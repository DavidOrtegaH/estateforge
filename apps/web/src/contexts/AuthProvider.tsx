import {
  useEffect,
  useState,
  type ReactNode,
} from 'react'

import * as authService from '@/services/authService'
import type { AuthUser } from '@/services/authService'
import { sessionEndedReasonFrom } from '@/lib/sessionAccess'

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
      const loggedInUser =
        await authService.login(
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
      const registeredUser =
        await authService.register(
          email,
          password,
          turnstileToken,
        )

      setUser(registeredUser)
      setSessionEndedReason(null)
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
      const updatedUser = await authService.verifyEmailChange(code)
      setUser(updatedUser)
      return updatedUser
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
