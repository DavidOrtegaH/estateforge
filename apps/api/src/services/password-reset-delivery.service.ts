import type { FastifyBaseLogger } from 'fastify'

import { emailService } from './email.service.js'
import { issuePasswordResetToken } from './password-reset.service.js'

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
// acaben (hook onClose de authRoutes), como los de la recuperación obligatoria.
const pendingDeliveries = new Set<Promise<void>>()

export function deliverPasswordResetInBackground(log: FastifyBaseLogger, user: { id: string; email: string }): void {
  const delivery: Promise<void> = (async () => {
    try {
      const reset = await issuePasswordResetToken(user.id)
      await emailService.sendPasswordResetEmail({ to: user.email, resetUrl: passwordResetUrl(reset.token), expiresAt: reset.expiresAt })
    } catch (error) {
      // Solo el id de la cuenta y el tipo de error: el error completo podría incluir el
      // destinatario, el enlace o el contenido del mensaje.
      log.error({ targetUserId: user.id, errorName: error instanceof Error ? error.name : typeof error }, 'No se pudo enviar el enlace de restablecimiento de contraseña')
    }
  })().finally(() => {
    pendingDeliveries.delete(delivery)
  })
  pendingDeliveries.add(delivery)
}

export function countPendingPasswordResetDeliveries(): number {
  return pendingDeliveries.size
}

export async function waitForPendingPasswordResetDeliveries(): Promise<void> {
  // Un envío puede terminar y dejar otro registrado mientras se espera: se repite hasta vaciar.
  while (pendingDeliveries.size > 0) {
    await Promise.allSettled(pendingDeliveries)
  }
}
