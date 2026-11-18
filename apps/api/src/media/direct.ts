import type { Prisma } from '../generated/prisma/client.js'
import { MediaError } from './media-errors.js'

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
  // Solo la caducidad saca de «processing» un intento ajeno a esta confirmación (cancelar solo afecta a
  // los pendientes). Se deshace la transacción y se responde como una subida caducada, no con un 500.
  if (done.count !== 1) throw new MediaError('UPLOAD_EXPIRED', 'La subida ha caducado. Vuelve a intentarlo.')
}
