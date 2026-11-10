import type { FastifyBaseLogger } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const revoke = vi.hoisted(() => vi.fn())

vi.mock('./password-reset.service.js', () => ({ revokeUndeliveredResetToken: revoke }))

import { revokeAfterFailedDelivery } from './undelivered-link.js'

const TOKEN = 'f'.repeat(64)

function logger() {
  const lines: unknown[] = []
  const raw = {
    warn: vi.fn((...args: unknown[]) => lines.push(args)),
    error: vi.fn((...args: unknown[]) => lines.push(args)),
  }
  return { log: raw as unknown as FastifyBaseLogger, raw, text: () => JSON.stringify(lines) }
}

const rejected = Object.assign(new Error('550 Recipient rejected: destino@example.test'), { code: 'EENVELOPE', responseCode: 550 })
const lost = Object.assign(new Error('Connection closed unexpectedly'), { code: 'ECONNECTION', command: 'CONN' })

beforeEach(() => {
  revoke.mockReset()
})

describe('compensación de un enlace no entregado (DA-39)', () => {
  it('un fallo conocido anula el token de esa cuenta', async () => {
    revoke.mockResolvedValue(true)
    const { log, raw, text } = logger()

    await revokeAfterFailedDelivery(log, 'security_recovery', 'cuenta-1', TOKEN, rejected)

    expect(revoke).toHaveBeenCalledWith('cuenta-1', TOKEN)
    expect(raw.warn).toHaveBeenCalledWith({ flow: 'security_recovery', targetUserId: 'cuenta-1', tokenRevoked: true }, expect.any(String))
    expect(text()).not.toContain(TOKEN)
    expect(text()).not.toContain('destino@example.test')
  })

  it('un envío no confirmado conserva el token', async () => {
    const { log, raw } = logger()

    await revokeAfterFailedDelivery(log, 'password_reset', 'cuenta-1', TOKEN, lost)

    expect(revoke).not.toHaveBeenCalled()
    expect(raw.warn).toHaveBeenCalledWith(expect.objectContaining({ deliveryState: 'unconfirmed', tokenKept: true }), expect.any(String))
  })

  it('un token ya usado o sustituido no se toca y se registra como no anulado', async () => {
    revoke.mockResolvedValue(false)
    const { log, raw } = logger()

    await revokeAfterFailedDelivery(log, 'password_reset', 'cuenta-1', TOKEN, rejected)

    expect(raw.warn).toHaveBeenCalledWith(expect.objectContaining({ tokenRevoked: false }), expect.any(String))
  })

  it('si la anulación falla, no lanza y registra solo campos cerrados', async () => {
    revoke.mockRejectedValue(Object.assign(new Error(`timeout ${TOKEN} postgresql://u:p@db/x`), { name: 'PrismaClientKnownRequestError', code: 'P2024' }))
    const { log, raw, text } = logger()

    await expect(revokeAfterFailedDelivery(log, 'security_recovery', 'cuenta-1', TOKEN, rejected)).resolves.toBeUndefined()

    expect(raw.error).toHaveBeenCalledWith(expect.objectContaining({ compensation: 'failed', errorCode: 'P2024' }), expect.any(String))
    expect(text()).not.toContain(TOKEN)
    expect(text()).not.toContain('postgresql://')
  })
})
