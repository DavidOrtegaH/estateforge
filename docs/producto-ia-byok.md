# IA con la API key de cada usuario (BYOK obligatorio): textos, carteles y vídeos

Decisiones DA-67 a DA-93; trazabilidad en `revision/specdd_adopcion/planificacion_auditoria_v2/plan_y_trazabilidad.md`, apartados 23 a 28.

> **Catálogo ampliado (DA-82 a DA-86).** Desde el 13/11/2026 EstateForge ofrece 15 proveedores de IA, incluidos agregadores, varias cuentas por proveedor y la elección de modelo en cada generación. Los proveedores, modelos, capacidades, límites y precios están en [proveedores-ia.md](proveedores-ia.md), junto con el clasificador de seguridad externo y lo que no se ha integrado. Este documento describe el funcionamiento general de BYOK; donde cita solo a Gemini y OpenAI, vale lo mismo para el resto del catálogo.

> **Diagnóstico y pruebas reales controladas (DA-87 a DA-89, 15/11/2026).** La comprobación de una conexión no genera contenido; si la documentación del proveedor no indica su coste, solo se hace con la confirmación del usuario, y guarda un diagnóstico (permiso denegado distinto de clave rechazada, modelos del catálogo que lista la cuenta). Para validar de verdad un proveedor, cada usuario puede lanzar desde Ajustes una **prueba real controlada**: una sola operación con un inmueble ficticio e imágenes sintéticas, tras ver el proveedor, el modelo, la cuenta que factura y el coste (o «Coste no verificable») y aceptarlo; el resultado se valida y se descarta. Ningún proveedor está validado todavía contra su servicio real. Detalle en [proveedores-ia.md](proveedores-ia.md).

> **Seis pruebas propuestas, logotipos y formulario (DA-90 a DA-93, 15/11/2026).** Ajustes ofrece seis pruebas reales agrupadas por modalidad (una API directa y un agregador para texto, imagen y vídeo), cada una con su confirmación individual, la cuenta elegida por el usuario y el desglose del coste (generación, referencias y clasificador; lo no calculable, como «no estimable»). Las tarjetas de proveedores muestran el logotipo de quien factura. El formulario de generación (método, tono e idioma) ya no se solapa: tres columnas independientes cuando hay espacio, dos en tableta y una en móvil.

## Formulario de generación (DA-90)

En «Nuevo inmueble» y en el detalle del inmueble, los tres campos (método de generación, tono e idioma) son elementos independientes de una rejilla con `min-width: 0`; cada selector ocupa el 100 % de su campo (`box-sizing: border-box`) y nunca fija el ancho de su columna. La descripción del método va dentro de su campo. El número de columnas depende del ancho real del formulario (consulta de contenedor), no de la ventana: una columna por debajo de 24rem, dos (el método en toda la fila) desde 24rem y tres desde 32rem, con la columna del método algo más ancha (1,7 : 1 : 1) para que su texto quepa entero. El modelo, la cuenta, el coste y la confirmación de la IA ocupan una fila de ancho completo bajo los tres campos. Sin alturas fijas, sin `overflow: hidden` y sin posiciones absolutas. Antes, el selector del método tomaba el ancho de su opción más larga y se extendía sobre Tono e Idioma.

**Estado:**
- **Implementado y probado en local**, sobre PostgreSQL real, en Edge, Chrome y Firefox 160:
  - el flujo completo (credenciales cifradas, trabajos asíncronos, moderación, revisión y sustitución);
  - el adaptador de Google Gemini, solo con respuestas simuladas que siguen la forma documentada (pruebas de contrato).
- **No verificado contra el servicio real:** no se ha usado ninguna API key real ni se ha hecho ninguna llamada facturable (no estaba autorizado). Las integraciones con Gemini y con OpenAI quedan **pendientes de verificar con la API key de un usuario**; sus catálogos y precios están verificados solo documentalmente (12/11/2026).

## BYOK obligatorio: EstateForge no aporta claves de IA (DA-77)

**EstateForge no proporciona API keys propias ni financia el consumo de servicios de IA de sus usuarios.** Desde esta decisión:
- no existe ninguna clave de proveedor de IA en el servidor: `GEMINI_API_KEY`, `OPENAI_API_KEY` y `AI_PROVIDER` se han eliminado de la configuración; si quedan en el entorno, se ignoran (ni se leen ni se migran a cuentas de usuario);
- la API arranca sin ninguna clave de IA;
- **toda** llamada a un proveedor de IA (texto del anuncio, cartel, vídeo y la moderación asociada) usa la API key del usuario autenticado, guardada cifrada; no hay respaldo, clave compartida ni sustitución silenciosa por otro proveedor o por un método sin IA;
- la antigua clave temporal por petición («Usar mi propia API key» al generar) se ha retirado: la clave solo se introduce en Ajustes y nunca viaja en las peticiones de generación;
- `ESTATEFORGE_API_KEY_ENCRYPTION_KEY` se mantiene: es la clave **interna** de cifrado de las credenciales, no una clave de un proveedor.

### Inventario de llamadas a IA

| Función | Proveedor y modelo | Credencial | Código | Coste | Sin clave |
|---|---|---|---|---|---|
| Texto del anuncio (título, descripción, puntos destacados y llamada a la acción) | Gemini `gemini-3.6-flash` o `gemini-3.5-flash-lite`; OpenAI `gpt-6.1-terra`, `gpt-6-luna`, `gpt-6.1-sol` o `gpt-5.5` (heredado) | Del usuario | `services/generation.service.ts` (`generateWithUserKey`), `ai/*.provider.ts` | En la cuenta del usuario | 409 `AI_KEY_REQUIRED`; quedan la plantilla local y la edición manual |
| Texto con la plantilla local (`mock`) | Ninguno: no es IA ni llama a nada | Ninguna | `ai/mock-ai.provider.ts` | Ninguno | Disponible siempre |

**Idioma de la plantilla local.** La plantilla respeta el idioma elegido (español por defecto) y es determinista. Sus etiquetas salen de `packages/shared/src/listing-copy.ts`, la misma fuente que usan el cartel y el vídeo.

- **Español:** usa el título del inmueble y añade al final de la descripción las observaciones del usuario, como hasta ahora.
- **Inglés:** título, descripción, destacados y llamada a la acción se construyen en inglés solo a partir de los datos estructurados. El ejemplo «3-bedroom apartment for sale in Chamberí, Madrid» conserva barrio y ciudad tal cual.
- **Texto libre en inglés:** el título y las observaciones del inmueble son texto libre que el usuario escribió en español. Un diccionario no los traduce, así que no se copian como si estuvieran traducidos.
  - Las observaciones quedan fuera del anuncio inglés y la API devuelve el aviso `FREE_TEXT_NOT_INCLUDED`. La web lo muestra e indica que se puede añadir la versión inglesa editando el anuncio.
  - El inmueble conserva su título en español.
  - No se promete ninguna traducción automática.
- **Correcciones del español:**
  - los traspasos ya no se redactan como venta;
  - los tipos dúplex, estudio, oficina y terreno tienen su nombre;
  - la planta baja y los sótanos se redactan bien;
  - se añade el punto que faltaba tras la planta;
  - sin superficie, las estancias quedan en una frase completa;
  - un inmueble sin superficie, estancias ni extras ya no hace fallar la generación: se destaca el precio.
- **Validación:** la validación de coherencia del anuncio (`listing-validator.service.ts`) reconoce etiquetas españolas. Con un anuncio inglés no rechaza nada indebidamente, pero tampoco aplica sus comprobaciones de extras y datos a textos ingleses redactados por un proveedor de IA (limitación conocida; la plantilla local usa datos exactos).
| Fondo del cartel con IA | Gemini (modelos de imagen) | Del usuario | `ai-media/jobs.service.ts`, `gemini.adapter.ts` | En la cuenta del usuario | Opción deshabilitada con enlace a Ajustes |
| Vídeo con IA | Gemini (`gemini-omni-flash`) | Del usuario | Ídem | En la cuenta del usuario | Opción deshabilitada; el vídeo clásico sigue disponible |
| Moderación y clasificación de entradas y resultados | Reglas locales (sin coste) y clasificador del mismo proveedor | Del usuario | `ai-media/policy.ts`, `gemini.adapter.ts` | En la cuenta del usuario (se avisa antes de confirmar) | No se ejecuta: sin clave no hay generación con IA |
| Comprobación de la conexión | Consulta de modelos del proveedor (no genera contenido) | Del usuario | `routes/ai-media.routes.ts`, adaptadores | Sin generación | No aplica |

No hay más llamadas a IA: los carteles de plantilla, Aleatoria, el vídeo clásico y el audio se componen en el navegador, y ni el seed ni los scripts usan IA.

### Texto con IA

- En «Nuevo inmueble» y en «Generar anuncio», el selector ofrece siempre **Plantilla local (sin IA)**. Los proveedores de IA aparecen deshabilitados («requiere tu API key») hasta que el usuario guarda su clave; un aviso explica que EstateForge no aporta claves y enlaza con Ajustes.
- El modelo es el de la preferencia «Textos con IA» de Ajustes si pertenece al proveedor elegido; sin preferencia para ese proveedor, el recomendado del catálogo. El navegador no puede indicar un modelo.
- Errores: sin clave, 409 `AI_KEY_REQUIRED`; clave que no se puede descifrar, 409 `AI_KEY_UNREADABLE`; clave rechazada o sin cuota, el error del proveedor referido a la cuenta del usuario. En ningún caso se prueba otra clave ni otro proveedor.
- **OpenAI:** solo para texto, con la API Responses y salida estructurada (JSON con esquema estricto). Catálogo y precios verificados **documentalmente** el 12/11/2026 (ver «OpenAI: modelos y precios»). No se ha llamado al servicio real: la integración sigue pendiente de verificar con la API key de un usuario (MD-35).
- **Modelo retirado o sin acceso.** Si el modelo guardado en la preferencia deja de estar en el catálogo, la generación responde 400 `AI_MODEL_NOT_ALLOWED` con un aviso para elegir otro en Ajustes, donde la preferencia aparece marcada como no disponible; EstateForge no lo cambia por su cuenta. Si es el proveedor quien no reconoce el modelo o la cuenta no tiene acceso (404), se informa igual. En ningún caso se prueba otro modelo.
- **Límite de peticiones y cuota.** Un 429 por límite de peticiones (`AI_RATE_LIMITED`, transitorio) se distingue de la cuota agotada (`AI_QUOTA_EXCEEDED`, hay que revisar el plan).
- Los precios de texto llevan su fuente, fecha y modalidad; no se calcula un importe por adelantado porque depende de los tokens de cada petición. Lo factura el proveedor.

### OpenAI: modelos y precios

Documentación oficial consultada el 12/11/2026 (las páginas no muestran fecha de actualización):
- https://developers.openai.com/api/docs/models
- https://developers.openai.com/api/docs/models/gpt-6.1-sol
- https://developers.openai.com/api/docs/models/gpt-6.1-terra
- https://developers.openai.com/api/docs/models/gpt-6-luna
- https://developers.openai.com/api/docs/models/gpt-5.5
- https://developers.openai.com/api/docs/pricing
- https://developers.openai.com/api/docs/deprecations

Precio estándar en dólares por millón de tokens, para peticiones de hasta 272 000 tokens de entrada (las de EstateForge son de unos pocos miles):

| Modelo | En EstateForge | Entrada | Entrada en caché | Salida |
|---|---|---:|---:|---:|
| `gpt-6.1-terra` | Recomendado (equilibrio entre calidad y coste) | 1,00 | 0,05 | 5,00 |
| `gpt-6-luna` | Alternativo (el más económico) | 0,10 | 0,01 | 0,50 |
| `gpt-6.1-sol` | Alternativo (mayor calidad) | 2,00 | 0,10 | 10,00 |
| `gpt-5.5` | Heredado | 5,00 | 0,50 | 30,00 |

Lo que dicen esas páginas, resumido:
- **Identificadores.** Los cuatro son identificadores de API; los GPT-6 no listan versiones fechadas y `gpt-5.5` apunta a `gpt-5.5-2026-04-23`.
- **Capacidades.** Entrada de texto e imagen y salida de texto. EstateForge solo envía texto y solo los ofrece para el texto del anuncio: no se declara imagen, vídeo ni moderación con OpenAI.
- **Endpoints.** Responses (`/v1/responses`), Chat Completions y Batch. EstateForge usa Responses con salida estructurada, que los cuatro admiten. No envía herramientas, imágenes ni parámetros de muestreo.
- **Contexto.** 1 050 000 tokens de ventana y 128 000 de salida máxima.
- **Otras modalidades de precio (no usadas).** Por encima de 272 000 tokens de entrada, el doble en entrada y caché y 1,5 veces en salida; Batch y Flex, la mitad; modo Fast, el doble; el procesamiento regional añade un 10 %. No hay precios promocionales publicados para estos modelos.
- **Estado y retirada.** Las páginas no indican un estado (GA, preview…) y ninguno de los cuatro figura en la página de retiradas. `gpt-5.5` se conserva como heredado para no cambiar la elección de quien ya lo tuviera; es más caro que los GPT-6.
- **Límites.** Dependen del nivel de uso de cada cuenta (desde 5 000 peticiones por minuto en el nivel inicial). Que un modelo esté en el catálogo no garantiza que la cuenta de un usuario tenga acceso a él.
- **Modelos no incluidos.** `gpt-6-astra` (el más capaz y el más caro: 10 $ / 50 $), `gpt-6-sol` y `gpt-5.6-sol` (este con un precio promocional hasta el 30/11/2026) aparecen en la documentación, pero no se han añadido: no aportan nada al texto de un anuncio frente a los tres elegidos.
- **Diferencia con los datos de partida.** La entrada en caché publicada es 0,10 $ para `gpt-6.1-sol` y 0,05 $ para `gpt-6.1-terra` (no 0,20 $ y 0,10 $, que corresponden a las peticiones de contexto largo). El catálogo usa los valores publicados para el contexto corto.

**Comprobación de la clave.** `GET /v1/models` (la lista de modelos de la cuenta) con `Authorization: Bearer`: no genera contenido ni consume tokens. Es una operación distinta de generar: que la comprobación no cueste no hace gratuito ningún modelo, y una clave válida puede no tener saldo o acceso a un modelo concreto.

### Gemini: precios de texto

Página oficial https://aistudio.google.com/docs/pricing, consultada de nuevo el 12/11/2026 (plan de pago, proceso estándar, dólares por millón de tokens):

| Modelo | En EstateForge | Entrada | Entrada en caché | Salida |
|---|---|---:|---:|---:|
| `gemini-3.6-flash` | Recomendado | 0,75 | 0,075 | 3,75 |
| `gemini-3.5-flash-lite` | Alternativo; también es el clasificador de seguridad | 0,30 | 0,03 | 2,50 |

Los precios de `gemini-3.6-flash` son **temporales**: valen hasta el 31/12/2026 y desde el 01/01/2027 pasan a 1,50 $, 0,15 $ y 7,50 $. Ambos modelos tienen nivel gratuito según esa página.

## Qué es

Cada usuario guarda su propia API key de un proveedor de IA en **Ajustes → Integraciones de inteligencia artificial**. EstateForge la usa solo en el servidor y solo para lo que el usuario pide:
- **cartel con IA:** la opción «Generación con IA» del selector de plantillas;
- **vídeo con IA:** la modalidad «Generación con IA» del vídeo.

EstateForge no aporta ninguna clave propia ni recurre a la de otro usuario o a una global: sin clave, la opción no está disponible. El consumo se cobra en la cuenta del usuario en el proveedor.

## Proveedores y modelos

El catálogo lo define la API (`apps/api/src/ai-media/registry.ts`) y la web lo consulta en `GET /api/ai/providers`. El usuario no puede indicar endpoints, `baseURL`, URLs, webhooks ni modelos fuera del catálogo.

Documentación oficial de Gemini consultada el 11/11/2026 en aistudio.google.com/docs (los precios, de nuevo el 12/11/2026):
- `image-generation`, `omni`, `safety-settings`, `pricing`, `models` y `terms`;
- las URLs de ai.google.dev redirigen allí.

| Proveedor | Modelo | Uso | Estado según la documentación | Precio publicado (plan de pago) |
|---|---|---|---|---|
| Google Gemini | `gemini-3.1-flash-image` (Nano Banana 2) | Fondo del cartel | Estable | 0,067 $ por imagen generada de 1K; la entrada, 0,50 $ por millón de tokens |
| Google Gemini | `gemini-3.1-flash-lite-image` (Nano Banana 2 Lite) | Fondo del cartel | Estable | 0,0336 $ por imagen generada de 1K; la entrada, 0,25 $ por millón de tokens |
| Google Gemini | `gemini-omni-1.2-flash` (Gemini Omni Flash) | Clip de vídeo | Disponible (GA) en el plan de pago | ≈0,07 $/s a 720p (12 $ por millón de tokens de salida; 5792 tokens/s); la entrada, 1,50 $ por millón de tokens |
| Google Gemini | `gemini-3.5-flash-lite` | Clasificador de seguridad | Estable | 0,30 $ / 0,03 $ / 2,50 $ por millón de tokens (entrada / entrada en caché / salida) |
| Simulador local | `sim-imagen-1`, `sim-video-1` | Desarrollo y pruebas | **No es un proveedor real** | Sin coste (no usa red) |

Notas sobre los modelos:
- **Retirados.** Imagen 4 y Veo 3.1 aparecen como retirados («shut down») en la documentación, así que no se usan.
- **Omni.** La versión `gemini-omni-1.1-flash` que se citaba al plantear el trabajo se redirige a la 1.2 a partir del 3/12/2026.
- **Nivel gratuito.** Ninguno de los modelos de imagen o vídeo lo tiene.

| Capacidad | Gemini | Simulador |
|---|---|---|
| Imagen y edición con referencias | Sí (hasta 14 referencias; EstateForge envía como máximo 3) | Sí |
| Vídeo con referencias | Sí (3-15 s, hasta 6 referencias, 16:9 o 9:16) | Sí (clip fijo de 6 s) |
| Moderación | Filtros del proveedor y clasificador | Determinista según la clave de prueba |
| Operaciones asíncronas | API Interactions en segundo plano (`background: true`), consulta y cancelación | Sí |

OpenAI se usa solo para generar el texto del anuncio: no se declara ninguna capacidad de imagen, de vídeo ni de moderación para él, aunque sus modelos admitan imágenes de entrada.

## Configuración de una API key

1. En Ajustes, en la tarjeta del proveedor, se escribe la clave y se pulsa «Guardar». Se envía por HTTPS una sola vez, el campo se vacía y nunca se vuelve a mostrar: solo «API key configurada: ••••••••A91F».
2. «Comprobar conexión» hace una operación mínima que **no genera contenido**: en Gemini, `GET /v1beta/models/gemini-3.5-flash-lite`. La documentación no indica el coste de esa consulta. El estado queda como «Verificada», «Clave rechazada» o «Error al comprobar».
3. Después se elige el **proveedor predeterminado** para carteles y para vídeos. Solo se ofrecen modelos del catálogo de proveedores con clave guardada.

Una misma clave de Gemini sirve para carteles, vídeos y la generación de texto: se guarda una sola vez.

| Operación | Comportamiento |
|---|---|
| Sustituir | Se guarda la clave nueva, cifrada con un IV nuevo, y la conexión vuelve a «Sin comprobar» |
| Eliminar | Borra la credencial y las preferencias que la usaban |
| Borrar la cuenta | Borra en cascada credenciales, preferencias y trabajos |

**Cifrado.** Se reutiliza `secret-encryption.service.ts`:
- AES-256-GCM, con IV aleatorio de 12 bytes y etiqueta de autenticación;
- la clave de cifrado es `ESTATEFORGE_API_KEY_ENCRYPTION_KEY` (32 bytes en base64 o hexadecimal);
- con cada credencial se guardan el algoritmo, la versión de cifrado, las fechas, el estado y la pista (los 4 últimos caracteres);
- si falta la clave de cifrado, no se guarda nada (503 `AI_ENCRYPTION_UNAVAILABLE`);
- si una credencial no se puede descifrar (por ejemplo, tras rotar la clave del servidor sin recifrar), no se usa (409 `AI_KEY_UNREADABLE`) y hay que volver a introducirla;
- nunca hay alternativa en texto plano.

La clave **nunca** aparece en respuestas, registros, la URL, el almacenamiento del navegador ni el código de la web. Las pruebas automáticas lo comprueban en la API, en PostgreSQL y en la página.

## Cartel con IA

**Selección.** «Generación con IA» se elige expresamente; está diferenciada visualmente y nunca forma parte de «Aleatoria»:
- «Aleatoria» sigue sorteando en la API con `crypto.randomInt` solo entre las seis plantillas;
- la opción IA no está en ese catálogo;
- la API rechaza un cartel `ai` sorteado o sin trabajo aceptado.

Sin proveedor configurado, la opción aparece como no disponible y enlaza a Ajustes.

**Composición.**
- La IA genera **solo el fondo decorativo**: sin texto, cifras, logotipos, personas ni estancias.
- EstateForge compone encima, en el navegador, **las fotografías auténticas** (hasta 3, la principal primero, sin alterar) y **los datos exactos del anuncio**: título, precio, ubicación y características.
- El cartel lleva el rótulo «Diseño asistido por IA».

**Fotografías de referencia.** Se envían como máximo 3 miniaturas propias, sin metadatos (se eliminan EXIF, XMP y los fragmentos de texto), solo como referencia de paleta. Nunca se envían fotografías de otros inmuebles, la dirección exacta, datos de contacto ni identificadores internos.

**Revisión y sustitución.**
1. Generar crea una propuesta. Cuando está «Lista para revisión», se compone la vista previa.
2. **Aceptar y sustituir:** guarda el cartel nuevo por la vía habitual (subida directa) y marca el trabajo como aceptado en la misma transacción. Solo después se borran el cartel anterior y el resultado temporal.
3. **Rechazar o regenerar:** el cartel vigente no cambia y la propuesta se borra.

## Vídeo con IA

**Modalidad.**
- **Generación clásica:** la de siempre, en el navegador y sin API key. Es la predeterminada.
- **Generación con IA:** se elige expresamente.
- Nunca se cambia de una modalidad a otra por un fallo.

**Clip.**
- El proveedor recibe las primeras fotografías de la selección del vídeo (la principal primero), hasta el límite del modelo (6 en Omni); la interfaz dice cuántas se enviarán.
- Duración de 4, 6 u 8 s, en 16:9 a 720p.
- El prompt pide conservar la identidad del inmueble y no inventar estancias, vistas ni equipamientos.

**Audio.** El clip del proveedor se reproduce **silenciado** dentro del compositor de siempre, así que su audio propio nunca entra en el archivo. Se graba con:
- presentación y cierre con los datos exactos;
- el rótulo «Vídeo generado con IA · no es una representación fotográfica certificada», visible todo el tiempo;
- la banda sonora elegida: pista predeterminada, pista personal o sin sonido.

La API comprueba que el archivo lleva audio si y solo si se eligió una pista: nunca se acepta un vídeo mudo por error ni con otra pista.

**Revisión.** Igual que el cartel. Las fotografías originales del inmueble no se sustituyen nunca.

## Trabajos asíncronos

Cada generación es un registro `AiMediaJob` en PostgreSQL. Estados:

| Estado | Significado |
|---|---|
| Pendiente | Creado; aún no se ha enviado al proveedor |
| Enviado al proveedor | El proveedor ha aceptado la solicitud |
| En proceso | El proveedor sigue generando |
| Moderando | Se está validando y comprobando el resultado |
| Listo para revisión | Ha superado las comprobaciones; espera la decisión del usuario |
| Aceptado | El usuario lo ha aceptado y es el material vigente |
| Rechazado | El usuario lo ha rechazado |
| Cancelado | Cancelado por el usuario o por el proveedor |
| Error | Fallo del proveedor, del resultado o de la moderación |
| Bloqueado por moderación | Una de las capas de seguridad lo ha bloqueado |
| Caducado | Se agotó el plazo de revisión (24 h) o el del proveedor (30 min) |

Funcionamiento:
- **Sondeo.** La web consulta `GET /api/ai-jobs/:id` con espera progresiva (de 2 a 10 s). Cada consulta pregunta al proveedor si toca, sin procesos en segundo plano ni peticiones bloqueadas durante minutos. Las transiciones se reclaman con `updateMany` condicionado.
- **Volver a la ficha.** Al volver se recuperan los trabajos del anuncio; salir no cancela el trabajo.
- **Idempotencia.** Cada solicitud lleva una clave de idempotencia.
- **Sin reenvíos.** Nunca se repite un envío que pudo haberse aceptado: un error tras enviar queda como «no confirmado» (`AI_PROVIDER_UNCERTAIN`), sin reintento, para no duplicar cargos.
- **Cancelación.** Se cancela en el proveedor si lo admite.
- **Plazos.** Un resultado sin revisar caduca a las 24 h. Un trabajo que no termina en 30 min se cierra. Uno interrumpido se marca como error a los 10 min.
- **Limpieza.** Los resultados temporales van al almacenamiento privado y, al cerrar el trabajo, un trigger los encola para borrarlos.
- **Descarga del resultado.** El resultado del proveedor llega en base64. Si llegara por URI, se descarga desde la API solo del host oficial, sin redirecciones y con límites de tamaño y tiempo. Después se valida el contenido real.

## Seguridad y moderación

**Tres capas, y ninguna basta por sí sola:**
1. **Reglas locales** sobre el título, la descripción y los destacados, antes de enviar nada: discriminación en la vivienda, inyección de instrucciones, contenido sexual o de menores, fraude inmobiliario, violencia, odio y actividades ilegales.
2. **Filtros del proveedor** en su umbral más estricto (`block_low_and_above` en todas las categorías) y un **clasificador** sobre:
   - la entrada (textos y fotografías);
   - la salida (la imagen completa, o el vídeo completo con su audio, no un fotograma).

   La respuesta del clasificador es JSON tipado: si no es válida, o la moderación no está disponible, el resultado no se acepta.
3. **Revisión humana obligatoria** antes de que nada sea material vigente.

**Ante un bloqueo:**
- no se guarda nada ni se puede descargar o publicar;
- el material anterior sigue vigente;
- se registra solo una categoría controlada y se muestra un mensaje comprensible, sin detalles internos del filtro.

**Inyección de instrucciones.** Los prompts se construyen en la API, con instrucciones y datos separados y los datos marcados como no confiables. Los de generación **no llevan texto libre del anuncio**: solo el tipo de inmueble y la operación, de listas cerradas. No se habilitan herramientas, código, navegación ni funciones, y no hay caja de texto libre para el usuario.

**SSRF.** Solo https, hosts de una lista cerrada (`generativelanguage.googleapis.com`), sin puerto ni credenciales en la URL y sin seguir redirecciones (OWASP SSRF).

**Aislamiento.** Todo se resuelve con el usuario autenticado. Un recurso ajeno responde igual que uno inexistente (404), y nadie puede usar la clave de otro.

**Límites internos** (configurables):

| Variable | Por defecto | Qué limita |
|---|---|---|
| `AI_MEDIA_MAX_CONCURRENT` | 2 | Generaciones a la vez por usuario, y solo una por material |
| `AI_MEDIA_DAILY_LIMIT` | 20 | Generaciones en 24 h |
| `AI_MEDIA_MONTHLY_LIMIT` | 200 | Generaciones en 30 días |

Además hay rate-limit por IP en las rutas, límites de fotografías, de duración y de tamaño (12 MB para la imagen y 24 MB para el vídeo del proveedor). El registro de uso (Ajustes) **no equivale a la factura del proveedor**.

**Limitación honesta.** Ningún sistema automático garantiza eliminar todo el contenido ilícito. Por eso la última palabra es siempre la revisión del usuario.

## Privacidad y costes

**Confirmación previa.** Antes de cada generación se muestran:
- el proveedor y el modelo;
- el tipo de generación, con su duración o resolución;
- las fotografías que se enviarán;
- qué datos van al clasificador;
- que se usa la clave guardada y que puede haber cargos;
- el coste aproximado con su fuente y fecha, o el aviso de que no se puede estimar.

**Qué cubre la estimación.** El coste aproximado de un cartel o de un vídeo es solo el de la generación (por imagen o por segundo). No incluye los tokens de entrada (fotografías y texto) ni las llamadas al clasificador de seguridad, que también consumen de la cuenta del usuario y se cobran por tokens. Para el texto no se calcula un importe: se muestran los precios por millón de tokens de entrada, de entrada en caché y de salida. La facturación definitiva la decide el proveedor según la cuenta del usuario (plan, impuestos, descuentos y modalidad).

No se envía nada hasta marcar el consentimiento.

**Uso de los datos por el proveedor.** Según los términos de la API de Gemini (vigentes desde el 23/03/2026):
- en el **nivel gratuito**, Google puede usar el contenido para mejorar sus productos y revisarlo con personas;
- en el **de pago**, no.

Depende del plan del usuario y EstateForge no puede garantizarlo.

**Registros.** No se guardan prompts, imágenes ni respuestas en los registros. Un usuario nunca ve contenido de otro.

## Cómo configurar una cuenta evaluadora

- **Sin cuenta en ningún proveedor** (solo desarrollo local):
  1. Arranca la API con `AI_MEDIA_SIMULATOR=1`. El simulador solo existe con `NODE_ENV` distinto de `production` y sin `VERCEL=1`.
  2. Guarda en Ajustes la clave de prueba `sim-ok-<8 o más caracteres>`. Con `sim-bloqueo-salida-…`, `sim-bloqueo-proveedor-…`, `sim-bloqueo-entrada-…`, `sim-sin-moderacion-…`, `sim-error-proveedor-…` o `sim-invalida-…` se prueban los casos de fallo.
  3. Elige el simulador como proveedor de carteles y vídeos.
- **Con Gemini:** cada evaluador crea su propia API key en Google AI Studio, en una cuenta con facturación si quiere imagen o vídeo (no tienen nivel gratuito), la guarda en Ajustes, la comprueba y elige los modelos. El consumo se le cobrará a él.

## Limitaciones conocidas

- **Gemini no verificado contra el servicio real.** Hay que confirmar con una clave real:
  - la forma exacta de las respuestas de la API Interactions (imagen, vídeo, `steps`, errores y uso);
  - que `safety_settings` se aplica a los modelos de imagen y vídeo;
  - el formato JSON del clasificador;
  - si la consulta de un modelo es gratuita;
  - la cancelación.
- **OpenAI no verificado contra el servicio real (MD-35).** El catálogo y los precios están verificados solo en la documentación oficial (12/11/2026) y el adaptador, con pruebas de contrato sobre el SDK simulado. Falta confirmar con una clave real la forma de la respuesta de la API Responses, los códigos de error y el acceso de la cuenta a cada modelo.
- **Audio de Omni.** La documentación no dice si se puede desactivar; EstateForge lo descarta al componer.
- **Componer en el navegador.** La vista previa del vídeo se graba en tiempo real con la pestaña visible, igual que el vídeo clásico.
- **Clasificador a cargo del usuario.** Consume tokens de la cuenta del usuario y su coste no se incluye en la estimación (es pequeño frente al de la generación).
- **Despliegue.** Ver [Preparación para Vercel, Neon y Blob](despliegue/vercel-neon-blob.md#generación-con-ia-byok).
