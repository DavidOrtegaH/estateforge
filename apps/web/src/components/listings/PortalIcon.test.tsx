import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { PUBLICATION_PLATFORMS } from '@estateforge/shared'

import { PORTAL_ICONS, portalIconFor, type PortalIconAsset } from '@/lib/portalIcons'

import { PortalIcon } from './PortalIcon'

// Registro de iconos de los portales: solo archivos locales con procedencia documentada; respaldo neutro.

const sample: PortalIconAsset = { src: '/portales/ejemplo.svg', source: 'https://ejemplo.test/prensa', terms: 'Autorización escrita del titular (ejemplo de prueba)', retrievedAt: '2026-11-19' }

describe('registro de iconos de los portales', () => {
  it('cada entrada es un archivo local con procedencia, condiciones y fecha; nunca una URL remota', () => {
    const ids = new Set<string>(PUBLICATION_PLATFORMS.map(platform => platform.id))
    for (const [id, icon] of Object.entries(PORTAL_ICONS)) {
      expect(ids.has(id), id).toBe(true)
      expect(icon!.src, id).toMatch(/^\/(?!\/)/)
      expect(icon!.src, id).not.toMatch(/^(https?:)?\/\//)
      expect(icon!.source.trim(), id).not.toBe('')
      expect(icon!.terms.trim(), id).not.toBe('')
      expect(icon!.retrievedAt, id).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('«Otro/a» y los portales sin recurso usan el respaldo neutro', () => {
    expect(portalIconFor(null)).toBeNull()
    expect(portalIconFor(null, { idealista: sample })).toBeNull()
    for (const { id } of PUBLICATION_PLATFORMS) expect(portalIconFor(id, {})).toBeNull()
    expect(portalIconFor('idealista', { idealista: sample })).toBe(sample)
    expect(portalIconFor('fotocasa', { idealista: sample })).toBeNull()
  })
})

describe('casilla del icono', () => {
  it('con recurso: imagen local decorativa, proporción conservada, dentro de la casilla de 32×32', () => {
    const markup = renderToStaticMarkup(<PortalIcon icon={sample} />)
    expect(markup).toContain('data-portal-icon="brand"')
    expect(markup).toMatch(/class="[^"]*h-8[^"]*w-8[^"]*"/)
    expect(markup).toContain('src="/portales/ejemplo.svg"')
    expect(markup).toContain('alt=""')
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).toContain('object-contain')
  })

  it('sin recurso: icono genérico oculto a los lectores de pantalla, en la misma casilla', () => {
    const markup = renderToStaticMarkup(<PortalIcon icon={null} />)
    expect(markup).toContain('data-portal-icon="generic"')
    expect(markup).toMatch(/class="[^"]*h-8[^"]*w-8[^"]*"/)
    expect(markup).toMatch(/<svg[^>]*aria-hidden="true"/)
    expect(markup).not.toContain('<img')
  })
})

it('un logotipo textual se conserva completo en una placa más ancha', () => {
  const markup = renderToStaticMarkup(<PortalIcon icon={{ ...sample, presentation: 'wordmark' }} />)
  expect(markup).toContain('w-28')
  expect(markup).toContain('width="100"')
  expect(markup).toContain('object-contain')
})

it('todos los portales del catálogo tienen recurso local y el favicon pequeño no se amplía', () => {
  expect(Object.keys(PORTAL_ICONS)).toEqual(PUBLICATION_PLATFORMS.map(({ id }) => id))
  const markup = renderToStaticMarkup(<PortalIcon icon={PORTAL_ICONS.yaencontre!} />)
  expect(markup).toContain('width="16"')
  expect(markup).toContain('height="16"')
  expect(markup).toContain('h-4 w-4')
})
