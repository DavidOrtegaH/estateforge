import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { deflateSync } from 'node:zlib'

import type { AiProviderAdapter, ModerationRequest, ModerationVerdict, OperationState, ProviderContext, SubmitRequest, VerifyResult } from './adapter.js'
import { AiMediaError } from './errors.js'

// Simulador local de proveedor de IA (DA-70). NO es un proveedor real ni se presenta como tal: solo se
// registra en desarrollo y pruebas (AI_MEDIA_SIMULATOR=1, nunca en producción ni en Vercel), no hace
// ninguna llamada de red y no genera cargos. Sirve para recorrer el flujo completo (credencial cifrada,
// trabajo asíncrono, moderación, revisión y sustitución) sin una API key real.
//
// La «API key» del simulador elige el escenario: sim-<escenario>-<8+ caracteres>.
//   sim-ok-…                 genera y aprueba
//   sim-bloqueo-proveedor-…  el «proveedor» marca el resultado como inseguro
//   sim-bloqueo-salida-…     la moderación de salida lo bloquea (texto en el resultado)
//   sim-bloqueo-entrada-…    la moderación de entrada bloquea las fotografías
//   sim-sin-moderacion-…     la moderación no está disponible
//   sim-error-proveedor-…    la operación falla en el «proveedor»
//   sim-invalida-…           clave rechazada

export const SIMULATOR_KEY_PATTERN = /^sim-[a-z0-9-]{8,64}$/

type Scenario = 'ok' | 'bloqueo-proveedor' | 'bloqueo-salida' | 'bloqueo-entrada' | 'sin-moderacion' | 'error-proveedor' | 'invalida'
const SCENARIOS: Scenario[] = ['bloqueo-proveedor', 'bloqueo-salida', 'bloqueo-entrada', 'sin-moderacion', 'error-proveedor', 'invalida', 'ok']

function scenarioOf(apiKey: string): Scenario {
  return SCENARIOS.find(s => apiKey.startsWith(`sim-${s}-`)) ?? 'ok'
}

const CLIP_PATH = resolve(import.meta.dirname, 'fixtures', 'simulador-clip.webm')

/** PNG RGB sin dependencias (fondo degradado del «cartel» simulado). */
export function simulatedBackground(width = 928, height = 1152, seed = 0): Buffer {
  const rows = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1)
    rows[row] = 0
    for (let x = 0; x < width; x++) {
      const t = (x / width + y / height) / 2
      const wave = Math.sin((x + seed * 37) / 70) * Math.cos(y / 90) * 18
      const i = row + 1 + x * 3
      rows[i] = Math.round(30 + 60 * t + wave) & 255
      rows[i + 1] = Math.round(70 + 80 * (1 - t) + wave) & 255
      rows[i + 2] = Math.round(110 + 90 * t) & 255
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf: Buffer) => {
    let c = 0xffffffff
    for (const byte of buf) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8)
    head.writeUInt32BE(data.length, 0)
    head.write(type, 4, 'ascii')
    const tail = Buffer.alloc(4)
    tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), data])), 0)
    return Buffer.concat([head, data, tail])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}

export function createSimulatorAdapter(delayMs = Number(process.env.AI_SIMULATOR_DELAY_MS ?? 2500)): AiProviderAdapter {
  return {
    async verifyKey(ctx: ProviderContext): Promise<VerifyResult> {
      return scenarioOf(ctx.apiKey) === 'invalida' ? { ok: false, code: 'AI_INVALID_KEY' } : { ok: true }
    },
    async submit(ctx: ProviderContext, request: SubmitRequest) {
      if (scenarioOf(ctx.apiKey) === 'invalida') throw new AiMediaError('AI_INVALID_KEY', 'El proveedor ha rechazado la API key.')
      return { operationId: `sim.${request.kind}.${Date.now()}.${randomUUID()}` }
    },
    async poll(ctx: ProviderContext, operationId: string): Promise<OperationState> {
      const [, kind, started] = operationId.split('.')
      if (Date.now() - Number(started) < delayMs) return { state: 'running' }
      const scenario = scenarioOf(ctx.apiKey)
      if (scenario === 'error-proveedor') return { state: 'failed', code: 'AI_PROVIDER_FAILED' }
      const output = kind === 'poster' ? { mimeType: 'image/png', data: simulatedBackground(928, 1152, Number(started) % 97) } : { mimeType: 'video/webm', data: readFileSync(CLIP_PATH) }
      return { state: 'done', output, providerFlagged: scenario === 'bloqueo-proveedor' }
    },
    async cancel() {
      return true
    },
    async fetchResult() {
      throw new AiMediaError('AI_SSRF_BLOCKED', 'El simulador no descarga URLs.')
    },
    async moderate(ctx: ProviderContext, request: ModerationRequest): Promise<ModerationVerdict> {
      const scenario = scenarioOf(ctx.apiKey)
      if (scenario === 'sin-moderacion') throw new AiMediaError('MODERATION_UNAVAILABLE', 'No se ha podido completar la comprobación de seguridad.', 'moderation_unavailable')
      if (request.stage === 'input' && scenario === 'bloqueo-entrada') return { allowed: false, categories: ['sexual_explicit'] }
      if (request.stage === 'output' && scenario === 'bloqueo-salida') return { allowed: false, categories: ['text_in_generated_media'] }
      return { allowed: true, categories: [] }
    },
  }
}
