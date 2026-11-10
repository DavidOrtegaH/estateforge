# PostgreSQL

EstateForge usa PostgreSQL 17 mediante Prisma y `@prisma/adapter-pg`. La versión probada es la 17.11.

## Puesta en marcha en desarrollo

1. Inicia un servidor PostgreSQL 17 local y crea una base y un usuario para el proyecto.
2. Copia `apps/api/.env.example` a `apps/api/.env` y define `DATABASE_URL`, por ejemplo `postgresql://usuario:contraseña@localhost:5432/estateforge`.
3. Instala las dependencias: `pnpm install`.
4. Genera el cliente: `pnpm --filter api db:generate`.
5. Aplica las migraciones: `pnpm --filter api db:migrate`.
6. Opcional, crea datos de ejemplo. Define `SEED_USER_PASSWORD` y ejecuta `pnpm --filter api db:seed`. La cuenta es `demo@estateforge.test`, el comando es repetible y se niega a actuar fuera de localhost.
7. Arranca la API y la web: `pnpm dev`.

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

**Desarrollo:** cambia `schema.prisma` y ejecuta `pnpm --filter api db:migrate:dev --name <cambio>` contra una base local. Prisma crea una base de sombra temporal para reconstruir la historia, por lo que el usuario necesita permiso `CREATEDB`. Comprueba el SQL generado antes de versionarlo. Prisma 7 no genera el cliente automáticamente: ejecuta `db:generate`. Si `migrate dev` detecta deriva (cambios en la base que no están en la historia), se detiene sin aplicar nada. En una base de desarrollo puedes reconstruirla; en cualquier otra, investiga el origen de la deriva.

## Tipos

| Dato | Tipo | Contrato |
|---|---|---|
| Importes (`price`) | `numeric(12,2)` | La API acepta un número o una cadena decimal con hasta 2 decimales y responde una cadena, por ejemplo `"250000.1"`. El máximo es 100.000.000 |
| Fechas | `timestamptz(3)` | Son instantes, en UTC, intercambiados en ISO 8601. Cada navegador los muestra en su zona horaria |
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
- **Base saturada.** Si PostgreSQL rechaza conexiones (por ejemplo, por el límite del rol), las peticiones afectadas responden 500 genérico, sin SQL ni datos de conexión. El proceso no cae y se recupera en cuanto hay conexiones. El error no se distingue como 503 porque el manejador de errores está en `app.ts`, protegido por la evidencia de N-1 a N-8.

## Despliegue

1. Haz una copia de seguridad y comprueba que se puede restaurar (ver más abajo).
2. Ejecuta `pnpm --filter api db:migrate` (`prisma migrate deploy`) antes de arrancar la versión nueva. Nunca uses `migrate dev` ni `db push` fuera de desarrollo.
3. Comprueba que `pnpm --filter api db:status` indica que la base está al día. **La API no comprueba las migraciones al arrancar:** con una migración pendiente arrancaría con un esquema antiguo.
4. Arranca la API y espera a que `/health/ready` responda 200.

## Cierre ordenado

Ante la primera señal, la API deja de aceptar peticiones, espera hasta 6 s a las que están en curso y cierra el pool de PostgreSQL. Una segunda señal fuerza la salida con código 1.

Comprobado en Windows con un Ctrl+C real de consola, que Node recibe como `SIGINT`:

| Situación | Resultado |
|---|---|
| Sin peticiones | Sale con código 0, sin conexiones abiertas y con el puerto liberado |
| Petición que termina dentro del plazo | Se completa y se confirma; después sale con código 0 |
| Petición más larga que el plazo | Se corta, sale con código 1 y PostgreSQL deshace la transacción: no queda escritura a medias |
| Segunda señal | Salida forzada inmediata, sin escritura a medias |
| Terminación abrupta del proceso (`TerminateProcess`) | PostgreSQL deshace la transacción |

**Limitaciones:**
- **SIGTERM:** Windows no lo entrega a un proceso, y las señales reales de Linux están sin probar (sin entorno Linux, DA-10).
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
