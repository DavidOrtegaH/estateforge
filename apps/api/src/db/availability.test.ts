import { describe, expect, it } from 'vitest'

import { databaseUnavailableKind, isDatabaseUnavailableError } from './availability.js'

// Formas reproducidas de las observadas con PostgreSQL 17.11, Prisma 7.9.1, @prisma/adapter-pg 7.9.1 y
// pg-pool 3.14 (diagnóstico de resiliencia). Las pruebas de integración las obtienen del servidor real.

function prismaKnown(code: string, message = 'x', cause?: Record<string, unknown>) {
  return Object.assign(new Error(message), {
    name: 'PrismaClientKnownRequestError',
    code,
    meta: cause ? { modelName: 'User', driverAdapterError: { name: 'DriverAdapterError', cause } } : { modelName: 'User' },
  })
}

describe('errores de disponibilidad de la base (DA-37)', () => {
  it.each([
    ['límite de conexiones del rol, consulta de modelo (P2037)', prismaKnown('P2037', 'Too many database connections opened', { originalCode: '53300', kind: 'TooManyConnections' }), 'too_many_connections'],
    ['límite de conexiones en una consulta en bruto (P2010)', prismaKnown('P2010', 'Raw query failed. Code: `53300`', { originalCode: '53300', kind: 'TooManyConnections' }), 'too_many_connections'],
    ['servidor inaccesible (P1001)', prismaKnown('P1001', "Can't reach database server at 127.0.0.1:1", { kind: 'DatabaseNotReachable', host: '127.0.0.1', port: 1 }), 'unreachable'],
    ['conexión cerrada por el servidor (P1017)', prismaKnown('P1017', 'Server has closed the connection.', { kind: 'ConnectionClosed' }), 'connection_lost'],
    ['conexión cerrada en una consulta en bruto (P2010)', prismaKnown('P2010', 'Server has closed the connection.', { kind: 'ConnectionClosed' }), 'connection_lost'],
    ['backend terminado por el administrador (57P01)', prismaKnown('P2010', 'terminating connection', { originalCode: '57P01', kind: 'postgres', code: '57P01' }), 'connection_lost'],
    ['servidor arrancando (57P03)', prismaKnown('P2010', 'the database system is starting up', { kind: 'postgres', code: '57P03' }), 'connection_lost'],
    ['autenticación rechazada (P1000)', prismaKnown('P1000', 'Authentication failed', { originalCode: '28P01', kind: 'AuthenticationFailed' }), 'configuration'],
    ['la base no existe (P1003)', prismaKnown('P1003', 'Database does not exist', { originalCode: '3D000', kind: 'DatabaseDoesNotExist' }), 'configuration'],
    ['tiempo agotado esperando el pool (P2024)', prismaKnown('P2024', 'Timed out fetching a new connection'), 'pool_timeout'],
    ['transacción sin conexión dentro de maxWait (P2028)', Object.assign(new Error('Transaction API error: Unable to start a transaction in the given time.'), { name: 'PrismaClientKnownRequestError', code: 'P2028', meta: {} }), 'pool_timeout'],
    ['inicialización del cliente', Object.assign(new Error('init'), { name: 'PrismaClientInitializationError' }), 'configuration'],
    ['pg-pool: tiempo agotado al pedir una conexión', new Error('timeout exceeded when trying to connect'), 'pool_timeout'],
    ['pg-pool: pool cerrado', new Error('Cannot use a pool after calling end on the pool'), 'pool_closed'],
    ['pg-pool: conexión cortada al conectar', new Error('Connection terminated due to connection timeout'), 'connection_lost'],
    ['error de pg con SQLSTATE 53300', Object.assign(new Error('too many connections'), { name: 'error', code: '53300' }), 'too_many_connections'],
    ['error de pg con SQLSTATE 08006', Object.assign(new Error('connection failure'), { name: 'error', code: '08006' }), 'connection_lost'],
    ['error del adaptador sin envolver', Object.assign(new Error('x'), { name: 'DriverAdapterError', cause: { kind: 'DatabaseNotReachable' } }), 'unreachable'],
    ['error envuelto en otro (cause)', new Error('envoltorio', { cause: new Error('timeout exceeded when trying to connect') }), 'pool_timeout'],
    // Forma observada en Linux con `localhost` resuelto a ::1 y 127.0.0.1 (AggregateError de pg que
    // adapter-pg no convierte): Prisma expone el código de red de Node, sin driverAdapterError.
    ['servidor inaccesible por las dos familias de direcciones (ECONNREFUSED)', Object.assign(new Error('x'), { name: 'PrismaClientKnownRequestError', code: 'ECONNREFUSED', meta: { modelName: 'Session' } }), 'unreachable'],
    ['primer intento por una red IPv6 no disponible (EADDRNOTAVAIL)', Object.assign(new Error('x'), { name: 'PrismaClientKnownRequestError', code: 'EADDRNOTAVAIL', meta: { modelName: 'Session' } }), 'unreachable'],
    ['conexión cortada (ECONNRESET)', Object.assign(new Error('x'), { name: 'PrismaClientKnownRequestError', code: 'ECONNRESET', meta: { modelName: 'User' } }), 'connection_lost'],
  ])('%s → 503', (_label, error, kind) => {
    expect(databaseUnavailableKind(error)).toBe(kind)
    expect(isDatabaseUnavailableError(error)).toBe(true)
  })

  it.each([
    ['violación de unicidad (P2002)', prismaKnown('P2002', 'Unique constraint failed', { originalCode: '23505', kind: 'UniqueConstraintViolation' })],
    ['violación de CHECK (P2039)', prismaKnown('P2039', 'check constraint', { originalCode: '23514', kind: 'postgres', code: '23514' })],
    ['clave foránea (P2003)', prismaKnown('P2003', 'Foreign key constraint violated', { originalCode: '23503', kind: 'ForeignKeyConstraintViolation' })],
    ['conflicto de escritura (P2034, 40001)', prismaKnown('P2034', 'write conflict', { originalCode: '40001', kind: 'TransactionWriteConflict' })],
    ['interbloqueo (40P01)', prismaKnown('P2010', 'deadlock detected', { originalCode: '40P01', kind: 'postgres', code: '40P01' })],
    ['tabla inexistente: error de programación (42P01)', prismaKnown('P2010', 'relation does not exist', { originalCode: '42P01', kind: 'TableDoesNotExist' })],
    ['registro no encontrado (P2025)', prismaKnown('P2025', 'Record not found')],
    ['transacción caducada: no es de disponibilidad (P2028)', Object.assign(new Error('Transaction API error: Transaction already closed'), { name: 'PrismaClientKnownRequestError', code: 'P2028', meta: {} })],
    ['validación de Prisma', Object.assign(new Error('Invalid value'), { name: 'PrismaClientValidationError' })],
    ['error de programación', new TypeError('Cannot read properties of undefined')],
    ['error genérico con un mensaje parecido', new Error('timeout exceeded when trying to connect to SMTP')],
    ['error con código propio y el mensaje de pg-pool', Object.assign(new Error('timeout exceeded when trying to connect'), { code: 'ETIMEDOUT' })],
    // Los códigos de red de Node solo cuentan en un error de Prisma: un error de red de otro servicio
    // (SMTP, un proveedor de IA) conserva su tratamiento aunque lleve el mismo código o la misma causa.
    ['error de red sin envolver (no es de la base)', Object.assign(new Error('connect'), { code: 'ECONNREFUSED', errno: -111, syscall: 'connect' })],
    ['AggregateError de red sin envolver', Object.assign(new AggregateError([Object.assign(new Error('a'), { code: 'ECONNREFUSED' })], 'x'), { code: 'ECONNREFUSED' })],
    ['error del SMTP con causa de red', Object.assign(new Error('Connection error', { cause: Object.assign(new Error('connect'), { code: 'ECONNREFUSED', syscall: 'connect', errno: -111 }) }), { code: 'ESOCKET', command: 'CONN' })],
    ['código de Prisma desconocido', Object.assign(new Error('x'), { name: 'PrismaClientKnownRequestError', code: 'EACCES', meta: {} })],
    ['un valor que no es un error', 'P1001'],
    ['nulo', null],
  ])('%s → no es de disponibilidad', (_label, error) => {
    expect(databaseUnavailableKind(error)).toBeNull()
  })

  it('no recorre una cadena de causas cíclica sin fin', () => {
    const a = new Error('a')
    const b = new Error('b', { cause: a })
    Object.assign(a, { cause: b })

    expect(databaseUnavailableKind(a)).toBeNull()
  })

  it('ignora propiedades heredadas: solo cuenta lo propio del error', () => {
    // Un objeto cuyo código viene del prototipo, no del propio error.
    const fake = Object.assign(Object.create(Object.assign(Object.create(Error.prototype), { code: 'P1001' })) as Error, { name: 'PrismaClientKnownRequestError', message: 'x' })

    expect(databaseUnavailableKind(fake)).toBeNull()
  })
})
