import Fastify, { type FastifyInstance } from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// PRISMA FALSO EN MEMORIA
// ============================================================
//
// Solo implementa las operaciones que usan admin.routes.ts y
// owner.middleware.ts. Las operaciones son diferidas, como en
// Prisma: se ejecutan al hacer await o dentro de $transaction.
// $transaction restaura el estado si alguna operación falla y
// entrega al callback un cliente tx distinto de prisma.

type Role = 'USER' | 'OWNER'

interface UserRecord {
  id: string
  email: string
  role: Role
  createdAt: Date
  securityHoldAt: Date | null
  securityHoldVersion: number
  adminSuspendedAt: Date | null
  adminSuspensionReason: string | null
}

interface TokenRecord {
  id: string
  userId: string
  usedAt: Date | null
}

interface SessionRecord {
  id: string
  userId: string
  expiresAt: Date
}

interface AuditRecord {
  id: string
  actorUserId: string
  targetUserId: string | null
  action: string
  reason: string | null
  metadata: string | null
  createdAt: Date
}

interface Store {
  users: UserRecord[]
  sessions: SessionRecord[]
  passwordResetTokens: TokenRecord[]
  emailChangeVerifications: TokenRecord[]
  securityIncidentTokens: TokenRecord[]
  adminAuditLogs: AuditRecord[]
  propertyCount: number
  // Inmuebles por usuario para _count.properties.
  propertiesByUser: Record<string, number>
  generationCount: number
}

type Where = Record<string, unknown>

interface FindManyArgs {
  where?: Where
  skip?: number
  take?: number
}

type OrderBy = Record<string, 'asc' | 'desc'>[]

interface Deferred<T> extends PromiseLike<T> {
  run: () => T
}

const fake = vi.hoisted(() => {
  const state = {
    store: null as unknown as Store,
    transactionActive: false,
    // Verdadero mientras se ejecuta una operación pedida a través de tx.
    runningViaTx: false,
    // Escrituras hechas con el cliente exterior con una transacción abierta:
    // en Prisma real quedarían fuera de ella.
    writesOutsideTx: 0,
    failAuditCreate: false,
    auditFailureInsideTransaction: null as boolean | null,
    sessionTokens: new Map<string, string>(),
    // Simula otra petición que confirma un cambio entre la lectura previa
    // de la ruta y su escritura condicional.
    beforeUserUpdateMany: null as (() => void) | null,
    userUpdateManyCalls: 0,
    lastUserUpdateManyWhere: null as Where | null,
    // Últimos argumentos de paginación recibidos por los findMany.
    lastUserFindMany: null as FindManyArgs | null,
    lastAuditFindMany: null as FindManyArgs | null,
    lastAuditCount: null as { where?: Where } | null,
    userFindManyCalls: 0,
    // Se ejecuta antes de cada user.findUnique con el id buscado.
    beforeUserFindUnique: null as ((id: string) => void) | null,
  }

  // Ordena por createdAt desc y aplica skip/take, como hacen las rutas.
  // Sin skip/take (búsqueda de emails de la auditoría) no pagina.
  function page<T extends { createdAt: Date }>(rows: T[], args: FindManyArgs): T[] {
    const sorted = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    if (args.skip === undefined || args.take === undefined) return sorted
    return sorted.slice(args.skip, args.skip + args.take)
  }

  // Aplica un orderBy de Prisma en forma de array, con desempate por cada clave
  // en orden. Compara texto por código, como la colación binaria de SQLite.
  function sortBy<T>(rows: T[], orderBy: OrderBy): T[] {
    return [...rows].sort((a, b) => {
      for (const clause of orderBy) {
        const [key, direction] = Object.entries(clause)[0]
        const left = (a as Record<string, unknown>)[key]
        const right = (b as Record<string, unknown>)[key]
        const diff = left instanceof Date && right instanceof Date
          ? left.getTime() - right.getTime()
          : String(left) < String(right) ? -1 : String(left) > String(right) ? 1 : 0
        if (diff !== 0) return direction === 'desc' ? -diff : diff
      }
      return 0
    })
  }

  function deferred<T>(fn: () => T): Deferred<T> {
    return {
      run: fn,
      then(onFulfilled, onRejected) {
        return Promise.resolve()
          .then(fn)
          .then(onFulfilled, onRejected)
      },
    }
  }

  function matches(record: object, where: Where | undefined): boolean {
    if (!where) return true

    return Object.entries(where).every(([key, expected]) => {
      const value = (record as Record<string, unknown>)[key]

      if (
        typeof expected === 'object' &&
        expected !== null &&
        !(expected instanceof Date)
      ) {
        if ('not' in expected && expected.not === null && Object.keys(expected).length === 1) {
          return value !== null
        }

        if ('contains' in expected && typeof expected.contains === 'string' && Object.keys(expected).length === 1) {
          return typeof value === 'string' && value.includes(expected.contains)
        }

        if ('in' in expected && Array.isArray(expected.in) && Object.keys(expected).length === 1) {
          return expected.in.includes(value)
        }

        if ('gt' in expected && expected.gt instanceof Date && Object.keys(expected).length === 1) {
          return value instanceof Date && value.getTime() > expected.gt.getTime()
        }

        throw new Error(`Filtro no soportado por el falso: ${key}`)
      }

      // Prisma compara las fechas por valor (texto ISO con milisegundos), no por referencia.
      if (expected instanceof Date) {
        return value instanceof Date && value.getTime() === expected.getTime()
      }

      return value === expected
    })
  }

  function recordWrite() {
    if (state.transactionActive && !state.runningViaTx) state.writesOutsideTx += 1
  }

  // Cliente que recibe el callback de $transaction: las mismas operaciones
  // que prisma, marcadas como parte de la transacción simulada.
  function transactionClient(client: object) {
    return Object.fromEntries(
      Object.entries(client)
        .filter(([model]) => !model.startsWith('$'))
        .map(([model, methods]) => [
          model,
          Object.fromEntries(
            Object.entries(methods as Record<string, (args: unknown) => Deferred<unknown>>).map(([name, method]) => [
              name,
              (args: unknown) => {
                const operation = method(args)
                return deferred(() => {
                  state.runningViaTx = true
                  try {
                    return operation.run()
                  } finally {
                    state.runningViaTx = false
                  }
                })
              },
            ]),
          ),
        ]),
    )
  }

  function deleteMany(
    table: 'sessions' | 'passwordResetTokens' | 'emailChangeVerifications',
    args: { where: Where },
  ) {
    return deferred(() => {
      recordWrite()
      const tables = state.store as unknown as Record<typeof table, object[]>
      const rows = tables[table]
      const kept = rows.filter(row => !matches(row, args.where))
      tables[table] = kept
      return { count: rows.length - kept.length }
    })
  }

  const prisma = {
    user: {
      // _count solo admite properties y sessions (con where opcional), como el detalle de cuenta.
      findUnique(args: { where: { id: string }; select?: Record<string, unknown> }) {
        const countSelect = args.select?._count as { select: Record<string, unknown> } | undefined
        if (countSelect) {
          const unsupported = Object.keys(countSelect.select).filter(key => key !== 'properties' && key !== 'sessions')
          if (unsupported.length > 0) throw new Error(`_count no soportado por el falso: ${unsupported.join(', ')}`)
        }

        return deferred(() => {
          state.beforeUserFindUnique?.(args.where.id)
          const user = state.store.users.find(item => item.id === args.where.id)
          if (!user) return null
          if (!countSelect) return { ...user }

          const sessionsArg = countSelect.select.sessions
          const sessionWhere = typeof sessionsArg === 'object' && sessionsArg !== null
            ? (sessionsArg as { where?: Where }).where
            : undefined
          return {
            ...user,
            _count: {
              properties: state.store.propertiesByUser[user.id] ?? 0,
              sessions: state.store.sessions.filter(session => session.userId === user.id && matches(session, sessionWhere)).length,
            },
          }
        })
      },

      count(args?: { where?: Where }) {
        return deferred(() =>
          state.store.users.filter(user => matches(user, args?.where)).length,
        )
      },

      // El recuento de inmuebles por usuario no se modela: se devuelve 0.
      findMany(args: FindManyArgs) {
        return deferred(() => {
          state.userFindManyCalls += 1
          state.lastUserFindMany = { where: args.where, skip: args.skip, take: args.take }
          const users = state.store.users.filter(user => matches(user, args.where))
          return page(users, args).map(user => ({ ...user, _count: { properties: 0 } }))
        })
      },

      updateMany(args: { where: Where; data: Partial<UserRecord> }) {
        return deferred(() => {
          recordWrite()
          state.userUpdateManyCalls += 1
          state.lastUserUpdateManyWhere = args.where
          state.beforeUserUpdateMany?.()
          const users = state.store.users.filter(user => matches(user, args.where))
          for (const user of users) Object.assign(user, args.data)
          return { count: users.length }
        })
      },
    },

    property: {
      count: () => deferred(() => state.store.propertyCount),
    },

    generation: {
      count: () => deferred(() => state.store.generationCount),
    },

    session: {
      deleteMany: (args: { where: Where }) => deleteMany('sessions', args),
    },

    passwordResetToken: {
      deleteMany: (args: { where: Where }) => deleteMany('passwordResetTokens', args),
    },

    emailChangeVerification: {
      deleteMany: (args: { where: Where }) => deleteMany('emailChangeVerifications', args),
    },

    adminAuditLog: {
      count: (args?: { where?: Where }) =>
        deferred(() => {
          state.lastAuditCount = { where: args?.where }
          return state.store.adminAuditLogs.filter(log => matches(log, args?.where)).length
        }),

      // Sin orderBy el orden real no está definido: se exige, como hace la ruta.
      findMany(args: FindManyArgs & { orderBy?: OrderBy }) {
        if (!args.orderBy) throw new Error('adminAuditLog.findMany sin orderBy no soportado por el falso')
        const orderBy = args.orderBy
        return deferred(() => {
          state.lastAuditFindMany = { where: args.where, skip: args.skip, take: args.take }
          const sorted = sortBy(state.store.adminAuditLogs.filter(log => matches(log, args.where)), orderBy)
          return args.skip === undefined || args.take === undefined ? sorted : sorted.slice(args.skip, args.skip + args.take)
        })
      },

      create(args: { data: Omit<AuditRecord, 'id' | 'createdAt' | 'metadata' | 'reason' | 'targetUserId'> & Partial<AuditRecord> }) {
        return deferred(() => {
          recordWrite()
          if (state.failAuditCreate) {
            state.auditFailureInsideTransaction = state.transactionActive && state.runningViaTx
            throw new Error('Fallo simulado al escribir la auditoría')
          }

          const record: AuditRecord = {
            id: `audit-${state.store.adminAuditLogs.length + 1}`,
            actorUserId: args.data.actorUserId,
            targetUserId: args.data.targetUserId ?? null,
            action: args.data.action,
            reason: args.data.reason ?? null,
            metadata: args.data.metadata ?? null,
            createdAt: new Date(),
          }

          state.store.adminAuditLogs.push(record)
          return record
        })
      },
    },

    // admin.routes.ts solo usa la forma callback interactiva.
    async $transaction(
      operations: (tx: unknown) => Promise<unknown>,
    ) {
      const snapshot = structuredClone(state.store)
      state.transactionActive = true

      try {
        return await operations(transactionClient(prisma))
      } catch (error) {
        state.store = snapshot
        throw error
      } finally {
        state.transactionActive = false
      }
    },
  }

  return { state, prisma }
})

vi.mock('../db/prisma.js', () => ({ prisma: fake.prisma }))

// Solo se simula la resolución del token de sesión. La lectura de la
// cookie, requireAuth y requireOwner son los reales.
vi.mock('../services/session.service.js', () => ({
  getUserIdFromSession: vi.fn(async (token: string) =>
    fake.state.sessionTokens.get(token) ?? null,
  ),
}))

import { adminRoutes } from './admin.routes.js'

// ============================================================
// DATOS DE PRUEBA
// ============================================================

const OWNER = 'owner-1'
const OTHER_OWNER = 'owner-2'
const HELD_OWNER = 'owner-held'
const USER = 'user-1'
const TARGET = 'target-1'

const HOLD_DATE = new Date('2026-10-01T10:00:00.000Z')
const SUSPENSION_DATE = new Date('2026-10-02T10:00:00.000Z')
const USED_DATE = new Date('2026-09-01T10:00:00.000Z')
// Muy en el futuro: las sesiones de la semilla siguen activas al ejecutar los tests.
const SESSION_EXPIRY = new Date('2999-01-01T00:00:00.000Z')

function emailOf(id: string) {
  return `${id}@estateforge.test`
}

function user(id: string, role: Role, extra: Partial<UserRecord> = {}): UserRecord {
  return {
    id,
    email: emailOf(id),
    role,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    securityHoldAt: null,
    // Valor por defecto de la migración: también el de las cuentas protegidas antes de ella.
    securityHoldVersion: 0,
    adminSuspendedAt: null,
    adminSuspensionReason: null,
    ...extra,
  }
}

function seed(): Store {
  return {
    users: [
      user(OWNER, 'OWNER'),
      user(OTHER_OWNER, 'OWNER'),
      user(HELD_OWNER, 'OWNER', { securityHoldAt: HOLD_DATE }),
      user(USER, 'USER'),
      user(TARGET, 'USER'),
    ],
    sessions: [
      { id: 's-target-1', userId: TARGET, expiresAt: SESSION_EXPIRY },
      { id: 's-target-2', userId: TARGET, expiresAt: SESSION_EXPIRY },
      { id: 's-user-1', userId: USER, expiresAt: SESSION_EXPIRY },
    ],
    passwordResetTokens: [
      { id: 'prt-target-pending', userId: TARGET, usedAt: null },
      { id: 'prt-target-used', userId: TARGET, usedAt: USED_DATE },
      { id: 'prt-user', userId: USER, usedAt: null },
    ],
    emailChangeVerifications: [
      { id: 'ecv-target-pending', userId: TARGET, usedAt: null },
      { id: 'ecv-target-used', userId: TARGET, usedAt: USED_DATE },
      { id: 'ecv-user', userId: USER, usedAt: null },
    ],
    securityIncidentTokens: [
      { id: 'sit-target', userId: TARGET, usedAt: null },
    ],
    adminAuditLogs: [],
    propertyCount: 4,
    propertiesByUser: { [TARGET]: 3, [USER]: 1 },
    generationCount: 7,
  }
}

function store(): Store {
  return fake.state.store
}

function findUser(id: string): UserRecord {
  const found = store().users.find(item => item.id === id)
  if (!found) throw new Error(`Usuario de prueba no encontrado: ${id}`)
  return found
}

function idsOf(rows: { id: string; userId: string }[], userId: string): string[] {
  return rows.filter(row => row.userId === userId).map(row => row.id).sort()
}

const cookieFor = (token: string) => ({ cookie: `estateforge_session=${token}` })
const asOwner = cookieFor('owner-token')

type ActionRoute = 'suspend' | 'unsuspend' | 'revoke-sessions' | 'resolve-security-hold'
const ACTIONS: ActionRoute[] = ['suspend', 'unsuspend', 'revoke-sessions', 'resolve-security-hold']

const ALL_ROUTES = [
  { method: 'GET' as const, url: '/api/admin/overview' },
  { method: 'GET' as const, url: '/api/admin/users' },
  { method: 'GET' as const, url: `/api/admin/users/${TARGET}` },
  { method: 'GET' as const, url: '/api/admin/audit' },
  ...ACTIONS.map(action => ({
    method: 'POST' as const,
    url: `/api/admin/users/${TARGET}/${action}`,
    payload: { reason: 'Motivo válido' },
  })),
]

// ============================================================
// TESTS
// ============================================================

describe('Admin routes', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    fake.state.store = seed()
    fake.state.transactionActive = false
    fake.state.runningViaTx = false
    fake.state.writesOutsideTx = 0
    fake.state.failAuditCreate = false
    fake.state.auditFailureInsideTransaction = null
    fake.state.beforeUserUpdateMany = null
    fake.state.userUpdateManyCalls = 0
    fake.state.lastUserUpdateManyWhere = null
    fake.state.lastUserFindMany = null
    fake.state.userFindManyCalls = 0
    fake.state.beforeUserFindUnique = null
    fake.state.lastAuditFindMany = null
    fake.state.lastAuditCount = null
    fake.state.sessionTokens = new Map([
      ['owner-token', OWNER],
      ['user-token', USER],
      ['held-owner-token', HELD_OWNER],
    ])

    app = Fastify()
    app.decorateRequest('userId', null)
    // Igual que en app.ts: el límite solo aplica a rutas con config.rateLimit.
    await app.register(rateLimit, { global: false })
    await app.register(adminRoutes)
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
    // Ninguna escritura dentro de una transacción puede hacerse con el cliente exterior.
    expect(fake.state.writesOutsideTx).toBe(0)
  })

  function action(route: ActionRoute, targetId: string, payload?: unknown, headers = asOwner) {
    return app.inject({
      method: 'POST',
      url: `/api/admin/users/${targetId}/${route}`,
      headers,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    })
  }

  // ----------------------------------------------------------
  // AUTORIZACIÓN
  // ----------------------------------------------------------

  describe('autorización', () => {
    it.each(ALL_ROUTES)('$method $url sin cookie devuelve 401', async route => {
      const before = structuredClone(store())

      const response = await app.inject(route)

      expect(response.statusCode).toBe(401)
      expect(response.json()).toEqual({ message: 'Se requiere una sesión activa.' })
      expect(store()).toEqual(before)
    })

    it.each(ALL_ROUTES)('$method $url con un token de sesión desconocido devuelve 401', async route => {
      const before = structuredClone(store())

      const response = await app.inject({ ...route, headers: cookieFor('token-desconocido') })

      expect(response.statusCode).toBe(401)
      expect(response.json()).toEqual({ message: 'Se requiere una sesión activa.' })
      expect(store()).toEqual(before)
    })

    it.each(ALL_ROUTES)('$method $url con rol USER devuelve 403', async route => {
      const before = structuredClone(store())

      const response = await app.inject({ ...route, headers: cookieFor('user-token') })

      expect(response.statusCode).toBe(403)
      expect(response.json()).toEqual({ message: 'No tienes permisos para acceder a esta sección.' })
      expect(store()).toEqual(before)
    })

    // Prueba aislada de requireOwner: se simula una sesión válida.
    // En producción getUserIdFromSession ya rechazaría esta sesión (401).
    it.each(ALL_ROUTES)('$method $url con OWNER bajo securityHoldAt devuelve 403 (requireOwner)', async route => {
      const before = structuredClone(store())

      const response = await app.inject({ ...route, headers: cookieFor('held-owner-token') })

      expect(response.statusCode).toBe(403)
      expect(response.json()).toEqual({ message: 'No tienes permisos para acceder a esta sección.' })
      expect(store()).toEqual(before)
    })
  })

  // ----------------------------------------------------------
  // VALIDACIÓN Y PROTECCIONES
  // ----------------------------------------------------------

  describe('validación del motivo', () => {
    const invalidReasons: [string, unknown][] = [
      ['menos de 3 caracteres', { reason: 'ab' }],
      ['menos de 3 caracteres tras recortar espacios', { reason: '   ab   ' }],
      ['más de 500 caracteres', { reason: 'a'.repeat(501) }],
      ['sin motivo', {}],
      ['sin body', undefined],
    ]

    for (const route of ACTIONS) {
      it.each(invalidReasons)(`${route}: rechaza un motivo con %s (400)`, async (_label, payload) => {
        if (route === 'unsuspend') {
          findUser(TARGET).adminSuspendedAt = SUSPENSION_DATE
        }
        const before = structuredClone(store())

        const response = await action(route, TARGET, payload)

        expect(response.statusCode).toBe(400)
        expect(response.json()).toEqual({ message: 'Indica un motivo de entre 3 y 500 caracteres.' })
        expect(store()).toEqual(before)
      })
    }

    it.each([
      ['exactamente 3 caracteres', 'abc'],
      ['exactamente 500 caracteres', 'a'.repeat(500)],
    ])('suspend acepta un motivo de %s', async (_label, reason) => {
      const response = await action('suspend', TARGET, { reason })

      expect(response.statusCode).toBe(200)
      expect(findUser(TARGET).adminSuspensionReason).toBe(reason)
    })
  })

  describe('protecciones sobre la cuenta objetivo', () => {
    it.each([
      ['suspend', 'No puedes suspender tu propia cuenta.'],
      ['unsuspend', 'No puedes modificar tu propia cuenta desde esta acción.'],
      ['revoke-sessions', 'No puedes cerrar tus propias sesiones desde esta acción.'],
      ['resolve-security-hold', 'No puedes modificar tu propia cuenta desde esta acción.'],
    ] as const)('%s sobre la propia cuenta devuelve 400', async (route, message) => {
      const before = structuredClone(store())

      const response = await action(route, OWNER, { reason: 'Motivo válido' })

      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ message })
      expect(store()).toEqual(before)
    })

    it.each([
      ['suspend', 'No se pueden suspender cuentas propietarias.'],
      ['unsuspend', 'No se pueden modificar cuentas propietarias.'],
      ['revoke-sessions', 'No se pueden cerrar sesiones de otra cuenta propietaria desde este panel.'],
      ['resolve-security-hold', 'No se pueden modificar cuentas propietarias.'],
    ] as const)('%s sobre otra cuenta OWNER devuelve 403', async (route, message) => {
      if (route === 'unsuspend') {
        findUser(OTHER_OWNER).adminSuspendedAt = SUSPENSION_DATE
      }
      if (route === 'resolve-security-hold') {
        // Con la protección activa, el 403 se debe al rol y no a la falta de protección.
        findUser(OTHER_OWNER).securityHoldAt = HOLD_DATE
      }
      const before = structuredClone(store())

      const response = await action(route, OTHER_OWNER, { reason: 'Motivo válido' })

      expect(response.statusCode).toBe(403)
      expect(response.json()).toEqual({ message })
      expect(store()).toEqual(before)
    })

    it.each(ACTIONS)('%s sobre una cuenta inexistente devuelve 404', async route => {
      const before = structuredClone(store())

      const response = await action(route, 'no-existe', { reason: 'Motivo válido' })

      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ message: 'No se ha encontrado la cuenta.' })
      expect(store()).toEqual(before)
    })
  })

  // ----------------------------------------------------------
  // SUSPENSIÓN
  // ----------------------------------------------------------

  describe('suspend', () => {
    it('suspende la cuenta, invalida sesiones y tokens pendientes y registra auditoría', async () => {
      const response = await action('suspend', TARGET, { reason: '  Spam reiterado  ' })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ success: true, message: 'Cuenta suspendida y sesiones cerradas.' })
      expect(fake.state.userUpdateManyCalls).toBe(1)

      const target = findUser(TARGET)
      expect(target.adminSuspendedAt).toBeInstanceOf(Date)
      expect(target.adminSuspensionReason).toBe('Spam reiterado')

      // Sesiones: se eliminan las del objetivo y se conservan las ajenas.
      expect(idsOf(store().sessions, TARGET)).toEqual([])
      expect(idsOf(store().sessions, USER)).toEqual(['s-user-1'])

      // Tokens de recuperación: se eliminan todos los del objetivo.
      expect(idsOf(store().passwordResetTokens, TARGET)).toEqual([])
      expect(idsOf(store().passwordResetTokens, USER)).toEqual(['prt-user'])

      // Cambios de email: solo se eliminan los pendientes.
      expect(idsOf(store().emailChangeVerifications, TARGET)).toEqual(['ecv-target-used'])
      expect(idsOf(store().emailChangeVerifications, USER)).toEqual(['ecv-user'])

      expect(store().adminAuditLogs).toEqual([
        expect.objectContaining({
          actorUserId: OWNER,
          targetUserId: TARGET,
          action: 'ACCOUNT_SUSPENDED',
          reason: 'Spam reiterado',
          metadata: JSON.stringify({ actorEmail: emailOf(OWNER), targetEmail: emailOf(TARGET) }),
        }),
      ])
    })

    it('omite el email del operador en metadata si ya no se encuentra, sin cambiar la acción', async () => {
      // Primera búsqueda: requireOwner. Segunda: la instantánea del operador.
      let ownerLookups = 0
      fake.state.beforeUserFindUnique = id => {
        if (id === OWNER && ++ownerLookups === 2) {
          store().users = store().users.filter(item => item.id !== OWNER)
        }
      }

      const response = await action('suspend', TARGET, { reason: 'Motivo válido' })

      expect(response.statusCode).toBe(200)
      expect(findUser(TARGET).adminSuspendedAt).toBeInstanceOf(Date)
      expect(idsOf(store().sessions, TARGET)).toEqual([])
      expect(store().adminAuditLogs).toEqual([
        expect.objectContaining({
          actorUserId: OWNER,
          action: 'ACCOUNT_SUSPENDED',
          metadata: JSON.stringify({ targetEmail: emailOf(TARGET) }),
        }),
      ])
    })

    it('no modifica securityHoldAt ni los tokens de incidente de seguridad', async () => {
      const response = await action('suspend', TARGET, { reason: 'Motivo válido' })

      expect(response.statusCode).toBe(200)
      expect(findUser(TARGET).securityHoldAt).toBeNull()
      expect(idsOf(store().securityIncidentTokens, TARGET)).toEqual(['sit-target'])
    })

    it('devuelve 409 si la cuenta ya está suspendida y no registra auditoría', async () => {
      findUser(TARGET).adminSuspendedAt = SUSPENSION_DATE
      findUser(TARGET).adminSuspensionReason = 'Motivo anterior'
      const before = structuredClone(store())

      const response = await action('suspend', TARGET, { reason: 'Motivo nuevo' })

      expect(response.statusCode).toBe(409)
      expect(response.json()).toEqual({ message: 'La cuenta ya está suspendida administrativamente.' })
      expect(store()).toEqual(before)
      // La comprobación previa responde sin llegar a la escritura condicional.
      expect(fake.state.userUpdateManyCalls).toBe(0)
    })

    it('devuelve 409 sin efectos si otra petición suspende la cuenta antes de la escritura condicional', async () => {
      const concurrentDate = new Date('2026-10-03T10:00:00.000Z')
      fake.state.beforeUserUpdateMany = () => {
        findUser(TARGET).adminSuspendedAt = concurrentDate
        findUser(TARGET).adminSuspensionReason = 'Suspensión concurrente'
      }

      const response = await action('suspend', TARGET, { reason: 'Motivo perdedor' })

      expect(response.statusCode).toBe(409)
      expect(response.json()).toEqual({ message: 'La cuenta ya está suspendida administrativamente.' })
      expect(fake.state.userUpdateManyCalls).toBe(1)
      // Se conserva el estado escrito por la otra petición.
      expect(findUser(TARGET).adminSuspendedAt).toEqual(concurrentDate)
      expect(findUser(TARGET).adminSuspensionReason).toBe('Suspensión concurrente')
      // No hay auditoría ni borrados.
      expect(store().adminAuditLogs).toEqual([])
      expect(idsOf(store().sessions, TARGET)).toEqual(['s-target-1', 's-target-2'])
      expect(idsOf(store().passwordResetTokens, TARGET)).toEqual(['prt-target-pending', 'prt-target-used'])
      expect(idsOf(store().emailChangeVerifications, TARGET)).toEqual(['ecv-target-pending', 'ecv-target-used'])
      expect(idsOf(store().securityIncidentTokens, TARGET)).toEqual(['sit-target'])
    })

    it('revierte todos los cambios si falla la auditoría dentro de la transacción', async () => {
      fake.state.failAuditCreate = true
      const before = structuredClone(store())

      const response = await action('suspend', TARGET, { reason: 'Motivo válido' })

      expect(response.statusCode).toBe(500)
      expect(fake.state.auditFailureInsideTransaction).toBe(true)
      expect(store()).toEqual(before)
      expect(findUser(TARGET).adminSuspendedAt).toBeNull()
      expect(idsOf(store().sessions, TARGET)).toEqual(['s-target-1', 's-target-2'])
    })
  })

  // ----------------------------------------------------------
  // REACTIVACIÓN
  // ----------------------------------------------------------

  describe('unsuspend', () => {
    beforeEach(() => {
      findUser(TARGET).adminSuspendedAt = SUSPENSION_DATE
      findUser(TARGET).adminSuspensionReason = 'Motivo anterior'
    })

    it('retira la suspensión y registra auditoría', async () => {
      const response = await action('unsuspend', TARGET, { reason: 'Revisión completada' })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        success: true,
        message: 'Suspensión administrativa retirada. Si existe una protección por incidente, seguirá activa.',
      })
      expect(fake.state.userUpdateManyCalls).toBe(1)
      expect(findUser(TARGET).adminSuspendedAt).toBeNull()
      expect(findUser(TARGET).adminSuspensionReason).toBeNull()
      expect(store().adminAuditLogs).toEqual([
        expect.objectContaining({
          actorUserId: OWNER,
          targetUserId: TARGET,
          action: 'ACCOUNT_UNSUSPENDED',
          reason: 'Revisión completada',
        }),
      ])
      expect(store().adminAuditLogs[0].metadata).toBe(
        JSON.stringify({ actorEmail: emailOf(OWNER), targetEmail: emailOf(TARGET) }),
      )
    })

    it('no elimina sesiones ni tokens', async () => {
      const before = structuredClone(store())

      const response = await action('unsuspend', TARGET, { reason: 'Revisión completada' })

      expect(response.statusCode).toBe(200)
      expect(store().sessions).toEqual(before.sessions)
      expect(store().passwordResetTokens).toEqual(before.passwordResetTokens)
      expect(store().emailChangeVerifications).toEqual(before.emailChangeVerifications)
      expect(store().securityIncidentTokens).toEqual(before.securityIncidentTokens)
    })

    it('mantiene securityHoldAt si la cuenta también está protegida por incidente', async () => {
      findUser(TARGET).securityHoldAt = HOLD_DATE

      const response = await action('unsuspend', TARGET, { reason: 'Revisión completada' })

      expect(response.statusCode).toBe(200)
      expect(findUser(TARGET).adminSuspendedAt).toBeNull()
      expect(findUser(TARGET).securityHoldAt).toEqual(HOLD_DATE)
    })

    it('devuelve 409 si la cuenta no está suspendida y no registra auditoría', async () => {
      findUser(TARGET).adminSuspendedAt = null
      findUser(TARGET).adminSuspensionReason = null
      const before = structuredClone(store())

      const response = await action('unsuspend', TARGET, { reason: 'Motivo válido' })

      expect(response.statusCode).toBe(409)
      expect(response.json()).toEqual({ message: 'La cuenta no tiene una suspensión administrativa activa.' })
      expect(store()).toEqual(before)
      // La comprobación previa responde sin llegar a la escritura condicional.
      expect(fake.state.userUpdateManyCalls).toBe(0)
    })

    it('devuelve 409 sin efectos si otra petición reactiva la cuenta antes de la escritura condicional', async () => {
      fake.state.beforeUserUpdateMany = () => {
        findUser(TARGET).adminSuspendedAt = null
        findUser(TARGET).adminSuspensionReason = null
      }
      const before = structuredClone(store())

      const response = await action('unsuspend', TARGET, { reason: 'Motivo perdedor' })

      expect(response.statusCode).toBe(409)
      expect(response.json()).toEqual({ message: 'La cuenta no tiene una suspensión administrativa activa.' })
      expect(fake.state.userUpdateManyCalls).toBe(1)
      expect(store().adminAuditLogs).toEqual([])
      // El único cambio es el de la otra petición; esta no modifica nada más.
      expect(store()).toEqual({
        ...before,
        users: before.users.map(item =>
          item.id === TARGET
            ? { ...item, adminSuspendedAt: null, adminSuspensionReason: null }
            : item,
        ),
      })
    })

    it('revierte todos los cambios si falla la auditoría dentro de la transacción', async () => {
      fake.state.failAuditCreate = true
      const before = structuredClone(store())

      const response = await action('unsuspend', TARGET, { reason: 'Motivo válido' })

      expect(response.statusCode).toBe(500)
      expect(fake.state.auditFailureInsideTransaction).toBe(true)
      expect(store()).toEqual(before)
      expect(findUser(TARGET).adminSuspendedAt).toEqual(SUSPENSION_DATE)
    })
  })

  // ----------------------------------------------------------
  // REVOCAR SESIONES
  // ----------------------------------------------------------

  describe('revoke-sessions', () => {
    it('cierra las sesiones del objetivo y registra el número en metadata', async () => {
      store().sessions.push({ id: 's-target-3', userId: TARGET, expiresAt: SESSION_EXPIRY })

      const response = await action('revoke-sessions', TARGET, { reason: 'Acceso sospechoso' })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        success: true,
        revokedCount: 3,
        message: 'Se han cerrado 3 sesiones.',
      })
      expect(idsOf(store().sessions, TARGET)).toEqual([])
      expect(idsOf(store().sessions, USER)).toEqual(['s-user-1'])
      expect(store().adminAuditLogs).toEqual([
        expect.objectContaining({
          actorUserId: OWNER,
          targetUserId: TARGET,
          action: 'SESSIONS_REVOKED',
          reason: 'Acceso sospechoso',
          metadata: JSON.stringify({ revokedCount: 3, actorEmail: emailOf(OWNER), targetEmail: emailOf(TARGET) }),
        }),
      ])
      // No altera el estado de la cuenta.
      expect(findUser(TARGET).adminSuspendedAt).toBeNull()
      expect(findUser(TARGET).securityHoldAt).toBeNull()
    })

    it('registra auditoría con revokedCount 0 si no hay sesiones', async () => {
      store().sessions = store().sessions.filter(session => session.userId !== TARGET)

      const response = await action('revoke-sessions', TARGET, { reason: 'Revisión preventiva' })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ revokedCount: 0 })
      expect(store().adminAuditLogs).toEqual([
        expect.objectContaining({
          action: 'SESSIONS_REVOKED',
          metadata: JSON.stringify({ revokedCount: 0, actorEmail: emailOf(OWNER), targetEmail: emailOf(TARGET) }),
        }),
      ])
    })

    it('revierte el borrado de sesiones si falla la auditoría dentro de la transacción', async () => {
      fake.state.failAuditCreate = true
      const before = structuredClone(store())

      const response = await action('revoke-sessions', TARGET, { reason: 'Acceso sospechoso' })

      expect(response.statusCode).toBe(500)
      expect(fake.state.auditFailureInsideTransaction).toBe(true)
      expect(store()).toEqual(before)
      expect(idsOf(store().sessions, TARGET)).toEqual(['s-target-1', 's-target-2'])
    })
  })

  // ----------------------------------------------------------
  // SUSPENSIÓN DE CUENTAS PROTEGIDAS (S4)
  // ----------------------------------------------------------

  describe('suspend sobre una cuenta protegida por incidente', () => {
    const HELD_MESSAGE = 'La cuenta está protegida por un incidente de seguridad; no se puede suspender administrativamente.'

    it('devuelve 409 sin escribir nada si la cuenta ya está protegida', async () => {
      findUser(TARGET).securityHoldAt = HOLD_DATE
      const before = structuredClone(store())

      const response = await action('suspend', TARGET, { reason: 'Motivo válido' })

      expect(response.statusCode).toBe(409)
      expect(response.json()).toEqual({ message: HELD_MESSAGE })
      expect(fake.state.userUpdateManyCalls).toBe(0)
      expect(store()).toEqual(before)
    })

    it('devuelve 409 sin efectos si la cuenta se protege antes de la escritura condicional', async () => {
      fake.state.beforeUserUpdateMany = () => {
        findUser(TARGET).securityHoldAt = HOLD_DATE
      }

      const response = await action('suspend', TARGET, { reason: 'Motivo perdedor' })

      expect(response.statusCode).toBe(409)
      expect(response.json()).toEqual({ message: HELD_MESSAGE })
      expect(fake.state.userUpdateManyCalls).toBe(1)
      expect(findUser(TARGET).adminSuspendedAt).toBeNull()
      expect(findUser(TARGET).adminSuspensionReason).toBeNull()
      expect(findUser(TARGET).securityHoldAt).toEqual(HOLD_DATE)
      expect(store().adminAuditLogs).toEqual([])
      expect(idsOf(store().sessions, TARGET)).toEqual(['s-target-1', 's-target-2'])
      expect(idsOf(store().passwordResetTokens, TARGET)).toEqual(['prt-target-pending', 'prt-target-used'])
      expect(idsOf(store().emailChangeVerifications, TARGET)).toEqual(['ecv-target-pending', 'ecv-target-used'])
    })

    it('si otra petición suspende la cuenta antes de la escritura, mantiene el 409 de cuenta ya suspendida', async () => {
      fake.state.beforeUserUpdateMany = () => {
        findUser(TARGET).adminSuspendedAt = SUSPENSION_DATE
      }

      const response = await action('suspend', TARGET, { reason: 'Motivo perdedor' })

      expect(response.statusCode).toBe(409)
      expect(response.json()).toEqual({ message: 'La cuenta ya está suspendida administrativamente.' })
      expect(store().adminAuditLogs).toEqual([])
    })

    it('una cuenta sin protección se sigue suspendiendo como antes', async () => {
      const response = await action('suspend', TARGET, { reason: 'Motivo válido' })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ success: true, message: 'Cuenta suspendida y sesiones cerradas.' })
      expect(findUser(TARGET).adminSuspendedAt).toBeInstanceOf(Date)
      expect(findUser(TARGET).securityHoldAt).toBeNull()
      expect(store().adminAuditLogs).toEqual([expect.objectContaining({ action: 'ACCOUNT_SUSPENDED' })])
    })
  })

  // ----------------------------------------------------------
  // RETIRAR LA PROTECCIÓN POR INCIDENTE
  // ----------------------------------------------------------

  describe('resolve-security-hold', () => {
    const NOT_HELD_MESSAGE = 'La cuenta no tiene una protección por incidente activa.'
    const HOLD_CHANGED_MESSAGE = 'La protección por incidente ha cambiado durante la operación. Revisa la cuenta antes de volver a intentarlo.'

    beforeEach(() => {
      findUser(TARGET).securityHoldAt = HOLD_DATE
    })

    it('retira la protección y registra auditoría SECURITY_HOLD_RESOLVED', async () => {
      const response = await action('resolve-security-hold', TARGET, { reason: '  Incidente revisado  ' })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        success: true,
        message: 'Protección por incidente retirada. Si existe una suspensión administrativa, seguirá activa.',
      })
      expect(fake.state.userUpdateManyCalls).toBe(1)
      expect(findUser(TARGET).securityHoldAt).toBeNull()
      expect(store().adminAuditLogs).toEqual([
        expect.objectContaining({
          actorUserId: OWNER,
          targetUserId: TARGET,
          action: 'SECURITY_HOLD_RESOLVED',
          reason: 'Incidente revisado',
          metadata: JSON.stringify({ actorEmail: emailOf(OWNER), targetEmail: emailOf(TARGET) }),
        }),
      ])
    })

    it.each([
      ['exactamente 3 caracteres', 'abc'],
      ['exactamente 500 caracteres', 'a'.repeat(500)],
    ])('acepta un motivo de %s', async (_label, reason) => {
      const response = await action('resolve-security-hold', TARGET, { reason })

      expect(response.statusCode).toBe(200)
      expect(store().adminAuditLogs[0].reason).toBe(reason)
    })

    it('no modifica la suspensión administrativa', async () => {
      findUser(TARGET).adminSuspendedAt = SUSPENSION_DATE
      findUser(TARGET).adminSuspensionReason = 'Motivo anterior'

      const response = await action('resolve-security-hold', TARGET, { reason: 'Incidente revisado' })

      expect(response.statusCode).toBe(200)
      expect(findUser(TARGET).securityHoldAt).toBeNull()
      expect(findUser(TARGET).adminSuspendedAt).toEqual(SUSPENSION_DATE)
      expect(findUser(TARGET).adminSuspensionReason).toBe('Motivo anterior')
    })

    it('no modifica sesiones, tokens ni otros datos de la cuenta', async () => {
      const before = structuredClone(store())

      const response = await action('resolve-security-hold', TARGET, { reason: 'Incidente revisado' })

      expect(response.statusCode).toBe(200)
      expect(store()).toEqual({
        ...before,
        users: before.users.map(item => (item.id === TARGET ? { ...item, securityHoldAt: null } : item)),
        adminAuditLogs: store().adminAuditLogs,
      })
      expect(store().adminAuditLogs).toHaveLength(1)
    })

    it('devuelve 409 sin escribir nada si la cuenta no está protegida', async () => {
      findUser(TARGET).securityHoldAt = null
      const before = structuredClone(store())

      const response = await action('resolve-security-hold', TARGET, { reason: 'Motivo válido' })

      expect(response.statusCode).toBe(409)
      expect(response.json()).toEqual({ message: NOT_HELD_MESSAGE })
      expect(fake.state.userUpdateManyCalls).toBe(0)
      expect(store()).toEqual(before)
    })

    it('devuelve 409 sin auditoría si otra petición retira la protección antes de la escritura condicional', async () => {
      fake.state.beforeUserUpdateMany = () => {
        findUser(TARGET).securityHoldAt = null
      }
      const before = structuredClone(store())

      const response = await action('resolve-security-hold', TARGET, { reason: 'Motivo perdedor' })

      expect(response.statusCode).toBe(409)
      expect(response.json()).toEqual({ message: NOT_HELD_MESSAGE })
      expect(fake.state.userUpdateManyCalls).toBe(1)
      expect(store().adminAuditLogs).toEqual([])
      // El único cambio es el de la otra petición.
      expect(store()).toEqual({
        ...before,
        users: before.users.map(item => (item.id === TARGET ? { ...item, securityHoldAt: null } : item)),
      })
    })

    it('no retira una protección nueva que aparece entre la lectura y la escritura', async () => {
      const newHold = new Date(HOLD_DATE.getTime() + 1)
      fake.state.beforeUserUpdateMany = () => {
        // Nuevo incidente, como lo registra reportSecurityIncident: nueva fecha y versión + 1.
        findUser(TARGET).securityHoldAt = newHold
        findUser(TARGET).securityHoldVersion += 1
      }
      const before = structuredClone(store())

      const response = await action('resolve-security-hold', TARGET, { reason: 'Motivo perdedor' })

      expect(response.statusCode).toBe(409)
      expect(response.json()).toEqual({ message: HOLD_CHANGED_MESSAGE })
      expect(fake.state.userUpdateManyCalls).toBe(1)
      expect(findUser(TARGET).securityHoldAt).toEqual(newHold)
      expect(store().adminAuditLogs).toEqual([])
      // El único cambio es el del nuevo incidente.
      expect(store()).toEqual({
        ...before,
        users: before.users.map(item => (item.id === TARGET ? { ...item, securityHoldAt: newHold, securityHoldVersion: 1 } : item)),
      })
    })

    it('no retira un incidente nuevo con la misma fecha si su versión es distinta', async () => {
      fake.state.beforeUserUpdateMany = () => {
        // Mismo milisegundo, otro incidente: solo la versión los distingue.
        findUser(TARGET).securityHoldVersion += 1
      }

      const response = await action('resolve-security-hold', TARGET, { reason: 'Motivo perdedor' })

      expect(response.statusCode).toBe(409)
      expect(response.json()).toEqual({ message: HOLD_CHANGED_MESSAGE })
      expect(findUser(TARGET).securityHoldAt).toEqual(HOLD_DATE)
      expect(findUser(TARGET).securityHoldVersion).toBe(1)
      expect(store().adminAuditLogs).toEqual([])
    })

    it('no aplica una retirada antigua si entre medias se retiró la protección y llegó otro incidente', async () => {
      fake.state.beforeUserUpdateMany = () => {
        // Otra persona retiró la protección (versión 0) y después se registró otro incidente.
        findUser(TARGET).securityHoldAt = new Date(HOLD_DATE.getTime())
        findUser(TARGET).securityHoldVersion = 1
      }

      const response = await action('resolve-security-hold', TARGET, { reason: 'Retirada antigua' })

      expect(response.statusCode).toBe(409)
      expect(response.json()).toEqual({ message: HOLD_CHANGED_MESSAGE })
      expect(findUser(TARGET).securityHoldAt).toEqual(HOLD_DATE)
      expect(findUser(TARGET).securityHoldVersion).toBe(1)
      expect(store().adminAuditLogs).toEqual([])
    })

    it('con la misma versión, la retirada no depende de la fecha guardada', async () => {
      fake.state.beforeUserUpdateMany = () => {
        // La fecha leída puede no coincidir textualmente con la guardada; la versión sí.
        findUser(TARGET).securityHoldAt = new Date(HOLD_DATE.getTime() + 5)
      }

      const response = await action('resolve-security-hold', TARGET, { reason: 'Incidente revisado' })

      expect(response.statusCode).toBe(200)
      expect(findUser(TARGET).securityHoldAt).toBeNull()
      expect(store().adminAuditLogs).toEqual([expect.objectContaining({ action: 'SECURITY_HOLD_RESOLVED' })])
    })

    it('envía a Prisma la condición por protección activa y versión leída', async () => {
      findUser(TARGET).securityHoldVersion = 3

      await action('resolve-security-hold', TARGET, { reason: 'Incidente revisado' })

      expect(fake.state.lastUserUpdateManyWhere).toEqual({
        id: TARGET,
        securityHoldAt: { not: null },
        securityHoldVersion: 3,
      })
    })

    it('retira una protección anterior a la migración (versión 0) sin cambiar el contador', async () => {
      const response = await action('resolve-security-hold', TARGET, { reason: 'Incidente revisado' })

      expect(response.statusCode).toBe(200)
      expect(findUser(TARGET).securityHoldAt).toBeNull()
      expect(findUser(TARGET).securityHoldVersion).toBe(0)
      expect(store().adminAuditLogs).toHaveLength(1)
    })

    it('retira una protección con versión distinta de 0 sin cambiar el contador', async () => {
      findUser(TARGET).securityHoldVersion = 3

      const response = await action('resolve-security-hold', TARGET, { reason: 'Incidente revisado' })

      expect(response.statusCode).toBe(200)
      expect(findUser(TARGET).securityHoldAt).toBeNull()
      expect(findUser(TARGET).securityHoldVersion).toBe(3)
    })

    it('dos retiradas seguidas de la misma protección solo registran una auditoría', async () => {
      const first = await action('resolve-security-hold', TARGET, { reason: 'Incidente revisado' })
      const second = await action('resolve-security-hold', TARGET, { reason: 'Incidente revisado' })

      expect(first.statusCode).toBe(200)
      expect(second.statusCode).toBe(409)
      expect(second.json()).toEqual({ message: NOT_HELD_MESSAGE })
      expect(store().adminAuditLogs).toHaveLength(1)
    })

    it('revierte todos los cambios si falla la auditoría dentro de la transacción', async () => {
      fake.state.failAuditCreate = true
      const before = structuredClone(store())

      const response = await action('resolve-security-hold', TARGET, { reason: 'Motivo válido' })

      expect(response.statusCode).toBe(500)
      expect(fake.state.auditFailureInsideTransaction).toBe(true)
      expect(store()).toEqual(before)
      expect(findUser(TARGET).securityHoldAt).toEqual(HOLD_DATE)
    })

    it('la acción queda disponible en el filtro de auditoría', async () => {
      await action('resolve-security-hold', TARGET, { reason: 'Incidente revisado' })
      await action('revoke-sessions', USER, { reason: 'Otra acción' })

      const response = await app.inject({ method: 'GET', url: '/api/admin/audit?action=SECURITY_HOLD_RESOLVED', headers: asOwner })

      expect(response.statusCode).toBe(200)
      expect(fake.state.lastAuditFindMany?.where).toEqual({ action: 'SECURITY_HOLD_RESOLVED' })
      expect(fake.state.lastAuditCount?.where).toEqual({ action: 'SECURITY_HOLD_RESOLVED' })
      expect(response.json().logs).toEqual([
        expect.objectContaining({ action: 'SECURITY_HOLD_RESOLVED', targetUserId: TARGET, targetEmail: emailOf(TARGET) }),
      ])
      expect(response.json().pagination.total).toBe(1)
    })
  })

  // ----------------------------------------------------------
  // PARÁMETROS DE CONSULTA
  // ----------------------------------------------------------

  describe('parámetros de consulta', () => {
    function getUsers(query: string) {
      return app.inject({ method: 'GET', url: `/api/admin/users${query}`, headers: asOwner })
    }

    function getAudit(query: string) {
      return app.inject({ method: 'GET', url: `/api/admin/audit${query}`, headers: asOwner })
    }

    it('users sin parámetros usa la primera página y no filtra', async () => {
      const response = await getUsers('')

      expect(response.statusCode).toBe(200)
      expect(fake.state.lastUserFindMany).toEqual({ where: {}, skip: 0, take: 20 })
      expect(response.json().pagination).toEqual({ page: 1, pageSize: 20, total: 5, pages: 1 })
    })

    it('users recorta la búsqueda y filtra por email', async () => {
      const response = await getUsers(`?search=${encodeURIComponent('  target  ')}`)

      expect(response.statusCode).toBe(200)
      expect(fake.state.lastUserFindMany?.where).toEqual({ email: { contains: 'target' } })
      expect(response.json().users.map((item: { id: string }) => item.id)).toEqual([TARGET])
      expect(response.json().pagination.total).toBe(1)
    })

    it('users limita la búsqueda a 120 caracteres', async () => {
      await getUsers(`?search=${'a'.repeat(200)}`)

      expect(fake.state.lastUserFindMany?.where).toEqual({ email: { contains: 'a'.repeat(120) } })
    })

    it('users ignora una búsqueda formada solo por espacios', async () => {
      await getUsers(`?search=${encodeURIComponent('   ')}`)

      expect(fake.state.lastUserFindMany?.where).toEqual({})
    })

    it.each([
      ['3', 3],
      ['abc', 1],
      ['0', 1],
      ['-5', 1],
      ['', 1],
      ['999999', 10000],
    ])('users con page=%s usa la página %i', async (value, expected) => {
      const response = await getUsers(`?page=${value}`)

      expect(response.statusCode).toBe(200)
      expect(fake.state.lastUserFindMany).toMatchObject({ skip: (expected - 1) * 20, take: 20 })
      expect(response.json().pagination.page).toBe(expected)
    })

    it('users con parámetros repetidos vuelve a los valores por defecto', async () => {
      const response = await getUsers('?search=target&search=user&page=3&page=4')

      expect(response.statusCode).toBe(200)
      expect(fake.state.lastUserFindMany).toEqual({ where: {}, skip: 0, take: 20 })
    })

    it('users ignora parámetros desconocidos', async () => {
      const response = await getUsers('?role=OWNER&page=2')

      expect(response.statusCode).toBe(200)
      expect(fake.state.lastUserFindMany).toEqual({ where: {}, skip: 20, take: 20 })
    })

    it.each([
      ['', 1],
      ['2', 2],
      ['abc', 1],
      ['0', 1],
      ['999999999', 100000],
    ])('audit con page=%s usa la página %i', async (value, expected) => {
      const response = await getAudit(value === '' ? '' : `?page=${value}`)

      expect(response.statusCode).toBe(200)
      expect(fake.state.lastAuditFindMany).toEqual({ where: {}, skip: (expected - 1) * 10, take: 10 })
      expect(response.json().pagination.page).toBe(expected)
    })

    it('audit devuelve los registros más recientes primero', async () => {
      store().adminAuditLogs.push(
        { id: 'a-old', actorUserId: OWNER, targetUserId: TARGET, action: 'ACCOUNT_SUSPENDED', reason: 'r', metadata: null, createdAt: new Date('2026-10-01T00:00:00.000Z') },
        { id: 'a-new', actorUserId: OWNER, targetUserId: TARGET, action: 'ACCOUNT_UNSUSPENDED', reason: 'r', metadata: null, createdAt: new Date('2026-10-02T00:00:00.000Z') },
      )

      const response = await getAudit('')

      expect(response.json().logs.map((log: { id: string }) => log.id)).toEqual(['a-new', 'a-old'])
      expect(response.json().pagination).toEqual({ page: 1, pageSize: 10, total: 2, pages: 1 })
    })
  })

  // ----------------------------------------------------------
  // IDENTIFICACIÓN EN LA AUDITORÍA
  // ----------------------------------------------------------

  describe('identificación en la auditoría', () => {
    const GONE = 'gone-1'

    function auditLog(id: string, extra: Partial<AuditRecord> = {}): AuditRecord {
      return {
        id,
        actorUserId: OWNER,
        targetUserId: TARGET,
        action: 'ACCOUNT_SUSPENDED',
        reason: 'r',
        metadata: null,
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
        ...extra,
      }
    }

    async function getLogs() {
      const response = await app.inject({ method: 'GET', url: '/api/admin/audit', headers: asOwner })
      expect(response.statusCode).toBe(200)
      return response.json().logs as Record<string, unknown>[]
    }

    it('un registro antiguo sin metadata usa el email actual y no expone metadata', async () => {
      store().adminAuditLogs.push(auditLog('a-1'))

      const [log] = await getLogs()

      expect(log).toEqual({
        id: 'a-1',
        actorUserId: OWNER,
        targetUserId: TARGET,
        action: 'ACCOUNT_SUSPENDED',
        reason: 'r',
        createdAt: '2026-10-01T00:00:00.000Z',
        actorEmail: emailOf(OWNER),
        actorEmailAtAction: null,
        actorFound: true,
        targetEmail: emailOf(TARGET),
        targetEmailAtAction: null,
        targetFound: true,
        revokedCount: null,
      })
    })

    it('un registro antiguo con solo revokedCount lo conserva, incluido 0', async () => {
      store().adminAuditLogs.push(
        auditLog('a-0', { action: 'SESSIONS_REVOKED', metadata: JSON.stringify({ revokedCount: 0 }) }),
        auditLog('a-3', { action: 'SESSIONS_REVOKED', metadata: JSON.stringify({ revokedCount: 3 }), createdAt: new Date('2026-10-02T00:00:00.000Z') }),
      )

      const logs = await getLogs()

      expect(logs.map(log => [log.id, log.revokedCount])).toEqual([['a-3', 3], ['a-0', 0]])
    })

    it('una cuenta que ya no existe devuelve la instantánea sin email actual', async () => {
      store().adminAuditLogs.push(auditLog('a-1', {
        targetUserId: GONE,
        metadata: JSON.stringify({ actorEmail: emailOf(OWNER), targetEmail: 'borrada@estateforge.test' }),
      }))

      const [log] = await getLogs()

      expect(log).toMatchObject({
        targetUserId: GONE,
        targetEmail: null,
        targetEmailAtAction: 'borrada@estateforge.test',
        targetFound: false,
        actorEmail: emailOf(OWNER),
        actorFound: true,
      })
    })

    it('una cuenta que ya no existe y sin instantánea no inventa datos', async () => {
      store().adminAuditLogs.push(auditLog('a-1', { actorUserId: 'gone-owner', targetUserId: GONE }))

      const [log] = await getLogs()

      expect(log).toMatchObject({
        actorEmail: null, actorEmailAtAction: null, actorFound: false,
        targetEmail: null, targetEmailAtAction: null, targetFound: false,
      })
    })

    it('un email cambiado devuelve por separado el actual y el de la acción', async () => {
      store().adminAuditLogs.push(auditLog('a-1', {
        metadata: JSON.stringify({ actorEmail: emailOf(OWNER), targetEmail: 'anterior@estateforge.test' }),
      }))

      const [log] = await getLogs()

      expect(log).toMatchObject({ targetEmail: emailOf(TARGET), targetEmailAtAction: 'anterior@estateforge.test' })
    })

    it('una metadata malformada no rompe la auditoría y conserva los campos válidos', async () => {
      store().adminAuditLogs.push(
        auditLog('a-bad', { metadata: '{no es json' }),
        auditLog('a-mixed', {
          metadata: JSON.stringify({ revokedCount: '3', actorEmail: 5, targetEmail: 'valido@estateforge.test' }),
          createdAt: new Date('2026-10-02T00:00:00.000Z'),
        }),
      )

      const [mixed, bad] = await getLogs()

      expect(bad).toMatchObject({ actorEmailAtAction: null, targetEmailAtAction: null, revokedCount: null, actorEmail: emailOf(OWNER) })
      expect(mixed).toMatchObject({ actorEmailAtAction: null, targetEmailAtAction: 'valido@estateforge.test', revokedCount: null })
    })

    it('sin cuenta afectada devuelve targetFound null', async () => {
      store().adminAuditLogs.push(auditLog('a-1', { targetUserId: null }))

      const [log] = await getLogs()

      expect(log).toMatchObject({ targetUserId: null, targetEmail: null, targetEmailAtAction: null, targetFound: null })
    })

    it('busca los emails en una sola consulta con los ids únicos de la página', async () => {
      store().adminAuditLogs.push(
        auditLog('a-1'),
        auditLog('a-2', { targetUserId: USER }),
        auditLog('a-3', { targetUserId: null }),
      )

      await getLogs()

      expect(fake.state.userFindManyCalls).toBe(1)
      const where = fake.state.lastUserFindMany?.where as { id: { in: string[] } }
      expect([...where.id.in].sort()).toEqual([OWNER, TARGET, USER].sort())
    })

    it('no consulta usuarios si la página está vacía', async () => {
      const logs = await getLogs()

      expect(logs).toEqual([])
      expect(fake.state.userFindManyCalls).toBe(0)
    })

    it('las acciones nuevas quedan identificadas en la auditoría', async () => {
      await action('revoke-sessions', TARGET, { reason: 'Acceso sospechoso' })

      const [log] = await getLogs()

      expect(log).toMatchObject({
        action: 'SESSIONS_REVOKED',
        actorEmail: emailOf(OWNER),
        actorEmailAtAction: emailOf(OWNER),
        targetEmail: emailOf(TARGET),
        targetEmailAtAction: emailOf(TARGET),
        revokedCount: 2,
      })
    })
  })

  // ----------------------------------------------------------
  // FILTROS DE AUDITORÍA
  // ----------------------------------------------------------

  describe('filtros de auditoría', () => {
    const GONE = 'gone-1'

    function day(n: number) {
      return new Date(Date.UTC(2026, 9, n))
    }

    function log(id: string, action: string, targetUserId: string | null, createdAt: Date, metadata: string | null = null): AuditRecord {
      return { id, actorUserId: OWNER, targetUserId, action, reason: 'r', metadata, createdAt }
    }

    beforeEach(() => {
      store().adminAuditLogs.push(
        log('l1', 'ACCOUNT_SUSPENDED', TARGET, day(1)),
        log('l2', 'ACCOUNT_UNSUSPENDED', TARGET, day(2)),
        log('l3', 'SESSIONS_REVOKED', USER, day(3), JSON.stringify({ revokedCount: 1 })),
        log('l4', 'ACCOUNT_SUSPENDED', USER, day(4)),
        log('l5', 'SESSIONS_REVOKED', GONE, day(5), JSON.stringify({ revokedCount: 0, targetEmail: 'borrada@estateforge.test' })),
      )
    })

    async function getAudit(query: string) {
      const response = await app.inject({ method: 'GET', url: `/api/admin/audit${query}`, headers: asOwner })
      expect(response.statusCode).toBe(200)
      // El total y la página tienen que calcularse con el mismo filtro.
      expect(fake.state.lastAuditCount).not.toBeNull()
      expect(fake.state.lastAuditCount?.where).toEqual(fake.state.lastAuditFindMany?.where)
      const body = response.json() as { logs: Record<string, unknown>[]; pagination: Record<string, number> }
      return { ...body, ids: body.logs.map(item => item.id) }
    }

    it('sin filtros devuelve todo, con where vacío', async () => {
      const result = await getAudit('')

      expect(fake.state.lastAuditFindMany).toEqual({ where: {}, skip: 0, take: 10 })
      expect(result.ids).toEqual(['l5', 'l4', 'l3', 'l2', 'l1'])
      expect(result.pagination).toEqual({ page: 1, pageSize: 10, total: 5, pages: 1 })
    })

    it('filtra por acción y ajusta el total y las páginas', async () => {
      const result = await getAudit('?action=ACCOUNT_SUSPENDED')

      expect(fake.state.lastAuditFindMany?.where).toEqual({ action: 'ACCOUNT_SUSPENDED' })
      expect(result.ids).toEqual(['l4', 'l1'])
      expect(result.pagination).toEqual({ page: 1, pageSize: 10, total: 2, pages: 1 })
    })

    it('filtra por cuenta afectada', async () => {
      const result = await getAudit(`?targetUserId=${TARGET}`)

      expect(fake.state.lastAuditFindMany?.where).toEqual({ targetUserId: TARGET })
      expect(result.ids).toEqual(['l2', 'l1'])
      expect(result.pagination.total).toBe(2)
    })

    it('recorta los espacios del identificador de cuenta', async () => {
      const result = await getAudit(`?targetUserId=${encodeURIComponent(`  ${USER}  `)}`)

      expect(fake.state.lastAuditFindMany?.where).toEqual({ targetUserId: USER })
      expect(result.ids).toEqual(['l4', 'l3'])
    })

    it('combina los dos filtros', async () => {
      const result = await getAudit(`?action=ACCOUNT_SUSPENDED&targetUserId=${USER}`)

      expect(fake.state.lastAuditFindMany?.where).toEqual({ action: 'ACCOUNT_SUSPENDED', targetUserId: USER })
      expect(fake.state.lastAuditCount).toEqual({ where: { action: 'ACCOUNT_SUSPENDED', targetUserId: USER } })
      expect(result.ids).toEqual(['l4'])
      expect(result.pagination).toEqual({ page: 1, pageSize: 10, total: 1, pages: 1 })
    })

    it('pagina el resultado filtrado', async () => {
      for (let i = 1; i <= 12; i++) {
        store().adminAuditLogs.push(log(`r${i}`, 'SESSIONS_REVOKED', TARGET, day(10 + i)))
      }

      const result = await getAudit(`?action=SESSIONS_REVOKED&targetUserId=${TARGET}&page=2`)

      expect(fake.state.lastAuditFindMany).toEqual({
        where: { action: 'SESSIONS_REVOKED', targetUserId: TARGET },
        skip: 10,
        take: 10,
      })
      expect(result.ids).toEqual(['r2', 'r1'])
      expect(result.pagination).toEqual({ page: 2, pageSize: 10, total: 12, pages: 2 })
    })

    it('con la misma fecha, desempata por id descendente', async () => {
      // Se insertan en orden ascendente: solo el desempate de la ruta los invierte.
      store().adminAuditLogs.push(
        log('tie-a', 'ACCOUNT_SUSPENDED', TARGET, day(20)),
        log('tie-b', 'ACCOUNT_SUSPENDED', TARGET, day(20)),
      )

      const result = await getAudit(`?targetUserId=${TARGET}`)

      expect(result.ids).toEqual(['tie-b', 'tie-a', 'l2', 'l1'])
    })

    it('devuelve una página vacía si nada coincide, sin consultar usuarios', async () => {
      const result = await getAudit(`?action=ACCOUNT_UNSUSPENDED&targetUserId=${USER}`)

      expect(result.logs).toEqual([])
      expect(result.pagination).toEqual({ page: 1, pageSize: 10, total: 0, pages: 0 })
      expect(fake.state.userFindManyCalls).toBe(0)
    })

    it.each([
      ['desconocida', 'OTRA_ACCION'],
      ['en minúsculas', 'account_suspended'],
      ['vacía', ''],
    ])('ignora una acción %s', async (_label, value) => {
      const result = await getAudit(`?action=${value}`)

      expect(fake.state.lastAuditFindMany?.where).toEqual({})
      expect(result.pagination.total).toBe(5)
    })

    it.each([
      ['vacío', ''],
      ['solo con espacios', '%20%20'],
      ['de más de 128 caracteres', 'a'.repeat(129)],
    ])('ignora un identificador de cuenta %s', async (_label, value) => {
      const result = await getAudit(`?targetUserId=${value}`)

      expect(fake.state.lastAuditFindMany?.where).toEqual({})
      expect(result.pagination.total).toBe(5)
    })

    it('ignora los filtros repetidos, pero conserva los válidos', async () => {
      const repeated = await getAudit(`?action=ACCOUNT_SUSPENDED&action=SESSIONS_REVOKED&targetUserId=${TARGET}`)
      expect(fake.state.lastAuditFindMany?.where).toEqual({ targetUserId: TARGET })
      expect(repeated.ids).toEqual(['l2', 'l1'])

      await getAudit(`?targetUserId=${TARGET}&targetUserId=${USER}&action=SESSIONS_REVOKED`)
      expect(fake.state.lastAuditFindMany?.where).toEqual({ action: 'SESSIONS_REVOKED' })
    })

    it('ignora parámetros desconocidos junto a los filtros', async () => {
      await getAudit('?action=SESSIONS_REVOKED&actorUserId=owner-1&foo=bar')

      expect(fake.state.lastAuditFindMany?.where).toEqual({ action: 'SESSIONS_REVOKED' })
    })

    it('filtra por una cuenta que ya no existe y conserva la instantánea de D1', async () => {
      const result = await getAudit(`?targetUserId=${GONE}`)

      expect(result.ids).toEqual(['l5'])
      expect(result.logs[0]).toMatchObject({
        targetUserId: GONE,
        targetEmail: null,
        targetEmailAtAction: 'borrada@estateforge.test',
        targetFound: false,
        revokedCount: 0,
      })
    })

    it('resuelve los emails del resultado filtrado en una sola consulta', async () => {
      const result = await getAudit(`?targetUserId=${USER}`)

      expect(fake.state.userFindManyCalls).toBe(1)
      const where = fake.state.lastUserFindMany?.where as { id: { in: string[] } }
      expect([...where.id.in].sort()).toEqual([OWNER, USER].sort())
      expect(result.logs[0]).toMatchObject({ targetEmail: emailOf(USER), actorEmail: emailOf(OWNER) })
    })
  })

  // ----------------------------------------------------------
  // RATE LIMIT
  // ----------------------------------------------------------

  describe('rate limit', () => {
    const LIMIT = 20

    it.each(ACTIONS)('%s admite 20 peticiones por minuto y responde 429 a la siguiente sin efectos', async route => {
      // Motivo inválido: cada petición llega al handler y responde 400 sin escribir.
      for (let i = 0; i < LIMIT; i++) {
        const response = await action(route, TARGET, { reason: 'ab' })
        expect(response.statusCode).toBe(400)
      }
      const before = structuredClone(store())

      const limited = await action(route, TARGET, { reason: 'Motivo válido' })

      expect(limited.statusCode).toBe(429)
      expect(limited.headers['retry-after']).toBeDefined()
      expect(fake.state.userUpdateManyCalls).toBe(0)
      expect(store()).toEqual(before)
    })

    it('cuenta el límite por separado en cada ruta', async () => {
      for (let i = 0; i < LIMIT; i++) {
        await action('suspend', TARGET, { reason: 'ab' })
      }

      expect((await action('suspend', TARGET, { reason: 'ab' })).statusCode).toBe(429)
      expect((await action('revoke-sessions', TARGET, { reason: 'ab' })).statusCode).toBe(400)
    })

    it('aplica el límite antes de la autenticación', async () => {
      for (let i = 0; i < LIMIT; i++) {
        const response = await app.inject({
          method: 'POST',
          url: `/api/admin/users/${TARGET}/suspend`,
          payload: { reason: 'Motivo válido' },
        })
        expect(response.statusCode).toBe(401)
      }

      const limited = await app.inject({
        method: 'POST',
        url: `/api/admin/users/${TARGET}/suspend`,
        payload: { reason: 'Motivo válido' },
      })

      expect(limited.statusCode).toBe(429)
    })

    it('no limita las consultas del panel', async () => {
      for (let i = 0; i < LIMIT + 5; i++) {
        const response = await app.inject({ method: 'GET', url: '/api/admin/overview', headers: asOwner })
        expect(response.statusCode).toBe(200)
      }
    })
  })

  // ----------------------------------------------------------
  // DETALLE DE CUENTA
  // ----------------------------------------------------------

  describe('detalle de cuenta', () => {
    function getDetail(id: string) {
      return app.inject({ method: 'GET', url: `/api/admin/users/${id}`, headers: asOwner })
    }

    it('devuelve exactamente los campos de la cuenta, sin datos sensibles', async () => {
      const response = await getDetail(TARGET)

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        id: TARGET,
        email: emailOf(TARGET),
        role: 'USER',
        createdAt: '2026-09-01T00:00:00.000Z',
        securityHoldAt: null,
        adminSuspendedAt: null,
        adminSuspensionReason: null,
        properties: 3,
        activeSessions: 2,
      })
    })

    it('no cuenta las sesiones caducadas como activas', async () => {
      store().sessions.push(
        { id: 's-target-expired', userId: TARGET, expiresAt: new Date('2020-01-01T00:00:00.000Z') },
        { id: 's-user-expired', userId: USER, expiresAt: new Date('2020-01-01T00:00:00.000Z') },
      )

      const response = await getDetail(TARGET)

      expect(response.json()).toMatchObject({ activeSessions: 2, properties: 3 })
    })

    it('usa el instante de la petición: una sesión que caduca justo entonces ya no es activa', async () => {
      const now = new Date('2026-11-01T12:00:00.000Z')
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(now)
      try {
        store().sessions = [
          { id: 's-boundary', userId: TARGET, expiresAt: now },
          { id: 's-later', userId: TARGET, expiresAt: new Date(now.getTime() + 1) },
          { id: 's-earlier', userId: TARGET, expiresAt: new Date(now.getTime() - 1) },
        ]

        const response = await getDetail(TARGET)

        expect(response.statusCode).toBe(200)
        expect(response.json().activeSessions).toBe(1)
      } finally {
        vi.useRealTimers()
      }
    })

    it('cuenta inmuebles y sesiones de cada cuenta por separado', async () => {
      expect((await getDetail(USER)).json()).toMatchObject({ properties: 1, activeSessions: 1 })
      expect((await getDetail(OTHER_OWNER)).json()).toMatchObject({ properties: 0, activeSessions: 0 })
    })

    it('el recuento de inmuebles no depende de las sesiones', async () => {
      store().sessions = []

      expect((await getDetail(TARGET)).json()).toMatchObject({ properties: 3, activeSessions: 0 })
    })

    it('devuelve 404 si la cuenta no existe', async () => {
      const response = await getDetail('no-existe')

      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ message: 'No se ha encontrado la cuenta.' })
    })

    it('devuelve 400 con un id formado solo por espacios', async () => {
      const response = await getDetail('%20%20')

      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ message: 'Identificador de cuenta no válido.' })
    })

    // El router de Fastify limita los parámetros a 100 caracteres (maxParamLength por
    // defecto, igual que en app.ts) y responde 414 antes de llegar a la validación.
    it('acepta un id de 100 caracteres y responde 404 si no existe', async () => {
      expect((await getDetail('a'.repeat(100))).statusCode).toBe(404)
    })

    it('rechaza en el router un id de más de 100 caracteres (414)', async () => {
      expect((await getDetail('a'.repeat(101))).statusCode).toBe(414)
    })

    it('permite consultar otra cuenta propietaria', async () => {
      const response = await getDetail(OTHER_OWNER)

      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ id: OTHER_OWNER, role: 'OWNER' })
    })

    it('permite consultar la propia cuenta', async () => {
      const response = await getDetail(OWNER)

      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ id: OWNER, email: emailOf(OWNER), role: 'OWNER' })
    })

    it('devuelve por separado la protección por incidente y la suspensión administrativa', async () => {
      findUser(TARGET).adminSuspendedAt = SUSPENSION_DATE
      findUser(TARGET).adminSuspensionReason = 'Motivo de prueba'

      const suspended = (await getDetail(TARGET)).json()
      const held = (await getDetail(HELD_OWNER)).json()

      expect(suspended).toMatchObject({
        securityHoldAt: null,
        adminSuspendedAt: SUSPENSION_DATE.toISOString(),
        adminSuspensionReason: 'Motivo de prueba',
      })
      expect(held).toMatchObject({
        securityHoldAt: HOLD_DATE.toISOString(),
        adminSuspendedAt: null,
        adminSuspensionReason: null,
      })
    })

    it('no tiene rate limit, como el resto de consultas', async () => {
      for (let i = 0; i < 25; i++) {
        expect((await getDetail(TARGET)).statusCode).toBe(200)
      }
    })

    it('no modifica datos', async () => {
      const before = structuredClone(store())

      await getDetail(TARGET)

      expect(store()).toEqual(before)
    })
  })

  // ----------------------------------------------------------
  // RESUMEN
  // ----------------------------------------------------------

  describe('overview', () => {
    it('cuenta por separado las cuentas protegidas y las suspendidas', async () => {
      findUser(TARGET).adminSuspendedAt = SUSPENSION_DATE

      const response = await app.inject({ method: 'GET', url: '/api/admin/overview', headers: asOwner })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        users: 5,
        properties: 4,
        generations: 7,
        blockedUsers: 1,
        suspendedUsers: 1,
      })
    })
  })
})
