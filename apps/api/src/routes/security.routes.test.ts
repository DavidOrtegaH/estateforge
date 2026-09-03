import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { FastifyInstance } from 'fastify'

import { buildApp } from '../app.js'

describe('API security validation', () => {
  let app: FastifyInstance

  before(async () => {
    app = await buildApp()
  })

  after(async () => {
    await app.close()
  })

  describe('Security headers', () => {
    it('incluye los headers de seguridad esperados', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      })

      assert.equal(response.statusCode, 200)

      assert.equal(
        response.headers['x-content-type-options'],
        'nosniff',
      )

      assert.equal(
        response.headers['x-frame-options'],
        'DENY',
      )

      assert.equal(
        response.headers['referrer-policy'],
        'strict-origin-when-cross-origin',
      )

      assert.equal(
        response.headers['permissions-policy'],
        'camera=(), microphone=(), geolocation=()',
      )
    })
  })

  describe('POST /api/generations', () => {
    it('rechaza datos con tipos incorrectos', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/generations',
        payload: {
          property: {
            title: 'Piso de prueba',
            operation: 'sale',
            type: 'apartment',
            price: '250000',
            address: 'Calle Falsa 123',
            city: 'Madrid',
            neighborhood: 'Centro',
            area: 80,
            bedrooms: 2,
            bathrooms: 1,
            floor: 3,
            condition: 'good',
            elevator: true,
            terrace: false,
            balcony: false,
            garage: false,
            storageRoom: false,
            pool: false,
            garden: false,
            airConditioning: true,
            heating: true,
            additionalInformation: '',
          },
          provider: 'mock',
          tone: 'professional',
          language: 'español',
        },
      })

      assert.equal(response.statusCode, 400)
    })

    it('rechaza campos desconocidos', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/generations',
        payload: {
          property: {
            title: 'Piso de prueba',
            operation: 'sale',
            type: 'apartment',
            price: 250000,
            address: 'Calle Falsa 123',
            city: 'Madrid',
            neighborhood: 'Centro',
            area: 80,
            bedrooms: 2,
            bathrooms: 1,
            floor: 3,
            condition: 'good',
            elevator: true,
            terrace: false,
            balcony: false,
            garage: false,
            storageRoom: false,
            pool: false,
            garden: false,
            airConditioning: true,
            heating: true,
            additionalInformation: '',
            unexpectedField: 'malicious-value',
          },
          provider: 'mock',
          tone: 'professional',
          language: 'español',
        },
      })

      assert.equal(response.statusCode, 400)
    })

    it('rechaza un provider no permitido', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/generations',
        payload: {
          property: {
            title: 'Piso de prueba',
            operation: 'sale',
            type: 'apartment',
            price: 250000,
            address: 'Calle Falsa 123',
            city: 'Madrid',
            neighborhood: 'Centro',
            area: 80,
            bedrooms: 2,
            bathrooms: 1,
            floor: 3,
            condition: 'good',
            elevator: true,
            terrace: false,
            balcony: false,
            garage: false,
            storageRoom: false,
            pool: false,
            garden: false,
            airConditioning: true,
            heating: true,
            additionalInformation: '',
          },
          provider: 'malicious-provider',
          tone: 'professional',
          language: 'español',
        },
      })

      assert.equal(response.statusCode, 400)
    })
  })

  describe('GET /api/generations/:id', () => {
    it('rechaza un ID que no es un CUID válido', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/generations/not-a-valid-cuid',
      })

      assert.equal(response.statusCode, 400)
    })

    it('rechaza un ID con contenido de SQL injection', async () => {
      const response = await app.inject({
        method: 'GET',
        url: "/api/generations/' OR 1=1 --",
      })

      assert.equal(response.statusCode, 400)
    })
  })

  describe('PUT /api/generations/:id', () => {
    it('rechaza un ID inválido antes de consultar Prisma', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/generations/not-a-valid-cuid',
        payload: {
          title: 'Título modificado',
        },
      })

      assert.equal(response.statusCode, 400)
    })

    it('rechaza un body con campos desconocidos', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/generations/not-a-valid-cuid',
        payload: {
          title: 'Título modificado',
          maliciousField: 'DROP TABLE generations',
        },
      })

      assert.equal(response.statusCode, 400)
    })
  })

  describe('DELETE /api/generations/:id', () => {
    it('rechaza un ID inválido', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/generations/not-a-valid-cuid',
      })

      assert.equal(response.statusCode, 400)
    })
  })

  describe('DELETE /api/generations', () => {
    it('rechaza un bulk delete sin IDs', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/generations',
        payload: {
          ids: [],
        },
      })

      assert.equal(response.statusCode, 400)
    })

    it('rechaza más de 100 IDs en bulk delete', async () => {
      const ids = Array.from(
        { length: 101 },
        () => 'not-a-valid-cuid',
      )

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/generations',
        payload: {
          ids,
        },
      })

      assert.equal(response.statusCode, 400)
    })
  })

  describe('GET /api/properties/:id', () => {
    it('rechaza un ID que no es un CUID válido', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/properties/not-a-valid-cuid',
      })

      assert.equal(response.statusCode, 400)
    })

    it('rechaza un ID con contenido de SQL injection', async () => {
      const response = await app.inject({
        method: 'GET',
        url: "/api/properties/' OR 1=1 --",
      })

      assert.equal(response.statusCode, 400)
    })
  })

  describe('PUT /api/properties/:id', () => {
    it('rechaza un ID inválido antes de consultar Prisma', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/properties/not-a-valid-cuid',
        payload: {
          title: 'Propiedad modificada',
        },
      })

      assert.equal(response.statusCode, 400)
    })

    it('rechaza un body con campos desconocidos', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/properties/not-a-valid-cuid',
        payload: {
          title: 'Propiedad modificada',
          maliciousField: 'DROP TABLE properties',
        },
      })

      assert.equal(response.statusCode, 400)
    })
  })

  describe('DELETE /api/properties/:id', () => {
    it('rechaza un ID inválido', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/properties/not-a-valid-cuid',
      })

      assert.equal(response.statusCode, 400)
    })
  })

  describe('DELETE /api/properties', () => {
    it('rechaza un bulk delete sin IDs', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/properties',
        payload: {
          ids: [],
        },
      })

      assert.equal(response.statusCode, 400)
    })

    it('rechaza más de 100 IDs en bulk delete', async () => {
      const ids = Array.from(
        { length: 101 },
        () => 'not-a-valid-cuid',
      )

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/properties',
        payload: {
          ids,
        },
      })

      assert.equal(response.statusCode, 400)
    })
  })
})