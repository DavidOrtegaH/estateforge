import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    env: {
      NODE_ENV: 'test',
      // Sin servidor: una prueba unitaria que toque la base falla enseguida. Las de integración usan la suya.
      DATABASE_URL: 'postgresql://sin-base:sin-base@127.0.0.1:1/ef_unit',
      GEMINI_API_KEY: 'test-gemini-key',
      CORS_ORIGIN: 'http://localhost:5173',
    },
  },
})