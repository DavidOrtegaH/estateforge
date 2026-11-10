import { describe, expect, it } from 'vitest'

import { deliveryStateFields, OTHER_ERROR_CODE, safeDeliveryErrorFields, safeErrorFields, safeErrorName } from './log-safety.js'

// Corrección A de la Fase 1: del error solo salen campos cerrados (nombre, código y código de
// respuesta SMTP); nunca el mensaje, la respuesta, los destinatarios ni otras propiedades.
describe('safeErrorFields', () => {
  const EMAIL = 'titular@estateforge.test'
  const TOKEN = 'a'.repeat(64)

  it('de un error SMTP de nodemailer solo deja el nombre, el código y el código de respuesta', () => {
    const error = Object.assign(new Error(`Invalid login: 535 5.7.8 <${EMAIL}> https://app.test/verificar-email?token=${TOKEN}`), {
      code: 'EAUTH',
      response: `535 5.7.8 <${EMAIL}> authentication failed`,
      responseCode: 535,
      command: 'AUTH PLAIN',
      rejected: [EMAIL],
      rejectedErrors: [new Error(EMAIL)],
    })

    const fields = safeErrorFields(error)

    expect(fields).toEqual({ errorName: 'Error', errorCode: 'EAUTH', smtpResponseCode: 535 })
    const serialized = JSON.stringify(fields)
    for (const secret of [EMAIL, TOKEN, 'Invalid login', '5.7.8', 'AUTH PLAIN', 'verificar-email']) {
      expect(serialized).not.toContain(secret)
    }
  })

  it('de un error de Prisma deja el nombre de la clase y el código Pxxxx, sin meta ni mensaje', () => {
    class PrismaClientKnownRequestError extends Error {
      override name = 'PrismaClientKnownRequestError'
      code = 'P2002'
      meta = { target: ['email'], driverAdapterError: EMAIL }
    }

    const fields = safeErrorFields(new PrismaClientKnownRequestError(`Unique constraint failed on email ${EMAIL}`))

    expect(fields).toEqual({ errorName: 'PrismaClientKnownRequestError', errorCode: 'P2002' })
    expect(JSON.stringify(fields)).not.toContain(EMAIL)
  })

  it.each([
    ['un código con texto libre', { code: `550 ${EMAIL}` }],
    ['un código en minúsculas', { code: 'eauth' }],
    ['un código demasiado largo', { code: `E${'A'.repeat(40)}` }],
    ['un código con formato válido pero desconocido', { code: 'ABC123' }],
    ['un hash en mayúsculas con forma de código', { code: 'A'.repeat(32) }],
  ])('sustituye %s por el valor genérico', (_label, extra) => {
    expect(safeErrorFields(Object.assign(new Error('x'), extra))).toEqual({ errorName: 'Error', errorCode: OTHER_ERROR_CODE })
  })

  it('un código que no es texto no se registra', () => {
    expect(safeErrorFields(Object.assign(new Error('x'), { code: 535 }))).toEqual({ errorName: 'Error' })
  })

  it.each([
    ['un hash hexadecimal', 'a'.repeat(64)],
    ['un identificador con datos', 'titular_estateforge_test'],
    ['un nombre con formato válido pero desconocido', 'CustomError'],
  ])('un nombre de error que es %s se sustituye por «Error»', (_label, name) => {
    const error = new Error('x')
    error.name = name

    expect(safeErrorName(error)).toBe('Error')
    expect(safeErrorFields(error)).toEqual({ errorName: 'Error' })
  })

  it.each(['TypeError', 'PrismaClientKnownRequestError', 'DriverAdapterError', 'LibsqlError'])('conserva el nombre conocido %s', name => {
    const error = new Error('x')
    error.name = name

    expect(safeErrorName(error)).toBe(name)
  })

  it.each(['EAUTH', 'EENVELOPE', 'ESOCKET', 'P2002', 'P2034', 'ERR_INVALID_URL'])('conserva el código conocido %s', code => {
    expect(safeErrorFields(Object.assign(new Error('x'), { code })).errorCode).toBe(code)
  })

  describe('estado del envío', () => {
    it.each(['ETIMEDOUT', 'ESOCKET', 'ECONNECTION'])('una conexión perdida sin respuesta (%s) queda como no confirmada', code => {
      expect(deliveryStateFields(Object.assign(new Error('x'), { code }))).toEqual({ deliveryState: 'unconfirmed' })
    })

    it('con una respuesta del servidor el resultado es conocido', () => {
      expect(deliveryStateFields(Object.assign(new Error('x'), { code: 'ECONNECTION', responseCode: 421 }))).toEqual({})
      expect(deliveryStateFields(Object.assign(new Error('x'), { code: 'EENVELOPE', responseCode: 550 }))).toEqual({})
    })

    it.each([
      ['un error de Prisma', Object.assign(new Error('x'), { code: 'P2002' })],
      ['un error sin código', new Error('x')],
      ['un valor que no es un error', 'texto'],
    ])('%s no indica estado de envío', (_label, error) => {
      expect(deliveryStateFields(error)).toEqual({})
    })

    it('safeDeliveryErrorFields une los campos del error y el estado', () => {
      expect(safeDeliveryErrorFields(Object.assign(new Error(`socket ${EMAIL}`), { code: 'ETIMEDOUT' })))
        .toEqual({ errorName: 'Error', errorCode: 'ETIMEDOUT', deliveryState: 'unconfirmed' })
    })
  })

  it.each([
    ['fuera de rango', 99],
    ['fuera de rango por arriba', 600],
    ['no entero', 535.5],
    ['como texto', '535'],
  ])('descarta un código de respuesta %s', (_label, responseCode) => {
    expect(safeErrorFields(Object.assign(new Error('x'), { responseCode }))).toEqual({ errorName: 'Error' })
  })

  it('un nombre de error con datos se sustituye por «Error»', () => {
    const error = new Error('x')
    error.name = `Fallo de ${EMAIL}`

    expect(safeErrorFields(error)).toEqual({ errorName: 'Error' })
  })

  it.each([
    ['un texto', `fallo ${EMAIL}`, 'string'],
    ['undefined', undefined, 'undefined'],
    ['null', null, 'object'],
    ['un objeto plano', { message: EMAIL, code: 'ECONNECTION' }, 'object'],
  ])('con un valor lanzado que no es Error (%s) solo indica su tipo', (_label, value, name) => {
    const fields = safeErrorFields(value)

    expect(fields.errorName).toBe(name)
    expect(JSON.stringify(fields)).not.toContain(EMAIL)
  })
})
