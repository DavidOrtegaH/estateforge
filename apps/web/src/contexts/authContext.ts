import { createContext } from 'react'

import type { AuthUser } from '@/services/authService'

export interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
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
}

export const AuthContext =
  createContext<AuthContextValue | null>(null)
