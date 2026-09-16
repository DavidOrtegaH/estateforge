import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'file:./test.db',
      GEMINI_API_KEY: 'test-gemini-key',
      CORS_ORIGIN: 'http://localhost:5173',
    },
  },
})