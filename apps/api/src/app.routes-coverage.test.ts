import diagnostics from 'node:diagnostics_channel'
import { EventEmitter } from 'node:events'
import { readdirSync, readFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import Fastify, { type FastifyInstance } from 'fastify'
import ts from 'typescript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// M-1 y R-1: cobertura de los siete grupos de rutas sobre la aplicación real de buildApp, con
// Prisma sustituido por un doble: sin base de datos, SMTP ni servicios externos. Las desconexiones
// usan sockets reales en localhost. La señal de cierre se emite sobre un emisor propio.

const db = vi.hoisted(() => {
  type Args = { select?: Record<string, unknown>; where?: Record<string, unknown> }
  type Hold = { key: string; match?: (args: Args) => boolean; reached: () => void; gate: Promise<void> }
  const holds: Hold[] = []
  const future = () => new Date(Date.now() + 3_600_000)
  const session = () => ({
    userId: 'user-1',
    expiresAt: future(),
    user: {
      id: 'user-1', email: 'titular@estateforge.test', role: 'OWNER', securityHoldAt: null, adminSuspendedAt: null,
      passwordResetRequiredAt: null, emailVerifiedAt: new Date(0), createdAt: new Date(0),
    },
  })
  const value = (key: string): unknown => {
    if (key === 'session.findUnique') return session()
    if (key === 'user.findUnique') return { role: 'OWNER', securityHoldAt: null }
    if (key.endsWith('.count')) return 0
    if (key.endsWith('.findMany')) return []
    return null
  }
  const call = (key: string, args: Args) => {
    const index = holds.findIndex(hold => hold.key === key && (!hold.match || hold.match(args)))
    if (index >= 0) {
      const [hold] = holds.splice(index, 1)
      hold.reached()
      return hold.gate.then(() => value(key))
    }
    return Promise.resolve(value(key))
  }
  return { holds, call }
})

// N-1: registra lo que buildApp entrega de verdad a cada plugin y ruta, se haya escrito como se haya escrito.
const effective = vi.hoisted(() => ({
  registers: [] as { plugin: unknown; options: unknown }[],
  routes: [] as { route: string; rateLimit: unknown }[],
}))

vi.mock('fastify', async importOriginal => {
  const actual = await importOriginal<typeof import('fastify')>()
  const build = (...args: unknown[]) => {
    const instance = (actual.default as unknown as (...factoryArgs: unknown[]) => FastifyInstance)(...args)
    const register = instance.register as (...registerArgs: unknown[]) => unknown
    instance.register = function (this: unknown, plugin: unknown, options: unknown) {
      effective.registers.push({ plugin, options })
      return register.call(this, plugin, options)
    } as never
    instance.addHook('onRoute', route => {
      const config = route.config as { rateLimit?: unknown } | undefined
      if (config?.rateLimit !== undefined) effective.routes.push({ route: `${String(route.method)} ${route.url}`, rateLimit: config.rateLimit })
    })
    return instance
  }
  return { ...actual, default: build, fastify: build }
})

vi.mock('./db/prisma.js', () => ({
  prisma: new Proxy({}, {
    get: (_target, model) => (typeof model === 'string' && !model.startsWith('$') && model !== 'then'
      ? new Proxy({}, { get: (_m, method) => (args: QueryArgs) => db.call(`${model}.${String(method)}`, args ?? {}) })
      : undefined),
  }),
}))
vi.mock('./services/email.service.js', () => ({ emailService: {} }))

import { buildApp } from './app.js'
import { requestWorkOf, type RequestWorkTracker } from './request-work.js'
import { registerGracefulShutdown } from './shutdown.js'

type QueryArgs = { select?: Record<string, unknown>; where?: Record<string, unknown> }

const COOKIE = `estateforge_session=${'a'.repeat(64)}`

// Los siete grupos, con las rutas declaradas por la aplicación. Una ruta nueva debe añadirse aquí.
const DECLARED: Record<string, string[]> = {
  authRoutes: [
    'POST /api/auth/register', 'POST /api/auth/login', 'POST /api/auth/forgot-password',
    'POST /api/auth/security-recovery/request', 'POST /api/auth/reset-password', 'POST /api/auth/security-recovery/complete',
    'POST /api/auth/change-email/request', 'POST /api/auth/change-email/verify', 'GET /api/auth/security-incident/:token',
    'POST /api/auth/security-incident/:token', 'POST /api/auth/change-password', 'DELETE /api/auth/account',
    'POST /api/auth/verify-email', 'POST /api/auth/verify-email/resend', 'GET /api/auth/me', 'POST /api/auth/logout',
  ],
  adminRoutes: [
    'GET /api/admin/overview', 'GET /api/admin/users', 'GET /api/admin/users/:id', 'GET /api/admin/audit',
    'POST /api/admin/users/:id/suspend', 'POST /api/admin/users/:id/unsuspend', 'POST /api/admin/users/:id/resolve-security-hold',
    'POST /api/admin/users/:id/recovery-destination', 'POST /api/admin/users/:id/resend-recovery', 'POST /api/admin/users/:id/revoke-sessions',
  ],
  aiKeyRoutes: ['GET /api/account/ai-keys', 'PUT /api/account/ai-keys/:provider', 'DELETE /api/account/ai-keys/:provider'],
  generationRoutes: [
    'POST /api/generations', 'POST /api/generations/from-property', 'GET /api/generations', 'GET /api/generations/:id',
    'PUT /api/generations/:id', 'DELETE /api/generations/:id', 'DELETE /api/generations', 'GET /api/generations/:id/publications', 'PUT /api/generations/:id/publications',
  ],
  dashboardRoutes: ['GET /api/dashboard/stats'],
  propertyRoutes: ['GET /api/properties', 'GET /api/properties/:id', 'PUT /api/properties/:id', 'DELETE /api/properties', 'DELETE /api/properties/:id'],
  health: ['GET /health'],
}

const declaredRoutes = Object.values(DECLARED).flat()

// Rutas automáticas legítimas: HEAD de cada GET (Fastify) y OPTIONS * (@fastify/cors).
const generatedRoutes = [
  ...declaredRoutes.filter(route => route.startsWith('GET ')).map(route => route.replace('GET ', 'HEAD ')),
  'OPTIONS *',
]

// Listas exactas de hooks admitidas por ruta y etapa, con los nombres que muestra Fastify. Cada hook
// está clasificado en plan_y_trazabilidad.md, apartado 9. Rate-limit y el onSend global se muestran
// como anonymous(): por eso se compara la lista completa y se fija cuántas rutas llevan rate-limit.
const ALLOWED_HOOKS: Record<string, string[][]> = {
  onRequest: [['handleCors()'], ['handleCors()', 'anonymous()']],
  preHandler: [['wrappedStage()']],
  onSend: [['anonymous()'], ['anonymous()', 'headRouteOnSendHandler()']],
}
const RATE_LIMITED_ROUTES = 23

type RouteDump = { route: string; hooks: Record<string, string[]> }

// Convierte el árbol de printRoutes({ commonPrefix: false, includeHooks: true }) en rutas completas.
function parseRoutes(text: string): RouteDump[] {
  const routes: RouteDump[] = []
  const stack: { width: number; path: string }[] = []
  // Una línea agrupa los métodos con los mismos hooks: se aplican a todos ellos.
  let current: RouteDump[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const hook = /•\s+\((\w+)\)\s+(\[.*\])\s*$/.exec(line)
    if (hook) {
      for (const entry of current) entry.hooks[hook[1]] = JSON.parse(hook[2]) as string[]
      continue
    }
    const match = /^([\s│├└─]*)(.*)$/.exec(line)
    if (!match) continue
    const width = match[1].length
    const content = match[2]
    const withMethods = /^(.*) \(([A-Z, ]+)\)$/.exec(content)
    const segment = withMethods ? withMethods[1] : content
    while (stack.length > 0 && stack[stack.length - 1].width >= width) stack.pop()
    const parent = stack.length > 0 ? stack[stack.length - 1].path : ''
    const path = parent + segment
    stack.push({ width, path })
    if (withMethods) {
      current = withMethods[2].split(', ').map(method => ({ route: `${method} ${path}`, hooks: {} }))
      routes.push(...current)
    }
  }
  return routes
}

function routerDump(app: FastifyInstance) {
  return parseRoutes(app.printRoutes({ commonPrefix: false, includeHooks: true }))
}

// N-5: una espera con límite propio, muy por debajo del de Vitest, que dice qué no llegó.
async function within<T>(pending: PromiseLike<T>, what: string, ms = 2_000): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const limit = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${what}: no llegó en ${ms} ms`)), ms)
  })
  try {
    return await Promise.race([pending, limit])
  } finally {
    clearTimeout(timer)
  }
}

// Espera a que termine una petición ya liberada, sin ocultar el fallo original de la prueba.
const settled = (response: Promise<unknown> | undefined) =>
  within(Promise.resolve(response).catch(() => undefined), 'la respuesta tras liberar', 1_000).catch(() => undefined)

function hold(key: string, match?: (args: QueryArgs) => boolean) {
  let reached: () => void = () => undefined
  const started = within(new Promise<void>(resolve => { reached = resolve }), `la consulta ${key}`, 1_500)
  // Si nadie llega a esperarla, su rechazo no debe convertirse en un rechazo sin atender.
  started.catch(() => undefined)
  let release: () => void = () => undefined
  const gate = new Promise<void>(resolve => { release = resolve })
  db.holds.push({ key, match, reached, gate })
  return { started, release }
}

// /api/auth/me consulta la sesión completa; requireAuth, solo su userId.
const isMeQuery = (args: QueryArgs) => args.select?.userId === undefined
// El panel de administración hace su propio property.count, sin filtro.
const isOwnCount = (args: QueryArgs) => args.where !== undefined

const inGroups: { group: string; url: string; key: string; match?: (args: QueryArgs) => boolean }[] = [
  { group: 'authRoutes', url: '/api/auth/me', key: 'session.findUnique', match: isMeQuery },
  { group: 'adminRoutes', url: '/api/admin/overview', key: 'user.count' },
  { group: 'aiKeyRoutes', url: '/api/account/ai-keys', key: 'userAIKey.findMany' },
  { group: 'generationRoutes', url: '/api/generations', key: 'generation.findMany' },
  { group: 'dashboardRoutes', url: '/api/dashboard/stats', key: 'property.count', match: isOwnCount },
  { group: 'propertyRoutes', url: '/api/properties', key: 'property.findMany' },
]

let app: FastifyInstance
let work: RequestWorkTracker
let built: { cors: unknown; rateLimit: unknown; corsCalls: number; rateLimitCalls: number; routes: typeof effective.routes }

beforeEach(async () => {
  db.holds.length = 0
  effective.registers.length = 0
  effective.routes.length = 0
  app = await buildApp()
  const optionsOf = (plugin: unknown) => effective.registers.filter(entry => entry.plugin === plugin).map(entry => entry.options)
  built = {
    cors: optionsOf(cors)[0], rateLimit: optionsOf(rateLimit)[0],
    corsCalls: optionsOf(cors).length, rateLimitCalls: optionsOf(rateLimit).length, routes: [...effective.routes],
  }
  const tracker = requestWorkOf(app)
  if (!tracker) throw new Error('buildApp no instaló el seguimiento')
  work = tracker
})

let clients: { destroy(): unknown }[] = []

// Los clientes se cierran antes: una prueba que falle no debe dejar app.close() esperando.
afterEach(async () => {
  for (const client of clients) client.destroy()
  clients = []
  await within(app.close(), 'app.close en la limpieza', 4_000)
  expect(db.holds).toEqual([])
})

describe('censo de rutas', () => {
  it('coincide con las 45 rutas declaradas por grupo', () => {
    expect(Object.fromEntries(Object.entries(DECLARED).map(([group, routes]) => [group, routes.length]))).toEqual({
      authRoutes: 16, adminRoutes: 10, aiKeyRoutes: 3, generationRoutes: 9, dashboardRoutes: 1, propertyRoutes: 5, health: 1,
    })
    expect(new Set(declaredRoutes).size).toBe(45)
  })
})

describe('guarda del inventario', () => {
  it('toda ruta del router está inventariada y clasificada: declarada o generada', async () => {
    await app.ready()
    const router = routerDump(app).map(entry => entry.route).sort()
    const inventory = work.routes().map(route => `${route.method} ${route.url}`).sort()
    const expected = [...declaredRoutes, ...generatedRoutes].sort()

    // El router es independiente del seguimiento: detecta rutas instaladas fuera de su ámbito.
    expect(router).toEqual(expected)
    expect(inventory).toEqual(expected)
  })

  it('todos los manejadores declarados son async (contrato PD-1) y solo declaran preHandler', () => {
    const declared = new Set(declaredRoutes)
    const entries = work.routes().filter(route => declared.has(`${route.method} ${route.url}`))

    expect(entries).toHaveLength(45)
    expect(entries.filter(route => !route.handlerIsAsync)).toEqual([])
    expect(entries.filter(route => route.routeHooks.some(hook => hook !== 'preHandler'))).toEqual([])
  })

  it('los hooks de petición de cada ruta están en la lista permitida', async () => {
    await app.ready()
    const routes = routerDump(app)
    const unexpected = routes.flatMap(entry => Object.entries(entry.hooks)
      .filter(([stage, names]) => !ALLOWED_HOOKS[stage]?.some(list => JSON.stringify(list) === JSON.stringify(names)))
      .map(([stage, names]) => `${entry.route} ${stage} ${names.join(',')}`))

    expect(unexpected).toEqual([])
    expect(routes.filter(entry => entry.hooks.onRequest?.length === 2)).toHaveLength(RATE_LIMITED_ROUTES)
  })
})

describe('PD-3 y PD-6: hooks globales excluidos', () => {
  // Política (PD-6): si se introduce un almacén externo, hay que revisar y adaptar el seguimiento de
  // onRequest antes de aprobar ese cambio. @fastify/rate-limit usa LocalStore si no recibe store ni redis.
  it('rate-limit: las opciones de buildApp son exactamente las revisadas', () => {
    const calls = sources().flatMap(({ node }) => descendants(node).filter(ts.isCallExpression)
      .filter(call => calleeName(call) === 'register' && call.arguments[0]?.getText() === 'rateLimit'))
    expect(calls).toHaveLength(1)
    const options = calls[0].arguments[1]

    expect(options && ts.isObjectLiteralExpression(options), 'las opciones deben ser un objeto literal').toBe(true)
    const properties = (options as ts.ObjectLiteralExpression).properties
    expect(properties.map(property => (ts.isPropertyAssignment(property) ? propertyName(property.name) : property.getText())))
      .toEqual(['global', 'max', 'timeWindow'])
  })

  it('rate-limit: ninguna configuración, ni de ruta, declara store o redis', () => {
    const found = sources().flatMap(({ file, node }) => descendants(node)
      .filter(ts.isObjectLiteralElementLike)
      .filter(element => ['store', 'redis'].includes(propertyName(element.name) ?? ''))
      .map(element => `${file}: ${element.getText()}`))

    expect(found).toEqual([])
  })

  // N-1: lo que se comprueba es el valor que recibe cada plugin, no cómo está escrito.
  it('configuración efectiva: cors recibe exactamente las opciones revisadas', () => {
    expect(built.corsCalls).toBe(1)
    expect(Object.keys(built.cors as object).sort()).toEqual(['credentials', 'methods', 'origin'])
  })

  it('configuración efectiva: origin de cors es síncrono y responde antes de devolver', () => {
    const { origin } = built.cors as { origin: (value: string | undefined, callback: () => void) => unknown }

    expect(typeof origin).toBe('function')
    expect(origin.constructor.name).toBe('Function')
    const source = ts.createSourceFile('origin.ts', `(${origin.toString()})`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const parsed = (source.statements[0] as ts.ExpressionStatement).expression as ts.ParenthesizedExpression
    expect(executionMode(parsed.expression)).toBe('callback')
    for (const value of [undefined, process.env.CORS_ORIGIN, 'https://otro.example']) {
      let called = 0
      const returned = origin(value, () => { called += 1 })
      expect({ value, called, returned }).toEqual({ value, called: 1, returned: undefined })
    }
  })

  it('configuración efectiva: rate-limit global recibe exactamente las opciones revisadas', () => {
    expect(built.rateLimitCalls).toBe(1)
    expect(built.rateLimit).toStrictEqual({ global: false, max: 20, timeWindow: '1 minute' })
  })

  it('configuración efectiva: cada config.rateLimit de ruta solo fija max y timeWindow estáticos', () => {
    const wrong = built.routes.filter(({ rateLimit: options }) => {
      const entries = Object.entries(options as object)
      return !entries.every(([key, value]) => (key === 'max' && typeof value === 'number')
        || (key === 'timeWindow' && ['number', 'string'].includes(typeof value)))
    }).map(entry => entry.route)

    expect(wrong).toEqual([])
    expect(built.routes.length).toBeGreaterThanOrEqual(RATE_LIMITED_ROUTES)
  })

  it('cors y rate-limit, con la misma configuración, no ceden a una macrotarea antes del manejador', async () => {
    const mirror = Fastify({ logger: false })
    let macrotask = false
    mirror.addHook('onRequest', (_q, _r, done) => {
      setImmediate(() => { macrotask = true })
      done()
    })
    await mirror.register(cors, built.cors as never)
    await mirror.register(rateLimit, built.rateLimit as never)
    mirror.get('/x', { config: { rateLimit: built.routes[0].rateLimit as never } }, async () => ({ macrotask }))

    const response = await within(mirror.inject({ method: 'GET', url: '/x', headers: { origin: 'http://localhost:5173' } }), 'la respuesta')
    await mirror.close()

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ macrotask: false })
  })
})

// T8-1: puntos de entrada de Fastify por los que puede ejecutarse trabajo de una petición fuera de
// las rutas y de los hooks que muestra printRoutes. Clasificación: plan_y_trazabilidad.md, apartado 10.
const ENTRY_APIS = new Set([
  'addHook', 'register', 'setErrorHandler', 'setNotFoundHandler', 'addContentTypeParser', 'setValidatorCompiler',
  'setSerializerCompiler', 'setSchemaController', 'setReplySerializer', 'setSchemaErrorFormatter', 'setGenReqId',
  'setChildLoggerFactory', 'addConstraintStrategy', 'addHttpMethod',
])
const ENTRY_OPTIONS = new Set([
  'errorHandler', 'validatorCompiler', 'serializerCompiler', 'schemaErrorFormatter', 'constraints', 'onRequest',
  'preParsing', 'preValidation', 'preSerialization', 'onSend', 'onResponse', 'onError', 'onTimeout', 'onRequestAbort',
])
const APPLICATION_HOOKS = new Set(['onRoute', 'onRegister', 'onReady', 'onListen', 'preClose', 'onClose'])

// Entradas revisadas: «archivo | punto de entrada | modo», con su clase de trabajo.
const REVIEWED_ENTRIES: Record<string, 'peticion' | 'aplicacion' | 'plugin' | 'configuracion'> = {
  'app.ts | Fastify:bodyLimit | configuracion': 'configuracion',
  'app.ts | Fastify:logger | configuracion': 'configuracion',
  'app.ts | addHook:onSend | callback': 'peticion',
  'app.ts | register:adminRoutes | referencia': 'plugin',
  'app.ts | register:aiKeyRoutes | referencia': 'plugin',
  'app.ts | register:authRoutes | referencia': 'plugin',
  'app.ts | register:cors | referencia': 'plugin',
  'app.ts | register:dashboardRoutes | referencia': 'plugin',
  'app.ts | register:generationRoutes | referencia': 'plugin',
  'app.ts | register:propertyRoutes | referencia': 'plugin',
  'app.ts | register:rateLimit | referencia': 'plugin',
  'app.ts | setErrorHandler | sincrona': 'peticion',
  'request-work.ts | addHook:onRoute | sincrona': 'aplicacion',
  'routes/auth.routes.ts | addHook:onClose | async': 'aplicacion',
  'server.ts | register:readinessRoutes | referencia': 'plugin',
}

const SOURCE_DIR = fileURLToPath(new URL('.', import.meta.url))

function productionFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = `${dir}${entry.name}`
    if (entry.isDirectory()) return entry.name === 'generated' ? [] : productionFiles(`${path}/`)
    return /\.[cm]?ts$/.test(entry.name) && !/\.(test|d)\.[cm]?ts$/.test(entry.name) ? [path] : []
  })
}

function sources() {
  return productionFiles(SOURCE_DIR).map(path => ({
    file: path.slice(SOURCE_DIR.length),
    node: ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
  }))
}

function descendants(root: ts.Node): ts.Node[] {
  const nodes: ts.Node[] = []
  const visit = (node: ts.Node) => { nodes.push(node); ts.forEachChild(node, visit) }
  visit(root)
  return nodes
}

// N-8: nombre de una propiedad, escrita como identificador, cadena o clave calculada literal.
function propertyName(name: ts.Node | undefined): string | undefined {
  if (!name) return undefined
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text
  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) return name.expression.text
  return undefined
}

function accessedName(node: ts.Node): string | undefined {
  if (ts.isPropertyAccessExpression(node)) return node.name.text
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) return node.argumentExpression.text
  return undefined
}

function calleeName(call: ts.CallExpression): string | undefined {
  return accessedName(call.expression)
}

const isFunctionNode = (node: ts.Node): node is ts.ArrowFunction | ts.FunctionExpression =>
  ts.isArrowFunction(node) || ts.isFunctionExpression(node)

// Forma visible en el código. Es estática: no ve lo que hagan las funciones a las que se llama.
function executionMode(node: ts.Node | undefined): string {
  if (!node || !isFunctionNode(node)) return 'referencia'
  if (node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)) return 'async'
  const pending = descendants(node.body).some(child => ts.isAwaitExpression(child)
    || (ts.isNewExpression(child) && child.expression.getText() === 'Promise')
    || ['then', 'catch', 'finally'].includes(accessedName(child) ?? '')
    || (ts.isCallExpression(child) && ['setTimeout', 'setImmediate', 'setInterval', 'queueMicrotask', 'fetch'].includes(child.expression.getText())))
  if (pending) return 'promesa'
  return node.parameters.some(parameter => /^_?(done|next|cb|callback)$/.test(parameter.name.getText())) ? 'callback' : 'sincrona'
}

function entryPoints() {
  return sources().flatMap(({ file, node }) => descendants(node).flatMap(child => {
    const entry = (label: string, mode: string) => [`${file} | ${label} | ${mode}`]
    const name = accessedName(child)
    if (name && ENTRY_APIS.has(name)) {
      const call = ts.isCallExpression(child.parent) && child.parent.expression === child ? child.parent : undefined
      if (!call) return entry(`${name}:alias`, 'referencia')
      const callback = [...call.arguments].reverse().find(isFunctionNode)
      if (name === 'addHook' || name === 'register') {
        const first = call.arguments[0]
        return entry(`${name}:${first && ts.isStringLiteralLike(first) ? first.text : first?.getText().slice(0, 40)}`, executionMode(callback))
      }
      return entry(name, executionMode(callback))
    }
    if (ts.isBindingElement(child) && ENTRY_APIS.has((child.propertyName ?? child.name).getText())) {
      return entry(`${(child.propertyName ?? child.name).getText()}:alias`, 'referencia')
    }
    if (ts.isObjectLiteralElementLike(child) && ENTRY_OPTIONS.has(propertyName(child.name) ?? '')) {
      return entry(`opcion:${propertyName(child.name)}`, executionMode(ts.isPropertyAssignment(child) ? child.initializer : child))
    }
    if (ts.isCallExpression(child) && child.expression.getText() === 'Fastify') {
      const options = child.arguments[0]
      if (!options || !ts.isObjectLiteralExpression(options)) return entry('Fastify:opciones', 'no-literal')
      return options.properties.flatMap(property => entry(`Fastify:${propertyName(property.name) ?? property.getText()}`, 'configuracion'))
    }
    return []
  })).sort()
}

function onSendHook() {
  const source = sources().find(({ file }) => file === 'app.ts')
  const calls = source ? descendants(source.node).filter(ts.isCallExpression)
    .filter(call => calleeName(call) === 'addHook' && call.arguments[0]?.getText() === "'onSend'") : []
  expect(calls).toHaveLength(1)
  return calls[0].arguments[1]
}

describe('T8-1: puntos de entrada de Fastify', () => {
  it('cada punto de entrada del código de producción está revisado y mantiene su modo', () => {
    expect(entryPoints()).toEqual(Object.keys(REVIEWED_ENTRIES).sort())
  })

  it('un hook de petición revisado no es asíncrono y uno de aplicación es de ciclo de vida', () => {
    const hooks = Object.entries(REVIEWED_ENTRIES).filter(([entry]) => entry.includes('| addHook:'))
    const misclassified = hooks.filter(([entry, kind]) => {
      const [, label, mode] = entry.split(' | ')
      const application = APPLICATION_HOOKS.has(label.slice('addHook:'.length))
      return application ? kind !== 'aplicacion' : kind !== 'peticion' || ['async', 'promesa'].includes(mode)
    })

    expect(misclassified).toEqual([])
    expect(hooks.length).toBeGreaterThan(0)
  })
})

describe('T8-2: contrato del onSend global', () => {
  it('es un callback síncrono que solo pone cabeceras literales y llama a done al final', () => {
    const hook = onSendHook()

    expect(hook && isFunctionNode(hook), 'debe ser una función en línea').toBe(true)
    const fn = hook as ts.ArrowFunction
    expect(executionMode(fn)).toBe('callback')
    expect(fn.parameters.map(parameter => parameter.name.getText())).toEqual(['_request', 'reply', '_payload', 'done'])
    expect(ts.isBlock(fn.body), 'el cuerpo debe ser un bloque').toBe(true)
    const statements = [...(fn.body as ts.Block).statements]
    const last = statements.pop()

    expect(last?.getText()).toBe('done()')
    expect(statements.length).toBeGreaterThan(0)
    expect(statements.filter(statement => !ts.isExpressionStatement(statement)
      || !ts.isCallExpression(statement.expression)
      || statement.expression.expression.getText() !== 'reply.header'
      || !statement.expression.arguments.every(ts.isStringLiteralLike)).map(statement => statement.getText())).toEqual([])
  })

  it.each([
    ['GET', '/health', 200],
    ['HEAD', '/health', 200],
    ['GET', '/no-existe', 404],
    ['POST', '/api/auth/verify-email/resend', 400],
  ] as const)('%s %s conserva las cabeceras de seguridad', async (method, url, status) => {
    const response = await within(app.inject({ method, url }), 'la respuesta')

    expect(response.statusCode).toBe(status)
    expect(response.headers).toMatchObject({
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    })
  })
})

describe('cobertura de los siete grupos', () => {
  it.each(inGroups)('$group: el manejador pendiente cuenta y se libera', async ({ url, key, match }) => {
    const pending = hold(key, match)
    let response: Promise<{ statusCode: number }> | undefined
    try {
      response = app.inject({ method: 'GET', url, headers: { cookie: COOKIE } })
      await pending.started
      expect(work.running()).toBe(1)
    } finally {
      pending.release()
      await settled(response)
    }
    expect((await within(Promise.resolve(response), 'la respuesta tras liberar', 1_000))?.statusCode).toBeLessThan(500)
    await vi.waitFor(() => expect(work.running()).toBe(0))
  })

  it.each(inGroups.filter(route => route.group !== 'authRoutes'))('$group: su preHandler pendiente cuenta', async ({ url }) => {
    const pending = hold('session.findUnique')
    let response: Promise<{ statusCode: number }> | undefined
    try {
      response = app.inject({ method: 'GET', url, headers: { cookie: COOKIE } })
      await pending.started
      expect(work.running()).toBe(1)
    } finally {
      pending.release()
      await settled(response)
    }
    await vi.waitFor(() => expect(work.running()).toBe(0))
  })

  it('health: el manejador cuenta mientras su promesa no se ha resuelto', async () => {
    const seen: number[] = []
    const channel = diagnostics.channel('tracing:fastify.request.handler:end')
    const listener = () => { seen.push(work.running()) }
    channel.subscribe(listener)
    try {
      const response = await within(app.inject({ method: 'GET', url: '/health' }), 'la respuesta')
      expect(response.statusCode).toBe(200)
    } finally {
      channel.unsubscribe(listener)
    }
    expect(seen).toEqual([1])
    await vi.waitFor(() => expect(work.running()).toBe(0))
  })

  it('admin: requireOwner, con su consulta propia, también cuenta', async () => {
    const pending = hold('user.findUnique')
    let response: Promise<unknown> | undefined
    try {
      response = app.inject({ method: 'GET', url: '/api/admin/overview', headers: { cookie: COOKIE } })
      await pending.started
      expect(work.running()).toBe(1)
    } finally {
      pending.release()
      await settled(response)
    }
    await vi.waitFor(() => expect(work.running()).toBe(0))
  })
})

describe('concurrencia y desconexiones con la aplicación real', () => {
  function client(port: number, path: string) {
    const request = httpRequest({ port, host: '127.0.0.1', path, agent: false, headers: { cookie: COOKIE } })
    request.on('error', () => undefined)
    request.end()
    clients.push(request)
    return request
  }

  it('grupos distintos simultáneos: desconectados, siguen contados hasta terminar', async () => {
    const pending = inGroups.map(route => hold(route.key, route.match))
    await app.listen({ port: 0, host: '127.0.0.1' })
    const { port } = app.server.address() as AddressInfo
    const clients = inGroups.map(route => client(port, route.url))
    try {
      await Promise.all(pending.map(entry => entry.started))
      expect(work.running()).toBe(6)

      for (const request of clients) request.destroy()
      await new Promise(resolve => setTimeout(resolve, 60))
      expect(work.running()).toBe(6)
    } finally {
      for (const entry of pending) entry.release()
    }
    await vi.waitFor(() => expect(work.running()).toBe(0))
  })

  it('cierre con trabajo activo de varios grupos tras desconectarse los clientes', async () => {
    const pending = inGroups.map(route => hold(route.key, route.match))
    const signals = new EventEmitter()
    const exit = vi.fn()
    registerGracefulShutdown(app, { target: signals, exit, timeoutMs: 3_000, drainMs: 1_500 })
    await app.listen({ port: 0, host: '127.0.0.1' })
    const { port } = app.server.address() as AddressInfo
    const clients = inGroups.map(route => client(port, route.url))
    try {
      await Promise.all(pending.map(entry => entry.started))
      for (const request of clients) request.destroy()
      await new Promise(resolve => setTimeout(resolve, 60))

      signals.emit('SIGTERM')
      await new Promise(resolve => setTimeout(resolve, 80))
      expect(exit).not.toHaveBeenCalled()
      expect(work.running()).toBe(6)
    } finally {
      for (const entry of pending) entry.release()
    }
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0))
    expect(work.running()).toBe(0)
  })
})
