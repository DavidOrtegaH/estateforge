// Importa @estateforge/shared como lo hace la función de Vercel: Node sin cargador, sin TypeScript y
// sin condiciones extra. Falla si la resolución no llega al JavaScript compilado (packages/shared/dist)
// o si este no carga. Requiere `pnpm --filter @estateforge/shared build` antes.
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const fail = (message) => {
  console.error(`check-shared-runtime: ${message}`)
  process.exit(1)
}

const runtimeFlags = [...process.execArgv, process.env.NODE_OPTIONS ?? ''].join(' ')
if (/--(import|loader|experimental-loader|require|conditions)\b|(^|\s)-[rC]\b/.test(runtimeFlags)) {
  fail(`se debe ejecutar con Node sin cargadores ni condiciones (flags: ${runtimeFlags})`)
}

const sharedDir = path.resolve(import.meta.dirname, '../../../packages/shared')
const distDir = path.join(sharedDir, 'dist')
if (!existsSync(path.join(distDir, 'index.js'))) {
  fail('no existe packages/shared/dist/index.js: ejecuta antes `pnpm --filter @estateforge/shared build`')
}
const resolved = fileURLToPath(import.meta.resolve('@estateforge/shared'))
if (resolved !== path.join(distDir, 'index.js')) {
  fail(`@estateforge/shared resuelve a ${resolved}, no a ${path.join(distDir, 'index.js')}`)
}

// Cada módulo fuente (salvo las pruebas) debe tener su JavaScript compilado.
const sources = readdirSync(path.join(sharedDir, 'src')).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
const missing = sources.map((f) => f.replace(/\.ts$/, '.js')).filter((f) => !existsSync(path.join(distDir, f)))
if (missing.length > 0) fail(`faltan en dist: ${missing.join(', ')}`)

let shared
try {
  shared = await import('@estateforge/shared')
} catch (error) {
  fail(`no se pudo importar el artefacto compilado: ${error instanceof Error ? error.message : error}`)
}
const exported = Object.keys(shared)
if (exported.length === 0) fail('el artefacto compilado no exporta nada')

console.log(`check-shared-runtime: ${path.relative(process.cwd(), resolved)} cargado sin cargador (${exported.length} exportaciones)`)
