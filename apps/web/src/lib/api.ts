export const DEFAULT_API_URL = 'http://localhost:3000'

export function resolveApiUrl(value: string | undefined): string {
  return (value ?? DEFAULT_API_URL).replace(/\/+$/, '')
}

export const API_URL = resolveApiUrl(import.meta.env.VITE_API_URL)
