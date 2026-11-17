import type { GeneratedListing } from '@estateforge/shared'

/** Tokens que el proveedor dice haber consumido en la última petición (DA-92). Ausente si no los devuelve. */
export interface AIUsage {
  inputTokens?: number
  outputTokens?: number
}

export interface AIProvider {
  generate(prompt: string): Promise<GeneratedListing>
  /** Consumo de la última llamada, tal como lo devuelve el proveedor; nunca se estima ni se inventa. */
  lastUsage?: AIUsage
}

/** Lee un número de tokens solo si es un entero no negativo. */
export function tokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}

export function usageFrom(input: unknown, output: unknown): AIUsage | undefined {
  const usage = { inputTokens: tokenCount(input), outputTokens: tokenCount(output) }
  return usage.inputTokens === undefined && usage.outputTokens === undefined ? undefined : usage
}