# Galería del inmueble, cartel y vídeo del anuncio

Decisiones: DA-46 y DA-47 (galería, almacenamiento, cartel y vídeo en el navegador, regeneración segura), DA-48 (caché revalidada) y DA-51 a DA-57 (galería de 50, plantillas y selección aleatoria, vídeo de hasta 25 fotografías, audio, biblioteca personal, duración en la cabecera e IP del cliente) y DA-58 a DA-64 (subidas y descargas directas con URL firmada, simulador local de Blob, configuración validada al arrancar, IP del cliente endurecida, orden de las fotografías del vídeo y descarga con nombre).

## Resumen

| Recurso | Dónde | Formato | Límites |
| --- | --- | --- | --- |
| Fotografías | Ficha del inmueble («Fotografías») | JPEG, PNG o WebP, con miniatura JPEG de 480 px | **50 por inmueble**, 4 MB cada una, 100 MB en total por inmueble, lado mayor ≤ 2400 px tras la preparación |
| Cartel | Ficha del anuncio («Cartel y vídeo») | JPEG 1080 × 1350, una de 6 plantillas | 3 MB |
| Vídeo | Ficha del anuncio | MP4 (H.264 + AAC) si el navegador lo graba; si no, WebM (VP9/VP8 + Opus). 1280 × 720 | 4 MB, ≤ 60 s, hasta 25 fotografías |
| Pistas de audio personales | Opciones del vídeo («Mi biblioteca») | MP3, WAV, OGG (Vorbis u Opus) o M4A (AAC) | 20 por usuario, 4 MB y 5 minutos cada una |
| Pistas predeterminadas | Opciones del vídeo | Sintetizadas en el navegador | 5 pistas originales; no ocupan almacenamiento |
| Total por usuario | — | Fotografías, miniaturas, carteles, vídeos y pistas | `STORAGE_USER_QUOTA_MB` (500 MB por defecto) |

Los archivos se guardan en el almacenamiento de objetos: una carpeta en local y Vercel Blob privado en producción. PostgreSQL solo guarda metadatos (clave interna, tipo, tamaño, dimensiones, duración, huella SHA-256, posición, versión y opciones usadas). Ninguna respuesta incluye claves internas, y los archivos se sirven por la API después de comprobar la sesión y la propiedad.

**Por qué estos límites.** Cada archivo pasa por la API y debe caber en los 4,5 MB de una petición a una función de Vercel; por eso fotografías, vídeos y pistas tienen 4 MB como máximo. Con fotografías de 2400 px a buena calidad (0,3-2 MB), 50 caben holgadas en 100 MB. Los 100 MB por inmueble y la cuota por usuario protegen el almacenamiento gratuito (1 GB en Vercel Blob Hobby) sin reducir el límite funcional de 50.

## Galería (ficha del inmueble)

- **Subir.** «Añadir fotografías» admite muchas a la vez:
  - se suben de tres en tres, con el estado de cada archivo (en espera, subiendo, subida o el motivo del error) y un resumen;
  - un error no detiene a las demás;
  - los archivos repetidos en la misma selección y los que pasan de 50 se marcan sin enviarlos.
- **Preparación en el navegador.**
  - Las fotografías mayores de 2400 px o de 4 MB se reducen y recodifican en JPEG, probando calidades de 0,90 a 0,65 hasta caber, con la orientación EXIF aplicada. Las demás se suben tal cual.
  - Cada fotografía se decodifica una sola vez y se libera enseguida.
  - Junto a cada fotografía se genera y se sube su **miniatura** (480 px).
- **Ver.**
  - La rejilla muestra las miniaturas: con 50 fotografías, mostrar las originales ocuparía cientos de megas de memoria. Las fotografías anteriores sin miniatura la reciben en segundo plano.
  - Cada miniatura indica su posición («12/50») y la marca «Principal».
  - La vista grande tiene anterior, siguiente, teclado y Escape.
- **Ordenar.** Mover a la izquierda o a la derecha, o llevar una fotografía a cualquier posición desde la vista grande («Mover a la posición»). El orden es el que usan el cartel y el vídeo, siempre con la principal primero.
- **Principal, sustituir y eliminar** como antes:
  - siempre hay exactamente una principal;
  - al sustituir, se retira la miniatura anterior y se sube la nueva;
  - al eliminar, se pide confirmación y se compactan las posiciones.

Validación:

| Caso | Navegador | API |
| --- | --- | --- |
| Tipo no admitido | Rechazado con mensaje | 415 `TYPE_MISMATCH` |
| Contenido que no es la imagen declarada | La preparación falla | 400 `INVALID_FILE` o 415 (firma real y dimensiones) |
| Más de 4 MB tras la preparación | Se intenta reducir | 413 `TOO_LARGE` |
| Fotografía 51.ª | Rechazada, botón desactivado | 409 `LIMIT_REACHED` (también lo impide un trigger de PostgreSQL) |
| Más de 100 MB por inmueble o cuota del usuario superada | — | 409 `LIMIT_REACHED` o `QUOTA_EXCEEDED` |
| Repetida en el inmueble | Repetida en la selección: no se envía | 409 `DUPLICATE` (SHA-256) |
| Miniatura | — | Solo JPEG, ≤ 480 px y 256 KB, con la proporción de su fotografía |
| Inmueble o fotografía de otra cuenta | — | 404 |

## Cartel: plantillas y «Aleatoria»

En «Opciones del cartel» se elige el diseño. Cada miniatura del selector es una **vista previa real**: la plantilla dibujada con los datos de este anuncio y sus fotografías. La seleccionada se puede ampliar.

| Plantilla (id, versión 1) | Composición | Fotografías |
| --- | --- | --- |
| Elegante (`elegante`) | Fondo crema, doble filete dorado, tipografía con serifa, foto enmarcada y todo centrado | 1 |
| Minimalista (`minimalista`) | Foto a sangre en la mitad superior, mucho blanco, datos en una rejilla con filetes y precio alineado a la derecha | 1 |
| Editorial (`editorial`) | Titular de revista en mayúsculas, mosaico de tres fotos y texto real del anuncio en dos columnas | 3 |
| Premium (`premium`) | Fondo oscuro, foto con degradado, segunda foto circular con aro dorado, marco interior y precio dorado | 2 |
| Fotográfico (`fotografico`) | Las fotos llenan el cartel en mosaico (1, 2, 3 o 4) y los datos van en una tarjeta translúcida | 4 |
| Moderno (`moderno`) | Foto con corte diagonal, franja de color, segunda foto redondeada, precio en etiqueta, datos en píldoras y características con marca | 2 |

Cada plantilla toma sus fotografías en el orden de la galería, con la principal primero, y nunca más de las que necesita (con 50 fotografías, el cartel usa como mucho 4). Solo se descargan y decodifican esas, reducidas a 1600 px. Si falta un dato, no se dibuja. La dirección exacta nunca aparece.

**«Aleatoria — Elegir una variante al azar».** No es una plantilla, sino un modo de elección:
1. Al generar, la API sortea una plantilla con `crypto.randomInt`, con distribución uniforme entre las 6 del catálogo. «Aleatoria» no cuenta como opción, no hay pesos ni exclusiones, y con una sola plantilla se elige esa.
2. La API guarda el sorteo (`MediaTemplateDraw`).
3. El navegador dibuja la plantilla sorteada.
4. La API solo acepta el cartel como aleatorio con ese sorteo: propio, del mismo anuncio, sin usar, de la última hora y con la plantilla sorteada. El navegador no puede elegir la plantilla.
5. Cada regeneración con «Aleatoria» hace un sorteo nuevo; puede coincidir con la anterior por azar.

La interfaz muestra la plantilla que ha salido («Plantilla Editorial (elegida al azar)»). Si se elige una plantilla concreta, se usa exactamente esa.

Metadatos del cartel: `templateId`, `templateVersion` y `selectionMode` (`manual` o `random`), además de la clave del archivo, la fecha, la huella de la fuente (`sourceHash`) y las fotografías usadas. Los carteles anteriores a las plantillas aparecen como «Diseño anterior a las plantillas».

## Vídeo

- **Fotografías.**
  - Por defecto, todas hasta 25, en el orden de la galería y con la principal primero.
  - Selección manual (DA-58):
    - lista ordenada con subir, bajar y quitar, y debajo las fotografías «Sin incluir» con un botón para añadirlas al final;
    - la principal es obligatoria, va siempre primera y no se puede quitar ni mover;
    - se muestran el número elegido, cuántas caben aún («puedes añadir N más») y la **duración estimada**, y se avisa cuando son más de 15.
  - El vídeo usa exactamente ese orden, y la API lo valida:
    - la primera debe ser la principal;
    - como mucho 25;
    - solo fotografías del inmueble.

    Si una fotografía elegida ya no existe, la interfaz actualiza la selección y avisa (`SOURCE_CHANGED`).
  - El ritmo va de 3,5 s por fotografía, con pocas, a un mínimo de 2 s, con 25. Más de 25 obligaría a pasarlas demasiado rápido o a superar los 60 s y los 4 MB.
- **Memoria.** Solo hay unas pocas fotografías decodificadas a la vez: la actual, la anterior (para el fundido), las dos siguientes (precarga), la principal y la segunda. Se cargan reducidas a 1600 px y se liberan al dejar de usarse.
- **Grabación.**
  - Se graba en tiempo real con Canvas y MediaRecorder, y hay que mantener la pestaña visible.
  - Se puede cancelar; al salir de la página, la grabación se cancela.
  - No se pueden lanzar dos grabaciones del mismo recurso a la vez.

### Sonido

En «Opciones del vídeo» se elige:

1. **Sin sonido.** El archivo no lleva pista de audio.
2. **Una pista de EstateForge.** Son 5 composiciones originales («Piano sereno», «Hogar cálido», «Urbano moderno», «Brisa ambiental» y «Acústico suave»), escritas como código en `apps/web/src/lib/audioPresets.ts`:
   - una partitura con acordes, ritmo y melodía;
   - instrumentos sintetizados: piano aditivo, colchón, campana, bajo, cuerda pulsada Karplus-Strong y percusión de ruido.

   Se calculan en el navegador para la duración exacta del vídeo. No hay archivos ni muestras de terceros, y por eso no ocupan almacenamiento ni requieren licencias externas (ver «Procedencia del audio»).
3. **Una pista de «Mi biblioteca».** Ver el apartado siguiente.

Cada pista se puede **escuchar antes** con reproducir o pausar y volumen de escucha. Se pueden ajustar el **volumen en el vídeo** (0-100 %) y los **fundidos de entrada y de salida** (0-5 s). Nunca se pide el micrófono.

**Cómo queda el sonido dentro del archivo** (`soundtrack.ts` y `videoRenderer.ts`):
1. **Preparación de la banda sonora.** Antes de grabar se prepara entera, con la duración exacta del vídeo: la pista predeterminada se sintetiza, y la personal se descarga con la sesión y se decodifica (`decodeAudioData`).
   - Si la pista es **más corta**, se repite con un fundido cruzado de igual potencia, sin huecos.
   - Si es **más larga**, termina con el vídeo, con el fundido de salida elegido.
   - Siempre se añaden 30 ms de rampa en los extremos para evitar chasquidos.
   - La pista nunca cambia la duración de la presentación.
2. **Grabación.** Con Web Audio, la banda sonora se reproduce una sola vez hacia un `MediaStreamAudioDestinationNode`. Su pista se une a la del lienzo (`captureStream`) y MediaRecorder graba las dos a la vez, empezando juntas.
3. **Formato.** Se comprueba con `MediaRecorder.isTypeSupported` la **combinación completa** de vídeo y audio: `avc1+mp4a.40.2`, `avc1+opus`, `vp9+opus` o `vp8+opus`. Que un formato admita vídeo no basta.
4. **Comprobación final.** Al terminar se abre el archivo:
   - si se pidió sonido y no lo lleva, **no se guarda** y se explica el motivo; nunca se sustituye por silencio;
   - la API repite la comprobación.
5. **Liberación de recursos.** Se paran las pistas del `MediaStream`, se cierra el `AudioContext`, se liberan las fotografías y el lienzo, y se revocan las URL de objeto de las escuchas previas.

**Duración en la cabecera (DA-56).** MediaRecorder graba «en directo»: en MP4 deja la duración de la cabecera a 0 y en WebM omite el elemento `Duration`. Antes de subir el archivo, `packages/shared/src/container.ts` calcula la duración real a partir de las propias muestras y la escribe, sin FFmpeg ni dependencias:
- en MP4: `mvhd`, `tkhd`, `mdhd` y una caja `mehd`;
- en WebM: `Duration` dentro de `Info`.

Solo lo hace cuando no hay referencias absolutas que se desplacen; si las hay, conserva el archivo tal cual. Verificado en Edge y Chrome 157, en MP4 y en WebM: un reproductor nuevo con `preload="metadata"` muestra la duración correcta (la limitación MD-3 de la ronda anterior queda resuelta).

Metadatos del vídeo: MIME con códecs, `hasAudio`, origen del audio (`none`, `preset` o `library`), identificador y nombre de la pista, volumen, fundidos, duración medida en el archivo y fotografías usadas, además de la huella de la fuente.

## Biblioteca de audio personal

- Subir, escuchar, elegir y eliminar pistas propias. Se muestran nombre, duración, formato y tamaño, y una misma pista sirve para los vídeos de cualquier anuncio del usuario.
- **Declaración previa obligatoria.** Antes de subir hay que marcar: «Declaro que soy titular de esta pista o que tengo autorización para usarla en mis vídeos. EstateForge no concede licencias sobre el audio que subas». La API rechaza la subida sin esa declaración (`X-Rights-Confirmed`). La declaración es del usuario: EstateForge no concede ninguna licencia.
- **Validación en el navegador.** Formato por tipo o extensión, tamaño, y que el navegador **pueda decodificarla** (`decodeAudioData`), con su duración.
- **Validación en la API** (por el contenido real, no por la extensión ni el tipo declarado):
  - firma y estructura de cada formato: tramas MPEG y cabecera Xing/VBRI en MP3, `fmt `/`data` en WAV, cabecera Vorbis u `OpusHead` y última página en Ogg, `moov`/`mvhd` con pista de sonido en M4A;
  - duración de 1 s a 5 minutos y tamaño de hasta 4 MB;
  - que no esté repetida (SHA-256);
  - como máximo 20 pistas por usuario, límite que también impone un trigger.
- **Formatos y navegadores.** MP3, WAV, OGG y M4A se aceptan en la API. Que un navegador pueda decodificar cada uno depende de él: Edge y Chrome 157 informan de MP3, OGG, M4A y WAV. Por eso la comprobación de decodificación se hace en el navegador de quien sube la pista y, si falla, se explica.
- **Seguridad y caché.**
  - Cada pista es de quien la sube: listar, escuchar, descargar, borrar o usarla en un vídeo con una pista ajena responde 404.
  - Las rutas exigen sesión y la caché es privada y revalidada, como en las fotografías.
- **Borrar una pista** elimina su archivo mediante la cola de limpieza. Los vídeos que ya la incorporan no cambian: el sonido está dentro del archivo, y `audioTrackId` no es una clave ajena.

## Procedencia del audio

| Pista | Autoría y procedencia | Licencia |
| --- | --- | --- |
| Las 5 pistas predeterminadas | Composición y síntesis originales, escritas como código para EstateForge en `apps/web/src/lib/audioPresets.ts`; sin muestras, grabaciones ni archivos de terceros | Las del propio repositorio de EstateForge: no hay material ajeno que licenciar. La decisión sobre la licencia de distribución del proyecto corresponde a su titular |
| Pistas de los usuarios | Las sube cada usuario bajo su declaración de derechos | EstateForge no concede licencias sobre ellas |

No se ha descargado ni incorporado ningún archivo de audio de terceros.

## Idioma del cartel y del vídeo

El cartel y el vídeo usan el idioma **guardado en el anuncio** (`Generation.language`), no el del selector. Generar después otro anuncio en otro idioma no cambia el material de este. La interfaz de EstateForge sigue en español.

**Origen del idioma.** La fuente que entrega la API (`GET /api/generations/:id/media/source`) incluye `generation.language` («español» o «english»). Las respuestas anteriores al campo se tratan como español.

**Qué se traduce.** Todas las etiquetas automáticas que se dibujan salen de una única fuente compartida, `packages/shared/src/listing-copy.ts`, la misma que usa la plantilla local de la API para redactar el anuncio:

- tipo de inmueble, operación, estado comercial y extras;
- habitaciones y baños, con sus plurales;
- planta: planta baja, sótanos y ordinales ingleses (1st, 2nd, 3rd, 11th, 12th, 13th, 21st…);
- sufijo del alquiler (`/mes`, `/month`) y rótulo «Características»/«Features». El pie de atribución a EstateForge se ha eliminado en ambos idiomas.

Lo cumplen las vistas previas, las seis plantillas, «Aleatoria» (que sortea una de ellas) y los vídeos clásicos. Los materiales con IA conservan su aviso de contenido asistido o generado con IA, traducido al idioma del anuncio; no llevan pie de atribución.

**Formatos.** Los importes siguen en euros y las superficies en m², con los mismos dígitos que el dato (sin coma flotante ni conversiones): `250.000 €` y `€250,000`, `92,5 m²` y `92.5 m²`. Barrio y ciudad se conservan tal cual, como nombres propios.

**Textos del anuncio.** Título, descripción, destacados y llamada a la acción se dibujan tal como están guardados en el anuncio, incluida cualquier edición manual. Generar el cartel o el vídeo nunca modifica el anuncio. El título del inmueble (texto libre del usuario) solo sirve de respaldo en español; nunca se dibuja en un material inglés.

**Huella y material anterior.**

- La huella incluye una revisión del renderizado (`rendererVersion: 2`), además del idioma cuando no es el español. La eliminación del pie cambia el resultado en ambos idiomas: el material anterior se muestra como desactualizado y no se ofrece su descarga desde la tarjeta hasta regenerarlo. No se borran sus archivos durante este despliegue.
- Los anuncios guardados en inglés antes de este cambio tienen una huella nueva. Su material se compuso con etiquetas españolas, por eso debe **regenerarse** desde «Cartel y vídeo». Al guardar, la protección de siempre rechaza un material calculado con la huella anterior (`SOURCE_CHANGED`).
- No se ha reescrito ningún anuncio ni archivo existente.

## Regeneración segura (cartel y vídeo)

Igual que antes, para cada recurso por separado:
1. Confirmación con las opciones elegidas.
2. Generación en el navegador.
3. Validación del contenido real en la API.
4. Almacenamiento con una clave nueva.
5. Transacción que bloquea usuario, inmueble y anuncio, recalcula la huella (`SOURCE_CHANGED`), comprueba la versión (`VERSION_CONFLICT`), la cuota y, en «Aleatoria», el sorteo.
6. Borrado del archivo anterior tras el commit; si falla, queda en `StorageCleanup` para reintentarlo.

Si falla cualquier paso, se conserva la versión anterior. Regenerar el cartel no toca el vídeo, y al revés.

## Caché de los archivos

**Almacenamiento local sin URLs firmadas** (desarrollo):
- fotografías, miniaturas, carteles, vídeos y pistas se sirven con `Cache-Control: private, no-cache`, `ETag` y `Vary: Cookie`;
- la API repite la comprobación de sesión y propiedad en cada revalidación y responde 304 sin leer el almacenamiento si el archivo no ha cambiado (DA-48, MD-1).

**Con Vercel Blob o con `STORAGE_LOCAL_SIGNED_URLS=1`** (DA-58):
- las mismas rutas comprueban la sesión y la propiedad en cada petición;
- responden `302` hacia una URL firmada de corta duración, o JSON con `?as=url`;
- la respuesta lleva `Cache-Control: private, no-store`: la URL firmada no se guarda en ninguna caché compartida;
- MD-1 se mantiene: sin sesión o con otra cuenta no se emite ninguna URL.

## Subidas y descargas directas

Con Vercel Blob, una función admite como máximo 4,5 MB de cuerpo. Por eso los archivos van directamente del navegador al almacenamiento:
1. **Preparar.** La API comprueba, reserva la cuota y firma un `PUT` de 15 minutos para una clave que elige ella.
2. **Enviar.** El navegador hace el `PUT` con progreso, cancelación y reintentos.
3. **Confirmar.** La API lee el archivo real, lo valida y lo asocia.

Cancelar o dejar caducar una subida libera la reserva y borra el archivo mediante la cola de limpieza. En la galería se ve el porcentaje de cada archivo y el botón «Cancelar subidas».

El botón «Descargar» guarda el cartel o el vídeo con su nombre (`estateforge-cartel-<anuncio>.jpg`). La arquitectura completa, las caducidades y lo que falta por verificar contra Blob están en [Preparación para Vercel, Neon y Blob](despliegue/vercel-neon-blob.md#transferencias-directas-da-58).

## API

| Método y ruta | Uso |
| --- | --- |
| `GET /api/properties/:id/photos` | Lista, límites y espacio usado |
| `POST /api/properties/:id/photos` | Sube una |
| `PUT /api/properties/:id/photos/:photoId/thumbnail` | Miniatura JPEG de una fotografía |
| `PUT /api/properties/:id/photos/order` | Permutación exacta |
| `PUT /api/properties/:id/photos/:photoId/primary` | Elige la principal |
| `PUT /api/properties/:id/photos/:photoId/file` | Sustituye |
| `DELETE /api/properties/:id/photos/:photoId` | Elimina |
| `GET /api/properties/:id/photos/:photoId/file[?size=thumb][&as=url]` | Archivo o miniatura (en modo directo, `302` o JSON con la URL firmada) |
| `GET /api/generations/:id/media` | Cartel y vídeo actuales con sus metadatos |
| `GET /api/generations/:id/media/source` | Datos para componerlos, su huella y el máximo de fotografías del vídeo |
| `POST /api/generations/:id/media/poster/template-draw` | Sorteo de plantilla para «Aleatoria» |
| `PUT /api/generations/:id/media/:kind` | Guarda `poster` o `video` (ver las cabeceras debajo) |
| `GET /api/generations/:id/media/:kind/file[?download=1][&as=url]` | Archivo (en modo directo, `302` o JSON con la URL firmada) |
| `GET /api/audio-tracks` | Biblioteca propia y sus límites |
| `POST /api/audio-tracks` | Sube una pista (cuerpo binario, `X-File-Name`, `X-Rights-Confirmed: yes`) |
| `DELETE /api/audio-tracks/:id` | Elimina una pista propia |
| `GET /api/audio-tracks/:id/file` | Archivo de una pista propia |
| `POST /api/uploads` | Prepara una subida directa (JSON: `kind`, `contentType`, `size` y el destino; nunca la ruta). Devuelve el intento y la URL firmada de `PUT` |
| `POST /api/uploads/:id/complete` | Confirma: valida el archivo subido y lo asocia (idempotente) |
| `DELETE /api/uploads/:id` | Cancela una subida pendiente |
| `GET`/`PUT /api/local-blob/*` | Simulador local de Blob (solo almacenamiento local; la firma HMAC es la autorización) |

Cabeceras de `PUT /api/generations/:id/media/:kind`:
- comunes: `X-Source-Hash`, `X-Expected-Version`, `X-Media-Variant` y `X-Photo-Ids`;
- cartel: `X-Template-Id`, `X-Template-Selection` y `X-Template-Draw`;
- vídeo: `X-Media-Duration-Ms`, `X-Audio-Source`, `X-Audio-Track`, `X-Audio-Volume`, `X-Audio-Fade-In-Ms`, `X-Audio-Fade-Out-Ms` y `X-Media-Codecs`.

Todas las rutas exigen sesión. Límites de frecuencia por IP:

| Operaciones | Límite |
| --- | --- |
| Escrituras de la galería | 300 cada 15 minutos |
| Guardado de material | 30 por hora |
| Sorteos | 60 por hora |
| Escrituras de audio | 30 por hora |
| Subidas directas (preparar, confirmar y cancelar) | 400 cada 15 minutos |

Con transferencias directas, las rutas que reciben archivos (`POST …/photos`, `PUT …/file`, `PUT …/thumbnail`, `PUT …/media/:kind` y `POST /api/audio-tracks`) responden `409 DIRECT_UPLOAD_REQUIRED`.

## Selector de plantillas y generación con IA

- **Maquetación (DA-76).** Las tarjetas de plantilla se adaptan al ancho: columnas automáticas, `min-width: 0` en el `<fieldset>` y en las tarjetas, y texto que se parte y hace crecer la tarjeta (nunca se oculta). Antes, el `<fieldset>` (con `min-inline-size: min-content`) y el ancho intrínseco de las vistas previas ensanchaban la rejilla, y las descripciones se salían de su recuadro. Comprobado en Edge, Chrome y Firefox a 360, 390, 600, 768, 1024, 1280 y 1440 px, también con textos largos y palabras muy largas.
- **Generación con IA.** Opción diferenciada en el selector de cartel y modalidad del vídeo, con la API key del propio usuario. Nunca forma parte de «Aleatoria». Ver [Carteles y vídeos con IA (BYOK)](producto-ia-byok.md).

## Compatibilidad comprobada

E2E reales del 11/11/2026, con el simulador local de Blob (`STORAGE_LOCAL_SIGNED_URLS=1`) y PostgreSQL 17:
- **«Directo»** (42 comprobaciones): subidas directas, progreso, cancelación, redirecciones firmadas, Range, descarga con nombre, orden de las fotografías del vídeo, vídeo de una sola fotografía y seguridad entre cuentas.
- **«Regresión»** (56 comprobaciones): galería de 50, seis plantillas y «Aleatoria», audio, vídeo con y sin sonido y seguridad.

| Navegador | Grabación con sonido | Directo | Regresión |
| --- | --- | --- | --- |
| Microsoft Edge 157 (Windows, headless) | MP4 H.264 + AAC | 42/42 | 56/56 |
| Google Chrome 157 (Windows, headless) | MP4 H.264 + AAC | 42/42 | 56/56 |
| Chrome 157 con MP4 desactivado | WebM VP9 + Opus | — | 56/56 |
| Mozilla Firefox 160 (Windows, headless, WebDriver BiDi) | WebM VP8 + Opus | 42/42 | 56/56 |
| Safari | — | **No comprobado**: no existe para Windows | — |

Ronda de BYOK de IA (11/11/2026): E2E de 38 comprobaciones (maquetación de las plantillas en siete anchos, ajustes, cartel y vídeo con IA con el simulador, bloqueo, rechazo, «Aleatoria» y seguridad entre cuentas): 38/38 en Edge, Chrome y Firefox 160.

Diferencias de Firefox 160, comprobadas con el navegador instalado:
- **Formato.** `MediaRecorder` no graba MP4 ni VP9, solo WebM VP8, y VP8 + Opus con sonido. La aplicación elige ese formato por capacidad, sin forzarlo.
- **Duración en la cabecera.** Firefox reserva el elemento `Duration` con valor 0. Ahora se escribe en su sitio sin mover bytes (DA-66), y el archivo descargado indica la duración real.
- **Progreso de subida.** Firefox da por enviado el archivo en cuanto lo entrega a la red, aunque los bytes sigan saliendo. El indicador se queda como mucho en el 99 % hasta que responde el almacenamiento (DA-65).
- **Lectura del vídeo.** Firefox lee el vídeo con una sola petición `Range: bytes=0-` (206) y avanza dentro de lo descargado. Los saltos a rangos parciales están cubiertos por las pruebas de integración.

## Datos de ejemplo

`pnpm --filter api db:seed` añade ilustraciones sintéticas a cuatro inmuebles de la cuenta de ejemplo. Sus miniaturas se generan al abrir la galería.

## Cómo evaluarlo

1. `pnpm dev` y entrar con la cuenta de ejemplo.
2. **Galería.** Añadir muchas fotografías de golpe y observar los estados y el «N de 50». Mover una a otra posición desde la vista grande.
3. **Cartel.** En un anuncio, abrir «Opciones del cartel» y comparar las vistas previas. Generar con una plantilla concreta y después regenerar con «Aleatoria» (la interfaz dice cuál ha salido).
4. **Vídeo.** En «Opciones del vídeo»:
   - escuchar las pistas;
   - generar con «Hogar cálido» y comprobar que el vídeo descargado suena;
   - subir una pista propia (declarando los derechos) y regenerar con ella;
   - regenerar sin sonido.

## Limitaciones

- La grabación depende de MediaRecorder y de Web Audio del navegador de quien genera. Comprobada en Edge y Chrome 157 (MP4 H.264 + AAC) y en Firefox 160 (WebM VP8 + Opus); Safari no se ha podido probar.
- El vídeo se graba en tiempo real (hasta 60 s) y la pestaña debe estar visible.
- La API comprueba la estructura de las pistas, pero no decodifica el sonido: la decodificación completa la hace el navegador antes de subirla.
- No hay recorte ni edición de fotografías ni de audio.
- El material en inglés (cartel y vídeo clásico) solo se ha comprobado en Edge, en modo headless. No se ha probado en Safari, Chrome ni Firefox.
- Los textos incrustados en una fotografía (por ejemplo, si se subió un cartel antiguo como foto) no son etiquetas del generador y no se traducen ni eliminan. Las fotografías deben sustituirse por originales sin texto si se quiere evitar ese contenido. Las ediciones manuales del anuncio se mantienen al generar material; para rehacerlas se usa el cambio confirmado de idioma.
- Las subidas directas están probadas con el simulador local de Blob. El comportamiento real de Blob está pendiente de verificar: CORS del `PUT` y del `GET` prefirmados, Range y caducidad.
- La integración con Vercel Blob y la IP del cliente en Vercel (MD-4) **no se han probado contra el servicio real**: ver [Preparación para Vercel, Neon y Blob](despliegue/vercel-neon-blob.md).

### Editar el idioma y rehacer el anuncio

El control aparece **solo al editar** un anuncio: desde su detalle, desde la ficha del inmueble y en la edición del resultado de «Crear inmueble». Solo ofrece el idioma contrario al guardado. La API rechaza volver a generar en el idioma actual. La confirmación avisa de los textos y materiales que se sustituyen y de las ediciones manuales que se pierden.

El cambio se prepara aparte durante un máximo de 15 minutos: una preparación de texto y subidas temporales, sin modificar los campos ni archivos actuales. El navegador compone y sube el material existente, conservando la plantilla clásica, selección de fotos y sonido disponibles. Solo cuando todos los archivos están listos, una única transacción cambia el texto y las referencias de cartel/vídeo; valida los archivos reales, la cuota de todo el lote y las versiones actuales. Si falla cualquier parte, no se publica ninguna. La confirmación final es idempotente.

Salir, recargar o cancelar durante la preparación aborta el trabajo del navegador y solicita descartar la preparación. Los intentos sin confirmar también caducan aunque no llegue la cancelación. La limpieza diaria y las nuevas preparaciones caducan los registros temporales; los triggers existentes encolan sus archivos para borrado. No se intenta deshacer un cambio ya confirmado: el punto de finalización es la transacción de guardado.

Al guardar correctamente se recarga el anuncio directamente, sin manejador `beforeunload` propio ni confirmación de salida. Un fallo al preparar permite reintentar con el mismo texto temporal, sin una nueva generación de texto; no se publican cambios parciales. Una respuesta de guardado perdida puede reconfirmarse sin crear versiones adicionales.

El texto conserva el proveedor original. Si usa IA, la confirmación informa de la operación con la API key y preferencias del usuario, coste no verificable y aceptación del consumo: una llamada ya realizada puede tener coste aunque después se abandone la preparación. El material se recompone en modo clásico sin IA, avisando de la sustitución de diseños de IA. No se han usado proveedores de IA reales durante las pruebas.
