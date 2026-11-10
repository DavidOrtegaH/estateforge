import { createHash, randomBytes } from 'node:crypto'

import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify'
import pg from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestDatabase, type TestDatabase } from '../test-support/postgres.js'

// Recuperación de contraseña cuando falla el correo (DA-39), con PostgreSQL real y dos instancias de
// los servicios (cada una con su cliente Prisma y su pool). El transporte es un doble con fallos
// inyectados que reproduce las formas de nodemailer 10.0.12 comprobadas en smtp-failure-shapes.test.ts.
// No se envía ningún correo real.

const mail = vi.hoisted(() => ({
  behavior: null as null | ((args: { to: string; url: string }) => Promise<void>),
  sent: [] as { to: string; url: string; outcome: 'ok' | 'error' }[],
}))

vi.mock('../services/email.service.js', () => {
  const send = async (to: string, url: string) => {
    try {
      if (mail.behavior) await mail.behavior({ to, url })
      mail.sent.push({ to, url, outcome: 'ok' })
    } catch (error) {
      mail.sent.push({ to, url, outcome: 'error' })
      throw error
    }
  }
  return {
    emailService: {
      sendSecurityRecoveryEmail: (args: { to: string; recoveryUrl: string }) => send(args.to, args.recoveryUrl),
      sendPasswordResetEmail: (args: { to: string; resetUrl: string }) => send(args.to, args.resetUrl),
    },
  }
})

// Formas de nodemailer: fallos conocidos y fallos sin confirmar.
const smtp = {
  rejected: () => Object.assign(new Error("Can't send mail - all recipients were rejected: 550 5.1.1 rechazado"), { code: 'EENVELOPE', responseCode: 550, command: 'RCPT TO' }),
  refused: () => Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:2525'), { code: 'ECONNECTION', syscall: 'connect', errno: -4078, command: 'CONN' }),
  connectTimeout: () => Object.assign(new Error('Connection timeout'), { code: 'ETIMEDOUT', command: 'CONN' }),
  socketTimeout: () => Object.assign(new Error('Timeout'), { code: 'ETIMEDOUT', command: 'CONN' }),
  droppedAfterData: () => Object.assign(new Error('Connection closed unexpectedly'), { code: 'ECONNECTION', command: 'CONN' }),
}

let database: TestDatabase
let admin: pg.Client

type Services = {
  recovery: typeof import('../services/security-recovery.service.js')
  resets: typeof import('../services/password-reset.service.js')
  delivery: typeof import('../services/password-reset-delivery.service.js')
  authRoutes: typeof import('../routes/auth.routes.js')['authRoutes']
  close: () => Promise<void>
}
const instances: Services[] = []
const instance = (index: number) => instances[index % instances.length]

// Todo lo que registran los servicios, para comprobar al final que ningún token aparece.
const logged: unknown[] = []
const log = {
  error: vi.fn((...args: unknown[]) => logged.push(args)),
  warn: vi.fn((...args: unknown[]) => logged.push(args)),
  info: vi.fn((...args: unknown[]) => logged.push(args)),
} as unknown as FastifyBaseLogger
const issuedTokens = new Set<string>()

async function load(): Promise<Services> {
  vi.resetModules()
  const { closeDatabase } = await import('../db/prisma.js')
  return {
    recovery: await import('../services/security-recovery.service.js'),
    resets: await import('../services/password-reset.service.js'),
    delivery: await import('../services/password-reset-delivery.service.js'),
    authRoutes: (await import('../routes/auth.routes.js')).authRoutes,
    close: closeDatabase,
  }
}

const tokenOf = (url: string) => {
  const token = new URL(url).searchParams.get('token') ?? ''
  issuedTokens.add(token)
  return token
}
const hashOf = (token: string) => createHash('sha256').update(token).digest('hex')
const one = async <T>(text: string, values: unknown[] = []) => (await admin.query(text, values)).rows[0] as T
const activeTokens = (userId: string, purpose: string) =>
  one<{ n: number }>(`SELECT count(*)::int AS n FROM "PasswordResetToken" WHERE "userId" = $1 AND purpose = $2 AND "usedAt" IS NULL`, [userId, purpose]).then(row => row.n)
const activeHashes = async (userId: string) =>
  (await admin.query(`SELECT "tokenHash" FROM "PasswordResetToken" WHERE "userId" = $1 AND "usedAt" IS NULL`, [userId])).rows.map(row => row.tokenHash as string)

async function pendingAccount() {
  const id = `u${randomBytes(6).toString('hex')}`
  await admin.query(
    `INSERT INTO "User" (id, email, password, "updatedAt", "passwordResetRequiredAt", "securityRecoveryEmail", "securityHoldVersion")
     VALUES ($1, $2, 'hash-original', now(), now(), $3, 1)`,
    [id, `${id}@example.test`, `destino-${id}@example.test`],
  )
  return { id, email: `${id}@example.test`, destination: `destino-${id}@example.test` }
}

async function eligibleAccount() {
  const id = `u${randomBytes(6).toString('hex')}`
  await admin.query(`INSERT INTO "User" (id, email, password, "updatedAt") VALUES ($1, $2, 'hash-original', now())`, [id, `${id}@example.test`])
  return { id, email: `${id}@example.test` }
}

// Solicitud E2 del titular completa: emisión, envío en segundo plano y espera al envío.
async function requestRecovery(index: number, email: string) {
  const services = instance(index)
  const links = await services.recovery.issueRequestedRecoveryLinks(log, email)
  for (const link of links) services.recovery.deliverRecoveryLinkInBackground(log, link)
  await services.recovery.waitForPendingRecoveryDeliveries(10_000)
  return links
}

// forgot-password: emisión y envío en segundo plano.
async function requestReset(index: number, user: { id: string; email: string }) {
  const services = instance(index)
  services.delivery.deliverPasswordResetInBackground(log, user)
  await services.delivery.waitForPendingPasswordResetDeliveries(10_000)
}

function gate() {
  let open: () => void = () => undefined
  const promise = new Promise<void>(resolve => { open = resolve })
  return { promise, open }
}

async function dropTriggers() {
  await admin.query(`DROP TRIGGER IF EXISTS fail_token_insert ON "PasswordResetToken"`)
  await admin.query(`DROP TRIGGER IF EXISTS fail_token_delete ON "PasswordResetToken"`)
  await admin.query(`DROP FUNCTION IF EXISTS fail_token()`)
}

async function failTokens(operation: 'INSERT' | 'DELETE') {
  await admin.query(`CREATE OR REPLACE FUNCTION fail_token() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fallo inyectado'; END $$`)
  await admin.query(`CREATE TRIGGER fail_token_${operation.toLowerCase()} BEFORE ${operation} ON "PasswordResetToken" FOR EACH ROW EXECUTE FUNCTION fail_token()`)
}

beforeAll(async () => {
  database = await createTestDatabase()
  vi.stubEnv('DATABASE_URL', database.url)
  admin = new pg.Client({ connectionString: database.url })
  await admin.connect()
  instances.push(await load(), await load())
})

afterAll(async () => {
  // Ningún token en claro en lo registrado durante toda la batería.
  const text = JSON.stringify(logged)
  for (const token of issuedTokens) if (token) expect(text).not.toContain(token)
  await Promise.all(instances.map(services => services.close()))
  await admin.end()
  vi.unstubAllEnvs()
  await database.drop()
})

beforeEach(async () => {
  mail.behavior = null
  mail.sent.length = 0
  await dropTriggers()
})

afterEach(async () => {
  mail.behavior = null
  await dropTriggers()
})

describe('recuperación obligatoria (E2): el enlace del titular cuando falla el correo', () => {
  it('1. el correo sale: un token activo y el enfriamiento de 15 minutos se mantiene', async () => {
    const account = await pendingAccount()

    expect(await requestRecovery(0, account.email)).toHaveLength(1)
    expect(await activeTokens(account.id, 'SECURITY_RECOVERY')).toBe(1)
    expect(await requestRecovery(1, account.email)).toHaveLength(0)
  })

  it.each([
    ['destinatario rechazado (550)', smtp.rejected],
    ['servidor SMTP caído (conexión rechazada)', smtp.refused],
    ['tiempo agotado al conectar', smtp.connectTimeout],
  ])('2. fallo conocido (%s): no queda token activo ni enfriamiento reservado', async (_label, failure) => {
    const account = await pendingAccount()
    mail.behavior = async () => { throw failure() }

    expect(await requestRecovery(0, account.email)).toHaveLength(1)
    expect(await activeTokens(account.id, 'SECURITY_RECOVERY')).toBe(0)

    // Reintento inmediato desde la otra instancia: no espera 15 minutos.
    mail.behavior = null
    const [retry] = await requestRecovery(1, account.email)
    expect(retry).toBeDefined()
    expect(await activeTokens(account.id, 'SECURITY_RECOVERY')).toBe(1)
    expect(await instance(0).resets.consumeSecurityRecoveryToken(tokenOf(mail.sent.at(-1)!.url), 'hash-nuevo')).toBe('completed')
  })

  it.each([
    ['tiempo agotado a mitad del envío', smtp.socketTimeout],
    ['el proveedor recibe el mensaje y la conexión se corta', smtp.droppedAfterData],
  ])('3. envío sin confirmar (%s): el token y el enfriamiento se conservan, porque el correo pudo llegar', async (_label, failure) => {
    const account = await pendingAccount()
    mail.behavior = async () => { throw failure() }

    await requestRecovery(0, account.email)
    const kept = tokenOf(mail.sent[0].url)

    expect(await activeHashes(account.id)).toEqual([hashOf(kept)])
    mail.behavior = null
    expect(await requestRecovery(1, account.email)).toHaveLength(0)
    expect(await instance(1).resets.consumeSecurityRecoveryToken(kept, 'hash-nuevo')).toBe('completed')
  })

  it('4. si falla la persistencia del enlace no se envía nada, no queda token y se puede repetir', async () => {
    const account = await pendingAccount()
    await failTokens('INSERT')

    expect(await requestRecovery(0, account.email)).toHaveLength(0)
    expect(mail.sent).toEqual([])
    expect(await activeTokens(account.id, 'SECURITY_RECOVERY')).toBe(0)
    expect(await one<{ n: number }>(`SELECT count(*)::int AS n FROM "AdminAuditLog" WHERE "targetUserId" = $1`, [account.id])).toEqual({ n: 0 })

    await dropTriggers()
    expect(await requestRecovery(1, account.email)).toHaveLength(1)
  })

  it('5. si falla la anulación, el token queda activo hasta caducar, sin errores y sin el token en el log', async () => {
    const account = await pendingAccount()
    mail.behavior = async () => {
      await failTokens('DELETE')
      throw smtp.rejected()
    }

    await expect(requestRecovery(0, account.email)).resolves.toHaveLength(1)

    expect(await activeTokens(account.id, 'SECURITY_RECOVERY')).toBe(1)
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ compensation: 'failed', targetUserId: account.id }), expect.any(String))
  })

  it('6. un fallo tardío no anula el enlace emitido después por un OWNER (otra instancia)', async () => {
    const account = await pendingAccount()
    const slow = gate()
    let entered = false
    mail.behavior = async () => {
      entered = true
      await slow.promise
      throw smtp.rejected()
    }
    // Solicitud del titular: su envío queda retenido y fallará más tarde.
    const links = await instance(0).recovery.issueRequestedRecoveryLinks(log, account.email)
    issuedTokens.add(links[0].token)
    instance(0).recovery.deliverRecoveryLinkInBackground(log, links[0])
    await vi.waitFor(() => expect(entered).toBe(true))

    // Mientras tanto, un enlace nuevo de la misma cuenta, como el reenvío de un OWNER: sustituye al
    // anterior en la base y su correo sale.
    const fresh = instance(1).recovery.newRecoveryToken(account.id, account.destination, 1)
    await admin.query(`DELETE FROM "PasswordResetToken" WHERE "userId" = $1 AND "usedAt" IS NULL`, [account.id])
    await admin.query(
      `INSERT INTO "PasswordResetToken" (id, "userId", "tokenHash", "expiresAt", purpose, "deliverTo", "securityHoldVersion") VALUES ($1, $2, $3, $4, 'SECURITY_RECOVERY', $5, 1)`,
      [`t${randomBytes(6).toString('hex')}`, account.id, fresh.data.tokenHash, fresh.expiresAt, account.destination],
    )
    issuedTokens.add(fresh.token)

    slow.open()
    await instance(0).recovery.waitForPendingRecoveryDeliveries(10_000)

    expect(await activeHashes(account.id)).toEqual([fresh.data.tokenHash])
    expect(await instance(0).resets.consumeSecurityRecoveryToken(fresh.token, 'hash-nuevo')).toBe('completed')
  })

  it.each([0, 1, 2])('7. ronda %i: solicitudes simultáneas desde dos instancias con fallos y éxitos mezclados: como mucho un token activo y solo si su correo pudo llegar', async () => {
    const account = await pendingAccount()
    let call = 0
    mail.behavior = async () => {
      call++
      await new Promise(resolve => setTimeout(resolve, Math.random() * 30))
      if (call % 2 === 1) throw smtp.rejected()
    }

    for (let wave = 0; wave < 4; wave++) {
      await Promise.all(Array.from({ length: 8 }, (_, index) => requestRecovery(index + wave, account.email)))
      const active = await activeHashes(account.id)
      expect(active.length).toBeLessThanOrEqual(1)
      const delivered = mail.sent.filter(sent => sent.outcome === 'ok').map(sent => hashOf(tokenOf(sent.url)))
      for (const hash of active) expect(delivered).toContain(hash)
      if (active.length === 1) break
    }
  })
})

describe('autoservicio (forgot-password): el enlace cuando falla el correo', () => {
  it.each([
    ['rechazo del destinatario', smtp.rejected],
    ['servidor SMTP caído', smtp.refused],
  ])('8. fallo conocido (%s): no queda token activo y un reintento inmediato funciona', async (_label, failure) => {
    const user = await eligibleAccount()
    mail.behavior = async () => { throw failure() }

    await requestReset(0, user)
    expect(await activeTokens(user.id, 'SELF_SERVICE')).toBe(0)

    mail.behavior = null
    await requestReset(1, user)
    expect(await activeTokens(user.id, 'SELF_SERVICE')).toBe(1)
    expect(await instance(0).resets.consumePasswordResetToken(tokenOf(mail.sent.at(-1)!.url), 'hash-nuevo')).toBe(true)
  })

  it('9. envío sin confirmar: el token se conserva y sirve', async () => {
    const user = await eligibleAccount()
    mail.behavior = async () => { throw smtp.droppedAfterData() }

    await requestReset(0, user)

    expect(await activeTokens(user.id, 'SELF_SERVICE')).toBe(1)
    expect(await instance(1).resets.consumePasswordResetToken(tokenOf(mail.sent[0].url), 'hash-nuevo')).toBe(true)
  })

  it('10. una solicitud fallida no invalida el token válido de una solicitud posterior (dos instancias)', async () => {
    const user = await eligibleAccount()
    const slow = gate()
    let first = true
    mail.behavior = async () => {
      if (first) {
        first = false
        await slow.promise
        throw smtp.rejected()
      }
    }

    instance(0).delivery.deliverPasswordResetInBackground(log, user)
    await vi.waitFor(async () => expect(await activeTokens(user.id, 'SELF_SERVICE')).toBe(1))
    // Segunda solicitud, en la otra instancia: sustituye al token anterior y su correo sale.
    await requestReset(1, user)
    const valid = tokenOf(mail.sent.find(sent => sent.outcome === 'ok')!.url)

    slow.open()
    await instance(0).delivery.waitForPendingPasswordResetDeliveries(10_000)

    expect(await activeHashes(user.id)).toEqual([hashOf(valid)])
    expect(await instance(0).resets.consumePasswordResetToken(valid, 'hash-nuevo')).toBe(true)
  })

  it('11. si falla la persistencia no se envía nada y no queda token', async () => {
    const user = await eligibleAccount()
    await failTokens('INSERT')

    await requestReset(0, user)

    expect(mail.sent).toEqual([])
    expect(await activeTokens(user.id, 'SELF_SERVICE')).toBe(0)
  })

  it.each([0, 1, 2])('12. ronda %i: solicitudes simultáneas con fallos y éxitos mezclados: como mucho un token activo, de un correo que salió', async () => {
    const user = await eligibleAccount()
    let call = 0
    mail.behavior = async () => {
      call++
      await new Promise(resolve => setTimeout(resolve, Math.random() * 30))
      if (call % 3 !== 0) throw smtp.rejected()
    }

    await Promise.all(Array.from({ length: 9 }, (_, index) => requestReset(index, user)))

    const active = await activeHashes(user.id)
    expect(active.length).toBeLessThanOrEqual(1)
    const delivered = mail.sent.filter(sent => sent.outcome === 'ok').map(sent => hashOf(tokenOf(sent.url)))
    for (const hash of active) expect(delivered).toContain(hash)
  })
})

describe('consumo y anulación', () => {
  it('13. doble consumo simultáneo desde dos instancias: solo uno tiene éxito', async () => {
    const user = await eligibleAccount()
    await requestReset(0, user)
    const token = tokenOf(mail.sent[0].url)

    const results = await Promise.all(Array.from({ length: 6 }, (_, index) => instance(index).resets.consumePasswordResetToken(token, `hash-${index}`)))

    expect(results.filter(Boolean)).toHaveLength(1)
  })

  it.each([0, 1, 2, 3])('14. ronda %i: anulación y consumo simultáneos del mismo token: gana exactamente uno', async () => {
    const account = await pendingAccount()
    await requestRecovery(0, account.email)
    const token = tokenOf(mail.sent[0].url)

    const [revoked, consumed] = await Promise.all([
      instance(1).resets.revokeUndeliveredResetToken(account.id, token),
      instance(0).resets.consumeSecurityRecoveryToken(token, 'hash-nuevo'),
    ])

    expect([revoked, consumed === 'completed'].filter(Boolean)).toHaveLength(1)
    expect(await activeTokens(account.id, 'SECURITY_RECOVERY')).toBe(0)
  })

  it('15. un token anulado, caducado o inventado no sirve', async () => {
    const user = await eligibleAccount()
    mail.behavior = async () => { throw smtp.rejected() }
    await requestReset(0, user)
    const revoked = tokenOf(mail.sent[0].url)

    mail.behavior = null
    await requestReset(1, user)
    const expired = tokenOf(mail.sent[1].url)
    await admin.query(`UPDATE "PasswordResetToken" SET "expiresAt" = now() - interval '1 second' WHERE "tokenHash" = $1`, [hashOf(expired)])

    expect(await instance(0).resets.consumePasswordResetToken(revoked, 'h')).toBe(false)
    expect(await instance(1).resets.consumePasswordResetToken(expired, 'h')).toBe(false)
    expect(await instance(0).resets.consumePasswordResetToken(randomBytes(32).toString('hex'), 'h')).toBe(false)
  })

  it('16. la anulación solo toca el token indicado y de su cuenta', async () => {
    const a = await eligibleAccount()
    const b = await eligibleAccount()
    await requestReset(0, a)
    await requestReset(1, b)
    const tokenA = tokenOf(mail.sent[0].url)

    expect(await instance(0).resets.revokeUndeliveredResetToken(b.id, tokenA)).toBe(false)
    expect(await activeTokens(a.id, 'SELF_SERVICE')).toBe(1)
    expect(await activeTokens(b.id, 'SELF_SERVICE')).toBe(1)
  })
})

describe('respuesta HTTP y enumeración', () => {
  let apps: FastifyInstance[] = []

  async function http(index: number) {
    const app = Fastify()
    app.decorateRequest('userId', null)
    await app.register((await import('@fastify/rate-limit')).default, { global: false })
    await app.register(instance(index).authRoutes)
    await app.ready()
    apps.push(app)
    return app
  }

  afterEach(async () => {
    await Promise.all(apps.map(app => app.close()))
    apps = []
  })

  it('17. forgot-password y la solicitud E2 responden igual con o sin cuenta y con o sin fallo del correo', async () => {
    const user = await eligibleAccount()
    const account = await pendingAccount()
    const bodies = new Set<string>()
    const recoveryBodies = new Set<string>()

    for (const failing of [false, true]) {
      mail.behavior = failing ? async () => { throw smtp.rejected() } : null
      for (const [index, email] of [[0, user.email], [1, 'nadie@example.test']] as const) {
        const response = await (await http(index)).inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { email } })
        expect(response.statusCode).toBe(200)
        bodies.add(response.body)
      }
      for (const [index, email] of [[0, account.email], [1, 'nadie-e2@example.test']] as const) {
        const response = await (await http(index)).inject({ method: 'POST', url: '/api/auth/security-recovery/request', payload: { email } })
        expect(response.statusCode).toBe(200)
        recoveryBodies.add(response.body)
      }
      await instance(0).delivery.waitForPendingPasswordResetDeliveries(10_000)
      await instance(1).delivery.waitForPendingPasswordResetDeliveries(10_000)
      await instance(0).recovery.waitForPendingRecoveryDeliveries(10_000)
      await instance(1).recovery.waitForPendingRecoveryDeliveries(10_000)
    }

    expect(bodies.size).toBe(1)
    expect(recoveryBodies.size).toBe(1)
  })

  it('18. el servicio de correo se recupera: tras fallos conocidos, el flujo completo funciona sin esperar', async () => {
    const account = await pendingAccount()
    const user = await eligibleAccount()
    mail.behavior = async () => { throw smtp.refused() }
    for (let attempt = 0; attempt < 3; attempt++) {
      await requestRecovery(attempt, account.email)
      await requestReset(attempt, user)
    }
    expect(await activeTokens(account.id, 'SECURITY_RECOVERY')).toBe(0)
    expect(await activeTokens(user.id, 'SELF_SERVICE')).toBe(0)

    mail.behavior = null
    await requestRecovery(0, account.email)
    await requestReset(1, user)

    const [recoveryUrl, resetUrl] = mail.sent.filter(sent => sent.outcome === 'ok').map(sent => sent.url)
    expect(await instance(1).resets.consumeSecurityRecoveryToken(tokenOf(recoveryUrl), 'hash-nuevo')).toBe('completed')
    expect(await instance(0).resets.consumePasswordResetToken(tokenOf(resetUrl), 'hash-nuevo')).toBe(true)
  })
})
