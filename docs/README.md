# Documentación de EstateForge

Presentación y uso: [README principal](../README.md). Instalación, arquitectura, variables y scripts: [desarrollo y configuración](desarrollo.md). Aplicación web: [apps/web/README.md](../apps/web/README.md).

## Base de datos

- [PostgreSQL](postgresql.md): puesta en marcha, migraciones, tipos, variables, despliegue y recuperación.

## Producto

- [Checklist de publicación y Estado del inmueble](producto-checklist-y-estado.md): EstateForge registra dónde se publica cada anuncio, pero no publica; validación de enlaces, Estado comercial y requisitos.

- [Galería del inmueble, cartel y vídeo del anuncio](producto-galeria-cartel-video.md): hasta 50 fotografías por inmueble con miniaturas, seis plantillas de cartel y «Aleatoria», vídeo de hasta 25 fotografías con sonido (pistas originales o biblioteca personal), duración en la cabecera, regeneración segura e independiente, límites y cuotas, caché revalidada, compatibilidad comprobada, procedencia del audio, evaluación y limitaciones; subidas y descargas directas con URL firmada y orden de las fotografías del vídeo (DA-46 a DA-64).

- [Catálogo de proveedores de IA](proveedores-ia.md): 15 proveedores (API directas y agregadores) para texto, imagen y vídeo, con fabricante, capacidades, límites, precios con su fuente, clasificador de seguridad, conexiones múltiples, estado de integración de cada uno de los 65 modelos, diagnóstico de conexiones, pruebas reales controladas, las seis pruebas propuestas con su desglose de coste, logotipos con su procedencia y licencia, y lo que no se ha integrado (DA-82 a DA-93). Verificado documentalmente y con pruebas de contrato por modelo; ningún proveedor validado todavía contra su servicio real.
- [IA solo con la API key de cada usuario (BYOK obligatorio)](producto-ia-byok.md): EstateForge no aporta claves de IA; textos, carteles, vídeos y moderación usan la clave del usuario (DA-77). Catálogo y precios de OpenAI y Gemini verificados en su documentación oficial el 12/11/2026 (DA-78). Proveedores y modelos, configuración y cifrado de las API keys, cartel y vídeo con IA, trabajos asíncronos, moderación en tres capas, privacidad, costes, límites, cuenta evaluadora y limitaciones (DA-67 a DA-76). Probado en local con el simulador; Gemini, pendiente de verificar con una clave real.

## Seguridad

- [Protección por incidente y su versionado](seguridad/proteccion-por-incidente.md): estados de bloqueo de una cuenta, flujo de un incidente, retirada administrativa, contador `securityHoldVersion`, migración, pruebas y limitaciones.
- [Recuperación obligatoria tras un incidente](seguridad/recuperacion-obligatoria.md): destino de recuperación, tokens `SELF_SERVICE` y `SECURITY_RECOVERY`, retirada con recuperación obligatoria, finalización en `/recuperar-cuenta`, solicitud de un enlace nuevo en `/recuperar-cuenta/solicitar`, auditoría y gestión de la recuperación desde el panel de administración (retirar la protección, corregir el destino y reenviar el enlace), errores, pruebas y riesgos.
- [Verificación del email](seguridad/verificacion-email.md): estado `emailVerifiedAt` y su relación con el cambio de email y con E2, tokens de un solo uso, política por fechas y periodo de gracia, avisos de la web y sincronización con `/me`, registro, verificación en `/verificar-email`, reenvío, envíos y fallos de SMTP por flujo, límites por cuenta y por IP, respuestas genéricas y errores HTTP, concurrencia y rollback (qué está demostrado y qué no), cuestiones pendientes y cómo probar el envío.
- [Dependencias de construcción de la web y picomatch](seguridad/dependencias-de-construccion.md): por qué `@tailwindcss/vite` es una dependencia de desarrollo, por qué GHSA-fc5q-39xc-vjpf no llega al navegador ni a la API y riesgo residual en las herramientas de construcción.

## Despliegue

- [Despliegue en Vercel (Hobby), Neon (Free) y Vercel Blob](despliegue/vercel-neon-blob.md): estado actual (comprobado en producción y pendiente), arquitectura con la API bajo el mismo dominio, variables, construcción y migraciones, cuotas, comprobaciones y procedimiento. Publicado en producción; Blob real comprobado con datos sintéticos (incluidas cuota con solicitudes simultáneas de reserva y caducidades), MP4 con sonido escuchado y WebM confirmado manualmente por el titular en Firefox. Pendientes: la ejecución programada del cron (19 y 20/11/2026), los casos aún no probados de Blob (renovación de la delegación de 2 h, caducidad de URLs de audio y vídeo), IA con claves reales y dispositivos físicos. MD-4 y Safari, fuera de alcance (riesgo aceptado).

- [Verificación remota](despliegue/verificacion-remota.md): matriz priorizada de comprobaciones en producción, con datos sintéticos, pasos, resultado esperado y limpieza. Cubre el mantenimiento diario (constancia en `MaintenanceRun`), el contrato real de Vercel Blob (sobrescritura, tipo, tamaño, caducidad, reutilización de URLs, Range, caché, CORS, cuota concurrente y borrado efectivo), la IP del cliente (MD-4), el aislamiento entre cuentas y la multimedia. Resultados del 18/11/2026: mantenimiento manual y Blob hechos (algunas filas con alcance acotado), aislamiento en una muestra, MD-4 como riesgo aceptado fuera de alcance; MP4 y WebM confirmados manualmente por el titular; pendientes la ejecución programada del cron, los casos de Blob no probados y los dispositivos físicos.

- [Indexación y Google Search Console](despliegue/search-console.md): qué se indexa y cómo (página pública estática, `noindex` en la aplicación, `robots.txt`, mapa del sitio y canónica), comprobaciones tras el despliegue y alta de la propiedad. Cabeceras y mapa del sitio comprobados en producción; propiedad verificada y mapa del sitio procesado; la portada aún no está indexada.

- [Fase 0 — Checklist y procedimiento de despliegue (v6)](despliegue/fase0_checklist_despliegue_v6.md): procedimiento y condiciones para desplegar la verificación del email de la Fase 0. No autoriza ninguna integración ni despliegue y no está aprobado para producción; la limitación L-2 sigue abierta.

## Publicación y licencia

- [Política de mensajes de commit](commit-message-policy.md): Conventional Commits en inglés, sin atribución a herramientas de IA, comprobada en CI.
- [Normalización del historial antes de la versión 1.0.0](release/history-rewrite.md): procedimiento, comprobaciones y [correspondencia de mensajes](release/commit-message-map.json).
- [Notas de la versión 1.0.0](release/v1.0.0.md) y [registro de cambios](../CHANGELOG.md).
- [Licencia](../LICENSE) (propietaria), [avisos de terceros](../THIRD_PARTY_NOTICES.md) e [inventario de dependencias](legal/dependency-licenses.json); [contribuciones](../CONTRIBUTING.md) y [seguridad](../SECURITY.md).
