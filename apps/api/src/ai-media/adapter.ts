import type { AiModerationCategory } from '@estateforge/shared'

// Contrato de los adaptadores de proveedores de IA (DA-70). Cada adaptador declara en el registro sus
// capacidades y modelos reales; la API construye las llamadas y nunca acepta endpoints del usuario.

export interface ProviderContext {
  apiKey: string
  signal?: AbortSignal
}

export interface InputImage {
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  data: Buffer
}

/** Instrucciones del sistema y datos separados: los datos nunca se mezclan con las instrucciones. */
export interface BuiltPrompt {
  instructions: string
  /** Datos de entrada no confiables (JSON), delimitados y marcados como tales. */
  data: Record<string, unknown>
  /**
   * Versión breve y en inglés de las mismas reglas (menos de 900 caracteres), sin datos del anuncio: para
   * los proveedores que limitan la longitud del prompt o solo admiten inglés.
   */
  compact: string
}

export interface SubmitRequest {
  kind: 'poster' | 'video'
  model: string
  prompt: BuiltPrompt
  references: InputImage[]
  /** Solo vídeo. */
  durationSeconds?: number
  /** Solo vídeo: una de las `resolutionOptions` del modelo (DA-92). Sin ella, la resolución por defecto. */
  resolution?: string
}

/** Resultado del envío. immediate: el proveedor es síncrono y ya ha devuelto el resultado (no hay sondeo). */
export interface SubmitResult {
  operationId: string
  immediate?: OperationState
}

export type OperationState =
  | { state: 'running' }
  | { state: 'done'; output: { mimeType: string; data?: Buffer; uri?: string }; providerFlagged: boolean; usage?: { inputTokens?: number; outputTokens?: number } }
  | { state: 'failed'; code: 'AI_PROVIDER_FAILED' | 'AI_INVALID_KEY' | 'AI_PERMISSION_DENIED' | 'AI_PROVIDER_QUOTA' | 'AI_INVALID_OUTPUT' }
  | { state: 'blocked'; category: AiModerationCategory }
  | { state: 'cancelled' }

export interface ModerationRequest {
  stage: 'input' | 'output'
  kind: 'poster' | 'video'
  /** Texto del anuncio que se va a mostrar en el material (no confiable). */
  text?: Record<string, string>
  images?: InputImage[]
  video?: { mimeType: string; data: Buffer }
}

export interface ModerationVerdict {
  allowed: boolean
  categories: AiModerationCategory[]
}

/**
 * Resultado de la comprobación de una clave (DA-87). models: identificadores que el proveedor lista para esa
 * cuenta, cuando la comprobación es una lista de modelos (sirve para avisar de los modelos del catálogo que la
 * cuenta no tiene). AI_PERMISSION_DENIED: la clave se reconoce, pero la cuenta, el proyecto o la región no
 * tienen permiso (403). AI_VERIFY_UNSUPPORTED: el proveedor no documenta ninguna comprobación sin generar.
 */
export type VerifyResult = { ok: true; models?: string[] } | { ok: false; code: 'AI_INVALID_KEY' | 'AI_PERMISSION_DENIED' | 'AI_PROVIDER_QUOTA' | 'AI_PROVIDER_UNAVAILABLE' | 'AI_VERIFY_UNSUPPORTED' }

export interface AiProviderAdapter {
  /** Comprobación mínima que no genera contenido. */
  verifyKey(ctx: ProviderContext): Promise<VerifyResult>
  submit(ctx: ProviderContext, request: SubmitRequest): Promise<SubmitResult>
  poll(ctx: ProviderContext, operationId: string): Promise<OperationState>
  /** Cancela en el proveedor si lo admite; devuelve si se ha podido. */
  cancel(ctx: ProviderContext, operationId: string): Promise<boolean>
  /** Descarga un resultado entregado por URI (solo hosts del registro). */
  fetchResult(ctx: ProviderContext, uri: string, maxBytes: number): Promise<Buffer>
  /** Clasificación de seguridad; lanza AiMediaError('MODERATION_UNAVAILABLE') si no puede completarla. */
  moderate(ctx: ProviderContext, request: ModerationRequest): Promise<ModerationVerdict>
}
