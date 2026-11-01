import { Navigate, Outlet } from 'react-router'
import { useAuth } from '@/hooks/useAuth'

export function OwnerRoute() {
  const { user, loading } = useAuth()
  if (loading) return <div className="flex min-h-screen items-center justify-center"><p className="text-sm text-muted-foreground">Comprobando permisos...</p></div>
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== 'OWNER') return <Navigate to="/" replace />
  return <Outlet />
}
