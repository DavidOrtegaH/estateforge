import { describe, expect, it } from 'vitest'

import { accountStatuses } from './adminAccountStatus'

const HOLD = '2026-11-02T10:00:00.000Z'
const SUSPENDED = '2026-11-01T10:00:00.000Z'

const PROTECTED = { label: 'Protección por incidente', className: 'font-medium text-red-700' }
const SUSPENDED_LABEL = { label: 'Suspendida por admin', className: 'font-medium text-amber-700' }
const NORMAL = { label: 'Normal', className: 'text-green-700' }

describe('accountStatuses', () => {
  it('con protección y suspensión a la vez muestra las dos etiquetas, primero la protección', () => {
    expect(accountStatuses({ securityHoldAt: HOLD, adminSuspendedAt: SUSPENDED })).toEqual([PROTECTED, SUSPENDED_LABEL])
  })

  it('solo protección: la etiqueta y el estilo de siempre', () => {
    expect(accountStatuses({ securityHoldAt: HOLD, adminSuspendedAt: null })).toEqual([PROTECTED])
  })

  it('solo suspensión: la etiqueta y el estilo de siempre', () => {
    expect(accountStatuses({ securityHoldAt: null, adminSuspendedAt: SUSPENDED })).toEqual([SUSPENDED_LABEL])
  })

  it('sin ninguna de las dos: «Normal»', () => {
    expect(accountStatuses({ securityHoldAt: null, adminSuspendedAt: null })).toEqual([NORMAL])
  })
})
