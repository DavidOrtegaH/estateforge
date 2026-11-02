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

const API_DIR = fileURLToPath(new URL('../../', import.meta.url))
const MIGRATIONS_DIR = join(API_DIR, 'prisma', 'migrations')
const PROJECT_DATABASES = [resolve(API_DIR, 'dev.db'), resolve(API_DIR, 'test.db')]
const HOLD_CHANGED_MESSAGE = 'La protección por incidente ha cambiado durante la operación. Revisa la cuenta antes de volver a intentarlo.'

type PrismaModule = typeof import('../db/prisma.js')
type IncidentModule = typeof import('../services/security-incident.service.js')
type SessionModule = typeof import('../services/session.service.js')
type AdminRoutesModule = typeof import('../routes/admin.routes.js')

let tempDir: string | undefined
let databasePath: string
let loaded: {
  prisma: PrismaModule['prisma']
  incidents: IncidentModule
  sessions: SessionModule
  adminRoutes: AdminRoutesModule['adminRoutes']
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

  async function reportNewIncident(userId: string) {
    const { incidents } = modules()
    const { token } = await incidents.issueSecurityIncidentToken(userId)
    return { token, result: await incidents.reportSecurityIncident(token) }
  }

  function resolveHold(userId: string, reason = 'Incidente revisado con el titular') {
    return server().inject({
      method: 'POST',
      url: `/api/admin/users/${userId}/resolve-security-hold`,
      headers: { cookie: ownerCookie },
      payload: { reason },
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

    const response = await resolveHold(legacy.id)

    expect(response.statusCode).toBe(200)
    expect(await holdState(legacy.id)).toEqual({ securityHoldAt: null, securityHoldVersion: 0 })
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
    })

    it('b. si falla una operación posterior al incremento, el informe se deshace por completo', async () => {
      const database = db()
      const { incidents, sessions } = modules()
      const userSession = await sessions.createSession(target.id)
      const { token } = await incidents.issueSecurityIncidentToken(target.id)

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
      const tokens = await database.securityIncidentToken.findMany({ where: { userId: target.id }, select: { usedAt: true } })
      expect(tokens).toEqual([{ usedAt: null }])
      expect(await database.session.count({ where: { userId: target.id } })).toBe(1)
      expect(userSession.token).toMatch(/^[a-f0-9]{64}$/)

      // Con el trigger retirado, el mismo token sigue siendo válido.
      expect(await incidents.reportSecurityIncident(token)).toBe('reported')
      expect((await holdState(target.id)).securityHoldVersion).toBe(1)
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
      expect(JSON.parse(logs[0].metadata!)).toEqual({ actorEmail: owner.email, targetEmail: target.email })
    })
  })
})
