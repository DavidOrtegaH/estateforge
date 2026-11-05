# Recuperación obligatoria tras un incidente (E2)

Este documento describe cómo una cuenta que sufrió un incidente de seguridad vuelve a ser utilizable: el titular tiene que establecer una contraseña nueva, y el email de la cuenta vuelve a la dirección autorizada. Complementa a [Protección por incidente y su versionado](proteccion-por-incidente.md), que explica cómo se protege una cuenta y cómo se evita retirar una protección más reciente.

> **Estado:** E2.1 a E2.6 están commiteados en la rama `feat/keys` (`d32ff42`; los hashes citados son los posteriores a la reescritura del historial del 2026-11-05). La página web para pedir un enlace nuevo y la presentación de estas acciones en la auditoría del panel (E4.1 y E4.2) están commiteadas en la misma rama (`e9afe29`). El estado de recuperación en la API del panel (R1) y los botones del panel para retirar la protección, corregir el destino y reenviar el enlace (R2) están integrados en la rama, pendientes de commit; ver [Gestión desde el panel de administración](#gestión-desde-el-panel-de-administración-r1-y-r2). Las dos migraciones de E2 están en el repositorio y se aplicaron a la base local de desarrollo (`apps/api/dev.db`, que no se versiona): la de E2.1 (`20261102090000_add_security_recovery_fields`) el 2026-11-02 y la del actor opcional de la auditoría (`20261103120000_admin_audit_optional_actor`) el 2026-11-04; cualquier otra base debe migrarse antes de usar este código (ver [Migración](#9-migración)).

## 1. Qué problema resuelve

Antes de E2, retirar una protección solo ponía `securityHoldAt` a nulo. Eso dejaba dos problemas:

- **La contraseña antigua seguía sirviendo.** Si el incidente fue real, quien la conociera podía volver a entrar.
- **El email de la cuenta podía ser el del atacante.** El enlace de incidente se envía al email anterior a un cambio; si el cambio lo hizo un atacante, el email actual es el suyo, y el anterior no quedaba guardado en ningún sitio. Una recuperación normal enviaría el enlace al atacante.

E2 resuelve ambos: guarda el email al que se avisó del incidente, obliga a establecer una contraseña nueva al retirar la protección, envía el enlace solo a un destino autorizado y, al completar la recuperación, devuelve el email de la cuenta a ese destino.

| Fase | Qué añade | Código principal |
|---|---|---|
| E2.1 | Campos y migración | `apps/api/prisma/schema.prisma` |
| E2.2 | Guardar el email avisado y proponerlo como destino | `apps/api/src/services/security-incident.service.ts` |
| E2.3 | Bloquear el acceso mientras la recuperación esté pendiente | `apps/api/src/routes/auth.routes.ts`, `apps/api/src/services/session.service.ts` |
| E2.4 | Retirada de la protección con recuperación obligatoria | `apps/api/src/routes/admin.routes.ts` |
| E2.5a–b | Consumo transaccional y aislamiento del autoservicio | `apps/api/src/services/password-reset.service.ts` |
| E2.5c | Endpoint `POST /api/auth/security-recovery/complete` | `apps/api/src/routes/auth.routes.ts` |
| E2.5d | Página web `/recuperar-cuenta` | `apps/web/src/pages/RecoverAccountPage.tsx`, `apps/web/src/services/authService.ts` |
| E2.5f | Corrección del destino y reenvío del enlace por un OWNER | `apps/api/src/routes/admin.routes.ts` |
| E2.6 | Solicitud de un enlace nuevo por el propio titular | `apps/api/src/services/security-recovery.service.ts`, `apps/api/src/routes/auth.routes.ts` |
| E4.1 | Página web `/recuperar-cuenta/solicitar` y enlaces de acceso desde el login y `/recuperar-cuenta` | `apps/web/src/pages/RequestRecoveryLinkPage.tsx`, `apps/web/src/services/authService.ts` |
| E4.2 | Etiquetas, filtro y origen del destino en la auditoría del panel | `apps/web/src/lib/adminAudit.ts`, `apps/web/src/pages/AdminPage.tsx` |
| R1 | Estado de recuperación (`passwordResetRequiredAt`) y destino guardado (`securityRecoveryEmail`) en el listado y el detalle de usuarios del panel | `apps/api/src/routes/admin.routes.ts` |
| R2 | Retirada de la protección, corrección del destino y reenvío del enlace desde el panel | `apps/web/src/pages/AdminPage.tsx`, `apps/web/src/services/adminService.ts`, `apps/web/src/lib/adminUserActions.ts`, `apps/web/src/lib/adminRecovery.ts`, `apps/web/src/lib/adminAccountStatus.ts` |

### Campos (E2.1)

| Modelo y campo | Significado |
|---|---|
| `User.passwordResetRequiredAt` | Distinto de nulo: la cuenta debe establecer una contraseña nueva antes de poder acceder. |
| `User.securityRecoveryEmail` | Destino de la recuperación. Lo propone el incidente y lo confirma o corrige un OWNER. |
| `SecurityIncidentToken.notifiedEmail` | Email al que se envió el enlace de incidente. Es un dato del incidente, **no** una autorización. |
| `PasswordResetToken.purpose` | `SELF_SERVICE` (por defecto, autoservicio) o `SECURITY_RECOVERY` (obligatoria). |
| `PasswordResetToken.deliverTo` | Solo en tokens `SECURITY_RECOVERY`: destino autorizado al que se envió. |
| `PasswordResetToken.securityHoldVersion` | Solo en tokens `SECURITY_RECOVERY`: versión de la protección que se resolvió. |

## 2. Ciclo completo

1. **Aviso del incidente (E2.2).** Al completar un cambio de email, `issueSecurityIncidentToken(userId, notifiedEmail)` crea el token de incidente (caducidad de 7 días) y guarda en `notifiedEmail` el email **anterior**, normalizado (`trim` y minúsculas). El aviso se envía a esa misma dirección.
2. **Registro del incidente.** El titular confirma desde el enlace. `reportSecurityIncident`, en una transacción, reclama el token, pone `securityHoldAt`, incrementa `securityHoldVersion` y **copia el `notifiedEmail` del token reclamado a `User.securityRecoveryEmail`** como destino propuesto. Un token anterior a E2, sin `notifiedEmail`, deja el destino a nulo. `User.email` no cambia. Se borran sesiones, tokens de recuperación, verificaciones de email y los demás tokens de incidente (ver el otro documento, sección 3).
3. **Cuenta protegida.** Mientras `securityHoldAt` no es nulo, la cuenta no puede acceder ni recuperar la contraseña.
4. **Retirada por un OWNER (E2.4).** `POST /api/admin/users/:id/resolve-security-hold` con un motivo y, opcionalmente, `recoveryEmail`. En una transacción: retira la protección, activa `passwordResetRequiredAt`, guarda el destino, crea el token `SECURITY_RECOVERY` y registra la auditoría `SECURITY_HOLD_RESOLVED` (sección 4).
5. **Envío del enlace.** Después del commit se envía el correo «EstateForge — Establece una contraseña nueva» al destino, con el enlace `WEB_APP_URL/recuperar-cuenta?token=…`.
6. **Acceso bloqueado (E2.3).** Mientras `passwordResetRequiredAt` no es nulo, la cuenta no puede iniciar ni mantener sesiones (sección 3).
7. **Finalización (E2.5).** El titular abre el enlace, establece una contraseña nueva en `/recuperar-cuenta` y la web llama a `POST /api/auth/security-recovery/complete`. `consumeSecurityRecoveryToken`, en una sola transacción, cambia la contraseña, restaura el email al destino, limpia la obligación, invalida sesiones y tokens y registra `SECURITY_RECOVERY_COMPLETED` (secciones 5 y 6).
8. **Acceso normal.** La cuenta vuelve a iniciar sesión con el email restaurado y la contraseña nueva.

La protección por incidente, la recuperación obligatoria y la suspensión administrativa (`adminSuspendedAt`) son **estados independientes**: retirar la protección no retira una suspensión, y una cuenta suspendida no puede completar la recuperación hasta que se retire la suspensión.

## 3. Autoservicio frente a recuperación obligatoria

| | `SELF_SERVICE` (autoservicio) | `SECURITY_RECOVERY` (obligatoria) |
|---|---|---|
| Quién lo inicia | El usuario, con `POST /api/auth/forgot-password` | Un OWNER, al retirar la protección |
| Destino | El email actual de la cuenta | El destino autorizado (`deliverTo`), que puede no ser el email actual |
| Página web | `/restablecer-contrasena` | `/recuperar-cuenta` |
| Endpoint de consumo | `POST /api/auth/reset-password` (`consumePasswordResetToken`) | `POST /api/auth/security-recovery/complete` (`consumeSecurityRecoveryToken`) |
| Cambia el email | No | Sí: lo restaura al destino |
| Caducidad | 1 hora | 1 hora |

**Por qué una cuenta con la recuperación obligatoria pendiente no puede usar el autoservicio:** el email actual puede ser el del atacante. Por eso:

- `forgot-password` no emite ni envía nada si la cuenta tiene `securityHoldAt`, `adminSuspendedAt` o `passwordResetRequiredAt`. La respuesta sigue siendo la genérica, para no revelar el estado.
- `issuePasswordResetToken` solo sustituye tokens `SELF_SERVICE` pendientes: nunca borra un token obligatorio.
- `consumePasswordResetToken` solo acepta tokens `SELF_SERVICE` (en la lectura y en la reclamación) y rechaza la cuenta si tiene la recuperación obligatoria pendiente, además de la protección o la suspensión. Un token obligatorio enviado a `reset-password` se rechaza sin consumirse.
- `consumeSecurityRecoveryToken` solo acepta tokens `SECURITY_RECOVERY`.

Para las cuentas sin esos estados, el autoservicio funciona igual que antes de E2.

**Bloqueo del acceso (E2.3).** Con `passwordResetRequiredAt` activo:

| Dónde | Efecto |
|---|---|
| `POST /api/auth/login` | Tras comprobar la contraseña (si es incorrecta, 401 como siempre): 423 «Debes establecer una contraseña nueva antes de volver a acceder. Si no has recibido el enlace de recuperación, contacta con soporte.». No se crea sesión. Si la cuenta también está protegida o suspendida, prevalece ese mensaje (orden: protección, suspensión, recuperación). |
| `getUserIdFromSession` (usado por `requireAuth` y `requireOwner`) | La sesión se borra y la petición se trata como no autenticada (401). |
| `getAuthenticatedUser` y `GET /api/auth/me` | Borran todas las sesiones de la cuenta, limpian la cookie y responden 423 con el mismo mensaje. |

## 4. Responsabilidades del OWNER y destino de la recuperación

La retirada exige sesión de un OWNER no protegido (`requireOwner`), no se puede aplicar a la propia cuenta ni a otra cuenta OWNER, y solo a una cuenta con la protección activa. La condición por versión de la protección es la misma que antes de E2 (ver el otro documento, sección 5).

**Cuerpo:** `{ reason, recoveryEmail? }`. `reason` tiene entre 3 y 500 caracteres tras recortar. `recoveryEmail` es opcional; si se envía, se valida (`trim`, formato de email, máximo 254) y se normaliza (minúsculas).

| Situación | Destino usado | `recoveryDestination` en la auditoría |
|---|---|---|
| Hay destino guardado y no se indica `recoveryEmail` | El guardado | `STORED` |
| Se indica el mismo destino guardado (tras normalizar) | El guardado | `STORED` |
| No hay destino guardado y se indica `recoveryEmail` | El indicado | `OWNER_PROVIDED` |
| Hay destino guardado y se indica otro distinto | El indicado | `OWNER_CORRECTED` |
| No hay destino guardado ni se indica `recoveryEmail` | — | 400, sin cambios |

**Nunca se usa `User.email` como destino de reserva.** Si el incidente fue real, el email actual puede ser el del atacante, y enviarle el enlace le devolvería el control de la cuenta. Las cuentas protegidas antes de E2 no tienen destino guardado: el OWNER debe indicarlo tras verificar la identidad del titular por otra vía. La retirada **no** cambia `User.email`; eso solo ocurre al completar la recuperación.

**Auditoría `SECURITY_HOLD_RESOLVED`:** se registra en la misma transacción. Guarda el OWNER (`actorUserId`), la cuenta (`targetUserId`), el motivo, los emails de ambos en el momento de la acción (como las demás acciones de administración) y `recoveryDestination`. **No** guarda la dirección de destino, el token ni el enlace. `GET /api/admin/audit` expone `recoveryDestination` y acepta como filtro `SECURITY_HOLD_RESOLVED`, `SECURITY_RECOVERY_COMPLETED`, `SECURITY_RECOVERY_DESTINATION_CHANGED`, `SECURITY_RECOVERY_LINK_RESENT` y `SECURITY_RECOVERY_LINK_REQUESTED`; el panel web las muestra con su etiqueta y permite filtrarlas (ver [Auditoría en el panel de administración](#auditoría-en-el-panel-de-administración-e42)).

**Actor opcional:** `AdminAuditLog.actorUserId` admite NULL (migración `20261103120000_admin_audit_optional_actor`, que reconstruye la tabla porque SQLite no permite quitar `NOT NULL`; conserva las filas y los dos índices). Un registro sin actor es una acción sin un actor autenticado; hoy solo `SECURITY_RECOVERY_LINK_REQUESTED`. En `GET /api/admin/audit` ese registro trae `actorUserId`, `actorEmail`, `actorEmailAtAction` y `actorFound` a `null`. El panel muestra «Solicitud no autenticada» como operador, sin identificador de actor. La cuenta afectada continúa mostrándose en su columna correspondiente.

### Corrección del destino y reenvío del enlace (E2.5f)

Mientras la recuperación está pendiente, un OWNER puede corregir el destino o enviar un enlace nuevo, sin repetir la retirada. Las dos acciones están en `apps/api/src/routes/admin.routes.ts` y, desde R2, también en el panel (ver [Gestión desde el panel de administración](#gestión-desde-el-panel-de-administración-r1-y-r2)), con `requireOwner`, el mismo rate limit que las demás acciones de cuenta (20 por minuto, contador propio de cada ruta) y motivo obligatorio (3 a 500 caracteres).

| | `POST /api/admin/users/:id/recovery-destination` | `POST /api/admin/users/:id/resend-recovery` |
|---|---|---|
| Cuerpo | `{ reason, recoveryEmail }` (`recoveryEmail` obligatorio, mismas reglas que en la retirada: `trim`, formato, máximo 254, normalizado) | `{ reason }` |
| Destino del enlace | El indicado, que pasa a ser `securityRecoveryEmail` | El `securityRecoveryEmail` guardado (si falta, 400: hay que corregirlo; nunca se usa `User.email`) |
| Auditoría | `SECURITY_RECOVERY_DESTINATION_CHANGED` con `recoveryDestination` = `OWNER_CORRECTED` (había destino) u `OWNER_PROVIDED` (no lo había) | `SECURITY_RECOVERY_LINK_RESENT` |

Las dos auditorías guardan el OWNER, la cuenta, el motivo y los emails de ambos en el momento de la acción, como las demás acciones de administración. **Nunca** guardan el destino de recuperación, el token ni el enlace.

**Requisitos de la cuenta** (se comprueban en este orden): sin protección por incidente activa (si la tiene, se usa la retirada, que ya envía un enlace nuevo), sin suspensión administrativa (hay que retirarla primero) y con la recuperación obligatoria pendiente. Ninguna de las dos acciones cambia la protección, la suspensión, `securityHoldVersion`, la contraseña ni `User.email`.

**Destino:** no puede ser el `User.email` de **otra** cuenta (409). Sí puede coincidir con el `securityRecoveryEmail` de otras cuentas y con el propio email de la cuenta.

**Mismo destino:** si la corrección indica el destino ya guardado (tras normalizar), responde 200 con `changed: false` y no emite token, no envía correo ni registra auditoría. Para un enlace nuevo se usa el reenvío.

**Transacción:** dentro de una sola transacción, comprueba que el destino no es el email de otra cuenta; escribe en la cuenta con una condición sobre el estado leído (`passwordResetRequiredAt` no nulo, sin protección ni suspensión, misma `securityHoldVersion` y mismo `securityRecoveryEmail`), que en el reenvío no cambia ningún valor y solo confirma el estado; borra los tokens `SECURITY_RECOVERY` **no usados** de la cuenta (los de autoservicio y los ya usados se conservan); crea el token nuevo con el destino, la versión **actual** (no se incrementa) y caducidad de 1 hora; y registra la auditoría. Si la escritura condicional no encuentra la cuenta en el estado leído, relee la cuenta para elegir el 409 y no crea nada. Cualquier fallo deshace la transacción entera.

**Envío:** después del commit, igual que en la retirada. Si falla, responde 200 con `recoveryEmailSent: false`; el destino, el token y la obligación se mantienen y se puede volver a reenviar.

**Concurrencia:** cada enlace nuevo invalida los anteriores, así que dos reenvíos seguidos o simultáneos dejan un único enlace utilizable (el último en confirmarse). Si dos correcciones leen el mismo destino, la segunda en escribir responde 409. Si el titular completa la recuperación antes que una de estas acciones, la acción responde 409; si la acción se confirma antes, el enlace anterior deja de existir y su consumo da `invalid_token`. Las limitaciones de SQLite entre procesos de la sección 8 también aplican aquí.

### Solicitud de un enlace nuevo por el titular (E2.6)

El titular puede pedir un enlace nuevo sin intervención de un OWNER con `POST /api/auth/security-recovery/request` (pública, en `apps/api/src/routes/auth.routes.ts`; la lógica está en `apps/api/src/services/security-recovery.service.ts`). La usa la página web `/recuperar-cuenta/solicitar` (E4.1, ver sección 7).

- **Cuerpo:** `{ email, turnstileToken? }`, estricto: cualquier otro campo (destino, token, versión…) da 400. El email se valida como en `forgot-password` y se normaliza (`trim` y minúsculas). `turnstileToken` usa el mismo esquema opcional que las demás rutas públicas (`register`, `login`, `forgot-password`, `reset-password`): el servidor solo lo exige si tiene configurada la clave secreta de Turnstile.
- **Cuentas candidatas:** las que tienen la recuperación pendiente, sin protección ni suspensión y con destino guardado, cuyo `User.email` **o** cuyo `securityRecoveryEmail` coincida con el email introducido. Se procesan **todas**: se leen por páginas de 50, ordenadas por id con un cursor estable (`id` mayor que el último leído). Ninguna se repite y no se omite ninguna de las que coinciden durante todo el recorrido, pero la paginación **no es una instantánea** de la tabla: una cuenta que cambie a la vez los campos de la búsqueda, o una creada con un id anterior al cursor, puede quedar fuera. Cada cuenta procesada se protege con su escritura condicional. Se busca también por el destino porque, si el incidente fue real, el `User.email` actual es el del atacante y el titular solo conoce su email anterior, que es el destino. `securityRecoveryEmail` no tiene índice: esa búsqueda recorre la tabla `User`.
- **Destino:** siempre el `securityRecoveryEmail` guardado de cada cuenta. Nunca `User.email` ni un email indicado por el cliente. No cambia el destino, la versión, la contraseña, `User.email` ni los estados de la cuenta.
- **Por cada candidata, en su propia transacción** (una cuenta que no cumpla o falle no impide las demás): comprueba que el destino no es el `User.email` de otra cuenta; comprueba el **enfriamiento** (sin tokens `SECURITY_RECOVERY` de la cuenta creados en los últimos 15 minutos, por cualquier vía); repite la escritura condicional de E2.5f sin cambiar valores; borra los `SECURITY_RECOVERY` no usados; crea el token (versión actual, 1 hora); y registra `SECURITY_RECOVERY_LINK_REQUESTED` **sin actor** (`actorUserId` NULL: quien lo pide no se autentica) y con la cuenta como objetivo (`targetUserId`), **sin motivo ni metadatos**. Si algo no se cumple, no se crea nada. Las solicitudes que no emiten enlace no se auditan.
- **Envío:** después del commit y **sin esperar** a que termine, para que el tiempo de respuesta no dependa del correo. Los envíos pendientes se registran; cualquier error, incluso antes de llamar al SMTP (por ejemplo, al construir el enlace), se captura y se registra en el log sin datos sensibles, sin dejar rechazos sin gestionar. Ante `SIGINT` o `SIGTERM`, `apps/api/src/server.ts` llama a `registerGracefulShutdown` (`apps/api/src/shutdown.ts`), que cierra la app: Fastify deja terminar las peticiones en curso y después ejecuta el hook `onClose` de `authRoutes`, que espera a todos los envíos registrados, también a los de esas peticiones. Una segunda señal, sea la misma o la otra (SIGTERM y luego SIGINT, o al revés), sale al momento con código 1 sin esperar al cierre; el proceso solo sale una vez. En Windows no se puede probar con un proceso real (enviar la señal a un proceso hijo lo termina sin ejecutar manejadores); se prueba el manejador con un servidor HTTP real y la señal emitida sobre un emisor inyectado. Un cliente que mantenga abierta su conexión (keep-alive) puede retrasar el cierre hasta que esta caduque. En una caída brusca del proceso (por ejemplo, `kill -9`) un envío en curso se perdería; el token y la obligación quedan guardados y el titular puede volver a pedirlo tras el enfriamiento, o un OWNER reenviarlo. Un fallo del SMTP se registra en el log solo con el id de la cuenta y el tipo de error.
- **Respuesta:** siempre 200 `{ message: "Si la cuenta puede recuperar el acceso, recibirás instrucciones en el destino de recuperación registrado." }`, la misma para una cuenta inexistente, sin recuperación, protegida, suspendida, sin destino, con el destino ocupado, en enfriamiento, con un conflicto de concurrencia, con varias cuentas o con un error interno. No indica cuántas cuentas hay ni si se envió algo.
- **Abuso:** Turnstile (si está configurado) y 5 solicitudes cada 15 minutos por IP, con contador propio de la ruta. El enfriamiento limita a 4 los correos por hora a cada cuenta y evita invalidar en bucle un enlace recién enviado; como cada enlace nuevo va al mismo destino, un tercero no puede dejar al titular sin enlace. El enfriamiento no afecta a la retirada ni a las acciones del OWNER.

### Auditoría en el panel de administración (E4.2)

El historial de acciones del panel (`/admin`, solo para cuentas OWNER: `OwnerRoute` en la web y `requireOwner` en la API) muestra los registros de `GET /api/admin/audit` con las columnas Acción, Cuenta afectada, Operador, Fecha y Motivo. Las etiquetas y el texto de la columna Acción están en `apps/web/src/lib/adminAudit.ts` (`AUDIT_ACTION_LABELS`, `auditActionLabel`, `recoveryDestinationLabel` y `describeAuditAction`).

| Acción | Etiqueta en el panel | Quién aparece como operador |
|---|---|---|
| `ACCOUNT_SUSPENDED` | Cuenta suspendida | El OWNER |
| `ACCOUNT_UNSUSPENDED` | Suspensión retirada | El OWNER |
| `SESSIONS_REVOKED` | Sesiones cerradas | El OWNER |
| `SECURITY_HOLD_RESOLVED` | Protección retirada | El OWNER |
| `SECURITY_RECOVERY_DESTINATION_CHANGED` | Destino de recuperación corregido | El OWNER |
| `SECURITY_RECOVERY_LINK_RESENT` | Enlace de recuperación reenviado | El OWNER |
| `SECURITY_RECOVERY_LINK_REQUESTED` | Enlace solicitado por el titular | «Solicitud no autenticada» (sin actor, sin identificador) |
| `SECURITY_RECOVERY_COMPLETED` | Recuperación completada | La propia cuenta afectada |

Una acción que el panel no conozca se muestra con su código tal cual.

**Filtro «Acción»:** ofrece «Todas» y las ocho acciones, en el orden de la tabla. Se combina con el filtro por cuenta (botón «Filtrar» de la columna Cuenta afectada). La acción se envía codificada en la URL (`?action=…`) y la API solo acepta esas ocho; un valor no válido no filtra.

**Texto de la columna Acción:** la etiqueta y, entre paréntesis, los datos adicionales que haya: el número de sesiones cerradas en `SESSIONS_REVOKED` (por ejemplo, «Sesiones cerradas (3)») y el origen del destino de recuperación (`recoveryDestination`), por ejemplo «Protección retirada (destino guardado)».

| `recoveryDestination` | Texto | Cuándo se registra |
|---|---|---|
| `STORED` | destino guardado | Retirada que usa el destino ya guardado (también si el OWNER indica esa misma dirección) |
| `OWNER_PROVIDED` | destino indicado por un OWNER | No había destino guardado y lo indicó el OWNER, en la retirada o en la corrección |
| `OWNER_CORRECTED` | destino corregido por un OWNER | Había destino guardado y el OWNER indicó otro, en la retirada o en la corrección |

Solo `SECURITY_HOLD_RESOLVED` y `SECURITY_RECOVERY_DESTINATION_CHANGED` guardan el origen. Si es `null` (el resto de acciones o retiradas anteriores a E2.4) o un valor desconocido, no se añade nada.

**Qué no muestra:** el origen del destino no es la dirección. La API no devuelve en la auditoría el destino de recuperación, el token ni el enlace, y la auditoría del panel no los muestra. Las columnas Cuenta afectada y Operador muestran, como antes, el email actual de cada cuenta y, si cambió o la cuenta ya no existe, el registrado al hacer la acción. El destino guardado sí se ve en la lista y el detalle de usuarios desde R1 (sección siguiente).

### Gestión desde el panel de administración (R1 y R2)

Un OWNER puede hacer las tres acciones de recuperación desde `/admin`, sin llamar a la API a mano. El panel usa los mismos endpoints (`resolve-security-hold`, `recovery-destination` y `resend-recovery`), así que las reglas, la transacción y las respuestas son las descritas en este documento. El panel solo decide qué botones ofrece y cuándo: la autorización y las comprobaciones de estado las sigue haciendo la API.

**Estado de recuperación (R1).** `GET /api/admin/users` y `GET /api/admin/users/:id` devuelven además `passwordResetRequiredAt` (desde cuándo está pendiente la recuperación, o `null`) y `securityRecoveryEmail` (destino guardado, o `null`). Una recuperación está pendiente cuando `passwordResetRequiredAt` no es nulo. Son los dos únicos endpoints que devuelven el destino, ambos con `requireOwner`; siguen sin devolver contraseñas, tokens ni sus hashes.

**Qué muestra el panel:**

- **Estado:** «Recuperación pendiente» junto a «Protección por incidente» y «Suspendida por admin» cuando concurren; ninguna etiqueta oculta a otra (`apps/web/src/lib/adminAccountStatus.ts`).
- **Destino de recuperación:** en la tabla y en las tarjetas móviles, cuando existe y hay recuperación pendiente o protección activa. En el detalle de la cuenta, siempre, junto a «Recuperación obligatoria» (fecha desde la que está pendiente, o «No»); sin destino, «Sin destino guardado».
- El destino es un dato personal: solo aparece en el panel OWNER.

**Acciones y condiciones** (`apps/web/src/lib/adminUserActions.ts`, las mismas condiciones que la API). Ninguna se ofrece para cuentas OWNER, que tampoco se pueden modificar por API (403).

| Botón | Se ofrece cuando | Email en el diálogo |
|---|---|---|
| «Retirar protección» | La cuenta tiene protección por incidente, también si está suspendida | Opcional si hay destino guardado (vacío = usar el guardado); obligatorio si no lo hay |
| «Corregir destino» | Recuperación pendiente, sin protección ni suspensión | Obligatorio |
| «Reenviar enlace» | Las mismas condiciones que «Corregir destino». Sin destino guardado aparece desactivado, con el mismo motivo que daría la API | No lleva |

Todas abren el diálogo de confirmación del panel y exigen un **motivo de 3 a 500 caracteres**, que se guarda en la auditoría (como suspender, reactivar y cerrar sesiones). Antes de enviar, el panel comprueba el formato del email y el máximo de 254 caracteres; la validación definitiva es la de la API.

**Resultados y errores** (`apps/web/src/lib/adminRecovery.ts`):

- `recoveryEmailSent: true`: aviso de éxito con el mensaje de la API.
- `recoveryEmailSent: false`: la operación se hizo, pero el enlace no se envió (también cuando la corrección indica el mismo destino, `changed: false`). Se muestra como advertencia, no como éxito; se puede reenviar desde el panel.
- 409: el mensaje de la API y un aviso de que el estado de la cuenta ha cambiado y hay que actualizar la página antes de volver a intentarlo.
- 400 y otros errores: el mensaje de la API.
- El aviso solo aparece con la respuesta del servidor. La acción se ejecuta una sola vez: un doble clic no la repite, y si después falla la actualización de los datos se avisa de eso, no de un fallo de la acción.

**Entrega del correo:** `recoveryEmailSent: true` significa que el servidor SMTP aceptó el mensaje, no que haya llegado al buzón; la entrega depende del proveedor de correo.

## 5. Ciclo de vida del token `SECURITY_RECOVERY`

- **Creación:** en la transacción de la retirada, después de la escritura condicional por versión. Antes se borran los tokens de recuperación **no usados** de la cuenta, de cualquier tipo: tras la retirada, el único enlace válido es el de esa versión.
- **Contenido:** solo se guarda el hash SHA-256 del token (`hashPasswordResetToken`), con `purpose = 'SECURITY_RECOVERY'`, `deliverTo` = destino y `securityHoldVersion` = versión de la protección resuelta. El token en claro solo viaja en el enlace del correo.
- **Caducidad:** 1 hora (`PASSWORD_RESET_TOKEN_DURATION_MS`), la misma que el autoservicio.
- **Un solo uso:** `consumeSecurityRecoveryToken` lo reclama con un `updateMany` condicional (`usedAt` nulo, no caducado y `purpose = 'SECURITY_RECOVERY'`). Si dos peticiones lo usan a la vez, solo una puede reclamarlo; la otra recibe token inválido.
- **Validaciones antes de reclamarlo:** el token existe, no se ha usado, no ha caducado, es `SECURITY_RECOVERY`, tiene `deliverTo` y `securityHoldVersion`. La cuenta existe, tiene `passwordResetRequiredAt`, no tiene protección ni suspensión, su `securityHoldVersion` es la del token y su `securityRecoveryEmail` coincide con `deliverTo`.
- **Invalidación por un incidente posterior:** `reportSecurityIncident` borra todos los tokens de recuperación de la cuenta, así que el token antiguo deja de existir. Aunque existiera, la nueva protección y la versión incrementada harían fallar la comprobación de estado.
- **Destino ocupado:** dentro de la transacción se comprueba que `deliverTo` no pertenece a otra cuenta. Si otra cuenta ocupa la dirección después de esa comprobación, la restricción `UNIQUE` de `User.email` falla (`P2002`). En ambos casos la transacción se deshace entera, el token **no** queda consumido y el resultado es `email_taken`.

## 6. Finalización de la recuperación

`consumeSecurityRecoveryToken(token, passwordHash)`, en una única transacción:

1. Reclama el token (sección 5).
2. Comprueba que el destino está libre.
3. Actualiza la cuenta con una escritura condicional que repite las comprobaciones de estado (`passwordResetRequiredAt` no nulo, sin protección ni suspensión, misma versión, mismo destino):
   - `password` = hash de la contraseña nueva (`hashPassword`, sin cambios en la política);
   - `email` = `deliverTo`;
   - `passwordResetRequiredAt` = nulo;
   - `securityRecoveryEmail` = nulo.
4. Borra todas las sesiones de la cuenta.
5. Borra los tokens de recuperación **no usados** de la cuenta.
6. Borra las verificaciones de cambio de email **pendientes** (`usedAt` nulo) de la cuenta.
7. Registra `SECURITY_RECOVERY_COMPLETED` con la propia cuenta como actor y como objetivo, **sin motivo ni metadatos**: ni emails, ni token, ni enlace.

Todos los borrados se limitan a la cuenta del token. Los tokens de incidente no se tocan. Si cualquier paso posterior a la reclamación falla o se rechaza, la transacción se deshace por completo, incluida la reclamación del token.

## 7. Errores, respuestas y operativa

### `POST /api/admin/users/:id/resolve-security-hold`

Rate limit: 20 peticiones por minuto (`ACCOUNT_ACTION_RATE_LIMIT`, contador propio de la ruta). Las respuestas de autenticación (401/403) son las de `requireOwner`.

| Situación | Respuesta |
|---|---|
| Identificador no válido | 400 «Identificador de cuenta no válido.» |
| `recoveryEmail` no válido | 400 «El email de recuperación no es válido.» |
| Motivo no válido | 400 «Indica un motivo de entre 3 y 500 caracteres.» |
| La propia cuenta | 400 «No puedes modificar tu propia cuenta desde esta acción.» |
| Cuenta inexistente | 404 «No se ha encontrado la cuenta.» |
| Cuenta OWNER | 403 «No se pueden modificar cuentas propietarias.» |
| Sin protección activa | 409 «La cuenta no tiene una protección por incidente activa.» |
| Sin destino guardado ni indicado | 400 «La cuenta no tiene un destino de recuperación guardado. Indica el email al que enviar el enlace de recuperación obligatoria.» |
| La protección cambió entre la lectura y la escritura | 409 «La protección por incidente ha cambiado durante la operación. Revisa la cuenta antes de volver a intentarlo.» |
| Éxito y correo enviado | 200 `{ success: true, recoveryEmailSent: true, message: "Protección por incidente retirada. Se ha enviado el enlace de recuperación obligatoria; la cuenta no podrá acceder hasta establecer una contraseña nueva. Si existe una suspensión administrativa, seguirá activa." }` |
| Éxito y fallo del envío | 200 `{ success: true, recoveryEmailSent: false, message: "Protección por incidente retirada y recuperación obligatoria activada, pero no se pudo enviar el enlace. La cuenta sigue sin acceso hasta establecer una contraseña nueva." }` |

**Fallo del envío (SMTP):** el correo se envía después del commit. Si falla, la protección ya está retirada y la obligación, el destino y el token **se mantienen**; la cuenta sigue sin acceso. No se compensa reactivando la protección. El fallo se registra en el log con el id de la cuenta y el tipo de error, sin el token, el enlace ni el destino. Ninguna respuesta incluye el token ni el enlace.

### `POST /api/auth/security-recovery/complete`

Cuerpo `{ token, password, turnstileToken? }`, validado con el mismo esquema que `reset-password` (token de 32 a 256 caracteres; contraseña con la política existente). Mismo Turnstile y mismo rate limit que `reset-password`: 10 peticiones cada 15 minutos (contador propio de la ruta).

| Resultado | Respuesta |
|---|---|
| Cuerpo no válido (contraseña) | 400 con el mensaje de la política de contraseñas |
| Cuerpo no válido (otro campo) | 400 «El enlace de recuperación no es válido.» |
| Turnstile no válido | 400 «No se ha podido completar la verificación de seguridad. Inténtalo de nuevo.» |
| `completed` | 200 «Contraseña establecida y acceso recuperado. Ya puedes iniciar sesión con el email al que recibiste este enlace.» |
| `invalid_token` (inexistente, usado, caducado o de autoservicio) | 400 «El enlace de recuperación no es válido o ha caducado.» (la misma respuesta que `reset-password`) |
| `state_mismatch` (la cuenta ya no está en recuperación o cambió su estado) | 400 «Este enlace ya no permite completar la recuperación de la cuenta. Contacta con soporte si sigues sin poder acceder.» |
| `email_taken` | 409 «No se ha podido completar la recuperación porque el email de recuperación no está disponible. Contacta con soporte.» |

Ninguna respuesta incluye el destino, la cuenta que ocupa la dirección, el token ni detalles internos.

### Página `/recuperar-cuenta`

Ruta pública (fuera de `ProtectedRoute`). Lee `token` de la URL y no pide ni muestra el email.

- Sin `token`: muestra que el enlace no es válido y no ofrece el formulario.
- Formulario: contraseña y confirmación con la misma validación que `/restablecer-contrasena`, y Turnstile si está configurado.
- Éxito: muestra el mensaje y un enlace para iniciar sesión; el formulario desaparece.
- `invalid_token`, `state_mismatch` y `email_taken`: muestra un texto propio y el formulario desaparece.
- Sin `token` o con `invalid_token` (enlace no válido o caducado), ofrece además el enlace «Solicitar un enlace nuevo» a `/recuperar-cuenta/solicitar` (E4.1). Con `state_mismatch` y `email_taken` no, porque sus textos remiten a soporte.
- Otros 400 (validación o Turnstile), 429, 5xx o errores de red: muestra el error, mantiene el formulario y renueva el widget de Turnstile, porque el servidor ya gastó el token anterior.
- Un bloqueo síncrono (`submittingRef`) impide enviar dos veces la misma petición.

`completeSecurityRecovery` (en `authService.ts`) distingue los dos 400 que cierran el enlace por el **texto exacto** del mensaje, porque la API solo devuelve `{ message }`.

### Página `/recuperar-cuenta/solicitar` (E4.1)

Ruta pública (fuera de `ProtectedRoute`), en `apps/web/src/pages/RequestRecoveryLinkPage.tsx`. Permite al titular pedir un enlace nuevo con `POST /api/auth/security-recovery/request` (E2.6, ver sección 4) mediante `requestSecurityRecoveryLink` de `authService.ts`.

**Accesos:**

- Desde `/recuperar-cuenta`, cuando no hay `token` o cuando la respuesta se clasifica específicamente como `invalid_token`. Muestra el enlace «Solicitar un enlace nuevo».
- Desde el login, cuando el error es **exactamente** el 423 de recuperación pendiente («Debes establecer una contraseña nueva antes de volver a acceder. Si no has recibido el enlace de recuperación, contacta con soporte.»): enlace «Solicitar un enlace de recuperación». No aparece con los 423 de protección o de suspensión ni con otros errores. La comparación la hace `isSecurityRecoveryRequiredMessage`, porque la API solo devuelve `{ message }`.

**Formulario:** email, Turnstile si está configurado y botón «Enviar enlace». El texto explica que, si la cuenta tiene una recuperación pendiente, se enviará un enlace nuevo al destino de recuperación registrado, sin indicar cuál. La petición lleva exactamente `{ email, turnstileToken }` (el email recortado; la API lo normaliza) y no envía la cookie de sesión.

**Resultado:** si la API acepta la solicitud, la página muestra su mensaje tal cual («Si la cuenta puede recuperar el acceso, recibirás instrucciones en el destino de recuperación registrado.»), que es el mismo exista o no la cuenta, se envíe o no un enlace y aunque la cuenta esté en el enfriamiento de 15 minutos. Después vacía el campo, oculta el formulario y ofrece «Enviar otra solicitud», que vuelve al formulario vacío con un widget de Turnstile nuevo. «Volver a iniciar sesión» está siempre visible. La página no vuelve a mostrar el email introducido ni ningún destino, y no lo guarda en la URL ni en el almacenamiento del navegador.

| Situación | Mensaje |
|---|---|
| Turnstile configurado y sin completar | «Completa la verificación de seguridad e inténtalo de nuevo.» (no se envía nada) |
| 400 de validación o de Turnstile | El mensaje de la API (por ejemplo, «Introduce un email válido.») |
| 429 (5 solicitudes cada 15 minutos por IP) | «Has hecho demasiadas solicitudes. Inténtalo de nuevo más tarde.» (texto propio; el plugin de rate limit responde en inglés) |
| Otro estado, respuesta sin mensaje o no JSON, o error de red | «No se ha podido enviar la solicitud. Inténtalo de nuevo en unos minutos.» |

Tras cualquier error del servidor o de red, la página renueva el widget de Turnstile, porque el servidor ya gastó el token anterior. Un bloqueo síncrono (`submittingRef`) impide enviar dos veces la misma solicitud. La página no añade límites propios: el límite por IP y el enfriamiento por cuenta son los de la API.

El enlace que llega por correo es el de siempre: abre `/recuperar-cuenta?token=…` y sigue el flujo de finalización de la sección 6.

### `POST /api/admin/users/:id/recovery-destination` y `POST /api/admin/users/:id/resend-recovery`

Comparten con la retirada las respuestas de validación y de cuenta (400 por identificador, motivo o propia cuenta; 404; 403 para cuentas OWNER; 401/403 de `requireOwner`; 429).

| Situación | Respuesta |
|---|---|
| `recoveryEmail` ausente o no válido (corrección) | 400 «El email de recuperación no es válido.» (si el motivo tampoco es válido, prevalece su mensaje) |
| Protección por incidente activa | 409 «La cuenta tiene una protección por incidente activa. Retírala primero; la retirada envía un enlace nuevo.» |
| Suspensión administrativa | 409 «La cuenta está suspendida administrativamente. Retira la suspensión antes de gestionar su recuperación.» |
| Sin recuperación pendiente | 409 «La cuenta no tiene una recuperación obligatoria pendiente.» |
| Sin destino guardado (reenvío) | 400 «La cuenta no tiene un destino de recuperación guardado. Corrige el destino antes de reenviar.» |
| Destino que es el email de otra cuenta | Corrección: 409 «Ese email pertenece a otra cuenta.» Reenvío: 409 «El destino de recuperación guardado pertenece a otra cuenta. Corrige el destino antes de reenviar.» |
| La cuenta cambió entre la lectura y la escritura | 409 «La recuperación de la cuenta ha cambiado durante la operación. Revisa la cuenta antes de volver a intentarlo.», o el 409 del estado nuevo si ya no admite la acción |
| Corrección con el mismo destino | 200 `{ success: true, changed: false, recoveryEmailSent: false, message: "El destino indicado ya es el destino de recuperación de la cuenta. No se ha enviado ningún enlace; usa el reenvío si necesitas uno nuevo." }` |
| Corrección realizada | 200 `{ success: true, changed: true, recoveryEmailSent, message }`: «Destino de recuperación actualizado. Se ha enviado un enlace nuevo; los enlaces anteriores ya no son válidos.» o, si falla el envío, «Destino de recuperación actualizado, pero no se pudo enviar el enlace nuevo. Los enlaces anteriores ya no son válidos; puedes reenviarlo.» |
| Reenvío realizado | 200 `{ success: true, recoveryEmailSent, message }`: «Se ha enviado un enlace de recuperación nuevo; los enlaces anteriores ya no son válidos.» o, si falla el envío, «No se pudo enviar el enlace de recuperación. Los enlaces anteriores ya no son válidos; vuelve a intentarlo más tarde.» |

Ninguna respuesta incluye el destino, el token ni el enlace. El fallo del envío se registra en el log con el id de la cuenta y el tipo de error, sin datos sensibles.

### Qué hacer cuando la recuperación se atasca

La retirada no se puede repetir, porque la protección ya no está activa (409). Desde E2.5f (y, desde R2, con los botones del panel indicados entre paréntesis):

- **El envío falló** (`recoveryEmailSent: false`) **o el enlace caducó** (1 hora): reenviar con `resend-recovery` («Reenviar enlace»).
- **El destino era incorrecto o está ocupado** por otra cuenta (`email_taken` en la finalización, o 409 en el reenvío): corregirlo con `recovery-destination` («Corregir destino»), que envía un enlace nuevo.
- **La cuenta se suspendió** después de la retirada (`suspend` borra el token): retirar la suspensión con `unsuspend` («Reactivar cuenta») y reenviar.
- **Llegó un incidente nuevo:** la cuenta vuelve a estar protegida; se usa la retirada, que emite el enlace de la versión nueva.

El titular también puede pedir por sí mismo un enlace nuevo al destino guardado (E2.6, ver sección 4), con un enfriamiento de 15 minutos. Antes de E2.5f, estos casos dejaban la cuenta sin acceso salvo intervención directa en la base de datos:

- el envío del correo falló (`recoveryEmailSent: false`);
- el token caducó (1 hora) sin usarse;
- el destino está ocupado por otra cuenta (`email_taken`);
- la cuenta se suspendió y se reactivó después de la retirada (`suspend` borra el token obligatorio; ver sección 8).

Hoy todos ellos se resuelven con las acciones anteriores.

## 8. Pruebas, limitaciones y riesgos

### Pruebas

Cifras de la última ejecución de cada suite (API 561/561 en 25 ficheros y shared 20/20 en 1 fichero, al integrar E2; web 112/112 en 8 ficheros, al integrar E4.2):

| Fichero | Pruebas | Qué cubre de E2 y E4 |
|---|---|---|
| `apps/api/src/integration/security-hold-version.integration.test.ts` | 67 | SQLite real con las migraciones del proyecto. Bloques 7 (destino propuesto, E2.2), 8 (sesión con recuperación pendiente, E2.3), 9 (retirada con recuperación obligatoria, E2.4) y 10 (consumo, E2.5: ciclo completo con login, destino ocupado con comprobación previa y con `P2002` real, doble consumo simultáneo, incidente nuevo, estados incompatibles, `ROLLBACK` real provocado con triggers, token caducado o usado, `reset-password` con el token obligatorio, `forgot-password` con la obligación activa y autoservicio normal) y 11 (E2.5f: corrección y reenvío con consumo posterior, enlace anterior invalidado, consumo intercalado, suspensión y reactivación, incidente nuevo, dos correcciones intercaladas, dos reenvíos simultáneos, `ROLLBACK` real, fallo del envío, y destino ocupado o compartido) y 12 (E2.6: solicitud por el email actual o por el destino, enfriamiento, respuesta idéntica en todos los casos, varias cuentas con el mismo destino, campos del cliente rechazados, consumo, incidente o suspensión intercalados, dos solicitudes simultáneas, `ROLLBACK` real, fallo del envío y reenvío del OWNER durante el enfriamiento, y más de diez candidatas con algunas que no pueden recibir enlace; la solicitud se audita sin actor y `GET /api/admin/audit` la lista con el actor a `null`, también con filtros) y 13 (actor opcional: `actorUserId` admite NULL y se conservan los dos índices tras todas las migraciones; registros con y sin actor) |
| `apps/api/src/routes/admin.routes.test.ts` | 260 | Retirada, corrección del destino y reenvío: destinos, idempotencia, transacción, estados, concurrencia simulada, auditoría y correo; listado de un registro sin actor (`actorFound` null) (dobles) |
| `apps/api/src/routes/auth.routes.test.ts` | 49 | Login, `getAuthenticatedUser` y `/me` con la recuperación pendiente; endpoints `security-recovery/complete` y `security-recovery/request` (contrato estricto, respuesta idéntica, Turnstile, rate limit, envío sin esperar y cierre ordenado) (dobles) |
| `apps/api/src/services/password-reset.service.test.ts` | 28 | Aislamiento del autoservicio y `consumeSecurityRecoveryToken` (dobles) |
| `apps/api/src/services/security-incident.service.test.ts` | 13 | `notifiedEmail` y su copia al destino (dobles) |
| `apps/api/src/services/session.service.test.ts` | 8 | `getUserIdFromSession` y `requireAuth` con la recuperación pendiente |
| `apps/api/src/services/admin-audit.service.test.ts` | 33 | `recoveryDestination` en los metadatos de auditoría; resolución de un registro sin actor (`actorFound` null, distinto de `false`: actor no encontrado) |
| `apps/api/src/services/email.service.test.ts` | 10 | Plantilla del correo de recuperación obligatoria |
| `apps/api/src/services/security-recovery.service.test.ts` | 17 | Candidatas, paginación con cursor, evaluación independiente por cuenta, enfriamiento, destino ocupado, auditoría sin metadatos y envíos en segundo plano, incluido un error antes del SMTP sin rechazos sin gestionar (dobles) |
| `apps/api/src/shutdown.test.ts` | 9 | Cierre ordenado ante `SIGTERM` y `SIGINT`: espera a los envíos registrados, también los de una petición en curso (servidor HTTP real); segunda señal en las cuatro secuencias (sale con 1 sin esperar y una sola vez); señal tras un cierre completo; fallo del cierre |
| `apps/web/src/services/authService.test.ts` | 37 | 13 de `completeSecurityRecovery` (contrato y clasificación de errores), 3 de E2.3 y 21 de E4.1: contrato exacto de `requestSecurityRecoveryLink` (sin cookie ni campos extra), clasificación de 400, 429, otros estados, respuestas no JSON y errores de red, y `isSecurityRecoveryRequiredMessage` solo con el texto exacto |
| `apps/web/src/lib/adminAudit.test.ts` | 34 | 2 de `describeAuditActor`: sin actor, «Solicitud no autenticada» sin identificador; con actor, igual que cualquier cuenta. 27 de E4.2: etiquetas de las ocho acciones, códigos desconocidos, opciones del filtro, orígenes del destino y texto de la columna Acción. Las otras 5 son anteriores a E2 |
| `apps/web/src/services/adminService.test.ts` | 28 | 7 de E4.2: filtro de la auditoría con las acciones de recuperación, combinado con el filtro por cuenta, y la acción codificada en la URL. Las otras 21 son anteriores |

Las cifras de los ficheros de la API incluyen también las pruebas anteriores a E2.

**R1 y R2.** Al integrar R1, la suite de la API pasó con 568/568 pruebas en 25 ficheros; `admin.routes.test.ts` tiene 267, entre ellas las de los dos campos nuevos en el listado y el detalle, la ausencia de contraseñas, tokens y hashes en esas respuestas y el contrato de la paginación. Al integrar R2, la web pasó con 295/295 en 14 ficheros:

| Fichero | Pruebas | Qué cubre de R2 |
|---|---|---|
| `apps/web/src/services/adminService.test.ts` | 38 | Rutas y cuerpos de las tres acciones, respuestas con envío correcto, envío fallido y destino sin cambios, y errores 400 y 409 con su estado HTTP |
| `apps/web/src/lib/adminUserActions.test.ts` | 18 | Disponibilidad de las acciones para cuentas normales, suspendidas, protegidas, con recuperación pendiente (con y sin destino) y OWNER |
| `apps/web/src/lib/adminAccountStatus.test.ts` | 9 | «Recuperación pendiente» y su coexistencia con la protección y la suspensión |
| `apps/web/src/lib/adminRecovery.test.ts` | 37 | Validación del email, campo del diálogo, avisos, mensajes de 400 y 409, doble envío y distinción entre fallo de la acción y fallo del refresco |

En esa integración no se ejecutaron `apps/api/src/cors.test.ts` ni `apps/api/src/routes/security.routes.test.ts`, porque al importar `app.ts` cargan `apps/api/.env` (R2 no modifica la API). El renderizado del panel no tiene pruebas automáticas; el ciclo completo (retirada, corrección, reenvío y correo recibido) se comprobó a mano.

**Página `RecoverAccountPage`: no tiene pruebas automáticas** de renderizado ni de interacción. La web no tiene Testing Library ni entorno DOM, y en E2.5d no se añadieron dependencias. La página se ha comprobado con typecheck y build, revisión de código y una prueba manual de una persona a través de un túnel. Las 13 pruebas de `authService.test.ts` cubren el servicio, no la página.

**`AdminPage`: tampoco tiene pruebas de componente.** Ningún test comprueba que la celda del operador oculta la línea del identificador cuando el actor es null. Sí está probado que `describeAuditActor` devuelve «Solicitud no autenticada» con `id: null`; en la prueba de mutación, pintar esa línea aunque el id sea null no hace fallar ningún test. Del mismo modo, las etiquetas, las opciones del filtro y el texto de la columna Acción están probados en `adminAudit.test.ts`, pero no que la página los pinte.

**`RequestRecoveryLinkPage` y los enlaces de acceso (E4.1): sin pruebas automáticas** de renderizado ni de interacción, por la misma razón. Se han comprobado con typecheck, build y revisión de código; las pruebas de `authService.test.ts` cubren el servicio y la detección del mensaje 423, no la página.

### Observaciones menores de E2.5d (sin corregir)

- Un token con formato no válido en la URL (por ejemplo, un enlace cortado) hace que la API responda 400 «El enlace de recuperación no es válido.», que la web clasifica como error reintentable (`rejected`) en lugar de enlace inválido: el formulario sigue visible y cada intento falla igual. Por eso, en ese caso tampoco aparece el enlace «Solicitar un enlace nuevo» (E4.1).
- El estado inicial de la página se calcula con el `token` de la URL al montarla. Si se navegara dentro de la SPA a `/recuperar-cuenta` con otro token sin recargar, la página no se reiniciaría.

### Riesgos conocidos

- **El registro no verifica el email.** Tras un cambio de email malicioso, la dirección anterior queda libre y cualquiera puede registrar una cuenta con ella. La finalización respondería entonces `email_taken`, y un OWNER tendría que corregir el destino tras verificar la identidad del titular. Como `securityRecoveryEmail` no es único, la comprobación de que el destino no es el email de otra cuenta se hace al corregirlo, al reenviar y al finalizar, no de forma permanente.
- **`suspend` borra el token obligatorio.** Suspender una cuenta borra todos sus tokens de recuperación. Al retirar la suspensión, la obligación sigue activa pero sin token: un OWNER tiene que reenviar el enlace (E2.5f).
- **Caducidad de 1 hora.** Si el titular no usa el enlace a tiempo, puede pedir otro (E2.6) una vez pasado el enfriamiento de 15 minutos, o un OWNER puede reenviarlo.
- **Concurrencia entre procesos (SQLite).** Las garantías se basan en escrituras condicionales dentro de transacciones. Con varias instancias de la API, SQLite puede devolver `SQLITE_BUSY`, que hoy acaba en 500 sin reintento. Las pruebas usan un único cliente de Prisma (ver el otro documento, sección 9).
- **Un destino compartido solo lo puede restaurar una cuenta.** Varias cuentas pueden tener el mismo `securityRecoveryEmail` y recibir cada una su enlace, pero cuando la primera completa, esa dirección pasa a ser su `User.email`; las demás reciben `email_taken` al finalizar y necesitan que un OWNER corrija su destino (demostrado en el bloque 12).
- **Tiempo de respuesta de la solicitud del titular (limitación aceptada).** El cuerpo, el código y las cabeceras son idénticos y el correo no se espera, pero la búsqueda y las transacciones solo se ejecutan para las cuentas que coinciden y cumplen las condiciones, así que quedan diferencias de tiempo pequeñas que no se ocultan. El límite por IP del plugin vive en la memoria de cada proceso. `forgot-password` sigue esperando al SMTP (fuga de tiempo previa, fuera de E2.6).
- **Envíos en segundo plano.** Sobreviven al final de la petición y a un cierre ordenado, pero no a una caída brusca del proceso (ver sección 4); no hay cola ni outbox duraderos.
- **Distinción por texto en la web.** Si cambiaran los mensajes de la API, la web dejaría de distinguir `invalid_token` y `state_mismatch` y los trataría como errores reintentables, y el login dejaría de mostrar el enlace a `/recuperar-cuenta/solicitar` (sin otro efecto: el error se seguiría mostrando).

## 9. Migración

E2 incluye dos migraciones en `apps/api/prisma/migrations/`, que se aplican en este orden.

**`20261102090000_add_security_recovery_fields` (E2.1).** Solo añade columnas (`ADD COLUMN`): las nuevas son nulas, salvo `PasswordResetToken.purpose`, que es `NOT NULL DEFAULT 'SELF_SERVICE'`, de modo que los tokens ya emitidos siguen siendo de autoservicio.

**Estado: aplicada a `apps/api/dev.db` el 2026-11-02**, con copia de seguridad previa. En una base sin esta migración, el código actual falla al leer o escribir esas columnas (por ejemplo, el login).

**`20261103120000_admin_audit_optional_actor` (actor opcional de la auditoría).** Hace que `AdminAuditLog.actorUserId` admita NULL. SQLite no permite quitar `NOT NULL` con `ALTER COLUMN`, así que la tabla se reconstruye: misma definición salvo esa columna, copia de todas las filas, sustitución y recreación de los dos índices. Antes de aplicarla se verificó en una base temporal (no en `dev.db`) que conserva las filas, los índices y las demás restricciones, y que su SQL coincide con el que genera `prisma migrate diff`.

**Estado: aplicada a `apps/api/dev.db` el 2026-11-04**, con copia de seguridad previa. Tras aplicarla, `prisma migrate status` indica que el esquema está al día, `actorUserId` admite NULL, los 15 registros de auditoría existentes y las demás tablas conservan sus datos, se mantienen los dos índices y las demás restricciones, y `PRAGMA integrity_check` es correcto. En una base sin esta migración, la solicitud del titular (E2.6) no puede guardar su auditoría sin actor: la transacción se revierte y no se emite el enlace, aunque la respuesta siga siendo la genérica.

Para aplicar estas migraciones en otra base se siguen los mismos pasos que en el otro documento, sección 7.

## 10. Pendiente

- Que la API devuelva un código de error además del mensaje, para que la web no dependa del texto.

Los botones del panel para retirar la protección, corregir el destino y reenviar el enlace, y la indicación de que una cuenta tiene la recuperación pendiente, ya están disponibles (R1 y R2; ver [Gestión desde el panel de administración](#gestión-desde-el-panel-de-administración-r1-y-r2)).
