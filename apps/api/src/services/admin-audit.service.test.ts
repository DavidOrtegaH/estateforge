import { describe, expect, it } from 'vitest'

import { buildAuditMetadata, parseAuditMetadata, resolveAuditAccounts } from './admin-audit.service.js'

describe('buildAuditMetadata', () => {
  it('guarda los dos emails', () => {
    expect(buildAuditMetadata({ actorEmail: 'owner@x.test', targetEmail: 'user@x.test' })).toBe(
      JSON.stringify({ actorEmail: 'owner@x.test', targetEmail: 'user@x.test' }),
    )
  })

  it('conserva revokedCount, también cuando es 0', () => {
    expect(JSON.parse(buildAuditMetadata({ revokedCount: 3, actorEmail: 'a@x.test', targetEmail: 'b@x.test' })!)).toEqual({
      revokedCount: 3, actorEmail: 'a@x.test', targetEmail: 'b@x.test',
    })
    expect(buildAuditMetadata({ revokedCount: 0 })).toBe(JSON.stringify({ revokedCount: 0 }))
  })

  it('omite los emails desconocidos', () => {
    expect(buildAuditMetadata({ actorEmail: null, targetEmail: 'b@x.test' })).toBe(JSON.stringify({ targetEmail: 'b@x.test' }))
    expect(buildAuditMetadata({ actorEmail: undefined, targetEmail: null, revokedCount: 2 })).toBe(JSON.stringify({ revokedCount: 2 }))
  })

  it('devuelve null si no hay ningún dato', () => {
    expect(buildAuditMetadata({ actorEmail: null, targetEmail: null })).toBeNull()
  })

  it('produce metadatos que parseAuditMetadata lee igual', () => {
    const input = { revokedCount: 0, actorEmail: 'a@x.test', targetEmail: 'b@x.test' }
    expect(parseAuditMetadata(buildAuditMetadata(input))).toEqual(input)
  })

  it('guarda el origen del destino de recuperación', () => {
    const input = { actorEmail: 'a@x.test', targetEmail: 'b@x.test', recoveryDestination: 'OWNER_PROVIDED' as const }
    expect(JSON.parse(buildAuditMetadata(input)!)).toEqual(input)
    expect(parseAuditMetadata(buildAuditMetadata(input))).toEqual(input)
  })

  it.each(['INCIDENT_LINK', 'DELIVERY'] as const)('guarda solo la fase del aviso fallido (%s), sin emails ni detalles', kind => {
    expect(buildAuditMetadata({ noticeFailure: kind })).toBe(JSON.stringify({ noticeFailure: kind }))
    expect(parseAuditMetadata(buildAuditMetadata({ noticeFailure: kind }))).toEqual({ noticeFailure: kind })
  })
})

describe('noticeFailure al leer', () => {
  it.each([
    ['un valor desconocido', 'SMTP_550'],
    ['un mensaje de error', 'Recipient rejected: anterior@x.test'],
    ['un número', 1],
  ])('ignora %s', (_label, value) => {
    expect(parseAuditMetadata(JSON.stringify({ noticeFailure: value }))).toEqual({})
  })
})

describe('parseAuditMetadata', () => {
  it.each([
    ['null', null],
    ['cadena vacía', ''],
    ['JSON inválido', '{no es json'],
    ['array', '[1,2]'],
    ['número', '42'],
    ['null en JSON', 'null'],
    ['texto JSON', '"texto"'],
  ])('devuelve un objeto vacío con %s', (_label, raw) => {
    expect(parseAuditMetadata(raw)).toEqual({})
  })

  it('lee los metadatos antiguos con solo revokedCount', () => {
    expect(parseAuditMetadata(JSON.stringify({ revokedCount: 3 }))).toEqual({ revokedCount: 3 })
  })

  it('conserva revokedCount 0', () => {
    expect(parseAuditMetadata(JSON.stringify({ revokedCount: 0 }))).toEqual({ revokedCount: 0 })
  })

  it('descarta solo los campos malformados y conserva los válidos', () => {
    expect(parseAuditMetadata(JSON.stringify({ revokedCount: '3', actorEmail: 5, targetEmail: 'b@x.test' }))).toEqual({
      targetEmail: 'b@x.test',
    })
    expect(parseAuditMetadata(JSON.stringify({ revokedCount: 0, actorEmail: '', targetEmail: null }))).toEqual({
      revokedCount: 0,
    })
  })

  it.each([
    ['negativo', -1],
    ['decimal', 1.5],
    ['booleano', true],
  ])('ignora un revokedCount %s', (_label, revokedCount) => {
    expect(parseAuditMetadata(JSON.stringify({ revokedCount, actorEmail: 'a@x.test' }))).toEqual({ actorEmail: 'a@x.test' })
  })

  it('ignora un email de más de 254 caracteres', () => {
    expect(parseAuditMetadata(JSON.stringify({ targetEmail: `${'a'.repeat(250)}@x.test` }))).toEqual({})
  })

  it.each(['STORED', 'OWNER_PROVIDED', 'OWNER_CORRECTED'])('lee recoveryDestination %s', recoveryDestination => {
    expect(parseAuditMetadata(JSON.stringify({ recoveryDestination }))).toEqual({ recoveryDestination })
  })

  it.each([
    ['desconocido', 'OTRO'],
    ['que es una dirección', 'titular@x.test'],
    ['que no es texto', 1],
  ])('ignora un recoveryDestination %s', (_label, recoveryDestination) => {
    expect(parseAuditMetadata(JSON.stringify({ recoveryDestination, actorEmail: 'a@x.test' }))).toEqual({ actorEmail: 'a@x.test' })
  })

  it('ignora las claves desconocidas', () => {
    expect(parseAuditMetadata(JSON.stringify({ revokedCount: 1, extra: 'x' }))).toEqual({ revokedCount: 1 })
  })
})

describe('resolveAuditAccounts', () => {
  const base = { id: 'log-1', action: 'ACCOUNT_SUSPENDED', reason: 'r', createdAt: new Date('2026-10-01T00:00:00.000Z') }
  const emails = new Map([['owner', 'owner@x.test'], ['user', 'user@x.test']])

  it('usa el email actual y separa el registrado en la acción', () => {
    const [log] = resolveAuditAccounts(
      [{ ...base, actorUserId: 'owner', targetUserId: 'user', metadata: JSON.stringify({ actorEmail: 'owner@x.test', targetEmail: 'antiguo@x.test' }) }],
      emails,
    )

    expect(log).toEqual({
      ...base,
      actorUserId: 'owner',
      targetUserId: 'user',
      actorEmail: 'owner@x.test',
      actorEmailAtAction: 'owner@x.test',
      actorFound: true,
      targetEmail: 'user@x.test',
      targetEmailAtAction: 'antiguo@x.test',
      targetFound: true,
      revokedCount: null,
      recoveryDestination: null,
      noticeFailure: null,
    })
    expect(log).not.toHaveProperty('metadata')
  })

  it('para una cuenta inexistente devuelve solo la instantánea, si existe', () => {
    const [withSnapshot, withoutSnapshot] = resolveAuditAccounts(
      [
        { ...base, actorUserId: 'owner', targetUserId: 'gone', metadata: JSON.stringify({ targetEmail: 'gone@x.test' }) },
        { ...base, actorUserId: 'gone-owner', targetUserId: 'gone', metadata: null },
      ],
      emails,
    )

    expect(withSnapshot).toMatchObject({ targetEmail: null, targetEmailAtAction: 'gone@x.test', targetFound: false })
    expect(withoutSnapshot).toMatchObject({
      actorEmail: null, actorEmailAtAction: null, actorFound: false,
      targetEmail: null, targetEmailAtAction: null, targetFound: false,
    })
  })

  it('sin cuenta afectada devuelve targetFound null', () => {
    const [log] = resolveAuditAccounts([{ ...base, actorUserId: 'owner', targetUserId: null, metadata: null }], emails)

    expect(log).toMatchObject({ targetUserId: null, targetEmail: null, targetFound: null })
  })

  it('sin actor (solicitud no autenticada) devuelve actorFound null y no busca su email', () => {
    const [log] = resolveAuditAccounts([{ ...base, actorUserId: null, targetUserId: 'user', metadata: null }], emails)

    expect(log).toMatchObject({
      actorUserId: null, actorEmail: null, actorEmailAtAction: null, actorFound: null,
      targetUserId: 'user', targetEmail: 'user@x.test', targetFound: true,
    })
  })

  it('expone revokedCount, incluido 0', () => {
    const logs = resolveAuditAccounts(
      [
        { ...base, actorUserId: 'owner', targetUserId: 'user', metadata: JSON.stringify({ revokedCount: 0 }) },
        { ...base, actorUserId: 'owner', targetUserId: 'user', metadata: JSON.stringify({ revokedCount: 4 }) },
      ],
      emails,
    )

    expect(logs.map(log => log.revokedCount)).toEqual([0, 4])
  })

  it('expone el origen del destino de recuperación, sin la dirección', () => {
    const [log] = resolveAuditAccounts(
      [{ ...base, actorUserId: 'owner', targetUserId: 'user', metadata: JSON.stringify({ recoveryDestination: 'OWNER_CORRECTED' }) }],
      emails,
    )

    expect(log.recoveryDestination).toBe('OWNER_CORRECTED')
  })

  it('expone la fase del aviso de cambio de email no enviado, y null si no la hay', () => {
    const [failed, other] = resolveAuditAccounts(
      [
        { ...base, actorUserId: 'user', targetUserId: 'user', metadata: JSON.stringify({ noticeFailure: 'DELIVERY' }) },
        { ...base, actorUserId: 'owner', targetUserId: 'user', metadata: null },
      ],
      emails,
    )

    expect(failed.noticeFailure).toBe('DELIVERY')
    expect(other.noticeFailure).toBeNull()
  })
})
