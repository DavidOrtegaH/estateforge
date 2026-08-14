import { BrowserRouter, Route, Routes } from 'react-router'
import AppLayout from '@/components/layout/AppLayout'
import DashboardPage from '@/pages/DashboardPage'
import PropertiesPage from '@/pages/PropertiesPage'
import NewPropertyPage from '@/pages/NewPropertyPage'
import PropertyDetailPage from '@/pages/PropertyDetailPage'


function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/inmuebles" element={<PropertiesPage />} />
          <Route
            path="/inmuebles/nuevo"
            element={<NewPropertyPage />}
          />
          <Route
            path="/inmuebles/:id"
            element={<PropertyDetailPage />}
          />
        </Route>
        <Route
          path="/inmuebles/:id"
          element={<PropertyDetailPage />}
        />
      </Routes>
    </BrowserRouter>
  )
}

export default App