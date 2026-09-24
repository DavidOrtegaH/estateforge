const MIN_PASSWORD_LENGTH = 12
const MAX_PASSWORD_LENGTH = 128

export function getPasswordValidationErrors(
  password: string,
): string[] {
  const errors: string[] = []

  if (password.length < MIN_PASSWORD_LENGTH) {
    errors.push(`Debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`)
  }

  if (password.length > MAX_PASSWORD_LENGTH) {
    errors.push(`No puede superar los ${MAX_PASSWORD_LENGTH} caracteres.`)
  }

  if (!/\p{Ll}/u.test(password)) {
    errors.push('Debe incluir al menos una letra minúscula.')
  }

  if (!/\p{Lu}/u.test(password)) {
    errors.push('Debe incluir al menos una letra mayúscula.')
  }

  if (!/\p{N}/u.test(password)) {
    errors.push('Debe incluir al menos un número.')
  }

  if (!/[^\p{L}\p{N}\s]/u.test(password)) {
    errors.push('Debe incluir al menos un carácter especial.')
  }

  return errors
}

export { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH }
