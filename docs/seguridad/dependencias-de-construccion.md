# Dependencias de construcción de la web y GHSA-fc5q-39xc-vjpf (picomatch)

Revisión del 17/11/2026.

## Hallazgo

`pnpm audit --prod --audit-level high` informó de [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf): ReDoS en `picomatch` `<=4.0.7`. En esa fecha la última versión publicada en npm es la 4.0.7 y el aviso no indica ninguna versión corregida, así que no hay actualización posible. El único camino de producción era:

```
apps/web > @tailwindcss/vite > vite > (tinyglobby | fdir) > picomatch
```

## Uso real de `@tailwindcss/vite`

- Es un plugin de Vite y solo se importa en `apps/web/vite.config.ts`. Ningún archivo de `apps/web/src` lo usa.
- Declara `vite` como `peerDependency`; `vite`, que es quien trae `picomatch`, ya estaba en `devDependencies`.
- `picomatch`, `tinyglobby` y `fdir` no aparecen en `apps/web/dist`: no forman parte del código que se envía al navegador.
- La API (`apps/api`) solo los recibe a través de `vitest` (`devDependencies`); no se incluyen en su código de ejecución.

Por eso `@tailwindcss/vite` estaba mal clasificado: se ha movido a `devDependencies` de `apps/web` con la misma versión (`^4.3.3`, resuelta a 4.3.3) y el lockfile se ha regenerado con `pnpm install --lockfile-only`. No se ha añadido ninguna excepción (`auditConfig.ignoreGhsas` sigue conteniendo solo GHSA-ggr8-5vv4-36mx), ninguna `override` ni ninguna versión no publicada, y no se ha modificado el código de ningún paquete.

`tailwindcss`, `tw-animate-css` y `@fontsource-variable/*` se mantienen en `dependencies`: se importan desde el CSS y parte de su contenido (estilos base, utilidades, fuentes) sí acaba en el bundle, con sus avisos en `third-party-notices.txt`.

## Efecto en la construcción

La construcción de la web ya necesitaba las `devDependencies` (`vite`, `@vitejs/plugin-react`, `typescript`), así que el cambio no añade ningún requisito. Vercel instala las dependencias de desarrollo por defecto; si alguna vez se configurase una instalación solo de producción para la web, la construcción fallaría por `vite` antes que por este plugin.

## Riesgo residual

La vulnerabilidad sigue presente en las herramientas de desarrollo y construcción (`vite` 7 y 8, `vitest`) y aparece en `pnpm audit` sin `--prod`; no se oculta. Es un ReDoS: un patrón glob malicioso puede consumir CPU durante mucho tiempo. En este proyecto los patrones que llegan a `picomatch` los escriben la configuración de Vite y Vitest y el propio repositorio (por ejemplo, `fs.globSync('src/**/*.css')` en `vite.config.ts`), no los usuarios ni las peticiones HTTP. El riesgo se limita a:

- construir o probar con configuraciones, plugins o patrones de origen externo no revisados;
- el servidor de desarrollo de Vite expuesto a una red no confiable (no debe hacerse).

Si una herramienta del proyecto llegara a aceptar patrones glob de una fuente externa en tiempo de ejecución, esa exposición debería tratarse como real: validar o limitar los patrones antes de pasarlos a `picomatch` o evitar los globs con entrada externa.

## Seguimiento

- Cuando se publique una versión corregida de `picomatch`, actualizar el lockfile (o añadir una `override` dentro de la misma versión mayor, como las de `pnpm-workspace.yaml`).
- La auditoría completa (`pnpm audit --audit-level high`, sin `--prod`) muestra además otros avisos en herramientas de desarrollo (`tinypool` de `vitest`, `vite` 7 de `vitest` 3 y `zod` 3 de la CLI de `shadcn`), ajenos a este cambio y pendientes de revisión aparte.

## Actualización de Effect (20/11/2026)

El CI detectó GHSA-7589-6fvf-x4pw en Effect 3.20.0, dependencia transitiva del cargador de configuración de Prisma. Se fija Effect 3.22.1 mediante una override y se actualiza únicamente su resolución en el lockfile. No se añade ninguna excepción a la auditoría. La generación del cliente y las migraciones se verifican con esta resolución, además del CI completo.
