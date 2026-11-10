import { describe, expect, it } from 'vitest'

import { buildPoolConfig } from './connection-config.js'

const URL = 'postgresql://usuario:clave-de-ejemplo@localhost:5432/base'

describe('configuración del pool', () => {
  it('usa valores acotados por defecto', () => {
    expect(buildPoolConfig({ DATABASE_URL: URL })).toEqual({
      connectionString: URL,
      application_name: 'estateforge-api',
      max: 10,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
    })
  })

  it('admite ajustes por entorno', () => {
    expect(buildPoolConfig({ DATABASE_URL: URL, DATABASE_POOL_MAX: '25', DATABASE_CONNECT_TIMEOUT_MS: '100', DATABASE_IDLE_TIMEOUT_MS: '200' })).toMatchObject({
      max: 25,
      connectionTimeoutMillis: 100,
      idleTimeoutMillis: 200,
    })
  })

  it.each(['0', '-1', 'x', '1.5'])('rechaza %s como tamaño del pool', (value) => {
    expect(() => buildPoolConfig({ DATABASE_URL: URL, DATABASE_POOL_MAX: value })).toThrow(/entero positivo/)
  })

  it('exige la URL', () => {
    expect(() => buildPoolConfig({})).toThrow(/no está configurada/)
  })

  it('rechaza una base SQLite y el mensaje no revela la conexión', () => {
    expect(() => buildPoolConfig({ DATABASE_URL: 'file:./dev.db' })).toThrow('DATABASE_URL debe ser una conexión postgresql://.')
  })
})
