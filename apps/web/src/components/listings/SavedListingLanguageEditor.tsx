import { useEffect, useState } from 'react'
import { getGeneration, type GenerationItem } from '@/services/generationService'
import { ListingLanguageEditor } from './ListingLanguageEditor'

/** The newly-created listing editor needs the saved version, not the generation form's selectors. */
export function SavedListingLanguageEditor({ generationId }: { generationId: string }) {
  const [generation, setGeneration] = useState<GenerationItem | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let active = true
    setGeneration(null)
    setError(false)
    void getGeneration(generationId).then(data => { if (active) setGeneration(data) }).catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [generationId])
  if (error) return <p role="alert" className="text-sm text-destructive">No se pudo cargar el idioma guardado. Vuelve a abrir la edición del anuncio.</p>
  if (!generation) return <p role="status" className="text-sm text-muted-foreground">Cargando el idioma del anuncio…</p>
  return <ListingLanguageEditor key={`${generation.id}-${generation.updatedAt}`} generation={generation} />
}
