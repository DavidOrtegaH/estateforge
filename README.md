# EstateForge

Aplicación web para preparar el material de los anuncios inmobiliarios: la ficha de cada inmueble, sus fotografías, el texto del anuncio, un cartel, un vídeo corto y el registro de los portales en los que se publica. La IA es opcional y funciona con la clave de cada usuario.

Proyecto personal. Versión **1.0.0**. La interfaz está en español.

> **Estado:** el código de la versión 1.0.0 está probado en local y preparado para publicarse como repositorio de solo lectura. El despliegue en Vercel, Neon y Vercel Blob está preparado pero **no se ha realizado**, y ningún proveedor de IA real se ha llamado todavía: esas integraciones solo se han validado con simuladores locales. Detalle en [Limitaciones conocidas](#limitaciones-conocidas).

## Qué hace

- **Cuentas:** registro, inicio y cierre de sesión (cookie `HttpOnly`), verificación del email, recuperación y cambio de contraseña, cambio de email con verificación y eliminación de la cuenta. Protección opcional contra bots con Cloudflare Turnstile.
- **Inmuebles:** listado con búsqueda, filtros, orden y paginación; detalle, edición y borrado (individual y múltiple). Cada inmueble pertenece a su usuario y tiene un estado comercial (en venta, vendido, por alquilar o alquilado).
- **Anuncios:** en español o en inglés, con cuatro tonos, generados con una plantilla local sin IA o con un proveedor de IA usando la clave del propio usuario. Siempre se pueden editar a mano. Historial con filtros y estadísticas.
- **Galería:** hasta 50 fotografías (JPEG, PNG o WebP) por inmueble, con miniaturas, orden, portada, sustitución y borrado. Se comprueba el contenido real de cada archivo y se guarda de forma privada. Ver [galería, cartel y vídeo](docs/producto-galeria-cartel-video.md).
- **Cartel y vídeo:** se componen en el navegador (Canvas y MediaRecorder, MP4 o WebM según el navegador) con los datos y las fotografías del inmueble, sin servicios de pago. Seis plantillas de cartel y una opción aleatoria; vídeo de hasta 25 fotografías con pistas sintetizadas en el navegador, pistas propias o sin sonido.
- **Registro de publicación:** en cada anuncio se anotan los portales donde se ha publicado (Idealista, Fotocasa, Pisos.com, Yaencontre, Habitaclia y hasta cinco más) y su enlace, validado. EstateForge no publica en los portales.
- **IA con la clave de cada usuario:** EstateForge no aporta claves ni paga consumo de IA. Cada usuario conecta sus cuentas (15 proveedores de texto, imagen y vídeo; claves cifradas con AES-256-GCM, que nunca vuelven al navegador), ve el coste estimado y confirma antes de cada operación de pago. Ver [IA con clave propia](docs/producto-ia-byok.md) y el [catálogo de proveedores](docs/proveedores-ia.md).
- **Seguridad de la cuenta:** protección por incidente cuando el titular no reconoce un cambio de email y recuperación obligatoria posterior. Ver [seguridad](docs/README.md).
- **Administración** (`/admin`, solo OWNER): usuarios, suspensiones, sesiones, protección por incidente, recuperación y auditoría con filtros.
- **Web pública:** página de presentación estática en `/`, páginas de privacidad y condiciones, `robots.txt` y mapa del sitio. La aplicación vive en `/panel` y no se indexa.

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

   En Windows con WSL hay scripts que instalan y arrancan un PostgreSQL de desarrollo solo en localhost: [docs/postgresql.md](docs/postgresql.md).

5. Arranca la API y la web:

   ```bash
   pnpm dev        # con el PostgreSQL de WSL (lo arranca si está detenido)
   pnpm dev:apps   # con cualquier otro PostgreSQL ya en marcha
   ```

   La web queda en `http://localhost:5173` (la presentación en `/`, la aplicación en `/panel`) y la API en `http://localhost:3000`.

6. Primer OWNER: registra una cuenta desde la web y conviértela en propietaria (solo si aún no hay ninguna; pide confirmación):

   ```bash
   pnpm --filter api exec tsx scripts/promote-owner.ts --email=tu-correo@dominio.com
   ```

   Datos de ejemplo ficticios, solo contra localhost: `pnpm --filter api db:seed`.

## Pruebas y calidad

| Comando | Qué hace |
|---|---|
| `pnpm lint` | Oxlint |
| `pnpm typecheck` | Tipos de shared, API y web |
| `pnpm test` | Tests de shared, web y API, uno tras otro. Las suites de integración de la API usan PostgreSQL real y necesitan `TEST_POSTGRES_ADMIN_URL` (un servidor en localhost; cada suite crea y borra su propia base) |
| `pnpm test:scripts` | Tests de los scripts de `scripts/` |
| `pnpm build` | Construye los tres paquetes; la web queda en `apps/web/dist` |
| `pnpm preview` | Sirve la web construida con las rutas y cabeceras de producción |
| `pnpm check:commits` | Comprueba la [política de mensajes de commit](docs/commit-message-policy.md) |

La integración continua ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) ejecuta todo lo anterior con un PostgreSQL efímero y una auditoría de dependencias de producción. No usa secretos ni despliega nada.

Además de los tests del repositorio, la versión 1.0.0 se ha probado en Edge, Chrome y Firefox de escritorio con pruebas de extremo a extremo propias (fuera del repositorio) contra la API, la web y PostgreSQL en local, con los simuladores de IA y de almacenamiento y sin acceso a Internet.

## Variables de entorno

### API (`apps/api/.env`)

Plantilla: [`apps/api/.env.example`](apps/api/.env.example). Nunca subas el `.env` real.

| Variable | Obligatoria | Uso |
|---|---|---|
| `DATABASE_URL` | Sí | Conexión `postgresql://`. Sin ella la API no arranca. Pool y TLS en [docs/postgresql.md](docs/postgresql.md) |
| `ESTATEFORGE_API_KEY_ENCRYPTION_KEY` | Para guardar claves de IA | Clave interna AES-256 de 32 bytes (base64 o hexadecimal) con la que se cifran las claves de los usuarios. No da acceso a ningún proveedor |
| `CORS_ORIGIN`, `WEB_APP_URL`, `API_PUBLIC_URL` | No (localhost) | Origen de la web, URL de la web en los correos y URL pública de la API |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_SECURE`, `SUPPORT_EMAIL` | Para enviar correos | Servidor y remitente |
| `EMAIL_VERIFICATION_REQUIRED_FROM`, `EMAIL_VERIFICATION_GRACE_UNTIL`, `EMAIL_VERIFICATION_TOKEN_TTL_HOURS` | No | Política de verificación del email ([detalle](docs/seguridad/verificacion-email.md)) |
| `TURNSTILE_SECRET_KEY`, `TURNSTILE_EXPECTED_HOSTNAME` | No | Verificación de Turnstile en la API |
| `NODE_ENV` | No | `production` activa la cookie `Secure` y prohíbe el disco local como almacenamiento |
| `STORAGE_DRIVER`, `STORAGE_LOCAL_DIR`, `STORAGE_LOCAL_SIGNED_URLS`, `STORAGE_LOCAL_SIGNING_SECRET`, `STORAGE_USER_QUOTA_MB` | No | Almacenamiento local (desarrollo) o `vercel-blob`, simulador de URLs firmadas y cuota por usuario |
| `BLOB_READ_WRITE_TOKEN` / `BLOB_STORE_ID` | Con `vercel-blob` | Acceso al Blob store privado, solo en el servidor |
| `CLIENT_IP_SOURCE` | No | `socket` (por defecto) o `vercel`, solo tras la comprobación descrita en [el plan de despliegue](docs/despliegue/vercel-neon-blob.md) |
| `AI_MEDIA_SIMULATOR`, `AI_SIMULATOR_DELAY_MS`, `AI_MEDIA_MAX_CONCURRENT`, `AI_MEDIA_DAILY_LIMIT`, `AI_MEDIA_MONTHLY_LIMIT` | No | Simulador local de IA (nunca en producción) y límites por usuario |

No existe ninguna variable para claves de proveedores de IA: cada usuario usa la suya.

### Web

| Variable | Uso |
|---|---|
| `VITE_API_URL` | URL base de la API; vacía, rutas relativas (API bajo el mismo dominio, como en producción) |
| `VITE_TURNSTILE_SITE_KEY` | Clave pública de Turnstile; vacía, sin widget |
| `SITE_URL` | Solo en la construcción: origen público canónico. En la producción de Vercel se usa su dominio de producción; sin origen, o en una vista previa, nada se indexa |

## Despliegue

Preparado para Vercel (web y API bajo el mismo dominio), Neon y Vercel Blob privado, **sin desplegar**: [docs/despliegue/vercel-neon-blob.md](docs/despliegue/vercel-neon-blob.md). El alta en Google Search Console está en [docs/despliegue/search-console.md](docs/despliegue/search-console.md).

## Problemas encontrados, soluciones y resultados

**De SQLite a PostgreSQL.** Empecé con SQLite y Prisma porque era lo más rápido para tener datos. Al llegar la recuperación de cuentas y el registro de publicación aparecieron escrituras concurrentes sobre la misma cuenta, y SQLite no me daba bloqueos de fila ni tipos exactos para los precios. Migré a PostgreSQL 17 con una migración base única, precios `Decimal(12,2)`, fechas con zona horaria, restricciones `CHECK` en la propia base y bloqueos de fila en los flujos que compiten. Para no engañarme con un ORM simulado, las pruebas de integración corren contra un PostgreSQL real y cada suite crea y borra su propia base. Ahora la API responde 503 con `Retry-After` cuando la base no está disponible, en lugar de errores genéricos.

**Claves de IA aisladas por usuario.** Al principio la aplicación tenía una clave de IA propia y caía a la del usuario cuando se agotaba. Eso significaba pagar el consumo de otros y mezclar responsabilidades, así que lo cambié: EstateForge no tiene ninguna clave de proveedor propia ni paga el consumo. Cada usuario conecta sus propias claves, que el servidor guarda cifradas (AES-256-GCM, con una clave interna de cifrado que no da acceso a ningún proveedor), solo descifra para una operación que el usuario confirma después de ver el coste y nunca devuelve al navegador. Las pruebas comprueban que otra cuenta recibe 404 al pedir recursos ajenos y que ninguna respuesta incluye una clave.

**Límites de las funciones serverless.** Una función de Vercel admite como máximo 4,5 MB por petición y por respuesta, y una galería de fotografías y un vídeo lo superan enseguida. Rediseñé las subidas para que el archivo no pase por la API: la API prepara una URL firmada limitada a una clave que genera ella, al tipo y al tamaño máximo declarados y a 15 minutos, que no puede sobrescribir un archivo existente; el navegador sube directamente al almacenamiento y la API valida el archivo real al confirmar (confirmar dos veces devuelve el mismo resultado). Las lecturas también son URLs firmadas de corta duración, con soporte de `Range` para avanzar en los vídeos. Los trabajos de IA avanzan por sondeo, sin procesos en segundo plano que dependan de que una función siga viva. Como no he desplegado todavía, lo he probado con un simulador local que reproduce el contrato previsto (firma, caducidad, tipo, tamaño, no sobrescritura y `Range`) según la documentación de Vercel Blob. Eso valida mis flujos, no el servicio: el comportamiento real de Blob (CORS, `Range`, caducidad y cuotas) queda pendiente de comprobar en el despliegue.

**Cartel y vídeo sin servicios de pago.** Quería que el material clásico no dependiera de ninguna API. El cartel se dibuja con Canvas y el vídeo se graba con MediaRecorder a partir de las fotografías, con música sintetizada en el propio navegador. Los navegadores no graban los mismos formatos: Edge y Chrome producen MP4 con AAC y Firefox WebM con VP8 y Opus, así que la aplicación elige el formato disponible y la API valida el archivo que recibe. Está comprobado en los tres navegadores; Safari no lo he probado.

**Problemas de diseño adaptable.** El formulario de generación recortaba el texto de los selectores en algunos anchos intermedios, y las medidas en Firefox no coincidían con las de Edge. Pasé esa parte a consultas de contenedor (una, dos o tres columnas según el espacio real) y medí la geometría con pruebas automáticas en cada navegador y ancho. En esta versión la página pública no tiene desbordamiento horizontal entre 320 y 1440 px ni en horizontal.

**Simulación frente a validación real.** Una parte importante del proyecto depende de servicios que todavía no he contratado ni desplegado: los proveedores de IA, Vercel, Neon y Blob. Para avanzar sin coste ni riesgo construí simuladores locales (de proveedor de IA y de almacenamiento firmado) y un bloqueo que impide cualquier salida a Internet durante las pruebas. Eso me permite probar los flujos completos, pero no sustituye a la validación real: lo que depende de los servicios está listado como pendiente y no lo doy por terminado.

**Preparación para publicar.** Al preparar la versión 1.0.0 encontré que el `build` de la raíz no funcionaba (llamaba a Vite sin configuración), que la portada era el panel privado y que el paquete inicial de la aplicación pesaba unos 858 kB. Separé una página pública estática, moví el panel a `/panel` y cargué las páginas privadas bajo demanda (350 kB, 104 kB comprimidos). Al aplicar la política de seguridad de contenidos, la directiva `upgrade-insecure-requests` rompía en local las redirecciones firmadas de las fotografías; la quité, porque en producción HTTPS ya es obligatorio, y añadí una prueba para que no vuelva.

## Limitaciones conocidas

- No desplegado: Vercel, Neon y Vercel Blob están preparados y documentados, pero sin probar contra los servicios reales.
- Ningún proveedor de IA se ha llamado con una clave real; están probados con un simulador y con pruebas de contrato.
- La IP del cliente detrás de Vercel para los límites de uso está pendiente de comprobar en la plataforma.
- No se ha probado en Safari ni en dispositivos móviles físicos (sí en Edge, Chrome y Firefox de escritorio, con emulación de anchos móviles).
- Las páginas de privacidad y condiciones describen el funcionamiento real, pero son borradores: antes de abrir el servicio al público con datos reales faltan la identificación del responsable del tratamiento y su revisión jurídica. Esto afecta al servicio, no a la publicación del código.

## Licencia

Software propietario: todos los derechos reservados. El código se publica para poder leerlo. Además de los permisos que exigen los Términos de GitHub para los repositorios públicos y de lo que la ley permite sin autorización, no se concede permiso para usarlo, copiarlo, modificarlo, redistribuirlo ni explotarlo. Ver [LICENSE](LICENSE). No se aceptan contribuciones externas ([CONTRIBUTING.md](CONTRIBUTING.md)). Las vulnerabilidades se comunican de forma privada ([SECURITY.md](SECURITY.md)).

Los componentes de terceros conservan sus licencias: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) y [`licenses/`](licenses/README.md). La web construida incluye `third-party-notices.txt` con los textos de licencia de todo lo que sirve al navegador.

## Documentación

- [Índice de la documentación](docs/README.md)
- [Galería, cartel y vídeo](docs/producto-galeria-cartel-video.md)
- [IA con clave propia](docs/producto-ia-byok.md) y [catálogo de proveedores](docs/proveedores-ia.md)
- [PostgreSQL: desarrollo, migraciones y copias](docs/postgresql.md)
- [Preparación para Vercel, Neon y Vercel Blob](docs/despliegue/vercel-neon-blob.md)
- [Cambios](CHANGELOG.md) y [notas de la versión 1.0.0](docs/release/v1.0.0.md)
- [Aplicación web](apps/web/README.md)
