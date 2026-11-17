// Entrada de despliegue: evita que Vercel seleccione src/app.ts, que es una factoría para pruebas.
// El arranque, las rutas y el cierre ordenado siguen centralizados en el servidor existente.
//
// Import directo de 'fastify' a propósito: el builder de Vercel para Fastify solo acepta como entrada
// un candidato (app, index, server, src/app, src/index, src/server) cuyo código fuente contenga una
// importación literal de 'fastify'. Sin esta línea descarta server.ts y elige src/app.ts, que no
// exporta un servidor ("Invalid export found in module ... src/app.js"). No lo elimines: lo comprueba
// src/vercel-entrypoint.test.ts.
import 'fastify'
import './src/server.js'
