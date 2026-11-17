# Third-party license texts kept in the repository

These files reproduce, unmodified, the official license texts of third-party material that is (or
was) included as source in this repository, as opposed to dependencies installed from npm. They were
retrieved on 17 November 2026.

| File | Applies to | Retrieved from |
| --- | --- | --- |
| `shadcn-ui-MIT.txt` | Component code generated with the shadcn/ui CLI and adapted in `apps/web/src/components/ui/button.tsx` and `apps/web/src/lib/utils.ts` (`cn` helper) | https://github.com/shadcn-ui/ui, `LICENSE.md` at tag `shadcn@4.16.2` |
| `create-vite-MIT.txt` | The create-vite React + TypeScript template used to scaffold `apps/web` in the first commits (configuration files, `react.svg`, `vite.svg`, `hero.png`, `icons.svg` and starter code), present in the history | https://github.com/vitejs/vite, `packages/create-vite/LICENSE` on `main`. The relevant notice is its first section (MIT, VoidZero Inc. and Vite contributors); the rest lists create-vite's own bundled dependencies |
| `prisma-skills-MIT.txt` | The `prisma/skills` bundles committed under `apps/api/.agents`, `apps/api/.claude` and `apps/api/.windsurf` in the history (removed from the tree in version 1.0.0) | https://github.com/prisma/skills, `LICENSE` on `main` (the project publishes no release tags) |

Dependencies installed from npm are not vendored. The licenses of the ones whose code, styles or
fonts are served to the browser are generated at build time into `third-party-notices.txt` (see
`apps/web/tooling/notices.ts` and [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)).
