import {
  BrowserRouter,
  Route,
  Routes,
} from 'react-router'

import AppLayout from '@/components/layout/AppLayout'
import CookieNotice from '@/components/layout/CookieNotice'
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
import AccountPage from '@/pages/AccountPage'
import PrivacyPage from '@/pages/PrivacyPage'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/registro" element={<RegisterPage />} />
        <Route path="/recuperar-contrasena" element={<ForgotPasswordPage />} />
        <Route path="/restablecer-contrasena" element={<ResetPasswordPage />} />
        <Route path="/privacidad" element={<PrivacyPage />} />

        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/inmuebles" element={<PropertiesPage />} />
            <Route path="/inmuebles/nuevo" element={<NewPropertyPage />} />
            <Route path="/inmuebles/:id" element={<PropertyDetailPage />} />
            <Route path="/historial" element={<HistoryPage />} />
            <Route path="/historial/:id" element={<GenerationDetailPage />} />
            <Route path="/cuenta" element={<AccountPage />} />
          </Route>
        </Route>
      </Routes>
      <CookieNotice />
    </BrowserRouter>
  )
}

export default App
