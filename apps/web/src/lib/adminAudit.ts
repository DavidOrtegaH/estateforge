// id null: no hay cuenta que mostrar (acción sin actor autenticado).
export type AuditAccountView = { primary: string; id: string | null; note: string | null }

export const UNAUTHENTICATED_ACTOR_LABEL = 'Solicitud no autenticada'

/**
 * Texto para identificar una cuenta en la auditoría. Sin cuenta devuelve null.
 * Nunca inventa un email: si la cuenta no existe y no hay instantánea, lo dice.
 */
export function describeAuditAccount(account: {
  id: string | null
  email: string | null
  emailAtAction: string | null
  found: boolean | null
}): AuditAccountView | null {
  if (account.id === null) return null

  if (account.found === true && account.email !== null) {
    const changed = account.emailAtAction !== null && account.emailAtAction !== account.email
    return {
      primary: account.email,
      id: account.id,
      note: changed ? `Email en la fecha de la acción: ${account.emailAtAction}` : null,
    }
  }

  if (account.emailAtAction !== null) {
    return { primary: account.emailAtAction, id: account.id, note: 'Cuenta no encontrada; email registrado en la acción' }
  }

  return { primary: 'Cuenta no encontrada', id: account.id, note: null }
}

/** Operador de un registro. Sin actor, la acción la pidió alguien sin sesión: se indica así, sin cuenta. */
export function describeAuditActor(actor: {
  id: string | null
  email: string | null
  emailAtAction: string | null
  found: boolean | null
}): AuditAccountView {
  return describeAuditAccount(actor) ?? { primary: UNAUTHENTICATED_ACTOR_LABEL, id: null, note: null }
}
