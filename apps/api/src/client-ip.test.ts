import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import rateLimit from '@fastify/rate-limit'
import Fastify from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'

import { ClientIpConfigError, clientIpOf, configureClientIp, readClientIpSource, requestClientIp, singleIp } from './client-ip.js'

// MD-4 (DA-57): de dónde sale la IP del cliente para el rate-limit y Turnstile. Pruebas locales: la
// IP que llega de verdad a través de Vercel solo puede comprobarse en un despliegue (pendiente).

afterEach(() => {
  configureClientIp({})
})

describe('configuración de CLIENT_IP_SOURCE', () => {
  it('por defecto (y con «socket») se usa la dirección del socket', () => {
    expect(readClientIpSource({})).toBe('socket')
    expect(readClientIpSource({ CLIENT_IP_SOURCE: ' Socket ' })).toBe('socket')
  })

  it('«vercel» solo se admite dentro de Vercel; cualquier otro valor impide arrancar', () => {
    expect(readClientIpSource({ CLIENT_IP_SOURCE: 'vercel', VERCEL: '1' })).toBe('vercel')
    expect(() => readClientIpSource({ CLIENT_IP_SOURCE: 'vercel' })).toThrow(ClientIpConfigError)
    expect(() => readClientIpSource({ CLIENT_IP_SOURCE: 'vercel', VERCEL: 'true' })).toThrow(ClientIpConfigError)
    for (const value of ['x-forwarded-for', 'true', '1', 'proxy', 'trust']) expect(() => readClientIpSource({ CLIENT_IP_SOURCE: value })).toThrow(ClientIpConfigError)
  })
})

describe('validación de la IP', () => {
  it.each([
    ['203.0.113.7', '203.0.113.7'],
    ['  198.51.100.1 ', '198.51.100.1'],
    ['2001:DB8::1', '2001:db8::1'],
    ['::1', '::1'],
    ['::ffff:192.0.2.10', '192.0.2.10'],
  ])('acepta %s como %s', (value, expected) => {
    expect(singleIp(value)).toBe(expected)
  })

  it.each([undefined, '', '   ', 'no-es-una-ip', '999.1.1.1', '1.2.3.4, 5.6.7.8', '1.2.3.4,', 'unknown', '1.2.3.4:443', 'x'.repeat(100)])('rechaza %s', value => {
    expect(singleIp(value)).toBeNull()
  })

  it('rechaza una cabecera repetida (varias instancias)', () => {
    expect(singleIp(['1.2.3.4', '5.6.7.8'])).toBeNull()
    expect(singleIp(['1.2.3.4'])).toBe('1.2.3.4')
  })
})

describe('IP del cliente', () => {
  const request = (headers: Record<string, string | string[]>, ip = '203.0.113.9') => ({ ip, headers })

  it('modo socket: ignora X-Forwarded-For, X-Real-IP y X-Vercel-Forwarded-For enviadas por el cliente', () => {
    expect(clientIpOf(request({ 'x-forwarded-for': '1.2.3.4', 'x-vercel-forwarded-for': '5.6.7.8', 'x-real-ip': '9.9.9.9' }), 'socket')).toBe('203.0.113.9')
    expect(clientIpOf(request({}, '::1'), 'socket')).toBe('::1')
  })

  it('modo vercel: usa solo X-Vercel-Forwarded-For con una IP válida (IPv4 o IPv6)', () => {
    expect(clientIpOf(request({ 'x-vercel-forwarded-for': '198.51.100.7' }), 'vercel')).toBe('198.51.100.7')
    expect(clientIpOf(request({ 'x-vercel-forwarded-for': '2001:db8::42' }), 'vercel')).toBe('2001:db8::42')
  })

  it('modo vercel: X-Forwarded-For no se tiene en cuenta; sin cabecera válida, el socket (fallo seguro)', () => {
    expect(clientIpOf(request({ 'x-forwarded-for': '198.51.100.8' }), 'vercel')).toBe('203.0.113.9')
    expect(clientIpOf(request({ 'x-vercel-forwarded-for': '198.51.100.8, 10.0.0.1' }), 'vercel')).toBe('203.0.113.9')
    expect(clientIpOf(request({ 'x-vercel-forwarded-for': 'falsa' }), 'vercel')).toBe('203.0.113.9')
    expect(clientIpOf(request({ 'x-vercel-forwarded-for': '' }), 'vercel')).toBe('203.0.113.9')
    expect(clientIpOf(request({}), 'vercel')).toBe('203.0.113.9')
  })
})

describe('rate-limit con requestClientIp', () => {
  async function appWith(env: NodeJS.ProcessEnv) {
    configureClientIp(env)
    const app = Fastify()
    await app.register(rateLimit, { global: false, max: 2, timeWindow: '1 minute', keyGenerator: requestClientIp })
    app.get('/x', { config: { rateLimit: { max: 2, timeWindow: '1 minute' } } }, async () => ({ ok: true }))
    await app.ready()
    return app
  }

  it('desarrollo: cambiar X-Forwarded-For o X-Vercel-Forwarded-For no da cupo nuevo', async () => {
    const app = await appWith({})
    const statuses = []
    for (let i = 0; i < 4; i += 1) statuses.push((await app.inject({ url: '/x', headers: { 'x-forwarded-for': `198.51.100.${i}`, 'x-vercel-forwarded-for': `198.51.100.${i}` } })).statusCode)
    expect(statuses).toEqual([200, 200, 429, 429])
    await app.close()
  })

  it('Vercel (entorno simulado): cada cliente que identifica Vercel tiene su propio cupo', async () => {
    const app = await appWith({ CLIENT_IP_SOURCE: 'vercel', VERCEL: '1' })
    const a = []
    const b = []
    for (let i = 0; i < 3; i += 1) {
      a.push((await app.inject({ url: '/x', headers: { 'x-vercel-forwarded-for': '198.51.100.1' } })).statusCode)
      b.push((await app.inject({ url: '/x', headers: { 'x-vercel-forwarded-for': '2001:db8::2' } })).statusCode)
    }
    expect(a).toEqual([200, 200, 429])
    expect(b).toEqual([200, 200, 429])
    await app.close()
  })

  it('Vercel (entorno simulado): X-Forwarded-For manipulada no cambia el cupo', async () => {
    const app = await appWith({ CLIENT_IP_SOURCE: 'vercel', VERCEL: '1' })
    const statuses = []
    for (let i = 0; i < 3; i += 1) statuses.push((await app.inject({ url: '/x', headers: { 'x-vercel-forwarded-for': '198.51.100.9', 'x-forwarded-for': `10.0.0.${i}` } })).statusCode)
    expect(statuses).toEqual([200, 200, 429])
    await app.close()
  })
})

describe('coherencia entre rate-limit y Turnstile', () => {
  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return entry.name === 'generated' ? [] : sources(path)
      return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : []
    })

  it('ningún código de producción usa request.ip directamente: todo pasa por requestClientIp', () => {
    const offenders = sources(import.meta.dirname).filter(file => !file.endsWith('client-ip.ts') && /request\.ip\b|request\.ips\b/.test(readFileSync(file, 'utf8')))
    expect(offenders).toEqual([])
  })

  it('Turnstile recibe la misma IP que el rate-limit', () => {
    const auth = readFileSync(join(import.meta.dirname, 'routes', 'auth.routes.ts'), 'utf8')
    const calls = auth.match(/requireTurnstile\([^)]*\)/g) ?? []
    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls.filter(text => !text.includes('token: string'))) expect(call).toContain('requestClientIp(request)')
    const app = readFileSync(join(import.meta.dirname, 'app.ts'), 'utf8')
    expect(app).toContain('keyGenerator: requestClientIp')
  })
})
