import { createHash } from 'node:crypto'

import {
  AI_ACTIVE_TRIAL_STATUSES,
  AI_ACTIVE_JOB_STATUSES,
  AI_COST_NOT_VERIFIABLE,
  AI_JOB_TIMEOUT_MS,
  AI_RESULT_MAX_BYTES,
  AI_TRIAL_STATUS_LABELS,
  inspectVideoContainer,
  type AiTrialKind,
  type AiTrialStatus,
  type GenerationRequest,
} from '@estateforge/shared'
import type { FastifyBaseLogger } from 'fastify'

import { createAIProvider } from '../ai/ai-provider.factory.js'
import { isAIProviderError } from '../ai/ai-provider.error.js'
import { prisma } from '../db/prisma.js'
import type { Prisma } from '../generated/prisma/client.js'
import { sniffImage, sniffVideo } from '../media/file-signatures.js'
import { lockUser } from '../media/quota.js'
import { buildListingPrompt } from '../services/prompt.service.js'
import { safeErrorName } from '../services/log-safety.js'
import { setConnectionStatus, type StoredAIKeyProvider } from '../services/user-ai-key.service.js'
import type { AiProviderAdapter, InputImage, OperationState, ProviderContext } from './adapter.js'
import { AiMediaError, isAiMediaError, PROVIDER_MESSAGES } from './errors.js'
import { CONTRACT_VERSION } from './integration.js'
import { costBreakdown, textUsageCost } from './costs.js'
import { TRIAL_PRESETS } from './trial-presets.js'
import { aiLimits, connectionFor, moderatorFor } from './jobs.service.js'
import { buildPosterPrompt, buildVideoPrompt } from './prompts.js'
import { activePricing, adapterFor, findProvider, isSelectable, resolveModel, type ProviderDefinition } from './registry.js'
import { simulatedBackground } from './simulator.adapter.js'

// Pruebas reales controladas de un proveedor (DA-89). Sirven para comprobar, con la clave del propio usuario,
// que una integración funciona contra el servicio real, sin tocar ningún inmueble ni anuncio:
//
//  · los datos son sintéticos (un inmueble ficticio y fondos degradados generados aquí): nunca fotografías
//    reales ni datos personales;
//  · antes, el usuario ve el plan (proveedor, fabricante, modelo, cuenta que factura, datos enviados y coste,
//    o «Coste no verificable») y lo confirma; la confirmación se compara con el plan del servidor;
//  · se ejecuta una sola operación. Si su estado externo es incierto, no se repite (podría haberse cobrado);
//  · el resultado se valida (formato, tamaño, resolución, duración, códec, moderación) y se descarta: solo se
//    guarda el informe, sin secretos ni URL del proveedor;
//  · cuenta para los mismos límites que las generaciones (simultáneas, diarias y mensuales).
//
// Igual que los trabajos, avanza por sondeo desde el navegador: sin procesos en segundo plano.

type Tx = Prisma.TransactionClient

const POLL_MIN_INTERVAL_MS = 2_000
const MAX_POLLS = 900
const ACTIVE = [...AI_ACTIVE_TRIAL_STATUSES] as string[]

/** Inmueble ficticio de las pruebas: ningún dato procede de un inmueble real ni identifica a nadie. */
export const SYNTHETIC_PROPERTY: GenerationRequest['property'] = {
  title: 'Piso de prueba (datos sintéticos)',
  operation: 'sale',
  type: 'apartment',
  price: 250000,
  address: 'Calle de Prueba 1',
  city: 'Ciudad de Prueba',
  neighborhood: 'Barrio de Prueba',
  area: 80,
  bedrooms: 2,
  bathrooms: 1,
  floor: 2,
  condition: 'good',
  elevator: true,
  terrace: false,
  balcony: true,
  garage: false,
  storageRoom: false,
  pool: false,
  garden: false,
  airConditioning: true,
  heating: true,
  additionalInformation: 'Inmueble ficticio creado para una prueba técnica de EstateForge.',
}

/** Imágenes de referencia sintéticas (degradados generados aquí, sin metadatos). */
export function syntheticReferences(kind: AiTrialKind, count: number): InputImage[] {
  const size = kind === 'video' ? { width: 1280, height: 720 } : { width: 928, height: 1152 }
  return Array.from({ length: count }, (_, index) => ({ mimeType: 'image/png' as const, data: simulatedBackground(size.width, size.height, 7 + index) }))
}

/** Textos que se moderan en la entrada (los mismos que mostraría el material). */
const SYNTHETIC_TEXT = { titulo: SYNTHETIC_PROPERTY.title, descripcion: SYNTHETIC_PROPERTY.additionalInformation, destacados: '2 dormitorios · 80 m² · ascensor', llamada_a_la_accion: 'Prueba técnica' }

export interface TrialInput {
  connectionId: string
  kind: AiTrialKind
  model: string
  durationSeconds?: number
  /** Solo vídeo: una de las resolutionOptions del modelo (DA-92). */
  resolution?: string
  /** Imágenes sintéticas de referencia (0 o 1). Sin indicar: 1 si el modelo las admite (obligatoria en vídeo). */
  references?: number
}

export interface TrialConfirmation {
  provider: string
  model: string
  connectionId: string
  /** Coste estimado que ha visto el usuario (null: no verificable). */
  estimatedCostMicroUsd: number | null
  acceptCharges: true
}

function referenceCount(kind: AiTrialKind, maxReferenceImages: number): number {
  if (kind === 'text') return 0
  // La menor cantidad que prueba la ruta del modelo: una imagen si la admite.
  return maxReferenceImages > 0 ? 1 : 0
}

/** Duración mínima admitida por el modelo (vídeo): la prueba más barata posible. */
function minimalDuration(durations: number[]): number {
  return Math.min(...durations)
}

/**
 * Plan de la prueba: lo que se va a enviar, a quién, con qué cuenta y cuánto puede costar. Se calcula en el
 * servidor a partir del catálogo; la web lo muestra y el usuario lo confirma.
 */
export async function trialPlan(userId: string, input: TrialInput) {
  const { provider, model } = resolveModel(await providerOfConnection(userId, input.connectionId), input.model, input.kind)
  const connection = await prisma.userAIKey.findFirst({ where: { id: input.connectionId, userId, provider: provider.id }, select: { id: true, label: true, status: true } })
  if (!connection) throw new AiMediaError('AI_NOT_CONFIGURED', 'No se ha encontrado la conexión elegida.')
  const durationSeconds = input.kind === 'video' ? (input.durationSeconds ?? minimalDuration(model.video?.durations ?? [])) : undefined
  if (input.kind === 'video' && !model.video?.durations.includes(durationSeconds!)) throw new AiMediaError('AI_INVALID_REQUEST', `Duración no admitida por este modelo. Elige ${(model.video?.durations ?? []).join(', ')} segundos.`)
  if (input.resolution !== undefined && (input.kind !== 'video' || !model.video?.resolutionOptions?.some(option => option.id === input.resolution))) throw new AiMediaError('AI_INVALID_REQUEST', 'Resolución no admitida por este modelo.')
  const references = input.references === undefined ? referenceCount(input.kind, model.maxReferenceImages) : input.references
  if (references < 0 || references > Math.min(1, model.maxReferenceImages) || (input.kind === 'video' && references < 1)) throw new AiMediaError('AI_INVALID_REQUEST', input.kind === 'video' ? 'Un vídeo de prueba parte de una imagen sintética.' : 'Este modelo no admite esa cantidad de imágenes de referencia.')
  let moderation: { provider: string; name: string; connectionId: string; external: boolean } | null = null
  if (input.kind !== 'text') {
    const generationCtx = { adapter: adapterFor(provider), ctx: { apiKey: '' } }
    try {
      const moderator = await moderatorFor(userId, provider, input.kind, generationCtx, undefined, false)
      moderation = moderator.external ? { provider: moderator.external.provider, name: findProvider(moderator.external.provider)?.name ?? moderator.external.provider, connectionId: moderator.external.connectionId, external: true } : { provider: provider.id, name: provider.name, connectionId: connection.id, external: false }
    } catch (error) {
      if (!isAiMediaError(error)) throw error
      // Sin clasificador no hay prueba de imagen ni de vídeo: se dice en el plan y la creación se rechaza.
      moderation = null
    }
  }
  const resolution = input.kind === 'video' ? (model.video?.resolutionOptions?.find(option => option.id === input.resolution) ?? null) : null
  const breakdown = costBreakdown(model, { kind: input.kind, durationSeconds, resolution: input.resolution, references, moderation })
  // Importe que el usuario confirma: generación y referencias calculables; null si la generación no se puede calcular.
  const generationLine = breakdown.lines[0]
  const estimated = generationLine.usd === null ? null : Math.round(breakdown.lines.filter(line => !line.concept.startsWith('Clasificador')).reduce((sum, line) => sum + (line.usd ?? 0), 0) * 1_000_000)
  const pricing = activePricing(model)
  const sent =
    input.kind === 'text'
      ? ['Instrucciones de redacción de EstateForge', 'Datos de un inmueble ficticio (título, tipo, precio, superficie, dormitorios, características y una nota)']
      : [
          'Instrucciones de diseño de EstateForge y el tipo de inmueble ficticio',
          references > 0 ? `${references} imagen sintética de referencia (degradado generado por EstateForge, ${input.kind === 'video' ? '1280×720' : '928×1152'} px)` : 'Ninguna imagen: el modelo genera solo a partir de las instrucciones',
          ...(input.kind === 'video' ? [`Duración pedida: ${durationSeconds} s${durationSeconds === minimalDuration(model.video?.durations ?? []) ? ' (la mínima del modelo)' : ''}`, `Resolución: ${resolution?.label ?? `${model.video?.resolution ?? ''} (la del catálogo)`}`] : [`Imagen: ${model.image?.resolution ?? ''} · ${model.image?.aspectRatio ?? ''}`]),
        ]
  return {
    kind: input.kind,
    provider: { id: provider.id, name: provider.name, kind: provider.kind, billing: provider.billing },
    model: { id: model.id, label: model.label, maker: model.maker, status: model.status },
    connection: { id: connection.id, label: connection.label, status: connection.status },
    durationSeconds: durationSeconds ?? null,
    resolution: resolution?.id ?? null,
    resolutionLabel: input.kind === 'video' ? (resolution?.label ?? model.video?.resolution ?? null) : (model.image?.resolution ?? null),
    referenceImages: references,
    dataSent: sent,
    estimatedCostMicroUsd: estimated,
    cost:
      estimated !== null
        ? `Coste estimado: ${(estimated / 1_000_000).toLocaleString('es-ES', { style: 'currency', currency: 'USD', maximumFractionDigits: 3 })} (${pricing!.detail}; consultado el ${pricing!.consultedAt.split('-').reverse().join('/')}).${breakdown.complete ? '' : ' Hay partes que no se pueden estimar: ver el desglose.'}`
        : pricing
          ? `${AI_COST_NOT_VERIFIABLE}: el precio publicado (${pricing.detail}) no permite calcular el importe por adelantado.`
          : `${AI_COST_NOT_VERIFIABLE}: no hay un precio publicado verificado. Consulta la tarifa del proveedor.`,
    costVerifiable: estimated !== null,
    costLines: breakdown.lines,
    costKnownUsd: breakdown.knownUsd,
    costComplete: breakdown.complete,
    priceConsultedAt: breakdown.priceConsultedAt,
    priceStale: breakdown.priceStale,
    moderation,
    moderationRequired: input.kind !== 'text',
    warnings: [
      ...(breakdown.priceStale ? [`El precio se consultó hace ${breakdown.priceAgeDays} días: comprueba la tarifa vigente del proveedor antes de confirmar.`] : []),
      `La operación puede generar cargos en tu cuenta de ${provider.name}${moderation?.external ? ` y en la de ${moderation.name} (clasificador de seguridad)` : ''}. EstateForge no puede limitar el gasto de tu cuenta del proveedor.`,
      'Se ejecuta una sola vez. Si no se puede confirmar si el proveedor la recibió, no se repite para no duplicar cargos.',
      'Los datos y las imágenes son sintéticos. El resultado se valida y se descarta: no se guarda ni sustituye ningún material.',
    ],
    contractVersion: CONTRACT_VERSION,
  }
}

async function providerOfConnection(userId: string, connectionId: string): Promise<string> {
  const row = await prisma.userAIKey.findFirst({ where: { id: connectionId, userId }, select: { provider: true } })
  if (!row || !findProvider(row.provider)) throw new AiMediaError('AI_NOT_CONFIGURED', 'No se ha encontrado la conexión elegida.')
  return row.provider
}

const TRIAL_SELECT = {
  id: true,
  userId: true,
  connectionId: true,
  provider: true,
  model: true,
  kind: true,
  status: true,
  durationSeconds: true,
  estimatedCostMicroUsd: true,
  contractVersion: true,
  moderationProvider: true,
  moderationKeyId: true,
  providerOperationId: true,
  failureCode: true,
  report: true,
  pollCount: true,
  lastPolledAt: true,
  submittedAt: true,
  completedAt: true,
  createdAt: true,
} as const
type TrialRow = Prisma.AiProviderTrialGetPayload<{ select: typeof TRIAL_SELECT }>

function parseReport(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw) as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function trialMessage(row: TrialRow): string | null {
  if (row.status === 'uncertain') return PROVIDER_MESSAGES.AI_PROVIDER_UNCERTAIN
  if (row.status === 'blocked') return 'La moderación ha bloqueado la prueba. No se ha conservado nada.'
  if (row.status === 'failed' && row.failureCode) {
    if (row.failureCode === 'AI_MODERATION_REQUIRED') return 'Hace falta un clasificador de seguridad para probar este proveedor.'
    if (row.failureCode === 'MODERATION_UNAVAILABLE') return 'El clasificador de seguridad no ha podido completar la revisión.'
    return PROVIDER_MESSAGES[row.failureCode as keyof typeof PROVIDER_MESSAGES] ?? 'La prueba no se ha podido completar.'
  }
  if (row.status === 'expired') return 'El proveedor no ha terminado a tiempo. Se ha pedido la cancelación si el proveedor la admite.'
  return null
}

/** Lo que ve el navegador: sin identificadores del proveedor ni URL. */
export function trialDto(row: TrialRow) {
  return {
    id: row.id,
    connectionId: row.connectionId,
    provider: row.provider,
    providerName: findProvider(row.provider)?.name ?? row.provider,
    model: row.model,
    kind: row.kind,
    status: row.status,
    statusLabel: AI_TRIAL_STATUS_LABELS[row.status as AiTrialStatus] ?? row.status,
    active: ACTIVE.includes(row.status),
    durationSeconds: row.durationSeconds,
    estimatedCostUsd: row.estimatedCostMicroUsd === null ? null : row.estimatedCostMicroUsd / 1_000_000,
    contractVersion: row.contractVersion,
    moderationProvider: row.moderationProvider,
    failureCode: row.failureCode,
    message: trialMessage(row),
    report: parseReport(row.report),
    createdAt: row.createdAt,
    submittedAt: row.submittedAt,
    completedAt: row.completedAt,
  }
}

async function close(id: string, from: string[], data: Prisma.AiProviderTrialUpdateManyMutationInput): Promise<boolean> {
  return (await prisma.aiProviderTrial.updateMany({ where: { id, status: { in: from } }, data })).count === 1
}

async function reload(id: string): Promise<TrialRow> {
  return prisma.aiProviderTrial.findUniqueOrThrow({ where: { id }, select: TRIAL_SELECT })
}

async function mergeReport(id: string, extra: Record<string, unknown>): Promise<void> {
  const row = await prisma.aiProviderTrial.findUniqueOrThrow({ where: { id }, select: { report: true } })
  const report = JSON.stringify({ ...parseReport(row.report), ...extra })
  await prisma.aiProviderTrial.update({ where: { id }, data: { report: report.length <= 16_000 ? report : JSON.stringify({ truncated: true }) } })
}

/** Solo el host de una URL (nunca la ruta ni los parámetros, que pueden ser una firma). */
function hostOf(uri: string | undefined): string | null {
  if (!uri) return null
  try {
    return new URL(uri).hostname
  } catch {
    return null
  }
}

export async function createTrial(log: FastifyBaseLogger | null, userId: string, input: TrialInput & { idempotencyKey: string; confirmation: TrialConfirmation }): Promise<TrialRow> {
  const existing = await prisma.aiProviderTrial.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } }, select: TRIAL_SELECT })
  if (existing) {
    // Misma petición repetida: se devuelve la prueba, sin otro envío.
    if (existing.connectionId !== input.connectionId || existing.model !== input.model || existing.kind !== input.kind) throw new AiMediaError('AI_INVALID_REQUEST', 'La clave de idempotencia ya se usó en otra solicitud.')
    return existing
  }
  const plan = await trialPlan(userId, input)
  const c = input.confirmation
  // La confirmación debe ser la del plan vigente: si el modelo, la cuenta o el coste han cambiado, se vuelve a pedir.
  if (c.acceptCharges !== true || c.provider !== plan.provider.id || c.model !== plan.model.id || c.connectionId !== plan.connection.id || c.estimatedCostMicroUsd !== plan.estimatedCostMicroUsd) {
    throw new AiMediaError('AI_TRIAL_CONFIRMATION', 'El proveedor, el modelo, la cuenta o el coste no coinciden con lo que has confirmado. Revisa la prueba y vuelve a confirmarla.')
  }
  if (plan.moderationRequired && !plan.moderation) {
    throw new AiMediaError('AI_MODERATION_REQUIRED', `${plan.provider.name} no incluye un clasificador de seguridad para este material. Elige en Ajustes un clasificador con tu propia clave antes de la prueba.`)
  }
  const { provider, model } = resolveModel(plan.provider.id, plan.model.id, input.kind)
  const connection = await connectionFor(userId, provider, plan.connection.id)
  const limits = aiLimits()
  let trial: TrialRow
  try {
    trial = await prisma.$transaction(async tx => {
      await lockUser(tx as Tx, userId)
      const now = Date.now()
      const day = new Date(now - 24 * 60 * 60 * 1000)
      const month = new Date(now - 30 * 24 * 60 * 60 * 1000)
      const [activeTrials, activeJobs, dailyTrials, dailyJobs, monthlyTrials, monthlyJobs] = await Promise.all([
        tx.aiProviderTrial.count({ where: { userId, status: { in: ACTIVE } } }),
        tx.aiMediaJob.count({ where: { userId, status: { in: [...AI_ACTIVE_JOB_STATUSES] } } }),
        tx.aiProviderTrial.count({ where: { userId, createdAt: { gt: day } } }),
        tx.aiMediaJob.count({ where: { userId, createdAt: { gt: day } } }),
        tx.aiProviderTrial.count({ where: { userId, createdAt: { gt: month } } }),
        tx.aiMediaJob.count({ where: { userId, createdAt: { gt: month } } }),
      ])
      if (activeTrials > 0) throw new AiMediaError('AI_CONCURRENCY_LIMIT', 'Ya hay una prueba real en curso. Espera a que termine.')
      if (activeTrials + activeJobs >= limits.concurrent) throw new AiMediaError('AI_CONCURRENCY_LIMIT', `Como máximo ${limits.concurrent} generaciones con IA a la vez.`)
      if (dailyTrials + dailyJobs >= limits.daily) throw new AiMediaError('AI_DAILY_LIMIT', `Has alcanzado el límite de ${limits.daily} generaciones con IA en 24 horas.`)
      if (monthlyTrials + monthlyJobs >= limits.monthly) throw new AiMediaError('AI_MONTHLY_LIMIT', `Has alcanzado el límite de ${limits.monthly} generaciones con IA en 30 días.`)
      return tx.aiProviderTrial.create({
        data: {
          userId,
          connectionId: connection.id,
          provider: provider.id,
          model: model.id,
          kind: input.kind,
          idempotencyKey: input.idempotencyKey,
          durationSeconds: plan.durationSeconds,
          estimatedCostMicroUsd: plan.estimatedCostMicroUsd,
          contractVersion: CONTRACT_VERSION,
          moderationProvider: plan.moderation?.external ? plan.moderation.provider : null,
          moderationKeyId: plan.moderation?.external ? plan.moderation.connectionId : null,
          report: JSON.stringify({ requested: { model: model.id, maker: model.maker, kind: input.kind, durationSeconds: plan.durationSeconds, referenceImages: plan.referenceImages, resolution: plan.resolutionLabel, resolutionId: plan.resolution, aspectRatio: model.video?.aspectRatio ?? model.image?.aspectRatio ?? null, costLines: plan.costLines, priceConsultedAt: plan.priceConsultedAt } }),
        },
        select: TRIAL_SELECT,
      })
    })
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === 'P2002') {
      const raced = await prisma.aiProviderTrial.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } }, select: TRIAL_SELECT })
      if (raced) return raced
    }
    throw error
  }
  if (input.kind === 'text') return runTextTrial(log, userId, trial, provider, model.id, connection)
  return startMediaTrial(log, userId, trial, provider, connection, plan.referenceImages, plan.resolution ?? undefined)
}

async function runTextTrial(log: FastifyBaseLogger | null, userId: string, trial: TrialRow, provider: ProviderDefinition, model: string, connection: { id: string; apiKey: string }): Promise<TrialRow> {
  const started = Date.now()
  await close(trial.id, ['pending'], { status: 'submitted', submittedAt: new Date() })
  try {
    const prompt = buildListingPrompt({ property: SYNTHETIC_PROPERTY, provider: provider.id as GenerationRequest['provider'], tone: 'professional', language: 'español' })
    const textProvider = createAIProvider(provider.id as GenerationRequest['provider'], { apiKey: connection.apiKey, model })
    const listing = await textProvider.generate(prompt)
    const definition = provider.models.find(item => item.id === model)
    // La respuesta ya está validada por el esquema del anuncio en el proveedor de texto.
    await mergeReport(trial.id, {
      durationMs: Date.now() - started,
      output: { titleLength: listing.title.length, descriptionLength: listing.description.length, highlights: listing.highlights.length, callToAction: Boolean(listing.callToAction), structured: true },
      usage: definition ? textUsageCost(definition, textProvider.lastUsage) : { reported: false, note: 'Modelo fuera del catálogo: consulta el consumo en tu cuenta del proveedor.' },
      fallback: false,
    })
    await close(trial.id, ['submitted'], { status: 'passed', completedAt: new Date() })
  } catch (error) {
    const code = isAIProviderError(error) ? error.code : 'AI_PROVIDER_ERROR'
    // Tiempo agotado o error inesperado: el proveedor pudo haber procesado (y cobrado) la petición.
    const uncertain = code === 'AI_TIMEOUT' || !isAIProviderError(error)
    await mergeReport(trial.id, { durationMs: Date.now() - started, errorCode: code, fallback: false })
    await close(trial.id, ['submitted'], { status: uncertain ? 'uncertain' : 'failed', failureCode: textFailure(code), completedAt: new Date() })
    if (code === 'AI_INVALID_API_KEY') await setConnectionStatus(userId, provider.id as StoredAIKeyProvider, 'invalid', 'AI_INVALID_KEY', connection.id)
    if (code === 'AI_PERMISSION_DENIED') await setConnectionStatus(userId, provider.id as StoredAIKeyProvider, 'error', 'AI_PERMISSION_DENIED', connection.id)
    log?.warn({ errorName: safeErrorName(error), code, trialId: trial.id }, 'Prueba real de texto no superada')
  }
  return reload(trial.id)
}

/** Códigos del texto traducidos a los de la prueba. */
function textFailure(code: string): string {
  switch (code) {
    case 'AI_INVALID_API_KEY':
      return 'AI_INVALID_KEY'
    case 'AI_QUOTA_EXCEEDED':
    case 'AI_RATE_LIMITED':
      return 'AI_PROVIDER_QUOTA'
    case 'AI_TIMEOUT':
      return 'AI_PROVIDER_UNCERTAIN'
    case 'AI_PERMISSION_DENIED':
    case 'AI_MODEL_NOT_ALLOWED':
      return code
    default:
      return 'AI_PROVIDER_FAILED'
  }
}

async function startMediaTrial(log: FastifyBaseLogger | null, userId: string, trial: TrialRow, provider: ProviderDefinition, connection: { id: string; apiKey: string }, referenceImages: number, resolution?: string): Promise<TrialRow> {
  const kind = trial.kind as 'poster' | 'video'
  const adapter = adapterFor(provider)
  const ctx: ProviderContext = { apiKey: connection.apiKey }
  const references = syntheticReferences(kind, referenceImages)
  let moderator
  try {
    moderator = await moderatorFor(userId, provider, kind, { adapter, ctx }, trial.moderationProvider && trial.moderationKeyId ? { provider: trial.moderationProvider, connectionId: trial.moderationKeyId } : undefined)
    const verdict = await moderator.adapter.moderate(moderator.ctx, { stage: 'input', kind, text: SYNTHETIC_TEXT, images: references })
    await mergeReport(trial.id, { inputModeration: verdict.allowed ? 'passed' : 'blocked' })
    if (!verdict.allowed) {
      await close(trial.id, ['pending'], { status: 'blocked', completedAt: new Date() })
      return reload(trial.id)
    }
  } catch (error) {
    const code = isAiMediaError(error) && error.code !== 'MODERATION_UNAVAILABLE' ? error.code : 'MODERATION_UNAVAILABLE'
    await close(trial.id, ['pending'], { status: 'failed', failureCode: code, completedAt: new Date() })
    log?.warn({ errorName: safeErrorName(error), trialId: trial.id }, 'Moderación de entrada de la prueba no disponible')
    return reload(trial.id)
  }
  const prompt = kind === 'poster' ? buildPosterPrompt(SYNTHETIC_PROPERTY) : buildVideoPrompt(SYNTHETIC_PROPERTY, trial.durationSeconds!, references.length)
  const started = Date.now()
  try {
    const { operationId, immediate } = await adapter.submit(ctx, { kind, model: trial.model, prompt, references, durationSeconds: trial.durationSeconds ?? undefined, ...(resolution && { resolution }) })
    await close(trial.id, ['pending'], { status: 'submitted', providerOperationId: operationId, submittedAt: new Date() })
    await mergeReport(trial.id, { submit: { accepted: true, operationIdReceived: true, synchronous: Boolean(immediate), durationMs: Date.now() - started } })
    if (immediate) return await applyTrialState(log, userId, await reload(trial.id), immediate, provider, adapter, ctx)
  } catch (error) {
    if (isAiMediaError(error) && error.category === 'provider_safety_block') {
      await close(trial.id, ['pending'], { status: 'blocked', completedAt: new Date() })
    } else if (isAiMediaError(error) && error.code !== 'AI_PROVIDER_UNAVAILABLE') {
      // Rechazo explícito del proveedor (clave, permiso, cuota, parámetros): no se ha aceptado nada.
      await close(trial.id, ['pending'], { status: 'failed', failureCode: error.code, completedAt: new Date() })
      if (error.code === 'AI_INVALID_KEY') await setConnectionStatus(userId, provider.id as StoredAIKeyProvider, 'invalid', error.code, connection.id)
      if (error.code === 'AI_PERMISSION_DENIED') await setConnectionStatus(userId, provider.id as StoredAIKeyProvider, 'error', error.code, connection.id)
    } else {
      // Red, tiempo agotado o respuesta ilegible: el proveedor pudo haber aceptado (y cobrado) la operación.
      await close(trial.id, ['pending'], { status: 'uncertain', failureCode: 'AI_PROVIDER_UNCERTAIN', completedAt: new Date() })
    }
    await mergeReport(trial.id, { submit: { accepted: false, durationMs: Date.now() - started, errorCode: isAiMediaError(error) ? error.code : 'AI_PROVIDER_UNCERTAIN' } })
    log?.warn({ errorName: safeErrorName(error), trialId: trial.id }, 'Envío de la prueba real no completado')
  }
  return reload(trial.id)
}

async function findOwnTrial(userId: string, trialId: string): Promise<TrialRow> {
  const row = await prisma.aiProviderTrial.findFirst({ where: { id: trialId, userId }, select: TRIAL_SELECT })
  if (!row) throw new AiMediaError('AI_TRIAL_NOT_FOUND', 'No se ha encontrado la prueba.')
  return row
}

/** Consulta la prueba y, si toca, sondea el proveedor (solo con la conexión con la que se creó). */
export async function refreshTrial(log: FastifyBaseLogger | null, userId: string, trialId: string): Promise<TrialRow> {
  let trial = await findOwnTrial(userId, trialId)
  if (trial.status !== 'submitted' && trial.status !== 'processing') return trial
  const now = new Date()
  const claimed = await prisma.aiProviderTrial.updateMany({
    where: { id: trialId, status: { in: ['submitted', 'processing'] }, OR: [{ lastPolledAt: null }, { lastPolledAt: { lt: new Date(now.getTime() - POLL_MIN_INTERVAL_MS) } }] },
    data: { lastPolledAt: now, pollCount: { increment: 1 } },
  })
  if (claimed.count !== 1) return reload(trialId)
  trial = await reload(trialId)
  const provider = findProvider(trial.provider)
  if (!provider || !trial.connectionId) {
    await close(trialId, ['submitted', 'processing'], { status: 'failed', failureCode: 'AI_NOT_CONFIGURED', completedAt: new Date() })
    return reload(trialId)
  }
  let ctx: ProviderContext
  try {
    ctx = { apiKey: (await connectionFor(userId, provider, trial.connectionId)).apiKey }
  } catch (error) {
    await close(trialId, ['submitted', 'processing'], { status: 'failed', failureCode: isAiMediaError(error) ? error.code : 'AI_NOT_CONFIGURED', completedAt: new Date() })
    return reload(trialId)
  }
  const adapter = adapterFor(provider)
  if (trial.submittedAt && now.getTime() - trial.submittedAt.getTime() > AI_JOB_TIMEOUT_MS) {
    const cancelled = await adapter.cancel(ctx, trial.providerOperationId!).catch(() => false)
    await mergeReport(trialId, { timeout: { cancelRequested: cancelled } })
    await close(trialId, ['submitted', 'processing'], { status: 'expired', failureCode: 'AI_TIMEOUT', completedAt: new Date() })
    return reload(trialId)
  }
  let state: OperationState
  try {
    state = await adapter.poll(ctx, trial.providerOperationId!)
  } catch (error) {
    if (trial.pollCount >= MAX_POLLS) await close(trialId, ['submitted', 'processing'], { status: 'failed', failureCode: 'AI_PROVIDER_UNAVAILABLE', completedAt: new Date() })
    log?.warn({ errorName: safeErrorName(error), trialId }, 'Consulta de la prueba real no completada')
    return reload(trialId)
  }
  return applyTrialState(log, userId, trial, state, provider, adapter, ctx)
}

async function applyTrialState(log: FastifyBaseLogger | null, userId: string, trial: TrialRow, state: OperationState, provider: ProviderDefinition, adapter: AiProviderAdapter, ctx: ProviderContext): Promise<TrialRow> {
  const id = trial.id
  switch (state.state) {
    case 'running':
      await close(id, ['submitted'], { status: 'processing' })
      return reload(id)
    case 'cancelled':
      await close(id, ['submitted', 'processing'], { status: 'cancelled', completedAt: new Date() })
      return reload(id)
    case 'blocked':
      await mergeReport(id, { providerModeration: 'blocked' })
      await close(id, ['submitted', 'processing'], { status: 'blocked', completedAt: new Date() })
      return reload(id)
    case 'failed':
      await close(id, ['submitted', 'processing'], { status: 'failed', failureCode: state.code, completedAt: new Date() })
      if (state.code === 'AI_INVALID_KEY') await setConnectionStatus(userId, provider.id as StoredAIKeyProvider, 'invalid', state.code, trial.connectionId ?? undefined)
      return reload(id)
    case 'done':
      break
  }
  if (!(await close(id, ['submitted', 'processing'], { status: 'validating' }))) return reload(id)
  const kind = trial.kind as 'poster' | 'video'
  try {
    const delivery = state.output.data ? 'inline' : 'url'
    const bytes = state.output.data ?? (state.output.uri ? await adapter.fetchResult(ctx, state.output.uri, AI_RESULT_MAX_BYTES[kind]) : null)
    if (!bytes || bytes.length === 0 || bytes.length > AI_RESULT_MAX_BYTES[kind]) throw new AiMediaError('AI_INVALID_OUTPUT', 'Resultado no válido.')
    const output = describeOutput(kind, bytes)
    await mergeReport(id, { output: { ...output, delivery, resultHost: hostOf(state.output.uri), declaredMimeType: state.output.mimeType, usage: state.usage ?? null, providerFlagged: state.providerFlagged } })
    if (!output.valid) throw new AiMediaError('AI_INVALID_OUTPUT', 'Resultado no válido.')
    if (state.providerFlagged) {
      await close(id, ['validating'], { status: 'blocked', completedAt: new Date() })
      return reload(id)
    }
    const moderator = await moderatorFor(userId, provider, kind, { adapter, ctx }, trial.moderationProvider && trial.moderationKeyId ? { provider: trial.moderationProvider, connectionId: trial.moderationKeyId } : undefined)
    const verdict = await moderator.adapter.moderate(moderator.ctx, kind === 'poster' ? { stage: 'output', kind, images: [{ mimeType: output.mimeType as InputImage['mimeType'], data: bytes }] } : { stage: 'output', kind, video: { mimeType: output.mimeType!, data: bytes }, images: syntheticReferences('video', 1) })
    await mergeReport(id, { outputModeration: verdict.allowed ? 'passed' : 'blocked' })
    await close(id, ['validating'], verdict.allowed ? { status: 'passed', completedAt: new Date() } : { status: 'blocked', completedAt: new Date() })
  } catch (error) {
    const code = isAiMediaError(error) ? error.code : 'AI_INVALID_OUTPUT'
    await close(id, ['validating'], { status: 'failed', failureCode: code, completedAt: new Date() })
    log?.warn({ errorName: safeErrorName(error), trialId: id }, 'Resultado de la prueba real no aceptado')
  }
  // El resultado nunca se guarda: los bytes se descartan aquí.
  return reload(id)
}

/** Validación del resultado (lo mismo que exige un trabajo real) y sus métricas, sin el contenido. */
export function describeOutput(kind: 'poster' | 'video', bytes: Buffer) {
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (kind === 'poster') {
    const image = sniffImage(bytes)
    const valid = Boolean(image && ['image/png', 'image/jpeg', 'image/webp'].includes(image.type) && image.width >= 256 && image.height >= 256 && image.width <= 4096 && image.height <= 4096)
    return { valid, mimeType: image?.type ?? null, bytes: bytes.length, width: image?.width ?? null, height: image?.height ?? null, sha256 }
  }
  const type = sniffVideo(bytes)
  const info = type ? inspectVideoContainer(new Uint8Array(bytes)) : null
  const durationMs = info ? (info.durationMs ?? info.headerDurationMs ?? null) : null
  const valid = Boolean(type && info && info.hasVideo && info.container === type && durationMs !== null && durationMs >= 1_000 && durationMs <= 16_000)
  return { valid, mimeType: type ?? null, bytes: bytes.length, durationMs, videoCodec: info?.videoCodec ?? null, hasAudio: info?.hasAudio ?? null, audioCodec: info?.audioCodec ?? null, sha256 }
}

export async function cancelTrial(log: FastifyBaseLogger | null, userId: string, trialId: string): Promise<TrialRow> {
  const trial = await findOwnTrial(userId, trialId)
  if (!['pending', 'submitted', 'processing'].includes(trial.status)) throw new AiMediaError('AI_TRIAL_CLOSED', 'Esta prueba ya no está en curso.')
  if (trial.providerOperationId && trial.connectionId) {
    const provider = findProvider(trial.provider)
    try {
      if (provider) {
        const cancelled = await adapterFor(provider).cancel({ apiKey: (await connectionFor(userId, provider, trial.connectionId)).apiKey }, trial.providerOperationId)
        await mergeReport(trialId, { cancel: { providerCancelled: cancelled } })
      }
    } catch (error) {
      log?.warn({ errorName: safeErrorName(error), trialId }, 'No se pudo cancelar la prueba en el proveedor')
    }
  }
  await close(trialId, ['pending', 'submitted', 'processing'], { status: 'cancelled', completedAt: new Date() })
  return reload(trialId)
}

export async function listTrials(userId: string): Promise<TrialRow[]> {
  return prisma.aiProviderTrial.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 20, select: TRIAL_SELECT })
}

/** Última prueba superada de cada proveedor y modelo del usuario (para el diagnóstico de Ajustes). */
export async function lastPassedTrials(userId: string): Promise<Record<string, { model: string; kind: string; completedAt: Date | null; contractVersion: string }[]>> {
  const rows = await prisma.aiProviderTrial.findMany({ where: { userId, status: 'passed' }, orderBy: { completedAt: 'desc' }, take: 200, select: { provider: true, model: true, kind: true, completedAt: true, contractVersion: true } })
  const out: Record<string, { model: string; kind: string; completedAt: Date | null; contractVersion: string }[]> = {}
  for (const row of rows) {
    const list = (out[row.provider] ??= [])
    if (!list.some(item => item.model === row.model && item.kind === row.kind)) list.push({ model: row.model, kind: row.kind, completedAt: row.completedAt, contractVersion: row.contractVersion })
  }
  return out
}

/**
 * Las seis pruebas propuestas (DA-93), con lo que el usuario necesita para decidir: modelo y si sigue en el
 * catálogo, proveedor que factura, fabricante, sus conexiones de ese proveedor (sin elegir ninguna por él),
 * clasificador disponible y desglose del coste. No llama a ningún proveedor ni descifra ninguna clave.
 */
export async function trialPresets(userId: string) {
  const [connections, trials] = await Promise.all([
    prisma.userAIKey.findMany({ where: { userId }, select: { id: true, provider: true, label: true, status: true, lastCheckDetails: true }, orderBy: { createdAt: 'asc' } }),
    prisma.aiProviderTrial.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50, select: TRIAL_SELECT }),
  ])
  const out = []
  for (const preset of TRIAL_PRESETS) {
    const provider = findProvider(preset.provider)
    const model = provider?.models.find(item => item.id === preset.model && item.purpose === preset.kind) ?? null
    const available = Boolean(provider && model && isSelectable(model))
    let moderation: { provider: string; name: string; external: boolean } | null = null
    let moderationMissing = false
    if (provider && preset.kind !== 'text') {
      try {
        const moderator = await moderatorFor(userId, provider, preset.kind, { adapter: adapterFor(provider), ctx: { apiKey: '' } }, undefined, false)
        moderation = moderator.external ? { provider: moderator.external.provider, name: findProvider(moderator.external.provider)?.name ?? moderator.external.provider, external: true } : { provider: provider.id, name: provider.name, external: false }
      } catch (error) {
        if (!isAiMediaError(error)) throw error
        moderationMissing = true
      }
    }
    const own = connections
      .filter(connection => connection.provider === preset.provider)
      .map(connection => {
        let notListed = false
        try {
          const details = connection.lastCheckDetails ? (JSON.parse(connection.lastCheckDetails) as { models?: { notListedByAccount?: string[] } }) : null
          notListed = Boolean(details?.models?.notListedByAccount?.includes(preset.model))
        } catch {
          notListed = false
        }
        return { id: connection.id, label: connection.label, status: connection.status, modelNotListed: notListed }
      })
    const last = trials.find(trial => trial.provider === preset.provider && trial.model === preset.model)
    out.push({
      ...preset,
      providerName: provider?.name ?? preset.provider,
      providerKind: provider?.kind ?? null,
      billing: provider?.billing ?? null,
      maker: model?.maker ?? null,
      modelLabel: model?.label ?? preset.model,
      modelStatus: model?.status ?? null,
      available,
      unavailableReason: available ? null : 'El modelo ya no está en el catálogo o se ha retirado. No se sustituye por otro: elige una alternativa en la prueba libre.',
      connections: own,
      moderation,
      moderationRequired: preset.kind !== 'text',
      moderationMissing,
      cost: model ? costBreakdown(model, { kind: preset.kind, durationSeconds: preset.durationSeconds, resolution: preset.resolution, references: preset.references, moderation }) : null,
      lastTrial: last ? trialDto(last) : null,
    })
  }
  return out
}
