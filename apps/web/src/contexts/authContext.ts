import { createContext } from 'react'

import type { AuthUser, EmailChangeResult, RegisterResult } from '@/services/authService'

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
  // Si la verificación del email ya se exige, la cuenta se crea sin sesión (Fase 0).
  register: (
    email: string,
    password: string,
    turnstileToken?: string,
  ) => Promise<RegisterResult>
  logout: () => Promise<void>
  changePassword: (
    currentPassword: string,
    newPassword: string,
  ) => Promise<string>
  deleteAccount: (currentPassword: string) => Promise<string>
  // El cambio está hecho; `securityNoticeSent` indica si se avisó a la dirección anterior.
  updateEmail: (code: string) => Promise<EmailChangeResult>
}

export const AuthContext =
  createContext<AuthContextValue | null>(null)
