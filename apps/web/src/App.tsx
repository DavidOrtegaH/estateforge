
import {
  createBrowserRouter,
  createRoutesFromElements,
  Route,
  RouterProvider,
} from 'react-router'

import AppLayout from '@/components/layout/AppLayout'
import { ProtectedRoute } from '@/components/auth/ProtectedRoute'

import DashboardPage from '@/pages/DashboardPage'
import PropertiesPage from '@/pages/PropertiesPage'
import NewPropertyPage from '@/pages/NewPropertyPage'
import PropertyDetailPage from '@/pages/PropertyDetailPage'
import HistoryPage from '@/pages/HistoryPage'
import GenerationDetailPage from '@/pages/GenerationDetailPage'
import LoginPage from '@/pages/LoginPage'
import RegisterPage from '@/pages/RegisterPage'
import ForgotPasswordPage from '@/pages/ForgotPasswordPage'
import ResetPasswordPage from '@/pages/ResetPasswordPage'
import RecoverAccountPage from '@/pages/RecoverAccountPage'
import RequestRecoveryLinkPage from '@/pages/RequestRecoveryLinkPage'
import VerifyEmailPage from '@/pages/VerifyEmailPage'
import AccountPage from '@/pages/AccountPage'
import AdminPage from '@/pages/AdminPage'
import { OwnerRoute } from '@/components/auth/OwnerRoute'

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

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/inmuebles" element={<PropertiesPage />} />
          <Route path="/inmuebles/nuevo" element={<NewPropertyPage />} />
          <Route path="/inmuebles/:id" element={<PropertyDetailPage />} />
          <Route path="/historial" element={<HistoryPage />} />
          <Route path="/historial/:id" element={<GenerationDetailPage />} />
          <Route path="/cuenta" element={<AccountPage />} />
          <Route element={<OwnerRoute />}>
            <Route path="/admin" element={<AdminPage />} />
          </Route>
        </Route>
      </Route>
    </>,
  ),
)

function App() {
  return <RouterProvider router={router} />
}

export default App
