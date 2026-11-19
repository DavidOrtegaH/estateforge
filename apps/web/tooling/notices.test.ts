import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { build } from 'vite'

import { collectNotice, cssImportPackages, isViteRuntime, packageOf } from './notices.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temp: string[] = []
const tempDir = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ef-notices-')); temp.push(dir); return dir }
afterAll(() => { for (const dir of temp) fs.rmSync(dir, { recursive: true, force: true }) })

describe('detección de paquetes', () => {
  it.each([
    ['C:/repo/node_modules/.pnpm/react@19.2.8/node_modules/react/index.js', 'react'],
    ['/repo/node_modules/.pnpm/@base-ui+react@1.7.0_x/node_modules/@base-ui/react/esm/index.js?v=1', '@base-ui/react'],
    ['C:\\repo\\apps\\web\\node_modules\\lucide-react\\dist\\esm\\icons\\globe.js', 'lucide-react'],
  ])('%s → %s', (id, name) => {
    expect(packageOf(id)?.name).toBe(name)
  })

  it('ignora los módulos propios y los virtuales', () => {
    expect(packageOf('/repo/apps/web/src/App.tsx')).toBeNull()
    expect(packageOf('\0vite/preload-helper.js')).toBeNull()
    expect(isViteRuntime('\0vite/preload-helper.js')).toBe(true)
  })

  it('encuentra los paquetes que entran por @import en el CSS del proyecto', () => {
    const css = ['src/index.css', 'src/site/site.css'].map((file) => path.join(root, file))
    expect(cssImportPackages(css)).toEqual(expect.arrayContaining(['tailwindcss', 'tw-animate-css', 'shadcn', '@fontsource-variable/inter', '@fontsource-variable/manrope']))
  })
})

describe('texto de cada paquete', () => {
  const fakePackage = (files: Record<string, string>) => {
    const dir = tempDir()
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0', license: 'Apache-2.0' }))
    for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content)
    return dir
  }

  it('incluye la licencia y el NOTICE del paquete instalado', () => {
    const notice = collectNotice('x', fakePackage({ LICENSE: 'Apache License text', NOTICE: 'x\nCopyright 2026 Someone' }), root)
    expect(notice.text).toContain('Apache License text')
    expect(notice.text).toContain('Copyright 2026 Someone')
    expect(notice.sources).toEqual(['x/LICENSE', 'x/NOTICE'])
  })

  it('un paquete distribuido sin licencia ni texto declarado detiene la construcción', () => {
    expect(() => collectNotice('x', fakePackage({ NOTICE: 'solo aviso' }), root)).toThrow(/no incluye su licencia/)
  })
})

describe('construcción de la web', () => {
  it('third-party-notices.txt cubre cada paquete de npm que llega al JavaScript servido', async () => {
    const outDir = tempDir()
    await build({ root, configFile: path.join(root, 'vite.config.ts'), logLevel: 'silent', build: { outDir, emptyOutDir: true, sourcemap: true } })

    // Comprobación independiente del complemento: los paquetes que citan los sourcemaps del resultado.
    const shipped = new Set<string>()
    for (const file of fs.readdirSync(path.join(outDir, 'assets')).filter((name) => name.endsWith('.js.map'))) {
      for (const source of JSON.parse(fs.readFileSync(path.join(outDir, 'assets', file), 'utf8')).sources as string[]) {
        const found = packageOf(source)
        if (found && !found.name.startsWith('@estateforge/')) shipped.add(found.name)
      }
    }
    const notices = fs.readFileSync(path.join(outDir, 'third-party-notices.txt'), 'utf8')
    expect(shipped.size).toBeGreaterThan(5)
    for (const name of shipped) {
      expect(notices, name).toMatch(new RegExp(`^- ${name.replace(/[/.]/g, '\\$&')} \\S+ \\(`, 'm'))
    }
    // Fuentes servidas: su licencia OFL con el aviso de copyright de cada familia.
    expect(fs.readdirSync(path.join(outDir, 'assets')).some((name) => name.startsWith('inter-') && name.endsWith('.woff2'))).toBe(true)
    expect(notices).toMatch(/Copyright 2016 The Inter Project Authors/)
    expect(notices).toMatch(/Copyright 2019 The Manrope Project Authors/)
    expect(notices.match(/SIL OPEN FONT LICENSE Version 1\.1/g)?.length).toBeGreaterThanOrEqual(2)
    // El recurso local y su atribución se publican con la web, sin depender de imágenes externas.
    expect(fs.readFileSync(path.join(outDir, 'portales/pisos.png'))).toEqual(fs.readFileSync(path.join(root, 'public/portales/pisos.png')))
    const assetNotice = fs.readFileSync(path.join(outDir, 'portales/NOTICE.txt'), 'utf8').trim()
    expect(notices).toContain(assetNotice)
    expect(assetNotice).toContain('portal identification assets')
    for (const file of ['idealista.png', 'fotocasa.png', 'pisos.png', 'yaencontre.ico', 'habitaclia.png']) {
      expect(fs.readFileSync(path.join(outDir, 'portales', file))).toEqual(fs.readFileSync(path.join(root, 'public/portales', file)))
      expect(assetNotice).toContain(`File: ${file}`)
    }
  }, 120_000)

  it('las páginas públicas enlazan los avisos de terceros', () => {
    for (const file of ['index.html', 'privacidad.html', 'condiciones.html']) {
      expect(fs.readFileSync(path.join(root, file), 'utf8'), file).toContain('href="/third-party-notices.txt"')
    }
  })
})
