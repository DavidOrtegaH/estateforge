import dotenv from 'dotenv'
import { z } from 'zod'

dotenv.config()

// BYOK obligatorio (DA-77): la configuración del servidor no admite ni lee API keys de proveedores de IA
// (GEMINI_API_KEY, OPENAI_API_KEY…). Si quedan en el entorno, se ignoran. Las claves las aporta cada usuario.
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL es requerida'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
})

export const env = envSchema.parse(process.env)