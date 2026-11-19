import { listingLanguageOf, AI_POSTER_MAX_REFERENCE_PHOTOS, POSTER_HEIGHT, POSTER_MAX_BYTES, POSTER_TEMPLATES, POSTER_WIDTH, type PosterTemplateId } from '@estateforge/shared'

import type { PromoContent } from './promoContent'

// Cartel publicitario (DA-47, DA-52): seis plantillas con composiciones realmente distintas, dibujadas
// con Canvas 2D a partir de los datos reales del anuncio y de las fotografías del inmueble. Cada
// plantilla decide cuántas fotografías usa (la principal primero) y se adapta a la información
// disponible: lo que falta no se dibuja y nunca se inventa. La API valida el resultado.

/** Lo que el cartel necesita de una imagen (ImageBitmap en el navegador, un objeto simple en pruebas). */
export interface PosterImage {
  width: number
  height: number
}

/** Subconjunto de CanvasRenderingContext2D que usa el cartel (permite probarlo sin navegador). */
export interface PosterContext {
  fillStyle: string | CanvasGradient | CanvasPattern
  strokeStyle: string | CanvasGradient | CanvasPattern
  font: string
  textBaseline: CanvasTextBaseline
  textAlign: CanvasTextAlign
  lineWidth: number
  globalAlpha: number
  fillRect(x: number, y: number, w: number, h: number): void
  strokeRect(x: number, y: number, w: number, h: number): void
  fillText(text: string, x: number, y: number, maxWidth?: number): void
  measureText(text: string): { width: number }
  drawImage(image: never, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradient
  save(): void
  restore(): void
  beginPath(): void
  roundRect(x: number, y: number, w: number, h: number, r: number): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  arc(x: number, y: number, r: number, start: number, end: number): void
  closePath(): void
  fill(): void
  stroke(): void
  clip(): void
}

const W = POSTER_WIDTH
const H = POSTER_HEIGHT
const SANS = "'Manrope Variable', 'Inter Variable', system-ui, sans-serif"
const SERIF = "Georgia, 'Times New Roman', serif"
// El pie sale del contenido (PromoContent.footer), en el idioma del anuncio.

/** Recorte centrado que cubre el hueco sin deformar la imagen. */
export function coverCrop(image: PosterImage, w: number, h: number) {
  const scale = Math.max(w / image.width, h / image.height)
  const sw = w / scale
  const sh = h / scale
  return { sx: (image.width - sw) / 2, sy: (image.height - sh) / 2, sw, sh }
}

/** Parte un texto en líneas que caben en maxWidth; si sobra, la última termina en «…». */
export function wrapText(ctx: Pick<PosterContext, 'measureText'>, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (ctx.measureText(next).width <= maxWidth || !line) {
      line = next
      continue
    }
    lines.push(line)
    line = word
    if (lines.length === maxLines) break
  }
  if (line && lines.length < maxLines) lines.push(line)
  const used = lines.join(' ').split(/\s+/).filter(Boolean).length
  if (used < words.length && lines.length) {
    let last = lines[lines.length - 1]
    while (last && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1)
    lines[lines.length - 1] = `${last.trimEnd()}…`
  }
  return lines
}

// ------------------------------------------------------------------------------- Utilidades

function photo(ctx: PosterContext, image: PosterImage, x: number, y: number, w: number, h: number, radius = 0) {
  const { sx, sy, sw, sh } = coverCrop(image, w, h)
  ctx.save()
  if (radius) {
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, radius)
    ctx.clip()
  }
  ctx.drawImage(image as never, sx, sy, sw, sh, x, y, w, h)
  ctx.restore()
}

function write(ctx: PosterContext, text: string, x: number, y: number, font: string, color: string, align: CanvasTextAlign = 'left', maxWidth = align === 'center' ? W - 160 : align === 'right' ? x - 64 : W - x - 64) {
  if (!text) return
  ctx.font = font
  ctx.fillStyle = color
  ctx.textAlign = align
  ctx.fillText(text, x, y, Math.max(40, maxWidth))
}

/** Escribe un párrafo y devuelve la coordenada y siguiente. */
function paragraph(ctx: PosterContext, text: string, x: number, y: number, width: number, font: string, size: number, color: string, maxLines: number, align: CanvasTextAlign = 'left', lineHeight = 1.22): number {
  if (!text) return y
  ctx.font = font
  const lines = wrapText(ctx, text, width, maxLines)
  for (const [i, line] of lines.entries()) write(ctx, line, align === 'center' ? x + width / 2 : x, y + i * size * lineHeight, font, color, align, width)
  return y + lines.length * size * lineHeight
}

const priceText = (c: PromoContent) => `${c.price}${c.priceSuffix ? ` ${c.priceSuffix}` : ''}`
const tagText = (c: PromoContent, withStatus = true) => [c.operation, c.type, withStatus ? c.status : null].filter(Boolean).join(' · ')
const extras = (c: PromoContent, limit: number) => [...c.features, ...c.highlights].slice(0, limit)



function check(ctx: PosterContext, x: number, y: number, color: string) {
  ctx.strokeStyle = color
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x + 8, y + 9)
  ctx.lineTo(x + 24, y - 10)
  ctx.stroke()
}

// ---------------------------------------------------------------------------- Plantillas

type Draw = (ctx: PosterContext, c: PromoContent, images: PosterImage[]) => number

/** Elegante: fondo crema, serifa, una foto enmarcada en dorado y composición centrada. */
const elegante: Draw = (ctx, c, images) => {
  const cream = '#f6f1e7'
  const gold = '#b08d57'
  const ink = '#2b2620'
  const muted = '#6b6259'
  ctx.fillStyle = cream
  ctx.fillRect(0, 0, W, H)
  ctx.strokeStyle = gold
  ctx.lineWidth = 2
  ctx.strokeRect(34, 34, W - 68, H - 68)
  ctx.lineWidth = 1
  ctx.strokeRect(46, 46, W - 92, H - 92)
  ctx.textBaseline = 'middle'
  write(ctx, tagText(c).toUpperCase(), W / 2, 104, `600 24px ${SERIF}`, gold, 'center', W - 200)
  ctx.fillStyle = gold
  ctx.fillRect(110, 140, W - 220, 8)
  photo(ctx, images[0], 118, 148, W - 236, 600)
  ctx.strokeStyle = cream
  ctx.lineWidth = 6
  ctx.strokeRect(130, 160, W - 260, 576)
  let y = paragraph(ctx, c.headline, 120, 820, W - 240, `italic 600 54px ${SERIF}`, 54, ink, 2, 'center')
  ctx.fillStyle = gold
  ctx.fillRect(W / 2 - 60, y + 6, 120, 3)
  y += 46
  if (c.location) {
    write(ctx, c.location, W / 2, y, `400 30px ${SERIF}`, muted, 'center')
    y += 64
  }
  write(ctx, priceText(c), W / 2, y + 10, `700 78px ${SERIF}`, ink, 'center')
  y += 86
  write(ctx, c.facts.join('  ·  '), W / 2, y, `400 28px ${SERIF}`, ink, 'center', W - 200)
  y += 46
  const more = extras(c, 4)
  if (more.length) y = paragraph(ctx, more.join(' · '), 120, y, W - 240, `italic 400 24px ${SERIF}`, 24, muted, 2, 'center') + 10
  if (c.slogan && y < H - 140) write(ctx, wrapText(ctx, c.slogan, W - 260, 1)[0] ?? '', W / 2, Math.max(y + 24, H - 136), `italic 600 30px ${SERIF}`, gold, 'center', W - 240)
  // Dentro del doble filete del marco.
  return 1
}

/** Minimalista: mucho blanco, una foto a lo ancho y datos en una rejilla con filetes finos. */
const minimalista: Draw = (ctx, c, images) => {
  const ink = '#111111'
  const muted = '#8a8a8a'
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)
  photo(ctx, images[0], 0, 0, W, 780)
  ctx.textBaseline = 'alphabetic'
  write(ctx, tagText(c, false).toUpperCase(), 80, 850, `600 20px ${SANS}`, muted)
  if (c.status) write(ctx, c.status.toUpperCase(), W - 80, 850, `600 20px ${SANS}`, muted, 'right', 400)
  let y = paragraph(ctx, c.headline, 80, 912, W - 160, `300 50px ${SANS}`, 50, ink, 2)
  if (c.location) {
    write(ctx, c.location, 80, y + 4, `400 26px ${SANS}`, muted)
    y += 40
  }
  // Rejilla de datos: una celda por dato, separadas por filetes verticales.
  const top = Math.max(y + 30, 1060)
  ctx.fillStyle = '#e5e5e5'
  ctx.fillRect(80, top, W - 160, 1)
  const cells = c.facts.slice(0, 4)
  const cellW = (W - 160) / Math.max(1, cells.length)
  cells.forEach((fact, i) => {
    if (i) {
      ctx.fillStyle = '#e5e5e5'
      ctx.fillRect(80 + i * cellW, top + 18, 1, 64)
    }
    write(ctx, fact, 80 + i * cellW + cellW / 2, top + 62, `500 28px ${SANS}`, ink, 'center', cellW - 20)
  })
  ctx.fillStyle = '#e5e5e5'
  ctx.fillRect(80, top + 100, W - 160, 1)
  const priceY = top + 196
  write(ctx, priceText(c), W - 80, priceY, `600 66px ${SANS}`, ink, 'right', 620)
  const more = extras(c, 3).join(' · ')
  paragraph(ctx, c.slogan ?? more, 80, priceY - 40, 340, `400 22px ${SANS}`, 22, muted, 3)
  return 1
}

/** Editorial: titular de revista, mosaico de tres fotos y texto en dos columnas. */
const editorial: Draw = (ctx, c, images) => {
  const paper = '#f2efe9'
  const ink = '#1a1a1a'
  const red = '#b3261e'
  ctx.fillStyle = paper
  ctx.fillRect(0, 0, W, H)
  ctx.textBaseline = 'alphabetic'
  write(ctx, [c.operation, c.location].filter(Boolean).join(' · ').toUpperCase(), 60, 78, `700 22px ${SANS}`, red)
  ctx.fillStyle = ink
  ctx.fillRect(60, 96, W - 120, 4)
  let y = paragraph(ctx, c.headline.toUpperCase(), 60, 186, W - 120, `900 84px ${SANS}`, 84, ink, 3, 'left', 1.02) - 40
  const mosaicTop = y + 40
  const mosaicH = 520
  const used = Math.min(3, images.length)
  if (used === 1) photo(ctx, images[0], 60, mosaicTop, W - 120, mosaicH)
  else {
    photo(ctx, images[0], 60, mosaicTop, 600, mosaicH)
    if (used === 2) photo(ctx, images[1], 676, mosaicTop, W - 736, mosaicH)
    else {
      const half = (mosaicH - 16) / 2
      photo(ctx, images[1], 676, mosaicTop, W - 736, half)
      photo(ctx, images[2], 676, mosaicTop + half + 16, W - 736, half)
    }
  }
  y = mosaicTop + mosaicH + 56
  // Columna izquierda: el texto real del anuncio; derecha: precio y datos.
  ctx.fillStyle = red
  ctx.fillRect(60, y - 30, 60, 6)
  const leftEnd = paragraph(ctx, c.excerpt, 60, y + 10, 470, `400 26px ${SERIF}`, 26, ink, Math.max(2, Math.floor((H - 150 - (y + 10)) / 35)), 'left', 1.35)
  write(ctx, priceText(c), 590, y + 30, `800 64px ${SANS}`, red, 'left', 430)
  let ry = y + 92
  const columnEnd = c.slogan ? H - 140 : H - 80
  for (const fact of c.facts) {
    if (ry > columnEnd) break
    write(ctx, fact, 590, ry, `600 28px ${SANS}`, ink, 'left', 430)
    ry += 40
  }
  for (const item of extras(c, 3)) {
    if (ry > columnEnd) break
    write(ctx, `— ${item}`, 590, ry, `400 24px ${SERIF}`, ink, 'left', 430)
    ry += 34
  }
  if (c.slogan) write(ctx, wrapText(ctx, c.slogan, W - 120, 1)[0] ?? '', 60, Math.min(H - 76, Math.max(leftEnd, ry) + 30), `italic 700 30px ${SERIF}`, red, 'left', W - 120)
  return used
}

/** Premium: fondo oscuro, dorado, foto a sangre con degradado, marco interior y una segunda foto circular. */
const premium: Draw = (ctx, c, images) => {
  const gold = '#c9a45c'
  ctx.fillStyle = '#0d0d0d'
  ctx.fillRect(0, 0, W, H)
  photo(ctx, images[0], 0, 0, W, 880)
  const fade = ctx.createLinearGradient(0, 420, 0, 900)
  fade.addColorStop(0, 'rgba(13, 13, 13, 0)')
  fade.addColorStop(1, 'rgba(13, 13, 13, 1)')
  ctx.fillStyle = fade
  ctx.fillRect(0, 420, W, 480)
  let used = 1
  if (images[1]) {
    used = 2
    ctx.save()
    ctx.beginPath()
    ctx.arc(880, 700, 120, 0, Math.PI * 2)
    ctx.closePath()
    ctx.clip()
    const { sx, sy, sw, sh } = coverCrop(images[1], 240, 240)
    ctx.drawImage(images[1] as never, sx, sy, sw, sh, 760, 580, 240, 240)
    ctx.restore()
    ctx.strokeStyle = gold
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.arc(880, 700, 122, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.strokeStyle = gold
  ctx.lineWidth = 2
  ctx.strokeRect(30, 30, W - 60, H - 60)
  ctx.textBaseline = 'alphabetic'
  write(ctx, tagText(c).toUpperCase(), 80, 900, `600 22px ${SANS}`, gold)
  let y = paragraph(ctx, c.headline, 80, 968, W - 160, `600 52px ${SERIF}`, 52, '#ffffff', 2)
  if (c.location) {
    write(ctx, c.location, 80, y + 2, `400 28px ${SANS}`, '#bdbdbd')
    y += 44
  }
  ctx.fillStyle = gold
  ctx.fillRect(80, y + 6, 160, 2)
  write(ctx, priceText(c), 80, y + 96, `700 80px ${SERIF}`, gold, 'left', W - 160)
  write(ctx, c.facts.join('   |   '), 80, y + 150, `500 26px ${SANS}`, '#f2f2f2', 'left', W - 160)
  // Debajo, por orden de importancia y solo si caben: llamada a la acción y extras.
  let next = y + 196
  if (c.slogan && next < H - 64) {
    write(ctx, wrapText(ctx, c.slogan, W - 160, 1)[0] ?? '', 80, next, `italic 500 28px ${SERIF}`, gold, 'left', W - 160)
    next += 44
  }
  const more = extras(c, 4)
  if (more.length && next < H - 64) write(ctx, wrapText(ctx, more.join(' · '), W - 160, 1)[0] ?? '', 80, next, `400 22px ${SANS}`, '#9e9e9e', 'left', W - 160)
  return used
}

/** Fotográfico: las fotos llenan el cartel en mosaico y los datos van en una tarjeta translúcida. */
const fotografico: Draw = (ctx, c, images) => {
  const accent = '#0f766e'
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)
  const used = Math.min(4, images.length)
  const g = 8
  if (used === 1) photo(ctx, images[0], 0, 0, W, H)
  else if (used === 2) {
    photo(ctx, images[0], 0, 0, W, 760)
    photo(ctx, images[1], 0, 760 + g, W, H - 760 - g)
  } else if (used === 3) {
    photo(ctx, images[0], 0, 0, W, 780)
    photo(ctx, images[1], 0, 780 + g, (W - g) / 2, H - 780 - g)
    photo(ctx, images[2], (W + g) / 2, 780 + g, (W - g) / 2, H - 780 - g)
  } else {
    const cw = (W - g) / 2
    const ch = (H - g) / 2
    images.slice(0, 4).forEach((image, i) => photo(ctx, image, (i % 2) * (cw + g), Math.floor(i / 2) * (ch + g), cw, ch))
  }
  // Tarjeta: su altura depende de lo que haya que mostrar.
  ctx.font = `700 40px ${SANS}`
  const headline = wrapText(ctx, c.headline, 860, 2)
  const cardH = 230 + headline.length * 48 + (c.location ? 40 : 0) + (c.slogan ? 44 : 0)
  const cardY = H - 50 - cardH
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
  ctx.beginPath()
  ctx.roundRect(50, cardY, W - 100, cardH, 28)
  ctx.fill()
  ctx.textBaseline = 'alphabetic'
  write(ctx, tagText(c).toUpperCase(), 92, cardY + 58, `700 22px ${SANS}`, accent, 'left', W - 184)
  write(ctx, priceText(c), 92, cardY + 130, `800 66px ${SANS}`, '#0f172a', 'left', W - 184)
  let y = cardY + 186
  for (const line of headline) {
    write(ctx, line, 92, y, `700 40px ${SANS}`, '#0f172a', 'left', W - 184)
    y += 48
  }
  if (c.location) {
    write(ctx, c.location, 92, y, `500 26px ${SANS}`, '#475569', 'left', W - 184)
    y += 40
  }
  write(ctx, c.facts.join(' · '), 92, y + 4, `600 26px ${SANS}`, '#0f172a', 'left', W - 184)
  if (c.slogan) write(ctx, wrapText(ctx, c.slogan, W - 184, 1)[0] ?? '', 92, y + 48, `600 26px ${SANS}`, accent, 'left', W - 184)
  return used
}

/** Moderno: foto con corte diagonal, bloques de color, precio en etiqueta y características marcadas. */
/** Línea base más baja de los extras de «Moderno»: deja 42 px libres sobre la llamada a la acción. */
export const MODERNO_EXTRAS_LIMIT = H - 120

const moderno: Draw = (ctx, c, images) => {
  const coral = '#f97316'
  const teal = '#0f766e'
  const ink = '#0f172a'
  ctx.fillStyle = '#f8fafc'
  ctx.fillRect(0, 0, W, H)
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(W, 0)
  ctx.lineTo(W, 600)
  ctx.lineTo(0, 740)
  ctx.closePath()
  ctx.clip()
  const { sx, sy, sw, sh } = coverCrop(images[0], W, 740)
  ctx.drawImage(images[0] as never, sx, sy, sw, sh, 0, 0, W, 740)
  ctx.restore()
  ctx.fillStyle = teal
  ctx.beginPath()
  ctx.moveTo(0, 740)
  ctx.lineTo(W, 600)
  ctx.lineTo(W, 622)
  ctx.lineTo(0, 762)
  ctx.closePath()
  ctx.fill()
  let used = 1
  if (images[1]) {
    used = 2
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.roundRect(692, 520, 336, 252, 28)
    ctx.fill()
    photo(ctx, images[1], 700, 528, 320, 236, 22)
  }
  ctx.textBaseline = 'middle'
  ctx.font = `800 54px ${SANS}`
  const price = priceText(c)
  const pillW = Math.min(W - 120, ctx.measureText(price).width + 64)
  ctx.fillStyle = coral
  ctx.beginPath()
  ctx.roundRect(60, 800, pillW, 92, 46)
  ctx.fill()
  write(ctx, price, 92, 848, `800 54px ${SANS}`, '#ffffff', 'left', pillW - 64)
  ctx.textBaseline = 'alphabetic'
  write(ctx, tagText(c).toUpperCase(), 60, 948, `700 22px ${SANS}`, teal)
  let y = paragraph(ctx, c.headline, 60, 1000, W - 120, `800 46px ${SANS}`, 46, ink, 2)
  if (c.location) {
    write(ctx, c.location, 60, y + 2, `500 26px ${SANS}`, '#475569')
    y += 44
  }
  // Datos en etiquetas y características con marca de verificación, en dos columnas.
  let x = 60
  ctx.font = `600 24px ${SANS}`
  for (const fact of c.facts) {
    const w = ctx.measureText(fact).width + 36
    if (x + w > W - 60) break
    ctx.strokeStyle = teal
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.roundRect(x, y + 6, w, 44, 22)
    ctx.stroke()
    write(ctx, fact, x + 18, y + 37, `600 24px ${SANS}`, teal, 'left', w - 36)
    x += w + 12
  }
  y += 86
  // Solo las filas que caben por encima de la llamada a la acción (H − 78): con un titular de dos líneas
  // y ubicación, la segunda fila se superponía a ella.
  extras(c, 4).filter((_, i) => y + Math.floor(i / 2) * 44 <= MODERNO_EXTRAS_LIMIT).forEach((item, i) => {
    const cx = 60 + (i % 2) * 490
    const cy = y + Math.floor(i / 2) * 44
    check(ctx, cx, cy - 8, coral)
    write(ctx, item, cx + 40, cy, `500 24px ${SANS}`, ink, 'left', 430)
  })
  if (c.slogan) write(ctx, wrapText(ctx, c.slogan, W - 120, 1)[0] ?? '', 60, H - 78, `800 28px ${SANS}`, teal, 'left', W - 120)
  return used
}

const TEMPLATES: Record<PosterTemplateId, Draw> = { elegante, minimalista, editorial, premium, fotografico, moderno }

/** Fotografías que usa una plantilla con las disponibles (la principal primero). */
export function photosForTemplate(templateId: PosterTemplateId, available: number): number {
  const template = POSTER_TEMPLATES.find(item => item.id === templateId)
  return Math.max(1, Math.min(template?.photos ?? 1, available))
}

/**
 * Dibuja el cartel con la plantilla indicada. images: fotografías del inmueble en orden (la principal
 * primero); solo se usan las que necesita la plantilla. Devuelve cuántas ha usado.
 */
export function drawPoster(ctx: PosterContext, content: PromoContent, images: PosterImage[], templateId: PosterTemplateId): { photosUsed: number } {
  if (images.length === 0) throw new Error('El cartel necesita al menos una fotografía.')
  const draw = TEMPLATES[templateId]
  if (!draw) throw new Error('Plantilla de cartel desconocida.')
  ctx.globalAlpha = 1
  const photosUsed = draw(ctx, content, images.slice(0, photosForTemplate(templateId, images.length)))
  return { photosUsed }
}

/** Vista previa a escala sobre un lienzo existente (selector de plantillas). */
export function drawPosterPreview(canvas: HTMLCanvasElement, content: PromoContent, images: PosterImage[], templateId: PosterTemplateId): void {
  const ctx = canvas.getContext('2d')
  if (!ctx || images.length === 0) return
  ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0)
  drawPoster(ctx as unknown as PosterContext, content, images, templateId)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
}

/** Compone el cartel y lo devuelve como JPEG que respeta el tamaño máximo. */
export async function renderPoster(content: PromoContent, images: ImageBitmap[], templateId: PosterTemplateId): Promise<{ blob: Blob; photosUsed: number }> {
  await document.fonts?.ready
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('El navegador no permite dibujar el cartel.')
  const { photosUsed } = drawPoster(ctx as unknown as PosterContext, content, images, templateId)
  try {
    for (const quality of [0.9, 0.82, 0.74]) {
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
      if (blob && blob.size <= POSTER_MAX_BYTES) return { blob, photosUsed }
    }
    throw new Error('El cartel generado supera el tamaño máximo de 3 MB.')
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}

// ---------------------------------------------------------------------------- Cartel con IA (DA-72)

/** Fotografías reales que usa como máximo el cartel con IA (la principal primero). */
export const AI_POSTER_PHOTOS = AI_POSTER_MAX_REFERENCE_PHOTOS

/**
 * Cartel con IA: la IA solo aporta el FONDO decorativo (generado sin texto). Las fotografías son las
 * auténticas del inmueble, sin alterar, y todos los datos (precio, superficie, ubicación…) los escribe
 * EstateForge a partir del anuncio: el modelo nunca los inventa. Lleva el rótulo «Diseño asistido por IA».
 */
export function drawAiPoster(ctx: PosterContext, c: PromoContent, background: PosterImage, images: PosterImage[]): { photosUsed: number } {
  if (images.length === 0) throw new Error('El cartel necesita al menos una fotografía.')
  const used = images.slice(0, AI_POSTER_PHOTOS)
  ctx.globalAlpha = 1
  photo(ctx, background, 0, 0, W, H)
  // Velo para que el texto se lea sobre cualquier fondo.
  ctx.fillStyle = 'rgba(15, 23, 42, 0.38)'
  ctx.fillRect(0, 0, W, H)
  const top = ctx.createLinearGradient(0, 0, 0, 300)
  top.addColorStop(0, 'rgba(15, 23, 42, 0.75)')
  top.addColorStop(1, 'rgba(15, 23, 42, 0)')
  ctx.fillStyle = top
  ctx.fillRect(0, 0, W, 300)
  write(ctx, tagText(c).toUpperCase(), 72, 92, `700 26px ${SANS}`, '#fde68a')
  paragraph(ctx, c.headline, 72, 150, W - 144, `800 58px ${SANS}`, 58, '#ffffff', 2)
  // Fotografía principal auténtica, enmarcada; las demás, debajo.
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.roundRect(64, 282, W - 128, 548, 28)
  ctx.fill()
  photo(ctx, used[0], 76, 294, W - 152, 524, 22)
  if (used.length > 1) {
    const gap = 20
    const w = (W - 128 - gap * (used.length - 2)) / (used.length - 1)
    used.slice(1).forEach((image, i) => {
      const x = 64 + i * (w + gap)
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.roundRect(x, 852, w, 200, 18)
      ctx.fill()
      photo(ctx, image, x + 8, 860, w - 16, 184, 14)
    })
  }
  // Datos exactos del anuncio.
  const dataTop = used.length > 1 ? 1076 : 872
  ctx.fillStyle = 'rgba(255, 255, 255, 0.94)'
  ctx.beginPath()
  ctx.roundRect(64, dataTop, W - 128, H - dataTop - 84, 24)
  ctx.fill()
  write(ctx, priceText(c), 100, dataTop + 70, `800 60px ${SANS}`, '#0f172a')
  write(ctx, c.location, 100, dataTop + 118, `600 28px ${SANS}`, '#334155')
  const facts = [...c.facts, ...extras(c, 3)].slice(0, 6).join('  ·  ')
  paragraph(ctx, facts, 100, dataTop + 166, W - 200, `600 26px ${SANS}`, 26, '#0f172a', used.length > 1 ? 1 : 3)
  if (used.length === 1) paragraph(ctx, c.excerpt, 100, dataTop + 290, W - 200, `400 26px ${SANS}`, 26, '#334155', 4)
  // Rótulo visible de contenido asistido por IA en el idioma del anuncio.
  ctx.font = `700 22px ${SANS}`
  const labelWidth = ctx.measureText((listingLanguageOf(c.language) === 'english' ? 'AI-assisted design' : 'Diseño asistido por IA')).width + 36
  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)'
  ctx.beginPath()
  ctx.roundRect(W - 64 - labelWidth, H - 70, labelWidth, 40, 20)
  ctx.fill()
  write(ctx, (c.language === 'english' ? 'AI-assisted design' : 'Diseño asistido por IA'), W - 64 - labelWidth / 2, H - 42, `700 22px ${SANS}`, '#ffffff', 'center', labelWidth)
  return { photosUsed: used.length }
}

/** Compone el cartel con IA como JPEG dentro del tamaño máximo. */
export async function renderAiPoster(content: PromoContent, background: ImageBitmap, images: ImageBitmap[]): Promise<{ blob: Blob; photosUsed: number }> {
  await document.fonts?.ready
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('El navegador no permite dibujar el cartel.')
  const { photosUsed } = drawAiPoster(ctx as unknown as PosterContext, content, background, images)
  try {
    for (const quality of [0.9, 0.82, 0.74]) {
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
      if (blob && blob.size <= POSTER_MAX_BYTES) return { blob, photosUsed }
    }
    throw new Error('El cartel generado supera el tamaño máximo de 3 MB.')
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}
