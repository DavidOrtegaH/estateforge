import { useEffect, useRef, useState } from 'react'
import { getProviderLabel, listingLanguageOf, type ListingLanguage } from '@estateforge/shared'
import { API_URL } from '@/lib/api'
import { regenerateListingMedia } from '@/lib/regenerateListingMedia'
import { ConfirmDialog } from '@/components/media/ConfirmDialog'

type Listing = { id: string; language: string; provider: string; updatedAt?: string }

export function ListingLanguageEditor({ generation }: { generation: Listing }) {
  const [language, setLanguage] = useState<ListingLanguage>(listingLanguageOf(generation.language))
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [pending, setPending] = useState<string[] | null>(null)
  const running = useRef(false)
  useEffect(() => {
    if (!busy) return
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', prevent)
    return () => window.removeEventListener('beforeunload', prevent)
  }, [busy])
  async function save() {
    if (running.current) return
    running.current = true; setBusy(true); setConfirming(false); setMessage(null)
    try {
      let kinds = pending
      if (kinds === null) {
        // La versión abierta se compara bajo bloqueo: una pestaña antigua no puede
        // sobrescribir ediciones posteriores de otra pestaña.
        const expectedUpdatedAt = generation.updatedAt
        if (!expectedUpdatedAt) throw new Error('Recarga la página antes de cambiar el idioma.')
        const response = await fetch(`${API_URL}/api/generations/${generation.id}/language`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language, confirmed: true, expectedUpdatedAt }) })
        const data = await response.json()
        if (!response.ok) throw new Error(data.message ?? 'No se pudo cambiar el idioma.')
        kinds = data.mediaKinds as string[]
        setPending(kinds)
      }
      const details: string[] = []
      const failures = await regenerateListingMedia(generation.id, kinds, text => { if (text.includes('pendiente:')) details.push(text); setMessage(text) })
      setPending(failures)
      if (failures.length) setMessage(`El texto ya está en el idioma elegido. ${details.join(' ')} Reintenta sin volver a generar ni facturar el texto, o abre el anuncio para revisar sus opciones.`)
      else window.location.assign(`/historial/${generation.id}`)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo completar el cambio de idioma.') }
    finally { running.current = false; setBusy(false) }
  }
  return <section className="my-4 rounded-lg border p-4" aria-label="Idioma del anuncio">
    <label htmlFor={`listing-language-${generation.id}`} className="text-sm font-medium">Idioma del anuncio</label>
    <div className="mt-2 flex flex-wrap items-center gap-3">
      <select id={`listing-language-${generation.id}`} value={language} disabled={busy || pending !== null} onChange={event => setLanguage(event.target.value as ListingLanguage)} className="rounded-md border bg-background px-3 py-2 text-sm">
        <option value="español">Español</option><option value="english">Inglés</option>
      </select>
      <button type="button" disabled={busy} onClick={() => pending !== null ? void save() : setConfirming(true)} className="rounded-md border px-3 py-2 text-sm disabled:opacity-50">{busy ? 'Rehaciendo anuncio…' : pending !== null ? 'Reintentar material pendiente' : 'Cambiar idioma y rehacer'}</button>
      {pending !== null && !busy && <a href={`/historial/${generation.id}`} className="text-sm underline">Abrir anuncio y revisar material</a>}
    </div>
    <p className="mt-2 text-xs text-muted-foreground">Sustituye los textos y rehace el cartel y el vídeo existentes. También permite corregir anuncios antiguos que tengan el idioma indicado incorrectamente. No traduce letras incrustadas en las fotografías.</p>
    {message && <p role="status" className="mt-2 text-sm">{message}</p>}
    {confirming && <ConfirmDialog id={`language-confirm-${generation.id}`} confirmLabel="Confirmar y rehacer" destructive title="¿Rehacer el anuncio en otro idioma?" description={`Se sustituirán título, descripción, características y llamada a la acción por textos en ${language === 'english' ? 'inglés' : 'español'}. Se perderán las ediciones manuales; las observaciones no se traducen automáticamente con la plantilla local. Se reharán el cartel y el vídeo que ya existan, sin el pie de EstateForge. Los materiales con IA se sustituirán por versiones clásicas sin IA; podrás generar otros con IA después. El texto usará ${getProviderLabel(generation.provider)}.${generation.provider !== 'mock' ? ' Una operación de texto con tu API key y preferencias actuales: coste no verificable, facturado por tu proveedor. Al confirmar aceptas ese consumo.' : ' Sin llamadas a IA ni coste de proveedor.'} Mantén la pestaña abierta hasta terminar. ¿Confirmas la sustitución?`} onConfirm={() => void save()} onCancel={() => setConfirming(false)} />}
  </section>
}
