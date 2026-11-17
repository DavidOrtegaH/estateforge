import type { Prisma } from '../generated/prisma/client.js'

// Confirmación de una subida directa (DA-58) dentro de la transacción del recurso: el archivo ya está
// en el almacenamiento, en la clave que eligió la API al preparar la subida. La reserva del propio
// intento se excluye de las comprobaciones de cuota y el intento queda completado en la misma
// transacción que crea o actualiza el recurso, de modo que nunca cuenta dos veces ni queda a medias.

export interface DirectCommit {
  key: string
  attemptId: string
}

export async function completeAttempt(tx: Prisma.TransactionClient, direct: DirectCommit, resultId: string): Promise<void> {
  const done = await tx.uploadAttempt.updateMany({ where: { id: direct.attemptId, status: 'processing' }, data: { status: 'completed', resultId, completedAt: new Date() } })
  if (done.count !== 1) throw new Error('El intento de subida ya no está en curso.')
}
