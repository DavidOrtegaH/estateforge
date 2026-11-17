import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { makePng, uniqueSeed } from './images.js'

// MD-43: las imágenes de prueba de un mismo inmueble deben ser distintas, porque la API rechaza una
// fotografía duplicada (409). La semilla ya no depende del azar.

const hash = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex')

describe('imágenes de prueba', () => {
  it('la misma semilla da el mismo archivo: por eso una semilla repetida provocaba un duplicado', () => {
    expect(hash(makePng(80, 60, 1234))).toBe(hash(makePng(80, 60, 1234)))
    // El patrón antiguo «1000 + i + aleatorio» podía repetirse: 1000 + 0 + 7 === 1000 + 3 + 4.
    expect(hash(makePng(80, 60, 1000 + 0 + 7))).toBe(hash(makePng(80, 60, 1000 + 3 + 4)))
  })

  it('semillas distintas dan archivos distintos', () => {
    expect(hash(makePng(80, 60, 1))).not.toBe(hash(makePng(80, 60, 2)))
    expect(hash(makePng(80, 60, 1))).not.toBe(hash(makePng(80, 60, 257)))
  })

  it('uniqueSeed no se repite y no choca con las semillas literales de las pruebas', () => {
    const seeds = Array.from({ length: 5000 }, () => uniqueSeed())
    expect(new Set(seeds).size).toBe(5000)
    expect(Math.min(...seeds)).toBeGreaterThan(10_000_000)
    const files = new Set(seeds.slice(0, 200).map(seed => hash(makePng(8, 8, seed))))
    expect(files.size).toBe(200)
  })
})
