// Entrada de despliegue: evita que Vercel seleccione src/app.ts, que es una factoría para pruebas.
// El arranque, las rutas y el cierre ordenado siguen centralizados en el servidor existente.
import './src/server.js'
