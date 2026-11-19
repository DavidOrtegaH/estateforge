/**
 * Checklist de publicación: catálogo de portales y validación de enlaces.
 *
 * EstateForge no publica en los portales: el usuario publica desde cada
 * plataforma y aquí registra dónde lo ha hecho. Este módulo es la única
 * fuente de criterio y lo usan tanto la web como la API.
 *
 * La validación es solo local: nunca visita el enlace ni resuelve
 * redirecciones. Confirma la estructura de la URL y, en los portales del
 * catálogo, que su dominio les corresponde; no que el anuncio exista.
 */

/**
 * Para añadir, cambiar o retirar un portal basta con editar esta lista.
 * `domains` contiene los dominios registrables; se admiten sus subdominios.
 * Los portales se identifican por su nombre y sus recursos locales, con procedencia y situación de
 * derechos documentadas en apps/web/src/lib/portalIcons.ts y docs/producto-checklist-y-estado.md.
 * El usuario ha solicitado incluir los cinco iconos sin enviar solicitudes a terceros (actualiza DA-102).
 */
export const PUBLICATION_PLATFORMS = [
  {
    id: 'idealista',
    name: 'Idealista',
    homeUrl: 'https://www.idealista.com/',
    domains: ['idealista.com'],
  },
  {
    id: 'fotocasa',
    name: 'Fotocasa',
    homeUrl: 'https://www.fotocasa.es/',
    domains: ['fotocasa.es'],
  },
  {
    id: 'pisos',
    name: 'Pisos.com',
    homeUrl: 'https://www.pisos.com/',
    domains: ['pisos.com'],
  },
  {
    id: 'yaencontre',
    name: 'Yaencontre',
    homeUrl: 'https://www.yaencontre.com/',
    domains: ['yaencontre.com'],
  },
  {
    id: 'habitaclia',
    name: 'Habitaclia',
    homeUrl: 'https://www.habitaclia.com/',
    domains: ['habitaclia.com'],
  },
] as const

export type PublicationPlatformId =
  (typeof PUBLICATION_PLATFORMS)[number]['id']

export const PUBLICATION_PLATFORM_IDS =
  PUBLICATION_PLATFORMS.map(
    (platform) => platform.id,
  ) as [
    PublicationPlatformId,
    ...PublicationPlatformId[],
  ]

/** Filas «Otro/a»: plataformas fuera del catálogo, con varias instancias por anuncio. */
export const OTHER_PLATFORM_ID = 'other'
export const OTHER_PLATFORM_LABEL = 'Otro/a'
export const MAX_OTHER_PUBLICATIONS = 5
export const OTHER_NAME_MAX_LENGTH = 80

/** Acortadores conocidos: su destino no se puede comprobar sin visitarlos. */
export const URL_SHORTENER_DOMAINS = [
  'bit.ly',
  'bitly.com',
  'tinyurl.com',
  't.co',
  'goo.gl',
  'ow.ly',
  'is.gd',
  'v.gd',
  'buff.ly',
  'cutt.ly',
  'rebrand.ly',
  'shorturl.at',
  'rb.gy',
  'tiny.cc',
  't.ly',
  's.id',
  'lnkd.in',
] as const

export const PUBLICATION_URL_MAX_LENGTH = 2048

export type PublicationUrlStatus =
  | 'valid'
  | 'empty'
  | 'invalid'
  | 'wrong-domain'
  | 'unverifiable'

export type PublicationUrlCode =
  | 'VALID'
  | 'EMPTY'
  | 'TOO_LONG'
  | 'MALFORMED'
  | 'MISSING_PROTOCOL'
  | 'UNSAFE_PROTOCOL'
  | 'INSECURE_PROTOCOL'
  | 'CREDENTIALS'
  | 'PORT'
  | 'INVALID_HOST'
  | 'SHORTENER'
  | 'WRONG_PLATFORM'
  | 'DOMAIN_MISMATCH'

export interface PublicationUrlResult {
  status: PublicationUrlStatus
  code: PublicationUrlCode
  message: string
  /** Solo si status es 'valid'. Es el único valor que debe guardarse o enlazarse. */
  normalizedUrl?: string
}

export const SHORTENED_URL_MESSAGE =
  'Este enlace está acortado y no podemos comprobar a qué plataforma dirige. Introduce el enlace directo de la publicación.'

/**
 * Compara por límites de dominio: `host` debe ser el dominio o un subdominio
 * suyo. `idealista.com.otrodominio.com` y `falsoidealista.com` no coinciden.
 */
export function hostMatchesDomain(
  host: string,
  domain: string,
): boolean {
  return (
    host === domain ||
    host.endsWith(`.${domain}`)
  )
}

function matchesAnyDomain(
  host: string,
  domains: readonly string[],
): boolean {
  return domains.some((domain) =>
    hostMatchesDomain(host, domain),
  )
}

function rejected(
  code: PublicationUrlCode,
  message: string,
): PublicationUrlResult {
  return { status: 'invalid', code, message }
}

function wrongDomain(
  code: PublicationUrlCode,
  message: string,
): PublicationUrlResult {
  return {
    status: 'wrong-domain',
    code,
    message,
  }
}

const MALFORMED_MESSAGE =
  'El enlace no tiene un formato válido. Cópialo completo desde la barra de direcciones.'

type ParsedWebUrl =
  | { url: URL; host: string }
  | { failure: PublicationUrlResult }

/**
 * Comprobaciones comunes a cualquier enlace web: estructura, protocolo http(s),
 * sin credenciales y con un host identificable.
 */
function parseWebUrl(
  rawUrl: string,
  emptyMessage: string,
  allowPort: boolean,
): ParsedWebUrl {
  const input = rawUrl.trim()

  if (input === '') {
    return {
      failure: {
        status: 'empty',
        code: 'EMPTY',
        message: emptyMessage,
      },
    }
  }

  if (
    input.length >
    PUBLICATION_URL_MAX_LENGTH
  ) {
    return {
      failure: rejected(
        'TOO_LONG',
        `El enlace no puede superar los ${PUBLICATION_URL_MAX_LENGTH} caracteres.`,
      ),
    }
  }

  // El parser estándar corrige espacios, controles y barras invertidas;
  // aquí se rechazan para no aceptar una dirección distinta de la escrita.
  // eslint-disable-next-line no-control-regex
  if (/[\s\\\u0000-\u001f\u007f]/.test(input)) {
    return {
      failure: rejected(
        'MALFORMED',
        MALFORMED_MESSAGE,
      ),
    }
  }

  const scheme =
    /^([a-z][a-z0-9+.-]*):/i.exec(input)?.[1]?.toLowerCase()

  if (!scheme) {
    return {
      failure: rejected(
        'MISSING_PROTOCOL',
        'Falta el protocolo. El enlace debe empezar por https://.',
      ),
    }
  }

  if (scheme !== 'https' && scheme !== 'http') {
    return {
      failure: rejected(
        'UNSAFE_PROTOCOL',
        'Este tipo de enlace no está permitido. Introduce una dirección que empiece por https://.',
      ),
    }
  }

  // El parser también aceptaría «https:dominio» y «https:///dominio».
  if (!/^https?:\/\/[^/]/i.test(input)) {
    return {
      failure: rejected(
        'MALFORMED',
        MALFORMED_MESSAGE,
      ),
    }
  }

  let url: URL

  try {
    url = new URL(input)
  } catch {
    return {
      failure: rejected(
        'MALFORMED',
        MALFORMED_MESSAGE,
      ),
    }
  }

  // Se mira también el texto original: «https://@host» deja vacío username.
  const authority = input
    .slice(input.indexOf('//') + 2)
    .split(/[/?#]/, 1)[0]

  if (
    url.username !== '' ||
    url.password !== '' ||
    authority.includes('@')
  ) {
    return {
      failure: rejected(
        'CREDENTIALS',
        'El enlace no puede incluir usuario ni contraseña.',
      ),
    }
  }

  if (!allowPort && url.port !== '') {
    return {
      failure: rejected(
        'PORT',
        'El enlace no puede indicar un puerto. Usa la dirección habitual del portal.',
      ),
    }
  }

  const host = url.hostname.toLowerCase()

  if (
    !host.includes('.') ||
    host.endsWith('.') ||
    host.startsWith('[') ||
    /^\d+(\.\d+){3}$/.test(host)
  ) {
    return {
      failure: rejected(
        'INVALID_HOST',
        'La dirección del enlace no es válida. Debe incluir un dominio reconocible.',
      ),
    }
  }

  return { url, host }
}

/**
 * Valida un enlace para un portal del catálogo.
 *
 * Solo se aceptan enlaces https. El puerto 443 explícito equivale a no indicar
 * puerto y desaparece al normalizar; cualquier otro se rechaza.
 */
export function validatePublicationUrl(
  platformId: PublicationPlatformId,
  rawUrl: string,
): PublicationUrlResult {
  const platform =
    PUBLICATION_PLATFORMS.find(
      (candidate) =>
        candidate.id === platformId,
    )

  if (!platform) {
    return rejected(
      'DOMAIN_MISMATCH',
      'La plataforma indicada no existe.',
    )
  }

  const parsed = parseWebUrl(
    rawUrl,
    `Falta introducir el enlace de la publicación en ${platform.name}.`,
    false,
  )

  if ('failure' in parsed) {
    return parsed.failure
  }

  const { url, host } = parsed

  if (
    matchesAnyDomain(
      host,
      URL_SHORTENER_DOMAINS,
    )
  ) {
    return {
      status: 'unverifiable',
      code: 'SHORTENER',
      message: SHORTENED_URL_MESSAGE,
    }
  }

  if (url.protocol !== 'https:') {
    return rejected(
      'INSECURE_PROTOCOL',
      'El enlace debe usar una conexión segura y empezar por https://.',
    )
  }

  if (
    matchesAnyDomain(host, platform.domains)
  ) {
    return {
      status: 'valid',
      code: 'VALID',
      message: `El dominio corresponde a ${platform.name}. EstateForge no comprueba si el anuncio existe o sigue publicado.`,
      normalizedUrl: url.href,
    }
  }

  const otherPlatform =
    PUBLICATION_PLATFORMS.find(
      (candidate) =>
        candidate.id !== platform.id &&
        matchesAnyDomain(
          host,
          candidate.domains,
        ),
    )

  if (otherPlatform) {
    return wrongDomain(
      'WRONG_PLATFORM',
      `Este enlace es de ${otherPlatform.name}, no de ${platform.name}.`,
    )
  }

  return wrongDomain(
    'DOMAIN_MISMATCH',
    `Este enlace no pertenece a ${platform.name}. Introduce la dirección de tu anuncio en ese portal.`,
  )
}

/**
 * Valida una dirección de una fila «Otro/a»: admite cualquier dominio, también
 * acortadores y puertos, porque no hay portal con el que compararla. Acepta
 * http y https y exige un destino identificable.
 */
export function validateOtherUrl(
  rawUrl: string,
): PublicationUrlResult {
  const parsed = parseWebUrl(
    rawUrl,
    'Falta introducir el enlace.',
    true,
  )

  if ('failure' in parsed) {
    return parsed.failure
  }

  return {
    status: 'valid',
    code: 'VALID',
    message:
      'El formato del enlace es correcto. EstateForge no comprueba si el destino existe o sigue publicado.',
    normalizedUrl: parsed.url.href,
  }
}
