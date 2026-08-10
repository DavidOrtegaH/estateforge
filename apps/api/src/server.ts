import Fastify from 'fastify'
import cors from '@fastify/cors'
import type {
  GeneratedListing,
  Property,
} from '@estateforge/shared'

const app = Fastify({
  logger: true,
})

await app.register(cors, {
  origin: 'http://localhost:5173',
})

app.get('/health', async () => {
  return {
    status: 'ok',
    service: 'estateforge-api',
  }
})

app.post('/api/generations', async (request) => {
  const body = request.body as {
    property: Property
  }

  console.log('Property received:', body.property)

  const listing: GeneratedListing = {
    title: 'Título generado desde la API',
    description:
      'Descripción generada desde el backend de EstateForge.',
    highlights: [
      '3 habitaciones',
      '2 baños',
      'Terraza',
    ],
    callToAction:
      'Contacta con nosotros para concertar una visita.',
  }

  return {
    listing,
  }
})

const start = async () => {
  try {
    await app.listen({
      port: 3000,
      host: 'localhost',
    })
  } catch (error) {
    app.log.error(error)
    process.exit(1)
  }
}

start()