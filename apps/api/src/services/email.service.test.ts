
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

const mocks = vi.hoisted(() => ({
  createTransport: vi.fn(),
  sendMail: vi.fn(),
}))

vi.mock('nodemailer', () => ({
  default: {
    createTransport: mocks.createTransport,
  },
}))

import {
  SMTPEmailService,
} from './email.service.js'

describe('SMTPEmailService', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.createTransport.mockReturnValue({
      sendMail: mocks.sendMail,
    })

    vi.stubEnv(
      'SMTP_HOST',
      'smtp.example.com',
    )

    vi.stubEnv(
      'SMTP_PORT',
      '587',
    )

    vi.stubEnv(
      'SMTP_SECURE',
      'false',
    )

    vi.stubEnv(
      'SMTP_USER',
      'smtp-user',
    )

    vi.stubEnv(
      'SMTP_PASSWORD',
      'smtp-password',
    )

    vi.stubEnv(
      'SMTP_FROM',
      'EstateForge <noreply@example.com>',
    )

    mocks.sendMail.mockResolvedValue({
      messageId: 'test-message-id',
    })
  })

  it(
    'envía correctamente un email de recuperación de contraseña',
    async () => {
      const service =
        new SMTPEmailService()

      const expiresAt =
        new Date(
          '2026-10-01T12:30:00.000Z',
        )

      await service.sendPasswordResetEmail({
        to: 'usuario@example.com',
        resetUrl:
          'http://localhost:5173/restablecer-contrasena?token=test-token',
        expiresAt,
      })

      expect(
        mocks.createTransport,
      ).toHaveBeenCalledTimes(1)

      expect(
        mocks.createTransport,
      ).toHaveBeenCalledWith({
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        auth: {
          user: 'smtp-user',
          pass: 'smtp-password',
        },
        disableFileAccess: true,
        disableUrlAccess: true,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 30_000,
      })

      expect(
        mocks.sendMail,
      ).toHaveBeenCalledTimes(1)

      const message =
        mocks.sendMail.mock.calls[0][0]

      expect(message).toMatchObject({
        from:
          'EstateForge <noreply@example.com>',
        to: 'usuario@example.com',
        subject:
          'EstateForge — Recuperación de contraseña',
      })

      expect(
        message.text,
      ).toContain(
        'Has solicitado recuperar tu contraseña de EstateForge.',
      )

      expect(
        message.text,
      ).toContain(
        'http://localhost:5173/restablecer-contrasena?token=test-token',
      )

      expect(
        message.html,
      ).toContain(
        'Recuperar contraseña',
      )
    },
  )

  it(
    'envía correctamente el código de cambio de email',
    async () => {
      const service =
        new SMTPEmailService()

      const expiresAt =
        new Date(
          '2026-10-01T12:40:00.000Z',
        )

      await service.sendEmailChangeCodeEmail({
        to: 'nuevo@example.com',
        code: '483921',
        expiresAt,
      })

      expect(
        mocks.createTransport,
      ).toHaveBeenCalledTimes(1)

      expect(
        mocks.sendMail,
      ).toHaveBeenCalledTimes(1)

      const message =
        mocks.sendMail.mock.calls[0][0]

      expect(message).toMatchObject({
        from:
          'EstateForge <noreply@example.com>',
        to: 'nuevo@example.com',
        subject:
          'EstateForge — Código de cambio de email',
      })

      expect(
        message.text,
      ).toContain(
        'Tu código de verificación es: 483921',
      )

      expect(
        message.html,
      ).toContain('483921')
    },
  )

  it(
    'usa SMTP seguro automáticamente en el puerto 465',
    async () => {
      vi.stubEnv(
        'SMTP_PORT',
        '465',
      )

      vi.stubEnv(
        'SMTP_SECURE',
        '',
      )

      const service =
        new SMTPEmailService()

      await service.sendEmailChangeCodeEmail({
        to: 'nuevo@example.com',
        code: '123456',
        expiresAt:
          new Date(
            '2026-10-01T12:40:00.000Z',
          ),
      })

      expect(
        mocks.createTransport,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          port: 465,
          secure: true,
        }),
      )
    },
  )

  it(
    'rechaza un SMTP_PORT inválido',
    async () => {
      vi.stubEnv(
        'SMTP_PORT',
        '99999',
      )

      const service =
        new SMTPEmailService()

      await expect(
        service.sendEmailChangeCodeEmail({
          to: 'nuevo@example.com',
          code: '123456',
          expiresAt:
            new Date(
              '2026-10-01T12:40:00.000Z',
            ),
        }),
      ).rejects.toThrow(
        'SMTP_PORT debe ser un puerto válido.',
      )

      expect(
        mocks.createTransport,
      ).not.toHaveBeenCalled()

      expect(
        mocks.sendMail,
      ).not.toHaveBeenCalled()
    },
  )

  it(
    'rechaza un SMTP_SECURE inválido',
    async () => {
      vi.stubEnv(
        'SMTP_SECURE',
        'maybe',
      )

      const service =
        new SMTPEmailService()

      await expect(
        service.sendPasswordResetEmail({
          to: 'usuario@example.com',
          resetUrl:
            'http://localhost:5173/restablecer-contrasena?token=test-token',
          expiresAt:
            new Date(
              '2026-10-01T12:30:00.000Z',
            ),
        }),
      ).rejects.toThrow(
        'SMTP_SECURE debe ser true o false.',
      )

      expect(
        mocks.createTransport,
      ).not.toHaveBeenCalled()

      expect(
        mocks.sendMail,
      ).not.toHaveBeenCalled()
    },
  )

  it(
    'requiere SMTP_HOST cuando se intenta enviar un email',
    async () => {
      vi.stubEnv(
        'SMTP_HOST',
        '',
      )

      const service =
        new SMTPEmailService()

      await expect(
        service.sendPasswordResetEmail({
          to: 'usuario@example.com',
          resetUrl:
            'http://localhost:5173/restablecer-contrasena?token=test-token',
          expiresAt:
            new Date(
              '2026-10-01T12:30:00.000Z',
            ),
        }),
      ).rejects.toThrow(
        'La variable de entorno SMTP_HOST es requerida para enviar emails.',
      )

      expect(
        mocks.createTransport,
      ).not.toHaveBeenCalled()

      expect(
        mocks.sendMail,
      ).not.toHaveBeenCalled()
    },
  )

  it(
    'requiere SMTP_FROM cuando se intenta enviar un email',
    async () => {
      vi.stubEnv(
        'SMTP_FROM',
        '',
      )

      const service =
        new SMTPEmailService()

      await expect(
        service.sendEmailChangeCodeEmail({
          to: 'nuevo@example.com',
          code: '123456',
          expiresAt:
            new Date(
              '2026-10-01T12:40:00.000Z',
            ),
        }),
      ).rejects.toThrow(
        'La variable de entorno SMTP_FROM es requerida para enviar emails.',
      )

      expect(
        mocks.createTransport,
      ).toHaveBeenCalledTimes(1)

      expect(
        mocks.sendMail,
      ).not.toHaveBeenCalled()
    },
  )

  it('avisa al correo anterior cuando se solicita un cambio', async () => {
    const service = new SMTPEmailService()

    await service.sendEmailChangeNoticeEmail({
      to: 'anterior@example.com',
      newEmail: 'nuevo@example.com',
      stage: 'requested',
    })

    const message = mocks.sendMail.mock.calls[0][0]
    expect(message).toMatchObject({
      to: 'anterior@example.com',
      subject: 'EstateForge — Solicitud de cambio de email',
    })
    expect(message.text).toContain('no compartas ningún código')
    expect(message.text).toContain('contacta con soporte')
    expect(message.text).toContain('nuevo@example.com')
  })

  it('avisa al correo anterior cuando el cambio se completa', async () => {
    const service = new SMTPEmailService()

    await service.sendEmailChangeNoticeEmail({
      to: 'anterior@example.com',
      newEmail: 'nuevo@example.com',
      stage: 'completed',
    })

    const message = mocks.sendMail.mock.calls[0][0]
    expect(message).toMatchObject({
      to: 'anterior@example.com',
      subject: 'EstateForge — Cambio de email completado',
    })
    expect(message.text).toContain('se ha cambiado correctamente')
  })

  it('envía el enlace de recuperación obligatoria al destino indicado', async () => {
    const service = new SMTPEmailService()
    const recoveryUrl = 'http://localhost:5173/recuperar-cuenta?token=test-token&x=1'

    await service.sendSecurityRecoveryEmail({
      to: 'destino@example.com',
      recoveryUrl,
      expiresAt: new Date('2026-11-02T12:30:00.000Z'),
    })

    const message = mocks.sendMail.mock.calls[0][0]
    expect(message).toMatchObject({
      from: 'EstateForge <noreply@example.com>',
      to: 'destino@example.com',
      subject: 'EstateForge — Establece una contraseña nueva',
    })
    expect(message.text).toContain(recoveryUrl)
    expect(message.text).toContain('no podrás iniciar sesión')
    // En el HTML el enlace va escapado.
    expect(message.html).toContain('href="http://localhost:5173/recuperar-cuenta?token=test-token&amp;x=1"')
    expect(message.html).toContain('Establecer contraseña nueva')
  })

})

