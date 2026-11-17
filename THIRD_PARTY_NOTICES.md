# Third-party notices

EstateForge is proprietary software (see [LICENSE](LICENSE)). It includes or uses the third-party
components listed below, which remain under their own licenses. Inventory date: 17 November 2026.

## 1. Code shipped to the browser

These packages end up in the JavaScript and CSS served by the web app (determined from the
production build's source maps):

| Package | Version | License |
| --- | --- | --- |
| react, react-dom, scheduler | 19.2.8, 19.2.8, 0.27.0 | MIT |
| react-router | 8.3.0 | MIT |
| @base-ui/react, @base-ui/utils | 1.7.0, 0.3.2 | MIT |
| @floating-ui/utils | 0.2.12 | MIT |
| lucide-react (icons) | 1.30.0 | ISC |
| class-variance-authority | 0.7.1 | Apache-2.0 |
| clsx | 2.1.1 | MIT |
| tailwind-merge | 3.6.0 | MIT |
| zod | 4.6.7 | MIT |
| tailwindcss (generated CSS), tw-animate-css, shadcn (CSS base, build-time package) | 4.3.3, 1.4.0, 4.16.2 | MIT |

## 2. Fonts

| Font | Package | License |
| --- | --- | --- |
| Inter | @fontsource-variable/inter 5.3.0 | SIL Open Font License 1.1 |
| Manrope | @fontsource-variable/manrope 5.3.0 | SIL Open Font License 1.1 |

The font files are served unmodified from the packages. The social card `apps/web/public/og-image.png`
was rendered by the author from the EstateForge logo with these two fonts.

## 3. Server runtime (main components)

| Package | Version | License |
| --- | --- | --- |
| fastify, @fastify/cors, @fastify/rate-limit | 5.12.8, 11.4.3, 11.2.2 | MIT |
| prisma, @prisma/client, @prisma/adapter-pg | 7.9.1 | Apache-2.0 |
| pg | 8.23.1 | MIT |
| @vercel/blob | 2.8.2 | Apache-2.0 |
| @google/genai | 2.17.1 | Apache-2.0 |
| nodemailer | 10.6.0 | MIT-0 |
| dotenv | 17.4.2 | BSD-2-Clause |
| zod | 4.6.7 | MIT |

## 4. All dependencies

The complete list of direct and transitive dependencies (594 packages, including build and test
tooling), with version, license and whether each one is a production dependency of a workspace, is
in [docs/legal/dependency-licenses.json](docs/legal/dependency-licenses.json). Summary by license:

| License | Packages |
| --- | --- |
| MIT | 462 |
| Apache-2.0 | 56 |
| ISC | 37 |
| BSD-3-Clause | 21 |
| BSD-2-Clause | 4 |
| OFL-1.1 | 2 (fonts, section 2) |
| BlueOak-1.0.0 | 2 (isexe, minimatch; build tooling) |
| MPL-2.0 | 2 (lightningcss; build tooling, not distributed) |
| Unlicense | 2 (postgres, robust-predicates; Prisma CLI tooling) |
| MIT AND ISC | 1 (@visx/vendor; Prisma CLI tooling) |
| Python-2.0 | 1 (argparse; build tooling) |
| CC-BY-4.0 | 1 (caniuse-lite; build data, not distributed) |
| EPL-2.0 | 1 (elkjs; Prisma CLI tooling, not distributed) |
| MIT-0 | 1 (nodemailer) |
| 0BSD | 1 (tslib) |

To regenerate it: `pnpm licenses list --json` and `pnpm --filter <workspace> licenses list --prod --json`.

## 5. Logos and trademarks

Third-party names and logos identify the corresponding products and services. They belong to their
owners and are not covered by the EstateForge license.

| File | Origin | License or terms |
| --- | --- | --- |
| `apps/web/src/assets/providers/{gemini,anthropic,deepseek,mistral,openrouter,replicate}.svg` | Simple Icons 16.36.0 | Icons CC0 1.0; trademarks of their owners |
| `apps/web/src/assets/providers/bfl.svg` | Black Forest Labs brand kit (`bfl.ai/brand`), unmodified | Black Forest Labs brand guidelines |
| `apps/web/public/portales/{idealista.ico,fotocasa.svg,pisos.png,yaencontre.ico,habitaclia.svg}` | Real estate portal logos used in the publication record | Trademarks of their owners. **Origin not recorded in the repository: pending confirmation by the owner** |

## 6. Other material

- **Audio presets** are synthesised in the browser at run time; no audio files are included.
- **Test fixtures.** `apps/api/src/test-support/` generates its images and audio in code.
  `apps/api/src/ai-media/fixtures/simulador-clip.webm`, the clip returned by the local AI simulator, is
  a short synthetic recording made with a Chromium browser's MediaRecorder (VP8 + Opus, according to
  its metadata). None of them contains third-party or personal material.
- **Demo seed** (`apps/api/prisma/seed.ts`, `demo-photos.ts`) uses fictitious data and images drawn
  by code.
- **Agent skills.** Earlier commits of the history contain the `prisma/skills` bundles
  (`apps/api/.agents`, `.claude`, `.windsurf`) from https://github.com/prisma/skills, which the upstream repository
  publishes under the MIT License (the bundles themselves do not include the license file). They were removed from the tracked tree in version 1.0.0 and remain
  in the history under that MIT license.
- **Vite starter assets** present in early commits (`react.svg`, `vite.svg`, `hero.png`,
  `icons.svg`) come from the create-vite template (MIT) and were removed in version 1.0.0.
