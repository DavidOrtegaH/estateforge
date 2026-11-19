import { useEffect, useState } from 'react'
import { useBlocker } from 'react-router'
import { portalIconFor } from '@/lib/portalIcons'
import { PortalIcon } from './PortalIcon'

import {
  OTHER_NAME_MAX_LENGTH,
  OTHER_PLATFORM_LABEL,
} from '@estateforge/shared'

import {
  buildChecklistRows,
  checklistFingerprint,
  clearRowUrl,
  editOtherField,
  editRowUrl,
  getChecklistFeedback,
  getHomeLink,
  getRowDisplayName,
  hasInvalidDrafts,
  isUrlEditable,
  toChecklistPayload,
  toggleRow,
  type ChecklistRow,
  type ChecklistTone,
} from '@/lib/publicationChecklist'

import {
  getPublicationChecklist,
  savePublicationChecklist,
} from '@/services/publicationService'

import { useModalDialog } from '@/hooks/useModalDialog'

import {
  clearPendingChanges,
  publishPendingChanges,
  shouldBlockNavigation,
} from '@/lib/unsavedChanges'

const badgeClasses: Record<
  ChecklistTone,
  string
> = {
  neutral: 'bg-muted/70 text-muted-foreground',
  info: 'border-primary/30 bg-primary/10 text-primary',
  success:
    'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  error:
    'border-destructive/30 bg-destructive/10 text-destructive',
}

const inputClass =
  'mt-1 w-full min-w-0 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50'

const linkClass =
  'text-sm font-medium text-primary hover:underline'

export interface ChecklistRowHandlers {
  onToggle: (key: string) => void
  onUrl: (key: string, value: string) => void
  onClear: (key: string) => void
  onOtherField: (
    key: string,
    field: 'name' | 'homeUrl',
    value: string,
  ) => void
}

function ExternalLink({
  href,
  children,
}: {
  href: string
  children: string
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={linkClass}
    >
      {children}
    </a>
  )
}

function ChecklistRowItem({
  row,
  disabled,
  handlers,
}: {
  row: ChecklistRow
  disabled: boolean
  handlers: ChecklistRowHandlers
}) {
  const feedback = getChecklistFeedback(row)
  const home = getHomeLink(row)
  const displayName = getRowDisplayName(row)
  const editable = isUrlEditable(row)
  const urlId = `publication-url-${row.key}`
  const messageId = `${urlId}-message`
  const homeErrorId = `publication-home-${row.key}-error`

  return (
    <li
      className="p-4"
      data-testid={`checklist-row-${row.kind}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <label className="flex min-w-0 cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={row.isPublished}
            onChange={() =>
              handlers.onToggle(row.key)
            }
            disabled={disabled}
            aria-label={`Publicado en ${displayName}`}
            className="h-4 w-4 shrink-0"
          />

          {/* Icono del portal si hay un recurso local con procedencia documentada (lib/portalIcons.ts);
              si no, o si no carga, el genérico. «Otro/a» usa siempre el genérico. Decorativo: el nombre
              visible identifica la fila. */}
          <PortalIcon
            icon={portalIconFor(row.kind === 'portal' ? row.platform : null)}
          />

          <span className="break-words text-sm font-medium">
            {row.kind === 'portal'
              ? row.name
              : OTHER_PLATFORM_LABEL}
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {home.href && (
            <ExternalLink href={home.href}>
              {`Ir a ${displayName}`}
            </ExternalLink>
          )}

          {feedback.listingHref && (
            <ExternalLink
              href={feedback.listingHref}
            >
              Ir al anuncio
            </ExternalLink>
          )}

          <span
            className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${badgeClasses[feedback.tone]}`}
          >
            {feedback.badge}
          </span>
        </div>
      </div>

      {row.kind === 'other' && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="min-w-0">
            <label
              htmlFor={`publication-name-${row.key}`}
              className="text-xs font-medium text-muted-foreground"
            >
              Nombre de la plataforma
            </label>

            <input
              id={`publication-name-${row.key}`}
              type="text"
              maxLength={OTHER_NAME_MAX_LENGTH}
              value={row.name}
              onChange={(event) =>
                handlers.onOtherField(
                  row.key,
                  'name',
                  event.target.value,
                )
              }
              disabled={disabled}
              className={inputClass}
            />
          </div>

          <div className="min-w-0">
            <label
              htmlFor={`publication-home-${row.key}`}
              className="text-xs font-medium text-muted-foreground"
            >
              Página principal (opcional)
            </label>

            <input
              id={`publication-home-${row.key}`}
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://"
              value={row.homeUrl}
              onChange={(event) =>
                handlers.onOtherField(
                  row.key,
                  'homeUrl',
                  event.target.value,
                )
              }
              disabled={disabled}
              aria-invalid={home.error !== null}
              aria-describedby={
                home.error
                  ? homeErrorId
                  : undefined
              }
              className={inputClass}
            />

            {home.error && (
              <p
                id={homeErrorId}
                className="mt-1 break-words text-xs text-destructive"
              >
                {home.error}
              </p>
            )}
          </div>
        </div>
      )}

      <div className="mt-3">
        <label
          htmlFor={urlId}
          className="text-xs font-medium text-muted-foreground"
        >
          Enlace de la publicación en{' '}
          {displayName}
        </label>

        <input
          id={urlId}
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={row.url}
          onChange={(event) =>
            handlers.onUrl(
              row.key,
              event.target.value,
            )
          }
          disabled={disabled || !editable}
          aria-describedby={
            feedback.message
              ? messageId
              : undefined
          }
          aria-invalid={
            feedback.tone === 'error'
          }
          placeholder="https://"
          className={inputClass}
        />
      </div>

      {feedback.message && (
        <p
          id={messageId}
          className={`mt-2 break-words text-xs ${
            feedback.tone === 'error'
              ? 'text-destructive'
              : 'text-muted-foreground'
          }`}
        >
          {feedback.message}
        </p>
      )}

      {!editable && row.url.trim() && (
        <button
          type="button"
          onClick={() =>
            handlers.onClear(row.key)
          }
          disabled={disabled}
          className="mt-2 text-xs font-medium text-destructive hover:underline disabled:opacity-50"
        >
          Borrar enlace
        </button>
      )}
    </li>
  )
}

export function PublicationChecklistRows({
  rows,
  disabled,
  handlers,
}: {
  rows: readonly ChecklistRow[]
  disabled: boolean
  handlers: ChecklistRowHandlers
}) {
  return (
    <ul className="mt-5 divide-y rounded-md border">
      {rows.map((row) => (
        <ChecklistRowItem
          key={row.key}
          row={row}
          disabled={disabled}
          handlers={handlers}
        />
      ))}
    </ul>
  )
}

function UnsavedChangesDialog({
  onStay,
  onLeave,
}: {
  onStay: () => void
  onLeave: () => void
}) {
  const dialogRef = useModalDialog<HTMLElement>({
    open: true,
    onClose: onStay,
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40"
        aria-hidden="true"
      />

      <section
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="checklist-unsaved-title"
        aria-describedby="checklist-unsaved-description"
        className="relative z-10 w-full max-w-md rounded-xl border bg-card p-6 shadow-xl"
      >
        <h2
          id="checklist-unsaved-title"
          className="text-lg font-semibold"
        >
          Cambios sin guardar
        </h2>

        <p
          id="checklist-unsaved-description"
          className="mt-2 text-sm text-muted-foreground"
        >
          Si sales de esta ficha, perderás los
          cambios del Checklist que no has
          guardado.
        </p>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onLeave}
            className="rounded-md border border-destructive/50 px-4 py-2 text-sm font-medium text-destructive transition hover:bg-destructive/10"
          >
            Salir sin guardar
          </button>

          <button
            type="button"
            onClick={onStay}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
          >
            Seguir editando
          </button>
        </div>
      </section>
    </div>
  )
}

export function PublicationChecklist({
  generationId,
  guardDisabled = false,
}: {
  generationId: string
  /** El anuncio se está eliminando: no hay cambios que proteger. */
  guardDisabled?: boolean
}) {
  const [rows, setRows] = useState<
    ChecklistRow[] | null
  >(null)

  const [loadError, setLoadError] =
    useState<string | null>(null)

  const [saving, setSaving] = useState(false)

  const [saveError, setSaveError] =
    useState<string | null>(null)

  const [saveNotice, setSaveNotice] =
    useState<string | null>(null)

  // Lo último confirmado por el servidor: la carga inicial nunca cuenta como cambio.
  const [savedFingerprint, setSavedFingerprint] =
    useState<string | null>(null)

  const hasUnsavedChanges =
    rows !== null &&
    checklistFingerprint(rows) !==
      savedFingerprint

  const protectChanges =
    hasUnsavedChanges && !guardDisabled

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      shouldBlockNavigation(
        protectChanges,
        currentLocation.pathname,
        nextLocation.pathname,
      ),
  )

  useEffect(() => {
    publishPendingChanges({
      dirty: protectChanges,
      saving,
    })
  }, [protectChanges, saving])

  useEffect(() => clearPendingChanges, [])

  useEffect(() => {
    if (!protectChanges) {
      return
    }

    function warnBeforeUnload(
      event: BeforeUnloadEvent,
    ) {
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener(
      'beforeunload',
      warnBeforeUnload,
    )

    return () =>
      window.removeEventListener(
        'beforeunload',
        warnBeforeUnload,
      )
  }, [protectChanges])

  function applyServerChecklist(
    checklist: Parameters<
      typeof buildChecklistRows
    >[0],
  ) {
    const next = buildChecklistRows(checklist)

    setRows(next)
    setSavedFingerprint(
      checklistFingerprint(next),
    )
  }

  useEffect(() => {
    let cancelled = false

    getPublicationChecklist(generationId)
      .then((checklist) => {
        if (!cancelled) {
          applyServerChecklist(checklist)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError(
            'No se ha podido cargar el Checklist.',
          )
        }
      })

    return () => {
      cancelled = true
    }
  }, [generationId])

  function change(
    update: (
      current: ChecklistRow[],
    ) => ChecklistRow[],
  ) {
    setSaveNotice(null)
    setSaveError(null)
    setRows((current) =>
      current ? update(current) : current,
    )
  }

  const handlers: ChecklistRowHandlers = {
    onToggle: (key) =>
      change((current) =>
        toggleRow(current, key),
      ),
    onUrl: (key, value) =>
      change((current) =>
        editRowUrl(current, key, value),
      ),
    onClear: (key) =>
      change((current) =>
        clearRowUrl(current, key),
      ),
    onOtherField: (key, field, value) =>
      change((current) =>
        editOtherField(
          current,
          key,
          field,
          value,
        ),
      ),
  }

  async function handleSave() {
    if (!rows || saving) {
      return
    }

    setSaving(true)
    setSaveNotice(null)
    setSaveError(null)

    try {
      const hadDrafts = hasInvalidDrafts(rows)

      const checklist =
        await savePublicationChecklist(
          generationId,
          toChecklistPayload(rows),
        )

      applyServerChecklist(checklist)
      setSaveNotice(
        hadDrafts
          ? 'Checklist guardado. Los enlaces no válidos no se han guardado y esas plataformas quedan sin marcar.'
          : 'Checklist guardado.',
      )
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : 'No se ha podido guardar el Checklist. Inténtalo de nuevo.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="mt-6 rounded-lg border bg-card p-6">
      <h2 className="text-xl font-semibold">
        Checklist
      </h2>

      <p className="mt-1 text-sm text-muted-foreground">
        Publica el anuncio desde cada portal,
        márcalo aquí y guarda su enlace.
        EstateForge no publica en los portales.
      </p>

      {loadError ? (
        <p className="mt-4 text-sm text-destructive">
          {loadError}
        </p>
      ) : !rows ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Cargando Checklist...
        </p>
      ) : (
        <>
          <PublicationChecklistRows
            rows={rows}
            disabled={saving}
            handlers={handlers}
          />

          {saveError && (
            <p className="mt-4 text-sm text-destructive">
              {saveError}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
            {hasUnsavedChanges && (
              <p
                role="status"
                data-testid="checklist-dirty"
                className="text-sm font-medium text-amber-700 dark:text-amber-400"
              >
                Cambios sin guardar
              </p>
            )}

            {saveNotice && (
              <p
                role="status"
                className="text-sm text-muted-foreground"
              >
                {saveNotice}
              </p>
            )}

            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={
                saving || !hasUnsavedChanges
              }
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving
                ? 'Guardando...'
                : 'Guardar Checklist'}
            </button>
          </div>
        </>
      )}

      {blocker.state === 'blocked' && (
        <UnsavedChangesDialog
          onStay={() => blocker.reset()}
          onLeave={() => blocker.proceed()}
        />
      )}
    </section>
  )
}
