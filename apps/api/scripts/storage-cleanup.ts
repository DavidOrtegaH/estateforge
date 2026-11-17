import 'dotenv/config'
import { prisma } from '../src/db/prisma.js'
import { drainStorageCleanup, findOrphans } from '../src/media/storage-cleanup.js'

// Mantenimiento del almacenamiento de archivos (DA-46).
//   pnpm --filter api storage:cleanup            reintenta los borrados pendientes de StorageCleanup
//   pnpm --filter api storage:cleanup --orphans  además informa de archivos sin referencia
// Los huérfanos solo se cuentan: una subida en curso también aparece como huérfana durante unos
// segundos, así que borrarlos automáticamente podría eliminar un archivo que está a punto de quedar
// referenciado. No se imprimen claves completas ni datos de usuarios.

async function main() {
  let total = { deleted: 0, failed: 0 }
  for (;;) {
    const round = await drainStorageCleanup(null, undefined, 200)
    total = { deleted: total.deleted + round.deleted, failed: total.failed + round.failed }
    if (round.deleted === 0) break
  }
  const pending = await prisma.storageCleanup.count()
  process.stdout.write(`Archivos borrados: ${total.deleted}. Fallos en esta ejecución: ${total.failed}. Pendientes en la cola: ${pending}.\n`)

  if (process.argv.includes('--orphans')) {
    const orphans = await findOrphans()
    process.stdout.write(`Archivos sin referencia en PostgreSQL: ${orphans.length}.\n`)
    if (orphans.length > 0) process.stdout.write('Revísalos con la aplicación detenida antes de decidir si se eliminan.\n')
  }
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.name : 'Error'}: no se ha podido completar la limpieza.\n`)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
