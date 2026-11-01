import { describe, expect, it } from 'vitest'

import { describeAuditAccount } from './adminAudit'

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
