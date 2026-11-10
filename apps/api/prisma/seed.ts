import 'dotenv/config'

import { prisma } from '../src/db/prisma.js'
import { hashPassword } from '../src/services/password.service.js'

// Datos de ejemplo para desarrollo. Es repetible y se niega a actuar fuera de localhost.
// La contraseña la aporta quien ejecuta el comando: nunca está en el repositorio.

const EMAIL = 'demo@estateforge.test'

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? 'postgresql://invalido').hostname

  if (!['localhost', '127.0.0.1'].includes(host)) {
    throw new Error('El seed solo se ejecuta contra PostgreSQL en localhost.')
  }

  const password = process.env.SEED_USER_PASSWORD

  if (!password) {
    throw new Error('Define SEED_USER_PASSWORD con la contraseña de la cuenta de ejemplo.')
  }

  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    update: {},
    create: {
      email: EMAIL,
      password: await hashPassword(password),
      emailVerifiedAt: new Date(),
    },
  })

  if ((await prisma.property.count({ where: { userId: user.id } })) > 0) {
    console.log('Los datos de ejemplo ya existían.')
    return
  }

  const property = await prisma.property.create({
    data: {
      userId: user.id,
      title: 'Piso de ejemplo en el centro',
      operation: 'sale',
      type: 'apartment',
      price: '250000.00',
      address: 'Calle de Ejemplo 1',
      city: 'Madrid',
      neighborhood: 'Centro',
      area: 90,
      bedrooms: 3,
      bathrooms: 2,
      condition: 'good',
      commercialStatus: 'for-sale',
      elevator: true,
      additionalInformation: '',
    },
  })

  const generation = await prisma.generation.create({
    data: {
      propertyId: property.id,
      title: 'Piso de ejemplo en el centro',
      description: 'Anuncio de ejemplo para desarrollo. Precio: 250.000 €.',
      highlights: JSON.stringify(['90 m²', '3 habitaciones']),
      callToAction: 'Contacta con nosotros.',
      provider: 'mock',
      tone: 'professional',
      language: 'español',
    },
  })

  await prisma.listingPublication.create({
    data: {
      generationId: generation.id,
      platform: 'idealista',
      isPublished: true,
      url: 'https://www.idealista.com/inmueble/000000/',
    },
  })

  console.log('Datos de ejemplo creados.')
}

try {
  await main()
} finally {
  await prisma.$disconnect()
}
