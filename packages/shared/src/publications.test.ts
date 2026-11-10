import { describe, expect, it, vi } from 'vitest'

import {
  PUBLICATION_PLATFORMS,
  SHORTENED_URL_MESSAGE,
  URL_SHORTENER_DOMAINS,
  hostMatchesDomain,
  validateOtherUrl,
  validatePublicationUrl,
  type PublicationPlatformId,
} from './publications.js'

import {
  PropertyInputSchema,
  PropertyUpdateSchema,
  PublicationChecklistUpdateSchema,
} from './validation.js'

import {
  PROPERTY_COMMERCIAL_STATUSES,
} from './property.js'

import {
  commercialStatusLabels,
  getCommercialStatusLabel,
} from './labels.js'

const samples: Array<
  [PublicationPlatformId, string, string]
> = [
  ['idealista', 'idealista.com', 'https://www.idealista.com/inmueble/123456/'],
  ['fotocasa', 'fotocasa.es', 'https://www.fotocasa.es/es/comprar/vivienda/madrid/123'],
  ['pisos', 'pisos.com', 'https://www.pisos.com/comprar/piso-madrid-123/'],
  ['yaencontre', 'yaencontre.com', 'https://www.yaencontre.com/venta/piso/123'],
  ['habitaclia', 'habitaclia.com', 'https://www.habitaclia.com/comprar-piso-123.htm'],
]

const code = (
  platform: PublicationPlatformId,
  url: string,
) => validatePublicationUrl(platform, url).code

describe('catálogo de plataformas', () => {
  it('contiene las cinco plataformas iniciales con identificadores únicos', () => {
    expect(
      PUBLICATION_PLATFORMS.map((p) => p.name),
    ).toEqual([
      'Idealista',
      'Fotocasa',
      'Pisos.com',
      'Yaencontre',
      'Habitaclia',
    ])

    expect(
      new Set(PUBLICATION_PLATFORMS.map((p) => p.id)).size,
    ).toBe(5)
  })
})

describe.each(samples)(
  'validatePublicationUrl: %s',
  (platform, domain, sample) => {
    it('reconoce su dominio y devuelve la URL normalizada', () => {
      expect(
        validatePublicationUrl(platform, `  ${sample}  `),
      ).toMatchObject({
        status: 'valid',
        normalizedUrl: sample,
      })
    })

    it('admite su dominio raíz y subdominios legítimos', () => {
      expect(code(platform, `https://${domain}/a`)).toBe('VALID')
      expect(code(platform, `https://m.${domain}/a`)).toBe('VALID')
      expect(code(platform, `https://a.b.${domain}/a`)).toBe('VALID')
    })

    it('no distingue mayúsculas en el dominio', () => {
      expect(code(platform, `HTTPS://WWW.${domain.toUpperCase()}/a`)).toBe('VALID')
    })

    it.each([
      ['sufijo ajeno', (d: string) => `https://${d}.otrodominio.com/a`],
      ['dominio en la ruta', (d: string) => `https://otrodominio.com/${d}/a`],
      ['dominio en la consulta', (d: string) => `https://otrodominio.com/?u=${d}`],
      ['dominio en el fragmento', (d: string) => `https://otrodominio.com/#${d}`],
      ['prefijo pegado', (d: string) => `https://falso${d}/a`],
      ['guion pegado', (d: string) => `https://mi-${d}/a`],
      ['subdominio engañoso', (d: string) => `https://${d.replace('.', '-')}.com/a`],
      ['otro TLD', (d: string) => `https://${d.split('.')[0]}.net/a`],
    ])('rechaza %s', (_name, build) => {
      expect(
        validatePublicationUrl(platform, build(domain)),
      ).toMatchObject({
        status: 'wrong-domain',
        code: 'DOMAIN_MISMATCH',
      })
    })

    it('rechaza un homógrafo internacionalizado', () => {
      const lookalike = domain.replace(
        /[aoi]/,
        (letter) => ({ a: 'а', o: 'о', i: 'і' })[letter] ?? letter,
      )

      expect(
        validatePublicationUrl(platform, `https://${lookalike}/a`).status,
      ).toBe('wrong-domain')
    })

    it('rechaza http sin confundirlo con un dominio ajeno', () => {
      expect(code(platform, `http://${domain}/a`)).toBe('INSECURE_PROTOCOL')
    })

    it('rechaza credenciales y puertos', () => {
      expect(code(platform, `https://user:clave@${domain}/a`)).toBe('CREDENTIALS')
      expect(code(platform, `https://user@${domain}/a`)).toBe('CREDENTIALS')
      expect(code(platform, `https://@${domain}/a`)).toBe('CREDENTIALS')
      expect(code(platform, `https://${domain}:8443/a`)).toBe('PORT')
      expect(code(platform, `https://${domain}:80/a`)).toBe('PORT')
    })

    it('el puerto https explícito equivale a no indicarlo', () => {
      expect(
        validatePublicationUrl(platform, `https://${domain}:443/a`).normalizedUrl,
      ).toBe(`https://${domain}/a`)
    })
  },
)

describe('validatePublicationUrl: criterios generales', () => {
  it('cumple los ejemplos exigidos', () => {
    expect(code('idealista', 'https://www.idealista.com/inmueble/123456/')).toBe('VALID')
    expect(code('idealista', 'https://idealista.com.otrodominio.com/anuncio')).toBe('DOMAIN_MISMATCH')
    expect(code('idealista', 'https://otrodominio.com/idealista.com/anuncio')).toBe('DOMAIN_MISMATCH')
    expect(code('idealista', 'https://www.fotocasa.es/piso')).toBe('WRONG_PLATFORM')
    expect(code('fotocasa', 'https://www.fotocasa.es/piso')).toBe('VALID')
  })

  it('indica a qué portal pertenece un enlace cruzado', () => {
    expect(
      validatePublicationUrl('idealista', 'https://www.fotocasa.es/a').message,
    ).toBe('Este enlace es de Fotocasa, no de Idealista.')
  })

  it.each(['', '   ', '\t\n'])('trata %j como vacío', (url) => {
    expect(validatePublicationUrl('idealista', url)).toMatchObject({
      status: 'empty',
      code: 'EMPTY',
    })
  })

  it.each([
    'www.idealista.com/inmueble/1',
    'idealista.com',
    '//www.idealista.com/a',
    '/inmueble/1',
  ])('exige protocolo en %s', (url) => {
    expect(code('idealista', url)).toBe('MISSING_PROTOCOL')
  })

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,hola',
    'file:///etc/passwd',
    'vbscript:msgbox(1)',
    'ftp://www.idealista.com/a',
    'blob:https://www.idealista.com/a',
  ])('rechaza el protocolo de %s', (url) => {
    expect(code('idealista', url)).toBe('UNSAFE_PROTOCOL')
  })

  it.each([
    'https://',
    'https:/www.idealista.com/a',
    'https:www.idealista.com/a',
    'https:///www.idealista.com/a',
    'https://www idealista.com/a',
    'https://www.idealista.com/a b',
    'https://evil.com\\@www.idealista.com/a',
    'https://www.idealista.com\\.evil.com/a',
    'https://[www.idealista.com/a',
    'https://exa%mple.com/a',
  ])('rechaza la URL mal formada %s', (url) => {
    expect(code('idealista', url)).toBe('MALFORMED')
  })

  it.each([
    'https://localhost/a',
    'https://127.0.0.1/a',
    'https://[::1]/a',
    'https://www.idealista.com./a',
  ])('rechaza el host %s', (url) => {
    expect(code('idealista', url)).toBe('INVALID_HOST')
  })

  it('rechaza un enlace demasiado largo', () => {
    expect(
      code('idealista', `https://www.idealista.com/${'a'.repeat(2048)}`),
    ).toBe('TOO_LONG')
  })

  it('no resuelve el destino: nunca hace una petición', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    validatePublicationUrl('idealista', 'https://bit.ly/abc')
    validatePublicationUrl('idealista', 'https://www.idealista.com/a')

    expect(fetchSpy).not.toHaveBeenCalled()

    fetchSpy.mockRestore()
  })

  it('un dominio correcto no afirma que el anuncio exista', () => {
    const { message, status } = validatePublicationUrl(
      'idealista',
      'https://www.idealista.com/inmueble/000000000/',
    )

    expect(status).toBe('valid')
    expect(message).toContain('no comprueba si el anuncio existe')
  })
})

describe('acortadores', () => {
  it.each([...URL_SHORTENER_DOMAINS])('%s es no verificable', (domain) => {
    expect(
      validatePublicationUrl('idealista', `https://${domain}/abc`),
    ).toEqual({
      status: 'unverifiable',
      code: 'SHORTENER',
      message: SHORTENED_URL_MESSAGE,
    })
  })

  it('también con http y con subdominio', () => {
    expect(code('idealista', 'http://bit.ly/abc')).toBe('SHORTENER')
    expect(code('idealista', 'https://www.tinyurl.com/abc')).toBe('SHORTENER')
  })

  it('no confunde un dominio parecido con un acortador', () => {
    expect(code('idealista', 'https://notbit.ly/abc')).toBe('DOMAIN_MISMATCH')
  })
})

describe('hostMatchesDomain', () => {
  it('respeta los límites de dominio', () => {
    expect(hostMatchesDomain('a.pisos.com', 'pisos.com')).toBe(true)
    expect(hostMatchesDomain('pisos.com', 'pisos.com')).toBe(true)
    expect(hostMatchesDomain('apisos.com', 'pisos.com')).toBe(false)
    expect(hostMatchesDomain('pisos.com.es', 'pisos.com')).toBe(false)
  })
})

describe('PublicationChecklistUpdateSchema', () => {
  const parse = (items: unknown[]) =>
    PublicationChecklistUpdateSchema.safeParse({ items })

  it('rechaza una petición vacía', () => {
    expect(PublicationChecklistUpdateSchema.safeParse({ items: [] }).success).toBe(false)
  })

  it('acepta un enlace válido en una plataforma marcada', () => {
    expect(
      parse([{ platform: 'idealista', isPublished: true, url: 'https://www.idealista.com/a' }]).success,
    ).toBe(true)
  })

  it('devuelve el mensaje del validador en la ruta del enlace', () => {
    const result = parse([
      { platform: 'fotocasa', isPublished: false },
      { platform: 'idealista', isPublished: true, url: 'https://bit.ly/a' },
    ])

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]).toMatchObject({
      path: ['items', 1, 'url'],
      message: SHORTENED_URL_MESSAGE,
    })
  })

  it('una plataforma marcada exige enlace', () => {
    for (const item of [
      { platform: 'pisos', isPublished: true, url: null },
      { platform: 'pisos', isPublished: true, url: '' },
      { platform: 'pisos', isPublished: true },
    ]) {
      const result = parse([item])

      expect(result.success).toBe(false)
      expect(result.error?.issues[0].message).toContain('obligatorio')
    }
  })

  it('sin marcar puede conservar, borrar o sustituir por un enlace válido', () => {
    expect(parse([{ platform: 'pisos', isPublished: false }]).success).toBe(true)
    expect(parse([{ platform: 'pisos', isPublished: false, url: null }]).success).toBe(true)
    expect(parse([{ platform: 'pisos', isPublished: false, url: 'https://www.pisos.com/a' }]).success).toBe(true)
    expect(parse([{ platform: 'pisos', isPublished: false, url: 'https://x.example/a' }]).success).toBe(false)
  })

  it('rechaza plataformas duplicadas, desconocidas o campos extra', () => {
    expect(
      parse([
        { platform: 'pisos', isPublished: false },
        { platform: 'pisos', isPublished: false },
      ]).success,
    ).toBe(false)
    expect(parse([{ platform: 'kyero', isPublished: false }]).success).toBe(false)
    expect(parse([{ platform: 'other', isPublished: false }]).success).toBe(false)
    expect(parse([{ platform: 'pisos', isPublished: false, extra: 1 }]).success).toBe(false)
    expect(parse([]).success).toBe(false)
  })
})

describe('catálogo: datos de cada portal', () => {
  it.each([...PUBLICATION_PLATFORMS])('$name tiene página oficial válida para su propio validador y logotipo local', (platform) => {
    expect(validatePublicationUrl(platform.id, platform.homeUrl).status).toBe('valid')
    expect(platform.logo).toMatch(/^\/portales\/[a-z]+\.(svg|png|ico)$/)
  })
})

describe('validateOtherUrl', () => {
  it.each([
    'https://www.portal-cualquiera.net/a',
    'http://inmuebles.example.org/ficha?id=1',
    'https://bit.ly/abc',
    'https://www.idealista.com/a',
    'https://portal.example:8443/a',
  ])('admite %s', (url) => {
    expect(validateOtherUrl(url).status).toBe('valid')
  })

  it.each([
    ['javascript:alert(1)', 'UNSAFE_PROTOCOL'],
    ['data:text/html,x', 'UNSAFE_PROTOCOL'],
    ['file:///c:/a', 'UNSAFE_PROTOCOL'],
    ['ftp://portal.example/a', 'UNSAFE_PROTOCOL'],
    ['portal.example/a', 'MISSING_PROTOCOL'],
    ['https://user:clave@portal.example/a', 'CREDENTIALS'],
    ['https://localhost/a', 'INVALID_HOST'],
    ['https://192.168.1.1/a', 'INVALID_HOST'],
    ['https://portal example/a', 'MALFORMED'],
    ['', 'EMPTY'],
  ])('rechaza %j con %s', (url, expected) => {
    expect(validateOtherUrl(url).code).toBe(expected)
  })

  it('no afirma que el destino exista', () => {
    expect(validateOtherUrl('https://portal.example/a').message).toContain('no comprueba')
  })
})

describe('PublicationChecklistUpdateSchema: filas «Otro/a»', () => {
  const other = (instanceKey: string, patch = {}) => ({
    instanceKey,
    isPublished: true,
    url: 'https://portal.example/a',
    ...patch,
  })
  const parse = (others: unknown[]) =>
    PublicationChecklistUpdateSchema.safeParse({ items: [], others })

  it('admite cinco filas y rechaza una sexta', () => {
    const keys = ['a', 'b', 'c', 'd', 'e']

    expect(parse(keys.map((key) => other(key))).success).toBe(true)

    const result = parse([...keys, 'f'].map((key) => other(key)))

    expect(result.success).toBe(false)
    expect(result.error?.issues[0].message).toContain('más de 5')
  })

  it('rechaza claves repetidas o con caracteres no admitidos', () => {
    expect(parse([other('a'), other('a')]).success).toBe(false)
    expect(parse([other('a b')]).success).toBe(false)
    expect(parse([other('')]).success).toBe(false)
  })

  it('exige enlace para marcar y valida la página principal', () => {
    expect(parse([other('a', { url: null })]).success).toBe(false)
    expect(parse([other('a', { url: 'nada' })]).success).toBe(false)
    expect(parse([other('a', { homeUrl: 'javascript:alert(1)' })]).success).toBe(false)
    expect(parse([other('a', { homeUrl: '' })]).success).toBe(true)
    expect(parse([other('a', { homeUrl: 'https://inicio.example/' })]).success).toBe(true)
  })

  it('limita la longitud del nombre', () => {
    expect(parse([other('a', { name: 'x'.repeat(81) })]).success).toBe(false)
  })
})

describe('Estado comercial del inmueble', () => {
  const input = {
    title: 'Piso',
    operation: 'sale',
    type: 'apartment',
    price: 1,
    address: 'Calle',
    city: 'Madrid',
    neighborhood: '',
    area: 1,
    bedrooms: 1,
    bathrooms: 1,
    condition: 'good',
    elevator: false,
    terrace: false,
    balcony: false,
    garage: false,
    storageRoom: false,
    pool: false,
    garden: false,
    airConditioning: false,
    heating: false,
    additionalInformation: '',
  }

  it('tiene exactamente las cuatro etiquetas visibles', () => {
    expect(
      PROPERTY_COMMERCIAL_STATUSES.map(
        (status) => commercialStatusLabels[status],
      ),
    ).toEqual(['En venta', 'Vendido', 'Por alquilar', 'Alquilado'])
  })

  it.each([...PROPERTY_COMMERCIAL_STATUSES])('admite %s al crear y al editar', (commercialStatus) => {
    expect(PropertyInputSchema.safeParse({ ...input, commercialStatus }).success).toBe(true)
    expect(PropertyUpdateSchema.safeParse({ commercialStatus }).success).toBe(true)
  })

  it('es obligatorio al crear', () => {
    const result = PropertyInputSchema.safeParse(input)

    expect(result.success).toBe(false)
    expect(result.error?.issues[0].path).toEqual(['commercialStatus'])
  })

  it('editar otros campos no lo exige', () => {
    expect(PropertyUpdateSchema.safeParse({ title: 'Nuevo' }).success).toBe(true)
  })

  it.each(['FOR_SALE', 'En venta', 'draft', '', null, 1])('rechaza %j', (commercialStatus) => {
    expect(PropertyInputSchema.safeParse({ ...input, commercialStatus }).success).toBe(false)
    expect(PropertyUpdateSchema.safeParse({ commercialStatus }).success).toBe(false)
  })

  it('un inmueble antiguo aparece sin indicar', () => {
    expect(getCommercialStatusLabel(null)).toBe('Sin indicar')
    expect(getCommercialStatusLabel(undefined)).toBe('Sin indicar')
    expect(getCommercialStatusLabel('otro')).toBe('Sin indicar')
  })
})
