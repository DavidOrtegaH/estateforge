import pg from 'pg'

// Cliente del pool con la zona horaria de la sesión fijada en UTC.
//
// @prisma/adapter-pg 7.9.1 lee los timestamptz sustituyendo el desplazamiento que envía PostgreSQL por
// +00:00 (normalize_timestamptz): solo es correcto si la sesión está en UTC. Con un servidor o una base
// cuya zona por defecto sea otra, los instantes leídos se desplazaban (caducidades incluidas). La API
// no depende de esa configuración: cada conexión fija su zona antes de que el pool la entregue.
//
// Se hace al conectar y no con el evento `connect` del pool, que entrega la conexión sin esperar a la
// consulta. Con el pooler de Neon (PgBouncer en modo transacción), TimeZone es uno de los parámetros que
// PgBouncer restaura para cada cliente; un SET de otra variable no sería fiable allí.
export const SESSION_TIME_ZONE_SQL = "SET TIME ZONE 'UTC'"

export class UtcClient extends pg.Client {
  // pg-pool llama a connect con un callback; el resto del código, sin él.
  override connect(): Promise<pg.Client>
  override connect(callback: ((err: Error) => void) | ((err: null, client: pg.Client) => void)): void
  override connect(callback?: ((err: Error) => void) | ((err: null, client: pg.Client) => void)): Promise<pg.Client> | void {
    const ready = super.connect().then(async () => {
      await super.query(SESSION_TIME_ZONE_SQL)
      return this as pg.Client
    })
    if (!callback) return ready
    const done = callback as (err: Error | null, client?: pg.Client) => void
    ready.then(client => done(null, client), (error: Error) => done(error))
  }
}
