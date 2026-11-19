# Checklist de publicación y Estado del inmueble

## Enfoque

EstateForge gestiona inmuebles y sus anuncios. Permite controlar en qué plataformas se ha publicado manualmente cada anuncio, conservar los enlaces de esas publicaciones y acceder a las páginas principales de los portales.

**EstateForge no publica, modifica ni gestiona anuncios en portales externos.** Cada portal tiene sus propios procedimientos, y la publicación la hace el usuario desde cada uno.

Al adoptar este enfoque se revisaron el código, el historial de Git y todas las ramas, las rutas, las tareas programadas, el modelo de datos, las variables de entorno, las dependencias y la documentación: **nunca existió una función de publicación automática**, de modo que no hubo nada que retirar ni credenciales que queden obsoletas. `apps/api/src/routes/publication.routes.test.ts` impide que aparezca sin una decisión explícita.

## Checklist

La sección **Checklist** está en la ficha de cada anuncio (`Generation`). El catálogo de portales (identificador, nombre, página principal y dominios) y los acortadores están solo en `packages/shared/src/publications.ts`, que usan la web y la API.

### Cada fila

| Destino | Cuándo aparece | A dónde lleva |
|---|---|---|
| **Ir a {portal}** | Siempre en los portales del catálogo; en «Otro/a», si se ha indicado página principal | Página principal de la plataforma |
| **Ir al anuncio** | Solo con la fila marcada y un enlace válido | La publicación concreta |

Ambos se abren en una pestaña nueva con `rel="noopener noreferrer"`.

### Reglas del Check

- Una fila solo queda marcada con un enlace válido.
- Marcar sin enlace válido no activa el Check: habilita el campo y avisa. Al introducir un enlace válido, el Check se completa. Una segunda pulsación cancela el intento.
- Si un enlace marcado deja de ser válido o se borra, el Check se desactiva y el campo sigue editable. Al corregirlo, la fila vuelve a marcarse.
- Desmarcar conserva el enlace válido. El botón «Borrar enlace» lo elimina.
- Un enlace no válido nunca se guarda: al guardar, esa fila queda sin marcar, conserva el último enlace válido y un mensaje lo indica.

### Guardado y cambios sin guardar

El guardado es explícito con «Guardar Checklist».

- Cualquier cambio en los datos muestra «Cambios sin guardar» y habilita el botón. La carga inicial, una fila «Otro/a» vacía y un intento de marcar sin enlace no cuentan como cambio. Si se vuelve al valor guardado, el indicador desaparece.
- Mientras se guarda, los campos y el botón quedan bloqueados. Si falla, los cambios siguen en pantalla, se informa del error y el indicador se mantiene.
- Con cambios pendientes, salir de la ficha dentro de la aplicación o usar el historial del navegador abre un diálogo con «Seguir editando» y «Salir sin guardar». Recargar o cerrar la pestaña activa el aviso propio del navegador (`beforeunload`).
- «Cerrar sesión» usa su diálogo habitual, que con cambios pendientes los menciona y ofrece «Descartar y cerrar sesión». La sesión no se invalida hasta confirmar, y con un guardado en curso no se puede confirmar hasta que termine. Cancelar conserva el Checklist.
- Una sesión caducada o invalidada por el servidor nunca queda retenida por estos avisos. Eliminar el anuncio tampoco avisa, porque ya no hay cambios que conservar.
- Entrar en «Editar» anuncio no pierde el Checklist: la vista queda montada y oculta.

La protección interna usa `useBlocker`, que exige un router de datos. Por eso `App.tsx` usa `createBrowserRouter` con las mismas rutas que antes.

### Filas «Otro/a»

Sirven para plataformas fuera del catálogo y se comportan igual, salvo en la validación del enlace.

- Siempre hay al menos una y nunca más de cinco.
- Al marcar correctamente una fila, si todas están marcadas aparece otra libre.
- Desmarcar expresamente una fila marcada la elimina si hay más; si es la única, permanece.
- Una desactivación automática por un enlace no válido nunca elimina la fila.
- Tienen nombre y página principal opcionales, independientes del Check y del enlace del anuncio. Sin página principal no aparece «Ir a…».

## Validación de enlaces

Web y API usan las mismas funciones, basadas en el parser estándar `URL`. Nunca visitan el enlace ni resuelven redirecciones, y por tanto no confirman que el anuncio exista, siga publicado o sea accesible.

| Resultado | Significado |
|---|---|
| `valid` | Estructura correcta y, en un portal del catálogo, dominio del portal |
| `empty` | Falta el enlace |
| `invalid` | Formato, protocolo, credenciales, puerto o host incorrectos |
| `wrong-domain` | El dominio no corresponde al portal |
| `unverifiable` | Acortador conocido: el destino no se puede comprobar |

| Regla | Portal del catálogo | «Otro/a» |
|---|---|---|
| Protocolo | Solo `https` | `http` o `https` |
| Dominio | El del portal o un subdominio, con límites de dominio | Cualquiera |
| Acortadores | No verificables | Admitidos: no hay portal que comprobar |
| Puertos | Solo el 443, que equivale a no indicarlo | Admitidos |
| Credenciales, otros protocolos, host sin dominio o IP | Rechazados | Rechazados |

Resolver acortadores no forma parte de este alcance. Si se plantea, será una función independiente con protecciones frente a SSRF, DNS rebinding, redirecciones maliciosas y destinos privados.

## API y datos

`GET` y `PUT /api/generations/:id/publications` exigen sesión y que el anuncio sea del usuario; si no lo es, responden 404. El `PUT` es atómico y los errores indican la ruta del campo y un mensaje en español. La lista `others`, si se envía, es la definitiva: las filas ausentes se eliminan.

`ListingPublication` pertenece al anuncio y se borra con él. Es única por `generationId`, `platform` e `instanceKey`: los portales usan una clave vacía y cada fila «Otro/a» tiene la suya.

### Integridad y concurrencia

La validación completa del enlace (formato, protocolo, dominio y acortadores) está en el código compartido y se ejecuta en la API. La base de datos impone además lo que no depende de esa lógica, incluso ante un error de programación o un acceso directo:

| Restricción | Regla |
|---|---|
| `ListingPublication_published_requires_url` | Una fila marcada tiene un enlace no nulo ni en blanco. Una sin marcar puede tenerlo o no |
| `ListingPublication_instance_key_matches_platform` | `other` exige clave de instancia; un portal, clave vacía |
| `ListingPublication_other_position_range` | Las filas `other` usan posiciones no nulas de 0 a 4; un portal siempre tiene posición 0 |
| `ListingPublication_other_position_key` | Índice único parcial: una posición por anuncio entre las filas `other` |

Las dos últimas hacen imposible una sexta fila «Otro/a»: solo hay cinco posiciones y no se pueden repetir.

Cada guardado es una transacción que primero adquiere la fila del anuncio (`UPDATE "Generation" SET "title" = "title"`, SQL estándar que no cambia datos). Los guardados simultáneos de un mismo anuncio se atienden de uno en uno y gana el último. Las filas «Otro/a» se reescriben con posiciones consecutivas y conservan su `id` y su fecha de creación. Si, aun así, la base rechaza una escritura por conflicto, la API responde 409 y no guarda nada.

Las columnas `position` e `instanceKey` son `NOT NULL`, y cada `CHECK` exige además sus columnas de forma explícita.

Prisma no modela los `CHECK` ni los índices parciales. Si una migración futura reconstruye la tabla, debe volver a incluirlos; una prueba de integración falla si desaparecen. `apps/api/prisma/postgresql/constraints.sql` contiene las mismas restricciones que la línea base y otra prueba falla si divergen.

| Acción en un portal | Enlace guardado |
|---|---|
| Marcado con enlace válido | Se guarda normalizado |
| Marcado sin enlace válido | 400; no se aplica nada del lote |
| Sin marcar, sin `url` | No cambia |
| Sin marcar, `url` nulo o vacío | Se borra |
| Sin marcar, enlace válido | Se guarda normalizado |
| Sin marcar, enlace no válido | 400 |

## Identificación de los portales

**Requisito actualizado (19/11/2026):** mostrar un icono identificativo de cada portal junto a su nombre, con recursos oficiales o verificables y respetando sus condiciones de uso y distribución.

**Estado: cinco recursos incorporados con servicio local y publicados en Vercel el 19/11/2026.** El usuario ha indicado expresamente que se utilicen los iconos y que no se envíen solicitudes. Los cinco portales muestran su imagen original, junto al nombre visible; «Otro/a» conserva el icono genérico. Se verificaron en producción los cinco archivos por SHA-256; la comprobación visual e interactiva de la checklist se realizó en local.

| Portal | Archivo local | Procedencia |
|---|---|---|
| idealista | `/portales/idealista.png` | [Fuente](https://www.idealista.com/sala-de-prensa/materiales/); logos_idealista/PNG/ID.png del ZIP oficial |
| fotocasa | `/portales/fotocasa.png` | [Fuente](https://frtassets.fotocasa.es/statics/img/favicon-96x96.png); Enlazado por https://www.fotocasa.es/ |
| pisos | `/portales/pisos.png` | [Fuente](https://statics.imghs.net/dist/img/favicon/favicon-48x48.png); Enlazado por https://www.pisos.com/ |
| yaencontre | `/portales/yaencontre.ico` | [Fuente](https://www.yaencontre.com/favicon.ico); Favicon servido por el dominio oficial |
| habitaclia | `/portales/habitaclia.png` | [Fuente](https://assets.gw.habitaclia.com/statics/favicon-96x96.png); Enlazado por https://www.habitaclia.com/ |

Los archivos se han descargado de nuevo; no se ha modificado el historial de Git. No se ha alterado, recortado ni redibujado ningún recurso. El logotipo textual anterior de Pisos.com (Commons) ha sido sustituido por el favicon cuadrado enlazado por su web actual.

**Presentación.** Casilla uniforme de 32×32, fondo blanco en ambos temas y proporciones conservadas. Los PNG se muestran a 24×24; el favicon de Yaencontre, de 16×16, conserva su tamaño para no ampliarlo. Las imágenes son decorativas (`alt=""`, `aria-hidden`); el nombre visible y la etiqueta de la casilla identifican cada portal. Si un archivo falla, aparece `Globe` sin cambiar las dimensiones. Una URL nueva se puede cargar después de un fallo. Los enlaces, casillas y validación por dominio conservan su comportamiento.

**Servicio local y procedencia.** El registro está en `apps/web/src/lib/portalIcons.ts`; cada entrada documenta la fuente, fecha y situación de derechos. No se realizan peticiones a los portales ni a servicios de favicons al abrir el Checklist. `portales/NOTICE.txt`, incluido también en `third-party-notices.txt`, conserva fuentes y SHA-256.

**Situación de derechos.** Las marcas y recursos pertenecen a sus titulares. La instrucción del usuario no se presenta como una autorización de los portales ni se atribuye a estos recursos una licencia libre. Se usan para identificar destinos externos, sin sugerir afiliación ni publicación automática. Las solicitudes preparadas quedan archivadas y **no se enviarán**, conforme a la instrucción del usuario. No se redistribuye el ZIP completo de Idealista, solo su símbolo original `ID.png`.

Las verificaciones de esta continuación se documentan en `revision/evidencias_iconos_portales_completos_2026-11-19/`, fuera del checkout.

## Estado del inmueble

`Property.commercialStatus` admite `for-sale` (En venta), `sold` (Vendido), `for-rent` (Por alquilar) y `rented` (Alquilado).

- Es obligatorio al crear un inmueble y opcional al editar, con validación compartida.
- Los inmuebles anteriores quedan con `NULL` y se muestran como «Sin indicar»; no se les asigna un valor.
- No depende de `operation` y cambiarlo no afecta al Checklist.
- Los datos numéricos que genera la IA se comparan con los del inmueble entendiendo separadores de miles, decimales y signo: «250.000 €» equivale a 250000 y «300.000 €» se rechaza. Antes, el punto de los miles se confundía con el final de una frase.
- La etiqueta «Estado» designa este campo. El campo `condition` se muestra como «Conservación» y mantiene su significado interno.

## Migraciones

| Migración | Efecto |
|---|---|
| `20261109120000_add_commercial_status_and_listing_publications` | Añade `commercialStatus` y la tabla |
| `20261109130000_add_other_publication_rows` | Añade `instanceKey`, `customName`, `homeUrl` y `position`, cambia el índice único y desmarca, sin borrarlas, las filas marcadas sin enlace |
| `20261109150000_tighten_listing_publication_instances` | Exige posición 0 en los portales y hace explícitas las comprobaciones de nulos. Conserva todas las filas |
| `20261109140000_add_listing_publication_integrity` | Reconstruye la tabla con los `CHECK`, crea el índice parcial, desmarca las filas con enlace en blanco y numera las filas «Otro/a». Conserva todas las filas; si un anuncio tuviera más de cinco «Otro/a», se detiene sin alterar los datos |

## Motores

EstateForge funciona con PostgreSQL 17. Las restricciones se aplican en la línea base de `prisma/migrations` y están verificadas contra PostgreSQL real, con conexiones concurrentes. Detalles en [postgresql.md](postgresql.md).

Las migraciones SQLite, con sus `down.sql`, quedan archivadas en `prisma/sqlite-history`.


## Requisitos

| ID | Requisito | Verificación |
|---|---|---|
| REQ-P1 | Cada anuncio tiene su Checklist con los portales del catálogo y filas «Otro/a», sin mezclar datos, y persiste | Integración, navegador |
| REQ-P2 | Una fila solo queda marcada con un enlace válido; el campo se habilita al intentar marcarla | `PublicationChecklist.test.tsx`, navegador |
| REQ-P3 | Desmarcar conserva el enlace válido; un enlace no válido o borrado desactiva el Check | `PublicationChecklist.test.tsx`, integración, navegador |
| REQ-P4 | Los enlaces se validan en web y API con el mismo criterio, por dominio en los portales del catálogo | `publications.test.ts`, integración |
| REQ-P5 | Los acortadores son no verificables en los portales y no se resuelven | `publications.test.ts`, integración, navegador |
| REQ-P6 | Sin duplicados por anuncio, plataforma e instancia; coherencia impuesta también en la base | Integración, PGlite |
| REQ-P7 | Solo el propietario lee y modifica | Integración, navegador |
| REQ-P8 | «Ir a {portal}» está siempre disponible y es distinto de «Ir al anuncio» | `PublicationChecklist.test.tsx`, navegador |
| REQ-P9 | Entre una y cinco filas «Otro/a» con las reglas de alta y baja descritas; el servidor y la base imponen el máximo, también con guardados simultáneos | `PublicationChecklist.test.tsx`, integración, navegador |
| REQ-P10 | Los cambios sin guardar se indican y se avisa antes de perderlos, también al cerrar sesión | `PublicationChecklist.test.tsx`, navegador |
| REQ-G2 | Una respuesta incoherente o malformada del proveedor de IA da un error controlado (502 `AI_PROVIDER_ERROR`) y no guarda nada; un error interno sigue siendo 500 | `listing-validator.service.test.ts`, `generation-errors.test.ts`, integración, navegador |
| REQ-G1 | Crear un inmueble no falla por el formato de sus cifras, y las cifras contradictorias se siguen rechazando | `listing-validator.service.test.ts`, integración, navegador |
| REQ-E1 | Estado con cuatro valores; se crea, consulta y modifica | `publications.test.ts`, integración, navegador |
| REQ-E2 | Datos antiguos sin estado inventado | Integración, navegador |
| REQ-E3 | Cambiar el estado no altera el Checklist | Integración |
| REQ-X1 | No existe publicación automática | `publication.routes.test.ts` |

REQ-P2 y REQ-P3 sustituyen a su versión anterior, que permitía marcar sin enlace. Ningún requisito previo a esta funcionalidad queda obsoleto, porque ninguno describía publicación en portales. Este cambio no resuelve ni cierra M-1, REQ-C10, B-6 ni ningún otro control abierto.
