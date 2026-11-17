import { describe, expect, it } from 'vitest'

import { noticeAuditProblems, type NoticeAuditRow } from './audit-assertions.js'

// MD-37: la comprobación de la auditoría del aviso fallido no puede depender de cifras que aparezcan
// por casualidad en identificadores o fechas. Datos deterministas: nada aquí es aleatorio.

const USER = 'cuser0000000000000000001'
const SMTP_ERROR = '550 Recipient rejected: antiguo@example.test'
const FORBIDDEN = ['antiguo@example.test', 'nuevo@example.test', 'http://localhost:3000/api/auth/security-incident/tok-secreto', 'tok-secreto', SMTP_ERROR, 'Recipient rejected', '550']

const row = (overrides: Partial<NoticeAuditRow> = {}): NoticeAuditRow => ({
  id: 'caudit000000000000000001',
  actorUserId: USER,
  targetUserId: USER,
  action: 'EMAIL_CHANGE_NOTICE_FAILED',
  reason: null,
  metadata: JSON.stringify({ noticeFailure: 'DELIVERY' }),
  createdAt: new Date('2026-11-12T10:00:00.000Z'),
  ...overrides,
})

const problems = (overrides: Partial<NoticeAuditRow> = {}, noticeFailure: 'DELIVERY' | 'INCIDENT_LINK' = 'DELIVERY') =>
  noticeAuditProblems(row(overrides), { userId: USER, noticeFailure, forbidden: FORBIDDEN })

describe('auditoría del aviso de cambio de email no entregado (MD-37)', () => {
  it('fila correcta: sin incumplimientos', () => {
    expect(problems()).toEqual([])
  })

  it('«550» en el identificador o en la fecha no es una fuga: no hay falso positivo', () => {
    expect(problems({ id: 'cmwdg550be5200hjt8u4vj55' })).toEqual([])
    expect(problems({ createdAt: new Date('2026-11-12T10:05:50.550Z') })).toEqual([])
    expect(problems({ id: 'c550550550550550550550550', createdAt: new Date('2550-05-05T05:50:55.550Z') })).toEqual([])
    // La búsqueda antigua, sobre el JSON completo, sí fallaba con estas filas válidas.
    expect(JSON.stringify(row({ createdAt: new Date('2026-11-12T10:05:50.550Z') }))).toContain('550')
  })

  it('otro identificador u otra fecha válidos no cambian el resultado', () => {
    expect(problems({ id: 'cotroidentificador0000009', createdAt: new Date('2031-01-02T03:04:05.006Z') })).toEqual([])
  })

  it('el mensaje del servidor de correo en un campo funcional sí se detecta', () => {
    expect(problems({ reason: SMTP_ERROR })).toEqual(expect.arrayContaining(['reason: debe ser null', 'reason: contiene un dato que no debe guardarse']))
    const leaked = problems({ metadata: JSON.stringify({ noticeFailure: 'DELIVERY', error: SMTP_ERROR }) })
    expect(leaked).toContain('metadata: debe contener solo noticeFailure')
    expect(leaked).toContain('metadata: contiene un dato que no debe guardarse')
    expect(problems({ metadata: JSON.stringify({ noticeFailure: '550 Recipient rejected' }) }).length).toBeGreaterThan(0)
  })

  it.each([
    ['la dirección anterior', 'antiguo@example.test'],
    ['la dirección nueva', 'nuevo@example.test'],
    ['el enlace de incidente', 'http://localhost:3000/api/auth/security-incident/tok-secreto'],
    ['el token de incidente', 'tok-secreto'],
  ])('%s en metadata o en reason se detecta', (_label, secret) => {
    expect(problems({ metadata: JSON.stringify({ noticeFailure: 'DELIVERY', detail: secret }) })).toContain('metadata: contiene un dato que no debe guardarse')
    expect(problems({ reason: `aviso a ${secret}` })).toContain('reason: contiene un dato que no debe guardarse')
  })

  it('un valor funcional incorrecto hace fallar la comprobación', () => {
    expect(problems({ metadata: JSON.stringify({ noticeFailure: 'INCIDENT_LINK' }) })).toEqual(['metadata.noticeFailure: se esperaba DELIVERY'])
    expect(problems({}, 'INCIDENT_LINK')).toEqual(['metadata.noticeFailure: se esperaba INCIDENT_LINK'])
    expect(problems({ metadata: JSON.stringify({ noticeFailure: 'INCIDENT_LINK' }) }, 'INCIDENT_LINK')).toEqual([])
    expect(problems({ action: 'EMAIL_CHANGE_COMPLETED' })).toEqual(['action: valor inesperado'])
    expect(problems({ actorUserId: 'cotro0000000000000000002' })).toEqual(['actorUserId: no es el usuario'])
    expect(problems({ targetUserId: null })).toEqual(['targetUserId: no es el usuario'])
    expect(problems({ metadata: null })).toEqual(['metadata: no es texto JSON'])
    expect(problems({ metadata: '{no es json' })).toEqual(['metadata: JSON no válido'])
    expect(problems({ metadata: '[]' })).toEqual(['metadata: debe contener solo noticeFailure'])
    expect(problems({ metadata: '{}' })).toEqual(['metadata: debe contener solo noticeFailure'])
  })

  it('los campos técnicos se validan por su tipo y un campo de más se detecta', () => {
    expect(problems({ id: '' })).toEqual(['id: no es un identificador'])
    expect(problems({ createdAt: '2026-11-12T10:00:00.000Z' })).toEqual(['createdAt: no es una fecha'])
    expect(problems({ createdAt: new Date('no es fecha') })).toEqual(['createdAt: no es una fecha'])
    expect(noticeAuditProblems({ ...row(), smtpResponse: SMTP_ERROR } as NoticeAuditRow, { userId: USER, noticeFailure: 'DELIVERY', forbidden: FORBIDDEN })).toEqual([
      'campos inesperados: action,actorUserId,createdAt,id,metadata,reason,smtpResponse,targetUserId',
    ])
  })
})
