import { useEffect, useRef, useState } from 'react'
import { getProviderLabel, listingLanguageOf } from '@estateforge/shared'
import { API_URL } from '@/lib/api'
import { prepareListingMedia, type PreparedLanguageChange } from '@/lib/regenerateListingMedia'
import { cancelUpload } from '@/services/mediaService'
import { ConfirmDialog } from '@/components/media/ConfirmDialog'

type Listing = { id: string; language: string; provider: string; updatedAt?: string }

export function ListingLanguageEditor({ generation }: { generation: Listing }) {
  const currentLanguage = listingLanguageOf(generation.language)
  const language = currentLanguage === 'english' ? 'español' : 'english'
  const targetLabel = language === 'english' ? 'Inglés' : 'Español'
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const running = useRef(false)
  const active = useRef(true)
  const committed = useRef(false)
  const controller = useRef<AbortController | null>(null)
  const prepared = useRef<PreparedLanguageChange | null>(null)
  const readyUploads = useRef<string[] | null>(null)
  const commitStarted = useRef(false)
  const path = `${API_URL}/api/generations/${generation.id}/language`
  useEffect(() => {
    active.current = true
    const abandon = () => {
      active.current = false
      controller.current?.abort()
      if (prepared.current && !committed.current) {
        void fetch(`${path}/${prepared.current.draftId}`, { method: 'DELETE', credentials: 'include', keepalive: true }).catch(() => undefined)
      }
    }
    window.addEventListener('pagehide', abandon)
    return () => { window.removeEventListener('pagehide', abandon); abandon() }
  }, [path])

  async function save() {
    if (running.current) return
    running.current = true; setBusy(true); setConfirming(false); setMessage(null)
    const operation = new AbortController()
    controller.current = operation
    let rejected = false
    try {
      if (!prepared.current) {
        if (!generation.updatedAt) throw new Error('Recarga la página antes de cambiar el idioma.')
        const response = await fetch(path, { method: 'POST', credentials: 'include', signal: operation.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language, confirmed: true, expectedUpdatedAt: generation.updatedAt, stageOnly: true }) })
        const data = await response.json()
        if (!response.ok) throw new Error(data.message ?? 'No se pudo preparar el cambio de idioma.')
        prepared.current = data as PreparedLanguageChange
      }
      operation.signal.throwIfAborted()
      const draft = prepared.current
      const uploadIds = readyUploads.current ?? await prepareListingMedia(generation.id, draft, operation.signal, text => { if (active.current) setMessage(text) })
      readyUploads.current = uploadIds
      operation.signal.throwIfAborted()
      if (!active.current) return
      setMessage('Guardando el anuncio y todos sus archivos…')
      commitStarted.current = true
      const response = await fetch(`${path}/${draft.draftId}/complete`, { method: 'POST', credentials: 'include', signal: operation.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uploadIds }) })
      const data = await response.json()
      if (!response.ok) { rejected = true; throw new Error(data.message ?? 'No se pudo guardar el cambio completo.') }
      committed.current = true
      readyUploads.current = null
      prepared.current = null
      if (active.current) {
        setBusy(false)
        // There is no beforeunload handler: successful completion reloads without an exit prompt.
        window.location.replace(`/historial/${generation.id}`)
      }
    } catch (error) {
      if (rejected) {
        await Promise.allSettled((readyUploads.current ?? []).map(id => cancelUpload(id)))
        readyUploads.current = null
        commitStarted.current = false
      }
      if (active.current) {
        if (commitStarted.current) setMessage('No se ha podido confirmar el resultado del guardado. Reintenta la confirmación o recarga el anuncio para comprobarlo.')
        else setMessage(operation.signal.aborted ? 'Cambio cancelado. El anuncio y sus archivos siguen como estaban.' : `${error instanceof Error ? error.message : 'No se pudo completar el cambio.'} El anuncio y sus archivos siguen como estaban.`)
      }
    } finally {
      running.current = false
      if (active.current) setBusy(false)
    }
  }

  async function cancel() {
    controller.current?.abort()
    const draft = prepared.current
    prepared.current = null
    readyUploads.current = null
    if (draft) {
      try {
        const response = await fetch(`${path}/${draft.draftId}`, { method: 'DELETE', credentials: 'include' })
        if (response.status === 409) {
          committed.current = true
          if (active.current) window.location.replace(`/historial/${generation.id}`)
          return
        }
        if (!response.ok) throw new Error('Cancelación no confirmada')
      } catch {
        if (active.current) setMessage('No se ha podido confirmar la cancelación. Recarga el anuncio para comprobar su estado.')
        return
      }
    }
    commitStarted.current = false
    if (active.current) setMessage('Cambio cancelado. El anuncio y sus archivos siguen como estaban.')
  }

  return <section className="my-4 rounded-lg border p-4" aria-label="Idioma del anuncio">
    <p className="text-sm text-muted-foreground">Idioma actual: {currentLanguage === 'english' ? 'Inglés' : 'Español'}</p>
    <label htmlFor={`listing-language-${generation.id}`} className="text-sm font-medium">Cambiar idioma a</label>
    <div className="mt-2 flex flex-wrap items-center gap-3">
      <select id={`listing-language-${generation.id}`} value={language} onChange={() => undefined} disabled={busy} className="rounded-md border bg-background px-3 py-2 text-sm">
        <option value={language}>{targetLabel}</option>
      </select>
      <button type="button" disabled={busy} onClick={() => prepared.current ? void save() : setConfirming(true)} className="rounded-md border px-3 py-2 text-sm disabled:opacity-50">{busy ? 'Rehaciendo anuncio…' : prepared.current ? 'Reintentar preparación' : 'Cambiar idioma y rehacer'}</button>
      {(busy || prepared.current) && <button type="button" onClick={() => void cancel()} className="rounded-md border px-3 py-2 text-sm">Cancelar cambio</button>}
    </div>
    <p className="mt-2 text-xs text-muted-foreground">El anuncio y sus archivos se sustituyen juntos al terminar. Si sales durante la preparación, se cancela el cambio y se conserva el original. Al finalizar se abrirá el anuncio actualizado automáticamente.</p>
    {message && <p role="status" className="mt-2 text-sm">{message}</p>}
    {confirming && <ConfirmDialog id={`language-confirm-${generation.id}`} confirmLabel="Confirmar y rehacer" destructive title={`¿Rehacer el anuncio en ${targetLabel.toLowerCase()}?`} description={`Se sustituirán título, descripción, características y llamada a la acción. Se perderán las ediciones manuales y se reharán el cartel y el vídeo existentes. Los materiales con IA se sustituirán por versiones clásicas sin IA. La plantilla local no traduce las observaciones ni las letras incrustadas en fotos. El texto usará ${getProviderLabel(generation.provider)}.${generation.provider !== 'mock' ? ' Una operación con tu API key y preferencias actuales: coste no verificable, facturado por tu proveedor aunque canceles después de generar el texto. Al confirmar aceptas ese consumo.' : ' Sin llamadas a IA ni coste de proveedor.'} Nada se sustituye hasta que todo esté listo; si abandonas la preparación, se mantiene el anuncio original. ¿Confirmas el cambio?`} onConfirm={() => void save()} onCancel={() => setConfirming(false)} />}
  </section>
}
