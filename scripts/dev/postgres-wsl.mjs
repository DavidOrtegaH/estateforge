#!/usr/bin/env node
// Prepara el PostgreSQL de desarrollo antes de arrancar la API y la web (`pnpm dev`).
//
//   node scripts/dev/postgres-wsl.mjs start    arranca PostgreSQL si hace falta y comprueba que acepta
//                                              conexiones (en WSL, desde Windows y con las credenciales
//                                              de apps/api/.env); no arranca la aplicación
//   node scripts/dev/postgres-wsl.mjs status   estado del servidor y conectividad
//   node scripts/dev/postgres-wsl.mjs stop     detiene PostgreSQL de forma ordenada
//
// La autoridad sobre el ciclo de vida de la base es scripts/wsl/postgres-dev.sh: aquí solo se invoca.
// En Windows se ejecuta dentro de la distribución Ubuntu de WSL con el usuario Linux normal; en Linux,
// directamente. Este proceso termina antes de que arranquen la API y la web: no las supervisa, y al
// cerrarlas con Ctrl+C PostgreSQL sigue en marcha. Nunca imprime credenciales ni URL de conexión.
//
// Variables opcionales: ESTATEFORGE_WSL_DISTRO, ESTATEFORGE_WSL_USER (User por defecto) y
// ESTATEFORGE_DEV_DB_START=0 (no gestionar el servidor; solo comprobar la conexión de apps/api/.env).

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const SCRIPT = 'scripts/wsl/postgres-dev.sh'
export const DEFAULT_USER = 'User'
export const LIMITS = Object.freeze({
  wslMs: 120_000,
  scriptMs: 120_000,
  statusAttempts: 30,
  tcpAttempts: 20,
  tcpTimeoutMs: 1_000,
  retryDelayMs: 500,
  checkMs: 30_000,
  lockWaitMs: 180_000,
})

export class DevSetupError extends Error {
  constructor(message, hints = []) {
    super(message)
    this.name = 'DevSetupError'
    this.hints = hints
  }
}

const DIAGNOSTIC = [
  'pnpm.cmd db:dev:status                     estado de PostgreSQL y de la conexión',
  'wsl.exe --list --verbose                   distribuciones de WSL y su estado',
  'docs/postgresql.md, «Puesta en marcha en desarrollo»',
]

// wsl.exe escribe en UTF-16LE salvo que se pida UTF-8 (WSL_UTF8=1); se aceptan las dos codificaciones.
export function decodeOutput(buffer) {
  if (!buffer || buffer.length === 0) return ''
  if (typeof buffer === 'string') return buffer
  const sample = Math.min(buffer.length, 400)
  let zeros = 0
  for (let i = 1; i < sample; i += 2) if (buffer[i] === 0) zeros += 1
  const text = zeros > sample / 8 ? buffer.toString('utf16le') : buffer.toString('utf8')
  return text.replace(/^﻿/, '').replace(/\0/g, '')
}

function defaultRun(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    timeout: options.timeout,
    windowsHide: true,
    encoding: 'buffer',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return {
    status: result.status,
    stdout: decodeOutput(result.stdout),
    stderr: decodeOutput(result.stderr),
    error: result.error ? result.error.code ?? 'ERROR' : undefined,
  }
}

function defaultTcpProbe(host, port, timeoutMs) {
  return new Promise(resolve => {
    const socket = net.connect({ host, port })
    const done = ok => {
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

// Exclusión entre dos `pnpm dev` simultáneos mientras se prepara la base (no mientras corre la app).
export function fileLock(file = path.join(os.tmpdir(), 'estateforge-dev-postgres.lock'), isAlive = pidAlive) {
  return {
    tryAcquire() {
      try {
        fs.writeFileSync(file, String(process.pid), { flag: 'wx' })
        return true
      } catch (error) {
        if (error.code !== 'EEXIST') throw error
        const owner = Number(fs.readFileSync(file, 'utf8'))
        if (!Number.isInteger(owner) || !isAlive(owner)) {
          fs.rmSync(file, { force: true })
          return this.tryAcquire()
        }
        return false
      }
    },
    release() {
      try {
        if (Number(fs.readFileSync(file, 'utf8')) === process.pid) fs.rmSync(file, { force: true })
      } catch {
        // ya no existe
      }
    },
  }
}

export function defaultDeps(overrides = {}) {
  return {
    platform: process.platform,
    env: process.env,
    root: ROOT,
    run: defaultRun,
    tcpProbe: defaultTcpProbe,
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    lock: fileLock(),
    log: line => console.log(line),
    limits: LIMITS,
    ...overrides,
  }
}

// ------------------------------------------------------------------ WSL

function wslFailure(result) {
  const text = `${result.stdout}\n${result.stderr}`
  if (result.error === 'ENOENT') return new DevSetupError('No se encuentra wsl.exe. Instala WSL 2 y Ubuntu (docs/postgresql.md).', DIAGNOSTIC)
  if (result.error === 'ETIMEDOUT') return new DevSetupError('WSL no ha respondido a tiempo.', ['Vuelve a intentarlo; la primera vez Ubuntu puede tardar en arrancar.', ...DIAGNOSTIC])
  if (/ERROR_NO_SYSTEM_RESOURCES/i.test(text)) {
    return new DevSetupError('WSL no ha podido arrancar Ubuntu: Windows no tiene memoria libre suficiente para la máquina virtual.', [
      'Cierra aplicaciones que consuman mucha memoria y vuelve a ejecutar pnpm.cmd dev.',
      'Si se repite, limita la memoria de WSL en %USERPROFILE%\\.wslconfig ([wsl2] memory=2GB); el cambio se aplica cuando WSL vuelve a arrancar.',
      ...DIAGNOSTIC,
    ])
  }
  if (/Wsl\/Service|CreateInstance|HCS\//i.test(text)) return new DevSetupError('WSL no ha podido arrancar la distribución.', DIAGNOSTIC)
  return null
}

function listDistros(deps) {
  const result = deps.run('wsl.exe', ['--list', '--verbose'], { env: { ...deps.env, WSL_UTF8: '1' }, timeout: deps.limits.wslMs })
  const failure = wslFailure(result)
  if (failure) throw failure
  if (result.status !== 0) throw new DevSetupError('WSL no tiene ninguna distribución instalada.', ['Instala Ubuntu: wsl.exe --install -d Ubuntu', ...DIAGNOSTIC])
  return result.stdout.split(/\r?\n/).slice(1).map(line => line.replace(/^\s*\*?\s*/, '').trim()).filter(Boolean).map(line => {
    const parts = line.split(/\s+/)
    return { name: parts.slice(0, -2).join(' '), state: parts.at(-2), version: parts.at(-1) }
  })
}

export function selectDistro(distros, env) {
  const wanted = env.ESTATEFORGE_WSL_DISTRO?.trim()
  if (wanted) {
    const found = distros.find(d => d.name === wanted)
    if (!found) throw new DevSetupError(`La distribución «${wanted}» (ESTATEFORGE_WSL_DISTRO) no existe en WSL.`, DIAGNOSTIC)
    return found
  }
  const ubuntu = distros.filter(d => /^ubuntu/i.test(d.name))
  if (ubuntu.length === 1) return ubuntu[0]
  if (ubuntu.length === 0) throw new DevSetupError('No hay ninguna distribución Ubuntu en WSL.', ['Instala Ubuntu (wsl.exe --install -d Ubuntu) o indica la tuya en ESTATEFORGE_WSL_DISTRO.', ...DIAGNOSTIC])
  throw new DevSetupError(`Hay varias distribuciones Ubuntu (${ubuntu.map(d => d.name).join(', ')}) y no se puede saber cuál tiene PostgreSQL.`, [
    'Indica cuál usar, por ejemplo en PowerShell: $env:ESTATEFORGE_WSL_DISTRO = "Ubuntu"',
  ])
}

function linuxRunner(deps, distro, user) {
  return (args, timeout = deps.limits.scriptMs) => {
    const result = deps.run('wsl.exe', ['-d', distro, '-u', user, '--exec', ...args], { env: { ...deps.env, WSL_UTF8: '1' }, timeout })
    const failure = wslFailure(result)
    if (failure) throw failure
    return result
  }
}

function localRunner(deps) {
  return (args, timeout = deps.limits.scriptMs) => {
    const result = deps.run(args[0], args.slice(1), { env: deps.env, timeout })
    if (result.error === 'ETIMEDOUT') throw new DevSetupError(`«${args.join(' ')}» no ha terminado a tiempo.`, DIAGNOSTIC)
    if (result.error) throw new DevSetupError(`No se ha podido ejecutar ${args[0]}.`, DIAGNOSTIC)
    return result
  }
}

// Entorno donde se ejecuta scripts/wsl/postgres-dev.sh: Ubuntu en WSL desde Windows, o Linux directamente.
export function resolveTarget(deps) {
  if (deps.platform !== 'win32') {
    const script = path.posix.join(deps.root.split(path.sep).join('/'), SCRIPT)
    const exec = localRunner(deps)
    if (exec(['test', '-f', script]).status !== 0) throw new DevSetupError(`No existe ${SCRIPT} en el repositorio.`, DIAGNOSTIC)
    return { description: 'Linux local', script, exec }
  }
  const distro = selectDistro(listDistros(deps), deps.env)
  const user = deps.env.ESTATEFORGE_WSL_USER?.trim() || DEFAULT_USER
  const exec = linuxRunner(deps, distro.name, user)
  if (exec(['id', '-u'], deps.limits.wslMs).status !== 0) {
    throw new DevSetupError(`El usuario Linux «${user}» no existe en ${distro.name}.`, ['Indica tu usuario en ESTATEFORGE_WSL_USER (por ejemplo, $env:ESTATEFORGE_WSL_USER = "tu_usuario").', ...DIAGNOSTIC])
  }
  // La ruta se pasa como un argumento, sin shell: los espacios no rompen nada.
  const converted = exec(['wslpath', '-a', deps.root])
  const linuxRoot = converted.stdout.trim()
  if (converted.status !== 0 || !linuxRoot.startsWith('/')) throw new DevSetupError('No se ha podido traducir la ruta del repositorio a WSL (wslpath).', DIAGNOSTIC)
  const script = path.posix.join(linuxRoot, SCRIPT)
  if (exec(['test', '-f', script]).status !== 0) throw new DevSetupError(`No existe ${SCRIPT} accesible desde ${distro.name}.`, DIAGNOSTIC)
  return { description: `${distro.name} (WSL ${distro.version})${distro.version === '1' ? ' — WSL 1: el reenvío de localhost y las señales se han probado solo con WSL 2' : ''}`, script, exec }
}

// ------------------------------------------------------------------ PostgreSQL

const ACCEPTING = /aceptando conexiones/

export function postgresStatus(target) {
  const result = target.exec(['bash', target.script, 'status'])
  return { accepting: result.status === 0 && ACCEPTING.test(result.stdout), text: result.stdout.trim() }
}

function configuredPort(target) {
  const result = target.exec(['bash', target.script, 'port'])
  const port = Number(result.stdout.trim())
  if (result.status !== 0 || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new DevSetupError('scripts/wsl/postgres-dev.sh no indica un puerto válido. ¿Están instaladas las herramientas (scripts/wsl/instalar-herramientas.sh)?', DIAGNOSTIC)
  }
  return port
}

async function waitAccepting(deps, target) {
  for (let attempt = 0; attempt < deps.limits.statusAttempts; attempt += 1) {
    if (postgresStatus(target).accepting) return true
    await deps.sleep(deps.limits.retryDelayMs)
  }
  return false
}

async function waitTcp(deps, port) {
  for (let attempt = 0; attempt < deps.limits.tcpAttempts; attempt += 1) {
    if (await deps.tcpProbe('127.0.0.1', port, deps.limits.tcpTimeoutMs)) return true
    await deps.sleep(deps.limits.retryDelayMs)
  }
  return false
}

// Conexión autenticada con la configuración real de la API (apps/api/.env), sin mostrar secretos.
export function checkCredentials(deps) {
  const api = path.join(deps.root, 'apps', 'api')
  const tsx = path.join(api, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  const result = deps.run(process.execPath, [tsx, path.join('src', 'db', 'check-connection.ts')], { cwd: api, env: deps.env, timeout: deps.limits.checkMs })
  if (result.error === 'ETIMEDOUT') throw new DevSetupError('La comprobación de las credenciales no ha terminado a tiempo.', DIAGNOSTIC)
  const line = result.stdout.trim().split(/\r?\n/).at(-1) ?? ''
  try {
    return JSON.parse(line)
  } catch {
    throw new DevSetupError('No se ha podido comprobar la conexión de apps/api/.env (¿están instaladas las dependencias? pnpm install).', DIAGNOSTIC)
  }
}

async function withLock(deps, work) {
  const started = Date.now()
  let waiting = false
  while (!deps.lock.tryAcquire()) {
    if (!waiting) deps.log('      Otro «pnpm dev» está preparando PostgreSQL; esperando a que termine...')
    waiting = true
    if (Date.now() - started > deps.limits.lockWaitMs) throw new DevSetupError('Otro «pnpm dev» lleva demasiado tiempo preparando PostgreSQL.', DIAGNOSTIC)
    await deps.sleep(deps.limits.retryDelayMs)
  }
  try {
    return await work()
  } finally {
    deps.lock.release()
  }
}

/** Deja PostgreSQL listo para la API. Lanza DevSetupError (sin secretos) si no lo consigue. */
export async function prepare(deps) {
  const manage = deps.env.ESTATEFORGE_DEV_DB_START !== '0'
  return withLock(deps, async () => {
    let port = null
    if (manage) {
      const windows = deps.platform === 'win32'
      deps.log(windows ? '[1/4] Comprobando WSL...' : '[1/4] Comprobando el entorno Linux...')
      const target = resolveTarget(deps)
      deps.log(`      ${target.description} disponible.`)

      deps.log('[2/4] Comprobando PostgreSQL...')
      if (postgresStatus(target).accepting) {
        deps.log('      PostgreSQL ya estaba en marcha. No es necesario reiniciarlo.')
      } else {
        deps.log('      PostgreSQL detenido. Iniciándolo...')
        const started = target.exec(['bash', target.script, 'start'])
        if (started.status !== 0) {
          throw new DevSetupError('scripts/wsl/postgres-dev.sh no ha podido arrancar PostgreSQL.', [
            ...started.stdout.trim().split(/\r?\n/).filter(Boolean).slice(-3).map(l => `postgres-dev.sh: ${l}`),
            ...started.stderr.trim().split(/\r?\n/).filter(Boolean).slice(-3).map(l => `postgres-dev.sh: ${l}`),
            ...DIAGNOSTIC,
          ])
        }
        if (!(await waitAccepting(deps, target))) throw new DevSetupError('PostgreSQL ha arrancado pero no acepta conexiones.', DIAGNOSTIC)
        deps.log('      PostgreSQL disponible.')
      }
      port = configuredPort(target)

      deps.log(windows ? '[3/4] Comprobando la conexión desde Windows...' : '[3/4] Comprobando la conexión TCP...')
      if (!(await waitTcp(deps, port))) {
        throw new DevSetupError(`PostgreSQL acepta conexiones en WSL, pero 127.0.0.1:${port} no responde desde ${deps.platform === 'win32' ? 'Windows' : 'este sistema'}.`, [
          'Comprueba que WSL 2 tiene activado el reenvío de localhost (localhostForwarding, activo por defecto).',
          ...DIAGNOSTIC,
        ])
      }
      deps.log(`      127.0.0.1:${port} disponible.`)
    } else {
      deps.log('[1-3] ESTATEFORGE_DEV_DB_START=0: no se gestiona el servidor; solo se comprueba la conexión.')
    }

    deps.log('[4/4] Comprobando las credenciales de apps/api/.env...')
    const check = checkCredentials(deps)
    if (!check.ok) {
      const hints = check.reason === 'protocol' && port !== null ? [`Otro servicio de Windows puede estar ocupando el puerto ${port}: netstat -ano | findstr :${port}`] : []
      throw new DevSetupError(check.message ?? 'La conexión de apps/api/.env no funciona.', [...hints, ...DIAGNOSTIC])
    }
    if (port !== null && (check.port !== port || !['127.0.0.1', 'localhost'].includes(check.host))) {
      throw new DevSetupError(`DATABASE_URL apunta a ${check.host}:${check.port}, pero el PostgreSQL de desarrollo escucha en 127.0.0.1:${port}.`, ['Copia DATABASE_URL de ~/.config/estateforge/postgres-dev.env (docs/postgresql.md).', ...DIAGNOSTIC])
    }
    deps.log(`      Conexión autenticada con «${check.database}».`)
    return { port: check.port, database: check.database }
  })
}

function banner(deps, port) {
  deps.log('--------------------------------')
  deps.log('Frontend: http://localhost:5173')
  deps.log('API:      http://localhost:3000 (o el PORT de apps/api/.env)')
  deps.log(`Database: PostgreSQL en 127.0.0.1:${port}`)
  deps.log('Ctrl+C detiene la API y la web; PostgreSQL sigue en marcha (pnpm.cmd db:dev:stop para detenerlo).')
  deps.log('--------------------------------')
}

function reportError(deps, error) {
  if (!(error instanceof DevSetupError)) throw error
  deps.log('')
  deps.log(`ERROR: ${error.message}`)
  deps.log('La API y la web no se han arrancado.')
  if (error.hints.length) {
    deps.log('Diagnóstico:')
    for (const hint of error.hints) deps.log(`  - ${hint}`)
  }
  return 1
}

/** Punto de entrada; devuelve el código de salida. */
export async function main(action, deps = defaultDeps()) {
  try {
    if (action === 'start') {
      deps.log('EstateForge Dev')
      deps.log('------------------------------')
      const { port } = await prepare(deps)
      deps.log('      Iniciando la API y la web...')
      banner(deps, port)
      return 0
    }
    if (action === 'status') {
      const target = resolveTarget(deps)
      const status = postgresStatus(target)
      deps.log(status.text || 'PostgreSQL detenido.')
      if (!status.accepting) return 1
      const port = configuredPort(target)
      const reachable = await deps.tcpProbe('127.0.0.1', port, deps.limits.tcpTimeoutMs)
      deps.log(reachable ? `Accesible desde ${deps.platform === 'win32' ? 'Windows' : 'este sistema'} en 127.0.0.1:${port}.` : `127.0.0.1:${port} no responde desde ${deps.platform === 'win32' ? 'Windows' : 'este sistema'}.`)
      return reachable ? 0 : 1
    }
    if (action === 'stop') {
      const target = resolveTarget(deps)
      const result = target.exec(['bash', target.script, 'stop'])
      deps.log(result.stdout.trim() || result.stderr.trim())
      return result.status === 0 ? 0 : 1
    }
    deps.log('Uso: node scripts/dev/postgres-wsl.mjs start|status|stop')
    return 2
  } catch (error) {
    return reportError(deps, error)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv[2])
}
