// Comprobación semántica de una fila de auditoría «aviso de cambio de email no entregado» (F0-002, MD-37).
//
// Lo que se protege: cuando el aviso de seguridad no se puede enviar, la auditoría guarda SOLO el tipo
// de fallo (DELIVERY o INCIDENT_LINK). No debe guardar direcciones de correo, el enlace o el token de
// incidente, ni el mensaje del servidor de correo (p. ej. «550 Recipient rejected: …»).
//
// La comprobación se hace campo a campo. Los campos técnicos (id, createdAt) son aleatorios y pueden
// contener cualquier secuencia de cifras por casualidad: se validan por su tipo y nunca se buscan
// textos en ellos. Los campos funcionales (action, reason, metadata y los identificadores de actor y
// destino) se comparan con su valor exacto.

export interface NoticeAuditRow {
  id: unknown
  actorUserId: unknown
  targetUserId: unknown
  action: unknown
  reason: unknown
  metadata: unknown
  createdAt: unknown
}

export interface NoticeAuditExpectation {
  userId: string
  noticeFailure: 'DELIVERY' | 'INCIDENT_LINK'
  /** Textos que no pueden aparecer en ningún campo funcional (emails, enlace, token, error SMTP). */
  forbidden: readonly string[]
}

const FIELDS = ['action', 'actorUserId', 'createdAt', 'id', 'metadata', 'reason', 'targetUserId']

/** Devuelve la lista de incumplimientos; vacía si la fila es correcta. */
export function noticeAuditProblems(row: NoticeAuditRow, expected: NoticeAuditExpectation): string[] {
  const problems: string[] = []
  const keys = Object.keys(row).sort()
  if (keys.join() !== FIELDS.join()) problems.push(`campos inesperados: ${keys.join()}`)

  // Campos técnicos: solo su tipo.
  if (typeof row.id !== 'string' || row.id.length === 0) problems.push('id: no es un identificador')
  if (!(row.createdAt instanceof Date) || Number.isNaN(row.createdAt.getTime())) problems.push('createdAt: no es una fecha')

  // Campos funcionales: valor exacto.
  if (row.action !== 'EMAIL_CHANGE_NOTICE_FAILED') problems.push('action: valor inesperado')
  if (row.actorUserId !== expected.userId) problems.push('actorUserId: no es el usuario')
  if (row.targetUserId !== expected.userId) problems.push('targetUserId: no es el usuario')
  if (row.reason !== null) problems.push('reason: debe ser null')

  let metadata: unknown = undefined
  if (typeof row.metadata !== 'string') {
    problems.push('metadata: no es texto JSON')
  } else {
    try {
      metadata = JSON.parse(row.metadata)
    } catch {
      problems.push('metadata: JSON no válido')
    }
  }
  if (metadata !== undefined) {
    const entries = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? Object.entries(metadata) : null
    if (!entries || entries.length !== 1 || entries[0][0] !== 'noticeFailure') problems.push('metadata: debe contener solo noticeFailure')
    else if (entries[0][1] !== expected.noticeFailure) problems.push(`metadata.noticeFailure: se esperaba ${expected.noticeFailure}`)
  }

  // Fugas: solo en los campos de texto libre que escribe la aplicación.
  for (const field of ['action', 'reason', 'metadata'] as const) {
    const value = row[field]
    if (typeof value !== 'string') continue
    for (const text of expected.forbidden) {
      if (text && value.includes(text)) problems.push(`${field}: contiene un dato que no debe guardarse`)
    }
  }
  return problems
}
