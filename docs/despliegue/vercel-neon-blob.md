# Despliegue en Vercel (Hobby), Neon (Free) y Vercel Blob

## Estado actual

Actualizado el **19/11/2026**. Las fechas de cada prueba concreta se conservan donde se indican.

**Corrección posterior del 19/11/2026: idioma, regeneración y orden.** Código publicado: `1e4e31b0c9d6ee92e7974ae048a54e362164dafe`. API: `dpl_2sJdxWa4hwe7t6QvxtDCm9ghwhj4`; web: `dpl_4oYAr2hT899qpD18jX8xWuUDrppY`. Construidos con dominios separados, comprobados y promovidos después del [CI completo aprobado](https://github.com/DavidOrtegaH/estateforge/actions/runs/44577471938) (API 2389, web 715, shared 221, scripts 60, tipos, lint, builds y auditoría). Sin migraciones nuevas. Las características y el texto copiado respetan el idioma; se elimina el pie de atribución en todo material. Cambiar o reparar el idioma exige confirmación y reemplaza los cuatro textos; recompone los archivos existentes en modo clásico, conserva sonido y selección disponibles y permite reintentar solo los pendientes. El aviso informa de la sustitución de material de IA por clásico y del consumo de texto si usa BYOK. Inmuebles y anuncios, incluidos los de cada ficha, se devuelven del más reciente al más antiguo antes de paginar.

La prueba completa **local** en Edge usó PostgreSQL y transferencias firmadas locales con cuenta y fotos sintéticas: inglés, cartel y MP4 con música, cancelar sin cambios, cambios inglés→español→inglés con ambas versiones multimedia nuevas, conservación de música, fallo de vídeo y reintento sin regenerar texto, orden de anuncios y diálogo a 320 px; ocho comprobaciones, sin errores de página. En **producción** se comprobaron los 19 módulos JavaScript (incluido Administración), los textos del editor, ausencia del pie anterior en los módulos, login sin errores, disponibilidad de PostgreSQL y 401 en la nueva ruta sin sesión. No se usaron cuentas reales ni proveedores de IA, ni se repitió el flujo autenticado en producción. El texto incrustado en una fotografía no se traduce: requiere una imagen original sin esas letras. El material anterior se muestra desactualizado hasta regenerarlo, sin borrar archivos de usuarios durante el despliegue.

**Actualización anterior del 19/11/2026.** Publicados el inglés de las plantillas sin IA, los cinco iconos originales de portales servidos localmente y la nota simplificada de la landing. API: `dpl_49PiXC8oxLbm6XGPxpaZij1udFaW`; web: `dpl_9SExQzWikuLtLHqiUuxRPEVrYRoi`. Ambos se construyeron desde `1e428f7` y se promovieron tras pasar el [CI completo sobre `a385201`](https://github.com/DavidOrtegaH/estateforge/actions/runs/44567916015) (API 2385, web 715, shared 221, scripts 60); entre esos commits solo cambió una prueba que ahora admite la procedencia de los iconos y mantiene la guarda de ausencia de peticiones a portales. No se requieren migraciones nuevas. Comprobado en producción en Edge: texto exacto de la landing, temas y persistencia, 1440/320 px sin desbordamiento ni errores de página, los cinco recursos y su aviso con SHA-256 idéntico al local, avisos de terceros, PostgreSQL disponible y rechazo 401 de una ruta protegida por la reescritura web. El flujo autenticado del inglés se verificó en local, no se ha repetido en producción. Las verificaciones anteriores que siguen pendientes conservan su estado.

**Publicado en producción.** Web: <https://estateforge-blush.vercel.app/>. API: <https://estateforge-api.vercel.app/>.

**Plataforma.** Vercel Hobby (proyectos `web` y `api`) y Neon Free. La API, el Blob store y la base de datos están en la región de Frankfurt. No se usa GitHub Pages. Los despliegues se hacen con la CLI de Vercel; no hay integración automática con Git configurada.

### Comprobado en producción

- `GET https://estateforge-api.vercel.app/health/ready` → 200 con la base de datos disponible. La entrada `apps/api/server.ts` y `@estateforge/shared` compilado funcionan en la plataforma (ver los dos incidentes de «Construcción y migraciones»).
- `GET /api/auth/me` a través de la reescritura de la web, sin sesión → 401 con `Cache-Control: no-store`.
- Portada → 200 sin `noindex`; `/panel` → `X-Robots-Tag: noindex`; una ruta desconocida → 404 real; CSP y demás cabeceras de seguridad presentes; `sitemap.xml` con las tres páginas públicas.
- Portada examinada a 320 px de ancho, sin desbordamiento horizontal.
- Registro real y envío del correo de verificación: el titular lo recibió en la carpeta de spam y `emailVerifiedAt` ya tiene valor en Neon.
- Recuperación de contraseña real, confirmada por el titular: el correo llegó, el enlace permitió cambiar la contraseña y el inicio de sesión con la nueva funcionó. Tras el cambio, la página se quedaba en «Restablecer contraseña» y había que pulsar el enlace al login; la redirección automática al login está corregida, cubierta por pruebas del enrutado y publicada en el despliegue web `dpl_FAFv8ozgBiJtjLrE3RfVRS2EQTzd`. El 18/11/2026 el titular confirmó, con una cuenta temporal, el flujo completo tras ese despliegue: recuperación, redirección al login, inicio de sesión y eliminación de la cuenta desde «Cuenta» (confirmación manual, no prueba automatizada del navegador).
- **Borrado de un inmueble** (18/11/2026, inmueble ficticio, desde la interfaz). Antes fallaba con un mensaje genérico: el cliente enviaba `DELETE /api/properties/:id` con `Content-Type: application/json` y sin cuerpo, y Fastify 5 lo rechazaba con `400 FST_ERR_CTP_EMPTY_JSON_BODY` antes de llegar a la ruta. La corrección, con una prueba de regresión sobre HTTP real (`apps/api/src/routes/property.routes.delete-contract.test.ts`), se publicó en el despliegue web `dpl_FAFv8ozgBiJtjLrE3RfVRS2EQTzd`. Tras borrar, la lista muestra «No hay inmuebles todavía» y la consulta SQL posterior devolvió 0 filas en `Property`, `Generation`, `PropertyPhoto` y `StorageCleanup`. No se ha inspeccionado por separado el contenido del Blob store.
- **Primer OWNER** autorizado y asignado únicamente a la cuenta del titular; la sección Administración es visible en la interfaz.
- **Search Console** verificada con la etiqueta `<meta>`; sitemap enviado y procesado correctamente (ver [Search Console](search-console.md)).
- Vercel Cron registrado (diario, `0 4 * * *` UTC). Sin el secreto o con uno incorrecto → 401 con `no-store`. Una ejecución **manual** con `vercel crons run` (18/11/2026, 15:47:54 UTC) dejó su fila en `MaintenanceRun` (`vercel-cron`, `ok`, contadores a 0). La CLI usa el mismo `user-agent` que el cron programado, así que esa fila no acredita la ejecución programada.
- **Código posterior a `ea5dbf0` desplegado** (18/11/2026): CI de Linux correcto sobre `3dc83ee` ([ejecución 44338627147](https://github.com/DavidOrtegaH/estateforge/actions/runs/44338627147); cifras verificadas en GitHub: API 2361, web 683, shared 212, scripts 60); los cambios de código se integraron por avance rápido en `feature`, `develop`, `release` y `main`, sin cambiar versiones ni etiquetas. Migración `20261118120000_maintenance_runs` probada en una rama temporal de Neon y aplicada en producción con `prisma migrate deploy`. API vigente: `dpl_6QefdFA6ZNPxZA6TFHr6F2AM9RBf`. La web no ha cambiado.
- **Vercel Blob privado, contratos avanzados y aislamiento** (18/11/2026, datos sintéticos; detalle y alcance exacto en [Verificación remota](verificacion-remota.md#resumen-de-la-ronda-del-18112026)):
  - sin sobrescritura (segundo `PUT` 400), más bytes de los firmados rechazados (403), menos bytes rechazados al confirmar (`INVALID_FILE`);
  - tipo: Blob fija el tipo por la extensión de la ruta firmada, así que cambiar solo la cabecera `Content-Type` no provoca rechazo; la API valida los bytes reales (`415 TYPE_MISMATCH` con un JPEG bajo autorización PNG);
  - `PUT` con la URL ya vencida → 403; un intento pendiente que vence sin subida ni confirmación previas: `PUT` → 403 y confirmación → `410 UPLOAD_EXPIRED`;
  - Range con `206` y `416` correctos en una fotografía (por la API y directamente en Blob) y en un MP4 sintético; caché `private`;
  - una URL de lectura emitida con el SDK para 120 s se reutilizó (tres `GET` 200) y caducó con 403; una URL de fotografía **emitida por la aplicación** se reutilizó (tres `GET` 200, mismos bytes y hash; `private, no-store` y `Vary: Cookie` en la respuesta de la app), respondió 403 tras vencer y una autorización nueva de la app volvió a dar acceso (200/200);
  - límite de 100 MB por inmueble (`LIMIT_REACHED`) y cuota de 100 MB por usuario (`QUOTA_EXCEEDED`, repartiendo entre dos inmuebles), con peticiones secuenciales y con **40 solicitudes simultáneas de reserva** de 4 MiB (`POST /api/uploads`, el paso previo a la subida; no se transfirieron 40 archivos): 25 aceptadas (exactamente 100 MiB), 15 `409 QUOTA_EXCEEDED`, ninguna 500; las 25 cancelaciones, 204;
  - listado directo del store: todos los objetos referenciados y, tras borrar los inmuebles, ambos prefijos vacíos con `StorageCleanup` = 0; después, `head` del SDK sobre los cinco objetos originales: `BlobNotFoundError` en los cinco (la sexta fotografía, de la prueba de caducidad, la cubre el listado). No se probó el `GET` de las URLs antiguas tras el borrado;
  - aislamiento con el OWNER y una cuenta USER temporal: 404 uniformes en lecturas, escrituras y `from-property`, 403 en administración, datos del OWNER intactos. Cuenta temporal eliminada por su titular;
  - limpieza de la segunda ronda por la API normal (dos inmuebles 200/200 y cuenta temporal 200): SQL sin cuenta, inmuebles, intentos ni cola (`StorageCleanup` 0), OWNER conservado; prefijo de Blob vacío (`hasMore` falso) y fotografía ausente con `head`.
- **Vercel Blob privado, flujo básico** (navegador, cuenta verificada, solo datos sintéticos y ficticios; sin llamadas a proveedores de IA). Es una prueba acotada, no una medida de rendimiento:
  - inicio de sesión; creación de un inmueble ficticio y de su anuncio con la plantilla local (sin IA);
  - dos PNG sintéticos de 800×600 subidos directamente a Blob con URL firmada; miniaturas de 480×360 cargadas; visor de imagen completa (800×600) cargado; cambio de la foto principal y del orden, que persisten al recargar;
  - cartel JPEG (182 KB) generado, guardado en Blob y descargado;
  - vídeo MP4 sin sonido (17,028 s, 1280×720, 3,6 MB) generado, guardado en Blob y reproducido desde la URL firmada (`readyState` 4);
  - 18/11/2026: vídeo regenerado como versión 2 (17 s) con la pista «Piano sereno», guardado y descargado. Se inspeccionó el MP4 descargado (3 916 958 bytes): sus cajas ISO BMFF contienen manejadores (`hdlr`) `vide` y `soun`, lo que confirma una pista de vídeo y otra de audio. El titular reprodujo ese archivo y confirmó que se oye correctamente, sin cortes evidentes (comprobación manual, no automatizada).
  - 18/11/2026, **WebM en producción (confirmación manual del titular).** En Firefox, con un inmueble sintético, una imagen sintética y generación clásica con «Piano sereno», el titular respondió: «Se escucha bien, aparece como WebM, se elimina todo bien». Quedan acreditados por confirmación humana el formato WebM, la escucha correcta y el borrado; no es una prueba automatizada ni una inspección del binario ni de las cabeceras Range del WebM, y no se verificó por separado la imagen ni el avance. Comprobación posterior: OWNER conservado (1), inmuebles del OWNER 0, `StorageCleanup` 0 y prefijo de Blob del OWNER vacío (0 objetos, `hasMore` falso).
- Los datos de prueba son sintéticos y están autorizados para sustituirse y borrarse al terminar.
- CI completo en GitHub sobre `896cc3e`: [ejecución 44295533465](https://github.com/DavidOrtegaH/estateforge/actions/runs/44295533465) correcta (suite de la API con PostgreSQL real, incluidas las nuevas pruebas HTTP del borrado; web 683, shared 212, scripts 60; tipos, lint, builds, importación de `shared` con Node y auditoría). La ejecución anterior, [44164287964](https://github.com/DavidOrtegaH/estateforge/actions/runs/44164287964) sobre `2d04d28`, también pasó.
- La etiqueta `v1.0.1` no se ha movido. Los cambios posteriores a 1.0.1 están en `main` y no forman parte de esa etiqueta.

### Pendiente

La matriz para comprobarlo en producción (pasos, resultado esperado y limpieza) está en [Verificación remota](verificacion-remota.md).

- **Ejecución programada del cron**, acreditada con una fila `vercel-cron` de `MaintenanceRun` en la franja de las 04:00 UTC: primera ventana el 19/11/2026 (04:00–04:59 UTC) y un segundo día seguido. La retención de 90 días con registros caducados solo está probada con pruebas unitarias y de integración.
- **Vercel Blob, lo no cubierto:** la renovación interna de la delegación de lectura de 2 h; la caducidad de las URLs de audio y vídeo; la petición previa `OPTIONS` de un `PUT`; una galería de 50 fotografías.
- Aislamiento con dos cuentas USER y con una pista de audio (la muestra se hizo con el OWNER y una cuenta USER temporal).
- Cierre de sesión con cookie a través de la reescritura, pendiente de anotar como evidencia (el inicio de sesión ya consta arriba).
- Proveedores de IA con claves reales y móviles físicos.
- Indexación en Google: la portada no está indexada; la solicitud de indexación se rechazó por cuota diaria y no se ha reintentado. No hay garantía de aparecer en Google.

### Limitaciones aceptadas (fuera de alcance)

Decisión expresa del titular (18/11/2026). No son pruebas aplazadas: no se harán.

- **MD-4, IP del cliente detrás de la reescritura: riesgo aceptado, no resuelto técnicamente.** Solo se midió desde una red; la prueba desde dos redes y con cabeceras falsificadas no se hará. `CLIENT_IP_SOURCE` permanece en `socket`, el diagnóstico está retirado (404) y no se vuelve a activar. Consecuencia: las peticiones que llegan por la reescritura pueden compartir el cupo del rate-limit. Es un riesgo aceptado, no resuelto: no se ha probado desde dos redes ni con cabeceras suplantadas.
- **Safari: sin validar.** No se probará. No se promete compatibilidad validada con Safari; el código de compatibilidad existente se mantiene.

El resto del documento conserva las instrucciones técnicas. Las marcas «pendiente de verificar» que siguen se refieren a lo que no aparece en «Comprobado en producción».

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

La reescritura hacia la API es la **primera** regla de `rewrites` (Vercel sirve antes los archivos estáticos y después aplica las reescrituras en orden) y apunta al dominio real del proyecto api:

```json
{ "source": "/api/:path*", "destination": "https://estateforge-api.vercel.app/api/:path*" }
```

Sin ella, `/api/*` respondería 404: la web no funcionaría, pero tampoco caería en la SPA ni expondría nada. `apps/web/tooling/site.test.ts` comprueba la regla.

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
   - Un intento pendiente caduca al vencer su plazo de 15 minutos.
   - Un intento que ya se está confirmando (`processing`) tiene un margen de 10 minutos más. Sin ese margen, si el plazo vencía mientras la API leía y validaba el archivo, otra petición del usuario lo caducaba y la limpieza borraba el archivo a mitad de la confirmación. El usuario recibía «El archivo no ha llegado al almacenamiento». Reproducido en local y corregido.
   - Si a pesar de todo el intento deja de estar en curso antes de guardar, la confirmación responde `410 UPLOAD_EXPIRED` (antes, `500`), se deshace y el archivo se limpia.
   - Cancelar y confirmar a la vez acaba siempre en un estado coherente: o fotografía con su archivo, o ninguna de las dos cosas (prueba con 20 repeticiones).

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

Una URL firmada **no es de un solo uso**: cualquiera que la tenga puede usarla tantas veces como quiera hasta que caduca. Lo que la limita es:

- la operación (lectura o escritura);
- la ruta exacta;
- el plazo;
- en la escritura, además, el tipo, el tamaño máximo y la prohibición de sobrescribir.

Por eso se emiten solo tras comprobar la sesión y la propiedad, con plazos cortos y sin caché compartida. En local lo comprueba `storage-maintenance.integration.test.ts` con el simulador (tres lecturas con la misma URL y rechazo tras caducar); en Blob real, la fila B-6 de la [verificación remota](verificacion-remota.md#prioridad-1-vercel-blob-real).

**Descarga.** El botón «Descargar» lee el archivo con la URL firmada y lo guarda con su nombre (`estateforge-cartel-<anuncio>.jpg`) mediante un `Blob` local con el atributo `download`. No depende de `Content-Disposition`, que Blob no documenta para las URLs prefirmadas.

**Desarrollo.**
- Con `STORAGE_DRIVER=local`, los archivos van al disco y la API los sirve como antes.
- Con `STORAGE_LOCAL_SIGNED_URLS=1`, el disco local se comporta como Blob. La API firma URLs hacia el simulador `/api/local-blob/*`: HMAC, operación, clave, tipo, tamaño y caducidad, con Range, `206` y `416`. Un `Range` mal formado (por ejemplo, `bytes=-`) o con varios rangos se ignora y se envía el archivo completo, como permite RFC 9110; antes, `bytes=-` se respondía como un `206` del archivo entero. También rechaza los archivos en sus rutas binarias (`409 DIRECT_UPLOAD_REQUIRED`).
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
| `CLIENT_IP_SOURCE` | `socket` (o sin definir). No se activa `vercel`: MD-4 es un riesgo aceptado | Origen de la IP para el rate-limit y Turnstile. Ver más abajo |
| `CLIENT_IP_DIAGNOSTIC_UNTIL` | **Sin definir.** El diagnóstico está retirado y no se vuelve a activar | Abriría el diagnóstico temporal de la IP, solo para el OWNER. Sin la variable la ruta responde 404 |
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
  - entrada de la función: `apps/api/server.ts`, que hace `import 'fastify'` e `import './src/server.js'`. El builder de Vercel para Fastify (`packages/fastify/src/build.ts`, `generateNodeBuilderFunctions`) recorre los candidatos `app`, `index`, `server`, `src/app`, `src/index`, `src/server` y **solo acepta uno cuyo código contenga una importación literal de `fastify`**. La primera versión de `server.ts` solo importaba `./src/server.js`, así que el builder la descartó y eligió `src/app.ts`, la factoría de pruebas. En el despliegue `dpl_CNnq2BZsDHBikV1Bbt81e9afNq7V` la construcción terminó bien, pero al invocar `/health/ready` el registro mostró `Invalid export found in module /var/task/apps/api/src/app.js. The default export must be a function or server.` El `import 'fastify'` (solo por efecto, sin cambiar el arranque) hace que `server.ts` sea elegible; `src/vercel-entrypoint.test.ts` reproduce el contrato del detector y falla si se quita. En la raíz de `apps/api` no hay `app.*` ni `index.*`. **Comprobado en producción:** con este cambio, `GET /health/ready` responde 200 con la base de datos disponible;
  - **las migraciones no se ejecutan en la construcción**: así una vista previa nunca modifica la base de producción. El titular las aplica a mano, antes de promover una versión que las necesite, con `prisma migrate deploy` y la URL **directa** (sin `-pooler`) de Neon (`DATABASE_URL=<directa> pnpm --filter api db:migrate`). `migrate deploy` aplica solo migraciones revisadas y nunca crea ni reinicia datos;
  - las vistas previas usan una base o una rama de Neon propia, nunca la de producción (variables del entorno Preview distintas de las de Production).
- **web**:
  - raíz `apps/web`; `vercel.json` fija `buildCommand` (`pnpm --filter @estateforge/shared build && pnpm run build`) y `outputDirectory` (`dist`). `vite build` resuelve `@estateforge/shared` a `dist/` (condición de producción), así que hay que compilarlo antes;
  - opcional: `SITE_URL` con el dominio propio; si no, en producción se usa `VERCEL_PROJECT_PRODUCTION_URL` (activar el acceso a las variables de sistema).
- **Zona horaria de las sesiones:** cada conexión del pool ejecuta `SET TIME ZONE 'UTC'` antes de usarse (Prisma con `@prisma/adapter-pg` lee mal los `timestamptz` en otra zona). Con el pooler de Neon (PgBouncer en modo transacción) los `SET` de sesión no son fiables en general, pero la documentación de Neon indica que PgBouncer restaura `TimeZone` para cada cliente. La validación del despliegue del 17/11/2026 lo comprobó a través del pooler, con el pool real (máximo 3): 12 transacciones simultáneas, todas con `TimeZone = UTC`.
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
- **Comprobado después:**
  - el despliegue de producción con este cambio y la entrada explícita: `/health/ready` responde 200 y las rutas de la API cargan `@estateforge/shared` (`/api/auth/me` responde 401 sin sesión);
  - la suite completa de la API (2321 pruebas, con PostgreSQL real) y la importación de `shared` con Node en el CI de GitHub (ver «Estado actual»).

- Migraciones actuales, todas aditivas:
  - `0_postgresql_baseline`;
  - `20261110120000_add_property_photos_and_listing_media`;
  - `20261111120000_gallery_50_poster_templates_audio`;
  - `20261112120000_direct_uploads`: la tabla `UploadAttempt` con CHECK y triggers de limpieza; no modifica datos existentes;
  - `20261113120000_ai_media_byok` a `20261115200000_ai_provider_trials`: IA con la clave de cada usuario (ver «Generación con IA»);
  - `20261118120000_maintenance_runs`: la tabla `MaintenanceRun` (constancia de las ejecuciones del mantenimiento) con su CHECK. Hay que aplicarla antes de desplegar la API que la usa; si se despliega antes, el mantenimiento funciona igual, pero registra un error y no deja constancia. **Aplicada en producción el 18/11/2026**, antes de desplegar la API.

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
- Pruebas locales: sin contexto, con el SDK real, y con contexto simulado sustituyendo la exportación pública `waitUntil` (`pending-deliveries.wait-until.test.ts`). En producción, el correo de verificación de un registro real llegó (a la carpeta de spam); el de recuperación de contraseña también llegó y permitió cambiarla. No se ha medido por separado el comportamiento de `waitUntil` en Vercel.

### Mantenimiento programado (Vercel Cron)

- **Qué hace.** `apps/api/vercel.json` programa una llamada diaria (`0 4 * * *`, UTC) a `GET /api/internal/cron/storage-cleanup`. La ruta (`apps/api/src/routes/maintenance.routes.ts`, registrada en `src/server.ts`) hace **una sola** llamada a la función existente `drainStorageCleanup` con un lote de **50** archivos de la cola `StorageCleanup`: los que los triggers de PostgreSQL ya marcaron para borrar.
- **Protección de los archivos referenciados.** Es la del mecanismo existente: antes de borrar, comprueba de nuevo que ninguna fotografía, miniatura, material, pista, subida en curso (pendiente y vigente, o confirmándose) ni resultado de IA pendiente use la clave. Si alguno la usa, la fila sale de la cola sin tocar el archivo. Un fallo deja la fila con el intento anotado. Probado contra PostgreSQL real con los seis tipos de referencia (`storage-maintenance.integration.test.ts`).
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
  - Dos ejecuciones simultáneas (por ejemplo, una manual y la programada, o una limpieza lanzada por una petición del usuario) pueden coger las mismas filas. El borrado en Blob es idempotente y solo cuenta como borrada la ejecución que retira la fila. Hasta esta corrección, la segunda ejecución contaba cada fila ya procesada como fallo y la registraba como aviso: el estado final era correcto, pero los contadores y los registros no. Reproducido con PostgreSQL real (12 de 12 y 30 de 30 «fallos» falsos) y corregido.
- **Constancia de cada ejecución (`MaintenanceRun`).**
  - En Hobby los registros de las funciones duran una hora, así que no bastan para acreditar al día siguiente que el cron se ejecutó.
  - Cada ejecución que supera la autenticación escribe una línea de registro («Mantenimiento diario ejecutado», con campos cerrados) y una fila en `MaintenanceRun` con: disparador, estado, `storageDeleted`, `storageFailed`, `auditDeleted`, `queuePending` (lo que queda en la cola), duración, `startedAt` y `finishedAt`.
  - El disparador es `vercel-cron` si la cabecera `user-agent` es exactamente `vercel-cron/1.0` (la que documenta Vercel) y `manual` en cualquier otro caso. Es una clasificación informativa, no un control: quien tenga `CRON_SECRET` podría imitarla. Por eso la verificación cruza la hora de la fila con la franja programada.
  - La tabla no guarda datos personales, claves de archivos ni secretos, y no se purga (una fila al día).
  - Una petición sin el secreto no escribe nada. Si la escritura falla (por ejemplo, sin la migración), el mantenimiento y su respuesta no cambian.
  - Procedimiento: [Verificación remota, prioridad 1](verificacion-remota.md#prioridad-1-mantenimiento-diario).
- Pruebas locales con dobles de Prisma y del almacenamiento: autenticación, delegación segura y constancia de cada ejecución (`maintenance.routes.test.ts`, `audit-retention.service.test.ts`). Retención contra PostgreSQL efímero en localhost (`audit-retention.integration.test.ts`): frontera, incidente abierto y resuelto, cuentas eliminadas, lotes sin starvation, concurrencia con apertura de incidente y fallo con ROLLBACK. Cola de limpieza y ruta del cron contra PostgreSQL efímero y el simulador de Blob (`storage-maintenance.integration.test.ts`): referencias protegidas, dos ejecuciones simultáneas, fallo parcial del almacenamiento con reintento, lote acotado a 50 y filas `MaintenanceRun`. En producción el cron está registrado (diario a las 4:00 UTC), una llamada sin el secreto responde 401 y una ejecución manual (18/11/2026) dejó su fila `ok` con todos los contadores a 0 (no había nada que limpiar ni registros de auditoría caducados). **No consta todavía ninguna ejecución programada.**

### Caché de las respuestas de la API

- Sin `Cache-Control` propio, Vercel añade `public, max-age=0, must-revalidate` (observado en pruebas reales sin sesión). Como endurecimiento, el `onSend` global de `apps/api/src/app.ts` fija `Cache-Control: no-store` en todas las respuestas de la API (incluidos errores, 404 y la respuesta preliminar de CORS), junto a las cabeceras de seguridad existentes.
- Se conserva la política de la ruta solo si ya impide guardar la respuesta en cachés compartidas (`private` o `no-store`; `apps/api/src/cache-control.ts`): `private, no-store` de las URL firmadas, `private, no-cache` con ETag de los archivos y `private, max-age=N` de la reproducción firmada. Cualquier otra se sustituye por `no-store`.
- No cambia la caché de los recursos de la web (`apps/web/vercel.json`). No se ha observado ninguna fuga a través de cachés; es una medida preventiva. Comprobado en producción en `/api/auth/me` sin sesión (401 con `Cache-Control: no-store`, a través de la reescritura), en los rechazos de aislamiento (404 y 403 con `no-store`) y en las lecturas por Range de una fotografía a través de la API (caché `private`), el 18/11/2026.

## IP del cliente detrás de Vercel (MD-4)

- **Fastify** se construye **sin `trustProxy`**: `request.ip` es siempre la dirección del socket. Fastify 5.12.1 y posteriores ya no admiten `trustProxy` numérico, porque contar saltos permitía falsificar la IP.
- **Vercel**, según su documentación de *Request headers*, construye `X-Forwarded-For` a partir de la conexión TCP, sobrescribe el valor que envía el cliente y repite el mismo valor en `X-Vercel-Forwarded-For`. Cuando Vercel es el borde más externo, ese valor es la IP real del cliente. Detrás de otro proxy, Vercel pone la IP de ese proxy.

Mecanismo implementado en `apps/api/src/client-ip.ts` (DA-57, endurecido en DA-58):

| `CLIENT_IP_SOURCE` | IP que usan el rate-limit y Turnstile | Cuándo |
| --- | --- | --- |
| vacía o `socket` | Dirección del socket. Las cabeceras `X-Forwarded-For` se ignoran siempre | Desarrollo, pruebas y cualquier despliegue sin verificar |
| `vercel` | **Solo** `X-Vercel-Forwarded-For`, y solo si contiene **exactamente una** IPv4 o IPv6 válida. `::ffff:a.b.c.d` se normaliza a IPv4 y IPv6 se pasa a minúsculas. Se rechazan los valores vacíos, los no válidos, los de más de 64 caracteres y los que tienen varias IP (con comas o repetidos). `X-Forwarded-For` no se usa nunca. Si el valor no es válido, se usa la del socket | Solo con `VERCEL=1`. Fuera de Vercel la API **no arranca** con este valor, porque allí cualquiera podría escribir esas cabeceras |

El rate-limit y Turnstile obtienen la IP con la misma función (`requestClientIp`). Una prueba comprueba, analizando el código fuente, que ningún otro archivo usa `request.ip`. Cualquier otro valor de `CLIENT_IP_SOURCE` impide arrancar.

**MD-4: riesgo aceptado, no resuelto técnicamente.** El 18/11/2026 se activó el diagnóstico de forma temporal y se midió desde **una sola red** a través de la web: la IP del socket es de loopback y `x-forwarded-for` y `x-vercel-forwarded-for` coincidían con la IP pública de esa red; la cabecera `host` llega como el dominio de la API también a través de la reescritura. Con una sola red no se puede concluir que el modo `vercel` sea seguro. Por decisión del titular, la prueba desde dos redes y con cabeceras falsificadas **queda fuera de alcance y no se hará**: `CLIENT_IP_SOURCE` permanece en `socket`, la variable del diagnóstico se retiró (la ruta responde 404 al OWNER) y el diagnóstico no se vuelve a activar.

Con la arquitectura recomendada (reescritura `/api/*` desde el proyecto web), la petición llega a la API a través de otro despliegue de Vercel.

- La documentación de [reescrituras](https://vercel.com/docs/routing/rewrites), consultada el 18/11/2026, indica que una reescritura hacia un origen externo reenvía `x-forwarded-for` y `x-real-ip`.
- No indica qué recibe en `x-vercel-forwarded-for` el proyecto de destino, y no se medirá (fuera de alcance).
- En modo `socket` todas las peticiones que llegan por la reescritura pueden compartir el cupo de la dirección del proxy. Es un riesgo aceptado, no resuelto: no se ha probado desde dos redes ni con cabeceras suplantadas.

**Diagnóstico temporal, retirado y sin reactivación prevista** (`apps/api/src/routes/client-ip-diagnostic.routes.ts`; el código sigue en el repositorio, inactivo sin la variable):

- `GET /api/admin/diagnostics/client-ip` solo existe si `CLIENT_IP_DIAGNOSTIC_UNTIL` contiene una fecha ISO 8601 futura y como mucho a 72 h. Pasada esa fecha responde 404.
- Solo responde al OWNER (USER: 403; sin sesión: 401).
- Devuelve el dominio de llegada, la IP del socket, `x-forwarded-for`, `x-vercel-forwarded-for`, `x-real-ip`, `forwarded`, `x-vercel-id` y la IP que usaría el rate-limit con cada valor de `CLIENT_IP_SOURCE`.
- No registra nada y lleva `Cache-Control: no-store`. No cambia el rate-limit ni Turnstile.
- Retirada: hecha el 18/11/2026 (variable eliminada y API desplegada de nuevo).

Pruebas locales: `client-ip-diagnostic.routes.test.ts` (ventana, caducidad, permisos, cabeceras falsificadas, sin cookies ni secretos en la respuesta) y el barrido de aislamiento (USER 403, OWNER 200, OWNER con incidente abierto rechazado).

Resultados medidos y filas fuera de alcance: [Verificación remota, IP del cliente](verificacion-remota.md#prioridad-1-ip-del-cliente-md-4-riesgo-aceptado). Sin la prueba desde dos redes no hay base para activar `CLIENT_IP_SOURCE=vercel`.

## Comprobaciones en el despliegue

Estado de cada comprobación a la fecha de «Estado actual».

1. **Hecho.** Arranque de Fastify con la entrada `apps/api/server.ts`, que importa `src/server.ts` (`tsc` comprueba sus tipos; está en el `include` de `apps/api/tsconfig.json`): `GET /health/ready` responde 200 sin `FUNCTION_INVOCATION_FAILED`. En un despliegue nuevo, conviene seguir revisando en el registro que la entrada sea `server.ts` (y no `src/app.ts`, como en `dpl_CNnq2BZsDHBikV1Bbt81e9afNq7V`) y que se ejecute `check:shared-runtime`.
2. **Hecho en lo esencial. Blob real**, SDK `@vercel/blob` 2.8.2: flujo básico desde el navegador y, el 18/11/2026, sobrescritura, tamaño mayor y menor, `PUT` con URL vencida, validación del tipo real, borrado, listado y ausencia individual con `head` del SDK, `410 UPLOAD_EXPIRED` de un intento pendiente caducado y cuota con 40 solicitudes simultáneas de reserva de subida (filas B-1 a B-12 de la [verificación remota](verificacion-remota.md#prioridad-1-vercel-blob-real)). El `PUT` no se rechaza por cambiar solo la cabecera `Content-Type`: el tipo lo fija la extensión firmada y la API valida los bytes.
3. **Parcial. CORS.** El `PUT` y el `GET` prefirmados funcionaron desde el dominio de la web; la lectura del MP4 con el `Origin` de la web devuelve `Access-Control-Allow-Origin: *`. Falta verificar la petición previa `OPTIONS` de un `PUT`.
4. **Hecho para MP4. Range.** `206` y `416` correctos en una fotografía y en un MP4 sintético (18/11/2026). En WebM no se inspeccionaron las cabeceras Range (la prueba de WebM fue manual).
5. **Hecho para fotografías y subidas. Caducidad real.** Una URL de fotografía emitida por la aplicación se reutilizó, respondió 403 al vencer y se renovó con una autorización nueva; un `PUT` con la URL vencida respondió 403 y un intento pendiente caducado, `410 UPLOAD_EXPIRED`. Falta acreditar la renovación interna de la delegación de lectura (se piden 2 h) y la caducidad de las URLs de audio y vídeo.
6. **Parcial.** Cookie de sesión a través de la reescritura `/api/*`: `/api/auth/me` sin sesión responde 401 con `no-store` y el inicio de sesión en el navegador funcionó; falta anotar como evidencia `/me` con sesión y el cierre.
7. **Fuera de alcance; riesgo aceptado. IP del cliente para el rate-limit (MD-4).** Medido desde una sola red; diagnóstico retirado y sin reactivación. Las filas IP-2 a IP-4 de la [verificación remota](verificacion-remota.md#prioridad-1-ip-del-cliente-md-4-riesgo-aceptado) no se harán; `CLIENT_IP_SOURCE` permanece en `socket`.
8. **Hecho.** La API conecta con Neon (`/health/ready` 200), el registro guarda cuentas y la zona de las sesiones es UTC a través del pooler (validación del 17/11/2026).
9. **Pendiente.** Tiempos con Neon tras escalar a cero.
10. **Parcial.** MP4 con sonido: el MP4 v2 con «Piano sereno» (manejadores `vide` y `soun`) lo escuchó el titular y se oye correctamente (manual). WebM en producción: el titular confirmó en Firefox que el vídeo aparece como WebM, se escucha bien y se borra todo (manual, 18/11/2026). **Pendiente:** dispositivos físicos. Safari queda fuera de alcance, sin validar (ver «Limitaciones aceptadas»). Está comprobada en Edge y Chrome 157 (MP4 + AAC), en Chrome por el camino WebM + Opus y en Firefox 160 (WebM VP8 + Opus), en local con el simulador de Blob.
11. **Pendiente.** Cuotas reales de Blob con una galería de 50 fotografías y vídeos con sonido: operaciones avanzadas y simples y transferencia.
12. **Parcial. Correos tras la respuesta (`waitUntil`).** El correo de verificación de un registro real llegó (a spam) y el de recuperación llegó y permitió cambiar la contraseña. La llegada a spam sigue siendo una limitación.
13. **Parcial. Vercel Cron.** Registrado en el proyecto api (diario, 4:00 UTC), una llamada sin el secreto responde 401 y una ejecución manual dejó su fila `ok`. Falta acreditar una ejecución programada: fila `vercel-cron` de `MaintenanceRun` con `status = 'ok'` en la franja de las 04:00 UTC ([M-3](verificacion-remota.md#prioridad-1-mantenimiento-diario)).
14. **Parcial.** [Search Console](search-console.md): propiedad verificada y sitemap procesado; la portada aún no está indexada.

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

## Procedimiento

Para la publicación actual (CLI de Vercel, sin integración con Git) se han realizado los pasos 1 a 4, 6 y 7 (OWNER asignado a la cuenta del titular), y del paso 5 el despliegue y `/health/ready`; las comprobaciones 1 a 8 tienen el estado indicado en «Comprobaciones en el despliegue». El paso 9 está en curso (propiedad verificada y sitemap procesado, portada sin indexar) y el 10 sigue pendiente. El registro es público con verificación del email (paso 8). Se conserva como referencia para un despliegue nuevo.

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


### Dominio de producción

El proyecto web usa `estateforge.casa` y redirige `www.estateforge.casa` al dominio principal. Mantener los servidores DNS de Namecheap y consultar los valores vigentes en Vercel al actualizar los registros de la web. En producción, configurar `SITE_URL` en el proyecto web y `WEB_APP_URL`, `API_PUBLIC_URL` y `CORS_ORIGIN` en el proyecto de API con `https://estateforge.casa`. La web reenvía `/api/*` al proyecto de API y las cookies de sesión pertenecen al host que utilizó el navegador. Al pasar del dominio anterior al nuevo, el usuario deberá iniciar sesión en el dominio nuevo.

Brevo autenticó `estateforge.casa` el 22/11/2026 tras verificar el TXT de propiedad, los dos CNAME de DKIM y el TXT de DMARC en Namecheap. El remitente verificado de producción es `EstateForge <no-reply@estateforge.casa>`, configurado mediante `SMTP_FROM` en el proyecto de API. El dominio usa DMARC en modo de monitorización (`p=none`).
