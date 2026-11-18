import { renderToStaticMarkup } from 'react-dom/server'
import { createMemoryRouter, MemoryRouter, type Location } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { AuthContext, type AuthContextValue } from '@/contexts/authContext'
import {
  goToLoginAfterPasswordReset,
  isPasswordResetCompleted,
  submitPasswordReset,
} from '@/lib/passwordReset'
import { loginRedirectState } from '@/lib/sessionAccess'

import LoginPage from './LoginPage'
import ResetPasswordPage from './ResetPasswordPage'

// Flujo «Restablecer contraseña» → login con el router real de react-router en memoria y el
// LoginPage real renderizado. El proyecto no tiene entorno DOM (ni testing-library), así que
// no se pulsa el botón del formulario: se ejecuta la misma secuencia que su envío
// (submitPasswordReset y, si va bien, goToLoginAfterPasswordReset con el navigate del router).

const TOKEN = 'token-de-un-solo-uso-123'
const PASSWORD = 'NuevaClave#2026'
const EMAIL = 'titular@estateforge.test'

function makeRouter() {
  return createMemoryRouter(
    [
      { path: '/login', element: <LoginPage /> },
      { path: '/restablecer-contrasena', element: <ResetPasswordPage /> },
      { path: '/recuperar-contrasena', element: null },
    ],
    { initialEntries: ['/recuperar-contrasena', `/restablecer-contrasena?token=${TOKEN}`] },
  )
}

// Misma secuencia que handleSubmit de ResetPasswordPage.
async function submitLikeThePage(
  router: ReturnType<typeof makeRouter>,
  values: { password: string; confirmPassword: string; turnstileRequired?: boolean; turnstileToken?: string },
  reset: (token: string, password: string, turnstileToken?: string) => Promise<unknown>,
) {
  const token = new URLSearchParams(router.state.location.search).get('token') ?? ''
  const result = await submitPasswordReset({
    token,
    password: values.password,
    confirmPassword: values.confirmPassword,
    turnstileRequired: values.turnstileRequired ?? false,
    turnstileToken: values.turnstileToken,
    reset,
  })
  if (result.ok) goToLoginAfterPasswordReset((to, options) => router.navigate(to, options))
  return result
}

const auth: AuthContextValue = {
  user: null,
  loading: false,
  sessionEndedReason: null,
  login: vi.fn(async () => {}),
  register: vi.fn(),
  logout: vi.fn(),
  changePassword: vi.fn(),
  deleteAccount: vi.fn(),
  updateEmail: vi.fn(),
}

function renderLogin(entry: string | Partial<Location>) {
  return renderToStaticMarkup(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[entry]}>
        <LoginPage />
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

const RESET_NOTICE = 'Contraseña restablecida.'

describe('restablecer contraseña → login', () => {
  it('al restablecer bien va al login reemplazando el enlace con el token y muestra la confirmación', async () => {
    const router = makeRouter()
    const reset = vi.fn(async () => 'Mensaje de la API')

    const result = await submitLikeThePage(router, { password: PASSWORD, confirmPassword: PASSWORD }, reset)

    expect(result).toEqual({ ok: true })
    expect(reset).toHaveBeenCalledWith(TOKEN, PASSWORD, undefined)

    const location = router.state.location
    expect(location.pathname).toBe('/login')
    expect(location.search).toBe('')
    expect(router.state.historyAction).toBe('REPLACE')
    // Estado cerrado: solo el booleano; nada del token, el email, la contraseña ni la API.
    expect(location.state).toEqual({ passwordReset: true })
    const serialized = JSON.stringify(location) + router.createHref(location)
    for (const secret of [TOKEN, PASSWORD, EMAIL, 'Mensaje de la API']) {
      expect(serialized).not.toContain(secret)
    }

    // «Atrás» vuelve a la página anterior al enlace, no al enlace con el token.
    await router.navigate(-1)
    expect(router.state.location.pathname).toBe('/recuperar-contrasena')

    const html = renderLogin(location)
    expect(html).toContain('role="status"')
    expect(html).toContain(RESET_NOTICE)
    expect(html).not.toContain('Se ha cerrado tu sesión.')
    // No se inicia sesión automáticamente.
    expect(auth.login).not.toHaveBeenCalled()
  })

  it.each([
    ['la API rechaza el token', { password: PASSWORD, confirmPassword: PASSWORD }, async () => { throw new Error('El enlace no es válido o ha caducado.') }, 'El enlace no es válido o ha caducado.'],
    ['fallo de red sin Error', { password: PASSWORD, confirmPassword: PASSWORD }, async () => { throw 'x' }, 'No se ha podido restablecer la contraseña.'],
    ['contraseña débil', { password: 'corta', confirmPassword: 'corta' }, async () => {}, 'Debe tener al menos 12 caracteres.'],
    ['no coinciden', { password: PASSWORD, confirmPassword: `${PASSWORD}x` }, async () => {}, 'Las contraseñas no coinciden.'],
    ['falta la verificación de seguridad', { password: PASSWORD, confirmPassword: PASSWORD, turnstileRequired: true }, async () => {}, 'Completa la verificación de seguridad e inténtalo de nuevo.'],
  ])('si %s se queda en el formulario con el error', async (_case, values, impl, error) => {
    const router = makeRouter()
    const result = await submitLikeThePage(router, values, vi.fn(impl))

    expect(result).toEqual({ ok: false, error })
    expect(router.state.location.pathname).toBe('/restablecer-contrasena')
    expect(router.state.location.search).toBe(`?token=${TOKEN}`)
  })

  it('sin token en el enlace no llama a la API ni redirige', async () => {
    const router = createMemoryRouter(
      [{ path: '/restablecer-contrasena', element: null }, { path: '/login', element: null }],
      { initialEntries: ['/restablecer-contrasena'] },
    )
    const reset = vi.fn(async () => {})
    const result = await submitLikeThePage(router, { password: PASSWORD, confirmPassword: PASSWORD }, reset)

    expect(result).toEqual({ ok: false, error: 'El enlace de recuperación no contiene un token válido.' })
    expect(reset).not.toHaveBeenCalled()
    expect(router.state.location.pathname).toBe('/restablecer-contrasena')
  })
})

describe('avisos del login', () => {
  it('un login normal no muestra ningún aviso', () => {
    const html = renderLogin('/login')
    expect(html).not.toContain(RESET_NOTICE)
    expect(html).not.toContain('Se ha cerrado tu sesión.')
  })

  it('solo el booleano exacto activa la confirmación', () => {
    expect(isPasswordResetCompleted({ passwordReset: true })).toBe(true)
    for (const state of [null, undefined, 'passwordReset', { passwordReset: 'true' }, { passwordReset: 1 }, {}]) {
      expect(isPasswordResetCompleted(state)).toBe(false)
    }
    expect(renderLogin({ pathname: '/login', state: { passwordReset: 'true' } })).not.toContain(RESET_NOTICE)
  })

  it('el aviso de sesión cerrada desde una ruta privada sigue igual', () => {
    const reason = 'La cuenta está protegida temporalmente.'
    const html = renderLogin({ pathname: '/login', state: loginRedirectState({ pathname: '/inmuebles' }, reason) })
    expect(html).toContain('role="alert"')
    expect(html).toContain('Se ha cerrado tu sesión.')
    expect(html).toContain(reason)
    expect(html).not.toContain(RESET_NOTICE)
  })

  it('la redirección al login sin motivo no muestra avisos', () => {
    const html = renderLogin({ pathname: '/login', state: loginRedirectState({ pathname: '/inmuebles' }, null) })
    expect(html).not.toContain('Se ha cerrado tu sesión.')
    expect(html).not.toContain(RESET_NOTICE)
  })
})
