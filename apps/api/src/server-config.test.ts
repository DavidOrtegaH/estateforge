import { describe, expect, it } from 'vitest'

import { readServerAddress } from './server-config.js'

describe('dirección de escucha', () => {
  it('conserva los valores anteriores por defecto', () => {
    expect(readServerAddress({})).toEqual({ port: 3000, host: 'localhost' })
  })

  it('acepta PORT y HOST', () => {
    expect(readServerAddress({ PORT: '8080', HOST: '0.0.0.0' })).toEqual({ port: 8080, host: '0.0.0.0' })
  })

  it.each(['0', '70000', 'x', '1.5', '-1'])('rechaza PORT=%s', (PORT) => {
    expect(() => readServerAddress({ PORT })).toThrow(/PORT/)
  })
})
