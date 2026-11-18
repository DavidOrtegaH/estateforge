# Desarrollo y configuración de EstateForge

Guía técnica para mantener el proyecto: arquitectura, instalación local, pruebas y variables. Para utilizar la aplicación, consulta el [README principal](../README.md). Los permisos sobre el código se describen en la [licencia](../LICENSE).

## Tecnologías

| Parte | Tecnologías |
|---|---|
| API (`apps/api`) | Node.js 24, TypeScript, Fastify 5, Prisma 7 con PostgreSQL 17 (`@prisma/adapter-pg`), Zod, Nodemailer, `@vercel/blob` |
| Web (`apps/web`) | React 19, React Router 8, Vite 8, TypeScript, Tailwind CSS 4, Base UI / shadcn, iconos Lucide |
| Compartido (`packages/shared`) | Tipos, etiquetas y validaciones usados por la API y la web |
| Herramientas | pnpm 11 (workspace), Vitest, Oxlint, `tsx`, GitHub Actions |

## Arquitectura

```
Navegador ── /, /privacidad, /condiciones ──► HTML estático (sin JavaScript)
   │
   ├── /panel, /inmuebles, /cuenta… ──► SPA React (app.html)
   │
   ├── /api/* ──► API Fastify ──► PostgreSQL (metadatos)
   │                  └──────────► almacenamiento privado (firma URLs, valida y borra)
   │
   └── PUT / GET con URL firmada ──► almacenamiento privado (los archivos no pasan por la API)
```

```
apps/
  api/        API Fastify: rutas, servicios, IA, almacenamiento, Prisma (esquema y migraciones)
  web/        página pública estática y SPA React; vercel.json y tooling/ (SEO y rutas)
packages/
  shared/     código compartido entre la API y la web
scripts/      arranque de PostgreSQL en WSL y herramientas de Git (política de commits)
docs/         documentación del producto, la seguridad, el despliegue y la publicación
```

## Puesta en marcha en local

Requisitos: **Node.js 24**, **pnpm 11.20** (`corepack enable` usa la versión de `packageManager`) y **PostgreSQL 17**. No hace falta ninguna clave de IA. Para los correos (verificación y recuperación) hace falta un servidor SMTP; sin él, esos envíos fallan con un error y el resto funciona.

1. Instala las dependencias desde la raíz, tal como fija el lockfile:

   ```bash
   pnpm install --frozen-lockfile
   ```

2. Copia `apps/api/.env.example` a `apps/api/.env` y rellena al menos `DATABASE_URL` y `ESTATEFORGE_API_KEY_ENCRYPTION_KEY` ([variables](#variables-de-entorno)). El `.env` está ignorado por Git.
3. Opcional: copia `apps/web/.env.example` a `apps/web/.env.local` si la API no está en `http://localhost:3000` o si usas Turnstile.
4. Genera el cliente de Prisma y aplica las migraciones:

   ```bash
   pnpm --filter api db:generate
   pnpm --filter api db:migrate
   ```

   En Windows con WSL hay scripts que instalan y arrancan un PostgreSQL de desarrollo solo en localhost: [docs/postgresql.md](postgresql.md).

5. Arranca la API y la web:

   ```bash
   pnpm dev        # con el PostgreSQL de WSL (lo arranca si está detenido)
   pnpm dev:apps   # con cualquier otro PostgreSQL ya en marcha
   ```

   La web queda en `http://localhost:5173` (la presentación en `/`, la aplicación en `/panel`) y la API en `http://localhost:3000`.

6. Primer OWNER: registra una cuenta desde la web y conviértela en propietaria (solo si aún no hay ninguna; pide confirmación):

   ```bash
   pnpm --filter api exec tsx --conditions=development scripts/promote-owner.ts --email=tu-correo@dominio.com
   ```

   Datos de ejemplo ficticios, solo contra localhost: `pnpm --filter api db:seed`.

## Pruebas y calidad

| Comando | Qué hace |
|---|---|
| `pnpm lint` | Oxlint |
| `pnpm typecheck` | Tipos de shared, API y web |
| `pnpm test` | Tests de shared, web y API, uno tras otro. Las suites de integración de la API usan PostgreSQL real y necesitan `TEST_POSTGRES_ADMIN_URL` (un servidor en localhost; cada suite crea y borra su propia base) |
| `pnpm test:scripts` | Tests de los scripts de `scripts/` |
| `pnpm build` | Construye los tres paquetes en orden topológico (primero `packages/shared/dist`); la web queda en `apps/web/dist` |
| `pnpm --filter api check:shared-runtime` | Importa `@estateforge/shared` con Node sin cargador y comprueba que resuelve al JavaScript compilado (necesita antes `pnpm --filter @estateforge/shared build`) |
| `pnpm preview` | Sirve la web construida con las rutas y cabeceras de producción |
| `pnpm check:commits` | Comprueba la [política de mensajes de commit](commit-message-policy.md) |

### Paquete compartido: fuente en desarrollo, JavaScript compilado en producción

`packages/shared/package.json` exporta tres condiciones:

| Condición | Destino | Quién la usa |
|---|---|---|
| `types` | `src/index.ts` | `tsc` de la API y de la web (no necesita compilar `shared` antes) |
| `development` | `src/index.ts` | Vite en desarrollo, Vitest y los scripts `tsx` de la API (`dev`, `db:seed` y `storage:cleanup` pasan `--conditions=development`) |
| `default` | `dist/index.js` | Node sin cargador (la función de Vercel de la API) y `vite build` de la web |

`dist/` no está en el repositorio. `pnpm --filter @estateforge/shared build` lo borra y lo regenera con `tsc -p tsconfig.build.json` (sin los tests), así que nunca quedan módulos obsoletos. Tras un clon e instalación limpios, desarrollo, tipos y tests funcionan sin `dist`. Solo lo necesitan la ejecución con Node puro y la construcción de producción, que lo construyen antes. Si ejecutas con `tsx` un script propio que importe `shared`, añade `--conditions=development`; si no, usará `dist` (o fallará si no existe).

La integración continua ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) ejecuta todo lo anterior con un PostgreSQL efímero y una auditoría de dependencias de producción. No usa secretos ni despliega nada.

Además de los tests del repositorio, la versión 1.0.0 se ha probado en Edge, Chrome y Firefox de escritorio con pruebas de extremo a extremo propias (fuera del repositorio) contra la API, la web y PostgreSQL en local, con los simuladores de IA y de almacenamiento y sin acceso a Internet.

## Variables de entorno

### API (`apps/api/.env`)

Plantilla: [`apps/api/.env.example`](../apps/api/.env.example). Nunca subas el `.env` real.

| Variable | Obligatoria | Uso |
|---|---|---|
| `DATABASE_URL` | Sí | Conexión `postgresql://`. Sin ella la API no arranca. Pool y TLS en [docs/postgresql.md](postgresql.md) |
| `ESTATEFORGE_API_KEY_ENCRYPTION_KEY` | Para guardar claves de IA | Clave interna AES-256 de 32 bytes (base64 o hexadecimal) con la que se cifran las claves de los usuarios. No da acceso a ningún proveedor |
| `CORS_ORIGIN`, `WEB_APP_URL`, `API_PUBLIC_URL` | No (localhost) | Origen de la web, URL de la web en los correos y URL pública de la API |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_SECURE`, `SUPPORT_EMAIL` | Para enviar correos | Servidor y remitente |
| `EMAIL_VERIFICATION_REQUIRED_FROM`, `EMAIL_VERIFICATION_GRACE_UNTIL`, `EMAIL_VERIFICATION_TOKEN_TTL_HOURS` | No | Política de verificación del email ([detalle](seguridad/verificacion-email.md)) |
| `TURNSTILE_SECRET_KEY`, `TURNSTILE_EXPECTED_HOSTNAME` | No | Verificación de Turnstile en la API |
| `NODE_ENV` | No | `production` activa la cookie `Secure` y prohíbe el disco local como almacenamiento |
| `STORAGE_DRIVER`, `STORAGE_LOCAL_DIR`, `STORAGE_LOCAL_SIGNED_URLS`, `STORAGE_LOCAL_SIGNING_SECRET`, `STORAGE_USER_QUOTA_MB` | No | Almacenamiento local (desarrollo) o `vercel-blob`, simulador de URLs firmadas y cuota por usuario |
| `BLOB_READ_WRITE_TOKEN` / `BLOB_STORE_ID` | Con `vercel-blob` | Acceso al Blob store privado, solo en el servidor |
| `CLIENT_IP_SOURCE` | No | `socket` (por defecto, y el valor de producción). `vercel` existe en el código, pero no se activa: la comprobación desde dos redes quedó fuera de alcance y MD-4 es un riesgo aceptado ([detalle](despliegue/vercel-neon-blob.md#ip-del-cliente-detrás-de-vercel-md-4)) |
| `AI_MEDIA_SIMULATOR`, `AI_SIMULATOR_DELAY_MS`, `AI_MEDIA_MAX_CONCURRENT`, `AI_MEDIA_DAILY_LIMIT`, `AI_MEDIA_MONTHLY_LIMIT` | No | Simulador local de IA (nunca en producción) y límites por usuario |

No existe ninguna variable para claves de proveedores de IA: cada usuario usa la suya.

### Web

| Variable | Uso |
|---|---|
| `VITE_API_URL` | URL base de la API; vacía, rutas relativas (API bajo el mismo dominio, como en producción) |
| `VITE_TURNSTILE_SITE_KEY` | Clave pública de Turnstile; vacía, sin widget |
| `SITE_URL` | Solo en la construcción: origen público canónico. En la producción de Vercel se usa su dominio de producción; sin origen, o en una vista previa, nada se indexa |

## Despliegue

La aplicación está publicada en Vercel (web y API), con Neon y Vercel Blob privado; el estado comprobado y lo pendiente están en la [guía de Vercel, Neon y Vercel Blob](despliegue/vercel-neon-blob.md#estado-actual). No apliques migraciones ni uses datos reales en un entorno externo sin comprobar primero su destino y configuración.
