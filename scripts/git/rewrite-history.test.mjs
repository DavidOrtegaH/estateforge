import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

import { cleanMessage, rewriteStream } from './rewrite-history.mjs'

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'rewrite-history.mjs')
const dirs = []
const temp = () => { const dir = mkdtempSync(path.join(tmpdir(), 'ef-rewrite-test-')); dirs.push(dir); return dir }
afterAll(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }) })

describe('cleanMessage', () => {
  it('removes AI attribution and keeps human co-authors', () => {
    expect(cleanMessage('feat: x\n\nBody.\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n')).toBe('feat: x\n\nBody.\n')
    expect(cleanMessage('feat: x\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)')).toBe('feat: x\n')
    expect(cleanMessage('feat: x\n\nCo-authored-by: Ana <ana@example.org>')).toBe('feat: x\n\nCo-authored-by: Ana <ana@example.org>\n')
  })
})

describe('rewriteStream', () => {
  it('replaces only commit messages and leaves blobs byte for byte', () => {
    const blob = Buffer.from([0x00, 0x0a, 0xff, 0x64, 0x61, 0x74, 0x61, 0x20, 0x39, 0x0a])
    const stream = Buffer.concat([
      Buffer.from(`blob\nmark :1\noriginal-oid aaa\ndata ${blob.length}\n`), blob, Buffer.from('\n'),
      Buffer.from('reset refs/heads/main\ncommit refs/heads/main\nmark :2\noriginal-oid bbb\nauthor A <a@x> 1 +0000\ncommitter A <a@x> 1 +0000\ndata 13\nchore: viejo\nM 100644 :1 file.bin\n\n'),
    ])
    const out = rewriteStream(stream, oid => (oid === 'bbb' ? 'chore: new message' : 'unexpected'))
    expect(out.includes(blob)).toBe(true)
    expect(out.toString('latin1')).toContain('data 19\nchore: new message\n')
    expect(out.toString('latin1')).toContain('M 100644 :1 file.bin')
  })
})

describe('rewrite-history end to end', () => {
  it('rewrites messages, keeps trees, authors, dates and parents, and exports only the listed branches', () => {
    const repo = temp()
    const run = (args, env = {}) => execFileSync('git', ['-C', repo, ...args], { env: { ...process.env, ...env }, encoding: 'utf8' }).trim()
    run(['init', '--quiet', '--initial-branch=main'])
    run(['config', 'user.name', 'Owner'])
    run(['config', 'user.email', 'owner@example.org'])
    const commit = (file, content, message, date) => {
      writeFileSync(path.join(repo, file), content)
      run(['add', file])
      run(['commit', '--quiet', '-m', message], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date })
      return run(['rev-parse', 'HEAD'])
    }
    const first = commit('a.txt', 'uno\n', 'chore: inicializado el repo', '2026-08-09T10:00:00+0200')
    writeFileSync(path.join(repo, 'bin.dat'), Buffer.from([0, 1, 2, 255, 10, 13]))
    run(['add', 'bin.dat'])
    run(['commit', '--quiet', '-m', 'feat: binario\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>'], { GIT_AUTHOR_DATE: '2026-08-10T10:00:00+0200', GIT_COMMITTER_DATE: '2026-08-10T11:00:00+0200' })
    const second = run(['rev-parse', 'HEAD'])
    run(['checkout', '--quiet', '-b', 'feature', first])
    commit('b.txt', 'dos\n', 'feat: rama', '2026-08-11T10:00:00+0200')
    run(['checkout', '--quiet', 'main'])
    run(['merge', '--quiet', '--no-ff', '-m', 'chore: fusiona la rama', 'feature'], { GIT_AUTHOR_DATE: '2026-08-12T10:00:00+0200', GIT_COMMITTER_DATE: '2026-08-12T10:00:00+0200' })
    run(['branch', 'showcase'])
    run(['update-ref', 'refs/codex/private', 'HEAD'])

    const map = path.join(temp(), 'map.json')
    writeFileSync(map, JSON.stringify({ commits: [{ old: first, message: 'chore: initialize the repository' }, { old: second, message: 'feat: add a binary file' }] }))
    const target = path.join(temp(), 'out.git')
    const report = path.join(temp(), 'report.json')
    execFileSync('node', [script, '--source', repo, '--target', target, '--map', map, '--refs', 'main,feature', '--report', report], { encoding: 'utf8' })

    const result = JSON.parse(readFileSync(report, 'utf8'))
    expect(result.problems).toEqual([])
    expect(result.commits).toBe(4)
    const log = execFileSync('git', ['-C', target, 'log', '--format=%s|%an|%ad|%cd', '--date=raw', '--topo-order', '--reverse', 'main'], { encoding: 'utf8' }).trim().split('\n')
    const original = run(['log', '--format=%s|%an|%ad|%cd', '--date=raw', '--topo-order', '--reverse', 'main']).split('\n')
    expect(log[0]).toBe(`chore: initialize the repository|${original[0].split('|').slice(1).join('|')}`)
    expect(log.map(line => line.split('|').slice(1).join('|'))).toEqual(original.map(line => line.split('|').slice(1).join('|')))
    expect(log.map(line => line.split('|')[0])).toContain('feat: add a binary file')
    const messages = execFileSync('git', ['-C', target, 'log', '--format=%B', 'main'], { encoding: 'utf8' })
    expect(messages).not.toMatch(/anthropic|Co-Authored-By/i)
    expect(execFileSync('git', ['-C', target, 'for-each-ref', '--format=%(refname)'], { encoding: 'utf8' }).trim().split('\n').sort()).toEqual(['refs/heads/feature', 'refs/heads/main'])
    expect(execFileSync('git', ['-C', target, 'rev-parse', 'main^{tree}'], { encoding: 'utf8' })).toBe(execFileSync('git', ['-C', repo, 'rev-parse', 'main^{tree}'], { encoding: 'utf8' }))
    expect(run(['rev-parse', 'HEAD'])).toBe(result.branches.main.old)
  })
})
