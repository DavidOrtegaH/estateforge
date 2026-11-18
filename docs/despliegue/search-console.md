# Indexación y Google Search Console

**Estado (18/11/2026): web publicada en <https://estateforge-blush.vercel.app/>; propiedad de Search Console verificada y sitemap procesado; portada todavía sin indexar.** En producción se ha comprobado que la portada responde 200 sin `noindex`, que `/panel` lleva `X-Robots-Tag: noindex`, que una ruta desconocida da un 404 real y que `sitemap.xml` lista las tres páginas públicas.

- **Propiedad.** De **prefijo de URL** para `https://estateforge-blush.vercel.app/`, verificada con la etiqueta `<meta name="google-site-verification">` (un identificador público, no un secreto) de `apps/web/index.html`. La etiqueta se mantiene: retirarla haría perder la verificación.
- **Sitemap.** `sitemap.xml` enviado. El detalle final de Google indica que se procesó correctamente, con última lectura el 18/11/2026 y 3 páginas descubiertas. Un estado transitorio anterior («No se ha podido obtener») quedó resuelto en ese detalle.
- **Indexación.** La solicitud de indexación de la portada se rechazó porque se había superado la cuota diaria; Google indica que la URL no está indexada. No se ha reintentado hoy. No hay garantía de que la web aparezca en Google.

Este documento describe cómo funciona el SEO de la web y los pasos de alta.

Documentación consultada el **17/11/2026**:

- [Bloquear la indexación (`noindex`, `X-Robots-Tag`)](https://developers.google.com/search/docs/crawling-indexing/block-indexing)
- [Crear un sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- [Canonicalización](https://developers.google.com/search/docs/crawling-indexing/canonicalization) y [URLs duplicadas](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
- [Directrices de datos estructurados](https://developers.google.com/search/docs/appearance/structured-data/sd-policies)
- [Verificar la propiedad en Search Console](https://support.google.com/webmasters/answer/9008080)
- [Entornos de Vercel (cabecera `X-Robots-Tag` en las vistas previas)](https://vercel.com/docs/deployments/environments), [variables de sistema](https://vercel.com/docs/environment-variables/system-environment-variables) y [`vercel.json`](https://vercel.com/docs/project-configuration/vercel-json)

## Qué se indexa

| Ruta | Indexable | Cómo |
|---|---|---|
| `/`, `/privacidad`, `/condiciones` | Sí, solo en producción | HTML estático con título, descripción, canónica absoluta y Open Graph; están en `sitemap.xml` |
| `/panel`, `/inmuebles`, `/historial`, `/cuenta`, `/admin`, `/login`, `/registro`, recuperación y verificación | No | `X-Robots-Tag: noindex, nofollow` (vercel.json) y `<meta name="robots">` en `app.html`. **No** se bloquean en `robots.txt`: Google solo respeta `noindex` si puede rastrear la página |
| `/api/*` | No | `Disallow: /api/` en `robots.txt` y `X-Robots-Tag` en todas las respuestas de la API |
| Rutas desconocidas | No | `404.html` con estado 404 y `noindex` |
| Vistas previas de Vercel | No | Vercel añade `X-Robots-Tag: noindex`; además la construcción no es indexable (`robots.txt` con `Disallow: /`, `noindex` y sin mapa del sitio) |

El origen canónico se decide al construir (`apps/web/tooling/site.ts`):

1. `SITE_URL`, si está definida (por ejemplo, un dominio propio: `https://estateforge.example`). Debe ser `https://` y solo el origen.
2. En la producción de Vercel, `https://` + `VERCEL_PROJECT_PRODUCTION_URL` (el dominio de producción más corto del proyecto). Requiere tener activado el acceso a las variables de sistema en el proyecto.
3. Sin ninguna de las dos, no hay canónica ni mapa del sitio, y nada se indexa.

Los datos estructurados son solo `WebSite` (nombre, URL e idioma), que coinciden con lo visible en la página. No se marcan precios, valoraciones ni opiniones.

## Antes de dar de alta la propiedad

1. Desplegar producción y comprobar:
   - `curl -I https://<dominio>/` → 200, sin `X-Robots-Tag`.
   - `curl -I https://<dominio>/panel` → 200 con `X-Robots-Tag: noindex, nofollow`.
   - `curl -I https://<dominio>/no-existe` → 404 con la página de error (comprobado en producción: sirve `404.html` con estado 404).
   - `curl -I https://<dominio>/privacidad.html` → 308 a `/privacidad`.
   - `https://<dominio>/robots.txt` contiene `Sitemap: https://<dominio>/sitemap.xml` y `sitemap.xml` lista las tres páginas con ese mismo dominio.
   - La canónica de cada página (`view-source:`) apunta a sí misma con el dominio definitivo.
2. Si se añade un dominio propio después del primer despliegue, volver a desplegar para que la canónica y el mapa lo usen.

## Alta en Search Console (a cargo del titular)

Estado de cada paso para `https://estateforge-blush.vercel.app/`: propiedad de prefijo de URL **creada y verificada** con la etiqueta `<meta>`; sitemap **enviado y procesado** (3 páginas descubiertas); solicitud de indexación de `/` **rechazada por cuota diaria**, pendiente de repetir otro día; revisión de **Páginas** pendiente.

1. Crear la propiedad:
   - **Dominio** (recomendado si hay dominio propio): verificación por registro DNS (TXT o CNAME). Cubre `http`, `https` y los subdominios. No borrar el registro después.
   - **Prefijo de URL** (por ejemplo, `https://<proyecto>.vercel.app/`): verificación con una etiqueta `<meta>` en la portada o un archivo HTML en la raíz. Ambos cambian el repositorio (`apps/web/index.html` o `apps/web/public/`) y necesitan un despliegue; el archivo debe ser accesible sin autenticación.
2. Enviar `https://<dominio>/sitemap.xml` en **Sitemaps**.
3. Inspeccionar `/` con **Inspección de URLs** y pedir la indexación.
4. Al cabo de unos días, revisar **Páginas**: las rutas de la aplicación deben aparecer como «Excluida por la etiqueta noindex» y ninguna página pública como bloqueada.
