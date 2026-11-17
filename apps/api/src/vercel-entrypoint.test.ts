import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

// Reproduce el contrato de selección de entrada del builder de Vercel para Fastify
// (vercel/vercel, packages/fastify/src/build.ts: generateNodeBuilderFunctions). Solo es elegible un
// candidato, en este orden, cuyo código contenga una importación literal de 'fastify'.
// Si cambia el builder, hay que revisar esta copia del contrato.

const API = resolve(import.meta.dirname, '..')
const CANDIDATES = ['app', 'index', 'server', 'src/app', 'src/index', 'src/server']
const EXTENSIONS = ['.js', '.cjs', '.mjs', '.ts', '.cts', '.mts']
const FASTIFY_IMPORT = /(?:from|require|import)\s*(?:\(\s*)?["']fastify["']\s*(?:\))?/g

function selectEntrypoint(read: (file: string) => string | undefined): string | undefined {
  for (const candidate of CANDIDATES) {
    for (const ext of EXTENSIONS) {
      const source = read(`${candidate}${ext}`)
      if (source !== undefined && new RegExp(FASTIFY_IMPORT.source, 'g').test(source)) return `${candidate}${ext}`
    }
  }
  return undefined
}

function readFromDisk(file: string): string | undefined {
  const path = resolve(API, file)
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined
}

describe('entrada de la función de Vercel (detector de Fastify)', () => {
  it('elige server.ts de la raíz y no la factoría de pruebas src/app.ts', () => {
    expect(selectEntrypoint(readFromDisk)).toBe('server.ts')
  })

  it('sin el import directo de fastify en server.ts, el detector caería en src/app.ts', () => {
    const withoutDirectImport = (file: string) =>
      file === 'server.ts' ? readFromDisk(file)?.replace(/^import 'fastify'\s*$/m, '') : readFromDisk(file)

    expect(selectEntrypoint(withoutDirectImport)).toBe('src/app.ts')
  })

  it('server.ts sigue delegando el arranque en src/server.ts', () => {
    expect(readFromDisk('server.ts')).toMatch(/^import '\.\/src\/server\.js'$/m)
  })
})
