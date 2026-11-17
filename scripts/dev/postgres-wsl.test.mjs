import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { decodeOutput, fileLock, LIMITS, main, prepare, ROOT, selectDistro } from './postgres-wsl.mjs'

// Orquestador de `pnpm dev` con WSL, PostgreSQL y la comprobación de credenciales simulados: ninguna
// prueba ejecuta wsl.exe ni toca la base de desarrollo real.

const WIN_ROOT = 'C:\\Users\\Ana Pérez\\Mis proyectos\\EstateForge'
const LINUX_ROOT = '/mnt/c/Users/Ana Pérez/Mis proyectos/EstateForge'
const SCRIPT = `${LINUX_ROOT}/scripts/wsl/postgres-dev.sh`
const ok = (stdout = '') => ({ status: 0, stdout, stderr: '' })
const fail = (stdout = '', status = 1, stderr = '') => ({ status, stdout, stderr })
const VERBOSE = '  NAME      STATE           VERSION\n* Ubuntu    Stopped         2\n'
const RUNNING = 'En marcha y aceptando conexiones en 127.0.0.1:55432 (postgres (PostgreSQL) 17.11).'
const CHECK_OK = JSON.stringify({ ok: true, host: '127.0.0.1', port: 55432, database: 'estateforge_dev' })

/** Simula WSL y PostgreSQL. `pg.running` cambia al ejecutar start/stop, como el script real. */
function world(options = {}) {
  const pg = { running: false, startsAfter: 0, statusCalls: 0, ...options.pg }
  const calls = []
  const run = (command, args, opts = {}) => {
    calls.push({ command, args, opts })
    if (options.override) {
      const forced = options.override(command, args)
      if (forced) return forced
    }
    if (command === process.execPath) return ok(options.check ?? CHECK_OK)
    if (command !== 'wsl.exe') return fail('', 127)
    if (args[0] === '--list') return ok(options.verbose ?? VERBOSE)
    const linux = args.slice(args.indexOf('--exec') + 1)
    const [program, ...rest] = linux
    if (program === 'id') return ok('1000\n')
    if (program === 'wslpath') return rest[1] === WIN_ROOT ? ok(`${LINUX_ROOT}\n`) : fail()
    if (program === 'test') return rest[1] === SCRIPT ? ok() : fail()
    if (program === 'bash' && rest[0] === SCRIPT) {
      const action = rest[1]
      if (action === 'status') {
        pg.statusCalls += 1
        const accepting = pg.running && pg.statusCalls > pg.startsAfter
        return accepting ? ok(`${RUNNING}\n`) : fail('Detenido o sin aceptar conexiones.\n')
      }
      if (action === 'start') {
        pg.starts = (pg.starts ?? 0) + 1
        if (options.startFails) return fail('pg_ctl: could not start server\n')
        pg.running = true
        pg.statusCalls = 0
        return ok('PostgreSQL en marcha en 127.0.0.1:55432.\n')
      }
      if (action === 'stop') {
        pg.running = false
        return ok('PostgreSQL detenido.\n')
      }
      if (action === 'port') return ok('55432\n')
    }
    return fail('', 127)
  }
  const logs = []
  let tcpCalls = 0
  const deps = {
    platform: 'win32',
    env: { ...options.env },
    root: WIN_ROOT,
    run,
    tcpProbe: async () => {
      tcpCalls += 1
      return options.tcp ? options.tcp(tcpCalls) : true
    },
    sleep: async () => {},
    lock: options.lock ?? { tryAcquire: () => true, release: () => {} },
    log: line => logs.push(line),
    limits: { ...LIMITS, statusAttempts: 5, tcpAttempts: 4 },
  }
  return { deps, pg, calls, logs, text: () => logs.join('\n'), wslArgs: () => calls.filter(c => c.command === 'wsl.exe').map(c => c.args.join(' ')) }
}

const scriptCalls = (w, action) => w.calls.filter(c => c.command === 'wsl.exe' && c.args.includes(SCRIPT) && c.args.at(-1) === action).length

describe('WSL', () => {
  it('1. Ubuntu disponible: usa la distribución y el usuario por defecto, sin contraseña', async () => {
    const w = world({ pg: { running: true } })
    expect(await main('start', w.deps)).toBe(0)
    const linuxCalls = w.calls.filter(c => c.command === 'wsl.exe' && c.args[0] === '-d')
    expect(linuxCalls.every(c => c.args.slice(0, 5).join(' ') === '-d Ubuntu -u User --exec')).toBe(true)
    expect(JSON.stringify(w.calls)).not.toMatch(/password|sudo|--shutdown/i)
  })

  it('2. Ubuntu detenida: WSL la arranca al ejecutar la primera orden', async () => {
    const w = world({ verbose: '  NAME STATE VERSION\n* Ubuntu Stopped 2\n' })
    expect(await main('start', w.deps)).toBe(0)
    expect(w.text()).toContain('Ubuntu (WSL 2) disponible.')
  })

  it('3. varias distribuciones Ubuntu: no elige una al azar y explica ESTATEFORGE_WSL_DISTRO', async () => {
    const w = world({ verbose: 'NAME STATE VERSION\n* Ubuntu Running 2\n  Ubuntu-24.04 Stopped 2\n' })
    expect(await main('start', w.deps)).toBe(1)
    expect(w.text()).toMatch(/varias distribuciones Ubuntu/)
    expect(w.text()).toContain('ESTATEFORGE_WSL_DISTRO')
    expect(scriptCalls(w, 'start')).toBe(0)
  })

  it('3b. con ESTATEFORGE_WSL_DISTRO se usa la indicada', () => {
    const list = [{ name: 'Ubuntu', version: '2' }, { name: 'Ubuntu-24.04', version: '2' }]
    expect(selectDistro(list, { ESTATEFORGE_WSL_DISTRO: 'Ubuntu-24.04' }).name).toBe('Ubuntu-24.04')
  })

  it('4. distribución no encontrada', async () => {
    const w = world({ verbose: 'NAME STATE VERSION\n* Debian Running 2\n' })
    expect(await main('start', w.deps)).toBe(1)
    expect(w.text()).toContain('No hay ninguna distribución Ubuntu')
    const named = world({ env: { ESTATEFORGE_WSL_DISTRO: 'Fedora' } })
    expect(await main('start', named.deps)).toBe(1)
    expect(named.text()).toContain('«Fedora» (ESTATEFORGE_WSL_DISTRO) no existe')
  })

  it('5. usuario Linux inexistente: lo dice y sugiere ESTATEFORGE_WSL_USER', async () => {
    const w = world({ env: { ESTATEFORGE_WSL_USER: 'nadie' }, override: (c, a) => (a.includes('id') ? fail('', 1, 'user not found') : null) })
    expect(await main('start', w.deps)).toBe(1)
    expect(w.text()).toContain('El usuario Linux «nadie» no existe')
    expect(w.text()).toContain('ESTATEFORGE_WSL_USER')
  })

  it('6. wsl.exe no disponible', async () => {
    const w = world({ override: c => (c === 'wsl.exe' ? { status: null, stdout: '', stderr: '', error: 'ENOENT' } : null) })
    expect(await main('start', w.deps)).toBe(1)
    expect(w.text()).toContain('No se encuentra wsl.exe')
  })

  it('6b. WSL sin memoria para la máquina virtual: mensaje específico', async () => {
    const w = world({ override: c => (c === 'wsl.exe' ? fail('Código de error: Wsl/Service/CreateInstance/CreateVm/HCS/ERROR_NO_SYSTEM_RESOURCES', 1) : null) })
    expect(await main('start', w.deps)).toBe(1)
    expect(w.text()).toContain('memoria libre suficiente')
  })

  it('7. wslpath falla', async () => {
    const w = world({ override: (c, a) => (a.includes('wslpath') ? fail('', 1) : null) })
    expect(await main('start', w.deps)).toBe(1)
    expect(w.text()).toContain('No se ha podido traducir la ruta del repositorio')
  })

  it('8. ruta con espacios y acentos: viaja como un único argumento, sin shell', async () => {
    const w = world({ pg: { running: true } })
    expect(await main('start', w.deps)).toBe(0)
    const call = w.calls.find(c => c.args.includes('wslpath'))
    expect(call.args.at(-1)).toBe(WIN_ROOT)
    expect(w.calls.some(c => c.args.includes(SCRIPT))).toBe(true)
    expect(w.calls.every(c => !c.args.includes('-c') && !c.args.includes('sh'))).toBe(true)
  })

  it('9. script de PostgreSQL inexistente: no busca alternativas', async () => {
    const w = world({ override: (c, a) => (a.includes('test') ? fail() : null) })
    expect(await main('start', w.deps)).toBe(1)
    expect(w.text()).toContain('No existe scripts/wsl/postgres-dev.sh')
    expect(w.wslArgs().filter(a => a.includes('bash'))).toEqual([])
  })

  it('10 y 12. el script no puede arrancar PostgreSQL (código distinto de 0)', async () => {
    const w = world({ startFails: true })
    expect(await main('start', w.deps)).toBe(1)
    expect(w.text()).toContain('no ha podido arrancar PostgreSQL')
    expect(w.text()).toContain('postgres-dev.sh: pg_ctl: could not start server')
  })

  it('11. WSL no responde a tiempo', async () => {
    const w = world({ override: c => (c === 'wsl.exe' ? { status: null, stdout: '', stderr: '', error: 'ETIMEDOUT' } : null) })
    expect(await main('start', w.deps)).toBe(1)
    expect(w.text()).toContain('WSL no ha respondido a tiempo')
  })
})

describe('PostgreSQL', () => {
  it('13. ya en marcha: no lo arranca otra vez', async () => {
    const w = world({ pg: { running: true } })
    expect(await main('start', w.deps)).toBe(0)
    expect(w.text()).toContain('PostgreSQL ya estaba en marcha. No es necesario reiniciarlo.')
    expect(scriptCalls(w, 'start')).toBe(0)
  })

  it('14. detenido: lo arranca una vez con el script y espera a que acepte conexiones', async () => {
    const w = world()
    expect(await main('start', w.deps)).toBe(0)
    expect(scriptCalls(w, 'start')).toBe(1)
    expect(w.text()).toMatch(/PostgreSQL detenido\. Iniciándolo\.\.\.[\s\S]*PostgreSQL disponible\./)
  })

  it('15. arranca pero el puerto no responde desde Windows', async () => {
    const w = world({ tcp: () => false })
    expect(await main('start', w.deps)).toBe(1)
    expect(w.text()).toContain('127.0.0.1:55432 no responde desde Windows')
  })

  it('16. tarda en aceptar conexiones: reintenta de forma acotada', async () => {
    const slow = world({ pg: { startsAfter: 2 } })
    expect(await main('start', slow.deps)).toBe(0)
    const never = world({ pg: { startsAfter: 99 } })
    expect(await main('start', never.deps)).toBe(1)
    expect(never.text()).toContain('no acepta conexiones')
  })

  it('16b. el puerto tarda en responder desde Windows: reintenta', async () => {
    const w = world({ tcp: n => n >= 3 })
    expect(await main('start', w.deps)).toBe(0)
  })

  it('17. otro servicio ocupa el puerto en Windows', async () => {
    const w = world({ pg: { running: true }, check: JSON.stringify({ ok: false, reason: 'protocol', message: 'En el puerto de DATABASE_URL responde un servicio que no es PostgreSQL, o la conexión se ha cortado.', host: '127.0.0.1', port: 55432 }) })
    expect(await main('start', w.deps)).toBe(1)
    expect(w.text()).toContain('netstat -ano | findstr :55432')
  })

  it('18. pierde la conexión durante la comprobación', async () => {
    const w = world({
      pg: { running: true },
      tcp: n => n % 2 === 0,
      check: JSON.stringify({ ok: false, reason: 'unreachable', message: 'No hay ningún PostgreSQL escuchando en el destino de DATABASE_URL.', host: '127.0.0.1', port: 55432 }),
    })
    expect(await main('start', w.deps)).toBe(1)
    expect(w.text()).toContain('No hay ningún PostgreSQL escuchando')
    expect(w.text()).toContain('La API y la web no se han arrancado.')
  })

  it('19. credenciales incorrectas', async () => {
    const w = world({ pg: { running: true }, check: JSON.stringify({ ok: false, reason: 'auth', message: 'PostgreSQL ha rechazado las credenciales de apps/api/.env.' }) })
    expect(await main('start', w.deps)).toBe(1)
    expect(w.text()).toContain('rechazado las credenciales')
  })

  it('20. DATABASE_URL no válida o de otro motor (SQLite, MySQL)', async () => {
    const w = world({ pg: { running: true }, check: JSON.stringify({ ok: false, reason: 'config', message: 'DATABASE_URL no es una conexión PostgreSQL válida.' }) })
    expect(await main('start', w.deps)).toBe(1)
    expect(w.text()).toContain('no es una conexión PostgreSQL válida')
  })

  it('20b. DATABASE_URL apunta a otro puerto que el del servidor de desarrollo', async () => {
    const w = world({ pg: { running: true }, check: JSON.stringify({ ok: true, host: '127.0.0.1', port: 5432, database: 'x' }) })
    expect(await main('start', w.deps)).toBe(1)
    expect(w.text()).toContain('DATABASE_URL apunta a 127.0.0.1:5432')
  })

  it('no imprime nunca credenciales', async () => {
    const w = world({ pg: { running: true } })
    await main('start', w.deps)
    expect(w.text()).not.toMatch(/postgresql:\/\/|PASSWORD|estateforge_app/)
  })
})

describe('desarrollo', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

  it('21 y 24. si falla PostgreSQL, devuelve 1 y `pnpm dev` no llega a arrancar la API ni la web (&&)', async () => {
    const w = world({ startFails: true })
    expect(await main('start', w.deps)).toBe(1)
    expect(w.text()).toContain('La API y la web no se han arrancado.')
    expect(pkg.scripts.dev).toBe('node scripts/dev/postgres-wsl.mjs start && pnpm run dev:apps')
  })

  it('22 y 23. si PostgreSQL está listo, devuelve 0 y el comando de siempre se ejecuta una sola vez', async () => {
    const w = world({ pg: { running: true } })
    expect(await main('start', w.deps)).toBe(0)
    expect(pkg.scripts['dev:apps']).toBe('pnpm --parallel --filter api --filter web dev')
    expect(pkg.scripts.dev.match(/dev:apps/g)).toHaveLength(1)
    // El orquestador no lanza la API ni la web: eso lo hace pnpm después.
    expect(w.calls.some(c => /pnpm|vite|server\.ts/.test([c.command, ...c.args].join(' ')))).toBe(false)
  })

  it('25, 26 y 27. no supervisa ni intercepta señales: Ctrl+C llega a pnpm, la API y Vite, y nunca se detiene PostgreSQL', async () => {
    const source = fs.readFileSync(path.join(ROOT, 'scripts', 'dev', 'postgres-wsl.mjs'), 'utf8')
    expect(source).not.toMatch(/process\.on\(|SIGINT|SIGTERM|spawn\(|--shutdown|taskkill|pkill|killall/)
    const w = world({ pg: { running: true } })
    await main('start', w.deps)
    expect(scriptCalls(w, 'stop')).toBe(0)
    expect(w.pg.running).toBe(true)
  })

  it('stop solo con db:dev:stop, delegando en el script', async () => {
    const w = world({ pg: { running: true } })
    expect(await main('stop', w.deps)).toBe(0)
    expect(scriptCalls(w, 'stop')).toBe(1)
    expect(pkg.scripts['db:dev:stop']).toBe('node scripts/dev/postgres-wsl.mjs stop')
    expect(pkg.scripts['db:dev:start']).toBe('node scripts/dev/postgres-wsl.mjs start')
    expect(pkg.scripts['db:dev:status']).toBe('node scripts/dev/postgres-wsl.mjs status')
  })

  it('status: 0 si acepta conexiones y responde desde Windows; 1 si está detenido', async () => {
    expect(await main('status', world({ pg: { running: true } }).deps)).toBe(0)
    expect(await main('status', world().deps)).toBe(1)
  })

  it('28. dos arranques seguidos: el segundo detecta PostgreSQL en marcha y no lo duplica', async () => {
    const w = world()
    await main('start', w.deps)
    await main('start', w.deps)
    expect(scriptCalls(w, 'start')).toBe(1)
  })

  it('29. dos orquestadores a la vez: el segundo espera al primero mientras prepara la base', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ef-lock-')), 'dev.lock')
    const first = fileLock(file)
    const second = fileLock(file, () => true)
    expect(first.tryAcquire()).toBe(true)
    fs.writeFileSync(file, '999999')
    expect(second.tryAcquire()).toBe(false)
    const stale = fileLock(file, () => false)
    expect(stale.tryAcquire()).toBe(true)
    stale.release()
    expect(fs.existsSync(file)).toBe(false)

    let attempts = 0
    const w = world({ pg: { running: true }, lock: { tryAcquire: () => (attempts += 1) > 2, release: () => {} } })
    expect(await main('start', w.deps)).toBe(0)
    expect(w.text()).toContain('Otro «pnpm dev» está preparando PostgreSQL')
  })

  it('ESTATEFORGE_DEV_DB_START=0: no usa WSL, solo comprueba la conexión', async () => {
    const w = world({ env: { ESTATEFORGE_DEV_DB_START: '0' } })
    expect(await prepare(w.deps)).toEqual({ port: 55432, database: 'estateforge_dev' })
    expect(w.calls.some(c => c.command === 'wsl.exe')).toBe(false)
  })

  it('Linux: llama al script local, sin wsl.exe', async () => {
    const w = world({
      override: (c, a) => {
        if (c === 'test') return ok()
        if (c === 'bash') return a[1] === 'status' ? ok(RUNNING) : a[1] === 'port' ? ok('55432') : ok()
        return null
      },
    })
    w.deps.platform = 'linux'
    w.deps.root = '/home/user/EstateForge'
    expect(await main('start', w.deps)).toBe(0)
    expect(w.calls.some(c => c.command === 'wsl.exe')).toBe(false)
    expect(w.calls.find(c => c.command === 'bash').args[0]).toBe('/home/user/EstateForge/scripts/wsl/postgres-dev.sh')
  })

  it('decodifica la salida UTF-16 de wsl.exe', () => {
    expect(decodeOutput(Buffer.from('Ubuntu\r\n', 'utf16le'))).toBe('Ubuntu\r\n')
    expect(decodeOutput(Buffer.from('Ubuntu\n', 'utf8'))).toBe('Ubuntu\n')
  })
})
