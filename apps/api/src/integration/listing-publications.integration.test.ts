import pg from 'pg'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestDatabase, type TestDatabase } from '../test-support/postgres.js'

// Checklist y Estado sobre PostgreSQL real: base temporal propia con las migraciones del
// proyecto. Prisma se importa tras fijar DATABASE_URL.

const auth = vi.hoisted(() => ({ userId: 'user-a' as string | null }))

vi.mock('../middleware/auth.middleware.js', () => ({
  requireAuth: async (
    request: { userId?: string | null },
    reply: { code: (status: number) => { send: (body: unknown) => void } },
  ) => {
    if (!auth.userId) {
      reply.code(401).send({ message: 'Se requiere una sesión activa.' })
      return
    }

    request.userId = auth.userId
  },
}))

const IDS = {
  legacy: 'cmj7b5q8r0000v6y7g5q4m3n2',
  genA: 'cmj7b5q8r0001v6y7g5q4m3n2',
  genB: 'cmj7b5q8r0002v6y7g5q4m3n2',
  genOther: 'cmj7b5q8r0003v6y7g5q4m3n2',
  other: 'cmj7b5q8r0004v6y7g5q4m3n2',
}

const VALID = 'https://www.idealista.com/inmueble/1/'

let database: TestDatabase
let client: pg.Client

// SQL directo de las pruebas: parámetros «?» e identificadores con mayúsculas sin citar.
const IDENTIFIERS = /\b(ListingPublication|Property|Generation|User|generationId|instanceKey|isPublished|additionalInformation|userId|updatedAt|propertyId|callToAction|commercialStatus)\b/g

const toPostgres = (sql: string) => {
  let index = 0

  return sql.replace(/\?/g, () => `$${++index}`).replace(IDENTIFIERS, '"$1"')
}

const raw = {
  execute: (statement: string | { sql: string; args: unknown[] }) =>
    typeof statement === 'string'
      ? client.query(toPostgres(statement))
      : client.query(toPostgres(statement.sql), statement.args),
}
let app: FastifyInstance
let prisma: typeof import('../db/prisma.js').prisma

const insertProperty = (id: string, userId: string) =>
  raw.execute({
    sql: `INSERT INTO Property (id,title,operation,type,price,address,city,neighborhood,area,bedrooms,bathrooms,condition,additionalInformation,userId,updatedAt)
          VALUES (?, 'Piso antiguo','sale','apartment',1,'Calle','Madrid','',1,1,1,'good','',?,CURRENT_TIMESTAMP)`,
    args: [id, userId],
  })

const insertGeneration = (id: string, propertyId: string) =>
  raw.execute({
    sql: `INSERT INTO Generation (id,title,description,highlights,callToAction,provider,tone,language,propertyId,updatedAt)
          VALUES (?, 'Anuncio','Texto','[]','Llama','mock','casual','español',?,CURRENT_TIMESTAMP)`,
    args: [id, propertyId],
  })

const put = (id: string, items: unknown[], others?: unknown[]) =>
  app.inject({ method: 'PUT', url: `/api/generations/${id}/publications`, payload: { items, ...(others && { others }) } })

const getOthers = async (id: string) =>
  (await app.inject({ url: `/api/generations/${id}/publications` })).json().others as Array<{
    instanceKey: string
    name: string | null
    homeUrl: string | null
    isPublished: boolean
    url: string | null
  }>

const get = async (id: string) =>
  (await app.inject({ url: `/api/generations/${id}/publications` })).json().items as Array<{
    platform: string
    isPublished: boolean
    url: string | null
  }>

const idealista = (items: Awaited<ReturnType<typeof get>>) =>
  items.find((item) => item.platform === 'idealista')

beforeAll(async () => {
  database = await createTestDatabase()
  vi.stubEnv('DATABASE_URL', database.url)
  client = new pg.Client({ connectionString: database.url })
  await client.connect()

  for (const id of ['user-a', 'user-b']) {
    await raw.execute({
      sql: `INSERT INTO User (id,email,password,updatedAt) VALUES (?,?, 'x', CURRENT_TIMESTAMP)`,
      args: [id, `${id}@example.test`],
    })
  }

  await insertProperty(IDS.legacy, 'user-a')
  await insertGeneration(IDS.genA, IDS.legacy)
  await insertGeneration(IDS.genB, IDS.legacy)
  await insertProperty(IDS.other, 'user-b')
  await insertGeneration(IDS.genOther, IDS.other)

  const prismaModule = await import('../db/prisma.js')
  const { generationRoutes } = await import('../routes/generation.routes.js')
  const { propertyRoutes } = await import('../routes/property.routes.js')

  prisma = prismaModule.prisma
  app = Fastify()
  app.setErrorHandler((error: { code?: string; message: string }, _request, reply) =>
    reply.code(error.code === 'AI_PROVIDER_ERROR' ? 502 : 500).send({ code: error.code, message: error.message }),
  )
  await app.register(generationRoutes)
  await app.register(propertyRoutes)
  await app.ready()
})

afterAll(async () => {
  await app?.close()
  await prisma?.$disconnect()
  await client?.end()
  vi.unstubAllEnvs()
  await database?.drop()
})

beforeEach(async () => {
  auth.userId = 'user-a'
  await prisma.listingPublication.deleteMany()
})

describe('migración', () => {
  it('conserva los inmuebles y anuncios existentes sin inventar estado', async () => {
    const property = await prisma.property.findUniqueOrThrow({
      where: { id: IDS.legacy },
      include: { generations: true },
    })

    expect(property.title).toBe('Piso antiguo')
    expect(property.commercialStatus).toBeNull()
    expect(property.generations).toHaveLength(2)
  })

  it('la base no admite los estados que antes se corregían al migrar', async () => {
    await expect(raw.execute(`INSERT INTO ListingPublication (id,generationId,platform,isPublished,url,updatedAt) VALUES ('sin-enlace','${IDS.genA}','pisos',true,NULL,now())`)).rejects.toThrow(/published_requires_url/)
    await expect(raw.execute(`INSERT INTO ListingPublication (id,generationId,platform,isPublished,url,updatedAt) VALUES ('en-blanco','${IDS.genA}','pisos',true,'   ',now())`)).rejects.toThrow(/published_requires_url/)
    await expect(raw.execute(`INSERT INTO ListingPublication (id,generationId,platform,position,updatedAt) VALUES ('portal-pos','${IDS.genA}','pisos',7,now())`)).rejects.toThrow(/other_position_range/)
  })

  it('la base impide duplicar anuncio y plataforma', async () => {
    const data = { generationId: IDS.genA, platform: 'idealista', isPublished: true, url: VALID }

    await prisma.listingPublication.create({ data })

    await expect(prisma.listingPublication.create({ data })).rejects.toThrow()
    await expect(prisma.listingPublication.count()).resolves.toBe(1)
  })
})

describe('Checklist', () => {
  it('sin registros devuelve las cinco plataformas sin marcar', async () => {
    const items = await get(IDS.genA)

    expect(items).toHaveLength(5)
    expect(items.every((item) => !item.isPublished && item.url === null)).toBe(true)
  })

  it('persiste el enlace y no mezcla anuncios', async () => {
    expect((await put(IDS.genA, [{ platform: 'idealista', isPublished: true, url: VALID }])).statusCode).toBe(200)

    expect(idealista(await get(IDS.genA))).toEqual({ platform: 'idealista', isPublished: true, url: VALID })
    expect(idealista(await get(IDS.genB))).toEqual({ platform: 'idealista', isPublished: false, url: null })
  })

  it('guardar dos veces actualiza la misma fila', async () => {
    await put(IDS.genA, [{ platform: 'idealista', isPublished: true, url: VALID }])
    await put(IDS.genA, [{ platform: 'idealista', isPublished: true, url: 'https://www.idealista.com/inmueble/2/' }])

    await expect(prisma.listingPublication.count({ where: { generationId: IDS.genA } })).resolves.toBe(1)
    expect(idealista(await get(IDS.genA))?.url).toBe('https://www.idealista.com/inmueble/2/')
  })

  it('desmarcar conserva el enlace y un enlace no válido nunca se guarda', async () => {
    await put(IDS.genA, [{ platform: 'idealista', isPublished: true, url: VALID }])
    await put(IDS.genA, [{ platform: 'idealista', isPublished: false }])

    expect(idealista(await get(IDS.genA))).toEqual({ platform: 'idealista', isPublished: false, url: VALID })

    expect((await put(IDS.genA, [{ platform: 'idealista', isPublished: false, url: 'https://evil.example/a' }])).statusCode).toBe(400)
    expect(idealista(await get(IDS.genA))?.url).toBe(VALID)

    await put(IDS.genA, [{ platform: 'idealista', isPublished: true, url: VALID }])

    expect(idealista(await get(IDS.genA))).toEqual({ platform: 'idealista', isPublished: true, url: VALID })
  })

  it('no se puede marcar sin enlace y borrar el enlace exige desmarcar', async () => {
    await put(IDS.genA, [{ platform: 'idealista', isPublished: true, url: VALID }])

    for (const item of [{ url: null }, { url: '' }, {}]) {
      const response = await put(IDS.genA, [{ platform: 'idealista', isPublished: true, ...item }])

      expect(response.statusCode).toBe(400)
      expect(response.json().errors[0].message).toContain('obligatorio')
    }

    expect(idealista(await get(IDS.genA))).toMatchObject({ isPublished: true, url: VALID })

    await put(IDS.genA, [{ platform: 'idealista', isPublished: false, url: null }])

    expect(idealista(await get(IDS.genA))).toEqual({ platform: 'idealista', isPublished: false, url: null })
  })

  it('rechaza identificadores de plataforma arbitrarios', async () => {
    for (const platform of ['kyero', 'other']) {
      expect((await put(IDS.genA, [{ platform, isPublished: false }])).statusCode).toBe(400)
    }
  })

  it.each([
    ['ajeno', 'https://idealista.com.otrodominio.com/a'],
    ['acortado', 'https://bit.ly/a'],
    ['peligroso', 'javascript:alert(1)'],
    ['de otro portal', 'https://www.fotocasa.es/a'],
  ])('un enlace %s no se guarda y nada del lote se aplica', async (_name, url) => {
    const response = await put(IDS.genA, [
      { platform: 'fotocasa', isPublished: true, url: 'https://www.fotocasa.es/ok' },
      { platform: 'idealista', isPublished: true, url },
    ])

    expect(response.statusCode).toBe(400)
    expect(response.json().errors[0].path).toEqual(['items', 1, 'url'])
    await expect(prisma.listingPublication.count()).resolves.toBe(0)
  })

  it('guarda la URL normalizada y no visita el enlace', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    await put(IDS.genA, [{ platform: 'idealista', isPublished: true, url: ` HTTPS://WWW.IDEALISTA.COM:443/inmueble/1/ ` }])

    expect(idealista(await get(IDS.genA))?.url).toBe(VALID)
    expect(fetchSpy).not.toHaveBeenCalled()

    fetchSpy.mockRestore()
  })

  it('otro usuario recibe 404 y no puede leer ni escribir', async () => {
    await put(IDS.genA, [{ platform: 'idealista', isPublished: true, url: VALID }])

    auth.userId = 'user-b'

    expect((await app.inject({ url: `/api/generations/${IDS.genA}/publications` })).statusCode).toBe(404)
    expect((await put(IDS.genA, [{ platform: 'idealista', isPublished: false }])).statusCode).toBe(404)

    auth.userId = 'user-a'

    expect(idealista(await get(IDS.genA))).toMatchObject({ isPublished: true, url: VALID })
  })

  it('sin sesión responde 401', async () => {
    auth.userId = null

    expect((await app.inject({ url: `/api/generations/${IDS.genA}/publications` })).statusCode).toBe(401)
    expect((await put(IDS.genA, [{ platform: 'idealista', isPublished: false }])).statusCode).toBe(401)
  })

  it('borrar el anuncio borra su Checklist y no el de otros', async () => {
    const generation = await prisma.generation.create({
      data: { title: 't', description: 'd', highlights: '[]', provider: 'mock', tone: 'casual', language: 'español', propertyId: IDS.legacy },
    })

    await put(generation.id, [{ platform: 'idealista', isPublished: true, url: VALID }])
    await put(IDS.genA, [{ platform: 'idealista', isPublished: true, url: VALID }])

    await prisma.generation.delete({ where: { id: generation.id } })

    await expect(prisma.listingPublication.count({ where: { generationId: generation.id } })).resolves.toBe(0)
    await expect(prisma.listingPublication.count({ where: { generationId: IDS.genA } })).resolves.toBe(1)
  })
})

describe('filas «Otro/a»', () => {
  const row = (instanceKey: string, patch = {}) => ({
    instanceKey,
    name: `Portal ${instanceKey}`,
    homeUrl: `https://${instanceKey}.example/`,
    isPublished: true,
    url: `https://${instanceKey}.example/anuncio`,
    ...patch,
  })
  const five = ['a', 'b', 'c', 'd', 'e']

  it('empieza sin filas guardadas', async () => {
    await expect(getOthers(IDS.genA)).resolves.toEqual([])
  })

  it('persiste hasta cinco filas independientes y en orden', async () => {
    const response = await put(IDS.genA, [], five.map((key) => row(key)))

    expect(response.statusCode).toBe(200)
    expect(await getOthers(IDS.genA)).toEqual(
      five.map((key) => ({
        instanceKey: key,
        name: `Portal ${key}`,
        homeUrl: `https://${key}.example/`,
        isPublished: true,
        url: `https://${key}.example/anuncio`,
      })),
    )
  })

  it('el servidor rechaza una sexta fila sin aplicar nada', async () => {
    const response = await put(IDS.genA, [], [...five, 'f'].map((key) => row(key)))

    expect(response.statusCode).toBe(400)
    expect(response.json().errors[0].message).toContain('más de 5')
    await expect(prisma.listingPublication.count()).resolves.toBe(0)
  })

  it('quitar una fila no toca las demás ni los portales', async () => {
    await put(IDS.genA, [{ platform: 'idealista', isPublished: true, url: VALID }], five.map((key) => row(key)))

    const before = await prisma.listingPublication.findMany({ where: { instanceKey: 'a' } })

    await put(IDS.genA, [], ['a', 'c'].map((key) => row(key)))

    expect((await getOthers(IDS.genA)).map((other) => other.instanceKey)).toEqual(['a', 'c'])
    expect(idealista(await get(IDS.genA))).toMatchObject({ isPublished: true, url: VALID })
    expect((await prisma.listingPublication.findMany({ where: { instanceKey: 'a' } }))[0].id).toBe(before[0].id)
  })

  it('no enviar others no borra las filas guardadas', async () => {
    await put(IDS.genA, [], [row('a')])
    await put(IDS.genA, [{ platform: 'pisos', isPublished: false }])

    expect(await getOthers(IDS.genA)).toHaveLength(1)
  })

  it('los dos anuncios no comparten filas aunque usen la misma clave', async () => {
    await put(IDS.genA, [], [row('a', { url: 'https://uno.example/x' })])
    await put(IDS.genB, [], [row('a', { url: 'https://dos.example/x' })])

    expect((await getOthers(IDS.genA))[0].url).toBe('https://uno.example/x')
    expect((await getOthers(IDS.genB))[0].url).toBe('https://dos.example/x')
  })

  it('una fila marcada exige enlace válido y un fallo no aplica nada del lote', async () => {
    for (const url of [null, '', 'nada', 'javascript:alert(1)']) {
      const response = await put(IDS.genA, [], [row('a'), row('b', { url })])

      expect(response.statusCode).toBe(400)
      expect(response.json().errors[0].path).toEqual(['others', 1, 'url'])
    }

    await expect(prisma.listingPublication.count()).resolves.toBe(0)
  })

  it('una fila sin marcar conserva su enlace', async () => {
    await put(IDS.genA, [], [row('a')])
    await put(IDS.genA, [], [{ instanceKey: 'a', isPublished: false }])

    expect((await getOthers(IDS.genA))[0]).toMatchObject({ isPublished: false, url: 'https://a.example/anuncio', name: 'Portal a' })
  })

  it('nombre y página principal son opcionales y no se deducen del enlace', async () => {
    await put(IDS.genA, [], [row('a', { name: null, homeUrl: null })])

    expect((await getOthers(IDS.genA))[0]).toMatchObject({ name: null, homeUrl: null })
  })

  it('otro usuario no puede leer ni escribir sus filas', async () => {
    await put(IDS.genA, [], [row('a')])

    auth.userId = 'user-b'

    expect((await put(IDS.genA, [], [])).statusCode).toBe(404)

    auth.userId = 'user-a'

    expect(await getOthers(IDS.genA)).toHaveLength(1)
  })

  it('borrar el anuncio borra sus filas', async () => {
    const generation = await prisma.generation.create({
      data: { title: 't', description: 'd', highlights: '[]', provider: 'mock', tone: 'casual', language: 'español', propertyId: IDS.legacy },
    })

    await put(generation.id, [], [row('a'), row('b')])
    await put(IDS.genA, [], [row('a')])

    await prisma.generation.delete({ where: { id: generation.id } })

    await expect(prisma.listingPublication.count({ where: { generationId: generation.id } })).resolves.toBe(0)
    await expect(prisma.listingPublication.count({ where: { generationId: IDS.genA } })).resolves.toBe(1)
  })

  it('la base permite varias filas «Otro/a» pero no repetir clave', async () => {
    const data = { generationId: IDS.genA, platform: 'other', instanceKey: 'a' }

    await prisma.listingPublication.create({ data })
    await prisma.listingPublication.create({ data: { ...data, instanceKey: 'b', position: 1 } })

    await expect(prisma.listingPublication.create({ data: { ...data, position: 2 } })).rejects.toThrow(/Unique/i)
  })
})

describe('restricciones de la base de datos', () => {
  const insert = (fields: Record<string, unknown>) => {
    const row: Record<string, unknown> = { id: `r${Math.random()}`, generationId: IDS.genA, platform: 'idealista', updatedAt: new Date(), ...fields }

    if ('isPublished' in row) {
      row.isPublished = Boolean(row.isPublished)
    }
    const names = Object.keys(row)

    return raw.execute({
      sql: `INSERT INTO ListingPublication (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`,
      args: Object.values(row) as never[],
    })
  }

  it.each([
    ['sin enlace', null],
    ['con enlace vacío', ''],
    ['con enlace en blanco', '   '],
  ])('SQL rechaza una fila marcada %s', async (_name, url) => {
    await expect(insert({ isPublished: 1, url })).rejects.toThrow(/published_requires_url/)
  })

  it('SQL rechaza dejar sin enlace una fila marcada', async () => {
    await insert({ id: 'a', isPublished: 1, url: VALID })

    await expect(raw.execute(`UPDATE ListingPublication SET url = NULL WHERE id = 'a'`)).rejects.toThrow(/published_requires_url/)
  })

  it('SQL admite filas sin marcar con enlace o sin él', async () => {
    await insert({ isPublished: 0, url: VALID })
    await insert({ isPublished: 0, url: null, platform: 'pisos' })

    await expect(prisma.listingPublication.count()).resolves.toBe(2)
  })

  it.each([-1, 5, 6])('SQL rechaza la posición %d en «Otro/a»', async (position) => {
    await expect(insert({ platform: 'other', instanceKey: 'x', position })).rejects.toThrow(/other_position_range/)
  })

  it('SQL impide una sexta fila «Otro/a» aunque no pase por la API', async () => {
    for (let position = 0; position < 5; position++) {
      await insert({ platform: 'other', instanceKey: `k${position}`, position })
    }

    for (const position of [0, 4, 5]) {
      await expect(insert({ platform: 'other', instanceKey: 'sexta', position })).rejects.toThrow()
    }

    await expect(prisma.listingPublication.count()).resolves.toBe(5)
  })

  it('las posiciones se aplican por anuncio y no afectan a los portales', async () => {
    await insert({ platform: 'other', instanceKey: 'a', position: 0 })
    await insert({ platform: 'other', instanceKey: 'a', position: 0, generationId: IDS.genB })
    await insert({ platform: 'pisos', position: 0 })
    await insert({ platform: 'fotocasa', position: 0 })

    await expect(prisma.listingPublication.count()).resolves.toBe(4)
  })

  it.each([
    ['position NULL en other', { platform: 'other', instanceKey: 'n', position: null }, /not-null/],
    ['instanceKey NULL en other', { platform: 'other', instanceKey: null, position: 1 }, /not-null/],
    ['instanceKey NULL en portal', { platform: 'pisos', instanceKey: null }, /not-null/],
    ['position NULL en portal', { platform: 'pisos', position: null }, /not-null/],
    ['portal con posición', { platform: 'pisos', position: 3 }, /other_position_range/],
    ['portal con clave', { platform: 'pisos', instanceKey: 'x' }, /instance_key_matches_platform/],
  ])('SQL rechaza %s', async (_name, fields, error) => {
    await expect(insert(fields)).rejects.toThrow(error)
  })

  it('seis filas con posición NULL no entran', async () => {
    for (let i = 0; i < 6; i++) {
      await expect(insert({ platform: 'other', instanceKey: `n${i}`, position: null })).rejects.toThrow(/not-null/)
    }

    await expect(prisma.listingPublication.count()).resolves.toBe(0)
  })

  it.each([
    ['position = NULL', /not-null/],
    ['position = 5', /other_position_range/],
    ['position = -1', /other_position_range/],
    ['instanceKey = NULL', /not-null/],
    [`instanceKey = ''`, /instance_key_matches_platform/],
  ])('SQL rechaza UPDATE %s en una fila other', async (assignment, error) => {
    await insert({ id: 'u', platform: 'other', instanceKey: 'a', position: 0 })

    await expect(raw.execute(`UPDATE ListingPublication SET ${assignment} WHERE id = 'u'`)).rejects.toThrow(error)
  })

  it('SQL rechaza mover una fila a una posición ocupada', async () => {
    await insert({ id: 'a', platform: 'other', instanceKey: 'a', position: 0 })
    await insert({ id: 'b', platform: 'other', instanceKey: 'b', position: 1 })

    await expect(raw.execute(`UPDATE ListingPublication SET position = 0 WHERE id = 'b'`)).rejects.toThrow(/other_position_key|UNIQUE/)
  })

  it('SQL exige coherencia entre plataforma e instancia', async () => {
    await expect(insert({ platform: 'other', instanceKey: '' })).rejects.toThrow(/instance_key_matches_platform/)
    await expect(insert({ platform: 'pisos', instanceKey: 'x' })).rejects.toThrow(/instance_key_matches_platform/)
  })

  it('las restricciones siguen en el esquema migrado', async () => {
    const constraints = await client.query(`SELECT conname AS name FROM pg_constraint WHERE conrelid = '"ListingPublication"'::regclass`)
    const indexes = await client.query(`SELECT indexname AS name FROM pg_indexes WHERE tablename = 'ListingPublication'`)
    const ddl = [...constraints.rows, ...indexes.rows].map((row) => row.name).join('\n')

    for (const name of ['published_requires_url', 'instance_key_matches_platform', 'other_position_range', 'ListingPublication_other_position_key']) {
      expect(ddl).toContain(name)
    }
  })
})

describe('guardados simultáneos', () => {
  const row = (instanceKey: string) => ({ instanceKey, isPublished: true, url: `https://${instanceKey}.example/a` })
  const set = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => row(`${prefix}${i}`))
  const others = () => prisma.listingPublication.findMany({ where: { generationId: IDS.genA, platform: 'other' }, orderBy: { position: 'asc' } })

  it('dos listas distintas nunca superan cinco filas ni se mezclan', async () => {
    const responses = await Promise.all([put(IDS.genA, [], set('a', 5)), put(IDS.genA, [], set('b', 5))])

    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 200])

    const stored = await others()

    expect(stored).toHaveLength(5)
    expect(new Set(stored.map((item) => item.instanceKey[0])).size).toBe(1)
    expect(stored.map((item) => item.position)).toEqual([0, 1, 2, 3, 4])
  })

  it('veinte guardados a la vez dejan un estado válido y responden sin error', async () => {
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, i) => put(IDS.genA, [{ platform: 'idealista', isPublished: i % 2 === 0, url: VALID }], set(`c${i}x`, (i % 5) + 1))),
    )

    expect(responses.filter((response) => response.statusCode !== 200)).toEqual([])

    const stored = await others()

    expect(stored.length).toBeGreaterThan(0)
    expect(stored.length).toBeLessThanOrEqual(5)
    expect(new Set(stored.map((item) => item.instanceKey.split('x')[0])).size).toBe(1)
  })

  it('un guardado no pierde datos conservados de otra fila', async () => {
    await put(IDS.genA, [], [{ ...row('a'), name: 'Portal', homeUrl: 'https://a.example/' }])

    const before = (await others())[0]

    await put(IDS.genA, [], [{ instanceKey: 'a', isPublished: true, url: 'https://a.example/nuevo' }, row('b')])

    const [kept] = await others()

    expect(kept).toMatchObject({ id: before.id, customName: 'Portal', homeUrl: 'https://a.example/', url: 'https://a.example/nuevo' })
    expect(kept.createdAt).toEqual(before.createdAt)
  })

  it('un anuncio borrado responde 404', async () => {
    expect((await put('cmj7b5q8r9999v6y7g5q4m3n2', [{ platform: 'pisos', isPublished: false }])).statusCode).toBe(404)
  })
})

describe('Estado del inmueble', () => {
  const setStatus = (commercialStatus: unknown, id = IDS.legacy) =>
    app.inject({ method: 'PUT', url: `/api/properties/${id}`, payload: { commercialStatus } })

  it.each(['for-sale', 'sold', 'for-rent', 'rented'])('persiste %s', async (status) => {
    expect((await setStatus(status)).statusCode).toBe(200)

    const response = await app.inject({ url: `/api/properties/${IDS.legacy}` })

    expect(response.json().commercialStatus).toBe(status)
  })

  it('rechaza valores arbitrarios sin alterar el dato', async () => {
    await setStatus('sold')

    expect((await setStatus('reservado')).statusCode).toBe(400)
    expect((await setStatus(null)).statusCode).toBe(400)

    const property = await prisma.property.findUniqueOrThrow({ where: { id: IDS.legacy } })

    expect(property.commercialStatus).toBe('sold')
  })

  it('cambiar el estado no altera el Checklist', async () => {
    await put(IDS.genA, [{ platform: 'idealista', isPublished: true, url: VALID }])

    const before = await prisma.listingPublication.findMany()

    await setStatus('rented')

    expect(await prisma.listingPublication.findMany()).toEqual(before)
  })

  describe('al crear un inmueble', () => {
    const property = {
      title: 'Piso nuevo',
      operation: 'rent',
      type: 'apartment',
      price: 900,
      address: 'Calle Nueva 1',
      city: 'Madrid',
      neighborhood: 'Centro',
      area: 80,
      bedrooms: 2,
      bathrooms: 1,
      condition: 'good',
      elevator: true,
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

    const create = (payload: object) =>
      app.inject({
        method: 'POST',
        url: '/api/generations',
        payload: { property: payload, provider: 'mock', tone: 'casual', language: 'español' },
      })

    it('persiste el estado seleccionado', async () => {
      const response = await create({ ...property, commercialStatus: 'for-rent' })

      expect(response.statusCode).toBe(200)

      const created = await prisma.property.findUniqueOrThrow({
        where: { id: response.json().propertyId },
      })

      expect(created.commercialStatus).toBe('for-rent')
    })

    it.each([900, 10000, 100000, 250000, 500000, 1000000, 100000000, 250000.5, 1234.75, 0.5])('crea y persiste un inmueble de %d €', async (price) => {
      const response = await create({ ...property, operation: 'sale', price, commercialStatus: 'for-sale' })

      expect(response.statusCode).toBe(200)

      const created = await prisma.property.findUniqueOrThrow({
        where: { id: response.json().propertyId },
        include: { generations: true },
      })

      expect(Number(created.price)).toBe(price)
      expect(response.json().listing).toBeDefined()
      expect(created.generations).toHaveLength(1)
    })

    it.each([
      [{ area: 90.5 }, 'superficie decimal'],
      [{ area: 1200.25 }, 'superficie grande'],
      [{ floor: -1 }, 'sótano'],
      [{ floor: 0 }, 'planta baja'],
      [{ floor: 12, bedrooms: 10, bathrooms: 4 }, 'cifras de dos dígitos'],
    ])('crea un inmueble con %j (%s)', async (patch, _case) => {
      const response = await create({ ...property, price: 250000, ...patch, commercialStatus: 'for-sale' })

      expect(response.statusCode).toBe(200)
    })

    it.each([
      ['un dato contradictorio', { additionalInformation: 'Precio 1 euros' }],
      ['una característica inventada', { additionalInformation: 'Tiene piscina' }],
    ])('la IA con %s responde 502 y no guarda nada', async (_name, patch) => {
      const before = [await prisma.property.count(), await prisma.generation.count()]
      const response = await create({ ...property, ...patch, commercialStatus: 'for-sale' })

      expect(response.statusCode).toBe(502)
      expect([await prisma.property.count(), await prisma.generation.count()]).toEqual(before)
    })

    it('la API responde los importes como cadena exacta y admite cadenas', async () => {
      const response = await create({ ...property, operation: 'sale', price: '250000.10', commercialStatus: 'for-sale' })

      expect(response.statusCode).toBe(200)

      const read = await app.inject({ url: `/api/properties/${response.json().propertyId}` })

      expect(read.json().price).toBe('250000.1')
    })

    it.each(['12.345', '-1', 'abc', '100000000.01', ''])('rechaza el importe %j', async (price) => {
      expect((await create({ ...property, price, commercialStatus: 'for-sale' })).statusCode).toBe(400)
    })

    it('no crea el inmueble si falta el estado', async () => {
      const before = await prisma.property.count()
      const response = await create(property)

      expect(response.statusCode).toBe(400)
      expect(response.json().errors[0].path).toEqual(['property', 'commercialStatus'])
      await expect(prisma.property.count()).resolves.toBe(before)
    })
  })

  it('otro usuario no puede cambiarlo', async () => {
    auth.userId = 'user-b'

    expect((await setStatus('sold')).statusCode).toBe(404)
  })
})
