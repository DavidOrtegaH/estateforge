# EstateForge — aplicación web

Interfaz de EstateForge: cuentas, inmuebles, generación de anuncios, historial, cuenta del usuario y panel de administración. La instalación general, la API y sus variables están en el [README principal](../../README.md).

## Tecnologías

React 19, React Router 8, Vite 8 (`@vitejs/plugin-react`), TypeScript, Tailwind CSS 4 (`@tailwindcss/vite`), componentes Base UI / shadcn, iconos Lucide y el paquete compartido `@estateforge/shared`. Tests con Vitest y lint con Oxlint.

## Estructura (`src/`)

| Carpeta | Contenido |
|---|---|
| `pages/` | Una página por ruta (login, registro, recuperación, dashboard, inmuebles, historial, cuenta, administración) |
| `components/` | `auth/` (`ProtectedRoute`, `OwnerRoute`), `layout/` (`AppLayout`, con menú lateral y diálogo de cierre de sesión), `security/` (`TurnstileField`) y `ui/` |
| `contexts/`, `hooks/` | `AuthProvider` y `useAuth` (sesión actual), `useModalDialog` (foco y teclado de los diálogos) |
| `services/` | Llamadas a la API (`authService`, `adminService`, `propertyService`, `generationService`…) |
| `lib/` | Lógica pura probada sin DOM: acceso a rutas privadas, foco de diálogos, estado y acciones del panel de administración, auditoría, recuperación de cuentas |

## Rutas

| Ruta | Página | Acceso |
|---|---|---|
| `/login`, `/registro` | Inicio de sesión y registro | Pública |
| `/recuperar-contrasena`, `/restablecer-contrasena` | Recuperación de contraseña por email | Pública |
| `/recuperar-cuenta`, `/recuperar-cuenta/solicitar` | Recuperación obligatoria tras un incidente y solicitud de un enlace nuevo | Pública |
| `/` | Dashboard | Sesión iniciada |
| `/inmuebles`, `/inmuebles/nuevo`, `/inmuebles/:id` | Inmuebles y generación de anuncios | Sesión iniciada |
| `/historial`, `/historial/:id` | Historial de generaciones | Sesión iniciada |
| `/cuenta` | Cuenta del usuario y claves de IA | Sesión iniciada |
| `/admin` | Panel de administración | Solo OWNER |

`ProtectedRoute` no muestra contenido privado mientras se comprueba la sesión. Si la API cierra la sesión por el estado de la cuenta (423 de `/api/auth/me`), redirige al login con el motivo, que se muestra como aviso.

## Desarrollo

Desde la raíz del repositorio (con la API en marcha; `pnpm dev` arranca las dos):

```bash
pnpm --filter web dev        # http://localhost:5173
pnpm --filter web test       # Vitest
pnpm --filter web typecheck  # tsc -b
pnpm --filter web lint       # Oxlint
pnpm --filter web build      # tsc -b && vite build → dist/
pnpm --filter web preview    # sirve el build
```

Los tests no tienen entorno DOM: se prueba la lógica de `src/lib` y `src/services`, no el renderizado de las páginas. El comportamiento visual (foco de los diálogos, diseño móvil…) se comprueba a mano.

## Configuración

Variables opcionales en `apps/web/.env.local` (plantilla: [`.env.example`](.env.example)):

| Variable | Por defecto | Uso |
|---|---|---|
| `VITE_API_URL` | `http://localhost:3000` | URL base de la API |
| `VITE_TURNSTILE_SITE_KEY` | vacía | Clave pública de Turnstile; vacía, los formularios no muestran el widget |

## Relación con la API

- Todas las peticiones van a `VITE_API_URL` con `credentials: 'include'`: la sesión es la cookie `HttpOnly` `estateforge_session` que pone la API.
- La API solo acepta por CORS el origen de `CORS_ORIGIN`, que debe ser la URL de esta web.
- Si se usa Turnstile, la clave pública va aquí y la secreta (`TURNSTILE_SECRET_KEY`) en la API.
- Los textos de error de la API se muestran tal cual. Algunos 423 se reconocen por su texto exacto (protección, suspensión y recuperación pendiente), porque la API no devuelve un código de error.
