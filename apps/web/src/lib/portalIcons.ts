import type { PublicationPlatformId } from '@estateforge/shared'

// Iconos identificativos de los portales en la checklist (actualización de DA-102).
//
// Los iconos se sirven como archivos LOCALES con procedencia y situación de derechos documentadas.
// Nunca se piden imágenes remotas al abrir la checklist ni se usan servicios de favicons, y no se dibujan
// imitaciones de los logotipos. Si falta un recurso o no carga, se usa Globe y se conserva el nombre.
//
// El titular de EstateForge ha pedido expresamente usar los cinco recursos y no enviar solicitudes.
// Esa instrucción no se presenta como una autorización de los portales ni como una licencia libre.
// Idealista: símbolo ID del kit oficial. Fotocasa, Habitaclia y Yaencontre: favicons oficiales.
// Pisos.com: favicon actual enlazado por su propia web, sustituye al logotipo textual de Commons.
// Procedencia completa y avisos: /portales/NOTICE.txt y docs/producto-checklist-y-estado.md.

export interface PortalIconAsset {
  /** Ruta local servida por la propia web (empieza por «/» o es un import de Vite). Nunca una URL remota. */
  src: string
  /** Procedencia: página oficial o documento del que se obtuvo el archivo. */
  source: string
  /** Licencia o situación de derechos documentada; no implica permiso de los titulares de las marcas. */
  terms: string
  /** Fecha de obtención (AAAA-MM-DD). */
  retrievedAt: string
  /** Placa horizontal para conservar un logotipo textual completo y legible. */
  presentation?: 'wordmark'
  /** Tamaño nativo para favicons pequeños; evita ampliar el archivo oficial de 16 px. */
  size?: 16
}

export const PORTAL_ICONS: Partial<Record<PublicationPlatformId, PortalIconAsset>> = {
  idealista: {
    src: '/portales/idealista.png',
    source: 'https://www.idealista.com/sala-de-prensa/materiales/',
    terms: 'Símbolo ID.png del kit oficial; archivo sin modificar. Marca y recurso de su titular, sin licencia libre declarada. Uso identificativo solicitado por el titular de EstateForge. Procedencia y aviso: /portales/NOTICE.txt.',
    retrievedAt: '2026-11-19',
  },
  fotocasa: {
    src: '/portales/fotocasa.png',
    source: 'https://frtassets.fotocasa.es/statics/img/favicon-96x96.png',
    terms: 'Favicon enlazado por la web oficial de Fotocasa; archivo sin modificar. Derechos de su titular, sin licencia libre declarada. Procedencia y aviso: /portales/NOTICE.txt.',
    retrievedAt: '2026-11-19',
  },
  pisos: {
    src: '/portales/pisos.png',
    source: 'https://statics.imghs.net/dist/img/favicon/favicon-48x48.png',
    terms: 'Favicon enlazado por la web oficial de Pisos.com; archivo sin modificar. Derechos de su titular, sin licencia libre declarada. Procedencia y aviso: /portales/NOTICE.txt.',
    retrievedAt: '2026-11-19',
  },
  yaencontre: {
    src: '/portales/yaencontre.ico',
    source: 'https://www.yaencontre.com/favicon.ico',
    terms: 'Favicon servido por el dominio oficial de Yaencontre; archivo sin modificar. Derechos de su titular, sin licencia libre declarada. Procedencia y aviso: /portales/NOTICE.txt.',
    retrievedAt: '2026-11-19',
    size: 16,
  },
  habitaclia: {
    src: '/portales/habitaclia.png',
    source: 'https://assets.gw.habitaclia.com/statics/favicon-96x96.png',
    terms: 'Favicon enlazado por la web oficial de Habitaclia; archivo sin modificar. Derechos de su titular, sin licencia libre declarada. Procedencia y aviso: /portales/NOTICE.txt.',
    retrievedAt: '2026-11-19',
  },
}

/** Icono de un portal o null si no hay ninguno incorporado (se usa el genérico). */
export function portalIconFor(platform: PublicationPlatformId | null, icons: Partial<Record<PublicationPlatformId, PortalIconAsset>> = PORTAL_ICONS): PortalIconAsset | null {
  return platform ? (icons[platform] ?? null) : null
}
