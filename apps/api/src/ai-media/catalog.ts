import { CONSULTED_AT, imagePrice, secondPrice, tokenPrice, type ModelDefinition, type ProviderDefinition } from './catalog-types.js'
import { GEMINI_HOSTS, GEMINI_MODERATION_MODEL } from './gemini.adapter.js'
import { SIMULATOR_KEY_PATTERN } from './simulator.adapter.js'

// Catálogo de proveedores y modelos de IA (DA-70, DA-78, DA-82). ÚNICA fuente de proveedores, modelos,
// capacidades, hosts, enlaces y precios: la web lo recibe de GET /api/ai/providers y la API valida contra
// él todo lo que llega. No contiene ninguna clave: todas las llamadas usan la API key del usuario (BYOK).
//
// Todo procede de la documentación oficial de cada proveedor, consultada el 12/11/2026 (las URL están en
// cada precio y en docs/proveedores-ia.md). Reglas:
//  · solo se registra un modelo si su identificador, su endpoint y sus parámetros constan en esa documentación;
//  · «status» es el que indica el proveedor; si no lo indica, «unknown» (nunca se presume estable);
//  · un precio que no consta se deja en null («Consultar tarifa del proveedor»): no se inventa ni se
//    copia el del fabricante cuando el modelo se consume a través de un agregador;
//  · «maker» es el fabricante del modelo; el proveedor es quien sirve la API y factura.
//
// Ningún adaptador se ha probado contra el servicio real (no autorizado): solo con respuestas simuladas
// que siguen la forma documentada.

const GENERIC_KEY = /^[A-Za-z0-9._:-]{16,256}$/
const TEXT_IO = { inputs: ['text'], outputs: ['text'], maxReferenceImages: 0 } as const
const NOT_STATED = 'La documentación consultada no indica su estado'
const POSTER = { resolution: '1K (≈1024 px)', aspectRatio: '4:5' }
const text = (model: Omit<ModelDefinition, 'purpose' | 'inputs' | 'outputs' | 'maxReferenceImages'>): ModelDefinition => ({ purpose: 'text', ...TEXT_IO, inputs: [...TEXT_IO.inputs], outputs: [...TEXT_IO.outputs], ...model })
const poster = (model: Omit<ModelDefinition, 'purpose' | 'inputs' | 'outputs' | 'image'> & { image?: ModelDefinition['image'] }): ModelDefinition => ({
  purpose: 'poster',
  inputs: model.maxReferenceImages > 0 ? ['text', 'image'] : ['text'],
  outputs: ['image'],
  image: POSTER,
  ...model,
})
const video = (model: Omit<ModelDefinition, 'purpose' | 'inputs' | 'outputs'>): ModelDefinition => ({ purpose: 'video', inputs: ['text', 'image'], outputs: ['video'], ...model })

// ------------------------------------------------------------------------------------------------ Google
const G_PRICING = 'https://aistudio.google.com/docs/pricing'
const G_CTX = { context: 'Plan de pago, proceso estándar' }

export const GEMINI: ProviderDefinition = {
  id: 'gemini',
  name: 'Google Gemini',
  kind: 'direct',
  billing: 'Tu cuenta de Google AI Studio / Google Cloud',
  simulated: false,
  authentication: 'Cabecera x-goog-api-key',
  description: 'Texto con Gemini, imagen con Nano Banana y vídeo con Gemini Omni Flash. También sirve de clasificador de seguridad para otros proveedores.',
  keyPattern: /^[A-Za-z0-9_-]{30,64}$/,
  keyHelp: 'API key de Google AI Studio (se crea en tu cuenta de Google AI Studio).',
  capabilities: ['text', 'image', 'image-reference', 'video', 'video-reference', 'moderation', 'moderation-video', 'async-operations'],
  text: { protocol: 'gemini-sdk' },
  models: [
    text({
      id: 'gemini-3.6-flash',
      label: 'Gemini 3.6 Flash (gemini-3.6-flash)',
      maker: 'Google',
      tier: 'recommended',
      status: 'stable',
      stability: 'Estable',
      pricing: tokenPrice(0.75, 0.075, 3.75, G_PRICING, { ...G_CTX, status: 'temporary', validUntil: '2026-12-31', detail: '0,75 $ por millón de tokens de entrada, 0,075 $ de entrada en caché y 3,75 $ de salida hasta el 31/12/2026 (desde el 01/01/2027: 1,50 $, 0,15 $ y 7,50 $). Tiene nivel gratuito según la página de precios' }),
      notes: 'Texto del anuncio (título, descripción, destacados y llamada a la acción).',
    }),
    text({
      id: 'gemini-3.5-flash-lite',
      label: 'Gemini 3.5 Flash-Lite (gemini-3.5-flash-lite)',
      maker: 'Google',
      tier: 'alternative',
      status: 'stable',
      stability: 'Estable',
      pricing: tokenPrice(0.3, 0.03, 2.5, G_PRICING, { ...G_CTX, detail: '0,30 $ por millón de tokens de entrada, 0,03 $ de entrada en caché y 2,50 $ de salida. Tiene nivel gratuito según la página de precios' }),
      notes: 'Opción más económica para el texto del anuncio.',
    }),
    text({
      id: 'gemini-3.8-flash',
      label: 'Gemini 3.8 Flash (gemini-3.8-flash)',
      maker: 'Google',
      tier: 'alternative',
      status: 'unknown',
      stability: 'Nuevo (02/09/2026); la página no lo etiqueta como estable',
      pricing: tokenPrice(0.75, 0.075, 3.75, G_PRICING, { ...G_CTX, status: 'temporary', validUntil: '2026-12-31', detail: '0,75 $ por millón de tokens de entrada, 0,075 $ de entrada en caché y 3,75 $ de salida hasta el 31/12/2026 (desde el 01/01/2027: 1,50 $, 0,15 $ y 7,50 $). Tiene nivel gratuito según la página de precios' }),
      notes: 'Generación Flash más reciente.',
    }),
    text({
      id: 'gemini-4-carbon',
      label: 'Gemini 4 Carbon (gemini-4-carbon)',
      maker: 'Google',
      tier: 'alternative',
      status: 'unknown',
      stability: 'Nuevo (10/11/2026); la página no indica su estado',
      pricing: tokenPrice(2, 0.1, 10, G_PRICING, { ...G_CTX, status: 'temporary', validUntil: '2026-11-30', detail: '2,00 $ por millón de tokens de entrada, 0,10 $ de entrada en caché y 10,00 $ de salida hasta el 30/11/2026 (desde el 01/12/2026: 4,00 $, 0,20 $ y 20,00 $). Sin nivel gratuito' }),
      notes: 'Modelo de razonamiento más capaz de Google; el más caro para un texto de anuncio.',
    }),
    poster({
      id: 'gemini-3.1-flash-image',
      label: 'Nano Banana 2 (gemini-3.1-flash-image)',
      maker: 'Google',
      tier: 'recommended',
      status: 'stable',
      stability: 'Estable',
      maxReferenceImages: 14,
      pricing: imagePrice(0.067, '0,067 $ por imagen generada de 1K (sin nivel gratuito). Aparte, las fotografías y el texto de entrada: 0,50 $ por millón de tokens', G_PRICING, G_CTX),
      notes: 'Admite hasta 14 imágenes de referencia; EstateForge envía como máximo 3. Todas las imágenes llevan marca SynthID.',
    }),
    poster({
      id: 'gemini-3.1-flash-lite-image',
      label: 'Nano Banana 2 Lite (gemini-3.1-flash-lite-image)',
      maker: 'Google',
      tier: 'alternative',
      status: 'stable',
      stability: 'Estable',
      maxReferenceImages: 14,
      pricing: imagePrice(0.0336, '0,0336 $ por imagen generada de 1K (sin nivel gratuito). Aparte, las fotografías y el texto de entrada: 0,25 $ por millón de tokens', G_PRICING, { ...G_CTX, consultedAt: '2026-11-15' }),
      notes: 'Versión más económica. EstateForge envía como máximo 3 imágenes de referencia.',
    }),
    poster({
      id: 'gemini-nano-banana-2.1',
      label: 'Nano Banana 2.1 (gemini-nano-banana-2.1)',
      maker: 'Google',
      tier: 'alternative',
      status: 'unknown',
      stability: 'Nuevo (06/10/2026); la página no lo etiqueta como estable',
      maxReferenceImages: 14,
      pricing: null,
      notes: 'Sucesor de Nano Banana 2. Su precio por imagen no se pudo leer de forma literal en la página de precios: consulta la tarifa del proveedor.',
    }),
    poster({
      id: 'gemini-3-pro-image',
      label: 'Nano Banana Pro (gemini-3-pro-image)',
      maker: 'Google',
      tier: 'alternative',
      status: 'stable',
      stability: 'Estable',
      maxReferenceImages: 14,
      pricing: null,
      notes: 'Mayor calidad. Su precio por imagen no se pudo leer de forma literal en la página de precios: consulta la tarifa del proveedor.',
    }),
    video({
      id: 'gemini-omni-1.2-flash',
      label: 'Gemini Omni Flash (gemini-omni-1.2-flash)',
      maker: 'Google',
      tier: 'recommended',
      status: 'stable',
      stability: 'Disponible (GA) en el plan de pago',
      maxReferenceImages: 6,
      video: { durations: [4, 6, 8], resolution: '720p', aspectRatio: '16:9', nativeAudio: 'discarded' },
      pricing: secondPrice(0.0695, '≈0,07 $ por segundo de vídeo a 720p (12 $ por millón de tokens de salida; 5792 tokens por segundo). Sin nivel gratuito. Aparte, las fotografías y el texto de entrada: 1,50 $ por millón de tokens', G_PRICING, G_CTX),
      notes: 'Vídeo de 3 a 15 s con hasta 6 imágenes de referencia. El modelo genera audio propio: EstateForge lo descarta y usa la pista elegida.',
    }),
  ],
  moderation: `Filtros de seguridad de Gemini en su umbral más estricto y clasificador ${GEMINI_MODERATION_MODEL} (consume tokens de tu cuenta).`,
  allowedHosts: GEMINI_HOSTS,
  resultHosts: GEMINI_HOSTS,
  links: {
    site: 'https://ai.google.dev',
    docs: 'https://aistudio.google.com/docs/image-generation',
    pricing: G_PRICING,
    terms: 'https://aistudio.google.com/docs/terms',
    privacy: 'https://policies.google.com/privacy',
    keys: 'https://aistudio.google.com/apikey',
  },
  dataUse:
    'Según los términos de la API de Gemini (vigentes desde el 23/03/2026), en el nivel gratuito Google puede usar el contenido para mejorar sus productos y revisarlo con personas; en el de pago, no. Depende del plan de tu cuenta: EstateForge no puede garantizarlo.',
  verification: 'Consulta los metadatos de un modelo (GET /v1beta/models/…): no genera contenido. La documentación no indica su coste: solo se hace si lo confirmas.',
  verificationCost: 'unknown',
  consultedAt: CONSULTED_AT,
}

// ------------------------------------------------------------------------------------------------ OpenAI
const OPENAI_CTX = { context: 'Proceso estándar, peticiones de hasta 272 000 tokens de entrada, sin procesamiento regional' }
const openaiModel = (id: string) => `https://developers.openai.com/api/docs/models/${id}`
const OPENAI_ACTIVE = 'Vigente: sin fecha de retirada publicada (la documentación no indica otro estado)'
const OPENAI_IMAGE_PRICE = tokenPrice(8, 2, 30, 'https://developers.openai.com/api/docs/pricing', {
  context: 'Proceso estándar; tokens de imagen',
  estimable: false,
  detail: 'Se factura por tokens: 8,00 $ por millón de tokens de imagen de entrada y 30,00 $ por millón de tokens de imagen de salida (el texto de entrada, 5,00 $). La página de precios no publica un importe por imagen: depende del tamaño y de la calidad',
})

export const OPENAI: ProviderDefinition = {
  id: 'openai',
  name: 'OpenAI',
  kind: 'direct',
  billing: 'Tu cuenta de la plataforma de OpenAI',
  simulated: false,
  authentication: 'Cabecera Authorization: Bearer',
  description: 'Texto del anuncio con la API Responses (modelos GPT-6), fondo de cartel con GPT Image y clasificador de seguridad gratuito (texto e imagen) para otros proveedores. La API de vídeo (Sora) se cerró el 24/09/2026.',
  keyPattern: /^sk-[A-Za-z0-9_-]{20,200}$/,
  keyHelp: 'API key de OpenAI (empieza por sk-; se crea en tu cuenta de la plataforma de OpenAI).',
  capabilities: ['text', 'image', 'image-reference', 'moderation'],
  text: { protocol: 'openai-responses' },
  models: [
    text({ id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra (gpt-6.1-terra)', maker: 'OpenAI', tier: 'recommended', status: 'unknown', stability: OPENAI_ACTIVE, pricing: tokenPrice(1, 0.05, 5, openaiModel('gpt-6.1-terra'), OPENAI_CTX), notes: 'Equilibrio entre calidad y coste para el texto del anuncio.' }),
    text({ id: 'gpt-6-luna', label: 'GPT-6 Luna (gpt-6-luna)', maker: 'OpenAI', tier: 'alternative', status: 'unknown', stability: OPENAI_ACTIVE, pricing: tokenPrice(0.1, 0.01, 0.5, openaiModel('gpt-6-luna'), { ...OPENAI_CTX, consultedAt: '2026-11-15' }), notes: 'El más económico: pensado para textos sencillos y mucho volumen.' }),
    text({ id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol (gpt-6.1-sol)', maker: 'OpenAI', tier: 'alternative', status: 'unknown', stability: OPENAI_ACTIVE, pricing: tokenPrice(2, 0.1, 10, openaiModel('gpt-6.1-sol'), OPENAI_CTX), notes: 'Mayor calidad, a mayor precio.' }),
    text({
      id: 'gpt-5.5',
      label: 'GPT-5.5 (gpt-5.5)',
      maker: 'OpenAI',
      tier: 'legacy',
      status: 'unknown',
      stability: 'Heredado: sigue documentado y sin fecha de retirada publicada, pero lo superan los modelos GPT-6',
      pricing: tokenPrice(5, 0.5, 30, openaiModel('gpt-5.5'), OPENAI_CTX),
      notes: 'Era el modelo de la generación de texto. Se conserva para no cambiar la elección de quien ya lo tenga; es más caro que los anteriores.',
    }),
    poster({
      id: 'gpt-image-2.6-flare',
      label: 'GPT Image 2.6 Flare (gpt-image-2.6-flare)',
      maker: 'OpenAI',
      tier: 'recommended',
      status: 'unknown',
      stability: 'Vigente: la guía lo recomienda para integraciones nuevas; sin fecha de retirada publicada',
      maxReferenceImages: 16,
      image: { resolution: '1024×1536', aspectRatio: '2:3' },
      pricing: OPENAI_IMAGE_PRICE,
      notes: 'Admite hasta 16 imágenes de referencia; EstateForge envía como máximo 3. Tu organización puede necesitar verificación para usar los modelos GPT Image.',
    }),
    poster({
      id: 'gpt-image-2.6-sunburst',
      label: 'GPT Image 2.6 Sunburst (gpt-image-2.6-sunburst)',
      maker: 'OpenAI',
      tier: 'alternative',
      status: 'unknown',
      stability: 'Vigente: la guía lo recomienda para integraciones nuevas; sin fecha de retirada publicada',
      maxReferenceImages: 16,
      image: { resolution: '1024×1536', aspectRatio: '2:3' },
      pricing: OPENAI_IMAGE_PRICE,
      notes: 'Mismas condiciones que Flare. Tu organización puede necesitar verificación para usar los modelos GPT Image.',
    }),
  ],
  moderation: 'Filtro de políticas de uso de OpenAI sobre el prompt y la imagen generada. Además, clasificador omni-moderation-latest (texto e imagen), gratuito según su documentación; no clasifica vídeo.',
  allowedHosts: ['api.openai.com'],
  links: {
    site: 'https://openai.com/api',
    docs: 'https://developers.openai.com/api/docs/models',
    pricing: 'https://developers.openai.com/api/docs/pricing',
    terms: 'https://openai.com/policies',
    privacy: 'https://openai.com/policies/privacy-policy',
    keys: 'https://platform.openai.com/api-keys',
  },
  dataUse: 'El tratamiento de los datos depende de las condiciones de tu cuenta de OpenAI. EstateForge no puede garantizarlo: consúltalo en sus políticas.',
  verification: 'Consulta la lista de modelos de tu cuenta (GET /v1/models): no genera contenido. La documentación no indica su coste: solo se hace si lo confirmas. Que la clave sea válida no garantiza que tu cuenta tenga acceso a todos los modelos ni saldo para generar.',
  verificationCost: 'unknown',
  consultedAt: CONSULTED_AT,
}

// ------------------------------------------------------------------------------------------------ Anthropic
const A_PRICING = 'https://platform.claude.com/docs/en/about-claude/pricing'
const claude = (id: string, label: string, tier: ModelDefinition['tier'], input: number, cached: number, output: number, retire: string, notes: string, detail?: string): ModelDefinition =>
  text({ id, label: `${label} (${id})`, maker: 'Anthropic', tier, status: 'stable', stability: `Activo; retirada no antes del ${retire}`, pricing: tokenPrice(input, cached, output, A_PRICING, { context: 'Proceso estándar; la entrada en caché es el precio de lectura', ...(detail && { detail }) }), notes })

export const ANTHROPIC: ProviderDefinition = {
  id: 'anthropic',
  name: 'Anthropic (Claude)',
  kind: 'direct',
  billing: 'Tu cuenta de la consola de Anthropic',
  simulated: false,
  authentication: 'Cabecera x-api-key',
  description: 'Texto del anuncio con la API Messages de Claude y salida estructurada. Los modelos Claude no generan imágenes ni vídeo.',
  keyPattern: GENERIC_KEY,
  keyHelp: 'API key de Anthropic (se crea en la consola de Claude).',
  capabilities: ['text'],
  text: { protocol: 'anthropic-messages', url: 'https://api.anthropic.com/v1/messages', version: '2026-10-21' },
  models: [
    claude('claude-sonnet-5-5', 'Claude Sonnet 5.5', 'recommended', 2, 0.1, 10, '28/09/2027', 'Mejor combinación de velocidad y calidad según Anthropic.'),
    claude('claude-haiku-5-5', 'Claude Haiku 5.5', 'alternative', 0.1, 0.01, 0.5, '07/10/2027', 'El más rápido y económico.', '0,10 $ por millón de tokens de entrada, 0,01 $ de entrada en caché y 0,50 $ de salida (peticiones de hasta 100 000 tokens; por encima, 0,50 $, 0,05 $ y 2,50 $)'),
    claude('claude-opus-5-5', 'Claude Opus 5.5', 'alternative', 4, 0.2, 20, '22/09/2027', 'Mayor capacidad, a mayor precio.'),
  ],
  moderation: 'El modelo puede negarse a responder (stop_reason «refusal»): EstateForge lo trata como un bloqueo, no como un texto válido.',
  allowedHosts: ['api.anthropic.com'],
  links: {
    site: 'https://www.anthropic.com/api',
    docs: 'https://platform.claude.com/docs/en/api/overview',
    pricing: A_PRICING,
    terms: 'https://www.anthropic.com/legal/commercial-terms',
    privacy: 'https://www.anthropic.com/legal/privacy',
    keys: 'https://platform.claude.com/settings/keys',
  },
  dataUse: 'Según su documentación, el contenido de la API no se conserva por defecto (salvo excepciones) y lo conservado no se usa para entrenar sin permiso expreso. Consulta las condiciones de tu cuenta.',
  verification: 'Consulta la lista de modelos (GET /v1/models): no genera contenido. La documentación no indica su coste: solo se hace si lo confirmas.',
  verificationCost: 'unknown',
  consultedAt: CONSULTED_AT,
}

// ------------------------------------------------------------------------------------------------ xAI
const X_PRICING = 'https://docs.x.ai/developers/pricing'
const X_VIDEO = { resolution: '720p', aspectRatio: 'el de la fotografía principal', nativeAudio: 'disabled' as const }

export const XAI: ProviderDefinition = {
  id: 'xai',
  name: 'xAI (Grok)',
  kind: 'direct',
  billing: 'Tu cuenta de la consola de xAI',
  simulated: false,
  authentication: 'Cabecera Authorization: Bearer',
  description: 'Texto con Grok, fondo de cartel con Grok Imagine Image y vídeo con Grok Imagine Video.',
  keyPattern: GENERIC_KEY,
  keyHelp: 'API key de xAI (se crea en la consola de xAI).',
  capabilities: ['text', 'image', 'image-reference', 'video', 'video-reference', 'async-operations'],
  text: { protocol: 'chat-completions', url: 'https://api.x.ai/v1/chat/completions', jsonMode: 'json_schema', maxTokensField: 'max_completion_tokens' },
  models: [
    text({ id: 'grok-4.3', label: 'Grok 4.3 (grok-4.3)', maker: 'xAI', tier: 'recommended', status: 'unknown', stability: NOT_STATED, pricing: tokenPrice(1.25, 0.2, 2.5, X_PRICING, { context: 'Proceso estándar, peticiones de menos de 200 000 tokens' }), notes: 'El más económico de la familia actual.' }),
    text({ id: 'grok-4.7', label: 'Grok 4.7 (grok-4.7)', maker: 'xAI', tier: 'alternative', status: 'unknown', stability: NOT_STATED, pricing: tokenPrice(2, 0.5, 6, X_PRICING, { context: 'Proceso estándar, peticiones de menos de 200 000 tokens' }), notes: 'Modelo más reciente de los ejemplos oficiales.' }),
    poster({ id: 'grok-imagine-image-2.0', label: 'Grok Imagine Image 2.0 (grok-imagine-image-2.0)', maker: 'xAI', tier: 'recommended', status: 'unknown', stability: NOT_STATED, maxReferenceImages: 5, image: { resolution: '1k', aspectRatio: '3:4' }, pricing: imagePrice(0.04, '0,04 $ por imagen generada. Con fotografías de referencia (edición) se cobran también las imágenes de entrada', X_PRICING), notes: 'Hasta 5 imágenes de referencia; EstateForge envía como máximo 3.' }),
    poster({ id: 'grok-imagine-image', label: 'Grok Imagine Image (grok-imagine-image)', maker: 'xAI', tier: 'alternative', status: 'unknown', stability: NOT_STATED, maxReferenceImages: 5, image: { resolution: '1k', aspectRatio: '3:4' }, pricing: imagePrice(0.02, '0,02 $ por imagen generada. Con fotografías de referencia (edición) se cobran también las imágenes de entrada', X_PRICING), notes: 'Versión más económica.' }),
    video({ id: 'grok-imagine-video-1.5', label: 'Grok Imagine Video 1.5 (grok-imagine-video-1.5)', maker: 'xAI', tier: 'recommended', status: 'unknown', stability: NOT_STATED, maxReferenceImages: 1, video: { durations: [4, 6, 8], ...X_VIDEO }, pricing: secondPrice(0.08, '0,08 $ por segundo de vídeo', X_PRICING), notes: 'Parte de la fotografía principal como primer fotograma. Se pide sin audio (generate_audio: false).' }),
    video({ id: 'grok-imagine-video-1.5-lite', label: 'Grok Imagine Video 1.5 Lite (grok-imagine-video-1.5-lite)', maker: 'xAI', tier: 'alternative', status: 'unknown', stability: NOT_STATED, maxReferenceImages: 1, video: { durations: [4, 6, 8], ...X_VIDEO }, pricing: secondPrice(0.02, '0,02 $ por segundo de vídeo (la documentación no publica precios por resolución ni el de la imagen de entrada)', X_PRICING, { consultedAt: '2026-11-15', referenceUsd: null }), notes: 'Versión más económica. Parte de la fotografía principal. Se pide sin audio.' }),
  ],
  moderation: 'Revisión de la política de contenido de xAI: un vídeo o una imagen bloqueados llegan como error «invalid_argument» o con respect_moderation: false, y EstateForge no los acepta. Los bloqueos posteriores a la generación se cobran.',
  allowedHosts: ['api.x.ai'],
  resultHosts: ['vidgen.x.ai'],
  links: { site: 'https://x.ai/api', docs: 'https://docs.x.ai/developers/models', pricing: X_PRICING, terms: 'https://x.ai/legal/terms-of-service-enterprise', privacy: 'https://x.ai/legal/privacy-policy', keys: 'https://console.x.ai' },
  dataUse: 'Según su documentación, las imágenes y los vídeos generados pasan una revisión de política de contenido y no se usan para entrenar. Para el texto no consta una declaración en las páginas consultadas.',
  verification: 'Consulta la lista de modelos disponibles para la clave (GET /v1/models): no genera contenido. La documentación no indica su coste: solo se hace si lo confirmas.',
  verificationCost: 'unknown',
  consultedAt: CONSULTED_AT,
}

// ------------------------------------------------------------------------------------------------ Mistral
export const MISTRAL: ProviderDefinition = {
  id: 'mistral',
  name: 'Mistral',
  kind: 'direct',
  billing: 'Tu cuenta de la plataforma de Mistral',
  simulated: false,
  authentication: 'Cabecera Authorization: Bearer',
  description: 'Texto del anuncio con la API de chat de Mistral en modo JSON.',
  keyPattern: GENERIC_KEY,
  keyHelp: 'API key de Mistral (se crea en la consola de Mistral).',
  capabilities: ['text'],
  text: { protocol: 'chat-completions', url: 'https://api.mistral.ai/v1/chat/completions', jsonMode: 'json_object', maxTokensField: 'max_tokens' },
  models: [
    text({ id: 'mistral-large-latest', label: 'Mistral Large (mistral-large-latest)', maker: 'Mistral AI', tier: 'recommended', status: 'unknown', stability: 'Alias de los ejemplos oficiales; la documentación no indica a qué versión apunta', pricing: null, notes: 'La ficha de Mistral Large 4 publica 0,70 $ / 0,07 $ / 2,10 $ por millón de tokens, pero no consta que este alias apunte a esa versión: consulta la tarifa del proveedor.' }),
    text({ id: 'mistral-medium-3-5', label: 'Mistral Medium 3.5 (mistral-medium-3-5)', maker: 'Mistral AI', tier: 'alternative', status: 'unknown', stability: NOT_STATED, pricing: null, notes: 'Recomendado por Mistral para la mayoría de las tareas. Su precio no consta en las páginas consultadas: consulta la tarifa del proveedor.' }),
  ],
  moderation: 'La documentación consultada no describe un filtro de contenido en la generación. EstateForge aplica sus reglas locales al texto del anuncio.',
  allowedHosts: ['api.mistral.ai'],
  links: { site: 'https://mistral.ai', docs: 'https://docs.mistral.ai/inference', pricing: 'https://mistral.ai/pricing', terms: 'https://mistral.ai/terms', privacy: 'https://mistral.ai/terms#privacy-policy', keys: 'https://console.mistral.ai/api-keys' },
  dataUse: 'No consta una declaración sobre el uso de los datos de la API en las páginas consultadas. Consulta las condiciones de tu cuenta.',
  verification: 'Consulta la lista de modelos (GET /v1/models): no genera contenido. La documentación no indica su coste: solo se hace si lo confirmas.',
  verificationCost: 'unknown',
  consultedAt: CONSULTED_AT,
}

// ------------------------------------------------------------------------------------------------ DeepSeek
const D_PRICING = 'https://api-docs.deepseek.com/quick_start/pricing'
export const DEEPSEEK: ProviderDefinition = {
  id: 'deepseek',
  name: 'DeepSeek',
  kind: 'direct',
  billing: 'Tu cuenta de la plataforma de DeepSeek (saldo de prepago)',
  simulated: false,
  authentication: 'Cabecera Authorization: Bearer',
  description: 'Texto del anuncio con la API de chat de DeepSeek en modo JSON (no admite esquema estricto).',
  keyPattern: GENERIC_KEY,
  keyHelp: 'API key de DeepSeek (se crea en su plataforma).',
  capabilities: ['text'],
  text: { protocol: 'chat-completions', url: 'https://api.deepseek.com/chat/completions', jsonMode: 'json_object', maxTokensField: 'max_tokens', extraBody: { thinking: { type: 'disabled' } } },
  models: [
    text({ id: 'deepseek-flash', label: 'DeepSeek Flash (deepseek-flash)', maker: 'DeepSeek', tier: 'recommended', status: 'unknown', stability: NOT_STATED, pricing: tokenPrice(0.3, 0.006, 1.2, D_PRICING, { context: 'Horas punta (01-04 y 06-10 UTC, de lunes a viernes); en horas valle, la mitad', detail: '0,30 $ por millón de tokens de entrada, 0,006 $ con acierto de caché y 1,20 $ de salida en horas punta (0,15 $, 0,003 $ y 0,60 $ en horas valle)' }), notes: 'Modelo rápido y económico.' }),
    text({ id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro (deepseek-v4-pro)', maker: 'DeepSeek', tier: 'alternative', status: 'unknown', stability: NOT_STATED, pricing: tokenPrice(1.32, 0.044, 3.96, D_PRICING, { context: 'Horas punta (01-04 y 06-10 UTC, de lunes a viernes); en horas valle, la mitad', detail: '1,32 $ por millón de tokens de entrada, 0,044 $ con acierto de caché y 3,96 $ de salida en horas punta (0,66 $, 0,022 $ y 1,98 $ en horas valle)' }), notes: 'Mayor capacidad.' }),
  ],
  moderation: 'La API puede cortar la respuesta por su filtro de contenido (finish_reason «content_filter»): EstateForge lo trata como un bloqueo.',
  allowedHosts: ['api.deepseek.com'],
  links: { site: 'https://www.deepseek.com', docs: 'https://api-docs.deepseek.com/en/', pricing: D_PRICING, terms: 'https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html', privacy: 'https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html', keys: 'https://platform.deepseek.com/api_keys' },
  dataUse: 'No consta una declaración sobre el uso de los datos de la API en las páginas consultadas. Consulta las condiciones de tu cuenta.',
  verification: 'Consulta la lista de modelos (GET /models): no genera contenido. La documentación no indica su coste: solo se hace si lo confirmas.',
  verificationCost: 'unknown',
  consultedAt: CONSULTED_AT,
}

// ------------------------------------------------------------------------------------------------ OpenRouter
export const OPENROUTER: ProviderDefinition = {
  id: 'openrouter',
  name: 'OpenRouter',
  kind: 'aggregator',
  billing: 'Tu cuenta de OpenRouter (créditos de OpenRouter, no la del fabricante del modelo)',
  simulated: false,
  authentication: 'Cabecera Authorization: Bearer',
  description: 'Agregador de modelos de texto de muchos fabricantes con una sola clave. Además de los modelos de ejemplo, EstateForge puede consultar el catálogo de OpenRouter y ofrecer los que admiten salida estructurada.',
  keyPattern: GENERIC_KEY,
  keyHelp: 'API key de OpenRouter (se crea en tu cuenta de OpenRouter).',
  capabilities: ['text', 'model-discovery'],
  text: { protocol: 'chat-completions', url: 'https://openrouter.ai/api/v1/chat/completions', jsonMode: 'json_schema', maxTokensField: 'max_tokens', extraBody: { provider: { require_parameters: true } } },
  models: [
    text({ id: '~anthropic/claude-sonnet-latest', label: 'Claude Sonnet, última versión (~anthropic/claude-sonnet-latest)', maker: 'Anthropic', tier: 'recommended', status: 'unknown', stability: 'Alias de los ejemplos oficiales de OpenRouter', pricing: null, notes: 'Se factura a tu cuenta de OpenRouter con la tarifa de OpenRouter para ese modelo, no con la de Anthropic: consulta la tarifa del proveedor.' }),
    text({ id: '~openai/gpt-sol-latest', label: 'GPT Sol, última versión (~openai/gpt-sol-latest)', maker: 'OpenAI', tier: 'alternative', status: 'unknown', stability: 'Alias de los ejemplos oficiales de OpenRouter', pricing: null, notes: 'Se factura a tu cuenta de OpenRouter con la tarifa de OpenRouter para ese modelo, no con la de OpenAI: consulta la tarifa del proveedor.' }),
  ],
  moderation: 'Depende del proveedor final al que OpenRouter enrute la petición. EstateForge aplica sus reglas locales al texto del anuncio.',
  allowedHosts: ['openrouter.ai'],
  links: { site: 'https://openrouter.ai', docs: 'https://openrouter.ai/docs', pricing: 'https://openrouter.ai/models', terms: 'https://openrouter.ai/terms', privacy: 'https://openrouter.ai/privacy', keys: 'https://openrouter.ai/settings/keys' },
  dataUse: 'Según su documentación, OpenRouter no registra los prompts ni las respuestas salvo que lo actives; el tratamiento final depende del proveedor al que se enrute y de los ajustes de privacidad de tu cuenta.',
  verification: 'OpenRouter no documenta ninguna comprobación de una clave normal que no genere contenido: la conexión queda «sin comprobar» hasta la primera generación.',
  verificationCost: 'unsupported',
  consultedAt: CONSULTED_AT,
}

// ------------------------------------------------------------------------------------------------ Groq
const GROQ_MODELS = 'https://console.groq.com/docs/models'
export const GROQ: ProviderDefinition = {
  id: 'groq',
  name: 'Groq',
  kind: 'aggregator',
  billing: 'Tu cuenta de la consola de Groq (no la del fabricante del modelo)',
  simulated: false,
  authentication: 'Cabecera Authorization: Bearer',
  description: 'Plataforma de inferencia rápida que sirve modelos de pesos abiertos de otros fabricantes. EstateForge solo ofrece los de producción con salida estructurada estricta.',
  keyPattern: GENERIC_KEY,
  keyHelp: 'API key de Groq (se crea en la consola de Groq).',
  capabilities: ['text'],
  text: { protocol: 'chat-completions', url: 'https://api.groq.com/openai/v1/chat/completions', jsonMode: 'json_schema', maxTokensField: 'max_completion_tokens' },
  models: [
    text({ id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B (openai/gpt-oss-120b)', maker: 'OpenAI (pesos abiertos)', tier: 'recommended', status: 'stable', stability: 'Producción', pricing: tokenPrice(0.15, null, 0.6, GROQ_MODELS), notes: 'Servido por Groq: se factura a tu cuenta de Groq.' }),
    text({ id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B (openai/gpt-oss-20b)', maker: 'OpenAI (pesos abiertos)', tier: 'alternative', status: 'stable', stability: 'Producción', pricing: tokenPrice(0.075, 0.037, 0.3, 'https://console.groq.com/docs/model/openai/gpt-oss-20b', { consultedAt: '2026-11-15' }), notes: 'Más rápido y económico. Servido por Groq.' }),
  ],
  moderation: 'La documentación consultada no describe un filtro de contenido en la generación. EstateForge aplica sus reglas locales al texto del anuncio.',
  allowedHosts: ['api.groq.com'],
  links: { site: 'https://groq.com', docs: 'https://console.groq.com/docs/quickstart', pricing: GROQ_MODELS, terms: 'https://groq.com/terms-of-use', privacy: 'https://groq.com/privacy-policy', keys: 'https://console.groq.com/keys' },
  dataUse: 'Según su documentación, Groq no conserva por defecto los datos de las peticiones de inferencia; puede registrarlos temporalmente para diagnosticar errores o abusos.',
  verification: 'Consulta la lista de modelos (GET /openai/v1/models): no genera contenido. La documentación no indica su coste: solo se hace si lo confirmas.',
  verificationCost: 'unknown',
  consultedAt: CONSULTED_AT,
}

// ------------------------------------------------------------------------------------------------ Black Forest Labs
const BFL_PRICING = 'https://bfl.ai/pricing'
export const BFL: ProviderDefinition = {
  id: 'bfl',
  name: 'Black Forest Labs (FLUX)',
  kind: 'direct',
  billing: 'Tu cuenta de Black Forest Labs (créditos de prepago)',
  simulated: false,
  authentication: 'Cabecera x-key',
  description: 'Fondo de cartel con FLUX y vídeo con FLUX 3 Video. Generación asíncrona.',
  keyPattern: GENERIC_KEY,
  keyHelp: 'API key de Black Forest Labs (se crea en su panel de la API).',
  capabilities: ['image', 'image-reference', 'video', 'video-reference', 'async-operations'],
  models: [
    poster({ id: 'flux-3-image', label: 'FLUX 3 Image (flux-3-image)', maker: 'Black Forest Labs', tier: 'recommended', status: 'unknown', stability: NOT_STATED, maxReferenceImages: 10, image: { resolution: '1k', aspectRatio: '4:5' }, pricing: imagePrice(0.048, '0,048 $ por imagen de 1K; las imágenes de referencia y el prompt no tienen coste adicional', BFL_PRICING), notes: 'Hasta 10 imágenes de referencia; EstateForge envía como máximo 3.' }),
    poster({ id: 'flux-2-pro', label: 'FLUX.2 [pro] (flux-2-pro)', maker: 'Black Forest Labs', tier: 'alternative', status: 'unknown', stability: NOT_STATED, maxReferenceImages: 8, image: { resolution: '1024×1280', aspectRatio: '4:5' }, pricing: imagePrice(0.03, '0,03 $ por el primer megapíxel generado y 0,015 $ por megapíxel adicional y por megapíxel de cada imagen de referencia', BFL_PRICING, { estimable: false }), notes: 'Hasta 8 imágenes de referencia; EstateForge envía como máximo 3.' }),
    video({ id: 'flux-3-video', label: 'FLUX 3 Video (flux-3-video)', maker: 'Black Forest Labs', tier: 'recommended', status: 'unknown', stability: NOT_STATED, maxReferenceImages: 4, video: { durations: [6, 8], resolution: 'HD', aspectRatio: '16:9', nativeAudio: 'disabled' }, pricing: secondPrice(0.15, '0,15 $ por segundo de vídeo en HD', BFL_PRICING), notes: 'De 5 a 20 s a partir de fotogramas clave (las fotografías elegidas). Se pide sin audio (generate_audio: false).' }),
  ],
  moderation: 'Moderación de BFL sobre la petición y el resultado (estados «Request Moderated» y «Content Moderated»), con safety_tolerance en su valor por defecto. Según BFL, lo retenido por moderación no se cobra.',
  allowedHosts: ['api.bfl.ai', 'api.eu.bfl.ai', 'api.us.bfl.ai'],
  resultHosts: ['.bfl.ai'],
  links: { site: 'https://bfl.ai', docs: 'https://docs.bfl.ai/', pricing: BFL_PRICING, terms: 'https://bfl.ai/legal/terms-of-service', privacy: 'https://bfl.ai/legal/privacy-policy', keys: 'https://dashboard.bfl.ai/' },
  dataUse: 'Los resultados se entregan por una URL que caduca a los 10 minutos. No consta más información sobre conservación en las páginas consultadas.',
  verification: 'Consulta el saldo de créditos (GET /v1/credits): no genera contenido. La documentación no indica su coste: solo se hace si lo confirmas.',
  verificationCost: 'unknown',
  consultedAt: CONSULTED_AT,
}

// ------------------------------------------------------------------------------------------------ Stability AI
const ST_PRICING = 'https://docs.stability.ai/pricing'
const stability = (id: string, label: string, tier: ModelDefinition['tier'], usd: number, credits: string, notes: string): ModelDefinition =>
  poster({ id, label, maker: 'Stability AI', tier, status: 'unknown', stability: NOT_STATED, maxReferenceImages: 0, image: { resolution: '≈1 megapíxel', aspectRatio: '4:5' }, pricing: imagePrice(usd, `${credits} créditos por imagen (1 crédito = 0,01 $); las generaciones fallidas no se cobran`, ST_PRICING), notes })
export const STABILITY: ProviderDefinition = {
  id: 'stability',
  name: 'Stability AI',
  kind: 'direct',
  billing: 'Tu cuenta de la plataforma de Stability AI (créditos)',
  simulated: false,
  authentication: 'Cabecera Authorization: Bearer',
  description: 'Fondo de cartel con Stable Image a partir de texto (sin fotografías de referencia). Stability ya no ofrece API de vídeo.',
  keyPattern: GENERIC_KEY,
  keyHelp: 'API key de Stability AI (se crea en su plataforma).',
  capabilities: ['image'],
  models: [
    stability('stable-image-core', 'Stable Image Core (stable-image-core)', 'recommended', 0.03, '3', 'Solo texto a imagen: no se envía ninguna fotografía.'),
    stability('stable-image-ultra', 'Stable Image Ultra (stable-image-ultra)', 'alternative', 0.08, '8', 'Mayor calidad. Solo se usa de texto a imagen.'),
    stability('sd3.5-large', 'Stable Diffusion 3.5 Large (sd3.5-large)', 'alternative', 0.065, '6,5', 'Solo se usa de texto a imagen.'),
  ],
  moderation: 'Filtros de entrada y de salida de Stability (403 «content_moderation» y finish_reason «CONTENT_FILTERED») y firma C2PA.',
  allowedHosts: ['api.stability.ai'],
  links: { site: 'https://stability.ai', docs: 'https://docs.stability.ai/api-reference', pricing: ST_PRICING, terms: 'https://stability.ai/terms-of-service', privacy: 'https://stability.ai/privacy-policy', keys: 'https://platform.stability.ai/account/keys' },
  dataUse: 'No consta una declaración sobre el uso de los datos en las páginas consultadas. Consulta las condiciones de tu cuenta.',
  verification: 'Consulta el saldo de créditos (GET /v1/user/balance): no genera contenido. La documentación no indica su coste: solo se hace si lo confirmas.',
  verificationCost: 'unknown',
  consultedAt: CONSULTED_AT,
}

// ------------------------------------------------------------------------------------------------ Ideogram
export const IDEOGRAM: ProviderDefinition = {
  id: 'ideogram',
  name: 'Ideogram',
  kind: 'direct',
  billing: 'Tu cuenta de la plataforma de Ideogram (saldo de prepago)',
  simulated: false,
  authentication: 'Cabecera Api-Key',
  description: 'Fondo de cartel con Ideogram a partir de texto (sin fotografías de referencia).',
  keyPattern: GENERIC_KEY,
  keyHelp: 'API key de Ideogram (se muestra una sola vez al crearla en su plataforma).',
  capabilities: ['image'],
  models: [
    poster({ id: 'ideogram-4-5', label: 'Ideogram 4.5 (ideogram-4-5)', maker: 'Ideogram', tier: 'recommended', status: 'unknown', stability: 'Modelo por defecto de la API v2; la documentación no indica otro estado', maxReferenceImages: 0, image: { resolution: '1024×1024', aspectRatio: '1:1' }, pricing: null, notes: 'Solo texto a imagen. La tabla de precios por imagen de Ideogram se carga de forma dinámica y no se pudo leer: consulta la tarifa del proveedor. Sus condiciones piden identificar el resultado como creado con Ideogram.' }),
  ],
  moderation: 'Comprobación de seguridad de Ideogram: 422 si el prompt no la supera y marca is_image_safe en cada imagen (si es falsa, no hay imagen).',
  allowedHosts: ['api.ideogram.ai'],
  resultHosts: ['ideogram.ai', '.ideogram.ai'],
  links: { site: 'https://ideogram.ai', docs: 'https://developer.ideogram.ai/', pricing: 'https://ideogram.ai/pricing/?pricing_tab=api', terms: 'https://ideogram.ai/legal/api-tos', privacy: 'https://ideogram.ai/legal/privacy', keys: 'https://ideogram.ai/platform' },
  dataUse: 'Según su acuerdo de la API, Ideogram no entrena con las entradas ni las salidas, salvo el contenido marcado como infractor.',
  verification: 'Pide un presupuesto con dry_run=true: según la documentación, no genera ni cobra.',
  verificationCost: 'free',
  consultedAt: CONSULTED_AT,
}

// ------------------------------------------------------------------------------------------------ Recraft
const RC_PRICING = 'https://www.recraft.ai/docs/api-reference/pricing'
const recraft = (id: string, label: string, tier: ModelDefinition['tier'], usd: number, detail: string, notes: string): ModelDefinition =>
  poster({ id, label, maker: 'Recraft', tier, status: 'unknown', stability: NOT_STATED, maxReferenceImages: 0, image: { resolution: '1K (1024×1024)', aspectRatio: '1:1' }, pricing: imagePrice(usd, detail, RC_PRICING), notes })
export const RECRAFT: ProviderDefinition = {
  id: 'recraft',
  name: 'Recraft',
  kind: 'direct',
  billing: 'Tu cuenta de Recraft (unidades de API de prepago)',
  simulated: false,
  authentication: 'Cabecera Authorization: Bearer',
  description: 'Fondo de cartel con Recraft a partir de texto (sin fotografías de referencia).',
  keyPattern: GENERIC_KEY,
  keyHelp: 'Token de la API de Recraft (se crea en tu cuenta de Recraft).',
  capabilities: ['image'],
  models: [
    recraft('recraftv4_1', 'Recraft V4.1 (recraftv4_1)', 'recommended', 0.035, '0,035 $ por imagen', 'Modelo por defecto de la API.'),
    recraft('recraftv4_1_flash', 'Recraft V4.1 Flash (recraftv4_1_flash)', 'alternative', 0.007, '0,007 $ por imagen', 'El más rápido y económico.'),
  ],
  moderation: 'Recraft puede aplicar filtros automáticos, pero su respuesta no incluye ninguna marca de seguridad: la comprobación del resultado depende del clasificador externo que elijas.',
  allowedHosts: ['external.api.recraft.ai'],
  links: { site: 'https://www.recraft.ai/api', docs: 'https://www.recraft.ai/docs/api-reference', pricing: RC_PRICING, terms: 'https://www.recraft.ai/legal/developer-terms', privacy: 'https://www.recraft.ai/privacy', keys: 'https://www.recraft.ai/app/api/api-keys' },
  dataUse: 'Según sus condiciones para desarrolladores, Recraft no entrena con los resultados de la API y no los conserva más allá de lo necesario para entregarlos.',
  verification: 'Consulta la cuenta (GET /v1/users/me): no genera contenido. La documentación no indica su coste: solo se hace si lo confirmas.',
  verificationCost: 'unknown',
  consultedAt: CONSULTED_AT,
}

// ------------------------------------------------------------------------------------------------ Runway (agregador)
const RW_PRICING = 'https://docs.dev.runwayml.com/guides/pricing/'
const RW_NOTE = 'Servido por Runway: se factura a tu cuenta de Runway en créditos (1 crédito = 0,01 $), con la tarifa de Runway.'
const runwayVideo = (id: string, label: string, maker: string, tier: ModelDefinition['tier'], usd: number, detail: string, spec: NonNullable<ModelDefinition['video']>, refs: number, notes: string, extra: Partial<ModelDefinition> = {}): ModelDefinition =>
  video({ id, label: `${label} (${id})`, maker, tier, status: 'unknown', stability: NOT_STATED, maxReferenceImages: refs, video: spec, pricing: secondPrice(usd, detail, RW_PRICING), notes: `${notes} ${RW_NOTE}`, ...extra })
const runwayImage = (id: string, label: string, maker: string, tier: ModelDefinition['tier'], refs: number, pricing: ModelDefinition['pricing'], notes: string): ModelDefinition =>
  poster({ id, label: `${label} (${id})`, maker, tier, status: 'unknown', stability: NOT_STATED, maxReferenceImages: refs, image: { resolution: '≈1 megapíxel', aspectRatio: '3:4' }, pricing, notes: `${notes} ${RW_NOTE}` })
const HD169 = { resolution: '720p', aspectRatio: '16:9' }

export const RUNWAY: ProviderDefinition = {
  id: 'runway',
  name: 'Runway',
  kind: 'aggregator',
  billing: 'Tu cuenta de la API de Runway (créditos de Runway, no la del fabricante del modelo)',
  simulated: false,
  authentication: 'Cabecera Authorization: Bearer (y X-Runway-Version)',
  description: 'Modelos propios de Runway y de terceros (Kling, ByteDance Seedance, MiniMax, Alibaba WAN, Google Veo y Omni, xAI Grok Imagine, OpenAI GPT Image…) con una sola clave de Runway.',
  keyPattern: /^key_[A-Za-z0-9_-]{16,250}$/,
  keyHelp: 'API key de Runway (empieza por key_; se crea en el portal de desarrolladores de Runway).',
  capabilities: ['image', 'image-reference', 'video', 'video-reference', 'async-operations'],
  models: [
    runwayVideo('gen4.5', 'Gen-4.5', 'Runway', 'recommended', 0.12, '12 créditos (0,12 $) por segundo', { durations: [4, 6, 8], ...HD169, nativeAudio: 'none' }, 1, 'Parte de la fotografía principal como primer fotograma.'),
    runwayVideo('veo3.1_fast', 'Veo 3.1 Fast', 'Google', 'alternative', 0.1, '10 créditos (0,10 $) por segundo sin audio (15 con audio)', { durations: [4, 6, 8], ...HD169, nativeAudio: 'disabled' }, 1, 'Veo ya no está disponible en la API de Gemini; Runway lo sirve. Se pide sin audio.'),
    runwayVideo('veo3.1', 'Veo 3.1', 'Google', 'alternative', 0.2, '20 créditos (0,20 $) por segundo sin audio (40 con audio)', { durations: [4, 6, 8], ...HD169, nativeAudio: 'disabled' }, 1, 'Veo ya no está disponible en la API de Gemini; Runway lo sirve. Se pide sin audio.'),
    runwayVideo('kling3.0_standard', 'Kling 3.0 Standard', 'Kling (Kuaishou)', 'alternative', 0.09, '9 créditos (0,09 $) por segundo sin audio (13 con audio)', { durations: [4, 6, 8], ...HD169, nativeAudio: 'disabled' }, 1, 'Se pide sin audio.'),
    runwayVideo('kling3.0_pro', 'Kling 3.0 Pro', 'Kling (Kuaishou)', 'alternative', 0.12, '12 créditos (0,12 $) por segundo sin audio (17 con audio)', { durations: [4, 6, 8], resolution: '1080p', aspectRatio: '16:9', nativeAudio: 'disabled' }, 1, 'Se pide sin audio.'),
    runwayVideo('kling_4', 'Kling 4.0', 'Kling (Kuaishou)', 'alternative', 0.1256, '12,56 créditos (0,1256 $) por segundo a 720p hasta el 30/11/2026 (después, 15,7 créditos: 0,157 $)', { durations: [4, 6, 8], resolution: '720p', aspectRatio: 'el de la fotografía principal', nativeAudio: 'discarded' }, 1, 'El modelo siempre genera audio: EstateForge lo descarta.', {
      pricing: secondPrice(0.1256, '12,56 créditos (0,1256 $) por segundo a 720p hasta el 30/11/2026 (después, 15,7 créditos: 0,157 $)', RW_PRICING, { status: 'temporary', validUntil: '2026-11-30' }),
    }),
    runwayVideo('seedance2_fast', 'Seedance 2.0 Fast', 'ByteDance', 'alternative', 0.24, '24 créditos (0,24 $) por segundo a 720p', { durations: [4, 6, 8], ...HD169, nativeAudio: 'disabled' }, 1, 'Se pide sin audio.'),
    runwayVideo('seedance2_5', 'Seedance 2.5', 'ByteDance', 'alternative', 0.3, '30 créditos (0,30 $) por segundo a 720p', { durations: [4, 6, 8], ...HD169, nativeAudio: 'disabled' }, 1, 'Se pide sin audio.'),
    runwayVideo('hailuo3', 'MiniMax H3 (Hailuo)', 'MiniMax', 'alternative', 0.1, '10 créditos (0,10 $) por segundo a 768p, más 2 créditos por fotograma clave', { durations: [6, 8], resolution: '768p', aspectRatio: '16:9', nativeAudio: 'discarded' }, 1, 'De 5 a 15 s. La API de Runway no ofrece un conmutador de audio para este modelo: si el clip trae audio, EstateForge lo descarta.'),
    runwayVideo('wan3', 'WAN 3.0', 'Alibaba', 'alternative', 0.1, '10 créditos (0,10 $) por segundo a 720p', { durations: [4, 6, 8], resolution: '720p', aspectRatio: 'el de la fotografía principal', nativeAudio: 'disabled' }, 1, 'Se pide sin audio.'),
    runwayVideo('grok_imagine_1_5', 'Grok Imagine Video 1.5', 'xAI', 'alternative', 0.16, '16 créditos (0,16 $) por segundo a 720p, más 1 crédito por imagen de referencia', { durations: [4, 6, 8], resolution: '720p', aspectRatio: 'el de la fotografía principal', nativeAudio: 'discarded' }, 1, 'La API de Runway no ofrece un conmutador de audio para este modelo: EstateForge descarta el audio.'),
    runwayVideo('gemini_omni_flash_1.2', 'Gemini Omni 1.2 Flash', 'Google', 'alternative', 0.07, '7 créditos (0,07 $) por segundo a 720p o 2 créditos (0,02 $) a 360p, más 1 crédito por imagen de referencia; mínimo de 6 créditos por petición', { durations: [4, 6, 8], ...HD169, nativeAudio: 'discarded', resolutionOptions: [{ id: '720p', label: '720p (1280×720)', usdPerSecond: 0.07 }, { id: '360p', label: '360p (640×360)', usdPerSecond: 0.02 }] }, 1, 'El mismo modelo que la integración directa de Google, con la tarifa de Runway. Todos sus clips llevan audio generado: EstateForge lo descarta y pone el sonido elegido por el usuario o silencio.', { pricing: secondPrice(0.07, '7 créditos (0,07 $) por segundo a 720p o 2 créditos (0,02 $) a 360p, más 1 crédito por imagen de referencia; mínimo de 6 créditos por petición', 'https://dev.runwayml.com/learn/gemini-omni-flash-1-2-api', { consultedAt: '2026-11-15', referenceUsd: 0.01, minimumUsd: 0.06 }) }),
    runwayImage('gen4_image', 'Gen-4 Image', 'Runway', 'recommended', 3, imagePrice(0.05, '5 créditos (0,05 $) por imagen a 720p', RW_PRICING), 'Hasta 3 imágenes de referencia.'),
    runwayImage('nano_banana_2.1', 'Nano Banana 2.1', 'Google', 'alternative', 14, imagePrice(0.04, '4 créditos (0,04 $) por imagen de 1K; las imágenes de referencia no añaden coste', 'https://dev.runwayml.com/learn/nano-banana-2-1-api', { consultedAt: '2026-11-15', referenceUsd: 0 }), 'Hasta 14 imágenes de referencia; EstateForge envía como máximo 3.'),
    runwayImage('seedream5_pro', 'Seedream 5.0 Pro', 'ByteDance', 'alternative', 3, imagePrice(0.05, '5 créditos (0,05 $) por imagen de 1K', RW_PRICING), 'EstateForge envía como máximo 3 imágenes de referencia.'),
    runwayImage('gpt_image_2_6_flare', 'GPT Image 2.6 Flare', 'OpenAI', 'alternative', 16, imagePrice(0.02, 'De 2 a 19 créditos (0,02 $ a 0,19 $) por imagen según la calidad y el tamaño, más 1 crédito por imagen de referencia', RW_PRICING, { estimable: false }), 'Hasta 16 imágenes de referencia; EstateForge envía como máximo 3.'),
    runwayImage('grok_imagine_image_2', 'Grok Imagine Image 2', 'xAI', 'alternative', 3, imagePrice(0.04, 'De 4 a 8 créditos (0,04 $ a 0,08 $) por imagen, más 1 crédito por imagen de referencia', RW_PRICING, { estimable: false }), 'Hasta 3 imágenes de referencia.'),
  ],
  moderation: 'Runway modera todas las entradas y los resultados (failureCode SAFETY.INPUT.* y SAFETY.OUTPUT.*). Según su documentación, las solicitudes moderadas se cobran igual que las correctas.',
  allowedHosts: ['api.dev.runwayml.com'],
  resultHosts: ['.cloudfront.net', '.runwayml.com'],
  links: { site: 'https://runwayml.com/api', docs: 'https://docs.dev.runwayml.com/', pricing: RW_PRICING, terms: 'https://runwayml.com/terms-of-use', privacy: 'https://runwayml.com/privacy-policy', keys: 'https://dev.runwayml.com/' },
  dataUse: 'No consta una declaración sobre conservación o entrenamiento en las páginas consultadas. Los modelos de terceros pueden aplicar sus propias condiciones. Las salidas caducan en 24-48 horas.',
  verification: 'Consulta la organización y su saldo (GET /v1/organization): no genera contenido. La documentación no indica su coste: solo se hace si lo confirmas.',
  verificationCost: 'unknown',
  consultedAt: CONSULTED_AT,
}

// ------------------------------------------------------------------------------------------------ fal.ai (agregador)
const FAL_NOTE = 'Servido por fal.ai: se factura a tu cuenta de fal.ai con la tarifa de fal.ai.'
const falModel = (id: string) => `https://fal.ai/models/${id}`
export const FAL: ProviderDefinition = {
  id: 'fal',
  name: 'fal.ai',
  kind: 'aggregator',
  billing: 'Tu cuenta de fal.ai (créditos de prepago, no la del fabricante del modelo)',
  simulated: false,
  authentication: 'Cabecera Authorization: Key',
  description: 'Agregador con cola asíncrona que sirve modelos de imagen y de vídeo de muchos fabricantes (FLUX, Nano Banana, Kling, Seedance, MiniMax…).',
  keyPattern: GENERIC_KEY,
  keyHelp: 'API key de fal.ai con el permiso «API» (se crea en el panel de fal.ai).',
  capabilities: ['image', 'image-reference', 'video', 'video-reference', 'async-operations'],
  models: [
    poster({ id: 'fal-ai/flux-2', label: 'FLUX.2 [dev] (fal-ai/flux-2)', maker: 'Black Forest Labs', tier: 'recommended', status: 'unknown', stability: NOT_STATED, maxReferenceImages: 0, image: { resolution: '1024×1280', aspectRatio: '4:5' }, pricing: imagePrice(0.012, '0,012 $ por megapíxel (una imagen de 1024×1280 es ≈1,3 megapíxeles)', falModel('fal-ai/flux-2'), { estimable: false }), notes: `Solo texto a imagen. ${FAL_NOTE}` }),
    poster({ id: 'fal-ai/flux-2/edit', label: 'FLUX.2 [dev] con referencias (fal-ai/flux-2/edit)', maker: 'Black Forest Labs', tier: 'alternative', status: 'unknown', stability: NOT_STATED, maxReferenceImages: 4, image: { resolution: '1024×1280', aspectRatio: '4:5' }, pricing: imagePrice(0.012, '0,012 $ por megapíxel de entrada y de salida', falModel('fal-ai/flux-2/edit'), { estimable: false }), notes: `Hasta 4 imágenes de referencia; EstateForge envía como máximo 3. ${FAL_NOTE}` }),
    poster({ id: 'fal-ai/nano-banana-2', label: 'Nano Banana 2 (fal-ai/nano-banana-2)', maker: 'Google', tier: 'alternative', status: 'unknown', stability: NOT_STATED, maxReferenceImages: 0, image: { resolution: '1K', aspectRatio: '4:5' }, pricing: imagePrice(0.08, '0,08 $ por imagen de 1K', falModel('fal-ai/nano-banana-2')), notes: `Solo texto a imagen en esta integración. ${FAL_NOTE}` }),
    video({ id: 'fal-ai/kling-video/v3/pro/image-to-video', label: 'Kling 3.0 Pro (fal-ai/kling-video/v3/pro/image-to-video)', maker: 'Kling (Kuaishou)', tier: 'recommended', status: 'unknown', stability: NOT_STATED, maxReferenceImages: 1, video: { durations: [4, 6, 8], resolution: 'la del modelo', aspectRatio: 'el de la fotografía principal', nativeAudio: 'disabled' }, pricing: secondPrice(0.112, '0,112 $ por segundo sin audio (0,168 $ con audio)', falModel('fal-ai/kling-video/v3/pro/image-to-video')), notes: `Parte de la fotografía principal. Se pide sin audio. ${FAL_NOTE}` }),
    video({ id: 'bytedance/seedance-2.0/fast/image-to-video', label: 'Seedance 2.0 Fast (bytedance/seedance-2.0/fast/image-to-video)', maker: 'ByteDance', tier: 'alternative', status: 'unknown', stability: NOT_STATED, maxReferenceImages: 1, video: { durations: [4, 6, 8], resolution: '720p', aspectRatio: '16:9', nativeAudio: 'disabled' }, pricing: secondPrice(0.2419, '0,2419 $ por segundo de vídeo a 720p', falModel('bytedance/seedance-2.0/fast/image-to-video')), notes: `Parte de la fotografía principal. Se pide sin audio. ${FAL_NOTE}` }),
    video({ id: 'minimax/h3-max/image-to-video', label: 'MiniMax H3 Max (minimax/h3-max/image-to-video)', maker: 'MiniMax', tier: 'alternative', status: 'unknown', stability: NOT_STATED, maxReferenceImages: 1, video: { durations: [6, 8], resolution: '768P', aspectRatio: 'el de la fotografía principal', nativeAudio: 'discarded' }, pricing: secondPrice(0.056, '0,056 $ por segundo a 768p hasta el 15/11/2026 (desde el 16/11/2026: 0,08 $)', falModel('minimax/h3-max/image-to-video'), { status: 'temporary', validUntil: '2026-11-15' }), notes: `Parte de la fotografía principal. Si el clip trae audio, EstateForge lo descarta. ${FAL_NOTE}` }),
  ],
  moderation: 'Comprobador de seguridad de cada modelo activado (enable_safety_checker) y errores «content_policy_violation». Depende del modelo.',
  allowedHosts: ['queue.fal.run', 'api.fal.ai'],
  resultHosts: ['fal.media', '.fal.media'],
  links: { site: 'https://fal.ai', docs: 'https://fal.ai/docs', pricing: 'https://fal.ai/pricing', terms: 'https://fal.ai/terms', privacy: 'https://fal.ai/privacy', keys: 'https://fal.ai/dashboard/keys' },
  dataUse: 'fal conserva por defecto las entradas y salidas 90 días en el historial; EstateForge envía X-Fal-Store-IO: 0 para que no se guarden. Las fotografías viajan como datos en la petición (data URI), nunca como una URL pública.',
  verification: 'Consulta el precio de un modelo (GET api.fal.ai/v1/models/pricing), que exige una clave válida: no genera contenido. La documentación no indica su coste: solo se hace si lo confirmas.',
  verificationCost: 'unknown',
  consultedAt: CONSULTED_AT,
}

// ------------------------------------------------------------------------------------------------ Replicate (agregador)
export const REPLICATE: ProviderDefinition = {
  id: 'replicate',
  name: 'Replicate',
  kind: 'aggregator',
  billing: 'Tu cuenta de Replicate (no la del fabricante del modelo)',
  simulated: false,
  authentication: 'Cabecera Authorization: Bearer',
  description: 'Agregador de modelos «oficiales» de terceros. EstateForge solo ofrece aquellos cuyos parámetros de entrada constan en su documentación pública.',
  keyPattern: /^r8_[A-Za-z0-9]{20,100}$/,
  keyHelp: 'Token de la API de Replicate (empieza por r8_).',
  capabilities: ['video', 'video-reference', 'async-operations'],
  models: [
    video({ id: 'bytedance/seedance-2.5', label: 'Seedance 2.5 (bytedance/seedance-2.5)', maker: 'ByteDance', tier: 'recommended', status: 'unknown', stability: NOT_STATED, maxReferenceImages: 1, video: { durations: [4, 6, 8], resolution: 'la del modelo', aspectRatio: '16:9', nativeAudio: 'disabled' }, pricing: null, notes: 'Parte de la fotografía principal. Se pide sin audio. Servido por Replicate: se factura a tu cuenta de Replicate; el precio de este modelo no consta en la página consultada: consulta la tarifa del proveedor.' }),
  ],
  moderation: 'Depende del modelo. La documentación consultada no describe un filtro común.',
  allowedHosts: ['api.replicate.com'],
  resultHosts: ['replicate.delivery', '.replicate.delivery'],
  links: { site: 'https://replicate.com', docs: 'https://replicate.com/docs/reference/http', pricing: 'https://replicate.com/pricing', terms: 'https://replicate.com/terms', privacy: 'https://replicate.com/privacy', keys: 'https://replicate.com/account/api-tokens' },
  dataUse: 'Según su documentación, las entradas, las salidas y los archivos de las predicciones creadas por la API se borran al cabo de una hora.',
  verification: 'Consulta la cuenta (GET /v1/account): no genera contenido. La documentación no indica su coste: solo se hace si lo confirmas.',
  verificationCost: 'unknown',
  consultedAt: CONSULTED_AT,
}

// ------------------------------------------------------------------------------------------------ Simulador local
export const SIMULATOR: ProviderDefinition = {
  id: 'simulador',
  kind: 'direct',
  billing: 'Nadie: no hay ninguna llamada externa',
  authentication: 'Ninguna llamada externa',
  name: 'Simulador local (no es un proveedor real)',
  simulated: true,
  description: 'Solo para desarrollo y pruebas: genera resultados de ejemplo sin red ni cargos. No usa IA.',
  keyPattern: SIMULATOR_KEY_PATTERN,
  keyHelp: 'Clave de prueba con la forma sim-ok-xxxxxxxx (el texto tras «sim-» elige el escenario).',
  capabilities: ['text', 'image', 'image-reference', 'video', 'video-reference', 'moderation', 'moderation-video', 'async-operations'],
  text: { protocol: 'local' },
  models: [
    text({ id: 'sim-texto-1', label: 'Simulador de texto', maker: 'EstateForge (simulador)', tier: 'recommended', status: 'experimental', stability: 'Simulado', pricing: null, notes: 'Texto generado localmente con la plantilla de EstateForge.' }),
    poster({ id: 'sim-imagen-1', label: 'Simulador de imagen', maker: 'EstateForge (simulador)', tier: 'recommended', status: 'experimental', stability: 'Simulado', maxReferenceImages: 3, pricing: null, notes: 'Fondo degradado generado localmente.' }),
    poster({ id: 'sim-imagen-texto', label: 'Simulador de imagen sin referencias', maker: 'EstateForge (simulador)', tier: 'alternative', status: 'experimental', stability: 'Simulado', maxReferenceImages: 0, pricing: null, notes: 'Como un modelo que solo genera a partir de texto: no se envía ninguna fotografía.' }),
    video({ id: 'sim-video-1', label: 'Simulador de vídeo', maker: 'EstateForge (simulador)', tier: 'recommended', status: 'experimental', stability: 'Simulado', maxReferenceImages: 6, video: { durations: [4, 6, 8], resolution: '720p', aspectRatio: '16:9', nativeAudio: 'discarded' }, pricing: null, notes: 'Clip de prueba de 6 s con un tono de audio que EstateForge descarta.' }),
  ],
  moderation: 'Moderación simulada (determinista según la clave de prueba).',
  allowedHosts: [],
  links: { site: '', docs: '', pricing: '', terms: '', privacy: '', keys: '' },
  dataUse: 'No sale ningún dato del servidor.',
  verification: 'Comprobación local, sin red.',
  verificationCost: 'free',
  consultedAt: CONSULTED_AT,
}

/** Orden del catálogo: directos de texto, de imagen y vídeo, y después los agregadores. */
export const REAL_PROVIDERS: readonly ProviderDefinition[] = [GEMINI, OPENAI, ANTHROPIC, XAI, MISTRAL, DEEPSEEK, BFL, STABILITY, IDEOGRAM, RECRAFT, OPENROUTER, GROQ, RUNWAY, FAL, REPLICATE]
