# Preparación para Vercel (Hobby), Neon (Free) y Vercel Blob

**Estado: preparado, no desplegado ni verificado contra los servicios reales.**

- No se ha creado ninguna cuenta, ningún proyecto ni ningún Blob store.
- No se ha conectado ningún servicio externo ni se ha ejecutado ninguna operación en la nube.
- Todo lo que sigue está comprobado en local:
  - pruebas unitarias del adaptador de Blob con el SDK simulado;
  - el simulador local de Blob con URLs firmadas;
  - E2E en Edge y Chrome.
- Lo que depende de la plataforma se señala como **pendiente de verificar en el despliegue**.
- **La integración con Vercel Blob no está verificada.**

Cuotas y comportamiento consultados el **11/11/2026** en la documentación oficial. Pueden cambiar, así que revísalos antes de desplegar:

- [Vercel Blob: uso y precios](https://vercel.com/docs/vercel-blob/usage-and-pricing)
- [Vercel Blob: almacenamiento privado](https://vercel.com/docs/vercel-blob/private-storage)
- [Vercel Blob: URLs firmadas (`issueSignedToken`, `presignUrl`)](https://vercel.com/docs/vercel-blob/vercel-signed-urls)
- [Vercel Blob: subidas desde el cliente](https://vercel.com/docs/vercel-blob/client-upload) y [desde el servidor](https://vercel.com/docs/vercel-blob/server-upload)
- [Límites de las funciones de Vercel](https://vercel.com/docs/functions/limitations)
- [Plan Hobby de Vercel](https://vercel.com/docs/plans/hobby)
- [Planes de Neon](https://neon.com/docs/introduction/plans)

## Arquitectura propuesta

```
Navegador ──► proyecto web (Vercel, estático: apps/web/dist)
   │             │  /api/*  ── reescritura ──►  proyecto api (Vercel, Fastify: apps/api/src/server.ts)
   │             │                                   ├─► Neon PostgreSQL (DATABASE_URL, TLS)
   │             │                                   └─► Vercel Blob privado: firma URLs, comprueba y borra
   │             │
   └── PUT / GET con URL firmada (sin cookies) ────────► Vercel Blob privado (los bytes nunca pasan por la API)
```

**La API debe servirse bajo el mismo dominio que la web.**
- La cookie de sesión es `HttpOnly; SameSite=Lax; Secure` (en producción) y no lleva `Domain`.
- `*.vercel.app` está en la Public Suffix List. Por eso `web.vercel.app` y `api.vercel.app` son sitios distintos: el navegador no enviaría la cookie en las peticiones `fetch` de la web a la API, y la sesión no funcionaría.
- Con la reescritura, todas las peticiones a la API son del mismo origen.

**`apps/web/vercel.json` (en el repositorio).** Define las URLs limpias, la SPA acotada a las rutas de la aplicación (cualquier otra ruta es un 404 real, no `index.html`), las cabeceras de seguridad, la CSP, la caché de los recursos con huella y `X-Robots-Tag` en las rutas privadas. Detalle en [la aplicación web](../../apps/web/README.md) y en [Search Console](search-console.md).

Falta solo la reescritura hacia la API, porque necesita su dominio real. Al desplegar, se añade como **primera** regla de `rewrites` (Vercel sirve antes los archivos estáticos y después aplica las reescrituras en orden):

```json
{ "source": "/api/:path*", "destination": "https://<dominio-del-proyecto-api>/api/:path*" }
```

Sin ella, `/api/*` responde 404: la web no funciona, pero tampoco cae en la SPA ni expone nada.

### Transferencias directas (DA-58)

Una función de Vercel admite como máximo **4,5 MB** de cuerpo, tanto en la petición como en la respuesta. Por eso ningún archivo pasa por la API cuando se usa Blob.

**Subida:**
1. **Preparar** (`POST /api/uploads`, JSON de menos de 1 KB). La API:
   - comprueba la sesión, la propiedad, el tipo, el tamaño, la capacidad y la cuota;
   - **reserva** el tamaño declarado;
   - genera una clave impredecible (el navegador nunca envía la ruta);
   - registra un intento `UploadAttempt` pendiente durante 15 minutos;
   - devuelve una URL firmada de `PUT`, limitada a esa ruta, a ese tipo, al tamaño máximo, a 15 minutos y sin sobrescritura (`allowOverwrite: false`).
2. **Enviar.** El navegador hace `PUT` directamente a Blob con `XMLHttpRequest`, lo que da progreso y cancelación. Hace 2 reintentos ante errores de red o 5xx y no envía cookies.
3. **Confirmar** (`POST /api/uploads/:id/complete`, sin cuerpo). La API:
   - lee el objeto real;
   - valida su contenido: firma del formato, dimensiones, duración, coincidencia con el tipo declarado y con los metadatos del cartel o del vídeo;
   - lo asocia y completa el intento en la misma transacción.

   Es idempotente: repetir la confirmación devuelve el mismo resultado. Si el archivo no es válido, el intento queda `failed`, el objeto se borra y la reserva se libera.
4. **Cancelar o caducar.** `DELETE /api/uploads/:id` o la caducidad marcan el intento como `cancelled` o `expired`. Un trigger encola la clave en la cola de limpieza existente (`StorageCleanup`), y `storage:cleanup` la borra.

**Lectura.** Las rutas de archivo de la API (`…/file`) comprueban la sesión y la propiedad, y responden de una de estas dos formas:
- `302` hacia una URL firmada de `GET`;
- con `?as=url`, en JSON.

Siempre llevan `Cache-Control: private, no-store`, `Vary: Cookie` y `Referrer-Policy: no-referrer`. Caducidad de la URL firmada:

| Archivo | Caducidad |
| --- | --- |
| Fotografía, miniatura o cartel | 10 a 15 min |
| Pista de audio | 30 a 35 min |
| Vídeo | 60 a 65 min, para reproducir y avanzar |

Las URLs no se guardan en la base de datos, en los registros ni en el almacenamiento del navegador. Ni el token de Blob ni la `clientSigningToken` salen del servidor.

**Descarga.** El botón «Descargar» lee el archivo con la URL firmada y lo guarda con su nombre (`estateforge-cartel-<anuncio>.jpg`) mediante un `Blob` local con el atributo `download`. No depende de `Content-Disposition`, que Blob no documenta para las URLs prefirmadas.

**Desarrollo.**
- Con `STORAGE_DRIVER=local`, los archivos van al disco y la API los sirve como antes.
- Con `STORAGE_LOCAL_SIGNED_URLS=1`, el disco local se comporta como Blob. La API firma URLs hacia el simulador `/api/local-blob/*`: HMAC, operación, clave, tipo, tamaño y caducidad, con Range, `206` y `416`. También rechaza los archivos en sus rutas binarias (`409 DIRECT_UPLOAD_REQUIRED`).
- Es el modo de las pruebas de integración y de los E2E de esta fase.

## Variables de entorno

### Proyecto api

| Variable | Valor | Notas |
| --- | --- | --- |
| `NODE_ENV` | `production` | Activa `Secure` en la cookie y prohíbe el disco local |
| `DATABASE_URL` | URL **con pooling** de Neon (host `-pooler`), con `sslmode=require` | Nunca en el código ni en el repositorio |
| `DATABASE_POOL_MAX` | `3` (orientativo) | Cada instancia de función tiene su propio pool; el pooler de Neon multiplexa |
| `STORAGE_DRIVER` (o `STORAGE_PROVIDER`) | `vercel-blob` | Si se definen las dos, deben coincidir. Con `VERCEL=1` o `NODE_ENV=production`, `local` impide arrancar |
| `BLOB_READ_WRITE_TOKEN` | La crea Vercel al conectar un Blob store **privado** | Solo en el backend. Alternativa: OIDC de Vercel (`VERCEL_OIDC_TOKEN`, que inyecta la plataforma) + `BLOB_STORE_ID`. Sin una de las dos, la API **no arranca** |
| `BLOB_STORE_ID` | Identificador del store | Solo con OIDC |
| `STORAGE_USER_QUOTA_MB` | Por ejemplo, `150` | Cuota por usuario (500 MB por defecto), con las subidas pendientes reservadas. Con 1 GB de Blob en total, ajústala al número de usuarios |
| `CLIENT_IP_SOURCE` | `vercel` (solo tras la verificación de MD-4) | Origen de la IP para el rate-limit y Turnstile; `socket` por defecto. Ver más abajo |
| `CORS_ORIGIN` | `https://<proyecto-web>.vercel.app` | Con la reescritura las peticiones son del mismo origen; se mantiene por coherencia |
| `WEB_APP_URL` | `https://<proyecto-web>.vercel.app` | Enlaces de los correos |
| `API_PUBLIC_URL` | `https://<proyecto-web>.vercel.app` | La API se publica bajo `/api` del dominio de la web |
| `ESTATEFORGE_API_KEY_ENCRYPTION_KEY` | 32 bytes aleatorios (base64 o hex) | Nueva, distinta de la de desarrollo |
| Claves de proveedores de IA (cualquiera de los 15 del catálogo) | **No se configuran** | BYOK obligatorio (DA-77): no existe ninguna variable; `GEMINI_API_KEY`, `OPENAI_API_KEY` y `AI_PROVIDER` se ignoran si quedan en el proyecto y conviene retirarlas |
| `SMTP_*`, `SUPPORT_EMAIL` | Del proveedor de correo | Sin ellas, los envíos fallan |
| `TURNSTILE_SECRET_KEY`, `TURNSTILE_EXPECTED_HOSTNAME` | Opcionales | Con `VITE_TURNSTILE_SITE_KEY` en la web |
| `EMAIL_VERIFICATION_*` | Según la política de la Fase 0 | Ver la checklist de despliegue v6 |
| `CRON_SECRET` | Valor aleatorio de al menos 16 caracteres (por ejemplo, 32 bytes en hex) | Lo envía Vercel Cron como `Authorization: Bearer …`. Sin él (o más corto), la limpieza programada responde 503 y no hace nada. Solo en Production; ver «Mantenimiento programado» |

Solo para desarrollo o pruebas (no se definen en Vercel):

| Variable | Uso |
| --- | --- |
| `STORAGE_LOCAL_DIR` | Carpeta del disco local (`apps/api/.storage` por defecto) |
| `STORAGE_LOCAL_SIGNED_URLS=1` | Disco local con URLs firmadas y transferencias directas (simulador de Blob) |
| `STORAGE_LOCAL_SIGNING_SECRET` | Secreto HMAC del simulador. Si falta, se genera uno aleatorio en cada arranque |
| `STORAGE_ALLOW_LOCAL_IN_PRODUCTION=1` | Permite el disco local con `NODE_ENV=production` fuera de Vercel (un servidor propio con disco persistente) |

`PORT` y `HOST` no se fijan en Vercel: la plataforma gestiona la escucha. En otra plataforma con contenedor, `HOST=0.0.0.0`.

**Correo con Brevo (pendiente de verificar).** EstateForge solo envía correos transaccionales (verificación, recuperación, cambio de email y avisos de seguridad), sin marketing. Brevo guarda registros de entrega de los correos SMTP y, según su documentación, puede medir aperturas y clics por defecto ([registros transaccionales](https://help.brevo.com/hc/en-us/articles/360021533839-Manage-your-transactional-logs-and-email-previews), [anonimizar aperturas y clics](https://help.brevo.com/hc/en-us/articles/11643306229906-Can-I-anonymize-the-tracking-of-opens-and-clicks-for-my-emails)). No se ha comprobado la configuración de la cuenta de envío, y esa cuenta puede compartirse con otros proyectos, así que no se cambia desde aquí ni se da por desactivada la medición. Queda como verificación pendiente del titular: revisar esos ajustes en Brevo y, si cambian, mantener coherente el texto de `apps/web/privacidad.html`, que hoy describe los registros de entrega y la posible medición de aperturas y clics. No es un bloqueo del despliegue.

### Proyecto web

| Variable | Valor |
| --- | --- |
| `VITE_API_URL` | **Vacía** (rutas relativas `/api/...`, mismo origen) |
| `VITE_TURNSTILE_SITE_KEY` | Opcional |
| `SITE_URL` | Opcional: origen canónico (dominio propio). Solo en la construcción; ver [Search Console](search-console.md) |

Ninguna variable `VITE_` debe contener secretos, porque Vite las incrusta en el JavaScript público. La web no recibe ningún token de Blob: solo URLs firmadas para un tipo de operación (lectura o escritura) sobre una ruta, con caducidad corta; la de escritura, además, limitada al tipo y al tamaño declarados y sin sobrescritura.

### Cabeceras del navegador (CSP y CORS)

- **CSP.** Definida en `apps/web/vercel.json`. Permite `https://*.blob.vercel-storage.com` en `connect-src`, `img-src` y `media-src`, `https://vercel.com` en `connect-src` (la URL de `PUT` firmada puede ser de ese dominio), Turnstile (`https://challenges.cloudflare.com` en `script-src` y `frame-src`), `blob:` y `data:` para el material generado en el navegador, y `worker-src 'self' blob:`. No admite scripts en línea ni `eval`. Probada en local (Edge, Chrome y Firefox) sin ninguna violación en las E2E de subidas, galería, cartel, vídeo con audio, ajustes de IA y formulario; **pendiente de verificar** con los dominios reales del store. No incluye `upgrade-insecure-requests`: Vercel ya fuerza HTTPS y la directiva rompía en local las redirecciones firmadas.
- **CORS de Blob.** La documentación consultada **no indica** si las URLs prefirmadas admiten CORS desde cualquier origen.

  El navegador necesita CORS en estos casos:
  - el `PUT` con `Content-Type`, que provoca una petición previa `OPTIONS`;
  - la lectura con `fetch`, que usan el cartel y el vídeo para dibujar las fotografías, la descarga y la decodificación de pistas.

  **Pendiente de verificar.** Las etiquetas `<img>` y `<video>` no necesitan CORS.

## Construcción y migraciones

- **Versiones:** Node.js 24.x (`engines` en `package.json`) y pnpm 11.20.0 (`packageManager`). Instalación con `pnpm install --frozen-lockfile`.
- **api**:
  - la CLI se ejecuta desde la raíz del monorepo con `--local-config apps/api/vercel.json`; el proyecto tiene `rootDirectory` `apps/api`;
  - comando de construcción (`buildCommand` de `apps/api/vercel.json`): `pnpm --filter @estateforge/shared build && pnpm --filter api check:shared-runtime && pnpm --filter api db:generate && pnpm --filter api build`. En orden:
    1. compila `packages/shared` a `dist/` (JavaScript);
    2. importa ese artefacto con Node sin cargador y falla la construcción si no resuelve a `dist/index.js` o no carga;
    3. genera el cliente de Prisma en `src/generated/prisma`, que no está en el repositorio;
    4. comprueba los tipos;
  - entrada de la función: `apps/api/server.ts`, que hace `import 'fastify'` e `import './src/server.js'`. El builder de Vercel para Fastify (`packages/fastify/src/build.ts`, `generateNodeBuilderFunctions`) recorre los candidatos `app`, `index`, `server`, `src/app`, `src/index`, `src/server` y **solo acepta uno cuyo código contenga una importación literal de `fastify`**. La primera versión de `server.ts` solo importaba `./src/server.js`, así que el builder la descartó y eligió `src/app.ts`, la factoría de pruebas. En el despliegue `dpl_CNnq2BZsDHBikV1Bbt81e9afNq7V` la construcción terminó bien, pero al invocar `/health/ready` el registro mostró `Invalid export found in module /var/task/apps/api/src/app.js. The default export must be a function or server.` El `import 'fastify'` (solo por efecto, sin cambiar el arranque) hace que `server.ts` sea elegible; `src/vercel-entrypoint.test.ts` reproduce el contrato del detector y falla si se quita. En la raíz de `apps/api` no hay `app.*` ni `index.*`. **No se ha comprobado aún en la plataforma** que el nuevo despliegue elija `server.ts` y responda: hay que confirmarlo en el registro;
  - **las migraciones no se ejecutan en la construcción**: así una vista previa nunca modifica la base de producción. El titular las aplica a mano, antes de promover una versión que las necesite, con `prisma migrate deploy` y la URL **directa** (sin `-pooler`) de Neon (`DATABASE_URL=<directa> pnpm --filter api db:migrate`). `migrate deploy` aplica solo migraciones revisadas y nunca crea ni reinicia datos;
  - las vistas previas usan una base o una rama de Neon propia, nunca la de producción (variables del entorno Preview distintas de las de Production).
- **web**:
  - raíz `apps/web`; `vercel.json` fija `buildCommand` (`pnpm --filter @estateforge/shared build && pnpm run build`) y `outputDirectory` (`dist`). `vite build` resuelve `@estateforge/shared` a `dist/` (condición de producción), así que hay que compilarlo antes;
  - opcional: `SITE_URL` con el dominio propio; si no, en producción se usa `VERCEL_PROJECT_PRODUCTION_URL` (activar el acceso a las variables de sistema).
- **Zona horaria de las sesiones:** cada conexión del pool ejecuta `SET TIME ZONE 'UTC'` antes de usarse (Prisma con `@prisma/adapter-pg` lee mal los `timestamptz` en otra zona). Con el pooler de Neon (PgBouncer en modo transacción) los `SET` de sesión no son fiables en general, pero la documentación de Neon indica que PgBouncer restaura `TimeZone` para cada cliente; **pendiente de verificar en el despliegue** con `SELECT current_setting('TimeZone')` a través de la URL con pooling.
- **Comprobaciones de salud:** `GET /health` (el proceso responde) y `GET /health/ready` (además, PostgreSQL disponible).
- **Vuelta atrás:** «Instant Rollback» de Vercel a la implementación anterior. Las migraciones son aditivas, así que una versión anterior funciona con el esquema nuevo; si alguna deja de serlo, hay que documentar su reversión antes de aplicarla.
- **Copias de seguridad y restauración:** ver [docs/postgresql.md](../postgresql.md); en Neon, además, la restauración a un punto en el tiempo de su plan.
- **Observabilidad:** los registros de las funciones de Vercel. La API solo registra campos cerrados (sin destinatarios, tokens ni SQL).

### Incidente: `FUNCTION_INVOCATION_FAILED` por `@estateforge/shared` sin compilar

- **Síntoma.** El despliegue `dpl_5RwfuTZKFEd8F4DC1W2TFvj5fF4a` construyó sin errores (READY), pero `/health/ready` devolvía `FUNCTION_INVOCATION_FAILED`. El registro mostraba: `ERR_MODULE_NOT_FOUND Cannot find module /var/task/apps/api/node_modules/@estateforge/shared/src/index.ts imported from /var/task/apps/api/src/routes/generation.routes.js`.
- **Causa.** `packages/shared` exportaba directamente su fuente TypeScript (`"exports": "./src/index.ts"`) y su `tsconfig.json` tenía `noEmit`. Vercel compila los archivos de la API, pero no los de un paquete de `node_modules`. Node, sin cargador, no puede ejecutar ese `.ts`, cuyos imports internos apuntan además a `./property.js` y otros `.js` que no existían. En local, con Node 24 y sin cargador, `import('@estateforge/shared')` fallaba igual.
- **Solución.**
  - `shared` se compila con `tsc -p tsconfig.build.json` a `dist/`: borra antes `dist/` y excluye los tests.
  - `exports` usa condiciones:
    - `types` y `development` apuntan a `src/index.ts`, así que los tipos, Vite en desarrollo, Vitest y `tsx --conditions=development` no dependen de `dist`;
    - `default` apunta a `dist/index.js`, que es lo que usan Node en producción y `vite build`.
  - El `buildCommand` de la API y el de la web compilan `shared` antes. La API además lo importa con Node puro (`check:shared-runtime`) antes de terminar la construcción. La CI hace la misma comprobación antes de `pnpm build`.
  - No se ha añadido ninguna dependencia ni se usa ningún cargador en Vercel.
- **Pruebas locales** (Windows, Node 24.19.0, 17/11/2026):
  - sin `dist`: `pnpm typecheck`, `pnpm lint`, tests de shared (212) y de la web (670), y un test de la API que importa `shared` (`listing-validator.service.test.ts`, 41). Todo correcto, con Vitest resolviendo a `src`;
  - sin `dist`, `check:shared-runtime` falla con un mensaje claro;
  - tras `pnpm --filter @estateforge/shared build`:
    - `check:shared-runtime` correcto (`dist/index.js`, 117 exportaciones);
    - `node --input-type=module -e "await import('@estateforge/shared')"` desde `apps/api` resuelve a `packages/shared/dist/index.js`;
    - con `--conditions=development` (Node o `tsx`) resuelve a `src/index.ts`;
  - `pnpm --filter api build` y `pnpm --filter web build` correctos.
- **No comprobado:**
  - un despliegue en Vercel con este cambio;
  - que el rastreo de archivos de Vercel incluya `packages/shared/dist` (debería, porque sigue `exports` con las condiciones de Node);
  - `db:generate` en esta verificación (carga `.env`);
  - la suite completa de la API.

- Migraciones actuales, todas aditivas:
  - `0_postgresql_baseline`;
  - `20261110120000_add_property_photos_and_listing_media`;
  - `20261111120000_gallery_50_poster_templates_audio`;
  - `20261112120000_direct_uploads`: la tabla `UploadAttempt` con CHECK y triggers de limpieza; no modifica datos existentes.

## Cuotas y cómo encaja EstateForge

| Servicio (plan) | Cuota relevante (11/11/2026) | Diseño de EstateForge |
| --- | --- | --- |
| Funciones de Vercel | Cuerpo de petición y de respuesta: máximo **4,5 MB**. El límite de respuesta no se aplica al streaming. Duración máxima: 300 s en Hobby | Con Blob, los archivos no atraviesan la función: solo JSON pequeños y redirecciones |
| Vercel Blob (Hobby) | 1 GB de almacenamiento al mes, 10 000 operaciones simples, 2 000 avanzadas y 10 GB de transferencia al mes. Borrar es gratis. Al superarlo no se cobra, pero **Blob deja de estar disponible hasta pasados 30 días**. Límite de ritmo: 1 200 simples y 900 avanzadas por minuto | Ver la estimación siguiente |
| Vercel Blob (Pro) | Por uso. Ejemplo de la documentación (iad1): 0,023 $/GB de almacenamiento, 0,40 $ por millón de operaciones simples, 5,00 $ por millón de avanzadas y 0,05 $/GB de transferencia | No se ha contratado ni se propone contratar |
| Neon (Free) | 1 GB por proyecto, 100 CU-hora al mes por proyecto y 5 GB de transferencia. Escala a cero tras 5 min | Solo metadatos (los binarios no van a PostgreSQL). El primer acceso tras escalar a cero tarda más; la API responde 503 con `Retry-After` si la base no está disponible |
| Vercel Hobby | Uso personal y no comercial según sus condiciones | Adecuado para evaluación o demostración, no para explotación comercial |

Las operaciones por subida directa son una **estimación**. Blob no documenta cómo se cuenta un `PUT` prefirmado; se supone que, como toda subida, es una operación avanzada.

| Paso | Operación de Blob |
| --- | --- |
| `PUT` firmado | 1 avanzada |
| Confirmación: lectura completa del objeto para validarlo | 1 simple (fallo de caché) + transferencia del tamaño del archivo |
| Lectura de una fotografía o miniatura | 1 simple por fallo de caché (los aciertos no cuentan) + transferencia |
| Borrado | Gratis |

### Estimación de almacenamiento y operaciones

| Elemento | Máximo técnico | Uso habitual |
| --- | --- | --- |
| Fotografía (≤ 2400 px) | 4 MB | 0,3-2 MB |
| Miniatura (480 px) | 256 KB | 30-80 KB |
| Galería completa (50) | 100 MB por inmueble | 25-60 MB |
| Cartel | 3 MB | 150-500 KB |
| Vídeo (≤ 60 s, con o sin audio) | 4 MB | 1,5-3,5 MB |
| Pista personal | 4 MB (20 por usuario: 80 MB) | 1-4 MB |
| Pistas predeterminadas | 0 (se sintetizan en el navegador) | 0 |
| Total por usuario | `STORAGE_USER_QUOTA_MB` (500 MB por defecto) | — |

Lo que supone para el plan Hobby:

- **Almacenamiento.** Con 1 GB caben unas 20-30 galerías completas con su material. Para una demostración con varios usuarios conviene una cuota de 100-200 MB por usuario.
- **Operaciones avanzadas.** Una galería completa son unas 100 (50 fotografías y 50 miniaturas), más una por cartel, vídeo o pista. Las 2 000 mensuales dan para unas 15-20 galerías completas al mes, que es el primer límite que se alcanzaría.
- **Transferencia.** Cuentan la validación de cada subida (una lectura completa), las descargas y la visualización. Para reducirla:
  - la rejilla muestra miniaturas;
  - la caducidad de las URLs de lectura se redondea por tramos, de modo que la misma URL se repite dentro de cada tramo y el navegador puede reutilizar su caché. En el simulador local, `max-age` coincide con la vigencia; en Blob, la caché de las respuestas privadas está pendiente de verificar.
- **Si se supera una cuota**, Blob deja de estar disponible: las subidas y la lectura de archivos fallarían con 503 (`STORAGE_UNAVAILABLE`).

## Trabajo después de la respuesta y mantenimiento programado

### Correos en segundo plano (`waitUntil`)

- La verificación del email, el restablecimiento de contraseña y la recuperación obligatoria envían algunos correos **sin que la respuesta HTTP los espere**, para no revelar por el tiempo de respuesta si una cuenta existe (anti-enumeración).
- En Vercel no hay cierre ordenado y la función puede congelarse tras responder. Por eso `createDeliveryTracker().track` (`apps/api/src/services/pending-deliveries.ts`) entrega cada envío a `waitUntil` del SDK oficial `@vercel/functions` (versión exacta 3.11.3 en `apps/api/package.json`).
- Se entrega la **promesa protegida**, la que nunca rechaza: un fallo SMTP no llega al runtime como rechazo sin gestionar. El seguimiento local y la espera del cierre ordenado (servidor propio, `SIGTERM`) no cambian.
- **Fuera de Vercel** no hay contexto de petición y `waitUntil` no hace nada; si lanzara, `track` lo ignora y el envío sigue en el seguimiento local.
- **Límites reales.** `waitUntil` solo prolonga la invocación hasta la duración máxima de la función (300 s en Hobby). Los tiempos de espera SMTP (10 s de conexión, 10 s de saludo y 30 s de inactividad del socket) quedan dentro. Si la plataforma termina la invocación antes, el envío se pierde igual que ante una caída y el titular puede pedir otro enlace.
- Pruebas locales: sin contexto, con el SDK real, y con contexto simulado sustituyendo la exportación pública `waitUntil` (`pending-deliveries.wait-until.test.ts`). **No se ha comprobado en Vercel.**

### Mantenimiento programado (Vercel Cron)

- **Qué hace.** `apps/api/vercel.json` programa una llamada diaria (`0 4 * * *`, UTC) a `GET /api/internal/cron/storage-cleanup`. La ruta (`apps/api/src/routes/maintenance.routes.ts`, registrada en `src/server.ts`) hace **una sola** llamada a la función existente `drainStorageCleanup` con un lote de **50** archivos de la cola `StorageCleanup`: los que los triggers de PostgreSQL ya marcaron para borrar.
- **Protección de los archivos referenciados.** Es la del mecanismo existente: antes de borrar, comprueba de nuevo que ninguna fotografía, miniatura, material, pista, subida en curso ni resultado de IA pendiente use la clave. Si alguno la usa, la fila sale de la cola sin tocar el archivo. Un fallo deja la fila con el intento anotado.
- **Autenticación.** Fallo cerrado:
  - sin `CRON_SECRET`, o con menos de 16 caracteres, responde `503` y no lee la cola;
  - si la cabecera no es exactamente `Authorization: Bearer <CRON_SECRET>`, responde `401`;
  - la comparación es en tiempo constante (`timingSafeEqual` sobre resúmenes SHA-256) y la ruta tiene un rate-limit de 10 peticiones por minuto. La respuesta solo contiene contadores (`deleted`, `failed`, `auditDeleted`), con `Cache-Control: no-store`.
- **Retención de `AdminAuditLog` (90 días, política autorizada por el propietario).** En la misma llamada, después de la cola y aunque esta falle, `purgeExpiredAuditLogs` (`apps/api/src/services/audit-retention.service.ts`) elimina **un lote de hasta 100** registros con `createdAt` estrictamente anterior a «ahora − 90 días» (UTC, intervalo fijo de 90 × 24 h), de los más antiguos a los más recientes.
  - **Excepción por incidente abierto.** Se conserva el registro si su `actorUserId` o su `targetUserId` es una cuenta existente con `securityHoldAt` (protección por incidente activa) o `passwordResetRequiredAt` (recuperación obligatoria pendiente, segunda fase del mismo incidente) distintos de NULL. No hay un campo de retención propio; `adminSuspendedAt` no es un incidente y no cambia la retención. Al completar la recuperación, los registros vuelven a caducar con normalidad.
  - **Relación fiable = identificadores.** Los emails de `metadata` son instantáneas y no se usan. Un registro sin actor ni cuenta afectada no se puede relacionar y se conserva siempre (hoy ningún flujo los crea). Los registros de cuentas ya eliminadas (sin incidente posible) caducan con normalidad.
  - **Sin starvation.** La selección excluye ya los registros protegidos, de modo que filas antiguas protegidas no ocupan el lote.
  - **Concurrencia.** En una transacción se bloquean en orden estable las filas `User` implicadas con `lockUserRow` (el mismo bloqueo que la denuncia de incidente y la recuperación) y el `DELETE` vuelve a comprobar la antigüedad y la excepción. Un incidente confirmado antes de ese bloqueo conserva sus registros; uno abierto después del COMMIT no recupera lo ya eliminado (solo había registros de más de 90 días sin incidente). Dos ejecuciones simultáneas no se interbloquean.
  - **Fallo seguro.** Un error deshace la transacción del lote, la ruta responde `500 {"status":"error"}` y solo registra el nombre del error. El umbral es una constante del código: no depende de variables de entorno ni de ejecuciones anteriores.
  - **Límite.** Con 100 registros al día, si se acumulan más registros caducados que eso, el borrado se retrasa varios días.
  - No necesita migración: no se ha añadido índice (la tabla queda acotada a unos 90 días de registros).
- **Qué no hace.** No busca ni borra huérfanos (`findOrphans` sigue siendo solo informativo, con `storage:cleanup --orphans`). No purga sesiones, tokens, cuentas ni ningún otro registro; la retención solo afecta a `AdminAuditLog`.
- **Límites reales.**
  - Según la documentación de Vercel (no comprobado en la plataforma): en Hobby un cron se ejecuta como mucho una vez al día y la hora exacta puede variar dentro de la hora indicada; solo se ejecuta en el despliegue de Production; no se reintenta si falla.
  - Con un lote de 50 al día, una cola mayor tarda varios días en vaciarse; `pnpm --filter api storage:cleanup` sigue disponible para vaciarla a mano.
  - Dos ejecuciones simultáneas (por ejemplo, una manual y la programada) pueden coger las mismas filas. El borrado en Blob es idempotente; la segunda cuenta la fila como fallo y no borra nada más.
- Pruebas locales con dobles de Prisma y del almacenamiento: autenticación y delegación segura (`maintenance.routes.test.ts`, `audit-retention.service.test.ts`). Retención contra PostgreSQL efímero en localhost (`audit-retention.integration.test.ts`): frontera, incidente abierto y resuelto, cuentas eliminadas, lotes sin starvation, concurrencia con apertura de incidente y fallo con ROLLBACK. **No se ha ejecutado ninguna limpieza ni purga de auditoría real, ni el cron en Vercel.**

### Caché de las respuestas de la API

- Sin `Cache-Control` propio, Vercel añade `public, max-age=0, must-revalidate` (observado en pruebas reales sin sesión). Como endurecimiento, el `onSend` global de `apps/api/src/app.ts` fija `Cache-Control: no-store` en todas las respuestas de la API (incluidos errores, 404 y la respuesta preliminar de CORS), junto a las cabeceras de seguridad existentes.
- Se conserva la política de la ruta solo si ya impide guardar la respuesta en cachés compartidas (`private` o `no-store`; `apps/api/src/cache-control.ts`): `private, no-store` de las URL firmadas, `private, no-cache` con ETag de los archivos y `private, max-age=N` de la reproducción firmada. Cualquier otra se sustituye por `no-store`.
- No cambia la caché de los recursos de la web (`apps/web/vercel.json`). No se ha observado ninguna fuga a través de cachés; es una medida preventiva. Pendiente de comprobar en el despliegue con `curl -I`.

## IP del cliente detrás de Vercel (MD-4)

- **Fastify** se construye **sin `trustProxy`**: `request.ip` es siempre la dirección del socket. Fastify 5.12.1 y posteriores ya no admiten `trustProxy` numérico, porque contar saltos permitía falsificar la IP.
- **Vercel**, según su documentación de *Request headers*, construye `X-Forwarded-For` a partir de la conexión TCP, sobrescribe el valor que envía el cliente y repite el mismo valor en `X-Vercel-Forwarded-For`. Cuando Vercel es el borde más externo, ese valor es la IP real del cliente. Detrás de otro proxy, Vercel pone la IP de ese proxy.

Mecanismo implementado en `apps/api/src/client-ip.ts` (DA-57, endurecido en DA-58):

| `CLIENT_IP_SOURCE` | IP que usan el rate-limit y Turnstile | Cuándo |
| --- | --- | --- |
| vacía o `socket` | Dirección del socket. Las cabeceras `X-Forwarded-For` se ignoran siempre | Desarrollo, pruebas y cualquier despliegue sin verificar |
| `vercel` | **Solo** `X-Vercel-Forwarded-For`, y solo si contiene **exactamente una** IPv4 o IPv6 válida. `::ffff:a.b.c.d` se normaliza a IPv4 y IPv6 se pasa a minúsculas. Se rechazan los valores vacíos, los no válidos, los de más de 64 caracteres y los que tienen varias IP (con comas o repetidos). `X-Forwarded-For` no se usa nunca. Si el valor no es válido, se usa la del socket | Solo con `VERCEL=1`. Fuera de Vercel la API **no arranca** con este valor, porque allí cualquiera podría escribir esas cabeceras |

El rate-limit y Turnstile obtienen la IP con la misma función (`requestClientIp`). Una prueba comprueba, analizando el código fuente, que ningún otro archivo usa `request.ip`. Cualquier otro valor de `CLIENT_IP_SOURCE` impide arrancar.

**MD-4 sigue abierto.** Con la arquitectura recomendada (reescritura `/api/*` desde el proyecto web), la petición llega a la API a través de otro despliegue de Vercel. No se ha podido comprobar si `X-Vercel-Forwarded-For` contiene entonces la IP del cliente o la del proxy de la reescritura.

Prueba externa necesaria (cuando se autorice el despliegue):
1. Desplegar con `CLIENT_IP_SOURCE` vacía.
2. Añadir temporalmente una ruta de diagnóstico, solo para la cuenta OWNER, que devuelva `request.ip`, `x-forwarded-for` y `x-vercel-forwarded-for`.
3. Llamarla desde dos redes distintas (por ejemplo, wifi y datos móviles), a través del dominio de la web (reescritura) y del de la API.
4. Si `x-vercel-forwarded-for` muestra la IP pública de cada red y no la de Vercel, activar `CLIENT_IP_SOURCE=vercel`. Si muestra una IP de Vercel, hay dos opciones:
   - servir la web y la API desde el mismo proyecto;
   - mantener `socket` y aceptar un límite compartido.
5. Enviar `X-Forwarded-For: 1.2.3.4` y `X-Vercel-Forwarded-For: 1.2.3.4` desde el cliente, y comprobar que la IP detectada no cambia.
6. Retirar la ruta de diagnóstico.

## Comprobaciones pendientes en el despliegue (no realizadas)

1. Arranque de Fastify en el entorno de funciones de Vercel con la entrada `apps/api/server.ts`, que importa `src/server.ts`. `tsc` ya comprueba los tipos de esa entrada (está en el `include` de `apps/api/tsconfig.json`). Hay que confirmar en el registro de construcción que la entrada elegida es `server.ts` (y no `src/app.ts`, como ocurrió en `dpl_CNnq2BZsDHBikV1Bbt81e9afNq7V` antes del `import 'fastify'`), que se ejecutó `check:shared-runtime` y que `GET /health` y `GET /health/ready` responden sin `FUNCTION_INVOCATION_FAILED` (ver el incidente de `@estateforge/shared`).
2. **Blob real**, SDK `@vercel/blob` 2.8.2:
   - `issueSignedToken` y `presignUrl` con un store privado;
   - el `PUT` firmado respeta el tipo, el tamaño máximo, la caducidad y `allowOverwrite: false`;
   - `head`, la lectura completa en la confirmación, el borrado y el listado.
3. **CORS** del `PUT` prefirmado (con petición previa `OPTIONS`) y del `GET` prefirmado con `fetch` desde el dominio de la web.
4. **Range.** Respuestas `206` del `GET` prefirmado al avanzar un vídeo MP4 y WebM. La documentación no lo menciona; en local está probado con el simulador.
5. **Caducidad real** de las URLs (`403` al caducar) y de la delegación de lectura reutilizada (como máximo 7 días según la documentación; se piden 2 h).
6. Cookie de sesión a través de la reescritura `/api/*` (inicio de sesión, `/me` y cierre).
7. **IP del cliente para el rate-limit (MD-4).** Seguir la «Prueba externa necesaria» del apartado anterior antes de activar `CLIENT_IP_SOURCE=vercel`.
8. Migraciones con la URL directa de Neon y conexión de la API con la URL del pooler (`sslmode=require`).
9. Tiempos con Neon tras escalar a cero.
10. Grabación del vídeo con sonido en Safari. Está comprobada en Edge y Chrome 157 (MP4 + AAC), en Chrome por el camino WebM + Opus y en Firefox 160 (WebM VP8 + Opus), en local con el simulador de Blob.
11. Cuotas reales de Blob con una galería de 50 fotografías y vídeos con sonido: operaciones avanzadas y simples y transferencia.
12. **`waitUntil` con Fastify en Vercel.** Comprobar que el runtime ofrece el contexto de petición al manejador de Fastify y que un correo de verificación o restablecimiento llega aunque la respuesta ya se haya enviado.
13. **Vercel Cron.** Comprobar que el cron aparece en el proyecto api, que la llamada lleva `Authorization: Bearer <CRON_SECRET>` y responde 200, y que sin el secreto o con otro valor responde 503 o 401. Hacerlo primero con la cola vacía.

## Generación con IA (BYOK)

- **Sin trabajos en segundo plano.** Los trabajos de IA avanzan por sondeo: cada consulta del navegador pregunta al proveedor si toca. No hay procesos persistentes ni colas que dependan de que una función siga viva.
- **Tiempo de las peticiones.** Las más largas son la generación síncrona de una imagen (los proveedores que responden en la misma petición, con un límite propio de 110 s) y la moderación del clip de vídeo (90 s), dentro de los 300 s de una función Hobby.
- **Tamaño.** El resultado del proveedor (hasta 12 MB de imagen o 24 MB de vídeo) se recibe en la API y va al almacenamiento privado. La respuesta al navegador es solo una URL firmada, así que no le afecta el límite de 4,5 MB de respuesta.
- **CSP.** No hace falta ninguna directiva para el proveedor: el navegador nunca llama a ningún proveedor de IA; todas las llamadas salen de la API, solo hacia los hosts fijos del catálogo.
- **Variables.** `ESTATEFORGE_API_KEY_ENCRYPTION_KEY`, propia de producción, y opcionalmente los límites `AI_MEDIA_*`. `AI_MEDIA_SIMULATOR` se ignora en producción.
- **Pendiente de verificar con una clave real de un usuario** (no autorizado en esta fase): los 15 proveedores del catálogo (texto, imagen, vídeo, sondeo, cancelación y clasificador), sus tiempos reales y los hosts desde los que entregan los resultados. Ninguno se ha llamado todavía.
- **Migraciones.** `20261115120000_ai_provider_catalog` y `20261115200000_ai_provider_trials` (aditivas) deben aplicarse con `prisma migrate deploy` antes de servir esta versión.
- **Pruebas reales controladas.** Avanzan por sondeo como los trabajos (ninguna función espera a que termine un vídeo); el resultado se valida en memoria y se descarta, sin pasar por Blob. Cuentan en los mismos límites `AI_MEDIA_*`.

Detalle en [Carteles y vídeos con IA (BYOK)](../producto-ia-byok.md) y en el [catálogo de proveedores](../proveedores-ia.md).

## Procedimiento (cuando se autorice)

1. Crear el proyecto de Neon (región cercana a la de Vercel) y anotar las URL directa y con pooler.
2. Crear dos proyectos de Vercel desde el repositorio (raíces `apps/api` y `apps/web`).
3. En el proyecto api, conectar un Blob store **privado**.
4. Definir las variables de las tablas anteriores en cada proyecto (entorno Production), sin copiarlas del `.env` de desarrollo.
5. Aplicar las migraciones con la URL directa, desplegar la api, comprobar `/health` y `/health/ready` y ejecutar las comprobaciones 1 a 8.
6. Añadir a `apps/web/vercel.json` la reescritura `/api/*` con el dominio real de la api y desplegar la web.
7. Crear el primer OWNER: registrar una cuenta y ejecutar `scripts/promote-owner.ts` contra la base de producción desde un equipo de confianza (no hay credenciales por defecto ni cuentas sembradas en producción; `db:seed` solo funciona contra localhost).
8. Decidir la política de registro antes de anunciar la web: el registro está abierto; Turnstile y la verificación del email (`EMAIL_VERIFICATION_REQUIRED_FROM`) son las medidas disponibles.
9. Seguir [Search Console](search-console.md) para la indexación.
10. Recorrer el procedimiento de evaluación de [producto-galeria-cartel-video.md](../producto-galeria-cartel-video.md#cómo-evaluarlo) y anotar los resultados como evidencia.
