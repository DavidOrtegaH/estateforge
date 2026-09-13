
import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'

import appIcon from '@/assets/appIcon.svg'
import appIconWhite from '@/assets/appIconWhite.svg'
import appLogo from '@/assets/appLogo.svg'
import appLogoWhite from '@/assets/appLogoWhite.svg'

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
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
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
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
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
      strokeLinejoin="round"
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

function SunIcon({
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
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.42 1.42" />
      <path d="m17.65 17.65 1.42 1.42" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.35 17.65-1.42 1.42" />
      <path d="m19.07 4.93-1.42 1.42" />
    </svg>
  )
}

function MoonIcon({
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
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M20.8 14.4A8.7 8.7 0 0 1 9.6 3.2 8.7 8.7 0 1 0 20.8 14.4Z" />
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

function getPageTitle(pathname: string) {
  if (pathname === '/') {
    return 'Dashboard - EstateForge'
  }

  if (pathname === '/inmuebles') {
    return 'Inmuebles - EstateForge'
  }

  if (pathname === '/inmuebles/nuevo') {
    return 'Crear inmueble - EstateForge'
  }

  if (pathname.startsWith('/inmuebles/')) {
    return 'Detalles del inmueble - EstateForge'
  }

  if (pathname === '/historial') {
    return 'Anuncios - EstateForge'
  }

  if (pathname.startsWith('/historial/')) {
    return 'Detalles del anuncio - EstateForge'
  }

  return 'EstateForge'
}

function getInitialDarkMode() {
  if (typeof window === 'undefined') {
    return false
  }

  const storedTheme =
    window.localStorage.getItem('estateforge-theme')

  if (storedTheme === 'dark') {
    return true
  }

  if (storedTheme === 'light') {
    return false
  }

  return window.matchMedia(
    '(prefers-color-scheme: dark)',
  ).matches
}

function AppLayout() {
  const location = useLocation()

  const [isSidebarCollapsed, setIsSidebarCollapsed] =
    useState(false)

  const [isMobileMenuOpen, setIsMobileMenuOpen] =
    useState(false)

  const [isDarkMode, setIsDarkMode] =
    useState(getInitialDarkMode)

  const currentLogo = isDarkMode
    ? appLogoWhite
    : appLogo

  const currentIcon = isDarkMode
    ? appIconWhite
    : appIcon

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

  const handleToggleTheme = () => {
    setIsDarkMode((previous) => {
      const nextTheme = !previous

      document.documentElement.classList.toggle(
        'dark',
        nextTheme,
      )

      window.localStorage.setItem(
        'estateforge-theme',
        nextTheme ? 'dark' : 'light',
      )

      return nextTheme
    })
  }

  // ============================================================
  // TÍTULO DE LA PESTAÑA
  // ============================================================

  useEffect(() => {
    document.title = getPageTitle(
      location.pathname,
    )
  }, [location.pathname])

  // ============================================================
  // SINCRONIZACIÓN DEL MODO OSCURO
  // ============================================================

  useEffect(() => {
    document.documentElement.classList.toggle(
      'dark',
      isDarkMode,
    )
  }, [isDarkMode])

  // ============================================================
  // FAVICON
  // ============================================================

  useEffect(() => {
    const mediaQuery = window.matchMedia(
      '(prefers-color-scheme: dark)',
    )

    const updateFavicon = (
      isSystemDark: boolean,
    ) => {
      let favicon =
        document.querySelector<HTMLLinkElement>(
          "link[rel*='icon']",
        )

      if (!favicon) {
        favicon = document.createElement('link')
        favicon.rel = 'icon'
        document.head.appendChild(favicon)
      }

      favicon.href = isSystemDark
        ? appIconWhite
        : appIcon
    }

    updateFavicon(mediaQuery.matches)

    const handleSystemThemeChange = (
      event: MediaQueryListEvent,
    ) => {
      updateFavicon(event.matches)
    }

    mediaQuery.addEventListener(
      'change',
      handleSystemThemeChange,
    )

    return () =>
      mediaQuery.removeEventListener(
        'change',
        handleSystemThemeChange,
      )
  }, [])

  // ============================================================
  // RESPONSIVE SIDEBAR
  // ============================================================

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        setIsSidebarCollapsed(false)
      }
    }

    handleResize()

    window.addEventListener(
      'resize',
      handleResize,
    )

    return () =>
      window.removeEventListener(
        'resize',
        handleResize,
      )
  }, [])

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
          'border-r border-border bg-card',
          'shadow-xl md:shadow-sm',

          'md:relative md:inset-auto md:z-auto',
          'md:translate-x-0',

          isSidebarCollapsed
            ? 'md:w-19'
            : 'md:w-60',

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
            'border-b border-border',
            'overflow-hidden',
            'transition-[padding] duration-300',

            isSidebarCollapsed
              ? 'justify-start px-4'
              : 'justify-center px-4',
          ].join(' ')}
        >
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

              'max-md:h-20 max-md:w-40',
              'max-md:justify-start',
            ].join(' ')}
          >
            <img
              src={currentLogo}
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
                  ? 'scale-95 opacity-0 md:opacity-0'
                  : 'scale-100 opacity-100',

                'max-md:scale-100 max-md:opacity-100',
              ].join(' ')}
            />

            <img
              src={currentIcon}
              alt="EstateForge"
              aria-hidden={!isSidebarCollapsed}
              className={[
                'absolute left-0 top-1/2',
                '-translate-y-1/2',
                'hidden md:block',
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

          {/* Botón móvil */}

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
              'border border-blue-200/80 dark:border-blue-400/20',
              'bg-blue-50/70 dark:bg-blue-950/30',
              'text-blue-600 dark:text-blue-300',
              'shadow-sm',
              'transition-all duration-200',
              'hover:-translate-y-0.5',
              'hover:bg-blue-50 dark:hover:bg-blue-950/50',
              'hover:text-blue-700 dark:hover:text-blue-200',
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
            'border-b border-border bg-card',
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
                      'text-xs sm:text-sm',
                      'bg-accent text-accent-foreground',
                      'border border-border',
                      'shadow-sm',

                      isFirst
                        ? 'rounded-xl px-3'
                        : 'pl-7 pr-4 rounded-r-xl',

                      isLast
                        ? 'font-semibold text-foreground bg-accent/80'
                        : 'font-medium opacity-90',

                      breadcrumb.to
                        ? [
                            'cursor-pointer',
                            'hover:-translate-y-0.5',
                            'hover:bg-accent/90',
                            'hover:shadow-md',
                          ].join(' ')
                        : 'cursor-default',
                    ].join(' ')

                    const breadcrumbStyle = {
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
                              'text-muted-foreground/70',
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

            {/* =================================================
                TOGGLE MODO OSCURO
                ================================================= */}

            <button
              type="button"
              onClick={handleToggleTheme}
              aria-label={
                isDarkMode
                  ? 'Cambiar a modo claro'
                  : 'Cambiar a modo oscuro'
              }
              title={
                isDarkMode
                  ? 'Modo claro'
                  : 'Modo oscuro'
              }
              className={[
                'flex h-10 w-10 shrink-0',
                'items-center justify-center',
                'rounded-xl',
                'border border-border/80',
                'bg-background',
                'text-muted-foreground',
                'shadow-sm',
                'transition-all duration-200',
                'hover:-translate-y-0.5',
                'hover:bg-accent',
                'hover:text-foreground',
                'hover:shadow-md',
                'focus-visible:outline-none',
                'focus-visible:ring-2',
                'focus-visible:ring-ring',
                'focus-visible:ring-offset-2',
                'focus-visible:ring-offset-background',
              ].join(' ')}
            >
              {isDarkMode ? (
                <SunIcon className="h-5 w-5" />
              ) : (
                <MoonIcon className="h-5 w-5" />
              )}
            </button>
          </div>
        </header>

        {/* ===================================================
            CONTENIDO
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