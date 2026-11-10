import {
  MAX_OTHER_PUBLICATIONS,
  OTHER_PLATFORM_LABEL,
  PUBLICATION_PLATFORMS,
  validateOtherUrl,
  validatePublicationUrl,
  type PublicationChecklistUpdate,
  type PublicationPlatformId,
  type PublicationUrlResult,
} from '@estateforge/shared'

// Lógica del Checklist, separada del componente para poder probarla sola.
//
// `isPublished` solo es true con un enlace válido. `pending` significa que el
// usuario quiere marcar la fila (o ha invalidado su enlace) y el enlace todavía
// no es válido: el campo sigue editable y la fila se marca al corregirlo.

interface BaseRow {
  key: string
  url: string
  savedUrl: string
  isPublished: boolean
  pending: boolean
}

export interface PortalRow extends BaseRow {
  kind: 'portal'
  platform: PublicationPlatformId
  name: string
  logo: string
  logoPx: number
  homeUrl: string
}

export interface OtherRow extends BaseRow {
  kind: 'other'
  name: string
  homeUrl: string
}

export type ChecklistRow = PortalRow | OtherRow

export type ChecklistTone =
  | 'neutral'
  | 'info'
  | 'success'
  | 'error'

export interface ChecklistFeedback {
  badge: string
  tone: ChecklistTone
  message: string | null
  /** Enlace al anuncio: solo un valor normalizado y con la fila marcada. */
  listingHref: string | null
}

export interface ChecklistData {
  items: ReadonlyArray<{
    platform: PublicationPlatformId
    isPublished: boolean
    url: string | null
  }>
  others?: ReadonlyArray<{
    instanceKey: string
    name: string | null
    homeUrl: string | null
    isPublished: boolean
    url: string | null
  }>
}

export type MakeKey = () => string

export const makeInstanceKey: MakeKey = () =>
  `other-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

function validateRowUrl(
  row: ChecklistRow,
): PublicationUrlResult {
  return row.kind === 'portal'
    ? validatePublicationUrl(
        row.platform,
        row.url,
      )
    : validateOtherUrl(row.url)
}

const blankOther = (
  makeKey: MakeKey,
): OtherRow => ({
  kind: 'other',
  key: makeKey(),
  name: '',
  homeUrl: '',
  url: '',
  savedUrl: '',
  isPublished: false,
  pending: false,
})

/** Siempre al menos una fila «Otro/a», y una libre si todas están marcadas (máximo cinco). */
function ensureOtherRows(
  rows: ChecklistRow[],
  makeKey: MakeKey,
): ChecklistRow[] {
  const others = rows.filter(
    (row) => row.kind === 'other',
  )

  const needsRow =
    others.length === 0 ||
    (others.length < MAX_OTHER_PUBLICATIONS &&
      others.every((row) => row.isPublished))

  return needsRow
    ? [...rows, blankOther(makeKey)]
    : rows
}

export function buildChecklistRows(
  data: ChecklistData,
  makeKey: MakeKey = makeInstanceKey,
): ChecklistRow[] {
  const portals: ChecklistRow[] =
    PUBLICATION_PLATFORMS.map((platform) => {
      const item = data.items.find(
        (candidate) =>
          candidate.platform === platform.id,
      )

      return {
        kind: 'portal',
        key: platform.id,
        platform: platform.id,
        name: platform.name,
        logo: platform.logo,
        logoPx: platform.logoPx,
        homeUrl: platform.homeUrl,
        url: item?.url ?? '',
        savedUrl: item?.url ?? '',
        isPublished:
          item?.isPublished ?? false,
        pending: false,
      }
    })

  const others: ChecklistRow[] = (
    data.others ?? []
  ).map((other) => ({
    kind: 'other',
    key: other.instanceKey,
    name: other.name ?? '',
    homeUrl: other.homeUrl ?? '',
    url: other.url ?? '',
    savedUrl: other.url ?? '',
    isPublished: other.isPublished,
    pending: false,
  }))

  return ensureOtherRows(
    [...portals, ...others],
    makeKey,
  )
}

function updateRow(
  rows: readonly ChecklistRow[],
  key: string,
  change: (row: ChecklistRow) => ChecklistRow,
  makeKey: MakeKey,
): ChecklistRow[] {
  return ensureOtherRows(
    rows.map((row) =>
      row.key === key ? change(row) : row,
    ),
    makeKey,
  )
}

/** Pulsación del usuario en la casilla. */
export function toggleRow(
  rows: readonly ChecklistRow[],
  key: string,
  makeKey: MakeKey = makeInstanceKey,
): ChecklistRow[] {
  const target = rows.find(
    (row) => row.key === key,
  )

  if (!target) {
    return [...rows]
  }

  // Desmarcar de forma expresa una fila «Otro/a» la quita si no es la única.
  if (
    target.isPublished &&
    target.kind === 'other' &&
    rows.filter((row) => row.kind === 'other')
      .length > 1
  ) {
    return ensureOtherRows(
      rows.filter((row) => row.key !== key),
      makeKey,
    )
  }

  return updateRow(
    rows,
    key,
    (row) => {
      if (row.isPublished) {
        return { ...row, isPublished: false, pending: false }
      }

      // Segunda pulsación sin enlace válido: se cancela el intento.
      if (row.pending) {
        return { ...row, pending: false, url: row.savedUrl }
      }

      return validateRowUrl(row).status === 'valid'
        ? { ...row, isPublished: true }
        : { ...row, pending: true }
    },
    makeKey,
  )
}

/** Edición del enlace: el Check sigue siempre a la validez del enlace. */
export function editRowUrl(
  rows: readonly ChecklistRow[],
  key: string,
  url: string,
  makeKey: MakeKey = makeInstanceKey,
): ChecklistRow[] {
  return updateRow(
    rows,
    key,
    (row) => {
      const next = { ...row, url }
      const valid =
        validateRowUrl(next).status === 'valid'

      if (row.isPublished && !valid) {
        return { ...next, isPublished: false, pending: true }
      }

      if (row.pending && valid) {
        return { ...next, isPublished: true, pending: false }
      }

      return next
    },
    makeKey,
  )
}

/** Borra el enlace conservado de una fila sin marcar. */
export function clearRowUrl(
  rows: readonly ChecklistRow[],
  key: string,
  makeKey: MakeKey = makeInstanceKey,
): ChecklistRow[] {
  return updateRow(
    rows,
    key,
    (row) => ({
      ...row,
      url: '',
      isPublished: false,
      pending: false,
    }),
    makeKey,
  )
}

export function editOtherField(
  rows: readonly ChecklistRow[],
  key: string,
  field: 'name' | 'homeUrl',
  value: string,
): ChecklistRow[] {
  return rows.map((row) =>
    row.key === key && row.kind === 'other'
      ? { ...row, [field]: value }
      : row,
  )
}

export const isUrlEditable = (
  row: ChecklistRow,
): boolean => row.isPublished || row.pending

export function getRowDisplayName(
  row: ChecklistRow,
): string {
  return (
    row.name.trim() || OTHER_PLATFORM_LABEL
  )
}

export function getChecklistFeedback(
  row: ChecklistRow,
): ChecklistFeedback {
  const result = validateRowUrl(row)

  if (row.isPublished && result.status === 'valid') {
    return {
      badge:
        row.kind === 'portal'
          ? 'Dominio correcto'
          : 'Formato correcto',
      tone: 'success',
      message: result.message,
      listingHref:
        result.normalizedUrl ?? null,
    }
  }

  if (!row.pending) {
    return {
      badge: 'Sin marcar',
      tone: 'neutral',
      message: row.url.trim()
        ? 'Esta plataforma no está marcada como publicada. El enlace se conserva por si vuelves a marcarla.'
        : null,
      listingHref: null,
    }
  }

  const base = { listingHref: null }

  switch (result.status) {
    case 'empty':
      return {
        ...base,
        badge: 'Falta el enlace',
        tone: 'info',
        message:
          'Introduce el enlace de la publicación para completar el Check.',
      }
    case 'unverifiable':
      return {
        ...base,
        badge: 'No verificable',
        tone: 'error',
        message: result.message,
      }
    case 'wrong-domain':
      return {
        ...base,
        badge: 'Dominio incorrecto',
        tone: 'error',
        message: result.message,
      }
    default:
      return {
        ...base,
        badge: 'Enlace no válido',
        tone: 'error',
        message: result.message,
      }
  }
}

export interface HomeLink {
  href: string | null
  error: string | null
}

/** Página principal: nunca se deduce del enlace del anuncio. */
export function getHomeLink(
  row: ChecklistRow,
): HomeLink {
  if (row.kind === 'portal') {
    return { href: row.homeUrl, error: null }
  }

  const result = validateOtherUrl(row.homeUrl)

  if (result.status === 'valid') {
    return {
      href: result.normalizedUrl ?? null,
      error: null,
    }
  }

  return {
    href: null,
    error:
      result.status === 'empty'
        ? null
        : result.message,
  }
}

// undefined conserva lo guardado: un borrador no válido no sustituye a nada.
function urlForSave(
  raw: string,
  result: PublicationUrlResult,
): string | null | undefined {
  if (raw.trim() === '') {
    return null
  }

  return result.status === 'valid'
    ? result.normalizedUrl
    : undefined
}

/**
 * Representación de los datos que escribe el usuario, para detectar cambios sin
 * guardar. Ignora las filas «Otro/a» vacías y el intento de marcar sin enlace,
 * que todavía no es ningún dato.
 */
export function checklistFingerprint(
  rows: readonly ChecklistRow[],
): string {
  return JSON.stringify(
    rows
      .filter(
        (row) =>
          row.kind === 'portal' ||
          row.isPublished ||
          row.url.trim() ||
          row.name.trim() ||
          row.homeUrl.trim(),
      )
      .map((row) => [
        row.key,
        row.isPublished,
        row.url.trim(),
        row.name.trim(),
        row.homeUrl.trim(),
      ]),
  )
}

/** Hay texto no válido que no llegará al servidor. */
export function hasInvalidDrafts(
  rows: readonly ChecklistRow[],
): boolean {
  return rows.some((row) => {
    const status = validateRowUrl(row).status

    return (
      (status !== 'valid' && status !== 'empty') ||
      getHomeLink(row).error !== null
    )
  })
}

export function toChecklistPayload(
  rows: readonly ChecklistRow[],
): PublicationChecklistUpdate {
  const items: PublicationChecklistUpdate['items'] = []
  const others: NonNullable<
    PublicationChecklistUpdate['others']
  > = []

  for (const row of rows) {
    const url = urlForSave(
      row.url,
      validateRowUrl(row),
    )

    if (row.kind === 'portal') {
      items.push({
        platform: row.platform,
        isPublished: row.isPublished,
        ...(url !== undefined && { url }),
      })
      continue
    }

    const home = validateOtherUrl(row.homeUrl)
    const homeUrl = urlForSave(
      row.homeUrl,
      home,
    )

    // Una fila sin ningún dato no se guarda.
    if (
      !row.isPublished &&
      !row.name.trim() &&
      !row.savedUrl &&
      !url &&
      !homeUrl &&
      homeUrl !== undefined
    ) {
      continue
    }

    others.push({
      instanceKey: row.key,
      name: row.name.trim() || null,
      isPublished: row.isPublished,
      ...(url !== undefined && { url }),
      ...(homeUrl !== undefined && { homeUrl }),
    })
  }

  return { items, others }
}
