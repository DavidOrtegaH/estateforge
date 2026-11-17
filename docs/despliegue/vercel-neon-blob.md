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

Solo para desarrollo o pruebas (no se definen en Vercel):

| Variable | Uso |
| --- | --- |
| `STORAGE_LOCAL_DIR` | Carpeta del disco local (`apps/api/.storage` por defecto) |
| `STORAGE_LOCAL_SIGNED_URLS=1` | Disco local con URLs firmadas y transferencias directas (simulador de Blob) |
| `STORAGE_LOCAL_SIGNING_SECRET` | Secreto HMAC del simulador. Si falta, se genera uno aleatorio en cada arranque |
| `STORAGE_ALLOW_LOCAL_IN_PRODUCTION=1` | Permite el disco local con `NODE_ENV=production` fuera de Vercel (un servidor propio con disco persistente) |

`PORT` y `HOST` no se fijan en Vercel: la plataforma gestiona la escucha. En otra plataforma con contenedor, `HOST=0.0.0.0`.

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
  - comando de construcción: `pnpm --filter api db:generate && pnpm --filter api build` (genera el cliente de Prisma en `src/generated/prisma`, que no está en el repositorio, y comprueba los tipos);
  - **las migraciones no se ejecutan en la construcción**: así una vista previa nunca modifica la base de producción. El titular las aplica a mano, antes de promover una versión que las necesite, con `prisma migrate deploy` y la URL **directa** (sin `-pooler`) de Neon (`DATABASE_URL=<directa> pnpm --filter api db:migrate`). `migrate deploy` aplica solo migraciones revisadas y nunca crea ni reinicia datos;
  - las vistas previas usan una base o una rama de Neon propia, nunca la de producción (variables del entorno Preview distintas de las de Production).
- **web**:
  - raíz `apps/web`; `vercel.json` fija `buildCommand` (`pnpm run build`) y `outputDirectory` (`dist`);
  - opcional: `SITE_URL` con el dominio propio; si no, en producción se usa `VERCEL_PROJECT_PRODUCTION_URL` (activar el acceso a las variables de sistema).
- **Comprobaciones de salud:** `GET /health` (el proceso responde) y `GET /health/ready` (además, PostgreSQL disponible).
- **Vuelta atrás:** «Instant Rollback» de Vercel a la implementación anterior. Las migraciones son aditivas, así que una versión anterior funciona con el esquema nuevo; si alguna deja de serlo, hay que documentar su reversión antes de aplicarla.
- **Copias de seguridad y restauración:** ver [docs/postgresql.md](../postgresql.md); en Neon, además, la restauración a un punto en el tiempo de su plan.
- **Observabilidad:** los registros de las funciones de Vercel. La API solo registra campos cerrados (sin destinatarios, tokens ni SQL).
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

1. Arranque de Fastify en el entorno de funciones de Vercel con `src/server.ts`. Vercel detecta Fastify sin configuración, pero no se ha probado en la plataforma.
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
