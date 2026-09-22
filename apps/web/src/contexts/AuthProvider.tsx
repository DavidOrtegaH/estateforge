import {
  useEffect,
  useState,
  type ReactNode,
} from 'react'

import * as authService from '@/services/authService'
import type { AuthUser } from '@/services/authService'

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

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const currentUser =
          await authService.getCurrentUser()

        if (!cancelled) {
          setUser(currentUser)
        }
      } catch {
        if (!cancelled) {
          setUser(null)
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

    login: async (
      email: string,
      password: string,
    ) => {
      const loggedInUser =
        await authService.login(email, password)

      setUser(loggedInUser)
    },

    register: async (
      email: string,
      password: string,
    ) => {
      const registeredUser =
        await authService.register(
          email,
          password,
        )

      setUser(registeredUser)
    },

    logout: async () => {
      await authService.logout()
      setUser(null)
    },
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}