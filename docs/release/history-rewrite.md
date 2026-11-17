# History normalisation and sanitisation before the first publication

Version 1.0.0 is the first public version. Before the first push, a copy of the history is produced
in which:

1. the commit messages follow the [commit message policy](../commit-message-policy.md) (the commits
   made before 1.0.0 had Spanish or non-standard messages, and some carried trailers attributing
   them to an AI tool), and
2. a closed list of paths whose content cannot be redistributed is removed from every commit.

The original repository is not modified. Nothing is force-pushed: the repository has never been
published.

## Removed paths (closed list)

| Path | Content | Reason | Commits affected |
| --- | --- | --- | --- |
| `apps/web/public/portales/` (`idealista.ico`, `fotocasa.svg`, `pisos.png`, `yaencontre.ico`, `habitaclia.svg`) | Favicons of five real estate portals, downloaded from their websites | Third-party marks and works with no license allowing redistribution. Version 1.0.0 identifies the portals by name with a generic icon instead | Added in the publication checklist commit (10 November 2026) and present until they were removed from the tree in 1.0.0 |

No other path is removed. Third-party material that may be redistributed under its license stays
in the history, with its license text in [`licenses/`](../../licenses/README.md) (see
[THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md)).

## What changes and what does not

| Aspect | Result |
| --- | --- |
| Commit messages | Rewritten as listed in [commit-message-map.json](commit-message-map.json); every message also loses trailers that attribute it to AI tools |
| Trees (file contents) | Identical, commit by commit, **except for the removed paths**: in the commits that contained them, the new tree equals the original tree without those paths. Every other file, mode and content is unchanged |
| Removed content | Absent from every commit and from the object database of the copy (checked blob by blob after `git gc --prune=now`) |
| Parents and topology | Identical, mapped to the new hashes |
| Author, committer, emails and dates | Identical |
| Commit hashes | Change, because messages and, in some commits, trees change |
| Signatures | None existed; nothing is lost |
| Published refs | Only `main`, `develop`, `release` and `feature`, plus the `v1.0.0` tag |
| Not published | Any other branch (for example `showcase/*`), `refs/codex/*` and other private refs, reflogs, stashes, notes, backups and earlier provisional candidates |

## Procedure

1. Integrate and validate the four branches in the original repository (they all point to the
   release commit).
2. Generate the publishable copy in a new directory:

   ```sh
   node scripts/git/rewrite-history.mjs \
     --source . \
     --target <new directory>/estateforge.git \
     --map docs/release/commit-message-map.json \
     --refs main,develop,release,feature \
     --remove-paths apps/web/public/portales \
     --report <new directory>/report.json
   ```

   The script exports only those branches with `git fast-export --show-original-ids`, replaces the
   messages, drops the file operations on the removed paths, imports the result with
   `git fast-import` into a new bare repository and runs `git gc --prune=now`. It then checks every
   commit: same author and committer (name, email and date), same parents once mapped, and a tree
   equal to the original tree without the removed paths. It also checks that no removed path appears
   in any commit and that no blob of a removed file is still stored. The report lists the old → new
   hash mapping, the commits whose trees changed with the paths removed from each, and the removed
   blobs. It exits with an error if any check fails or if the target contains a ref that was not
   requested.
3. Check the messages of the copy: `node scripts/git/check-commit-messages.mjs` run inside a clone
   of the copy, which must report every commit as valid.
4. Create the annotated tag `v1.0.0` on `main` in the copy, with the release notes as its message.
5. Publish from the copy, pushing each branch and the tag explicitly (never `--mirror` and never
   `--all` from the original repository).

## Verifications to repeat before publishing

- `git -C <copy> for-each-ref` lists only the four branches and the tag.
- The four branches point to the same commit, and the tree of `main` equals the tree of `main` in
  the original repository (the removed paths are no longer in the current tree).
- `git -C <copy> log --all --name-only` never shows a removed path.
- `git -C <copy> log --all --format=%B` contains no AI attribution trailers.
- `git -C <copy> log --all --format='%an <%ae>|%cn <%ce>'` shows only the maintainer's identity.
- `git -C <copy> fsck --full` reports no errors.
