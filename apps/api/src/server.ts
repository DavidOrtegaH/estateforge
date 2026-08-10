import Fastify from 'fastify'

const app = Fastify({
  logger: true,
})

app.get('/health', async () => {
  return {
    status: 'ok',
    service: 'estateforge-api',
  }
})

app.post('/api/generations', async (request) => {
  const body = request.body as {
    property: unknown
  }

  console.log('Property received:', body.property)

  return {
    listing: {
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
    },
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