# Commit message policy

Every commit published in this repository follows these rules. `pnpm check:commits [<range>]`
checks them locally and the CI workflow checks every pushed commit. Git hooks are not required.

## Format

Messages follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/):

```
<type>(<optional scope>)!: <description>

<optional body>

<optional footers>
```

- **Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`,
  `revert`. Security fixes use `fix` (with a `security` scope or a clear description).
- **Scope:** optional, lower case, naming the area: `api`, `web`, `shared`, `db`, `dev`, `deps`, …
- **Breaking changes:** `!` after the type or scope and a `BREAKING CHANGE:` footer.
- **Description:** imperative mood, no final period, header of at most 100 characters.
- **Body:** separated from the header by a blank line; explains what changed and why.
- **Language:** English, header and body.

## Authorship

- Commits are authored and committed with the maintainer's own Git identity, configured per
  repository.
- No trailers, signatures or text attributing a commit to AI tools or assistants
  (`Co-authored-by` for an AI tool, "Generated with …", and similar). `Co-authored-by` is only
  used for real human co-authors.

## History normalisation for version 1.0.0

The commits written before version 1.0.0 used Spanish and non-standard headers. Before the first
publication, their messages were rewritten in a separate local copy so that the published history
follows this policy. Trees, parents, authors and dates are unchanged; only the messages (and
therefore the commit hashes) differ. The procedure, the old-to-new mapping and the checks are in
[docs/release/history-rewrite.md](release/history-rewrite.md).
