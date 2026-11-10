import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client.js'

import { buildPoolConfig } from './connection-config.js'

// Cliente único por proceso: el adaptador crea el pool y lo cierra con $disconnect.
const adapter = new PrismaPg(
  buildPoolConfig(process.env),
)

export const prisma = new PrismaClient({
  adapter,
})
