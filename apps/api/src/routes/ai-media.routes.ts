import { AI_CONNECTION_LABEL_PATTERN, AI_JOB_KINDS, AI_TRIAL_KINDS, AI_VIDEO_DURATIONS } from '@estateforge/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { discoverOpenRouterModels } from '../ai/text/openrouter-discovery.js'
import { isAiMediaError } from '../ai-media/errors.js'
import { cancelJob, createJob, expireAiJobs, getJob, jobDto, listJobs, locateJobResult, rejectJob, usageSummary } from '../ai-media/jobs.service.js'
import { cancelTrial, createTrial, lastPassedTrials, listTrials, refreshTrial, trialDto, trialPlan, trialPresets } from '../ai-media/trials.service.js'
import { adapterFor, capabilityFor, findProvider, isSelectable, listProviders, publicProvider, resolveModel } from '../ai-media/registry.js'
import { prisma } from '../db/prisma.js'
import { requireAuth } from '../middleware/auth.middleware.js'
import { isDiscoveredModel } from '../services/generation.service.js'
import { safeErrorName } from '../services/log-safety.js'
import {
  ConnectionError,
  CredentialCryptoError,
  createConnection,
  deleteConnection,
  listConnections,
  resolveConnection,
  setConnectionStatus,
  updateConnection,
  type StoredAIKeyProvider,
} from '../services/user-ai-key.service.js'
import { sendAccess } from './media.routes.js'

// IA con la API key de cada usuario (BYOK; DA-67 a DA-75, DA-82 a DA-86): catálogo, conexiones,
// preferencias y trabajos de carteles y vídeos. Todas las rutas exigen sesión y solo actúan sobre datos
// del usuario autenticado; un recurso ajeno responde igual que uno inexistente (404). Ninguna respuesta
// incluye la API key, su cifrado, claves de almacenamiento ni identificadores del proveedor, y las que
// llevan estado son no-store.

const ID = z.string().regex(/^c[a-z0-9]{20,30}$/)
const IdParams = z.object({ id: ID }).strict()
const JOB_LIMIT = { rateLimit: { max: 20, timeWindow: '15 minutes' } }
const POLL_LIMIT = { rateLimit: { max: 600, timeWindow: '15 minutes' } }
const VERIFY_LIMIT = { rateLimit: { max: 10, timeWindow: '15 minutes' } }
const PREFS_LIMIT = { rateLimit: { max: 30, timeWindow: '15 minutes' } }
const KEY_LIMIT = { rateLimit: { max: 20, timeWindow: '15 minutes' } }
const DISCOVERY_LIMIT = { rateLimit: { max: 12, timeWindow: '15 minutes' } }
const TRIAL_LIMIT = { rateLimit: { max: 10, timeWindow: '15 minutes' } }

const ApiKey = z.string().trim().min(1).max(512)
const Label = z.string().trim().max(40).regex(AI_CONNECTION_LABEL_PATTERN)
const CreateConnectionBody = z.object({ provider: z.string().max(24), label: Label.default(''), apiKey: ApiKey }).strict()
const UpdateConnectionBody = z
  .object({ label: Label.optional(), apiKey: ApiKey.optional() })
  .strict()
  .refine(body => body.label !== undefined || body.apiKey !== undefined)

const CreateJobBody = z
  .object({
    kind: z.enum(AI_JOB_KINDS),
    provider: z.string().max(40),
    model: z.string().max(120),
    connectionId: ID.optional(),
    photoIds: z.array(ID).max(25),
    durationSeconds: z.number().int().refine(value => (AI_VIDEO_DURATIONS as readonly number[]).includes(value)).optional(),
    sourceHash: z.string().regex(/^[0-9a-f]{64}$/),
    expectedVersion: z.number().int().min(0),
    idempotencyKey: z.string().regex(/^[A-Za-z0-9-]{16,64}$/),
    consent: z.literal(true),
  })
  .strict()

const Choice = z.object({ provider: z.string().max(40), model: z.string().max(120), connectionId: ID.nullable().optional() }).strict().nullable()
const PreferencesBody = z
  .object({
    text: Choice.optional(),
    poster: Choice,
    video: Choice,
    // Clasificador de seguridad externo: undefined no lo cambia; null lo quita.
    moderation: z.object({ provider: z.string().max(40), connectionId: ID.nullable().optional() }).strict().nullable().optional(),
  })
  .strict()

const VerifyBody = z.object({ acknowledgeCost: z.literal(true).optional() }).strict()

const TrialTarget = z
  .object({
    connectionId: ID,
    kind: z.enum(AI_TRIAL_KINDS),
    model: z.string().min(1).max(120),
    durationSeconds: z.number().int().min(1).max(30).optional(),
    resolution: z.string().regex(/^[0-9]{3,4}p$/).optional(),
    references: z.number().int().min(0).max(1).optional(),
  })
  .strict()
const CreateTrialBody = TrialTarget.extend({
  idempotencyKey: z.string().regex(/^[A-Za-z0-9-]{16,64}$/),
  confirmation: z
    .object({
      provider: z.string().max(40),
      model: z.string().max(120),
      connectionId: ID,
      estimatedCostMicroUsd: z.number().int().min(0).nullable(),
      acceptCharges: z.literal(true),
    })
    .strict(),
}).strict()

const userOf = (request: FastifyRequest) => request.userId!

function parseDetails(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function noStore(reply: FastifyReply) {
  return reply.header('Cache-Control', 'private, no-store').header('Vary', 'Cookie')
}

function sendError(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  if (isAiMediaError(error)) return reply.code(error.status).send({ code: error.code, message: error.message, ...(error.category && { category: error.category }) })
  if (error instanceof CredentialCryptoError) {
    return error.operation === 'encrypt'
      ? reply.code(503).send({ code: 'AI_ENCRYPTION_UNAVAILABLE', message: 'No se puede guardar la API key de forma segura en este momento.' })
      : reply.code(409).send({ code: 'AI_KEY_UNREADABLE', message: 'No se puede usar la API key guardada. Vuelve a introducirla en Ajustes.' })
  }
  if (error instanceof ConnectionError) return reply.code(409).send({ code: error.code, message: error.message })
  if (error && typeof error === 'object' && 'code' in error && (error as { code: unknown }).code === 'NOT_FOUND') return reply.code(404).send({ code: 'NOT_FOUND', message: 'No se ha encontrado el anuncio.' })
  request.log.error({ errorName: safeErrorName(error) }, 'Error en la generación con IA')
  return reply.code(500).send({ code: 'INTERNAL', message: 'No se ha podido completar la operación.' })
}

type Purpose = 'text' | 'poster' | 'video'

/**
 * Preferencia guardada. available: false si el modelo ya no está en el catálogo (retirado) o la conexión
 * ya no existe: el usuario debe elegir otro; EstateForge no lo cambia por su cuenta.
 */
function preferenceDto(provider: string | null | undefined, model: string | null | undefined, connectionId: string | null | undefined, purpose: Purpose, connectionIds: Set<string>) {
  if (!provider) return null
  const definition = findProvider(provider)
  const inCatalog = Boolean(definition?.models.some(item => item.id === model && item.purpose === purpose && isSelectable(item)))
  // Un modelo descubierto en un agregador no está en el catálogo estático: se comprueba al generar.
  const discovered = !inCatalog && Boolean(definition?.capabilities.includes('model-discovery')) && purpose === 'text'
  return { provider, model: model ?? null, connectionId: connectionId ?? null, available: (inCatalog || discovered) && (!connectionId || connectionIds.has(connectionId)), ...(discovered && { discovered: true }) }
}

async function integrations(userId: string) {
  const [connections, preference, usage, realTrials] = await Promise.all([
    listConnections(userId),
    prisma.aiMediaPreference.findUnique({ where: { userId } }),
    usageSummary(userId),
    lastPassedTrials(userId),
  ])
  const visible = new Set(listProviders().map(provider => provider.id as string))
  // Diagnóstico de la última comprobación (DA-87): sin secretos; la columna en bruto no se devuelve.
  const shown = connections.filter(connection => visible.has(connection.provider)).map(({ lastCheckDetails, ...connection }) => ({ ...connection, diagnostics: parseDetails(lastCheckDetails) }))
  const ids = new Set(shown.map(connection => connection.id))
  return {
    connections: shown,
    preferences: {
      text: preferenceDto(preference?.textProvider, preference?.textModel, preference?.textKeyId, 'text', ids),
      poster: preferenceDto(preference?.posterProvider, preference?.posterModel, preference?.posterKeyId, 'poster', ids),
      video: preferenceDto(preference?.videoProvider, preference?.videoModel, preference?.videoKeyId, 'video', ids),
      moderation: preference?.moderationProvider && preference.moderationKeyId ? { provider: preference.moderationProvider, connectionId: preference.moderationKeyId, available: ids.has(preference.moderationKeyId) && Boolean(findProvider(preference.moderationProvider)?.capabilities.includes('moderation')) } : null,
      updatedAt: preference?.updatedAt ?? null,
    },
    usage,
    /** Pruebas reales superadas por este usuario, por proveedor y modelo (DA-89). Nunca las de otros usuarios. */
    realTrials,
  }
}

/** Conexión propia por su identificador (null si no existe o es de otro usuario). */
async function ownConnection(userId: string, connectionId: string) {
  return prisma.userAIKey.findFirst({ where: { id: connectionId, userId }, select: { id: true, provider: true, label: true } })
}

async function verifyConnection(request: FastifyRequest, reply: FastifyReply, providerId: string, connectionId?: string) {
  const userId = userOf(request)
  const provider = findProvider(providerId)
  if (!provider) return reply.code(400).send({ code: 'AI_PROVIDER_UNKNOWN', message: 'Proveedor de IA no disponible.' })
  const body = VerifyBody.safeParse(request.body ?? {})
  if (!body.success) return reply.code(400).send({ code: 'AI_INVALID_REQUEST', message: 'Solicitud no válida.' })
  // DA-87: si la documentación no indica el coste de la comprobación, solo se hace con la confirmación del usuario.
  if (provider.verificationCost === 'unknown' && body.data.acknowledgeCost !== true) {
    return reply.code(409).send({ code: 'AI_VERIFY_COST_UNCONFIRMED', message: `La documentación de ${provider.name} no indica si la comprobación tiene coste. No genera contenido; confírmalo para hacerla.`, verification: provider.verification })
  }
  let resolvedId: string | undefined = connectionId
  try {
    const connection = await resolveConnection(userId, provider.id as StoredAIKeyProvider, connectionId)
    if (!connection) return reply.code(connectionId ? 404 : 409).send({ code: 'AI_NOT_CONFIGURED', message: 'No hay ninguna API key guardada para este proveedor.' })
    resolvedId = connection.id
    const checkedAt = new Date().toISOString()
    const result = await adapterFor(provider).verifyKey({ apiKey: connection.apiKey })
    if (!result.ok && result.code === 'AI_VERIFY_UNSUPPORTED') {
      // No hay comprobación sin generar: no se llama a nada y la conexión sigue «sin comprobar».
      return { provider: provider.id, connectionId: connection.id, status: 'unverified', code: result.code, message: `${provider.name} no ofrece una comprobación que no genere contenido. La clave se comprobará en la primera generación.` }
    }
    const status = result.ok ? 'verified' : result.code === 'AI_INVALID_KEY' ? 'invalid' : 'error'
    const diagnostics = diagnosticsFor(provider, result, checkedAt)
    // Solo se guarda el resultado, la fecha, un código de error normalizado y el diagnóstico (sin la respuesta).
    await setConnectionStatus(userId, provider.id as StoredAIKeyProvider, status, result.ok ? null : result.code, connection.id, diagnostics)
    return { provider: provider.id, connectionId: connection.id, status, ...(result.ok ? {} : { code: result.code }), diagnostics }
  } catch (error) {
    if (error instanceof CredentialCryptoError && error.operation === 'decrypt') await setConnectionStatus(userId, provider.id as StoredAIKeyProvider, 'error', 'AI_KEY_UNREADABLE', resolvedId)
    return sendError(request, reply, error)
  }
}

const VERIFY_MESSAGES: Record<string, string> = {
  AI_INVALID_KEY: 'El proveedor ha rechazado la API key: no es válida o se ha revocado.',
  AI_PERMISSION_DENIED: 'La API key es válida, pero la cuenta no tiene permiso (proyecto, plan, organización o región).',
  AI_PROVIDER_QUOTA: 'Sin saldo o cuota disponible, o se ha superado el límite de peticiones.',
  AI_PROVIDER_UNAVAILABLE: 'El proveedor no ha respondido o no está disponible ahora mismo.',
}

/**
 * Diagnóstico de una comprobación (DA-87): qué se ha consultado, qué modelos del catálogo lista la cuenta y
 * cuáles no, y el problema detectado. Que un modelo no aparezca en la lista es una señal, no una prueba de que
 * la cuenta no tenga acceso; y que aparezca no garantiza saldo ni permiso para generar.
 */
function diagnosticsFor(provider: NonNullable<ReturnType<typeof findProvider>>, result: Awaited<ReturnType<ReturnType<typeof adapterFor>['verifyKey']>>, checkedAt: string) {
  const catalog = provider.models.map(model => model.id)
  const listed = result.ok && result.models ? new Set(result.models) : null
  return {
    checkedAt,
    method: provider.verification,
    generatesContent: false,
    capabilities: provider.capabilities,
    ...(result.ok ? {} : { problem: result.code, message: VERIFY_MESSAGES[result.code] ?? 'No se ha podido comprobar.' }),
    ...(listed && {
      models: {
        listedByAccount: catalog.filter(id => listed.has(id)),
        notListedByAccount: catalog.filter(id => !listed.has(id)),
        accountTotal: listed.size,
      },
    }),
    generationVerified: false,
  }
}

export async function aiMediaRoutes(app: FastifyInstance) {
  // Catálogo de proveedores, fabricantes, capacidades, modelos, enlaces y precios (con su fuente y fecha).
  app.get('/api/ai/providers', { preHandler: requireAuth }, async (_request, reply) => {
    noStore(reply)
    return { providers: listProviders().map(provider => publicProvider(provider)) }
  })

  app.get('/api/account/ai-integrations', { preHandler: requireAuth }, async (request, reply) => {
    noStore(reply)
    return integrations(userOf(request))
  })

  // Conexiones BYOK: varias por proveedor, distinguidas por su etiqueta (DA-83).
  app.post('/api/account/ai-connections', { preHandler: requireAuth, config: KEY_LIMIT }, async (request, reply) => {
    noStore(reply)
    const body = CreateConnectionBody.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ code: 'AI_INVALID_REQUEST', message: 'Datos de la conexión no válidos.' })
    const provider = findProvider(body.data.provider)
    if (!provider) return reply.code(400).send({ code: 'AI_PROVIDER_UNKNOWN', message: 'Proveedor de IA no disponible.' })
    if (!provider.keyPattern.test(body.data.apiKey)) return reply.code(400).send({ code: 'AI_INVALID_REQUEST', message: `La API key no tiene el formato de ${provider.name}.` })
    try {
      const id = await createConnection(userOf(request), provider.id as StoredAIKeyProvider, body.data.apiKey, body.data.label)
      return reply.code(201).send({ id, provider: provider.id, label: body.data.label })
    } catch (error) {
      return sendError(request, reply, error)
    }
  })

  app.put('/api/account/ai-connections/:id', { preHandler: requireAuth, config: KEY_LIMIT }, async (request, reply) => {
    noStore(reply)
    const params = IdParams.safeParse(request.params)
    const body = UpdateConnectionBody.safeParse(request.body)
    if (!params.success) return reply.code(404).send({ code: 'NOT_FOUND', message: 'No se ha encontrado la conexión.' })
    if (!body.success) return reply.code(400).send({ code: 'AI_INVALID_REQUEST', message: 'Datos de la conexión no válidos.' })
    const userId = userOf(request)
    const current = await ownConnection(userId, params.data.id)
    if (!current) return reply.code(404).send({ code: 'NOT_FOUND', message: 'No se ha encontrado la conexión.' })
    const provider = findProvider(current.provider)
    if (body.data.apiKey !== undefined && provider && !provider.keyPattern.test(body.data.apiKey)) return reply.code(400).send({ code: 'AI_INVALID_REQUEST', message: `La API key no tiene el formato de ${provider.name}.` })
    try {
      await updateConnection(userId, current.id, body.data)
      return { id: current.id, provider: current.provider }
    } catch (error) {
      return sendError(request, reply, error)
    }
  })

  app.delete('/api/account/ai-connections/:id', { preHandler: requireAuth, config: KEY_LIMIT }, async (request, reply) => {
    noStore(reply)
    const params = IdParams.safeParse(request.params)
    if (!params.success || !(await deleteConnection(userOf(request), params.data.id))) return reply.code(404).send({ code: 'NOT_FOUND', message: 'No se ha encontrado la conexión.' })
    return { success: true }
  })

  // Comprobación de la conexión: operación mínima que no genera contenido.
  app.post('/api/account/ai-connections/:id/verify', { preHandler: requireAuth, config: VERIFY_LIMIT }, async (request, reply) => {
    noStore(reply)
    const params = IdParams.safeParse(request.params)
    const current = params.success ? await ownConnection(userOf(request), params.data.id) : null
    if (!current) return reply.code(404).send({ code: 'NOT_FOUND', message: 'No se ha encontrado la conexión.' })
    return verifyConnection(request, reply, current.provider, current.id)
  })

  app.post('/api/account/ai-keys/:provider/verify', { preHandler: requireAuth, config: VERIFY_LIMIT }, async (request, reply) => {
    noStore(reply)
    return verifyConnection(request, reply, String((request.params as { provider?: unknown }).provider ?? ''))
  })

  // Descubrimiento de modelos de un agregador (DA-86): lista validada y marcada como no verificada.
  app.get('/api/account/ai-connections/:id/models', { preHandler: requireAuth, config: DISCOVERY_LIMIT }, async (request, reply) => {
    noStore(reply)
    const params = IdParams.safeParse(request.params)
    const userId = userOf(request)
    const current = params.success ? await ownConnection(userId, params.data.id) : null
    if (!current) return reply.code(404).send({ code: 'NOT_FOUND', message: 'No se ha encontrado la conexión.' })
    const provider = findProvider(current.provider)
    if (!provider?.capabilities.includes('model-discovery')) return reply.code(400).send({ code: 'AI_CAPABILITY_MISSING', message: 'Este proveedor no ofrece un catálogo de modelos consultable.' })
    try {
      const connection = await resolveConnection(userId, provider.id as StoredAIKeyProvider, current.id)
      if (!connection) return reply.code(404).send({ code: 'NOT_FOUND', message: 'No se ha encontrado la conexión.' })
      const known = new Set(provider.models.map(model => model.id))
      const models = (await discoverOpenRouterModels(connection.apiKey)).filter(model => !known.has(model.id))
      return { provider: provider.id, purpose: 'text', verified: false, models, note: 'Modelos del catálogo de OpenRouter que solo generan texto y admiten salida estructurada. EstateForge no los ha verificado: consulta su precio en OpenRouter.' }
    } catch (error) {
      if (error instanceof CredentialCryptoError || error instanceof ConnectionError || isAiMediaError(error)) return sendError(request, reply, error)
      return reply.code(502).send({ code: 'AI_PROVIDER_UNAVAILABLE', message: 'No se ha podido leer el catálogo de modelos del proveedor. Siguen disponibles los modelos del catálogo de EstateForge.' })
    }
  })

  app.put('/api/account/ai-preferences', { preHandler: requireAuth, config: PREFS_LIMIT }, async (request, reply) => {
    noStore(reply)
    const body = PreferencesBody.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ code: 'AI_INVALID_REQUEST', message: 'Preferencias no válidas.' })
    const userId = userOf(request)
    try {
      const chosen: Record<Purpose, { provider: string; model: string; keyId: string | null } | null> = { text: null, poster: null, video: null }
      for (const purpose of ['text', 'poster', 'video'] as const) {
        const value = body.data[purpose]
        if (!value) continue
        const provider = findProvider(value.provider)
        if (!provider) return reply.code(400).send({ code: 'AI_PROVIDER_UNKNOWN', message: 'Proveedor de IA no disponible.' })
        if (!provider.capabilities.includes(capabilityFor(purpose))) return reply.code(400).send({ code: 'AI_CAPABILITY_MISSING', message: 'El proveedor no admite este tipo de generación.' })
        // La conexión debe ser del usuario y de ese proveedor; con varias, hay que indicar cuál.
        const connection = await resolveConnection(userId, provider.id as StoredAIKeyProvider, value.connectionId ?? null)
        if (!connection) return reply.code(409).send({ code: 'AI_NOT_CONFIGURED', message: value.connectionId ? 'La conexión elegida no existe.' : `Guarda primero una API key de ${provider.name}.` })
        let modelId: string
        const inCatalog = provider.models.some(model => model.id === value.model && model.purpose === purpose)
        if (inCatalog || purpose !== 'text' || !provider.capabilities.includes('model-discovery')) modelId = resolveModel(provider.id, value.model, purpose).model.id
        else if (await isDiscoveredModel(provider.id, value.model, connection.apiKey)) modelId = value.model
        else return reply.code(400).send({ code: 'AI_MODEL_NOT_ALLOWED', message: 'Ese modelo no está admitido para este uso.' })
        chosen[purpose] = { provider: provider.id, model: modelId, keyId: value.connectionId ? connection.id : null }
      }
      let moderation: { moderationProvider: string | null; moderationKeyId: string | null } | Record<string, never> = {}
      if (body.data.moderation === null) moderation = { moderationProvider: null, moderationKeyId: null }
      else if (body.data.moderation) {
        const provider = findProvider(body.data.moderation.provider)
        if (!provider?.capabilities.includes('moderation')) return reply.code(400).send({ code: 'AI_CAPABILITY_MISSING', message: 'Ese proveedor no ofrece un clasificador de seguridad.' })
        const connection = await resolveConnection(userId, provider.id as StoredAIKeyProvider, body.data.moderation.connectionId ?? null)
        if (!connection) return reply.code(409).send({ code: 'AI_NOT_CONFIGURED', message: `Guarda primero una API key de ${provider.name}.` })
        moderation = { moderationProvider: provider.id, moderationKeyId: connection.id }
      }
      const data = {
        textProvider: chosen.text?.provider ?? null,
        textModel: chosen.text?.model ?? null,
        textKeyId: chosen.text?.keyId ?? null,
        posterProvider: chosen.poster?.provider ?? null,
        posterModel: chosen.poster?.model ?? null,
        posterKeyId: chosen.poster?.keyId ?? null,
        videoProvider: chosen.video?.provider ?? null,
        videoModel: chosen.video?.model ?? null,
        videoKeyId: chosen.video?.keyId ?? null,
        ...moderation,
      }
      await prisma.aiMediaPreference.upsert({ where: { userId }, create: { userId, ...data }, update: data })
      return integrations(userId)
    } catch (error) {
      return sendError(request, reply, error)
    }
  })

  app.get('/api/generations/:id/ai-jobs', { preHandler: requireAuth }, async (request, reply) => {
    noStore(reply)
    const params = IdParams.safeParse(request.params)
    if (!params.success) return reply.code(404).send({ code: 'NOT_FOUND', message: 'No se ha encontrado el anuncio.' })
    try {
      await expireAiJobs(request.log, userOf(request))
      return { jobs: (await listJobs(userOf(request), params.data.id)).map(jobDto) }
    } catch (error) {
      return sendError(request, reply, error)
    }
  })

  // Crea el trabajo: solo tras el consentimiento expreso; modera la entrada y lo envía al proveedor.
  app.post('/api/generations/:id/ai-jobs', { preHandler: requireAuth, config: JOB_LIMIT }, async (request, reply) => {
    noStore(reply)
    const params = IdParams.safeParse(request.params)
    if (!params.success) return reply.code(404).send({ code: 'NOT_FOUND', message: 'No se ha encontrado el anuncio.' })
    const body = CreateJobBody.safeParse(request.body)
    if (!body.success) {
      const consent = (request.body as { consent?: unknown } | null)?.consent
      return reply.code(400).send(consent !== true ? { code: 'AI_CONSENT_REQUIRED', message: 'Confirma que aceptas enviar los datos al proveedor y el posible cargo en tu cuenta.' } : { code: 'AI_INVALID_REQUEST', message: 'Solicitud de generación no válida.' })
    }
    try {
      const job = await createJob(request.log, userOf(request), params.data.id, body.data)
      return reply.code(201).send({ job: jobDto(job) })
    } catch (error) {
      return sendError(request, reply, error)
    }
  })

  app.get('/api/ai-jobs/:id', { preHandler: requireAuth, config: POLL_LIMIT }, async (request, reply) => {
    noStore(reply)
    const params = IdParams.safeParse(request.params)
    if (!params.success) return reply.code(404).send({ code: 'AI_JOB_NOT_FOUND', message: 'No se ha encontrado la generación.' })
    try {
      return { job: jobDto(await getJob(request.log, userOf(request), params.data.id)) }
    } catch (error) {
      return sendError(request, reply, error)
    }
  })

  // Propuesta lista para revisión: URL firmada de corta duración (nunca la del proveedor).
  app.get('/api/ai-jobs/:id/result', { preHandler: requireAuth, config: POLL_LIMIT }, async (request, reply) => {
    const params = IdParams.safeParse(request.params)
    if (!params.success) return reply.code(404).send({ code: 'AI_JOB_NOT_FOUND', message: 'No se ha encontrado la generación.' })
    try {
      const { key, kind } = await locateJobResult(userOf(request), params.data.id)
      return await sendAccess(reply, key, kind === 'poster' ? 'poster' : 'video', true)
    } catch (error) {
      noStore(reply)
      return sendError(request, reply, error)
    }
  })

  app.post('/api/ai-jobs/:id/cancel', { preHandler: requireAuth, config: JOB_LIMIT }, async (request, reply) => {
    noStore(reply)
    const params = IdParams.safeParse(request.params)
    if (!params.success) return reply.code(404).send({ code: 'AI_JOB_NOT_FOUND', message: 'No se ha encontrado la generación.' })
    try {
      return { job: jobDto(await cancelJob(request.log, userOf(request), params.data.id)) }
    } catch (error) {
      return sendError(request, reply, error)
    }
  })

  app.post('/api/ai-jobs/:id/reject', { preHandler: requireAuth, config: JOB_LIMIT }, async (request, reply) => {
    noStore(reply)
    const params = IdParams.safeParse(request.params)
    if (!params.success) return reply.code(404).send({ code: 'AI_JOB_NOT_FOUND', message: 'No se ha encontrado la generación.' })
    try {
      return { job: jobDto(await rejectJob(request.log, userOf(request), params.data.id)) }
    } catch (error) {
      return sendError(request, reply, error)
    }
  })

  // Pruebas reales controladas (DA-89): plan con coste, confirmación expresa y una sola operación con datos
  // sintéticos y la conexión del propio usuario. Nunca tocan un inmueble ni un anuncio.
  app.post('/api/account/ai-trials/plan', { preHandler: requireAuth, config: TRIAL_LIMIT }, async (request, reply) => {
    noStore(reply)
    const body = TrialTarget.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ code: 'AI_INVALID_REQUEST', message: 'Datos de la prueba no válidos.' })
    try {
      return { plan: await trialPlan(userOf(request), body.data) }
    } catch (error) {
      return sendError(request, reply, error)
    }
  })

  app.post('/api/account/ai-trials', { preHandler: requireAuth, config: TRIAL_LIMIT }, async (request, reply) => {
    noStore(reply)
    const body = CreateTrialBody.safeParse(request.body)
    if (!body.success) {
      const accepted = (request.body as { confirmation?: { acceptCharges?: unknown } } | null)?.confirmation?.acceptCharges
      return reply.code(400).send(accepted !== true ? { code: 'AI_TRIAL_CONFIRMATION', message: 'Confirma la prueba después de revisar el proveedor, el modelo y el coste.' } : { code: 'AI_INVALID_REQUEST', message: 'Datos de la prueba no válidos.' })
    }
    try {
      const trial = await createTrial(request.log, userOf(request), body.data)
      return reply.code(201).send({ trial: trialDto(trial) })
    } catch (error) {
      return sendError(request, reply, error)
    }
  })

  // Las seis pruebas propuestas (DA-93): estado de cada una para este usuario, sin llamar a ningún proveedor.
  app.get('/api/account/ai-trials/presets', { preHandler: requireAuth }, async (request, reply) => {
    noStore(reply)
    return { presets: await trialPresets(userOf(request)) }
  })

  app.get('/api/account/ai-trials', { preHandler: requireAuth }, async (request, reply) => {
    noStore(reply)
    return { trials: (await listTrials(userOf(request))).map(trialDto) }
  })

  app.get('/api/account/ai-trials/:id', { preHandler: requireAuth, config: POLL_LIMIT }, async (request, reply) => {
    noStore(reply)
    const params = IdParams.safeParse(request.params)
    if (!params.success) return reply.code(404).send({ code: 'AI_TRIAL_NOT_FOUND', message: 'No se ha encontrado la prueba.' })
    try {
      return { trial: trialDto(await refreshTrial(request.log, userOf(request), params.data.id)) }
    } catch (error) {
      return sendError(request, reply, error)
    }
  })

  app.post('/api/account/ai-trials/:id/cancel', { preHandler: requireAuth, config: TRIAL_LIMIT }, async (request, reply) => {
    noStore(reply)
    const params = IdParams.safeParse(request.params)
    if (!params.success) return reply.code(404).send({ code: 'AI_TRIAL_NOT_FOUND', message: 'No se ha encontrado la prueba.' })
    try {
      return { trial: trialDto(await cancelTrial(request.log, userOf(request), params.data.id)) }
    } catch (error) {
      return sendError(request, reply, error)
    }
  })
}
