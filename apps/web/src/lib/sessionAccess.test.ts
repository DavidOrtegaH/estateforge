import { describe, expect, it } from 'vitest'

import { SessionBlockedError } from '@/services/authService'

import {
  loginRedirectState,
  protectedRouteDecision,
  sessionEndedNotice,
  sessionEndedReasonFrom,
} from './sessionAccess'

// Lógica pura de AuthProvider, ProtectedRoute y LoginPage. No renderiza componentes: el
// proyecto no tiene entorno DOM, así que el comportamiento visual se prueba a mano.

const SECURITY_HOLD_MESSAGE =
  'La cuenta está protegida temporalmente. Contacta con soporte para verificar su titularidad.'
const user = { id: 'u1', email: 'titular@estateforge.test', role: 'USER' as const }

describe('sessionEndedReasonFrom (AuthProvider)', () => {
  it('conserva el motivo cuando la API cerró la sesión (423)', () => {
    expect(sessionEndedReasonFrom(new SessionBlockedError(SECURITY_HOLD_MESSAGE))).toBe(SECURITY_HOLD_MESSAGE)
  })

  it('no inventa un motivo para otros fallos al cargar la sesión', () => {
    expect(sessionEndedReasonFrom(new Error('Failed to load session: 500'))).toBeNull()
    expect(sessionEndedReasonFrom(new TypeError('Failed to fetch'))).toBeNull()
    expect(sessionEndedReasonFrom('texto')).toBeNull()
    expect(sessionEndedReasonFrom(undefined)).toBeNull()
  })
})

describe('protectedRouteDecision (ProtectedRoute)', () => {
  it('mientras se carga la sesión no deja ver contenido privado', () => {
    expect(protectedRouteDecision({ loading: true, user: null, sessionEndedReason: null })).toEqual({ kind: 'loading' })
    expect(protectedRouteDecision({ loading: true, user, sessionEndedReason: null })).toEqual({ kind: 'loading' })
  })

  it('con la cuenta protegida no muestra contenido privado: redirige con el motivo', () => {
    expect(protectedRouteDecision({ loading: false, user: null, sessionEndedReason: SECURITY_HOLD_MESSAGE }))
      .toEqual({ kind: 'redirect', sessionEndedReason: SECURITY_HOLD_MESSAGE })
  })

  it('sin sesión por otra causa redirige sin motivo', () => {
    expect(protectedRouteDecision({ loading: false, user: null, sessionEndedReason: null }))
      .toEqual({ kind: 'redirect', sessionEndedReason: null })
  })

  it('con sesión válida deja pasar', () => {
    expect(protectedRouteDecision({ loading: false, user, sessionEndedReason: null })).toEqual({ kind: 'allow' })
  })
})

describe('loginRedirectState (redirección al login)', () => {
  const from = { pathname: '/inmuebles' }

  it('conserva el motivo y la ruta de origen', () => {
    expect(loginRedirectState(from, SECURITY_HOLD_MESSAGE)).toEqual({ from, sessionEndedReason: SECURITY_HOLD_MESSAGE })
  })

  it('sin motivo solo lleva la ruta de origen, como antes', () => {
    expect(loginRedirectState(from, null)).toEqual({ from })
  })

  it('el login lee el mismo motivo que se envió', () => {
    expect(sessionEndedNotice(loginRedirectState(from, SECURITY_HOLD_MESSAGE))).toBe(SECURITY_HOLD_MESSAGE)
    expect(sessionEndedNotice(loginRedirectState(from, null))).toBeNull()
  })
})

describe('sessionEndedNotice (LoginPage)', () => {
  it('muestra el motivo recibido tal cual', () => {
    expect(sessionEndedNotice({ from: { pathname: '/' }, sessionEndedReason: SECURITY_HOLD_MESSAGE })).toBe(SECURITY_HOLD_MESSAGE)
  })

  it('en una navegación normal no hay aviso', () => {
    expect(sessionEndedNotice(null)).toBeNull()
    expect(sessionEndedNotice(undefined)).toBeNull()
    expect(sessionEndedNotice({ from: { pathname: '/cuenta' } })).toBeNull()
  })

  it('descarta estados que no traen un motivo válido', () => {
    expect(sessionEndedNotice({ sessionEndedReason: '' })).toBeNull()
    expect(sessionEndedNotice({ sessionEndedReason: '   ' })).toBeNull()
    expect(sessionEndedNotice({ sessionEndedReason: 423 })).toBeNull()
    expect(sessionEndedNotice('texto')).toBeNull()
  })

  it('con una ruta de origen interna y un motivo devuelve el motivo original, sin recortarlo', () => {
    expect(sessionEndedNotice({ from: { pathname: '/inmuebles/33' }, sessionEndedReason: SECURITY_HOLD_MESSAGE })).toBe(SECURITY_HOLD_MESSAGE)
    expect(sessionEndedNotice({ from: { pathname: '/' }, sessionEndedReason: `  ${SECURITY_HOLD_MESSAGE} ` })).toBe(`  ${SECURITY_HOLD_MESSAGE} `)
  })

  it('un motivo válido sin ruta de origen no muestra aviso', () => {
    expect(sessionEndedNotice({ sessionEndedReason: SECURITY_HOLD_MESSAGE })).toBeNull()
    expect(sessionEndedNotice({ from: null, sessionEndedReason: SECURITY_HOLD_MESSAGE })).toBeNull()
    expect(sessionEndedNotice({ from: undefined, sessionEndedReason: SECURITY_HOLD_MESSAGE })).toBeNull()
  })

  it('una ruta de origen sin pathname no muestra aviso', () => {
    expect(sessionEndedNotice({ from: {}, sessionEndedReason: SECURITY_HOLD_MESSAGE })).toBeNull()
    expect(sessionEndedNotice({ from: { search: '?q=1' }, sessionEndedReason: SECURITY_HOLD_MESSAGE })).toBeNull()
  })

  it.each([undefined, null, 42, true, ['/'], { value: '/' }])('un pathname que no es texto (%j) no muestra aviso', (pathname) => {
    expect(sessionEndedNotice({ from: { pathname }, sessionEndedReason: SECURITY_HOLD_MESSAGE })).toBeNull()
  })

  it.each(['', 'inmuebles', ' /inmuebles', 'https://otro.example/x', '//otro.example/x'])('un pathname que no es una ruta interna (%j) no muestra aviso', (pathname) => {
    expect(sessionEndedNotice({ from: { pathname }, sessionEndedReason: SECURITY_HOLD_MESSAGE })).toBeNull()
  })

  it('una ruta interna válida sin motivo no muestra aviso', () => {
    expect(sessionEndedNotice({ from: { pathname: '/cuenta' } })).toBeNull()
    expect(sessionEndedNotice({ from: { pathname: '/cuenta' }, sessionEndedReason: null })).toBeNull()
    expect(sessionEndedNotice({ from: { pathname: '/cuenta' }, sessionEndedReason: 423 })).toBeNull()
  })

  it('una ruta interna válida con un motivo vacío o de solo espacios no muestra aviso', () => {
    expect(sessionEndedNotice({ from: { pathname: '/cuenta' }, sessionEndedReason: '' })).toBeNull()
    expect(sessionEndedNotice({ from: { pathname: '/cuenta' }, sessionEndedReason: '   ' })).toBeNull()
    expect(sessionEndedNotice({ from: { pathname: '/cuenta' }, sessionEndedReason: '\n\t' })).toBeNull()
  })

  it.each([null, undefined, 'texto', 423, true, Symbol('estado')])('un estado nulo, indefinido o primitivo (%s) no muestra aviso', (state) => {
    expect(sessionEndedNotice(state)).toBeNull()
  })
})
