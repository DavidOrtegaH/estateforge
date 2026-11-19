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

**Archivos demasiado grandes para la API.** Para que fotografías y vídeos no atraviesen las funciones del servidor, preparé transferencias directas al almacenamiento con URLs firmadas, límites y caducidad. La API valida el archivo antes de asociarlo al inmueble. En producción, con el almacenamiento privado real y datos ficticios, se ha comprobado el flujo completo (fotografías, miniaturas, cartel y vídeo MP4) y los límites principales: sin sobrescritura, tamaño firmado, validación del contenido real, descargas parciales, límites por inmueble y por usuario, y borrado sin objetos huérfanos. También se comprobó que 40 solicitudes simultáneas de reserva de espacio (el paso previo a una subida; no se transfirieron 40 archivos) no superan la cuota de una cuenta: se aceptaron 25 reservas, que suman exactamente 100 MiB, 15 se rechazaron por cuota y las 25 aceptadas se cancelaron después. También se comprobó que una subida no completada caduca a los 15 minutos y que los enlaces temporales de las fotografías dejan de funcionar al vencer y se renuevan. Lo que queda abierto está en la [verificación remota](docs/despliegue/verificacion-remota.md).

**Material publicitario en el navegador.** Compuse los carteles con Canvas y los vídeos con MediaRecorder. Como cada navegador admite formatos distintos, la aplicación elige entre MP4 y WebM según sus capacidades. Así se genera material en Edge, Chrome y Firefox sin claves de IA.

**Pantallas pequeñas.** El formulario de generación recortaba campos en algunos anchos. Ajusté su distribución y comprobé la geometría en varios navegadores y tamaños. En producción, la portada se ha revisado a 320 píxeles sin desbordamiento horizontal.

**Pruebas que pasaban en Windows y fallaban en Linux.** El primer CI reveló dependencias del orden de los títulos, del recuento global de conexiones y de la forma de los errores de red. Corregí las comparaciones y el tratamiento de PostgreSQL inaccesible, y descubrí un problema de fechas: ahora cada conexión trabaja en UTC para que las caducidades no dependan de la zona horaria del servidor.

**Una portada indexable y una carga inicial más ligera.** Separé una portada pública estática del panel privado y cargué las páginas de la aplicación bajo demanda: el paquete inicial pasó de unos 858 kB a 350 kB. La portada tiene contenido indexable y un mapa del sitio sin exponer inmuebles ni cuentas.

**Una construcción correcta con una API que no arrancaba.** En Vercel la construcción terminaba bien, pero la API fallaba al recibir peticiones: el paquete compartido exportaba TypeScript sin compilar y el detector de Vercel elegía como entrada la factoría de pruebas en lugar del servidor. Ahora el paquete compartido se compila a JavaScript (y se comprueba con Node antes de terminar la construcción) y la entrada de la API es explícita.

**Correos en segundo plano.** Algunos correos se envían sin que la respuesta los espere, para no revelar si una cuenta existe. Como la plataforma puede congelar la función tras responder, esos envíos se registran con `waitUntil`.

**Borrar un inmueble.** En producción el borrado fallaba con un mensaje genérico: la petición `DELETE` declaraba un cuerpo JSON que no enviaba y el servidor la rechazaba antes de llegar a la ruta. Lo corregí, añadí una prueba de regresión sobre HTTP real y, tras desplegarlo, el borrado desde la interfaz funciona.

**Volver al login tras cambiar la contraseña.** Después de restablecerla, la página se quedaba en el formulario. Ahora redirige al inicio de sesión; está cubierto por pruebas del enrutado y confirmado en producción.

**Limpieza de archivos y subidas a la vez.** Al auditar el mantenimiento diario reproduje con PostgreSQL real dos carreras:

- si el plazo de una subida vencía mientras se confirmaba, la limpieza podía borrar el archivo a mitad de la validación;
- dos limpiezas simultáneas contaban como fallos los archivos que ya había borrado la otra.

Las corregí con pruebas que fuerzan esos cruces. Como en el plan gratuito los registros solo duran una hora, cada ejecución del mantenimiento deja ahora constancia en la base de datos, sin datos personales: así se puede acreditar después que la ejecución programada ocurrió.

**Aislamiento entre cuentas.** Añadí pruebas con dos cuentas ficticias que llaman a todas las rutas con los identificadores de la otra cuenta y comparan cada rechazo con el de un identificador inexistente. No apareció ninguna fuga. Una ruta respondía con un error interno en lugar de «no encontrado»; ahora responde 404. En producción, una muestra con dos cuentas confirmó las mismas respuestas.

## Estado

- La web y la API están publicadas en Vercel y la base de datos en Neon. La versión desplegada incluye las correcciones de la limpieza de archivos, la constancia del mantenimiento y el aislamiento entre cuentas, y su [CI en GitHub](https://github.com/DavidOrtegaH/estateforge/actions/runs/44338627147) pasó.
- Comprobado en producción con datos ficticios: registro y verificación por correo, recuperación de contraseña con vuelta al login, inicio de sesión y eliminación de la cuenta; inmuebles, fotografías, carteles y vídeos MP4 en el almacenamiento privado, con sus límites, la cuota con reservas de subida simultáneas y la caducidad de subidas y enlaces; aislamiento entre cuentas en una muestra; y una ejecución manual del mantenimiento diario. Los datos de prueba se borraron después.
- Vídeo con música: el titular escuchó en su equipo un MP4 generado en producción con «Piano sereno» y el sonido se oye bien, sin cortes evidentes. Es una comprobación manual de ese archivo, no una prueba automática.
- Vídeo WebM: el titular lo generó en producción con Firefox y confirmó que aparece como WebM, que se escucha bien y que después se borró todo. Una comprobación posterior de la base de datos y del almacenamiento no encontró restos. Es una confirmación manual, no una prueba automática ni un análisis del archivo.
- Google Search Console: propiedad verificada y mapa del sitio procesado. La portada aún no está indexada.
- Pendiente: la ejecución automática del mantenimiento diario, que se revisará el 19 y el 20 de noviembre; proveedores de IA con claves reales; dispositivos físicos y los casos que aún no se han probado (detalle en la guía). Los correos pueden llegar a spam.
- Limitaciones aceptadas, que no se probarán: Safari no se ha validado, así que no se promete que funcione en él, aunque se mantiene el soporte existente. La IP de cada visitante solo se midió desde una red; por eso el límite de peticiones sigue contando por la conexión interna y no por visitante, y las peticiones que llegan por la reescritura pueden compartir cupo. Es un riesgo aceptado, no resuelto: no se ha probado desde dos redes ni con cabeceras suplantadas.

Detalle de lo comprobado y lo pendiente en la [guía de despliegue](docs/despliegue/vercel-neon-blob.md#estado-actual).

**Cambios incluidos en la actualización del 19/11/2026:**

Publicados en Vercel (web y API). El [CI completo](https://github.com/DavidOrtegaH/estateforge/actions/runs/44567916015) pasó sobre `a385201`. Se comprobó en producción la landing, sus temas y tamaños, los cinco archivos de iconos y la disponibilidad de la API. La validación funcional del inglés indicada debajo corresponde al entorno local; no se repitió el flujo autenticado en producción.

1. **Anuncios en inglés sin IA: implementado y verificado en local.** Con «Plantilla local (sin IA)» e inglés, el anuncio, el cartel (las seis plantillas y «Aleatoria») y el vídeo clásico salen en inglés, a partir de los datos del inmueble. Las observaciones escritas en español no se traducen; se avisa para añadir su versión inglesa editando el anuncio. Comprobado con las pruebas automáticas, con PostgreSQL real y en Edge, inspeccionando el cartel y el vídeo descargados (con sonido). Detalle en [galería, cartel y vídeo](docs/producto-galeria-cartel-video.md#idioma-del-cartel-y-del-vídeo) y en [IA con la clave de cada usuario](docs/producto-ia-byok.md).
2. **Iconos de los portales en la checklist: los cinco incorporados.** Idealista, Fotocasa, Pisos.com, Yaencontre y Habitaclia muestran sus recursos originales junto al nombre, con servicio local y respaldo genérico si falla una imagen. «Otro/a» mantiene el icono genérico. Se ha sustituido el logotipo textual de Pisos.com por su favicon oficial cuadrado. No se han enviado solicitudes, por instrucción del usuario. Procedencia y situación de derechos en la [checklist de publicación](docs/producto-checklist-y-estado.md#identificación-de-los-portales) y en los avisos de terceros.

3. **Limitaciones fuera del alcance de estos cambios:**
   - la validación de coherencia no revisa los textos ingleses que redacte un proveedor de IA;
   - el material en inglés no se ha probado en Safari, Chrome ni Firefox, solo en Edge.

## Tecnología y documentación

React y Vite en la interfaz; Fastify en la API; TypeScript y PostgreSQL con Prisma. Los archivos se guardan fuera de la base de datos.

- [Desarrollo y configuración](docs/desarrollo.md): instalación local, arquitectura, variables y comandos.
- [Documentación del producto y seguridad](docs/README.md).
- [Despliegue en Vercel, Neon y Blob](docs/despliegue/vercel-neon-blob.md) y [registro de cambios](CHANGELOG.md).

## Licencia

Código propietario, con todos los derechos reservados. Se publica para su consulta, con los permisos exigidos por GitHub y las excepciones legales aplicables; no se concede permiso general de modificación, redistribución o explotación comercial. No se aceptan contribuciones externas.

Consulta la [licencia](LICENSE), los [avisos de terceros](THIRD_PARTY_NOTICES.md) y la [política de seguridad](SECURITY.md). Las licencias de los componentes de terceros se mantienen y se distribuyen con la aplicación.

**Corrección de idioma y orden, publicada en Vercel (19/11/2026).** Los rótulos de características del contenido y del texto copiado respetan el idioma del anuncio. El cartel y el vídeo no llevan pie de atribución a EstateForge. El idioma se puede rehacer con confirmación explícita, sustituyendo todos los textos y recomponiendo el material existente; se avisa de ediciones perdidas y del consumo de IA si el texto usa un proveedor. Los inmuebles y los anuncios, incluidos los de cada ficha, se ordenan de más reciente a más antiguo antes de paginar. El texto incrustado en una fotografía no se traduce: requiere una foto original sin esas letras.

CI del código publicado: [2389 pruebas de API, 715 web, 221 compartidas y 60 de scripts](https://github.com/DavidOrtegaH/estateforge/actions/runs/44577471938). El flujo completo de cambio de idioma y regeneración con música se comprobó en Edge con datos sintéticos locales; las comprobaciones públicas de producción y sus límites están en la [guía de despliegue](docs/despliegue/vercel-neon-blob.md#estado-actual).
