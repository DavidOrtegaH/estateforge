import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'

import appIcon from '@/assets/appIcon.svg'
import appLogo from '@/assets/appLogo.svg'

type NavigationItem = {
  label: string
  to: string
  icon:
    | 'dashboard'
    | 'properties'
    | 'create'
    | 'announcements'
}

type BreadcrumbItem = {
  label: string
  to?: string
}

function NavigationIcon({
  type,
  className = 'h-5 w-5',
}: {
  type: NavigationItem['icon']
  className?: string
}) {
  if (type === 'dashboard') {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
      >
        <rect
          x="3"
          y="3"
          width="7"
          height="7"
          rx="1.5"
        />
        <rect
          x="14"
          y="3"
          width="7"
          height="7"
          rx="1.5"
        />
        <rect
          x="3"
          y="14"
          width="7"
          height="7"
          rx="1.5"
        />
        <rect
          x="14"
          y="14"
          width="7"
          height="7"
          rx="1.5"
        />
      </svg>
    )
  }

  if (type === 'properties') {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
      >
        <path d="M3.5 10.5 12 3l8.5 7.5" />
        <path d="M5.5 9.5V21h13V9.5" />
        <path d="M9 21v-6h6v6" />
      </svg>
    )
  }

  if (type === 'create') {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
      >
        <rect
          x="3.5"
          y="3.5"
          width="17"
          height="17"
          rx="3"
        />
        <path d="M12 8v8" />
        <path d="M8 12h8" />
      </svg>
    )
  }

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect
        x="3"
        y="4"
        width="18"
        height="16"
        rx="2.5"
      />
      <path d="M7 9h10" />
      <path d="M7 13h6" />
      <path d="M7 17h8" />
    </svg>
  )
}

function MenuIcon({
  className = 'h-5 w-5',
}: {
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </svg>
  )
}

function CloseIcon({
  className = 'h-5 w-5',
}: {
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
    >
      <path d="m6 6 12 12" />
      <path d="m18 6-12 12" />
    </svg>
  )
}

function ChevronLeftIcon({
  className = 'h-4 w-4',
}: {
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  )
}

function ChevronRightIcon({
  className = 'h-4 w-4',
}: {
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  )
}

const navigationItems: NavigationItem[] = [
  {
    label: 'Dashboard',
    to: '/',
    icon: 'dashboard',
  },
  {
    label: 'Inmuebles',
    to: '/inmuebles',
    icon: 'properties',
  },
  {
    label: 'Crear inmueble',
    to: '/inmuebles/nuevo',
    icon: 'create',
  },
  {
    label: 'Anuncios',
    to: '/historial',
    icon: 'announcements',
  },
]

function getBreadcrumbs(
  pathname: string,
): BreadcrumbItem[] {
  if (pathname === '/') {
    return [
      {
        label: 'Dashboard',
      },
    ]
  }

  if (pathname === '/inmuebles') {
    return [
      {
        label: 'Dashboard',
        to: '/',
      },
      {
        label: 'Inmuebles',
      },
    ]
  }

  if (pathname === '/inmuebles/nuevo') {
    return [
      {
        label: 'Dashboard',
        to: '/',
      },
      {
        label: 'Inmuebles',
        to: '/inmuebles',
      },
      {
        label: 'Crear inmueble',
      },
    ]
  }

  if (pathname.startsWith('/inmuebles/')) {
    return [
      {
        label: 'Dashboard',
        to: '/',
      },
      {
        label: 'Inmuebles',
        to: '/inmuebles',
      },
      {
        label: 'Detalles del inmueble',
      },
    ]
  }

  if (pathname === '/historial') {
    return [
      {
        label: 'Dashboard',
        to: '/',
      },
      {
        label: 'Anuncios',
      },
    ]
  }

  if (pathname.startsWith('/historial/')) {
    return [
      {
        label: 'Dashboard',
        to: '/',
      },
      {
        label: 'Anuncios',
        to: '/historial',
      },
      {
        label: 'Detalles del anuncio',
      },
    ]
  }

  return [
    {
      label: 'Dashboard',
      to: '/',
    },
  ]
}

function AppLayout() {
  const location = useLocation()

  const [isSidebarCollapsed, setIsSidebarCollapsed] =
    useState(false)

  const [isMobileMenuOpen, setIsMobileMenuOpen] =
    useState(false)

  const breadcrumbs = getBreadcrumbs(
    location.pathname,
  )

  const closeMobileMenu = () => {
    setIsMobileMenuOpen(false)
  }

  const handleToggleSidebar = () => {
    if (window.innerWidth < 768) {
      closeMobileMenu()
    } else {
      setIsSidebarCollapsed((previous) => !previous)
    }
  }

  return (
    <div className="flex min-h-screen w-full max-w-full overflow-x-hidden bg-background">
      {/* =====================================================
          OVERLAY MOBILE
          ===================================================== */}

      <div
        className={[
          'fixed inset-0 z-40 bg-black/30',
          'transition-opacity duration-300',
          'md:hidden',

          isMobileMenuOpen
            ? 'pointer-events-auto opacity-100'
            : 'pointer-events-none opacity-0',
        ].join(' ')}
        aria-hidden="true"
        onClick={closeMobileMenu}
      />

      {/* =====================================================
          SIDEBAR
          ===================================================== */}

      <aside
        className={[
          'fixed inset-y-0 left-0 z-50',
          'flex shrink-0 flex-col',
          'border-r bg-card',
          'shadow-xl md:shadow-sm',

          // Desktop
          'md:relative md:inset-auto md:z-auto',
          'md:translate-x-0',

          // Ancho estable: evita saltos del contenido
          isSidebarCollapsed
            ? 'md:w-19'
            : 'md:w-60',

          // Mobile
          'w-60',
          'transition-[width,transform]',
          'duration-300',
          'ease-in-out',

          isMobileMenuOpen
            ? 'translate-x-0'
            : '-translate-x-full',
        ].join(' ')}
      >
        {/* ===================================================
            LOGO
            =================================================== */}

        <div
          className={[
            'relative flex h-24 shrink-0',
            'items-center',
            'border-b',
            'overflow-hidden',
            'transition-[padding] duration-300',

            isSidebarCollapsed
              ? 'justify-start px-4'
              : 'justify-center px-4',
          ].join(' ')}
        >
          {/* Contenedor real del logo.
              El logo NUNCA puede superar este espacio. */}

          <NavLink
            to="/"
            onClick={closeMobileMenu}
            aria-label="Ir al Dashboard"
            title="Dashboard"
            className={[
              'relative flex min-w-0 items-center',
              'overflow-hidden',

              isSidebarCollapsed
                ? 'h-20 w-12 justify-start'
                : 'h-20 w-44 justify-center',

              // En móvil reservamos espacio para el botón
              'max-md:h-20 max-md:w-40',
              'max-md:justify-start',
            ].join(' ')}
          >
            {/* Logo completo */}
            <img
              src={appLogo}
              alt="EstateForge"
              aria-hidden={isSidebarCollapsed}
              className={[
                'absolute left-0 top-1/2',
                '-translate-y-1/2',
                'block',
                'h-auto',
                'max-h-20',
                'max-w-full',
                'object-contain',
                'object-left',
                'transition-[opacity,transform]',
                'duration-300',
                'ease-in-out',

                isSidebarCollapsed
                  ? 'scale-95 opacity-0'
                  : 'scale-100 opacity-100',
              ].join(' ')}
            />

            {/* Icono compacto */}
            <img
              src={appIcon}
              alt="EstateForge"
              aria-hidden={!isSidebarCollapsed}
              className={[
                'absolute left-0 top-1/2',
                '-translate-y-1/2',
                'block',
                'h-12 w-12',
                'object-contain',
                'transition-[opacity,transform]',
                'duration-300',
                'ease-in-out',

                isSidebarCollapsed
                  ? 'scale-100 opacity-100'
                  : 'scale-95 opacity-0',
              ].join(' ')}
            />
          </NavLink>

          {/* Botón móvil separado del área del logo */}

          <button
            type="button"
            onClick={closeMobileMenu}
            aria-label="Cerrar menú"
            title="Cerrar menú"
            className={[
              'absolute right-3 top-1/2',
              '-translate-y-1/2',
              'flex h-9 w-9 shrink-0',
              'items-center justify-center',
              'rounded-lg',
              'border border-border/80',
              'bg-background',
              'text-muted-foreground',
              'transition',
              'hover:bg-accent',
              'hover:text-foreground',
              'md:hidden',
            ].join(' ')}
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        {/* ===================================================
            NAVEGACIÓN
            =================================================== */}

        <nav
          aria-label="Navegación principal"
          className={[
            'flex min-h-0 flex-1',
            'flex-col gap-1',
            'overflow-y-auto overflow-x-hidden',
            'p-3',
          ].join(' ')}
        >
          {navigationItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={
                item.to === '/' ||
                item.to === '/inmuebles' ||
                item.to === '/historial'
              }
              onClick={closeMobileMenu}
              title={
                isSidebarCollapsed
                  ? item.label
                  : undefined
              }
              className={({ isActive }) =>
                [
                  'group relative flex h-11 shrink-0',
                  'items-center rounded-xl',
                  'text-sm font-medium',
                  'transition-colors duration-200',

                  isSidebarCollapsed
                    ? 'w-11 justify-center px-0'
                    : 'w-full gap-3 px-3',

                  isActive
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                ].join(' ')
              }
            >
              {({ isActive }) => (
                <>
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                    <NavigationIcon
                      type={item.icon}
                      className="h-5 w-5 transition-transform duration-200 group-hover:scale-[1.04]"
                    />
                  </span>

                  {/* 
                    El texto NO ocupa espacio en el layout.
                    Así la anchura del sidebar permanece estable
                    durante la animación.
                  */}

                  <span
                    className={[
                      'pointer-events-none absolute',
                      'left-13',
                      'whitespace-nowrap',
                      'leading-none',
                      'transition-[opacity,visibility]',
                      'duration-150',

                      isSidebarCollapsed
                        ? 'invisible opacity-0'
                        : 'visible opacity-100',
                    ].join(' ')}
                  >
                    {item.label}
                  </span>

                  {!isSidebarCollapsed &&
                    isActive && (
                      <span
                        className={[
                          'absolute right-3',
                          'h-1.5 w-1.5',
                          'rounded-full',
                          'bg-primary-foreground/90',
                        ].join(' ')}
                      />
                    )}
                </>
              )}
            </NavLink>
          ))}

          {/* =================================================
              BOTÓN CONTRAER / CERRAR
              ================================================= */}

          <div className="my-3 shrink-0 border-t border-border/70" />

          <button
            type="button"
            onClick={handleToggleSidebar}
            title={
              isSidebarCollapsed
                ? 'Expandir menú'
                : 'Contraer menú'
            }
            aria-label={
              isSidebarCollapsed
                ? 'Expandir menú'
                : 'Contraer menú'
            }
            className={[
              'group relative flex h-11 shrink-0',
              'items-center rounded-xl',
              'border border-blue-200/80',
              'bg-blue-50/70',
              'text-blue-600',
              'shadow-sm',
              'transition-all duration-200',
              'hover:-translate-y-0.5',
              'hover:bg-blue-50',
              'hover:text-blue-700',
              'hover:shadow-md',

              isSidebarCollapsed
                ? 'w-11 justify-center px-0'
                : 'w-full gap-3 px-3',
            ].join(' ')}
          >
            <span
              className={[
                'flex h-5 w-5 shrink-0',
                'items-center justify-center',
                'transition-transform duration-300',
                isSidebarCollapsed
                  ? 'rotate-180'
                  : 'rotate-0',
              ].join(' ')}
            >
              <ChevronLeftIcon className="h-5 w-5" />
            </span>

            <span
              className={[
                'pointer-events-none absolute',
                'left-13',
                'whitespace-nowrap',
                'leading-none',
                'font-medium',
                'transition-[opacity,visibility]',
                'duration-150',

                isSidebarCollapsed
                  ? 'invisible opacity-0'
                  : 'visible opacity-100',
              ].join(' ')}
            >
              Contraer menú
            </span>
          </button>
        </nav>
      </aside>

      {/* =====================================================
          MAIN
          ===================================================== */}

      <main
        className={[
          'min-w-0 w-0 flex-1',
          'max-w-full',
          'overflow-x-hidden',
        ].join(' ')}
      >
        {/* ===================================================
            HEADER
            =================================================== */}

        <header
          className={[
            'flex h-24 w-full min-w-0',
            'items-center',
            'border-b bg-card',
            'px-4 sm:px-6 lg:px-8',
          ].join(' ')}
        >
          <div className="flex min-w-0 w-full items-center gap-3">
            {/* Botón móvil */}

            <button
              type="button"
              onClick={() =>
                setIsMobileMenuOpen(true)
              }
              aria-label="Abrir menú"
              title="Abrir menú"
              className={[
                'flex h-10 w-10 shrink-0',
                'items-center justify-center',
                'rounded-xl',
                'border border-border/80',
                'bg-background',
                'text-muted-foreground',
                'transition',
                'hover:bg-accent',
                'hover:text-foreground',
                'md:hidden',
              ].join(' ')}
            >
              <MenuIcon className="h-5 w-5" />
            </button>

            {/* =================================================
                BREADCRUMBS

                Se mantiene el estilo original:
                - gradiente azul
                - borde translúcido
                - sombra azul
                - chevron/notch
                - borde derecho completamente recto
                ================================================= */}

            <nav
              aria-label="Navegación de ruta"
              className={[
                'min-w-0 flex-1',
                'overflow-x-auto overflow-y-hidden',
                'scrollbar-none',
                '[&::-webkit-scrollbar]:hidden',
              ].join(' ')}
            >
              <ol className="flex min-w-max items-center py-2 pr-1">
                {breadcrumbs.map(
                  (breadcrumb, index) => {
                    const isFirst = index === 0
                    const isLast =
                      index ===
                      breadcrumbs.length - 1

                    const breadcrumbClassName = [
                      'relative flex h-9 shrink-0',
                      'items-center',
                      'transition-all duration-200',
                      'select-none',

                      isFirst
                        ? 'rounded-xl px-3'
                        : 'pl-7 pr-4 rounded-r-xl',

                      isLast
                        ? 'font-semibold'
                        : 'font-medium',

                      breadcrumb.to
                        ? [
                            'cursor-pointer',
                            'hover:-translate-y-0.5',
                            'hover:brightness-105',
                            'hover:shadow-md',
                          ].join(' ')
                        : 'cursor-default',
                    ].join(' ')

                    const breadcrumbStyle = {
                      background: isFirst
                        ? 'linear-gradient(135deg, rgba(239,246,255,0.98), rgba(219,234,254,0.92))'
                        : 'linear-gradient(135deg, rgba(219,234,254,0.94), rgba(191,219,254,0.82))',

                      border:
                        '1px solid rgba(147,197,253,0.48)',

                      boxShadow:
                        '0 2px 7px rgba(37,99,235,0.10)',

                      clipPath: isFirst
                        ? undefined
                        : 'polygon(12px 0, 100% 0, 100% 100%, 12px 100%, 24px 50%)',
                    }

                    return (
                      <li
                        key={`${breadcrumb.label}-${index}`}
                        className="flex items-center"
                      >
                        {!isFirst && (
                          <span
                            aria-hidden="true"
                            className={[
                              'relative z-10',
                              '-mr-3',
                              'flex h-9 w-6',
                              'items-center justify-center',
                              'text-blue-500/70',
                              'pointer-events-none',
                            ].join(' ')}
                          >
                            <ChevronRightIcon className="h-3.5 w-3.5" />
                          </span>
                        )}

                        {breadcrumb.to ? (
                          <NavLink
                            to={breadcrumb.to}
                            onClick={closeMobileMenu}
                            className={
                              breadcrumbClassName
                            }
                            style={breadcrumbStyle}
                          >
                            <span className="relative z-20">
                              {breadcrumb.label}
                            </span>
                          </NavLink>
                        ) : (
                          <span
                            aria-current={
                              isLast
                                ? 'page'
                                : undefined
                            }
                            className={[
                              breadcrumbClassName,
                              'relative',
                            ].join(' ')}
                            style={breadcrumbStyle}
                          >
                            <span className="relative z-20">
                              {breadcrumb.label}
                            </span>
                          </span>
                        )}
                      </li>
                    )
                  },
                )}
              </ol>
            </nav>
          </div>
        </header>

        {/* ===================================================
            CONTENIDO

            min-w-0 es especialmente importante aquí:
            permite que flex reduzca correctamente el área
            disponible en móvil en lugar de mantener un
            ancho intrínseco que provoque overflow.
            =================================================== */}

        <div
          className={[
            'w-full min-w-0 max-w-full',
            'overflow-x-hidden',
            'p-4 sm:p-6 lg:p-8',
          ].join(' ')}
        >
          <Outlet />
        </div>
      </main>
    </div>
  )
}

export default AppLayout