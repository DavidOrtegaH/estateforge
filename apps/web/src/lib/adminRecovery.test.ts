import { describe, expect, it, vi } from 'vitest'

import { AdminApiError } from '@/services/adminService'

import { runActionThenRefresh } from './adminPageState'
import {
  actionNotice,
  adminActionErrorMessage,
  isValidRecoveryEmail,
  RECOVERY_EMAIL_MAX,
  recoveryEmailError,
  recoveryEmailField,
  recoveryEmailToSend,
  showsRecoveryDestination,
  STATE_CHANGED_HINT,
  tryStartOnce,
} from './adminRecovery'

// Lógica pura de la recuperación en el panel. No renderiza AdminPage (sin entorno DOM).

const DESTINATION = 'destino@estateforge.test'

describe('isValidRecoveryEmail', () => {
  it.each(['titular@estateforge.test', '  con.espacios@dominio.es  ', 'a+b@sub.dominio.com'])('acepta %j', value => {
    expect(isValidRecoveryEmail(value)).toBe(true)
  })

  it.each(['', '   ', 'sin-arroba', 'a@b', 'a @b.com', '@dominio.com', 'a@.com'])('rechaza %j', value => {
    expect(isValidRecoveryEmail(value)).toBe(false)
  })

  it('respeta el límite de 254 caracteres de la API', () => {
    const local = 'a'.repeat(RECOVERY_EMAIL_MAX - '@x.es'.length)
    expect(isValidRecoveryEmail(`${local}@x.es`)).toBe(true)
    expect(isValidRecoveryEmail(`a${local}@x.es`)).toBe(false)
  })
})

describe('recoveryEmailField', () => {
  it('corregir el destino siempre exige email', () => {
    expect(recoveryEmailField('recovery-destination', { securityRecoveryEmail: DESTINATION })).toBe('required')
    expect(recoveryEmailField('recovery-destination', { securityRecoveryEmail: null })).toBe('required')
  })

  it('retirar la protección: opcional con destino guardado, obligatorio sin él', () => {
    expect(recoveryEmailField('resolve-security-hold', { securityRecoveryEmail: DESTINATION })).toBe('optional')
    expect(recoveryEmailField('resolve-security-hold', { securityRecoveryEmail: null })).toBe('required')
    expect(recoveryEmailField('resolve-security-hold', {})).toBe('required')
  })

  it.each(['resend-recovery', 'suspend', 'unsuspend', 'revoke-sessions'] as const)('%s no lleva email', action => {
    expect(recoveryEmailField(action, { securityRecoveryEmail: DESTINATION })).toBe('none')
  })
})

describe('recoveryEmailError y recoveryEmailToSend', () => {
  it('obligatorio y vacío: error y no se ejecuta', () => {
    expect(recoveryEmailError('required', '   ')).toBe('Indica el email al que enviar el enlace de recuperación.')
  })

  it('formato no válido: error, sea obligatorio u opcional', () => {
    expect(recoveryEmailError('required', 'no-es-un-email')).toBe('Escribe un email válido (máximo 254 caracteres).')
    expect(recoveryEmailError('optional', 'no-es-un-email')).toBe('Escribe un email válido (máximo 254 caracteres).')
  })

  it('opcional y vacío: sin error y no se envía (la API usa el destino guardado)', () => {
    expect(recoveryEmailError('optional', '')).toBeNull()
    expect(recoveryEmailToSend('optional', '  ')).toBeUndefined()
  })

  it('válido: sin error y se envía recortado', () => {
    expect(recoveryEmailError('required', `  ${DESTINATION} `)).toBeNull()
    expect(recoveryEmailToSend('required', `  ${DESTINATION} `)).toBe(DESTINATION)
  })

  it('una acción sin email nunca da error ni lo envía', () => {
    expect(recoveryEmailError('none', 'lo-que-sea')).toBeNull()
    expect(recoveryEmailToSend('none', DESTINATION)).toBeUndefined()
  })
})

describe('showsRecoveryDestination', () => {
  const PENDING = '2026-11-03T10:00:00.000Z'
  const HOLD = '2026-11-02T10:00:00.000Z'

  it('se muestra con la recuperación pendiente o la protección activa, si hay destino', () => {
    expect(showsRecoveryDestination({ passwordResetRequiredAt: PENDING, securityHoldAt: null, securityRecoveryEmail: DESTINATION })).toBe(true)
    expect(showsRecoveryDestination({ passwordResetRequiredAt: null, securityHoldAt: HOLD, securityRecoveryEmail: DESTINATION })).toBe(true)
  })

  it('no se muestra sin destino ni cuando no es pertinente', () => {
    expect(showsRecoveryDestination({ passwordResetRequiredAt: PENDING, securityHoldAt: null, securityRecoveryEmail: null })).toBe(false)
    expect(showsRecoveryDestination({ passwordResetRequiredAt: null, securityHoldAt: null, securityRecoveryEmail: DESTINATION })).toBe(false)
    expect(showsRecoveryDestination({ securityHoldAt: null })).toBe(false)
  })
})

describe('actionNotice', () => {
  it('enlace enviado: éxito con el mensaje de la API', () => {
    expect(actionNotice({ message: 'Se ha enviado un enlace nuevo.', recoveryEmailSent: true })).toEqual({ message: 'Se ha enviado un enlace nuevo.', tone: 'success' })
  })

  it('operación hecha pero enlace no enviado: advertencia, no éxito de envío', () => {
    expect(actionNotice({ message: 'No se pudo enviar el enlace.', recoveryEmailSent: false })).toEqual({ message: 'No se pudo enviar el enlace.', tone: 'warning' })
  })

  it('las acciones sin envío (suspender, reactivar, cerrar sesiones) siguen siendo éxito', () => {
    expect(actionNotice({ message: 'Cuenta suspendida.' })).toEqual({ message: 'Cuenta suspendida.', tone: 'success' })
  })
})

describe('adminActionErrorMessage', () => {
  it('409: el mensaje de la API y que el estado ha cambiado', () => {
    const message = 'La recuperación de la cuenta ha cambiado durante la operación.'
    expect(adminActionErrorMessage(new AdminApiError(message, 409))).toBe(`${message} ${STATE_CHANGED_HINT}`)
  })

  it('400: el mensaje de la API sin ocultarlo', () => {
    expect(adminActionErrorMessage(new AdminApiError('El email de recuperación no es válido.', 400))).toBe('El email de recuperación no es válido.')
  })

  it('otros errores: su mensaje o el genérico de siempre', () => {
    expect(adminActionErrorMessage(new AdminApiError('No tienes permisos para acceder a esta sección.', 403))).toBe('No tienes permisos para acceder a esta sección.')
    expect(adminActionErrorMessage(new TypeError('Failed to fetch'))).toBe('Failed to fetch')
    expect(adminActionErrorMessage('desconocido')).toBe('No se pudo completar la acción.')
  })
})

describe('tryStartOnce (doble envío)', () => {
  it('un segundo inicio mientras hay uno en curso se rechaza; tras liberar se puede volver a empezar', () => {
    const flag = { current: false }
    const release = tryStartOnce(flag)
    expect(release).toBeTypeOf('function')
    expect(tryStartOnce(flag)).toBeNull()
    release!()
    expect(tryStartOnce(flag)).toBeTypeOf('function')
  })
})

// Reproduce el envío de submitAction en AdminPage: bloqueo de doble envío, errores con su
// mensaje (409 con aviso) y runActionThenRefresh de F3 sin cambios.
function panel(run: () => Promise<{ message: string; recoveryEmailSent?: boolean }>, refresh: () => Promise<void>) {
  const flag = { current: false }
  const state = { notice: null as ReturnType<typeof actionNotice> | null, actionError: null as string | null, refreshError: null as string | null }
  async function submit() {
    const release = tryStartOnce(flag)
    if (!release) return 'ignorado'
    try {
      let result: { message: string; recoveryEmailSent?: boolean } | null = null
      const outcome = await runActionThenRefresh(
        async () => {
          try {
            result = await run()
            return result
          } catch (error) {
            throw new Error(adminActionErrorMessage(error))
          }
        },
        message => { state.notice = actionNotice(result ?? { message }) },
        refresh,
      )
      if (outcome.kind === 'failed') state.actionError = outcome.error
      else state.refreshError = outcome.refreshError
      return 'hecho'
    } finally { release() }
  }
  return { state, submit }
}

describe('envío de una acción de recuperación', () => {
  it('dos envíos seguidos (doble clic) ejecutan la acción una sola vez', async () => {
    const run = vi.fn().mockResolvedValue({ message: 'Enviado.', recoveryEmailSent: true })
    const { submit } = panel(run, () => Promise.resolve())

    const [first, second] = await Promise.all([submit(), submit()])

    expect([first, second]).toEqual(['hecho', 'ignorado'])
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('enlace enviado y refresco correcto: éxito y ningún error', async () => {
    const { state, submit } = panel(() => Promise.resolve({ message: 'Enviado.', recoveryEmailSent: true }), () => Promise.resolve())
    await submit()
    expect(state).toEqual({ notice: { message: 'Enviado.', tone: 'success' }, actionError: null, refreshError: null })
  })

  it('operación hecha con envío fallido: advertencia, sin presentarlo como fallo de la acción', async () => {
    const { state, submit } = panel(() => Promise.resolve({ message: 'No se pudo enviar el enlace.', recoveryEmailSent: false }), () => Promise.resolve())
    await submit()
    expect(state).toEqual({ notice: { message: 'No se pudo enviar el enlace.', tone: 'warning' }, actionError: null, refreshError: null })
  })

  it('operación hecha y refresco fallido: se distingue del fallo de la acción y no se repite', async () => {
    const run = vi.fn().mockResolvedValue({ message: 'Protección retirada.', recoveryEmailSent: true })
    const { state, submit } = panel(run, () => Promise.reject(new Error('Sin conexión')))
    await submit()
    expect(state.notice).toEqual({ message: 'Protección retirada.', tone: 'success' })
    expect(state.actionError).toBeNull()
    expect(state.refreshError).toContain('La acción se ha completado')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('409: fallo de la acción con el aviso de que el estado ha cambiado; sin aviso de éxito ni refresco', async () => {
    const refresh = vi.fn()
    const { state, submit } = panel(() => Promise.reject(new AdminApiError('La cuenta no tiene una recuperación obligatoria pendiente.', 409)), refresh)
    await submit()
    expect(state.notice).toBeNull()
    expect(state.actionError).toBe(`La cuenta no tiene una recuperación obligatoria pendiente. ${STATE_CHANGED_HINT}`)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('400: fallo de la acción con el mensaje de la API', async () => {
    const { state, submit } = panel(() => Promise.reject(new AdminApiError('El email de recuperación no es válido.', 400)), () => Promise.resolve())
    await submit()
    expect(state).toEqual({ notice: null, actionError: 'El email de recuperación no es válido.', refreshError: null })
  })
})
