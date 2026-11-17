import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import type { ListingMediaItem, PropertyPhoto } from '@/services/mediaService'

import { DEFAULT_AUDIO } from '@/lib/audioChoice'

import { AudioPickerView } from './AudioPicker'
import { PosterTemplatePicker } from './PosterTemplatePicker'
import { PhotoGrid } from './PropertyGallery'
import { MediaCard } from './PromoMaterials'
import { VideoPhotoPicker } from './VideoPhotoPicker'

const noop = () => {}

const photo = (i: number, isPrimary = false): PropertyPhoto => ({
  id: `ph${i}`,
  position: i,
  isPrimary,
  contentType: 'image/jpeg',
  size: 1000,
  width: 800,
  height: 600,
  originalName: `foto-${i}.jpg`,
  createdAt: '2026-11-10T00:00:00.000Z',
  url: `/api/properties/p1/photos/ph${i}/file?v=abc`,
  thumbUrl: i % 2 ? `/api/properties/p1/photos/ph${i}/file?v=abc-900&size=thumb` : null,
})

const media = (kind: 'poster' | 'video'): ListingMediaItem => ({
  kind,
  contentType: kind === 'poster' ? 'image/jpeg' : 'video/webm',
  size: 2_000_000,
  width: 1080,
  height: 1350,
  durationMs: kind === 'video' ? 21000 : null,
  variant: 4,
  version: 3,
  photoCount: 3,
  templateId: kind === 'poster' ? 'editorial' : null,
  templateName: kind === 'poster' ? 'Editorial' : null,
  templateVersion: kind === 'poster' ? 1 : null,
  selectionMode: kind === 'poster' ? 'random' : null,
  codecs: kind === 'video' ? 'video/webm;codecs="vp9,opus"' : null,
  hasAudio: kind === 'video',
  audioSource: kind === 'video' ? 'preset' : 'none',
  audioTrackId: kind === 'video' ? 'piano-sereno' : null,
  audioName: kind === 'video' ? 'Piano sereno' : null,
  audioVolume: kind === 'video' ? 70 : null,
  audioFadeInMs: kind === 'video' ? 1000 : null,
  audioFadeOutMs: kind === 'video' ? 2000 : null,
  createdAt: '2026-11-10T00:00:00.000Z',
  updatedAt: '2026-11-10T00:00:00.000Z',
  url: `/api/generations/g1/media/${kind}/file?v=3`,
})

const grid = (photos: PropertyPhoto[], busy = false) =>
  renderToStaticMarkup(<PhotoGrid photos={photos} busy={busy} onView={noop} onMove={noop} onPrimary={noop} onReplace={noop} onDelete={noop} />)

const card = (props: Partial<Parameters<typeof MediaCard>[0]> & { kind: 'poster' | 'video' }) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <MediaCard item={null} busy={false} progress={null} error={null} propertyId="p1" onGenerate={noop} {...props} />
    </MemoryRouter>,
  )

describe('galería del inmueble', () => {
  it('muestra posición, total y la principal', () => {
    const html = grid([photo(0, true), photo(1), photo(2)])
    expect(html).toContain('1/3')
    expect(html).toContain('3/3')
    expect(html.match(/Principal/g)).toHaveLength(1)
    expect(html).toContain('/api/properties/p1/photos/ph1/file?v=abc')
    expect(html).not.toContain('storageKey')
  })

  it('desactiva los movimientos imposibles y todo mientras hay una operación en curso', () => {
    const html = grid([photo(0, true), photo(1)])
    const left = html.match(/<button[^>]*aria-label="Mover a la izquierda"[^>]*>/g) ?? []
    expect(left[0]).toContain('disabled=""')
    expect(left[1]).not.toContain('disabled=""')
    const busy = grid([photo(0, true), photo(1)], true)
    const deletes = busy.match(/<button[^>]*aria-label="Eliminar fotografía"[^>]*>/g) ?? []
    expect(deletes).toHaveLength(2)
    for (const button of deletes) expect(button).toContain('disabled=""')
  })
})

describe('cartel y vídeo del anuncio', () => {
  it('sin material ofrece generar', () => {
    const html = card({ kind: 'poster' })
    expect(html).toContain('Todavía no se ha generado el cartel')
    expect(html).toContain('Generar cartel')
    expect(html).not.toContain('Descargar')
  })

  it('con material ofrece regenerar y descargar, con versión y formato', () => {
    const html = card({ kind: 'video', item: media('video') })
    expect(html).toContain('Regenerar vídeo')
    expect(html).toContain('Versión 3')
    expect(html).toContain('WebM')
    expect(html).toContain('21 s')
    expect(html).toContain('file?v=3&amp;download=1')
    expect(html).toContain('<video')
  })

  it('durante la grabación muestra el progreso, permite cancelar y bloquea regenerar', () => {
    const html = card({ kind: 'video', item: media('video'), busy: true, progress: 0.42, onCancel: noop })
    expect(html).toContain('42 %')
    expect(html).toContain('Cancelar')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Regenerar vídeo/)
    expect(html).not.toContain('Descargar')
  })

  it('si faltan fotografías enlaza a la ficha del inmueble', () => {
    const html = card({ kind: 'poster', error: { text: 'El inmueble no tiene fotografías.', needsPhotos: true } })
    expect(html).toContain('role="alert"')
    expect(html).toContain('href="/inmuebles/p1"')
  })
})

describe('galería de 50 (DA-51)', () => {
  it('usa la miniatura cuando existe y la original cuando aún no', () => {
    const html = grid([photo(0, true), photo(1)])
    expect(html).toContain('ph1/file?v=abc-900&amp;size=thumb')
    expect(html).toContain('ph0/file?v=abc')
    expect(html).toContain('loading="lazy"')
  })

  it('muestra la posición con 50 fotografías', () => {
    const html = grid(Array.from({ length: 50 }, (_, i) => photo(i, i === 0)))
    expect(html).toContain('50/50')
    expect(html.match(/Principal/g)).toHaveLength(1)
  })
})

describe('opciones del cartel y del vídeo', () => {
  it('el cartel muestra la plantilla usada y si se eligió al azar; el vídeo, su sonido', () => {
    expect(card({ kind: 'poster', item: media('poster') })).toContain('Plantilla Editorial (elegida al azar)')
    expect(card({ kind: 'video', item: media('video') })).toContain('Sonido: Piano sereno (70 %)')
    const silent = { ...media('video'), hasAudio: false, audioSource: 'none' as const, audioName: null, audioTrackId: null, audioVolume: null }
    expect(card({ kind: 'video', item: silent })).toContain('Sin sonido')
    const legacy = { ...media('poster'), templateId: null, templateName: null, selectionMode: null }
    expect(card({ kind: 'poster', item: legacy })).toContain('Diseño anterior a las plantillas')
  })

  it('selector de plantilla: «Aleatoria» y las seis plantillas, con nombre, descripción y vista previa', () => {
    const html = renderToStaticMarkup(<PosterTemplatePicker value="random" onChange={noop} content={null} images={[]} loading={false} />)
    expect(html.match(/name="poster-template"/g)).toHaveLength(7)
    expect(html).toContain('Elegir una variante al azar entre las 6')
    for (const name of ['Elegante', 'Minimalista', 'Editorial', 'Premium', 'Fotográfico', 'Moderno']) expect(html).toContain(name)
    expect(html.match(/Vista previa de la plantilla/g)).toHaveLength(6)
    expect(html).toMatch(/data-template="random"[^>]*>[\s\S]*?checked=""/)
  })

  it('selector de plantilla (DA-76): nada impone un ancho mínimo y las descripciones se parten sin ocultarse', () => {
    const html = renderToStaticMarkup(<PosterTemplatePicker value="random" onChange={noop} content={null} images={[]} loading={false} />)
    expect(html).toMatch(/<fieldset class="min-w-0[^"]*"/)
    expect(html).toMatch(/<ul class="grid min-w-0 grid-cols-\[repeat\(auto-fill,minmax\(min\(100%,8\.5rem\),1fr\)\)\]/)
    expect(html.match(/<li class="min-w-0">/g)).toHaveLength(7)
    expect(html).toContain('[overflow-wrap:anywhere]')
    expect(html).toContain('max-w-full')
    // Nunca se recorta: ni altura fija, ni overflow oculto, ni puntos suspensivos en las descripciones.
    expect(html).not.toMatch(/line-clamp|truncate|overflow-hidden|text-ellipsis/)
  })

  it('selector de plantilla: «Generación con IA» diferenciada, expresa y fuera de «Aleatoria»', () => {
    const available = renderToStaticMarkup(
      <MemoryRouter>
        <PosterTemplatePicker value="ai" onChange={noop} content={null} images={[]} loading={false} ai={{ available: true, reason: null, provider: 'Google Gemini · Nano Banana 2', model: 'gemini-3.1-flash-image' }} />
      </MemoryRouter>,
    )
    expect(available.match(/name="poster-template"/g)).toHaveLength(8)
    expect(available).toMatch(/data-template="ai"[^>]*>[\s\S]*?checked=""/)
    expect(available).toContain('Generación con IA')
    expect(available).toContain('Google Gemini · Nano Banana 2')
    expect(available).toContain('nunca la de IA')
    const missing = renderToStaticMarkup(
      <MemoryRouter>
        <PosterTemplatePicker value="random" onChange={noop} content={null} images={[]} loading={false} ai={{ available: false, reason: 'Configura un proveedor y su API key para carteles con IA.', provider: null, model: null }} />
      </MemoryRouter>,
    )
    // Sin proveedor: no es seleccionable y lleva a Ajustes.
    expect(missing.match(/name="poster-template"/g)).toHaveLength(7)
    expect(missing).toContain('Generación con IA (no disponible)')
    expect(missing).toContain('href="/cuenta"')
  })

  it('fotografías del vídeo: orden elegido, principal fija y primera, número, capacidad restante, duración y aviso', () => {
    const photos = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, isPrimary: i === 0, url: `/u${i}`, thumbUrl: null }))
    // Orden personalizado: la principal y después la 3.ª y la 2.ª de la galería.
    const few = renderToStaticMarkup(<VideoPhotoPicker photos={photos} selected={['p0', 'p2', 'p1']} onChange={noop} />)
    expect(few).toContain('3 seleccionadas (máximo 25) · puedes añadir 22 más')
    // 3 × 3,5 s + presentación, características y cierre (10 s) = 20,5 s.
    expect(few).toContain('duración estimada 21 s')
    expect([...few.matchAll(/data-video-photo="(p\d+)"/g)].map(m => m[1])).toEqual(['p0', 'p2', 'p1'])
    expect(few).toContain('Principal (obligatoria)')
    // La principal no se puede quitar ni mover; la segunda no puede subir por encima de ella.
    for (const label of ['Quitar la fotografía 1 del vídeo', 'Subir la fotografía 1', 'Bajar la fotografía 1', 'Subir la fotografía 2', 'Bajar la fotografía 3']) {
      expect(few).toMatch(new RegExp(`disabled=""[^>]*aria-label="${label}"`))
    }
    expect(few).not.toMatch(/disabled=""[^>]*aria-label="Quitar la fotografía 2 del vídeo"/)
    expect(few).toContain('Sin incluir (27)')
    expect(few).toContain('las primeras 25 de la galería, en su orden')
    expect(few).not.toContain('quizá prefieras quitar algunas')
    const many = renderToStaticMarkup(<VideoPhotoPicker photos={photos} selected={photos.slice(0, 25).map(p => p.id)} onChange={noop} />)
    expect(many).toContain('25 seleccionadas (máximo 25) · puedes añadir 0 más')
    expect(many).toContain('quizá prefieras quitar algunas')
    // Con 25 elegidas no se puede añadir la 26.ª.
    expect(many).toMatch(/disabled=""[^>]*aria-label="Añadir la fotografía 26 al vídeo"/)
  })

  it('selector de sonido: sin sonido, cinco pistas con escucha previa y subida que exige declarar los derechos', () => {
    const view = (value = DEFAULT_AUDIO, rights = false) =>
      renderToStaticMarkup(
        <AudioPickerView value={value} onChange={noop} tracks={[]} libraryError={null} uploading={false} rights={rights} onRights={noop} message={null} playing={null} onPreset={noop} onTrack={noop} onRemove={noop} fileInput={{ current: null }} onFile={noop} previewVolume={0.7} onPreviewVolume={noop} />,
      )
    const html = view()
    expect(html).toContain('Sin sonido')
    expect(html.match(/data-preset-id=/g)).toHaveLength(5)
    expect(html.match(/aria-label="Escuchar /g)).toHaveLength(5)
    expect(html).toContain('Declaro que soy titular de esta pista')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Subir pista/)
    expect(html).toContain('Volumen de la escucha previa')
    // Sin sonido no se muestran volumen ni fundidos del vídeo.
    expect(html).not.toContain('Volumen en el vídeo')
    expect(view(DEFAULT_AUDIO, true)).not.toMatch(/<button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Subir pista/)
    const withPreset = view({ ...DEFAULT_AUDIO, source: 'preset', trackId: 'acustico-suave' })
    expect(withPreset).toContain('Volumen en el vídeo: 80 %')
    expect(withPreset).toContain('Fundido de salida')
  })
})
