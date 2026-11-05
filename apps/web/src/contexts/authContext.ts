import { createContext } from 'react'

import type { AuthUser } from '@/services/authService'

export interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
  // Motivo que dio la API al cerrar la sesión al cargarla (423 de /me); null si no hubo.
  sessionEndedReason: string | null
  login: (
    email: string,
    password: string,
    turnstileToken?: string,
  ) => Promise<void>
  register: (
    email: string,
    password: string,
    turnstileToken?: string,
  ) => Promise<void>
  logout: () => Promise<void>
  changePassword: (
    currentPassword: string,
    newPassword: string,
  ) => Promise<string>
  deleteAccount: (currentPassword: string) => Promise<string>
  updateEmail: (code: string) => Promise<AuthUser>
}

export const AuthContext =
  createContext<AuthContextValue | null>(null)
