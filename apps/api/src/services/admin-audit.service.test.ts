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
})
