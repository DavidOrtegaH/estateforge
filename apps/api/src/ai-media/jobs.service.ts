import {
  AI_ACTIVE_TRIAL_STATUSES,
  AI_JOB_STATUS_LABELS,
  AI_MODERATION_MESSAGES,
  AI_POSTER_MAX_REFERENCE_PHOTOS,
  AI_READY_TTL_MS,
  AI_RESULT_MAX_BYTES,
  AI_JOB_TIMEOUT_MS,
  AI_VIDEO_DURATIONS,
  type AiJobKind,
  type AiModerationCategory,
} from '@estateforge/shared'
import type { FastifyBaseLogger } from 'fastify'

import { prisma } from '../db/prisma.js'
import type { Prisma } from '../generated/prisma/client.js'
import { sniffImage, sniffVideo } from '../media/file-signatures.js'
import { getMediaSource, type MediaSource } from '../media/listing-media.service.js'
import { lockUser } from '../media/quota.js'
import { drainStorageCleanup } from '../media/storage-cleanup.js'
import { ConnectionError, CredentialCryptoError, resolveConnection, setConnectionStatus, type StoredAIKeyProvider } from '../services/user-ai-key.service.js'
import { safeErrorName } from '../services/log-safety.js'
import { aiResultKey, getStorage } from '../storage/object-storage.js'
import { inspectVideoContainer } from '@estateforge/shared'
import type { AiProviderAdapter, InputImage, OperationState, ProviderContext } from './adapter.js'
import { AiMediaError, PROVIDER_MESSAGES, isAiMediaError, type AiErrorCode } from './errors.js'
import { checkTextPolicy } from './policy.js'
import { buildPosterPrompt, buildVideoPrompt } from './prompts.js'
import { adapterFor, estimateCostMicroUsd, findProvider, resolveModel, type ProviderDefinition } from './registry.js'
import { stripImageMetadata } from './sanitize.js'

// Trabajos de generación con IA (DA-71). Persistentes en PostgreSQL y avanzados por sondeo: cada consulta
// del navegador (GET /api/ai-jobs/:id) pregunta al proveedor si toca, sin procesos en segundo plano ni
// peticiones bloqueadas durante minutos (compatible con funciones de Vercel). Cada transición se reclama
// con updateMany condicionado: dos consultas simultáneas no la ejecutan dos veces. Nunca se repite un envío
// al proveedor que pudo haberse aceptado (no se duplican cargos).
//
// Ciclo: pending → submitted → processing → moderating → ready → (revisión del usuario) accepted | rejected.
// Salidas: blocked (moderación), failed, cancelled, expired. El resultado es temporal y privado; al cerrar
// el trabajo, un trigger lo encola para borrarlo. Solo «ready» puede convertirse en material del anuncio, y
// solo al guardar la composición final (listing-media.service.ts).

type Tx = Prisma.TransactionClient

const num = (value: string | undefined, fallback: number) => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}
export const aiLimits = () => ({
  concurrent: num(process.env.AI_MEDIA_MAX_CONCURRENT, 2),
  daily: num(process.env.AI_MEDIA_DAILY_LIMIT, 20),
  monthly: num(process.env.AI_MEDIA_MONTHLY_LIMIT, 200),
})
const POLL_MIN_INTERVAL_MS = 2_000
const MAX_POLLS = 900
const STALE_MS = 10 * 60 * 1000
const REFERENCE_MAX_BYTES = 4 * 1024 * 1024

const JOB_SELECT = {
  id: true,
  userId: true,
  generationId: true,
  propertyId: true,
  kind: true,
  provider: true,
  model: true,
  status: true,
  sourceHash: true,
  expectedVersion: true,
  params: true,
  providerOperationId: true,
  resultKey: true,
  resultContentType: true,
  resultSize: true,
  moderationStatus: true,
  moderationCategory: true,
  failureCode: true,
  estimatedCostMicroUsd: true,
  pollCount: true,
  lastPolledAt: true,
  submittedAt: true,
  completedAt: true,
  expiresAt: true,
  createdAt: true,
} as const
export type AiJobRow = Prisma.AiMediaJobGetPayload<{ select: typeof JOB_SELECT }>

export interface JobParams {
  photoIds: string[]
  durationSeconds?: number
  /** Conexión del usuario con la que se generó (DA-83). Sin ella: la principal del proveedor. */
  connectionId?: string
  /** Clasificador de seguridad externo usado (DA-85), cuando el proveedor de generación no trae uno. */
  moderation?: { provider: string; connectionId: string }
}

export function parseParams(raw: string): JobParams {
  try {
    const value = JSON.parse(raw) as JobParams
    const moderation = value.moderation && typeof value.moderation.provider === 'string' && typeof value.moderation.connectionId === 'string' ? { provider: value.moderation.provider, connectionId: value.moderation.connectionId } : undefined
    return {
      photoIds: Array.isArray(value.photoIds) ? value.photoIds.filter(id => typeof id === 'string') : [],
      ...(typeof value.durationSeconds === 'number' && { durationSeconds: value.durationSeconds }),
      ...(typeof value.connectionId === 'string' && { connectionId: value.connectionId }),
      ...(moderation && { moderation }),
    }
  } catch {
    return { photoIds: [] }
  }
}

function messageFor(job: AiJobRow): string | null {
  if (job.status === 'blocked' && job.moderationCategory) return AI_MODERATION_MESSAGES[job.moderationCategory as AiModerationCategory] ?? AI_MODERATION_MESSAGES.provider_safety_block
  if (job.status === 'failed' && job.failureCode) {
    if (job.failureCode === 'MODERATION_UNAVAILABLE') return AI_MODERATION_MESSAGES.moderation_unavailable
    if (job.failureCode === 'AI_INTERRUPTED') return 'La generación se interrumpió antes de terminar. No se ha guardado nada; puedes volver a intentarlo.'
    if (job.failureCode === 'AI_NOT_CONFIGURED') return 'La API key de este proveedor ya no está configurada.'
    return PROVIDER_MESSAGES[job.failureCode as keyof typeof PROVIDER_MESSAGES] ?? 'La generación no se ha podido completar.'
  }
  if (job.status === 'expired') return 'La propuesta ha caducado sin revisarse y se ha eliminado.'
  return null
}

/** Lo que ve el navegador de un trabajo (sin claves de almacenamiento ni identificadores del proveedor). */
export function jobDto(job: AiJobRow) {
  const params = parseParams(job.params)
  return {
    id: job.id,
    generationId: job.generationId,
    kind: job.kind,
    provider: job.provider,
    model: job.model,
    status: job.status,
    statusLabel: AI_JOB_STATUS_LABELS[job.status as keyof typeof AI_JOB_STATUS_LABELS] ?? job.status,
    moderationStatus: job.moderationStatus,
    moderationCategory: job.moderationCategory,
    message: messageFor(job),
    photoIds: params.photoIds,
    durationSeconds: params.durationSeconds ?? null,
    estimatedCostUsd: job.estimatedCostMicroUsd === null ? null : job.estimatedCostMicroUsd / 1_000_000,
    resultReady: job.status === 'ready',
    resultContentType: job.status === 'ready' ? job.resultContentType : null,
    createdAt: job.createdAt,
    submittedAt: job.submittedAt,
    completedAt: job.completedAt,
    expiresAt: job.expiresAt,
  }
}

async function readAll(stream: NodeJS.ReadableStream, max: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    total += chunk.length
    if (total > max) throw new AiMediaError('AI_INVALID_REQUEST', 'Una fotografía de referencia supera el tamaño máximo.')
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

/** Fotografías de referencia: propias, sin metadatos. Carteles: miniaturas (solo estilo); vídeo: originales. */
async function loadReferences(userId: string, propertyId: string, photoIds: string[], kind: AiJobKind): Promise<InputImage[]> {
  const rows = await prisma.propertyPhoto.findMany({
    where: { id: { in: photoIds }, propertyId, property: { userId } },
    select: { id: true, storageKey: true, contentType: true, thumbKey: true },
  })
  const storage = await getStorage()
  const images: InputImage[] = []
  for (const id of photoIds) {
    const row = rows.find(item => item.id === id)
    if (!row) throw new AiMediaError('AI_INVALID_REQUEST', 'Solo se pueden usar fotografías de este inmueble.')
    const useThumb = kind === 'poster' && row.thumbKey
    const key = useThumb ? row.thumbKey! : row.storageKey
    const mimeType = (useThumb ? 'image/jpeg' : row.contentType) as InputImage['mimeType']
    const object = await storage.get(key)
    if (!object) throw new AiMediaError('AI_INVALID_REQUEST', 'No se ha encontrado una de las fotografías.')
    const clean = stripImageMetadata(await readAll(object.stream, REFERENCE_MAX_BYTES), mimeType)
    if (!clean) throw new AiMediaError('AI_INVALID_REQUEST', 'Una fotografía tiene un formato no admitido.')
    images.push({ mimeType, data: clean })
  }
  return images
}

/** Textos del anuncio que se mostrarán en el material: se moderan (no se envían al modelo generador). */
function displayedText(source: MediaSource): Record<string, string> {
  return {
    titulo: source.generation.title,
    descripcion: source.generation.description,
    destacados: source.generation.highlights.join(' · '),
    llamada_a_la_accion: source.generation.callToAction ?? '',
    titulo_del_inmueble: source.property.title ?? '',
  }
}

interface Connection {
  id: string
  apiKey: string
}

/** Conexión del propio usuario para un proveedor (la indicada, la de la preferencia, la única o la principal). */
export async function connectionFor(userId: string, provider: ProviderDefinition, connectionId?: string | null, preferredId?: string | null): Promise<Connection> {
  let connection
  try {
    connection = await resolveConnection(userId, provider.id as StoredAIKeyProvider, connectionId, preferredId)
  } catch (error) {
    if (error instanceof CredentialCryptoError) throw new AiMediaError('AI_KEY_UNREADABLE', 'No se puede usar la API key guardada (no se puede descifrar). Vuelve a introducirla en Ajustes.')
    if (error instanceof ConnectionError) throw new AiMediaError('AI_CONNECTION_AMBIGUOUS', `Tienes varias conexiones de ${provider.name}. Elige cuál quieres usar.`)
    throw error
  }
  if (!connection) throw new AiMediaError('AI_NOT_CONFIGURED', connectionId ? `La conexión elegida de ${provider.name} ya no existe. Elige otra.` : `Configura una API key de ${provider.name} en Ajustes para usar la generación con IA.`)
  return { id: connection.id, apiKey: connection.apiKey }
}

interface Moderator {
  adapter: AiProviderAdapter
  ctx: ProviderContext
  /** Solo si es un clasificador externo, distinto del proveedor de generación. */
  external?: { provider: string; connectionId: string }
}

const moderationCapability = (kind: AiJobKind) => (kind === 'video' ? 'moderation-video' : 'moderation')

/**
 * Clasificador de seguridad de un trabajo (2.ª capa, DA-75 y DA-85). Si el proveedor de generación trae
 * uno para ese tipo de material, se usa con la misma clave. Si no, hace falta el clasificador externo que
 * el usuario haya elegido en Ajustes, con su propia clave: sin él no se genera (no se acepta contenido sin
 * clasificar ni se usa ninguna clave compartida).
 */
export async function moderatorFor(userId: string, provider: ProviderDefinition, kind: AiJobKind, generation: { adapter: AiProviderAdapter; ctx: ProviderContext }, saved?: JobParams['moderation'], resolveKey = true): Promise<Moderator> {
  const needed = moderationCapability(kind)
  if (provider.capabilities.includes(needed)) return { adapter: generation.adapter, ctx: generation.ctx }
  let external = saved
  if (!external) {
    const preference = await prisma.aiMediaPreference.findUnique({ where: { userId }, select: { moderationProvider: true, moderationKeyId: true } })
    if (preference?.moderationProvider && preference.moderationKeyId) external = { provider: preference.moderationProvider, connectionId: preference.moderationKeyId }
  }
  const definition = external ? findProvider(external.provider) : null
  if (!external || !definition) {
    throw new AiMediaError('AI_MODERATION_REQUIRED', `${provider.name} no incluye un clasificador de seguridad para ${kind === 'video' ? 'vídeo' : 'imágenes'}. Elige en Ajustes un proveedor de moderación con tu propia clave${kind === 'video' ? ' que analice vídeo (por ejemplo, Google Gemini)' : ' (por ejemplo, Google Gemini u OpenAI)'}. Su consumo se factura en tu cuenta de ese proveedor.`)
  }
  if (!definition.capabilities.includes(needed)) {
    throw new AiMediaError('AI_MODERATION_REQUIRED', `${definition.name} no puede clasificar ${kind === 'video' ? 'vídeo' : 'imágenes'}. Elige en Ajustes otro proveedor de moderación${kind === 'video' ? ' que analice vídeo (por ejemplo, Google Gemini)' : ''}.`)
  }
  // Sin resolveKey (plan de una prueba): solo se comprueba que la conexión existe, sin descifrar la clave.
  if (!resolveKey) {
    const exists = await prisma.userAIKey.findFirst({ where: { id: external.connectionId, userId, provider: definition.id }, select: { id: true } })
    if (!exists) throw new AiMediaError('AI_NOT_CONFIGURED', `La conexión del clasificador de ${definition.name} ya no existe. Elige otra en Ajustes.`)
    return { adapter: adapterFor(definition), ctx: { apiKey: '' }, external: { provider: definition.id, connectionId: exists.id } }
  }
  const connection = await connectionFor(userId, definition, external.connectionId)
  return { adapter: adapterFor(definition), ctx: { apiKey: connection.apiKey }, external: { provider: definition.id, connectionId: connection.id } }
}

export interface CreateJobInput {
  kind: AiJobKind
  provider: string
  model: string
  /** Conexión concreta del proveedor, si el usuario tiene varias. */
  connectionId?: string
  photoIds: string[]
  durationSeconds?: number
  sourceHash: string
  expectedVersion: number
  idempotencyKey: string
  consent: boolean
}

async function close(id: string, from: string[], data: Prisma.AiMediaJobUpdateManyMutationInput): Promise<boolean> {
  const updated = await prisma.aiMediaJob.updateMany({ where: { id, status: { in: from } }, data })
  return updated.count === 1
}

async function reload(id: string): Promise<AiJobRow> {
  return prisma.aiMediaJob.findUniqueOrThrow({ where: { id }, select: JOB_SELECT })
}

export async function createJob(log: FastifyBaseLogger | null, userId: string, generationId: string, input: CreateJobInput): Promise<AiJobRow> {
  if (!input.consent) throw new AiMediaError('AI_CONSENT_REQUIRED', 'Confirma que aceptas enviar los datos al proveedor y que el consumo se cargará a tu cuenta.')
  const existing = await prisma.aiMediaJob.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } }, select: JOB_SELECT })
  if (existing) {
    // Misma petición repetida (reintento del navegador): devuelve el trabajo, sin otro envío.
    if (existing.generationId !== generationId || existing.kind !== input.kind) throw new AiMediaError('AI_INVALID_REQUEST', 'La clave de idempotencia ya se usó en otra solicitud.')
    return existing
  }
  const { provider, model } = resolveModel(input.provider, input.model, input.kind)
  const preference = await prisma.aiMediaPreference.findUnique({ where: { userId }, select: { posterProvider: true, posterKeyId: true, videoProvider: true, videoKeyId: true } })
  const preferredKeyId = input.kind === 'poster' ? (preference?.posterProvider === provider.id ? preference.posterKeyId : null) : preference?.videoProvider === provider.id ? preference.videoKeyId : null
  const connection = await connectionFor(userId, provider, input.connectionId, preferredKeyId)
  const adapter = adapterFor(provider)
  const ctx: ProviderContext = { apiKey: connection.apiKey }
  // Antes de crear el trabajo: sin clasificador de seguridad no hay generación (ni cuenta para los límites).
  const moderator = await moderatorFor(userId, provider, input.kind, { adapter, ctx })
  await expireAiJobs(log, userId)

  const source = await getMediaSource(generationId, userId)
  if (source.photos.length === 0) throw new AiMediaError('AI_INVALID_REQUEST', 'El inmueble no tiene fotografías. Añade al menos una antes de generar con IA.')
  if (source.sourceHash !== input.sourceHash) throw new AiMediaError('AI_INVALID_REQUEST', 'Los datos del anuncio o las fotografías han cambiado. Recarga la página.')
  const owned = new Set(source.photos.map(photo => photo.id))
  const max = input.kind === 'poster' ? Math.min(AI_POSTER_MAX_REFERENCE_PHOTOS, model.maxReferenceImages) : model.maxReferenceImages
  const ids = input.photoIds
  // Un modelo que solo genera a partir de texto no recibe ninguna fotografía.
  if (max === 0 ? ids.length > 0 : ids.length === 0 || ids.length > max || new Set(ids).size !== ids.length || ids.some(id => !owned.has(id))) {
    throw new AiMediaError('AI_INVALID_REQUEST', max === 0 ? 'Este modelo no admite fotografías de referencia.' : `Elige entre 1 y ${max} fotografías de este inmueble.`)
  }
  const primary = source.photos.find(photo => photo.isPrimary)
  if (input.kind === 'video' && primary && ids[0] !== primary.id) throw new AiMediaError('AI_INVALID_REQUEST', 'El vídeo debe empezar por la fotografía principal del inmueble.')
  if (input.kind === 'video' && (!(AI_VIDEO_DURATIONS as readonly number[]).includes(input.durationSeconds ?? 0) || !model.video?.durations.includes(input.durationSeconds ?? 0))) {
    throw new AiMediaError('AI_INVALID_REQUEST', `Duración no admitida por este modelo. Elige ${(model.video?.durations ?? []).join(', ')} segundos.`)
  }
  const current = await prisma.listingMedia.findUnique({ where: { generationId_kind: { generationId, kind: input.kind } }, select: { version: true } })
  if ((current?.version ?? 0) !== input.expectedVersion) throw new AiMediaError('AI_INVALID_REQUEST', 'El material se ha actualizado desde otra pestaña. Recarga la página.')

  const params: JobParams = { photoIds: ids, ...(input.kind === 'video' && { durationSeconds: input.durationSeconds }), connectionId: connection.id, ...(moderator.external && { moderation: moderator.external }) }
  const limits = aiLimits()
  let job: AiJobRow
  try {
    job = await prisma.$transaction(async tx => {
      await lockUser(tx as Tx, userId)
      const now = Date.now()
      // Las pruebas reales controladas (DA-89) también consumen de la cuenta del usuario: cuentan en los límites.
      const [activeJobs, sameTarget, dailyJobs, monthlyJobs, activeTrials, dailyTrials, monthlyTrials] = await Promise.all([
        tx.aiMediaJob.count({ where: { userId, status: { in: ['pending', 'submitted', 'processing', 'moderating'] } } }),
        tx.aiMediaJob.count({ where: { userId, generationId, kind: input.kind, status: { in: ['pending', 'submitted', 'processing', 'moderating'] } } }),
        tx.aiMediaJob.count({ where: { userId, createdAt: { gt: new Date(now - 24 * 60 * 60 * 1000) } } }),
        tx.aiMediaJob.count({ where: { userId, createdAt: { gt: new Date(now - 30 * 24 * 60 * 60 * 1000) } } }),
        tx.aiProviderTrial.count({ where: { userId, status: { in: [...AI_ACTIVE_TRIAL_STATUSES] } } }),
        tx.aiProviderTrial.count({ where: { userId, createdAt: { gt: new Date(now - 24 * 60 * 60 * 1000) } } }),
        tx.aiProviderTrial.count({ where: { userId, createdAt: { gt: new Date(now - 30 * 24 * 60 * 60 * 1000) } } }),
      ])
      const active = activeJobs + activeTrials
      const daily = dailyJobs + dailyTrials
      const monthly = monthlyJobs + monthlyTrials
      if (sameTarget > 0) throw new AiMediaError('AI_CONCURRENCY_LIMIT', 'Ya hay una generación con IA en curso para este material.')
      if (active >= limits.concurrent) throw new AiMediaError('AI_CONCURRENCY_LIMIT', `Como máximo ${limits.concurrent} generaciones con IA a la vez.`)
      if (daily >= limits.daily) throw new AiMediaError('AI_DAILY_LIMIT', `Has alcanzado el límite de ${limits.daily} generaciones con IA en 24 horas.`)
      if (monthly >= limits.monthly) throw new AiMediaError('AI_MONTHLY_LIMIT', `Has alcanzado el límite de ${limits.monthly} generaciones con IA en 30 días.`)
      return tx.aiMediaJob.create({
        data: {
          userId,
          generationId,
          propertyId: source.property.id,
          kind: input.kind,
          provider: provider.id,
          model: model.id,
          idempotencyKey: input.idempotencyKey,
          sourceHash: source.sourceHash,
          expectedVersion: input.expectedVersion,
          params: JSON.stringify(params),
          estimatedCostMicroUsd: estimateCostMicroUsd(model, input.durationSeconds),
        },
        select: JOB_SELECT,
      })
    })
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === 'P2002') {
      const raced = await prisma.aiMediaJob.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } }, select: JOB_SELECT })
      if (raced) return raced
    }
    throw error
  }

  // 1.ª capa de moderación: reglas locales sobre los textos que se mostrarán. No sale nada del servidor.
  const local = checkTextPolicy(displayedText(source))
  if (local.length > 0) {
    await close(job.id, ['pending'], { status: 'blocked', moderationStatus: 'blocked', moderationCategory: local[0], completedAt: new Date() })
    return reload(job.id)
  }

  let references: InputImage[]
  try {
    references = await loadReferences(userId, source.property.id, ids, input.kind)
  } catch (error) {
    await close(job.id, ['pending'], { status: 'failed', failureCode: 'AI_INVALID_REQUEST', completedAt: new Date() })
    throw error
  }

  // 2.ª capa: clasificador del proveedor sobre los textos y las fotografías (no confiables).
  try {
    const verdict = await moderator.adapter.moderate(moderator.ctx, { stage: 'input', kind: input.kind, text: displayedText(source), images: references })
    if (!verdict.allowed) {
      await close(job.id, ['pending'], { status: 'blocked', moderationStatus: 'blocked', moderationCategory: verdict.categories[0] ?? 'provider_safety_block', completedAt: new Date() })
      return reload(job.id)
    }
  } catch (error) {
    await close(job.id, ['pending'], { status: 'failed', moderationStatus: 'unavailable', failureCode: 'MODERATION_UNAVAILABLE', completedAt: new Date() })
    log?.warn({ errorName: safeErrorName(error), jobId: job.id }, 'Moderación de entrada no disponible')
    return reload(job.id)
  }

  const prompt = input.kind === 'poster' ? buildPosterPrompt(source.property) : buildVideoPrompt(source.property, input.durationSeconds!, references.length)
  try {
    const { operationId, immediate } = await adapter.submit(ctx, { kind: input.kind, model: model.id, prompt, references, durationSeconds: input.durationSeconds })
    await close(job.id, ['pending'], { status: 'submitted', providerOperationId: operationId, submittedAt: new Date() })
    // Proveedor síncrono: el resultado ya ha llegado y se valida y modera ahora, sin sondeo.
    if (immediate) return await applyState(log, userId, await reload(job.id), immediate, provider, adapter, ctx)
  } catch (error) {
    const code: AiErrorCode = isAiMediaError(error) ? error.code : 'AI_PROVIDER_UNCERTAIN'
    if (isAiMediaError(error) && error.category === 'provider_safety_block') {
      await close(job.id, ['pending'], { status: 'blocked', moderationStatus: 'blocked', moderationCategory: 'provider_safety_block', completedAt: new Date() })
    } else {
      await close(job.id, ['pending'], { status: 'failed', failureCode: code, completedAt: new Date() })
      if (code === 'AI_INVALID_KEY') await setConnectionStatus(userId, provider.id as StoredAIKeyProvider, 'invalid', code, connection.id)
      // Clave válida sin permiso para esta operación: la conexión no es inválida, pero se anota el problema.
      if (code === 'AI_PERMISSION_DENIED') await setConnectionStatus(userId, provider.id as StoredAIKeyProvider, 'error', code, connection.id)
    }
    log?.warn({ errorName: safeErrorName(error), code, jobId: job.id }, 'Envío al proveedor de IA no completado')
  }
  return reload(job.id)
}

async function findOwnJob(userId: string, jobId: string): Promise<AiJobRow> {
  const job = await prisma.aiMediaJob.findFirst({ where: { id: jobId, userId }, select: JOB_SELECT })
  if (!job) throw new AiMediaError('AI_JOB_NOT_FOUND', 'No se ha encontrado la generación.')
  return job
}

async function validateOutput(kind: AiJobKind, bytes: Buffer): Promise<string> {
  if (kind === 'poster') {
    const image = sniffImage(bytes)
    if (!image || !['image/png', 'image/jpeg', 'image/webp'].includes(image.type) || image.width < 256 || image.height < 256 || image.width > 4096 || image.height > 4096) {
      throw new AiMediaError('AI_INVALID_OUTPUT', 'Resultado no válido.')
    }
    return image.type
  }
  const type = sniffVideo(bytes)
  const info = type ? inspectVideoContainer(new Uint8Array(bytes)) : null
  if (!type || !info || !info.hasVideo || info.container !== type) throw new AiMediaError('AI_INVALID_OUTPUT', 'Resultado no válido.')
  const duration = info.durationMs ?? info.headerDurationMs ?? 0
  if (duration < 1_000 || duration > 16_000) throw new AiMediaError('AI_INVALID_OUTPUT', 'Duración del resultado no válida.')
  return type
}

/** Consulta el estado y, si toca, avanza el trabajo (sondeo del proveedor, validación y moderación). */
export async function refreshJob(log: FastifyBaseLogger | null, userId: string, jobId: string): Promise<AiJobRow> {
  let job = await findOwnJob(userId, jobId)
  if (job.status === 'ready' && job.expiresAt && job.expiresAt.getTime() < Date.now()) {
    await expireAiJobs(log, userId)
    return reload(jobId)
  }
  if (job.status !== 'submitted' && job.status !== 'processing') return job
  const now = new Date()
  const claimed = await prisma.aiMediaJob.updateMany({
    where: { id: jobId, status: { in: ['submitted', 'processing'] }, OR: [{ lastPolledAt: null }, { lastPolledAt: { lt: new Date(now.getTime() - POLL_MIN_INTERVAL_MS) } }] },
    data: { lastPolledAt: now, pollCount: { increment: 1 } },
  })
  if (claimed.count !== 1) return reload(jobId)
  job = await reload(jobId)
  const provider = resolveModel(job.provider, job.model, job.kind as AiJobKind).provider
  const adapter = adapterFor(provider)
  let apiKey: string
  try {
    apiKey = (await connectionFor(userId, provider, parseParams(job.params).connectionId)).apiKey
  } catch (error) {
    await close(jobId, ['submitted', 'processing'], { status: 'failed', failureCode: isAiMediaError(error) ? error.code : 'AI_NOT_CONFIGURED', completedAt: new Date() })
    return reload(jobId)
  }
  const ctx: ProviderContext = { apiKey }
  if (job.submittedAt && now.getTime() - job.submittedAt.getTime() > AI_JOB_TIMEOUT_MS) {
    await adapter.cancel(ctx, job.providerOperationId!).catch(() => false)
    await close(jobId, ['submitted', 'processing'], { status: 'expired', failureCode: 'AI_TIMEOUT', completedAt: new Date() })
    return reload(jobId)
  }
  let state
  try {
    state = await adapter.poll(ctx, job.providerOperationId!)
  } catch (error) {
    // Fallo transitorio de la consulta: se reintenta en el siguiente sondeo, hasta un máximo.
    if (job.pollCount >= MAX_POLLS) await close(jobId, ['submitted', 'processing'], { status: 'failed', failureCode: 'AI_PROVIDER_UNAVAILABLE', completedAt: new Date() })
    log?.warn({ errorName: safeErrorName(error), jobId }, 'Consulta al proveedor de IA no completada')
    return reload(jobId)
  }
  return applyState(log, userId, job, state, provider, adapter, ctx)
}

/** Aplica el estado que da el proveedor: lo cierra o, si hay resultado, lo valida, lo guarda y lo modera. */
async function applyState(log: FastifyBaseLogger | null, userId: string, job: AiJobRow, state: OperationState, provider: ProviderDefinition, adapter: AiProviderAdapter, ctx: ProviderContext): Promise<AiJobRow> {
  const jobId = job.id
  const jobParams = parseParams(job.params)
  switch (state.state) {
    case 'running':
      await close(jobId, ['submitted'], { status: 'processing' })
      return reload(jobId)
    case 'cancelled':
      await close(jobId, ['submitted', 'processing'], { status: 'cancelled', completedAt: new Date() })
      return reload(jobId)
    case 'blocked':
      await close(jobId, ['submitted', 'processing'], { status: 'blocked', moderationStatus: 'blocked', moderationCategory: state.category, completedAt: new Date() })
      return reload(jobId)
    case 'failed':
      await close(jobId, ['submitted', 'processing'], { status: 'failed', failureCode: state.code, completedAt: new Date() })
      if (state.code === 'AI_INVALID_KEY') await setConnectionStatus(userId, provider.id as StoredAIKeyProvider, 'invalid', state.code, jobParams.connectionId)
      if (state.code === 'AI_PERMISSION_DENIED') await setConnectionStatus(userId, provider.id as StoredAIKeyProvider, 'error', state.code, jobParams.connectionId)
      return reload(jobId)
    case 'done':
      break
  }
  if (!(await close(jobId, ['submitted', 'processing'], { status: 'moderating' }))) return reload(jobId)
  const kind = job.kind as AiJobKind
  let key: string | null = null
  try {
    const bytes = state.output.data ?? (state.output.uri ? await adapter.fetchResult(ctx, state.output.uri, AI_RESULT_MAX_BYTES[kind]) : null)
    if (!bytes || bytes.length === 0 || bytes.length > AI_RESULT_MAX_BYTES[kind]) throw new AiMediaError('AI_INVALID_OUTPUT', 'Resultado no válido.')
    const contentType = await validateOutput(kind, bytes)
    key = aiResultKey(userId, job.generationId, contentType)
    await (await getStorage()).put(key, bytes, contentType)
    await prisma.aiMediaJob.update({ where: { id: jobId }, data: { resultKey: key, resultContentType: contentType, resultSize: bytes.length } })
    // Resultados de seguridad del propio proveedor.
    if (state.providerFlagged) {
      await close(jobId, ['moderating'], { status: 'blocked', moderationStatus: 'blocked', moderationCategory: 'provider_safety_block', completedAt: new Date() })
    } else {
      // 2.ª capa sobre la salida: imagen completa o vídeo completo (toda su duración y su audio).
      const references = kind === 'video' ? await loadReferences(userId, job.propertyId, jobParams.photoIds, 'poster') : []
      let verdict
      try {
        // El mismo clasificador que se fijó al crear el trabajo (el del proveedor o el externo del usuario).
        const moderator = await moderatorFor(userId, provider, kind, { adapter, ctx }, jobParams.moderation)
        verdict = await moderator.adapter.moderate(moderator.ctx, kind === 'poster' ? { stage: 'output', kind, images: [{ mimeType: contentType as InputImage['mimeType'], data: bytes }] } : { stage: 'output', kind, video: { mimeType: contentType, data: bytes }, images: references })
      } catch {
        await close(jobId, ['moderating'], { status: 'failed', moderationStatus: 'unavailable', failureCode: 'MODERATION_UNAVAILABLE', completedAt: new Date() })
        verdict = null
      }
      if (verdict && !verdict.allowed) {
        await close(jobId, ['moderating'], { status: 'blocked', moderationStatus: 'blocked', moderationCategory: verdict.categories[0] ?? 'provider_safety_block', completedAt: new Date() })
      } else if (verdict) {
        await close(jobId, ['moderating'], { status: 'ready', moderationStatus: 'passed', completedAt: new Date(), expiresAt: new Date(Date.now() + AI_READY_TTL_MS) })
      }
    }
  } catch (error) {
    await close(jobId, ['moderating'], { status: 'failed', failureCode: isAiMediaError(error) ? error.code : 'AI_INVALID_OUTPUT', completedAt: new Date() })
    log?.warn({ errorName: safeErrorName(error), jobId }, 'Resultado de IA no aceptado')
  }
  const final = await reload(jobId)
  // Un resultado bloqueado o fallido no se conserva: se borra ya (el trigger lo encoló).
  if (final.resultKey && final.status !== 'ready') await drainStorageCleanup(log, [final.resultKey])
  return final
}

export async function cancelJob(log: FastifyBaseLogger | null, userId: string, jobId: string): Promise<AiJobRow> {
  const job = await findOwnJob(userId, jobId)
  if (!['pending', 'submitted', 'processing'].includes(job.status)) throw new AiMediaError('AI_JOB_CLOSED', 'Esta generación ya no está en curso.')
  if (job.providerOperationId) {
    const provider = resolveModel(job.provider, job.model, job.kind as AiJobKind).provider
    try {
      // Cancelación en el proveedor si la admite; si no, el resultado se descarta al llegar.
      await adapterFor(provider).cancel({ apiKey: (await connectionFor(userId, provider, parseParams(job.params).connectionId)).apiKey }, job.providerOperationId)
    } catch (error) {
      log?.warn({ errorName: safeErrorName(error), jobId }, 'No se pudo cancelar en el proveedor de IA')
    }
  }
  await close(jobId, ['pending', 'submitted', 'processing'], { status: 'cancelled', completedAt: new Date() })
  return reload(jobId)
}

export async function rejectJob(log: FastifyBaseLogger | null, userId: string, jobId: string): Promise<AiJobRow> {
  const job = await findOwnJob(userId, jobId)
  if (job.status !== 'ready') throw new AiMediaError('AI_JOB_CLOSED', 'Solo se puede rechazar una propuesta lista para revisión.')
  await close(jobId, ['ready'], { status: 'rejected' })
  if (job.resultKey) await drainStorageCleanup(log, [job.resultKey])
  return reload(jobId)
}

export async function getJob(log: FastifyBaseLogger | null, userId: string, jobId: string): Promise<AiJobRow> {
  return refreshJob(log, userId, jobId)
}

export async function listJobs(userId: string, generationId: string): Promise<AiJobRow[]> {
  const owned = await prisma.generation.count({ where: { id: generationId, property: { userId } } })
  if (owned !== 1) throw new AiMediaError('AI_JOB_NOT_FOUND', 'No se ha encontrado el anuncio.')
  return prisma.aiMediaJob.findMany({ where: { userId, generationId }, orderBy: { createdAt: 'desc' }, take: 10, select: JOB_SELECT })
}

/** Archivo de una propuesta lista para revisión (solo del propio usuario). */
export async function locateJobResult(userId: string, jobId: string): Promise<{ key: string; contentType: string; kind: AiJobKind }> {
  const job = await findOwnJob(userId, jobId)
  if (job.status !== 'ready' || !job.resultKey || !job.resultContentType || (job.expiresAt && job.expiresAt.getTime() < Date.now())) {
    throw new AiMediaError('AI_JOB_NOT_READY', 'La propuesta no está disponible para revisión.')
  }
  return { key: job.resultKey, contentType: job.resultContentType, kind: job.kind as AiJobKind }
}

/**
 * Aceptación (revisión humana): dentro de la transacción que guarda el material. El trabajo debe ser del
 * usuario, de este anuncio y tipo, estar listo, sin caducar y con los mismos datos; queda aceptado en la
 * misma transacción. Devuelve el proveedor y el modelo para registrarlos en el material.
 */
export async function consumeReadyJob(tx: Tx, input: { jobId: string; userId: string; generationId: string; kind: AiJobKind; sourceHash: string }): Promise<{ provider: string; model: string; resultKey: string | null }> {
  const job = await tx.aiMediaJob.findFirst({ where: { id: input.jobId, userId: input.userId, generationId: input.generationId, kind: input.kind }, select: { provider: true, model: true, sourceHash: true, resultKey: true } })
  if (!job) throw new AiMediaError('AI_JOB_NOT_FOUND', 'No se ha encontrado la propuesta de IA.')
  if (job.sourceHash !== input.sourceHash) throw new AiMediaError('AI_JOB_NOT_READY', 'Los datos del anuncio han cambiado desde la propuesta. Vuelve a generarla.')
  const accepted = await tx.aiMediaJob.updateMany({ where: { id: input.jobId, status: 'ready', expiresAt: { gt: new Date() } }, data: { status: 'accepted' } })
  if (accepted.count !== 1) throw new AiMediaError('AI_JOB_NOT_READY', 'La propuesta de IA ya no está disponible para aceptarse.')
  return { provider: job.provider, model: job.model, resultKey: job.resultKey }
}

/** Cierra los trabajos caducados o interrumpidos y borra sus resultados. */
export async function expireAiJobs(log: FastifyBaseLogger | null, userId?: string): Promise<number> {
  const now = Date.now()
  const scope = userId ? { userId } : {}
  const candidates = await prisma.aiMediaJob.findMany({
    where: {
      ...scope,
      OR: [
        { status: 'ready', expiresAt: { lt: new Date(now) } },
        { status: 'pending', createdAt: { lt: new Date(now - STALE_MS) } },
        { status: 'moderating', lastPolledAt: { lt: new Date(now - STALE_MS) } },
        { status: { in: ['submitted', 'processing'] }, submittedAt: { lt: new Date(now - AI_JOB_TIMEOUT_MS) } },
      ],
    },
    select: { id: true, status: true, resultKey: true },
    take: 100,
  })
  const keys: string[] = []
  let closed = 0
  for (const job of candidates) {
    const data = job.status === 'ready' || job.status === 'submitted' || job.status === 'processing' ? { status: 'expired', completedAt: new Date() } : { status: 'failed', failureCode: 'AI_INTERRUPTED', completedAt: new Date() }
    if (await close(job.id, [job.status], data)) {
      closed++
      if (job.resultKey) keys.push(job.resultKey)
    }
  }
  if (keys.length) await drainStorageCleanup(log, keys)
  return closed
}

/** Registro de uso del usuario (no equivale a la factura del proveedor). */
export async function usageSummary(userId: string) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const rows = await prisma.aiMediaJob.groupBy({ by: ['status'], where: { userId, createdAt: { gt: since } }, _count: { _all: true } })
  const counts = Object.fromEntries(rows.map(row => [row.status, row._count._all]))
  const day = await prisma.aiMediaJob.count({ where: { userId, createdAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } })
  return { last30Days: counts, last24Hours: day, limits: aiLimits() }
}

export type { AiProviderAdapter }
