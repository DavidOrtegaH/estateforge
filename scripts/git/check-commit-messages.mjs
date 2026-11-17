#!/usr/bin/env node
// Validates commit messages against docs/commit-message-policy.md: Conventional Commits 1.0.0, in
// English, without automated attribution to AI tools.
//
//   node scripts/git/check-commit-messages.mjs [<revision range>]   (default: HEAD, whole history)
//   node scripts/git/check-commit-messages.mjs --stdin              (one message from standard input)
//
// Exit code 0 when every message passes, 1 otherwise. Uses only git and Node.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const TYPES = ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert']
const HEADER = new RegExp(`^(${TYPES.join('|')})(\\([a-z0-9][a-z0-9/._-]*\\))?(!)?: (\\S.*)$`)
export const MAX_HEADER = 100

// Words that are frequent in Spanish and do not occur in normal English commit messages.
const SPANISH = /\b(el|los|las|del|para|con|sin|una|uno|que|por|como|cuando|añade|añadir|añadido|corrige|corregir|corregido|mejora|mejorar|mejorado|mejoradas|integra|integrar|integrado|inicializado|inicializada|actualiza|actualizado|elimina|eliminado|página|páginas|también|pruebas|usuario|usuarios|clave|claves|cuenta|seguridad|recuperación|contraseña|anuncio|anuncios|inmueble|inmuebles|versión)\b/i
const NON_ENGLISH_LETTERS = /[áéíóúñüÁÉÍÓÚÑÜ¿¡]/
const AI_ATTRIBUTION = /(co-authored-by:.*(claude|anthropic|openai|chatgpt|codex|copilot|gemini))|noreply@anthropic\.com|generated with \[?claude|🤖/i

/** Problems found in one commit message (empty when it is valid). */
export function checkMessage(message) {
  const problems = []
  const text = message.replace(/\r\n/g, '\n').replace(/\n+$/, '')
  const [header = '', second, ...rest] = text.split('\n')
  const match = HEADER.exec(header)
  if (!match) {
    problems.push(`header must be "<type>(<optional scope>): <description>" with a type in ${TYPES.join(', ')}`)
  } else {
    const description = match[4]
    if (/[.]$/.test(description)) problems.push('description must not end with a period')
  }
  if (header.length > MAX_HEADER) problems.push(`header is longer than ${MAX_HEADER} characters`)
  if (second !== undefined && second !== '') problems.push('the header must be followed by a blank line')
  const all = [header, ...(second ? [second] : []), ...rest].join('\n')
  // Paths, URLs and code spans may contain Spanish route or file names (/recuperar-cuenta).
  const prose = all.replace(/`[^`]*`/g, ' ').replace(/\S*\/\S*/g, ' ')
  if (NON_ENGLISH_LETTERS.test(prose) || SPANISH.test(prose)) problems.push('message must be written in English')
  if (AI_ATTRIBUTION.test(all)) problems.push('message must not contain attribution to AI tools')
  return problems
}

function commits(range) {
  const out = execFileSync('git', ['log', '--format=%H%x00%B%x00', range], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const parts = out.split('\0')
  const list = []
  for (let i = 0; i + 1 < parts.length; i += 2) list.push({ hash: parts[i].trim(), message: parts[i + 1] })
  return list
}

function main(argv) {
  if (argv[0] === '--stdin') {
    const problems = checkMessage(readFileSync(0, 'utf8'))
    for (const problem of problems) console.error(`- ${problem}`)
    return problems.length ? 1 : 0
  }
  const range = argv[0] ?? 'HEAD'
  let failed = 0
  const list = commits(range)
  for (const { hash, message } of list) {
    const problems = checkMessage(message)
    if (!problems.length) continue
    failed += 1
    console.error(`${hash.slice(0, 10)} ${message.split('\n')[0]}`)
    for (const problem of problems) console.error(`  - ${problem}`)
  }
  console.log(`${list.length - failed}/${list.length} commit messages follow the policy (${range}).`)
  return failed ? 1 : 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exit(main(process.argv.slice(2)))
