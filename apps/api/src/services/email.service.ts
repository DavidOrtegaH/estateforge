import nodemailer from 'nodemailer'

export interface PasswordResetEmail {
  to: string
  resetUrl: string
  expiresAt: Date
}

export interface EmailChangeCodeEmail {
  to: string
  code: string
  expiresAt: Date
}

export interface EmailService {
  sendPasswordResetEmail(
    email: PasswordResetEmail,
  ): Promise<void>

  sendEmailChangeCodeEmail(
    email: EmailChangeCodeEmail,
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
  })
}

function getFromAddress(): string {
  return getRequiredEnv('SMTP_FROM')
}

function formatExpiration(date: Date): string {
  return date.toLocaleString('es-ES', {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

export class SMTPEmailService implements EmailService {
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
}

export const emailService: EmailService =
  new SMTPEmailService()