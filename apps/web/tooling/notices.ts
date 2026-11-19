// Avisos de terceros del código y los recursos que se sirven al navegador.
//
// Durante la construcción se recorren los módulos que entran en el grafo de la web (JavaScript, CSS y
// fuentes) y, de cada paquete de npm que aparece, se toman del propio paquete instalado su licencia,
// su aviso de copyright y su NOTICE, si lo tiene. Algunos paquetes no incluyen el archivo de licencia en
// lo que publican en npm; su texto, copiado de su repositorio oficial para la versión usada, está en
// `licenses/` (en la raíz del repositorio) y se declara en EXTERNAL_LICENSES. Si un paquete del grafo no
// tiene texto de licencia por ninguna de las dos vías, la construcción falla.
import fs from 'node:fs'
import path from 'node:path'

export type PackageNotice = {
  name: string
  version: string
  license: string
  homepage: string | null
  /** Archivos de los que sale el texto, relativos al paquete o a la raíz del repositorio. */
  sources: string[]
  text: string
}

/**
 * Paquetes que no incluyen su licencia en lo que publican en npm: texto oficial guardado en
 * licenses/<archivo>. Hoy todos los paquetes del grafo la incluyen, así que está vacío.
 */
export const EXTERNAL_LICENSES: Record<string, string> = {}

const LICENSE_FILE = /^(licen[cs]e|copying|notice)(\.(md|txt|markdown))?$/i

/** Nombre y carpeta del paquete de npm al que pertenece un módulo, o null si no viene de node_modules. */
export function packageOf(moduleId: string): { name: string; dir: string } | null {
  const id = moduleId.replace(/\\/g, '/').replace(/^\0/, '').split('?')[0]
  const index = id.lastIndexOf('/node_modules/')
  if (index === -1) return null
  const rest = id.slice(index + '/node_modules/'.length).split('/')
  const name = rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0]
  if (!name || name === '.pnpm' || name === '.vite') return null
  return { name, dir: id.slice(0, index + '/node_modules/'.length) + name }
}

/**
 * Paquetes que entran por un `@import` de CSS con especificador de paquete. Tailwind expande esos
 * imports dentro del CSS final, así que no aparecen como módulos del grafo.
 */
export function cssImportPackages(cssFiles: string[]): string[] {
  const names = new Set<string>()
  for (const file of cssFiles) {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/@import\s+(?:url\()?["']([^"'.\/][^"']*)["']/g)) {
      const parts = match[1].split('/')
      names.add(parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0])
    }
  }
  return [...names].sort()
}

/** Módulos virtuales de Vite que acaban en el código servido (precarga de los fragmentos diferidos). */
export const isViteRuntime = (moduleId: string) => /^\0?vite\/(preload-helper|modulepreload-polyfill)/.test(moduleId)

/**
 * La licencia de Vite incluye después las de sus dependencias empaquetadas, que no llegan a la web:
 * solo se reproduce su primera sección («Vite core license»).
 */
const EXCERPTS: Record<string, RegExp> = { vite: /\n# Licenses of bundled dependencies[\s\S]*$/ }

export function collectNotice(name: string, dir: string, repoRoot: string): PackageNotice {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
    version: string
    license?: string | { type: string }
    homepage?: string
    repository?: string | { url?: string }
  }
  const license = typeof manifest.license === 'string' ? manifest.license : manifest.license?.type ?? 'UNKNOWN'
  const files = fs.readdirSync(dir).filter((file) => LICENSE_FILE.test(file)).sort()
  const sources: string[] = []
  const parts: string[] = []
  for (const file of files) {
    const excerpt = EXCERPTS[name]
    const content = fs.readFileSync(path.join(dir, file), 'utf8')
    sources.push(excerpt && excerpt.test(content) ? `${name}/${file} (first section: Vite core license)` : `${name}/${file}`)
    parts.push((excerpt ? content.replace(excerpt, '') : content).trim())
  }
  if (!files.some((file) => !/^notice/i.test(file))) {
    const external = EXTERNAL_LICENSES[name]
    if (!external) throw new Error(`El paquete ${name}@${manifest.version} se distribuye en la web pero no incluye su licencia: añade su texto oficial a licenses/ y a EXTERNAL_LICENSES.`)
    const file = path.join(repoRoot, 'licenses', external)
    sources.unshift(`licenses/${external}`)
    parts.unshift(fs.readFileSync(file, 'utf8').trim())
  }
  const repository = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url
  return { name, version: manifest.version, license, homepage: manifest.homepage ?? repository ?? null, sources, text: parts.join('\n\n') }
}

/** Texto final de third-party-notices.txt. */
export function renderNotices(notices: PackageNotice[], own: string): string {
  const sorted = [...notices].sort((a, b) => a.name.localeCompare(b.name))
  const index = sorted.map((notice) => `- ${notice.name} ${notice.version} (${notice.license})`).join('\n')
  const bodies = sorted
    .map((notice) => [
      '='.repeat(78),
      `${notice.name} ${notice.version}`,
      `License: ${notice.license}`,
      ...(notice.homepage ? [`Source: ${notice.homepage}`] : []),
      `Text taken from: ${notice.sources.join(', ')}`,
      '-'.repeat(78),
      notice.text,
    ].join('\n'))
    .join('\n\n')
  return `${own}\n\nComponents included in this web application:\n\n${index}\n\n${bodies}\n`
}

export const OWN_NOTICE = `EstateForge web application - third-party notices

EstateForge is proprietary software (see LICENSE in the source repository). The JavaScript, CSS and
font files served by this application include the third-party components listed below. Each of them
remains under its own license, reproduced here with its copyright notice and, where provided, its
NOTICE file. Nothing in the EstateForge license limits the rights granted by these licenses for the
corresponding components.

${fs.readFileSync(new URL('../public/portales/NOTICE.txt', import.meta.url), 'utf8').trim()}`
