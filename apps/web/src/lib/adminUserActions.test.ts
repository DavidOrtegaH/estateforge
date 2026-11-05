import { describe, expect, it } from 'vitest'

import { canManageRecovery, NO_STORED_DESTINATION_TITLE, SECURITY_HOLD_ACTION_TITLE, userActionsAvailability } from './adminUserActions'

const user = { id: 'u1', role: 'USER' as const, adminSuspendedAt: null, securityHoldAt: null }
const suspended = { ...user, adminSuspendedAt: '2026-11-01T10:00:00.000Z' }
const protectedUser = { ...user, securityHoldAt: '2026-11-02T10:00:00.000Z' }
const owner = { ...user, role: 'OWNER' as const }

describe('userActionsAvailability', () => {
  it('cuenta normal sin acciones en curso: suspender y cerrar sesiones, todo activo', () => {
    expect(userActionsAvailability(user, null)).toEqual({
      detailDisabled: false,
      actions: [{ action: 'suspend', disabled: false }, { action: 'revoke-sessions', disabled: false }],
    })
  })

  it('cuenta suspendida: reactivar en lugar de suspender', () => {
    expect(userActionsAvailability(suspended, null).actions).toEqual([
      { action: 'unsuspend', disabled: false },
      { action: 'revoke-sessions', disabled: false },
    ])
  })

  it('cuenta protegida no suspendida: suspender desactivado con su explicación; cerrar sesiones y retirar la protección activos', () => {
    expect(userActionsAvailability(protectedUser, null).actions).toEqual([
      { action: 'suspend', disabled: true, title: SECURITY_HOLD_ACTION_TITLE },
      { action: 'revoke-sessions', disabled: false },
      { action: 'resolve-security-hold', disabled: false },
    ])
  })

  it('cuenta protegida y suspendida: se puede reactivar y retirar la protección', () => {
    expect(userActionsAvailability({ ...protectedUser, adminSuspendedAt: suspended.adminSuspendedAt }, null).actions)
      .toEqual([
        { action: 'unsuspend', disabled: false },
        { action: 'revoke-sessions', disabled: false },
        { action: 'resolve-security-hold', disabled: false },
      ])
  })

  it('cuenta propietaria: solo «Ver detalle», sin acciones administrativas', () => {
    expect(userActionsAvailability(owner, null)).toEqual({ detailDisabled: false, actions: [] })
    expect(userActionsAvailability({ ...owner, adminSuspendedAt: suspended.adminSuspendedAt, securityHoldAt: protectedUser.securityHoldAt }, null).actions).toEqual([])
  })

  it('con una acción en curso sobre esta cuenta: todo desactivado, también «Ver detalle»', () => {
    expect(userActionsAvailability(user, 'u1')).toEqual({
      detailDisabled: true,
      actions: [{ action: 'suspend', disabled: true }, { action: 'revoke-sessions', disabled: true }],
    })
    expect(userActionsAvailability(suspended, 'u1').actions).toEqual([
      { action: 'unsuspend', disabled: true },
      { action: 'revoke-sessions', disabled: true },
    ])
  })

  it('con una acción en curso sobre otra cuenta: acciones desactivadas, «Ver detalle» activo', () => {
    expect(userActionsAvailability(user, 'u2')).toEqual({
      detailDisabled: false,
      actions: [{ action: 'suspend', disabled: true }, { action: 'revoke-sessions', disabled: true }],
    })
  })

  it('cuenta propietaria en curso: solo se desactiva «Ver detalle»', () => {
    expect(userActionsAvailability(owner, 'u1')).toEqual({ detailDisabled: true, actions: [] })
    expect(userActionsAvailability(owner, 'u2')).toEqual({ detailDisabled: false, actions: [] })
  })

  it('cuenta protegida con otra acción en curso: suspender sigue desactivado con su explicación', () => {
    expect(userActionsAvailability(protectedUser, 'u2').actions[0])
      .toEqual({ action: 'suspend', disabled: true, title: SECURITY_HOLD_ACTION_TITLE })
  })
})

describe('userActionsAvailability: recuperación obligatoria (R2)', () => {
  const PENDING = '2026-11-03T10:00:00.000Z'
  const DESTINATION = 'destino@estateforge.test'
  const pending = { ...user, passwordResetRequiredAt: PENDING, securityRecoveryEmail: DESTINATION }
  const recoveryActions = (availability: ReturnType<typeof userActionsAvailability>) =>
    availability.actions.filter(({ action }) => ['resolve-security-hold', 'recovery-destination', 'resend-recovery'].includes(action))

  it('cuenta normal: ninguna acción de recuperación', () => {
    expect(recoveryActions(userActionsAvailability(user, null))).toEqual([])
    expect(recoveryActions(userActionsAvailability({ ...user, passwordResetRequiredAt: null, securityRecoveryEmail: null }, null))).toEqual([])
  })

  it('un destino guardado sin recuperación pendiente no habilita corregir ni reenviar', () => {
    expect(recoveryActions(userActionsAvailability({ ...user, securityRecoveryEmail: DESTINATION }, null))).toEqual([])
  })

  it('recuperación pendiente con destino: corregir y reenviar activos, sin retirar la protección', () => {
    expect(userActionsAvailability(pending, null).actions).toEqual([
      { action: 'suspend', disabled: false },
      { action: 'revoke-sessions', disabled: false },
      { action: 'recovery-destination', disabled: false },
      { action: 'resend-recovery', disabled: false },
    ])
  })

  it('recuperación pendiente sin destino guardado: corregir activo; reenviar desactivado con el motivo de la API', () => {
    expect(recoveryActions(userActionsAvailability({ ...pending, securityRecoveryEmail: null }, null))).toEqual([
      { action: 'recovery-destination', disabled: false },
      { action: 'resend-recovery', disabled: true, title: NO_STORED_DESTINATION_TITLE },
    ])
  })

  it('recuperación pendiente con la cuenta suspendida: ni corregir ni reenviar (la API respondería 409)', () => {
    expect(recoveryActions(userActionsAvailability({ ...pending, adminSuspendedAt: suspended.adminSuspendedAt }, null))).toEqual([])
  })

  it('recuperación pendiente con protección activa: solo retirar la protección', () => {
    expect(recoveryActions(userActionsAvailability({ ...pending, securityHoldAt: protectedUser.securityHoldAt }, null)))
      .toEqual([{ action: 'resolve-security-hold', disabled: false }])
  })

  it('cuenta propietaria protegida o con recuperación pendiente: ninguna acción', () => {
    expect(userActionsAvailability({ ...owner, securityHoldAt: protectedUser.securityHoldAt }, null).actions).toEqual([])
    expect(userActionsAvailability({ ...owner, passwordResetRequiredAt: PENDING, securityRecoveryEmail: DESTINATION }, null).actions).toEqual([])
  })

  it('con una acción en curso, las acciones de recuperación también se desactivan', () => {
    expect(recoveryActions(userActionsAvailability(pending, 'u2'))).toEqual([
      { action: 'recovery-destination', disabled: true },
      { action: 'resend-recovery', disabled: true },
    ])
    expect(recoveryActions(userActionsAvailability(protectedUser, 'u1'))).toEqual([{ action: 'resolve-security-hold', disabled: true }])
  })

  it('canManageRecovery exige recuperación pendiente, sin protección ni suspensión', () => {
    expect(canManageRecovery(pending)).toBe(true)
    expect(canManageRecovery(user)).toBe(false)
    expect(canManageRecovery({ ...pending, securityHoldAt: protectedUser.securityHoldAt })).toBe(false)
    expect(canManageRecovery({ ...pending, adminSuspendedAt: suspended.adminSuspendedAt })).toBe(false)
  })
})
