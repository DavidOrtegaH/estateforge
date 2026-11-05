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

describe('accountStatuses: recuperación pendiente (R2)', () => {
  const PENDING = '2026-11-03T10:00:00.000Z'
  const RECOVERY = { label: 'Recuperación pendiente', className: 'font-medium text-sky-700' }

  it('solo recuperación pendiente: su propia etiqueta, distinta de las demás', () => {
    expect(accountStatuses({ securityHoldAt: null, adminSuspendedAt: null, passwordResetRequiredAt: PENDING })).toEqual([RECOVERY])
  })

  it('con suspensión: no oculta la suspensión (primero la suspensión)', () => {
    expect(accountStatuses({ securityHoldAt: null, adminSuspendedAt: SUSPENDED, passwordResetRequiredAt: PENDING })).toEqual([SUSPENDED_LABEL, RECOVERY])
  })

  it('con protección: no oculta la protección (primero la protección)', () => {
    expect(accountStatuses({ securityHoldAt: HOLD, adminSuspendedAt: null, passwordResetRequiredAt: PENDING })).toEqual([PROTECTED, RECOVERY])
  })

  it('los tres estados a la vez se muestran todos', () => {
    expect(accountStatuses({ securityHoldAt: HOLD, adminSuspendedAt: SUSPENDED, passwordResetRequiredAt: PENDING })).toEqual([PROTECTED, SUSPENDED_LABEL, RECOVERY])
  })

  it('sin recuperación pendiente (null o sin el campo) sigue siendo «Normal»', () => {
    expect(accountStatuses({ securityHoldAt: null, adminSuspendedAt: null, passwordResetRequiredAt: null })).toEqual([NORMAL])
    expect(accountStatuses({ securityHoldAt: null, adminSuspendedAt: null })).toEqual([NORMAL])
  })
})
