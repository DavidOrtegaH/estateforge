import { NavLink, Outlet } from 'react-router'

function AppLayout() {
  return (
    <div className="flex min-h-screen bg-background">
      <aside className="w-64 border-r bg-card">
        <div className="border-b px-6 py-5">
          <h1 className="text-xl font-bold">EstateForge</h1>
          <p className="text-sm text-muted-foreground">
            AI Real Estate
          </p>
        </div>

        <nav className="space-y-1 p-4">
          <NavLink
            to="/"
            end
            className="block rounded-md px-3 py-2 text-sm hover:bg-muted"
          >
            Dashboard
          </NavLink>

          <NavLink
            to="/inmuebles"
            className="block rounded-md px-3 py-2 text-sm hover:bg-muted"
          >
            Inmuebles
          </NavLink>

          <NavLink
            to="/inmuebles/nuevo"
            className="block rounded-md px-3 py-2 text-sm hover:bg-muted"
          >
            Crear inmueble
          </NavLink>

          <NavLink
            to="/historial"
            className="block rounded-md px-3 py-2 text-sm hover:bg-muted"
          >
            Historial
          </NavLink>
        </nav>
      </aside>

      <main className="flex-1">
        <header className="border-b px-8 py-4">
          <span className="text-sm text-muted-foreground">
            EstateForge
          </span>
        </header>

        <div className="p-8">
          <Outlet />
        </div>
      </main>
    </div>
  )
}

export default AppLayout