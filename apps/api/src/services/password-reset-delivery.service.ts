import type { FastifyBaseLogger } from 'fastify'

import { emailService } from './email.service.js'
import { safeDeliveryErrorFields } from './log-safety.js'
import { issuePasswordResetToken } from './password-reset.service.js'
import { createDeliveryTracker, type DeliveryWaitResult } from './pending-deliveries.js'

// Restablecimiento de contraseña por autoservicio (forgot-password, decisión D3 de la Fase 0).
// La emisión del token y el envío se hacen sin esperar a que terminen, para que la respuesta
// pública sea la misma exista o no una cuenta elegible y un fallo del SMTP no la cambie. No hay
// reintentos: si el envío falla, el token emitido sigue válido hasta caducar (1 hora) o hasta
// que se pida otro, y el titular puede volver a solicitarlo.

const RESET_PASSWORD_URL = process.env.WEB_APP_URL ?? 'http://localhost:5173'

export function passwordResetUrl(token: string): string {
  const url = new URL('/restablecer-contrasena', RESET_PASSWORD_URL)
  url.searchParams.set('token', token)
  return url.toString()
}

// Envíos lanzados sin esperar a la respuesta HTTP. El cierre ordenado de la app espera a que
// acaben (hook onClose de authRoutes), con el mismo mecanismo y plazo que los demás (F0-005).
const deliveries = createDeliveryTracker()

export function deliverPasswordResetInBackground(log: FastifyBaseLogger, user: { id: string; email: string }): void {
  deliveries.track((async () => {
    try {
      const reset = await issuePasswordResetToken(user.id)
      await emailService.sendPasswordResetEmail({ to: user.email, resetUrl: passwordResetUrl(reset.token), expiresAt: reset.expiresAt })
    } catch (error) {
      // Solo el id de la cuenta y campos cerrados del error: el error completo podría incluir el
      // destinatario, el enlace o el contenido del mensaje.
      log.error({ flow: 'password_reset', targetUserId: user.id, ...safeDeliveryErrorFields(error) }, 'No se pudo enviar el enlace de restablecimiento de contraseña')
    }
  })())
}

export function countPendingPasswordResetDeliveries(): number {
  return deliveries.count()
}

export function waitForPendingPasswordResetDeliveries(timeoutMs?: number): Promise<DeliveryWaitResult> {
  return deliveries.waitForAll(timeoutMs)
}
