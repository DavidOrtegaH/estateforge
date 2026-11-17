# EstateForge

EstateForge es una aplicación para organizar inmuebles y preparar sus anuncios: fotografías, textos, carteles, vídeos y seguimiento de publicación en portales. La interfaz está en español.

**Estado:** versión 1.0.1 publicada, con el CI de GitHub aprobado. El despliegue de la aplicación en Vercel está en preparación.

## Qué puedes hacer

- Guardar, buscar y editar inmuebles, con sus características, precio y estado comercial.
- Organizar hasta 50 fotografías por inmueble, elegir la principal y cambiar su orden.
- Crear y editar textos de anuncios en español o inglés.
- Preparar carteles con seis plantillas y vídeos con fotografías, transiciones y música, sin contratar servicios de IA.
- Anotar en qué portales has publicado cada anuncio y guardar sus enlaces. EstateForge no publica automáticamente en esos portales.
- Usar opcionalmente IA para generar textos, imágenes o vídeos, con tus propias claves y confirmación del coste antes de cada operación. El consumo lo factura el proveedor que elijas.

## Cómo se utiliza

1. Accede a tu cuenta y crea un inmueble con sus datos.
2. Añade las fotografías y selecciona la principal.
3. Prepara el texto del anuncio y revísalo; puedes editarlo a mano.
4. Elige una plantilla de cartel o compón un vídeo con las fotografías y el audio que prefieras.
5. Descarga el material y registra los enlaces de los portales donde lo publiques.

Las funciones clásicas no necesitan claves de IA. Las conexiones opcionales se configuran desde Ajustes; sus claves se guardan cifradas y no se muestran de nuevo en el navegador.

## Problemas encontrados, soluciones y resultados

**Concurrencia y datos precisos.** Empecé con SQLite, pero los flujos de recuperación de cuentas y publicación necesitaban controlar escrituras simultáneas y guardar los precios sin pérdida de precisión. Migré a PostgreSQL, con bloqueos de fila, tipos decimales y restricciones en la base. Las pruebas de integración comprueban estos comportamientos contra un PostgreSQL real.

**Separar las claves y el consumo de cada usuario.** El planteamiento inicial podía cargar consumo a una clave de la aplicación. Lo cambié por un modelo en el que cada usuario aporta sus claves, elige el proveedor y confirma las operaciones de pago. Ahora EstateForge no financia las generaciones y las conexiones quedan aisladas por cuenta.

**Fotografías y vídeos demasiado grandes para la API.** Para evitar que los archivos atraviesen las funciones del servidor, preparé transferencias directas al almacenamiento mediante URLs firmadas, con límites y caducidad. La API valida el archivo antes de asociarlo al inmueble. Los flujos están probados con un simulador; la comprobación del almacenamiento real forma parte del despliegue.

**Material publicitario sin depender de servicios externos.** Compuse los carteles con Canvas y los vídeos con MediaRecorder. Como los navegadores no admiten los mismos formatos, la aplicación elige entre MP4 y WebM según sus capacidades. Esto permite generar material clásico en Edge, Chrome y Firefox sin claves de IA.

**Selectores que se solapaban en pantallas pequeñas.** El formulario de generación recortaba campos en algunos anchos. Ajusté su distribución al espacio disponible y comprobé la geometría en varios navegadores y tamaños. La portada también se revisó entre 320 y 1440 píxeles para evitar desbordamientos.

**Pruebas que pasaban en Windows y fallaban en Linux.** El primer CI descubrió dependencias del orden de los títulos, del recuento global de conexiones y de la forma de los errores de red. Corregí las comparaciones y el tratamiento de PostgreSQL inaccesible. Al reproducirlo apareció además un problema con las fechas: ahora cada conexión trabaja en UTC para que las caducidades no cambien con la zona horaria del servidor. La versión 1.0.1 supera el CI completo en GitHub.

**Una portada privada y una carga inicial excesiva.** Separé una presentación pública estática del panel privado y cargué las páginas de la aplicación bajo demanda. La medida del paquete inicial pasó de unos 858 kB a 350 kB. La portada puede tener contenido indexable sin exponer los inmuebles ni los datos de las cuentas.

## Tecnología y validación

React y Vite en la interfaz; Fastify en la API; TypeScript y PostgreSQL con Prisma. Los archivos se almacenan fuera de la base de datos.

- [CI de GitHub](https://github.com/DavidOrtegaH/estateforge/actions): tipos, lint, pruebas, migraciones, build y auditoría de dependencias.
- Pruebas de integración con PostgreSQL real en Windows y Linux.
- Flujos de navegador comprobados en Edge, Chrome y Firefox de escritorio. Safari y móviles físicos siguen pendientes.
- Los proveedores de IA están probados con simuladores y contratos; todavía no se han validado con claves reales.

## Documentación

- [Desarrollo y configuración](docs/desarrollo.md): instalación local, arquitectura, variables y comandos.
- [Documentación del producto y seguridad](docs/README.md).
- [Despliegue en Vercel](docs/despliegue/vercel-neon-blob.md) y [registro de cambios](CHANGELOG.md).

## Licencia

Código propietario, con todos los derechos reservados. Se publica para su consulta, con los permisos exigidos por GitHub y las excepciones legales aplicables; no se concede permiso general de modificación, redistribución o explotación comercial. No se aceptan contribuciones externas.

Consulta la [licencia](LICENSE), los [avisos de terceros](THIRD_PARTY_NOTICES.md) y la [política de seguridad](SECURITY.md). Las licencias de los componentes de terceros se mantienen y se distribuyen con la aplicación.
