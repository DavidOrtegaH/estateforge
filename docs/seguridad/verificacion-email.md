# Verificación del email (Fase 0)

Una cuenta nueva confirma con un enlace que su email es suyo antes de usar EstateForge. Las cuentas que ya existían siguen entrando durante un periodo de gracia configurable. `emailVerifiedAt` lo escriben la confirmación de un enlace de verificación y el cambio de email confirmado con código. La recuperación E2 lo deja vacío si cambia la dirección (apartados 5 y 6).

Este documento distingue tres niveles: lo que **hace el código**, lo que está **probado** (y con qué tipo de prueba) y las **limitaciones** conocidas. Las cuestiones abiertas están en el apartado 14.

## 1. Datos

- `User.emailVerifiedAt` (`DateTime?`): cuándo se demostró el control de la dirección actual, con un enlace de verificación o con el código del cambio de email. `NULL` si no se ha demostrado. Lo escriben tres operaciones, cada una en su transacción:
  - `consumeEmailVerificationToken`: lo rellena al confirmar un enlace de verificación;
  - `consumeEmailChangeCode`: lo rellena al confirmar un cambio de email con el código enviado a la dirección nueva (decisión D1, apartado 5);
  - `consumeSecurityRecoveryToken`: lo deja en `NULL` si la recuperación E2 cambia la dirección y lo conserva si no la cambia (decisión D2, apartado 6).
  - No guarda la dirección, pero ningún flujo cambia el email sin una de estas tres escrituras: si tiene valor, corresponde a la dirección actual.
- `User.emailVerificationSentAt` (`DateTime?`): cuándo se emitió el último enlace. Lo reserva la emisión con una escritura condicional atómica (apartado 8).
- `EmailVerificationToken`: un registro por enlace emitido.
  - Guarda solo el SHA-256 del token (`tokenHash`, único), nunca el token.
  - Guarda el email al que se envió (`email`), su caducidad (`expiresAt`), cuándo se usó o invalidó (`usedAt`) y cuándo se creó (`createdAt`).
  - Al emitir un enlace nuevo se borran los tokens de esa cuenta creados hace más de 7 días, que ya han caducado (la validez máxima es de 168 horas). No hay limpieza periódica: los tokens de una cuenta que no vuelve a pedir enlace se conservan.
- Migración: `apps/api/prisma/migrations/20261106090000_add_email_verification`.
  - Es aditiva: dos columnas nuevas en `User` y una tabla nueva. No modifica ni borra datos.
  - Las cuentas existentes quedan con `emailVerifiedAt = NULL` y `emailVerificationSentAt = NULL`.

## 2. Política, periodo de gracia y avisos

Código: `readEmailVerificationPolicy` y `emailAccess` en `apps/api/src/services/email-verification.service.ts`. Las cuentas se distinguen por su fecha de alta (`User.createdAt`), sin marcar nada en la base de datos.

| Variable (`apps/api/.env`) | Significado |
|---|---|
| `EMAIL_VERIFICATION_REQUIRED_FROM` | Fecha ISO 8601 con zona horaria. Las cuentas creadas en ese instante o después son **nuevas**; las creadas antes son **existentes**. Vacía o sin definir: la verificación no se exige a nadie (`NOT_ENFORCED`). |
| `EMAIL_VERIFICATION_GRACE_UNTIL` | Fecha ISO 8601 con zona horaria. Hasta ese instante (sin incluirlo), las cuentas existentes sin verificar pueden seguir entrando. Desde ese instante, se les exige igual que a las nuevas. Vacía o sin definir: el periodo de gracia no termina. Requiere `EMAIL_VERIFICATION_REQUIRED_FROM` y no puede ser anterior a ella (sí igual). |
| `EMAIL_VERIFICATION_TOKEN_TTL_HOURS` | Validez del enlace en horas: un número entero de 1 a 168. Vacía o sin definir: 24. |

**Validación.** La política se lee al registrar las rutas de autenticación y en cada comprobación de acceso. Una configuración no válida detiene el arranque de la API.
- Solo se aceptan fechas ISO 8601 completas, con la hora y la zona horaria obligatorias (`Z` o `±hh:mm`, de −12:00 a +14:00). Ejemplos: `2026-12-01T00:00:00Z` y `2026-12-01T09:00:00+01:00`.
- Se rechazan las fechas que no existen en el calendario (como el 31 de febrero o el 29 de febrero de un año no bisiesto), el mes 0 o 13, el día 0, la hora 24 o más, los minutos o segundos 60, los desplazamientos fuera de rango, las fechas sin zona horaria y los formatos regionales.
- Cada fecha se interpreta como el instante UTC que representa, y el orden entre las dos fechas se compara por ese instante.

**Estados** que calcula `emailAccess` en el instante actual, en este orden:

| Estado | Condición | Acceso | Aviso en la web |
|---|---|---|---|
| `VERIFIED` | `emailVerifiedAt` tiene valor (se evalúa primero) | Sí | No |
| `NOT_ENFORCED` | Sin verificar y sin `EMAIL_VERIFICATION_REQUIRED_FROM` | Sí | No |
| `GRACE` | Sin verificar, `createdAt` anterior a `EMAIL_VERIFICATION_REQUIRED_FROM` y el instante actual anterior a `EMAIL_VERIFICATION_GRACE_UNTIL` (o sin esa fecha) | Sí | Sí: indica la fecha límite, si la hay, y permite pedir el enlace |
| `REQUIRED` | Sin verificar y, o bien `createdAt` igual o posterior a `EMAIL_VERIFICATION_REQUIRED_FROM`, o bien cuenta existente con el instante actual igual o posterior a `EMAIL_VERIFICATION_GRACE_UNTIL` | No: la API cierra la sesión | No llega a la interfaz autenticada |

**Límites temporales** (probados en `email-verification.service.test.ts`, con dobles de Prisma):
- Una cuenta creada exactamente en `EMAIL_VERIFICATION_REQUIRED_FROM` ya es nueva.
- Exactamente en `EMAIL_VERIFICATION_GRACE_UNTIL`, la cuenta existente pasa a `REQUIRED`; un milisegundo antes sigue en `GRACE`.
- Si `EMAIL_VERIFICATION_REQUIRED_FROM` está en el futuro, todas las cuentas sin verificar creadas hasta ese momento son existentes: su estado es `GRACE` y la web les muestra el aviso.

`/me` devuelve `emailVerification: { status, graceUntil }` con `status` igual a `VERIFIED`, `NOT_ENFORCED` o `GRACE`. `graceUntil` solo tiene valor en `GRACE` con fecha de fin. Con `REQUIRED`, `/me` responde `403` y no incluye el usuario.

**Puesta en marcha recomendada:**
1. Aplicar la migración y desplegar con las dos fechas vacías (`NOT_ENFORCED`). Nada cambia para los usuarios ni aparece ningún aviso. Las cuentas nuevas reciben el enlace por correo y pueden verificar si quieren.
2. Fijar `EMAIL_VERIFICATION_REQUIRED_FROM`, por ejemplo al momento del despliegue, y `EMAIL_VERIFICATION_GRACE_UNTIL`, por ejemplo un mes después.
   - Desde ese momento, las cuentas nuevas deben verificar antes de entrar.
   - Las existentes sin verificar ven el aviso con la fecha límite.
3. Al llegar la fecha de fin de gracia, las cuentas existentes sin verificar dejan de entrar. Pueden pedir un enlace nuevo desde el login.

## 3. Flujos

- **Registro** (`POST /api/auth/register`): crea la cuenta sin verificar y lanza la emisión y el envío del enlace en segundo plano, en todos los estados de la política.
  - Si la cuenta nueva queda en `REQUIRED`, **no abre sesión** y responde `201 { verificationRequired: true, email, message }`.
  - Si no, abre sesión como antes y responde `201 { user }`.
  - El mensaje «Te hemos enviado un enlace…» se devuelve sin esperar al envío (apartado 7).
- **Verificación** (`POST /api/auth/verify-email`, cuerpo `{ token }`): consume el token y marca el email como verificado, en una sola transacción.
  - Responde `200` si lo verifica; `400` con `code: EXPIRED` si caducó; y `400` con `code: INVALID` si no existe, ya se usó, está manipulado, el email de la cuenta ya no es el del token, o la cuenta está protegida, suspendida o en recuperación obligatoria (E2).
  - **No inicia sesión**: verificar el email no es una forma de autenticarse.
  - La página `/verificar-email?token=…` solo envía el token cuando el titular pulsa «Verificar mi email», para que un escáner de enlaces del correo no lo consuma al abrir la página.
- **Reenvío** (`POST /api/auth/verify-email/resend`, cuerpo `{ email }`): busca la cuenta por email y, si existe, lanza la emisión en segundo plano. La respuesta es siempre la misma (apartado 9).
  - La emisión decide si la cuenta puede recibir un enlace (sin verificar, sin estados de E2 y dentro de los límites). Si lo emite, invalida los enlaces anteriores sin usar.
- **Acceso sin verificar** (`REQUIRED`). Las tres comprobaciones aplican la misma regla (`emailAccess`), después de los estados de E2:
  - el login responde `403 { code: EMAIL_NOT_VERIFIED, message }`, solo después de comprobar la contraseña;
  - `/me` y las rutas de cuenta de `auth.routes.ts` (`getAuthenticatedUser`) borran todas las sesiones de la cuenta, borran la cookie y responden igual;
  - `requireAuth` (`getUserIdFromSession`) borra la sesión usada y responde el `401` genérico «Se requiere una sesión activa.», sin código: la web solo conoce el motivo cuando vuelve a consultar `/me`.

## 4. Seguridad de los enlaces

- **Tokens:** 32 bytes de `crypto.randomBytes` en hexadecimal. Solo se guarda su SHA-256. El formato se valida antes de buscarlos.
- **Destinatario:** el correo se envía al email guardado en el registro del token, que es el que tenía la cuenta al emitirlo; no se vuelve a consultar la cuenta. Si la cuenta desaparece durante la emisión, no se envía nada.
- **Vinculación al email:** el consumo exige que el email actual de la cuenta coincida con el del token. Si no coincide, responde `INVALID` sin gastar el token (apartado 5).
- **Uso único:** el token se reclama con una actualización condicional (`usedAt: null` y sin caducar). Al verificar, todos los enlaces pendientes de la cuenta dejan de servir.
- **Verificación efectiva:** la cuenta se marca con otra actualización condicional: email del token, `emailVerifiedAt` vacío y sin estados de E2.
  - Si no afecta a la cuenta (`count = 0`), solo se responde «verificado» cuando otra operación ya la verificó con el mismo email y la cuenta sigue usable.
  - Si no, el servicio lanza `ConsumeAbort`: la transacción se deshace por completo, incluida la reclamación del token, y se responde `INVALID`. Este rollback está demostrado con SQLite real (apartado 11).
- **CSRF:** los dos endpoints nuevos no usan la sesión ni la cookie.
  - En la verificación solo actúa quien tiene el token.
  - El reenvío solo puede provocar un correo al titular, con los límites del apartado 8.
  - Ambos aceptan únicamente JSON, como el resto de la API.
- **Registros:** un fallo de envío se registra sin el token ni el enlace.

## 5. Cambio de email y `emailVerifiedAt`

Código: rutas `POST /api/auth/change-email/request` y `POST /api/auth/change-email/verify` en `apps/api/src/routes/auth.routes.ts`, y `apps/api/src/services/email-change.service.ts`.

**Qué comprueba el cambio de email:**
- **Solicitud:** exige una sesión válida (`getAuthenticatedUser`, así que una cuenta en `REQUIRED` no puede pedirlo) y la contraseña actual.
  - Rechaza un email igual al actual (`400`) o que ya pertenezca a otra cuenta (`409`).
  - Genera un código de 6 dígitos, válido 10 minutos, que sustituye a los códigos pendientes.
  - Envía el código a la **dirección nueva** y un aviso a la **dirección actual**.
- **Confirmación:** la misma sesión introduce el código. En una transacción (`consumeEmailChangeCode`), el servicio:
  - comprueba que el código existe, es de la cuenta, no se ha usado y no ha caducado, y que la dirección nueva sigue libre;
  - reclama el código con una escritura condicional;
  - **cambia `User.email` y pone `emailVerifiedAt` = ahora** en la misma escritura;
  - marca como usados los enlaces de verificación **pendientes** (los ya usados no se tocan);
  - y borra los códigos de cambio.

  Si cualquier paso falla, la transacción se deshace entera, así que no puede quedar el email cambiado sin la verificación o sin la invalidación.
  - **Dirección ocupada durante la escritura** (otra cuenta la toma entre la comprobación previa y el `UPDATE`): el servicio aborta la transacción y responde `email_taken` (`409`). El código no queda consumido por ese intento y se puede volver a usar si se resuelve el conflicto (corrección F0-003).
  - Las salidas con `invalid` (código inexistente, ajeno, usado o caducado) y la de `email_taken` por la comprobación previa no han escrito nada antes de responder.
  - Cualquier otro error se propaga y también deshace la transacción.
  - Es el único momento en que cambia el email por esta vía.
  - Tras el cambio, la dirección anterior recibe un aviso con un enlace para denunciar un cambio no reconocido ([protección por incidente](proteccion-por-incidente.md)). Si ese aviso falla, el cambio se mantiene y la respuesta lo indica (apartado 7).

**Qué demuestra el código:** que quien tiene la sesión y la contraseña controlaba la dirección nueva en ese momento. Por eso el cambio confirmado **cuenta como verificación** de la dirección nueva (decisión D1 de la Fase 0).

**Qué pasa con la verificación al cambiar el email** (integración con SQLite real, sección 14, «decisiones de producto»):

| Situación | Resultado | Prueba |
|---|---|---|
| La cuenta estaba verificada | `emailVerifiedAt` pasa a ser el instante del cambio | D1.a |
| La cuenta no estaba verificada | Queda verificada con la dirección nueva (`VERIFIED`) y deja de ver el aviso de gracia | D1.a |
| Enlaces pendientes | Quedan usados en el mismo instante; ya no verifican | D1.a |
| Enlaces ya usados | No cambian | D1.a |
| Código incorrecto o caducado | No cambia el email, la verificación ni los enlaces | D1.b |
| Fallo dentro de la transacción | `ROLLBACK` real: el email, la verificación, los enlaces y el código quedan como estaban | D1.c |
| Otra cuenta ocupa la dirección durante la escritura (P2002 real, provocado con un trigger temporal) | `email_taken` con `ROLLBACK` real; la cuenta, los enlaces y el código quedan intactos, y el mismo código sirve después | D1.d |
| El enlace antiguo se consume **antes** del cambio | Verifica y después el cambio vuelve a fechar `emailVerifiedAt` con la dirección nueva | 14.i, «verificación primero» |
| El cambio se completa **antes** de consumir el enlace antiguo | El enlace ya está invalidado y responde `INVALID` | 14.i, «cambio primero» |
| `emailVerificationSentAt` | No cambia | — |

**Qué significa el estado tras un cambio de email:** `VERIFIED` indica que se demostró el control de la dirección actual, con el enlace o con el código del cambio.

## 6. Relación con E2 y con los demás estados de la cuenta

Son cuatro mecanismos independientes, cada uno con su campo:

| Mecanismo | Campo | Detalle |
|---|---|---|
| Verificación ordinaria del email | `emailVerifiedAt` y la política del apartado 2 | Este documento |
| Protección por incidente | `securityHoldAt` | [Protección por incidente](proteccion-por-incidente.md) |
| Suspensión administrativa | `adminSuspendedAt` | [Protección por incidente, apartado 1](proteccion-por-incidente.md#1-dos-estados-independientes) |
| Recuperación obligatoria (E2) | `passwordResetRequiredAt` y `securityRecoveryEmail` | [Recuperación obligatoria](recuperacion-obligatoria.md) |

**Efecto sobre la verificación.** Mientras `securityHoldAt`, `adminSuspendedAt` o `passwordResetRequiredAt` tengan valor:
- no se emite ningún enlace de verificación (el reenvío responde lo mismo, sin enviar);
- y los enlaces ya emitidos responden `INVALID` sin gastarse.

Los tres estados tienen prioridad sobre la verificación en el login (`423`), en `/me` y en las sesiones. Mientras están activos no modifican `emailVerifiedAt`. Al levantar una suspensión, los enlaces pendientes que no hayan caducado vuelven a servir (apartado 14).

**Finalización de E2.** `consumeSecurityRecoveryToken` (`apps/api/src/services/password-reset.service.ts`), en una sola transacción:
- reclama el token `SECURITY_RECOVERY`;
- cambia la contraseña;
- **pone `User.email` = `deliverTo`**, el destino de recuperación guardado en `securityRecoveryEmail`. La escritura condicional incluye el email leído, así que la comparación de la línea siguiente sigue siendo cierta al escribir;
- **verificación del email** (decisión D2):
  - si `deliverTo` es el email que tenía la cuenta, **conserva** `emailVerifiedAt`, tenga valor o sea `NULL`;
  - si es otra dirección, lo deja en **`NULL`**;
- vacía `passwordResetRequiredAt` y `securityRecoveryEmail`;
- borra las sesiones, los tokens de recuperación pendientes y los cambios de email pendientes;
- **marca como usados todos los enlaces de verificación pendientes** (los ya usados no se tocan);
- y lo registra en la auditoría ([detalle](recuperacion-obligatoria.md#6-finalización-de-la-recuperación)).

**Pruebas** (integración con SQLite real, sección 14, «decisiones de producto»):
- **D2.a:** misma u otra dirección, cuenta verificada o no:
  - se conserva o vacía `emailVerifiedAt` según la regla;
  - los enlaces pendientes quedan usados y los consumidos no cambian;
  - el enlace pendiente ya no verifica después de E2, tampoco con la misma dirección;
  - se cierran las sesiones y se audita la finalización.
- **D2.b:** un fallo dentro de la transacción la deshace por completo con un `ROLLBACK` real. La cuenta, los enlaces y el token de recuperación quedan intactos, y no hay auditoría.

**Por qué E2 no marca como verificada otra dirección.** El enlace de recuperación demuestra el control de `deliverTo`, pero sirve para recuperar la cuenta, no para la política de verificación. Además, ese destino lo puede fijar o corregir un OWNER desde el panel. Si la dirección cambia, la cuenta tiene que verificarla con el flujo ordinario.

## 7. Envío de correos y fallos de SMTP

El sistema solo sabe que el servidor SMTP **aceptó** el mensaje (la llamada de `nodemailer` termina sin error). No hay confirmación de entrega ni tratamiento de rebotes: «aceptado» no significa «recibido». Ningún flujo reintenta un envío fallido, ni hay colas persistentes. Los tokens solo se guardan como hash, así que no se podrían reenviar (decisión D5).

| Flujo | Qué se guarda antes de enviar | Envío | Si falla el SMTP | Qué ve el usuario |
|---|---|---|---|---|
| Verificación (registro y reenvío) | Token y reserva (`emailVerificationSentAt`), confirmados en la base | En segundo plano, sin esperar | Se registra el error con `console.error`, sin token ni enlace. **La reserva y el token se conservan** (decisión D5): el envío fallido cuenta para el intervalo de un minuto y para los cinco diarios. El token sigue válido hasta caducar o hasta que se emita otro. Pasado el minuto, el titular puede pedir otro | El mismo mensaje que si se hubiera enviado («Te hemos enviado un enlace…» en el registro; el mensaje genérico en el reenvío) |
| Error al emitir el token de verificación (base de datos) | Nada: la transacción se deshace | No se envía | Se registra igual, sin token | El mismo mensaje |
| Solicitud de cambio de email | El código | Se espera al código (a la dirección nueva) y al aviso (a la actual) | Se borran los códigos pendientes y responde `503`: «No se han podido enviar todos los correos de seguridad. No se ha iniciado el cambio…» | El error |
| Aviso de cambio de email completado (con el enlace de incidente) | El cambio ya está hecho | Se espera | El cambio se mantiene (decisión D4). Se registra en el log el id de la cuenta y el tipo de error, sin la dirección anterior ni el enlace. Se audita `EMAIL_CHANGE_NOTICE_FAILED` para que un OWNER lo vea (corrección F0-002, apartado 9). La respuesta lleva `securityNoticeSent: false` | `200` con «Email actualizado correctamente, pero no hemos podido enviar el aviso de seguridad a tu dirección anterior. No hace falta repetir el cambio.»; la web lo muestra como confirmación, no como error |
| `forgot-password` | Nada antes de responder: la emisión del token de autoservicio (1 hora) y el envío van en segundo plano (decisión D3) | En segundo plano | Se registra el id de la cuenta y el tipo de error. El token emitido se conserva sin usar | La misma respuesta genérica (apartado 9) |
| Solicitud pública de recuperación E2 | El token `SECURITY_RECOVERY` y la auditoría, confirmados | En segundo plano | Se registra el id de la cuenta y el tipo de error; el token se conserva | El mismo mensaje genérico |
| Recuperación E2 iniciada por un OWNER | La obligación y el token | Se espera | La operación se mantiene y responde `recoveryEmailSent: false` | El OWNER ve el aviso; [detalle](recuperacion-obligatoria.md#post-apiadminusersidrecovery-destination-y-post-apiadminusersidresend-recovery) |

Los envíos en segundo plano (verificación, `forgot-password` y recuperación E2) siguen tras la respuesta; al cerrar la API se espera a los pendientes.

## 8. Límites de envío y de peticiones

**Por cuenta**, en el servicio, específicos de cada flujo:
- **Verificación del email:** un enlace por minuto como mucho y cinco cada 24 horas.
  - La emisión empieza reservando el envío con una actualización condicional sobre la fila del usuario: `emailVerificationSentAt` vacío o de hace al menos un minuto, cuenta sin verificar y sin estados de E2. Si no la consigue, no emite (`cooldown` si la cuenta es elegible; `not_eligible` si no).
  - Con la reserva hecha, se cuentan los enlaces creados en las últimas 24 horas. Si ya hay cinco, se deshace la reserva y no se emite (`daily_limit`).
  - Estos motivos no llegan al usuario: el reenvío responde siempre lo mismo.
- **Solicitud pública de recuperación E2:** como mucho un enlace cada 15 minutos por cuenta ([detalle](recuperacion-obligatoria.md#solicitud-de-un-enlace-nuevo-por-el-titular-e26)).
- **Restablecimiento de contraseña y cambio de email:** no tienen límite por cuenta en el servicio; cada solicitud sustituye a la pendiente.

**Por IP**, en cada ruta (`@fastify/rate-limit`, registrado con `global: false`): solo tienen límite las rutas que lo declaran. Al superarlo, la API responde `429`.

| Ruta | Límite por IP | Turnstile |
|---|---|---|
| `POST /api/auth/register` | 10 por minuto | Sí |
| `POST /api/auth/login` | 10 por minuto | Sí |
| `POST /api/auth/verify-email` | 10 cada 15 minutos | No |
| `POST /api/auth/verify-email/resend` | 3 cada 15 minutos | No |
| `POST /api/auth/forgot-password` | 5 cada 15 minutos | Sí |
| `POST /api/auth/security-recovery/request` | 5 cada 15 minutos | Sí |
| `POST /api/auth/change-email/request` | 5 cada 15 minutos | No (sesión y contraseña) |
| `POST /api/auth/change-email/verify` | 10 cada 15 minutos | No (sesión) |

- `GET /api/auth/me` no tiene límite, así que la consulta que hace la web tras el login (apartado 10) no consume ninguno.
- La clave del límite es la que usa el plugin por defecto (la IP de la petición). No se ha verificado cómo se comporta detrás de un proxy.

## 9. Respuestas públicas y errores HTTP

**Respuestas genéricas** (siempre `200` con el mismo cuerpo, exista o no la cuenta):

| Ruta | Mensaje | Cuentas inexistentes, no elegibles o limitadas |
|---|---|---|
| `verify-email/resend` | «Si la cuenta existe y su email está pendiente de verificación, recibirás un enlace nuevo en unos minutos.» | Mismo mensaje. Se consulta la cuenta por email en todos los casos y la emisión va en segundo plano. No se ha medido el tiempo de respuesta. |
| `security-recovery/request` | «Si la cuenta puede recuperar el acceso, recibirás instrucciones en el destino de recuperación registrado.» | Mismo mensaje, también si falla la emisión. El correo va en segundo plano. |
| `forgot-password` | «Si la cuenta existe, recibirás instrucciones para restablecer la contraseña.» | Mismo cuerpo, código y tipo de contenido para cuentas elegibles, inexistentes y no elegibles, también si falla el SMTP o la emisión del token (`forgot-password.routes.test.ts`). La ruta consulta la cuenta en todos los casos y deja la emisión y el envío en segundo plano. No se ha medido el tiempo de respuesta, así que no se afirma que no haya diferencias. Se mantienen Turnstile y el límite de 5 cada 15 minutos por IP. |

**Auditoría:**
- La solicitud pública de recuperación E2 registra `SECURITY_RECOVERY_LINK_REQUESTED` sin actor (`actorUserId` nulo, porque quien la hace no se autentica), con la cuenta como objetivo y sin metadatos. Las solicitudes que no emiten enlace no se auditan.
- La finalización de E2 registra `SECURITY_RECOVERY_COMPLETED` con la propia cuenta como actor.
- **Aviso de cambio de email no enviado (corrección F0-002).** Si el cambio se confirma pero falla el aviso a la dirección anterior, se registra `EMAIL_CHANGE_NOTICE_FAILED`, que es el único aviso con el enlace para denunciar el cambio. El registro:
  - tiene como actor y objetivo la propia cuenta, sin motivo;
  - guarda en `metadata` solo la fase del fallo: `noticeFailure` = `INCIDENT_LINK` (no se pudo crear el enlace de incidente) o `DELIVERY` (falló el envío);
  - no guarda emails, token, enlace ni el mensaje del error;
  - aparece en la auditoría del panel con la etiqueta «Aviso de cambio de email no enviado» y la fase entre paréntesis, y se puede filtrar.

  No hay reintento automático: un OWNER que lo vea puede contactar con el titular. Si el propio registro de auditoría falla, se anota en el log y la respuesta sigue siendo la del cambio completado. Pruebas: `email-change.routes.test.ts` (con mocks) y la integración con SQLite real (sección 14, «F0-002»), que también consulta `GET /api/admin/audit` como OWNER.
- **La verificación del email no registra nada en la auditoría.**

**Errores de autenticación ordinarios**, que **no** son genéricos:
- **Login:**
  - `401` «Email o contraseña incorrectos.» si la cuenta no existe o la contraseña no es correcta;
  - tras una contraseña correcta: `423` con el mensaje de cada estado de E2, o `403 EMAIL_NOT_VERIFIED`.
- **`/me`:**
  - `401` sin sesión o con sesión no válida o caducada;
  - `423` por protección, suspensión o recuperación obligatoria, borrando las sesiones;
  - `403 EMAIL_NOT_VERIFIED` en `REQUIRED`.
- **Rutas de cuenta** (`getAuthenticatedUser`):
  - `401` sin sesión o con sesión no válida;
  - `423` por protección o recuperación obligatoria;
  - `403 EMAIL_NOT_VERIFIED`;
  - no comprueba `adminSuspendedAt`, pero la suspensión ya borra todas las sesiones de la cuenta.
- **Rutas con `requireAuth`:** `401` «Se requiere una sesión activa.» para todos los casos (sin sesión, sesión caducada o cerrada por un estado de la cuenta).
- **Panel** (`requireOwner`): además, `403` si la cuenta no es OWNER o está protegida.

## 10. Sincronización de la sesión en la web (Fase 0.3a)

Código: `apps/web/src/lib/authSession.ts` y `apps/web/src/contexts/AuthProvider.tsx`. Pruebas: `apps/web/src/lib/authSession.test.ts` (con `fetch` simulado).

- **Por qué se consulta `/me`.** Las respuestas del login y del registro con sesión traen `{ id, email, role }`, y la del cambio de email trae `{ id, email }`. Ninguna trae `emailVerification`, que solo devuelve `/me`. Tras esas operaciones, `AuthProvider` consulta `/me` **una vez** y guarda ese usuario. Así el aviso de `GRACE` aparece sin recargar la página y, tras un cambio de email, el usuario recupera también `role`.
- **Cuándo se consulta:**
  - después de un login correcto;
  - después de un registro que abre sesión (`kind: 'session'`);
  - después de un cambio de email confirmado.
- **Cuándo no se consulta:** si la operación falla (incluido el `403 EMAIL_NOT_VERIFIED` del login) o si el registro no abre sesión (`verification_required`).
- **Si `/me` falla** (error del servidor, red, `401` o `403`):
  - se conserva el usuario devuelto por la operación, que ya ha tenido éxito, y el fallo se registra en la consola sin datos de la cuenta;
  - ni la operación se presenta como fallida ni el usuario pasa a `null`;
  - tras un cambio de email, ese usuario no trae `role` (apartado 14).
- **Cambio de email y aviso fallido (decisión D4).** `updateEmail` devuelve `{ user, securityNoticeSent }`.
  - La página de la cuenta muestra «Email actualizado correctamente a …» y, si `securityNoticeSent` es `false`, añade que no se pudo enviar el aviso a la dirección anterior y que no hace falta repetir el cambio.
  - Una respuesta sin el campo (de una API anterior) se trata como aviso enviado.
- No hay reintentos, temporizadores ni consultas periódicas: `/me` se vuelve a leer solo al cargar la aplicación o tras estas operaciones.

## 11. Concurrencia y transacciones: qué está demostrado y qué no

Pruebas de integración con SQLite real en una base temporal: `apps/api/src/integration/security-hold-version.integration.test.ts`, sección 14.

- **Operaciones simultáneas.** El helper `runConcurrently` lanza las operaciones a la vez (varias emisiones o varios consumos), como harían varias peticiones a la API.
- **Serialización.** El adaptador `@prisma/adapter-libsql` serializa las transacciones de un mismo cliente con un *mutex*, que se mantiene desde `startTransaction` hasta el COMMIT o el ROLLBACK. Según el código del adaptador, las consultas fuera de transacción (`queryRaw` y `executeRaw`, mediante `performIO`) adquieren ese mismo *mutex*. Ninguna prueba lo mide.
  - En las pruebas, el máximo de conexiones dedicadas abiertas a la vez fue **uno**, y se comprueba en cada escenario. Como cada transacción usa una conexión dedicada, es coherente con la serialización observada.
  - Se demuestra el resultado de negocio con la serialización que aplica la API, **no** un entrelazado de transacciones dentro de SQLite.
  - El test sustituye la conexión de cada transacción por una conexión SQLite dedicada, con BEGIN, COMMIT y ROLLBACK reales. El *mutex* es el del adaptador real. No se prueba el ciclo de vida de la transacción nativa de libsql.
- **Errores técnicos.** Cualquier rechazo (`SQLITE_BUSY`, bloqueo, conexión, excepción inesperada) hace fallar la prueba: no cuenta como rechazo de negocio.
- **Escenarios y resultados exigidos:**

  | Escenario | Lanzadas | Resultado de negocio |
  |---|---|---|
  | Emisiones simultáneas | 5 | 1 emitida y 4 `cooldown`; un solo token |
  | Emisiones con 4 envíos previos | 4 | 1 emitida y 3 `cooldown`; después, `daily_limit` sin dejar la reserva |
  | Consumos del mismo token | 3 | 1 `verified` y 2 `invalid`; verificado una vez |
  | Consumo y cambio de email reales | 2 (en los dos órdenes) | En los dos órdenes, la cuenta queda verificada con la dirección nueva y el enlace usado (apartado 5) |

  En todos se comprueban el estado final en la base, la ausencia de efectos parciales y que cada operación abrió una sola transacción, sin reintentos.
- **Rollback del cambio de email y de la finalización de E2**, también con SQLite real (D1.c y D2.b): un trigger temporal hace fallar la invalidación de los enlaces y la transacción termina con un `ROLLBACK` real, sin ninguna escritura.
- **Rollback del cambio de email ante un P2002 real (D1.d, F0-003):** un trigger temporal inserta otra cuenta con la dirección nueva dentro del `UPDATE`; la transacción termina con un `ROLLBACK` real, incluida la reclamación del código.
- **Rollback de `ConsumeAbort`, demostrado con SQLite real (14.h):**
  - un trigger temporal hace que la escritura de `emailVerifiedAt` no afecte a ninguna fila, solo si la reclamación del token ya se ha escrito en la misma transacción;
  - el servicio responde `INVALID` y la transacción termina con un `ROLLBACK` real;
  - después, el token sigue sin usar y la cuenta queda igual que antes;
  - sin el trigger, el mismo token verifica.
- **Pruebas unitarias** (`email-verification.service.test.ts`, con dobles de Prisma): comprueban la lógica de decisión (reserva, recuento, `count` de cada actualización y que se lance `ConsumeAbort`). **No demuestran** la atomicidad ni la concurrencia.

| Entorno | Situación |
|---|---|
| SQLite con Prisma 7.9.1, un proceso | Demostrado como se describe arriba. |
| Varios procesos o instancias de la API sobre el mismo fichero SQLite | **No probado.** Con dos clientes sí podría haber transacciones simultáneas y errores de bloqueo de SQLite; no se sabe qué respondería la API. |
| PostgreSQL | **No probado, y con un riesgo conocido (F0-001, pendiente).** El diseño se apoya en que, en `READ COMMITTED`, una segunda actualización sobre la misma fila espera al bloqueo de la primera y vuelve a evaluar su condición. Pero el consumo del enlace escribe primero el token y después la cuenta, mientras que el cambio de email y la finalización de E2 escriben primero la cuenta y después los tokens (también la emisión, respecto al consumo). Con transacciones simultáneas, PostgreSQL podría detectar un *deadlock* y abortar una de ellas: el estado no quedaría inconsistente, pero esa petición fallaría. Hay que unificar el orden y probarlo antes de migrar. Pasar las pruebas con SQLite no demuestra que funcione con PostgreSQL. |

## 12. Compatibilidad

- **Política de contraseñas, sesiones (formato, duración y cookie), recuperación de contraseña y E2:** sin cambios de comportamiento.
- **Formulario de registro de la web:** aplica la misma política que el servidor: de 12 a 128 caracteres, con minúscula, mayúscula, número y carácter especial.
- **Prioridad:** los estados de E2 (protección, suspensión y recuperación obligatoria) van por delante de la verificación del email, en el login y en las sesiones.
- **Recuperación de contraseña:** una cuenta sin verificar puede pedirla y completarla. Si después la verificación se le exige, tendrá que verificar el email para entrar.

## 13. Cómo probar el envío real

Las pruebas automáticas no envían correos: sustituyen `emailService`. Para probar el envío con el SMTP configurado (Brevo):
1. Aplicar la migración a la base de desarrollo: `pnpm --filter api exec prisma migrate deploy`. Generar el cliente: `pnpm --filter api exec prisma generate`.
2. Con `EMAIL_VERIFICATION_REQUIRED_FROM` en una fecha pasada, registrar una cuenta de prueba con un buzón propio. Comprobar que no se abre sesión y que llega el correo «EstateForge — Verifica tu email».
3. Abrir el enlace, pulsar «Verificar mi email» e iniciar sesión.
4. Volver a abrir el mismo enlace: debe responder que no es válido o que ya se ha usado.
5. Pedir un enlace nuevo desde el login antes de un minuto: no llega otro correo. Pasado el minuto, llega uno nuevo y el anterior ya no sirve.
6. Con una cuenta creada antes de `EMAIL_VERIFICATION_REQUIRED_FROM` y la gracia abierta, iniciar sesión y comprobar que el aviso aparece sin recargar. Después, con `EMAIL_VERIFICATION_GRACE_UNTIL` en el pasado, comprobar que se cierra la sesión y que el login pide verificar.
7. Con las dos fechas vacías, comprobar que no aparece ningún aviso.

## 14. Decisiones tomadas y cuestiones pendientes

Decisiones de producto aplicadas (Fase 0):
- **D1.** El cambio de email confirmado con código verifica la dirección nueva e invalida los enlaces pendientes (apartado 5).
- **D2.** La finalización de E2 conserva la verificación si la dirección no cambia, la vacía si cambia e invalida los enlaces pendientes (apartado 6).
- **D3.** `forgot-password` emite y envía en segundo plano, con la respuesta genérica en todos los casos (apartados 7 y 9). Antes esperaba al SMTP y un fallo respondía `500` solo para las cuentas elegibles.
- **D4.** Si falla el aviso del cambio de email completado, el cambio se mantiene y se comunica al usuario (apartados 7 y 10).
- **D5.** Un envío de verificación fallido sigue consumiendo el intervalo y la cuota diaria; no hay reintentos (apartado 7). El registro sigue anunciando el envío sin saber si se ha hecho.

Correcciones de la auditoría aplicadas:
- **F0-002.** El fallo del aviso del cambio de email queda auditado (`EMAIL_CHANGE_NOTICE_FAILED`) y visible en el panel (apartado 9).
- **F0-003.** Un conflicto de unicidad al cambiar el email aborta la transacción sin gastar el código (apartado 5).

Cuestiones pendientes:
1. **Enlaces pendientes tras levantar una suspensión.** `unsuspend` no invalida los enlaces de verificación: si no han caducado, vuelven a servir. No se ha decidido.
2. **Tiempo de respuesta de `forgot-password`.** No se ha medido (apartado 9).
3. **Orden de bloqueos para PostgreSQL (F0-001).** Hay que unificar el orden de escritura de la cuenta y de los tokens, y probarlo con PostgreSQL antes de migrar (apartado 11).
4. **Otras observaciones de la auditoría (F0-004 a F0-007):** sin aplicar.
   - el orden de llegada de dos correos de `forgot-password` seguidos;
   - la espera sin plazo a los envíos al cerrar la API;
   - la falta de pruebas de componentes de la web;
   - la confirmación repetida de un cambio de email ya hecho, que responde que el código no es válido.

Hallazgos en el código, fuera del alcance de esta fase (sin corregir):
1. **La confirmación del cambio de email responde `user` sin `role`.** Si falla la consulta a `/me` posterior (apartado 10), el usuario del contexto queda sin `role` hasta recargar.
2. **`requireAuth` responde un `401` genérico** cuando cierra una sesión por el estado de la cuenta. La web no muestra el motivo hasta que vuelve a consultar `/me`.
3. **`getAuthenticatedUser` no comprueba `adminSuspendedAt`.** La suspensión administrativa elimina todas las sesiones de la cuenta, y el análisis realizado no ha encontrado ninguna forma de aprovechar esa ausencia. Se deja como observación pendiente, no como vulnerabilidad demostrada.

## 15. PostgreSQL

- **El código está pensado para ser portable:**
  - solo usa operaciones de Prisma (`findUnique`, `count`, `updateMany`, `create`, `deleteMany` y transacciones interactivas), sin SQL propio;
  - las fechas se comparan como `DateTime`;
  - los límites y el uso único se apoyan en actualizaciones condicionales.
- **No se ha probado con PostgreSQL** (apartado 11).
- **Lo único específico de SQLite es el SQL de la migración** (tipo `DATETIME`). Al pasar a PostgreSQL se generará el esquema con el proveedor nuevo, como el resto de migraciones.
