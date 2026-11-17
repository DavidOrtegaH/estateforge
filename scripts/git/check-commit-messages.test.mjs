import { describe, expect, it } from 'vitest'

import { checkMessage, MAX_HEADER } from './check-commit-messages.mjs'

describe('commit message policy', () => {
  it.each([
    'feat(web): add a static landing page',
    'fix: return 503 when PostgreSQL is unavailable',
    'chore(api)!: drop the SQLite driver\n\nBREAKING CHANGE: PostgreSQL is now required.',
    'docs: document the deployment plan\n\nExplain the Vercel, Neon and Blob setup.\n\nRefs: MD-4',
    'build: set version 1.0.0\n',
    'revert: restore the previous rate limit\n\nThis reverts commit 1234567.',
  ])('accepts %j', message => {
    expect(checkMessage(message)).toEqual([])
  })

  it.each([
    ['feat(web/api) mock data', /header/],
    ['feat/fix: something', /header/],
    ['feat:improved buttons', /header/],
    ['security(api): harden sessions', /header/],
    ['feat: add a button.', /period/],
    ['feat: add a button\nsecond line without blank', /blank line/],
    ['feat: integrar protección contra bots', /English/],
    ['chore: inicializado EstateForge repository', /English/],
    ['fix: corrige el registro de usuarios', /English/],
    ['feat: add x\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>', /AI tools/],
    ['feat: add x\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)', /AI tools/],
    [`feat: ${'a'.repeat(MAX_HEADER)}`, /longer/],
  ])('rejects %j', (message, problem) => {
    expect(checkMessage(message).join('\n')).toMatch(problem)
  })

  it('ignores Spanish route and file names in paths and code spans', () => {
    expect(checkMessage('feat(web): add the /recuperar-cuenta page\n\nDocument it in docs/seguridad and `cuenta.ts`.')).toEqual([])
    expect(checkMessage('fix: PostgreSQL connection retries')).toEqual([])
  })

  it('keeps human co-authors', () => {
    expect(checkMessage('feat: add x\n\nCo-authored-by: Jane Doe <jane@example.org>')).toEqual([])
  })
})
