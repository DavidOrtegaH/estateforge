import type { AiTrial } from '@/services/aiMediaService'

// Presentación del informe de una prueba real controlada (DA-89).

/** Resumen legible del informe de la prueba (sin secretos: la API nunca los incluye). */
export function trialSummary(trial: AiTrial): string[] {
  const report = trial.report as Record<string, Record<string, unknown> | string | boolean | undefined>
  const output = (report.output ?? {}) as Record<string, unknown>
  const lines: string[] = []
  if (trial.kind === 'text' && output.structured) lines.push(`Respuesta estructurada válida: título de ${output.titleLength} caracteres, ${output.highlights} destacados.`)
  const usage = report.usage as unknown as { reported?: boolean; inputTokens?: number | null; outputTokens?: number | null; estimatedUsd?: number | null; note?: string } | undefined
  if (trial.kind === 'text' && usage && typeof usage === 'object') {
    if (usage.reported) lines.push(`Tokens que devuelve la API: ${usage.inputTokens ?? '—'} de entrada y ${usage.outputTokens ?? '—'} de salida${usage.estimatedUsd != null ? `; coste estimado ${usage.estimatedUsd.toLocaleString('es-ES', { style: 'currency', currency: 'USD', maximumFractionDigits: 5 })} (no es la factura del proveedor)` : ''}.`)
    else if (usage.note) lines.push(usage.note)
  }
  if (trial.kind !== 'text' && output.mimeType) {
    const size = typeof output.bytes === 'number' ? `${(output.bytes / 1024).toFixed(0)} KB` : ''
    const shape = trial.kind === 'poster' ? `${output.width}×${output.height} px` : `${((output.durationMs as number) / 1000).toFixed(1)} s${output.videoCodec ? `, códec ${output.videoCodec}` : ''}${output.hasAudio ? ' (el audio del modelo se descartaría)' : ''}`
    lines.push(`Resultado ${output.valid ? 'válido' : 'no válido'}: ${output.mimeType}, ${shape}, ${size}${output.resultHost ? `, entregado desde ${output.resultHost}` : ''}.`)
  }
  if (report.inputModeration) lines.push(`Moderación de la entrada: ${report.inputModeration === 'passed' ? 'superada' : 'bloqueada'}.`)
  if (report.outputModeration) lines.push(`Moderación del resultado: ${report.outputModeration === 'passed' ? 'superada' : 'bloqueada'}.`)
  if (typeof report.durationMs === 'number') lines.push(`Tiempo de respuesta: ${(report.durationMs / 1000).toFixed(1)} s.`)
  if (trial.status === 'passed') lines.push('El resultado no se ha guardado ni sustituye ningún material.')
  return lines
}
