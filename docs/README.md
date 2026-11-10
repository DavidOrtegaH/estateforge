# Documentación de EstateForge

Instalación, configuración, variables de entorno y scripts: [README principal](../README.md). Aplicación web: [apps/web/README.md](../apps/web/README.md).

## Producto

- [Checklist de publicación y Estado del inmueble](producto-checklist-y-estado.md): EstateForge registra dónde se publica cada anuncio, pero no publica; validación de enlaces, Estado comercial y requisitos.

## Seguridad

- [Protección por incidente y su versionado](seguridad/proteccion-por-incidente.md): estados de bloqueo de una cuenta, flujo de un incidente, retirada administrativa, contador `securityHoldVersion`, migración, pruebas y limitaciones.
- [Recuperación obligatoria tras un incidente](seguridad/recuperacion-obligatoria.md): destino de recuperación, tokens `SELF_SERVICE` y `SECURITY_RECOVERY`, retirada con recuperación obligatoria, finalización en `/recuperar-cuenta`, solicitud de un enlace nuevo en `/recuperar-cuenta/solicitar`, auditoría y gestión de la recuperación desde el panel de administración (retirar la protección, corregir el destino y reenviar el enlace), errores, pruebas y riesgos.
- [Verificación del email](seguridad/verificacion-email.md): estado `emailVerifiedAt` y su relación con el cambio de email y con E2, tokens de un solo uso, política por fechas y periodo de gracia, avisos de la web y sincronización con `/me`, registro, verificación en `/verificar-email`, reenvío, envíos y fallos de SMTP por flujo, límites por cuenta y por IP, respuestas genéricas y errores HTTP, concurrencia y rollback (qué está demostrado y qué no), cuestiones pendientes y cómo probar el envío.

## Despliegue

- [Fase 0 — Checklist y procedimiento de despliegue (v6)](despliegue/fase0_checklist_despliegue_v6.md): procedimiento y condiciones para desplegar la verificación del email de la Fase 0. No autoriza ninguna integración ni despliegue y no está aprobado para producción; la limitación L-2 sigue abierta.
