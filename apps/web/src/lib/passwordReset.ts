import { getPasswordValidationErrors } from '@/lib/passwordPolicy'

// Flujo de «Restablecer contraseña» y el aviso que ve el login al llegar tras un cambio
// correcto. Funciones puras para probarlas sin DOM (el proyecto no tiene entorno DOM).

/**
 * Estado de navegación cerrado con el que se llega al login tras restablecer la contraseña.
 * Solo un booleano: ni el token, ni el email, ni la contraseña, ni texto de la API.
 */
export interface PasswordResetLoginState {
  passwordReset: true
}

export const PASSWORD_RESET_LOGIN_STATE: PasswordResetLoginState = Object.freeze({
  passwordReset: true,
})

/** Si el login debe confirmar que la contraseña se ha restablecido. */
export function isPasswordResetCompleted(state: unknown): boolean {
  return (
    typeof state === 'object' &&
    state !== null &&
    (state as { passwordReset?: unknown }).passwordReset === true
  )
}

/**
 * Tras un cambio correcto va al login reemplazando la entrada actual: el enlace con el token
 * sale del historial y no se puede volver a él con «Atrás».
 */
export function goToLoginAfterPasswordReset(
  navigate: (to: string, options: { replace: true; state: PasswordResetLoginState }) => unknown,
): void {
  void navigate('/login', { replace: true, state: PASSWORD_RESET_LOGIN_STATE })
}

export type PasswordResetSubmitResult =
  | { ok: true }
  | { ok: false; error: string }

/**
 * Valida en local y llama a la API. Si todo va bien devuelve { ok: true } y la página
 * redirige al login; cualquier fallo devuelve el error para mostrarlo en el formulario.
 */
export async function submitPasswordReset(input: {
  token: string
  password: string
  confirmPassword: string
  turnstileRequired: boolean
  turnstileToken: string | undefined
  reset: (token: string, password: string, turnstileToken?: string) => Promise<unknown>
}): Promise<PasswordResetSubmitResult> {
  if (input.turnstileRequired && !input.turnstileToken) {
    return { ok: false, error: 'Completa la verificación de seguridad e inténtalo de nuevo.' }
  }

  if (!input.token) {
    return { ok: false, error: 'El enlace de recuperación no contiene un token válido.' }
  }

  const validationErrors = getPasswordValidationErrors(input.password)
  if (validationErrors.length > 0) {
    return { ok: false, error: validationErrors[0] }
  }

  if (input.password !== input.confirmPassword) {
    return { ok: false, error: 'Las contraseñas no coinciden.' }
  }

  try {
    await input.reset(input.token, input.password, input.turnstileToken)
    return { ok: true }
  } catch (resetError) {
    return {
      ok: false,
      error:
        resetError instanceof Error
          ? resetError.message
          : 'No se ha podido restablecer la contraseña.',
    }
  }
}
