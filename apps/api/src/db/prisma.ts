import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'

import { PrismaClient } from '../generated/prisma/client.js'

import { buildPoolConfig } from './connection-config.js'

// Cliente único por proceso. El pool es propio, no del adaptador (DA-38): con un pool del
// adaptador, $disconnect lo cierra pero la siguiente consulta abre otro, de modo que el trabajo
// que llega después del cierre volvía a conectar. Un pool propio cerrado rechaza ese trabajo
// («Cannot use a pool after calling end on the pool»), que se responde como 503.
const pool = new pg.Pool(buildPoolConfig(process.env))

// Un error de una conexión inactiva (por ejemplo, el servidor la corta) no debe tumbar el proceso:
// el pool la descarta y la siguiente consulta usa otra. Sin el mensaje, que puede citar el host.
pool.on('error', () => {})

const adapter = new PrismaPg(pool)

export const prisma = new PrismaClient({
  adapter,
})

let closing: Promise<void> | null = null

/** Cierra el cliente y el pool, una sola vez. Después, toda consulta falla sin reconectar. */
export function closeDatabase(): Promise<void> {
  closing ??= (async () => {
    try {
      await prisma.$disconnect()
    } finally {
      await pool.end()
    }
  })()
  return closing
}
