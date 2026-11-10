import type {
  FastifyInstance,
  FastifyReply,
} from 'fastify'

import {
  IdParamsSchema,
  OTHER_PLATFORM_ID,
  PUBLICATION_PLATFORMS,
  PublicationChecklistUpdateSchema,
  validateOtherUrl,
  validatePublicationUrl,
  type PublicationChecklistUpdate,
  type PublicationUrlResult,
} from '@estateforge/shared'

import { prisma } from '../db/prisma.js'
import { isDatabaseUnavailableError } from '../db/availability.js'

import type { Prisma } from '../generated/prisma/client.js'

import { requireAuth } from '../middleware/auth.middleware.js'

// Checklist de publicación de un anuncio. Solo registra lo que indica el
// usuario: estas rutas nunca visitan los enlaces ni contactan con los portales.

function sendValidationError(
  reply: FastifyReply,
  error: {
    issues: Array<{
      path: PropertyKey[]
      message: string
    }>
  },
) {
  return reply.code(400).send({
    message: 'Datos de entrada no válidos',
    errors: error.issues.map((issue) => ({
      path: issue.path,
      message: issue.message,
    })),
  })
}

function findOwnedGeneration(
  id: string,
  userId: string,
) {
  return prisma.generation.findFirst({
    where: {
      id,
      property: {
        userId,
      },
    },
    select: {
      id: true,
    },
  })
}

async function readChecklist(
  generationId: string,
) {
  const rows =
    await prisma.listingPublication.findMany({
      where: {
        generationId,
      },
      orderBy: {
        position: 'asc',
      },
    })

  return {
    // Siempre una fila por portal del catálogo; sin registro, sin marcar.
    items: PUBLICATION_PLATFORMS.map(
      (platform) => {
        const row = rows.find(
          (candidate) =>
            candidate.platform === platform.id,
        )

        return {
          platform: platform.id,
          isPublished:
            row?.isPublished ?? false,
          url: row?.url ?? null,
        }
      },
    ),
    others: rows
      .filter(
        (row) =>
          row.platform === OTHER_PLATFORM_ID,
      )
      .map((row) => ({
        instanceKey: row.instanceKey,
        name: row.customName,
        homeUrl: row.homeUrl,
        isPublished: row.isPublished,
        url: row.url,
      })),
  }
}

// undefined significa «no tocar el valor guardado». El esquema ya ha validado
// el texto; aquí solo se obtiene su forma normalizada.
function toStored(
  value: string | null | undefined,
  validate: (raw: string) => PublicationUrlResult,
): string | null | undefined {
  if (value === undefined) {
    return undefined
  }

  if (value === null || value.trim() === '') {
    return null
  }

  return validate(value).normalizedUrl ?? null
}

type OtherUpdate = NonNullable<
  PublicationChecklistUpdate['others']
>[number]

// La lista recibida es la definitiva. Se reescriben las filas con posiciones
// consecutivas de 0 a 4, que la base impone; las conservadas mantienen su id y su fecha.
async function replaceOthers(
  tx: Prisma.TransactionClient,
  generationId: string,
  others: OtherUpdate[],
) {
  const where = {
    generationId,
    platform: OTHER_PLATFORM_ID,
  }

  const existing =
    await tx.listingPublication.findMany({
      where,
    })

  const data = others.map((other, position) => {
    const previous = existing.find(
      (row) =>
        row.instanceKey === other.instanceKey,
    )

    const url = toStored(
      other.url,
      validateOtherUrl,
    )

    const homeUrl = toStored(
      other.homeUrl,
      validateOtherUrl,
    )

    const customName =
      other.name === undefined
        ? undefined
        : other.name?.trim() || null

    return {
      id: previous?.id,
      createdAt: previous?.createdAt,
      generationId,
      platform: OTHER_PLATFORM_ID,
      instanceKey: other.instanceKey,
      isPublished: other.isPublished,
      url:
        url === undefined
          ? (previous?.url ?? null)
          : url,
      homeUrl:
        homeUrl === undefined
          ? (previous?.homeUrl ?? null)
          : homeUrl,
      customName:
        customName === undefined
          ? (previous?.customName ?? null)
          : customName,
      position,
    }
  })

  await tx.listingPublication.deleteMany({
    where,
  })

  if (data.length > 0) {
    await tx.listingPublication.createMany({
      data,
    })
  }
}

/**
 * Todo o nada. Se adquiere primero la fila del anuncio, sin cambiar ningún dato:
 * los guardados simultáneos de un mismo anuncio se atienden de uno en uno. Es SQL
 * estándar, válido en SQLite y PostgreSQL, y no pasa por Prisma para no tocar
 * `updatedAt`. Devuelve false si el anuncio ya no existe.
 */
function saveChecklist(
  generationId: string,
  { items, others }: PublicationChecklistUpdate,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const locked =
      await tx.$executeRaw`UPDATE "Generation" SET "title" = "title" WHERE "id" = ${generationId}`

    if (locked !== 1) {
      return false
    }

    for (const item of items) {
      const url = toStored(item.url, (raw) =>
        validatePublicationUrl(item.platform, raw),
      )

      await tx.listingPublication.upsert({
        where: {
          generationId_platform_instanceKey: {
            generationId,
            platform: item.platform,
            instanceKey: '',
          },
        },
        create: {
          generationId,
          platform: item.platform,
          isPublished: item.isPublished,
          url: url ?? null,
        },
        update: {
          isPublished: item.isPublished,
          ...(url !== undefined && { url }),
        },
      })
    }

    if (others) {
      await replaceOthers(
        tx,
        generationId,
        others,
      )
    }

    return true
  })
}

// Colisión con otra escritura: la base la ha rechazado y no se ha guardado nada.
export function isWriteConflict(error: unknown): boolean {
  // Base no disponible (por ejemplo, P2028 «Unable to start a transaction in the given time», sin
  // conexión dentro de maxWait): no es un conflicto, la responde el manejador global con 503 (DA-37).
  if (isDatabaseUnavailableError(error)) return false

  const code = (error as { code?: unknown } | null)
    ?.code

  // Unicidad, conflicto o interbloqueo de PostgreSQL, y transacción caducada esperando un bloqueo.
  return code === 'P2002' || code === 'P2034' || code === 'P2028'
}

export function registerPublicationRoutes(
  app: FastifyInstance,
) {
  app.get(
    '/api/generations/:id/publications',
    {
      preHandler: requireAuth,
    },
    async (request, reply) => {
      const paramsResult =
        IdParamsSchema.safeParse(request.params)

      if (!paramsResult.success) {
        return sendValidationError(
          reply,
          paramsResult.error,
        )
      }

      const { id } = paramsResult.data

      const userId = request.userId

      // Sin este control, un userId nulo coincidiría con inmuebles sin propietario.
      if (!userId) {
        return reply.code(401).send({
          message:
            'Se requiere una sesión activa.',
        })
      }

      if (
        !(await findOwnedGeneration(
          id,
          userId,
        ))
      ) {
        return reply.code(404).send({
          message: 'Generation not found',
        })
      }

      return readChecklist(id)
    },
  )

  app.put(
    '/api/generations/:id/publications',
    {
      preHandler: requireAuth,
    },
    async (request, reply) => {
      const paramsResult =
        IdParamsSchema.safeParse(request.params)

      if (!paramsResult.success) {
        return sendValidationError(
          reply,
          paramsResult.error,
        )
      }

      const bodyResult =
        PublicationChecklistUpdateSchema.safeParse(
          request.body,
        )

      if (!bodyResult.success) {
        return sendValidationError(
          reply,
          bodyResult.error,
        )
      }

      const { id } = paramsResult.data

      const userId = request.userId

      // Sin este control, un userId nulo coincidiría con inmuebles sin propietario.
      if (!userId) {
        return reply.code(401).send({
          message:
            'Se requiere una sesión activa.',
        })
      }

      if (
        !(await findOwnedGeneration(
          id,
          userId,
        ))
      ) {
        return reply.code(404).send({
          message: 'Generation not found',
        })
      }

      try {
        if (
          !(await saveChecklist(
            id,
            bodyResult.data,
          ))
        ) {
          return reply.code(404).send({
            message: 'Generation not found',
          })
        }
      } catch (error) {
        if (isWriteConflict(error)) {
          return reply.code(409).send({
            message:
              'El Checklist ha cambiado mientras se guardaba. Recarga la ficha e inténtalo de nuevo.',
          })
        }

        throw error
      }

      return readChecklist(id)
    },
  )
}
