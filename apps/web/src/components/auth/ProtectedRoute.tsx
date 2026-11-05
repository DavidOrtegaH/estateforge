import {
  Navigate,
  Outlet,
  useLocation,
} from 'react-router'

import { useAuth } from '@/hooks/useAuth'
import {
  loginRedirectState,
  protectedRouteDecision,
} from '@/lib/sessionAccess'

export function ProtectedRoute() {
  const { user, loading, sessionEndedReason } = useAuth()
  const location = useLocation()
  const decision = protectedRouteDecision({ loading, user, sessionEndedReason })

  if (decision.kind === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">
          Cargando sesión...
        </p>
      </div>
    )
  }

  if (decision.kind === 'redirect') {
    // El login recibe la ruta de origen y, si la API cerró la sesión, su motivo.
    return (
      <Navigate
        to="/login"
        replace
        state={loginRedirectState(location, decision.sessionEndedReason)}
      />
    )
  }

  return <Outlet />
}
