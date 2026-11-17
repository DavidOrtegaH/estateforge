# History normalisation before the first publication

Version 1.0.0 is the first public version. The commits made before it had Spanish or
non-standard messages, and some carried trailers attributing them to an AI tool. Before the first
push, a copy of the history was produced in which only the messages change, so that the public
history follows the [commit message policy](../commit-message-policy.md).

## What changes and what does not

| Aspect | Result |
| --- | --- |
| Commit messages | Rewritten as listed in [commit-message-map.json](commit-message-map.json); every message also loses trailers that attribute it to AI tools |
| Trees (file contents) | Identical, commit by commit |
| Parents and topology | Identical, mapped to the new hashes |
| Author, committer, emails and dates | Identical |
| Commit hashes | Change, because the message is part of the commit |
| Signatures | None existed; nothing is lost |
| Published refs | Only `main`, `develop`, `release` and `feature`, plus the `v1.0.0` tag |
| Not published | Any other branch (for example `showcase/*`), `refs/codex/*` and other private refs, reflogs, stashes, notes and backups |

The original repository is not modified. Nothing is force-pushed: the repository has never been
published.

## Procedure

1. Integrate and validate the four branches in the original repository (they all point to the
   release commit).
2. Generate the publishable copy in a new directory:

   ```sh
   node scripts/git/rewrite-history.mjs \
     --source . \
     --target ../estateforge-public.git \
     --map docs/release/commit-message-map.json \
     --refs main,develop,release,feature \
     --report ../estateforge-public-report.json
   ```

   The script exports only those branches with `git fast-export --show-original-ids`, replaces the
   messages, imports them with `git fast-import` into a new bare repository and then checks every
   commit: same tree, same author and committer (name, email and date) and the same parents once
   mapped. It writes the old → new hash mapping to the report and exits with an error if any check
   fails or if the target contains a ref that was not requested.
3. Check the messages of the copy: `node scripts/git/check-commit-messages.mjs` run inside a clone
   of the copy (or `git -C ../estateforge-public.git log`), which must report every commit as valid.
4. Create the annotated tag `v1.0.0` on `main` in the copy, with the release notes as its message.
5. Publish from the copy, pushing each branch and the tag explicitly (never `--mirror` and never
   `--all` from the original repository).

## Verifications to repeat before publishing

- `git -C <copy> for-each-ref` lists only the four branches and the tag.
- The four branches point to the same commit and `git -C <copy> rev-parse main^{tree}` equals the
  tree of `main` in the original repository.
- `git -C <copy> log --all --format=%B` contains no AI attribution trailers.
- `git -C <copy> log --all --format='%an <%ae>|%cn <%ce>'` shows only the maintainer's identity.
- `git -C <copy> fsck --full` reports no errors.
