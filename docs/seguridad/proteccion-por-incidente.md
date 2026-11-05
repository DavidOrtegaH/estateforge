# Protección por incidente y su versionado

Este documento describe cómo funciona la protección de una cuenta tras un incidente de seguridad, cómo la retira un administrador y cómo se evita retirar por error una protección más reciente. Distingue entre lo que hace el código actual, lo que está demostrado por pruebas y lo que sigue pendiente.

> **Estado:** la retirada administrativa, el bloqueo de suspensión de cuentas protegidas y el contador de versión (V1–V5) están commiteados en la rama `feat/keys` (`618ecb0`). La recuperación obligatoria tras la retirada (E2.1–E2.6) está commiteada en la misma rama (`d32ff42`) y se describe en [Recuperación obligatoria tras un incidente](recuperacion-obligatoria.md). Los hashes citados son los posteriores a la reescritura del historial del 2026-11-05. Desde R2, la retirada también se hace desde el panel de administración (botón «Retirar protección»). Las migraciones del contador y de E2.1 se aplicaron a la base local de desarrollo (`apps/api/dev.db`, que no se versiona) el 2026-11-02, y la del actor opcional de la auditoría (`20261103120000_admin_audit_optional_actor`) el 2026-11-04; cualquier otra base debe migrarse antes de usar este código. Ver [Migración del contador](#7-migración-del-contador).

## 1. Dos estados independientes

Una cuenta (`User` en `apps/api/prisma/schema.prisma`) tiene dos estados de bloqueo **independientes entre sí**:

| Campo | Qué significa | Quién lo activa | Quién lo retira |
|---|---|---|---|
| `securityHoldAt` | **Protección por incidente**: el titular denunció que no reconoce un cambio en su cuenta. | El propio titular, desde el enlace del correo (`reportSecurityIncident`). | Un OWNER con `POST /api/admin/users/:id/resolve-security-hold`. |
| `adminSuspendedAt` (+ `adminSuspensionReason`) | **Suspensión administrativa** decidida por el equipo. | Un OWNER con `POST /api/admin/users/:id/suspend`. | Un OWNER con `POST /api/admin/users/:id/unsuspend`. |

Consecuencias de esa independencia:

- **Retirar la protección por incidente no reactiva una cuenta suspendida.** Si la cuenta también está suspendida, sigue suspendida, y el mensaje de la retirada lo indica («…Si existe una suspensión administrativa, seguirá activa.»). Además, desde E2.4 la cuenta queda pendiente de establecer una contraseña nueva (sección 4).
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

**Recuperación obligatoria (E2).** Tras retirar la protección, la cuenta queda con `passwordResetRequiredAt` activo hasta que establece una contraseña nueva. Mientras tanto se aplican bloqueos equivalentes: el login responde 423 (después de comprobar la contraseña), las sesiones se invalidan en `getUserIdFromSession`, y `GET /api/auth/me` y `getAuthenticatedUser` borran las sesiones y responden 423. Además, `forgot-password` tampoco envía nada a estas cuentas y `consumePasswordResetToken` las rechaza. Detalle en [Recuperación obligatoria tras un incidente](recuperacion-obligatoria.md#3-autoservicio-frente-a-recuperación-obligatoria).

## 3. Flujo de un incidente

1. **Emisión del enlace.** Solo se emite al completar un cambio de email: `issueSecurityIncidentToken` (en `apps/api/src/services/security-incident.service.ts`) genera un token aleatorio, guarda su hash SHA-256 con caducidad de 7 días y, en `notifiedEmail`, el email anterior normalizado, que es al que se envía el aviso (E2.2).
   - **Hallazgo pendiente:** la emisión **no es atómica**. Borra los tokens pendientes y crea el nuevo en dos operaciones sin transacción, así que dos emisiones simultáneas pueden dejar dos tokens válidos. No se le atribuye ninguna garantía.
2. **Confirmación.** `GET /api/auth/security-incident/:token` solo muestra una página con un botón (para que los escáneres de enlaces no bloqueen cuentas). `POST /api/auth/security-incident/:token` (rate limit 5 cada 15 minutos) ejecuta `reportSecurityIncident`.
3. **Registro (`reportSecurityIncident`)**, todo dentro de una transacción:
   1. Busca el token por su hash; si no existe, está usado o caducado → `invalid`.
   2. **Reclama** el token con un `updateMany` condicional (`usedAt` nulo y no caducado). Si no afecta a una fila → `invalid`. Esto impide usar el mismo token dos veces.
   3. Protege la cuenta: `securityHoldAt = ahora` y **`securityHoldVersion` + 1**. Ocurre aunque la cuenta ya estuviera protegida. En la misma escritura copia el `notifiedEmail` del token reclamado a `User.securityRecoveryEmail`, como destino propuesto para la recuperación (nulo si el token es anterior a E2). `User.email` no cambia.
   4. Borra sesiones, tokens de recuperación, verificaciones de email y los demás tokens de incidente de la cuenta.

   Si algo falla después del incremento, la transacción se deshace entera: el token sigue sin usar, la versión no cambia y la sesión sigue existiendo (demostrado con SQLite real, ver sección 8).

## 4. Retirada administrativa

`POST /api/admin/users/:id/resolve-security-hold`, en `apps/api/src/routes/admin.routes.ts`. En el panel de administración la usa el botón «Retirar protección», que solo aparece en cuentas no propietarias con la protección activa (ver [Gestión desde el panel de administración](recuperacion-obligatoria.md#gestión-desde-el-panel-de-administración-r1-y-r2)).

**Requisitos y respuestas:**

| Situación | Respuesta |
|---|---|
| Sin sesión, sesión no válida, rol USER u OWNER protegido | 401 / 403 (`requireAuth` + `requireOwner`) |
| Más de 20 peticiones por minuto a esta ruta desde la misma IP (`ACCOUNT_ACTION_RATE_LIMIT`: misma configuración que las demás acciones de cuenta, con un contador propio por ruta) | 429 |
| Identificador no válido | 400 «Identificador de cuenta no válido.» |
| `recoveryEmail` no válido (E2.4) | 400 «El email de recuperación no es válido.» |
| Motivo de menos de 3 o más de 500 caracteres (tras recortar) | 400 «Indica un motivo de entre 3 y 500 caracteres.» |
| La propia cuenta del administrador | 400 «No puedes modificar tu propia cuenta desde esta acción.» |
| Cuenta inexistente | 404 «No se ha encontrado la cuenta.» |
| Cuenta OWNER | 403 «No se pueden modificar cuentas propietarias.» |
| Sin protección activa (o la retiró otra petición) | 409 «La cuenta no tiene una protección por incidente activa.» |
| Sin destino de recuperación guardado ni indicado (E2.4) | 400 «La cuenta no tiene un destino de recuperación guardado. Indica el email al que enviar el enlace de recuperación obligatoria.» |
| Llegó un incidente nuevo entre la lectura y la escritura | 409 «La protección por incidente ha cambiado durante la operación. Revisa la cuenta antes de volver a intentarlo.» |
| Éxito | 200 con `success: true`, `recoveryEmailSent` (si se pudo enviar el enlace) y un mensaje que indica que la cuenta no podrá acceder hasta establecer una contraseña nueva y que una suspensión, si existe, sigue activa. Textos exactos en [Recuperación obligatoria](recuperacion-obligatoria.md#7-errores-respuestas-y-operativa). |

**Cuerpo:** `{ reason, recoveryEmail? }`. Desde E2.4, la retirada necesita un destino para la recuperación: el guardado al informar del incidente o el que indique el OWNER en `recoveryEmail`. **Nunca se usa `User.email` como alternativa.**

**Qué hace,** en una sola transacción y con la condición por versión de la sección 5:

- pone `securityHoldAt` a nulo, activa `passwordResetRequiredAt` y guarda el destino en `securityRecoveryEmail`;
- borra los tokens de recuperación no usados de la cuenta y crea un token `SECURITY_RECOVERY` ligado al destino (`deliverTo`) y a la versión resuelta (`securityHoldVersion`);
- registra la auditoría `SECURITY_HOLD_RESOLVED` con el motivo, los emails de operador y cuenta y el origen del destino (`recoveryDestination`: `STORED`, `OWNER_PROVIDED` u `OWNER_CORRECTED`), sin la dirección de destino, el token ni el enlace.

Si cualquier paso falla, no se retira nada. **Después del commit** envía el correo con el enlace a `/recuperar-cuenta`. Si el envío falla, la protección queda retirada pero la obligación y el token se mantienen y la respuesta trae `recoveryEmailSent: false`. La API (`GET /api/admin/audit?action=SECURITY_HOLD_RESOLVED`) admite esta acción como filtro, junto a `ACCOUNT_SUSPENDED`, `ACCOUNT_UNSUSPENDED`, `SESSIONS_REVOKED`, `SECURITY_RECOVERY_COMPLETED`, `SECURITY_RECOVERY_DESTINATION_CHANGED`, `SECURITY_RECOVERY_LINK_RESENT` y `SECURITY_RECOVERY_LINK_REQUESTED`; el panel web las muestra con su etiqueta y las ofrece en el filtro del historial (E4.2), pero todavía no tiene botón para retirar la protección.

**Qué no hace:** no modifica la suspensión administrativa, no cambia `securityHoldVersion`, no toca sesiones, contraseña ni `User.email`. La contraseña y el email cambian solo cuando el titular completa la recuperación. Ciclo completo en [Recuperación obligatoria tras un incidente](recuperacion-obligatoria.md).

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

El mismo fichero incluye los bloques 7 a 13, que cubren la recuperación obligatoria (E2), incluida la auditoría con actor opcional. Esa cobertura, junto con la de las demás pruebas de E2, se detalla en [Recuperación obligatoria tras un incidente](recuperacion-obligatoria.md#8-pruebas-limitaciones-y-riesgos).

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
| `apps/api/dev.db` estaba versionado en Git y contenía datos locales (usuarios, sesiones, auditoría). | Resuelto: ya no se versiona (`.gitignore` incluye `apps/api/dev.db*`) y se retiró del historial de todas las ramas. |

## 11. Trabajo pendiente y completado

**Pendiente:**

- **E3:** procedimiento por línea de comandos para retirar la protección de una cuenta OWNER, que deberá incrementar o respetar la versión.

**Completado:**

- **E2 (E2.1–E2.6, commiteado en `d32ff42`):** la retirada obliga a establecer una contraseña nueva y envía el enlace a un destino autorizado; un OWNER puede corregir el destino o reenviar el enlace, y el propio titular puede pedir un enlace nuevo al destino guardado; ver [Recuperación obligatoria tras un incidente](recuperacion-obligatoria.md). La página web de esa solicitud es `/recuperar-cuenta/solicitar` (E4.1).
- **Panel web (R1 y R2, integrados, pendientes de commit):** botones «Retirar protección», «Corregir destino» y «Reenviar enlace», y estado «Recuperación pendiente» con el destino guardado. La acción `SECURITY_HOLD_RESOLVED` aparece con su etiqueta y en el filtro del historial desde E4.2.
- **F (F1a, F1b y F2):** diálogos del panel y de la aplicación accesibles con teclado, y aviso en el login cuando la API cierra una sesión abierta por protección, suspensión o recuperación pendiente, con el motivo que devuelve la API.
