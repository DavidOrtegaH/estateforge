# Catálogo de proveedores de IA (BYOK)

Decisiones DA-82 a DA-93; trazabilidad en `revision/specdd_adopcion/planificacion_auditoria_v2/plan_y_trazabilidad.md`, apartados 26 a 28. El funcionamiento general de BYOK está en [producto-ia-byok.md](producto-ia-byok.md).

> Este documento se genera a partir del catálogo de la API (`apps/api/src/ai-media/catalog.ts`), que es la única fuente de proveedores, modelos, capacidades y precios. La web lo recibe de `GET /api/ai/providers`.

**Fecha de verificación documental: 12/11/2026; los seis modelos de las pruebas propuestas y el clasificador de Gemini, de nuevo el 15/11/2026.** Todo procede de la documentación oficial de cada proveedor en esa fecha.

**Estado de las integraciones** (detalle por modelo en «Estado de integración por modelo»):
- cada proveedor de la lista tiene un adaptador implementado, validaciones y tratamiento de errores;
- **cada uno de los 65 modelos** tiene su prueba de contrato con respuestas simuladas que siguen la forma documentada (`apps/api/src/ai-media/model-coverage.contract.test.ts`), además de las pruebas por proveedor;
- el flujo de EstateForge de cada modalidad (texto, carteles y vídeos) está probado de extremo a extremo con el simulador local, que no implica a ningún proveedor;
- **ninguno se ha validado contra el servicio real**: EstateForge no ha usado ninguna API key real ni ha hecho ninguna llamada a un proveedor. Cada usuario puede validar un proveedor con su propia clave mediante una prueba real controlada (ver más abajo);
- los modelos que no se han podido documentar con certeza no figuran (ver «No integrado»).

## Conceptos

- **Proveedor de la API:** quien sirve la API, recibe la clave del usuario y **factura** el consumo.
- **Fabricante:** quien ha creado el modelo. Puede no ser el proveedor.
- **API directa:** el fabricante sirve su propio modelo (OpenAI, Anthropic, Google, xAI…).
- **Agregador:** sirve modelos de otros fabricantes con su propia clave y **sus propias tarifas** (OpenRouter, Groq, Runway, fal.ai, Replicate). Kling a través de Runway se paga a Runway, al precio de Runway.
- **Estado «No indicado»:** la documentación consultada no dice si el modelo es estable o preliminar. No se presume estable.
- **«Consultar tarifa del proveedor»:** el precio no está publicado o no se ha podido leer de forma fiable. No se inventa ni se copia el del fabricante.

## Matriz de proveedores y capacidades

| Proveedor | Tipo | Texto | Imagen | Imagen con referencias | Vídeo | Clasificador de seguridad | Descubrimiento de modelos | Factura |
|---|---|:-:|:-:|:-:|:-:|---|:-:|---|
| Google Gemini | API directa | Sí | Sí | Sí | Sí | Texto, imagen y vídeo | — | Tu cuenta de Google AI Studio / Google Cloud |
| OpenAI | API directa | Sí | Sí | Sí | — | Texto e imagen | — | Tu cuenta de la plataforma de OpenAI |
| Anthropic (Claude) | API directa | Sí | — | — | — | — | — | Tu cuenta de la consola de Anthropic |
| xAI (Grok) | API directa | Sí | Sí | Sí | Sí | — | — | Tu cuenta de la consola de xAI |
| Mistral | API directa | Sí | — | — | — | — | — | Tu cuenta de la plataforma de Mistral |
| DeepSeek | API directa | Sí | — | — | — | — | — | Tu cuenta de la plataforma de DeepSeek (saldo de prepago) |
| Black Forest Labs (FLUX) | API directa | — | Sí | Sí | Sí | — | — | Tu cuenta de Black Forest Labs (créditos de prepago) |
| Stability AI | API directa | — | Sí | — | — | — | — | Tu cuenta de la plataforma de Stability AI (créditos) |
| Ideogram | API directa | — | Sí | — | — | — | — | Tu cuenta de la plataforma de Ideogram (saldo de prepago) |
| Recraft | API directa | — | Sí | — | — | — | — | Tu cuenta de Recraft (unidades de API de prepago) |
| OpenRouter | Agregador | Sí | — | — | — | — | Sí | Tu cuenta de OpenRouter (créditos de OpenRouter, no la del fabricante del modelo) |
| Groq | Agregador | Sí | — | — | — | — | — | Tu cuenta de la consola de Groq (no la del fabricante del modelo) |
| Runway | Agregador | — | Sí | Sí | Sí | — | — | Tu cuenta de la API de Runway (créditos de Runway, no la del fabricante del modelo) |
| fal.ai | Agregador | — | Sí | Sí | Sí | — | — | Tu cuenta de fal.ai (créditos de prepago, no la del fabricante del modelo) |
| Replicate | Agregador | — | — | — | Sí | — | — | Tu cuenta de Replicate (no la del fabricante del modelo) |

## Texto

Texto del anuncio (título, descripción, destacados y llamada a la acción). Todos devuelven un JSON que la API valida con el esquema del anuncio. Solo se listan modelos que **generan texto**; que un modelo admita imágenes de entrada no lo convierte en generador de imágenes.

Los precios son por millón de tokens (entrada, entrada en caché y salida). No se calcula un importe por adelantado: depende de los tokens de cada petición.

| Proveedor (factura) | Fabricante | Modelo | Estado | Recomendación | Precio publicado |
|---|---|---|---|---|---|
| Google Gemini | Google | `gemini-3.6-flash` | Estable: Estable | Recomendado | 0,75 $ por millón de tokens de entrada, 0,075 $ de entrada en caché y 3,75 $ de salida hasta el 31/12/2026 (desde el 01/01/2027: 1,50 $, 0,15 $ y 7,50 $). Tiene nivel gratuito según la página de precios. **Precio temporal hasta el 31/12/2026.** [Fuente](https://aistudio.google.com/docs/pricing) |
| Google Gemini | Google | `gemini-3.5-flash-lite` | Estable: Estable | Alternativo | 0,30 $ por millón de tokens de entrada, 0,03 $ de entrada en caché y 2,50 $ de salida. Tiene nivel gratuito según la página de precios. [Fuente](https://aistudio.google.com/docs/pricing) |
| Google Gemini | Google | `gemini-3.8-flash` | No indicado: Nuevo (02/09/2026); la página no lo etiqueta como estable | Alternativo | 0,75 $ por millón de tokens de entrada, 0,075 $ de entrada en caché y 3,75 $ de salida hasta el 31/12/2026 (desde el 01/01/2027: 1,50 $, 0,15 $ y 7,50 $). Tiene nivel gratuito según la página de precios. **Precio temporal hasta el 31/12/2026.** [Fuente](https://aistudio.google.com/docs/pricing) |
| Google Gemini | Google | `gemini-4-carbon` | No indicado: Nuevo (10/11/2026); la página no indica su estado | Alternativo | 2,00 $ por millón de tokens de entrada, 0,10 $ de entrada en caché y 10,00 $ de salida hasta el 30/11/2026 (desde el 01/12/2026: 4,00 $, 0,20 $ y 20,00 $). Sin nivel gratuito. **Precio temporal hasta el 30/11/2026.** [Fuente](https://aistudio.google.com/docs/pricing) |
| OpenAI | OpenAI | `gpt-6.1-terra` | No indicado: Vigente: sin fecha de retirada publicada (la documentación no indica otro estado) | Recomendado | 1,00 $ por millón de tokens de entrada, 0,05 $ de entrada en caché y 5,00 $ de salida. [Fuente](https://developers.openai.com/api/docs/models/gpt-6.1-terra) |
| OpenAI | OpenAI | `gpt-6-luna` | No indicado: Vigente: sin fecha de retirada publicada (la documentación no indica otro estado) | Alternativo | 0,10 $ por millón de tokens de entrada, 0,01 $ de entrada en caché y 0,50 $ de salida. [Fuente](https://developers.openai.com/api/docs/models/gpt-6-luna) |
| OpenAI | OpenAI | `gpt-6.1-sol` | No indicado: Vigente: sin fecha de retirada publicada (la documentación no indica otro estado) | Alternativo | 2,00 $ por millón de tokens de entrada, 0,10 $ de entrada en caché y 10,00 $ de salida. [Fuente](https://developers.openai.com/api/docs/models/gpt-6.1-sol) |
| OpenAI | OpenAI | `gpt-5.5` | No indicado: Heredado: sigue documentado y sin fecha de retirada publicada, pero lo superan los modelos GPT-6 | Heredado | 5,00 $ por millón de tokens de entrada, 0,50 $ de entrada en caché y 30,00 $ de salida. [Fuente](https://developers.openai.com/api/docs/models/gpt-5.5) |
| Anthropic (Claude) | Anthropic | `claude-sonnet-5-5` | Estable: Activo; retirada no antes del 28/09/2027 | Recomendado | 2,00 $ por millón de tokens de entrada, 0,10 $ de entrada en caché y 10,00 $ de salida. [Fuente](https://platform.claude.com/docs/en/about-claude/pricing) |
| Anthropic (Claude) | Anthropic | `claude-haiku-5-5` | Estable: Activo; retirada no antes del 07/10/2027 | Alternativo | 0,10 $ por millón de tokens de entrada, 0,01 $ de entrada en caché y 0,50 $ de salida (peticiones de hasta 100 000 tokens; por encima, 0,50 $, 0,05 $ y 2,50 $). [Fuente](https://platform.claude.com/docs/en/about-claude/pricing) |
| Anthropic (Claude) | Anthropic | `claude-opus-5-5` | Estable: Activo; retirada no antes del 22/09/2027 | Alternativo | 4,00 $ por millón de tokens de entrada, 0,20 $ de entrada en caché y 20,00 $ de salida. [Fuente](https://platform.claude.com/docs/en/about-claude/pricing) |
| xAI (Grok) | xAI | `grok-4.3` | No indicado: La documentación consultada no indica su estado | Recomendado | 1,25 $ por millón de tokens de entrada, 0,20 $ de entrada en caché y 2,50 $ de salida. [Fuente](https://docs.x.ai/developers/pricing) |
| xAI (Grok) | xAI | `grok-4.7` | No indicado: La documentación consultada no indica su estado | Alternativo | 2,00 $ por millón de tokens de entrada, 0,50 $ de entrada en caché y 6,00 $ de salida. [Fuente](https://docs.x.ai/developers/pricing) |
| Mistral | Mistral AI | `mistral-large-latest` | No indicado: Alias de los ejemplos oficiales; la documentación no indica a qué versión apunta | Recomendado | Consultar tarifa del proveedor |
| Mistral | Mistral AI | `mistral-medium-3-5` | No indicado: La documentación consultada no indica su estado | Alternativo | Consultar tarifa del proveedor |
| DeepSeek | DeepSeek | `deepseek-flash` | No indicado: La documentación consultada no indica su estado | Recomendado | 0,30 $ por millón de tokens de entrada, 0,006 $ con acierto de caché y 1,20 $ de salida en horas punta (0,15 $, 0,003 $ y 0,60 $ en horas valle). [Fuente](https://api-docs.deepseek.com/quick_start/pricing) |
| DeepSeek | DeepSeek | `deepseek-v4-pro` | No indicado: La documentación consultada no indica su estado | Alternativo | 1,32 $ por millón de tokens de entrada, 0,044 $ con acierto de caché y 3,96 $ de salida en horas punta (0,66 $, 0,022 $ y 1,98 $ en horas valle). [Fuente](https://api-docs.deepseek.com/quick_start/pricing) |
| OpenRouter | Anthropic | `~anthropic/claude-sonnet-latest` | No indicado: Alias de los ejemplos oficiales de OpenRouter | Recomendado | Consultar tarifa del proveedor |
| OpenRouter | OpenAI | `~openai/gpt-sol-latest` | No indicado: Alias de los ejemplos oficiales de OpenRouter | Alternativo | Consultar tarifa del proveedor |
| Groq | OpenAI (pesos abiertos) | `openai/gpt-oss-120b` | Estable: Producción | Recomendado | 0,15 $ por millón de tokens de entrada y 0,60 $ de salida. [Fuente](https://console.groq.com/docs/models) |
| Groq | OpenAI (pesos abiertos) | `openai/gpt-oss-20b` | Estable: Producción | Alternativo | 0,075 $ por millón de tokens de entrada, 0,037 $ de entrada en caché y 0,30 $ de salida. [Fuente](https://console.groq.com/docs/model/openai/gpt-oss-20b) |

Protocolo de cada proveedor de texto:

- **Google Gemini:** API de Gemini con el SDK oficial, respuesta con esquema. Cabecera x-goog-api-key.
- **OpenAI:** API Responses con el SDK oficial, salida estructurada con esquema estricto. Cabecera Authorization: Bearer.
- **Anthropic (Claude):** API Messages (`https://api.anthropic.com/v1/messages`, versión 2026-10-21), salida estructurada con esquema. Cabecera x-api-key.
- **xAI (Grok):** API de chat (`https://api.x.ai/v1/chat/completions`), salida estructurada con esquema estricto. Cabecera Authorization: Bearer.
- **Mistral:** API de chat (`https://api.mistral.ai/v1/chat/completions`), modo JSON (la forma se describe en el mensaje y se valida en la API). Cabecera Authorization: Bearer.
- **DeepSeek:** API de chat (`https://api.deepseek.com/chat/completions`), modo JSON (la forma se describe en el mensaje y se valida en la API). Cabecera Authorization: Bearer.
- **OpenRouter:** API de chat (`https://openrouter.ai/api/v1/chat/completions`), salida estructurada con esquema estricto. Cabecera Authorization: Bearer.
- **Groq:** API de chat (`https://api.groq.com/openai/v1/chat/completions`), salida estructurada con esquema estricto. Cabecera Authorization: Bearer.

## Imagen (fondo del cartel)

La IA genera solo el **fondo gráfico** del cartel; las fotografías auténticas, el precio y los datos exactos los compone EstateForge. «Referencias» es el número de fotografías del inmueble que EstateForge envía como máximo (para paleta y ambiente); con 0, el modelo solo recibe las instrucciones.

| Proveedor (factura) | Fabricante | Modelo | Estado | Referencias | Resolución y relación | Precio publicado | Estimación |
|---|---|---|---|---|---|---|---|
| Google Gemini | Google | `gemini-3.1-flash-image` | Estable | 3 | 1K (≈1024 px) · 4:5 | 0,067 $ por imagen generada de 1K (sin nivel gratuito). Aparte, las fotografías y el texto de entrada: 0,50 $ por millón de tokens. [Fuente](https://aistudio.google.com/docs/pricing) | 0,067 $ |
| Google Gemini | Google | `gemini-3.1-flash-lite-image` | Estable | 3 | 1K (≈1024 px) · 4:5 | 0,0336 $ por imagen generada de 1K (sin nivel gratuito). Aparte, las fotografías y el texto de entrada: 0,25 $ por millón de tokens. [Fuente](https://aistudio.google.com/docs/pricing) | 0,0336 $ |
| Google Gemini | Google | `gemini-nano-banana-2.1` | No indicado | 3 | 1K (≈1024 px) · 4:5 | Consultar tarifa del proveedor | No se estima |
| Google Gemini | Google | `gemini-3-pro-image` | Estable | 3 | 1K (≈1024 px) · 4:5 | Consultar tarifa del proveedor | No se estima |
| OpenAI | OpenAI | `gpt-image-2.6-flare` | No indicado | 3 | 1024×1536 · 2:3 | Se factura por tokens: 8,00 $ por millón de tokens de imagen de entrada y 30,00 $ por millón de tokens de imagen de salida (el texto de entrada, 5,00 $). La página de precios no publica un importe por imagen: depende del tamaño y de la calidad. [Fuente](https://developers.openai.com/api/docs/pricing) | No se estima |
| OpenAI | OpenAI | `gpt-image-2.6-sunburst` | No indicado | 3 | 1024×1536 · 2:3 | Se factura por tokens: 8,00 $ por millón de tokens de imagen de entrada y 30,00 $ por millón de tokens de imagen de salida (el texto de entrada, 5,00 $). La página de precios no publica un importe por imagen: depende del tamaño y de la calidad. [Fuente](https://developers.openai.com/api/docs/pricing) | No se estima |
| xAI (Grok) | xAI | `grok-imagine-image-2.0` | No indicado | 3 | 1k · 3:4 | 0,04 $ por imagen generada. Con fotografías de referencia (edición) se cobran también las imágenes de entrada. [Fuente](https://docs.x.ai/developers/pricing) | 0,04 $ |
| xAI (Grok) | xAI | `grok-imagine-image` | No indicado | 3 | 1k · 3:4 | 0,02 $ por imagen generada. Con fotografías de referencia (edición) se cobran también las imágenes de entrada. [Fuente](https://docs.x.ai/developers/pricing) | 0,02 $ |
| Black Forest Labs (FLUX) | Black Forest Labs | `flux-3-image` | No indicado | 3 | 1k · 4:5 | 0,048 $ por imagen de 1K; las imágenes de referencia y el prompt no tienen coste adicional. [Fuente](https://bfl.ai/pricing) | 0,048 $ |
| Black Forest Labs (FLUX) | Black Forest Labs | `flux-2-pro` | No indicado | 3 | 1024×1280 · 4:5 | 0,03 $ por el primer megapíxel generado y 0,015 $ por megapíxel adicional y por megapíxel de cada imagen de referencia. [Fuente](https://bfl.ai/pricing) | No se estima |
| Stability AI | Stability AI | `stable-image-core` | No indicado | 0 | ≈1 megapíxel · 4:5 | 3 créditos por imagen (1 crédito = 0,01 $); las generaciones fallidas no se cobran. [Fuente](https://docs.stability.ai/pricing) | 0,03 $ |
| Stability AI | Stability AI | `stable-image-ultra` | No indicado | 0 | ≈1 megapíxel · 4:5 | 8 créditos por imagen (1 crédito = 0,01 $); las generaciones fallidas no se cobran. [Fuente](https://docs.stability.ai/pricing) | 0,08 $ |
| Stability AI | Stability AI | `sd3.5-large` | No indicado | 0 | ≈1 megapíxel · 4:5 | 6,5 créditos por imagen (1 crédito = 0,01 $); las generaciones fallidas no se cobran. [Fuente](https://docs.stability.ai/pricing) | 0,065 $ |
| Ideogram | Ideogram | `ideogram-4-5` | No indicado | 0 | 1024×1024 · 1:1 | Consultar tarifa del proveedor | No se estima |
| Recraft | Recraft | `recraftv4_1` | No indicado | 0 | 1K (1024×1024) · 1:1 | 0,035 $ por imagen. [Fuente](https://www.recraft.ai/docs/api-reference/pricing) | 0,035 $ |
| Recraft | Recraft | `recraftv4_1_flash` | No indicado | 0 | 1K (1024×1024) · 1:1 | 0,007 $ por imagen. [Fuente](https://www.recraft.ai/docs/api-reference/pricing) | 0,007 $ |
| Runway | Runway | `gen4_image` | No indicado | 3 | ≈1 megapíxel · 3:4 | 5 créditos (0,05 $) por imagen a 720p. [Fuente](https://docs.dev.runwayml.com/guides/pricing/) | 0,05 $ |
| Runway | Google | `nano_banana_2.1` | No indicado | 3 | ≈1 megapíxel · 3:4 | 4 créditos (0,04 $) por imagen de 1K; las imágenes de referencia no añaden coste. [Fuente](https://dev.runwayml.com/learn/nano-banana-2-1-api) | 0,04 $ |
| Runway | ByteDance | `seedream5_pro` | No indicado | 3 | ≈1 megapíxel · 3:4 | 5 créditos (0,05 $) por imagen de 1K. [Fuente](https://docs.dev.runwayml.com/guides/pricing/) | 0,05 $ |
| Runway | OpenAI | `gpt_image_2_6_flare` | No indicado | 3 | ≈1 megapíxel · 3:4 | De 2 a 19 créditos (0,02 $ a 0,19 $) por imagen según la calidad y el tamaño, más 1 crédito por imagen de referencia. [Fuente](https://docs.dev.runwayml.com/guides/pricing/) | No se estima |
| Runway | xAI | `grok_imagine_image_2` | No indicado | 3 | ≈1 megapíxel · 3:4 | De 4 a 8 créditos (0,04 $ a 0,08 $) por imagen, más 1 crédito por imagen de referencia. [Fuente](https://docs.dev.runwayml.com/guides/pricing/) | No se estima |
| fal.ai | Black Forest Labs | `fal-ai/flux-2` | No indicado | 0 | 1024×1280 · 4:5 | 0,012 $ por megapíxel (una imagen de 1024×1280 es ≈1,3 megapíxeles). [Fuente](https://fal.ai/models/fal-ai/flux-2) | No se estima |
| fal.ai | Black Forest Labs | `fal-ai/flux-2/edit` | No indicado | 3 | 1024×1280 · 4:5 | 0,012 $ por megapíxel de entrada y de salida. [Fuente](https://fal.ai/models/fal-ai/flux-2/edit) | No se estima |
| fal.ai | Google | `fal-ai/nano-banana-2` | No indicado | 0 | 1K · 4:5 | 0,08 $ por imagen de 1K. [Fuente](https://fal.ai/models/fal-ai/nano-banana-2) | 0,08 $ |

## Vídeo

El clip parte de las fotografías del inmueble (la principal primero). «Referencias» es el máximo de fotografías que admite el modelo en esta integración. El audio del clip nunca se usa: se pide sin audio cuando la API lo permite y, si no, EstateForge lo descarta al componer y pone el sonido elegido por el usuario.

| Proveedor (factura) | Fabricante | Modelo | Estado | Duraciones (s) | Resolución y relación | Referencias | Audio del modelo | Precio publicado | 6 s estimados |
|---|---|---|---|---|---|---|---|---|---|
| Google Gemini | Google | `gemini-omni-1.2-flash` | Estable | 4, 6, 8 | 720p · 16:9 | 6 | Se descarta | ≈0,07 $ por segundo de vídeo a 720p (12 $ por millón de tokens de salida; 5792 tokens por segundo). Sin nivel gratuito. Aparte, las fotografías y el texto de entrada: 1,50 $ por millón de tokens. [Fuente](https://aistudio.google.com/docs/pricing) | 0,417 $ |
| xAI (Grok) | xAI | `grok-imagine-video-1.5` | No indicado | 4, 6, 8 | 720p · el de la fotografía principal | 1 | Se pide sin audio | 0,08 $ por segundo de vídeo. [Fuente](https://docs.x.ai/developers/pricing) | 0,48 $ |
| xAI (Grok) | xAI | `grok-imagine-video-1.5-lite` | No indicado | 4, 6, 8 | 720p · el de la fotografía principal | 1 | Se pide sin audio | 0,02 $ por segundo de vídeo (la documentación no publica precios por resolución ni el de la imagen de entrada). [Fuente](https://docs.x.ai/developers/pricing) | 0,12 $ |
| Black Forest Labs (FLUX) | Black Forest Labs | `flux-3-video` | No indicado | 6, 8 | HD · 16:9 | 4 | Se pide sin audio | 0,15 $ por segundo de vídeo en HD. [Fuente](https://bfl.ai/pricing) | 0,9 $ |
| Runway | Runway | `gen4.5` | No indicado | 4, 6, 8 | 720p · 16:9 | 1 | No genera | 12 créditos (0,12 $) por segundo. [Fuente](https://docs.dev.runwayml.com/guides/pricing/) | 0,72 $ |
| Runway | Google | `veo3.1_fast` | No indicado | 4, 6, 8 | 720p · 16:9 | 1 | Se pide sin audio | 10 créditos (0,10 $) por segundo sin audio (15 con audio). [Fuente](https://docs.dev.runwayml.com/guides/pricing/) | 0,6 $ |
| Runway | Google | `veo3.1` | No indicado | 4, 6, 8 | 720p · 16:9 | 1 | Se pide sin audio | 20 créditos (0,20 $) por segundo sin audio (40 con audio). [Fuente](https://docs.dev.runwayml.com/guides/pricing/) | 1,2 $ |
| Runway | Kling (Kuaishou) | `kling3.0_standard` | No indicado | 4, 6, 8 | 720p · 16:9 | 1 | Se pide sin audio | 9 créditos (0,09 $) por segundo sin audio (13 con audio). [Fuente](https://docs.dev.runwayml.com/guides/pricing/) | 0,54 $ |
| Runway | Kling (Kuaishou) | `kling3.0_pro` | No indicado | 4, 6, 8 | 1080p · 16:9 | 1 | Se pide sin audio | 12 créditos (0,12 $) por segundo sin audio (17 con audio). [Fuente](https://docs.dev.runwayml.com/guides/pricing/) | 0,72 $ |
| Runway | Kling (Kuaishou) | `kling_4` | No indicado | 4, 6, 8 | 720p · el de la fotografía principal | 1 | Se descarta | 12,56 créditos (0,1256 $) por segundo a 720p hasta el 30/11/2026 (después, 15,7 créditos: 0,157 $). **Precio temporal hasta el 30/11/2026.** [Fuente](https://docs.dev.runwayml.com/guides/pricing/) | 0,754 $ |
| Runway | ByteDance | `seedance2_fast` | No indicado | 4, 6, 8 | 720p · 16:9 | 1 | Se pide sin audio | 24 créditos (0,24 $) por segundo a 720p. [Fuente](https://docs.dev.runwayml.com/guides/pricing/) | 1,44 $ |
| Runway | ByteDance | `seedance2_5` | No indicado | 4, 6, 8 | 720p · 16:9 | 1 | Se pide sin audio | 30 créditos (0,30 $) por segundo a 720p. [Fuente](https://docs.dev.runwayml.com/guides/pricing/) | 1,8 $ |
| Runway | MiniMax | `hailuo3` | No indicado | 6, 8 | 768p · 16:9 | 1 | Se descarta | 10 créditos (0,10 $) por segundo a 768p, más 2 créditos por fotograma clave. [Fuente](https://docs.dev.runwayml.com/guides/pricing/) | 0,6 $ |
| Runway | Alibaba | `wan3` | No indicado | 4, 6, 8 | 720p · el de la fotografía principal | 1 | Se pide sin audio | 10 créditos (0,10 $) por segundo a 720p. [Fuente](https://docs.dev.runwayml.com/guides/pricing/) | 0,6 $ |
| Runway | xAI | `grok_imagine_1_5` | No indicado | 4, 6, 8 | 720p · el de la fotografía principal | 1 | Se descarta | 16 créditos (0,16 $) por segundo a 720p, más 1 crédito por imagen de referencia. [Fuente](https://docs.dev.runwayml.com/guides/pricing/) | 0,96 $ |
| Runway | Google | `gemini_omni_flash_1.2` | No indicado | 4, 6, 8 | 720p · 16:9 | 1 | Se descarta | 7 créditos (0,07 $) por segundo a 720p o 2 créditos (0,02 $) a 360p, más 1 crédito por imagen de referencia; mínimo de 6 créditos por petición. [Fuente](https://dev.runwayml.com/learn/gemini-omni-flash-1-2-api) | 0,42 $ |
| fal.ai | Kling (Kuaishou) | `fal-ai/kling-video/v3/pro/image-to-video` | No indicado | 4, 6, 8 | la del modelo · el de la fotografía principal | 1 | Se pide sin audio | 0,112 $ por segundo sin audio (0,168 $ con audio). [Fuente](https://fal.ai/models/fal-ai/kling-video/v3/pro/image-to-video) | 0,672 $ |
| fal.ai | ByteDance | `bytedance/seedance-2.0/fast/image-to-video` | No indicado | 4, 6, 8 | 720p · 16:9 | 1 | Se pide sin audio | 0,2419 $ por segundo de vídeo a 720p. [Fuente](https://fal.ai/models/bytedance/seedance-2.0/fast/image-to-video) | 1,451 $ |
| fal.ai | MiniMax | `minimax/h3-max/image-to-video` | No indicado | 6, 8 | 768P · el de la fotografía principal | 1 | Se descarta | 0,056 $ por segundo a 768p hasta el 15/11/2026 (desde el 16/11/2026: 0,08 $). **Precio temporal hasta el 15/11/2026.** [Fuente](https://fal.ai/models/minimax/h3-max/image-to-video) | 0,336 $ |
| Replicate | ByteDance | `bytedance/seedance-2.5` | No indicado | 4, 6, 8 | la del modelo · 16:9 | 1 | Se pide sin audio | Consultar tarifa del proveedor | No se estima |

## Comprobación de la clave y seguridad de cada proveedor

| Proveedor | Autenticación | Comprobación de la clave (no genera contenido) | Seguridad nativa | Uso de los datos |
|---|---|---|---|---|
| Google Gemini | Cabecera x-goog-api-key | Consulta los metadatos de un modelo (GET /v1beta/models/…): no genera contenido. La documentación no indica su coste: solo se hace si lo confirmas. | Filtros de seguridad de Gemini en su umbral más estricto y clasificador gemini-3.5-flash-lite (consume tokens de tu cuenta). | Según los términos de la API de Gemini (vigentes desde el 23/03/2026), en el nivel gratuito Google puede usar el contenido para mejorar sus productos y revisarlo con personas; en el de pago, no. Depende del plan de tu cuenta: EstateForge no puede garantizarlo. |
| OpenAI | Cabecera Authorization: Bearer | Consulta la lista de modelos de tu cuenta (GET /v1/models): no genera contenido. La documentación no indica su coste: solo se hace si lo confirmas. Que la clave sea válida no garantiza que tu cuenta tenga acceso a todos los modelos ni saldo para generar. | Filtro de políticas de uso de OpenAI sobre el prompt y la imagen generada. Además, clasificador omni-moderation-latest (texto e imagen), gratuito según su documentación; no clasifica vídeo. | El tratamiento de los datos depende de las condiciones de tu cuenta de OpenAI. EstateForge no puede garantizarlo: consúltalo en sus políticas. |
| Anthropic (Claude) | Cabecera x-api-key | Consulta la lista de modelos (GET /v1/models): no genera contenido. La documentación no indica su coste: solo se hace si lo confirmas. | El modelo puede negarse a responder (stop_reason «refusal»): EstateForge lo trata como un bloqueo, no como un texto válido. | Según su documentación, el contenido de la API no se conserva por defecto (salvo excepciones) y lo conservado no se usa para entrenar sin permiso expreso. Consulta las condiciones de tu cuenta. |
| xAI (Grok) | Cabecera Authorization: Bearer | Consulta la lista de modelos disponibles para la clave (GET /v1/models): no genera contenido. La documentación no indica su coste: solo se hace si lo confirmas. | Revisión de la política de contenido de xAI: un vídeo o una imagen bloqueados llegan como error «invalid_argument» o con respect_moderation: false, y EstateForge no los acepta. Los bloqueos posteriores a la generación se cobran. | Según su documentación, las imágenes y los vídeos generados pasan una revisión de política de contenido y no se usan para entrenar. Para el texto no consta una declaración en las páginas consultadas. |
| Mistral | Cabecera Authorization: Bearer | Consulta la lista de modelos (GET /v1/models): no genera contenido. La documentación no indica su coste: solo se hace si lo confirmas. | La documentación consultada no describe un filtro de contenido en la generación. EstateForge aplica sus reglas locales al texto del anuncio. | No consta una declaración sobre el uso de los datos de la API en las páginas consultadas. Consulta las condiciones de tu cuenta. |
| DeepSeek | Cabecera Authorization: Bearer | Consulta la lista de modelos (GET /models): no genera contenido. La documentación no indica su coste: solo se hace si lo confirmas. | La API puede cortar la respuesta por su filtro de contenido (finish_reason «content_filter»): EstateForge lo trata como un bloqueo. | No consta una declaración sobre el uso de los datos de la API en las páginas consultadas. Consulta las condiciones de tu cuenta. |
| Black Forest Labs (FLUX) | Cabecera x-key | Consulta el saldo de créditos (GET /v1/credits): no genera contenido. La documentación no indica su coste: solo se hace si lo confirmas. | Moderación de BFL sobre la petición y el resultado (estados «Request Moderated» y «Content Moderated»), con safety_tolerance en su valor por defecto. Según BFL, lo retenido por moderación no se cobra. | Los resultados se entregan por una URL que caduca a los 10 minutos. No consta más información sobre conservación en las páginas consultadas. |
| Stability AI | Cabecera Authorization: Bearer | Consulta el saldo de créditos (GET /v1/user/balance): no genera contenido. La documentación no indica su coste: solo se hace si lo confirmas. | Filtros de entrada y de salida de Stability (403 «content_moderation» y finish_reason «CONTENT_FILTERED») y firma C2PA. | No consta una declaración sobre el uso de los datos en las páginas consultadas. Consulta las condiciones de tu cuenta. |
| Ideogram | Cabecera Api-Key | Pide un presupuesto con dry_run=true: según la documentación, no genera ni cobra. | Comprobación de seguridad de Ideogram: 422 si el prompt no la supera y marca is_image_safe en cada imagen (si es falsa, no hay imagen). | Según su acuerdo de la API, Ideogram no entrena con las entradas ni las salidas, salvo el contenido marcado como infractor. |
| Recraft | Cabecera Authorization: Bearer | Consulta la cuenta (GET /v1/users/me): no genera contenido. La documentación no indica su coste: solo se hace si lo confirmas. | Recraft puede aplicar filtros automáticos, pero su respuesta no incluye ninguna marca de seguridad: la comprobación del resultado depende del clasificador externo que elijas. | Según sus condiciones para desarrolladores, Recraft no entrena con los resultados de la API y no los conserva más allá de lo necesario para entregarlos. |
| OpenRouter | Cabecera Authorization: Bearer | OpenRouter no documenta ninguna comprobación de una clave normal que no genere contenido: la conexión queda «sin comprobar» hasta la primera generación. | Depende del proveedor final al que OpenRouter enrute la petición. EstateForge aplica sus reglas locales al texto del anuncio. | Según su documentación, OpenRouter no registra los prompts ni las respuestas salvo que lo actives; el tratamiento final depende del proveedor al que se enrute y de los ajustes de privacidad de tu cuenta. |
| Groq | Cabecera Authorization: Bearer | Consulta la lista de modelos (GET /openai/v1/models): no genera contenido. La documentación no indica su coste: solo se hace si lo confirmas. | La documentación consultada no describe un filtro de contenido en la generación. EstateForge aplica sus reglas locales al texto del anuncio. | Según su documentación, Groq no conserva por defecto los datos de las peticiones de inferencia; puede registrarlos temporalmente para diagnosticar errores o abusos. |
| Runway | Cabecera Authorization: Bearer (y X-Runway-Version) | Consulta la organización y su saldo (GET /v1/organization): no genera contenido. La documentación no indica su coste: solo se hace si lo confirmas. | Runway modera todas las entradas y los resultados (failureCode SAFETY.INPUT.* y SAFETY.OUTPUT.*). Según su documentación, las solicitudes moderadas se cobran igual que las correctas. | No consta una declaración sobre conservación o entrenamiento en las páginas consultadas. Los modelos de terceros pueden aplicar sus propias condiciones. Las salidas caducan en 24-48 horas. |
| fal.ai | Cabecera Authorization: Key | Consulta el precio de un modelo (GET api.fal.ai/v1/models/pricing), que exige una clave válida: no genera contenido. La documentación no indica su coste: solo se hace si lo confirmas. | Comprobador de seguridad de cada modelo activado (enable_safety_checker) y errores «content_policy_violation». Depende del modelo. | fal conserva por defecto las entradas y salidas 90 días en el historial; EstateForge envía X-Fal-Store-IO: 0 para que no se guarden. Las fotografías viajan como datos en la petición (data URI), nunca como una URL pública. |
| Replicate | Cabecera Authorization: Bearer | Consulta la cuenta (GET /v1/account): no genera contenido. La documentación no indica su coste: solo se hace si lo confirmas. | Depende del modelo. La documentación consultada no describe un filtro común. | Según su documentación, las entradas, las salidas y los archivos de las predicciones creadas por la API se borran al cabo de una hora. |

## Enlaces oficiales

| Proveedor | Documentación | Precios | Obtener la clave | Condiciones | Privacidad |
|---|---|---|---|---|---|
| Google Gemini | https://aistudio.google.com/docs/image-generation | https://aistudio.google.com/docs/pricing | https://aistudio.google.com/apikey | https://aistudio.google.com/docs/terms | https://policies.google.com/privacy |
| OpenAI | https://developers.openai.com/api/docs/models | https://developers.openai.com/api/docs/pricing | https://platform.openai.com/api-keys | https://openai.com/policies | https://openai.com/policies/privacy-policy |
| Anthropic (Claude) | https://platform.claude.com/docs/en/api/overview | https://platform.claude.com/docs/en/about-claude/pricing | https://platform.claude.com/settings/keys | https://www.anthropic.com/legal/commercial-terms | https://www.anthropic.com/legal/privacy |
| xAI (Grok) | https://docs.x.ai/developers/models | https://docs.x.ai/developers/pricing | https://console.x.ai | https://x.ai/legal/terms-of-service-enterprise | https://x.ai/legal/privacy-policy |
| Mistral | https://docs.mistral.ai/inference | https://mistral.ai/pricing | https://console.mistral.ai/api-keys | https://mistral.ai/terms | https://mistral.ai/terms#privacy-policy |
| DeepSeek | https://api-docs.deepseek.com/en/ | https://api-docs.deepseek.com/quick_start/pricing | https://platform.deepseek.com/api_keys | https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html | https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html |
| Black Forest Labs (FLUX) | https://docs.bfl.ai/ | https://bfl.ai/pricing | https://dashboard.bfl.ai/ | https://bfl.ai/legal/terms-of-service | https://bfl.ai/legal/privacy-policy |
| Stability AI | https://docs.stability.ai/api-reference | https://docs.stability.ai/pricing | https://platform.stability.ai/account/keys | https://stability.ai/terms-of-service | https://stability.ai/privacy-policy |
| Ideogram | https://developer.ideogram.ai/ | https://ideogram.ai/pricing/?pricing_tab=api | https://ideogram.ai/platform | https://ideogram.ai/legal/api-tos | https://ideogram.ai/legal/privacy |
| Recraft | https://www.recraft.ai/docs/api-reference | https://www.recraft.ai/docs/api-reference/pricing | https://www.recraft.ai/app/api/api-keys | https://www.recraft.ai/legal/developer-terms | https://www.recraft.ai/privacy |
| OpenRouter | https://openrouter.ai/docs | https://openrouter.ai/models | https://openrouter.ai/settings/keys | https://openrouter.ai/terms | https://openrouter.ai/privacy |
| Groq | https://console.groq.com/docs/quickstart | https://console.groq.com/docs/models | https://console.groq.com/keys | https://groq.com/terms-of-use | https://groq.com/privacy-policy |
| Runway | https://docs.dev.runwayml.com/ | https://docs.dev.runwayml.com/guides/pricing/ | https://dev.runwayml.com/ | https://runwayml.com/terms-of-use | https://runwayml.com/privacy-policy |
| fal.ai | https://fal.ai/docs | https://fal.ai/pricing | https://fal.ai/dashboard/keys | https://fal.ai/terms | https://fal.ai/privacy |
| Replicate | https://replicate.com/docs/reference/http | https://replicate.com/pricing | https://replicate.com/account/api-tokens | https://replicate.com/terms | https://replicate.com/privacy |

Totales: 15 proveedores (10 con API directa y 5 agregadores); 21 modelos de texto, 24 de imagen y 20 de vídeo.

## Estado de integración por modelo

Estados independientes (DA-88): que un modelo esté documentado no significa que esté integrado, y que su adaptador supere las pruebas de contrato no demuestra cómo responde el servicio real.

- **Adaptador:** EstateForge construye la petición y lee la respuesta de ese modelo.
- **Contrato:** prueba con respuestas simuladas que comprueba, para ese modelo, el host de la lista cerrada, el identificador exacto, la duración y las imágenes de referencia, que la clave va solo en la cabecera, que no se envía ninguna URL del usuario y que una configuración que el catálogo no admite se rechaza sin llamar al proveedor.
- **Simulador:** el flujo de EstateForge de esa modalidad (confirmación, trabajo, moderación, validación, almacenamiento e interfaz) probado de extremo a extremo con el simulador local. Es común a todos los modelos de la modalidad y no implica al proveedor.
- **Real:** validado con el servicio real mediante una prueba real controlada. EstateForge no lo declara en el catálogo: cada usuario ve en Ajustes las pruebas que ha superado con su clave.

| Proveedor (factura) | Modalidad | Modelo | Fabricante | Adaptador | Contrato | Simulador | Real |
|---|---|---|---|:-:|:-:|:-:|:-:|
| Google Gemini | Texto | `gemini-3.6-flash` | Google | Sí | Sí, por modelo | Flujo común | No verificado |
| Google Gemini | Texto | `gemini-3.5-flash-lite` | Google | Sí | Sí, por modelo | Flujo común | No verificado |
| Google Gemini | Texto | `gemini-3.8-flash` | Google | Sí | Sí, por modelo | Flujo común | No verificado |
| Google Gemini | Texto | `gemini-4-carbon` | Google | Sí | Sí, por modelo | Flujo común | No verificado |
| Google Gemini | Imagen | `gemini-3.1-flash-image` | Google | Sí | Sí, por modelo | Flujo común | No verificado |
| Google Gemini | Imagen | `gemini-3.1-flash-lite-image` | Google | Sí | Sí, por modelo | Flujo común | No verificado |
| Google Gemini | Imagen | `gemini-nano-banana-2.1` | Google | Sí | Sí, por modelo | Flujo común | No verificado |
| Google Gemini | Imagen | `gemini-3-pro-image` | Google | Sí | Sí, por modelo | Flujo común | No verificado |
| Google Gemini | Vídeo | `gemini-omni-1.2-flash` | Google | Sí | Sí, por modelo | Flujo común | No verificado |
| OpenAI | Texto | `gpt-6.1-terra` | OpenAI | Sí | Sí, por modelo | Flujo común | No verificado |
| OpenAI | Texto | `gpt-6-luna` | OpenAI | Sí | Sí, por modelo | Flujo común | No verificado |
| OpenAI | Texto | `gpt-6.1-sol` | OpenAI | Sí | Sí, por modelo | Flujo común | No verificado |
| OpenAI | Texto | `gpt-5.5` | OpenAI | Sí | Sí, por modelo | Flujo común | No verificado |
| OpenAI | Imagen | `gpt-image-2.6-flare` | OpenAI | Sí | Sí, por modelo | Flujo común | No verificado |
| OpenAI | Imagen | `gpt-image-2.6-sunburst` | OpenAI | Sí | Sí, por modelo | Flujo común | No verificado |
| Anthropic (Claude) | Texto | `claude-sonnet-5-5` | Anthropic | Sí | Sí, por modelo | Flujo común | No verificado |
| Anthropic (Claude) | Texto | `claude-haiku-5-5` | Anthropic | Sí | Sí, por modelo | Flujo común | No verificado |
| Anthropic (Claude) | Texto | `claude-opus-5-5` | Anthropic | Sí | Sí, por modelo | Flujo común | No verificado |
| xAI (Grok) | Texto | `grok-4.3` | xAI | Sí | Sí, por modelo | Flujo común | No verificado |
| xAI (Grok) | Texto | `grok-4.7` | xAI | Sí | Sí, por modelo | Flujo común | No verificado |
| xAI (Grok) | Imagen | `grok-imagine-image-2.0` | xAI | Sí | Sí, por modelo | Flujo común | No verificado |
| xAI (Grok) | Imagen | `grok-imagine-image` | xAI | Sí | Sí, por modelo | Flujo común | No verificado |
| xAI (Grok) | Vídeo | `grok-imagine-video-1.5` | xAI | Sí | Sí, por modelo | Flujo común | No verificado |
| xAI (Grok) | Vídeo | `grok-imagine-video-1.5-lite` | xAI | Sí | Sí, por modelo | Flujo común | No verificado |
| Mistral | Texto | `mistral-large-latest` | Mistral AI | Sí | Sí, por modelo | Flujo común | No verificado |
| Mistral | Texto | `mistral-medium-3-5` | Mistral AI | Sí | Sí, por modelo | Flujo común | No verificado |
| DeepSeek | Texto | `deepseek-flash` | DeepSeek | Sí | Sí, por modelo | Flujo común | No verificado |
| DeepSeek | Texto | `deepseek-v4-pro` | DeepSeek | Sí | Sí, por modelo | Flujo común | No verificado |
| Black Forest Labs (FLUX) | Imagen | `flux-3-image` | Black Forest Labs | Sí | Sí, por modelo | Flujo común | No verificado |
| Black Forest Labs (FLUX) | Imagen | `flux-2-pro` | Black Forest Labs | Sí | Sí, por modelo | Flujo común | No verificado |
| Black Forest Labs (FLUX) | Vídeo | `flux-3-video` | Black Forest Labs | Sí | Sí, por modelo | Flujo común | No verificado |
| Stability AI | Imagen | `stable-image-core` | Stability AI | Sí | Sí, por modelo | Flujo común | No verificado |
| Stability AI | Imagen | `stable-image-ultra` | Stability AI | Sí | Sí, por modelo | Flujo común | No verificado |
| Stability AI | Imagen | `sd3.5-large` | Stability AI | Sí | Sí, por modelo | Flujo común | No verificado |
| Ideogram | Imagen | `ideogram-4-5` | Ideogram | Sí | Sí, por modelo | Flujo común | No verificado |
| Recraft | Imagen | `recraftv4_1` | Recraft | Sí | Sí, por modelo | Flujo común | No verificado |
| Recraft | Imagen | `recraftv4_1_flash` | Recraft | Sí | Sí, por modelo | Flujo común | No verificado |
| OpenRouter | Texto | `~anthropic/claude-sonnet-latest` | Anthropic | Sí | Sí, por modelo | Flujo común | No verificado |
| OpenRouter | Texto | `~openai/gpt-sol-latest` | OpenAI | Sí | Sí, por modelo | Flujo común | No verificado |
| Groq | Texto | `openai/gpt-oss-120b` | OpenAI (pesos abiertos) | Sí | Sí, por modelo | Flujo común | No verificado |
| Groq | Texto | `openai/gpt-oss-20b` | OpenAI (pesos abiertos) | Sí | Sí, por modelo | Flujo común | No verificado |
| Runway | Vídeo | `gen4.5` | Runway | Sí | Sí, por modelo | Flujo común | No verificado |
| Runway | Vídeo | `veo3.1_fast` | Google | Sí | Sí, por modelo | Flujo común | No verificado |
| Runway | Vídeo | `veo3.1` | Google | Sí | Sí, por modelo | Flujo común | No verificado |
| Runway | Vídeo | `kling3.0_standard` | Kling (Kuaishou) | Sí | Sí, por modelo | Flujo común | No verificado |
| Runway | Vídeo | `kling3.0_pro` | Kling (Kuaishou) | Sí | Sí, por modelo | Flujo común | No verificado |
| Runway | Vídeo | `kling_4` | Kling (Kuaishou) | Sí | Sí, por modelo | Flujo común | No verificado |
| Runway | Vídeo | `seedance2_fast` | ByteDance | Sí | Sí, por modelo | Flujo común | No verificado |
| Runway | Vídeo | `seedance2_5` | ByteDance | Sí | Sí, por modelo | Flujo común | No verificado |
| Runway | Vídeo | `hailuo3` | MiniMax | Sí | Sí, por modelo | Flujo común | No verificado |
| Runway | Vídeo | `wan3` | Alibaba | Sí | Sí, por modelo | Flujo común | No verificado |
| Runway | Vídeo | `grok_imagine_1_5` | xAI | Sí | Sí, por modelo | Flujo común | No verificado |
| Runway | Vídeo | `gemini_omni_flash_1.2` | Google | Sí | Sí, por modelo | Flujo común | No verificado |
| Runway | Imagen | `gen4_image` | Runway | Sí | Sí, por modelo | Flujo común | No verificado |
| Runway | Imagen | `nano_banana_2.1` | Google | Sí | Sí, por modelo | Flujo común | No verificado |
| Runway | Imagen | `seedream5_pro` | ByteDance | Sí | Sí, por modelo | Flujo común | No verificado |
| Runway | Imagen | `gpt_image_2_6_flare` | OpenAI | Sí | Sí, por modelo | Flujo común | No verificado |
| Runway | Imagen | `grok_imagine_image_2` | xAI | Sí | Sí, por modelo | Flujo común | No verificado |
| fal.ai | Imagen | `fal-ai/flux-2` | Black Forest Labs | Sí | Sí, por modelo | Flujo común | No verificado |
| fal.ai | Imagen | `fal-ai/flux-2/edit` | Black Forest Labs | Sí | Sí, por modelo | Flujo común | No verificado |
| fal.ai | Imagen | `fal-ai/nano-banana-2` | Google | Sí | Sí, por modelo | Flujo común | No verificado |
| fal.ai | Vídeo | `fal-ai/kling-video/v3/pro/image-to-video` | Kling (Kuaishou) | Sí | Sí, por modelo | Flujo común | No verificado |
| fal.ai | Vídeo | `bytedance/seedance-2.0/fast/image-to-video` | ByteDance | Sí | Sí, por modelo | Flujo común | No verificado |
| fal.ai | Vídeo | `minimax/h3-max/image-to-video` | MiniMax | Sí | Sí, por modelo | Flujo común | No verificado |
| Replicate | Vídeo | `bytedance/seedance-2.5` | ByteDance | Sí | Sí, por modelo | Flujo común | No verificado |

Comparten contrato (misma forma de petición, cambia solo el identificador o un parámetro del catálogo): los modelos de texto de cada proveedor de API de chat; las imágenes de Gemini; los modelos de imagen de OpenAI, xAI, Recraft y Stability SD 3.5; los de imagen y de vídeo de Runway con sus parámetros por modelo (`RUNWAY_IMAGE_MODELS`, `RUNWAY_VIDEO_MODELS`); y los de fal.ai con los suyos (`FAL_MODELS`). Aun así, cada modelo tiene su propia prueba.

## Comprobación de la conexión y diagnóstico

La comprobación usa una llamada de lectura que no genera contenido (DA-87):
- **Coste:** solo Ideogram documenta expresamente que su comprobación (`dry_run=true`) no cobra. Para el resto, la documentación no indica el coste: EstateForge no la hace hasta que el usuario lo confirma (casilla en Ajustes; la API responde 409 `AI_VERIFY_COST_UNCONFIRMED` sin confirmación). OpenRouter no ofrece ninguna comprobación sin generar.
- **Diagnóstico guardado** (sin la respuesta del proveedor ni secretos): fecha, método, capacidades y el problema detectado: clave rechazada (401), **permiso denegado (403: la clave se reconoce, pero la cuenta, el proyecto o la región no tienen permiso)**, cuota o saldo (402/429) o proveedor no disponible.
- **Modelos accesibles:** cuando la comprobación es una lista de modelos (OpenAI, xAI, Anthropic, Mistral, DeepSeek y Groq), se indica qué modelos del catálogo lista la cuenta y cuáles no. Que un modelo no aparezca es una señal, no una prueba de falta de acceso.
- Una comprobación correcta **no demuestra que se pueda generar**: no comprueba saldo ni permisos de generación. Para eso está la prueba real controlada.

## Pruebas reales controladas

Desde Ajustes, cada usuario puede validar un proveedor con su propia conexión (DA-89):

1. Elige una de sus conexiones, el tipo (texto, imagen o vídeo) y el modelo (en vídeo, la duración mínima por defecto).
2. EstateForge muestra el plan: proveedor de la API, fabricante, modelo, cuenta que factura, datos que se envían (un **inmueble ficticio** y **degradados sintéticos**: nunca fotografías ni datos personales), clasificador de seguridad y coste estimado, o «Coste no verificable» si no hay un precio que permita calcularlo.
3. Solo se ejecuta si el usuario marca que acepta los posibles cargos. La API compara la confirmación con su propio plan: si el modelo, la cuenta o el coste han cambiado, la rechaza.
4. Se envía **una sola** operación. Si su estado es incierto (red, tiempo agotado), queda como «incierta» y no se repite. Las imágenes y los vídeos se sondean como los trabajos, sin procesos en segundo plano.
5. El resultado se valida (formato, tamaño, resolución, duración, códec y moderación de entrada y de salida) y **se descarta**: solo se guarda un informe sin secretos ni URL del proveedor (de una URL, solo el host). No toca ningún inmueble, anuncio ni material.
6. Las pruebas cuentan en los mismos límites que las generaciones (2 a la vez, 20 al día y 200 en 30 días) y solo una puede estar en curso.

### Las seis pruebas propuestas (DA-93)

Agrupadas por modalidad en Ajustes. Cada tarjeta muestra el logotipo del proveedor que recibe la clave y factura, el fabricante del modelo, la capacidad, la resolución o duración, las referencias, el desglose del coste y el clasificador. La cuenta se elige expresamente (nunca la elige EstateForge) y cada prueba tiene su propia confirmación. Sin credenciales, la tarjeta dice «Pendiente de credenciales» y enlaza con la tarjeta del proveedor. Precios y parámetros verificados en la documentación oficial el **15/11/2026**; el plan avisa si el precio tiene más de 7 días.

| Prueba | Proveedor (factura) | Fabricante | Modelo | Parámetros | Coste calculable | Aparte |
|---|---|---|---|---|---|---|
| Texto · API directa | OpenAI | OpenAI | `gpt-6-luna` | Anuncio breve, salida estructurada | Por tokens (0,10 $ / 0,01 $ en caché / 0,50 $ por millón): se calcula al terminar con los tokens que devuelve la API | — |
| Texto · agregador | Groq | OpenAI (pesos abiertos) | `openai/gpt-oss-20b` | Anuncio breve, salida estructurada | Por tokens (0,075 $ / 0,037 $ en caché / 0,30 $ por millón) | — |
| Imagen · API directa | Google Gemini | Google | `gemini-3.1-flash-lite-image` | 1 imagen de 1K, sin referencias | 0,0336 $ | Clasificador propio de Gemini (tokens de gemini-3.5-flash-lite, no estimable) |
| Imagen · agregador | Runway | Google | `nano_banana_2.1` | 1 imagen de 1K (848×1264), sin referencias | 0,04 $ (las referencias no añaden coste) | Clasificador de Gemini con tu clave (no estimable) |
| Vídeo · API directa | xAI | xAI | `grok-imagine-video-1.5-lite` | 4 s, 1 imagen sintética, resolución del catálogo (720p) | 0,08 $ (0,02 $/s) | Imagen de entrada: precio no publicado; clasificador de vídeo de Gemini (no estimable) |
| Vídeo · agregador | Runway | Google | `gemini_omni_flash_1.2` | 4 s a 360p (640×360), 1 imagen sintética | 0,08 $ + 0,01 $ por la referencia = 0,09 $ (mínimo 6 créditos por petición) | Clasificador de vídeo de Gemini (no estimable). El clip siempre trae audio: EstateForge lo descarta |

Diferencias con los parámetros propuestos inicialmente:
- **xAI a 480p:** la documentación consultada publica 0,02 $/s para `grok-imagine-video-1.5-lite` sin distinguir resolución, y su guía de vídeo no estaba disponible (404). No consta que 480p sea un valor admitido ni su precio, así que no se ofrece: la prueba usa la resolución del catálogo (720p) y el precio publicado.
- **Runway a 360p:** la página del modelo publica 2 créditos/s a 360p y lista la relación `640:360`; que esa relación sea la que da 360p se deduce de sus píxeles (la página no enumera la correspondencia). Es la única resolución adicional que se ofrece, solo para este modelo.
- **Precio de la imagen de Gemini:** la página de precios llegó truncada a la herramienta de lectura; 0,0336 $ procede de su resumen y coincide con el valor del 12/11/2026. Conviene confirmarlo en la página antes de la prueba.

Los costes que no se pueden calcular (tokens, clasificador, imagen de entrada de xAI) se muestran como «no estimable» y el total indica «más lo no estimable». EstateForge nunca presenta su cálculo como la factura del proveedor.

## Desglose del coste (DA-92)

Antes de confirmar una prueba se suman solo los importes publicados por el proveedor que factura:
- **generación:** por imagen, o por segundo y resolución en vídeo (con el mínimo por petición si lo hay);
- **imágenes de referencia:** su precio si se publica; «no añaden coste» si el proveedor lo dice; «no estimable» si no consta;
- **clasificador de seguridad:** el de Gemini (gemini-3.5-flash-lite, 0,30 $ por millón de tokens de entrada y 2,50 $ de salida) no se puede estimar porque la documentación no dice cuántos tokens cuenta una imagen o un segundo de vídeo; el de OpenAI es gratuito según su documentación;
- **texto:** por tokens; tras la prueba se muestran los tokens que devuelve la API (`usage`) y el coste estimado con ellos. Si la API no los devuelve, se dice. La salida está limitada a 4 000 tokens en las API de chat y en Anthropic; en OpenAI y Gemini EstateForge no fija un máximo.

## Logotipos (DA-91)

Cada tarjeta muestra el logotipo del proveedor que **recibe la API key y factura**, nunca el del fabricante del modelo (Runway muestra Runway; sus fabricantes aparecen aparte, como texto). Los archivos están en `apps/web/src/assets/providers/` y se sirven con la propia aplicación: ninguna tarjeta depende de una imagen externa. El nombre se muestra siempre junto al logotipo.

| Proveedor | Recurso | Procedencia | Licencia |
|---|---|---|---|
| Google Gemini | `gemini.svg` | Simple Icons 16.36.0, «Google Gemini» (color #8E75B2) | CC0 1.0 (el trazado); la marca pertenece a Google |
| Anthropic | `anthropic.svg` | Simple Icons 16.36.0, «Anthropic» (#191919) | CC0 1.0; la marca pertenece a Anthropic |
| DeepSeek | `deepseek.svg` | Simple Icons 16.36.0, «DeepSeek» (#5786FE) | CC0 1.0; la marca pertenece a DeepSeek |
| Mistral | `mistral.svg` | Simple Icons 16.36.0, «Mistral AI» (#FA520F) | CC0 1.0; la marca pertenece a Mistral AI |
| OpenRouter | `openrouter.svg` | Simple Icons 16.36.0, «OpenRouter» (#94A3B8, sobre placa oscura para llegar al contraste 3:1) | CC0 1.0; la marca pertenece a OpenRouter |
| Replicate | `replicate.svg` | Simple Icons 16.36.0, «Replicate» (#000000) | CC0 1.0; la marca pertenece a Replicate |
| Black Forest Labs | `bfl.svg` | Kit de marca oficial, `https://bfl.ai/brand/symbol-black.svg`, sin modificar | Directrices de bfl.ai/brand (no alterar, no cambiar el color, no distorsionar) |
| OpenAI, xAI, Groq, Stability AI, Ideogram, Recraft, Runway, fal.ai | — | Sin recurso verificable: Simple Icons no los incluye y sus páginas de marca no ofrecen un archivo descargable en su dominio (OpenAI: 403; xAI, Groq, Runway: 404; Stability enlaza a Google Drive; Ideogram, Recraft y fal.ai sin kit) | Respaldo neutro (icono genérico y el nombre); no se imita ninguna identidad |

Los SVG de Simple Icons se reconstruyen solo con su trazado y su color de marca (sin scripts ni referencias externas); el de BFL se copia tal cual. Cada logotipo va sobre una placa de tamaño fijo (sin saltos de maquetación) con su propio fondo, válida en tema claro y oscuro, y tiene texto alternativo; el respaldo lleva `aria-label` con el nombre.

## Sin reintentos automáticos

Ninguna llamada a un proveedor se repite sola. El SDK de OpenAI reintenta por defecto ante errores 5xx, 429 o de red (dos veces), lo que podría duplicar un cargo: EstateForge lo crea con `maxRetries: 0` (MD-51). El SDK de Gemini solo reintenta si se le pasan opciones de reintento, y EstateForge no las pasa. Los adaptadores HTTP propios no reintentan.

## Conexiones (varias cuentas por proveedor)

- En **Ajustes → Integraciones de inteligencia artificial** cada proveedor admite hasta 5 conexiones, cada una con su API key y una etiqueta (por ejemplo, «personal» y «profesional»). La primera es la conexión principal (sin etiqueta).
- La clave se asocia al **proveedor de la API** (en un agregador, a la cuenta del agregador), no a cada modelo.
- Qué conexión se usa en una generación, por este orden: la elegida para esa operación, la de la preferencia guardada, la única que haya o la principal. Si hay varias y nada de eso decide, se pide elegir: nunca se escoge una cuenta al azar ni se sustituye una conexión que ya no existe.
- Cada clave se cifra por separado con AES-256-GCM. No se devuelve al navegador, no se registra y no hay forma de recuperarla. Toda consulta filtra por el usuario autenticado: una conexión ajena responde igual que una inexistente (404).
- Rutas: `POST /api/account/ai-connections`, `PUT` y `DELETE /api/account/ai-connections/:id`, `POST …/:id/verify` y `GET …/:id/models`. Las rutas por proveedor (`/api/account/ai-keys/:provider`) siguen gestionando la conexión principal.

## Elección de proveedor y modelo

- **Preferencias por uso** (texto, cartel y vídeo): proveedor, modelo y conexión. Cada lista solo ofrece modelos que **generan** ese tipo de contenido y cuentas conectadas.
- **En cada generación** se puede elegir otro modelo u otra cuenta sin cambiar la preferencia.
- **Sin sustituciones:** se usa exactamente el proveedor, el modelo y la conexión elegidos. Si falla, se informa; no se prueba otro modelo, otra clave ni otro proveedor, ni se entrega una plantilla local como si fuera IA.
- **Modelo no disponible:** si el modelo de una preferencia deja de estar en el catálogo, la preferencia se conserva marcada como no disponible y se pide elegir otro.
- **Antes de generar** se muestran el proveedor de la API, el fabricante, el modelo, la cuenta que factura, el coste estimado (o que no se puede estimar) y el clasificador de seguridad, y se pide una confirmación expresa. También para el texto.

## Clasificador de seguridad

Antes de aceptar un cartel o un vídeo generado con IA se clasifican los textos del anuncio, las fotografías y el resultado (segunda capa de moderación, además de las reglas locales y de la revisión del usuario).

- **Google Gemini** trae su clasificador (texto, imagen y vídeo) y lo usa con la misma clave.
- **OpenAI** ofrece `omni-moderation-latest` (texto e imagen; gratuito según su documentación). No clasifica vídeo.
- **El resto de proveedores no trae un clasificador equivalente.** Para generar con ellos el usuario elige en Ajustes un clasificador externo (Gemini u OpenAI) con **su propia clave**; su consumo se factura en esa cuenta y se avisa antes de confirmar.
- Sin clasificador configurado, o si no puede analizar ese tipo de material (un vídeo con el clasificador de OpenAI), **no se genera**: la petición se rechaza antes de crear el trabajo y de llamar al proveedor.
- Fallo seguro: si la clasificación no se puede completar, el resultado no se acepta.
- Los filtros propios de cada proveedor siguen activos; un bloqueo suyo se trata como un bloqueo de moderación.

## Descubrimiento de modelos (OpenRouter)

OpenRouter publica su catálogo en `GET /api/v1/models`. Desde Ajustes («Ver más modelos») EstateForge lo consulta con la clave del usuario y ofrece solo los modelos que cumplen todos los requisitos:
- generan exclusivamente texto;
- admiten salida estructurada;
- no están caducados y no son variantes gratuitas con límites;
- su identificador tiene la forma `fabricante/modelo`.

La forma de la respuesta se valida: si no es la documentada, no se ofrece ningún modelo descubierto. Los resultados se guardan una hora en memoria y se muestran siempre como **no verificados por EstateForge**, sin precio (hay que consultarlo en OpenRouter). Al generar, el modelo debe seguir en ese catálogo.

## No integrado, y por qué

| Proveedor o modelo | Motivo |
|---|---|
| OpenAI Sora (vídeo) | La API de vídeos y los modelos Sora 2 se cerraron el 24/09/2026, sin sustituto |
| Google Veo, API directa | Todos los modelos Veo de la API de Gemini están cerrados (los últimos, el 22/10/2026). Veo 3.1 se ofrece a través de Runway |
| Google Imagen | Imagen 4 está cerrado en la API de Gemini |
| Luma (Dream Machine) | Su API solo admite las imágenes de entrada como URL públicas: habría que publicar las fotografías privadas del inmueble. Además, su documentación remite a otra más reciente que no se ha podido leer y no publica precios |
| Kling, ByteDance Seedance y MiniMax, API directa | No se han integrado sus API directas; se ofrecen a través de Runway, fal.ai y Replicate, con la clave y la tarifa del agregador |
| Kling 4.0 en Replicate, y el resto de modelos de Replicate | Los parámetros de entrada no se pudieron leer en su documentación pública. Solo se registra Seedance 2.5, cuyos campos sí constan |
| Runway Gen-4 Turbo | Su esquema no documenta las duraciones admitidas |
| Recraft V3 | Su prompt admite 1000 caracteres: no caben las instrucciones de seguridad completas |
| Cohere y otros proveedores de texto | No se han investigado en esta intervención |
| Stability AI, vídeo | Stability retiró su API de vídeo |
| Edición de fotografías (inpainting, sustitución de fondo) | Fuera del alcance: la IA solo genera el fondo del cartel o el clip; las fotografías del inmueble no se alteran |

## Límites de esta integración

- **Resolución, relación de aspecto y calidad** están fijadas por modelo (las indicadas en las tablas); el usuario elige proveedor, modelo, cuenta y, en vídeo, la duración entre las que admite el modelo.
- **Fotografías de referencia:** como máximo 3 para el cartel; en vídeo, la principal como primer fotograma en la mayoría de los modelos. Los modelos que solo generan a partir de texto no reciben ninguna.
- **Tamaño de las fotografías** enviadas como datos: 3,6 MB en Runway y 1 MB en Replicate. Una fotografía mayor se rechaza con un aviso.
- **Hosts de entrega:** cada resultado por URL solo se descarga de los hosts de entrega documentados del proveedor. En Runway e Ideogram la documentación no garantiza el host: si entregan desde otro, la descarga se rechaza y la generación falla sin guardar nada.
- **Webhooks:** no se usan; los trabajos avanzan por sondeo.
- **Gasto:** EstateForge mantiene sus límites (2 generaciones a la vez, 20 al día y 200 en 30 días), pero no puede limitar el gasto de la cuenta del usuario en el proveedor.

## Mantenimiento del catálogo

Los proveedores cambian modelos y precios con frecuencia. Procedimiento manual, que debe repetirse periódicamente:
1. Consultar la documentación oficial de cada proveedor (enlaces de este documento): modelos vigentes, retiradas, parámetros y precios.
2. Actualizar `apps/api/src/ai-media/catalog.ts`: añadir o retirar modelos, `retiresAt` para los que tienen fecha de retirada, precios con su fuente y `consultedAt`. Un modelo solo se añade si su identificador, su endpoint y sus parámetros constan en la documentación.
3. Si el modelo es de Runway o de fal.ai, añadir sus parámetros en el adaptador (`adapters/runway.adapter.ts`, `adapters/fal.adapter.ts`).
4. Ejecutar las pruebas: `catalog.test.ts` comprueba las invariantes de cualquier modelo (genera lo que declara, fabricante, precio con fuente y fecha, duraciones, que cada modelo tiene sus parámetros en el adaptador) y que no figura ningún modelo retirado; `model-coverage.contract.test.ts` construye la petición de cada modelo y comprueba que las configuraciones no admitidas se rechazan. Si cambia la forma de alguna petición, actualizar `CONTRACT_VERSION` (`ai-media/integration.ts`).
5. Regenerar este documento.

Un modelo con `retiresAt` vencido deja de poder elegirse automáticamente; las preferencias que lo usaban se conservan marcadas como no disponibles.

Un precio temporal deja de mostrarse y de usarse para estimar al día siguiente de su fecha de fin: desde entonces el modelo indica «Consultar tarifa del proveedor» hasta que se registre el precio nuevo. Hoy son cinco: `minimax/h3-max/image-to-video` en fal.ai (hasta el 15/11/2026), `kling_4` en Runway y `gemini-4-carbon` (hasta el 30/11/2026) y `gemini-3.6-flash` y `gemini-3.8-flash` (hasta el 31/12/2026).

## Fuentes consultadas (12/11/2026 y 15/11/2026)

- **Anthropic:** platform.claude.com/docs/en — `api/overview`, `api/messages`, `build-with-claude/structured-outputs`, `api/models/list`, `models/overview`, `about-claude/pricing`, `about-claude/model-deprecations`, `api/errors`, `manage-claude/api-and-data-retention`.
- **xAI:** docs.x.ai/developers — `models`, `pricing`, `model-capabilities/imagine`, `model-capabilities/images/generation`, `model-capabilities/video/generation`, `model-capabilities/text/structured-outputs`, `rest-api-reference/inference/*`, `debugging`.
- **Mistral:** docs.mistral.ai — `inference`, `api`, `api/endpoint/models`, `getting-started/models/models_overview`, `inference/conversations/structured-output/*`; mistral.ai/pricing.
- **DeepSeek:** api-docs.deepseek.com — `en`, `api/list-models`, `quick_start/pricing`, `guides/json_mode`, `api/create-chat-completion`, `quick_start/error_codes`.
- **OpenRouter:** openrouter.ai/docs — inicio, `api-reference/chat-completion`, `features/structured-outputs`, `api-reference/list-available-models`, `faq`, `features/privacy-and-logging`.
- **Groq:** console.groq.com/docs — `quickstart`, `models`, `structured-outputs`, `api-reference`, `deprecations`, `errors`, `your-data`.
- **OpenAI:** developers.openai.com/api/docs — `models`, `guides/image-generation`, `guides/video-generation`, `guides/moderation`, `pricing`, `deprecations`, y la referencia de imágenes.
- **Google:** aistudio.google.com/docs — `models`, `video`, `image-generation`, `pricing`, `deprecations`.
- **Black Forest Labs:** docs.bfl.ml (referencia de la API, guía de integración y errores) y bfl.ai/pricing.
- **Stability AI:** docs.stability.ai — `api-reference`, endpoints de generación, saldo, `pricing` y notas de versión.
- **Ideogram:** developer.ideogram.ai (API v2), ideogram.ai/pricing e ideogram.ai/legal/api-tos.
- **Recraft:** recraft.ai/docs/api-reference y recraft.ai/legal/developer-terms.
- **Runway:** docs.dev.runwayml.com — `guides/models`, `guides/pricing`, `guides/using-the-api`, `assets/inputs`, `assets/outputs`, `api-details/moderation`, `errors/*`, `usage/tiers`; y los esquemas exactos del SDK oficial `runwayml/sdk-node`.
- **Luma:** docs.lumalabs.ai (no integrado).
- **fal.ai:** fal.ai/docs (cola, autenticación, errores, archivos, API de la plataforma), fal.ai/pricing y las páginas de cada modelo.
- **Replicate:** replicate.com/docs (referencia HTTP, predicciones, archivos de entrada y salida), replicate.com/pricing y las páginas de los modelos.

Consultadas el 15/11/2026 para las seis pruebas propuestas:
- https://developers.openai.com/api/docs/models/gpt-6-luna y https://developers.openai.com/api/docs/pricing
- https://console.groq.com/docs/models y https://console.groq.com/docs/model/openai/gpt-oss-20b
- https://aistudio.google.com/docs/pricing y https://aistudio.google.com/docs/models (la página de precios llegó truncada)
- https://dev.runwayml.com/learn/nano-banana-2-1-api, https://dev.runwayml.com/learn/gemini-omni-flash-1-2-api y https://docs.dev.runwayml.com/guides/pricing/
- https://docs.x.ai/developers/models/grok-imagine-video-1.5-lite y https://docs.x.ai/developers/pricing (la guía de vídeo devolvió 404)
- Logotipos: paquete `simple-icons` 16.36.0 (npm, CC0) y https://bfl.ai/brand
