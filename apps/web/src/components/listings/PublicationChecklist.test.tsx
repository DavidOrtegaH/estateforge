import { renderToStaticMarkup } from 'react-dom/server'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { MAX_OTHER_PUBLICATIONS, PUBLICATION_PLATFORMS } from '@estateforge/shared'

import { PublicationChecklistRows } from './PublicationChecklist'

import {
  buildChecklistRows,
  checklistFingerprint,
  clearRowUrl,
  editOtherField,
  editRowUrl,
  getChecklistFeedback,
  getHomeLink,
  hasInvalidDrafts,
  isUrlEditable,
  toChecklistPayload,
  toggleRow,
  type ChecklistRow,
} from '@/lib/publicationChecklist'

import { savePublicationChecklist } from '@/services/publicationService'

const VALID = 'https://www.idealista.com/inmueble/1/'
const OTHER = 'https://www.portalpropio.net/anuncio/9'

let counter = 0
const makeKey = () => `k${++counter}`
const fresh = (data: Parameters<typeof buildChecklistRows>[0] = { items: [] }) =>
  buildChecklistRows(data, makeKey)
const find = (rows: ChecklistRow[], key: string) => {
  const row = rows.find((candidate) => candidate.key === key)

  if (!row) {
    throw new Error(`sin fila ${key}`)
  }

  return row
}
const others = (rows: ChecklistRow[]) => rows.filter((row) => row.kind === 'other')
const lastOther = (rows: ChecklistRow[]) => others(rows).at(-1) as ChecklistRow

// Marca la última fila «Otro/a» como haría el usuario: casilla y enlace.
function markLastOther(rows: ChecklistRow[], url = OTHER) {
  const key = lastOther(rows).key

  return editRowUrl(toggleRow(rows, key, makeKey), key, url, makeKey)
}

const html = (rows: ChecklistRow[]) =>
  renderToStaticMarkup(
    <PublicationChecklistRows
      rows={rows}
      disabled={false}
      handlers={{ onToggle: vi.fn(), onUrl: vi.fn(), onClear: vi.fn(), onOtherField: vi.fn() }}
    />,
  )

const linkTo = (markup: string, text: string) =>
  new RegExp(`<a href="([^"]+)"[^>]*>${text}</a>`).exec(markup)?.[1]

describe('portales del catálogo', () => {
  it('1. empieza desmarcado y con el campo deshabilitado', () => {
    const row = find(fresh(), 'idealista')

    expect(row.isPublished).toBe(false)
    expect(isUrlEditable(row)).toBe(false)
  })

  it('2. la página principal está disponible sin marcar', () => {
    const markup = html(fresh())

    expect(linkTo(markup, 'Ir a Idealista')).toBe('https://www.idealista.com/')
    expect(linkTo(markup, 'Ir a Fotocasa')).toBe('https://www.fotocasa.es/')
    expect(linkTo(markup, 'Ir a Habitaclia')).toBe('https://www.habitaclia.com/')
    expect(linkTo(markup, 'Ir al anuncio')).toBeUndefined()
  })

  it('3. marcar sin enlace no activa el Check, pero habilita el campo y avisa', () => {
    const row = find(toggleRow(fresh(), 'idealista', makeKey), 'idealista')

    expect(row.isPublished).toBe(false)
    expect(row.pending).toBe(true)
    expect(isUrlEditable(row)).toBe(true)
    expect(getChecklistFeedback(row)).toMatchObject({ badge: 'Falta el enlace', tone: 'info', listingHref: null })
  })

  it('4. un enlace válido completa el Check', () => {
    let rows = toggleRow(fresh(), 'idealista', makeKey)

    rows = editRowUrl(rows, 'idealista', VALID.slice(0, 12), makeKey)
    expect(find(rows, 'idealista').isPublished).toBe(false)

    rows = editRowUrl(rows, 'idealista', VALID, makeKey)
    expect(find(rows, 'idealista')).toMatchObject({ isPublished: true, pending: false })
  })

  it('5 y 6. «Ir al anuncio» apunta al enlace concreto, distinto de la página principal', () => {
    const markup = html(editRowUrl(toggleRow(fresh(), 'idealista', makeKey), 'idealista', VALID, makeKey))

    expect(linkTo(markup, 'Ir al anuncio')).toBe(VALID)
    expect(linkTo(markup, 'Ir a Idealista')).toBe('https://www.idealista.com/')
  })

  it('«Ir al anuncio» usa la URL normalizada, no el texto escrito', () => {
    const rows = editRowUrl(toggleRow(fresh(), 'idealista', makeKey), 'idealista', `  HTTPS://WWW.IDEALISTA.COM:443/inmueble/1/ `, makeKey)

    expect(linkTo(html(rows), 'Ir al anuncio')).toBe(VALID)
  })

  it('ambos destinos se abren con protección', () => {
    const markup = html(fresh({ items: [{ platform: 'idealista', isPublished: true, url: VALID }] }))
    const anchors = markup.match(/<a [^>]+>/g) ?? []

    expect(anchors.length).toBeGreaterThan(5)
    for (const anchor of anchors) {
      expect(anchor).toContain('target="_blank"')
      expect(anchor).toContain('rel="noopener noreferrer"')
    }
  })

  const marked = () => fresh({ items: [{ platform: 'idealista', isPublished: true, url: VALID }] })

  it('7. el enlace se puede editar por otro válido', () => {
    const next = 'https://www.idealista.com/inmueble/2/'
    const rows = editRowUrl(marked(), 'idealista', next, makeKey)

    expect(find(rows, 'idealista')).toMatchObject({ isPublished: true, url: next })
  })

  it.each([
    ['dominio ajeno', 'https://otro.example/a', 'Dominio incorrecto'],
    ['otro portal', 'https://www.fotocasa.es/a', 'Dominio incorrecto'],
    ['formato', 'nada', 'Enlace no válido'],
    ['acortado', 'https://bit.ly/a', 'No verificable'],
  ])('8. un enlace incorrecto (%s) desactiva el Check', (_name, url, badge) => {
    const row = find(editRowUrl(marked(), 'idealista', url, makeKey), 'idealista')

    expect(row.isPublished).toBe(false)
    expect(isUrlEditable(row)).toBe(true)
    expect(getChecklistFeedback(row)).toMatchObject({ badge, tone: 'error', listingHref: null })
  })

  it('corregir el enlace vuelve a marcar', () => {
    let rows = editRowUrl(marked(), 'idealista', 'https://otro.example/a', makeKey)

    rows = editRowUrl(rows, 'idealista', VALID, makeKey)
    expect(find(rows, 'idealista').isPublished).toBe(true)
  })

  it('9. borrar el enlace desactiva el Check', () => {
    expect(find(editRowUrl(marked(), 'idealista', '', makeKey), 'idealista').isPublished).toBe(false)
  })

  it('10. desmarcar conserva el enlace válido y permite volver a marcar', () => {
    let rows = toggleRow(marked(), 'idealista', makeKey)

    expect(find(rows, 'idealista')).toMatchObject({ isPublished: false, url: VALID })
    expect(toChecklistPayload(rows).items[0]).toEqual({ platform: 'idealista', isPublished: false, url: VALID })

    rows = toggleRow(rows, 'idealista', makeKey)
    expect(find(rows, 'idealista').isPublished).toBe(true)
  })

  it('el usuario puede borrar un enlace conservado', () => {
    const rows = clearRowUrl(toggleRow(marked(), 'idealista', makeKey), 'idealista', makeKey)

    expect(toChecklistPayload(rows).items[0]).toEqual({ platform: 'idealista', isPublished: false, url: null })
  })

  it('una segunda pulsación cancela el intento y recupera lo guardado', () => {
    let rows = editRowUrl(marked(), 'idealista', 'mal', makeKey)

    rows = toggleRow(rows, 'idealista', makeKey)
    expect(find(rows, 'idealista')).toMatchObject({ pending: false, isPublished: false, url: VALID })
  })

  it('un borrador no válido no llega al servidor y no deja la fila marcada', () => {
    const rows = editRowUrl(marked(), 'idealista', 'https://otro.example/a', makeKey)

    expect(hasInvalidDrafts(rows)).toBe(true)
    expect(toChecklistPayload(rows).items[0]).toEqual({ platform: 'idealista', isPublished: false })
  })

  it('nunca se envía una fila marcada sin enlace', () => {
    let rows = toggleRow(fresh(), 'fotocasa', makeKey)

    rows = editRowUrl(rows, 'fotocasa', '', makeKey)
    expect(toChecklistPayload(rows).items.every((item) => !item.isPublished)).toBe(true)
  })

  it('identifica cada portal por su nombre visible, con un icono genérico y sin logotipos de marca', () => {
    const markup = html(fresh())

    expect(markup).not.toContain('<img')
    for (const { name } of PUBLICATION_PLATFORMS) {
      expect(markup).toContain(`aria-label="Publicado en ${name}"`)
      expect(markup).toContain(`>${name}<`)
    }
    // Un icono decorativo por fila (portales y «Otro/a»), oculto a los lectores de pantalla.
    expect(markup.match(/<svg[^>]*aria-hidden="true"/g)?.length).toBeGreaterThanOrEqual(PUBLICATION_PLATFORMS.length)
  })

  it('el campo sigue el estado de la casilla', () => {
    const input = (markup: string) => /<input id="publication-url-idealista"[^>]*>/.exec(markup)?.[0] ?? ''

    expect(input(html(fresh()))).toContain('disabled=""')
    expect(input(html(toggleRow(fresh(), 'idealista', makeKey)))).not.toContain('disabled=""')
  })
})

describe('filas «Otro/a»', () => {
  it('inicialmente hay una y puede quedarse sin marcar', () => {
    expect(others(fresh())).toHaveLength(1)
    expect(lastOther(fresh()).isPublished).toBe(false)
    expect(toChecklistPayload(fresh()).others).toEqual([])
  })

  it('al marcarla correctamente aparece otra sin marcar', () => {
    const rows = markLastOther(fresh())

    expect(others(rows)).toHaveLength(2)
    expect(others(rows)[0].isPublished).toBe(true)
    expect(others(rows)[1]).toMatchObject({ isPublished: false, url: '' })
  })

  it('marcar sin enlace o con enlace no válido no añade fila', () => {
    let rows = fresh()
    const key = lastOther(rows).key

    rows = toggleRow(rows, key, makeKey)
    expect(others(rows)).toHaveLength(1)
    rows = editRowUrl(rows, key, 'javascript:alert(1)', makeKey)
    expect(others(rows)).toHaveLength(1)
    expect(find(rows, key).isPublished).toBe(false)
  })

  function fiveRows() {
    let rows = fresh()

    for (let i = 1; i <= MAX_OTHER_PUBLICATIONS; i++) {
      rows = markLastOther(rows, `https://portal${i}.example/a`)
      expect(others(rows)).toHaveLength(Math.min(i + 1, MAX_OTHER_PUBLICATIONS))
    }

    return rows
  }

  it('se crean hasta cinco y nunca una sexta, con dominios distintos e independientes', () => {
    const rows = fiveRows()

    expect(others(rows)).toHaveLength(5)
    expect(others(rows).every((row) => row.isPublished)).toBe(true)
    expect(new Set(others(rows).map((row) => row.key)).size).toBe(5)
    expect(others(rows).map((row) => row.url)).toEqual([1, 2, 3, 4, 5].map((i) => `https://portal${i}.example/a`))
  })

  it('el enlace obligatorio admite un acortador porque no hay portal que comprobar', () => {
    expect(others(markLastOther(fresh(), 'https://bit.ly/abc'))[0].isPublished).toBe(true)
  })

  it('al desmarcar, la fila desaparece si hay más y las demás no cambian', () => {
    const rows = fiveRows()
    const [first, second] = others(rows)
    const after = toggleRow(rows, second.key, makeKey)

    expect(after.some((row) => row.key === second.key)).toBe(false)
    expect(others(after).filter((row) => row.isPublished)).toHaveLength(4)
    expect(find(after, first.key)).toEqual(first)
  })

  it('con cinco marcadas, quitar una no crea filas de más y vuelve a permitir añadir', () => {
    const rows = fiveRows()
    const after = toggleRow(rows, others(rows)[0].key, makeKey)

    expect(others(after)).toHaveLength(5)
    expect(lastOther(after)).toMatchObject({ isPublished: false, url: '' })
  })

  it('desmarcar con otra fila libre deja esa fila: nunca se eliminan todas', () => {
    let rows = markLastOther(fresh())
    const key = others(rows)[0].key

    rows = toggleRow(rows, key, makeKey)
    expect(others(rows)).toHaveLength(1)
    expect(lastOther(rows).key).not.toBe(key)
  })

  it('si solo queda una fila, al desmarcarla permanece con su enlace', () => {
    const only = fresh({ items: [], others: [{ instanceKey: 'solo', name: null, homeUrl: null, isPublished: false, url: OTHER }] })
    const marked = toggleRow(only, 'solo', makeKey)
    const single = marked.filter((row) => row.kind !== 'other' || row.key === 'solo')
    const kept = toggleRow(single, 'solo', makeKey)

    expect(others(kept)).toHaveLength(1)
    expect(find(kept, 'solo')).toMatchObject({ isPublished: false, url: OTHER })
  })

  it('invalidar el enlace mientras se escribe no elimina la fila', () => {
    let rows = markLastOther(fresh())
    const key = others(rows)[0].key

    rows = editRowUrl(rows, key, 'https://', makeKey)
    expect(others(rows)).toHaveLength(2)
    expect(find(rows, key)).toMatchObject({ isPublished: false, pending: true })

    rows = editRowUrl(rows, key, OTHER, makeKey)
    expect(find(rows, key).isPublished).toBe(true)
    expect(others(rows)).toHaveLength(2)
  })

  it('nombre y página principal son datos distintos del enlace y no dependen del Check', () => {
    let rows = fresh()
    const key = lastOther(rows).key

    rows = editOtherField(rows, key, 'name', 'Mi portal')
    rows = editOtherField(rows, key, 'homeUrl', 'https://miportal.example')

    const markup = html(rows)

    expect(find(rows, key).isPublished).toBe(false)
    expect(linkTo(markup, 'Ir a Mi portal')).toBe('https://miportal.example/')
    expect(getHomeLink(find(rows, key))).toEqual({ href: 'https://miportal.example/', error: null })
  })

  it('sin página principal no se inventa un destino ni se usa el del anuncio', () => {
    const rows = markLastOther(fresh())

    expect(getHomeLink(others(rows)[0])).toEqual({ href: null, error: null })
    expect(linkTo(html(rows), 'Ir a Otro/a')).toBeUndefined()
    expect(linkTo(html(rows), 'Ir al anuncio')).toBe(OTHER)
  })

  it('una página principal peligrosa no genera enlace y avisa', () => {
    const base = fresh()
    const bad = editOtherField(base, lastOther(base).key, 'homeUrl', 'javascript:alert(1)')

    expect(getHomeLink(lastOther(bad)).href).toBeNull()
    expect(getHomeLink(lastOther(bad)).error).toContain('no está permitido')
  })

  it('el envío conserva cada fila con su clave y omite las vacías', () => {
    let rows = markLastOther(fresh())

    rows = editOtherField(rows, others(rows)[0].key, 'name', 'Mi portal')

    expect(toChecklistPayload(rows).others).toEqual([
      { instanceKey: others(rows)[0].key, name: 'Mi portal', isPublished: true, url: OTHER, homeUrl: null },
    ])
  })

  it('recupera del servidor las filas guardadas', () => {
    const rows = fresh({
      items: [],
      others: [
        { instanceKey: 'a', name: 'Uno', homeUrl: 'https://uno.example/', isPublished: true, url: OTHER },
        { instanceKey: 'b', name: null, homeUrl: null, isPublished: false, url: null },
      ],
    })

    expect(others(rows).map((row) => row.key)).toEqual(['a', 'b'])
    expect(find(rows, 'a')).toMatchObject({ name: 'Uno', isPublished: true })
  })

  it('usa un icono genérico, sin logotipo de marca', () => {
    const row = html(fresh()).split('data-testid="checklist-row-other"')[1]

    expect(row).not.toContain('<img')
    expect(row).toContain('<svg')
  })
})

describe('detección de cambios sin guardar', () => {
  const saved = {
    items: [{ platform: 'idealista' as const, isPublished: true, url: VALID }],
    others: [{ instanceKey: 'a', name: 'Uno', homeUrl: null, isPublished: true, url: OTHER }],
  }
  const baseline = () => checklistFingerprint(fresh(saved))

  it('la carga no cuenta como cambio aunque se genere otra fila libre', () => {
    expect(checklistFingerprint(fresh(saved))).toBe(baseline())
  })

  it('intentar marcar sin enlace todavía no es un cambio', () => {
    expect(checklistFingerprint(toggleRow(fresh(saved), 'fotocasa', makeKey))).toBe(baseline())
  })

  it.each<[string, (rows: ChecklistRow[]) => ChecklistRow[]]>([
    ['desmarcar', (rows) => toggleRow(rows, 'idealista', makeKey)],
    ['editar el enlace', (rows) => editRowUrl(rows, 'idealista', 'https://www.idealista.com/inmueble/2/', makeKey)],
    ['un enlace no válido', (rows) => editRowUrl(rows, 'idealista', 'mal', makeKey)],
    ['borrar el enlace', (rows) => editRowUrl(rows, 'idealista', '', makeKey)],
    ['cambiar el nombre', (rows) => editOtherField(rows, 'a', 'name', 'Dos')],
    ['cambiar la página principal', (rows) => editOtherField(rows, 'a', 'homeUrl', 'https://a.example/')],
    ['quitar una fila', (rows) => toggleRow(rows, 'a', makeKey)],
  ])('%s es un cambio', (_name, change) => {
    expect(checklistFingerprint(change(fresh(saved)))).not.toBe(baseline())
  })

  it('volver al valor guardado deja de ser un cambio', () => {
    let rows = editRowUrl(fresh(saved), 'idealista', 'mal', makeKey)

    rows = editRowUrl(rows, 'idealista', VALID, makeKey)
    expect(checklistFingerprint(rows)).toBe(baseline())
  })

  it('los datos en una fila nueva son un cambio y vaciarla deja de serlo', () => {
    const rows = fresh()
    const key = lastOther(rows).key
    const empty = checklistFingerprint(rows)
    const written = editOtherField(rows, key, 'name', 'Nuevo')

    expect(checklistFingerprint(written)).not.toBe(empty)
    expect(checklistFingerprint(editOtherField(written, key, 'name', ''))).toBe(empty)
  })
})

describe('sin recursos de marca de terceros', () => {
  it('no se distribuyen logotipos de portales', () => {
    expect(existsSync(resolve(import.meta.dirname, '../../../public/portales'))).toBe(false)
  })
})

it('no ofrece ninguna acción de publicar', () => {
  expect(html(fresh())).not.toMatch(/>\s*(Re)?publicar|sincronizar/i)
})

describe('savePublicationChecklist', () => {
  it('un conflicto muestra el mensaje general del servidor', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Recarga la ficha.' }), { status: 409 })))

    await expect(savePublicationChecklist('gen', { items: [] })).rejects.toThrow('Recarga la ficha.')

    vi.unstubAllGlobals()
  })

  it('muestra el motivo devuelto por el servidor', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ errors: [{ message: 'Este enlace no pertenece a Idealista.' }] }), { status: 400 }),
    )

    vi.stubGlobal('fetch', fetchMock)

    await expect(
      savePublicationChecklist('gen', { items: [{ platform: 'idealista', isPublished: false }] }),
    ).rejects.toThrow('Este enlace no pertenece a Idealista.')

    expect(fetchMock.mock.calls[0][0]).toContain('/api/generations/gen/publications')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'PUT', credentials: 'include' })

    vi.unstubAllGlobals()
  })
})
