# Protección por incidente y su versionado

Este documento describe cómo funciona la protección de una cuenta tras un incidente de seguridad, cómo la retira un administrador y cómo se evita retirar por error una protección más reciente. Distingue entre lo que hace el código actual, lo que está demostrado por pruebas y lo que sigue pendiente.

> **Estado:** los cambios descritos (retirada administrativa, bloqueo de suspensión de cuentas protegidas y contador de versión) están implementados en la rama `feat/keys`, pero **sin commitear**. La migración del contador está aplicada a la base local `apps/api/dev.db` desde el 2026-11-02; cualquier otra base debe migrarse antes de usar este código. Ver [Migración del contador](#7-migración-del-contador).

## 1. Dos estados independientes

Una cuenta (`User` en `apps/api/prisma/schema.prisma`) tiene dos estados de bloqueo **independientes entre sí**:

| Campo | Qué significa | Quién lo activa | Quién lo retira |
|---|---|---|---|
| `securityHoldAt` | **Protección por incidente**: el titular denunció que no reconoce un cambio en su cuenta. | El propio titular, desde el enlace del correo (`reportSecurityIncident`). | Un OWNER con `POST /api/admin/users/:id/resolve-security-hold`. |
| `adminSuspendedAt` (+ `adminSuspensionReason`) | **Suspensión administrativa** decidida por el equipo. | Un OWNER con `POST /api/admin/users/:id/suspend`. | Un OWNER con `POST /api/admin/users/:id/unsuspend`. |

Consecuencias de esa independencia:

- **Retirar la protección por incidente no reactiva una cuenta suspendida.** Si la cuenta también está suspendida, sigue suspendida; la respuesta lo indica: «Protección por incidente retirada. Si existe una suspensión administrativa, seguirá activa.».
- **Retirar la suspensión no retira la protección.** La respuesta de `unsuspend` dice: «Suspensión administrativa retirada. Si existe una protección por incidente, seguirá activa.».
- **Una cuenta protegida no se puede suspender** (corrección S4): la API responde 409 «La cuenta está protegida por un incidente de seguridad; no se puede suspender administrativamente.». Primero hay que resolver la protección.
- El contador `securityHoldVersion` pertenece solo a la protección por incidente; la suspensión no lo usa.

## 2. Efectos de una cuenta protegida

Mientras `securityHoldAt` no es nulo:

| Dónde | Efecto | Código |
|---|---|---|
| Login (`POST /api/auth/login`) | 423 «La cuenta está protegida temporalmente. Contacta con soporte para verificar su titularidad.» (la contraseña se comprueba antes). | `apps/api/src/routes/auth.routes.ts` |
| Sesiones existentes | Cualquier sesión de la cuenta se borra al usarse y la petición se trata como no autenticada. `GET /api/auth/me` y las rutas que usan `getAuthenticatedUser` borran todas sus sesiones y responden 423 con el mismo mensaje. | `getUserIdFromSession` en `apps/api/src/services/session.service.ts`; `getAuthenticatedUser` en `auth.routes.ts` |
| Recuperación de contraseña | `POST /api/auth/forgot-password` no envía el correo, y `consumePasswordResetToken` rechaza el token dentro de su transacción. | `auth.routes.ts`; `apps/api/src/services/password-reset.service.ts` |
| Panel de administración | `requireOwner` deniega el acceso (403 «No tienes permisos para acceder a esta sección.») aunque la cuenta sea OWNER. | `apps/api/src/middleware/owner.middleware.ts` |
| Suspensión administrativa | Bloqueada (S4), ver sección 1. | `apps/api/src/routes/admin.routes.ts` |

## 3. Flujo de un incidente

1. **Emisión del enlace.** Solo se emite al completar un cambio de email: `issueSecurityIncidentToken` (en `apps/api/src/services/security-incident.service.ts`) genera un token aleatorio, guarda su hash SHA-256 con caducidad de 7 días y se envía al email anterior.
   - **Hallazgo pendiente:** la emisión **no es atómica**. Borra los tokens pendientes y crea el nuevo en dos operaciones sin transacción, así que dos emisiones simultáneas pueden dejar dos tokens válidos. No se le atribuye ninguna garantía.
2. **Confirmación.** `GET /api/auth/security-incident/:token` solo muestra una página con un botón (para que los escáneres de enlaces no bloqueen cuentas). `POST /api/auth/security-incident/:token` (rate limit 5 cada 15 minutos) ejecuta `reportSecurityIncident`.
3. **Registro (`reportSecurityIncident`)**, todo dentro de una transacción:
   1. Busca el token por su hash; si no existe, está usado o caducado → `invalid`.
   2. **Reclama** el token con un `updateMany` condicional (`usedAt` nulo y no caducado). Si no afecta a una fila → `invalid`. Esto impide usar el mismo token dos veces.
   3. Protege la cuenta: `securityHoldAt = ahora` y **`securityHoldVersion` + 1**. Ocurre aunque la cuenta ya estuviera protegida.
   4. Borra sesiones, tokens de recuperación, verificaciones de email y los demás tokens de incidente de la cuenta.

   Si algo falla después del incremento, la transacción se deshace entera: el token sigue sin usar, la versión no cambia y la sesión sigue existiendo (demostrado con SQLite real, ver sección 8).

## 4. Retirada administrativa

`POST /api/admin/users/:id/resolve-security-hold`, en `apps/api/src/routes/admin.routes.ts`.

**Requisitos y respuestas:**

| Situación | Respuesta |
|---|---|
| Sin sesión, sesión no válida, rol USER u OWNER protegido | 401 / 403 (`requireAuth` + `requireOwner`) |
| Más de 20 peticiones por minuto a esta ruta desde la misma IP (`ACCOUNT_ACTION_RATE_LIMIT`: misma configuración que las demás acciones de cuenta, con un contador propio por ruta) | 429 |
| Identificador no válido | 400 «Identificador de cuenta no válido.» |
| Motivo de menos de 3 o más de 500 caracteres (tras recortar) | 400 «Indica un motivo de entre 3 y 500 caracteres.» |
| La propia cuenta del administrador | 400 «No puedes modificar tu propia cuenta desde esta acción.» |
| Cuenta inexistente | 404 «No se ha encontrado la cuenta.» |
| Cuenta OWNER | 403 «No se pueden modificar cuentas propietarias.» |
| Sin protección activa (o la retiró otra petición) | 409 «La cuenta no tiene una protección por incidente activa.» |
| Llegó un incidente nuevo entre la lectura y la escritura | 409 «La protección por incidente ha cambiado durante la operación. Revisa la cuenta antes de volver a intentarlo.» |
| Éxito | 200 «Protección por incidente retirada. Si existe una suspensión administrativa, seguirá activa.» |

**Qué hace:** pone `securityHoldAt` a nulo y, en la misma transacción, registra la auditoría `SECURITY_HOLD_RESOLVED` (con el motivo y los emails de operador y cuenta en `metadata`). Si la auditoría falla, no se retira nada. La API (`GET /api/admin/audit?action=SECURITY_HOLD_RESOLVED`) admite esta acción como filtro, junto a `ACCOUNT_SUSPENDED`, `ACCOUNT_UNSUSPENDED` y `SESSIONS_REVOKED`; el panel web todavía no la ofrece ni tiene botón para retirar la protección (**E4, pendiente**).

**Qué no hace:** no modifica la suspensión administrativa, no cambia `securityHoldVersion`, no toca sesiones, tokens ni contraseña, y no envía correos.

**Riesgo conocido:** tras retirar la protección, nada obliga a cambiar la contraseña. Si el incidente fue real, quien conozca la contraseña podría volver a entrar. Está previsto estudiarlo en **E2 (pendiente)**.

### Cuentas OWNER protegidas

El endpoint **no es una solución universal**:

- Un OWNER protegido no puede usar el panel: no puede iniciar sesión (423) y `requireOwner` lo rechaza aunque tuviera sesión.
- Ningún OWNER puede retirar la protección de otro OWNER desde el panel (403).

Por tanto, **no existe hoy ninguna forma de recuperar una cuenta OWNER protegida** sin intervenir directamente en la base de datos. Si el único OWNER queda protegido, nadie puede administrar el sistema. El procedimiento por línea de comandos previsto para este caso es **E3 (pendiente)**.

## 5. Diseño del contador `securityHoldVersion`

### Problema

Una retirada lee la cuenta y, después, escribe en una transacción. Entre ambas puede registrarse un incidente nuevo. La primera versión comparaba la fecha `securityHoldAt` leída con la guardada, pero:

- dos incidentes en el mismo milisegundo tienen la misma fecha (el adaptador guarda las fechas como texto ISO con milisegundos);
- la igualdad de texto depende del formato con que se guardó la fecha.

### Alternativas valoradas

| Alternativa | Por qué se descartó o eligió |
|---|---|
| Comparar la fecha | No distingue el mismo milisegundo y depende del formato guardado. |
| Identificador aleatorio por incidente | Garantía probabilística, sin orden entre incidentes y con valores nulos para las cuentas ya protegidas. |
| **Contador por cuenta (elegida)** | Garantía determinista, con orden, y las cuentas ya protegidas quedan con 0 sin tratamiento especial. |

### Invariantes

- Empieza en `0` (valor por defecto de la columna).
- **Solo** `reportSecurityIncident` lo modifica, con la operación atómica `increment: 1` de Prisma: el incremento se aplica en la propia sentencia de actualización, sin leer el valor desde JavaScript.
- La retirada **no** lo cambia.
- **Nunca disminuye ni se reinicia** (si se reiniciara, podría reaparecer un valor ya visto).

**Regla para el código futuro:** cualquier escritura que proteja una cuenta (por ejemplo, el procedimiento de E3) debe incrementar la versión. El esquema no lo impone.

### Condición de la retirada

La ruta usa `updateMany` con `where: { id, securityHoldAt: { not: null }, securityHoldVersion: <leída> }`. En SQL equivale a (no es el texto literal que genera Prisma):

```sql
UPDATE "User" SET "securityHoldAt" = NULL
WHERE "id" = ? AND "securityHoldAt" IS NOT NULL AND "securityHoldVersion" = ?  -- la versión leída
```

Si no se actualiza exactamente una fila, no se escribe auditoría y se vuelve a leer la cuenta dentro de la transacción solo para elegir el mensaje del 409 (protección retirada o cambiada).

## 6. Secuencias y qué las impide

| Secuencia | Resultado |
|---|---|
| Dos informes del mismo incidente (mismo token) | El reclamo condicional del token solo deja pasar uno; el otro da `invalid`. |
| Dos informes con tokens distintos | En un mismo proceso se ejecutan en serie. Normalmente el primero borra los demás tokens pendientes y el segundo da `invalid`. Solo si un token se emitió después de ese borrado (la emisión no es atómica), su informe vuelve a proteger la cuenta e incrementa otra vez la versión. |
| Incidente nuevo durante una retirada | La retirada leyó la versión *v*; el incidente la deja en *v*+1; la condición `securityHoldVersion = v` no se cumple → 409 «ha cambiado», sin auditoría. |
| Dos administradores retiran la misma protección | El primero la retira; el segundo encuentra `securityHoldAt IS NULL` → 409 «no tiene protección». Una sola auditoría. |
| Retirada obsoleta tras «retirada + incidente nuevo» (ABA) | La versión ya es mayor que la leída → 409, aunque la fecha coincida. |
| Fallo de la auditoría durante una retirada | La transacción se deshace: la protección sigue activa y no queda auditoría. |

**Reintentos:**

- **Repetir una retirada tras un rollback** (por ejemplo, porque falló la auditoría): la protección sigue activa y una nueva petición puede retirarla normalmente.
- **Repetir una retirada que ya tuvo éxito:** responde 409 «La cuenta no tiene una protección por incidente activa.», porque ya no hay protección. No se duplica la auditoría.
- **Reintento automático ante `SQLITE_BUSY`:** **no está implementado**. El adaptador convierte ese error en un fallo de la consulta, Prisma no reintenta las transacciones interactivas y la API responde 500. El cliente tendría que repetir la petición.

## 7. Migración del contador

**Migración:** `apps/api/prisma/migrations/20261101100000_add_security_hold_version/migration.sql`

```sql
-- Additive version counter for security holds; existing accounts, including protected ones, start at 0.
ALTER TABLE "User" ADD COLUMN "securityHoldVersion" INTEGER NOT NULL DEFAULT 0;
```

- Prisma propone para este cambio una redefinición completa de la tabla `User`. Se usa `ADD COLUMN`, como en las demás migraciones del proyecto, porque SQLite lo admite con `NOT NULL` y un valor por defecto constante y no recrea la tabla.
- Verificado en una base temporal (no en `dev.db`): las cuentas protegidas conservan `securityHoldAt` y reciben versión 0, y `prisma migrate diff` no muestra diferencias entre la base migrada y el esquema.

**Estado: aplicada a la base local `apps/api/dev.db` el 2026-11-02**, con copia de seguridad previa. Tras aplicarla se comprobó que la columna es `INTEGER NOT NULL DEFAULT 0`, que todos los usuarios existentes tienen versión 0 y conservan sus datos (incluida la cuenta protegida), que los recuentos de todas las tablas no cambiaron y que `prisma migrate status` indica que el esquema está al día.

En cualquier base **sin** esta migración (otra copia local u otro entorno), el código actual falla:

- informar de un incidente da 500 (la columna no existe);
- retirar una protección da 500.

Los tests no dependen de ninguna base: los unitarios usan dobles y el de integración crea su propia base temporal.

**Pasos para aplicarla en otra base:**

1. Hacer una copia de la base.
2. Desde la raíz del repositorio: `pnpm --filter api exec prisma migrate deploy` (se ejecuta en `apps/api`, que contiene `prisma.config.ts`), comprobando antes con `prisma migrate status` que apunta a la base correcta y que esta es la única migración pendiente.
3. `pnpm --filter api exec prisma generate` si el cliente no está generado.
4. Comprobar que la columna existe y que las cuentas protegidas conservan `securityHoldAt` con versión 0.

Se recomienda commitear juntos el esquema y la migración (V1), el incremento (V2) y la condición por versión (V3): por separado, un commit podría dejar el código usando una columna sin su migración.

## 8. Qué está demostrado y cómo

### Pruebas con dobles (sin base de datos)

| Fichero | Qué demuestra |
|---|---|
| `apps/api/src/routes/admin.routes.test.ts` | Permisos, validaciones, mensajes y códigos; que la retirada pide la condición `{ id, securityHoldAt: { not: null }, securityHoldVersion }`; carreras **simuladas** con ganchos del doble (incidente nuevo, misma fecha con otra versión, ABA, dos retiradas); rollback simulado; S4; filtro de auditoría. |
| `apps/api/src/services/security-incident.service.test.ts` | Que el informe pide `increment: 1` junto a la fecha, en la transacción y después de reclamar el token; que un token inválido o ya reclamado no incrementa; que un fallo posterior propaga el error. |

Estas pruebas demuestran **qué pide el código**, no cómo lo ejecuta SQLite.

### Integración con SQLite real

`apps/api/src/integration/security-hold-version.integration.test.ts` crea una base SQLite temporal en el directorio temporal del sistema, aplica las migraciones reales del proyecto y usa Prisma, los servicios, la ruta y la sesión reales. Verifica:

1. Un incidente incrementa la versión de 0 a 1.
2. Dos incidentes la dejan en 2.
3. Una retirada válida quita la protección sin cambiar la versión.
4. **Una retirada obsoleta no borra la protección de un incidente posterior:** un incidente nuevo se registra y confirma entre la lectura de la ruta y su transacción; la ruta responde 409 «ha cambiado», la versión queda en 2 y no hay auditoría.
5. La columna es `INTEGER NOT NULL DEFAULT 0` y una cuenta con versión 0 se puede retirar.
6. Coherencia transaccional con `ROLLBACK` reales provocados con triggers de SQLite: (a) si falla la auditoría, la retirada se deshace por completo; (b) si falla una operación posterior al incremento, el informe se deshace (versión intacta, token sin usar, sesión existente); (c) una retirada correcta deja exactamente una auditoría con los datos esperados.

**Alcance del caso 4:** demuestra que un incidente nuevo invalida una retirada obsoleta en el orden real de las operaciones. **No** demuestra concurrencia entre procesos ni la ausencia de `SQLITE_BUSY`.

### Cómo ejecutar las pruebas

Desde la raíz del repositorio:

```bash
pnpm --filter api exec vitest run src/routes/admin.routes.test.ts
pnpm --filter api exec vitest run src/services/security-incident.service.test.ts
pnpm --filter api exec vitest run src/integration/security-hold-version.integration.test.ts
pnpm --filter api test   # suite completa de la API, incluida la integración
```

## 9. Limitaciones y lo que no está demostrado

- **Concurrencia entre procesos.** Todas las pruebas usan un único cliente de Prisma, cuyo adaptador ejecuta en serie las transacciones del mismo proceso. Con varias instancias de la API o un script simultáneo, SQLite coordina con bloqueos de fichero (`BEGIN DEFERRED`) y puede devolver `SQLITE_BUSY`, que hoy acaba en 500 sin reintento.
- **Detalles del test de integración (no son recomendaciones para producción):**
  - El test sustituye `Sqlite3Transaction` de `@libsql/client` por una conexión SQLite dedicada por transacción, con `BEGIN DEFERRED`, `COMMIT` y `ROLLBACK` reales sobre el mismo fichero, que se cierra siempre. Se hizo porque las transacciones de libsql no cierran su conexión y en Windows impedían borrar la base temporal. Por eso **no se prueba el ciclo de vida de `Sqlite3Transaction`**.
  - En Windows, `close()` de `libsql` 0.5 no libera el fichero hasta que el recolector de memoria recoge la conexión; la limpieza del test fuerza la recolección entre reintentos de borrado.
  - El test lee `error.stack` de los errores de SQLite antes de relanzarlos, porque la pila sin formatear retenía la conexión; el error no cambia.
- **Fidelidad de los dobles.** Los dobles reproducen solo los filtros y operaciones que usa el código; no prueban el SQL que genera Prisma.

## 10. Hallazgos abiertos

| Hallazgo | Estado |
|---|---|
| Retención de conexiones libsql en producción: Prisma conserva hasta 100 transacciones cerradas y cada una retiene su conexión; `close()` de libsql no libera el fichero de inmediato. | Sin resolver; requiere estudio aparte. |
| La emisión de tokens de incidente no es atómica (sección 3). | Sin resolver. |
| Fastify limita los parámetros de ruta a 100 caracteres (`maxParamLength` por defecto, no se configura en `apps/api/src/app.ts`), mientras `UserIdParams` admite hasta 128: un identificador de 101 a 128 caracteres recibe 414 del router antes de validarse. | Sin resolver; decidir cuál ajustar. |
| `apps/api/dev.db` está versionado en Git y contiene datos locales (usuarios, sesiones, auditoría); tras la migración aparece modificado. | Sin decidir cómo gestionarlo; no se recomienda commitear la base. |

## 11. Trabajo pendiente (no disponible todavía)

- **E2:** obligar a recuperar la contraseña (o enviar un correo de recuperación) al retirar una protección.
- **E3:** procedimiento por línea de comandos para retirar la protección de una cuenta OWNER, que deberá incrementar o respetar la versión.
- **E4:** botón «Retirar protección» y la nueva acción en el filtro del panel web.
- **F:** accesibilidad de los diálogos del panel y visibilidad del incidente para el usuario.
