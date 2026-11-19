import { findPosterTemplate, type AudioPresetId, type PosterTemplateId } from '@estateforge/shared'
import { synthesizePreset } from './audioPresets'
import type { AudioChoice } from './audioChoice'
import { fitWithin } from './imagePrep'
import { photosForTemplate, renderPoster } from './posterRenderer'
import { buildPromoContent, nextVariant, orderedPhotos } from './promoContent'
import { buildSoundtrack, decodeAudio, type PcmAudio } from './soundtrack'
import { estimateDuration, renderVideo } from './videoRenderer'
import { drawPosterTemplate, fetchPrivate, getMediaSource, listAudioTracks, listMedia, loadBitmap, MediaRequestError, prepareUpload, transferFile, mediaPrepare, cancelUpload } from '@/services/mediaService'

export async function prepareSoundtrack(choice: AudioChoice, seconds: number, signal: AbortSignal): Promise<PcmAudio | null> {
  if (choice.source === 'none' || !choice.trackId) return null
  let raw: PcmAudio
  if (choice.source === 'preset') raw = synthesizePreset(choice.trackId as AudioPresetId, seconds)
  else {
    const { tracks } = await listAudioTracks()
    const track = tracks.find(item => item.id === choice.trackId)
    if (!track) throw new MediaRequestError('La pista elegida ya no está en tu biblioteca. Elige otra.', 404, 'NOT_FOUND')
    raw = await decodeAudio(await (await fetchPrivate(track.url, signal)).arrayBuffer())
  }
  return buildSoundtrack(raw, seconds, { volume: choice.volume / 100, fadeInSec: choice.fadeInMs / 1000, fadeOutSec: choice.fadeOutMs / 1000 })
}

export interface PreparedLanguageChange {
  draftId: string
  beforeSourceHash: string
  sourceHash: string
  generation: { id: string; title: string; description: string; highlights: string[]; callToAction: string | null; language: string }
  mediaKinds: string[]
}

/** Uploads draft files only. No existing media is replaced here. */
export async function prepareListingMedia(id: string, draft: PreparedLanguageChange, signal: AbortSignal, report: (message: string) => void): Promise<string[]> {
  const uploads: string[] = []
  const stage = async (kind: 'poster' | 'video', blob: Blob, meta: Parameters<typeof mediaPrepare>[3]) => {
    signal.throwIfAborted()
    const prepared = await prepareUpload({ ...mediaPrepare(id, kind, blob, meta), languageDraftId: draft.draftId }, signal)
    uploads.push(prepared.attemptId)
    await transferFile(prepared.upload, blob, { signal })
    signal.throwIfAborted()
  }
  try {
  for (const kind of draft.mediaKinds) {
    if (kind !== 'poster' && kind !== 'video') continue
    const bitmaps: ImageBitmap[] = []
    try {
      report(kind === 'poster' ? 'Rehaciendo el cartel…' : 'Rehaciendo el vídeo… Mantén esta pestaña visible.')
      const [source, media] = await Promise.all([getMediaSource(id), listMedia(id)])
      signal.throwIfAborted()
      if (source.sourceHash !== draft.beforeSourceHash) throw new Error('El anuncio ha cambiado durante la preparación. Recarga y vuelve a intentarlo.')
      source.generation = draft.generation
      source.sourceHash = draft.sourceHash
      const current = media[kind]
      const all = orderedPhotos(source.photos)
      if (!all.length) throw new Error('El inmueble no tiene fotografías.')
      const content = buildPromoContent(source)
      if (kind === 'poster') {
        const drawn = current?.selectionMode === 'random' || !findPosterTemplate(current?.templateId ?? '') ? await drawPosterTemplate(id) : null
        const templateId = (drawn?.templateId ?? current!.templateId) as PosterTemplateId
        const photos = all.slice(0, photosForTemplate(templateId, all.length))
        for (const photo of photos) bitmaps.push(await loadBitmap(photo.url, fitWithin(photo.width, photo.height, 1600), signal))
        const result = await renderPoster(content, bitmaps, templateId)
        await stage(kind, result.blob, { sourceHash: source.sourceHash, expectedVersion: current?.version ?? 0, variant: nextVariant(current?.variant), photoIds: photos.slice(0, result.photosUsed).map(p => p.id), poster: { templateId, selection: drawn ? 'random' : 'manual', drawId: drawn?.drawId } })
      } else {
        const photos = current?.photoIds?.length ? current.photoIds.map(photoId => all.find(photo => photo.id === photoId)) : all.slice(0, 25)
        if (photos.some(photo => !photo)) throw new Error('La selección contiene fotografías eliminadas. Revisa las opciones del vídeo.')
        const selected = photos.filter((photo): photo is (typeof all)[number] => !!photo)
        const seconds = estimateDuration(selected.length)
        const audio: AudioChoice = { source: current?.audioSource ?? 'none', trackId: current?.audioTrackId ?? null, volume: current?.audioVolume ?? 80, fadeInMs: current?.audioFadeInMs ?? 1000, fadeOutMs: current?.audioFadeOutMs ?? 2000 }
        const soundtrack = await prepareSoundtrack(audio, seconds, signal)
        const variant = nextVariant(current?.variant)
        const result = await renderVideo(content, selected.length, index => loadBitmap(selected[index].url, fitWithin(selected[index].width, selected[index].height, 1600), signal), variant, { soundtrack, signal })
        await stage(kind, result.blob, { sourceHash: source.sourceHash, expectedVersion: current?.version ?? 0, variant, photoIds: selected.map(photo => photo.id), durationMs: result.durationMs, codecs: result.mimeType, audio: soundtrack ? { source: audio.source, trackId: audio.trackId ?? undefined, volume: audio.volume, fadeInMs: audio.fadeInMs, fadeOutMs: audio.fadeOutMs } : { source: 'none' } })
      }
    } finally { bitmaps.forEach(bitmap => bitmap.close()) }
  }
  return uploads
  } catch (error) {
    // Cancellation is best effort; unconfirmed attempts also expire server-side.
    await Promise.allSettled(uploads.map(id => cancelUpload(id)))
    throw error
  }
}
