import { describe, expect, it } from 'vitest'

import { z } from './zod.js'

describe('zod configuration', () => {
  it('never compiles schemas with eval, which the web CSP forbids', () => {
    expect(z.config().jitless).toBe(true)
    expect(z.object({ a: z.string() }).parse({ a: 'x' })).toEqual({ a: 'x' })
  })
})
