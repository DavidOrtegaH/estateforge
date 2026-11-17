# Documentación de EstateForge

Instalación, configuración, variables de entorno y scripts: [README principal](../README.md). Aplicación web: [apps/web/README.md](../apps/web/README.md).

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

## Despliegue

- [Preparación para Vercel (Hobby), Neon (Free) y Vercel Blob](despliegue/vercel-neon-blob.md): arquitectura con la API bajo el mismo dominio, variables, construcción y migraciones, cuotas, comprobaciones pendientes y procedimiento. Preparado, no desplegado ni verificado contra los servicios reales.

- [Fase 0 — Checklist y procedimiento de despliegue (v6)](despliegue/fase0_checklist_despliegue_v6.md): procedimiento y condiciones para desplegar la verificación del email de la Fase 0. No autoriza ninguna integración ni despliegue y no está aprobado para producción; la limitación L-2 sigue abierta.
