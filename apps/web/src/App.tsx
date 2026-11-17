
import type { ComponentType } from 'react'
import {
  createBrowserRouter,
  createRoutesFromElements,
  Navigate,
  Route,
  RouterProvider,
} from 'react-router'

import AppLayout from '@/components/layout/AppLayout'
import { ProtectedRoute } from '@/components/auth/ProtectedRoute'

import LoginPage from '@/pages/LoginPage'
import RegisterPage from '@/pages/RegisterPage'
import ForgotPasswordPage from '@/pages/ForgotPasswordPage'
import ResetPasswordPage from '@/pages/ResetPasswordPage'
import RecoverAccountPage from '@/pages/RecoverAccountPage'
import RequestRecoveryLinkPage from '@/pages/RequestRecoveryLinkPage'
import VerifyEmailPage from '@/pages/VerifyEmailPage'
import { OwnerRoute } from '@/components/auth/OwnerRoute'
import NotFoundPage from '@/pages/NotFoundPage'
import { APP_HOME } from '@/lib/routes'

// Las páginas de la aplicación se cargan al visitarlas: el acceso y el registro no descargan el
// código del panel, la galería, el cartel o el vídeo.
const page = (load: () => Promise<{ default: ComponentType }>) => async () => ({ Component: (await load()).default })

// Router de datos: useBlocker, que protege los cambios sin guardar, no funciona con BrowserRouter.
const router = createBrowserRouter(
  createRoutesFromElements(
    <>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/registro" element={<RegisterPage />} />
      <Route path="/recuperar-contrasena" element={<ForgotPasswordPage />} />
      <Route path="/restablecer-contrasena" element={<ResetPasswordPage />} />
      <Route path="/recuperar-cuenta" element={<RecoverAccountPage />} />
      <Route path="/recuperar-cuenta/solicitar" element={<RequestRecoveryLinkPage />} />
      <Route path="/verificar-email" element={<VerifyEmailPage />} />
      {/* «/» es la página pública estática; dentro de la SPA lleva al panel. */}
      <Route path="/" element={<Navigate to={APP_HOME} replace />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path={APP_HOME} lazy={page(() => import('@/pages/DashboardPage'))} />
          <Route path="/inmuebles" lazy={page(() => import('@/pages/PropertiesPage'))} />
          <Route path="/inmuebles/nuevo" lazy={page(() => import('@/pages/NewPropertyPage'))} />
          <Route path="/inmuebles/:id" lazy={page(() => import('@/pages/PropertyDetailPage'))} />
          <Route path="/historial" lazy={page(() => import('@/pages/HistoryPage'))} />
          <Route path="/historial/:id" lazy={page(() => import('@/pages/GenerationDetailPage'))} />
          <Route path="/cuenta" lazy={page(() => import('@/pages/AccountPage'))} />
          <Route element={<OwnerRoute />}>
            <Route path="/admin" lazy={page(() => import('@/pages/AdminPage'))} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </>,
  ),
)

function App() {
  return <RouterProvider router={router} />
}

export default App
