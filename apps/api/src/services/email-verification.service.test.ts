import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Pruebas UNITARIAS con un doble de Prisma: $transaction ejecuta el callback con tx y, si el
// callback lanza, rechaza (como Prisma, que deshace la transacción). Comprueban qué operaciones
// pide el servicio y cómo decide; la concurrencia real con SQLite se prueba en la integración.
const db = vi.hoisted(() => ({
  // Bloqueo de la fila de la cuenta (F0-001): devuelve las filas afectadas.
  $executeRaw: vi.fn(),
  user: { findUnique: vi.fn(), updateMany: vi.fn() },
  emailVerificationToken: {
    count: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
    create: vi.fn(),
  },
}))
vi.mock('../db/prisma.js', () => ({
  prisma: {
    ...db,
    $transaction: vi.fn(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db)),
  },
}))

const mail = vi.hoisted(() => ({ sendEmailVerificationEmail: vi.fn() }))
vi.mock('./email.service.js', () => ({ emailService: mail }))

import {
  MAX_TOKENS_PER_DAY,
  RESEND_COOLDOWN_MS,
  consumeEmailVerificationToken,
  createEmailVerificationToken,
  emailAccess,
  emailAllowsAccess,
  hashEmailVerificationToken,
  isEmailVerificationTokenFormat,
  issueEmailVerificationToken,
  readEmailVerificationPolicy,
  sendEmailVerification,
  sendEmailVerificationInBackground,
  waitForPendingVerificationDeliveries,
  type EmailVerificationPolicy,
} from './email-verification.service.js'

const USER_ID = 'user-1'
const EMAIL = 'titular@estateforge.test'
const OTHER_EMAIL = 'otro@estateforge.test'
const NOW = new Date('2026-12-10T12:00:00.000Z')
const REQUIRED_FROM = new Date('2026-12-01T00:00:00.000Z')
const GRACE_UNTIL = new Date('2027-01-01T00:00:00.000Z')
const POLICY: EmailVerificationPolicy = { requiredFrom: REQUIRED_FROM, graceUntil: GRACE_UNTIL, tokenTtlMs: 24 * 60 * 60 * 1000 }
const TOKEN = 'c'.repeat(64)
const USABLE = { securityHoldAt: null, adminSuspendedAt: null, passwordResetRequiredAt: null }

function account(extra: Record<string, unknown> = {}) {
  return { email: EMAIL, emailVerifiedAt: null, ...USABLE, ...extra }
}

beforeEach(() => {
  vi.clearAllMocks()
  db.$executeRaw.mockResolvedValue(1)
  db.user.updateMany.mockResolvedValue({ count: 1 })
  db.emailVerificationToken.updateMany.mockResolvedValue({ count: 1 })
  db.emailVerificationToken.deleteMany.mockResolvedValue({ count: 0 })
  db.emailVerificationToken.create.mockResolvedValue({})
  db.emailVerificationToken.count.mockResolvedValue(0)
})

describe('readEmailVerificationPolicy', () => {
  it('sin variables no exige la verificación y el enlace dura 24 horas', () => {
    expect(readEmailVerificationPolicy({})).toEqual({ requiredFrom: null, graceUntil: null, tokenTtlMs: 24 * 60 * 60 * 1000 })
  })

  it('las variables vacías equivalen a no configuradas', () => {
    expect(readEmailVerificationPolicy({ EMAIL_VERIFICATION_REQUIRED_FROM: ' ', EMAIL_VERIFICATION_GRACE_UNTIL: '', EMAIL_VERIFICATION_TOKEN_TTL_HOURS: '' }))
      .toEqual({ requiredFrom: null, graceUntil: null, tokenTtlMs: 24 * 60 * 60 * 1000 })
  })

  it('lee una fecha con Z, otra con desplazamiento (como el instante UTC que representa) y la caducidad', () => {
    expect(readEmailVerificationPolicy({
      EMAIL_VERIFICATION_REQUIRED_FROM: '2026-12-01T00:00:00Z',
      EMAIL_VERIFICATION_GRACE_UNTIL: '2027-01-01T02:00:00+02:00',
      EMAIL_VERIFICATION_TOKEN_TTL_HOURS: '48',
    })).toEqual({ requiredFrom: REQUIRED_FROM, graceUntil: GRACE_UNTIL, tokenTtlMs: 48 * 60 * 60 * 1000 })
  })

  it.each([
    '2026-12-01T00:00Z',
    '2026-12-01T00:00:00.123Z',
    '2028-02-29T00:00:00Z',
    '2026-12-01T00:00:00-12:00',
    '2026-12-01T00:00:00+14:00',
    '2026-12-01T23:59:59+05:30',
  ])('acepta la fecha válida «%s»', value => {
    expect(readEmailVerificationPolicy({ EMAIL_VERIFICATION_REQUIRED_FROM: value }).requiredFrom).toEqual(new Date(value))
  })

  it.each([
    ['una fecha imposible (31 de febrero)', '2026-02-31T00:00:00Z'],
    ['un 29 de febrero de año no bisiesto', '2027-02-29T00:00:00Z'],
    ['el mes 13', '2026-13-01T00:00:00Z'],
    ['el mes 0', '2026-00-10T00:00:00Z'],
    ['el día 0', '2026-12-00T00:00:00Z'],
    ['el 31 de un mes de 30 días', '2026-11-31T00:00:00Z'],
    ['la hora 25', '2026-12-01T25:00:00Z'],
    ['la hora 24', '2026-12-01T24:00:00Z'],
    ['el minuto 60', '2026-12-01T10:60:00Z'],
    ['el segundo 60', '2026-12-01T10:00:60Z'],
    ['un desplazamiento de +15:00', '2026-12-01T00:00:00+15:00'],
    ['un desplazamiento de -13:00', '2026-12-01T00:00:00-13:00'],
    ['un desplazamiento de +14:30', '2026-12-01T00:00:00+14:30'],
    ['minutos de desplazamiento 60', '2026-12-01T00:00:00+05:60'],
    ['un desplazamiento sin dos puntos', '2026-12-01T00:00:00+0200'],
    ['una fecha sin zona horaria', '2026-12-01T00:00:00'],
    ['solo la fecha', '2026-12-01'],
    ['un formato regional', '01/12/2026 00:00'],
    ['un texto', 'mañana'],
  ])('rechaza %s («%s»)', (_label, value) => {
    expect(() => readEmailVerificationPolicy({ EMAIL_VERIFICATION_REQUIRED_FROM: value })).toThrow(/EMAIL_VERIFICATION_REQUIRED_FROM/)
  })

  it('valida también la fecha de gracia', () => {
    expect(() => readEmailVerificationPolicy({
      EMAIL_VERIFICATION_REQUIRED_FROM: '2026-12-01T00:00:00Z',
      EMAIL_VERIFICATION_GRACE_UNTIL: '2026-02-30T00:00:00Z',
    })).toThrow(/EMAIL_VERIFICATION_GRACE_UNTIL/)
  })

  it('rechaza un fin de gracia sin fecha de inicio o anterior a ella', () => {
    expect(() => readEmailVerificationPolicy({ EMAIL_VERIFICATION_GRACE_UNTIL: '2027-01-01T00:00:00Z' })).toThrow(/requiere/)
    expect(() => readEmailVerificationPolicy({
      EMAIL_VERIFICATION_REQUIRED_FROM: '2027-01-01T00:00:00Z',
      EMAIL_VERIFICATION_GRACE_UNTIL: '2026-12-01T00:00:00Z',
    })).toThrow(/anterior/)
    // El orden se compara por el instante real, no por el texto.
    expect(() => readEmailVerificationPolicy({
      EMAIL_VERIFICATION_REQUIRED_FROM: '2027-01-01T00:00:00Z',
      EMAIL_VERIFICATION_GRACE_UNTIL: '2027-01-01T01:00:00+02:00',
    })).toThrow(/anterior/)
  })

  it.each(['0', '169', '1.5', 'abc', '-1'])('rechaza una caducidad de «%s» horas', value => {
    expect(() => readEmailVerificationPolicy({ EMAIL_VERIFICATION_TOKEN_TTL_HOURS: value })).toThrow(/TTL_HOURS/)
  })
})

describe('emailAccess', () => {
  const existing = new Date('2026-06-01T00:00:00.000Z')
  const created = new Date('2026-12-05T00:00:00.000Z')

  it('un email verificado siempre tiene acceso', () => {
    expect(emailAccess({ emailVerifiedAt: NOW, createdAt: created }, POLICY, NOW)).toBe('VERIFIED')
  })

  it('sin fecha de inicio no se exige a nadie', () => {
    const policy = { ...POLICY, requiredFrom: null, graceUntil: null }
    expect(emailAccess({ emailVerifiedAt: null, createdAt: created }, policy, NOW)).toBe('NOT_ENFORCED')
  })

  it('una cuenta nueva sin verificar no tiene acceso', () => {
    expect(emailAccess({ emailVerifiedAt: null, createdAt: created }, POLICY, NOW)).toBe('REQUIRED')
    // Creada justo en la fecha de inicio: ya es nueva.
    expect(emailAccess({ emailVerifiedAt: null, createdAt: REQUIRED_FROM }, POLICY, NOW)).toBe('REQUIRED')
  })

  it('una cuenta existente sin verificar entra durante el periodo de gracia', () => {
    expect(emailAccess({ emailVerifiedAt: null, createdAt: existing }, POLICY, NOW)).toBe('GRACE')
    expect(emailAccess({ emailVerifiedAt: null, createdAt: existing }, POLICY, new Date(GRACE_UNTIL.getTime() - 1))).toBe('GRACE')
  })

  it('al terminar el periodo de gracia, la cuenta existente sin verificar debe verificar', () => {
    expect(emailAccess({ emailVerifiedAt: null, createdAt: existing }, POLICY, GRACE_UNTIL)).toBe('REQUIRED')
  })

  it('sin fin de gracia, las cuentas existentes siguen entrando', () => {
    expect(emailAccess({ emailVerifiedAt: null, createdAt: existing }, { ...POLICY, graceUntil: null }, new Date('2030-01-01T00:00:00Z'))).toBe('GRACE')
  })

  it('solo REQUIRED impide el acceso', () => {
    expect(['VERIFIED', 'NOT_ENFORCED', 'GRACE', 'REQUIRED'].map(a => emailAllowsAccess(a as never))).toEqual([true, true, true, false])
  })
})

describe('tokens', () => {
  it('son 32 bytes aleatorios en hexadecimal y distintos en cada llamada', () => {
    const a = createEmailVerificationToken()
    const b = createEmailVerificationToken()
    expect(isEmailVerificationTokenFormat(a)).toBe(true)
    expect(a).not.toBe(b)
  })

  it('el hash es SHA-256 y no contiene el token', () => {
    const hash = hashEmailVerificationToken(TOKEN)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).not.toBe(TOKEN)
  })

  it.each([['', false], ['C'.repeat(64), false], ['c'.repeat(63), false], ['c'.repeat(65), false], [123, false], [TOKEN, true]])('formato de %j: %s', (value, ok) => {
    expect(isEmailVerificationTokenFormat(value)).toBe(ok)
  })
})

describe('issueEmailVerificationToken', () => {
  it('reserva el envío con una escritura condicional sobre la cuenta antes de nada', async () => {
    db.user.findUnique.mockResolvedValue({ email: EMAIL })

    await issueEmailVerificationToken(USER_ID, POLICY, NOW)

    expect(db.user.updateMany).toHaveBeenCalledWith({
      where: {
        id: USER_ID,
        emailVerifiedAt: null,
        ...USABLE,
        OR: [
          { emailVerificationSentAt: null },
          { emailVerificationSentAt: { lte: new Date(NOW.getTime() - RESEND_COOLDOWN_MS) } },
        ],
      },
      data: { emailVerificationSentAt: NOW },
    })
    expect(db.user.updateMany.mock.invocationCallOrder[0]).toBeLessThan(db.emailVerificationToken.count.mock.invocationCallOrder[0])
  })

  it('emite un token, guarda solo su hash con la caducidad y el email, e invalida los anteriores', async () => {
    db.user.findUnique.mockResolvedValue({ email: EMAIL })

    const result = await issueEmailVerificationToken(USER_ID, POLICY, NOW)

    expect(result.issued).toBe(true)
    if (!result.issued) return
    expect(result.email).toBe(EMAIL)
    expect(result.expiresAt).toEqual(new Date(NOW.getTime() + POLICY.tokenTtlMs))
    expect(db.emailVerificationToken.updateMany).toHaveBeenCalledWith({ where: { userId: USER_ID, usedAt: null }, data: { usedAt: NOW } })
    const created = db.emailVerificationToken.create.mock.calls[0][0].data
    expect(created).toEqual({ tokenHash: hashEmailVerificationToken(result.token), userId: USER_ID, email: EMAIL, expiresAt: result.expiresAt, createdAt: NOW })
    expect(JSON.stringify(created)).not.toContain(result.token)
  })

  it('si la reserva falla con la cuenta disponible, es el intervalo mínimo: no emite nada', async () => {
    db.user.updateMany.mockResolvedValue({ count: 0 })
    db.user.findUnique.mockResolvedValue(account())

    expect(await issueEmailVerificationToken(USER_ID, POLICY, NOW)).toEqual({ issued: false, reason: 'cooldown' })
    expect(db.emailVerificationToken.count).not.toHaveBeenCalled()
    expect(db.emailVerificationToken.create).not.toHaveBeenCalled()
    expect(db.emailVerificationToken.updateMany).not.toHaveBeenCalled()
  })

  it.each([
    ['no existe', null],
    ['ya verificada', account({ emailVerifiedAt: NOW })],
    ['protegida', account({ securityHoldAt: NOW })],
    ['suspendida', account({ adminSuspendedAt: NOW })],
    ['en recuperación obligatoria (E2)', account({ passwordResetRequiredAt: NOW })],
  ])('si la reserva falla porque la cuenta %s, no es elegible', async (_label, user) => {
    db.user.updateMany.mockResolvedValue({ count: 0 })
    db.user.findUnique.mockResolvedValue(user)

    expect(await issueEmailVerificationToken(USER_ID, POLICY, NOW)).toEqual({ issued: false, reason: 'not_eligible' })
    expect(db.emailVerificationToken.create).not.toHaveBeenCalled()
  })

  it(`con ${MAX_TOKENS_PER_DAY} envíos en 24 horas no emite y deshace la reserva`, async () => {
    db.user.findUnique.mockResolvedValue({ email: EMAIL })
    db.emailVerificationToken.count.mockResolvedValue(MAX_TOKENS_PER_DAY)

    expect(await issueEmailVerificationToken(USER_ID, POLICY, NOW)).toEqual({ issued: false, reason: 'daily_limit' })
    expect(db.emailVerificationToken.create).not.toHaveBeenCalled()
    expect(db.emailVerificationToken.updateMany).not.toHaveBeenCalled()
  })

  it('cuenta los envíos de las últimas 24 horas', async () => {
    db.user.findUnique.mockResolvedValue({ email: EMAIL })
    await issueEmailVerificationToken(USER_ID, POLICY, NOW)

    expect(db.emailVerificationToken.count).toHaveBeenCalledWith({
      where: { userId: USER_ID, createdAt: { gt: new Date(NOW.getTime() - 24 * 60 * 60 * 1000) } },
    })
  })
})

describe('consumeEmailVerificationToken', () => {
  const HASH = hashEmailVerificationToken(TOKEN)
  const record = (extra: Record<string, unknown> = {}) => ({
    id: 'evt-1', userId: USER_ID, email: EMAIL, expiresAt: new Date(NOW.getTime() + 60_000), usedAt: null, ...extra,
  })

  it('con la escritura aplicada (count = 1) verifica el email y deja sin efecto los demás enlaces', async () => {
    db.emailVerificationToken.findUnique.mockResolvedValue(record())
    db.user.findUnique.mockResolvedValue(account())

    expect(await consumeEmailVerificationToken(TOKEN, NOW)).toBe('verified')
    expect(db.emailVerificationToken.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { tokenHash: HASH } }))
    expect(db.emailVerificationToken.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'evt-1', usedAt: null, expiresAt: { gt: NOW } },
      data: { usedAt: NOW },
    })
    expect(db.user.updateMany).toHaveBeenCalledWith({
      where: { id: USER_ID, email: EMAIL, emailVerifiedAt: null, ...USABLE },
      data: { emailVerifiedAt: NOW },
    })
    expect(db.emailVerificationToken.updateMany).toHaveBeenNthCalledWith(2, { where: { userId: USER_ID, usedAt: null }, data: { usedAt: NOW } })
  })

  it('bloquea la fila de la cuenta antes de leerla y de escribir el token (orden único, F0-001)', async () => {
    db.emailVerificationToken.findUnique.mockResolvedValue(record())
    db.user.findUnique.mockResolvedValue(account())

    expect(await consumeEmailVerificationToken(TOKEN, NOW)).toBe('verified')
    expect(db.$executeRaw).toHaveBeenCalledOnce()
    const [sql, ...values] = db.$executeRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]]
    expect(sql.join('?')).toBe('UPDATE "User" SET "role" = "role" WHERE "id" = ?')
    expect(values).toEqual([USER_ID])
    const lockOrder = db.$executeRaw.mock.invocationCallOrder[0]
    expect(lockOrder).toBeLessThan(db.user.findUnique.mock.invocationCallOrder[0])
    expect(lockOrder).toBeLessThan(db.emailVerificationToken.updateMany.mock.invocationCallOrder[0])
    expect(lockOrder).toBeLessThan(db.user.updateMany.mock.invocationCallOrder[0])
  })

  it('si la cuenta ya no existe al bloquearla, no verifica ni escribe', async () => {
    db.emailVerificationToken.findUnique.mockResolvedValue(record())
    db.$executeRaw.mockResolvedValue(0)

    expect(await consumeEmailVerificationToken(TOKEN, NOW)).toBe('invalid')
    expect(db.user.findUnique).not.toHaveBeenCalled()
    expect(db.emailVerificationToken.updateMany).not.toHaveBeenCalled()
    expect(db.user.updateMany).not.toHaveBeenCalled()
  })

  it('un token caducado, usado o inexistente no bloquea la cuenta', async () => {
    db.emailVerificationToken.findUnique.mockResolvedValueOnce(record({ expiresAt: NOW }))
    expect(await consumeEmailVerificationToken(TOKEN, NOW)).toBe('expired')
    db.emailVerificationToken.findUnique.mockResolvedValueOnce(record({ usedAt: NOW }))
    expect(await consumeEmailVerificationToken(TOKEN, NOW)).toBe('invalid')
    db.emailVerificationToken.findUnique.mockResolvedValueOnce(null)
    expect(await consumeEmailVerificationToken(TOKEN, NOW)).toBe('invalid')
    expect(db.$executeRaw).not.toHaveBeenCalled()
  })

  it('con la escritura sin efecto (count = 0) y la cuenta cambiada no verifica y lanza dentro de la transacción', async () => {
    db.emailVerificationToken.findUnique.mockResolvedValue(record())
    // Lectura: email del token. Escritura: no afecta. Relectura: otro email.
    db.user.findUnique.mockResolvedValueOnce(account()).mockResolvedValueOnce(account({ email: OTHER_EMAIL }))
    db.user.updateMany.mockResolvedValue({ count: 0 })

    await expect(consumeEmailVerificationToken(TOKEN, NOW)).resolves.toBe('invalid')
    // El callback lanzó (ConsumeAbort), que es lo que hace que Prisma deshaga la transacción. Este
    // doble no deshace nada: el ROLLBACK real se prueba con SQLite en la integración (14.h).
    const transaction = (await import('../db/prisma.js')).prisma.$transaction as unknown as ReturnType<typeof vi.fn>
    await expect(transaction.mock.results[0].value).rejects.toBeInstanceOf(Error)
    // No se invalidan los demás enlaces: solo hubo la reclamación del token.
    expect(db.emailVerificationToken.updateMany).toHaveBeenCalledOnce()
  })

  it('con la escritura sin efecto porque la cuenta entró en E2 entre medias, no verifica', async () => {
    db.emailVerificationToken.findUnique.mockResolvedValue(record())
    db.user.findUnique.mockResolvedValueOnce(account()).mockResolvedValueOnce(account({ passwordResetRequiredAt: NOW }))
    db.user.updateMany.mockResolvedValue({ count: 0 })

    expect(await consumeEmailVerificationToken(TOKEN, NOW)).toBe('invalid')
  })

  it('con la escritura sin efecto porque otra operación ya lo verificó con el mismo email, es verificado', async () => {
    db.emailVerificationToken.findUnique.mockResolvedValue(record())
    db.user.findUnique.mockResolvedValueOnce(account()).mockResolvedValueOnce(account({ emailVerifiedAt: NOW }))
    db.user.updateMany.mockResolvedValue({ count: 0 })

    expect(await consumeEmailVerificationToken(TOKEN, NOW)).toBe('verified')
  })

  it('no verifica si la cuenta ya tenía otro email al leerla', async () => {
    db.emailVerificationToken.findUnique.mockResolvedValue(record())
    db.user.findUnique.mockResolvedValue(account({ email: OTHER_EMAIL }))

    expect(await consumeEmailVerificationToken(TOKEN, NOW)).toBe('invalid')
    expect(db.emailVerificationToken.updateMany).not.toHaveBeenCalled()
    expect(db.user.updateMany).not.toHaveBeenCalled()
  })

  it('si otra petición reclama el token a la vez (count = 0), esta no verifica', async () => {
    db.emailVerificationToken.findUnique.mockResolvedValue(record())
    db.user.findUnique.mockResolvedValue(account())
    db.emailVerificationToken.updateMany.mockResolvedValueOnce({ count: 0 })

    expect(await consumeEmailVerificationToken(TOKEN, NOW)).toBe('invalid')
    expect(db.user.updateMany).not.toHaveBeenCalled()
  })

  it('un token caducado no verifica', async () => {
    db.emailVerificationToken.findUnique.mockResolvedValue(record({ expiresAt: NOW }))

    expect(await consumeEmailVerificationToken(TOKEN, NOW)).toBe('expired')
    expect(db.user.updateMany).not.toHaveBeenCalled()
  })

  it('un token inexistente (inventado o manipulado) no verifica', async () => {
    db.emailVerificationToken.findUnique.mockResolvedValue(null)

    expect(await consumeEmailVerificationToken('d'.repeat(64), NOW)).toBe('invalid')
    expect(db.user.updateMany).not.toHaveBeenCalled()
  })

  it.each(['', 'abc', 'C'.repeat(64), `${TOKEN}x`])('un token con formato incorrecto («%s») ni se busca', async value => {
    expect(await consumeEmailVerificationToken(value, NOW)).toBe('invalid')
    expect(db.emailVerificationToken.findUnique).not.toHaveBeenCalled()
  })

  it('un token ya usado no verifica otra vez', async () => {
    db.emailVerificationToken.findUnique.mockResolvedValue(record({ usedAt: NOW }))

    expect(await consumeEmailVerificationToken(TOKEN, NOW)).toBe('invalid')
    expect(db.user.updateMany).not.toHaveBeenCalled()
  })

  it.each([
    ['protegida', { securityHoldAt: NOW }],
    ['suspendida', { adminSuspendedAt: NOW }],
    ['en recuperación obligatoria (E2)', { passwordResetRequiredAt: NOW }],
  ])('no verifica una cuenta %s', async (_label, state) => {
    db.emailVerificationToken.findUnique.mockResolvedValue(record())
    db.user.findUnique.mockResolvedValue(account(state))

    expect(await consumeEmailVerificationToken(TOKEN, NOW)).toBe('invalid')
    expect(db.user.updateMany).not.toHaveBeenCalled()
  })

  it('con el email ya verificado al leerlo, consume el token sin volver a fecharlo', async () => {
    db.emailVerificationToken.findUnique.mockResolvedValue(record())
    db.user.findUnique.mockResolvedValue(account({ emailVerifiedAt: new Date('2026-12-02T00:00:00Z') }))

    expect(await consumeEmailVerificationToken(TOKEN, NOW)).toBe('verified')
    expect(db.user.updateMany).not.toHaveBeenCalled()
  })
})

describe('envío', () => {
  it('envía el enlace al email asociado al token', async () => {
    db.user.findUnique.mockResolvedValue({ email: EMAIL })

    const result = await sendEmailVerification(USER_ID)

    expect(result.issued).toBe(true)
    if (!result.issued) return
    const sent = mail.sendEmailVerificationEmail.mock.calls[0][0]
    expect(sent.to).toBe(EMAIL)
    expect(sent.verifyUrl).toBe(`http://localhost:5173/verificar-email?token=${result.token}`)
  })

  it('si la cuenta cambia de email tras emitir el token, el enlace va al email del token, no al nuevo', async () => {
    // La única lectura del email es la de la emisión; después la cuenta ya tendría otro email.
    db.user.findUnique.mockResolvedValueOnce({ email: EMAIL }).mockResolvedValue({ email: OTHER_EMAIL })

    await sendEmailVerification(USER_ID)

    expect(mail.sendEmailVerificationEmail).toHaveBeenCalledOnce()
    expect(mail.sendEmailVerificationEmail.mock.calls[0][0].to).toBe(EMAIL)
    expect(db.emailVerificationToken.create.mock.calls[0][0].data.email).toBe(EMAIL)
    expect(db.user.findUnique).toHaveBeenCalledOnce()
  })

  it('no envía si no se emite el token', async () => {
    db.user.updateMany.mockResolvedValue({ count: 0 })
    db.user.findUnique.mockResolvedValue(account({ emailVerifiedAt: NOW }))

    await sendEmailVerification(USER_ID)
    expect(mail.sendEmailVerificationEmail).not.toHaveBeenCalled()
  })

  it('no envía si la cuenta desaparece durante la emisión', async () => {
    db.user.findUnique.mockResolvedValue(null)

    expect(await sendEmailVerification(USER_ID)).toEqual({ issued: false, reason: 'not_eligible' })
    expect(mail.sendEmailVerificationEmail).not.toHaveBeenCalled()
  })

  // Corrección A de la Fase 1: antes se registraba error.message con console.error. Se prueba con
  // el registro real de Fastify (pino) lo que queda escrito.
  it('en segundo plano, un fallo del SMTP se registra con campos cerrados, sin email, token, hash ni enlace', async () => {
    db.user.findUnique.mockResolvedValue({ email: EMAIL })
    const lines: string[] = []
    const app = Fastify({ logger: { level: 'info', stream: { write: (line: string) => { lines.push(line) } } } })
    let sentUrl = ''
    mail.sendEmailVerificationEmail.mockImplementationOnce(async ({ verifyUrl }: { verifyUrl: string }) => {
      sentUrl = verifyUrl
      throw Object.assign(new Error(`Invalid login: 535 5.7.8 rejected for ${EMAIL} at ${verifyUrl}`), {
        code: 'EAUTH',
        response: `535 5.7.8 <${EMAIL}> authentication failed`,
        responseCode: 535,
        command: 'AUTH PLAIN',
        rejected: [EMAIL],
      })
    })

    sendEmailVerificationInBackground(app.log, USER_ID)
    expect(await waitForPendingVerificationDeliveries()).toEqual({ timedOut: false, pending: 0 })
    await app.close()

    const token = new URL(sentUrl).searchParams.get('token') as string
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    const entries = lines.map(line => JSON.parse(line) as Record<string, unknown>)
    const entry = entries.find(item => item.msg === 'No se pudo enviar el correo de verificación')
    // Sigue siendo útil: nivel de error, flujo, cuenta, tipo de error y códigos.
    expect(entry).toMatchObject({ level: 50, flow: 'email_verification', targetUserId: USER_ID, errorName: 'Error', errorCode: 'EAUTH', smtpResponseCode: 535 })
    expect(entry).not.toHaveProperty('err')
    const logged = lines.join('\n')
    for (const secret of [EMAIL, token, hashEmailVerificationToken(token), 'verificar-email', 'Invalid login', '5.7.8', 'AUTH PLAIN', 'rejected']) {
      expect(logged).not.toContain(secret)
    }
  })

  it('en segundo plano, un fallo de Prisma se registra con su código, sin el mensaje ni los argumentos', async () => {
    const lines: string[] = []
    const app = Fastify({ logger: { level: 'info', stream: { write: (line: string) => { lines.push(line) } } } })
    // Forma de PrismaClientKnownRequestError: el mensaje cita la consulta y sus valores.
    class PrismaClientKnownRequestError extends Error {
      override name = 'PrismaClientKnownRequestError'
      code = 'P2002'
      meta = { target: ['email'], modelName: 'EmailVerificationToken' }
      clientVersion = '7.9.1'
    }
    db.user.updateMany.mockRejectedValueOnce(new PrismaClientKnownRequestError(
      `Invalid \`prisma.user.updateMany()\` invocation: where { id: "${USER_ID}", email: "${EMAIL}" } tokenHash "${'f'.repeat(64)}"`,
    ))

    sendEmailVerificationInBackground(app.log, USER_ID)
    await waitForPendingVerificationDeliveries()
    await app.close()

    const entry = lines.map(line => JSON.parse(line) as Record<string, unknown>).find(item => item.msg === 'No se pudo enviar el correo de verificación')
    expect(entry).toMatchObject({ level: 50, flow: 'email_verification', targetUserId: USER_ID, errorName: 'PrismaClientKnownRequestError', errorCode: 'P2002' })
    expect(entry).not.toHaveProperty('smtpResponseCode')
    const logged = lines.join('\n')
    for (const secret of [EMAIL, 'f'.repeat(64), 'Invalid', 'updateMany', 'tokenHash', 'EmailVerificationToken', 'clientVersion']) {
      expect(logged).not.toContain(secret)
    }
    expect(mail.sendEmailVerificationEmail).not.toHaveBeenCalled()
  })
})
