# Contributing

EstateForge is a personal project published so that its code can be read. It is not open source:
see [LICENSE](LICENSE).

**External contributions are not accepted.** Please do not open pull requests, and do not send
patches or code by any other means. Pull requests will be closed without review, and submitting
one grants no rights to the project.

Issues may be disabled or closed without reply. To report a security vulnerability, do not open a
public issue: follow [SECURITY.md](SECURITY.md).

## For the maintainer

These rules apply to the project's own commits:

- Messages follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/), in
  English, including the body. The full policy is in
  [docs/commit-message-policy.md](docs/commit-message-policy.md).
- `pnpm check:commits` validates the messages of a commit range and runs in CI.
- Branches: `feature` → `develop` → `release` → `main`. `main` is the default branch.
