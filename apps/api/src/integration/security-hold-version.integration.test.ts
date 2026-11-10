import { createHash } from 'node:crypto'
import Fastify, { type FastifyInstance } from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestDatabase, type TestDatabase } from '../test-support/postgres.js'

// ============================================================
// INTEGRACIÓN CON POSTGRESQL REAL
// ============================================================
//
// Base PostgreSQL propia de esta suite (test-support/postgres.ts), con las migraciones reales.
// Prisma se importa después de fijar DATABASE_URL, porque db/prisma.ts la lee al cargarse.
// Se envuelve el adaptador real solo para registrar el inicio y el final de cada transacción,
// sus escrituras, y para intercalar una operación justo antes de la siguiente transacción.
const transactions = vi.hoisted(() => ({
  beforeNext: null as null | (() => Promise<void>),
  started: 0,
  openConnections: 0,
  // Máximo de transacciones abiertas a la vez desde la última puesta a cero (Fase 0.3b): mide
  // si unas operaciones lanzadas a la vez llegaron a solaparse en SQLite.
  peakOpenConnections: 0,
  log: [] as string[],
  // Escrituras de cada transacción interactiva, en orden y normalizadas a «VERBO Tabla» (Fase 1,
  // F0-001): permiten comprobar qué fila se bloquea primero. Una lista por transacción.
  writes: [] as string[][],
}))

vi.mock('@prisma/adapter-pg', async importOriginal => {
  const actual = await importOriginal<typeof import('@prisma/adapter-pg')>()

  // «UPDATE "public"."User" SET …» → «UPDATE User». Las lecturas no se registran.
  function writeOf(sql: string): string | null {
    const match = /^\s*(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+(?:"public"\.)?"?(\w+)"?/i.exec(sql)
    return match ? `${match[1].toUpperCase().replace(/\s+/g, ' ')} ${match[2]}` : null
  }

  class HookedPrismaPg extends actual.PrismaPg {
    override async connect() {
      const adapter = await super.connect()
      const startTransaction = adapter.startTransaction.bind(adapter)
      adapter.startTransaction = async (...args: Parameters<typeof startTransaction>) => {
        transactions.started += 1
        const hook = transactions.beforeNext
        if (hook) {
          transactions.beforeNext = null
          transactions.log.push('gancho: inicio')
          await hook()
          transactions.log.push('gancho: fin')
        }
        const transaction = await startTransaction(...args)
        transactions.openConnections += 1
        transactions.peakOpenConnections = Math.max(transactions.peakOpenConnections, transactions.openConnections)
        transactions.log.push('BEGIN')
        const writes: string[] = []
        transactions.writes.push(writes)
        let finished = false
        const finish = (statement: 'COMMIT' | 'ROLLBACK', close: () => Promise<void>) => async () => {
          if (!finished) {
            finished = true
            transactions.openConnections -= 1
            transactions.log.push(statement)
          }
          await close()
        }
        const track = <K extends 'executeRaw' | 'queryRaw'>(name: K) => {
          const original = transaction[name].bind(transaction) as (query: { sql: string }) => Promise<never>
          ;(transaction as unknown as Record<string, unknown>)[name] = (query: { sql: string }) => {
            const write = writeOf(query.sql)
            if (write) writes.push(write)
            return original(query)
          }
        }
        track('executeRaw')
        track('queryRaw')
        transaction.commit = finish('COMMIT', transaction.commit.bind(transaction))
        transaction.rollback = finish('ROLLBACK', transaction.rollback.bind(transaction))
        return transaction
      }
      return adapter
    }
  }
  return { ...actual, PrismaPg: HookedPrismaPg }
})

// Trigger temporal de PostgreSQL para provocar un fallo o una intercalación en una prueba.
async function createTestTrigger(
  database: { $executeRawUnsafe: (sql: string) => Promise<unknown> },
  name: string,
  timing: string,
  body: string,
  when?: string,
) {
  await database.$executeRawUnsafe(`CREATE FUNCTION "${name}"() RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN ${body} END $fn$`)
  await database.$executeRawUnsafe(`CREATE TRIGGER "${name}" ${timing} FOR EACH ROW ${when ? `WHEN (${when})` : ''} EXECUTE FUNCTION "${name}"()`)
}

async function dropTestTrigger(database: { $executeRawUnsafe: (sql: string) => Promise<unknown> }, name: string) {
  await database.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${name}"() CASCADE`)
}

// Doble del envío de la recuperación obligatoria (E2.4): guarda cada llamada con el
// registro de transacciones en ese momento, para comprobar que llega tras el COMMIT.
const mail = vi.hoisted(() => ({
  calls: [] as { args: { to: string; recoveryUrl: string; expiresAt: Date }; transactionLog: string[] }[],
  fail: false,
  // Envíos de autoservicio de forgot-password (E2.5).
  resetCalls: [] as { to: string; resetUrl: string }[],
  // Fallo simulado del SMTP en forgot-password (decisión D3 de la Fase 0).
  resetFail: false,
  // Avisos de cambio de email y su fallo simulado (corrección F0-002).
  noticeCalls: [] as { to: string; stage: string; incidentReportUrl?: string }[],
  noticeFail: false,
  // Conexión perdida a mitad del envío, sin respuesta del servidor: el correo pudo llegar (DA-39).
  unconfirmed: false,
  resetUnconfirmed: false,
}))

// Forma de nodemailer 10.0.12 para una conexión cerrada sin respuesta durante el envío.
const lostConnection = () => Object.assign(new Error('Connection closed unexpectedly'), { code: 'ECONNECTION', command: 'CONN' })

vi.mock('../services/email.service.js', () => ({
  emailService: {
    sendSecurityRecoveryEmail: async (args: { to: string; recoveryUrl: string; expiresAt: Date }) => {
      mail.calls.push({ args, transactionLog: [...transactions.log] })
      if (mail.fail) throw new Error('Fallo SMTP simulado')
      if (mail.unconfirmed) throw lostConnection()
    },
    sendPasswordResetEmail: async (args: { to: string; resetUrl: string }) => {
      mail.resetCalls.push({ to: args.to, resetUrl: args.resetUrl })
      if (mail.resetFail) throw new Error('Fallo SMTP simulado')
      if (mail.resetUnconfirmed) throw lostConnection()
    },
    sendEmailChangeNoticeEmail: async (args: { to: string; stage: string; incidentReportUrl?: string }) => {
      mail.noticeCalls.push({ to: args.to, stage: args.stage, incidentReportUrl: args.incidentReportUrl })
      if (mail.noticeFail) throw new Error(`550 Recipient rejected: ${args.to}`)
    },
  },
}))

const HOLD_CHANGED_MESSAGE = 'La protección por incidente ha cambiado durante la operación. Revisa la cuenta antes de volver a intentarlo.'

type PrismaModule = typeof import('../db/prisma.js')
type IncidentModule = typeof import('../services/security-incident.service.js')
type SessionModule = typeof import('../services/session.service.js')
type AdminRoutesModule = typeof import('../routes/admin.routes.js')
type ResetModule = typeof import('../services/password-reset.service.js')
type PasswordModule = typeof import('../services/password.service.js')
type AuthRoutesModule = typeof import('../routes/auth.routes.js')
type VerificationModule = typeof import('../services/email-verification.service.js')
type EmailChangeModule = typeof import('../services/email-change.service.js')
type ResetDeliveryModule = typeof import('../services/password-reset-delivery.service.js')

let testDatabase: TestDatabase | undefined
let loaded: {
  prisma: PrismaModule['prisma']
  closeDatabase: PrismaModule['closeDatabase']
  incidents: IncidentModule
  sessions: SessionModule
  adminRoutes: AdminRoutesModule['adminRoutes']
  resets: ResetModule
  passwords: PasswordModule
  authRoutes: AuthRoutesModule['authRoutes']
  verification: VerificationModule
  emailChange: EmailChangeModule
  resetDelivery: ResetDeliveryModule
} | undefined
let app: FastifyInstance | undefined

function modules() {
  if (!loaded) throw new Error('Los módulos de la API no se han cargado')
  return loaded
}

function server() {
  if (!app) throw new Error('Fastify no se ha inicializado')
  return app
}

beforeAll(async () => {
  testDatabase = await createTestDatabase()
  vi.stubEnv('DATABASE_URL', testDatabase.url)

  loaded = {
    prisma: (await import('../db/prisma.js')).prisma,
    closeDatabase: (await import('../db/prisma.js')).closeDatabase,
    incidents: await import('../services/security-incident.service.js'),
    sessions: await import('../services/session.service.js'),
    adminRoutes: (await import('../routes/admin.routes.js')).adminRoutes,
    resets: await import('../services/password-reset.service.js'),
    passwords: await import('../services/password.service.js'),
    authRoutes: (await import('../routes/auth.routes.js')).authRoutes,
    verification: await import('../services/email-verification.service.js'),
    emailChange: await import('../services/email-change.service.js'),
    resetDelivery: await import('../services/password-reset-delivery.service.js'),
  }
})

afterAll(async () => {
  try {
    await app?.close()
    await loaded?.closeDatabase()
  } finally {
    app = undefined
    loaded = undefined
    vi.unstubAllEnvs()
    await testDatabase?.drop()
  }
  // Una transacción abierta aquí sería una fuga de conexión del pool.
  expect(transactions.openConnections).toBe(0)
})

describe('versionado de la protección por incidente con PostgreSQL real', () => {
  let sequence = 0
  let owner: { id: string; email: string }
  let target: { id: string; email: string }
  let ownerCookie: string

  function db() {
    return modules().prisma
  }

  async function createUser(role: 'USER' | 'OWNER', extra: Record<string, unknown> = {}) {
    sequence += 1
    return db().user.create({
      data: { email: `v4-${role.toLowerCase()}-${sequence}@estateforge.test`, password: 'hash-no-usado', role, ...extra },
      select: { id: true, email: true },
    })
  }

  async function holdState(userId: string) {
    return db().user.findUniqueOrThrow({ where: { id: userId }, select: { securityHoldAt: true, securityHoldVersion: true } })
  }

  async function reportNewIncident(userId: string, notifiedEmail = 'anterior@estateforge.test') {
    const { incidents } = modules()
    const { token } = await incidents.issueSecurityIncidentToken(userId, notifiedEmail)
    return { token, result: await incidents.reportSecurityIncident(token) }
  }

  async function recoveryState(userId: string) {
    return db().user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, securityRecoveryEmail: true, securityHoldVersion: true },
    })
  }

  // Token insertado directamente, para simular tokens que la emisión no produce:
  // uno anterior a E2 (sin email) o uno ajeno que siga pendiente.
  async function insertIncidentToken(userId: string, token: string, extra: Record<string, unknown> = {}) {
    await db().securityIncidentToken.create({
      data: {
        userId,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date(Date.now() + 60_000),
        ...extra,
      },
    })
  }

  function resolveHold(userId: string, reason = 'Incidente revisado con el titular', extra: Record<string, unknown> = {}) {
    return server().inject({
      method: 'POST',
      url: `/api/admin/users/${userId}/resolve-security-hold`,
      headers: { cookie: ownerCookie },
      payload: { reason, ...extra },
    })
  }

  beforeEach(async () => {
    // Una instancia de Fastify por test: el contador del rate limit no se comparte.
    const instance = Fastify()
    instance.decorateRequest('userId', null)
    await instance.register(rateLimit, { global: false })
    await instance.register(modules().adminRoutes)
    await instance.ready()
    app = instance

    owner = await createUser('OWNER')
    target = await createUser('USER')
    const session = await modules().sessions.createSession(owner.id)
    ownerCookie = `estateforge_session=${session.token}`
    transactions.log.length = 0
    mail.calls.length = 0
    mail.fail = false
    mail.resetCalls.length = 0
    mail.resetFail = false
    mail.noticeCalls.length = 0
    mail.noticeFail = false
    mail.unconfirmed = false
    mail.resetUnconfirmed = false
  })

  afterEach(async () => {
    // Un gancho que no llegara a ejecutarse no debe afectar al siguiente test.
    transactions.beforeNext = null
    await app?.close()
    app = undefined
    // Cada transacción del test debe haber cerrado su conexión dedicada.
    expect(transactions.openConnections).toBe(0)
    const database = db()
    await database.adminAuditLog.deleteMany()
    await database.session.deleteMany()
    await database.securityIncidentToken.deleteMany()
    await database.passwordResetToken.deleteMany()
    await database.emailChangeVerification.deleteMany()
    await database.user.deleteMany()
  })

  it('usa una base temporal propia en un servidor local', () => {
    const url = new URL(process.env.DATABASE_URL as string)
    expect(url.pathname).toMatch(/^\/ef_test_[0-9a-f]{16}$/)
    expect(['localhost', '127.0.0.1']).toContain(url.hostname)
  })

  it('1. un incidente incrementa la versión de 0 a 1', async () => {
    expect(await holdState(target.id)).toEqual({ securityHoldAt: null, securityHoldVersion: 0 })

    const { result } = await reportNewIncident(target.id)

    expect(result).toBe('reported')
    const state = await holdState(target.id)
    expect(state.securityHoldAt).toBeInstanceOf(Date)
    expect(state.securityHoldVersion).toBe(1)
    // El informe se ejecuta en una transacción real de la conexión dedicada.
    expect(transactions.log).toEqual(['BEGIN', 'COMMIT'])
  })

  it('2. dos incidentes sucesivos incrementan el contador dos veces', async () => {
    await reportNewIncident(target.id)
    const first = await holdState(target.id)

    const { result } = await reportNewIncident(target.id)

    expect(result).toBe('reported')
    const second = await holdState(target.id)
    expect(second.securityHoldVersion).toBe(2)
    expect(second.securityHoldAt).toBeInstanceOf(Date)
    expect(second.securityHoldAt!.getTime()).toBeGreaterThanOrEqual(first.securityHoldAt!.getTime())
  })

  it('3. una retirada válida quita la protección sin cambiar la versión', async () => {
    await reportNewIncident(target.id)

    const response = await resolveHold(target.id)

    expect(response.statusCode).toBe(200)
    expect(await holdState(target.id)).toEqual({ securityHoldAt: null, securityHoldVersion: 1 })
  })

  it('4. una retirada obsoleta no borra la protección de un incidente posterior', async () => {
    await reportNewIncident(target.id)
    expect((await holdState(target.id)).securityHoldVersion).toBe(1)

    const database = db()
    let interleavedReport: string | undefined
    // Solo se intercepta la primera transacción, la de la ruta, que se inicia después
    // de que la ruta haya leído la versión 1. El informe usa el camino original.
    transactions.started = 0
    transactions.log.length = 0
    transactions.beforeNext = async () => {
      interleavedReport = (await reportNewIncident(target.id)).result
    }

    const response = await resolveHold(target.id, 'Retirada obsoleta')

    expect(transactions.beforeNext).toBeNull()
    expect(interleavedReport).toBe('reported')
    // Transacción de la ruta + la del informe intercalado; ninguna otra.
    expect(transactions.started).toBe(2)
    // El informe intercalado se confirma por completo antes de que empiece la
    // transacción de la retirada, que termina sin error (responde 409 con COMMIT).
    expect(transactions.log).toEqual([
      'gancho: inicio',
      'BEGIN', 'COMMIT',
      'gancho: fin',
      'BEGIN', 'COMMIT',
    ])
    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ message: HOLD_CHANGED_MESSAGE })
    const state = await holdState(target.id)
    expect(state.securityHoldAt).toBeInstanceOf(Date)
    expect(state.securityHoldVersion).toBe(2)
    expect(await database.adminAuditLog.count()).toBe(0)
    // Ni recuperación obligatoria ni token para la versión 1.
    expect(await database.passwordResetToken.count({ where: { userId: target.id } })).toBe(0)
    expect((await database.user.findUniqueOrThrow({ where: { id: target.id } })).passwordResetRequiredAt).toBeNull()
    expect(mail.calls).toEqual([])
  })

  it('5. una cuenta protegida con la versión por defecto 0 se puede retirar', async () => {
    const columns = await db().$queryRawUnsafe<{ type: string; notnull: number | bigint; dflt_value: string }[]>(
      `SELECT data_type AS type, CASE WHEN is_nullable = 'NO' THEN 1 ELSE 0 END AS "notnull", column_default AS dflt_value FROM information_schema.columns WHERE table_name = 'User' AND column_name = 'securityHoldVersion'`,
    )
    expect(columns).toHaveLength(1)
    expect(columns[0].type).toBe('integer')
    expect(Number(columns[0].notnull)).toBe(1)
    expect(columns[0].dflt_value).toBe('0')

    // Sin indicar la versión: toma el DEFAULT 0 de la migración, como las cuentas previas.
    const legacy = await createUser('USER', { securityHoldAt: new Date('2026-10-30T09:00:00.000Z') })
    expect((await holdState(legacy.id)).securityHoldVersion).toBe(0)

    // Sin destino guardado (protegida antes de E2): el OWNER debe indicarlo (E2.4).
    expect((await resolveHold(legacy.id)).statusCode).toBe(400)
    expect((await holdState(legacy.id)).securityHoldAt).toBeInstanceOf(Date)

    const response = await resolveHold(legacy.id, 'Incidente revisado con el titular', { recoveryEmail: 'titular@estateforge.test' })

    expect(response.statusCode).toBe(200)
    expect(await holdState(legacy.id)).toEqual({ securityHoldAt: null, securityHoldVersion: 0 })
    const token = await db().passwordResetToken.findFirstOrThrow({ where: { userId: legacy.id } })
    expect(token).toMatchObject({ purpose: 'SECURITY_RECOVERY', deliverTo: 'titular@estateforge.test', securityHoldVersion: 0 })
  })

  describe('6. coherencia transaccional', () => {
    it('a. si falla la auditoría, la retirada se deshace por completo', async () => {
      await reportNewIncident(target.id)
      const before = await holdState(target.id)
      const database = db()

      await createTestTrigger(database, 'v4_fail_audit', 'BEFORE INSERT ON "AdminAuditLog"', `RAISE EXCEPTION 'fallo simulado de auditoria';`)
      transactions.log.length = 0
      try {
        const response = await resolveHold(target.id)

        expect(response.statusCode).toBe(500)
      } finally {
        await dropTestTrigger(database, 'v4_fail_audit')
      }

      // La transacción de la retirada terminó con un ROLLBACK real, no con COMMIT.
      expect(transactions.log).toEqual(['BEGIN', 'ROLLBACK'])
      expect(await holdState(target.id)).toEqual(before)
      expect(before.securityHoldAt).toBeInstanceOf(Date)
      expect(await database.adminAuditLog.count()).toBe(0)
      // El token creado antes de la auditoría y la obligación también se deshacen.
      expect(await database.passwordResetToken.count({ where: { userId: target.id } })).toBe(0)
      expect((await database.user.findUniqueOrThrow({ where: { id: target.id } })).passwordResetRequiredAt).toBeNull()
      expect(mail.calls).toEqual([])
    })

    it('b. si falla una operación posterior al incremento, el informe se deshace por completo', async () => {
      const database = db()
      const { incidents, sessions } = modules()
      const userSession = await sessions.createSession(target.id)
      const { token } = await incidents.issueSecurityIncidentToken(target.id, 'anterior@estateforge.test')

      await createTestTrigger(database, 'v4_fail_session_delete', 'BEFORE DELETE ON "Session"', `RAISE EXCEPTION 'fallo simulado al borrar sesiones';`)
      transactions.log.length = 0
      try {
        await expect(incidents.reportSecurityIncident(token)).rejects.toThrow()
      } finally {
        await dropTestTrigger(database, 'v4_fail_session_delete')
      }

      // El informe terminó con un ROLLBACK real después del incremento.
      expect(transactions.log).toEqual(['BEGIN', 'ROLLBACK'])
      expect(await holdState(target.id)).toEqual({ securityHoldAt: null, securityHoldVersion: 0 })
      // El destino también se deshace con el incremento.
      expect(await recoveryState(target.id)).toEqual({ email: target.email, securityRecoveryEmail: null, securityHoldVersion: 0 })
      const tokens = await database.securityIncidentToken.findMany({ where: { userId: target.id }, select: { usedAt: true } })
      expect(tokens).toEqual([{ usedAt: null }])
      expect(await database.session.count({ where: { userId: target.id } })).toBe(1)
      expect(userSession.token).toMatch(/^[a-f0-9]{64}$/)

      // Con el trigger retirado, el mismo token sigue siendo válido.
      expect(await incidents.reportSecurityIncident(token)).toBe('reported')
      expect(await recoveryState(target.id)).toEqual({
        email: target.email,
        securityRecoveryEmail: 'anterior@estateforge.test',
        securityHoldVersion: 1,
      })
    })

    it('c. una retirada correcta deja exactamente una auditoría con los datos de los usuarios del test', async () => {
      await reportNewIncident(target.id)

      const response = await resolveHold(target.id, '  Titular verificado por soporte  ')

      expect(response.statusCode).toBe(200)
      expect((await holdState(target.id)).securityHoldAt).toBeNull()
      const logs = await db().adminAuditLog.findMany()
      expect(logs).toHaveLength(1)
      expect(logs[0]).toMatchObject({
        actorUserId: owner.id,
        targetUserId: target.id,
        action: 'SECURITY_HOLD_RESOLVED',
        reason: 'Titular verificado por soporte',
      })
      expect(JSON.parse(logs[0].metadata!)).toEqual({ actorEmail: owner.email, targetEmail: target.email, recoveryDestination: 'STORED' })
    })
  })

  describe('7. destino de recuperación propuesto (E2.2)', () => {
    it('a. la emisión guarda el email avisado normalizado y el informe lo copia sin tocar User.email', async () => {
      const { incidents } = modules()
      const { token } = await incidents.issueSecurityIncidentToken(target.id, '  Anterior@EstateForge.TEST ')

      const stored = await db().securityIncidentToken.findMany({ where: { userId: target.id }, select: { notifiedEmail: true } })
      expect(stored).toEqual([{ notifiedEmail: 'anterior@estateforge.test' }])

      expect(await incidents.reportSecurityIncident(token)).toBe('reported')
      expect(await recoveryState(target.id)).toEqual({
        email: target.email,
        securityRecoveryEmail: 'anterior@estateforge.test',
        securityHoldVersion: 1,
      })
    })

    it('b. copia el email del token reclamado, no el de otro token del mismo usuario', async () => {
      const claimed = 'b'.repeat(64)
      const other = 'c'.repeat(64)
      await insertIncidentToken(target.id, other, { notifiedEmail: 'otro@estateforge.test' })
      await insertIncidentToken(target.id, claimed, { notifiedEmail: 'reclamado@estateforge.test' })

      expect(await modules().incidents.reportSecurityIncident(claimed)).toBe('reported')

      expect((await recoveryState(target.id)).securityRecoveryEmail).toBe('reclamado@estateforge.test')
      // El otro token se borra, como antes de E2.2.
      const remaining = await db().securityIncidentToken.findMany({ where: { userId: target.id }, select: { notifiedEmail: true } })
      expect(remaining).toEqual([{ notifiedEmail: 'reclamado@estateforge.test' }])
    })

    it('c. un token anterior a E2 sin email deja el destino a null', async () => {
      const legacy = 'd'.repeat(64)
      await insertIncidentToken(target.id, legacy)

      expect(await modules().incidents.reportSecurityIncident(legacy)).toBe('reported')

      expect(await recoveryState(target.id)).toEqual({ email: target.email, securityRecoveryEmail: null, securityHoldVersion: 1 })
    })

    it.each([
      ['caducado', { expiresAt: new Date(Date.now() - 1_000) }],
      ['ya usado', { usedAt: new Date() }],
    ])('d. un token %s no modifica el destino ni la versión', async (_label, extra) => {
      const user = await createUser('USER', { securityRecoveryEmail: 'previo@estateforge.test' })
      const token = 'e'.repeat(64)
      await insertIncidentToken(user.id, token, { notifiedEmail: 'nuevo@estateforge.test', ...extra })

      expect(await modules().incidents.reportSecurityIncident(token)).toBe('invalid')

      expect(await recoveryState(user.id)).toEqual({
        email: user.email,
        securityRecoveryEmail: 'previo@estateforge.test',
        securityHoldVersion: 0,
      })
    })

    it('e. un token inexistente no modifica el destino ni la versión', async () => {
      const user = await createUser('USER', { securityRecoveryEmail: 'previo@estateforge.test' })

      expect(await modules().incidents.reportSecurityIncident('f'.repeat(64))).toBe('invalid')

      expect(await recoveryState(user.id)).toEqual({
        email: user.email,
        securityRecoveryEmail: 'previo@estateforge.test',
        securityHoldVersion: 0,
      })
    })
  })

  describe('8. acceso con recuperación pendiente (E2.3)', () => {
    it('una sesión real se invalida con la recuperación pendiente y vuelve a funcionar al limpiarla', async () => {
      const { sessions } = modules()
      const database = db()
      const first = await sessions.createSession(target.id)
      await database.user.update({ where: { id: target.id }, data: { passwordResetRequiredAt: new Date() } })

      expect(await sessions.getUserIdFromSession(first.token)).toBeNull()
      expect(await database.session.count({ where: { userId: target.id } })).toBe(0)

      // Con los tres estados activos tampoco hay acceso.
      await database.user.update({
        where: { id: target.id },
        data: { securityHoldAt: new Date(), adminSuspendedAt: new Date() },
      })
      const blocked = await sessions.createSession(target.id)
      expect(await sessions.getUserIdFromSession(blocked.token)).toBeNull()

      await database.user.update({
        where: { id: target.id },
        data: { securityHoldAt: null, adminSuspendedAt: null, passwordResetRequiredAt: null },
      })
      const second = await sessions.createSession(target.id)
      expect(await sessions.getUserIdFromSession(second.token)).toBe(target.id)
      // La versión no cambia por estos estados.
      expect((await holdState(target.id)).securityHoldVersion).toBe(0)
    })
  })

  describe('9. retirada con recuperación obligatoria (E2.4)', () => {
    async function recoveryTokens(userId: string) {
      return db().passwordResetToken.findMany({ where: { userId, purpose: 'SECURITY_RECOVERY' } })
    }

    async function accessState(userId: string) {
      return db().user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          email: true, securityHoldAt: true, securityHoldVersion: true, adminSuspendedAt: true,
          passwordResetRequiredAt: true, securityRecoveryEmail: true,
        },
      })
    }

    function sentToken() {
      expect(mail.calls).toHaveLength(1)
      return new URL(mail.calls[0].args.recoveryUrl).searchParams.get('token')!
    }

    it('a. persiste la obligación, el destino y el token en una transacción y envía el correo después del COMMIT', async () => {
      await reportNewIncident(target.id)
      transactions.log.length = 0

      const response = await resolveHold(target.id)

      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ success: true, recoveryEmailSent: true })
      expect(await accessState(target.id)).toEqual({
        email: target.email,
        securityHoldAt: null,
        securityHoldVersion: 1,
        adminSuspendedAt: null,
        passwordResetRequiredAt: expect.any(Date),
        securityRecoveryEmail: 'anterior@estateforge.test',
      })
      const tokens = await recoveryTokens(target.id)
      expect(tokens).toHaveLength(1)
      expect(tokens[0]).toMatchObject({
        tokenHash: createHash('sha256').update(sentToken()).digest('hex'),
        usedAt: null,
        purpose: 'SECURITY_RECOVERY',
        deliverTo: 'anterior@estateforge.test',
        securityHoldVersion: 1,
      })
      // Una sola transacción, ya confirmada cuando se intenta el envío.
      expect(transactions.log).toEqual(['BEGIN', 'COMMIT'])
      expect(mail.calls[0].transactionLog).toEqual(['BEGIN', 'COMMIT'])
      expect(mail.calls[0].args.to).toBe('anterior@estateforge.test')
      expect(response.body).not.toContain(sentToken())
    })

    it('b. la cuenta sigue sin acceso por E2.3 tras la retirada', async () => {
      await reportNewIncident(target.id)
      await resolveHold(target.id)
      const { sessions } = modules()

      const session = await sessions.createSession(target.id)

      expect(await sessions.getUserIdFromSession(session.token)).toBeNull()
    })

    it('c. si falla la creación del token, la transacción se deshace por completo y no se envía nada', async () => {
      await reportNewIncident(target.id)
      const before = await accessState(target.id)
      const database = db()

      await createTestTrigger(database, 'e24_fail_token', 'BEFORE INSERT ON "PasswordResetToken"', `RAISE EXCEPTION 'fallo simulado del token';`)
      transactions.log.length = 0
      try {
        expect((await resolveHold(target.id)).statusCode).toBe(500)
      } finally {
        await dropTestTrigger(database, 'e24_fail_token')
      }

      expect(transactions.log).toEqual(['BEGIN', 'ROLLBACK'])
      expect(await accessState(target.id)).toEqual(before)
      expect(before.securityHoldAt).toBeInstanceOf(Date)
      expect(before.passwordResetRequiredAt).toBeNull()
      expect(await database.passwordResetToken.count({ where: { userId: target.id } })).toBe(0)
      expect(await database.adminAuditLog.count()).toBe(0)
      expect(mail.calls).toEqual([])
    })

    it('d. si consta que el envío falló, la obligación y el destino permanecen y el token no entregado se anula (DA-39)', async () => {
      await reportNewIncident(target.id)
      mail.fail = true

      const response = await resolveHold(target.id)

      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ success: true, recoveryEmailSent: false })
      expect(await accessState(target.id)).toMatchObject({
        securityHoldAt: null,
        passwordResetRequiredAt: expect.any(Date),
        securityRecoveryEmail: 'anterior@estateforge.test',
      })
      expect(await recoveryTokens(target.id)).toEqual([])
      expect(await db().adminAuditLog.count()).toBe(1)
    })

    it('d2. si el envío no está confirmado, el token se conserva: el correo pudo llegar', async () => {
      await reportNewIncident(target.id)
      mail.unconfirmed = true

      const response = await resolveHold(target.id)

      expect(response.json()).toMatchObject({ success: true, recoveryEmailSent: false })
      expect(await recoveryTokens(target.id)).toEqual([expect.objectContaining({ usedAt: null, deliverTo: 'anterior@estateforge.test' })])
    })

    it('e. una cuenta suspendida sigue suspendida y queda en recuperación obligatoria', async () => {
      await reportNewIncident(target.id)
      await db().user.update({ where: { id: target.id }, data: { adminSuspendedAt: new Date(), adminSuspensionReason: 'Revisión' } })

      expect((await resolveHold(target.id)).statusCode).toBe(200)

      const state = await accessState(target.id)
      expect(state.adminSuspendedAt).toBeInstanceOf(Date)
      expect(state.securityHoldAt).toBeNull()
      expect(state.passwordResetRequiredAt).toBeInstanceOf(Date)
    })

    it('f. el destino corregido por el OWNER queda en la cuenta y en el token, sin tocar User.email', async () => {
      await reportNewIncident(target.id)

      const response = await resolveHold(target.id, 'Titular verificado', { recoveryEmail: 'Corregido@EstateForge.test' })

      expect(response.statusCode).toBe(200)
      expect(await accessState(target.id)).toMatchObject({ email: target.email, securityRecoveryEmail: 'corregido@estateforge.test' })
      expect(await recoveryTokens(target.id)).toEqual([expect.objectContaining({ deliverTo: 'corregido@estateforge.test' })])
      const [log] = await db().adminAuditLog.findMany()
      expect(JSON.parse(log.metadata!).recoveryDestination).toBe('OWNER_CORRECTED')
      expect(log.metadata).not.toContain('corregido@estateforge.test')
    })
  })

  describe('10. consumo de la recuperación obligatoria (E2.5)', () => {
    const NEW_PASSWORD = 'Nueva-Contrasena-Segura-1'

    // Ciclo real hasta la recuperación pendiente: el email actual de la cuenta (el del
    // atacante) no es el destino; el destino es el email avisado por el incidente.
    async function pendingRecovery() {
      const destination = `titular-${target.id}@estateforge.test`
      await reportNewIncident(target.id, destination)
      expect((await resolveHold(target.id)).statusCode).toBe(200)
      const token = new URL(mail.calls.at(-1)!.args.recoveryUrl).searchParams.get('token')!
      transactions.log.length = 0
      return { token, destination }
    }

    async function account(userId: string) {
      return db().user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          email: true, password: true, passwordResetRequiredAt: true, securityRecoveryEmail: true,
          securityHoldAt: true, adminSuspendedAt: true, securityHoldVersion: true,
        },
      })
    }

    function hashOf(token: string) {
      return createHash('sha256').update(token).digest('hex')
    }

    async function tokenRow(token: string) {
      return db().passwordResetToken.findUnique({ where: { tokenHash: hashOf(token) }, select: { usedAt: true, purpose: true } })
    }

    async function consume(token: string, password = NEW_PASSWORD) {
      const { resets, passwords } = modules()
      return resets.consumeSecurityRecoveryToken(token, await passwords.hashPassword(password))
    }

    async function withAuthServer<T>(run: (auth: FastifyInstance) => Promise<T>) {
      const auth = Fastify()
      auth.decorateRequest('userId', null)
      await auth.register(rateLimit, { global: false })
      await auth.register(modules().authRoutes)
      await auth.ready()
      try {
        return await run(auth)
      } finally {
        await auth.close()
      }
    }

    // Un intento rechazado no deja ningún cambio: ni en la cuenta, ni en el token, ni auditoría.
    async function expectUntouched(token: string, before: Awaited<ReturnType<typeof account>>) {
      expect(await account(target.id)).toEqual(before)
      expect(await tokenRow(token)).toEqual({ usedAt: null, purpose: 'SECURITY_RECOVERY' })
      expect(await db().adminAuditLog.count({ where: { action: 'SECURITY_RECOVERY_COMPLETED' } })).toBe(0)
    }

    it('a. completa: contraseña nueva, email restaurado, campos limpios, sesiones y tokens invalidados', async () => {
      const { token, destination } = await pendingRecovery()
      const database = db()
      const { sessions, passwords } = modules()
      const soon = () => new Date(Date.now() + 60_000)
      await sessions.createSession(target.id)
      await database.passwordResetToken.create({ data: { userId: target.id, tokenHash: 'pendiente-propio', expiresAt: soon() } })
      await database.passwordResetToken.create({ data: { userId: owner.id, tokenHash: 'pendiente-ajeno', expiresAt: soon() } })
      const verifications: [string, string, Date | null][] = [
        [target.id, 'ecv-propia-pendiente', null],
        [target.id, 'ecv-propia-usada', new Date()],
        [owner.id, 'ecv-ajena', null],
      ]
      for (const [userId, codeHash, usedAt] of verifications) {
        await database.emailChangeVerification.create({ data: { userId, codeHash, usedAt, newEmail: `${codeHash}@estateforge.test`, expiresAt: soon() } })
      }
      transactions.log.length = 0

      expect(await consume(token)).toBe('completed')

      expect(transactions.log).toEqual(['BEGIN', 'COMMIT'])
      const state = await account(target.id)
      expect(state).toMatchObject({
        email: destination, passwordResetRequiredAt: null, securityRecoveryEmail: null,
        securityHoldAt: null, adminSuspendedAt: null, securityHoldVersion: 1,
      })
      expect(await passwords.verifyPassword(NEW_PASSWORD, state.password)).toBe(true)
      expect(await tokenRow(token)).toEqual({ usedAt: expect.any(Date), purpose: 'SECURITY_RECOVERY' })
      // De la cuenta solo queda el token consumido; lo de otras cuentas no se toca.
      expect(await database.session.count({ where: { userId: target.id } })).toBe(0)
      expect(await database.session.count({ where: { userId: owner.id } })).toBe(1)
      expect(await database.passwordResetToken.findMany({ where: { userId: target.id }, select: { usedAt: true } })).toEqual([{ usedAt: expect.any(Date) }])
      expect(await database.passwordResetToken.count({ where: { userId: owner.id, tokenHash: 'pendiente-ajeno' } })).toBe(1)
      const ownVerifications = await database.emailChangeVerification.findMany({ where: { userId: target.id }, select: { codeHash: true } })
      expect(ownVerifications.map(row => row.codeHash)).toEqual(['ecv-propia-usada'])
      expect(await database.emailChangeVerification.count({ where: { userId: owner.id } })).toBe(1)

      const audits = await database.adminAuditLog.findMany({ where: { action: 'SECURITY_RECOVERY_COMPLETED' } })
      expect(audits).toEqual([expect.objectContaining({ actorUserId: target.id, targetUserId: target.id, reason: null, metadata: null })])

      // El acceso vuelve: sesión nueva válida y login con el email restaurado.
      const session = await sessions.createSession(target.id)
      expect(await sessions.getUserIdFromSession(session.token)).toBe(target.id)
      const login = await withAuthServer(auth => auth.inject({ method: 'POST', url: '/api/auth/login', payload: { email: destination, password: NEW_PASSWORD } }))
      expect(login.statusCode).toBe(200)
    })

    it('b. destino ocupado por otra cuenta: email_taken, ROLLBACK y token sin consumir', async () => {
      const { token, destination } = await pendingRecovery()
      const other = await createUser('USER')
      await db().user.update({ where: { id: other.id }, data: { email: destination } })
      const before = await account(target.id)
      transactions.log.length = 0

      expect(await consume(token)).toBe('email_taken')

      expect(transactions.log).toEqual(['BEGIN', 'ROLLBACK'])
      await expectUntouched(token, before)
      expect((await account(other.id)).email).toBe(destination)
    })

    it('c. destino ocupado justo antes de escribir (P2002 real): email_taken y ROLLBACK completo', async () => {
      const { token, destination } = await pendingRecovery()
      const before = await account(target.id)
      const database = db()

      // Otra cuenta ocupa el destino después de la comprobación previa y antes de la escritura.
      await createTestTrigger(
        database,
        'e25_steal_email',
        'BEFORE UPDATE OF "email" ON "User"',
        `INSERT INTO "User" ("id", "email", "password", "updatedAt") VALUES ('intruso', NEW."email", 'x', CURRENT_TIMESTAMP); RETURN NEW;`,
        `NEW."email" = '${destination}'`,
      )
      transactions.log.length = 0
      try {
        expect(await consume(token)).toBe('email_taken')
      } finally {
        await dropTestTrigger(database, 'e25_steal_email')
      }

      expect(transactions.log).toEqual(['BEGIN', 'ROLLBACK'])
      await expectUntouched(token, before)
      expect(await database.user.count({ where: { id: 'intruso' } })).toBe(0)
    })

    it('d. dos consumos simultáneos del mismo token: solo uno completa', async () => {
      const { token } = await pendingRecovery()
      const { passwords } = modules()

      const results = await Promise.all([consume(token, 'Primera-Contrasena-1'), consume(token, 'Segunda-Contrasena-2')])

      expect([...results].sort()).toEqual(['completed', 'invalid_token'])
      const winner = results[0] === 'completed' ? 'Primera-Contrasena-1' : 'Segunda-Contrasena-2'
      expect(await passwords.verifyPassword(winner, (await account(target.id)).password)).toBe(true)
      expect(await db().adminAuditLog.count({ where: { action: 'SECURITY_RECOVERY_COMPLETED' } })).toBe(1)
    })

    it('e. un incidente nuevo invalida el token antiguo', async () => {
      const { token } = await pendingRecovery()
      await reportNewIncident(target.id, 'otro-aviso@estateforge.test')
      const before = await account(target.id)

      expect(await consume(token)).toBe('invalid_token')

      expect(await account(target.id)).toEqual(before)
      expect(before.securityHoldAt).toBeInstanceOf(Date)
      expect(before.securityHoldVersion).toBe(2)
      // El informe del incidente borró el token: no queda nada que consumir.
      expect(await tokenRow(token)).toBeNull()
    })

    it.each([
      ['la versión de la cuenta no coincide con la del token', { securityHoldVersion: 7 }],
      ['la cuenta está suspendida', { adminSuspendedAt: new Date() }],
      ['la cuenta tiene una protección activa', { securityHoldAt: new Date() }],
      ['la cuenta ya no requiere recuperación', { passwordResetRequiredAt: null }],
    ])('f. state_mismatch sin cambios si %s', async (_label, data) => {
      const { token } = await pendingRecovery()
      await db().user.update({ where: { id: target.id }, data })
      const before = await account(target.id)

      expect(await consume(token)).toBe('state_mismatch')

      await expectUntouched(token, before)
    })

    it('g. si falla una operación posterior, ROLLBACK completo y el token sigue válido', async () => {
      const { token } = await pendingRecovery()
      const database = db()
      await modules().sessions.createSession(target.id)
      const before = await account(target.id)
      await createTestTrigger(database, 'e25_fail_session_delete', 'BEFORE DELETE ON "Session"', `RAISE EXCEPTION 'fallo simulado al borrar sesiones';`)
      transactions.log.length = 0
      try {
        await expect(consume(token)).rejects.toThrow()
      } finally {
        await dropTestTrigger(database, 'e25_fail_session_delete')
      }

      expect(transactions.log).toEqual(['BEGIN', 'ROLLBACK'])
      await expectUntouched(token, before)
      expect(await database.session.count({ where: { userId: target.id } })).toBe(1)
      // Sin el trigger, el mismo token completa.
      expect(await consume(token)).toBe('completed')
    })

    it.each([
      ['caducado', { expiresAt: new Date(Date.now() - 1_000) }],
      ['ya consumido', { usedAt: new Date() }],
    ])('h. un token %s se rechaza sin cambios', async (_label, data) => {
      const { token } = await pendingRecovery()
      await db().passwordResetToken.update({ where: { tokenHash: hashOf(token) }, data })
      const before = await account(target.id)

      expect(await consume(token)).toBe('invalid_token')

      expect(await account(target.id)).toEqual(before)
    })

    it('i. un token de autoservicio no sirve para la recuperación obligatoria', async () => {
      await pendingRecovery()
      const selfService = 'b2'.repeat(32)
      await db().passwordResetToken.create({ data: { userId: target.id, tokenHash: hashOf(selfService), expiresAt: new Date(Date.now() + 60_000) } })
      const before = await account(target.id)

      expect(await consume(selfService)).toBe('invalid_token')

      expect(await account(target.id)).toEqual(before)
      expect(await tokenRow(selfService)).toEqual({ usedAt: null, purpose: 'SELF_SERVICE' })
    })

    it('j. reset-password rechaza el token obligatorio sin consumirlo', async () => {
      const { token } = await pendingRecovery()
      const before = await account(target.id)

      const response = await withAuthServer(auth => auth.inject({
        method: 'POST', url: '/api/auth/reset-password', payload: { token, password: NEW_PASSWORD },
      }))

      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ message: 'El enlace de recuperación no es válido o ha caducado.' })
      await expectUntouched(token, before)
    })

    it('k. forgot-password no emite un token de autoservicio ni invalida el obligatorio', async () => {
      const { token, destination } = await pendingRecovery()

      // Por el email actual (el del atacante) y por el destino, que aún no es de ninguna cuenta.
      await withAuthServer(async auth => {
        for (const email of [target.email, destination]) {
          const response = await auth.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { email } })
          expect(response.statusCode).toBe(200)
          expect(response.json()).toEqual({ message: 'Si la cuenta existe, recibirás instrucciones para restablecer la contraseña.' })
        }
      })

      expect(mail.resetCalls).toEqual([])
      expect(await db().passwordResetToken.findMany({ where: { userId: target.id }, select: { purpose: true, usedAt: true } }))
        .toEqual([{ purpose: 'SECURITY_RECOVERY', usedAt: null }])
      expect(await tokenRow(token)).toEqual({ usedAt: null, purpose: 'SECURITY_RECOVERY' })
    })

    it('l. el autoservicio de una cuenta normal funciona como antes', async () => {
      const { sessions, passwords } = modules()
      await sessions.createSession(target.id)

      const issued = await withAuthServer(async auth => {
        for (let i = 0; i < 2; i++) {
          const response = await auth.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { email: target.email } })
          expect(response.statusCode).toBe(200)
        }
        // El envío va en segundo plano (decisión D3 de la Fase 0): se espera a que termine.
        await modules().resetDelivery.waitForPendingPasswordResetDeliveries()
        const tokens = mail.resetCalls.map(call => new URL(call.resetUrl).searchParams.get('token')!)
        expect(mail.resetCalls.map(call => call.to)).toEqual([target.email, target.email])
        // La segunda solicitud sustituye a la primera.
        expect(await db().passwordResetToken.findMany({ where: { userId: target.id }, select: { purpose: true, usedAt: true } }))
          .toEqual([{ purpose: 'SELF_SERVICE', usedAt: null }])

        const stale = await auth.inject({ method: 'POST', url: '/api/auth/reset-password', payload: { token: tokens[0], password: NEW_PASSWORD } })
        expect(stale.statusCode).toBe(400)
        const reset = await auth.inject({ method: 'POST', url: '/api/auth/reset-password', payload: { token: tokens[1], password: NEW_PASSWORD } })
        expect(reset.statusCode).toBe(200)
        expect(reset.json()).toEqual({ message: 'Contraseña restablecida correctamente. Ya puedes iniciar sesión.' })
        return tokens
      })

      const state = await account(target.id)
      expect(await passwords.verifyPassword(NEW_PASSWORD, state.password)).toBe(true)
      expect(state).toMatchObject({ email: target.email, passwordResetRequiredAt: null, securityRecoveryEmail: null })
      expect(await db().session.count({ where: { userId: target.id } })).toBe(0)
      expect(await tokenRow(issued[1])).toEqual({ usedAt: expect.any(Date), purpose: 'SELF_SERVICE' })
    })
  })

  describe('11. corrección del destino y reenvío del enlace (E2.5f)', () => {
    const NEW_PASSWORD = 'Nueva-Contrasena-Segura-1'
    const HELD = 'La cuenta tiene una protección por incidente activa. Retírala primero; la retirada envía un enlace nuevo.'
    const SUSPENDED = 'La cuenta está suspendida administrativamente. Retira la suspensión antes de gestionar su recuperación.'
    const NOT_REQUIRED = 'La cuenta no tiene una recuperación obligatoria pendiente.'
    const CHANGED = 'La recuperación de la cuenta ha cambiado durante la operación. Revisa la cuenta antes de volver a intentarlo.'

    // Recuperación pendiente real: incidente, retirada y enlace enviado al destino guardado.
    async function pendingRecovery() {
      const destination = `titular-${target.id}@estateforge.test`
      await reportNewIncident(target.id, destination)
      expect((await resolveHold(target.id)).statusCode).toBe(200)
      transactions.log.length = 0
      return { destination, firstToken: lastSentToken() }
    }

    function lastSentToken() {
      return new URL(mail.calls.at(-1)!.args.recoveryUrl).searchParams.get('token')!
    }

    function adminAction(route: 'recovery-destination' | 'resend-recovery' | 'suspend' | 'unsuspend', payload: Record<string, unknown>) {
      return server().inject({
        method: 'POST',
        url: `/api/admin/users/${target.id}/${route}`,
        headers: { cookie: ownerCookie },
        payload: { reason: 'Titular verificado por soporte', ...payload },
      })
    }

    async function consume(token: string) {
      const { resets, passwords } = modules()
      return resets.consumeSecurityRecoveryToken(token, await passwords.hashPassword(NEW_PASSWORD))
    }

    async function account() {
      return db().user.findUniqueOrThrow({
        where: { id: target.id },
        select: {
          email: true, password: true, passwordResetRequiredAt: true, securityRecoveryEmail: true,
          securityHoldAt: true, adminSuspendedAt: true, securityHoldVersion: true,
        },
      })
    }

    async function pendingRecoveryTokens() {
      return db().passwordResetToken.findMany({
        where: { userId: target.id, usedAt: null, purpose: 'SECURITY_RECOVERY' },
        select: { tokenHash: true, deliverTo: true, securityHoldVersion: true },
      })
    }

    function hashOf(token: string) {
      return createHash('sha256').update(token).digest('hex')
    }

    it('a. corregir el destino invalida el enlace anterior y el nuevo restaura el email corregido', async () => {
      const { firstToken } = await pendingRecovery()
      const before = await account()

      const response = await adminAction('recovery-destination', { recoveryEmail: 'Corregido@EstateForge.test' })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ success: true, changed: true, recoveryEmailSent: true })
      expect(transactions.log).toEqual(['BEGIN', 'COMMIT'])
      expect(mail.calls.at(-1)!.transactionLog).toEqual(['BEGIN', 'COMMIT'])
      expect(mail.calls.at(-1)!.args.to).toBe('corregido@estateforge.test')
      // Solo cambia el destino: misma versión, contraseña, email y obligación.
      expect(await account()).toEqual({ ...before, securityRecoveryEmail: 'corregido@estateforge.test' })
      const newToken = lastSentToken()
      expect(await pendingRecoveryTokens()).toEqual([{ tokenHash: hashOf(newToken), deliverTo: 'corregido@estateforge.test', securityHoldVersion: 1 }])
      const [log] = await db().adminAuditLog.findMany({ where: { action: 'SECURITY_RECOVERY_DESTINATION_CHANGED' } })
      expect(JSON.parse(log.metadata!)).toEqual({ actorEmail: owner.email, targetEmail: target.email, recoveryDestination: 'OWNER_CORRECTED' })

      expect(await consume(firstToken)).toBe('invalid_token')
      expect(await consume(newToken)).toBe('completed')
      expect((await account()).email).toBe('corregido@estateforge.test')
    })

    it('b. reenviar sustituye el enlace sin cambiar el destino y conserva los tokens de autoservicio', async () => {
      const { destination, firstToken } = await pendingRecovery()
      await db().passwordResetToken.create({ data: { userId: target.id, tokenHash: 'autoservicio-pendiente', expiresAt: new Date(Date.now() + 60_000) } })
      const before = await account()

      const response = await adminAction('resend-recovery', {})

      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ success: true, recoveryEmailSent: true })
      expect(await account()).toEqual(before)
      const newToken = lastSentToken()
      expect(await pendingRecoveryTokens()).toEqual([{ tokenHash: hashOf(newToken), deliverTo: destination, securityHoldVersion: 1 }])
      expect(await db().passwordResetToken.count({ where: { tokenHash: 'autoservicio-pendiente', usedAt: null } })).toBe(1)
      expect(await db().adminAuditLog.count({ where: { action: 'SECURITY_RECOVERY_LINK_RESENT' } })).toBe(1)

      expect(await consume(firstToken)).toBe('invalid_token')
      expect(await consume(newToken)).toBe('completed')
      expect((await account()).email).toBe(destination)
    })

    it('c. si el consumo se confirma antes que un reenvío intercalado, el reenvío responde 409 y no emite nada', async () => {
      const { firstToken } = await pendingRecovery()
      let consumed: string | undefined
      // El consumo se confirma después de que la ruta lea la cuenta y antes de su transacción.
      transactions.beforeNext = async () => {
        consumed = await consume(firstToken)
      }
      const mailsBefore = mail.calls.length

      const response = await adminAction('resend-recovery', {})

      expect(consumed).toBe('completed')
      expect(response.statusCode).toBe(409)
      expect(response.json()).toEqual({ message: NOT_REQUIRED })
      expect(await pendingRecoveryTokens()).toEqual([])
      expect(mail.calls.length).toBe(mailsBefore)
      expect((await account()).passwordResetRequiredAt).toBeNull()
    })

    it('d. si el reenvío se confirma antes, el enlace anterior ya no se puede consumir', async () => {
      const { firstToken } = await pendingRecovery()
      expect((await adminAction('resend-recovery', {})).statusCode).toBe(200)

      expect(await consume(firstToken)).toBe('invalid_token')
      expect(await consume(lastSentToken())).toBe('completed')
    })

    it('e. con una suspensión responde 409; tras retirarla, el reenvío emite un enlace válido', async () => {
      await pendingRecovery()
      expect((await adminAction('suspend', {})).statusCode).toBe(200)
      // La suspensión borra todos los tokens de recuperación de la cuenta.
      expect(await pendingRecoveryTokens()).toEqual([])

      for (const route of ['resend-recovery', 'recovery-destination'] as const) {
        const blocked = await adminAction(route, route === 'recovery-destination' ? { recoveryEmail: 'otro-destino@estateforge.test' } : {})
        expect(blocked.statusCode).toBe(409)
        expect(blocked.json()).toEqual({ message: SUSPENDED })
      }
      expect((await adminAction('unsuspend', {})).statusCode).toBe(200)

      expect((await adminAction('resend-recovery', {})).statusCode).toBe(200)
      expect(await consume(lastSentToken())).toBe('completed')
    })

    it('f. un incidente nuevo durante la recuperación bloquea ambas acciones hasta una nueva retirada', async () => {
      const { firstToken } = await pendingRecovery()
      await reportNewIncident(target.id, 'aviso-nuevo@estateforge.test')

      for (const route of ['resend-recovery', 'recovery-destination'] as const) {
        const blocked = await adminAction(route, route === 'recovery-destination' ? { recoveryEmail: 'otro-destino@estateforge.test' } : {})
        expect(blocked.statusCode).toBe(409)
        expect(blocked.json()).toEqual({ message: HELD })
      }
      expect((await account()).securityHoldVersion).toBe(2)
      expect(await consume(firstToken)).toBe('invalid_token')

      // La retirada del incidente nuevo sigue funcionando como antes y emite la versión 2.
      expect((await resolveHold(target.id)).statusCode).toBe(200)
      expect(await pendingRecoveryTokens()).toEqual([expect.objectContaining({ deliverTo: 'aviso-nuevo@estateforge.test', securityHoldVersion: 2 })])
      expect(await consume(lastSentToken())).toBe('completed')
    })

    it('g. dos correcciones intercaladas: la que leyó un destino ya cambiado responde 409', async () => {
      await pendingRecovery()
      let interleaved: number | undefined
      transactions.beforeNext = async () => {
        interleaved = (await adminAction('recovery-destination', { recoveryEmail: 'primera@estateforge.test' })).statusCode
      }

      const response = await adminAction('recovery-destination', { recoveryEmail: 'segunda@estateforge.test' })

      expect(interleaved).toBe(200)
      expect(response.statusCode).toBe(409)
      expect(response.json()).toEqual({ message: CHANGED })
      expect((await account()).securityRecoveryEmail).toBe('primera@estateforge.test')
      expect(await pendingRecoveryTokens()).toEqual([expect.objectContaining({ deliverTo: 'primera@estateforge.test' })])
      expect(await db().adminAuditLog.count({ where: { action: 'SECURITY_RECOVERY_DESTINATION_CHANGED' } })).toBe(1)
    })

    it('h. dos reenvíos simultáneos dejan un único enlace utilizable', async () => {
      const { firstToken } = await pendingRecovery()
      const mailsBefore = mail.calls.length

      const responses = await Promise.all([adminAction('resend-recovery', {}), adminAction('resend-recovery', {})])

      expect(responses.map(response => response.statusCode)).toEqual([200, 200])
      const sent = mail.calls.slice(mailsBefore).map(call => new URL(call.args.recoveryUrl).searchParams.get('token')!)
      expect(sent).toHaveLength(2)
      const pending = await pendingRecoveryTokens()
      expect(pending).toHaveLength(1)
      const [usable] = sent.filter(token => hashOf(token) === pending[0].tokenHash)
      const [stale] = sent.filter(token => token !== usable)
      expect(await consume(firstToken)).toBe('invalid_token')
      expect(await consume(stale)).toBe('invalid_token')
      expect(await consume(usable)).toBe('completed')
    })

    it('i. si falla la creación del token, ROLLBACK completo: destino, enlace anterior y auditoría intactos', async () => {
      const { firstToken } = await pendingRecovery()
      const before = await account()
      const mailsBefore = mail.calls.length
      const database = db()
      await createTestTrigger(database, 'e25f_fail_token', 'BEFORE INSERT ON "PasswordResetToken"', `RAISE EXCEPTION 'fallo simulado del token';`)
      try {
        expect((await adminAction('recovery-destination', { recoveryEmail: 'corregido@estateforge.test' })).statusCode).toBe(500)
      } finally {
        await dropTestTrigger(database, 'e25f_fail_token')
      }

      expect(transactions.log).toEqual(['BEGIN', 'ROLLBACK'])
      expect(await account()).toEqual(before)
      expect(await pendingRecoveryTokens()).toEqual([expect.objectContaining({ tokenHash: hashOf(firstToken) })])
      expect(await database.adminAuditLog.count({ where: { action: 'SECURITY_RECOVERY_DESTINATION_CHANGED' } })).toBe(0)
      expect(mail.calls.length).toBe(mailsBefore)
      expect(await consume(firstToken)).toBe('completed')
    })

    it('j. si consta que el envío falló, se conserva la obligación, se anula el token no entregado y un reenvío posterior funciona', async () => {
      await pendingRecovery()
      mail.fail = true

      const failed = await adminAction('resend-recovery', {})

      expect(failed.statusCode).toBe(200)
      expect(failed.json()).toMatchObject({ success: true, recoveryEmailSent: false })
      expect((await account()).passwordResetRequiredAt).toBeInstanceOf(Date)
      expect(await pendingRecoveryTokens()).toEqual([])

      mail.fail = false
      expect((await adminAction('resend-recovery', {})).json()).toMatchObject({ recoveryEmailSent: true })
      expect(await consume(lastSentToken())).toBe('completed')
    })

    it('k. el destino no puede ser el email de otra cuenta, pero sí el destino guardado de otra', async () => {
      await pendingRecovery()
      const other = await createUser('USER', { securityRecoveryEmail: 'compartido@estateforge.test' })

      const taken = await adminAction('recovery-destination', { recoveryEmail: other.email })
      const shared = await adminAction('recovery-destination', { recoveryEmail: 'compartido@estateforge.test' })

      expect(taken.statusCode).toBe(409)
      expect(taken.json()).toEqual({ message: 'Ese email pertenece a otra cuenta.' })
      expect(shared.statusCode).toBe(200)
      expect((await account()).securityRecoveryEmail).toBe('compartido@estateforge.test')
    })
  })

  describe('12. solicitud del titular de un enlace nuevo (E2.6)', () => {
    const NEW_PASSWORD = 'Nueva-Contrasena-Segura-1'
    const GENERIC = { message: 'Si la cuenta puede recuperar el acceso, recibirás instrucciones en el destino de recuperación registrado.' }
    const COOLDOWN_PASSED = () => new Date(Date.now() - 16 * 60_000)

    // Recuperación pendiente real; el email actual de la cuenta (target.email) hace de email del atacante.
    async function pendingRecovery() {
      const destination = `titular-${target.id}@estateforge.test`
      await reportNewIncident(target.id, destination)
      expect((await resolveHold(target.id)).statusCode).toBe(200)
      transactions.log.length = 0
      return { destination, firstToken: lastSentToken() }
    }

    function lastSentToken() {
      return new URL(mail.calls.at(-1)!.args.recoveryUrl).searchParams.get('token')!
    }

    // El enlace de la retirada se creó ahora: se adelanta su creación para dejar atrás el enfriamiento.
    async function passCooldown(userId = target.id) {
      await db().passwordResetToken.updateMany({ where: { userId, purpose: 'SECURITY_RECOVERY' }, data: { createdAt: COOLDOWN_PASSED() } })
    }

    // Cada solicitud usa su propia instancia (límite por IP propio) y espera a los envíos al cerrarla.
    async function requestLink(email: string, extra: Record<string, unknown> = {}) {
      const auth = Fastify()
      auth.decorateRequest('userId', null)
      await auth.register(rateLimit, { global: false })
      await auth.register(modules().authRoutes)
      await auth.ready()
      try {
        return await auth.inject({ method: 'POST', url: '/api/auth/security-recovery/request', payload: { email, ...extra } })
      } finally {
        await auth.close()
      }
    }

    async function consume(token: string) {
      const { resets, passwords } = modules()
      return resets.consumeSecurityRecoveryToken(token, await passwords.hashPassword(NEW_PASSWORD))
    }

    async function account(userId = target.id) {
      return db().user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          email: true, password: true, passwordResetRequiredAt: true, securityRecoveryEmail: true,
          securityHoldAt: true, adminSuspendedAt: true, securityHoldVersion: true,
        },
      })
    }

    async function pendingRecoveryTokens(userId = target.id) {
      return db().passwordResetToken.findMany({
        where: { userId, usedAt: null, purpose: 'SECURITY_RECOVERY' },
        select: { tokenHash: true, deliverTo: true, securityHoldVersion: true },
      })
    }

    function hashOf(token: string) {
      return createHash('sha256').update(token).digest('hex')
    }

    it('a. por el email actual de la cuenta: envía solo al destino guardado, invalida el enlace anterior y el nuevo completa', async () => {
      const { destination, firstToken } = await pendingRecovery()
      await passCooldown()
      await db().passwordResetToken.create({ data: { userId: target.id, tokenHash: 'autoservicio-pendiente', expiresAt: new Date(Date.now() + 60_000) } })
      const before = await account()
      const mailsBefore = mail.calls.length

      const response = await requestLink(target.email)

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual(GENERIC)
      expect(mail.calls.length).toBe(mailsBefore + 1)
      expect(mail.calls.at(-1)!.args.to).toBe(destination)
      expect(mail.calls.at(-1)!.args.to).not.toBe(target.email)
      // Nada de la cuenta cambia: ni destino, versión, contraseña, email ni estados.
      expect(await account()).toEqual(before)
      const newToken = lastSentToken()
      expect(await pendingRecoveryTokens()).toEqual([{ tokenHash: hashOf(newToken), deliverTo: destination, securityHoldVersion: 1 }])
      expect(await db().passwordResetToken.count({ where: { tokenHash: 'autoservicio-pendiente', usedAt: null } })).toBe(1)
      const audits = await db().adminAuditLog.findMany({ where: { action: 'SECURITY_RECOVERY_LINK_REQUESTED' } })
      expect(audits).toEqual([expect.objectContaining({ actorUserId: null, targetUserId: target.id, reason: null, metadata: null })])

      expect(await consume(firstToken)).toBe('invalid_token')
      expect(await consume(newToken)).toBe('completed')
      expect((await account()).email).toBe(destination)
    })

    it('b. por el destino guardado (el email anterior del titular), con otro formato', async () => {
      const { destination } = await pendingRecovery()
      await passCooldown()

      const response = await requestLink(`  ${destination.toUpperCase()} `)

      expect(response.json()).toEqual(GENERIC)
      expect(mail.calls.at(-1)!.args.to).toBe(destination)
      expect(await consume(lastSentToken())).toBe('completed')
    })

    it('c. con un enlace de hace menos de 15 minutos no emite nada y responde lo mismo', async () => {
      const { firstToken } = await pendingRecovery()
      const mailsBefore = mail.calls.length

      const response = await requestLink(target.email)

      expect(response.json()).toEqual(GENERIC)
      expect(mail.calls.length).toBe(mailsBefore)
      expect(await pendingRecoveryTokens()).toEqual([expect.objectContaining({ tokenHash: hashOf(firstToken) })])
      expect(await db().adminAuditLog.count({ where: { action: 'SECURITY_RECOVERY_LINK_REQUESTED' } })).toBe(0)
    })

    it('d. respuesta idéntica, byte a byte, en todos los casos; solo la cuenta válida recibe correo', async () => {
      const { destination } = await pendingRecovery()
      await passCooldown()
      const normal = await createUser('USER')
      const held = await createUser('USER', { passwordResetRequiredAt: new Date(), securityRecoveryEmail: 'protegida@estateforge.test', securityHoldAt: new Date() })
      const suspended = await createUser('USER', { passwordResetRequiredAt: new Date(), securityRecoveryEmail: 'suspendida@estateforge.test', adminSuspendedAt: new Date() })
      const noDestination = await createUser('USER', { passwordResetRequiredAt: new Date() })
      const takenDestination = await createUser('USER', { passwordResetRequiredAt: new Date(), securityRecoveryEmail: normal.email })
      const mailsBefore = mail.calls.length

      const bodies: string[] = []
      for (const email of ['no-existe@estateforge.test', normal.email, held.email, suspended.email, noDestination.email, takenDestination.email, target.email]) {
        const response = await requestLink(email)
        expect(response.statusCode).toBe(200)
        bodies.push(response.body)
      }

      expect(new Set(bodies).size).toBe(1)
      expect(JSON.parse(bodies[0])).toEqual(GENERIC)
      expect(mail.calls.slice(mailsBefore).map(call => call.args.to)).toEqual([destination])
      for (const user of [normal, held, suspended, noDestination, takenDestination]) {
        expect(await db().passwordResetToken.count({ where: { userId: user.id } })).toBe(0)
      }
    })

    it('e. varias cuentas con el mismo destino se evalúan por separado', async () => {
      const shared = 'compartido@estateforge.test'
      const first = await createUser('USER', { passwordResetRequiredAt: new Date(), securityRecoveryEmail: shared })
      const second = await createUser('USER', { passwordResetRequiredAt: new Date(), securityRecoveryEmail: shared })
      const suspended = await createUser('USER', { passwordResetRequiredAt: new Date(), securityRecoveryEmail: shared, adminSuspendedAt: new Date() })

      expect((await requestLink(shared)).json()).toEqual(GENERIC)

      const sent = mail.calls.filter(call => call.args.to === shared).map(call => new URL(call.args.recoveryUrl).searchParams.get('token')!)
      expect(sent).toHaveLength(2)
      expect(await pendingRecoveryTokens(first.id)).toHaveLength(1)
      expect(await pendingRecoveryTokens(second.id)).toHaveLength(1)
      expect(await pendingRecoveryTokens(suspended.id)).toEqual([])
      // Cada enlace es de su cuenta, pero solo una puede quedarse con ese email: la segunda
      // en completar recibe email_taken, sin cambios, y necesita que un OWNER corrija su destino.
      const results = []
      for (const token of sent) results.push(await consume(token))
      expect(results).toEqual(['completed', 'email_taken'])
    })

    it('f. no acepta un destino, token o versión del cliente (400) y no emite nada', async () => {
      await pendingRecovery()
      await passCooldown()
      const mailsBefore = mail.calls.length

      const response = await requestLink(target.email, { recoveryEmail: 'atacante@estateforge.test' })

      expect(response.statusCode).toBe(400)
      expect(mail.calls.length).toBe(mailsBefore)
      expect((await account()).securityRecoveryEmail).toBe(`titular-${target.id}@estateforge.test`)
    })

    it.each([
      ['un consumo del enlace', async (token: string) => { expect(await consume(token)).toBe('completed') }],
      ['un incidente nuevo', async () => { await reportNewIncident(target.id, 'aviso-nuevo@estateforge.test') }],
      ['una suspensión', async () => { await db().user.update({ where: { id: target.id }, data: { adminSuspendedAt: new Date() } }) }],
    ])('g. si entre la lectura y la transacción llega %s, no emite nada', async (_label, change) => {
      const { firstToken } = await pendingRecovery()
      await passCooldown()
      const mailsBefore = mail.calls.length
      transactions.beforeNext = async () => {
        await change(firstToken)
      }

      const response = await requestLink(target.email)

      expect(transactions.beforeNext).toBeNull()
      expect(response.json()).toEqual(GENERIC)
      expect(mail.calls.slice(mailsBefore).filter(call => call.args.to === `titular-${target.id}@estateforge.test`)).toEqual([])
      expect(await db().adminAuditLog.count({ where: { action: 'SECURITY_RECOVERY_LINK_REQUESTED' } })).toBe(0)
    })

    it('h. dos solicitudes simultáneas emiten un solo enlace', async () => {
      await pendingRecovery()
      await passCooldown()
      const mailsBefore = mail.calls.length

      const responses = await Promise.all([requestLink(target.email), requestLink(target.email)])

      expect(responses.map(response => response.body)).toEqual([JSON.stringify(GENERIC), JSON.stringify(GENERIC)])
      expect(mail.calls.length).toBe(mailsBefore + 1)
      expect(await pendingRecoveryTokens()).toHaveLength(1)
      expect(await db().adminAuditLog.count({ where: { action: 'SECURITY_RECOVERY_LINK_REQUESTED' } })).toBe(1)
    })

    it('i. si falla la auditoría, ROLLBACK completo: el enlace anterior sigue válido y no se envía nada', async () => {
      const { firstToken } = await pendingRecovery()
      await passCooldown()
      const database = db()
      const mailsBefore = mail.calls.length
      await createTestTrigger(database, 'e26_fail_audit', 'BEFORE INSERT ON "AdminAuditLog"', `RAISE EXCEPTION 'fallo simulado de auditoria';`)
      transactions.log.length = 0
      try {
        expect((await requestLink(target.email)).json()).toEqual(GENERIC)
      } finally {
        await dropTestTrigger(database, 'e26_fail_audit')
      }

      expect(transactions.log).toEqual(['BEGIN', 'ROLLBACK'])
      expect(mail.calls.length).toBe(mailsBefore)
      expect(await pendingRecoveryTokens()).toEqual([expect.objectContaining({ tokenHash: hashOf(firstToken) })])
      expect(await consume(firstToken)).toBe('completed')
    })

    it('j. si consta que el envío falló, se anula el token, la obligación se conserva y otra solicitud inmediata funciona (DA-39)', async () => {
      await pendingRecovery()
      await passCooldown()
      mail.fail = true

      expect((await requestLink(target.email)).json()).toEqual(GENERIC)

      const failedToken = lastSentToken()
      expect(await pendingRecoveryTokens()).toEqual([])
      expect((await account()).passwordResetRequiredAt).toBeInstanceOf(Date)

      // Sin esperar al enfriamiento: un correo que no salió no lo reserva.
      mail.fail = false
      expect((await requestLink(target.email)).json()).toEqual(GENERIC)
      expect(lastSentToken()).not.toBe(failedToken)
      expect(await consume(lastSentToken())).toBe('completed')
    })

    it('j2. si el envío no está confirmado, el token y el enfriamiento se conservan', async () => {
      await pendingRecovery()
      await passCooldown()
      mail.unconfirmed = true

      expect((await requestLink(target.email)).json()).toEqual(GENERIC)
      const keptToken = lastSentToken()
      expect(await pendingRecoveryTokens()).toEqual([expect.objectContaining({ tokenHash: hashOf(keptToken) })])

      mail.unconfirmed = false
      const mailsBefore = mail.calls.length
      expect((await requestLink(target.email)).json()).toEqual(GENERIC)
      expect(mail.calls.length).toBe(mailsBefore)
      expect(await consume(keptToken)).toBe('completed')
    })

    it('k. el enfriamiento no bloquea al OWNER: reenvía aunque el titular acabe de pedir un enlace', async () => {
      await pendingRecovery()
      await passCooldown()
      expect((await requestLink(target.email)).json()).toEqual(GENERIC)

      const resent = await server().inject({
        method: 'POST',
        url: `/api/admin/users/${target.id}/resend-recovery`,
        headers: { cookie: ownerCookie },
        payload: { reason: 'Reenvío del titular' },
      })

      expect(resent.statusCode).toBe(200)
      expect(await consume(lastSentToken())).toBe('completed')
    })

    it('l. una cuenta sin recuperación obligatoria no recibe ningún token, tampoco de autoservicio', async () => {
      const mailsBefore = mail.calls.length
      const resetMailsBefore = mail.resetCalls.length

      expect((await requestLink(target.email)).json()).toEqual(GENERIC)

      expect(mail.calls.length).toBe(mailsBefore)
      expect(mail.resetCalls.length).toBe(resetMailsBefore)
      expect(await db().passwordResetToken.count({ where: { userId: target.id } })).toBe(0)
    })

    it('m. con más de diez candidatas las procesa todas y solo excluye las que no pueden recibir enlace', async () => {
      const shared = 'muchas-cuentas@estateforge.test'
      const pending = { passwordResetRequiredAt: new Date(), securityRecoveryEmail: shared }
      const valid = []
      for (let i = 0; i < 11; i++) valid.push(await createUser('USER', pending))
      const cooling = []
      for (let i = 0; i < 3; i++) {
        const user = await createUser('USER', pending)
        // Enlace emitido hace 5 minutos: dentro del enfriamiento.
        await db().passwordResetToken.create({
          data: {
            userId: user.id, tokenHash: `reciente-${user.id}`, expiresAt: new Date(Date.now() + 55 * 60_000), createdAt: new Date(Date.now() - 5 * 60_000),
            purpose: 'SECURITY_RECOVERY', deliverTo: shared, securityHoldVersion: 0,
          },
        })
        cooling.push(user)
      }
      const suspended = await createUser('USER', { ...pending, adminSuspendedAt: new Date() })
      const held = await createUser('USER', { ...pending, securityHoldAt: new Date() })
      const mailsBefore = mail.calls.length

      expect((await requestLink(shared)).json()).toEqual(GENERIC)

      expect(mail.calls.length - mailsBefore).toBe(11)
      expect(mail.calls.slice(mailsBefore).every(call => call.args.to === shared)).toBe(true)
      for (const user of valid) expect(await pendingRecoveryTokens(user.id)).toEqual([expect.objectContaining({ deliverTo: shared })])
      // Las que están en enfriamiento conservan su enlace reciente y no reciben otro.
      for (const user of cooling) {
        expect((await pendingRecoveryTokens(user.id)).map(token => token.tokenHash)).toEqual([`reciente-${user.id}`])
      }
      expect(await pendingRecoveryTokens(suspended.id)).toEqual([])
      expect(await pendingRecoveryTokens(held.id)).toEqual([])
      const audits = await db().adminAuditLog.findMany({ where: { action: 'SECURITY_RECOVERY_LINK_REQUESTED' }, select: { actorUserId: true, targetUserId: true } })
      expect(audits).toHaveLength(11)
      expect(audits.every(audit => audit.actorUserId === null)).toBe(true)
      expect(new Set(audits.map(audit => audit.targetUserId))).toEqual(new Set(valid.map(user => user.id)))
    })

    it('n. la auditoría lista la solicitud sin actor junto a las acciones del OWNER, también con filtros', async () => {
      await pendingRecovery()
      await passCooldown()
      expect((await requestLink(target.email)).json()).toEqual(GENERIC)

      async function getAudit(query = '') {
        const response = await server().inject({ method: 'GET', url: `/api/admin/audit${query}`, headers: { cookie: ownerCookie } })
        expect(response.statusCode).toBe(200)
        return response.json() as { logs: Record<string, unknown>[]; pagination: { total: number } }
      }

      const all = await getAudit()
      expect(all.logs.map(log => log.action)).toEqual(expect.arrayContaining(['SECURITY_HOLD_RESOLVED', 'SECURITY_RECOVERY_LINK_REQUESTED']))
      expect(all.logs.find(log => log.action === 'SECURITY_HOLD_RESOLVED')).toMatchObject({ actorUserId: owner.id, actorEmail: owner.email, actorFound: true })

      const requested = await getAudit('?action=SECURITY_RECOVERY_LINK_REQUESTED')
      expect(requested.pagination.total).toBe(1)
      expect(requested.logs).toEqual([expect.objectContaining({
        actorUserId: null, actorEmail: null, actorEmailAtAction: null, actorFound: null,
        targetUserId: target.id, targetEmail: target.email, targetFound: true, reason: null,
      })])
      expect((await getAudit(`?targetUserId=${target.id}&action=SECURITY_RECOVERY_LINK_REQUESTED`)).pagination.total).toBe(1)
    })
  })

  describe('13. auditoría con actor opcional', () => {
    it('a. tras todas las migraciones, actorUserId admite NULL y se conservan los dos índices', async () => {
      const columns = await db().$queryRawUnsafe<{ name: string; notnull: number | bigint }[]>(`SELECT column_name AS name, CASE WHEN is_nullable = 'NO' THEN 1 ELSE 0 END::int AS "notnull" FROM information_schema.columns WHERE table_name = 'AdminAuditLog'`)
      expect(Object.fromEntries(columns.map(column => [column.name, Number(column.notnull)]))).toEqual({
        id: 1, actorUserId: 0, targetUserId: 0, action: 1, reason: 0, metadata: 0, createdAt: 1,
      })
      const indexes = await db().$queryRawUnsafe<{ name: string; sql: string | null }[]>(
        `SELECT indexname AS name, indexdef AS sql FROM pg_indexes WHERE tablename = 'AdminAuditLog' AND indexname NOT LIKE '%_pkey' ORDER BY indexname COLLATE "C"`,
      )
      expect(indexes.map(index => index.name)).toEqual(['AdminAuditLog_actorUserId_createdAt_idx', 'AdminAuditLog_targetUserId_createdAt_idx'])
    })

    it('b. guarda un registro sin actor y uno con actor', async () => {
      await db().adminAuditLog.create({ data: { actorUserId: null, targetUserId: target.id, action: 'SECURITY_RECOVERY_LINK_REQUESTED' } })
      await db().adminAuditLog.create({ data: { actorUserId: owner.id, targetUserId: target.id, action: 'ACCOUNT_SUSPENDED', reason: 'r' } })

      expect(await db().adminAuditLog.count({ where: { actorUserId: null, targetUserId: target.id } })).toBe(1)
      expect(await db().adminAuditLog.count({ where: { actorUserId: owner.id, targetUserId: target.id } })).toBe(1)
    })
  })

  // ============================================================
  // 14. VERIFICACIÓN DEL EMAIL (Fase 0) — SQLite real, base temporal
  // ============================================================
  // Operaciones lanzadas a la vez (Fase 0.3b). Cada una abre su transacción real en su propia
  // conexión del pool de PostgreSQL, y pueden solaparse de verdad: se demuestra el resultado de
  // negocio con bloqueos reales de fila.
  // Cualquier rechazo (interbloqueo, conexión, excepción inesperada) es un error técnico:
  // no cuenta como rechazo de negocio y hace fallar la prueba con su detalle.
  describe('14. verificación del email (Fase 0)', () => {
    const POLICY = { requiredFrom: null, graceUntil: null, tokenTtlMs: 24 * 60 * 60 * 1000 }
    const T0 = new Date('2026-12-10T12:00:00.000Z')

    function verification() {
      return modules().verification
    }

    async function tokensOf(userId: string) {
      return db().emailVerificationToken.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } })
    }

    async function accountState(userId: string) {
      return db().user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          email: true,
          emailVerifiedAt: true,
          emailVerificationSentAt: true,
          securityHoldAt: true,
          adminSuspendedAt: true,
          passwordResetRequiredAt: true,
        },
      })
    }

    function describeError(error: unknown): string {
      if (!(error instanceof Error)) return String(error)
      const code = (error as { code?: unknown }).code
      return `${error.name}${code === undefined ? '' : ` [${String(code)}]`}: ${error.message}`
    }

    // Lanza las operaciones a la vez y devuelve sus resultados. Comprueba que cada una abrió
    // exactamente una transacción (sin reintentos) y registra cuántas llegaron a solaparse.
    async function runConcurrently<T>(operations: (() => Promise<T>)[]) {
      const startedBefore = transactions.started
      transactions.peakOpenConnections = transactions.openConnections
      const results = await Promise.allSettled(operations.map(operation => operation()))
      const technical = results.flatMap((result, index) =>
        result.status === 'rejected' ? [`operación ${index}: ${describeError(result.reason)}`] : [])
      if (technical.length > 0) {
        throw new Error(`Errores técnicos en operaciones concurrentes (no son rechazos de negocio):\n${technical.join('\n')}`)
      }
      return {
        values: results.map(result => (result as PromiseFulfilledResult<T>).value),
        transactionsStarted: transactions.started - startedBefore,
        peakOpenTransactions: transactions.peakOpenConnections,
      }
    }

    function tally<T>(values: T[], outcome: (value: T) => string): Record<string, number> {
      const counts: Record<string, number> = {}
      for (const value of values) counts[outcome(value)] = (counts[outcome(value)] ?? 0) + 1
      return counts
    }

    const issueOutcome = (result: { issued: true } | { issued: false; reason: string }) =>
      (result.issued ? 'issued' : result.reason)

    it('a. la migración añade las columnas y la tabla, con el índice único del hash', async () => {
      const columns = await db().$queryRawUnsafe<{ name: string; notnull: number }[]>(`SELECT column_name AS name, CASE WHEN is_nullable = 'NO' THEN 1 ELSE 0 END::int AS "notnull" FROM information_schema.columns WHERE table_name = 'User'`)
      const byName = new Map(columns.map(column => [column.name, column.notnull]))
      expect(byName.get('emailVerifiedAt')).toBe(0)
      expect(byName.get('emailVerificationSentAt')).toBe(0)
      const indexes = await db().$queryRawUnsafe<{ name: string; sql: string | null }[]>(
        `SELECT indexname AS name, indexdef AS sql FROM pg_indexes WHERE tablename = 'EmailVerificationToken' AND indexname NOT LIKE '%_pkey' ORDER BY indexname COLLATE "C"`,
      )
      expect(indexes.map(index => index.name)).toEqual([
        'EmailVerificationToken_expiresAt_idx',
        'EmailVerificationToken_tokenHash_key',
        'EmailVerificationToken_userId_createdAt_idx',
      ])
      expect(indexes.find(index => index.name === 'EmailVerificationToken_tokenHash_key')?.sql).toMatch(/^CREATE UNIQUE INDEX/)
    })

    it('b. cinco emisiones simultáneas para la misma cuenta dejan un único enlace (intervalo de 60 s)', async () => {
      const user = await createUser('USER')

      const run = await runConcurrently(Array.from({ length: 5 }, () => () => verification().issueEmailVerificationToken(user.id, POLICY, T0)))

      // 5 lanzadas: 1 emitida y 4 rechazadas por el intervalo, ninguna por un error técnico.
      expect(tally(run.values, issueOutcome)).toEqual({ issued: 1, cooldown: 4 })
      expect(run.transactionsStarted).toBe(5)
      expect(run.peakOpenTransactions).toBeGreaterThanOrEqual(1)
      // Estado final: un solo token, sin usar, para el email de la cuenta, y la reserva en T0.
      const issued = run.values.find(value => value.issued)
      const tokens = await tokensOf(user.id)
      expect(tokens).toHaveLength(1)
      expect(tokens[0]).toMatchObject({ email: user.email, usedAt: null, createdAt: T0 })
      if (issued?.issued) expect(tokens[0].tokenHash).toBe(verification().hashEmailVerificationToken(issued.token))
      expect(await accountState(user.id)).toMatchObject({ email: user.email, emailVerifiedAt: null, emailVerificationSentAt: T0 })
    })

    it('c. con cuatro envíos en 24 horas, cuatro emisiones simultáneas solo añaden uno (máximo de cinco)', async () => {
      const user = await createUser('USER')
      for (let i = 0; i < 4; i += 1) {
        await db().emailVerificationToken.create({
          data: {
            tokenHash: `historico-${user.id}-${i}`,
            userId: user.id,
            email: user.email,
            expiresAt: new Date(T0.getTime() - 60 * 60 * 1000),
            usedAt: new Date(T0.getTime() - 60 * 60 * 1000),
            createdAt: new Date(T0.getTime() - (i + 2) * 60 * 60 * 1000),
          },
        })
      }
      await db().user.update({ where: { id: user.id }, data: { emailVerificationSentAt: new Date(T0.getTime() - 2 * 60 * 60 * 1000) } })

      const run = await runConcurrently(Array.from({ length: 4 }, () => () => verification().issueEmailVerificationToken(user.id, POLICY, T0)))

      // 4 lanzadas: la primera reserva y emite el quinto envío del día; las otras 3 encuentran la
      // reserva en T0 y se rechazan por el intervalo. Ninguna por un error técnico.
      expect(tally(run.values, issueOutcome)).toEqual({ issued: 1, cooldown: 3 })
      expect(run.transactionsStarted).toBe(4)
      expect(run.peakOpenTransactions).toBeGreaterThanOrEqual(1)
      const tokens = await tokensOf(user.id)
      expect(tokens).toHaveLength(5)
      // Los 4 históricos siguen como estaban; solo el nuevo queda sin usar.
      expect(tokens.filter(token => token.usedAt === null)).toHaveLength(1)
      expect(tokens.filter(token => token.createdAt.getTime() === T0.getTime())).toHaveLength(1)

      // Pasado el intervalo, el sexto se rechaza por el máximo diario y no deja la reserva puesta.
      const later = new Date(T0.getTime() + 61 * 1000)
      expect(await verification().issueEmailVerificationToken(user.id, POLICY, later)).toEqual({ issued: false, reason: 'daily_limit' })
      expect(await tokensOf(user.id)).toHaveLength(5)
      const state = await db().user.findUniqueOrThrow({ where: { id: user.id }, select: { emailVerificationSentAt: true } })
      expect(state.emailVerificationSentAt).toEqual(T0)
    })

    it('d. respeta el intervalo en secuencia: a los 30 s no, a los 60 s sí, y el nuevo anula al anterior', async () => {
      const user = await createUser('USER')
      const first = await verification().issueEmailVerificationToken(user.id, POLICY, T0)
      expect(first.issued).toBe(true)

      expect(await verification().issueEmailVerificationToken(user.id, POLICY, new Date(T0.getTime() + 30 * 1000)))
        .toEqual({ issued: false, reason: 'cooldown' })
      const second = await verification().issueEmailVerificationToken(user.id, POLICY, new Date(T0.getTime() + 60 * 1000))
      expect(second.issued).toBe(true)

      const tokens = await tokensOf(user.id)
      expect(tokens).toHaveLength(2)
      expect(tokens[0].usedAt).not.toBeNull()
      expect(tokens[1].usedAt).toBeNull()
      // El token del primer enlace ya no verifica.
      if (first.issued) expect(await verification().consumeEmailVerificationToken(first.token, new Date(T0.getTime() + 61 * 1000))).toBe('invalid')
    })

    it('e. tres consumos simultáneos del mismo token: solo uno verifica', async () => {
      const user = await createUser('USER')
      const issued = await verification().issueEmailVerificationToken(user.id, POLICY, T0)
      if (!issued.issued) throw new Error('no se emitió el token')
      const at = new Date(T0.getTime() + 1000)

      const run = await runConcurrently(Array.from({ length: 3 }, () => () => verification().consumeEmailVerificationToken(issued.token, at)))

      // 3 lanzadas: 1 verifica y 2 encuentran el token ya usado. Ninguna por un error técnico.
      expect(tally(run.values, value => value)).toEqual({ verified: 1, invalid: 2 })
      expect(run.transactionsStarted).toBe(3)
      expect(run.peakOpenTransactions).toBeGreaterThanOrEqual(1)
      // Estado final: verificado una sola vez, en `at`, con el mismo email; el token, usado en `at`.
      expect(await accountState(user.id)).toMatchObject({ email: user.email, emailVerifiedAt: at, emailVerificationSentAt: T0 })
      const tokens = await tokensOf(user.id)
      expect(tokens).toHaveLength(1)
      expect(tokens[0].usedAt).toEqual(at)
      // Reutilizarlo después tampoco verifica.
      expect(await verification().consumeEmailVerificationToken(issued.token, new Date(at.getTime() + 1000))).toBe('invalid')
    })

    it('f. si la cuenta cambia de email entre la emisión y el consumo, no verifica ni gasta el token', async () => {
      const user = await createUser('USER')
      const issued = await verification().issueEmailVerificationToken(user.id, POLICY, T0)
      if (!issued.issued) throw new Error('no se emitió el token')
      expect(issued.email).toBe(user.email)
      await db().user.update({ where: { id: user.id }, data: { email: `cambiado-${user.id}@estateforge.test` } })

      expect(await verification().consumeEmailVerificationToken(issued.token, new Date(T0.getTime() + 1000))).toBe('invalid')

      const state = await db().user.findUniqueOrThrow({ where: { id: user.id }, select: { emailVerifiedAt: true } })
      expect(state.emailVerifiedAt).toBeNull()
      expect((await tokensOf(user.id))[0].usedAt).toBeNull()
    })

    it('g. una cuenta en recuperación obligatoria (E2) no recibe enlaces ni puede verificar uno anterior', async () => {
      const user = await createUser('USER')
      const issued = await verification().issueEmailVerificationToken(user.id, POLICY, T0)
      if (!issued.issued) throw new Error('no se emitió el token')
      await db().user.update({ where: { id: user.id }, data: { passwordResetRequiredAt: T0 } })

      expect(await verification().issueEmailVerificationToken(user.id, POLICY, new Date(T0.getTime() + 120 * 1000)))
        .toEqual({ issued: false, reason: 'not_eligible' })
      expect(await verification().consumeEmailVerificationToken(issued.token, new Date(T0.getTime() + 1000))).toBe('invalid')
      const state = await db().user.findUniqueOrThrow({ where: { id: user.id }, select: { emailVerifiedAt: true } })
      expect(state.emailVerifiedAt).toBeNull()
    })

    // ConsumeAbort con un ROLLBACK real (Fase 0.3b). Un trigger temporal, solo en esta base,
    // hace que la escritura que marca el email como verificado no afecte a ninguna fila
    // (el trigger devuelve NULL), pero únicamente si en la misma transacción ya es visible la reclamación
    // del token (usedAt con valor). Así, la primera escritura (la reclamación) se ha hecho antes
    // del fallo: si no se hubiera hecho, el trigger no actuaría y el consumo verificaría. El
    // servicio recibe count = 0, relee la cuenta, la ve sin verificar y lanza ConsumeAbort.
    // Todo es código de producción; el test solo prepara la base y la comprueba después.
    it('h. ConsumeAbort deshace con un ROLLBACK real la reclamación del token ya escrita', async () => {
      const user = await createUser('USER')
      const issued = await verification().issueEmailVerificationToken(user.id, POLICY, T0)
      if (!issued.issued) throw new Error('no se emitió el token')
      const tokenHash = verification().hashEmailVerificationToken(issued.token)
      const at = new Date(T0.getTime() + 1000)
      const accountBefore = await accountState(user.id)
      const tokensBefore = await tokensOf(user.id)
      expect(accountBefore).toMatchObject({ email: user.email, emailVerifiedAt: null })
      expect(tokensBefore).toHaveLength(1)
      expect(tokensBefore[0].usedAt).toBeNull()

      const database = db()
      // tokenHash son 64 caracteres hexadecimales: se puede incluir en el SQL sin riesgo.
      await createTestTrigger(
        database,
        'f0_3b_ignore_verification',
        'BEFORE UPDATE OF "emailVerifiedAt" ON "User"',
        `IF EXISTS (SELECT 1 FROM "EmailVerificationToken" WHERE "tokenHash" = '${tokenHash}' AND "usedAt" IS NOT NULL) THEN RETURN NULL; END IF; RETURN NEW;`,
        `NEW."emailVerifiedAt" IS NOT NULL`,
      )
      transactions.log.length = 0
      let result: string
      try {
        result = await verification().consumeEmailVerificationToken(issued.token, at)
      } finally {
        await dropTestTrigger(database, 'f0_3b_ignore_verification')
      }

      // El servicio responde como un enlace no válido y la transacción termina con ROLLBACK:
      // las salidas de 'invalid' sin escrituras confirman con COMMIT; solo ConsumeAbort deshace.
      expect(result).toBe('invalid')
      expect(transactions.log).toEqual(['BEGIN', 'ROLLBACK'])
      expect(await database.$queryRawUnsafe(`SELECT tgname FROM pg_trigger WHERE tgname = 'f0_3b_ignore_verification'`)).toEqual([])
      // Después de la transacción, nada de lo escrito dentro sigue en la base: el token sigue sin
      // usar, el email es el mismo, no está verificado y la cuenta está como antes.
      expect(await tokensOf(user.id)).toEqual(tokensBefore)
      expect(await accountState(user.id)).toEqual(accountBefore)

      // Control: sin el trigger, el mismo token verifica. No se había gastado.
      const later = new Date(at.getTime() + 1000)
      expect(await verification().consumeEmailVerificationToken(issued.token, later)).toBe('verified')
      expect(await accountState(user.id)).toMatchObject({ email: user.email, emailVerifiedAt: later })
      expect((await tokensOf(user.id))[0].usedAt).toEqual(later)
    })

    // Consumo del enlace y cambio de email confirmado (servicio real) lanzados a la vez, en los
    // dos órdenes de lanzamiento. Con la decisión D1, el cambio confirmado deja verificada la
    // dirección nueva e invalida los enlaces pendientes. Se ejecuten en el orden que se ejecuten,
    // el resultado final es el mismo y coherente, sin estados intermedios:
    // - primero la verificación: 'verified' (token usado en `at`) y después el cambio vuelve a
    //   fechar emailVerifiedAt con la dirección nueva;
    // - primero el cambio: verificado con la dirección nueva y el token invalidado, así que el
    //   consumo responde 'invalid'.
    it.each([
      ['la verificación se lanza primero', 'verify-first'],
      ['el cambio de email se lanza primero', 'change-first'],
    ] as const)('i. consumo del enlace y cambio de email a la vez (%s): un resultado coherente, sin efectos parciales', async (_label, order) => {
      const user = await createUser('USER')
      const issued = await verification().issueEmailVerificationToken(user.id, POLICY, T0)
      if (!issued.issued) throw new Error('no se emitió el token')
      const newEmail = `nuevo-${user.id}@estateforge.test`
      const { code } = await modules().emailChange.issueEmailChangeCode(user.id, newEmail)
      const at = new Date(T0.getTime() + 1000)

      const consume = () => verification().consumeEmailVerificationToken(issued.token, at)
      const change = () => modules().emailChange.consumeEmailChangeCode(user.id, code)
      const before = new Date()
      const run = await runConcurrently<unknown>(order === 'verify-first' ? [consume, change] : [change, consume])
      const after = new Date()
      const verifyResult = run.values[order === 'verify-first' ? 0 : 1]
      const changeResult = run.values[order === 'verify-first' ? 1 : 0]

      expect(run.transactionsStarted).toBe(2)
      expect(run.peakOpenTransactions).toBeGreaterThanOrEqual(1)
      expect(changeResult).toEqual({ success: true, email: newEmail, oldEmail: user.email })
      const account = await accountState(user.id)
      const tokens = await tokensOf(user.id)
      expect(account.email).toBe(newEmail)
      expect(tokens).toHaveLength(1)
      // En los dos órdenes, la verificación final es la del cambio (dirección nueva).
      expect(account.emailVerifiedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(account.emailVerifiedAt!.getTime()).toBeLessThanOrEqual(after.getTime())
      if (verifyResult === 'verified') {
        expect(tokens[0].usedAt).toEqual(at)
      } else {
        expect(verifyResult).toBe('invalid')
        expect(tokens[0].usedAt).toEqual(account.emailVerifiedAt)
      }
    })

    // ============================================================
    // Decisiones de producto de la Fase 0 (D1 a D3) — SQLite real, servicios reales
    // ============================================================
    describe('decisiones de producto (D1 a D3)', () => {
      const PENDING_EXPIRES = () => new Date(Date.now() + 24 * 60 * 60 * 1000)
      const OLD_USE = new Date('2026-01-01T00:00:00.000Z')

      // Un enlace pendiente (sin usar) y otro ya consumido, insertados directamente para no
      // depender de los límites de emisión. Devuelve el token en claro del pendiente.
      async function seedVerificationTokens(userId: string, email: string) {
        const raw = verification().createEmailVerificationToken()
        await db().emailVerificationToken.create({
          data: { tokenHash: verification().hashEmailVerificationToken(raw), userId, email, expiresAt: PENDING_EXPIRES() },
        })
        await db().emailVerificationToken.create({
          data: { tokenHash: `usado-${userId}`, userId, email, expiresAt: OLD_USE, usedAt: OLD_USE, createdAt: OLD_USE },
        })
        return raw
      }

      async function verificationTokenRows(userId: string) {
        const rows = await db().emailVerificationToken.findMany({ where: { userId }, select: { tokenHash: true, usedAt: true } })
        return {
          pending: rows.filter(row => !row.tokenHash.startsWith('usado-')),
          consumed: rows.filter(row => row.tokenHash.startsWith('usado-')),
        }
      }

      function within(date: Date | null, from: Date, to: Date) {
        expect(date).toBeInstanceOf(Date)
        expect(date!.getTime()).toBeGreaterThanOrEqual(from.getTime())
        expect(date!.getTime()).toBeLessThanOrEqual(to.getTime())
      }

      describe('D1. el cambio de email confirmado verifica la dirección nueva', () => {
        it.each([
          ['sin verificar', null],
          ['ya verificada', new Date('2026-06-01T00:00:00.000Z')],
        ] as const)('D1.a cuenta %s: email nuevo, emailVerifiedAt = ahora y enlaces pendientes invalidados en la misma transacción', async (_label, verifiedAt) => {
          const user = await createUser('USER', { emailVerifiedAt: verifiedAt })
          const raw = await seedVerificationTokens(user.id, user.email)
          const newEmail = `d1-${user.id}@estateforge.test`
          const { code } = await modules().emailChange.issueEmailChangeCode(user.id, newEmail)
          transactions.log.length = 0

          const before = new Date()
          const result = await modules().emailChange.consumeEmailChangeCode(user.id, code)
          const after = new Date()

          expect(result).toEqual({ success: true, email: newEmail, oldEmail: user.email })
          expect(transactions.log).toEqual(['BEGIN', 'COMMIT'])
          const account = await accountState(user.id)
          expect(account.email).toBe(newEmail)
          within(account.emailVerifiedAt, before, after)
          const rows = await verificationTokenRows(user.id)
          // El pendiente queda invalidado en el mismo instante que la verificación; el consumido no cambia.
          expect(rows.pending).toEqual([expect.objectContaining({ usedAt: account.emailVerifiedAt })])
          expect(rows.consumed).toEqual([expect.objectContaining({ usedAt: OLD_USE })])
          expect(await db().emailChangeVerification.count({ where: { userId: user.id } })).toBe(0)
          // El enlace anterior ya no verifica.
          expect(await verification().consumeEmailVerificationToken(raw)).toBe('invalid')
        })

        const incorrectCode = async (): Promise<string> => '000000'
        const expiredCode = async (userId: string): Promise<string> => {
          const { code } = await modules().emailChange.issueEmailChangeCode(userId, `caducado-${userId}@estateforge.test`)
          await db().emailChangeVerification.updateMany({ where: { userId }, data: { expiresAt: new Date(Date.now() - 1000) } })
          return code
        }

        it.each([
          ['incorrecto', incorrectCode],
          ['caducado', expiredCode],
        ] as const)('D1.b con un código %s no cambia el email, la verificación ni los enlaces', async (_label, codeFor) => {
          const user = await createUser('USER')
          await seedVerificationTokens(user.id, user.email)
          const code = await codeFor(user.id)
          const accountBefore = await accountState(user.id)
          const tokensBefore = await verificationTokenRows(user.id)

          expect(await modules().emailChange.consumeEmailChangeCode(user.id, code)).toEqual({ success: false, reason: 'invalid' })

          expect(await accountState(user.id)).toEqual(accountBefore)
          expect(await verificationTokenRows(user.id)).toEqual(tokensBefore)
        })

        // Un fallo después de cambiar el email (al invalidar los enlaces) deshace la transacción
        // entera con un ROLLBACK real: ni email nuevo, ni verificación, ni código gastado.
        it('D1.c un error dentro de la transacción la deshace por completo', async () => {
          const user = await createUser('USER')
          await seedVerificationTokens(user.id, user.email)
          const { code } = await modules().emailChange.issueEmailChangeCode(user.id, `d1c-${user.id}@estateforge.test`)
          const accountBefore = await accountState(user.id)
          const tokensBefore = await verificationTokenRows(user.id)
          const database = db()
          await createTestTrigger(database, 'd1_fail_invalidation', 'BEFORE UPDATE ON "EmailVerificationToken"', `RAISE EXCEPTION 'fallo simulado al invalidar enlaces';`)
          transactions.log.length = 0
          try {
            await expect(modules().emailChange.consumeEmailChangeCode(user.id, code)).rejects.toThrow()
          } finally {
            await dropTestTrigger(database, 'd1_fail_invalidation')
          }

          expect(transactions.log).toEqual(['BEGIN', 'ROLLBACK'])
          expect(await accountState(user.id)).toEqual(accountBefore)
          expect(await verificationTokenRows(user.id)).toEqual(tokensBefore)
          expect(await database.emailChangeVerification.findMany({ where: { userId: user.id }, select: { usedAt: true } })).toEqual([{ usedAt: null }])
        })

        // Corrección F0-003: un P2002 real. Un trigger temporal inserta, dentro del propio UPDATE
        // del email, otra cuenta con la dirección nueva (después de la comprobación previa del
        // servicio), así que la escritura choca con el índice único de User.email. El servicio
        // solo traduce a email_taken ese error concreto: si fuera otro, la prueba rechazaría.
        it('D1.d si otra cuenta ocupa la dirección durante la escritura (P2002 real), ROLLBACK completo y el código sigue sirviendo', async () => {
          const user = await createUser('USER')
          await seedVerificationTokens(user.id, user.email)
          const newEmail = `d1d-${user.id}@estateforge.test`
          const { code } = await modules().emailChange.issueEmailChangeCode(user.id, newEmail)
          const accountBefore = await accountState(user.id)
          const tokensBefore = await verificationTokenRows(user.id)
          const codesBefore = await db().emailChangeVerification.findMany({ where: { userId: user.id } })
          const intruderId = `intruso-${user.id}`
          const database = db()
          // newEmail solo contiene el id (cuid) y texto fijo: se puede incluir en el SQL sin riesgo.
          await createTestTrigger(
            database,
            'f0_003_take_email',
            'BEFORE UPDATE OF "email" ON "User"',
            `INSERT INTO "User" ("id", "email", "password", "updatedAt") VALUES ('${intruderId}', NEW."email", 'no-usado', CURRENT_TIMESTAMP); RETURN NEW;`,
            `NEW."email" = '${newEmail}'`,
          )
          transactions.log.length = 0
          let result: unknown
          try {
            result = await modules().emailChange.consumeEmailChangeCode(user.id, code)
          } finally {
            await dropTestTrigger(database, 'f0_003_take_email')
          }

          expect(result).toEqual({ success: false, reason: 'email_taken' })
          // Antes de F0-003 la transacción terminaba en COMMIT con el código reclamado.
          expect(transactions.log).toEqual(['BEGIN', 'ROLLBACK'])
          expect(await accountState(user.id)).toEqual(accountBefore)
          expect(await verificationTokenRows(user.id)).toEqual(tokensBefore)
          expect(await database.emailChangeVerification.findMany({ where: { userId: user.id } })).toEqual(codesBefore)
          expect(codesBefore[0].usedAt).toBeNull()
          // La cuenta insertada por el trigger también se ha deshecho.
          expect(await database.user.findUnique({ where: { id: intruderId } })).toBeNull()

          // Resuelto el conflicto (sin el trigger), el mismo código completa el cambio.
          expect(await modules().emailChange.consumeEmailChangeCode(user.id, code)).toEqual({ success: true, email: newEmail, oldEmail: user.email })
          expect((await accountState(user.id)).email).toBe(newEmail)
        })
      })

      // Corrección F0-002: con la ruta real, la base real y la auditoría que consulta un OWNER.
      describe('F0-002. aviso de cambio de email no enviado', () => {
        async function confirmChange(userId: string, code: string) {
          const session = await modules().sessions.createSession(userId)
          const auth = Fastify()
          auth.decorateRequest('userId', null)
          await auth.register(rateLimit, { global: false })
          await auth.register(modules().authRoutes)
          await auth.ready()
          try {
            return await auth.inject({
              method: 'POST',
              url: '/api/auth/change-email/verify',
              headers: { cookie: `estateforge_session=${session.token}` },
              payload: { code },
            })
          } finally {
            await auth.close()
          }
        }

        function noticeAudits(userId: string) {
          return db().adminAuditLog.findMany({ where: { action: 'EMAIL_CHANGE_NOTICE_FAILED', targetUserId: userId } })
        }

        it('con el aviso enviado: cambio completado, aviso con el enlace de incidente y sin auditoría de fallo', async () => {
          const user = await createUser('USER')
          const newEmail = `f002-ok-${user.id}@estateforge.test`
          const { code } = await modules().emailChange.issueEmailChangeCode(user.id, newEmail)

          const response = await confirmChange(user.id, code)

          expect(response.statusCode).toBe(200)
          expect(response.json()).toMatchObject({ securityNoticeSent: true, user: { id: user.id, email: newEmail } })
          expect(mail.noticeCalls).toEqual([expect.objectContaining({ to: user.email, stage: 'completed', incidentReportUrl: expect.stringContaining('/api/auth/security-incident/') })])
          expect(await noticeAudits(user.id)).toEqual([])
        })

        it('con el SMTP fallando: el cambio queda confirmado en la base, se audita sin datos sensibles y un OWNER lo ve', async () => {
          const user = await createUser('USER')
          const newEmail = `f002-ko-${user.id}@estateforge.test`
          const { code } = await modules().emailChange.issueEmailChangeCode(user.id, newEmail)
          mail.noticeFail = true

          const response = await confirmChange(user.id, code)

          expect(response.statusCode).toBe(200)
          expect(response.json()).toMatchObject({ securityNoticeSent: false, user: { id: user.id, email: newEmail } })
          // El cambio está hecho en la base (D1) y no se deshace por el fallo del aviso.
          expect(await accountState(user.id)).toMatchObject({ email: newEmail, emailVerifiedAt: expect.any(Date) })
          const [audit, ...rest] = await noticeAudits(user.id)
          expect(rest).toEqual([])
          expect(audit).toMatchObject({ actorUserId: user.id, targetUserId: user.id, reason: null, metadata: JSON.stringify({ noticeFailure: 'DELIVERY' }) })
          expect(audit.createdAt).toBeInstanceOf(Date)
          const incidentUrl = mail.noticeCalls[0].incidentReportUrl!
          const stored = JSON.stringify(audit)
          for (const secret of [user.email, newEmail, incidentUrl, incidentUrl.split('/').pop()!, '550']) expect(stored).not.toContain(secret)

          // La auditoría del panel (GET /api/admin/audit, solo OWNER) muestra el evento filtrado.
          const listed = await server().inject({
            method: 'GET',
            url: `/api/admin/audit?action=EMAIL_CHANGE_NOTICE_FAILED&targetUserId=${user.id}`,
            headers: { cookie: ownerCookie },
          })
          expect(listed.statusCode).toBe(200)
          const { logs } = listed.json() as { logs: Record<string, unknown>[] }
          expect(logs).toEqual([expect.objectContaining({
            action: 'EMAIL_CHANGE_NOTICE_FAILED', actorUserId: user.id, targetUserId: user.id, targetEmail: newEmail, noticeFailure: 'DELIVERY',
          })])
          expect(logs[0]).not.toHaveProperty('metadata')
          expect(listed.payload).not.toContain(incidentUrl.split('/').pop()!)
        })
      })

      describe('D2. la finalización de E2 y la verificación del email', () => {
        const NEW_PASSWORD = 'Nueva-Contrasena-Segura-1'
        const VERIFIED_AT = new Date('2026-06-01T00:00:00.000Z')

        // Ciclo real hasta la recuperación pendiente, con el destino indicado.
        async function pendingRecoveryTo(destination: string) {
          await reportNewIncident(target.id, destination)
          expect((await resolveHold(target.id)).statusCode).toBe(200)
          return new URL(mail.calls.at(-1)!.args.recoveryUrl).searchParams.get('token')!
        }

        async function complete(token: string) {
          const { resets, passwords } = modules()
          return resets.consumeSecurityRecoveryToken(token, await passwords.hashPassword(NEW_PASSWORD))
        }

        it.each([
          ['la misma dirección', 'same', VERIFIED_AT, VERIFIED_AT],
          ['la misma dirección', 'same', null, null],
          ['otra dirección', 'other', VERIFIED_AT, null],
          ['otra dirección', 'other', null, null],
        ] as const)('D2.a con %s (%s) y emailVerifiedAt %s: queda %s y todos los enlaces pendientes se invalidan', async (_label, kind, verifiedAt, expected) => {
          await db().user.update({ where: { id: target.id }, data: { emailVerifiedAt: verifiedAt } })
          const raw = await seedVerificationTokens(target.id, target.email)
          const destination = kind === 'same' ? target.email : `e2-${target.id}@estateforge.test`
          const token = await pendingRecoveryTo(destination)
          transactions.log.length = 0

          const before = new Date()
          expect(await complete(token)).toBe('completed')
          const after = new Date()

          expect(transactions.log).toEqual(['BEGIN', 'COMMIT'])
          const account = await accountState(target.id)
          expect(account).toMatchObject({ email: destination, emailVerifiedAt: expected, passwordResetRequiredAt: null })
          const rows = await verificationTokenRows(target.id)
          expect(rows.pending).toHaveLength(1)
          within(rows.pending[0].usedAt, before, after)
          expect(rows.consumed).toEqual([expect.objectContaining({ usedAt: OLD_USE })])
          // Invariantes de E2 que se mantienen: sesiones cerradas y la finalización auditada.
          expect(await db().session.count({ where: { userId: target.id } })).toBe(0)
          expect(await db().adminAuditLog.count({ where: { action: 'SECURITY_RECOVERY_COMPLETED', targetUserId: target.id } })).toBe(1)
          // El enlace pendiente no sirve después de E2, tampoco con la misma dirección.
          expect(await verification().consumeEmailVerificationToken(raw)).toBe('invalid')
          expect((await accountState(target.id)).emailVerifiedAt).toEqual(expected)
        })

        it('D2.b un error dentro de la finalización deshace todas las escrituras (ROLLBACK real)', async () => {
          await db().user.update({ where: { id: target.id }, data: { emailVerifiedAt: VERIFIED_AT } })
          await seedVerificationTokens(target.id, target.email)
          const token = await pendingRecoveryTo(`e2b-${target.id}@estateforge.test`)
          const accountBefore = await db().user.findUniqueOrThrow({ where: { id: target.id } })
          const tokensBefore = await verificationTokenRows(target.id)
          const database = db()
          await createTestTrigger(database, 'd2_fail_invalidation', 'BEFORE UPDATE ON "EmailVerificationToken"', `RAISE EXCEPTION 'fallo simulado al invalidar enlaces';`)
          transactions.log.length = 0
          try {
            await expect(complete(token)).rejects.toThrow()
          } finally {
            await dropTestTrigger(database, 'd2_fail_invalidation')
          }

          expect(transactions.log).toEqual(['BEGIN', 'ROLLBACK'])
          // La cuenta entera (contraseña, email, verificación, E2) y los enlaces quedan como antes.
          expect(await database.user.findUniqueOrThrow({ where: { id: target.id } })).toEqual(accountBefore)
          expect(await verificationTokenRows(target.id)).toEqual(tokensBefore)
          const recovery = await database.passwordResetToken.findUnique({ where: { tokenHash: createHash('sha256').update(token).digest('hex') }, select: { usedAt: true } })
          expect(recovery).toEqual({ usedAt: null })
          expect(await database.adminAuditLog.count({ where: { action: 'SECURITY_RECOVERY_COMPLETED' } })).toBe(0)
        })
      })

      describe('D3. forgot-password en segundo plano', () => {
        const GENERIC = { message: 'Si la cuenta existe, recibirás instrucciones para restablecer la contraseña.' }

        async function forgot(email: string) {
          const auth = Fastify()
          auth.decorateRequest('userId', null)
          await auth.register(rateLimit, { global: false })
          await auth.register(modules().authRoutes)
          await auth.ready()
          try {
            const response = await auth.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { email } })
            await modules().resetDelivery.waitForPendingPasswordResetDeliveries()
            return response
          } finally {
            await auth.close()
          }
        }

        async function selfServiceTokens(userId: string) {
          return db().passwordResetToken.findMany({ where: { userId, purpose: 'SELF_SERVICE' }, select: { usedAt: true, expiresAt: true } })
        }

        it.each([
          ['el SMTP acepta el envío', 'ok', 1],
          ['consta que el SMTP falló', 'failed', 0],
          ['el envío no está confirmado', 'unconfirmed', 1],
        ] as const)('D3.a cuenta elegible y %s: respuesta genérica idéntica; token activo solo si el correo pudo llegar (DA-39)', async (_label, outcome, activeTokens) => {
          mail.resetFail = outcome === 'failed'
          mail.resetUnconfirmed = outcome === 'unconfirmed'
          const user = await createUser('USER')

          const response = await forgot(user.email)

          expect(response.statusCode).toBe(200)
          expect(response.json()).toEqual(GENERIC)
          expect(mail.resetCalls.map(call => call.to)).toEqual([user.email])
          // Sin reintentos. Un correo que consta que no salió no deja un enlace activo inútil.
          const tokens = await selfServiceTokens(user.id)
          expect(tokens).toHaveLength(activeTokens)
          for (const token of tokens) {
            expect(token.usedAt).toBeNull()
            expect(token.expiresAt.getTime()).toBeGreaterThan(Date.now())
          }
        })

        it('D3.b cuenta inexistente o no elegible: la misma respuesta, sin token ni envío', async () => {
          const held = await createUser('USER', { passwordResetRequiredAt: new Date() })

          for (const email of ['nadie@estateforge.test', held.email]) {
            const response = await forgot(email)
            expect(response.statusCode).toBe(200)
            expect(response.json()).toEqual(GENERIC)
          }
          expect(mail.resetCalls).toEqual([])
          expect(await selfServiceTokens(held.id)).toEqual([])
        })
      })
    })
  })

  // Fase 1, corrección B (F0-001): orden único de bloqueos. Toda transacción que escribe la fila
  // de la cuenta y filas de sus tokens bloquea primero la cuenta. Aquí se comprueba con SQLite
  // real (1) que la primera escritura de cada consumo es la de User y (2) que las operaciones
  // concurrentes dan resultados de negocio coherentes, sin estados parciales ni dobles consumos.
  // SQLite serializa las transacciones de escritura (el pico de transacciones abiertas es 1), así
  // que estas pruebas NO demuestran la ausencia de interbloqueos en PostgreSQL: solo que el nuevo
  // orden conserva el comportamiento. La prueba en PostgreSQL queda diseñada en el informe.
  describe('15. orden único de bloqueos: primero la cuenta (F0-001)', () => {
    const POLICY = { requiredFrom: null, graceUntil: null, tokenTtlMs: 24 * 60 * 60 * 1000 }
    const T0 = new Date('2026-12-10T12:00:00.000Z')
    const AT = new Date(T0.getTime() + 1000)
    const LATER = new Date(T0.getTime() + 61 * 1000)
    const LOCK = 'UPDATE User'

    function verification() {
      return modules().verification
    }

    async function issueVerification(userId: string, now = T0) {
      const issued = await verification().issueEmailVerificationToken(userId, POLICY, now)
      if (!issued.issued) throw new Error(`no se emitió el enlace: ${issued.reason}`)
      return issued
    }

    function hashOf(token: string) {
      return createHash('sha256').update(token).digest('hex')
    }

    async function hashedPassword() {
      return modules().passwords.hashPassword('Nueva-Contrasena-Segura-1')
    }

    // Escrituras de las transacciones interactivas que abre la operación.
    async function writesDuring<T>(operation: () => Promise<T>) {
      const from = transactions.writes.length
      const value = await operation()
      return { value, writes: transactions.writes.slice(from).filter(writes => writes.length > 0) }
    }

    // Lanza las operaciones a la vez. Un rechazo es un error técnico (por ejemplo, un
    // interbloqueo o un conflicto de escritura), no un resultado de negocio: hace fallar la prueba.
    async function atOnce<T>(operations: (() => Promise<T>)[]) {
      const results = await Promise.allSettled(operations.map(operation => operation()))
      const technical = results.flatMap((result, index) =>
        result.status === 'rejected' ? [`operación ${index}: ${String(result.reason)}`] : [])
      if (technical.length > 0) throw new Error(`Errores técnicos en operaciones concurrentes:\n${technical.join('\n')}`)
      return results.map(result => (result as PromiseFulfilledResult<T>).value)
    }

    // Ciclo real hasta la recuperación obligatoria pendiente (como en el bloque 10).
    async function pendingRecovery() {
      const destination = `titular-${target.id}@estateforge.test`
      await reportNewIncident(target.id, destination)
      expect((await resolveHold(target.id)).statusCode).toBe(200)
      return { token: new URL(mail.calls.at(-1)!.args.recoveryUrl).searchParams.get('token')!, destination }
    }

    async function user(userId: string) {
      return db().user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          email: true, password: true, emailVerifiedAt: true, securityHoldAt: true, securityHoldVersion: true,
          passwordResetRequiredAt: true, securityRecoveryEmail: true,
        },
      })
    }

    describe('a. la primera escritura de cada consumo es el bloqueo de la cuenta', () => {
      it('consumeEmailVerificationToken', async () => {
        const account = await createUser('USER')
        const issued = await issueVerification(account.id)

        const run = await writesDuring(() => verification().consumeEmailVerificationToken(issued.token, AT))

        expect(run.value).toBe('verified')
        expect(run.writes).toHaveLength(1)
        expect(run.writes[0][0]).toBe(LOCK)
        expect(run.writes[0].slice(1)).toEqual(['UPDATE EmailVerificationToken', 'UPDATE User', 'UPDATE EmailVerificationToken'])
      })

      it('consumeEmailChangeCode', async () => {
        const account = await createUser('USER')
        const { code } = await modules().emailChange.issueEmailChangeCode(account.id, `nueva-${account.id}@estateforge.test`)

        const run = await writesDuring(() => modules().emailChange.consumeEmailChangeCode(account.id, code))

        expect(run.value).toMatchObject({ success: true })
        expect(run.writes).toHaveLength(1)
        expect(run.writes[0][0]).toBe(LOCK)
        expect(run.writes[0].slice(1)).toEqual(['UPDATE EmailChangeVerification', 'UPDATE User', 'UPDATE EmailVerificationToken', 'DELETE FROM EmailChangeVerification'])
      })

      it('reportSecurityIncident', async () => {
        const { token } = await modules().incidents.issueSecurityIncidentToken(target.id, 'anterior@estateforge.test')

        const run = await writesDuring(() => modules().incidents.reportSecurityIncident(token))

        expect(run.value).toBe('reported')
        expect(run.writes).toHaveLength(1)
        expect(run.writes[0][0]).toBe(LOCK)
        expect(run.writes[0][1]).toBe('UPDATE SecurityIncidentToken')
      })

      it('consumePasswordResetToken', async () => {
        const reset = await modules().resets.issuePasswordResetToken(target.id)
        const hash = await hashedPassword()

        const run = await writesDuring(() => modules().resets.consumePasswordResetToken(reset.token, hash))

        expect(run.value).toBe(true)
        expect(run.writes).toHaveLength(1)
        expect(run.writes[0]).toEqual([LOCK, 'UPDATE PasswordResetToken', 'UPDATE User', 'DELETE FROM Session'])
      })

      it('consumeSecurityRecoveryToken', async () => {
        const { token } = await pendingRecovery()
        const hash = await hashedPassword()

        const run = await writesDuring(() => modules().resets.consumeSecurityRecoveryToken(token, hash))

        expect(run.value).toBe('completed')
        expect(run.writes).toHaveLength(1)
        expect(run.writes[0][0]).toBe(LOCK)
        expect(run.writes[0][1]).toBe('UPDATE PasswordResetToken')
      })

      // Revisión de la Fase 1: las dos emisiones que empezaban por los tokens.
      it('issuePasswordResetToken', async () => {
        const run = await writesDuring(() => modules().resets.issuePasswordResetToken(target.id))

        expect(run.writes).toEqual([[LOCK, 'DELETE FROM PasswordResetToken', 'INSERT INTO PasswordResetToken']])
      })

      it('issueEmailChangeCode', async () => {
        const run = await writesDuring(() => modules().emailChange.issueEmailChangeCode(target.id, `nueva-${target.id}@estateforge.test`))

        expect(run.writes).toEqual([[LOCK, 'DELETE FROM EmailChangeVerification', 'INSERT INTO EmailChangeVerification']])
      })

      it('un token inexistente no bloquea la cuenta ni escribe', async () => {
        const run = await writesDuring(() => modules().resets.consumePasswordResetToken('9'.repeat(64), 'hash'))

        expect(run.value).toBe(false)
        expect(run.writes).toEqual([])
      })
    })

    it.each(['consumo primero', 'emisión primero'])(
      'b. emisión de un enlace nuevo y consumo del anterior a la vez (%s): uno de los dos resultados coherentes',
      async order => {
        const account = await createUser('USER')
        const first = await issueVerification(account.id)
        const consume = () => verification().consumeEmailVerificationToken(first.token, LATER)
        const reissue = () => verification().issueEmailVerificationToken(account.id, POLICY, LATER)

        const values = await atOnce<unknown>(order === 'consumo primero' ? [consume, reissue] : [reissue, consume])
        const consumed = values[order === 'consumo primero' ? 0 : 1]
        const reissued = values[order === 'consumo primero' ? 1 : 0] as { issued: boolean; reason?: string }

        const state = await user(account.id)
        const tokens = await db().emailVerificationToken.findMany({ where: { userId: account.id }, orderBy: { createdAt: 'asc' } })
        if (consumed === 'verified') {
          // Verificó antes: la cuenta ya no necesita enlace y no se emite ninguno.
          expect(reissued).toEqual({ issued: false, reason: 'not_eligible' })
          expect(state.emailVerifiedAt).toEqual(LATER)
          expect(tokens).toHaveLength(1)
          expect(tokens[0].usedAt).toEqual(LATER)
        } else {
          // Emitió antes: el enlace anterior quedó anulado y no verifica; queda solo el nuevo.
          expect(consumed).toBe('invalid')
          expect(reissued.issued).toBe(true)
          expect(state.emailVerifiedAt).toBeNull()
          expect(tokens).toHaveLength(2)
          expect(tokens[0].usedAt).toEqual(LATER)
          expect(tokens[1].usedAt).toBeNull()
        }
      },
    )

    it('c. emitir un enlace de verificación mientras se consume un token de restablecimiento de la misma cuenta', async () => {
      const account = await createUser('USER')
      const reset = await modules().resets.issuePasswordResetToken(account.id)
      await modules().sessions.createSession(account.id)
      const hash = await hashedPassword()

      const [consumed, issued] = await atOnce<unknown>([
        () => modules().resets.consumePasswordResetToken(reset.token, hash),
        () => verification().issueEmailVerificationToken(account.id, POLICY, T0),
      ])

      // Operaciones independientes sobre la misma cuenta: las dos terminan, cada una completa.
      expect(consumed).toBe(true)
      expect(issued).toMatchObject({ issued: true, email: account.email })
      const state = await user(account.id)
      expect(state.password).toBe(hash)
      expect(await db().session.count({ where: { userId: account.id } })).toBe(0)
      expect(await db().passwordResetToken.findUnique({ where: { tokenHash: hashOf(reset.token) }, select: { usedAt: true } }))
        .toEqual({ usedAt: expect.any(Date) })
      expect(await db().emailVerificationToken.count({ where: { userId: account.id, usedAt: null } })).toBe(1)
    })

    describe('d. el mismo token consumido a la vez: un solo consumo', () => {
      it('restablecimiento de contraseña', async () => {
        const reset = await modules().resets.issuePasswordResetToken(target.id)
        const hashes = await Promise.all([hashedPassword(), hashedPassword(), hashedPassword()])

        const values = await atOnce(hashes.map(hash => () => modules().resets.consumePasswordResetToken(reset.token, hash)))

        expect(values.filter(Boolean)).toHaveLength(1)
        const winner = hashes[values.indexOf(true)]
        expect((await user(target.id)).password).toBe(winner)
      })

      it('código de cambio de email', async () => {
        const newEmail = `nueva-${target.id}@estateforge.test`
        const { code } = await modules().emailChange.issueEmailChangeCode(target.id, newEmail)

        const values = await atOnce(Array.from({ length: 3 }, () => () => modules().emailChange.consumeEmailChangeCode(target.id, code)))

        expect(values.filter(value => value.success)).toHaveLength(1)
        expect(values.filter(value => !value.success)).toEqual([{ success: false, reason: 'invalid' }, { success: false, reason: 'invalid' }])
        expect((await user(target.id)).email).toBe(newEmail)
      })

      it('denuncia de incidente: la versión sube una sola vez', async () => {
        const { token } = await modules().incidents.issueSecurityIncidentToken(target.id, 'anterior@estateforge.test')
        const before = (await user(target.id)).securityHoldVersion

        const values = await atOnce(Array.from({ length: 3 }, () => () => modules().incidents.reportSecurityIncident(token)))

        expect(values.sort()).toEqual(['invalid', 'invalid', 'reported'])
        expect((await user(target.id)).securityHoldVersion).toBe(before + 1)
      })

      it('dos denuncias a la vez con tokens distintos de la misma cuenta (el caso del interbloqueo)', async () => {
        await insertIncidentToken(target.id, '1'.repeat(64), { notifiedEmail: 'primero@estateforge.test' })
        await insertIncidentToken(target.id, '2'.repeat(64), { notifiedEmail: 'segundo@estateforge.test' })
        const before = (await user(target.id)).securityHoldVersion

        const values = await atOnce(['1', '2'].map(digit => () => modules().incidents.reportSecurityIncident(digit.repeat(64))))

        // La primera reclama la suya y borra la otra; la segunda ya no la encuentra válida.
        expect([...values].sort()).toEqual(['invalid', 'reported'])
        const state = await user(target.id)
        expect(state.securityHoldVersion).toBe(before + 1)
        expect(state.securityRecoveryEmail).toBe(values[0] === 'reported' ? 'primero@estateforge.test' : 'segundo@estateforge.test')
        expect(await db().securityIncidentToken.count({ where: { userId: target.id } })).toBe(1)
      })
    })

    it.each(['verificación primero', 'cambio primero'])(
      'e. cambio de email y verificación del email anterior a la vez (%s): termina con la dirección nueva verificada',
      async order => {
        const account = await createUser('USER')
        const issued = await issueVerification(account.id)
        const newEmail = `nueva-${account.id}@estateforge.test`
        const { code } = await modules().emailChange.issueEmailChangeCode(account.id, newEmail)
        const verify = () => verification().consumeEmailVerificationToken(issued.token, AT)
        const change = () => modules().emailChange.consumeEmailChangeCode(account.id, code)

        const values = await atOnce<unknown>(order === 'verificación primero' ? [verify, change] : [change, verify])
        const verified = values[order === 'verificación primero' ? 0 : 1]
        const changed = values[order === 'verificación primero' ? 1 : 0]

        // Los dos órdenes posibles: verificó la dirección anterior y después cambió (D1 la deja
        // verificada), o cambió primero y el enlace de la dirección anterior ya no sirve.
        expect(['verified', 'invalid']).toContain(verified)
        expect(changed).toMatchObject({ success: true, email: newEmail, oldEmail: account.email })
        const state = await user(account.id)
        expect(state.email).toBe(newEmail)
        expect(state.emailVerifiedAt).not.toBeNull()
        expect(await db().emailVerificationToken.count({ where: { userId: account.id, usedAt: null } })).toBe(0)
        expect(await db().emailChangeVerification.count({ where: { userId: account.id } })).toBe(0)
      },
    )

    it.each(['consumo primero', 'emisión primero'])(
      'g. restablecimiento: consumo del token y emisión de uno nuevo a la vez (%s), un solo token pendiente',
      async order => {
        const first = await modules().resets.issuePasswordResetToken(target.id)
        const before = await user(target.id)
        const hash = await hashedPassword()
        const consume = () => modules().resets.consumePasswordResetToken(first.token, hash)
        const reissue = () => modules().resets.issuePasswordResetToken(target.id)

        const values = await atOnce<unknown>(order === 'consumo primero' ? [consume, reissue] : [reissue, consume])
        const consumed = values[order === 'consumo primero' ? 0 : 1]

        expect((await user(target.id)).password).toBe(consumed === true ? hash : before.password)
        expect(await db().passwordResetToken.count({ where: { userId: target.id, usedAt: null } })).toBe(1)
      },
    )

    it.each(['consumo primero', 'emisión primero'])(
      'h. cambio de email: confirmación del código y emisión de uno nuevo a la vez (%s), sin estados parciales',
      async order => {
        const newEmail = `nueva-${target.id}@estateforge.test`
        const { code } = await modules().emailChange.issueEmailChangeCode(target.id, newEmail)
        const before = await user(target.id)
        const consume = () => modules().emailChange.consumeEmailChangeCode(target.id, code)
        const reissue = () => modules().emailChange.issueEmailChangeCode(target.id, `otra-${target.id}@estateforge.test`)

        const values = await atOnce<unknown>(order === 'consumo primero' ? [consume, reissue] : [reissue, consume])
        const consumed = values[order === 'consumo primero' ? 0 : 1] as { success: boolean }

        expect((await user(target.id)).email).toBe(consumed.success ? newEmail : before.email)
        expect(await db().emailChangeVerification.count({ where: { userId: target.id, usedAt: null } })).toBe(1)
      },
    )

    describe('f. E2 a la vez que otros consumos', () => {
      it('completar la recuperación obligatoria y consumir un enlace de verificación anterior', async () => {
        const { token, destination } = await pendingRecovery()
        // Enlace de verificación pendiente de antes de la recuperación (insertado: en E2 no se emiten).
        const verifyToken = '7'.repeat(64)
        const current = await user(target.id)
        await db().emailVerificationToken.create({
          data: { userId: target.id, tokenHash: hashOf(verifyToken), email: current.email, expiresAt: new Date(Date.now() + 60_000) },
        })
        const hash = await hashedPassword()

        const [recovered, verified] = await atOnce<unknown>([
          () => modules().resets.consumeSecurityRecoveryToken(token, hash),
          () => verification().consumeEmailVerificationToken(verifyToken),
        ])

        // Con la recuperación pendiente no se verifica; al completarla, el enlace queda anulado (D2).
        expect(recovered).toBe('completed')
        expect(verified).toBe('invalid')
        const state = await user(target.id)
        expect(state).toMatchObject({ email: destination, password: hash, passwordResetRequiredAt: null, securityRecoveryEmail: null, emailVerifiedAt: null })
        expect(await db().emailVerificationToken.count({ where: { userId: target.id, usedAt: null } })).toBe(0)
      })

      it('una denuncia de incidente a la vez que un restablecimiento de contraseña', async () => {
        const reset = await modules().resets.issuePasswordResetToken(target.id)
        const { token } = await modules().incidents.issueSecurityIncidentToken(target.id, 'anterior@estateforge.test')
        const before = await user(target.id)
        const hash = await hashedPassword()

        const [consumed, reported] = await atOnce<unknown>([
          () => modules().resets.consumePasswordResetToken(reset.token, hash),
          () => modules().incidents.reportSecurityIncident(token),
        ])

        // La denuncia siempre gana la protección; el restablecimiento solo vale si fue antes.
        expect(reported).toBe('reported')
        const state = await user(target.id)
        expect(state.securityHoldAt).not.toBeNull()
        expect(state.securityHoldVersion).toBe(before.securityHoldVersion + 1)
        expect(state.password).toBe(consumed ? hash : before.password)
        expect(await db().passwordResetToken.count({ where: { userId: target.id, usedAt: null } })).toBe(0)
        expect(await db().session.count({ where: { userId: target.id } })).toBe(0)
      })

      it('dos consumos a la vez del mismo enlace de recuperación obligatoria: uno completa', async () => {
        const { token } = await pendingRecovery()
        const hashes = await Promise.all([hashedPassword(), hashedPassword()])

        const values = await atOnce(hashes.map(hash => () => modules().resets.consumeSecurityRecoveryToken(token, hash)))

        expect([...values].sort()).toEqual(['completed', 'invalid_token'])
        expect((await user(target.id)).password).toBe(hashes[values.indexOf('completed')])
        expect(await db().adminAuditLog.count({ where: { action: 'SECURITY_RECOVERY_COMPLETED' } })).toBe(1)
      })
    })
  })
})
