import { describe, expect, it } from 'vitest'

import { SECURITY_HOLD_ACTION_TITLE, userActionsAvailability } from './adminUserActions'

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

  it('cuenta protegida no suspendida: suspender desactivado con su explicación; cerrar sesiones activo', () => {
    expect(userActionsAvailability(protectedUser, null).actions).toEqual([
      { action: 'suspend', disabled: true, title: SECURITY_HOLD_ACTION_TITLE },
      { action: 'revoke-sessions', disabled: false },
    ])
  })

  it('cuenta protegida y suspendida: se puede reactivar', () => {
    expect(userActionsAvailability({ ...protectedUser, adminSuspendedAt: suspended.adminSuspendedAt }, null).actions)
      .toEqual([{ action: 'unsuspend', disabled: false }, { action: 'revoke-sessions', disabled: false }])
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
