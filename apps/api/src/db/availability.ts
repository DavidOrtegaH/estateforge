// Errores de disponibilidad de PostgreSQL (DA-37).
//
// Indican que la base no puede atender la petición ahora mismo (pool agotado, límite de conexiones,
// servidor caído, reiniciándose o inaccesible), no que la petición sea incorrecta: se responde 503 y
// se puede repetir. Los errores de integridad, validación, conflicto o programación no son de
// disponibilidad y conservan su tratamiento (400, 409 o 500).
//
// Solo se reconocen formas comprobadas con PostgreSQL 17.11, Prisma 7.9.1, @prisma/adapter-pg 7.9.1
// y pg-pool 3.14 (diagnóstico de la Fase de resiliencia y, para los códigos de red de Node, el primer
// CI en Linux). Al actualizar cualquiera de ellos hay que
// repetir las pruebas de integración de disponibilidad: si cambia una forma, el error vuelve a ser
// un 500 genérico, nunca un 503 indebido.

// Códigos de Prisma de conexión o de agotamiento de conexiones.
const PRISMA_CODES: ReadonlySet<string> = new Set([
  'P1000', // autenticación rechazada
  'P1001', // servidor inaccesible
  'P1002', // tiempo de conexión agotado
  'P1003', // la base no existe
  'P1008', // operación sin respuesta a tiempo
  'P1010', // acceso denegado
  'P1011', // error de TLS
  'P1017', // el servidor cerró la conexión
  'P2024', // tiempo agotado esperando una conexión del pool
  'P2037', // demasiadas conexiones
])

// Códigos de red de Node con los que Prisma crea el PrismaClientKnownRequestError cuando el adaptador no
// reconoce el error de conexión. Observado (Node 24, pg 8.23, adapter-pg 7.9.1): si `localhost` resuelve
// a ::1 y a 127.0.0.1, Node prueba las dos direcciones y, si ambas fallan, pg recibe un AggregateError con
// `code` pero sin `syscall` ni `errno`; adapter-pg no lo convierte en DatabaseNotReachable y Prisma lo
// expone con code 'ECONNREFUSED' y sin driverAdapterError. El código del AggregateError es el del primer
// intento, por eso se aceptan también los de una red IPv6 no disponible. Solo cuentan en un error de
// Prisma (la consulta a la base): un error de red de otro servicio, como el SMTP, no llega con esta forma.
const NODE_UNREACHABLE_CODES: ReadonlySet<string> = new Set([
  'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'EADDRNOTAVAIL',
])
const NODE_CONNECTION_LOST_CODES: ReadonlySet<string> = new Set(['ECONNRESET', 'EPIPE'])

// Clases de error del adaptador (DriverAdapterError.cause.kind) que son de conexión.
const ADAPTER_KINDS: ReadonlySet<string> = new Set([
  'AuthenticationFailed', 'ConnectionClosed', 'DatabaseAccessDenied', 'DatabaseDoesNotExist',
  'DatabaseNotReachable', 'SocketTimeout', 'TlsConnectionError', 'TooManyConnections',
])

// SQLSTATE: clase 08 (excepción de conexión), 53300 (demasiadas conexiones) y 57P01 a 57P03
// (servidor deteniéndose, caído o arrancando).
const AVAILABILITY_SQLSTATE = /^(08[0-9A-Z]{3}|53300|57P0[123])$/

// Mensajes literales de pg-pool 3.14, que lanza un Error sin código y Prisma no envuelve.
const POOL_MESSAGES: ReadonlySet<string> = new Set([
  'timeout exceeded when trying to connect',
  'Cannot use a pool after calling end on the pool',
  'Connection terminated due to connection timeout',
  'Connection terminated unexpectedly',
])

// P2028 agrupa varios errores de transacción; solo este es de disponibilidad: la transacción no
// obtuvo una conexión dentro de maxWait.
const TRANSACTION_START_TIMEOUT = 'Unable to start a transaction in the given time'

const MAX_DEPTH = 4

export type AvailabilityKind = 'pool_timeout' | 'too_many_connections' | 'unreachable' | 'connection_lost' | 'pool_closed' | 'configuration'

function own(value: unknown, key: string): unknown {
  return value !== null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key)
    ? (value as Record<string, unknown>)[key]
    : undefined
}

function kindOfAdapterCause(cause: unknown): AvailabilityKind | null {
  const kind = own(cause, 'kind')
  if (kind === 'TooManyConnections') return 'too_many_connections'
  if (kind === 'DatabaseNotReachable' || kind === 'SocketTimeout') return 'unreachable'
  if (kind === 'ConnectionClosed') return 'connection_lost'
  if (typeof kind === 'string' && ADAPTER_KINDS.has(kind)) return 'configuration'
  const sqlstate = own(cause, 'originalCode') ?? (kind === 'postgres' ? own(cause, 'code') : undefined)
  if (typeof sqlstate === 'string' && AVAILABILITY_SQLSTATE.test(sqlstate)) {
    return sqlstate === '53300' ? 'too_many_connections' : 'connection_lost'
  }
  return null
}

function kindOfPrismaCode(code: string): AvailabilityKind {
  if (code === 'P2024') return 'pool_timeout'
  if (code === 'P2037') return 'too_many_connections'
  if (code === 'P1017') return 'connection_lost'
  if (code === 'P1001' || code === 'P1002' || code === 'P1008') return 'unreachable'
  return 'configuration'
}

/** Clase de indisponibilidad del error, o null si no es un error de disponibilidad de la base. */
export function databaseUnavailableKind(error: unknown, depth = 0): AvailabilityKind | null {
  if (!(error instanceof Error) || depth > MAX_DEPTH) return null

  if (error.name === 'PrismaClientInitializationError') return 'configuration'

  const code = own(error, 'code')
  if (error.name === 'PrismaClientKnownRequestError' && typeof code === 'string') {
    if (code === 'P2028') return error.message.includes(TRANSACTION_START_TIMEOUT) ? 'pool_timeout' : null
    const fromAdapter = kindOfAdapterCause(own(own(own(error, 'meta'), 'driverAdapterError'), 'cause'))
    if (fromAdapter) return fromAdapter
    if (NODE_UNREACHABLE_CODES.has(code)) return 'unreachable'
    if (NODE_CONNECTION_LOST_CODES.has(code)) return 'connection_lost'
    // Un código de integridad (P2002, P2003...) nunca es de disponibilidad, aunque se reciba junto a
    // otro dato; uno de conexión lo es aunque falte el detalle del adaptador.
    return PRISMA_CODES.has(code) ? kindOfPrismaCode(code) : null
  }

  if (error.name === 'DriverAdapterError') return kindOfAdapterCause(own(error, 'cause'))

  // pg: DatabaseError con SQLSTATE propio.
  if (error.name === 'error' || error.name === 'DatabaseError') {
    if (typeof code === 'string' && AVAILABILITY_SQLSTATE.test(code)) return code === '53300' ? 'too_many_connections' : 'connection_lost'
  }

  if (error.name === 'Error' && code === undefined && POOL_MESSAGES.has(error.message)) {
    if (error.message.startsWith('timeout exceeded')) return 'pool_timeout'
    return error.message.startsWith('Cannot use a pool') ? 'pool_closed' : 'connection_lost'
  }

  return databaseUnavailableKind(own(error, 'cause'), depth + 1)
}

export function isDatabaseUnavailableError(error: unknown): boolean {
  return databaseUnavailableKind(error) !== null
}

// Respuesta pública: sin causa, sin SQL y sin datos de conexión.
export const DATABASE_UNAVAILABLE_STATUS = 503
export const DATABASE_UNAVAILABLE_RETRY_AFTER_S = 5
export const DATABASE_UNAVAILABLE_BODY = Object.freeze({
  code: 'SERVICE_UNAVAILABLE',
  message: 'El servicio no está disponible temporalmente. Inténtalo de nuevo en unos segundos.',
})
