# Fase 0 — Checklist y procedimiento de despliegue (v6)

> **Este documento no autoriza ninguna integración ni despliegue, y no está aprobado para producción.** Describe las condiciones, la secuencia y las comprobaciones que deben cumplirse antes de que el propietario del producto lo autorice expresamente. Todas las casillas están sin marcar: ninguna comprobación se ha ejecutado todavía.
>
> La v6 sustituye como referencia documental a `revision/fase0_checklist_despliegue_v5.md`. La v5, la v4 (`revision/fase0_checklist_despliegue_v4.md`), la v3 (`revision/fase0_checklist_despliegue_v3.md`), la v2 (`revision/fase0_checklist_despliegue_v2.md`) y la v1 (`revision/fase0_checklist_despliegue.md`) se conservan sin cambios.
>
> La v6 corrige las observaciones de la auditoría de la v5 (dos de gravedad alta, dos medias y nueve bajas) e incorpora las correcciones derivadas de las auditorías independientes y las tres rondas de revisión documental de la v6, sin cambiar los criterios técnicos ni las autorizaciones. El apartado 1.1 conserva los cambios de la v4 a la v5, y el 1.2 recoge los de la v6. Los de versiones anteriores están en cada versión.

Leyenda de roles:
- **PP:** propietario del producto, que autoriza.
- **RT:** responsable técnico.
- **OD:** operador del despliegue.
- **OW:** cuentas OWNER.
- **QA:** quien ejecuta las pruebas manuales, que puede ser el RT.

Convenciones:
- **☐** marca una comprobación o acción pendiente. Ninguna está marcada.
- **«Detener si»** indica cuándo se interrumpe el procedimiento. Detenerse significa no pasar al paso siguiente e informar al RT y al PP. Si el paso ya ha cambiado algo en producción, se aplica el apartado 10. Si lo que ha fallado es la migración, se aplica «Si falla la migración», en el apartado 6.6, porque el apartado 10 no define ninguna reversión de la base.
- **L-n** son limitaciones pendientes y **PR-n** son requisitos previos de código futuro (apartado 11.2). Una limitación **no** se convierte en una casilla que se pueda marcar, y **cada una se trata solo según su regla propia** (apartado 11.2):
  - **L-2 no se puede aceptar ni dispensar:** ninguna decisión administrativa puede hacerlo. **L-2 solo se cierra cuando se acredita el conjunto completo de evidencias definido en el apartado 9.5. GA es obligatoria, pero no suficiente por sí sola.** El conjunto es:
    1. E1: el valor configurado y verificado;
    2. E2: el arranque de cada proceso con la configuración autorizada;
    3. E3: la comprobación funcional individual de cada instancia;
    4. E4: el inventario y el historial de instancias;
    5. GA: la garantía real de admisión antes de recibir tráfico;
    6. el mecanismo de acceso a la instancia retenida para ejecutar E3;
    7. la cobertura acreditada de todas las formas de incorporación de instancias;
    8. el ensayo documentado y representativo de producción.

    E1–E4 por sí solos no cierran L-2, y GA aislada tampoco. Un cambio de código puede contribuir, pero no la cierra por sí solo. **L-2 sigue abierta mientras falte cualquiera de las evidencias**, y mientras siga abierta **no se autoriza la activación ni el fin de la gracia** (apartado 12).
  - **L-3 es una condición de parada,** no una limitación que se pueda aceptar. Se resuelve con C3, C4 y S15: si alguna falla, se detiene el procedimiento.
  - **L-1** solo puede **aceptarse expresamente** por el PP, por separado para la activación y para el fin de la gracia (apartado 12).
  - **L-4 y L-5** se tratan según su regla propia: L-4, con su aceptación por el PP en la integración (apartado 7.1) y la prevención del apartado 5; L-5, con una decisión documentada del PP sobre la migración (apartado 6.5).
  - Las limitaciones distintas de L-2 pueden **eliminarse** con un cambio futuro que se pruebe y se autorice aparte. **Para L-2**, un cambio de código podría contribuir si implementa un mecanismo real de admisión de instancias, pero **por sí solo no la cierra**. Solo la cierra el conjunto de evidencias del apartado 9.5. **Conocer una limitación no es aceptarla.**
- **Aceptar una limitación no es autorizar una etapa.** La aceptación de L-1 es una condición previa de la autorización correspondiente del apartado 12, no la sustituye.
- Se distinguen cuatro tipos de resultado:
  - una **comprobación diagnóstica**, que aporta información pero no demuestra nada por sí sola;
  - una **anomalía**, que obliga a investigar antes de seguir;
  - una **condición de parada**, que impide continuar;
  - y una **garantía que el código no proporciona**, que se trata como limitación.

## 1. Objetivo y alcance

**Objetivo operativo:** desplegar la Fase 0 y activar la verificación del email de forma controlada y reversible. La Fase 0 incluye:
- la verificación del email;
- las decisiones D1 a D5;
- y las correcciones F0-002 y F0-003.

Al hacerlo, se busca:
- **minimizar el riesgo de pérdida de datos**, con una copia de seguridad previa, cuya restauración se haya comprobado, y una migración aditiva;
- **minimizar la indisponibilidad**, coordinando el orden de los cambios;
- **evitar bloqueos indebidos** de cuentas legítimas, OWNER incluidos.

Son objetivos, no garantías. Este documento **no demuestra**:
- que sea posible desplegar sin ninguna interrupción;
- que ningún cliente con la web antigua quede bloqueado (limitación L-1);
- que todas las instancias en servicio, incluidas las creadas o sustituidas por la plataforma, apliquen la misma configuración, ni que ninguna atienda peticiones antes de comprobarla (limitación L-2);
- ni que se pueda comprobar que la copia de seguridad contiene todos los datos de producción en su instante, si la API antigua sigue escribiendo (limitación L-5).

Los riesgos y las limitaciones que siguen abiertos están en el apartado 11.

**Alcance:**
- el despliegue con SQLite (`@prisma/adapter-libsql`);
- el orden copia de seguridad → migración → web → API;
- la configuración de `EMAIL_VERIFICATION_REQUIRED_FROM` y `EMAIL_VERIFICATION_GRACE_UNTIL`;
- las condiciones para las cuentas OWNER;
- la validación en staging;
- la preparación de las instancias y la activación de la política;
- y la reversión de la política y de las versiones.

**Fuera de alcance:**
- PostgreSQL (F0-001);
- F0-004 a F0-007;
- cualquier cambio de código, incluidos los requisitos previos PR-1 a PR-3 (apartado 11.2), que solo se describen;
- los procedimientos propios de un proveedor de despliegue concreto, que no está identificado en el proyecto;
- cualquier procedimiento de reversión de la base de datos.

### 1.1 Cambios respecto a la v4

La v5 aplica cinco correcciones concretas. El resto de la v4 se conserva.

| # | Tema | v4 | v5 |
|---|---|---|---|
| 1 | L-2 y entrada de instancias al tráfico | E1–E4 detectaban y comprobaban una instancia nueva o reiniciada **después** de que entrara en servicio | Se distinguen cuatro cosas: detectar la instancia, conocer su configuración, comprobar su comportamiento y **garantizar que no recibe tráfico hasta superar las comprobaciones**. Esta última es la garantía de admisión GA (apartado 9.5), que ni el proyecto ni E1–E4 proporcionan. **L-2 solo se cierra con evidencia de GA**: sin ella, la activación y el fin de la gracia siguen bloqueados. *(Descripción histórica de la v5. El criterio vigente es más estricto: L-2 solo se cierra con el conjunto completo de evidencias del apartado 9.5, y GA es obligatoria pero no suficiente.)* |
| 2 | `EMAIL_VERIFICATION_TOKEN_TTL_HOURS` | Se trataba igual que las dos fechas: «vacías en la etapa 1» | Se describe su comportamiento real (H18): es opcional; vacía equivale a 24 horas; si no, debe ser un entero de 1 a 168, o la API no arranca (apartados 3.1 y 6.4) |
| 3 | Consulta de P5 | 7.3 contaba `createdAt >= T_act AND emailVerifiedAt IS NULL` y P5, solo `createdAt >= T_act` | Dos consultas con nombre propio: P5-a (sin verificar), que es la de 7.3, y P5-b (todas), como métrica diagnóstica independiente. Ninguna de las dos es una garantía (apartados 7.3 y 9.6) |
| 4 | Orden temporal de E4 | E4 era el historial «desde P4», y P4 necesitaba ese inventario | Inventario inicial **I0** inmediatamente después de P3; P4 comprueba I0; desde I0 se registran las altas, reinicios, sustituciones y bajas. El inventario es manual y su completitud depende de la plataforma (apartados 9.5 y 9.6) |
| 5 | Referencia temporal de R4 | Comparaba la copia con «producción en la hora de B1», sin explicar cómo obtener ese estado | Solo hay dos formas válidas: escrituras detenidas durante la copia y el recuento, o recuento dentro de la misma lectura consistente que la copia. Si no, una reconciliación documentada parcial, con sus límites. Si no se puede verificar, queda la **limitación L-5** (apartado 6.5) |

### 1.2 Cambios de la v6

La v6 no cambia los criterios técnicos, las fechas, los umbrales ni las autorizaciones. Incorpora la corrección de la auditoría de la v5, con la que se creó la v6, y tres rondas de correcciones documentales posteriores sobre la propia v6:

| Revisión | Contenido |
|---|---|
| Auditoría de la v5 (dos observaciones altas, dos medias y nueve bajas) | Convenciones: tratamiento propio de cada limitación, y L-2 no aceptable. Alternativa B sujeta a GA (9.4). Conocer frente a aceptar (7.1). Encabezados sin versión (2.1, 3.2 y 11.2). Terminología de G1 y del apartado 12. Precisiones de H16, H18, A7 y R1. Remisión a 6.6 si falla la migración |
| Primera ronda sobre la v6 (N-1 a N-8) | G3 retiene fuera del tráfico, con GA, cada instancia reiniciada después de *T_act*, y no la admite con `REQUIRED_FROM` ausente o incorrecto (9.8). E3 definido antes y después de *T_fin* (9.5). L-2: un cambio de código solo puede contribuir, y no la cierra por sí solo (convenciones y 9.5). Acceso a la instancia retenida y condiciones para que un ensayo en staging cuente (9.5). Entrega de las variables vacías y `.env` en el directorio de trabajo (A4 y H16). Aceptación de L-4 en 11.2. Cuándo es obligatoria GA (9.5), también en las reversiones (10.1 y 10.3) |
| Segunda ronda sobre la v6 (P-1 a P-4) | Requisitos de la cuenta de prueba de E3 (9.5). `.env.vault`, `DOTENV_KEY` y otras fuentes locales en A4 y H16. El cierre de L-2 exige el conjunto E1–E4 + GA + acceso a la instancia retenida + cobertura + ensayo representativo (9.5, 11.2 y las referencias de las convenciones, 9.4 y 12). Condición explícita para el reinicio después de *T_act* en la tabla de escenarios (9.5) |
| Tercera ronda sobre la v6 (P-2, P-3 y P-4) | Escenarios A–D de `.env.vault` y `DOTENV_KEY` en A4, con H16 y E1 alineados. Convenciones: L-2 solo se cierra con el conjunto completo del apartado 9.5, y GA es obligatoria pero no suficiente; nota de vigencia en la fila histórica de 1.1. Valoración del riesgo del reinicio después de *T_act*, coherente con su condición operativa (9.5) |

L-2 sigue **abierta** y GA **no está acreditada**.

## 2. Estado técnico de referencia

| Elemento | Valor |
|---|---|
| Repositorio | `feat/keys`, HEAD `127a0a61d30d27f1e699e83274255777d6b31047` (árbol `9c72277c86bdb6b7be47347e0a22c73fb82ce83f`) |
| Diff acumulado | `revision/fase0_acumulado_final.diff` (SHA-256 `660a782a93e79629959cfd190d6644b72c64f3884bf90c4c53f320a9146da273`) |
| Árbol resultante | `c99d5f65cd21b48214701038d8b52e530c4aebcd` (copia verificada `revision/fase0_verificacion_final`) |
| Secuencia de origen | `fase0_v2_3a_combinada` → `fase0_3b` → `fase0_3c` → `fase0_decisiones_implementacion` → `fase0_correcciones_002_003` |
| Migración | `apps/api/prisma/migrations/20261106090000_add_email_verification`: aditiva. Añade a `User` dos columnas que admiten NULL (`emailVerifiedAt` y `emailVerificationSentAt`) y crea la tabla `EmailVerificationToken` |
| Pruebas automáticas (última ejecución, en la copia aislada) | API 736 de 736 (93 de integración con SQLite **temporal**), web 432 de 432 (lógica pura, sin DOM) y paquete compartido 20 de 20; typecheck, oxlint y `git diff --check` sin errores |
| No probado | SMTP real, base real o de producción, PostgreSQL, renderizado de componentes y build de la web |

Documentación funcional: `docs/seguridad/verificacion-email.md` y `docs/seguridad/recuperacion-obligatoria.md`, en el árbol resultante.

### 2.1 Hechos del código usados en este documento

Comprobados leyendo el código: la web antigua en `127a0a6` y la nueva en el árbol `c99d5f65…`. No se ha ejecutado ningún build ni ningún servidor.

| # | Hecho | Evidencia |
|---|---|---|
| H1 | La web es una SPA de Vite **sin configuración de build propia**. `vite.config.ts` solo declara plugins y un alias | `apps/web/vite.config.ts`; script `build`: `tsc -b && vite build` |
| H2 | **No hay división de código.** Ni la web antigua ni la nueva usan `lazy()` ni `import()` dinámico, así que una pestaña cargada tiene ya todo el código y no necesita descargar más archivos para seguir funcionando | Búsqueda en `apps/web/src`, en las dos versiones |
| H3 | **No hay service worker ni manifiesto PWA.** `public/` solo contiene `favicon.svg` e `icons.svg` | Búsqueda de `serviceWorker`, `workbox`, `vite-plugin-pwa`, `registerSW` y `manifest`, sin resultados |
| H4 | **Ni la API ni el repositorio controlan la caché de la web.** La API no sirve la web ni fija `Cache-Control`, y el repositorio no contiene ninguna configuración de alojamiento (nginx, Docker, Vercel, Netlify, `_headers`…). Cómo se cachea `index.html` depende de un alojamiento no identificado | Búsqueda en `apps/api/src` y en `git ls-files` |
| H5 | **No hay control de versión entre la web y la API.** `GET /health` devuelve solo `{status, service}`; la web no incluye ningún identificador de build y la API no envía ninguna cabecera de versión | `apps/api/src/app.ts` (`/health`); búsqueda de `VITE_*`, `APP_VERSION` y `BUILD_ID` |
| H6 | **Ninguna de las dos webs hace nunca una navegación completa ni una recarga.** Toda la navegación es interna (React Router), incluido el cierre de sesión. Por tanto, una pestaña con la web antigua **solo** cambia de versión cuando el navegador carga de nuevo el documento: al recargar, al abrir una pestaña o un enlace nuevos, o si el propio navegador descarta y restaura la pestaña | Búsqueda de `window.location`, `location.href`, `assign`, `replace` y `reload` en `apps/web/src`, sin resultados |
| H7 | La web antigua no tiene la ruta `/verificar-email` ni ruta comodín | `apps/web/src/App.tsx` en `127a0a6` |
| H8 | **La web antigua ante la API nueva con la verificación exigida:**<br>• **registro:** la API responde 201 sin sesión (`verificationRequired: true`); la página antigua no navega ni muestra ningún mensaje;<br>• **login:** muestra tal cual el texto que envía la API en cualquier respuesta de error (`extractErrorMessage`). Con el 403 muestra «Tienes que verificar tu email antes de acceder. Revisa tu correo o solicita un enlace nuevo.», sin formulario de reenvío;<br>• **sesión:** de `/api/auth/me` solo muestra el texto del servidor en un 423. El 403 lo convierte en el error genérico `Failed to load session: 403`, sin el texto de la API | `RegisterPage.tsx`, `authService.ts` (`register`, `login`, `getCurrentUser`) en `127a0a6`; `auth.routes.ts` (registro) en `c99d5f65…` |
| H9 | **La política la aplica la API, no la web.** Una pestaña antigua no puede saltársela: el efecto de L-1 es de uso y de soporte (un usuario que no ve cómo verificar), no una pérdida de seguridad | `requireAuth`, `getUserIdFromSession` y el login en `c99d5f65…` |
| H10 | El registro **siempre** envía el enlace en segundo plano, se exija o no la verificación. El enlace se abre en una navegación nueva | `auth.routes.ts` (`sendEmailVerificationInBackground`) |
| H11 | **La web nueva compara el texto exacto** del mensaje `EMAIL_NOT_VERIFIED` (`EMAIL_NOT_VERIFIED_MESSAGE`). Cambiar ese texto en la API afectaría a la web nueva | `apps/web/src/services/authService.ts` en `c99d5f65…` |
| H12 | **El estado de una cuenta no se guarda: se calcula en cada comprobación**, a partir de `createdAt`, `emailVerifiedAt`, la configuración del proceso y la hora actual. `createdAt` se fija al crear la cuenta (`@default(now())`) y no cambia. Al registrarse, la decisión de abrir o no sesión usa ese mismo `createdAt` guardado | `email-verification.service.ts` (`emailAccess`, `isEmailVerificationRequired`); `schema.prisma` |
| H13 | **No existe ningún mecanismo de mantenimiento, bloqueo del registro ni drenaje de tráfico** en el código. La única forma de que no se creen cuentas es que la API no esté en marcha | Búsqueda de `maintenance`, `mantenimiento`, `REGISTRATION_*` y `ALLOW_REGISTRATION`, sin resultados en el código de la aplicación |
| H14 | **Ningún endpoint expone la configuración de la política.** Solo puede inferirse su efecto. `GET /api/auth/me` devuelve `emailVerification.status`, que distingue `NOT_ENFORCED`, `GRACE`, `REQUIRED` y `VERIFIED`. También devuelve `emailVerification.graceUntil`, que es el valor exacto de `GRACE_UNTIL` en ISO 8601 cuando la cuenta está en `GRACE` y la variable tiene valor, y `null` en otro caso. **No devuelve nunca el valor de `REQUIRED_FROM`** | `auth.routes.ts` (`/me`) |
| H15 | **La API antigua tolera los datos de la Fase 0:**<br>• la acción de auditoría es un `String`;<br>• el panel antiguo muestra el código en bruto cuando no conoce la acción;<br>• el filtro antiguo ignora los valores desconocidos (`z.enum(...).catch(undefined)`);<br>• las columnas nuevas admiten NULL | `schema.prisma` (`action String`), `adminAudit.ts` y `admin.routes.ts` en `127a0a6` |
| H16 | **La API lee la configuración de dos fuentes.** Al arrancar, `dotenv.config()` carga el archivo `.env` del directorio de trabajo del proceso, si existe. Por defecto, `dotenv` no sobrescribe las variables que ya estén definidas en el entorno. Por tanto:<br>• si la plataforma define una variable, aunque sea vacía, prevalece. **Solo es así si la plataforma entrega realmente la variable vacía al proceso**, cosa que no se ha comprobado (A4);<br>• si no la define, se aplica la del `.env` que encuentre el proceso.<br>Una variable vacía o compuesta solo de espacios se trata como no definida (`NOT_ENFORCED`).<br>**Precisión sobre `dotenv` 17** (17.4.2 en el repositorio):<br>• `dotenv.config()`, sin opciones, usa por defecto `.env` en el directorio de trabajo;<br>• si el entorno define `DOTENV_KEY`, también puede cargar `.env.vault`.<br>El repositorio no contiene ninguna configuración de vault, y **no se ha comprobado** si la plataforma real define `DOTENV_KEY` ni si existe un `.env.vault` en el entorno real.<br>**Tres cosas distintas, que no hay que confundir:**<br>1. las variables que la plataforma **entrega** al proceso;<br>2. las variables que `dotenv` **puede cargar** desde archivos (`.env` o, con `DOTENV_KEY`, `.env.vault`);<br>3. los valores que el proceso **usa de verdad**.<br>Que una variable esté en la configuración de la plataforma no demuestra que el proceso la haya recibido. El efecto en el proceso solo lo muestran E2 y E3 (apartado 9.5). A4 trata las fuentes 1 y 2, con los escenarios A–D de `.env.vault` y `DOTENV_KEY`. Solo se comprueba la existencia de los archivos y la presencia de `DOTENV_KEY`, nunca su contenido ni su valor | `apps/api/src/env.ts`; `parseDate` en `email-verification.service.ts`; `dotenv/lib/main.js` |
| H17 | **E2 empieza en el enlace de denuncia de incidente.** El incidente se registra cuando el titular confirma desde ese enlace; un OWNER lo resuelve después desde el panel | `docs/seguridad/recuperacion-obligatoria.md`, apartado 2 («Ciclo completo») |
| H18 | **`EMAIL_VERIFICATION_TOKEN_TTL_HOURS` no es una fecha de la política: fija la caducidad de los enlaces.**<br>• **es opcional:** sin valor, o vacía o compuesta solo de espacios, vale **24 horas** (`DEFAULT_TOKEN_TTL_HOURS`);<br>• con valor, debe ser un **número entero de 1 a 168** (`MAX_TOKEN_TTL_HOURS`). El valor se recorta con `trim()` y se convierte con `Number()`. Por eso:<br>&nbsp;&nbsp;– se admiten los espacios alrededor del número (`' 24 '` vale 24) y las notaciones que `Number()` convierte en un entero dentro del intervalo, como la exponencial (`1e1` vale 10) o la hexadecimal (`0x10` vale 16);<br>&nbsp;&nbsp;– se rechaza todo lo que no resulte en un entero, o resulte en un entero fuera de 1–168, como `1.5`, `abc`, `0` o `169`;<br>• **si no es válida, la API no arranca:** `readEmailVerificationPolicy` la valida junto con las fechas al registrar las rutas de autenticación, y lanza un error;<br>• la misma lectura se repite en cada uso, pero `process.env` no cambia mientras el proceso está en marcha, así que un cambio surte efecto al reiniciar | `email-verification.service.ts` (`readEmailVerificationPolicy`); `auth.routes.ts` (llamada al registrar las rutas) |
| H19 | **`GET /health` no refleja la configuración.** Siempre devuelve `{status: 'ok', service: 'estateforge-api'}`. Aunque una plataforma lo usara para decidir si una instancia recibe tráfico, no comprobaría la política | `apps/api/src/app.ts` (`/health`) |

## 3. Configuración de fechas

### 3.1 Regla del código

`emailAccess` (`apps/api/src/services/email-verification.service.ts`) evalúa en este orden:

1. Si `emailVerifiedAt` tiene valor: **`VERIFIED`**.
2. Si no hay `EMAIL_VERIFICATION_REQUIRED_FROM`: **`NOT_ENFORCED`**.
3. Si `createdAt < REQUIRED_FROM` (cuenta **existente**):
   - si hay `GRACE_UNTIL` y el instante actual es igual o posterior a `GRACE_UNTIL`: **`REQUIRED`**;
   - si no: **`GRACE`**.
4. Si `createdAt >= REQUIRED_FROM` (cuenta **nueva**, incluido el mismo instante): **`REQUIRED`**.

Solo `REQUIRED` impide el acceso. **No hay ninguna excepción por rol:** los OWNER siguen la misma regla.

**`NOT_ENFORCED` no desactiva el envío de enlaces.** Con las dos variables vacías no se exige la verificación a nadie, pero:
- el registro sigue enviando el enlace;
- y el reenvío sigue funcionando.

**Formato y validación de las dos fechas de la política.**
- `REQUIRED_FROM` y `GRACE_UNTIL` son fechas ISO 8601 **con zona horaria** obligatoria (`Z` o `±hh:mm`).
- Cada una puede quedar **vacía**, y entonces se trata como no definida (H16). Con las dos vacías, la política es `NOT_ENFORCED`.
- La API **no arranca** si:
  - hay fechas sin zona horaria o imposibles (como el 31 de febrero o la hora 24);
  - hay `GRACE_UNTIL` sin `REQUIRED_FROM`;
  - o `GRACE_UNTIL` es anterior a `REQUIRED_FROM`.

**`EMAIL_VERIFICATION_TOKEN_TTL_HOURS` es otra cosa** (H18). No interviene en la clasificación de las cuentas: solo fija la caducidad de los enlaces de verificación. Es opcional y, vacía, vale 24 horas. Si tiene valor, debe ser un entero de 1 a 168; si no, la API no arranca. Se valida a la vez que las fechas.

La validación **no** exige que *T_act* sea pasado ni futuro: los dos valores se aceptan.

**Instantes, no horas locales.**
- *T_act* y *T_fin* se interpretan como **instantes absolutos**: el código los convierte a un instante UTC y compara instantes.
- No son horas locales de cada servidor: un mismo valor con zona horaria significa el mismo instante en todas las instancias.

**Sincronización de relojes.**
- Cada instancia compara con **su propio reloj** la hora actual, para `GRACE_UNTIL`.
- `createdAt` se fija con el reloj del sistema que crea la fila. Este documento no ha verificado si lo pone el proceso de la API o la base, pero en ambos casos debe estar sincronizado.
- Si los relojes no están sincronizados, cerca de *T_act* o *T_fin* dos instancias pueden tomar **decisiones distintas** sobre la misma cuenta, o una cuenta puede quedar en el lado equivocado de *T_act*.
- El proyecto **no define ninguna tolerancia de reloj**, y este documento no inventa ninguna. Todos los relojes deben sincronizarse con una fuente horaria común, por ejemplo NTP, configurada en la plataforma.

**Cuándo tiene efecto un cambio.**
- La política se lee del entorno del proceso y se valida al arrancar, así que un cambio de configuración surte efecto **al reiniciar cada instancia**.
- El entorno del proceso combina las variables de la plataforma y las del `.env` que encuentre el proceso (H16).
- Mientras haya instancias con valores distintos, cada una decide por su cuenta.
- Reiniciar una instancia **con la misma configuración** no cambia ninguna decisión, ni antes ni después de *T_act*: el estado se recalcula con los mismos datos (H12).
- En el apartado 9 se analiza cuándo esa mezcla es inocua y cuándo no.

**Límites de las fechas** (de la regla del punto anterior):
- una cuenta creada **exactamente** en *T_act* es nueva (`REQUIRED`);
- en el instante exacto *T_fin*, las cuentas existentes sin verificar ya son `REQUIRED`;
- `GRACE_UNTIL` puede ser igual a `REQUIRED_FROM`: en ese caso, las cuentas existentes no tienen ningún periodo de gracia.

### 3.2 Consecuencia importante: `REQUIRED_FROM` clasifica las cuentas

`REQUIRED_FROM` separa las cuentas **existentes** (creadas antes) de las **nuevas** (creadas en ese instante o después).

**No debe modificarse una vez alcanzado** sin analizar antes el impacto. Si se mueve:
- **hacia atrás:** las cuentas creadas entre la fecha nueva y la anterior pasan a ser **nuevas** y quedan `REQUIRED` de inmediato;
- **hacia delante:** las cuentas creadas entre la fecha anterior y la nueva pasan a ser **existentes** (`GRACE`).

Mientras *T_act* siga siendo futuro, no debería haber ninguna cuenta con `createdAt >= T_act`, siempre que los relojes estén sincronizados (apartado 9.6, P5). Por eso, cambiarlo por otro valor futuro o vaciarlo antes de alcanzarlo no reclasifica ninguna cuenta: las que eran `GRACE` vuelven a `NOT_ENFORCED`, o siguen `GRACE`.

**Corrección mantenida de la v2.** Proponer `REQUIRED_FROM` «en el instante del despliegue **o posterior**» como forma de exigir la verificación de inmediato era engañoso. Un valor futuro **no** obliga a verificar a quienes se registran antes de esa fecha: esas cuentas son existentes y quedan en `GRACE`. Desde la v3 se usa un valor futuro **a propósito**, asumiendo ese efecto (alternativa A, apartado 9.3).

Las tres opciones al fijar `REQUIRED_FROM`, donde *T_act* es el instante elegido y *T_carga* el instante en que la última instancia arranca con esa configuración:

| Valor elegido | Efecto | Valoración |
|---|---|---|
| *T_act* posterior a *T_carga* (futuro) | Desde la carga hasta *T_act*, las cuentas que se registren son **existentes** (`GRACE`) y no verifican de inmediato. Desde *T_act*, todas las cuentas que se registren son **nuevas** (`REQUIRED`) en todas las instancias que ya cargaron la configuración | **Recomendado** (alternativa A, apartado 9.3) |
| *T_act* aproximadamente igual a la activación (*ahora*) | Las cuentas creadas entre *T_act* y el reinicio de cada instancia las crea una instancia que todavía no exige la verificación, pero quedan `REQUIRED` en cuanto las evalúa una instancia reiniciada (riesgo P-01). Ninguna consulta previa lo evita | Solo viable en el caso restringido del apartado 9.4 |
| *T_act* anterior a la activación (pasado) | Las cuentas creadas en [*T_act*, activación) ya existían, pero el código las trata como **nuevas** y quedan `REQUIRED` en ese momento (P-01) | **No forma parte de este procedimiento.** Solo sería posible si el PP quiere exactamente ese efecto, con las cuentas afectadas identificadas y un análisis y una autorización aparte. Esto también incluye reactivar con el *T_act* de antes después de una reversión (apartado 10.1) |

### 3.3 Las cuatro etapas

Los ejemplos son ilustrativos: *T_act* y *T_fin* son marcadores, no fechas reales. El formato debe ser ISO 8601 con zona horaria, por ejemplo `AAAA-MM-DDThh:mm:ssZ` o `AAAA-MM-DDThh:mm:ss+01:00`.

**Etapa 1. Desplegar el código sin exigir nada (`NOT_ENFORCED`).**
```env
EMAIL_VERIFICATION_REQUIRED_FROM=""
EMAIL_VERIFICATION_GRACE_UNTIL=""
```
- Todas las cuentas sin verificar quedan `NOT_ENFORCED`: entran y no ven ningún aviso.
- Las cuentas que se registran reciben el enlace. Las anteriores pueden pedirlo desde `/verificar-email`, que sin token muestra el formulario de reenvío.

**Etapa 2. Exigir la verificación a las cuentas nuevas.**
```env
EMAIL_VERIFICATION_REQUIRED_FROM="<T_act>"   # instante futuro, cargado de antemano: apartado 9
EMAIL_VERIFICATION_GRACE_UNTIL=""            # gracia sin fin para las existentes
```
- **Desde la carga y antes de *T_act*:** las cuentas sin verificar quedan `GRACE`, incluidas las que se registren en ese intervalo. Entran y ven el aviso, sin fecha límite.
- **Desde *T_act*:** las cuentas creadas a partir de *T_act* sin verificar quedan `REQUIRED`. El registro no abre sesión y el login responde 403 hasta que verifiquen.
- Las cuentas anteriores a *T_act* sin verificar siguen `GRACE`, sin fecha límite.

**Etapa 3. Conceder un periodo de gracia con fecha de fin a las cuentas existentes.**
```env
EMAIL_VERIFICATION_REQUIRED_FROM="<T_act>"   # el MISMO valor de la etapa 2
EMAIL_VERIFICATION_GRACE_UNTIL="<T_fin>"     # T_fin futuro, igual o posterior a T_act, anunciado con antelación
```
- Las cuentas existentes sin verificar siguen en `GRACE` hasta *T_fin*, sin incluirlo; el aviso muestra la fecha.

**Etapa 4. Fin del periodo de gracia.**
- No hay que cambiar nada. A partir de *T_fin* (incluido), las cuentas existentes sin verificar pasan a `REQUIRED`:
  - sus sesiones se cierran en la siguiente petición protegida;
  - el login les pide verificar y ofrece el reenvío, **en la web nueva** (en la antigua, ver L-1).

**Autorizaciones.** La activación de la obligación (etapa 2) y la fijación del fin de la gracia (etapa 3, que provoca la etapa 4) son **decisiones distintas**, con autorizaciones separadas (apartado 12).

## 4. Clasificación de cuentas

Con `REQUIRED_FROM = T_act` y, si existe, `GRACE_UNTIL = T_fin`:

| `emailVerifiedAt` | `createdAt` | Instante actual | Estado | Acceso |
|---|---|---|---|---|
| Con valor | Cualquiera | Cualquiera | `VERIFIED` | Sí |
| `NULL` | Cualquiera | Sin `REQUIRED_FROM` | `NOT_ENFORCED` | Sí, sin aviso |
| `NULL` | < *T_act* | < *T_fin*, o sin *T_fin* | `GRACE` | Sí, con aviso |
| `NULL` | < *T_act* | ≥ *T_fin* | `REQUIRED` | No: login 403 y sesiones cerradas |
| `NULL` | ≥ *T_act* | Cualquiera | `REQUIRED` | No, hasta verificar |

**Otros casos:**
- **Recuperación obligatoria (E2) pendiente:** prevalece el 423 de E2, y mientras dure no se emiten ni se consumen enlaces. Al terminar E2:
  - con la misma dirección, se conserva la verificación;
  - con otra dirección, la cuenta queda sin verificar.

  Después se aplica la tabla.
- **Protección o suspensión:** prevalecen su 423 o 403.
- **Cambio de email confirmado con código:** la cuenta queda `VERIFIED` (D1).
- **Cuentas que no entran durante la gracia:** pasan a `REQUIRED` igual. Al volver, el login de la web nueva ofrece pedir el enlace, si el buzón y el SMTP funcionan.

**No existe ninguna herramienta administrativa** (API, panel ni script) para verificar o eximir una cuenta:
- `apps/api/scripts/promote-owner.ts` solo cambia el rol;
- el panel no muestra `emailVerifiedAt`;
- una cuenta cuyo buzón no funciona no puede verificar por sí misma.

## 5. Condiciones para OWNER

**Comportamiento comprobado en el código:**
- los OWNER necesitan verificar el email como cualquier cuenta;
- un OWNER creado en *T_act* o después queda `REQUIRED` desde el principio;
- uno anterior puede estar en `GRACE` hasta *T_fin*;
- en `REQUIRED`, `requireAuth` y `getUserIdFromSession` cierran su sesión y `requireOwner` le niega el panel;
- **si el único OWNER queda bloqueado**, la administración de la plataforma queda inaccesible hasta que verifique;
- no existe ninguna herramienta para hacerlo por él (apartado 4);
- **un OWNER existente no queda bloqueado en *T_act*, sino en *T_fin*,** si sigue sin verificar. En *T_act* solo se bloquea un OWNER creado o promovido a partir de una cuenta creada en *T_act* o después. Aun así, se mantiene la regla conservadora de la v2: la etapa 2 no se carga sin todos los OWNER verificados (O6).

**Checklist previo a la carga de la configuración de la etapa 2 (paso 7), repetido antes de *T_act* y antes de *T_fin*.** **No se carga la configuración** si algún punto no se cumple:

| # | Qué comprobar | Cómo | Resultado esperado | Aprobado si | Rol | Estado |
|---|---|---|---|---|---|---|
| O1 | Inventario completo y actualizado de las cuentas OWNER | El operador autorizado lo **contrasta con una fuente autorizada y actual de producción**, mediante una consulta de solo lectura con acceso aprobado. No basta con una copia antigua ni con una lista que no se haya contrastado. Se registran la fecha y hora de la comprobación y la persona responsable | Lista de **todas** las cuentas con rol OWNER en la fecha de la comprobación, con constancia de que no falta ningún OWNER reciente (por ejemplo, promovido con `promote-owner.ts` después de la última lista) | Lista con fecha, responsable y fuente indicados, firmada por el RT. Se repite si pasa tiempo antes de la activación | RT | ☐ |
| O2 | Email válido y accesible de cada OWNER | Cada OWNER confirma que recibe correo en esa dirección | Confirmación de cada OWNER | Todos confirman | OW | ☐ |
| O3 | Cada OWNER verificado | Pedir el enlace en `/verificar-email` (sin token), **con la web nueva**, y confirmarlo. Comprobarlo en la respuesta de `GET /api/auth/me` (`emailVerification.status = "VERIFIED"`), por ejemplo con el inspector de red del navegador, o con una consulta de solo lectura autorizada (`emailVerifiedAt` no nulo). En `NOT_ENFORCED` la web no muestra aviso, así que su ausencia no basta | `VERIFIED` para todos | Todos `VERIFIED` | OW y RT | ☐ |
| O4 | Acceso al panel | Cada OWNER abre la web en una pestaña nueva y comprueba que usa la versión nueva: `/verificar-email` carga, lo que la web antigua no hace (H7). Una simple recarga no lo garantiza si hay caché (apartado 6.2). Después inicia sesión y abre `/admin` | Entra al panel con la web nueva | Todos entran | OW | ☐ |
| O5 | Vía de recuperación de un OWNER | Ver «Recuperación de un OWNER bloqueado», debajo de la tabla | Todos los OWNER verificados y con acceso a su buzón **antes** de cargar la configuración | Confirmado, y el riesgo residual aceptado por el PP | RT y PP | ☐ |
| O6 | Regla de parada | Revisar O1–O5 | — | Si algún OWNER no está verificado o su acceso al buzón no está confirmado:<br>• no se carga la configuración de la etapa 2;<br>• si ya estaba cargada y *T_act* no ha llegado, se vacía (apartado 9.6);<br>• no se fija *T_fin* o, si ya está fijado y no se ha alcanzado, se vacía `GRACE_UNTIL` (apartado 9.8).<br>No hay alternativa administrativa para ese OWNER (apartado 4) | PP | ☐ |

**Recuperación de un OWNER bloqueado (O5): situación actual.**
- **La única vía disponible** es que el propio OWNER reciba y confirme un enlace de verificación. Depende de:
  - que tenga acceso a su buzón;
  - que el SMTP funcione;
  - que `WEB_APP_URL` sea correcta;
  - y que el enlace se abra con la web nueva.
- **No existe ninguna herramienta administrativa** de verificación ni de exención. Si el OWNER pierde el acceso a su buzón o el correo no llega, **el proyecto no tiene ahora ninguna alternativa implementada**.
- **Una intervención manual en la base de datos no es un procedimiento existente, aprobado ni seguro.** Una vía administrativa futura queda **pendiente de diseño, implementación, pruebas y autorización**. Mientras no exista, la protección es preventiva: O1–O4 y la regla de parada O6.

## 6. Secuencia de despliegue

### 6.1 Compatibilidad entre versiones

Compatibilidad comprobada leyendo el código:

| Combinación | Resultado |
|---|---|
| **Web nueva con API antigua** | Funciona con degradación. La web nueva tolera los campos que faltan. La página `/verificar-email` y el reenvío darían error porque esos endpoints no existen, pero la API antigua tampoco envía enlaces ni exige la verificación |
| **API nueva con web antigua y `NOT_ENFORCED`** | Funciona salvo los enlaces de verificación abiertos con la web antigua, que no tiene la ruta `/verificar-email` (H7). Un enlace se abre en una navegación nueva, que carga la web que sirva el alojamiento en ese momento (H6 y H10) |
| **API nueva con web antigua y verificación exigida** | **Incompatible para activar la obligación.** El registro no muestra ningún mensaje, el login no ofrece el reenvío y la sesión se trata como un error genérico (H8). La API sigue aplicando la política (H9) |
| **API nueva con base sin migrar** | **Incompatible.** El login, `/me` y las sesiones fallan |
| **API antigua con base migrada** | Compatible: la migración es aditiva y la API antigua tolera los datos nuevos (H15) |

De ahí el orden: **copia de seguridad (restauración comprobada) → migración (con la API nueva parada) → web nueva → API nueva con `NOT_ENFORCED`** → periodo con la web nueva publicada → preparación de las instancias con un *T_act* futuro → *T_act*.

**Coordinación.** La transición debe coordinarse para que los usuarios no trabajen con una combinación incompatible. Si la plataforma no permite coordinar los cambios, puede ser necesaria **una ventana de mantenimiento controlada**. Esto es una decisión operativa, no un mecanismo del proyecto (H13). Este documento no presupone despliegues progresivos, *blue-green*, drenaje de tráfico ni rollback automático, porque el proyecto no los tiene confirmados.

### 6.2 Clientes que siguen ejecutando la web antigua (problema crítico 1)

**Tres hechos distintos, que no son equivalentes:**

| Hecho | Qué significa | ¿Se puede comprobar con la implementación actual? |
|---|---|---|
| **1. Web nueva publicada** | El alojamiento sirve el `index.html` nuevo y sus recursos a las **cargas nuevas** | **Sí**, desde fuera: descargar `index.html` y comparar los recursos que referencia con los del build (paso 4) |
| **2. Web nueva en uso** | Los navegadores de los usuarios **ejecutan** la web nueva | **No.** No hay identificador de versión ni ninguna señal de los clientes (H5). Las pestañas abiertas antes de publicar siguen ejecutando la web antigua indefinidamente, hasta una carga nueva del documento (H2 y H6) |
| **3. Política activa** | La API exige la verificación (`REQUIRED`) | **Solo indirectamente**, por su efecto en `/me` (H14), y solo en la instancia que responde (apartado 9) |

**Mecanismos que existen realmente:**
- **Nombres de archivo con hash.** Como `vite.config.ts` no configura el build (H1), se aplica el comportamiento por defecto de Vite: JS y CSS en `assets/` con un hash del contenido en el nombre, y `index.html` sin hash.
  - **Garantía:** una carga nueva de un `index.html` nuevo no reutiliza JS antiguo cacheado.
  - **Límites:** no se ha ejecutado el build (no probado, apartado 2) y debe confirmarse en el paso 1. Tampoco afecta a pestañas ya abiertas.
- **Carga nueva del documento.** Es la única forma de pasar a la web nueva (H6). Ocurre al recargar, al abrir la web en una pestaña nueva o **al abrir un enlace de un correo** (H10).
  - **Límite:** solo funciona si el alojamiento sirve el `index.html` vigente para esa ruta. Eso exige que no lo cachee con validez larga y que tenga la reescritura de rutas de la SPA a `index.html`. No hay ninguna configuración en el repositorio (H4): **se comprueba en producción, no se presupone** (pasos 4 y 6).

**Mecanismos que no existen:** service worker (H3), invalidación activa de caché (H4), control de versión entre web y API (H5), detección de versión antigua en la web (H5) y recarga forzada (H6).

**Qué ocurre realmente con una pestaña antigua cuando se exige la verificación (H8 y H9):**
- **Cuenta nueva registrada desde la pestaña antigua después de *T_act*:**
  - la API crea la cuenta sin sesión y envía el enlace (H10);
  - la página antigua no muestra nada;
  - el usuario puede salir de esa situación abriendo el enlace del correo, que es una carga nueva, si el SMTP y el alojamiento funcionan.
- **Cuenta existente que pasa a `REQUIRED` en *T_fin* con la pestaña abierta:**
  - su sesión se cierra;
  - el login antiguo muestra «…solicita un enlace nuevo», pero **no ofrece cómo hacerlo**;
  - en este caso no se envía ningún enlace automáticamente;
  - **el usuario queda bloqueado en esa pestaña** hasta que cargue la web de nuevo.
- **En ningún caso la pestaña antigua permite saltarse la política:** el problema es de uso y de soporte, no de seguridad.

**Qué no puede garantizarse con la implementación actual:**
- que ningún usuario siga con la web antigua al llegar *T_act* o *T_fin*;
- medir cuántos usuarios la usan;
- forzar su actualización.

**Pedir a los usuarios que recarguen la página no es una solución suficiente.** Es una medida de mitigación que no se puede verificar.

**Medidas operativas aplicables** (reducen el riesgo, no lo eliminan):
1. **Separar la publicación de la activación** con un periodo en la etapa 1 cuya duración decide el PP. Es lo que ocurre en los pasos 4 a 6: cuanto más largo es el periodo, más pestañas antiguas se habrán cerrado o recargado, pero la duración de una pestaña no tiene límite.
2. **Comprobar la caché y la reescritura de rutas del alojamiento** antes de activar nada. Si `index.html` se sirve con una caché de validez larga, o `/verificar-email` no devuelve la web, **se detiene** el procedimiento (paso 4).
3. **Aplicar el mismo razonamiento a *T_fin*,** que es el caso de mayor impacto: anunciarlo con antelación y dejar entre la publicación de la web y *T_fin* el máximo periodo razonable.
4. **Preparar el soporte** con la instrucción concreta para un usuario afectado: abrir la web en una pestaña nueva o abrir el enlace del correo. Es una carga nueva, no la simple recarga de una pestaña que ya muestra un error.
5. **Comunicar *T_act* y *T_fin*,** sabiendo que no garantiza nada.

**Qué se puede hacer, y qué no, con las pestañas que ya ejecutan la web antigua:**

| # | Acción | ¿Es posible? | Alcance real |
|---|---|---|---|
| 1 | **Cambiar el JavaScript** que ya se ejecuta en una pestaña antigua | **No.** Ningún cambio en el servidor ni en una web publicada después modifica el código cargado en esa pestaña (H2 y H6) | — |
| 2 | **Cambiar las respuestas del servidor** que recibe esa pestaña | **Sí**, con un cambio futuro en la API. Pero la API no distingue la web antigua de la nueva (H5): cualquier cambio afecta a las dos | Solo sirve donde la web antigua muestra lo que envía el servidor |
| 3 | **Ayudar al usuario con un mensaje** para que salga de la pantalla antigua | **Parcialmente.** El login antiguo muestra tal cual el texto de error de la API (H8), así que un texto que indicara cómo abrir la web nueva le llegaría (PR-2). En `/me`, el 403 no muestra el texto del servidor (H8) | **Solo en el login.** Además, la web nueva compara el texto exacto (H11): cambiarlo exige cambiar también la web nueva y probar las dos versiones |
| 4 | **Resolver el registro antiguo,** que no muestra ningún mensaje | **No sin romper la web nueva.** La web antigua solo mostraría un texto si el registro respondiera con error, y la web nueva espera un 201 con `verificationRequired` | El usuario solo tiene el correo de verificación (H10), que es una carga nueva |
| 5 | **Detectar automáticamente** una versión antigua y **forzar una recarga** | **No** para las pestañas actuales: su código no tiene esa lógica, y el proyecto no tiene ningún mecanismo que la provoque desde fuera (H3 y H5). Con PR-1 sería posible solo para las pestañas cargadas después de publicarlo | Transiciones futuras |

**Conclusión: limitación pendiente L-1** (apartado 11.2).
- No existe ninguna forma fiable de garantizar que los clientes con la web antigua no queden bloqueados.
- Un cambio futuro en las respuestas del servidor (PR-2) podría **mitigar** el caso del login, pero no el del registro, no detecta ni actualiza la pestaña, y no está analizado ni implementado. **No resuelve L-1.**
- PR-1 no ayuda a las pestañas ya abiertas: solo protegería las transiciones posteriores a su publicación.
- La activación (etapa 2) y el fin de la gracia (etapa 3, que provoca la etapa 4) exigen, cada una, que el **PP acepte expresamente L-1** (apartado 12). Aceptarla no autoriza la etapa.

### 6.3 Procedimiento en diez pasos

| Paso | Contenido | Apartado | Afecta a producción |
|---|---|---|---|
| 1 | Preparación técnica | 6.4 | No |
| 2 | Copia de seguridad y restauración comprobada | 6.5 | Lectura de la base de producción; la restauración, en un entorno aparte |
| 3 | Migración | 6.6 | Sí (esquema) |
| 4 | Publicación del frontend | 6.7 | Sí (web) |
| 5 | Arranque coordinado de la API con `NOT_ENFORCED` | 6.8 | Sí (API) |
| 6 | Comprobación de versiones de los clientes | 6.9 | No |
| 7 | Preparación de todas las instancias con un *T_act* futuro | 9.6 | Sí (configuración) |
| 8 | Activación de la política en *T_act* | 9.7 | No hay que hacer nada: llega la fecha |
| 9 | Finalización del periodo de gracia | 9.8 | Sí (configuración) y, en *T_fin*, el efecto |
| 10 | Reversión, si es necesaria | 10 | Sí |

Entre los pasos 6 y 7, y entre los pasos 8 y 9, puede pasar mucho tiempo. Las autorizaciones son por grupos de pasos (apartado 12):
- integración;
- pasos 1 a 5;
- pasos 6 a 8;
- paso 9;
- y la reversión, que se puede ejecutar cuando haga falta.

Dentro de cada grupo, una condición de parada detiene el procedimiento.

### 6.4 Paso 1 — Preparación técnica

| # | Acción | Qué se comprueba | Resultado esperado | Detener si | Rol | Estado |
|---|---|---|---|---|---|---|
| A1 | **Construir** los artefactos de la API nueva (incluido `prisma generate`) y de la web nueva, sin desplegarlos | Los builds terminan sin errores | Dos artefactos | Algún build falla | OD | ☐ |
| A2 | Confirmar los artefactos | SHA del diff acumulado y árbol `c99d5f65…` (apartado 2), y que los dos builds proceden de ese árbol | Coinciden | No coinciden | RT | ☐ |
| A3 | Confirmar el build de la web | Que la salida tiene `index.html` y los recursos JS y CSS con hash en el nombre (apartado 6.2); anotar los nombres para el paso 4 | Recursos con hash, nombres anotados | No tienen hash o no se pueden identificar | OD y RT | ☐ |
| A4 | Revisar la configuración de producción **sin mostrar secretos** (ver la tabla de variables debajo) | Que las variables están presentes y con el valor previsto (tabla de debajo).<br>• **Las dos fechas** (`EMAIL_VERIFICATION_REQUIRED_FROM` y `EMAIL_VERIFICATION_GRACE_UNTIL`) están **definidas expresamente en la plataforma**, vacías en la etapa 1, para que prevalezcan sobre cualquier `.env` (H16).<br>• **`EMAIL_VERIFICATION_TOKEN_TTL_HOURS`** está definida expresamente en la plataforma, con el entero de 1 a 168 que se haya decidido, o vacía si se acepta el valor de 24 horas (H18). Definirla evita que la aporte un `.env`.<br>• El artefacto desplegado de la API **no contiene ningún `.env`** con estas variables: se comprueba la lista de archivos del artefacto, sin abrir su contenido si pudiera tener secretos.<br>• **La plataforma entrega realmente las variables vacías al proceso.** La precedencia de H16 solo vale si una variable definida vacía llega al proceso como definida. Si la plataforma descarta las variables vacías, se tratan como no definidas, y las aportaría un `.env` si lo hubiera. Se comprueba con la documentación o las herramientas de la plataforma, sin mostrar valores.<br>• **No hay ningún `.env` en el directorio de trabajo efectivo del proceso**, que puede ser distinto del artefacto, por ejemplo por un volumen montado. Se comprueba solo la existencia del archivo, **sin leer su contenido**.<br>• **`.env.vault` y `DOTENV_KEY`** (H16). Solo se comprueba la **existencia** de los archivos y la **presencia o ausencia** de `DOTENV_KEY`, nunca su contenido ni su valor. No se presupone que el entorno real carezca de ninguno de los dos:<br>&nbsp;&nbsp;– **A. `.env.vault` ausente:** se documenta su ausencia en el artefacto y en el directorio de trabajo efectivo del proceso. No puede aportar configuración por esa vía;<br>&nbsp;&nbsp;– **B. `.env.vault` presente:** se documenta su presencia **sin leerlo**. A4 **no se da por superada** mientras no se determine de forma segura qué cargaría `dotenv` y esa fuente no se haya autorizado expresamente;<br>&nbsp;&nbsp;– **C. `DOTENV_KEY` presente en el entorno del proceso:** se registra solo que está definida, **sin mostrar su valor**. Hay que determinar de forma segura cómo se comportaría `dotenv` con `.env.vault`. Con `DOTENV_KEY` y sin `.env.vault`, se documentan las dos cosas;<br>&nbsp;&nbsp;– **D. No se puede verificar:** si no se puede determinar de forma segura la existencia de `.env.vault`, la presencia de `DOTENV_KEY` o las fuentes reales de configuración, A4 **queda pendiente** y no se marca como superada.<br>• **No hay ninguna otra fuente de configuración local o montada** que pueda introducir valores distintos de los autorizados. Se documentan las fuentes que existan, sin leer su contenido. No se afirma que una fuente está controlada sin evidencia.<br>• **A4 solo comprueba las fuentes**: lo que la plataforma entrega y lo que `dotenv` puede cargar. Los valores que el proceso usa de verdad solo los muestran E2 y E3, por instancia (apartado 9.5) | Correctas: fechas vacías (etapa 1), TTL válido o vacío, variables vacías entregadas como definidas; ningún `.env` en el artefacto ni en el directorio de trabajo; escenario A, o bien B o C con lo que cargaría `dotenv` determinado de forma segura y la fuente autorizada expresamente; y ninguna otra fuente local o montada no autorizada | Falta alguna; tiene un valor erróneo (el TTL fuera de 1–168 o no entero impide arrancar); hay un `.env` en el artefacto o en el directorio de trabajo; escenario B o C sin determinar qué cargaría `dotenv` o sin autorización expresa de la fuente; escenario D; o no se puede confirmar que la plataforma entregue las variables vacías y no se puede descartar un `.env` (A4 pendiente) | OD | ☐ |
| A5 | `WEB_APP_URL` y `API_PUBLIC_URL` | Que apuntan a las URL públicas reales | Correctas | No | OD | ☐ |
| A6 | SMTP y enlaces en staging | Casos S15 y S10 (apartado 8) | Correctos | Falla alguno | OD y QA | ☐ |
| A7 | Origen de la configuración e instancias | Se documentan cuatro cosas, con la documentación o las herramientas de la plataforma que se use (no identificada):<br>• **la fuente de configuración:** de dónde toma su entorno cada proceso de la API;<br>• **cuándo lo toma:** si las instancias que se crean o se reinician más tarde (por autoescalado, por sustitución o por una reversión de la plataforma) toman la configuración vigente o la de una versión de despliegue anterior;<br>• **cuántas instancias hay;**<br>• **qué evidencia ofrece la plataforma:** lista de instancias, hora de arranque de cada una, configuración o versión con que arrancó, e historial de sustituciones (E1–E4 del apartado 9.5). También si existe un mecanismo de **garantía de admisión GA** que impida que una instancia nueva, reiniciada o sustituida reciba tráfico antes de superar E2 y E3, y cómo funciona (apartado 9.5).<br>**Documentar E1–E4 no demuestra GA.** GA necesita su propia evidencia y su ensayo (apartado 7.3) | Las cuatro cosas documentadas, incluida la existencia o no de GA, indicando qué no ofrece la plataforma | No se puede determinar de dónde toma el entorno cada instancia, o cuántas hay | OD | ☐ |
| A8 | Relojes | Que todas las instancias, y la base si fija `createdAt`, se sincronizan con una fuente horaria común (apartado 3.1) | Sincronización configurada | No se puede confirmar | OD | ☐ |
| A9 | Decisiones del PP | *T_act*, y más adelante y por separado *T_fin* (apartado 3), y la duración del periodo entre los pasos 4 y 7 (apartado 6.2) | Documentadas | — | PP | ☐ |
| A10 | Ventana de mantenimiento | Si hace falta y cómo se comunica (apartado 6.1) | Decidida | — | PP y OD | ☐ |

**Variables que hay que revisar en A4** (comprobado en el código versionado):

| Grupo | Variables | Función |
|---|---|---|
| Obligatorias para enviar correo | `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`; `SMTP_PORT` y `SMTP_SECURE` son opcionales | Si falta alguna de las obligatorias, **cada envío falla**: la API arranca igual, pero los correos de verificación, recuperación y aviso no salen |
| Enlaces públicos de los correos | `WEB_APP_URL` | Construye los enlaces de verificación (`/verificar-email`), de restablecimiento y de E2. Por defecto vale `http://localhost:5173`: en producción, los enlaces serían inservibles |
| Enlaces públicos de los correos | `API_PUBLIC_URL` | Construye el enlace de denuncia de incidente del aviso de cambio de email completado (`auth.routes.ts`). Por defecto vale `http://localhost:3000` |
| Funcionamiento general (no específicas de la Fase 0) | `CORS_ORIGIN` y, en el build de la web, `VITE_API_URL` | Origen web permitido por la API y URL de la API en la web. Si no son correctas, la web no puede comunicarse con la API |
| Fechas de la política de la Fase 0 | `EMAIL_VERIFICATION_REQUIRED_FROM` y `EMAIL_VERIFICATION_GRACE_UNTIL` | Clasifican las cuentas. Vacías en el despliegue (etapa 1). Ver el apartado 3 |
| Caducidad de los enlaces | `EMAIL_VERIFICATION_TOKEN_TTL_HOURS` | No clasifica las cuentas. Opcional: vacía vale 24 horas. Con valor, un entero de 1 a 168, o la API no arranca (H18). La decide el RT; en staging puede valer 1 para S6 |

### 6.5 Paso 2 — Copia de seguridad y restauración comprobada

La restauración se ensaya **en un entorno aparte**, nunca sobre producción. La copia restaurada contiene datos reales: se protege igual que la base de producción, con acceso autorizado y sin extraer datos personales a informes. Las consultas son de solo lectura.

**Consistencia de la copia.**
- La API antigua puede seguir escribiendo durante la copia (B2). Por eso el método de copia debe producir **una copia consistente de una base SQLite en uso**.
- Copiar el archivo de la base mientras se escribe, o sin sus archivos auxiliares si la base los usa (por ejemplo, el registro WAL), puede dar una copia incompleta o dañada.
- Este documento no fija el método, que depende del alojamiento. El RT lo aprueba antes del ensayo, y R2 debe detectar una copia dañada.
- **Las escrituras posteriores a B1 no están en la copia.** Si la API antigua sigue en marcha entre B1 y la migración, restaurar B1 las perdería, y además R4 no tiene una referencia temporal exacta (ver «Referencia temporal de R4»). El PP decide si lo acepta o si para la API antigua durante B1–B4 (A10).

| # | Acción | Qué se comprueba | Resultado esperado | Detener si | Rol | Estado |
|---|---|---|---|---|---|---|
| B1 | **Copia de seguridad** de la base de producción, inmediatamente antes de la migración, con el método consistente aprobado | Que el procedimiento de copia termina sin errores. Se anotan la hora, el tamaño y una huella (SHA-256) de cada archivo de la copia | Copia con su huella | Falla | OD | ☐ |
| R1 | Restaurar la copia en un entorno aparte | **Que es la base esperada:**<br>• la huella de lo que se restaura coincide con la anotada en B1;<br>• el historial de migraciones de Prisma de la copia restaurada es el de producción **antes** de la migración, sin `20261106090000_add_email_verification`;<br>• la hora coincide con la anotada en B1 | Coinciden | No coinciden, o falta el historial | OD | ☐ |
| R2 | Comprobar la integridad | **Que se puede leer:** la comprobación de integridad de SQLite sobre la copia restaurada no da errores | Sin errores | Hay errores | OD | ☐ |
| R3 | Comprobar la información esencial | **Que se leen los datos esenciales:** con consultas de solo lectura sobre la copia restaurada se leen las cuentas, sus roles y las sesiones | Lectura correcta | Error de lectura | OD | ☐ |
| R4 | Comprobar los datos principales | **Que los datos principales están presentes,** comparados con un estado de producción **equivalente en el tiempo** a la copia (ver «Referencia temporal de R4», debajo de la tabla):<br>• el número de filas de las tablas principales (usuarios, inmuebles y auditoría, como mínimo) coincide con el de ese estado de referencia, o la diferencia se explica con la reconciliación documentada;<br>• están las cuentas OWNER del inventario O1 | Recuentos iguales a la referencia (formas 1 y 2) o reconciliados y documentados (forma 3) | Faltan tablas o datos; hay una diferencia que la reconciliación no explica; o no existe ninguna referencia temporal válida (**L-5**, que no se marca como superada) | OD y RT | ☐ |
| R5 | Recuperación del servicio | **Que el servicio se recupera en el escenario previsto para la copia:** que falle la migración o la base quede dañada, y haya que volver a la API antigua sobre la base anterior. Se arranca la **API antigua** contra la copia restaurada, en el entorno aparte, y se comprueban `GET /health` y el login de una cuenta de prueba de ese entorno. Usar esta copia en producción no es una reversión ordinaria (apartado 10.3) | Responde y se inicia sesión | No arranca o no responde | OD y QA | ☐ |
| R6 | Tiempo de restauración | La duración de R1 a R5 | Documentada | — | OD | ☐ |

**Referencia temporal de R4.**
- **Instante de referencia:** el instante que captura la copia B1. Con un método de copia consistente, es un único estado de la base. El método aprobado debe indicar cuál es; este documento no lo presupone.
- **Estado de producción en ese instante:** es el que hay que comparar con la copia. Una consulta posterior sobre producción **no** lo representa si la API antigua ha seguido escribiendo: incluye las altas, modificaciones y borrados posteriores.
- **Escrituras posteriores:** el proyecto no tiene ningún registro de transacciones, *snapshot* ni recuperación a un instante que permita reconstruir producción en B1 a posteriori. Este documento no presupone que el alojamiento lo tenga.

Formas válidas de obtener la referencia, en orden de preferencia:
1. **Escrituras detenidas.** La API antigua (y cualquier otro proceso que escriba) está parada desde antes de B1 hasta que se toman los recuentos de producción. Entonces esos recuentos son los del instante de la copia. Requiere la ventana de mantenimiento de A10.
2. **Recuento dentro de la misma lectura consistente que la copia.** Solo si el método de copia aprobado permite tomar los recuentos dentro de esa misma lectura, y está documentado que lo permite. No se presupone.
3. **Reconciliación documentada, parcial.**
   - En las tablas que tengan una fecha de creación, se cuentan en producción las filas creadas hasta el instante de B1 y se comparan con la copia.
   - Esto solo reconcilia **altas**. **No** detecta borrados ni modificaciones posteriores, y depende de que los relojes estén sincronizados (A8).
   - Una diferencia que no se explique así no se atribuye a «escrituras posteriores» sin más.
   - Las tablas sin fecha de creación no se pueden reconciliar por esta vía.

**Si no se puede aplicar la forma 1 ni la 2,** la comprobación de presencia de datos de R4 **solo es parcial** (forma 3). **Si tampoco se puede aplicar la forma 3,** no hay referencia válida. En ambos casos queda la **limitación L-5** (apartado 11.2). Para superarla falta una de estas evidencias:
- una ventana sin escrituras (forma 1);
- la documentación del método de copia que permita la forma 2;
- o un mecanismo del alojamiento que reconstruya el estado en B1, que este documento no presupone.

El PP decide, de forma documentada, si se migra con la presencia de los datos comprobada solo parcialmente.

**Detener el procedimiento** si R1–R5 no se cumplen: sin una restauración comprobada **no se migra**. Si R4 solo es parcial (L-5), tampoco se migra sin la decisión documentada del PP.

### 6.6 Paso 3 — Migración

| # | Acción | Qué se comprueba | Resultado esperado | Detener si | Rol | Estado |
|---|---|---|---|---|---|---|
| B2 | Mantener **parada la API nueva**. La API antigua puede seguir funcionando, porque es compatible con la base migrada, o pararse dentro de la ventana de mantenimiento (A10) | Que ningún proceso con la API nueva está en marcha | Ninguno | Hay alguno | OD | ☐ |
| B3 | `prisma migrate deploy`: **aplica la migración** a la base de producción. No confundir con `prisma generate`, que solo genera el cliente durante el build (A1) y no toca ninguna base | Que el comando termina sin errores | Sin errores | Error. **No se reintenta sin analizarlo.** Ver «Si falla la migración», debajo de la tabla | OD | ☐ |
| B4 | Confirmar la migración | Que el historial de migraciones de Prisma muestra `20261106090000_add_email_verification` aplicada y ninguna otra migración nueva | Solo esa migración nueva | Hay otra o consta como fallida | OD | ☐ |
| B5 | Comprobar la API antigua, si sigue en marcha | `GET /health` y el login de una cuenta de prueba | Funciona | No funciona | OD y QA | ☐ |

**Si falla la migración (B3 o B4).** Este documento **no define ningún procedimiento de reversión de la base de datos**. Solo establece lo siguiente:
1. La API nueva **no se arranca**.
2. Se determina el estado de la base: el historial de migraciones y si la migración consta como fallida o como aplicada a medias.
3. Si la API antigua sigue en marcha, se mantiene solo si funciona (B5). Si no funciona, el servicio queda interrumpido.
4. **Restaurar la copia B1 en producción no es una reversión ordinaria:**
   - pierde las escrituras posteriores a B1;
   - es una decisión aparte del PP, con un análisis previo;
   - se apoya en el ensayo R1–R6.
5. Volver a intentar la migración exige saber por qué falló.

### 6.7 Paso 4 — Publicación del frontend

| # | Acción | Qué se comprueba | Resultado esperado | Detener si | Rol | Estado |
|---|---|---|---|---|---|---|
| C1 | **Desplegar la web nueva**, compatible con la API antigua con degradación (apartado 6.1) | Que el despliegue termina | Publicada | Falla | OD | ☐ |
| C2 | Comprobar la publicación **desde fuera** de la red de despliegue | Que `index.html`, descargado de la URL pública, referencia los recursos con hash anotados en A3. Solo demuestra lo que sirve el punto de acceso consultado: si el alojamiento usa varios servidores o una CDN, no demuestra que todos sirvan ya la versión nueva | Coinciden | No coinciden | OD | ☐ |
| C3 | Comprobar la caché de `index.html` | Las cabeceras de caché con que el alojamiento sirve `index.html`. Se anotan las observadas; no se presuponen | `index.html` se revalida en cada carga o caduca en un plazo que el RT considera aceptable | Validez larga sin revalidación (L-1 se agrava): resolver en el alojamiento antes de seguir | OD y RT | ☐ |
| C4 | Comprobar la reescritura de rutas | Que `/verificar-email` y `/restablecer-contrasena`, abiertas directamente en un navegador nuevo, cargan la web nueva | Cargan | No cargan | OD y QA | ☐ |

**Publicar la web no significa que los usuarios la usen** (apartado 6.2). Este paso solo demuestra el hecho 1.

### 6.8 Paso 5 — Arranque coordinado de la API con `NOT_ENFORCED`

| # | Acción | Qué se comprueba | Resultado esperado | Detener si | Rol | Estado |
|---|---|---|---|---|---|---|
| C5 | **Arrancar la API nueva** con la etapa 1 (las dos variables vacías), desde la fuente única de configuración (A7), y retirar la API antigua | Que todas las instancias que lista la plataforma (A7) arrancan con la API nueva y ninguna sigue con la antigua | Todas con la API nueva | Alguna no arranca, sigue con la antigua o no se puede identificar | OD | ☐ |
| C6 | Compatibilidad, inmediatamente | `GET /health` responde; la web nueva carga; un login y `GET /api/auth/me` con una cuenta de prueba devuelven `emailVerification` con `NOT_ENFORCED`; `/verificar-email` carga y, sin token, ofrece el reenvío | Todo correcto | Falla algo: apartado 10 | OD y QA | ☐ |
| C7 | Comprobaciones posteriores | Apartado 7.5 | Correctas | Falla alguna | QA | ☐ |

Las comprobaciones visuales de la etapa 2 o 3 se hacen **en staging** (apartado 8): el 403 `EMAIL_NOT_VERIFIED` con el formulario de reenvío, el aviso de gracia con su fecha y la acción de auditoría nueva en el panel. **La interfaz no se considera validada** hasta completar esas pruebas visuales: hoy solo está probada la lógica, sin DOM.

### 6.9 Paso 6 — Comprobación de versiones de los clientes

**Con la implementación actual no se puede comprobar qué versión ejecutan los clientes** (H5). Este paso no se puede aprobar con una comprobación superficial. Consiste en documentar el estado y obtener una decisión:

| # | Qué se comprueba | Resultado esperado | Detener si | Rol | Estado |
|---|---|---|---|---|---|
| V1 | Que la publicación (C2–C4) sigue vigente, el día previsto para el paso 7 | Igual que en el paso 4 | Ha cambiado | OD | ☐ |
| V2 | Que ha transcurrido el periodo decidido en A9 desde la publicación | Periodo cumplido | No se ha cumplido | RT | ☐ |
| V3 | Que el soporte tiene la instrucción para los usuarios con la web antigua (apartado 6.2, medida 4) | Preparada | No | RT | ☐ |
| V4 | Que el PP conoce L-1, incluido lo que ni PR-1 ni PR-2 resolverían (apartado 6.2), y la **acepta expresamente** para la etapa 2, o que decide esperar a un cambio futuro (apartado 11.2). Aceptarla no autoriza la etapa 2 (apartado 12) | Decisión documentada | No hay decisión | PP | ☐ |

## 7. Checklist de aceptación

Columnas: qué comprobar, cómo, resultado esperado, condición de aprobación, rol y estado (☐ = pendiente).

### 7.1 Antes de integrar

| Qué | Cómo | Resultado esperado | Aprobado si | Rol | Estado |
|---|---|---|---|---|---|
| Artefactos y hashes | `sha256sum` del diff acumulado; aplicarlo sobre una exportación limpia de `127a0a6` y comparar el árbol | `660a782a…` y árbol `c99d5f65…` | Coinciden | RT | ☐ |
| Revisión de código | Informes de auditoría y hallazgos | Sin defectos bloqueantes | El PP **conoce** todos los riesgos y limitaciones del apartado 11. **Acepta** solo los que se pueden aceptar según sus reglas (convenciones y apartado 11.2), incluida la falta de herramienta administrativa del apartado 4 (L-4). Constancia expresa de que **L-2 no es aceptable ni se puede dispensar** | PP y RT | ☐ |
| Estado del repositorio | `git status` y `git rev-parse HEAD` | `feat/keys`, `127a0a6`, limpio | Coincide | RT | ☐ |
| Aprobación expresa | Autorización escrita del PP con el SHA | Autorización recibida | Existe | PP | ☐ |

### 7.2 Antes de desplegar (pasos 1 a 5)

| Qué | Cómo | Resultado esperado | Aprobado si | Rol | Estado |
|---|---|---|---|---|---|
| Preparación técnica | Paso 1 (A1–A10) | Completo | Sin ninguna condición de parada | OD y RT | ☐ |
| Restauración comprobada | Paso 2 ensayado antes del día del despliegue (R1–R6 sobre una copia reciente) y repetido con la copia B1 del día | Las cuatro comprobaciones de 6.5 correctas, con R4 frente a una referencia temporal válida | Correctas, o R4 parcial (L-5) con la decisión documentada del PP | OD | ☐ |
| Migración | Ensayo de `prisma migrate deploy` sobre una copia restaurada de producción, en el entorno aparte | Se aplica sin errores; B4 correcto; la API antigua arranca sobre la copia migrada | Sin errores ni pérdida de datos | OD | ☐ |
| Orden de despliegue | Plan escrito que siga el apartado 6.3 | Plan revisado | El RT lo aprueba | RT | ☐ |
| Ensayo en staging | S14, S15 y S18 (apartado 8) | Correctos | Correctos | QA | ☐ |
| OWNER | Apartado 5, O1–O4 (obligatorio antes del paso 7; recomendable ya en el despliegue) | Todo cumplido | Todo cumplido | RT | ☐ |

### 7.3 Antes de preparar las instancias para la etapa 2 (paso 7)

| Qué | Cómo | Resultado esperado | Aprobado si | Rol | Estado |
|---|---|---|---|---|---|
| Versiones de los clientes | Paso 6 (V1–V4) | Completo | L-1 aceptada expresamente por el PP | PP y RT | ☐ |
| Instancias y evidencia | A7, actualizado | Documentado | La plataforma ofrece E1–E4 del apartado 9.5 para todas las instancias, sean una o varias, incluidas las que se creen o se reinicien después de I0 | OD y RT | ☐ |
| Garantía de admisión GA | Evidencia documentada de la capacidad de la plataforma o del procedimiento operativo que impide que una instancia nueva, reiniciada o sustituida reciba tráfico antes de superar E2 y E3, aplicable a todas las formas de entrada en servicio, y ensayada en staging (S17) (apartado 9.5) | Evidencia documentada | Existe y está ensayada. Si no, **L-2 sigue abierta y bloquea la activación**. E1–E4 no la sustituyen.<br>**GA es obligatoria, pero no suficiente por sí sola.** Que GA esté acreditada y ensayada no cierra L-2 ni sustituye ninguna de las ocho evidencias de «Evidencia que cerraría L-2» (apartado 9.5). Ni la referencia a S17 ni la cobertura de las formas de admisión sustituyen a las demás. La autorización exige el conjunto completo, incluido el **mecanismo de acceso a la instancia retenida** y el **ensayo representativo** según las condiciones de staging de 9.5 | OD, RT y PP | ☐ |
| *T_act* | Valor decidido según los apartados 3.2 y 9.3: futuro, con zona horaria y con el margen de preparación decidido | *T_act* y margen documentados | El PP los aprueba | PP | ☐ |
| OWNER verificados | O1–O6 repetidos justo antes | Todos `VERIFIED` | Todos (regla de parada O6) | OW y RT | ☐ |
| Registro y verificación | Prueba en staging con la etapa 2 (S1, S3–S6) y ensayo del procedimiento con *T_act* futuro (S17) | Correctos | Correctos | QA | ☐ |
| Recuperación | `forgot-password` y E2 en staging (S9, S10) | Correctas (apartado 8) | Correctas | QA | ☐ |
| Comunicación | Aviso a los usuarios con la fecha de *T_act*, si procede | Comunicado | Enviado o descartado por el PP | PP | ☐ |

**Sobre el recuento de la v2.** P5 (apartado 9.6) usa dos consultas de solo lectura, que no son equivalentes:

| Consulta | Condición | Qué cuenta | Uso |
|---|---|---|---|
| **P5-a** | `createdAt >= T_act AND emailVerifiedAt IS NULL` | Las cuentas que quedarían `REQUIRED` en cuanto una instancia con la configuración las evalúe. Es la consulta de la v2 | Diagnóstico antes de *T_act*; dato informativo después |
| **P5-b** | `createdAt >= T_act` | Todas las cuentas con fecha de creación igual o posterior a *T_act*, verificadas o no | Métrica diagnóstica independiente, solo antes de *T_act*. Una cuenta verificada no queda bloqueada, pero su existencia antes de *T_act* revela el mismo tipo de anomalía (relojes, valor de *T_act* o datos) |

- **Ninguna de las dos es un control de seguridad.** Su resultado puede quedar obsoleto en cuanto se ejecutan (apartado 9.1). Tampoco demuestran la configuración de ninguna instancia ni que una instancia mal configurada no haya atendido peticiones (L-2).
- **Antes de *T_act*,** con relojes sincronizados y las consultas bien escritas, las dos deben dar 0. Otro resultado es una **anomalía que se investiga** (apartado 9.6), no una condición de parada por sí misma ni una prueba de que la configuración sea incorrecta.
- **Después de *T_act*,** P5-a da el número de cuentas nuevas sin verificar, que es el resultado esperado de la política y no un error. P5-b deja de tener sentido diagnóstico.

### 7.4 Antes de terminar la gracia (paso 9: fijar *T_fin* y alcanzarlo)

| Qué | Cómo | Resultado esperado | Aprobado si | Rol | Estado |
|---|---|---|---|---|---|
| Cuentas existentes | Consulta de solo lectura autorizada: existentes sin verificar | Número observado y documentado | El PP lo conoce y decide expresamente seguir | RT y PP | ☐ |
| OWNER verificados | O1–O6 | Todos `VERIFIED` | Todos | OW y RT | ☐ |
| SMTP operativo | Envío de prueba reciente a un buzón de prueba | Recibido | Correcto | QA | ☐ |
| Recuperación probada | Reenvío desde el login con una cuenta de prueba en `REQUIRED` (staging, S3) | Llega el enlace y verifica | Correcto | QA | ☐ |
| Clientes antiguos | Paso 6 repetido para *T_fin* (apartado 6.2, medida 3) | Decisión documentada | L-1 aceptada expresamente por el PP para el fin de la gracia (etapas 3 y 4), aparte de la aceptación de la etapa 2 | PP | ☐ |
| Instancias, evidencia y GA | A7 actualizado y el **conjunto completo de las ocho evidencias** de «Evidencia que cerraría L-2» (apartado 9.5): E1–E4, GA, el mecanismo de acceso a la instancia retenida, la cobertura de todas las formas de incorporación y el ensayo representativo. Todas las instancias sujetas al procedimiento cumplen las condiciones de admisión aplicables. E1–E4 y la acreditación de GA no bastan por sí solas | Documentado | Las ocho evidencias disponibles. Si falta cualquiera, **L-2 sigue abierta** y no hay autorización para activar ni para terminar la gracia | OD y RT | ☐ |
| Soporte preparado | Instrucciones para las cuentas que no reciben el enlace y para las que tengan la web antigua. No hay herramienta administrativa (apartado 4): el soporte solo puede ayudar a recuperar el acceso al buzón, a pedir un enlace nuevo o a abrir la web nueva | Procedimiento conocido | Definido | RT | ☐ |

### 7.5 Después del despliegue (y de cada cambio de etapa)

**Reglas para las pruebas en producción:**
- **Solo se usan cuentas de prueba controladas,** creadas para este fin, identificadas por su dirección, con buzones de prueba y con un responsable. Se documenta su lista.
- **Nunca se bloquea a un usuario real** ni se provoca deliberadamente una situación de bloqueo para demostrar la política. No se cambian la configuración ni las fechas para forzar un caso. Los casos que lo exigen (S6, S8 y S12 con un *T_fin* cercano) solo se prueban en staging.
- No se lanza `forgot-password`, E2 ni la denuncia de incidente sobre cuentas reales.
- **El enlace de denuncia de incidente no se abre en producción,** porque actúa sobre la cuenta: la protege y le cierra las sesiones (H17). Como E2 empieza con ese enlace, **el ciclo E2 completo solo se prueba en staging** (S9).
- Qué hacer después con las cuentas de prueba (conservarlas o retirarlas) es una decisión aparte del RT.

| Qué | Cómo | Resultado esperado | Aprobado si | Rol | Estado |
|---|---|---|---|---|---|
| Health check | `GET /health` | Responde | Correcto | OD | ☐ |
| Compatibilidad web y API | Paso 5, C6 | Web y API nuevas publicadas | Correcto | QA | ☐ |
| Registro y login | Cuentas de prueba | Según la etapa (apartado 4) | Correcto | QA | ☐ |
| `/me` | Inspector de red, con una cuenta de prueba | `emailVerification.status` según la etapa; 403 en `REQUIRED` | Correcto | QA | ☐ |
| Verificación del email | Enlace válido y enlace ya usado, con una cuenta de prueba | 200 y «ya usado» (el caducado, solo en staging: S6) | Correcto | QA | ☐ |
| Auditoría | Panel de administración, con un OWNER | El filtro ofrece la acción nueva («Aviso de cambio de email no enviado») y el panel carga. Si no hay filas de esa acción, se anota así: no se fuerza ningún fallo en producción (S8, solo en staging) | Correcto | QA | ☐ |
| Sesiones (solo al llegar *T_fin*, paso 9) | Sesión abierta de una cuenta de prueba **existente** sin verificar, al alcanzarse *T_fin* de forma natural. Una cuenta creada después de *T_act* nunca tiene sesión, porque el registro no la abre | Se cierra en la siguiente petición | Correcto | QA | ☐ |
| Recuperación de contraseña | `forgot-password` con una cuenta de prueba elegible, una dirección inexistente de un dominio de prueba y una cuenta de prueba no elegible | Misma respuesta; solo la elegible recibe el correo | Correcto | QA | ☐ |
| Recuperación E2 | **No se prueba en producción** (reglas de arriba). Solo se comprueba que el caso S9 de staging está aprobado | S9 aprobado | Correcto | RT | ☐ |
| Logs sin datos sensibles | Revisar los logs tras las pruebas (atención a P-08) | Sin tokens ni enlaces; las posibles direcciones, identificadas | Aceptado por el RT | RT | ☐ |

## 8. Validación en staging

Requisitos:
- un entorno de staging con una base **propia** (nunca la de producción);
- el SMTP de pruebas o el real con buzones de prueba;
- cuentas y correos de prueba (dominios de prueba, sin datos reales);
- la misma versión y configuración en todas las instancias, con los relojes sincronizados;
- **el mismo orden de despliegue que en producción** (apartado 6.3);
- en staging sí se pueden usar valores cercanos de *T_act* y *T_fin* y forzar fallos, con cuentas de prueba.

Staging no es producción: estas pruebas no sustituyen a las del apartado 7.5. Las pruebas automáticas no sustituyen a estas pruebas visuales. Este documento no envía ningún correo: los envíos se hacen al ejecutar el procedimiento, con autorización.

| # | Caso | Etapa | Pasos | Resultado esperado |
|---|---|---|---|---|
| S1 | Registro nuevo | 2 | Registrarse | 201 sin sesión, mensaje «Revisa tu correo» y enlace recibido |
| S2 | Login de una cuenta verificada | 2–4 | Iniciar sesión | Entra, sin aviso |
| S3 | Login de una cuenta sin verificar | 2 (nueva) o 4 (existente) | Iniciar sesión | 403 `EMAIL_NOT_VERIFIED` con el formulario de reenvío |
| S4 | Reenvío | 2 | Pedir el enlace dos veces en menos de un minuto, y otra vez pasado el minuto | Primero llega; el segundo no; el tercero sí y anula el anterior |
| S5 | Enlace válido | 2 | Abrir y pulsar «Verificar mi email» | Verificado, sin sesión; después, el login entra |
| S6 | Enlace caducado | 2 | Usar un enlace caducado (`EMAIL_VERIFICATION_TOKEN_TTL_HOURS=1` en staging) | «Ha caducado», con el reenvío |
| S7 | Cambio de email | 3 | Una cuenta en `GRACE` cambia el email con el código | Cambio hecho, `VERIFIED` y el aviso desaparece; el aviso «completed» llega a la dirección anterior |
| S8 | Fallo del aviso de seguridad | 3 | Simular el fallo del SMTP solo para el aviso, en staging | 200 con «…no hemos podido enviar el aviso…»; acción «Aviso de cambio de email no enviado» en el panel |
| S9 | Recuperación obligatoria (E2) | 2–3 | Incidente, retirada con destino y finalización | Con la misma dirección se conserva la verificación; con otra, sin verificar; los enlaces previos dejan de servir |
| S10 | Recuperación de contraseña | 1–4 | Elegible, inexistente, no elegible y SMTP caído | Misma respuesta; solo la elegible recibe el correo |
| S11 | OWNER verificado | 2–4 | Entrar a `/admin` | Acceso |
| S12 | Sesión abierta al terminar la gracia | 3 → 4 | Sesión abierta y *T_fin* alcanzado (con un *T_fin* cercano en staging) | La siguiente petición protegida cierra la sesión; `/me` da 403 y el login pide verificar |
| S13 | Aviso de gracia | 3 | Una cuenta existente sin verificar entra | Aviso con la fecha de *T_fin* (en la hora local del navegador) |
| S14 | Orden de despliegue y reversión | 1 | Ensayar los pasos 3 a 5 y la reversión de versiones del apartado 10.3, con la comprobación previa del apartado 10.2 | Las combinaciones que se usan son compatibles y `GET /health` responde después de cada paso |
| S15 | Enlace de correo desde un navegador externo | 1–2 | Recibir el correo de verificación en un buzón de prueba y abrir el enlace **en un navegador y una red ajenos al entorno de staging** (por ejemplo, otro dispositivo con otra conexión), sin sesión previa. Comprobar el dominio del enlace antes de abrirlo. Repetir con el enlace de restablecimiento | El enlace usa el dominio público de la web; carga la **web nueva** (no la antigua ni `localhost`); el flujo se completa con la cuenta de prueba (verificada; contraseña cambiada) |
| S16 | Pestaña con la web antigua | 1 → 4 | Con una pestaña abierta con la web antigua antes de publicar la nueva, pasar a la etapa 2 con una cuenta de prueba nueva y a la etapa 4 (con un *T_fin* cercano) con una existente | Se observa y se documenta el comportamiento de H8 (registro sin mensaje, login sin reenvío). Se comprueba que una pestaña nueva y el enlace del correo cargan la web nueva y permiten verificar. **Es una demostración de L-1, no una prueba que la resuelva** |
| S17 | Preparación con *T_act* futuro | 1 → 2 | Fijar un *T_act* futuro cercano, reiniciar las instancias antes de esa hora y aplicar las comprobaciones del paso 7. Registrar una cuenta de prueba antes de *T_act* y otra después. Obtener I0 tras el reinicio. Reiniciar una instancia después de I0 y, si la plataforma lo permite, crear otra, aplicándoles la regla del apartado 9.5. Ensayar el mecanismo de GA, si existe, y comprobar que la instancia no recibe tráfico antes de superar E2 y E3 | Antes de *T_act*: `/me` da `GRACE` (no `NOT_ENFORCED`) y la cuenta registrada entra. Después: la cuenta nueva queda `REQUIRED` y la anterior sigue `GRACE`. Se confirma qué evidencias E1–E4 ofrece realmente la plataforma de staging, que puede no ser la de producción, y si GA existe y funciona. Si no existe, se documenta: **L-2 sigue abierta**. Si hay varias instancias, el resultado se observa en cada una (apartado 9.5) |
| S18 | Restauración de la copia | — | Pasos R1–R6 del apartado 6.5 con una copia de la base de staging | Las cuatro comprobaciones correctas y la API arranca sobre la copia restaurada |

## 9. Activación de la política (problema crítico 2)

### 9.1 Por qué la consulta previa no basta

La v2 proponía contar las cuentas con `createdAt >= T_act` y `emailVerifiedAt IS NULL` justo antes de activar, y esperar 0. **No evita la carrera:**
1. La consulta devuelve 0.
2. Se registra una cuenta: la instancia, todavía sin la política, le abre sesión.
3. Se reinicia la instancia con `REQUIRED_FROM = T_act`.
4. Como esa cuenta tiene `createdAt >= T_act`, queda `REQUIRED` de inmediato y su sesión se cierra.

Con varias instancias reiniciadas en momentos distintos, el periodo en el que la configuración está mezclada puede ser largo.

**Hechos del código que delimitan el problema** (apartados 2.1 y 3.1):
- el estado de una cuenta no se guarda: se recalcula en cada comprobación (H12);
- la configuración se lee y se valida al arrancar cada proceso, y solo cambia al reiniciar. Procede del entorno que la plataforma da al proceso y, para las variables que no defina, de un `.env` (H16);
- las fechas se comparan como instantes absolutos;
- la clasificación de una cuenta depende de su `createdAt`, que no cambia, y de *T_act*, que es fijo: no depende de la hora actual. La hora actual solo interviene con `GRACE_UNTIL`;
- no hay ningún mecanismo para bloquear el registro, entrar en mantenimiento o drenar tráfico (H13);
- ningún endpoint muestra la configuración cargada (H14).

**Consecuencia:** el riesgo no está en el instante en que se consulta, sino en **si existe algún momento, a partir de *T_act*, en que una instancia sin la configuración atiende peticiones**.

### 9.2 Efecto de una configuración mezclada

| Momento | Instancia con `REQUIRED_FROM = T_act` | Instancia todavía en la etapa 1 | ¿Diferencia relevante? |
|---|---|---|---|
| **Antes de *T_act*** | Cuentas sin verificar: `GRACE` (entran, con aviso). Registro: abre sesión, porque `createdAt < T_act` | `NOT_ENFORCED` (entran, sin aviso). Registro: abre sesión | **No.** Las dos dan acceso; solo cambia la aparición del aviso |
| **Después de *T_act*** | Cuenta creada desde *T_act*: `REQUIRED` | La misma cuenta: `NOT_ENFORCED` (entra) | **Sí.** Según qué instancia atienda, la cuenta entra o se le cierra la sesión |

### 9.3 Alternativa A: *T_act* futuro, cargado de antemano (recomendada)

**Procedimiento:**
1. Fijar en la fuente única de configuración `REQUIRED_FROM = T_act`, con *T_act* futuro.
2. Reiniciar todas las instancias.
3. Comprobar que **todas** han cargado la configuración **antes de *T_act***, con el margen decidido por el PP.

**Por qué evita la carrera:**
- Todos los reinicios ocurren antes de *T_act*, cuando la mezcla es inocua (apartado 9.2).
- Al llegar *T_act* no se reinicia nada: la política empieza a aplicarse sola, con una configuración idéntica en todas las instancias.
- **Siempre que todas las instancias en servicio desde *T_act* tengan la configuración** (apartado 9.5), una cuenta creada desde *T_act* queda `REQUIRED` en cualquier instancia que la evalúe. La respuesta del registro, que usa el mismo `createdAt` guardado (H12), ya le indica que verifique, y no hay ninguna sesión que después se cierre.
- La seguridad del procedimiento descansa en la evidencia de configuración y en la garantía de admisión GA del apartado 9.5, no en ninguna consulta. Las consultas P5-a y P5-b son solo diagnósticas (apartado 7.3).

**Qué ocurre con cada tipo de cuenta:**
- **Cuentas creadas antes de *T_act*,** incluidas las registradas entre el reinicio y *T_act*: son **existentes** y quedan `GRACE`. Entran y ven el aviso sin fecha, desde el reinicio. Pasarán a `REQUIRED` solo si se fija y se alcanza *T_fin* (paso 9).
- **Cuentas creadas desde *T_act*:** son **nuevas** y quedan `REQUIRED` hasta verificar. Reciben el enlace al registrarse (H10).

**Condiciones, todas obligatorias:**
- una **fuente única de configuración**, que también usen las instancias que arranquen más tarde (A7);
- **relojes sincronizados** (A8). Cerca de *T_act*, un desfase solo decide a qué lado de *T_act* queda una cuenta. Como la decisión del registro y la de todas las instancias usan el mismo `createdAt` guardado, el resultado es coherente. Pero un desfase grande clasifica mal las cuentas: no hay tolerancia definida y no se inventa;
- **evidencia de que cada instancia ha cargado la configuración** antes de *T_act* (E1–E4 del apartado 9.5);
- **la garantía de admisión GA** (apartado 9.5): ninguna instancia nueva, reiniciada o sustituida recibe tráfico antes de comprobarla. Sin GA, las comprobaciones llegan después del tráfico y L-2 sigue abierta;
- **un margen** entre la carga y *T_act* suficiente para comprobarlo todo y, si algo falla, deshacerlo antes de *T_act* (apartado 9.6). Lo decide el PP.

**Coste:**
- las cuentas que se registren entre la carga y *T_act* no tienen que verificar de inmediato;
- las cuentas existentes sin verificar ven el aviso desde la carga.

Por eso conviene que el margen sea el mínimo suficiente.

### 9.4 Alternativa B: activación inmediata (*T_act* = *ahora*)

**La carrera solo desaparece si no hay ninguna instancia sin la configuración atendiendo peticiones desde *T_act*.** No hay ningún mecanismo de bloqueo del registro, mantenimiento ni drenaje (H13). Ninguna consulta lo sustituye. Las combinaciones posibles:
- **Varias instancias, o una plataforma que arranca la instancia nueva antes de parar la antigua:** siempre hay un periodo de configuración mezclada a partir de *T_act*. **No es viable sin un mecanismo que no existe.**
- **Una sola instancia, si se ha comprobado que la plataforma la para antes de arrancarla:**
  1. parar la API;
  2. confirmar que ningún proceso atiende peticiones;
  3. fijar *T_act* igual o posterior al instante de la parada, tomado de un reloj sincronizado;
  4. arrancar.

  Mientras la API está parada no se crea ninguna cuenta. Es **viable en teoría**, pero implica una interrupción del servicio, depende de un comportamiento de la plataforma no confirmado (H4) y depende de que el reloj del operador y el de la instancia coincidan. **No aporta nada respecto a A.**

**B también exige GA y L-2 cerrada.**
- En el caso de una sola instancia, la instancia arrancada en el punto 4 de la lista anterior («arrancar») entra en servicio **después** de *T_act*. Es exactamente el escenario que GA debe cubrir (apartado 9.5).
- Antes de ponerla en servicio, L-2 debe estar cerrada, con GA acreditada y ensayada (apartado 7.3). La instancia no debe recibir tráfico hasta superar E2 y E3.
- **No es viable** arrancarla sin la garantía previa de que no recibirá tráfico antes de esas comprobaciones.
- **Sin GA, la alternativa B no es viable** y no permite superar L-2. Parar y arrancar no sustituye a GA.

**Valoración:** B no se recomienda. Solo puede usarse en el caso de una sola instancia descrito arriba, si el PP renuncia expresamente a A, el comportamiento de la plataforma está comprobado en staging y **L-2 está cerrada con el conjunto de evidencias del apartado 9.5**, GA incluida. Las mismas condiciones de los apartados 9.5, 9.6 y 12 se aplican a B.

### 9.5 Alternativa C: varias instancias

- **Un reinicio escalonado no es seguro por sí mismo.** Solo es aceptable si termina **antes de *T_act*** (alternativa A), porque entonces la mezcla es inocua (apartado 9.2).
- **Hay que demostrar que cada instancia cargó la configuración, y que ninguna atiende peticiones antes de demostrarlo.** Ningún endpoint expone la configuración (H14), y `GET /health` no la refleja (H19). Se distinguen cuatro cosas, que no se cubren entre sí:

| Qué se necesita | Cómo se obtiene | Lo que **no** aporta |
|---|---|---|
| **Detectar** una instancia nueva, reiniciada o sustituida | E4 | Ni su configuración ni su comportamiento |
| **Conocer su configuración** | E1 y E2 | Que la aplique de verdad |
| **Comprobar su comportamiento funcional** | E3 | Nada sobre las peticiones que atendió **antes** de la comprobación |
| **Garantizar que no recibe tráfico hasta superar las comprobaciones** | **GA**, garantía de admisión. **El proyecto no la tiene** | — |

**Evidencias E1–E4.** Aportan información, pero ninguna es una garantía de seguridad:

| # | Evidencia | Qué demuestra | Qué no demuestra | Fuente |
|---|---|---|---|---|
| E1 | **Valor configurado:** el valor de `EMAIL_VERIFICATION_REQUIRED_FROM` (o de `GRACE_UNTIL`) en la configuración de la plataforma, revisado por dos personas, y la ausencia de otras fuentes de configuración locales o montadas no autorizadas (`.env`; `.env.vault` y `DOTENV_KEY` según los escenarios A–D), verificada en A4. Si A4 está pendiente (escenario D), E1 tampoco está completa | Lo que **debería** cargar un proceso que arranque con esa configuración | Que algún proceso lo haya cargado de verdad | Plataforma y artefacto |
| E2 | **Arranque posterior al cambio:** cada proceso arrancó después del cambio de E1 y con esa configuración, o con la versión de despliegue que la contiene | Que el proceso pudo leer el valor nuevo | Que lo aplique, si la plataforma da otro entorno a ese proceso, ni lo que hizo antes de comprobarlo | Plataforma (A7) |
| E3 | **Efecto funcional por instancia,** dirigido a esa instancia (si es una instancia retenida por GA, mediante el mecanismo de acceso descrito debajo de la tabla), con una **cuenta de prueba controlada** que cumple todas estas condiciones:<br>&nbsp;&nbsp;– su correo **no está verificado**;<br>&nbsp;&nbsp;– se creó **antes del valor efectivo de `REQUIRED_FROM`** (*T_act*), y por tanto es una cuenta existente. Crearla antes de la carga no basta si `REQUIRED_FROM` fuera anterior a la carga;<br>&nbsp;&nbsp;– se creó **antes de la carga de la configuración** que se comprueba;<br>&nbsp;&nbsp;– es una cuenta controlada, identificada en la lista de 7.5, que se mantiene sin verificar durante ambas comprobaciones;<br>&nbsp;&nbsp;– se usa **la misma cuenta** para la comprobación anterior a *T_fin* y para la posterior, **sin sustituirla por otra** entre las dos fases.<br>Su `createdAt` se anota, y su relación con *T_act* se contrasta con E1. Depende del momento:<br>• **Antes de *T_fin*:** `GET /api/auth/me` con una sesión de esa cuenta devuelve `emailVerification.status = "GRACE"`, lo que implica que `REQUIRED_FROM` es posterior a su `createdAt`. En la etapa 2, `graceUntil` es `null`; en la etapa 3, `graceUntil` coincide exactamente con *T_fin*.<br>• **Después de *T_fin*:** el **intento de inicio de sesión** con esa cuenta devuelve HTTP 403 con el código `EMAIL_NOT_VERIFIED`. No se exige que siga disponible una sesión anterior ni se usa `/me` como requisito, porque una cuenta `REQUIRED` no mantiene la sesión | Antes de *T_fin*, con `GRACE`: `REQUIRED_FROM` está definido, es **posterior** al `createdAt` de la cuenta de prueba y `GRACE_UNTIL` está vacía o es futura; en la etapa 3, el **valor exacto** de *T_fin* (H14). Después de *T_fin*, con el 403: la instancia **bloquea** a las cuentas sin verificar. Una instancia en `NOT_ENFORCED` permitiría iniciar sesión | **No demuestra el valor de `REQUIRED_FROM`**, que solo acota y se completa con E1. **Después de *T_fin*, tampoco demuestra el valor exacto de *T_fin***: se verifica con E1 y la evidencia de configuración. No demuestra cómo se comportó la instancia antes de la prueba | Prueba manual. Requiere que la plataforma permita dirigir la petición a una instancia concreta |
| E4 | **Inventario de instancias:**<br>• el **inventario inicial I0**, que es la lista de las instancias en servicio obtenida **inmediatamente después de P3**;<br>• el **registro de cambios desde I0:** altas, reinicios, sustituciones y bajas | Las instancias que la plataforma permite ver, y cuándo cambiaron | Que el inventario sea completo si la plataforma no lo garantiza. Es una consulta o un procedimiento **manual**, que no se presupone automático. Tampoco demuestra si una instancia atendió peticiones antes de comprobarla | Plataforma (A7) |

**Orden temporal:**
1. P3: reiniciar todas las instancias.
2. Obtener I0.
3. P4: E1–E3 para cada instancia de I0.
4. Desde I0, registrar cada alta, reinicio, sustitución o baja, durante la preparación y el seguimiento (T1, T7 y G3).

Una instancia que aparece después de I0 no está comprobada por P4: necesita E2 y E3 propios.

**Garantía de admisión (GA).**
- **Qué exige:** que una instancia nueva, reiniciada, sustituida o reincorporada **no se incorpore al tráfico de usuarios** hasta haber superado E2 y E3, y que esto se pueda verificar. Solo así lo que comprueban E1–E4 coincide con lo que han vivido los usuarios.
  - Se aplica a **cualquier forma de entrada en servicio:** reinicio, despliegue, sustitución, escalado automático, recuperación tras un fallo y reversión, incluida la de la plataforma, además de las altas nuevas.
  - **Si una instancia presenta `REQUIRED_FROM` ausente o distinto del autorizado (E1), no se incorpora al tráfico.** Se aborta su incorporación y se aplica el procedimiento de incidente o reversión de los apartados 9.6 y 10.1.
- **Cuándo es obligatoria:**
  - **Antes de T1:** la mezcla de configuraciones es inocua (apartado 9.2), porque todavía no se aplica ningún bloqueo. Los reinicios de P3 y las altas anteriores a T1 se comprueban después, en P4 y T1.
  - **Desde T1 y, en todo caso, después de *T_act*:** cualquier instancia nueva, reiniciada, sustituida o reincorporada pasa por GA **antes** de recibir tráfico.
  - Esto incluye **los reinicios planificados de G3** (apartado 9.8) y **los de una reversión** (apartados 10.1 y 10.3). En esos casos se comprueba frente a la configuración de destino. No hay excepciones.
- **Acceso a una instancia retenida.** Superar E3 antes de recibir tráfico exige que la plataforma ofrezca **un mecanismo para dirigir la comprobación a la instancia retenida, sin que reciba tráfico de usuarios**. Este documento no presupone que exista ni cómo funcionaría en ningún proveedor. Si no existe, GA no se puede cumplir, aunque la plataforma sí pueda retener la instancia.
- **Puede proceder** de una capacidad de la plataforma o de un procedimiento operativo equivalente. Este documento **solo la considera disponible si hay evidencia documentada** de que existe y de cómo se usa en la plataforma real, y de que se ha ensayado en staging (S17). No presupone ningún mecanismo concreto, y el proyecto no aporta ninguno:
  - `/health` no comprueba la política (H19);
  - no hay drenaje de tráfico (H13);
  - no hay ningún endpoint de configuración (H14).
- **Lo que sí garantiza el código:** una configuración **no válida** impide arrancar (apartado 3.1), así que una instancia con fechas mal escritas no atiende tráfico. Pero una configuración **válida y distinta** (vacía, otro *T_act*, un `.env` antiguo) arranca y atiende con normalidad.
- **Intervalo de riesgo sin GA:**
  - va desde que la instancia empieza a atender peticiones hasta que se completan E2 y E3 para ella;
  - si es después de *T_act* y la instancia no tiene la configuración, durante ese intervalo da acceso a cuentas nuevas sin verificar que las demás instancias bloquean;
  - en el paso 9 ocurre lo mismo a partir de *T_fin*, con las cuentas existentes;
  - ninguna comprobación posterior puede saber qué peticiones atendió en ese intervalo.
- **Evidencia que cerraría L-2.** El cierre exige **todo el conjunto**:
  1. **E1:** el valor configurado, verificado por los responsables (dos personas), sin otras fuentes no autorizadas (A4);
  2. **E2:** cada proceso arrancó con la configuración autorizada;
  3. **E3:** la comprobación funcional individual de cada instancia;
  4. **E4:** el inventario y el historial de instancias, con la cobertura exigida;
  5. **GA:** la garantía real de admisión, con la documentación de la capacidad o del procedimiento que impide que una instancia reciba tráfico de usuarios antes de superar los controles exigidos;
  6. el **mecanismo de acceso a la instancia retenida**, que permite ejecutar E3 antes de admitirla;
  7. la **cobertura acreditada** de todas las formas en que una instancia entra en servicio (despliegue, reinicio, escalado automático, sustitución, recuperación y reversión, incluida la de la plataforma);
  8. el **ensayo documentado** (S17), con evidencia representativa de producción según las condiciones de staging de debajo.

  **Ni E1–E4 por sí solos ni GA considerada de forma aislada,** sin la evidencia por instancia, cierran L-2. Solo la cierra el conjunto de los puntos 1 a 8.

  **Un ensayo en staging solo cuenta como evidencia para producción si se cumplen tres condiciones:**
  - el mecanismo de admisión es el mismo que se usará en producción;
  - la configuración de la plataforma es materialmente equivalente;
  - la evidencia permite justificar que el resultado es representativo de producción.

  Si no se cumplen, un ensayo satisfactorio en staging **no demuestra GA en producción**.

  E1–E4, por sí solos, **no** cierran L-2.

  **L-2 no se puede aceptar ni dispensar mediante ninguna decisión administrativa.** Un cambio de código futuro podría **contribuir** a cerrarla si implementa un mecanismo real de admisión de instancias, pero **por sí solo no la cierra**. El cierre exige evidencia verificable de que ninguna instancia nueva, reiniciada o sustituida puede recibir tráfico antes de superar los controles exigidos.

- **Repetir la petición de E3 a través del balanceador no demuestra que se hayan cubierto todas las instancias**, ni siquiera con muchas repeticiones.
- **Con una sola instancia** la comprobación es más sencilla, pero E4 y GA siguen haciendo falta: sin ellas no se sabe si la plataforma la ha sustituido o ha añadido otra, ni si esa otra atendió peticiones antes de comprobarla.
- **Una fuente única de configuración no garantiza por sí sola** que cada proceso nuevo reciba la configuración correcta. Depende de cómo la plataforma da el entorno a cada proceso (A7) y del `.env` (H16).
- **Mientras no haya evidencia de GA,** o si la plataforma no ofrece E2 y E4 o no permite E3 para cada instancia, **L-2 sigue abierta y bloquea** la activación y el fin de la gracia, haya una instancia o varias.

**Instancias nuevas, reiniciadas o sustituidas.** Regla general: cualquier instancia que entre en servicio después de I0 debe figurar en E4 y superar E2 y E3. **Con GA,** eso ocurre antes de que reciba tráfico. **Sin GA,** ocurre después, y el intervalo de riesgo queda abierto. Por eso, sin GA, la activación sigue bloqueada (L-2).

| Escenario | Riesgo | Condición operativa | Detener si |
|---|---|---|---|
| Se crea una instancia después de I0 y antes de T1 | Bajo si se corrige antes de *T_act*: la mezcla todavía no tiene efecto (apartado 9.2). Alto si sigue sin comprobar al llegar *T_act* | E2 y E3 para esa instancia antes de *T_act* menos el margen (T1) | No se puede comprobar a tiempo: se aborta (apartado 9.6) |
| Se reinicia una instancia después de I0 y antes de T1 | Igual que el anterior | Igual que el anterior | Igual que el anterior |
| Se crea o se reinicia una instancia entre T1 y *T_act*, o se crea después de *T_act* (por ejemplo, por autoescalado) | **Alto** si arranca con otra configuración: da acceso a cuentas que otras instancias bloquean, desde que recibe tráfico hasta que se comprueba | **GA**: no recibe tráfico hasta superar E2 y E3. Sin GA, la condición no se puede cumplir: solo se detecta a posteriori con E4. El proyecto no tiene ningún mecanismo para impedir la creación ni avisar de ella | Sin GA: L-2 abierta y activación bloqueada. Si ya se activó y aparece una instancia con otra configuración: «Si *T_act* llega, o pasa, con una instancia sin comprobar» (apartado 9.6) |
| Se reinicia una instancia después de *T_act* | **Riesgo no controlado hasta comprobarla y admitirla.**<br>• La configuración esperada no demuestra la configuración efectiva, y la ausencia de cambios conocidos no sustituye la comprobación individual.<br>• Si la configuración efectiva resulta ser la autorizada, el reinicio no cambia ninguna decisión (apartado 3.1). Pero eso solo se sabe después de E2 y E3.<br>• Si no lo es, el riesgo es alto: da acceso a cuentas que otras instancias bloquean.<br>• **Sin GA no se puede garantizar** que la instancia permanezca fuera del tráfico durante las comprobaciones. No puede recibir tráfico de usuarios antes de superar las condiciones obligatorias | **La instancia reiniciada permanece fuera del tráfico de usuarios hasta superar E2 y E3 y cumplir GA**, **aunque se espere** que arranque con la misma configuración que las demás. Ni la configuración esperada ni la ausencia de cambios sustituyen la comprobación individual ni la garantía de admisión. Se aplica igual a los reinicios de G3 (apartado 9.8), de una reversión (apartado 10.1) y de X3 (apartado 10.3), frente a la configuración de destino | **`REQUIRED_FROM` ausente o incorrecto:** la instancia **no se incorpora**, se aborta su incorporación y se aplica el apartado 9.6 («Si *T_act* llega, o pasa…») o la reversión del apartado 10.1. Sin GA: L-2 abierta y activación bloqueada |
| Una instancia arranca con una configuración antigua o distinta, pero válida | Antes de *T_act*, se corrige sin efecto; después, el de los casos anteriores. Una configuración no válida no llega a arrancar | E1–E3 la detectan solo si se aplican a esa instancia, y GA es lo que evita que atienda antes | — |
| La plataforma sustituye una instancia sin que el operador lo advierta | No se detecta sin E4, y sin GA atiende sin comprobar | E4 con historial, revisado en T1, en T7 y después de cada etapa, más GA | La plataforma no ofrece historial o no hay GA: L-2 |

**Vigilancia después de *T_act*.** Cualquier despliegue, reinicio o cambio de configuración de la API posterior a *T_act* repite E1–E4 para las instancias afectadas, y debe pasar por GA. Este documento no presupone ninguna monitorización automática, porque el proyecto no la tiene.

- **El fin de la gracia** (paso 9) tiene el mismo tratamiento: fijar *T_fin* futuro, comprobar todas las instancias con E1–E4 antes de *T_fin* (con un inventario inicial propio, obtenido tras el reinicio de G3) y exigir GA. Aquí E3 sí comprueba el valor, con `graceUntil`. A partir de *T_fin* interviene la hora actual de cada instancia, así que un desfase de relojes cambia el momento exacto en que cada una cierra las sesiones.

**Recomendación:**
- **alternativa A** en todos los casos;
- **solo si existen E1–E4 y la garantía de admisión GA** para todas las instancias, sean una o varias. Si no, la activación queda **pendiente** (L-2). Con la implementación actual y sin evidencia de la plataforma, **está pendiente**;
- no usar B salvo en el caso restringido del apartado 9.4;
- no usar nunca un *T_act* pasado sin la decisión expresa del apartado 3.2.

### 9.6 Paso 7 — Preparación de todas las instancias

| # | Acción | Qué se comprueba | Resultado esperado | Detener si | Rol | Estado |
|---|---|---|---|---|---|---|
| P1 | Condiciones previas | Apartado 7.3 completo y autorización de la etapa 2 (apartado 12) | Completo | Falta algo | RT y PP | ☐ |
| P2 | Fijar `EMAIL_VERIFICATION_REQUIRED_FROM = T_act` (futuro, con zona horaria) y `GRACE_UNTIL` vacía, en la fuente única | El valor escrito, revisado por dos personas | Coincide con el autorizado | No coincide | OD y RT | ☐ |
| P3 | Reiniciar todas las instancias | Que todas arrancan; una configuración no válida impide arrancar | Todas en marcha | Alguna no arranca (configuración no válida): vaciar las variables y reiniciar, antes de *T_act* | OD | ☐ |
| P4 | Inventario inicial y evidencia por instancia | En este orden (apartado 9.5):<br>1. obtener el inventario inicial **I0** inmediatamente después de P3, y anotar la hora y cómo se ha obtenido (manualmente, con las herramientas de la plataforma);<br>2. E1, y E2 y E3 para **cada** instancia de I0;<br>3. abrir el registro de cambios de E4 desde I0;<br>4. confirmar que la evidencia de GA documentada en 7.3 se aplica a esta plataforma | Todas las instancias de I0 con la configuración, el registro abierto y GA acreditada | No se puede obtener I0; no se puede demostrar para alguna instancia; no se pueden registrar los cambios; o no hay evidencia de GA (L-2) | OD y QA | ☐ |
| P5 | Comprobación diagnóstica | Las consultas de solo lectura P5-a (`createdAt >= T_act AND emailVerifiedAt IS NULL`) y P5-b (`createdAt >= T_act`), definidas en el apartado 7.3. Las dos expresan *T_act* en el mismo formato y la misma zona en que la base guarda las fechas, que este documento no ha comprobado. Un formato mal expresado da un recuento erróneo, en cualquier sentido | P5-a = 0 y P5-b = 0 | **No detiene por sí sola.** Un resultado distinto de 0 en cualquiera de las dos es una anomalía: ver «Si P5 no da 0», debajo de la tabla. Un 0 no demuestra nada sobre la configuración: no sustituye a P4 ni a GA | RT | ☐ |
| P6 | Plazo | Que P2–P5 terminan antes de *T_act* menos el margen decidido | Dentro del plazo | Fuera de plazo | RT | ☐ |
| P7 | OWNER | O1–O6 con la configuración cargada | Todos `VERIFIED` | Alguno no | OW y RT | ☐ |

**Si P5 no da 0** (P5-a, P5-b o las dos). Una fila con `createdAt >= T_act` antes de *T_act* puede deberse a varias causas, y el número por sí solo no indica cuál. Si solo P5-b es distinta de 0, las cuentas afectadas están verificadas y no quedarían bloqueadas, pero la causa se investiga igual:
- la propia consulta: el formato o la zona horaria de *T_act*;
- un *T_act* configurado distinto del autorizado (E1). Si fuera anterior al momento actual, el procedimiento se convertiría en el caso de *T_act* pasado (apartado 3.2);
- un reloj adelantado en el sistema que fija `createdAt` (apartado 3.1);
- o datos con fechas de creación que no proceden del registro normal, que este documento no conoce.

Se actúa así:
1. Revisar la consulta y repetirla.
2. Comparar E1 con el valor autorizado.
3. Comparar la hora de las instancias y de la base con la fuente horaria común (A8).
4. Identificar las filas afectadas (cuántas y su `createdAt`), sin extraer datos personales.

**Se detiene, y se aborta antes de *T_act*,** si se confirma un *T_act* erróneo o un desfase de relojes, o si la investigación no termina dentro del plazo de P6. Si la causa es la consulta, se corrige y se sigue. En cualquier caso, la decisión se documenta.

**Si se detiene antes de *T_act*** (abortar sin daño):
- vaciar las dos variables y reiniciar todas las instancias **antes de *T_act***. Desde T1, cada instancia reiniciada pasa por GA frente a la configuración de destino (apartado 9.5);
- como no hay cuentas con `createdAt >= T_act` (salvo la anomalía de P5, ya analizada), no se reclasifica ninguna (apartado 3.2);
- después, comprobar con E2–E4 que cada instancia volvió a `NOT_ENFORCED`. Antes de *T_act*, una instancia que tarde en volver no tiene efecto (apartado 9.2);
- si el aborto no puede completarse antes de *T_act*, se aplica el caso siguiente;
- para volver a intentarlo, elegir un *T_act* nuevo, también futuro.

**Si *T_act* llega, o pasa, con una instancia sin comprobar** (incluidas las creadas, reiniciadas o sustituidas después de *T_act*: apartado 9.5):
- las cuentas creadas desde *T_act* que atienda una instancia sin la configuración entran, y se les cierra la sesión cuando las evalúa otra;
- no afecta a cuentas existentes, y esas cuentas recibieron el enlace (H10), pero es el efecto que se quería evitar;
- se informa al PP;
- esa instancia se corrige (o se retira de servicio, si la plataforma lo permite) de inmediato, o se revierte la política (apartado 10.1);
- se documentan el intervalo y las cuentas creadas en él.

### 9.7 Paso 8 — Activación de la política en *T_act*

En *T_act* no se ejecuta ninguna acción de configuración.

| # | Qué se comprueba | Resultado esperado | Detener si | Rol | Estado |
|---|---|---|---|---|---|
| T1 | Justo antes de *T_act* menos el margen: inventario actual comparado con I0 más los cambios registrados (E4). Toda instancia creada, reiniciada o sustituida desde I0 tiene E2 y E3. Desde T1, cualquier instancia nueva depende de GA (apartado 9.5) | Inventario cuadrado con I0 y los cambios, y las nuevas comprobadas | Hay una instancia sin comprobar y no da tiempo a comprobarla, o el inventario no cuadra: se aborta (apartado 9.6) | OD | ☐ |
| T2 | Pasado *T_act*: registro de una cuenta de prueba nueva (S1) | 201 sin sesión; enlace recibido | Abre sesión: indica una instancia sin la configuración. Se aplica el apartado 9.6, «Si *T_act* llega, o pasa…», o se revierte (apartado 10.1) | QA | ☐ |
| T3 | Login de esa cuenta de prueba (S3) y verificación con el enlace (S5) | 403 con reenvío; después, verificada y con acceso | Falla | QA | ☐ |
| T4 | Una cuenta de prueba existente sin verificar | Sigue `GRACE` | Queda `REQUIRED`: indica un `REQUIRED_FROM` cargado anterior a su `createdAt` (valor erróneo) o un `GRACE_UNTIL` no previsto. Se revierte (apartado 10.1) | QA | ☐ |
| T5 | OWNER (S11) | Acceso al panel | Falla: apartado 10.1 | OW | ☐ |
| T6 | Apartado 7.5 | Correcto | Falla | QA | ☐ |
| T7 | Después de *T_act*, tras cada despliegue, reinicio o sustitución conocidos, y en cada revisión de E4: que las instancias nuevas o reiniciadas pasaron por GA y superaron E2 y E3 **antes** de recibir tráfico (apartado 9.5) | Todas, con GA aplicada | Alguna sin la configuración: apartado 9.6, «Si *T_act* llega, o pasa…». Alguna atendió tráfico sin pasar por GA: se trata igual y se documenta el intervalo | OD | ☐ |

### 9.8 Paso 9 — Finalización del periodo de gracia

Es una decisión separada, con su propia autorización (apartado 12).

| # | Acción | Qué se comprueba | Resultado esperado | Detener si | Rol | Estado |
|---|---|---|---|---|---|---|
| G1 | Condiciones previas | Apartado 7.4 completo, con *T_fin* futuro anunciado y L-1 aceptada expresamente para el fin de la gracia (etapas 3 y 4) | Completo | Falta algo | RT y PP | ☐ |
| G2 | Fijar `EMAIL_VERIFICATION_GRACE_UNTIL = T_fin` **sin cambiar** `REQUIRED_FROM` (etapa 3), en la fuente única | El valor escrito, revisado por dos personas; `REQUIRED_FROM` igual que en la etapa 2 | Coincide | No coincide | OD y RT | ☐ |
| G3 | Reiniciar todas las instancias, con margen antes de *T_fin*. **Este reinicio ocurre después de *T_act*:** cada instancia reiniciada **permanece fuera del tráfico de usuarios** hasta superar E2 y E3 y cumplir GA (apartado 9.5) | Para cada instancia reiniciada, antes de admitirla:<br>• E1: `REQUIRED_FROM` igual al de la etapa 2 y `GRACE_UNTIL = T_fin`;<br>• E2;<br>• E3 antes de *T_fin*: `GRACE`, con `graceUntil` exactamente igual a *T_fin*.<br>Inventario inicial propio, obtenido inmediatamente después de este reinicio, y E4 sobre él. Antes de *T_fin*, se repite T1 respecto a ese inventario. Después de *T_fin*, T7, con GA y E3 en su forma posterior a *T_fin* | Todas admitidas por GA, con `REQUIRED_FROM` correcto y *T_fin* | Una instancia con **`REQUIRED_FROM` ausente o incorrecto:** **no se incorpora al tráfico**. Se aborta su incorporación y se aplica el apartado 9.6 («Si *T_act* llega, o pasa…») o la reversión del apartado 10.1. **Vaciar `GRACE_UNTIL` no basta** para ese caso.<br>Un *T_fin* incorrecto, no se puede demostrar (L-2) o no hay GA: no se admite la instancia, y se vacía `GRACE_UNTIL` antes de *T_fin* en la fuente única | OD y QA | ☐ |
| G4 | Ninguna: al llegar *T_fin* la etapa 4 se aplica sola | Pasado *T_fin*, una cuenta de prueba existente sin verificar (S12 y S3) | Sesión cerrada en la siguiente petición; login con reenvío; verifica | Falla | QA | ☐ |
| G5 | Ninguna | OWNER (S11) y apartado 7.5 | Correctos | Falla: apartado 10.1 | OW y QA | ☐ |

## 10. Reversión (paso 10)

### 10.1 Reversión de la política (configuración)

**Volver a no exigir la verificación a nadie (etapa 1).**
- Dejar **vacías las dos variables** en la fuente única y reiniciar todas las instancias.
- Hay que vaciar las dos: si `GRACE_UNTIL` sigue definida sin `REQUIRED_FROM`, la API no arranca.
- Mientras se reinician, la configuración está mezclada: unas instancias ya dan acceso y otras todavía no. Una reversión no elimina el problema del apartado 9.2, solo lo acorta.

**Volver a dar acceso a las cuentas existentes sin quitar la obligación a las nuevas.**
- Vaciar `GRACE_UNTIL` (gracia sin fin) o posponerla, manteniendo `REQUIRED_FROM`, y reiniciar todas las instancias.

**Lo que la reversión de la configuración no deshace:**
- **no recupera las sesiones ya cerradas:** esos usuarios tienen que iniciar sesión de nuevo;
- los enlaces emitidos, las reservas de envío y los registros de auditoría permanecen;
- `emailVerifiedAt` no se toca: las cuentas verificadas siguen así;
- el aviso a los usuarios, si se envió.

**Volver a activar después de revertir.**
- Si se revierte a la etapa 1 **después de *T_act***, las cuentas creadas mientras tanto no tienen que verificar.
- Volver a cargar el mismo *T_act*, que ya es pasado, las dejaría `REQUIRED` de golpe. Es el caso de *T_act* pasado, que no forma parte de este procedimiento (apartado 3.2).
- Una nueva activación exige **un *T_act* nuevo y futuro** y repetir los pasos 6 a 8, con su autorización.
- Lo mismo vale para *T_fin*: posponerlo o vaciarlo después de alcanzarlo devuelve el acceso a las cuentas existentes, y fijarlo de nuevo exige el paso 9 completo.

**Detener si:** después de revertir, E2–E4 (apartado 9.5) no muestran el estado esperado en **todas** las instancias, con `/me` de una cuenta de prueba en `NOT_ENFORCED` (o `GRACE`, según el caso). Si la evidencia no está disponible (L-2), la reversión **no se puede dar por completada**: se documenta así y se informa al PP.

**Reversión y GA.**
- Una reversión de la política después de *T_act* solo puede darse si hubo activación, y la activación exige el conjunto completo de las ocho evidencias que cierran L-2 (apartados 9.5 y 12), GA incluida como requisito obligatorio pero no suficiente por sí sola. Por tanto, cada instancia reiniciada para revertir **pasa por GA** como cualquier otra (apartado 9.5): no recibe tráfico hasta superar E2 y E3 frente a la configuración de destino.
- Mientras tanto, las instancias que aún no se han reiniciado siguen atendiendo con la configuración anterior, que es más restrictiva. Eso no da acceso indebido.
- La mezcla dura hasta que la última instancia supera GA, y se sigue con E4.
- Un aborto **antes de T1** (apartado 9.6) no necesita GA, porque la mezcla todavía es inocua. **Desde T1**, también los reinicios de un aborto pasan por GA (apartado 9.5, «Cuándo es obligatoria»).

### 10.2 Comprobación de compatibilidad antes de volver a una versión anterior

**No se vuelve a ninguna versión anterior sin completar esta tabla.** No se presupone que cualquier combinación de web y API sea segura.

| # | Qué se comprueba | Cómo | Resultado esperado | Detener si | Rol | Estado |
|---|---|---|---|---|---|---|
| K1 | Estado de la base | Historial de migraciones de Prisma (solo lectura) | Solo `20261106090000_add_email_verification` como migración nueva y aplicada, o la base sin migrar | Hay otra migración posterior a `127a0a6`, o una fallida: la API antigua no se ha comprobado con ese estado | OD | ☐ |
| K2 | Combinación de destino | Tabla del apartado 6.1 | La combinación que va a quedar es compatible | Quedaría la API nueva con la web antigua y la verificación exigida, o la API nueva con la base sin migrar | RT | ☐ |
| K3 | Política | Configuración actual | `NOT_ENFORCED` antes de cambiar la API (apartado 10.1), para que la API antigua no cambie el acceso de golpe | No se ha podido revertir la política | OD | ☐ |
| K4 | Datos y operaciones de la Fase 0 con la API antigua | Revisión de los efectos (debajo de la tabla) | El PP conoce y acepta los efectos | El PP no los acepta | RT y PP | ☐ |
| K5 | Artefacto de destino | Que el artefacto antiguo procede de `127a0a6` y que se ha ensayado sobre una base migrada (S14 y R5) | Comprobado | No hay ensayo | OD y RT | ☐ |

**Efectos conocidos de la API antigua sobre una base migrada** (H15):
- **ignora** `emailVerifiedAt`, `emailVerificationSentAt` y la tabla `EmailVerificationToken`, y los conserva;
- **las cuentas que estaban en `REQUIRED` pueden entrar sin verificar**;
- **los enlaces de verificación ya enviados dejan de funcionar:** con la web nueva, el endpoint no existe; con la web antigua, la ruta no existe;
- los cambios de email y E2 pendientes los gestiona con su propia lógica, sin las reglas D1 y D2, que son de la Fase 0;
- las filas de auditoría `EMAIL_CHANGE_NOTICE_FAILED` se muestran con el código en bruto en el panel antiguo, y el filtro antiguo no las ofrece.

Cualquier otro estado u operación que la API antigua no conozca y que no figure en esta lista se trata como **no comprobado**: se detiene el procedimiento y se analiza antes de revertir.

### 10.3 Reversión de versiones (API y web)

**Principios:**
- **API y web deben volver a una combinación compatible** (apartado 6.1), comprobada en el apartado 10.2.
- **No dejar la API nueva con la web antigua** con la verificación exigida.
- **No arrancar la API nueva contra una base sin migrar.**
- **No mantener la API antigua con usuarios en la web nueva más allá de lo imprescindible.** Es compatible con degradación, pero la página `/verificar-email` y el reenvío darían error, porque dependen de endpoints que la API antigua no tiene.
- **La migración no se deshace** en una reversión ordinaria. Es aditiva y la API antigua es compatible con ella. Este documento **no define ningún procedimiento de reversión de la base de datos**. Restaurar la copia B1 perdería todo lo escrito después y no es una reversión ordinaria: requiere un análisis y una autorización aparte.

**Secuencia** (sin comandos propios de ningún proveedor, que no está identificado):

| # | Acción | Qué se comprueba | Resultado esperado | Detener si | Rol | Estado |
|---|---|---|---|---|---|---|
| X1 | Comprobación previa | Apartado 10.2 (K1–K5) | Completa | Falla alguna | RT | ☐ |
| X2 | Volver a `NOT_ENFORCED` (apartado 10.1), si la política estaba activada | `/me` con una cuenta de prueba | `NOT_ENFORCED` | No | OD | ☐ |
| X3 | Sustituir la API nueva por la antigua en todas las instancias. Queda la web nueva con la API antigua: compatible con degradación. Si ocurre después de *T_act*, cada instancia sustituida pasa por GA frente al estado de destino (apartado 9.5) | `GET /health` y el login con una cuenta de prueba; E4 para confirmar que no queda ninguna instancia con la API nueva. `/health` no distingue las versiones (H5) | Funciona, y ninguna instancia con la API nueva | No funciona, o no se puede confirmar con E4 qué versión ejecuta cada instancia | OD y QA | ☐ |
| X4 | Si también hay que revertir la web, desplegar la web antigua **justo después** | Publicación (como en C2) y login con una cuenta de prueba | Web y API antiguas | No | OD y QA | ☐ |
| X5 | Si la plataforma no permite coordinar X3 y X4 | Ventana de mantenimiento controlada (apartado 6.1) | Decidida | — | PP y OD | ☐ |
| X6 | Documentar e informar | Combinación final, efectos de K4 y hora de cada paso | Documentado | — | RT | ☐ |

**Efectos de revertir el código:**
- con la API antigua no se exige la verificación, así que las cuentas registradas mientras se exigía vuelven a poder entrar sin verificar;
- `emailVerifiedAt` y los datos de la migración se conservan.

## 11. Riesgos y limitaciones

### 11.1 Riesgos conocidos

| Riesgo | Situación |
|---|---|
| **F0-001 — PostgreSQL** | **No preparado.** El orden inverso de bloqueos entre el consumo del enlace y el cambio de email, E2 o la emisión podría producir *deadlocks* en PostgreSQL. Pasar las pruebas con SQLite no demuestra que funcione con PostgreSQL. Bloquea cualquier migración a PostgreSQL hasta que se corrija y se pruebe. |
| F0-004 a F0-007 | Fuera de alcance:<br>• orden de llegada de los correos de `forgot-password`;<br>• espera sin plazo a los envíos al cerrar;<br>• pruebas DOM;<br>• confirmación repetida del cambio de email |
| **P-08** | El log de un fallo de envío de verificación incluye el mensaje del error, que puede contener la dirección del destinatario. El de la solicitud de cambio de email registra el error completo (anterior a la Fase 0) |
| **P-09** | El cierre de la API espera a los envíos pendientes sin un plazo propio; el transporte SMTP usa los timeouts por defecto de `nodemailer`, sin configurar. Un cierre brusco pierde los envíos en curso (en E2 pública, 15 minutos de espera para pedir otro). Afecta a cada reinicio de los pasos 5, 7 y 9 |
| **P-10** | La enumeración por tiempo en `forgot-password` no está medida; solo está probada la igualdad de las respuestas |
| Pruebas de interfaz | No hay pruebas de renderizado de componentes ni del build de la web; la lógica web está probada sin DOM |
| SMTP real | No probado (apartado 2); se prueba en staging (S15) |
| Copia de seguridad | Su consistencia depende del método, que fija el alojamiento. Las escrituras posteriores a B1 se pierden si se restaura. Sin escrituras detenidas, R4 solo es parcial (L-5, apartado 6.5) |
| Indisponibilidad | No se garantiza un despliegue sin interrupciones; puede requerir una ventana de mantenimiento (apartado 6.1) |
| Relojes | Sin sincronización, las instancias pueden decidir de forma distinta cerca de *T_act* y *T_fin*, o clasificar mal cuentas (apartado 3.1). No hay tolerancia definida |
| P-01 a P-07 | Condiciones de este documento:<br>• `REQUIRED_FROM` y la carrera de activación (3.2 y 9);<br>• OWNER (5);<br>• orden web y API (6.1 y 6.3);<br>• migración antes de la API (6.6);<br>• URL públicas (6.4);<br>• configuración uniforme (6.4, A7, y 9.5);<br>• SMTP (6.4) |
| Sin herramienta administrativa | No se puede verificar ni eximir una cuenta desde la aplicación (apartado 4). La recuperación de un OWNER depende de su buzón (apartado 5) |

### 11.2 Limitaciones pendientes y requisitos previos de código futuro

| Id | Limitación o requisito | Efecto | Tratamiento |
|---|---|---|---|
| **L-1** | **Clientes con la web antigua.** No hay service worker, versión, detección ni recarga forzada (apartado 6.2). Las pestañas abiertas antes de publicar la web nueva siguen ejecutando la antigua sin límite de tiempo | Un usuario puede quedar sin forma de verificar desde esa pestaña: registro sin mensaje, login sin reenvío. Mayor impacto en *T_fin* | Medidas operativas del apartado 6.2. **No se puede eliminar** para las pestañas actuales: PR-2 solo mitigaría el login, y PR-1 solo serviría en el futuro. **Bloquea** la activación (etapa 2) y el fin de la gracia (etapa 3, que provoca la etapa 4) hasta que el PP lo acepte expresamente para cada una (V4 y apartado 7.4) |
| **L-2** | **Configuración de las instancias sin evidencia.** No hay ningún endpoint de configuración ni de versión (H5 y H14), la configuración puede venir también de un `.env` (H16) y el proyecto no controla la creación ni la sustitución de instancias | Si no se puede demostrar que **cada** instancia en servicio, incluidas las creadas, reiniciadas o sustituidas después de I0, cargó la configuración **antes de recibir tráfico**, puede haber una configuración mezclada después de *T_act* o *T_fin* (apartado 9.2). E1–E4 la detectan, en el mejor caso, después de que la instancia haya atendido peticiones: queda un intervalo de riesgo sin cubrir (apartado 9.5) | **Bloquea** la activación y el fin de la gracia, **haya una instancia o varias**, mientras falte **cualquiera** de las ocho evidencias de «Evidencia que cerraría L-2» (apartado 9.5):<br>• E1, E2, E3 y E4;<br>• GA;<br>• el mecanismo de acceso a la instancia retenida;<br>• la cobertura de todas las formas de incorporación;<br>• el ensayo representativo de producción.<br>**Solo la cierra el conjunto.** Ni E1–E4 por sí solos ni GA aislada, sin la evidencia por instancia, la cierran. Un cambio de código (por ejemplo, PR-3) podría contribuir, pero no la cierra por sí solo. **Ninguna decisión administrativa puede aceptarla ni dispensarla.** Con la información disponible no hay evidencia de GA: **L-2 sigue abierta** |
| **L-5** | **Referencia temporal de R4.** Si la API antigua sigue escribiendo durante la copia y los recuentos, y el método de copia no permite contar dentro de la misma lectura, no hay forma de obtener el estado de producción en B1. El proyecto no tiene ningún mecanismo que lo reconstruya | La presencia de los datos solo se comprueba de forma parcial: altas, en tablas con fecha de creación (apartado 6.5) | Se elimina con la forma 1 (escrituras detenidas) o la forma 2 (recuento en la misma lectura) del apartado 6.5. Si no, el PP decide de forma documentada si migra con R4 parcial. No se marca como superada |
| L-3 | **Comportamiento del alojamiento** no identificado: caché de `index.html` y reescritura de rutas (H4) | Determina si una carga nueva obtiene la web nueva y si los enlaces de los correos funcionan | Se comprueba en C3, C4 y S15; si falla, se detiene el procedimiento |
| L-4 | **Ninguna herramienta administrativa** de verificación o exención | Una cuenta, OWNER incluido, sin acceso a su buzón no puede recuperarse | **El PP la acepta en la integración** (apartado 7.1, fila «Revisión de código»), según su regla propia (convenciones). Prevención: apartado 5. La herramienta, pendiente de diseño |
| **PR-1** | **Requisito previo de código futuro, independiente y no implementado: control de versión entre la web y la API.** Por ejemplo, un identificador de build en la web, expuesto también por la API, con el que la web pueda detectar que ha quedado antigua y pedir o forzar una recarga | Reduciría L-1 **solo en transiciones futuras** y solo para las pestañas cargadas después de publicarlo. **No ayuda a las pestañas que ya ejecutan la web antigua** (apartado 6.2, acción 5). **No reduce L-2:** una versión del código no demuestra la configuración que cargó un proceso. Si se incluyera en la web de esta Fase 0, cambiaría el diff acumulado | Fuera de alcance. Requiere diseño, implementación, pruebas, un diff nuevo y una autorización aparte |
| PR-2 | **Mitigación parcial que habría que analizar, no recomendada sin ese análisis:** cambiar el texto de error de la API. Es un cambio en las respuestas del servidor (apartado 6.2, acciones 2 y 3), no en el código de la pestaña antigua | Llegaría a las pestañas antiguas **solo en el login** (H8). No sirve para el registro ni para el 403 de `/me`, y no detecta ni recarga nada. **La web nueva compara ese texto exacto (H11):** cambiarlo exige cambiar también la web nueva, en un diff nuevo. **No resuelve L-1** | Fuera de alcance. Solo se menciona como vía a evaluar |
| PR-3 | **Requisito previo de código futuro, independiente y no implementado: evidencia de la configuración cargada por cada proceso.** Por ejemplo, un dato de solo lectura que identifique la configuración de la política y la instancia que responde, sin exponer secretos | Permitiría E3 con el valor exacto de `REQUIRED_FROM`. Seguirían haciendo falta E4 y GA, que solo puede dar la plataforma o un procedimiento operativo: PR-3 comprueba una instancia, pero no impide que atienda antes de comprobarla. **No resuelve L-2** | Fuera de alcance. Requiere un análisis de seguridad (exponer la configuración), diseño, pruebas, un diff nuevo y una autorización aparte |

## 12. Criterios de autorización final

Cada decisión exige una **autorización expresa y separada** del PP. **Este documento no constituye ninguna autorización y no está aprobado para producción.**

Aceptar L-1 es una condición previa, documentada aparte, de las autorizaciones de la activación y del fin de la gracia. **No las sustituye ni las implica.**

L-2, en cambio, **no se acepta: bloquea**. Sin E1–E4 no se puede saber si la política se aplica de forma uniforme, y sin la garantía de admisión GA no se puede evitar que una instancia sin comprobar atienda peticiones. **Con la información disponible, L-2 está abierta: la activación y el fin de la gracia no son autorizables** hasta que se acredite el conjunto de evidencias que cierra L-2 (apartado 9.5), GA incluida.

L-5 es una decisión del PP sobre la migración (apartado 6.5), no una autorización.

**Integración en `feat/keys`:**
- apartado 7.1 completo;
- autorización con el SHA del diff acumulado.

**Despliegue en producción (pasos 1 a 5, etapa 1 `NOT_ENFORCED`):**
- apartado 7.2 completo, con la restauración comprobada (apartado 6.5). Si R4 es parcial (L-5), con la decisión documentada del PP;
- en staging, los casos S14, S15 y S18, además de S2, S5 y S10;
- autorización expresa.

**Activación de la obligación (pasos 6 a 8, etapa 2):**
- paso 6 completo, con **L-1 aceptada expresamente**;
- apartados 5 (O1–O6) y 7.3 completos;
- **el conjunto completo de las ocho evidencias** de «Evidencia que cerraría L-2» (apartado 9.5), para todas las instancias, sean una o varias: E1, E2, E3, E4, GA, el mecanismo de acceso a la instancia retenida, la cobertura de todas las formas de incorporación y el ensayo representativo de producción. Ni GA, ni E1–E4, ni S17, ni una decisión administrativa bastan por separado. Si falta cualquiera de las ocho, **L-2 sigue abierta y bloquea esta autorización**;
- en staging, los casos S1, S3, S4, S6, S9, S10, S11, S16 y S17;
- autorización expresa con el valor de *T_act* (futuro) y el margen de preparación.

**Fin de la gracia (paso 9: etapa 3 y, al llegar *T_fin*, la etapa 4):**
- apartado 7.4 completo, con **L-1 aceptada expresamente para el fin de la gracia**, aparte de la aceptación de la etapa 2;
- **el conjunto completo de las ocho evidencias** de «Evidencia que cerraría L-2» (apartado 9.5), igual que en la activación, para todas las instancias. Ni GA, ni E1–E4, ni S17, ni una decisión administrativa bastan por separado. Si falta cualquiera de las ocho, **L-2 sigue abierta y bloquea esta autorización**;
- en staging, los casos S12, S13 y S16 (S16 incluye la etapa 4);
- autorización expresa con el valor de *T_fin*.

**Reversión (paso 10):**
- se puede ejecutar cuando sea necesaria, según el apartado 10 y con la comprobación del apartado 10.2;
- se informa al PP y se documenta.

**PostgreSQL:** no autorizable mientras F0-001 siga pendiente.

| Autorización | Responsable | Fecha | Estado |
|---|---|---|---|
| Integración | PP | — | ☐ |
| Despliegue (etapa 1) | PP | — | ☐ |
| Aceptación de L-1 para la etapa 2 | PP | — | ☐ |
| Activación (etapa 2, *T_act*) | PP | — | ☐ |
| Aceptación de L-1 para el fin de la gracia (etapas 3 y 4) | PP | — | ☐ |
| Fin de la gracia (etapa 3, *T_fin*) | PP | — | ☐ |
