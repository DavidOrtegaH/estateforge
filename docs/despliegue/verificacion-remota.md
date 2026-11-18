# Verificación remota: mantenimiento, almacenamiento, IP y aislamiento

Matriz de comprobaciones en producción para lo que las pruebas locales no pueden demostrar, con los resultados de la ronda del **18/11/2026**. Una fila sin resultado anotado sigue **pendiente**.

Las pruebas locales usan PostgreSQL 17 real y el **simulador** de Vercel Blob (`STORAGE_LOCAL_SIGNED_URLS=1`). El simulador reproduce el contrato que espera la API, pero no demuestra cómo se comporta el servicio real: por eso las filas de Blob se repiten contra el store privado de producción.

Documentación oficial consultada el 18/11/2026: [Managing Cron Jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs) (cabecera `Authorization: Bearer <CRON_SECRET>`, `user-agent: vercel-cron/1.0`, solo en Production, ejecución manual desde el panel), [`vercel crons`](https://vercel.com/docs/cli/crons), [Runtime Logs](https://vercel.com/docs/logs/runtime) (Hobby: **1 hora** de retención), [`vercel blob`](https://vercel.com/docs/cli/blob), [Request headers](https://vercel.com/docs/headers/request-headers) y [Rewrites](https://vercel.com/docs/routing/rewrites).

## Resumen de la ronda del 18/11/2026

**Código desplegado.** El CI de Linux pasó sobre `3dc83ee` ([ejecución 44338627147](https://github.com/DavidOrtegaH/estateforge/actions/runs/44338627147); cifras verificadas en GitHub: API 2361, web 683, shared 212, scripts 60) y los cambios de código se integraron por avance rápido en `feature`, `develop`, `release` y `main`. Versiones y etiquetas, sin cambios. La migración `20261118120000_maintenance_runs` se probó antes en una rama temporal de Neon (eliminada después) y se aplicó en producción con `prisma migrate deploy`. El despliegue de la API vigente es `dpl_6QefdFA6ZNPxZA6TFHr6F2AM9RBf`. La web no ha cambiado.

| Área | Resultado |
|---|---|
| Mantenimiento | M-1 y M-2 hechos. **La ejecución programada (M-3, M-4, M-5) sigue pendiente** |
| Vercel Blob real | B-1, B-3, B-4, B-5, B-7, B-10, B-11 y B-12 hechos; B-2, B-6, B-8 y B-9 hechos con el alcance limitado que se indica en cada fila |
| Multimedia | MP4 con «Piano sereno» escuchado por el titular (manual). WebM en producción confirmado por el titular en Firefox: aparece como WebM, se escucha bien y se borra todo (manual, sin inspección del archivo). Quedan pendientes los dispositivos físicos |
| IP del cliente (MD-4) | Una sola red por la web; diagnóstico retirado. **Riesgo aceptado, no resuelto técnicamente:** la prueba desde dos redes queda fuera de alcance y `CLIENT_IP_SOURCE` permanece en `socket` |
| Aislamiento | Muestra con el OWNER y una cuenta USER temporal: sin fugas. No equivale a dos cuentas USER ni al barrido de todas las rutas |
| Limpieza | Primera ronda: tres inmuebles sintéticos, sus anuncios y archivos borrados; cuenta temporal eliminada. Segunda ronda (cierre de almacenamiento): dos inmuebles y otra cuenta temporal borrados por la API; base y store sin restos. Prueba manual de WebM: el titular borró su contenido de prueba; después, inmuebles del OWNER 0, `StorageCleanup` 0 y prefijo de Blob del OWNER vacío. OWNER conservado |

**Segunda ronda (cierre de almacenamiento y multimedia, 18/11/2026, 16:38–16:58 UTC).** Mismo despliegue de la API (`dpl_6QefdFA6ZNPxZA6TFHr6F2AM9RBf`), sin cambios funcionales. Cuenta USER temporal nueva, verificada por el titular, con dos inmuebles sintéticos; contraseña, cookie y URLs firmadas solo en memoria del proceso de pruebas, que se cerró con normalidad al terminar. Sin leer `.env`, sin cambiar la configuración de los proveedores y sin llamadas a proveedores de IA. Resultados en B-5, B-6, B-10 y B-11 y en «Prioridad 3».

## Reglas para todas las comprobaciones

- Solo datos sintéticos: inmuebles, textos e imágenes inventados, PNG generados y audio sintético. Ningún dato real de personas ni de inmuebles.
- Sin proveedores de IA: ninguna comprobación necesita claves ni llama a un proveedor.
- Ningún secreto en las evidencias: ni `CRON_SECRET`, ni cookies de sesión, ni tokens de Blob, ni URLs firmadas completas (se anotan sin la cadena de consulta). Las IP públicas de quien prueba son datos personales: en las evidencias se anotan enmascaradas y no se publican.
- Los secretos que haya que usar se mantienen solo en memoria, sin mostrarlos, y se descartan al terminar. No se escriben en archivos ni en el historial.
- Sin consultas SQL de escritura en producción. Las consultas de esta guía son de solo lectura.
- Cada comprobación termina con su limpieza. Lo que no se pueda limpiar se anota.

## Requisitos previos

| Requisito | Para qué | Estado |
|---|---|---|
| Aplicar la migración `20261118120000_maintenance_runs` con `prisma migrate deploy` y la URL **directa** de Neon, y después desplegar la API | Tabla `MaintenanceRun` | **Hecho** (18/11/2026) |
| Acceso de lectura a la base de producción | Consultar `MaintenanceRun`, `StorageCleanup` y recuentos | Disponible |
| CLI de Vercel autenticada en el proyecto `api` | `vercel crons`, `vercel logs`, listados de Blob | Disponible |
| Dos cuentas sintéticas verificadas con rol USER | Aislamiento entre cuentas | **Parcial:** se usó el OWNER existente y una cuenta USER temporal, ya eliminada |
| Dos redes con IP pública distinta | MD-4 | **Fuera de alcance** por decisión del titular: no se hará |
| Autorización para definir temporalmente `CLIENT_IP_DIAGNOSTIC_UNTIL` | Diagnóstico de MD-4 | Usada y retirada; no se vuelve a activar |

## Prioridad 1: mantenimiento diario

Distingue tres cosas que no son lo mismo:

- **Registro:** el cron figura en el proyecto. Comprobado: diario, `0 4 * * *` UTC.
- **Ejecución manual:** alguien la lanza desde el panel («Run») o con `vercel crons run`. Comprobada (M-2).
- **Ejecución programada:** Vercel la lanza solo, dentro de la hora indicada. **Pendiente.**

Cada ejecución autorizada deja una fila en `MaintenanceRun` con:

- el disparador (`vercel-cron` si la cabecera `user-agent` es exactamente `vercel-cron/1.0`; `manual` en cualquier otro caso);
- el estado, los contadores (`storageDeleted`, `storageFailed`, `auditDeleted`, `queuePending`) y la duración;
- `startedAt` y `finishedAt`.

No guarda datos personales, claves de archivos ni secretos. Una petición sin el secreto no deja ninguna fila.

| ID | Comprobación | Pasos | Resultado esperado | Resultado (18/11/2026) |
|---|---|---|---|---|
| M-1 | Rechazo sin secreto | `curl` a `https://estateforge-api.vercel.app/api/internal/cron/storage-cleanup` sin cabecera y con `Authorization: Bearer incorrecto-…` | `401` las dos veces, con `Cache-Control: no-store`; `MaintenanceRun` no cambia | **Hecho.** `401` y `no-store` en los dos casos; la tabla siguió vacía |
| M-2 | Ejecución manual | Anotar la hora UTC, lanzar `vercel crons run` una sola vez y consultar `MaintenanceRun` | Fila nueva con `status = 'ok'` dentro del minuto anotado | **Hecho** a las 15:47:54 UTC: `trigger = 'vercel-cron'`, `status = 'ok'`, todos los contadores a 0, `durationMs` 171. La ejecución manual de la CLI usa el **mismo** `user-agent` que la programada, así que solo se distingue por la hora. Esta fila **no** acredita M-3 |
| M-3 | **Ejecución programada** | Después de las 05:00 UTC del 19/11/2026: `SELECT trigger, status, "storageDeleted", "storageFailed", "auditDeleted", "queuePending", "durationMs", "startedAt" FROM "MaintenanceRun" ORDER BY "startedAt" DESC LIMIT 5;` | Una fila `vercel-cron`, `status = 'ok'`, con `startedAt` entre las 04:00 y las 04:59:59 UTC, sin ninguna ejecución manual en esa franja | **Pendiente:** ventana del 19/11/2026, 04:00–04:59 UTC. No se lanza nada a mano en esa franja |
| M-4 | Repetición diaria | Repetir M-3 al día siguiente (20/11/2026) | Una fila `vercel-cron` por día. Vercel no reintenta una ejecución fallida | **Pendiente** |
| M-5 | Cola acotada | `SELECT count(*), max(attempts) FROM "StorageCleanup";` tras M-3 | `queuePending` coincide con el recuento; `max(attempts)` no crece día a día | **Pendiente** (tras la limpieza de esta ronda, la cola estaba en 0) |

Qué no acredita una ejecución programada: un `200` en M-2, la presencia del cron en el panel o una fila `vercel-cron` fuera de la franja de las 04:00 UTC.

## Prioridad 1: Vercel Blob real

Para obtener una URL de subida se envía `POST /api/uploads` con un JSON como `{"kind":"photo","contentType":"image/png","size":<bytes>,"propertyId":"<inmueble sintético>"}`. La respuesta trae `attemptId` y `upload.url`. Las URLs firmadas no se copian completas en las evidencias.

**Cómo valida el tipo cada capa.** Blob deduce el tipo del objeto a partir de la **extensión de la ruta firmada**, que fija la API; la cabecera `Content-Type` del `PUT` por sí sola no provoca un rechazo. La API valida los **bytes reales** al confirmar (firma del formato, dimensiones y coincidencia con el tipo autorizado).

| ID | Comprobación | Resultado esperado | Resultado (18/11/2026) |
|---|---|---|---|
| B-1 | Sin sobrescritura: dos `PUT` iguales a la misma URL | Primer `PUT` 2xx; el segundo, rechazado; una sola fotografía tras confirmar | **Hecho.** `PUT` 200, repetición 400, confirmación 200; una sola fotografía PNG (90 909 bytes) |
| B-2 | Tipo distinto del autorizado | Cambiar solo la cabecera `Content-Type` **no** provoca rechazo de Blob (la extensión firmada fija el tipo). Enviar bytes de otro formato bajo una autorización PNG: la confirmación responde `415 TYPE_MISMATCH` | **Hecho (matriz corregida).** PNG con cabecera `image/jpeg`: Blob 200 (la confirmación dio `409 DUPLICATE` porque ese PNG ya existía en el inmueble). JPEG real bajo autorización PNG: `415 TYPE_MISMATCH` al confirmar. No se deduce fuga ni debilitamiento de la validación |
| B-3 | Más bytes de los declarados | Rechazado por Blob | **Hecho.** N + 1000 bytes: `403` |
| B-4 | Menos bytes de los declarados | Blob acepta; la confirmación responde `INVALID_FILE` y el objeto se borra | **Hecho.** Blob 200; confirmación `400 INVALID_FILE`; el objeto no aparece en el listado final |
| B-5 | URL de subida caducada | `PUT` después del vencimiento rechazado; un intento **pendiente** que vence sin completarse responde `410 UPLOAD_EXPIRED` al confirmar | **Hecho.** Primera ronda: el `PUT` se envió por error unos segundos antes del vencimiento (200) y el intento se confirmó antes de vencer; después, la misma URL respondió `403` y la confirmación, `200` idempotente. Segunda ronda: intento preparado a las 16:41:29 UTC con vencimiento 16:56:29.174 UTC, **sin `PUT` ni confirmación previos**; a las 16:56:35 UTC, ya vencido, `PUT` → `403` y confirmación → `410 UPLOAD_EXPIRED` |
| B-6 | La URL de lectura se reutiliza hasta su caducidad | Varias lecturas `200`; `403` tras caducar | **Hecho para fotografías, con alcance acotado.** Primera ronda: sonda del SDK con 120 s (tres `GET` 200 y `403` tras vencer). Segunda ronda, **URL emitida por la propia aplicación** para una fotografía PNG sintética de 90 909 bytes subida por el flujo normal, con vencimiento 16:55:00 UTC: tres `GET` 200 con los mismos bytes y el mismo SHA-256; la respuesta de la app lleva `Cache-Control: private, no-store` y `Vary: Cookie`; el objeto, caché `private`. A las 16:55:05 UTC: `GET` con la URL antigua → `403`; nueva autorización de la app → `200`; lectura con la URL nueva → `200`. **No acredita** la renovación interna de la delegación de lectura de 2 h ni la caducidad de las URLs de audio y vídeo |
| B-7 | Range | `206` con `Content-Range` correcto en el primer y el último bloque; `416` con `bytes */<total>` fuera de tamaño | **Hecho.** Fotografía, por la ruta de la API: `206` en el primer y el último bloque, `416` fuera de tamaño, caché `private`. Fotografía, directamente en Blob: `Content-Range` correcto en los primeros y los últimos 1024 bytes y `bytes */90909` en el `416`; `bytes=-` → `416`. MP4 sintético generado en la interfaz (13,53 s, 1280×720, 3 227 165 bytes), con URL de lectura temporal del SDK: `206` en el primer y el último bloque, `Accept-Ranges: bytes`, `416` con `bytes */3227165`, `Content-Type: video/mp4`. La respuesta `416` del proveedor puede incluir el contenido completo; se anota como comportamiento del proveedor |
| B-8 | Cabeceras y caché de Blob | `Content-Type` igual al del archivo; ninguna caché pública | **Hecho (observación).** `image/png` y `video/mp4` correctos; `Cache-Control: private` en fotografía y vídeo |
| B-9 | CORS desde la web | `fetch` y `PUT` funcionan desde el dominio de la web | **Parcial.** La subida real de fotografías y el guardado del cartel desde la interfaz funcionaron. Lectura del MP4 con el `Origin` de la web: `Access-Control-Allow-Origin: *`. Un `OPTIONS` sobre una URL firmada **solo para GET** respondió `403` con `ACAO *`; eso no demuestra un fallo del `GET` simple ni del flujo de la interfaz, y **no se ha verificado** la petición previa de un `PUT` con esta sonda |
| B-10 | Los objetos borrados ya no existen en el store | Listado del prefijo vacío; `StorageCleanup` = 0 | **Hecho.** Tras borrar los tres inmuebles: SQL con 0 inmuebles, 0 anuncios y `StorageCleanup` = 0; listado directo con el SDK de los prefijos de las dos cuentas: 0 objetos, `hasMore` falso, incluidos los archivos fallidos y la segunda fotografía de B-5. Comprobación individual posterior: `head` del SDK sobre los cinco objetos originales → `BlobNotFoundError` en los cinco (ausentes 5, presentes 0); listado repetido de los dos prefijos: A 0 y B 0, `hasMore` falso. La sexta fotografía, creada en la prueba de caducidad (B-5), queda cubierta por el listado del prefijo B, no por esas cinco consultas `head`. Se comprobó con `head` del SDK, **no** con `GET` de las URLs antiguas: que esas URLs fallen tras el borrado no está probado. Segunda ronda: borrado normal por la API de los dos inmuebles (`200`/`200`) y de la cuenta temporal con su contraseña (`200`); SQL: cuenta temporal 0, inmuebles de prueba 0, intentos de subida 0, `StorageCleanup` 0, OWNER 1; listado del prefijo: 0 objetos, `hasMore` falso; `head` de la fotografía: ausente |
| B-11 | Cuota | Sin superar la cuota; ninguna `500` | **Hecho, también con concurrencia.** Segunda ronda, a las 16:41:15 UTC: **40 solicitudes `POST /api/uploads` simultáneas** (reservas de espacio previas a la subida; no se transfirieron 40 archivos) de 4 194 304 bytes, repartidos entre dos inmuebles: 25 aceptados (exactamente 104 857 600 bytes = 100 MiB), 15 rechazados con `409 QUOTA_EXCEEDED`, ninguna `500` y sin superar la cuota; las 25 reservas se cancelaron (`204`) y no quedó ninguna pendiente. Valida esa carga y configuración concretas, no el rendimiento ni una carga sostenida. Primera ronda, secuencial (matriz corregida): en un inmueble de la cuenta USER, con una fotografía y otro intento pendiente: 24 reservas de 4 194 304 bytes → `201`; la 25.ª y la 26.ª → `409 LIMIT_REACHED` (100 MB por inmueble). En un **segundo** inmueble, la reserva adicional → `409 QUOTA_EXCEEDED` (cuota de 100 MB del usuario). Cancelaciones `204`. Para probar la cuota de usuario hay que **repartir las reservas entre dos inmuebles**: con uno solo se alcanza antes el límite del inmueble. Esas peticiones fueron secuenciales; la concurrencia se cubrió en la segunda ronda |
| B-12 | Sin huérfanos | Cada objeto listado corresponde a un archivo visible | **Hecho.** Antes de la limpieza, listado directo: 3 objetos de la cuenta A y 1 de la cuenta USER, todos referenciados en la base, sin adicionales ni ausentes. Después, ambos prefijos vacíos (B-10) |

Pasos detallados de referencia, por si se repiten:

- **B-2:** preparar con `image/png` y, en una URL, enviar un PNG con `Content-Type: image/jpeg`; en otra, enviar bytes JPEG. Confirmar cada una.
- **B-5:** preparar, **no** enviar nada, esperar a que venza (15 min) y confirmar: se espera `410 UPLOAD_EXPIRED`. Aparte, enviar el `PUT` después del vencimiento: rechazado.
- **B-6:** con la URL que devuelve `GET /api/properties/<id>/photos/<foto>/file?as=url`, pedirla tres veces y otra vez pasado su plazo (10 a 15 min para imágenes).
- **B-7:** `curl -s -D - -o /dev/null -H 'Range: bytes=0-1023' "$URL"`, luego `bytes=-1024`, `bytes=999999999-` y `bytes=-`.
- **B-11:** cuota del inmueble con un inmueble; cuota del usuario repartiendo las reservas entre dos. Para la concurrencia, lanzar las peticiones en paralelo y comprobar que ninguna `201` supera la cuota y que no hay `500`; después, cancelar las reservas.

## Prioridad 1: IP del cliente (MD-4, riesgo aceptado)

**Decisión del titular (18/11/2026):** la prueba desde dos redes (y con ella IP-2 a IP-4) queda **fuera de alcance y no se hará**. MD-4 **no** se considera resuelto técnicamente: es un riesgo aceptado. `CLIENT_IP_SOURCE` permanece en `socket` y el diagnóstico, ya retirado, no se vuelve a activar. Consecuencia aceptada: las peticiones que llegan por la reescritura pueden compartir el cupo del rate-limit. No se ha probado desde dos redes ni con cabeceras suplantadas.

La documentación de Vercel indica que una reescritura hacia un origen externo reenvía `x-forwarded-for` y `x-real-ip`, pero no qué recibe en `x-vercel-forwarded-for` un segundo proyecto de Vercel; no se ha medido más allá de IP-1.

Diagnóstico temporal (usado el 18/11/2026 y retirado) (`apps/api/src/routes/client-ip-diagnostic.routes.ts`): `GET /api/admin/diagnostics/client-ip` solo existe si `CLIENT_IP_DIAGNOSTIC_UNTIL` contiene una fecha ISO 8601 futura, como mucho a 72 h; solo responde al OWNER; devuelve el dominio de llegada, la IP del socket, las cabeceras de proxy y la IP que usaría el rate-limit con cada valor de `CLIENT_IP_SOURCE`; no registra nada y lleva `Cache-Control: no-store`.

| ID | Comprobación | Resultado esperado | Resultado (18/11/2026) |
|---|---|---|---|
| IP-0 | Activación | `401` sin sesión | **Hecho**, con autorización del titular y ventana acotada: `401` sin sesión |
| IP-1 | Red 1, a través de la web | Anotar `socketIp`, `x-forwarded-for`, `x-vercel-forwarded-for` y `x-real-ip` | **Hecho.** IP del socket: loopback. `x-forwarded-for` y `x-vercel-forwarded-for` coinciden con la IP pública de la red (enmascarada en las evidencias). La cabecera `host` llega como el dominio de la API también a través de la reescritura, así que no identifica por sí sola el dominio público de origen |
| IP-2 | Red 1, dominio de la API | `x-vercel-forwarded-for` con la IP pública de la red | **Fuera de alcance** (no se hará): requiere reactivar el diagnóstico |
| IP-3 | Red 2 | Las IP de cada red son distintas y coinciden con su IP pública | **Fuera de alcance** (no se hará): decisión del titular |
| IP-4 | Cabeceras falsificadas | `clientIp.vercel` nunca toma el valor falsificado | **Fuera de alcance** (no se hará): requiere reactivar el diagnóstico |
| IP-5 | Retirada | `404` con la sesión del OWNER | **Hecho.** Variable eliminada y API desplegada de nuevo (`dpl_6QefdFA6ZNPxZA6TFHr6F2AM9RBf`, mismo código); la ruta responde `404` con `no-store` al OWNER |

Con una sola red no se puede deducir que el modo `vercel` sea seguro, así que **no se activa**. MD-4 queda como riesgo aceptado:

- `CLIENT_IP_SOURCE` permanece en `socket`; `CLIENT_IP_DIAGNOSTIC_UNTIL` permanece sin definir.
- No se usa `x-forwarded-for` ni `x-real-ip`.
- Las alternativas (servir la web y la API desde un mismo proyecto, o una cabecera secreta añadida por la reescritura) serían cambios de arquitectura y no están previstas.

## Prioridad 2: aislamiento entre cuentas en producción

En local, `apps/api/src/integration/account-isolation.integration.test.ts` recorre todas las rutas con identificador como cuenta intrusa. En producción se tomó una muestra para comprobar que la configuración real (reescritura, cookies y caché) no cambia ese resultado.

**Alcance exacto de la ronda del 18/11/2026.** Cuenta A: el OWNER existente, con un inmueble sintético creado para la prueba (fotografía y cartel). Cuenta B: una cuenta USER temporal, verificada por el titular. Solo se usaron recursos sintéticos de esta ronda. **No equivale** a la prueba con dos cuentas USER ni al barrido de todas las rutas; la pista de audio no se incluyó.

| ID | Comprobación | Resultado esperado | Resultado (18/11/2026) |
|---|---|---|---|
| I-1 | Datos de A | — | Inmueble sintético con fotografía y cartel creados desde la interfaz |
| I-2 | Lecturas de B | `404` sin URL firmada, con `no-store` o `private` | **Hecho.** `404` con `no-store` al leer el inmueble, la fotografía y el cartel de A. Las mismas respuestas que con identificadores inexistentes. La lectura del inmueble propio de B: `200` |
| I-3 | Escrituras de B | `404`; datos de A sin cambios | **Hecho.** `404` con `no-store` al cambiar el título, borrar la fotografía, preparar una subida contra el inmueble de A y crear un anuncio desde él (`POST /api/generations/from-property`, que antes respondía `500`). La consulta SQL posterior confirmó el título de A intacto, una fotografía y un cartel |
| I-4 | Administración | `403` | **Hecho.** `403` con `no-store` |
| I-5 | Limpieza | Sin objetos de A ni de B en el store | **Hecho** (ver B-10). B borró sus dos inmuebles con la API y A el suyo desde la interfaz. La cuenta temporal la eliminó su titular desde «Cuenta», tras recuperar la contraseña por el flujo normal; el OWNER se conserva |

Pendiente: repetir la muestra con dos cuentas USER e incluir una pista de audio.

## Prioridad 3: otras comprobaciones

- **Restablecimiento de contraseña tras la redirección al login: confirmado por el titular** (18/11/2026). Con la cuenta temporal completó el flujo normal: el enlace de recuperación, la redirección al inicio de sesión, el acceso con la contraseña nueva y la eliminación de la cuenta desde «Cuenta». Es una confirmación manual del titular, no una prueba automatizada del navegador.
- **MP4 con «Piano sereno»: escuchado por el titular** (18/11/2026). Reprodujo el MP4 descargado de producción (3 916 958 bytes) y confirmó que se oye correctamente, sin cortes ni distorsión evidentes. Es una confirmación humana de ese archivo, no una prueba automatizada ni de todos los dispositivos.
- **WebM en producción: confirmado por el titular** (18/11/2026). El control automático de Firefox no fue posible (la herramienta no puede aplicar su política de URLs a ese navegador; no se eludió y no indica un fallo de EstateForge), así que el titular hizo la prueba a mano en Firefox, con acceso confirmado por él: inmueble sintético, imagen sintética, generación clásica con «Piano sereno» y borrado posterior. Respondió: «Se escucha bien, aparece como WebM, se elimina todo bien». Quedan acreditados por confirmación humana el formato WebM, la escucha correcta y el borrado. No es una prueba automatizada ni una inspección del binario ni de las cabeceras Range del WebM, no se verificaron por separado la imagen ni el avance, y no se infiere compatibilidad con Safari ni con todos los dispositivos. Comprobación posterior: OWNER conservado (1), inmuebles del OWNER 0, `StorageCleanup` 0 y listado de Blob del prefijo del OWNER con 0 objetos y `hasMore` falso.
- Pendientes: tiempos de Neon tras escalar a cero; proveedores de IA con claves reales (necesitan autorización aparte, porque tienen coste); dispositivos físicos.
- **Safari: fuera de alcance** por decisión del titular (18/11/2026). No se probará; queda sin validar, sin prometer compatibilidad validada y sin retirar el soporte existente.

## Registro de resultados

Para cada fila, anotar:

- fecha y hora UTC;
- quién la ejecutó;
- el resultado obtenido, junto al esperado;
- la evidencia saneada: sin cookies, URLs firmadas ni identificadores privados, y con las IP enmascaradas;
- la limpieza realizada.
