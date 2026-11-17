import { ArrowDown, ArrowUp, Plus, Star, X } from 'lucide-react'

import { VIDEO_MAX_PHOTOS } from '@estateforge/shared'

import { formatDuration, moveInSelection } from '@/lib/mediaUi'
import { estimateDuration } from '@/lib/videoRenderer'
import { fileUrl } from '@/services/mediaService'

// Fotografías del vídeo (DA-53): el usuario elige cuáles entran y en qué orden. La principal es
// obligatoria y abre el vídeo; las demás se añaden, se quitan y se ordenan libremente, hasta 25. Por
// defecto se proponen las primeras de la galería en su orden (lo explica el texto); nada se añade
// después por su cuenta. Se muestran el número elegido, cuántas caben aún y la duración estimada.

export interface VideoPhoto {
  id: string
  isPrimary: boolean
  url: string
  thumbUrl: string | null
}

/** Más de 15 fotografías dan un vídeo de casi un minuto: se avisa, pero no se impide. */
const LONG_VIDEO_PHOTOS = 15

export function VideoPhotoPicker({ photos, selected, onChange, disabled }: { photos: VideoPhoto[]; selected: string[]; onChange: (ids: string[]) => void; disabled?: boolean }) {
  const byId = new Map(photos.map(photo => [photo.id, photo]))
  const chosen = selected.map(id => byId.get(id)).filter((photo): photo is VideoPhoto => Boolean(photo))
  const available = photos.filter(photo => !selected.includes(photo.id))
  const count = chosen.length
  const free = Math.max(0, VIDEO_MAX_PHOTOS - count)
  const seconds = count ? estimateDuration(count) : 0
  const thumb = (photo: VideoPhoto) => fileUrl(photo.thumbUrl ?? photo.url)
  const galleryIndex = (photo: VideoPhoto) => photos.indexOf(photo) + 1

  return (
    <fieldset className="space-y-3" disabled={disabled} data-testid="video-photo-picker">
      <legend className="text-sm font-semibold">Fotografías del vídeo</legend>
      <p className="text-sm text-muted-foreground" data-testid="video-estimate">
        {count} seleccionadas (máximo {VIDEO_MAX_PHOTOS}) · puedes añadir {free} más · duración estimada {formatDuration(seconds * 1000)}
      </p>
      <p className="text-xs text-muted-foreground">
        Al abrir se proponen las primeras {Math.min(VIDEO_MAX_PHOTOS, photos.length)} de la galería, en su orden. La principal siempre abre el vídeo; las demás puedes quitarlas, añadirlas y ordenarlas.
      </p>
      {count > LONG_VIDEO_PHOTOS && <p className="text-sm text-amber-700">Con {count} fotografías el vídeo durará {formatDuration(seconds * 1000)}: quizá prefieras quitar algunas para que sea más ágil.</p>}

      <ol className="max-h-72 space-y-1 overflow-y-auto" aria-label="Orden de las fotografías del vídeo">
        {chosen.map((photo, index) => (
          <li key={photo.id} className="flex items-center gap-2 rounded border p-1" data-video-photo={photo.id}>
            <span className="w-6 text-center text-xs font-semibold">{index + 1}</span>
            <img src={thumb(photo)} alt="" loading="lazy" decoding="async" className="h-10 w-14 rounded object-cover" />
            <span className="flex-1 text-xs text-muted-foreground">
              Fotografía {galleryIndex(photo)} de la galería
              {photo.isPrimary && (
                <span className="ml-2 inline-flex items-center gap-1 rounded bg-amber-500 px-1.5 py-0.5 font-semibold text-black">
                  <Star className="h-3 w-3" aria-hidden="true" /> Principal (obligatoria)
                </span>
              )}
            </span>
            <button type="button" disabled={photo.isPrimary || index <= 1} onClick={() => onChange(moveInSelection(selected, index, -1))} className="rounded border p-1 disabled:opacity-30" aria-label={`Subir la fotografía ${index + 1}`}>
              <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button type="button" disabled={photo.isPrimary || index === count - 1} onClick={() => onChange(moveInSelection(selected, index, 1))} className="rounded border p-1 disabled:opacity-30" aria-label={`Bajar la fotografía ${index + 1}`}>
              <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button type="button" disabled={photo.isPrimary} onClick={() => onChange(selected.filter(id => id !== photo.id))} className="rounded border p-1 disabled:opacity-30" aria-label={`Quitar la fotografía ${index + 1} del vídeo`}>
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ol>

      {available.length > 0 && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Sin incluir ({available.length})</p>
          <ul className="mt-1 grid max-h-48 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
            {available.map(photo => (
              <li key={photo.id}>
                <button type="button" disabled={free === 0} onClick={() => onChange([...selected, photo.id])} className="relative block w-full overflow-hidden rounded border opacity-70 hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40" aria-label={`Añadir la fotografía ${galleryIndex(photo)} al vídeo`}>
                  <img src={thumb(photo)} alt="" loading="lazy" decoding="async" className="aspect-[4/3] w-full object-cover" />
                  <span className="absolute bottom-1 right-1 rounded bg-black/70 p-0.5 text-white">
                    <Plus className="h-3 w-3" aria-hidden="true" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </fieldset>
  )
}
