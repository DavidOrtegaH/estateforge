import 'dotenv/config'
import { defineConfig, env } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',

  migrations: {
    path: 'prisma/migrations',
  },

  datasource: {
    url: env('DATABASE_URL'),
    // Base de sombra de `migrate dev` creada de antemano: el rol de desarrollo no necesita CREATEDB.
    ...(process.env.SHADOW_DATABASE_URL && { shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL }),
  },
})