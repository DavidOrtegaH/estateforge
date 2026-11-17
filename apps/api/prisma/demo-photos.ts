import { deflateSync } from 'node:zlib'

// Ilustraciones sintéticas para el seed de desarrollo (DA-46): se dibujan por código, sin fotografías
// reales ni recursos de terceros. Cada escena es un PNG válido distinto (cambia el color con la
// semilla), para que la galería, el cartel y el vídeo se puedan probar con datos de ejemplo.

export type DemoScene = 'fachada' | 'salon' | 'dormitorio' | 'cocina'
export const DEMO_SCENES: DemoScene[] = ['fachada', 'salon', 'dormitorio', 'cocina']

type RGB = [number, number, number]

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

class Canvas {
  readonly width: number
  readonly height: number
  readonly pixels: Buffer
  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.pixels = Buffer.alloc(width * height * 3)
  }

  rect(x0: number, y0: number, w: number, h: number, color: RGB) {
    for (let y = Math.max(0, Math.round(y0)); y < Math.min(this.height, Math.round(y0 + h)); y += 1) {
      for (let x = Math.max(0, Math.round(x0)); x < Math.min(this.width, Math.round(x0 + w)); x += 1) this.set(x, y, color)
    }
  }

  gradient(y0: number, h: number, top: RGB, bottom: RGB) {
    for (let y = Math.max(0, y0); y < Math.min(this.height, y0 + h); y += 1) {
      const t = (y - y0) / Math.max(1, h - 1)
      const color = top.map((c, i) => Math.round(c + (bottom[i] - c) * t)) as RGB
      for (let x = 0; x < this.width; x += 1) this.set(x, y, color)
    }
  }

  /** Triángulo isósceles con el vértice arriba (tejado). */
  roof(cx: number, top: number, halfBase: number, h: number, color: RGB) {
    for (let y = 0; y < h; y += 1) {
      const half = (halfBase * y) / h
      this.rect(cx - half, top + y, half * 2, 1, color)
    }
  }

  circle(cx: number, cy: number, r: number, color: RGB) {
    for (let y = -r; y <= r; y += 1) {
      const half = Math.sqrt(r * r - y * y)
      this.rect(cx - half, cy + y, half * 2, 1, color)
    }
  }

  private set(x: number, y: number, [r, g, b]: RGB) {
    const i = (y * this.width + x) * 3
    this.pixels[i] = r
    this.pixels[i + 1] = g
    this.pixels[i + 2] = b
  }

  png(label: string): Buffer {
    const header = Buffer.alloc(13)
    header.writeUInt32BE(this.width, 0)
    header.writeUInt32BE(this.height, 4)
    header[8] = 8
    header[9] = 2
    const raw = Buffer.alloc((this.width * 3 + 1) * this.height)
    for (let y = 0; y < this.height; y += 1) this.pixels.copy(raw, y * (this.width * 3 + 1) + 1, y * this.width * 3, (y + 1) * this.width * 3)
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('tEXt', Buffer.from(`Comment\0EstateForge demo sintetica: ${label}`, 'latin1')),
      chunk('IDAT', deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ])
  }
}

const tint = (base: RGB, seed: number, amount = 40): RGB => base.map((c, i) => Math.max(0, Math.min(255, c + (((seed * (i + 3) * 37) % (amount * 2)) - amount)))) as RGB

/** PNG de 1200×900 con una escena sencilla. La semilla cambia los colores y hace único el archivo. */
export function demoPhoto(scene: DemoScene, seed: number): Buffer {
  const W = 1200
  const H = 900
  const c = new Canvas(W, H)
  if (scene === 'fachada') {
    c.gradient(0, 620, tint([110, 170, 230], seed, 20), [210, 230, 250])
    c.circle(1000, 140, 60, [255, 220, 120])
    c.gradient(620, 280, [120, 170, 90], [80, 120, 60])
    const wall = tint([235, 215, 190], seed)
    c.rect(300, 330, 600, 330, wall)
    c.roof(600, 170, 360, 170, tint([170, 70, 50], seed, 25))
    c.rect(560, 500, 90, 160, [110, 75, 50])
    for (const x of [360, 720]) {
      c.rect(x, 400, 120, 100, [250, 250, 250])
      c.rect(x + 8, 408, 104, 84, [140, 190, 230])
    }
  } else {
    const wall = tint(scene === 'salon' ? [236, 228, 214] : scene === 'dormitorio' ? [220, 228, 236] : [240, 240, 232], seed)
    c.gradient(0, 640, wall, wall.map(v => v - 25) as RGB)
    c.gradient(640, 260, tint([170, 125, 85], seed, 20), [120, 85, 55])
    c.rect(780, 120, 300, 340, [250, 250, 250])
    c.rect(795, 135, 270, 310, [170, 210, 240])
    c.rect(925, 135, 10, 310, [250, 250, 250])
    if (scene === 'salon') {
      c.rect(120, 470, 520, 170, tint([90, 110, 140], seed, 30))
      c.rect(120, 420, 520, 70, tint([110, 130, 160], seed, 30))
      c.rect(250, 690, 260, 50, [200, 180, 150])
    } else if (scene === 'dormitorio') {
      c.rect(150, 500, 560, 180, [245, 245, 245])
      c.rect(150, 420, 40, 260, [130, 95, 65])
      c.rect(170, 470, 160, 60, tint([200, 120, 120], seed, 30))
    } else {
      c.rect(100, 480, 620, 200, tint([230, 230, 230], seed, 15))
      c.rect(100, 460, 620, 24, [70, 70, 70])
      c.rect(100, 160, 620, 150, tint([200, 210, 220], seed, 20))
      for (const x of [140, 300, 460, 620]) c.rect(x, 560, 60, 8, [90, 90, 90])
    }
  }
  return c.png(`${scene}-${seed}`)
}
