import { describe, expect, it } from 'vitest'

import {
  AUDIT_ACTIONS,
  auditActionLabel,
  describeAuditAccount,
  describeAuditAction,
  describeAuditActor,
  recoveryDestinationLabel,
} from './adminAudit'

describe('describeAuditAccount', () => {
  it('muestra el email actual de una cuenta existente', () => {
    expect(describeAuditAccount({ id: 'u1', email: 'a@x.test', emailAtAction: 'a@x.test', found: true })).toEqual({
      primary: 'a@x.test', id: 'u1', note: null,
    })
    expect(describeAuditAccount({ id: 'u1', email: 'a@x.test', emailAtAction: null, found: true })).toEqual({
      primary: 'a@x.test', id: 'u1', note: null,
    })
  })

  it('indica el email de la fecha de la acción si ha cambiado', () => {
    expect(describeAuditAccount({ id: 'u1', email: 'nuevo@x.test', emailAtAction: 'viejo@x.test', found: true })).toEqual({
      primary: 'nuevo@x.test', id: 'u1', note: 'Email en la fecha de la acción: viejo@x.test',
    })
  })

  it('usa la instantánea si la cuenta ya no existe', () => {
    expect(describeAuditAccount({ id: 'u1', email: null, emailAtAction: 'viejo@x.test', found: false })).toEqual({
      primary: 'viejo@x.test', id: 'u1', note: 'Cuenta no encontrada; email registrado en la acción',
    })
  })

  it('no inventa un email si la cuenta no existe y no hay instantánea', () => {
    expect(describeAuditAccount({ id: 'u1', email: null, emailAtAction: null, found: false })).toEqual({
      primary: 'Cuenta no encontrada', id: 'u1', note: null,
    })
  })

  it('devuelve null si el registro no tiene cuenta afectada', () => {
    expect(describeAuditAccount({ id: null, email: null, emailAtAction: null, found: null })).toBeNull()
  })
})

describe('describeAuditActor', () => {
  it('sin actor indica una solicitud no autenticada, sin identificador', () => {
    expect(describeAuditActor({ id: null, email: null, emailAtAction: null, found: null })).toEqual({
      primary: 'Solicitud no autenticada', id: null, note: null,
    })
  })

  it('con actor se describe igual que cualquier cuenta', () => {
    expect(describeAuditActor({ id: 'o1', email: 'o@x.test', emailAtAction: 'o@x.test', found: true })).toEqual({
      primary: 'o@x.test', id: 'o1', note: null,
    })
    expect(describeAuditActor({ id: 'o1', email: null, emailAtAction: null, found: false })).toEqual({
      primary: 'Cuenta no encontrada', id: 'o1', note: null,
    })
  })
})

describe('auditActionLabel', () => {
  it.each([
    ['ACCOUNT_SUSPENDED', 'Cuenta suspendida'],
    ['ACCOUNT_UNSUSPENDED', 'Suspensión retirada'],
    ['SESSIONS_REVOKED', 'Sesiones cerradas'],
    ['SECURITY_HOLD_RESOLVED', 'Protección retirada'],
    ['SECURITY_RECOVERY_DESTINATION_CHANGED', 'Destino de recuperación corregido'],
    ['SECURITY_RECOVERY_LINK_RESENT', 'Enlace de recuperación reenviado'],
    ['SECURITY_RECOVERY_LINK_REQUESTED', 'Enlace solicitado por el titular'],
    ['SECURITY_RECOVERY_COMPLETED', 'Recuperación completada'],
  ])('%s se muestra como «%s»', (action, label) => {
    expect(auditActionLabel(action)).toBe(label)
  })

  it.each([
    ['una acción nueva', 'SECURITY_SOMETHING_NEW'],
    ['un código en minúsculas', 'account_suspended'],
    ['un nombre heredado de Object', 'toString'],
    ['otro nombre heredado', 'constructor'],
    ['un texto vacío', ''],
  ])('con %s devuelve el código tal cual', (_label, action) => {
    expect(auditActionLabel(action)).toBe(action)
  })
})

describe('AUDIT_ACTIONS', () => {
  it('ofrece en el filtro las ocho acciones de la API, en orden y todas con etiqueta propia', () => {
    expect(AUDIT_ACTIONS).toEqual([
      'ACCOUNT_SUSPENDED',
      'ACCOUNT_UNSUSPENDED',
      'SESSIONS_REVOKED',
      'SECURITY_HOLD_RESOLVED',
      'SECURITY_RECOVERY_DESTINATION_CHANGED',
      'SECURITY_RECOVERY_LINK_RESENT',
      'SECURITY_RECOVERY_LINK_REQUESTED',
      'SECURITY_RECOVERY_COMPLETED',
    ])
    for (const action of AUDIT_ACTIONS) expect(auditActionLabel(action)).not.toBe(action)
  })
})

describe('recoveryDestinationLabel', () => {
  it.each([
    ['STORED', 'destino guardado'],
    ['OWNER_PROVIDED', 'destino indicado por un OWNER'],
    ['OWNER_CORRECTED', 'destino corregido por un OWNER'],
  ])('%s se muestra como «%s»', (source, label) => {
    expect(recoveryDestinationLabel(source)).toBe(label)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['un origen desconocido', 'OWNER_GUESSED'],
    ['un nombre heredado de Object', 'toString'],
    ['un texto vacío', ''],
  ])('con %s no inventa una etiqueta', (_label, source) => {
    expect(recoveryDestinationLabel(source)).toBeNull()
  })
})

describe('describeAuditAction', () => {
  it('sin datos adicionales muestra solo la etiqueta', () => {
    expect(describeAuditAction({ action: 'SECURITY_RECOVERY_COMPLETED', revokedCount: null, recoveryDestination: null })).toBe('Recuperación completada')
  })

  it('mantiene el número de sesiones cerradas, también 0', () => {
    expect(describeAuditAction({ action: 'SESSIONS_REVOKED', revokedCount: 3, recoveryDestination: null })).toBe('Sesiones cerradas (3)')
    expect(describeAuditAction({ action: 'SESSIONS_REVOKED', revokedCount: 0, recoveryDestination: null })).toBe('Sesiones cerradas (0)')
  })

  it('añade entre paréntesis el origen del destino', () => {
    expect(describeAuditAction({ action: 'SECURITY_HOLD_RESOLVED', revokedCount: null, recoveryDestination: 'STORED' })).toBe('Protección retirada (destino guardado)')
    expect(describeAuditAction({ action: 'SECURITY_RECOVERY_DESTINATION_CHANGED', revokedCount: null, recoveryDestination: 'OWNER_CORRECTED' }))
      .toBe('Destino de recuperación corregido (destino corregido por un OWNER)')
  })

  it('con un origen desconocido no añade nada', () => {
    expect(describeAuditAction({ action: 'SECURITY_HOLD_RESOLVED', revokedCount: null, recoveryDestination: 'OWNER_GUESSED' })).toBe('Protección retirada')
  })

  it('una acción desconocida conserva su código y sus datos', () => {
    expect(describeAuditAction({ action: 'NEW_ACTION', revokedCount: 2, recoveryDestination: 'OWNER_PROVIDED' })).toBe('NEW_ACTION (2) (destino indicado por un OWNER)')
  })
})
