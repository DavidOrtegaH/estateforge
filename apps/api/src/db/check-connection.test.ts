import { describe, expect, it } from 'vitest'

import { checkConnection, type Probe } from './check-connection.js'

const URL_OK = 'postgresql://estateforge_app:clave-secreta-de-prueba@127.0.0.1:55432/estateforge_dev'

function probe(fail?: unknown): Probe {
  return {
    connect: async () => {
      if (fail) throw fail
    },
    query: async () => [{ '?column?': 1 }],
    end: async () => {},
  }
}

const err = (code: string, message = 'x') => Object.assign(new Error(message), { code })

describe('comprobación de la base de desarrollo', () => {
  it('conexión autenticada: devuelve el destino sin usuario ni contraseña', async () => {
    const result = await checkConnection({ DATABASE_URL: URL_OK }, () => probe())

    expect(result).toEqual({ ok: true, host: '127.0.0.1', port: 55432, database: 'estateforge_dev' })
    expect(JSON.stringify(result)).not.toMatch(/clave-secreta|estateforge_app/)
  })

  it.each([
    ['sin DATABASE_URL', {}],
    ['URL de SQLite', { DATABASE_URL: 'file:./dev.db' }],
    ['URL de MySQL', { DATABASE_URL: 'mysql://u:clave-mysql@127.0.0.1/db' }],
  ])('%s: configuración no válida y sin conectarse', async (_label, env) => {
    let connected = false
    const result = await checkConnection(env, () => ({ ...probe(), connect: async () => { connected = true } }))

    expect(result).toMatchObject({ ok: false, reason: 'config' })
    expect(connected).toBe(false)
    expect(JSON.stringify(result)).not.toMatch(/clave-mysql|dev\.db/)
  })

  it.each([
    ['credenciales rechazadas', err('28P01'), 'auth'],
    ['base inexistente', err('3D000'), 'database'],
    ['nadie escucha en el puerto', err('ECONNREFUSED'), 'unreachable'],
    ['tiempo agotado', new Error('timeout expired'), 'unreachable'],
    ['otro servicio en el puerto o conexión cortada', new Error('Connection terminated unexpectedly'), 'protocol'],
    ['error desconocido', new Error('raro'), 'other'],
  ])('%s: %s', async (_label, failure, reason) => {
    const result = await checkConnection({ DATABASE_URL: URL_OK }, () => probe(failure))

    expect(result).toMatchObject({ ok: false, reason, host: '127.0.0.1', port: 55432 })
    expect(JSON.stringify(result)).not.toMatch(/clave-secreta|estateforge_app/)
  })
})
