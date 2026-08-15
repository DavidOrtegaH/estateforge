import { BrowserRouter, Route, Routes } from 'react-router'

import AppLayout from '@/components/layout/AppLayout'

import DashboardPage from '@/pages/DashboardPage'
import PropertiesPage from '@/pages/PropertiesPage'
import NewPropertyPage from '@/pages/NewPropertyPage'
import PropertyDetailPage from '@/pages/PropertyDetailPage'
import HistoryPage from '@/pages/HistoryPage'
import GenerationDetailPage from '@/pages/GenerationDetailPage'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route
            path="/"
            element={<DashboardPage />}
          />

          <Route
            path="/inmuebles"
            element={<PropertiesPage />}
          />

          <Route
            path="/inmuebles/nuevo"
            element={<NewPropertyPage />}
          />

          <Route
            path="/inmuebles/:id"
            element={<PropertyDetailPage />}
          />

          <Route
            path="/historial"
            element={<HistoryPage />}
          />

          <Route
            path="/historial/:id"
            element={<GenerationDetailPage />}
          />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App