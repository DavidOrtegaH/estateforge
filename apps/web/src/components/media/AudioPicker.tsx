import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { Music, Pause, Play, Trash2, Upload, VolumeX } from 'lucide-react'

import { AUDIO_MAX_BYTES, AUDIO_MAX_DURATION_MS, AUDIO_PRESETS, type AudioPresetId, type AudioSource } from '@estateforge/shared'

import { synthesizePreset } from '@/lib/audioPresets'
import { formatBytes, formatDuration } from '@/lib/mediaUi'
import { checkAudioFile, type AudioChoice } from '@/lib/audioChoice'
import { encodeWav } from '@/lib/soundtrack'
import { deleteAudioTrack, fileUrl, listAudioTracks, uploadAudioTrack, type AudioTrack } from '@/services/mediaService'

import { ConfirmDialog } from './ConfirmDialog'

// Elección del sonido del vídeo (DA-54, DA-55): sin sonido, una pista predeterminada de EstateForge o
// una pista de la biblioteca personal. Cada pista se puede escuchar antes; la escucha previa usa un
// elemento <audio> y nunca pide el micrófono ni otros permisos.

const PREVIEW_SECONDS = 15

export function AudioPicker({ value, onChange, disabled }: { value: AudioChoice; onChange: (value: AudioChoice) => void; disabled?: boolean }) {
  const [tracks, setTracks] = useState<AudioTrack[] | null>(null)
  const [libraryError, setLibraryError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [rights, setRights] = useState(false)
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  const [previewVolume, setPreviewVolume] = useState(0.7)
  const [removing, setRemoving] = useState<AudioTrack | null>(null)
  const audio = useRef<HTMLAudioElement | null>(null)
  const presetUrls = useRef(new Map<string, string>())
  const fileInput = useRef<HTMLInputElement>(null)

  const loadTracks = useCallback(async () => {
    try {
      setTracks((await listAudioTracks()).tracks)
      setLibraryError(null)
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : 'No se ha podido cargar tu biblioteca de audio.')
    }
  }, [])

  useEffect(() => {
    void loadTracks()
  }, [loadTracks])

  // Al salir: se para la escucha y se liberan las URL de objeto de las pistas sintetizadas.
  useEffect(() => {
    const urls = presetUrls.current
    return () => {
      audio.current?.pause()
      for (const url of urls.values()) URL.revokeObjectURL(url)
      urls.clear()
    }
  }, [])

  useEffect(() => {
    if (audio.current) audio.current.volume = previewVolume
  }, [previewVolume])

  function stopPreview() {
    audio.current?.pause()
    setPlaying(null)
  }

  function togglePreview(key: string, src: () => string) {
    if (playing === key) return stopPreview()
    audio.current?.pause()
    const element = new Audio(src())
    element.volume = previewVolume
    element.onended = () => setPlaying(current => (current === key ? null : current))
    audio.current = element
    setPlaying(key)
    void element.play().catch(() => {
      setPlaying(null)
      setMessage({ tone: 'error', text: 'El navegador no ha podido reproducir esta pista.' })
    })
  }

  function presetUrl(id: AudioPresetId) {
    let url = presetUrls.current.get(id)
    if (!url) {
      url = URL.createObjectURL(encodeWav(synthesizePreset(id, PREVIEW_SECONDS)))
      presetUrls.current.set(id, url)
    }
    return url
  }

  async function onUpload(file: File | undefined) {
    if (!file) return
    setMessage(null)
    if (!rights) {
      setMessage({ tone: 'error', text: 'Antes de subir una pista, confirma que tienes derecho a usarla.' })
      return
    }
    setUploading(true)
    try {
      const checked = await checkAudioFile(file)
      if (typeof checked === 'string') throw new Error(checked)
      const track = await uploadAudioTrack(file, file.name, checked.contentType, true)
      setTracks(current => [track, ...(current ?? [])])
      onChange({ ...value, source: 'library', trackId: track.id })
      setMessage({ tone: 'success', text: `«${track.name}» añadida a tu biblioteca y seleccionada.` })
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'No se ha podido subir la pista.' })
    } finally {
      setUploading(false)
    }
  }

  return (
    <>
      <AudioPickerView
        value={value}
        onChange={onChange}
        disabled={disabled}
        tracks={tracks}
        libraryError={libraryError}
        uploading={uploading}
        rights={rights}
        onRights={setRights}
        message={message}
        playing={playing}
        onPreset={id => togglePreview(`preset:${id}`, () => presetUrl(id))}
        onTrack={track => togglePreview(`track:${track.id}`, () => fileUrl(track.url))}
        onRemove={setRemoving}
        fileInput={fileInput}
        onFile={file => void onUpload(file)}
        previewVolume={previewVolume}
        onPreviewVolume={setPreviewVolume}
      />
      {removing && (
        <ConfirmDialog
          id="audio-delete"
          title="Eliminar pista"
          description={`«${removing.name}» se eliminará de tu biblioteca. Los vídeos que ya la incorporan no cambian.`}
          confirmLabel="Eliminar"
          destructive
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            const track = removing
            setRemoving(null)
            stopPreview()
            void deleteAudioTrack(track.id)
              .then(() => {
                setTracks(current => (current ?? []).filter(item => item.id !== track.id))
                if (value.source === 'library' && value.trackId === track.id) onChange({ ...value, source: 'none', trackId: null })
                setMessage({ tone: 'success', text: `«${track.name}» eliminada.` })
              })
              .catch(error => setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'No se ha podido eliminar.' }))
          }}
        />
      )}
    </>
  )
}

/** Vista sin estado del selector de sonido (se puede renderizar y probar sin efectos). */
export function AudioPickerView({
  value,
  onChange,
  disabled,
  tracks,
  libraryError,
  uploading,
  rights,
  onRights,
  message,
  playing,
  onPreset,
  onTrack,
  onRemove,
  fileInput,
  onFile,
  previewVolume,
  onPreviewVolume,
}: {
  value: AudioChoice
  onChange: (value: AudioChoice) => void
  disabled?: boolean
  tracks: AudioTrack[] | null
  libraryError: string | null
  uploading: boolean
  rights: boolean
  onRights: (value: boolean) => void
  message: { tone: 'error' | 'success'; text: string } | null
  playing: string | null
  onPreset: (id: AudioPresetId) => void
  onTrack: (track: AudioTrack) => void
  onRemove: (track: AudioTrack) => void
  fileInput: RefObject<HTMLInputElement | null>
  onFile: (file: File | undefined) => void
  previewVolume: number
  onPreviewVolume: (value: number) => void
}) {
  const select = (source: AudioSource, trackId: string | null) => onChange({ ...value, source, trackId })
  const radio = 'h-4 w-4'

  return (
    <fieldset className="space-y-3" disabled={disabled} data-testid="audio-picker">
      <legend className="text-sm font-semibold">Sonido del vídeo</legend>

      <label className="flex items-center gap-2 text-sm">
        <input type="radio" name="audio-source" className={radio} checked={value.source === 'none'} onChange={() => select('none', null)} />
        <VolumeX className="h-4 w-4" aria-hidden="true" /> Sin sonido
      </label>

      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pistas de EstateForge</p>
        <ul className="mt-1 space-y-1">
          {AUDIO_PRESETS.map(preset => (
            <li key={preset.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2" data-preset-id={preset.id}>
              <label className="flex flex-1 items-start gap-2 text-sm">
                <input type="radio" name="audio-source" className={`${radio} mt-0.5`} checked={value.source === 'preset' && value.trackId === preset.id} onChange={() => select('preset', preset.id)} />
                <span>
                  <span className="font-medium">{preset.name}</span>
                  <span className="block text-xs text-muted-foreground">{preset.description}</span>
                </span>
              </label>
              <button type="button" onClick={() => onPreset(preset.id)} className="rounded border p-1.5 hover:bg-muted" aria-label={playing === `preset:${preset.id}` ? `Pausar ${preset.name}` : `Escuchar ${preset.name}`}>
                {playing === `preset:${preset.id}` ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-1 text-xs text-muted-foreground">Composiciones originales de EstateForge, sintetizadas en tu navegador.</p>
      </div>

      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Mi biblioteca</p>
        {libraryError && <p className="text-sm text-destructive">{libraryError}</p>}
        {tracks !== null && tracks.length === 0 && <p className="mt-1 text-sm text-muted-foreground">Todavía no has subido ninguna pista.</p>}
        <ul className="mt-1 space-y-1">
          {(tracks ?? []).map(track => (
            <li key={track.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2" data-track-id={track.id}>
              <label className="flex flex-1 items-start gap-2 text-sm">
                <input type="radio" name="audio-source" className={`${radio} mt-0.5`} checked={value.source === 'library' && value.trackId === track.id} onChange={() => select('library', track.id)} />
                <span>
                  <span className="font-medium">{track.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {formatDuration(track.durationMs)} · {track.format.toUpperCase()} · {formatBytes(track.size)}
                  </span>
                </span>
              </label>
              <button type="button" onClick={() => onTrack(track)} className="rounded border p-1.5 hover:bg-muted" aria-label={playing === `track:${track.id}` ? `Pausar ${track.name}` : `Escuchar ${track.name}`}>
                {playing === `track:${track.id}` ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
              </button>
              <button type="button" onClick={() => onRemove(track)} className="rounded border border-destructive/40 p-1.5 text-destructive hover:bg-destructive/10" aria-label={`Eliminar ${track.name}`}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-2 rounded-md border border-dashed p-3 text-sm">
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={rights} onChange={event => onRights(event.target.checked)} className="mt-0.5 h-4 w-4" data-testid="audio-rights" />
            <span>Declaro que soy titular de esta pista o que tengo autorización para usarla en mis vídeos. EstateForge no concede licencias sobre el audio que subas.</span>
          </label>
          <button
            type="button"
            disabled={uploading || !rights}
            onClick={() => fileInput.current?.click()}
            className="mt-2 inline-flex items-center gap-2 rounded-md border px-3 py-1.5 font-medium hover:bg-muted disabled:opacity-50"
          >
            <Upload className="h-4 w-4" aria-hidden="true" /> {uploading ? 'Subiendo…' : 'Subir pista'}
          </button>
          <span className="ml-2 text-xs text-muted-foreground">MP3, WAV, OGG o M4A · hasta {formatBytes(AUDIO_MAX_BYTES)} y {formatDuration(AUDIO_MAX_DURATION_MS)}</span>
          <input
            ref={fileInput}
            type="file"
            accept="audio/mpeg,audio/wav,audio/x-wav,audio/ogg,audio/mp4,audio/x-m4a,.mp3,.wav,.ogg,.oga,.opus,.m4a"
            hidden
            data-testid="audio-upload-input"
            onChange={event => {
              const file = event.target.files?.[0]
              event.target.value = ''
              onFile(file)
            }}
          />
        </div>
      </div>

      {message && (
        <p role={message.tone === 'error' ? 'alert' : 'status'} className={`text-sm ${message.tone === 'error' ? 'text-destructive' : 'text-emerald-600'}`}>
          {message.text}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          Volumen de escucha previa: {Math.round(previewVolume * 100)} %
          <input type="range" min={0} max={1} step={0.05} value={previewVolume} onChange={event => onPreviewVolume(Number(event.target.value))} className="mt-1 w-full" aria-label="Volumen de la escucha previa" />
        </label>
        {value.source !== 'none' && (
          <label className="text-sm">
            Volumen en el vídeo: {value.volume} %
            <input type="range" min={0} max={100} step={5} value={value.volume} onChange={event => onChange({ ...value, volume: Number(event.target.value) })} className="mt-1 w-full" aria-label="Volumen en el vídeo" data-testid="audio-volume" />
          </label>
        )}
        {value.source !== 'none' && (
          <label className="text-sm">
            Fundido de entrada
            <select value={value.fadeInMs} onChange={event => onChange({ ...value, fadeInMs: Number(event.target.value) })} className="mt-1 w-full rounded-md border bg-background px-2 py-1">
              {[0, 500, 1000, 2000, 3000].map(ms => (
                <option key={ms} value={ms}>
                  {ms === 0 ? 'Sin fundido' : `${ms / 1000} s`}
                </option>
              ))}
            </select>
          </label>
        )}
        {value.source !== 'none' && (
          <label className="text-sm">
            Fundido de salida
            <select value={value.fadeOutMs} onChange={event => onChange({ ...value, fadeOutMs: Number(event.target.value) })} className="mt-1 w-full rounded-md border bg-background px-2 py-1">
              {[0, 1000, 2000, 3000, 5000].map(ms => (
                <option key={ms} value={ms}>
                  {ms === 0 ? 'Sin fundido' : `${ms / 1000} s`}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {value.source !== 'none' && (
        <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Music className="h-3 w-3" aria-hidden="true" /> Si la pista es más corta que el vídeo, se repite con un fundido; si es más larga, termina con el vídeo.
        </p>
      )}

    </fieldset>
  )
}
