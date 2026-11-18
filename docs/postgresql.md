# PostgreSQL

EstateForge usa PostgreSQL 17 mediante Prisma y `@prisma/adapter-pg`. La versión probada es la 17.11.

## Puesta en marcha en desarrollo

La API no usa SQLite: sin una `DATABASE_URL` `postgresql://` válida no arranca. Las migraciones SQLite antiguas están archivadas en `prisma/sqlite-history` y no se aplican.

### PostgreSQL de desarrollo en WSL (Ubuntu)

Los scripts de `scripts/wsl/` se ejecutan con el usuario Linux normal, sin `sudo`, y no tocan Windows:

1. **Herramientas (una vez):** `bash scripts/wsl/instalar-herramientas.sh` instala en `~/.local/ef-tools` Node.js 24.19.0, pnpm 11.20.0 y PostgreSQL 17 de PGDG. Verifica cada descarga: la firma GPG de las sumas de Node, la huella de la clave de PGDG y la firma de su índice, y el SHA-256 de cada paquete. El detalle queda en `~/.local/ef-tools/verificacion.txt`. Si ya tienes PostgreSQL 17 instalado con `apt` (`/usr/lib/postgresql/17/bin`), los scripts lo usan y este paso no hace falta.
2. **Clúster (una vez):** `bash scripts/wsl/postgres-dev.sh init` crea los datos en `~/.local/share/estateforge/pg17-dev` y lo deja escuchando solo en `127.0.0.1:55432`. Crea:
   - el rol `estateforge_app`, sin superusuario, `CREATEDB` ni `CREATEROLE`, propietario de `estateforge_dev` y de la base de sombra `estateforge_shadow`;
   - el rol `estateforge_test`, con `CREATEDB` y `CREATEROLE` pero sin superusuario, para las pruebas de integración.

   Las contraseñas son aleatorias y se guardan en `~/.config/estateforge/postgres-dev.env` (permisos 600). El administrador solo entra por un socket local privado (autenticación `peer`).
3. **Uso diario:** no hace falta abrir Ubuntu. `pnpm.cmd dev` lo arranca (ver más abajo), y desde PowerShell también están `pnpm.cmd db:dev:start | db:dev:status | db:dev:stop`. Dentro de Ubuntu sigue funcionando `bash scripts/wsl/postgres-dev.sh start | stop | status | port`.

Desde Windows, `127.0.0.1:55432` llega al servidor de WSL 2 gracias al reenvío de `localhost`, sin abrir ningún puerto a la red.

### Aplicación

1. Copia `apps/api/.env.example` a `apps/api/.env` (ignorado por Git). Copia en él `DATABASE_URL`, `SHADOW_DATABASE_URL`, `TEST_POSTGRES_ADMIN_URL` y `SEED_USER_PASSWORD` desde `~/.config/estateforge/postgres-dev.env`. Desde Windows, ese archivo está en `\\wsl.localhost\Ubuntu\home\<usuario>\.config\estateforge\postgres-dev.env`. No los copies a ningún archivo versionado.
2. Instala las dependencias: `pnpm install --frozen-lockfile`.
3. Genera el cliente: `pnpm --filter api db:generate`.
4. Aplica las migraciones: `pnpm --filter api db:migrate`.
5. Crea los datos de ejemplo con `pnpm --filter api db:seed`. Crea `demo@estateforge.test` y `otra@estateforge.test`, cuya contraseña es `SEED_USER_PASSWORD`. Los datos incluyen inmuebles en los cuatro estados, uno antiguo sin estado y un Checklist con portales y filas «Otro/a». El comando es repetible, no duplica nada y se niega a actuar fuera de localhost.
6. Arranca la API y la web: `pnpm dev` (en PowerShell, `pnpm.cmd dev`).

### Arranque automático con `pnpm dev`

`pnpm dev` ejecuta `node scripts/dev/postgres-wsl.mjs start` y, solo si termina bien, `pnpm run dev:apps` (la API y la web en paralelo, como siempre). El orquestador:

1. Busca la distribución Ubuntu de WSL (`wsl.exe --list --verbose`) y comprueba el usuario Linux. Ejecuta las órdenes sin contraseña, con `wsl.exe -d <distro> -u <usuario> --exec …`, y traduce la ruta del repositorio con `wslpath -a`, como un único argumento, así que los espacios no son un problema.
2. Consulta `scripts/wsl/postgres-dev.sh status`. Si PostgreSQL ya acepta conexiones, no lo toca. Si está detenido, ejecuta `start` y espera, con reintentos acotados, a que acepte conexiones. El script sigue siendo la única autoridad sobre el servidor: nunca se crea una segunda instancia.
3. Comprueba desde Windows que `127.0.0.1:<puerto>` responde. El puerto lo indica el propio script (`postgres-dev.sh port`): no está repetido en ningún otro sitio.
4. Se conecta con la configuración real de la API (`apps/api/.env`, mediante `apps/api/src/db/check-connection.ts`). Rechaza una URL que no sea PostgreSQL y comprueba que apunta a ese mismo puerto. No imprime nunca el usuario, la contraseña ni la URL.

Si cualquier paso falla, termina con código 1, no arranca la API ni la web y muestra los pasos de diagnóstico. Dos `pnpm dev` simultáneos no compiten: el segundo espera a que el primero termine de preparar la base.

**Al cerrar con Ctrl+C** se detienen pnpm, la API (con su cierre ordenado) y Vite. **PostgreSQL sigue en marcha** para la siguiente sesión u otros procesos; el orquestador ya ha terminado antes de arrancar la aplicación y no intercepta señales. Para detenerlo: `pnpm.cmd db:dev:stop`. Al apagar Windows o detenerse WSL, PostgreSQL se detiene con él, y el siguiente `pnpm.cmd dev` lo vuelve a arrancar.

| Variable (opcional) | Uso |
|---|---|
| `ESTATEFORGE_WSL_DISTRO` | Distribución de WSL. Obligatoria si hay varias Ubuntu (por ejemplo, `$env:ESTATEFORGE_WSL_DISTRO = "Ubuntu"`) |
| `ESTATEFORGE_WSL_USER` | Usuario Linux (`User` por defecto) |
| `ESTATEFORGE_DEV_DB_START=0` | No gestiona el servidor; solo comprueba la conexión de `apps/api/.env` (por ejemplo, con otro PostgreSQL) |

En Linux, o dentro de WSL, `pnpm dev` llama directamente al script local, sin `wsl.exe`.

**Diagnóstico:**
- `pnpm.cmd db:dev:status` indica si PostgreSQL acepta conexiones y si responde desde Windows.
- `wsl.exe --list --verbose` muestra las distribuciones, su estado y su versión.
- «Windows no tiene memoria libre suficiente para la máquina virtual» (`ERROR_NO_SYSTEM_RESOURCES`): WSL 2 no ha podido arrancar. Cierra aplicaciones y vuelve a intentarlo, o limita la memoria de WSL en `%USERPROFILE%\.wslconfig` (`[wsl2]` `memory=2GB`).
- «rechazado las credenciales» o «DATABASE_URL apunta a…»: copia de nuevo las variables de `~/.config/estateforge/postgres-dev.env` a `apps/api/.env`.
- «responde un servicio que no es PostgreSQL»: otro programa de Windows ocupa el puerto (`netstat -ano | findstr :55432`).

**Reconstruir la base de desarrollo:** con el servidor en marcha, elimina y crea de nuevo `estateforge_dev`; puedes hacerlo como administrador por el socket o con `bash scripts/wsl/postgres-dev.sh stop`, borrando el directorio de datos y repitiendo `init`. Después repite los pasos 4 y 5.

## Pruebas

| Comando | Necesita PostgreSQL |
|---|---|
| `pnpm --filter api test:unit` | No |
| `pnpm --filter api test:integration` | Sí |
| `pnpm --filter api test` | Sí |

Las pruebas de integración necesitan `TEST_POSTGRES_ADMIN_URL`: un servidor en localhost y un usuario con permiso para crear bases. Cada suite crea su propia base `ef_test_*` y la destruye. Cualquier otro host se rechaza, de modo que no pueden alcanzar una base de desarrollo, compartida o de producción.

## Migraciones

`prisma/migrations` contiene solo migraciones de PostgreSQL. La primera es la línea base, `0_postgresql_baseline`, con el esquema completo. El prefijo `0_` es la convención de Prisma para líneas base: garantiza que se ordena antes que cualquier migración posterior, sea cual sea la fecha con que se cree. Las migraciones de SQLite están archivadas en `prisma/sqlite-history` y no se aplican.

Prisma no representa los `CHECK` ni los índices parciales. Están en la línea base y en `prisma/postgresql/constraints.sql`, y una prueba falla si esos dos textos divergen o si desaparecen de la base. Revisa estas restricciones cuando una migración nueva toque esas tablas.

La segunda migración, `20261110120000_add_property_photos_and_listing_media` (DA-46), es aditiva: crea `PropertyPhoto`, `ListingMedia` y `StorageCleanup` con sus `CHECK`, un índice único parcial (una sola fotografía principal por inmueble) y triggers que limitan la galería a 16 fotografías y encolan para su borrado las claves de archivo que dejan de estar referenciadas (también en cascada). Ese bloque manual está también al final de `prisma/postgresql/constraints.sql` y la misma prueba comprueba que coincide. Los binarios nunca se guardan en PostgreSQL: ver [Galería, cartel y vídeo](producto-galeria-cartel-video.md).

La tercera, `20261111120000_gallery_50_poster_templates_audio` (DA-51 a DA-55), también es aditiva:
- amplía el rango de posiciones a 0-49 y el límite a 50 fotografías (sustituye el trigger `PropertyPhoto_max_16` por `PropertyPhoto_max_photos`);
- añade las miniaturas, los metadatos de plantilla y de audio de `ListingMedia`, la tabla de sorteos `MediaTemplateDraw` y la biblioteca `AudioTrack` (límite de 20 por usuario y cola de limpieza);
- incluye los `CHECK` de coherencia de esos campos.

Su bloque manual está al final de `prisma/postgresql/constraints.sql`.

La última, `20261118120000_maintenance_runs`, también es aditiva: crea `MaintenanceRun`, la constancia de cada ejecución autorizada del mantenimiento diario. Guarda el disparador, el estado, los contadores y la duración, sin datos personales, claves ni secretos. Tiene un `CHECK` de valores y un índice por `startedAt`. Su restricción está también en `constraints.sql` y una prueba comprueba que coinciden. Se probó primero en una rama temporal de Neon (tabla vacía con su `CHECK` e índices) y se aplicó en producción el 18/11/2026 con `prisma migrate deploy` y la conexión directa; Prisma la registró como terminada, sin reversión. Ver [despliegue, mantenimiento programado](despliegue/vercel-neon-blob.md#mantenimiento-programado-vercel-cron).

**Desarrollo:** cambia `schema.prisma` y ejecuta `pnpm --filter api db:migrate:dev --name <cambio>` contra una base local. Prisma crea una base de sombra temporal para reconstruir la historia, por lo que el usuario necesita permiso `CREATEDB`. Comprueba el SQL generado antes de versionarlo. Prisma 7 no genera el cliente automáticamente: ejecuta `db:generate`. Si `migrate dev` detecta deriva (cambios en la base que no están en la historia), se detiene sin aplicar nada. En una base de desarrollo puedes reconstruirla; en cualquier otra, investiga el origen de la deriva.

## Tipos

| Dato | Tipo | Contrato |
|---|---|---|
| Importes (`price`) | `numeric(12,2)` | La API acepta un número o una cadena decimal con hasta 2 decimales y responde una cadena, por ejemplo `"250000.1"`. El máximo es 100.000.000 |
| Fechas | `timestamptz(3)` | Son instantes, en UTC, intercambiados en ISO 8601. Cada navegador los muestra en su zona horaria. Cada sesión del pool fija su zona en UTC al conectar (`src/db/utc-client.ts`): `@prisma/adapter-pg` 7.9.1 sustituye el desplazamiento de los `timestamptz` por `+00:00`, así que con otra zona por defecto en el servidor o en la base leería instantes desplazados |
| Emails | `text`, en minúsculas | `normalizeEmail` es el único punto de normalización. La base exige `email = lower(email)` y unicidad en `User` |

## Variables de entorno

| Variable | Obligatoria | Uso |
|---|---|---|
| `DATABASE_URL` | Sí | Debe ser `postgresql://`. El SSL se configura en la propia URL, por ejemplo con `?sslmode=require` |
| `DATABASE_POOL_MAX` | No (10) | Conexiones máximas por proceso |
| `DATABASE_CONNECT_TIMEOUT_MS` | No (5000) | Espera para obtener una conexión |
| `DATABASE_IDLE_TIMEOUT_MS` | No (30000) | Cierre de conexiones inactivas |
| `DATABASE_APPLICATION_NAME` | No (`estateforge-api`) | Nombre de las conexiones en `pg_stat_activity` |
| `PORT` | No (3000) | Puerto HTTP |
| `HOST` | No (`localhost`) | Interfaz de escucha; `0.0.0.0` detrás de un proxy o en un contenedor |

Si falta `DATABASE_URL`, si no es `postgresql://` o si `PORT` no es válido, la API termina al arrancar con código 1 y un mensaje que no incluye la conexión. No hay vuelta silenciosa a SQLite.

La plataforma de despliegue no está elegida. Dependen de ella la versión menor, los parámetros SSL y el tamaño del pool, que multiplicado por el número de procesos no debe superar `max_connections` (ni el límite de conexiones del rol).

## Comprobaciones de estado

| Ruta | Indica | Respuesta |
|---|---|---|
| `GET /health` | El proceso responde | Siempre 200 |
| `GET /health/ready` | El proceso responde y PostgreSQL contesta en menos de 2 s | 200 `{"status":"ok","database":"ok"}` o 503 `{"status":"unavailable","database":"unavailable"}` |

La respuesta no incluye detalles: el motivo se registra en el log, sin datos de conexión. Usa `/health` como comprobación de vida y `/health/ready` para decidir si el proceso recibe tráfico.

## Conexiones y carga

- **Un pool por proceso.** Se ha comprobado con 400 peticiones en 40 hilos: todas respondieron y nunca hubo más de 10 conexiones.
- **Conexiones cortadas por el servidor** (reinicio o `pg_terminate_backend`): el pool las sustituye y la API se recupera sola.
- **Base no disponible (DA-37).** Si el pool no consigue conexión a tiempo, PostgreSQL rechaza conexiones (límite del rol o `max_connections`), el servidor está caído, se está reiniciando o corta la conexión, la petición responde **503** con `Retry-After: 5` y `{"code":"SERVICE_UNAVAILABLE","message":"El servicio no está disponible temporalmente. Inténtalo de nuevo en unos segundos."}`. Sin SQL, sin host, sin rol y sin el mensaje del driver. El log registra solo `dbUnavailable` (clase), `errorName` y `errorCode`. El proceso no cae y se recupera solo en cuanto hay conexiones. No hay identificador de correlación público: los logs de Fastify ya llevan `reqId`.
- **Lo que no es disponibilidad** sigue igual: una violación de unicidad, de `CHECK` o de clave foránea, un conflicto de escritura (409 donde la ruta lo trata), una validación (400) o un error de programación (500 genérico).
- La clasificación (`src/db/availability.ts`) reconoce solo formas comprobadas con PostgreSQL 17.11, Prisma 7.9.1, `@prisma/adapter-pg` 7.9.1 y `pg-pool` 3.14. Incluye el caso de un `localhost` que resuelve a `::1` y a `127.0.0.1` (habitual en Linux): si las dos direcciones rechazan la conexión, pg recibe un `AggregateError` que el adaptador no convierte y Prisma expone el código de red de Node (`ECONNREFUSED` y similares); esos códigos solo cuentan en un error de Prisma. Al actualizar cualquiera, repite `availability.integration.test.ts`: si cambia una forma, el error vuelve a ser un 500, nunca un 503 indebido.
- **Pool propio.** El pool de `pg` lo crea la aplicación y se lo pasa al adaptador. `closeDatabase()` lo cierra una sola vez; después, cualquier consulta falla (503) en lugar de abrir conexiones nuevas.

## Despliegue

1. Haz una copia de seguridad y comprueba que se puede restaurar (ver más abajo).
2. Ejecuta `pnpm --filter api db:migrate` (`prisma migrate deploy`) antes de arrancar la versión nueva. Nunca uses `migrate dev` ni `db push` fuera de desarrollo.
3. Comprueba que `pnpm --filter api db:status` indica que la base está al día. **La API no comprueba las migraciones al arrancar:** con una migración pendiente arrancaría con un esquema antiguo.
4. Arranca la API y espera a que `/health/ready` responda 200.

## Cierre ordenado

Ante la primera señal, la API deja de aceptar peticiones, espera hasta 6 s a las que están en curso, después al trabajo que siga en marcha y a los envíos de correo, y **solo entonces** cierra el pool de PostgreSQL (DA-38). Antes se cerraba en un hook `onClose`, que se ejecuta sin esperar a ese trabajo: una consulta posterior abría un pool nuevo que nadie cerraba. Una segunda señal fuerza la salida con código 1.

Comprobado en Windows con un Ctrl+C real de consola, que Node recibe como `SIGINT`, y en Linux (Ubuntu 26.04 sobre WSL 2, kernel 6.18) con `kill -TERM`, en 12 situaciones: en reposo, con una petición en curso, dentro y fuera del plazo de drenaje, con una transacción abierta, con una consulta esperando un bloqueo, con cinco conexiones ocupadas, con una segunda señal, con PostgreSQL detenido, con errores de arranque, tras un cierre normal y al reiniciar en el mismo puerto:

| Situación | Resultado |
|---|---|
| Sin peticiones | Sale con código 0, sin conexiones abiertas y con el puerto liberado |
| Petición que termina dentro del plazo | Se completa y se confirma; después sale con código 0 |
| Petición más larga que el plazo | Se corta, sale con código 1 y PostgreSQL deshace la transacción: no queda escritura a medias |
| Segunda señal | Salida forzada inmediata, sin escritura a medias |
| Terminación abrupta del proceso (`TerminateProcess`) | PostgreSQL deshace la transacción |

**Limitaciones:**
- **SIGTERM en Windows:** Windows no lo entrega a un proceso; allí solo se prueba Ctrl+C (SIGINT). En Linux, SIGTERM está probado (WSL 2). Un orquestador concreto (Docker o systemd) no se ha probado.
- **Una petición que espera un bloqueo más de 5 s** caduca dentro de su transacción interactiva (`P2028`) y el Checklist responde 409. El cierre ordenado no cambia este comportamiento.
- **Conexión huérfana:** si el proceso muere con una transacción esperando un bloqueo, PostgreSQL mantiene esa conexión hasta que el bloqueo se libera; entonces la descarta sin escribir. En las pruebas tardó hasta 6 s.
- **Generación con IA en curso:** no se puede cancelar (M-3, DA-3).

## Copia de seguridad y restauración

Usa `pg_dump` y `pg_restore` de la misma versión mayor que el servidor (17). Las credenciales van en `PGHOST`, `PGPORT`, `PGUSER` y `PGPASSWORD`, o en un archivo `pgpass`, nunca en la línea de órdenes.

```bash
# Copia en formato custom (comprimida, restaurable por partes)
pg_dump --format=custom --file estateforge.dump --dbname estateforge

# Verificación: debe listar las tablas, sus datos, restricciones, índices y claves foráneas
pg_restore --list estateforge.dump

# Restauración en una base vacía y nueva, todo o nada
createdb estateforge_restaurada
pg_restore --single-transaction --exit-on-error --dbname estateforge_restaurada estateforge.dump
```

**Roles.** La copia guarda los propietarios. Si la base de destino pertenece a otro rol, restaura con `--no-owner --no-privileges` conectando como ese rol. Sin esas opciones la restauración falla.

**Extensiones.** Solo `plpgsql`, presente en cualquier instalación. No hay secuencias: los identificadores son `cuid`.

**Después de restaurar:**
1. `pnpm --filter api db:status` debe indicar que la base está al día. Si hay migraciones pendientes, aplícalas con `db:migrate`.
2. Compara el recuento de filas por tabla con el origen.
3. Comprueba que existen los `CHECK` (`pg_constraint`) y el índice `ListingPublication_other_position_key` (`pg_indexes`).
4. Arranca la API y comprueba `/health/ready`, el inicio de sesión, la ficha de un anuncio y el guardado del Checklist.

**Fallos de restauración:**

| Situación | Comportamiento comprobado |
|---|---|
| Copia truncada o dañada | `pg_restore` falla. Con `--single-transaction` la base queda vacía; sin esa opción puede quedar a medias |
| Base de destino con datos | Falla sin modificarla. Para sustituir el contenido, usa `--clean --if-exists` junto con `--single-transaction` |

Si una restauración queda a medias, elimina la base de destino y repite en una base nueva.

## Recuperación

**Volver a una versión anterior del código no restaura la base de datos.** Son dos operaciones distintas, y una versión anterior puede no ser compatible con un esquema más nuevo.

**Si falla `prisma migrate deploy`:**
1. Consulta `prisma migrate status`: la migración aparece como fallida y Prisma no aplicará más hasta resolverla.
2. Prisma **no** envuelve toda la migración en una transacción: las sentencias anteriores al error pueden haberse aplicado. Se ha comprobado que una columna añadida antes del error queda en la base. Revísalo en la base.
3. Deshaz a mano lo aplicado, o restaura la copia, y ejecuta `prisma migrate resolve --rolled-back <migración>`. Corrige la migración y vuelve a desplegar.
4. Si se terminó de aplicar manualmente, usa `prisma migrate resolve --applied <migración>`.

**Abortar una migración de datos:** no abras el tráfico a la base nueva si falla un recuento, una suma de control, una restricción o una prueba de humo. Una vez abierto el tráfico, las escrituras nuevas solo existen en la base nueva.

**Reconstruir una base de desarrollo o de pruebas:** elimínala, créala de nuevo, aplica las migraciones y ejecuta el seed.
