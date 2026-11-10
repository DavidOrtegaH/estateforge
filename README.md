# EstateForge

Plataforma SaaS basada en inteligencia artificial generativa para la automatización del marketing inmobiliario: el usuario registra sus inmuebles y genera anuncios con un proveedor de IA.

Trabajo Fin de Máster — Máster en IA Generativa. Estado: 🚧 en desarrollo.

## Funcionalidades

- **Cuentas:** registro, inicio y cierre de sesión (cookie `HttpOnly`), verificación del email con un enlace (exigible por fechas, con periodo de gracia para las cuentas existentes), recuperación y cambio de contraseña, cambio de email con código de verificación y eliminación de la cuenta. Protección opcional contra bots con Cloudflare Turnstile.
- **Inmuebles:** listado con filtros, detalle, edición y borrado (individual y múltiple). Cada inmueble pertenece a su usuario y tiene un Estado comercial (en venta, vendido, por alquilar o alquilado).
- **Generación de anuncios:** con Gemini, OpenAI o un proveedor simulado (`mock`, sin clave), historial de generaciones con filtros y panel de estadísticas.
- **Checklist de publicación:** en cada anuncio se marcan los portales en los que se ha publicado manualmente, se conserva cada enlace y se accede a la página principal de cada portal. Admite hasta cinco plataformas adicionales. EstateForge no publica en los portales: lo hace el usuario desde cada uno.
- **Claves de IA del usuario:** se pueden guardar cifradas (AES-256-GCM) para Gemini y OpenAI; se usan solo si se agota la cuota de la clave del servidor.
- **Seguridad de la cuenta:** protección por incidente cuando el titular no reconoce un cambio de email, recuperación obligatoria con contraseña nueva y aviso en el login cuando la API cierra una sesión abierta. Ver [docs/seguridad](docs/README.md).
- **Panel de administración** (`/admin`, solo cuentas OWNER): resumen, usuarios con su estado, suspender y reactivar cuentas, cerrar sesiones, retirar la protección por incidente, corregir el destino de recuperación, reenviar el enlace y auditoría con filtros.

## Tecnologías

| Parte | Tecnologías |
|---|---|
| API (`apps/api`) | Node.js, TypeScript, Fastify 5 (`@fastify/cors`, `@fastify/rate-limit`), Prisma 7 con PostgreSQL 17 mediante `@prisma/adapter-pg`, Zod 4, Nodemailer (SMTP), `@google/genai` (Gemini) y `openai` |
| Web (`apps/web`) | React 19, React Router 8, Vite 8, TypeScript, Tailwind CSS 4, componentes Base UI / shadcn, iconos Lucide |
| Compartido (`packages/shared`) | Tipos, etiquetas y validaciones (Zod 3) usados por la API y la web |
| Herramientas | pnpm (workspace), Vitest, Oxlint, `tsx` |

Modelos usados por los proveedores (en el código): Gemini `gemini-3.6-flash` y OpenAI `gpt-5.5`.

## Estructura

```
apps/
  api/                 API Fastify
    prisma/            esquema (schema.prisma) y migraciones
    scripts/           promote-owner.ts: asigna el primer OWNER
    src/
      ai/              proveedores de IA (gemini, openai, mock)
      routes/          endpoints (auth, admin, propiedades, generaciones, claves de IA, dashboard)
      services/        lógica de negocio (sesiones, correo, recuperación, cifrado, Turnstile…)
      middleware/      requireAuth y requireOwner
      db/              cliente Prisma
      integration/     pruebas de integración con PostgreSQL real
  web/                 aplicación React (ver apps/web/README.md)
packages/
  shared/              código compartido entre API y web
docs/                  documentación (seguridad)
```

## Requisitos

- Node.js. El proyecto no declara una versión mínima (`engines`); se desarrolla con Node.js 24.
- pnpm (el repositorio es un workspace de pnpm: `pnpm-workspace.yaml`).
- Un servidor SMTP para los correos (recuperación de contraseña, cambio de email, avisos de incidente y recuperación obligatoria). En desarrollo se ha usado Brevo.
- Una API key de Gemini (obligatoria para arrancar la API, ver más abajo) y, opcionalmente, de OpenAI.

## Instalación y puesta en marcha

1. **Dependencias**, desde la raíz:

   ```bash
   pnpm install
   ```

2. **Configuración de la API.** Copia `apps/api/.env.example` a `apps/api/.env` y rellena los valores (sección [Variables de entorno](#variables-de-entorno)). La API carga `apps/api/.env` con `dotenv` al arrancar.

3. **Configuración de la web (opcional).** Si la API no está en `http://localhost:3000` o usas Turnstile, copia `apps/web/.env.example` a `apps/web/.env.local`.

4. **Cliente de Prisma.** Se genera en `apps/api/src/generated/prisma`, que no está versionado:

   ```bash
   pnpm --filter api exec prisma generate
   ```

5. **Base de datos.** Necesitas PostgreSQL 17. Define `DATABASE_URL` y aplica las migraciones versionadas (detalle en [docs/postgresql.md](docs/postgresql.md)):

   ```bash
   pnpm --filter api db:migrate
   ```


6. **Arranque en desarrollo** (API y web a la vez):

   ```bash
   pnpm dev
   ```

   La API escucha en `http://localhost:3000` (fijado en `apps/api/src/server.ts`) y la web en el puerto por defecto de Vite, `http://localhost:5173`.

7. **Primer OWNER.** Registra una cuenta normal desde la web y conviértela en propietaria (solo funciona si todavía no hay ninguna; pide confirmación escrita):

   ```bash
   pnpm --filter api exec tsx scripts/promote-owner.ts --email=tu-correo@dominio.com
   ```

## Scripts

Desde la raíz:

| Comando | Qué hace |
|---|---|
| `pnpm dev` | Arranca la API (`tsx watch src/server.ts`) y la web (`vite`) en paralelo |
| `pnpm test` | Ejecuta los tests de todos los paquetes, uno tras otro |
| `pnpm test:api` / `pnpm test:web` / `pnpm test:shared` | Tests de un solo paquete |
| `pnpm typecheck` | Comprobación de tipos de shared, API y web |
| `pnpm --filter web lint` | Oxlint de la web |
| `pnpm --filter web build` | Build de producción de la web (`tsc -b && vite build`, en `apps/web/dist`) |
| `pnpm --filter api build` | Compila la API con `tsc` |

El `package.json` raíz también define `build` (`tsc -b && vite build`) y `preview` (`vite preview`), los mismos comandos que la web, pero en la raíz no hay `tsconfig` ni configuración de Vite (están en `apps/web`); para compilar o previsualizar la web usa los comandos con `--filter web`. El `lint` de la raíz ejecuta solo `oxlint`, sin TypeScript ni Vite, pero en la raíz no hay `.oxlintrc.json`: la configuración de Oxlint del proyecto es `apps/web/.oxlintrc.json`, así que para el lint de la web con esa configuración usa `pnpm --filter web lint`.

### Tests

- **API:** Vitest con un Prisma simulado en memoria; las suites de `src/integration` usan PostgreSQL real, con una base temporal por suite (requieren `TEST_POSTGRES_ADMIN_URL`; ver [docs/postgresql.md](docs/postgresql.md)).
- **Web:** Vitest sin entorno DOM. Se prueba la lógica extraída (`src/lib`, `src/services`), no el renderizado de las páginas.
- Los tests que importan `apps/api/src/app.ts` (`src/cors.test.ts` y `src/routes/security.routes.test.ts`) cargan también `apps/api/.env` a través de `dotenv`; las variables de `vitest.config.ts` tienen prioridad.

## Variables de entorno

### API (`apps/api/.env`)

Plantilla: [`apps/api/.env.example`](apps/api/.env.example). Nunca subas el `.env` real al repositorio.

| Variable | Obligatoria | Uso |
|---|---|---|
| `DATABASE_URL` | Sí | Conexión `postgresql://`. Sin ella la API no arranca. El pool y el SSL se describen en [docs/postgresql.md](docs/postgresql.md). |
| `GEMINI_API_KEY` | Sí | Clave del servidor para Gemini. La valida `src/env.ts` al arrancar, aunque solo se use el proveedor `mock` u OpenAI. |
| `OPENAI_API_KEY` | No | Clave del servidor para OpenAI. Sin ella, generar con OpenAI requiere que el usuario aporte su clave. |
| `ESTATEFORGE_API_KEY_ENCRYPTION_KEY` | Para guardar claves de IA | Clave AES-256 de 32 bytes, en base64 o en hexadecimal, para cifrar las claves de IA que guardan los usuarios. |
| `CORS_ORIGIN` | No (por defecto `http://localhost:5173`) | Único origen web permitido por CORS; debe coincidir con la URL de la web. |
| `WEB_APP_URL` | No (por defecto `http://localhost:5173`) | URL de la web en los enlaces de los correos (restablecer contraseña, recuperación obligatoria). |
| `API_PUBLIC_URL` | No (por defecto `http://localhost:3000`) | URL pública de la API en los enlaces que la apuntan (aviso de incidente). |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Para enviar correos | Servidor, credenciales y remitente. Si falta alguna, el envío falla con un error. |
| `SMTP_PORT` | No (por defecto `587`) | Puerto SMTP. |
| `SMTP_SECURE` | No | `true` o `false`; si se omite, es `true` solo con el puerto 465. |
| `SUPPORT_EMAIL` | No | Contacto de soporte que se añade a algunos correos. |
| `EMAIL_VERIFICATION_REQUIRED_FROM` | No | Fecha ISO 8601 con zona horaria desde la que las cuentas nuevas deben verificar el email. Vacía: no se exige a nadie. Ver [Verificación del email](docs/seguridad/verificacion-email.md#2-política-periodo-de-gracia-y-avisos). |
| `EMAIL_VERIFICATION_GRACE_UNTIL` | No | Fecha ISO 8601 con zona horaria hasta la que las cuentas existentes sin verificar siguen entrando. Vacía: la gracia no termina. Requiere la anterior. |
| `EMAIL_VERIFICATION_TOKEN_TTL_HOURS` | No (por defecto `24`) | Validez del enlace de verificación, en horas enteras de 1 a 168. Un valor que no sea un número entero entre 1 y 168 impide arrancar la API. |
| `TURNSTILE_SECRET_KEY` | No | Clave secreta de Turnstile. Sin ella, la API no verifica Turnstile (modo de desarrollo). |
| `TURNSTILE_EXPECTED_HOSTNAME` | No | Si se indica, rechaza tokens de Turnstile de otro hostname. |
| `NODE_ENV` | No (por defecto `development`) | Con `production`, la cookie de sesión lleva `Secure` (requiere HTTPS). |
| `AI_PROVIDER` | No (por defecto `gemini`) | Se valida en `src/env.ts`, pero el código actual no la usa: el proveedor se elige en cada generación. |

### Web (`apps/web/.env.local`)

Plantilla: [`apps/web/.env.example`](apps/web/.env.example).

| Variable | Obligatoria | Uso |
|---|---|---|
| `VITE_API_URL` | No (por defecto `http://localhost:3000`) | URL base de la API. |
| `VITE_TURNSTILE_SITE_KEY` | No | Clave pública de Turnstile. Sin ella, los formularios no muestran el widget. Debe configurarse junto con `TURNSTILE_SECRET_KEY` en la API. |

`TURNSTILE.env.example`, en la raíz, resume las tres variables de Turnstile.

### Producción

- `NODE_ENV=production` y HTTPS (la cookie de sesión pasa a ser `Secure`).
- `CORS_ORIGIN`, `WEB_APP_URL` y `API_PUBLIC_URL` con las URL reales, y `VITE_API_URL` en el build de la web.
- Turnstile configurado en ambos lados y, si procede, `TURNSTILE_EXPECTED_HOSTNAME`.

## Documentación

- [Índice de la documentación](docs/README.md)
- [Protección por incidente y su versionado](docs/seguridad/proteccion-por-incidente.md)
- [Recuperación obligatoria tras un incidente](docs/seguridad/recuperacion-obligatoria.md)
- [Verificación del email](docs/seguridad/verificacion-email.md)
- [Aplicación web](apps/web/README.md)
