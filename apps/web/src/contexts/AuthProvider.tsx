import {
  useEffect,
  useState,
  type ReactNode,
} from 'react'

import * as authService from '@/services/authService'
import type { AuthUser } from '@/services/authService'
import { sessionEndedReasonFrom } from '@/lib/sessionAccess'
import {
  loginWithSessionState,
  registerWithSessionState,
  updateEmailWithSessionState,
} from '@/lib/authSession'

import { AuthContext } from './authContext'

interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({
  children,
}: AuthProviderProps) {
  const [user, setUser] =
    useState<AuthUser | null>(null)

  const [loading, setLoading] = useState(true)

  const [sessionEndedReason, setSessionEndedReason] =
    useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const currentUser =
          await authService.getCurrentUser()

        if (!cancelled) {
          setUser(currentUser)
        }
      } catch (error) {
        if (!cancelled) {
          setUser(null)
          // Si la API cerró la sesión por el estado de la cuenta, se conserva su motivo.
          setSessionEndedReason(sessionEndedReasonFrom(error))
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [])

  const value = {
    user,
    loading,
    sessionEndedReason,

    login: async (
      email: string,
      password: string,
      turnstileToken?: string,
    ) => {
      // El usuario de /me, con el estado de verificación del email (Fase 0.3a).
      const loggedInUser =
        await loginWithSessionState(
          authService,
          email,
          password,
          turnstileToken,
        )

      setUser(loggedInUser)
      setSessionEndedReason(null)
    },

    register: async (
      email: string,
      password: string,
      turnstileToken?: string,
    ) => {
      const result =
        await registerWithSessionState(
          authService,
          email,
          password,
          turnstileToken,
        )

      // Solo hay sesión si la API la abrió; si falta verificar el email, no la hay (Fase 0).
      // Con sesión, el usuario es el de /me (Fase 0.3a).
      if (result.kind === 'session') setUser(result.user)
      setSessionEndedReason(null)
      return result
    },

    logout: async () => {
      await authService.logout()
      setUser(null)
    },

    changePassword: async (
      currentPassword: string,
      newPassword: string,
    ) =>
      authService.changePassword(
        currentPassword,
        newPassword,
      ),

    updateEmail: async (code: string) => {
      // El usuario de /me, con el estado de verificación del email (Fase 0.3a), y si se pudo
      // avisar a la dirección anterior (decisión D4).
      const result = await updateEmailWithSessionState(authService, code)
      setUser(result.user)
      return result
    },

    deleteAccount: async (currentPassword: string) => {
      const message =
        await authService.deleteAccount(currentPassword)

      setUser(null)
      return message
    },
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}
