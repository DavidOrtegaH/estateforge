# Verificación remota: mantenimiento, almacenamiento, IP y aislamiento

Matriz de comprobaciones en producción para lo que las pruebas locales no pueden demostrar. Preparada el **18/11/2026** sobre el código posterior a `ea5dbf0` (rama `feature`). Ninguna de estas comprobaciones se ha ejecutado todavía en producción: **todas están pendientes** hasta que se anote su resultado.

Las pruebas locales usan PostgreSQL 17 real y el **simulador** de Vercel Blob (`STORAGE_LOCAL_SIGNED_URLS=1`). El simulador reproduce el contrato que espera la API, pero no demuestra cómo se comporta el servicio real: por eso cada fila de Blob de esta guía tiene que repetirse contra el store privado de producción.

Documentación oficial consultada el 18/11/2026: [Managing Cron Jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs) (cabecera `Authorization: Bearer <CRON_SECRET>`, `user-agent: vercel-cron/1.0`, solo en Production, ejecución manual desde el panel), [`vercel crons`](https://vercel.com/docs/cli/crons), [Runtime Logs](https://vercel.com/docs/logs/runtime) (Hobby: **1 hora** de retención), [`vercel blob`](https://vercel.com/docs/cli/blob), [Request headers](https://vercel.com/docs/headers/request-headers) y [Rewrites](https://vercel.com/docs/routing/rewrites).

## Reglas para todas las comprobaciones

- Solo datos sintéticos: inmuebles, textos e imágenes inventados, PNG generados y audio sintético. Ningún dato real de personas ni de inmuebles.
- Sin proveedores de IA: ninguna comprobación necesita claves ni llama a un proveedor.
- Ningún secreto en las evidencias: ni `CRON_SECRET`, ni cookies de sesión, ni tokens de Blob, ni URLs firmadas completas (se anotan sin la cadena de consulta). Las IP públicas de quien prueba son datos personales: en las evidencias se anotan enmascaradas (por ejemplo, `83.45.x.x`).
- Los secretos que haya que usar se cargan en una variable del shell sin mostrarlos (`read -rs`) y se borran al terminar (`unset`). No se escriben en archivos ni en el historial.
- Sin consultas SQL de escritura en producción. Las consultas de esta guía son de solo lectura.
- Cada comprobación termina con su limpieza. Lo que no se pueda limpiar se anota.

## Requisitos previos

| Requisito | Para qué | Quién |
|---|---|---|
| Aplicar la migración `20261118120000_maintenance_runs` con `prisma migrate deploy` y la URL **directa** de Neon, y después desplegar la API con este código | Tabla `MaintenanceRun` (constancia de cada ejecución del mantenimiento). Es aditiva: una tabla nueva, sin tocar datos. Si se despliega antes de migrar, el mantenimiento funciona igual, pero registra un error y no deja constancia | Codex, con autorización del titular |
| Acceso de lectura a la base de producción (consola SQL de Neon o `psql` con la URL directa) | Consultar `MaintenanceRun`, `StorageCleanup` y recuentos | Codex |
| CLI de Vercel autenticada en el equipo y el proyecto `api` | `vercel crons`, `vercel logs`, `vercel blob list` | Codex |
| Dos cuentas sintéticas verificadas, A y B, con rol USER | Aislamiento entre cuentas. La segunda necesita una dirección de correo más que controle el titular (por ejemplo, un alias) | Titular (registro y verificación) |
| Dos redes con IP pública distinta (por ejemplo, la wifi de casa y los datos del móvil) | MD-4 | Titular o Codex |
| Autorización del titular para definir temporalmente `CLIENT_IP_DIAGNOSTIC_UNTIL` y volver a desplegar la API | Diagnóstico de MD-4 | Titular |

## Prioridad 1: mantenimiento diario

Distingue tres cosas que no son lo mismo:

- **Registro:** el cron figura en el proyecto. Ya comprobado: diario, `0 4 * * *` UTC.
- **Ejecución manual:** alguien la lanza desde el panel («Run») o con `vercel crons run`.
- **Ejecución programada:** Vercel la lanza solo, dentro de la hora indicada. Es lo que falta por acreditar.

Cada ejecución autorizada deja una fila en `MaintenanceRun` con:

- el disparador (`vercel-cron` si la cabecera `user-agent` es exactamente `vercel-cron/1.0`; `manual` en cualquier otro caso);
- el estado, los contadores (`storageDeleted`, `storageFailed`, `auditDeleted`, `queuePending`) y la duración;
- `startedAt` y `finishedAt`.

No guarda datos personales, claves de archivos ni secretos. Una petición sin el secreto no deja ninguna fila.

| ID | Comprobación | Pasos | Resultado esperado | Limpieza |
|---|---|---|---|---|
| M-1 | Rechazo sin secreto | `curl -s -o /dev/null -w '%{http_code}\n' https://estateforge-api.vercel.app/api/internal/cron/storage-cleanup` y lo mismo con `-H 'Authorization: Bearer incorrecto-0000000000000000'` | `401` las dos veces, con `Cache-Control: no-store`. `SELECT count(*) FROM "MaintenanceRun"` no cambia | Ninguna |
| M-2 | Ejecución manual desde Vercel | Antes, anotar la hora UTC exacta y `SELECT count(*) FROM "StorageCleanup"`. Lanzar el cron desde el panel (pestaña de Cron Jobs, «Run») o con `vercel crons run /api/internal/cron/storage-cleanup`. Antes de una hora, revisar los registros de esa invocación en el panel | La invocación responde `200`. En los registros aparece «Mantenimiento diario ejecutado» con el objeto `maintenance` (contadores, duración, disparador). Hay una fila nueva en `MaintenanceRun` con `status = 'ok'`, `startedAt` dentro del minuto anotado y `storageFailed = 0`. **Anotar qué disparador registra**: si Vercel usa el mismo `user-agent` para las ejecuciones manuales, aparecerá `vercel-cron` y la ejecución solo se distingue por su hora | Ninguna. Ejecuta la misma limpieza que el cron programado (solo archivos sin referencia de la cola y auditoría de más de 90 días sin incidente abierto) |
| M-3 | **Ejecución programada** | Al día siguiente del despliegue, después de las 05:00 UTC: `SELECT trigger, status, "storageDeleted", "storageFailed", "auditDeleted", "queuePending", "durationMs", "startedAt" FROM "MaintenanceRun" ORDER BY "startedAt" DESC LIMIT 5;` | Una fila con `trigger = 'vercel-cron'`, `status = 'ok'` y `startedAt` entre las 04:00 y las 04:59:59 UTC de ese día, y ninguna ejecución manual anotada en esa franja (la de M-2 tiene su propia hora). Es la evidencia de la ejecución programada. Los registros de Vercel solo duran 1 hora en Hobby: si se consultan entre las 04:00 y las 05:00 UTC, también deben mostrar la invocación | Ninguna |
| M-4 | Repetición diaria | Repetir la consulta de M-3 dos días seguidos | Una fila `vercel-cron` por día. Si falta un día, revisar el registro del cron en el panel; Vercel no reintenta una ejecución fallida | Ninguna |
| M-5 | Cola acotada | `SELECT count(*), max(attempts) FROM "StorageCleanup";` tras M-3 | `queuePending` de la fila coincide con el recuento. Si `max(attempts)` crece día a día, hay un archivo que no se puede borrar: anotar su `lastError` (solo el nombre del error) | Ninguna |

Qué no acredita una ejecución programada: un `200` en M-2, la presencia del cron en el panel o una fila `vercel-cron` fuera de la franja de las 04:00 UTC.

## Prioridad 1: Vercel Blob real

Flujo de cada prueba con la cuenta A en el navegador (herramientas de desarrollo, pestaña Red) o con `curl` y la cookie de A cargada sin mostrarla (`read -rs EF_COOKIE`).

Para obtener una URL de subida, enviar `POST /api/uploads` con un JSON como `{"kind":"photo","contentType":"image/png","size":<bytes>,"propertyId":"<inmueble sintético>"}`. La respuesta trae `attemptId` y `upload.url`. Las URLs firmadas no se copian completas en las evidencias.

| ID | Comprobación | Pasos | Resultado esperado | Limpieza |
|---|---|---|---|---|
| B-1 | Sin sobrescritura | Subir un PNG sintético a `upload.url` con `PUT` (`curl -T archivo.png -H 'Content-Type: image/png' "$URL"`) y repetir el mismo `PUT` | Primer `PUT` 2xx; el segundo, rechazado (4xx). Tras confirmar (`POST /api/uploads/<id>/complete`), la fotografía es la primera | Borrar la fotografía desde la interfaz |
| B-2 | Tipo distinto del autorizado | Preparar con `image/png` y enviar el `PUT` con `Content-Type: image/jpeg` | Rechazado por Blob (4xx). `complete` responde `409 UPLOAD_MISSING` | `DELETE /api/uploads/<id>` |
| B-3 | Más bytes de los declarados | Preparar con `size` = N y enviar N + 1000 bytes | Rechazado por Blob (4xx, `maximumSizeInBytes`) | `DELETE /api/uploads/<id>` |
| B-4 | Menos bytes de los declarados | Preparar con N y enviar un PNG válido de menos de N bytes | Blob lo acepta; `complete` responde `INVALID_FILE`, el intento queda `failed` y el objeto desaparece (comprobar con B-10) | Ninguna adicional |
| B-5 | URL de subida caducada | Preparar, esperar 16 minutos y enviar el `PUT` | Rechazado (4xx). `complete` responde `410 UPLOAD_EXPIRED` | Ninguna (el intento caduca solo) |
| B-6 | La URL de lectura **se reutiliza** hasta su caducidad (no es de un solo uso) | `GET /api/properties/<id>/photos/<foto>/file?as=url` y pedir esa URL tres veces; volver a pedirla pasados 16 minutos | Tres `200` con el mismo contenido; pasado el plazo (10 a 15 min para imágenes), `403` | Ninguna |
| B-7 | Range | Con la URL de lectura de un vídeo: `curl -s -D - -o /dev/null -H 'Range: bytes=0-1023' "$URL"`, luego `bytes=-1024`, `bytes=999999999-` y `bytes=-` | `206` con `Content-Range: bytes 0-1023/<total>` y `Accept-Ranges: bytes`; `206` con los últimos 1024 bytes; `416` con `Content-Range: bytes */<total>`; el último, `200` completo o `416` (anotar cuál) | Ninguna |
| B-8 | Cabeceras y caché de Blob | Anotar las cabeceras de la respuesta de B-6: `Cache-Control`, `Content-Type`, `X-Content-Type-Options`, `Content-Disposition`, `ETag`, `Age` y las `x-vercel-cache` | `Content-Type` igual al del archivo; ninguna cabecera de caché pública con contenido de otra cuenta. **Es una observación**: la documentación no especifica la caché de las lecturas privadas | Ninguna |
| B-9 | CORS desde la web | Desde la consola de `https://estateforge-blush.vercel.app`, `fetch(urlDeLectura)` y una subida real desde la interfaz; anotar la petición previa `OPTIONS` del `PUT` en la pestaña Red | `fetch` y `PUT` funcionan desde el dominio de la web; `OPTIONS` con `Access-Control-Allow-Origin` aceptable y sin credenciales | Borrar la fotografía |
| B-10 | **Los objetos borrados ya no existen en el store** | Antes de borrar, guardar (sin publicarla) la URL de lectura de una fotografía, de su miniatura y de un cartel. Borrar el inmueble sintético desde la interfaz. Pedir de nuevo esas URLs y listar con `vercel blob list --prefix u/<id de la cuenta A>/p/<id del inmueble>/` | Las URLs responden `404`; el listado del prefijo, vacío. `SELECT count(*) FROM "StorageCleanup"` = 0 | Ninguna |
| B-11 | Cuota con subidas simultáneas | Con la cuota de 100 MB y la cuenta A sin archivos, lanzar 40 `POST /api/uploads` simultáneos de `size` = 4 194 304 para un inmueble sintético, sin subir nada (`for i in $(seq 40); do curl … & done; wait`) | Como mucho 25 respuestas `201` (`STORAGE_USER_QUOTA_MB=100`: 104 857 600 bytes / 4 194 304, sin superar la cuota) y el resto `QUOTA_EXCEEDED`; ninguna `500`. En local, con PostgreSQL real y el simulador, el mismo caso a menor escala está en `storage-maintenance.integration.test.ts` | `DELETE /api/uploads/<id>` de cada `201` (o dejar que caduquen en 15 min) |
| B-12 | Sin huérfanos tras las pruebas | Al terminar, `vercel blob list --prefix u/<id de la cuenta A>/` y comparar con las fotografías, miniaturas, materiales y pistas que muestra la interfaz | Cada objeto listado corresponde a un archivo visible; ninguno de los intentos fallidos, cancelados o caducados de B-2 a B-5 | Anotar cualquier diferencia; no borrar a mano sin revisarla |

Coste orientativo: menos de 60 operaciones avanzadas y unos pocos MB de transferencia, dentro de la cuota mensual de Hobby (2 000 avanzadas y 10 GB).

## Prioridad 1: IP del cliente (MD-4)

`CLIENT_IP_SOURCE` sigue en `socket` y no se cambia durante estas pruebas. La documentación de Vercel indica que una reescritura hacia un origen externo reenvía `x-forwarded-for` y `x-real-ip`. No dice qué recibe en `x-vercel-forwarded-for` un segundo proyecto de Vercel. Por eso hay que medirlo.

Diagnóstico temporal (`apps/api/src/routes/client-ip-diagnostic.routes.ts`):

- `GET /api/admin/diagnostics/client-ip` solo existe si `CLIENT_IP_DIAGNOSTIC_UNTIL` contiene una fecha ISO 8601 futura y como mucho a **72 horas**. Pasada esa fecha responde 404 aunque la variable siga definida.
- Solo responde al OWNER; cualquier otra cuenta recibe 403.
- Devuelve:
  - el dominio de llegada;
  - la IP del socket;
  - las cabeceras `x-forwarded-for`, `x-vercel-forwarded-for`, `x-real-ip`, `forwarded` y `x-vercel-id`;
  - la IP que usaría el rate-limit con cada valor de `CLIENT_IP_SOURCE`.
- No registra nada y lleva `Cache-Control: no-store`.

| ID | Comprobación | Pasos | Resultado esperado | Limpieza |
|---|---|---|---|---|
| IP-0 | Activación | Definir en el proyecto `api` (Production) `CLIENT_IP_DIAGNOSTIC_UNTIL` = ahora + 24 h, en UTC (`2026-11-20T18:00:00Z`), y volver a desplegar la API. Sin sesión, `GET https://estateforge-blush.vercel.app/api/admin/diagnostics/client-ip` | `401` sin sesión; con una cuenta USER, `403` | — |
| IP-1 | Red 1, a través de la web | Con la sesión del OWNER en el navegador, abrir `https://estateforge-blush.vercel.app/api/admin/diagnostics/client-ip` | `host` es el dominio de la web. Anotar (enmascarados) `socketIp`, `x-forwarded-for`, `x-vercel-forwarded-for` y `x-real-ip`, y compararlos con la IP pública de la red (por ejemplo, la que muestra el router) | — |
| IP-2 | Red 1, dominio de la API | `curl -s -H "Cookie: $EF_COOKIE" https://estateforge-api.vercel.app/api/admin/diagnostics/client-ip` con la cookie del OWNER cargada con `read -rs` | `host` es el de la API; `x-vercel-forwarded-for` debería ser la IP pública de la red | — |
| IP-3 | Red 2 | Repetir IP-1 e IP-2 desde la segunda red | Las IP de cada red son distintas. Si en IP-1 `x-vercel-forwarded-for` cambia con la red y coincide con la IP pública, la reescritura conserva la IP del cliente | — |
| IP-4 | Cabeceras falsificadas | Repetir IP-1 (con `curl` y la cookie) e IP-2 añadiendo `-H 'X-Forwarded-For: 1.2.3.4' -H 'X-Vercel-Forwarded-For: 1.2.3.4' -H 'X-Real-IP: 1.2.3.4'` | `clientIp.vercel` sigue siendo la IP pública de la red, nunca `1.2.3.4`. Si alguna ruta devuelve `1.2.3.4` en `x-vercel-forwarded-for`, el modo `vercel` **no** es seguro por esa ruta | — |
| IP-5 | Retirada | Eliminar `CLIENT_IP_DIAGNOSTIC_UNTIL` y volver a desplegar (o dejarla vencer). Pedir la ruta con la sesión del OWNER | `404` | Anotar la hora de retirada |

Decisión con los resultados:

- **Se puede activar `CLIENT_IP_SOURCE=vercel`** solo si, por los dos dominios y desde las dos redes, `x-vercel-forwarded-for` contiene la IP pública de cada red e IP-4 no la altera. Después de activarlo, hay que repetir IP-1 y comprobar que `clientIp.configuredSource` es `vercel`.
- **Hay que mantener `socket`** si por la web llega una IP de Vercel o la misma en las dos redes. Todas las peticiones compartirían cupo de rate-limit. Las alternativas (servir la web y la API desde un mismo proyecto, o una cabecera secreta añadida por la reescritura) son cambios de arquitectura y quedan fuera de esta verificación.
- En ningún caso se usa `x-forwarded-for` ni `x-real-ip` sin haber demostrado que el cliente no puede escribirlos.

Una vez cerrado MD-4, la ruta de diagnóstico se elimina del código.

## Prioridad 2: aislamiento entre cuentas en producción

En local, `apps/api/src/integration/account-isolation.integration.test.ts` recorre todas las rutas con identificador como cuenta intrusa. En producción basta una muestra que demuestre que la configuración real (reescritura, cookies y caché) no cambia ese resultado.

| ID | Comprobación | Pasos | Resultado esperado | Limpieza |
|---|---|---|---|---|
| I-1 | Datos de A | Con A: crear un inmueble sintético con una fotografía, una pista sintética y un cartel. Anotar los identificadores del inmueble, la fotografía, el anuncio y la pista (pestaña Red) | — | Se limpia en I-5 |
| I-2 | Lecturas de B | Con la sesión de B: `GET /api/properties/<inmueble de A>`, `/api/properties/<inmueble de A>/photos/<foto>/file?as=url`, `/api/generations/<anuncio de A>/media/poster/file?as=url` y `/api/audio-tracks/<pista de A>/file?as=url` | `404` en todas, sin redirección ni URL firmada, con `Cache-Control: no-store` o `private` | — |
| I-3 | Escrituras de B | Con B: `PUT /api/properties/<inmueble de A>` con `{"title":"x"}`, `DELETE /api/properties/<inmueble de A>/photos/<foto>` y `POST /api/uploads` con `{"kind":"photo","contentType":"image/png","size":100,"propertyId":"<inmueble de A>"}` | `404` en todas; los datos de A, sin cambios en la interfaz de A | — |
| I-4 | Administración | Con B: `GET /api/admin/users` | `403` | — |
| I-5 | Limpieza | A borra su inmueble y su pista; B, si creó algo, también. Comprobar con B-10 | Sin objetos de A ni de B en el store | Si se quieren eliminar las cuentas sintéticas, desde «Cuenta» en la interfaz |

## Prioridad 3: otras comprobaciones abiertas

- Restablecer la contraseña de verdad después del despliegue que añadió la redirección al login.
- Escuchar el MP4 con «Piano sereno» y probar WebM en producción.
- Tiempos de Neon tras escalar a cero.
- Proveedores de IA con claves reales: necesitan autorización aparte, porque tienen coste.
- Safari y dispositivos físicos.

## Registro de resultados

Para cada fila, anotar:

- fecha y hora UTC;
- quién la ejecutó;
- el resultado obtenido, junto al esperado;
- la evidencia saneada: capturas sin cookies ni URLs firmadas e IP enmascaradas;
- la limpieza realizada.

Una fila sin resultado anotado sigue **pendiente**.
