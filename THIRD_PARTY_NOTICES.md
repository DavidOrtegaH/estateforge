# Third-party notices

EstateForge is proprietary software (see [LICENSE](LICENSE)). The repository and the web application
include third-party material that remains under its own license. Nothing in the EstateForge license
restricts the rights those licenses grant for that material, and that material is not relicensed.
Inventory date: 17 November 2026.

## 1. How the notices are distributed

| What is distributed | Third-party material | Where its license texts are |
| --- | --- | --- |
| The built web application (`apps/web/dist`, served to every visitor) | JavaScript, CSS and fonts of the npm packages in section 2 | `third-party-notices.txt` at the root of the built site (`/third-party-notices.txt`, linked from the footer of the public pages and from the login and registration pages). It is generated on every build from the packages actually included and contains each license, copyright notice and NOTICE file as shipped by the installed package. The build fails if an included package has no license text |
| The source repository, current tree | Code adapted from shadcn/ui; provider logos (section 3) | [`licenses/`](licenses/README.md) and section 3 |
| The source repository, history | create-vite template files and the `prisma/skills` bundles (section 4) | [`licenses/`](licenses/README.md) |
| npm dependencies | Not vendored: they are installed from the npm registry under their own licenses | Their packages; summary in [docs/legal/dependency-licenses.json](docs/legal/dependency-licenses.json) |

The production minifier removes license comments from the JavaScript and CSS (checked in the 1.0.0
build), which is why the notices are distributed as a separate file.

## 2. Packages included in the built web application (1.0.0)

Generated list; versions as of this release.

| Package | Version | License | Text taken from |
| --- | --- | --- | --- |
| react, react-dom, scheduler | 19.2.8, 19.2.8, 0.27.0 | MIT | each package's `LICENSE` |
| react-router | 8.3.0 | MIT | `LICENSE.md` |
| cookie-es (dependency of react-router) | 3.1.1 | MIT | `LICENSE` |
| @base-ui/react, @base-ui/utils | 1.7.0, 0.3.2 | MIT | `LICENSE` |
| @floating-ui/utils | 0.2.12 | MIT | `LICENSE` |
| lucide-react (icons) | 1.30.0 | ISC (includes the Feather MIT notice) | `LICENSE` |
| class-variance-authority | 0.7.1 | Apache-2.0 (no NOTICE file upstream) | `LICENSE` |
| clsx | 2.1.1 | MIT | `license` |
| tailwind-merge | 3.6.0 | MIT | `LICENSE.md` |
| zod | 4.6.7 | MIT | `LICENSE` |
| tailwindcss (generated CSS), tw-animate-css, shadcn (base CSS) | 4.3.3, 1.4.0, 4.16.2 | MIT | `LICENSE`, `LICENSE`, `LICENSE.md` |
| vite (module preload helper injected in the bundle) | 8.3.8 | MIT | first section of `LICENSE.md` (Vite core license) |
| Inter (`@fontsource-variable/inter`) | 5.3.0 | SIL Open Font License 1.1 | `LICENSE` (Copyright 2016 The Inter Project Authors) |
| Manrope (`@fontsource-variable/manrope`) | 5.3.0 | SIL Open Font License 1.1 | `LICENSE` (Copyright 2019 The Manrope Project Authors) |

The font files are served unmodified, and the OFL text travels with them in `third-party-notices.txt`.
The social card `apps/web/public/og-image.png` is an image rendered by the author with these fonts;
the OFL does not restrict documents or images created with the fonts.

## 3. Material in the current tree

| Path | Origin | License or terms |
| --- | --- | --- |
| `apps/web/src/components/ui/button.tsx`, `apps/web/src/lib/utils.ts` | Generated with the shadcn/ui CLI and adapted | MIT, Copyright (c) 2023 shadcn: [`licenses/shadcn-ui-MIT.txt`](licenses/shadcn-ui-MIT.txt) |
| `apps/web/src/assets/providers/{gemini,anthropic,deepseek,mistral,openrouter,replicate}.svg` | Simple Icons 16.36.0 | CC0 1.0 (no notice required); the marks belong to their owners and identify the AI provider the user connects |
| `apps/web/src/assets/providers/bfl.svg` | Black Forest Labs brand kit (`bfl.ai/brand`), unmodified | Black Forest Labs brand guidelines; used only to identify the provider |
| `apps/web/src/assets/app*.svg`, `apps/web/public/favicon.svg`, `apps/web/public/og-image.png` | EstateForge | Part of EstateForge (not licensed) |
| `apps/api/src/ai-media/fixtures/simulador-clip.webm` | Short synthetic clip recorded with a Chromium browser's MediaRecorder (VP8 + Opus, according to its metadata) | Test fixture of EstateForge; contains no third-party material |
| Test images and audio in `apps/api/src/test-support/`, demo images in `apps/api/prisma/demo-photos.ts` | Generated in code | Part of EstateForge |

Audio presets are synthesised in the browser at run time; no audio files are included.

The publication record includes five original portal-identification assets served from
`apps/web/public/portales/`: Idealista's `ID.png` from its official press kit, and the official
favicons of Fotocasa, Pisos.com, Yaencontre and Habitaclia. Their source URLs, checksums and unchanged
status are recorded in `apps/web/public/portales/NOTICE.txt`. This notice is also included in the
built `third-party-notices.txt` linked from the application footer.

The user expressly instructed EstateForge to include these assets and not send permission requests.
That instruction is not a grant of rights by the portals. These trademarks and artwork remain the
property of their holders; no open-source license or free redistribution permission is asserted.
They identify the external destinations only, separate from EstateForge's branding, and do not
indicate affiliation, endorsement or automatic publication. EstateForge's proprietary license does
not grant rights to these assets.

The earlier Commons wordmark for Pisos.com is no longer distributed. Its original and declared
CC BY-SA provenance remain in the local historical evidence outside this checkout. The current
square favicon was downloaded from the URL linked by the official Pisos.com website. The source
history was not modified; the files in this working tree were obtained anew.

See [portal identification](docs/producto-checklist-y-estado.md#identificación-de-los-portales).

## 4. Material present only in the history

| Material | Commits | License text |
| --- | --- | --- |
| create-vite React + TypeScript template (starter files, `react.svg`, `vite.svg`, `hero.png`, `icons.svg`) | From the scaffolding commits of August 2026; the image assets were removed in 1.0.0 | MIT, VoidZero Inc. and Vite contributors: [`licenses/create-vite-MIT.txt`](licenses/create-vite-MIT.txt). The React and Vite logos are trademarks of their owners |
| `prisma/skills` agent bundles under `apps/api/.agents`, `.claude` and `.windsurf` | From August 2026 until their removal in 1.0.0 | MIT, Copyright (c) 2025 Prisma: [`licenses/prisma-skills-MIT.txt`](licenses/prisma-skills-MIT.txt). The bundles did not include the license file; it is distributed with the repository from 1.0.0 on |

## 5. Server and build dependencies

The API runtime (Fastify, Prisma, `pg`, `@vercel/blob`, Nodemailer and others) and the build and test
tooling are installed from npm and are not distributed by this repository. The complete list of the
594 direct and transitive packages, with version, license and whether each is a production
dependency, is in [docs/legal/dependency-licenses.json](docs/legal/dependency-licenses.json)
(regenerate with `pnpm licenses list --json`). Summary: MIT 462, Apache-2.0 56, ISC 37,
BSD-3-Clause 21, BSD-2-Clause 4, OFL-1.1 2, BlueOak-1.0.0 2, MPL-2.0 2, Unlicense 2, MIT AND ISC 1,
Python-2.0 1, CC-BY-4.0 1, EPL-2.0 1, MIT-0 1, 0BSD 1.
