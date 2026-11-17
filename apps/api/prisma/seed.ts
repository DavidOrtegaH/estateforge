import 'dotenv/config'

import { pathToFileURL } from 'node:url'

import { closeDatabase, prisma } from '../src/db/prisma.js'
import { addPhoto } from '../src/media/photo.service.js'
import { hashPassword } from '../src/services/password.service.js'

import { DEMO_SCENES, demoPhoto } from './demo-photos.js'

// Datos de ejemplo para desarrollo. Es repetible y se niega a actuar fuera de localhost.
// La contraseña la aporta quien ejecuta el comando (SEED_USER_PASSWORD): nunca está en el repositorio.
//
// Crea dos cuentas: la de ejemplo, con inmuebles en los cuatro estados comerciales, uno antiguo sin
// estado y un Checklist con portales y filas «Otro/a», y otra cuenta con un inmueble propio, para
// comprobar que una cuenta no ve los datos de la otra. Si una cuenta ya tiene inmuebles, no se toca.
//
// Los inmuebles de la cuenta de ejemplo reciben ilustraciones sintéticas (prisma/demo-photos.ts) para
// probar la galería, el cartel y el vídeo; el inmueble sin estado se queda sin fotografías a propósito
// (estado vacío). Las fotografías se guardan con el almacenamiento configurado (STORAGE_DRIVER) y pasan
// por las mismas validaciones que una subida real. Con «--photos» se añaden a una base ya sembrada.

export const SEED_EMAIL = 'demo@estateforge.test'
export const SEED_OTHER_EMAIL = 'otra@estateforge.test'

const BASE = {
  operation: 'sale',
  type: 'apartment',
  address: 'Calle de Ejemplo 1',
  city: 'Madrid',
  neighborhood: 'Centro',
  area: 90,
  bedrooms: 3,
  bathrooms: 2,
  condition: 'good',
  elevator: true,
  additionalInformation: '',
} as const

type Seeded = { title: string; price: string; operation?: string; commercialStatus: string | null }

const DEMO_PROPERTIES: Seeded[] = [
  { title: 'Piso en venta en el centro', price: '250000.00', commercialStatus: 'for-sale' },
  { title: 'Ático vendido con terraza', price: '485000.50', commercialStatus: 'sold' },
  { title: 'Estudio por alquilar', price: '950.00', operation: 'rent', commercialStatus: 'for-rent' },
  { title: 'Piso alquilado junto al parque', price: '1200.75', operation: 'rent', commercialStatus: 'rented' },
  // Inmueble anterior al Estado comercial: sin valor guardado.
  { title: 'Inmueble antiguo sin estado', price: '199999.99', commercialStatus: null },
]

async function account(email: string, password: string) {
  return prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, password: await hashPassword(password), emailVerifiedAt: new Date() },
  })
}

async function seedProperties(userId: string, items: Seeded[], withChecklist: boolean) {
  if ((await prisma.property.count({ where: { userId } })) > 0) return false

  await prisma.$transaction(async (tx) => {
    for (const [index, item] of items.entries()) {
      const property = await tx.property.create({
        data: { ...BASE, userId, title: item.title, price: item.price, operation: item.operation ?? BASE.operation, commercialStatus: item.commercialStatus },
      })
      const generation = await tx.generation.create({
        data: {
          propertyId: property.id,
          title: item.title,
          description: `Anuncio de ejemplo para desarrollo. Precio: ${item.price} €.`,
          highlights: JSON.stringify(['90 m²', '3 habitaciones']),
          callToAction: 'Contacta con nosotros.',
          provider: 'mock',
          tone: 'professional',
          language: 'español',
        },
      })
      if (!withChecklist || index !== 0) continue
      // Checklist del primer anuncio: portales marcados, uno con el enlace conservado sin marcar,
      // y dos filas «Otro/a» con nombre y página principal propios.
      await tx.listingPublication.createMany({
        data: [
          { generationId: generation.id, platform: 'idealista', isPublished: true, url: 'https://www.idealista.com/inmueble/000000/' },
          { generationId: generation.id, platform: 'fotocasa', isPublished: true, url: 'https://www.fotocasa.es/es/comprar/vivienda/madrid-capital/000000/d' },
          { generationId: generation.id, platform: 'pisos', isPublished: false, url: 'https://www.pisos.com/comprar/piso-madrid-000000/' },
          { generationId: generation.id, platform: 'other', instanceKey: 'seed-portal-local', position: 0, customName: 'Portal local', homeUrl: 'https://portal-local.example/', isPublished: true, url: 'https://portal-local.example/anuncio/1' },
          { generationId: generation.id, platform: 'other', instanceKey: 'seed-agencia', position: 1, customName: 'Web de la agencia', homeUrl: 'https://agencia.example/', isPublished: false },
        ],
      })
    }
  })
  return true
}

/** Fotografías sintéticas por inmueble de la cuenta de ejemplo (por título), en el orden de la galería. */
const DEMO_PHOTO_COUNT: Record<string, number> = {
  'Piso en venta en el centro': 4,
  'Ático vendido con terraza': 3,
  'Estudio por alquilar': 2,
  'Piso alquilado junto al parque': 3,
}

/** Añade las ilustraciones a los inmuebles de ejemplo que aún no tienen ninguna. Devuelve cuántas. */
export async function seedDemoPhotos(userId: string): Promise<number> {
  const properties = await prisma.property.findMany({
    where: { userId, title: { in: Object.keys(DEMO_PHOTO_COUNT) }, photos: { none: {} } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, title: true },
  })
  let added = 0
  for (const [index, property] of properties.entries()) {
    for (let i = 0; i < DEMO_PHOTO_COUNT[property.title]; i += 1) {
      const scene = DEMO_SCENES[(index + i) % DEMO_SCENES.length]
      const body = demoPhoto(scene, index * 10 + i + 1)
      await addPhoto(null, userId, property.id, { body, declaredType: 'image/png', originalName: `demo-${scene}-${i + 1}.png` })
      added += 1
    }
  }
  return added
}

/** Crea los datos de ejemplo si faltan. Devuelve si ha creado alguno. */
export async function seed(password = process.env.SEED_USER_PASSWORD, options: { photos?: boolean } = {}): Promise<boolean> {
  const host = new URL(process.env.DATABASE_URL ?? 'postgresql://invalido').hostname

  if (!['localhost', '127.0.0.1'].includes(host)) {
    throw new Error('El seed solo se ejecuta contra PostgreSQL en localhost.')
  }

  if (!password) {
    throw new Error('Define SEED_USER_PASSWORD con la contraseña de las cuentas de ejemplo.')
  }

  const demo = await account(SEED_EMAIL, password)
  const other = await account(SEED_OTHER_EMAIL, password)
  const created = [
    await seedProperties(demo.id, DEMO_PROPERTIES, true),
    await seedProperties(other.id, [{ title: 'Inmueble de otra cuenta', price: '320000.00', commercialStatus: 'for-sale' }], false),
  ]
  if (created[0] || options.photos) await seedDemoPhotos(demo.id)

  return created.some(Boolean)
}

// Solo al ejecutarlo como script (pnpm --filter api db:seed), no al importarlo en una prueba.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const photos = process.argv.includes('--photos')
    console.log((await seed(undefined, { photos })) ? 'Datos de ejemplo creados.' : photos ? 'Los datos de ejemplo ya existían; se han completado las fotografías que faltaban.' : 'Los datos de ejemplo ya existían.')
  } finally {
    // Pool propio (DA-38): $disconnect no lo cierra y el proceso no terminaría.
    await closeDatabase()
  }
}
