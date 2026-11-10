
import nodemailer from 'nodemailer'

export interface PasswordResetEmail {
  to: string
  resetUrl: string
  expiresAt: Date
}

// Verificación del email de una cuenta (Fase 0).
export interface EmailVerificationEmail {
  to: string
  verifyUrl: string
  expiresAt: Date
}

export interface EmailChangeCodeEmail {
  to: string
  code: string
  expiresAt: Date
}

export interface EmailChangeNoticeEmail {
  to: string
  newEmail: string
  stage: 'requested' | 'completed'
  incidentReportUrl?: string
}

// Recuperación obligatoria tras un incidente (E2): va al destino autorizado por un OWNER.
export interface SecurityRecoveryEmail {
  to: string
  recoveryUrl: string
  expiresAt: Date
}

export interface EmailService {
  sendPasswordResetEmail(
    email: PasswordResetEmail,
  ): Promise<void>

  sendSecurityRecoveryEmail(
    email: SecurityRecoveryEmail,
  ): Promise<void>

  sendEmailChangeCodeEmail(
    email: EmailChangeCodeEmail,
  ): Promise<void>

  sendEmailChangeNoticeEmail(
    email: EmailChangeNoticeEmail,
  ): Promise<void>

  sendEmailVerificationEmail(
    email: EmailVerificationEmail,
  ): Promise<void>
}

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim()

  if (!value) {
    throw new Error(
      `La variable de entorno ${name} es requerida para enviar emails.`,
    )
  }

  return value
}

function getSmtpPort(): number {
  const rawPort = process.env.SMTP_PORT?.trim() ?? '587'
  const port = Number(rawPort)

  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(
      'SMTP_PORT debe ser un puerto válido.',
    )
  }

  return port
}

function getSmtpSecure(port: number): boolean {
  const rawSecure =
    process.env.SMTP_SECURE?.trim().toLowerCase()

  if (!rawSecure) {
    return port === 465
  }

  if (
    rawSecure !== 'true' &&
    rawSecure !== 'false'
  ) {
    throw new Error(
      'SMTP_SECURE debe ser true o false.',
    )
  }

  return rawSecure === 'true'
}

// Tiempos máximos del SMTP (DA-39). Los de nodemailer por defecto (2 minutos para conectar y 10 de
// inactividad) mantenían un envío, y su token, sin resultado durante minutos. Conectar y recibir el
// saludo sin respuesta es un fallo conocido (no se transmitió nada); una inactividad posterior deja
// el envío sin confirmar.
export const SMTP_CONNECTION_TIMEOUT_MS = 10_000
export const SMTP_GREETING_TIMEOUT_MS = 10_000
export const SMTP_SOCKET_TIMEOUT_MS = 30_000

function createTransporter() {
  const port = getSmtpPort()

  return nodemailer.createTransport({
    host: getRequiredEnv('SMTP_HOST'),
    port,
    secure: getSmtpSecure(port),
    auth: {
      user: getRequiredEnv('SMTP_USER'),
      pass: getRequiredEnv('SMTP_PASSWORD'),
    },
    disableFileAccess: true,
    disableUrlAccess: true,
    connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
    greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
    socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
  })
}

function getFromAddress(): string {
  return getRequiredEnv('SMTP_FROM')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatExpiration(date: Date): string {
  return date.toLocaleString('es-ES', {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

export class SMTPEmailService implements EmailService {
  async sendEmailVerificationEmail(
    email: EmailVerificationEmail,
  ): Promise<void> {
    const transporter = createTransporter()
    const fromAddress = getFromAddress()
    const verifyUrl = escapeHtml(email.verifyUrl)

    await transporter.sendMail({
      from: fromAddress,
      to: email.to,
      subject: 'EstateForge — Verifica tu email',
      text: [
        'Confirma que este email es tuyo para usar tu cuenta de EstateForge.',
        '',
        `Enlace de verificación: ${email.verifyUrl}`,
        '',
        `Este enlace caduca el ${formatExpiration(email.expiresAt)}.`,
        '',
        'Si no has creado una cuenta en EstateForge, puedes ignorar este mensaje.',
      ].join('\n'),
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937">
          <h2>EstateForge</h2>

          <p>
            Confirma que este email es tuyo para usar tu cuenta.
          </p>

          <p>
            <a
              href="${verifyUrl}"
              style="
                display:inline-block;
                padding:10px 16px;
                background:#111827;
                color:#ffffff;
                text-decoration:none;
                border-radius:8px;
              "
            >
              Verificar email
            </a>
          </p>

          <p>
            Este enlace caduca el
            <strong>${formatExpiration(email.expiresAt)}</strong>.
          </p>

          <p>
            Si no has creado una cuenta en EstateForge,
            puedes ignorar este mensaje.
          </p>
        </div>
      `,
    })
  }

  async sendPasswordResetEmail(
    email: PasswordResetEmail,
  ): Promise<void> {
    const transporter = createTransporter()
    const fromAddress = getFromAddress()

    await transporter.sendMail({
      from: fromAddress,
      to: email.to,
      subject:
        'EstateForge — Recuperación de contraseña',
      text: [
        'Has solicitado recuperar tu contraseña de EstateForge.',
        '',
        `Enlace de recuperación: ${email.resetUrl}`,
        '',
        `Este enlace caduca el ${formatExpiration(email.expiresAt)}.`,
        '',
        'Si no has solicitado este cambio, puedes ignorar este mensaje.',
      ].join('\n'),
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937">
          <h2>EstateForge</h2>

          <p>
            Has solicitado recuperar tu contraseña.
          </p>

          <p>
            <a
              href="${email.resetUrl}"
              style="
                display:inline-block;
                padding:10px 16px;
                background:#111827;
                color:#ffffff;
                text-decoration:none;
                border-radius:8px;
              "
            >
              Recuperar contraseña
            </a>
          </p>

          <p>
            Este enlace caduca el
            <strong>${formatExpiration(email.expiresAt)}</strong>.
          </p>

          <p>
            Si no has solicitado este cambio,
            puedes ignorar este mensaje.
          </p>
        </div>
      `,
    })
  }

  async sendSecurityRecoveryEmail(
    email: SecurityRecoveryEmail,
  ): Promise<void> {
    const transporter = createTransporter()
    const fromAddress = getFromAddress()
    const expiration = formatExpiration(email.expiresAt)
    const supportEmail = process.env.SUPPORT_EMAIL?.trim()
    const supportHtml = supportEmail ? `<p>Soporte: <a href="mailto:${escapeHtml(supportEmail)}">${escapeHtml(supportEmail)}</a></p>` : ''
    const supportText = supportEmail ? `\nContacto de soporte: ${supportEmail}` : ''

    await transporter.sendMail({
      from: fromAddress,
      to: email.to,
      subject:
        'EstateForge — Establece una contraseña nueva',
      text: [
        'El equipo de EstateForge ha revisado el incidente de seguridad de tu cuenta.',
        '',
        'Para volver a acceder debes establecer una contraseña nueva desde este enlace:',
        email.recoveryUrl,
        '',
        `Este enlace caduca el ${expiration}. Hasta que establezcas la contraseña nueva no podrás iniciar sesión.`,
        '',
        'Si no esperabas este mensaje, no uses el enlace y contacta con soporte.',
        supportText,
      ].join('\n'),
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937">
          <h2>EstateForge</h2>
          <p>El equipo de EstateForge ha revisado el incidente de seguridad de tu cuenta.</p>
          <p>Para volver a acceder debes establecer una contraseña nueva.</p>
          <p>
            <a
              href="${escapeHtml(email.recoveryUrl)}"
              style="display:inline-block;padding:10px 16px;background:#111827;color:#ffffff;text-decoration:none;border-radius:8px;"
            >
              Establecer contraseña nueva
            </a>
          </p>
          <p>
            Este enlace caduca el <strong>${expiration}</strong>.
            Hasta que establezcas la contraseña nueva no podrás iniciar sesión.
          </p>
          <p>Si no esperabas este mensaje, no uses el enlace y contacta con soporte.</p>
          ${supportHtml}
        </div>
      `,
    })
  }

  async sendEmailChangeCodeEmail(
    email: EmailChangeCodeEmail,
  ): Promise<void> {
    const transporter = createTransporter()
    const fromAddress = getFromAddress()

    await transporter.sendMail({
      from: fromAddress,
      to: email.to,
      subject:
        'EstateForge — Código de cambio de email',
      text: [
        'Has solicitado cambiar el email de tu cuenta de EstateForge.',
        '',
        `Tu código de verificación es: ${email.code}`,
        '',
        `El código caduca el ${formatExpiration(email.expiresAt)}.`,
        '',
        'Si no has solicitado este cambio, ignora este mensaje.',
      ].join('\n'),
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937">
          <h2>EstateForge</h2>

          <p>
            Has solicitado cambiar el email de tu cuenta.
          </p>

          <p>
            Tu código de verificación es:
          </p>

          <p
            style="
              font-size:32px;
              font-weight:bold;
              letter-spacing:8px;
              margin:20px 0;
            "
          >
            ${email.code}
          </p>

          <p>
            El código caduca el
            <strong>${formatExpiration(email.expiresAt)}</strong>.
          </p>

          <p>
            Si no has solicitado este cambio,
            ignora este mensaje.
          </p>
        </div>
      `,
    })
  }

  async sendEmailChangeNoticeEmail(
    email: EmailChangeNoticeEmail,
  ): Promise<void> {
    const transporter = createTransporter()
    const fromAddress = getFromAddress()
    const completed = email.stage === 'completed'
    const safeNewEmail = escapeHtml(email.newEmail)
    const subject = completed
      ? 'EstateForge — Cambio de email completado'
      : 'EstateForge — Solicitud de cambio de email'
    const supportEmail = process.env.SUPPORT_EMAIL?.trim()
    const supportHtml = supportEmail ? `<p>Soporte: <a href="mailto:${escapeHtml(supportEmail)}">${escapeHtml(supportEmail)}</a></p>` : ''
    const supportText = supportEmail ? `\n\nContacto de soporte: ${supportEmail}` : ''
    const incidentText = email.incidentReportUrl
      ? `\n\nSi no reconoces este cambio, protege tu cuenta aquí: ${email.incidentReportUrl}\nAl confirmar el aviso se cerrarán todas las sesiones y se bloqueará temporalmente el acceso hasta que soporte verifique la titularidad.`
      : ''
    const text = completed
      ? [
          'El email de tu cuenta de EstateForge se ha cambiado correctamente.',
          '',
          `La nueva dirección es: ${email.newEmail}`,
          '',
          'Si no reconoces este cambio, no basta con cambiar la contraseña. Utiliza el enlace seguro de denuncia incluido en este mensaje para proteger la cuenta. Si el enlace no está disponible, contacta con el soporte de EstateForge.',
          incidentText,
          supportText,
        ].join('\n')
      : [
          'Se ha solicitado cambiar el email de tu cuenta de EstateForge.',
          '',
          `Nueva dirección solicitada: ${email.newEmail}`,
          '',
          'Tu email actual no cambiará hasta que se verifique el código enviado a la nueva dirección.',
          'Si no has solicitado este cambio, no compartas ningún código y contacta con soporte si sospechas que tu cuenta está comprometida.',
        ].join('\n')
    const incidentHtml = email.incidentReportUrl
      ? `<p><a href="${escapeHtml(email.incidentReportUrl)}">No reconozco este cambio</a></p><p>Al confirmar la denuncia se cerrarán todas las sesiones y se bloqueará temporalmente el acceso hasta que soporte verifique la titularidad.</p>`
      : ''

    await transporter.sendMail({
      from: fromAddress,
      to: email.to,
      subject,
      text,
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937">
          <h2>EstateForge</h2>
          <p>${completed
            ? 'El email de tu cuenta se ha cambiado correctamente.'
            : 'Se ha solicitado cambiar el email de tu cuenta.'}</p>
          <p><strong>Nueva dirección: ${safeNewEmail}</strong></p>
          ${completed
            ? `<p>Si no reconoces este cambio, no basta con cambiar la contraseña. Utiliza el enlace seguro para denunciarlo y proteger la cuenta.</p>${incidentHtml}${supportHtml}`
            : '<p>Tu email actual no cambiará hasta que se verifique el código enviado a la nueva dirección.</p><p>Si no has solicitado este cambio, no compartas ningún código y contacta con soporte si sospechas que tu cuenta está comprometida.</p>'}
        </div>
      `,
    })
  }

}

export const emailService: EmailService =
  new SMTPEmailService()


