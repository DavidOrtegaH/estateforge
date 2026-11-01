import 'dotenv/config'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { prisma } from '../src/db/prisma.js'

async function main() {
  const emailArg = process.argv.slice(2).find((arg) => arg.startsWith('--email='))
  const email = emailArg?.slice('--email='.length).trim().toLowerCase()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Uso: pnpm --filter api exec tsx scripts/promote-owner.ts --email=tu-correo@dominio.com')
  }

  const ownerCount = await prisma.user.count({ where: { role: 'OWNER' } })
  if (ownerCount > 0) throw new Error('Ya existe un propietario. El comando de inicialización solo puede utilizarse una vez.')

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, role: true, securityHoldAt: true } })
  if (!user) throw new Error('No existe una cuenta con ese email. Registra primero tu cuenta normal e inténtalo de nuevo.')
  if (user.role !== 'USER' || user.securityHoldAt) throw new Error('La cuenta no tiene el rol USER esperado; no se ha realizado ningún cambio.')

  const rl = createInterface({ input, output })
  try {
    output.write(`\nSe asignará el rol OWNER a: ${user.email}\n`)
    output.write('Esto concede acceso administrativo completo al panel.\n')
    const confirmation = await rl.question('Escribe exactamente CONVERTIR EN PROPIETARIO para continuar: ')
    if (confirmation !== 'CONVERTIR EN PROPIETARIO') {
      output.write('Operación cancelada.\n')
      return
    }
    const result = await prisma.user.updateMany({ where: { id: user.id, role: 'USER', securityHoldAt: null }, data: { role: 'OWNER' } })
    if (result.count !== 1) throw new Error('No se pudo confirmar la asignación; revisa el estado de la cuenta.')
    output.write('Rol OWNER asignado correctamente. Cierra sesión y vuelve a iniciarla para actualizar los permisos.\n')
  } finally {
    rl.close()
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Error inesperado'
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
}).finally(async () => {
  await prisma.$disconnect()
})
