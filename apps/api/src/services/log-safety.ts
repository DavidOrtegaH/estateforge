// Campos de un error que se pueden registrar sin datos personales ni secretos (Fase 1, correcciones A y A-1).
//
// El mensaje y las propiedades de un error de envío o de base de datos pueden contener el
// destinatario (un rechazo SMTP suele citar la dirección), la respuesta del servidor SMTP, las
// direcciones rechazadas o los argumentos de una consulta de Prisma (emails, hashes de token).
// Por eso nunca se registran `message`, `response`, `rejected`, `cause` ni el error completo.
//
// El nombre y el código se comparan con listas cerradas: validar solo el formato dejaba pasar
// cualquier identificador, por ejemplo un hash hexadecimal. Un valor fuera de la lista se sustituye
// por uno genérico. Al actualizar nodemailer o Prisma hay que revisar estas listas.

export interface SafeErrorFields {
  // Nombre del tipo de error ('Error', 'PrismaClientKnownRequestError'…).
  errorName: string
  // Código simbólico del error, o OTHER_ERROR_CODE si no es uno conocido.
  errorCode?: string
  // Código de respuesta SMTP (por ejemplo, 550), sin el texto de la respuesta.
  smtpResponseCode?: number
}

export interface DeliveryStateFields {
  deliveryState?: 'unconfirmed'
}

const GENERIC_ERROR_NAME = 'Error'
export const OTHER_ERROR_CODE = 'OTHER'

const SAFE_ERROR_NAMES: ReadonlySet<string> = new Set([
  // Errores nativos de ECMAScript. nodemailer no define clases propias: usa Error con `code`.
  'Error', 'AggregateError', 'EvalError', 'RangeError', 'ReferenceError', 'SyntaxError', 'TypeError', 'URIError',
  // Prisma 7.9.1 (runtime de @prisma/client y @prisma/driver-adapter-utils).
  'PrismaClientKnownRequestError', 'PrismaClientUnknownRequestError', 'PrismaClientRustPanicError',
  'PrismaClientInitializationError', 'PrismaClientValidationError', 'PrismaClientConstructorValidationError',
  'DriverAdapterError',
  // pg.
  'DatabaseError',
])

// Resultado de `typeof`, para lo que se lanza sin ser un Error: un conjunto cerrado por el lenguaje.
const TYPEOF_NAMES: ReadonlySet<string> = new Set(['string', 'number', 'bigint', 'boolean', 'symbol', 'undefined', 'object', 'function'])

const SAFE_ERROR_CODES: ReadonlySet<string> = new Set([
  // nodemailer 10.0.12, lib/errors (ERROR_CODES). Sobrescribe el código de los errores de socket.
  'ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ETLS', 'EREQUIRETLS', 'EPROTOCOL', 'EENVELOPE', 'EMESSAGE',
  'ESTREAM', 'EAUTH', 'ENOAUTH', 'EOAUTH2', 'EMAXLIMIT', 'EMAXRECIPIENTS', 'ESENDMAIL', 'ESES', 'ECONFIG',
  'EPROXY', 'EFILEACCESS', 'EURLACCESS', 'EFETCH',
  // Prisma 7.9.1 (códigos literales del runtime de @prisma/client).
  'P1000', 'P1001', 'P1003', 'P1008', 'P1009', 'P1010', 'P1011', 'P1017', 'P1018',
  'P2000', 'P2002', 'P2003', 'P2007', 'P2009', 'P2010', 'P2011', 'P2012', 'P2014', 'P2017', 'P2018', 'P2020',
  'P2021', 'P2022', 'P2023', 'P2025', 'P2028', 'P2029', 'P2030', 'P2034', 'P2036', 'P2037', 'P2038', 'P2039',
  'P6000', 'P6001',
  // Node: new URL() al construir los enlaces.
  'ERR_INVALID_URL',
])

// Los que nodemailer trata como transitorios: la conexión se perdió sin una respuesta del servidor.
const CONNECTION_LOST_CODES: ReadonlySet<string> = new Set(['ETIMEDOUT', 'ESOCKET', 'ECONNECTION'])

export function safeErrorName(error: unknown): string {
  if (error instanceof Error) return SAFE_ERROR_NAMES.has(error.name) ? error.name : GENERIC_ERROR_NAME
  const type = typeof error
  return TYPEOF_NAMES.has(type) ? type : GENERIC_ERROR_NAME
}

function validSmtpResponseCode(responseCode: unknown): number | undefined {
  return typeof responseCode === 'number' && Number.isInteger(responseCode) && responseCode >= 200 && responseCode <= 599
    ? responseCode
    : undefined
}

export function safeErrorFields(error: unknown): SafeErrorFields {
  const fields: SafeErrorFields = { errorName: safeErrorName(error) }
  if (error && typeof error === 'object') {
    const { code, responseCode } = error as { code?: unknown; responseCode?: unknown }
    if (typeof code === 'string') fields.errorCode = SAFE_ERROR_CODES.has(code) ? code : OTHER_ERROR_CODE
    const smtpResponseCode = validSmtpResponseCode(responseCode)
    if (smtpResponseCode !== undefined) fields.smtpResponseCode = smtpResponseCode
  }
  return fields
}

/**
 * Indica si el resultado de un envío es desconocido. Si la conexión se pierde sin una respuesta
 * del servidor, el mensaje puede haberse aceptado o no: ni enviado ni fallido, sino no confirmado.
 */
export function deliveryStateFields(error: unknown): DeliveryStateFields {
  if (!error || typeof error !== 'object') return {}
  const { code, responseCode } = error as { code?: unknown; responseCode?: unknown }
  if (typeof code === 'string' && CONNECTION_LOST_CODES.has(code) && validSmtpResponseCode(responseCode) === undefined) {
    return { deliveryState: 'unconfirmed' }
  }
  return {}
}

export function safeDeliveryErrorFields(error: unknown): SafeErrorFields & DeliveryStateFields {
  return { ...safeErrorFields(error), ...deliveryStateFields(error) }
}
