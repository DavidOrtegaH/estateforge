import type { Prisma } from '../generated/prisma/client.js'

// Orden único de bloqueos para las transacciones de una cuenta (Fase 1, corrección B, F0-001).
//
// Las transacciones que escriben a la vez la fila de la cuenta (User) y alguno de sus registros
// dependientes (tokens de verificación, de recuperación o de incidente, códigos de cambio de
// email, sesiones) adquieren primero la fila de User y después el resto. Antes, las que se
// consumen con un token (verificación del email, cambio de email, recuperación E2, restablecimiento
// de contraseña y denuncia de incidente) reclamaban primero el token y después escribían la cuenta,
// mientras que la emisión de enlaces, las acciones del panel y la propia recuperación escribían
// primero la cuenta y después los tokens. En PostgreSQL, dos transacciones con órdenes contrarios
// sobre la misma cuenta pueden interbloquearse.
//
// Con la fila de User adquirida primero, las transacciones de una misma cuenta se serializan en
// ese punto: la segunda espera al COMMIT o al ROLLBACK de la primera y, en READ COMMITTED, sus
// lecturas posteriores ven ya el estado confirmado.

/**
 * Adquiere el bloqueo de escritura de la fila de la cuenta dentro de la transacción, sin cambiar
 * ningún dato: una actualización que asigna a `role` su propio valor. Es SQL estándar, válido en
 * SQLite y en PostgreSQL. No pasa por el cliente de Prisma para no tocar `updatedAt`, y no
 * modifica columnas de clave (en PostgreSQL toma un bloqueo FOR NO KEY UPDATE, que no impide crear
 * registros dependientes con clave foránea hacia la cuenta).
 *
 * Devuelve false si la cuenta no existe. En SQLite, la propia escritura hace de la transacción
 * una transacción de escritura: las del mismo cliente ya se serializan con el Mutex del adaptador.
 */
export async function lockUserRow(tx: Prisma.TransactionClient, userId: string): Promise<boolean> {
  const affected = await tx.$executeRaw`UPDATE "User" SET "role" = "role" WHERE "id" = ${userId}`
  return affected === 1
}
