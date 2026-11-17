#!/usr/bin/env node
// Builds the publishable copy of the history with normalised commit messages, without modifying the
// source repository (it only reads it with git fast-export).
//
//   node scripts/git/rewrite-history.mjs --source <repo> --target <new bare repo> \
//     --map docs/release/commit-message-map.json --refs main,develop,release,feature \
//     [--remove-paths <path>[,<path>...]] [--report <file.json>]
//
// - Only the listed branches are exported: no other branches, tags, notes, reflogs or private refs.
// - Each commit keeps its tree, parents (rewritten), author, committer and dates. Only the message
//   changes: the one in the map for the original hash, or the original one; in both cases trailers
//   that attribute the commit to AI tools are removed.
// - --remove-paths drops a closed list of files or directories from every commit (for material that
//   cannot be redistributed). Nothing else in the trees changes.
// - Afterwards it checks, commit by commit, that authors, committers, dates and the parent structure
//   are identical and that each tree is identical once the removed paths are excluded from the
//   original; it also checks that no removed path or blob is left in the new repository, and writes
//   the old → new hash mapping with the commits whose trees changed.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const AI_TRAILER = /^(co-authored-by|generated-by|signed-off-by):.*(claude|anthropic|openai|chatgpt|codex|copilot)/i
const AI_LINE = /^(🤖 )?generated with \[?(claude|chatgpt|codex)/i

/** Removes lines that attribute a commit to AI tools and normalises the final newline. */
export function cleanMessage(message) {
  const lines = message.replace(/\r\n/g, '\n').split('\n').filter(line => !AI_TRAILER.test(line.trim()) && !AI_LINE.test(line.trim()))
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`
}

/**
 * Rewrites the commit messages of a git fast-export stream (Buffer) and returns the new stream.
 * Blobs and every other command pass through byte for byte.
 */
/** True when a repository path is one of the removed paths or lies inside a removed directory. */
export const isRemovedPath = (file, removed) => removed.some(entry => file === entry || file.startsWith(`${entry.replace(/\/$/, '')}/`))

const unquote = file => (file.startsWith('"') ? JSON.parse(file) : file)

export function rewriteStream(stream, messageFor, removed = []) {
  const out = []
  let pos = 0
  let commitOid = null
  let inCommit = false
  let inOps = false
  const readLine = () => {
    const end = stream.indexOf(0x0a, pos)
    const line = stream.subarray(pos, end === -1 ? stream.length : end).toString('utf8')
    pos = end === -1 ? stream.length : end + 1
    return line
  }
  while (pos < stream.length) {
    const start = pos
    const line = readLine()
    if (line.startsWith('data ')) {
      const size = Number(line.slice(5))
      const data = stream.subarray(pos, pos + size)
      pos += size
      if (inCommit) {
        const message = cleanMessage(messageFor(commitOid, data.toString('utf8')))
        const bytes = Buffer.from(message, 'utf8')
        out.push(Buffer.from(`data ${bytes.length}\n`), bytes)
        inCommit = false
        inOps = true
      } else {
        out.push(stream.subarray(start, pos))
      }
      continue
    }
    if (inOps && removed.length) {
      const op = /^M \S+ \S+ (.+)$/.exec(line) ?? /^D (.+)$/.exec(line)
      if (op && isRemovedPath(unquote(op[1]), removed)) continue
    }
    if (line.startsWith('commit ')) {
      inCommit = true
      inOps = false
      commitOid = null
    } else if (inCommit && line.startsWith('original-oid ')) {
      commitOid = line.slice('original-oid '.length).trim()
    } else if (/^(blob|reset|tag|feature|done|progress|checkpoint)\b/.test(line)) {
      inCommit = false
      inOps = false
    }
    out.push(stream.subarray(start, pos))
  }
  return Buffer.concat(out)
}

const git = (cwd, args, input) => execFileSync('git', ['-C', cwd, ...args], { input, maxBuffer: 1024 * 1024 * 1024 })

/** Files of a commit as "mode type oid<TAB>path" entries, optionally without the removed paths. */
const entryPath = entry => entry.slice(entry.indexOf('\t') + 1)
const entryOid = entry => entry.split(/\s/)[2]
function treeEntries(repo, oid, removed = []) {
  return git(repo, ['ls-tree', '-r', '-z', '--full-tree', oid]).toString('utf8').split('\0').filter(Boolean)
    .filter(entry => !isRemovedPath(entryPath(entry), removed))
}

function commitInfo(repo, oid) {
  const [tree, parents, an, ae, ad, cn, ce, cd] = git(repo, ['show', '-s', '--format=%T%x00%P%x00%an%x00%ae%x00%ad%x00%cn%x00%ce%x00%cd', '--date=raw', oid]).toString('utf8').trim().split('\0')
  return { tree, parents: parents ? parents.split(' ') : [], author: [an, ae, ad], committer: [cn, ce, cd] }
}

async function main(argv) {
  const args = Object.fromEntries(argv.reduce((pairs, value, index) => (index % 2 === 0 ? [...pairs, [value.replace(/^--/, ''), argv[index + 1]]] : pairs), []))
  const { source, target, map, refs = 'main,develop,release,feature', report } = args
  const removed = (args['remove-paths'] ?? '').split(',').map(entry => entry.trim().replace(/\/$/, '')).filter(Boolean)
  if (!source || !target || !map) throw new Error('Usage: --source <repo> --target <dir> --map <json> [--refs a,b] [--remove-paths a,b] [--report <file>]')
  if (existsSync(target)) throw new Error(`The target ${target} already exists; choose a new directory.`)
  const branches = refs.split(',').map(ref => ref.trim()).filter(Boolean)
  for (const branch of branches) git(source, ['rev-parse', '--verify', `refs/heads/${branch}^{commit}`])
  const messages = new Map(JSON.parse(readFileSync(map, 'utf8')).commits.map(entry => [entry.old, entry.message]))

  const work = mkdtempSync(path.join(tmpdir(), 'ef-rewrite-'))
  try {
    const oldMarks = path.join(work, 'old.marks')
    const newMarks = path.join(work, 'new.marks')
    const exported = git(source, ['fast-export', '--show-original-ids', '--signed-tags=strip', '--tag-of-filtered-object=drop', '--reencode=yes', `--export-marks=${oldMarks}`, ...branches.map(branch => `refs/heads/${branch}`)])
    const stream = rewriteStream(exported, (oid, original) => messages.get(oid) ?? original, removed)
    execFileSync('git', ['init', '--bare', '--quiet', '--initial-branch=main', target])
    await new Promise((resolve, reject) => {
      const child = spawn('git', ['-C', target, 'fast-import', '--quiet', `--export-marks=${newMarks}`], { stdio: ['pipe', 'inherit', 'inherit'] })
      child.on('error', reject)
      child.on('close', code => (code === 0 ? resolve() : reject(new Error(`git fast-import exited with ${code}`))))
      child.stdin.end(stream)
    })
    // Blobs that only the removed paths used stay unreachable after the import: drop them.
    git(target, ['gc', '--prune=now', '--quiet'])

    const read = file => new Map(readFileSync(file, 'utf8').trim().split('\n').map(line => line.split(' ')))
    const before = read(oldMarks)
    const after = read(newMarks)
    const mapping = new Map()
    for (const [mark, oldOid] of before) if (after.has(mark)) mapping.set(oldOid, after.get(mark))
    const commits = []
    const problems = []
    const removedBlobs = new Map()
    for (const [oldOid, newOid] of mapping) {
      const type = git(source, ['cat-file', '-t', oldOid]).toString().trim()
      if (type !== 'commit') continue
      const a = commitInfo(source, oldOid)
      const b = commitInfo(target, newOid)
      const sameMeta = JSON.stringify(a.author) === JSON.stringify(b.author) && JSON.stringify(a.committer) === JSON.stringify(b.committer)
        && JSON.stringify(a.parents.map(parent => mapping.get(parent))) === JSON.stringify(b.parents)
      let removedHere = []
      let sameTree = a.tree === b.tree
      if (removed.length) {
        removedHere = treeEntries(source, oldOid).filter(entry => isRemovedPath(entryPath(entry), removed))
        for (const entry of removedHere) removedBlobs.set(entryOid(entry), entryPath(entry))
        const actual = treeEntries(target, newOid)
        sameTree = JSON.stringify(treeEntries(source, oldOid, removed)) === JSON.stringify(actual)
        if (actual.some(entry => isRemovedPath(entryPath(entry), removed))) problems.push({ old: oldOid, new: newOid, reason: 'removed path still present' })
      }
      if (!sameMeta || !sameTree) problems.push({ old: oldOid, new: newOid, before: a, after: b })
      commits.push({ old: oldOid, new: newOid, tree: a.tree, ...(removedHere.length ? { newTree: b.tree, removedPaths: removedHere.map(entryPath) } : {}) })
    }
    // No object of a removed file may survive in the new repository, unless the same content is still
    // used by a kept path (which the tree comparison above would have to justify).
    const keptBlobs = new Set()
    for (const { new: newOid } of commits) for (const entry of treeEntries(target, newOid)) keptBlobs.add(entryOid(entry))
    const stored = oid => { try { git(target, ['cat-file', '-e', oid]); return true } catch { return false } }
    const leftovers = [...removedBlobs].filter(([oid]) => !keptBlobs.has(oid) && stored(oid))
    if (leftovers.length) problems.push({ reason: 'removed blobs still stored', blobs: leftovers.map(([oid, file]) => ({ oid, path: file })) })
    const heads = Object.fromEntries(branches.map(branch => [branch, {
      old: git(source, ['rev-parse', `refs/heads/${branch}`]).toString().trim(),
      new: git(target, ['rev-parse', `refs/heads/${branch}`]).toString().trim(),
    }]))
    for (const [branch, { old, new: rewritten }] of Object.entries(heads)) {
      if (mapping.get(old) !== rewritten) problems.push({ branch, old, new: rewritten, reason: 'branch does not point to the rewritten tip' })
    }
    const refsInTarget = git(target, ['for-each-ref', '--format=%(refname)']).toString().trim().split('\n')
    const unexpected = refsInTarget.filter(ref => !branches.map(branch => `refs/heads/${branch}`).includes(ref))
    if (unexpected.length) problems.push({ reason: 'unexpected refs in target', refs: unexpected })
    const result = {
      source: path.basename(path.resolve(source)), branches: heads, commits: commits.length, removedPaths: removed,
      removedBlobs: [...removedBlobs].map(([oid, file]) => ({ oid, path: file, alsoKeptElsewhere: keptBlobs.has(oid) })),
      commitsWithChangedTrees: commits.filter(commit => commit.removedPaths).length, problems, mapping: commits,
    }
    if (report) writeFileSync(report, `${JSON.stringify(result, null, 1)}\n`)
    console.log(`${commits.length} commits rewritten; ${problems.length} problems; refs: ${refsInTarget.join(', ')}`)
    return problems.length ? 1 : 0
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then(code => process.exit(code), error => { console.error(error.message); process.exit(2) })
}
