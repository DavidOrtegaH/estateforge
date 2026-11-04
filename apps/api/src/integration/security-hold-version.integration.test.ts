import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import { createClient } from '@libsql/client'
import Fastify, { type FastifyInstance } from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// INTEGRACIÓN CON SQLITE REAL (V4)
// ============================================================
//
// Base SQLite temporal en el directorio temporal del sistema, con las
// migraciones reales del proyecto. No usa dev.db ni test.db. Prisma se
// importa después de fijar DATABASE_URL, porque db/prisma.ts lee la
// variable al cargarse. Todo se ejecuta con un solo PrismaClient: el
// caso de retirada obsoleta prueba una intercalación real entre lectura
// y escritura, no concurrencia entre procesos.

// Dos cambios sobre el adaptador real, solo en este fichero:
//
// 1. Sustituto mínimo de client.transaction(). @libsql/client 0.17 entrega a cada
//    transacción interactiva una conexión nativa que su Sqlite3Transaction nunca
//    cierra, y Prisma retiene las transacciones cerradas; en Windows eso impide
//    borrar la base temporal. Aquí cada transacción usa una conexión SQLite
//    dedicada sobre el mismo fichero, con BEGIN/COMMIT/ROLLBACK reales en esa
//    conexión, y la conexión se cierra siempre en un finally. No se prueba el
//    ciclo de vida de Sqlite3Transaction de libsql.
// 2. Gancho de intercalación. El cliente de Prisma 7 es un Proxy y vi.spyOn sobre
//    $transaction no intercepta sus llamadas, así que se envuelve startTransaction:
//    la siguiente transacción que se inicie ejecuta antes el gancho, que se
//    desactiva en ese momento para que sus propias transacciones sigan el camino normal.
const transactions = vi.hoisted(() => ({
  beforeNext: null as null | (() => Promise<void>),
  started: 0,
  openConnections: 0,
  log: [] as string[],
}))

vi.mock('@prisma/adapter-libsql', async importOriginal => {
  const actual = await importOriginal<typeof import('@prisma/adapter-libsql')>()
  const libsql = await import('@libsql/client')
  type Config = Parameters<typeof libsql.createClient>[0]
  type Client = ReturnType<typeof libsql.createClient>
  type Statement = Parameters<Client['execute']>[0]

  function open(connection: Client | null): Client {
    if (!connection) throw new Error('La conexión SQLite del test ya está cerrada')
    return connection
  }

  // El close() nativo de libsql 0.5 no suelta el fichero hasta que el recolector
  // recoge la conexión, y Prisma conserva las transacciones cerradas. Por eso, al
  // cerrar, se suelta también la referencia: la limpieza puede recogerla.
  async function dedicatedTransaction(config: Config, mode: string) {
    let connection: Client | null = libsql.createClient(config)
    transactions.openConnections += 1
    let finished = false
    const release = () => {
      try {
        open(connection).close()
      } finally {
        connection = null
        transactions.openConnections -= 1
      }
    }
    const finish = (statement: 'COMMIT' | 'ROLLBACK') => async () => {
      if (finished) return
      finished = true
      transactions.log.push(statement)
      try {
        await open(connection).execute(statement)
      } finally {
        release()
      }
    }

    const begin = `BEGIN ${mode.toUpperCase()}`
    try {
      await open(connection).execute(begin)
    } catch (error) {
      finished = true
      release()
      throw error
    }
    transactions.log.push(begin)

    // Solo lo que usa la transacción del adaptador: execute, commit y rollback.
    return {
      execute: async (statement: Statement) => {
        try {
          return await open(connection).execute(statement)
        } catch (error) {
          // V8 guarda la pila de un error sin formatear y, con ella, el `this` de cada
          // marco: el error de SQLite retendría la conexión aunque ya esté cerrada.
          // Leer `stack` la formatea y suelta esas referencias; el error no cambia.
          void (error as Error).stack
          void ((error as Error).cause as Error | undefined)?.stack
          throw error
        }
      },
      commit: finish('COMMIT'),
      rollback: finish('ROLLBACK'),
      close: finish('ROLLBACK'),
      get closed() {
        return finished
      },
    }
  }

  class HookedPrismaLibSql extends actual.PrismaLibSql {
    // Cliente principal del adaptador: las consultas fuera de transacción van a la
    // conexión real; al cerrarlo ($disconnect) se suelta la referencia, como arriba.
    override createClient(config: Config) {
      let inner: Client | null = super.createClient(config)
      const client = {
        execute: (statement: Statement) => open(inner).execute(statement),
        executeMultiple: (sql: string) => open(inner).executeMultiple(sql),
        transaction: (mode = 'write') => dedicatedTransaction(config, mode),
        close: () => {
          try {
            inner?.close()
          } finally {
            inner = null
          }
        },
        get closed() {
          return inner === null
        },
      }
      return client as unknown as Client
    }

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
        return startTransaction(...args)
      }
      return adapter
    }
  }
  return { ...actual, PrismaLibSql: HookedPrismaLibSql }
})

// Doble del envío de la recuperación obligatoria (E2.4): guarda cada llamada con el
// registro de transacciones en ese momento, para comprobar que llega tras el COMMIT.
const mail = vi.hoisted(() => ({
  calls: [] as { args: { to: string; recoveryUrl: string; expiresAt: Date }; transactionLog: string[] }[],
  fail: false,
  // Envíos de autoservicio de forgot-password (E2.5).
  resetCalls: [] as { to: string; resetUrl: string }[],
}))

vi.mock('../services/email.service.js', () => ({
  emailService: {
    sendSecurityRecoveryEmail: async (args: { to: string; recoveryUrl: string; expiresAt: Date }) => {
      mail.calls.push({ args, transactionLog: [...transactions.log] })
      if (mail.fail) throw new Error('Fallo SMTP simulado')
    },
    sendPasswordResetEmail: async (args: { to: string; resetUrl: string }) => {
      mail.resetCalls.push({ to: args.to, resetUrl: args.resetUrl })
    },
  },
}))

const API_DIR = fileURLToPath(new URL('../../', import.meta.url))
const MIGRATIONS_DIR = join(API_DIR, 'prisma', 'migrations')
const PROJECT_DATABASES = [resolve(API_DIR, 'dev.db'), resolve(API_DIR, 'test.db')]
const HOLD_CHANGED_MESSAGE = 'La protección por incidente ha cambiado durante la operación. Revisa la cuenta antes de volver a intentarlo.'

type PrismaModule = typeof import('../db/prisma.js')
type IncidentModule = typeof import('../services/security-incident.service.js')
type SessionModule = typeof import('../services/session.service.js')
type AdminRoutesModule = typeof import('../routes/admin.routes.js')
type ResetModule = typeof import('../services/password-reset.service.js')
type PasswordModule = typeof import('../services/password.service.js')
type AuthRoutesModule = typeof import('../routes/auth.routes.js')

let tempDir: string | undefined
let databasePath: string
let loaded: {
  prisma: PrismaModule['prisma']
  incidents: IncidentModule
  sessions: SessionModule
  adminRoutes: AdminRoutesModule['adminRoutes']
  resets: ResetModule
  passwords: PasswordModule
  authRoutes: AuthRoutesModule['authRoutes']
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

function collectGarbage() {
  setFlagsFromString('--expose-gc')
  ;(runInNewContext('gc') as () => void)()
}

async function applyMigrations(url: string) {
  const client = createClient({ url })
  try {
    const folders = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort()
    for (const folder of folders) {
      await client.executeMultiple(readFileSync(join(MIGRATIONS_DIR, folder, 'migration.sql'), 'utf8'))
    }
  } finally {
    client.close()
  }
}

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'estateforge-v4-'))
  databasePath = join(tempDir, 'test.db')
  const url = `file:${databasePath.replaceAll('\\', '/')}`
  vi.stubEnv('DATABASE_URL', url)

  await applyMigrations(url)

  loaded = {
    prisma: (await import('../db/prisma.js')).prisma,
    incidents: await import('../services/security-incident.service.js'),
    sessions: await import('../services/session.service.js'),
    adminRoutes: (await import('../routes/admin.routes.js')).adminRoutes,
    resets: await import('../services/password-reset.service.js'),
    passwords: await import('../services/password.service.js'),
    authRoutes: (await import('../routes/auth.routes.js')).authRoutes,
  }
})

afterAll(async () => {
  // Primero se cierran Fastify y Prisma (Windows no deja borrar un fichero abierto)
  // y después el directorio. Los errores de limpieza no se ocultan.
  let disconnectError: unknown
  try {
    await app?.close()
    await loaded?.prisma.$disconnect()
  } catch (error) {
    disconnectError = error
  }

  app = undefined
  loaded = undefined
  vi.unstubAllEnvs()
  // Si quedara una conexión de transacción abierta, el borrado fallaría en Windows:
  // se informa expresamente para que la causa no se confunda.
  const leakedConnections = transactions.openConnections
  if (!tempDir) {
    if (disconnectError) throw disconnectError
    return
  }

  // libsql 0.5 no libera el fichero en close(): lo hace al recoger la conexión ya
  // cerrada y sin referencias. Se fuerza la recolección entre reintentos; si aun
  // así no se puede borrar, el error se informa tal cual.
  let removeError: unknown
  for (let attempt = 1; attempt <= 10 && existsSync(tempDir); attempt++) {
    try {
      await rm(tempDir, { recursive: true, force: true })
      removeError = undefined
    } catch (error) {
      removeError = error
      collectGarbage()
      await new Promise(resolveDelay => setTimeout(resolveDelay, 100))
    }
  }
  const stillExists = existsSync(tempDir)

  const problems = [
    leakedConnections !== 0 && `quedan ${leakedConnections} conexiones de transacción sin cerrar`,
    disconnectError && `no se pudo cerrar Prisma: ${String(disconnectError)}`,
    removeError && `no se pudo borrar ${tempDir}: ${String(removeError)}`,
    stillExists && `el directorio temporal sigue existiendo: ${tempDir}`,
  ].filter(Boolean)
  if (problems.length > 0) throw new Error(problems.join('\n'))
})

describe('versionado de la protección por incidente con SQLite real', () => {
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

  it('usa una base temporal fuera del proyecto', () => {
    const resolved = resolve(databasePath)
    expect(PROJECT_DATABASES).not.toContain(resolved)
    expect(resolved.startsWith(resolve(tmpdir()) + sep)).toBe(true)
    expect(process.env.DATABASE_URL).toContain('estateforge-v4-')
    expect(existsSync(resolved)).toBe(true)
  })

  it('1. un incidente incrementa la versión de 0 a 1', async () => {
    expect(await holdState(target.id)).toEqual({ securityHoldAt: null, securityHoldVersion: 0 })

    const { result } = await reportNewIncident(target.id)

    expect(result).toBe('reported')
    const state = await holdState(target.id)
    expect(state.securityHoldAt).toBeInstanceOf(Date)
    expect(state.securityHoldVersion).toBe(1)
    // El informe se ejecuta en una transacción real de la conexión dedicada.
    expect(transactions.log).toEqual(['BEGIN DEFERRED', 'COMMIT'])
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
      'BEGIN DEFERRED', 'COMMIT',
      'gancho: fin',
      'BEGIN DEFERRED', 'COMMIT',
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
      "SELECT type, \"notnull\", dflt_value FROM pragma_table_info('User') WHERE name = 'securityHoldVersion'",
    )
    expect(columns).toHaveLength(1)
    expect(columns[0].type).toBe('INTEGER')
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

      await database.$executeRawUnsafe(
        `CREATE TRIGGER "v4_fail_audit" BEFORE INSERT ON "AdminAuditLog" BEGIN SELECT RAISE(ABORT, 'fallo simulado de auditoria'); END`,
      )
      transactions.log.length = 0
      try {
        const response = await resolveHold(target.id)

        expect(response.statusCode).toBe(500)
      } finally {
        await database.$executeRawUnsafe('DROP TRIGGER IF EXISTS "v4_fail_audit"')
      }

      // La transacción de la retirada terminó con un ROLLBACK real, no con COMMIT.
      expect(transactions.log).toEqual(['BEGIN DEFERRED', 'ROLLBACK'])
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

      await database.$executeRawUnsafe(
        `CREATE TRIGGER "v4_fail_session_delete" BEFORE DELETE ON "Session" BEGIN SELECT RAISE(ABORT, 'fallo simulado al borrar sesiones'); END`,
      )
      transactions.log.length = 0
      try {
        await expect(incidents.reportSecurityIncident(token)).rejects.toThrow()
      } finally {
        await database.$executeRawUnsafe('DROP TRIGGER IF EXISTS "v4_fail_session_delete"')
      }

      // El informe terminó con un ROLLBACK real después del incremento.
      expect(transactions.log).toEqual(['BEGIN DEFERRED', 'ROLLBACK'])
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
      expect(transactions.log).toEqual(['BEGIN DEFERRED', 'COMMIT'])
      expect(mail.calls[0].transactionLog).toEqual(['BEGIN DEFERRED', 'COMMIT'])
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

      await database.$executeRawUnsafe(
        `CREATE TRIGGER "e24_fail_token" BEFORE INSERT ON "PasswordResetToken" BEGIN SELECT RAISE(ABORT, 'fallo simulado del token'); END`,
      )
      transactions.log.length = 0
      try {
        expect((await resolveHold(target.id)).statusCode).toBe(500)
      } finally {
        await database.$executeRawUnsafe('DROP TRIGGER IF EXISTS "e24_fail_token"')
      }

      expect(transactions.log).toEqual(['BEGIN DEFERRED', 'ROLLBACK'])
      expect(await accessState(target.id)).toEqual(before)
      expect(before.securityHoldAt).toBeInstanceOf(Date)
      expect(before.passwordResetRequiredAt).toBeNull()
      expect(await database.passwordResetToken.count({ where: { userId: target.id } })).toBe(0)
      expect(await database.adminAuditLog.count()).toBe(0)
      expect(mail.calls).toEqual([])
    })

    it('d. si falla el envío, la obligación, el destino y el token permanecen', async () => {
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
      expect(await recoveryTokens(target.id)).toEqual([expect.objectContaining({ usedAt: null, deliverTo: 'anterior@estateforge.test' })])
      expect(await db().adminAuditLog.count()).toBe(1)
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

      expect(transactions.log).toEqual(['BEGIN DEFERRED', 'COMMIT'])
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

      expect(transactions.log).toEqual(['BEGIN DEFERRED', 'ROLLBACK'])
      await expectUntouched(token, before)
      expect((await account(other.id)).email).toBe(destination)
    })

    it('c. destino ocupado justo antes de escribir (P2002 real): email_taken y ROLLBACK completo', async () => {
      const { token, destination } = await pendingRecovery()
      const before = await account(target.id)
      const database = db()

      // Otra cuenta ocupa el destino después de la comprobación previa y antes de la escritura.
      await database.$executeRawUnsafe(
        `CREATE TRIGGER "e25_steal_email" BEFORE UPDATE OF "email" ON "User" WHEN NEW."email" = '${destination}' BEGIN ` +
        `INSERT INTO "User" ("id", "email", "password", "updatedAt") VALUES ('intruso', NEW."email", 'x', CURRENT_TIMESTAMP); END`,
      )
      transactions.log.length = 0
      try {
        expect(await consume(token)).toBe('email_taken')
      } finally {
        await database.$executeRawUnsafe('DROP TRIGGER IF EXISTS "e25_steal_email"')
      }

      expect(transactions.log).toEqual(['BEGIN DEFERRED', 'ROLLBACK'])
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
      await database.$executeRawUnsafe(
        `CREATE TRIGGER "e25_fail_session_delete" BEFORE DELETE ON "Session" BEGIN SELECT RAISE(ABORT, 'fallo simulado al borrar sesiones'); END`,
      )
      transactions.log.length = 0
      try {
        await expect(consume(token)).rejects.toThrow()
      } finally {
        await database.$executeRawUnsafe('DROP TRIGGER IF EXISTS "e25_fail_session_delete"')
      }

      expect(transactions.log).toEqual(['BEGIN DEFERRED', 'ROLLBACK'])
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
      expect(transactions.log).toEqual(['BEGIN DEFERRED', 'COMMIT'])
      expect(mail.calls.at(-1)!.transactionLog).toEqual(['BEGIN DEFERRED', 'COMMIT'])
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
      await database.$executeRawUnsafe(
        `CREATE TRIGGER "e25f_fail_token" BEFORE INSERT ON "PasswordResetToken" BEGIN SELECT RAISE(ABORT, 'fallo simulado del token'); END`,
      )
      try {
        expect((await adminAction('recovery-destination', { recoveryEmail: 'corregido@estateforge.test' })).statusCode).toBe(500)
      } finally {
        await database.$executeRawUnsafe('DROP TRIGGER IF EXISTS "e25f_fail_token"')
      }

      expect(transactions.log).toEqual(['BEGIN DEFERRED', 'ROLLBACK'])
      expect(await account()).toEqual(before)
      expect(await pendingRecoveryTokens()).toEqual([expect.objectContaining({ tokenHash: hashOf(firstToken) })])
      expect(await database.adminAuditLog.count({ where: { action: 'SECURITY_RECOVERY_DESTINATION_CHANGED' } })).toBe(0)
      expect(mail.calls.length).toBe(mailsBefore)
      expect(await consume(firstToken)).toBe('completed')
    })

    it('j. si falla el envío, se conservan la obligación y el token, y un reenvío posterior funciona', async () => {
      await pendingRecovery()
      mail.fail = true

      const failed = await adminAction('resend-recovery', {})

      expect(failed.statusCode).toBe(200)
      expect(failed.json()).toMatchObject({ success: true, recoveryEmailSent: false })
      expect((await account()).passwordResetRequiredAt).toBeInstanceOf(Date)
      expect(await pendingRecoveryTokens()).toEqual([expect.objectContaining({ tokenHash: hashOf(lastSentToken()) })])

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
      await database.$executeRawUnsafe(
        `CREATE TRIGGER "e26_fail_audit" BEFORE INSERT ON "AdminAuditLog" BEGIN SELECT RAISE(ABORT, 'fallo simulado de auditoria'); END`,
      )
      transactions.log.length = 0
      try {
        expect((await requestLink(target.email)).json()).toEqual(GENERIC)
      } finally {
        await database.$executeRawUnsafe('DROP TRIGGER IF EXISTS "e26_fail_audit"')
      }

      expect(transactions.log).toEqual(['BEGIN DEFERRED', 'ROLLBACK'])
      expect(mail.calls.length).toBe(mailsBefore)
      expect(await pendingRecoveryTokens()).toEqual([expect.objectContaining({ tokenHash: hashOf(firstToken) })])
      expect(await consume(firstToken)).toBe('completed')
    })

    it('j. si falla el envío, el token y la obligación se conservan y otra solicitud tras el enfriamiento funciona', async () => {
      await pendingRecovery()
      await passCooldown()
      mail.fail = true

      expect((await requestLink(target.email)).json()).toEqual(GENERIC)

      const failedToken = lastSentToken()
      expect(await pendingRecoveryTokens()).toEqual([expect.objectContaining({ tokenHash: hashOf(failedToken) })])
      expect((await account()).passwordResetRequiredAt).toBeInstanceOf(Date)

      mail.fail = false
      await passCooldown()
      expect((await requestLink(target.email)).json()).toEqual(GENERIC)
      expect(lastSentToken()).not.toBe(failedToken)
      expect(await consume(lastSentToken())).toBe('completed')
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
      const columns = await db().$queryRawUnsafe<{ name: string; notnull: number | bigint }[]>('PRAGMA table_info("AdminAuditLog")')
      expect(Object.fromEntries(columns.map(column => [column.name, Number(column.notnull)]))).toEqual({
        id: 1, actorUserId: 0, targetUserId: 0, action: 1, reason: 0, metadata: 0, createdAt: 1,
      })
      const indexes = await db().$queryRawUnsafe<{ name: string; sql: string | null }[]>(
        `SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'AdminAuditLog' AND sql IS NOT NULL ORDER BY name`,
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
})
