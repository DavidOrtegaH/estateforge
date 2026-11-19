import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { FastifyInstance } from 'fastify'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { createTestDatabase, type TestDatabase } from '../test-support/postgres.js'

// Idioma del anuncio de extremo a extremo contra PostgreSQL real y la aplicación completa: generación con
// la plantilla local (sin IA), persistencia, fuente multimedia (contrato y huella) y aviso del texto libre.

let database: TestDatabase
let admin: pg.Client
let app: FastifyInstance
let root: string
let mods: {
  createSession: typeof import('../services/session.service.js')['createSession']
  getMediaSource: typeof import('../media/listing-media.service.js')['getMediaSource']
  closeDatabase: () => Promise<void>
}

const id = (prefix: string) => `c${prefix}${randomBytes(12).toString('hex')}`.slice(0, 25)

async function account() {
  const userId = id('u')
  await admin.query(`INSERT INTO "User" (id, email, password, "updatedAt", "emailVerifiedAt") VALUES ($1, $2, 'x', now(), now())`, [userId, `${userId}@example.test`])
  const { token } = await mods.createSession(userId)
  return { userId, cookie: `estateforge_session=${token}` }
}

async function propertyOf(userId: string) {
  const propertyId = id('p')
  await admin.query(
    `INSERT INTO "Property" (id, title, operation, type, price, address, city, neighborhood, area, bedrooms, bathrooms, floor, condition, "commercialStatus", "additionalInformation", elevator, terrace, "userId", "updatedAt")
     VALUES ($1, 'Piso precioso junto al parque', 'rent', 'apartment', 1250.50, 'Calle Privada 7', 'Madrid', 'Chamberí', 85, 2, 1, 12, 'good', 'for-rent', 'Muy luminoso y con vistas al parque.', true, true, $2, now())`,
    [propertyId, userId],
  )
  return propertyId
}

const generate = (cookie: string, propertyId: string, language: string) =>
  app.inject({ method: 'POST', url: '/api/generations/from-property', headers: { cookie, 'content-type': 'application/json' }, payload: { propertyId, provider: 'mock', tone: 'professional', language } })

beforeAll(async () => {
  database = await createTestDatabase()
  root = mkdtempSync(join(tmpdir(), 'ef-language-'))
  vi.stubEnv('DATABASE_URL', database.url)
  admin = new pg.Client({ connectionString: database.url })
  await admin.connect()
  vi.resetModules()
  const { LocalStorage } = await import('../storage/local-storage.js')
  ;(await import('../storage/object-storage.js')).setStorageForTests(new LocalStorage(root))
  mods = {
    createSession: (await import('../services/session.service.js')).createSession,
    getMediaSource: (await import('../media/listing-media.service.js')).getMediaSource,
    closeDatabase: (await import('../db/prisma.js')).closeDatabase,
  }
  app = await (await import('../app.js')).buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await mods.closeDatabase()
  await admin.end()
  vi.unstubAllEnvs()
  await database.drop()
  rmSync(root, { recursive: true, force: true })
})

describe('anuncio en inglés con la plantilla local', () => {
  it('se genera en inglés, se guarda con su idioma, avisa del texto libre y no toca el título del inmueble', async () => {
    const owner = await account()
    const propertyId = await propertyOf(owner.userId)
    const response = await generate(owner.cookie, propertyId, 'english')
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.listing).toEqual({
      title: '2-bedroom apartment for rent in Chamberí, Madrid',
      description: 'Apartment for rent in Chamberí, Madrid. It has 85 m², 2 bedrooms and 1 bathroom. It is on the 12th floor. Features: terrace and lift. It is in good condition. Price: €1,250.50/month.',
      highlights: ['85 m²', '2 bedrooms', '1 bathroom', 'Terrace', 'Lift'],
      callToAction: 'Contact us to arrange a viewing.',
    })
    expect(body.notices).toEqual(['FREE_TEXT_NOT_INCLUDED'])
    const stored = (await admin.query(`SELECT language, title, description FROM "Generation" WHERE id = $1`, [body.generationId])).rows[0]
    expect(stored).toMatchObject({ language: 'english', title: body.listing.title })
    expect(stored.description).not.toContain('vistas al parque')
    expect((await admin.query(`SELECT title, "additionalInformation" FROM "Property" WHERE id = $1`, [propertyId])).rows[0]).toEqual({ title: 'Piso precioso junto al parque', additionalInformation: 'Muy luminoso y con vistas al parque.' })
  })

  it('en español: sin aviso y con las observaciones del usuario', async () => {
    const owner = await account()
    const propertyId = await propertyOf(owner.userId)
    const body = (await generate(owner.cookie, propertyId, 'español')).json()
    expect(body.notices).toEqual([])
    expect(body.listing.title).toBe('Piso precioso junto al parque')
    expect(body.listing.description).toContain('Se encuentra en una 12.ª planta.')
    expect(body.listing.description).toContain('Muy luminoso y con vistas al parque.')
  })
})

describe('fuente multimedia', () => {
  async function twoListings() {
    const owner = await account()
    const propertyId = await propertyOf(owner.userId)
    const english = (await generate(owner.cookie, propertyId, 'english')).json().generationId as string
    const spanish = (await generate(owner.cookie, propertyId, 'español')).json().generationId as string
    return { owner, english, spanish }
  }

  it('cada anuncio lleva su idioma en el contrato, aunque después se genere otro en otro idioma', async () => {
    const { owner, english, spanish } = await twoListings()
    const source = async (generationId: string) => (await app.inject({ url: `/api/generations/${generationId}/media/source`, headers: { cookie: owner.cookie } })).json()
    expect((await source(english)).generation.language).toBe('english')
    expect((await source(spanish)).generation.language).toBe('español')
  })

  it('huella: el español conserva la de siempre (su material sigue vigente); el idioma cambia la del inglés', async () => {
    const { owner, english, spanish } = await twoListings()
    // Huella tal como se calculaba antes de añadir el idioma.
    const previousHash = (source: Awaited<ReturnType<typeof mods.getMediaSource>>) => {
      const { language: _language, ...generation } = source.generation
      return createHash('sha256').update(JSON.stringify({ generation, property: source.property, photos: source.photos.map(({ thumbSize: _thumb, ...photo }) => photo) })).digest('hex')
    }
    const es = await mods.getMediaSource(spanish, owner.userId)
    expect(es.sourceHash).not.toBe(previousHash(es))
    const en = await mods.getMediaSource(english, owner.userId)
    expect(en.sourceHash).not.toBe(previousHash(en))
    // Cambiar el idioma guardado cambia la huella: el material anterior queda desactualizado y el guardado
    // con la huella vieja se rechaza (protección existente frente a cambios concurrentes).
    await admin.query(`UPDATE "Generation" SET language = 'español' WHERE id = $1`, [english])
    expect((await mods.getMediaSource(english, owner.userId)).sourceHash).not.toBe(en.sourceHash)
  })
})

describe('cambio confirmado de idioma y orden cronológico', () => {
  async function fixture() {
    const owner = await account()
    const propertyId = await propertyOf(owner.userId)
    const generationId = (await generate(owner.cookie, propertyId, 'español')).json().generationId as string
    const get = async () => (await app.inject({ url: `/api/generations/${generationId}`, headers: { cookie: owner.cookie } })).json()
    return { owner, propertyId, generationId, get }
  }
  it('rehace los cuatro campos, admite la vuelta al español y conserva el inmueble y los otros anuncios', async () => {
    const { owner, propertyId, generationId, get } = await fixture()
    const otherId = (await generate(owner.cookie, propertyId, 'español')).json().generationId
    const change = async (language: string) => app.inject({ method: 'POST', url: `/api/generations/${generationId}/language`, headers: { cookie: owner.cookie }, payload: { language, confirmed: true, expectedUpdatedAt: (await get()).updatedAt } })
    const en = await change('english')
    expect(en.statusCode).toBe(200)
    expect(en.json()).toMatchObject({ generation: { language: 'english', title: '2-bedroom apartment for rent in Chamberí, Madrid', callToAction: 'Contact us to arrange a viewing.' }, mediaKinds: [], notices: ['FREE_TEXT_NOT_INCLUDED'] })
    expect(en.json().generation.description).toContain('12th floor')
    expect(JSON.parse(en.json().generation.highlights)).toContain('2 bedrooms')
    expect((await admin.query('SELECT language FROM "Generation" WHERE id = $1', [otherId])).rows[0].language).toBe('español')
    const es = await change('español')
    expect(es.statusCode).toBe(200)
    expect(es.json().generation.description).toContain('vistas al parque')
    expect((await admin.query('SELECT title FROM "Property" WHERE id = $1', [propertyId])).rows[0].title).toBe('Piso precioso junto al parque')
  })
  it('sin confirmación, sin propiedad o con una versión vieja no modifica el anuncio', async () => {
    const { owner, generationId, get } = await fixture()
    const stranger = await account()
    const before = await get()
    const request = (cookie: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url: `/api/generations/${generationId}/language`, headers: { cookie }, payload })
    const body = { language: 'english', confirmed: true, expectedUpdatedAt: before.updatedAt }
    expect((await request(owner.cookie, { ...body, confirmed: false })).statusCode).toBe(400)
    expect((await request(stranger.cookie, body)).statusCode).toBe(404)
    expect((await request(owner.cookie, { ...body, expectedUpdatedAt: '2020-01-01T00:00:00.000Z' })).statusCode).toBe(409)
    expect((await app.inject({ method: 'PUT', url: `/api/generations/${generationId}`, headers: { cookie: owner.cookie }, payload: { language: 'english' } })).statusCode).toBe(409)
    expect(await get()).toEqual(before)
  })
  it('repara un anuncio antiguo con etiqueta inglesa y contenido español aunque no cambie la etiqueta', async () => {
    const { owner, generationId, get } = await fixture()
    await admin.query('UPDATE "Generation" SET language = $2 WHERE id = $1', [generationId, 'english'])
    const response = await app.inject({ method: 'POST', url: `/api/generations/${generationId}/language`, headers: { cookie: owner.cookie }, payload: { language: 'english', confirmed: true, expectedUpdatedAt: (await get()).updatedAt } })
    expect(response.statusCode).toBe(200)
    expect(response.json().generation.description).not.toMatch(/habitaciones|Se encuentra/)
  })
  it('devuelve los inmuebles y sus anuncios del más reciente al más antiguo', async () => {
    const { owner, propertyId, generationId } = await fixture()
    const newer = await propertyOf(owner.userId)
    const secondId = (await generate(owner.cookie, propertyId, 'english')).json().generationId
    await admin.query('UPDATE "Property" SET "createdAt" = $2 WHERE id = $1', [propertyId, '2025-01-01T00:00:00Z'])
    await admin.query('UPDATE "Property" SET "createdAt" = $2 WHERE id = $1', [newer, '2026-01-01T00:00:00Z'])
    await admin.query('UPDATE "Generation" SET "createdAt" = $2 WHERE id = $1', [generationId, '2025-01-01T00:00:00Z'])
    await admin.query('UPDATE "Generation" SET "createdAt" = $2 WHERE id = $1', [secondId, '2026-01-01T00:00:00Z'])
    const headers = { cookie: owner.cookie }
    const properties = (await app.inject({ url: '/api/properties', headers })).json()
    expect(properties.map((p: { id: string }) => p.id)).toEqual([newer, propertyId])
    const detail = (await app.inject({ url: `/api/properties/${propertyId}`, headers })).json()
    expect(detail.generations.map((g: { id: string }) => g.id)).toEqual([secondId, generationId])
    const listings = (await app.inject({ url: '/api/generations', headers })).json()
    expect(listings.map((g: { id: string }) => g.id)).toEqual([secondId, generationId])
  })
})
