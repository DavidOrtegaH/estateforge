# EstateForge

**[Abrir EstateForge → estateforge-blush.vercel.app](https://estateforge-blush.vercel.app/)**

EstateForge es una aplicación web en español para organizar inmuebles y preparar sus anuncios: fotografías, textos, carteles, vídeos y seguimiento de dónde se ha publicado cada uno.

Es un proyecto personal y gratuito. El registro es público y exige verificar el email; los correos de la aplicación pueden llegar a la carpeta de spam, así que conviene revisarla.

## Qué puedes hacer

- Guardar, buscar y editar inmuebles, con sus características, precio y estado comercial.
- Organizar hasta 50 fotografías por inmueble, elegir la principal y cambiar su orden.
- Crear y editar textos de anuncios en español o inglés.
- Preparar carteles con seis plantillas y vídeos con fotografías, transiciones y música, sin servicios de IA.
- Anotar en qué portales has publicado cada anuncio y guardar sus enlaces. EstateForge no publica en esos portales.
- Opcionalmente, generar textos, imágenes o vídeos con IA usando tus propias claves, con confirmación del coste antes de cada operación. El consumo lo factura el proveedor que elijas.

## Cómo se usa

1. Regístrate, abre el enlace de verificación que recibes por correo (mira también en spam) e inicia sesión.
2. Crea un inmueble con sus datos y su estado comercial.
3. Sube las fotografías, elige la principal y ordénalas.
4. Prepara el texto del anuncio y crea un cartel o un vídeo a partir de las fotografías.
5. Descarga el material, publícalo en los portales que quieras y guarda sus enlaces en la checklist del anuncio.

Las funciones clásicas no necesitan claves de IA. Las conexiones opcionales se configuran en Ajustes; las claves se guardan cifradas y no vuelven a mostrarse en el navegador.

## Problemas que encontré, cómo los solucioné y qué conseguí

**Concurrencia y precisión de los datos.** Empecé con SQLite, pero la recuperación de cuentas y la checklist de publicación necesitaban controlar escrituras simultáneas, y los precios no podían perder precisión. Migré a PostgreSQL con bloqueos de fila, tipos decimales y restricciones en la base. Las pruebas de integración lo comprueban contra un PostgreSQL real.

**Claves y consumo de cada usuario.** El planteamiento inicial podía cargar el consumo a una clave de la aplicación. Lo cambié a un modelo en el que cada usuario aporta sus claves (BYOK), elige el proveedor y confirma las operaciones de pago. EstateForge no financia generaciones y las conexiones quedan aisladas por cuenta.

**Archivos demasiado grandes para la API.** Para que fotografías y vídeos no atraviesen las funciones del servidor, preparé transferencias directas al almacenamiento con URLs firmadas, límites y caducidad. La API valida el archivo antes de asociarlo al inmueble. Además de las pruebas con simulador, en producción se ha comprobado con el almacenamiento privado real una prueba acotada con datos ficticios: subida de fotografías, miniaturas, visor, foto principal y orden, y guardado de un cartel y un vídeo MP4. Otros casos siguen sin verificarse en real (ver [guía de despliegue](docs/despliegue/vercel-neon-blob.md#estado-actual)).

**Material publicitario en el navegador.** Compuse los carteles con Canvas y los vídeos con MediaRecorder. Como cada navegador admite formatos distintos, la aplicación elige entre MP4 y WebM según sus capacidades. Así se genera material en Edge, Chrome y Firefox sin claves de IA.

**Pantallas pequeñas.** El formulario de generación recortaba campos en algunos anchos. Ajusté su distribución y comprobé la geometría en varios navegadores y tamaños. En producción, la portada se ha revisado a 320 píxeles sin desbordamiento horizontal.

**Pruebas que pasaban en Windows y fallaban en Linux.** El primer CI reveló dependencias del orden de los títulos, del recuento global de conexiones y de la forma de los errores de red. Corregí las comparaciones y el tratamiento de PostgreSQL inaccesible, y descubrí un problema de fechas: ahora cada conexión trabaja en UTC para que las caducidades no dependan de la zona horaria del servidor.

**Una portada indexable y una carga inicial más ligera.** Separé una portada pública estática del panel privado y cargué las páginas de la aplicación bajo demanda: el paquete inicial pasó de unos 858 kB a 350 kB. La portada tiene contenido indexable y un mapa del sitio sin exponer inmuebles ni cuentas.

**Una construcción correcta con una API que no arrancaba.** En Vercel la construcción terminaba bien, pero la API fallaba al recibir peticiones: el paquete compartido exportaba TypeScript sin compilar y el detector de Vercel elegía como entrada la factoría de pruebas en lugar del servidor. Ahora el paquete compartido se compila a JavaScript (y se comprueba con Node antes de terminar la construcción) y la entrada de la API es explícita.

**Correos en segundo plano.** Algunos correos se envían sin que la respuesta los espere, para no revelar si una cuenta existe. Como la plataforma puede congelar la función tras responder, esos envíos se registran con `waitUntil`.

## Estado

- La web y la API están publicadas en Vercel y la base de datos en Neon. El registro, el correo de verificación, la recuperación de contraseña por correo y el inicio de sesión con la contraseña nueva se han comprobado en producción.
- Con una cuenta verificada y datos ficticios se ha comprobado en producción: crear un inmueble y su anuncio con la plantilla local (sin IA), subir fotografías al almacenamiento privado, ver miniaturas e imagen completa, cambiar la principal y el orden, y generar, guardar y descargar un cartel y un vídeo MP4 sin sonido.
- Una [ejecución completa del CI en GitHub](https://github.com/DavidOrtegaH/estateforge/actions/runs/44164287964) pasó (tipos, lint, pruebas con PostgreSQL real, builds y auditoría); se lanzó manualmente. Los últimos cambios de interfaz aún no han pasado por el CI.
- Borrar un inmueble falla en producción con un mensaje genérico. La causa está reproducida y corregida en el código, pero el arreglo aún no está desplegado ni comprobado.
- Pendiente: vídeo con audio (se generó y descargó un MP4 con pista musical; su estructura confirma pistas de vídeo y audio, pero no se ha escuchado) y WebM, descargas parciales, límites y caducidades en real, aislamiento entre cuentas en producción, proveedores de IA con claves reales, Safari y dispositivos físicos, y el alta en Google Search Console. Los correos pueden seguir llegando a spam.

Detalle de lo comprobado y lo pendiente en la [guía de despliegue](docs/despliegue/vercel-neon-blob.md#estado-actual).

## Tecnología y documentación

React y Vite en la interfaz; Fastify en la API; TypeScript y PostgreSQL con Prisma. Los archivos se guardan fuera de la base de datos.

- [Desarrollo y configuración](docs/desarrollo.md): instalación local, arquitectura, variables y comandos.
- [Documentación del producto y seguridad](docs/README.md).
- [Despliegue en Vercel, Neon y Blob](docs/despliegue/vercel-neon-blob.md) y [registro de cambios](CHANGELOG.md).

## Licencia

Código propietario, con todos los derechos reservados. Se publica para su consulta, con los permisos exigidos por GitHub y las excepciones legales aplicables; no se concede permiso general de modificación, redistribución o explotación comercial. No se aceptan contribuciones externas.

Consulta la [licencia](LICENSE), los [avisos de terceros](THIRD_PARTY_NOTICES.md) y la [política de seguridad](SECURITY.md). Las licencias de los componentes de terceros se mantienen y se distribuyen con la aplicación.
