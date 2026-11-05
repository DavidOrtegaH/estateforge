# Documentación de EstateForge

Instalación, configuración, variables de entorno y scripts: [README principal](../README.md). Aplicación web: [apps/web/README.md](../apps/web/README.md).

## Seguridad

- [Protección por incidente y su versionado](seguridad/proteccion-por-incidente.md): estados de bloqueo de una cuenta, flujo de un incidente, retirada administrativa, contador `securityHoldVersion`, migración, pruebas y limitaciones.
- [Recuperación obligatoria tras un incidente](seguridad/recuperacion-obligatoria.md): destino de recuperación, tokens `SELF_SERVICE` y `SECURITY_RECOVERY`, retirada con recuperación obligatoria, finalización en `/recuperar-cuenta`, solicitud de un enlace nuevo en `/recuperar-cuenta/solicitar`, auditoría y gestión de la recuperación desde el panel de administración (retirar la protección, corregir el destino y reenviar el enlace), errores, pruebas y riesgos.
