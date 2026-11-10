import type { FastifyBaseLogger } from 'fastify'

import { isDeliveryUnconfirmed, safeErrorFields } from './log-safety.js'
import { revokeUndeliveredResetToken } from './password-reset.service.js'

// Compensación de un enlace de contraseña que no se pudo enviar (DA-39).
//
// El token se confirma en la base antes del envío y el envío no forma parte de esa transacción:
// las dos operaciones no son atómicas. Si consta que el correo no salió, el token no sirve a nadie y
// se anula, de modo que no queda un enlace activo inútil ni, en la recuperación obligatoria, un
// enfriamiento de 15 minutos reservado por un correo que nunca llegó. Si el resultado no está
// confirmado (conexión perdida a mitad del envío), el correo pudo llegar: el token se conserva.
//
// Nunca lanza y nunca registra el token, el enlace ni el destinatario.

export type LinkFlow = 'password_reset' | 'security_recovery'

export async function revokeAfterFailedDelivery(
  log: FastifyBaseLogger,
  flow: LinkFlow,
  userId: string,
  token: string,
  deliveryError: unknown,
): Promise<void> {
  if (isDeliveryUnconfirmed(deliveryError)) {
    log.warn({ flow, targetUserId: userId, deliveryState: 'unconfirmed', tokenKept: true }, 'Se conserva el enlace: el envío no está confirmado')
    return
  }
  try {
    const revoked = await revokeUndeliveredResetToken(userId, token)
    // false: ya se había usado o sustituido por uno posterior, que se conserva.
    log.warn({ flow, targetUserId: userId, tokenRevoked: revoked }, 'Enlace no entregado anulado')
  } catch (error) {
    // El token queda activo hasta caducar (1 hora) o hasta que se emita otro.
    log.error({ flow, targetUserId: userId, compensation: 'failed', ...safeErrorFields(error) }, 'No se pudo anular el enlace no entregado')
  }
}
