export interface PasswordResetEmail {
  to: string
  resetUrl: string
  expiresAt: Date
}

export interface EmailService {
  sendPasswordResetEmail(
    email: PasswordResetEmail,
  ): Promise<void>
}

/**
 * Desarrollo local:
 * el enlace se muestra en la consola del API en lugar de enviarse por SMTP.
 * Esto permite probar el flujo completo sin introducir credenciales de correo
 * en el TFM.
 */
export class ConsoleEmailService implements EmailService {
  async sendPasswordResetEmail(
    email: PasswordResetEmail,
  ): Promise<void> {
    console.info(
      '[EstateForge] Recuperación de contraseña',
      {
        to: email.to,
        resetUrl: email.resetUrl,
        expiresAt: email.expiresAt.toISOString(),
      },
    )
  }
}

export const emailService: EmailService =
  new ConsoleEmailService()
