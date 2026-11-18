# Changelog

All notable changes to EstateForge are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added

- Retention for the security audit log (`AdminAuditLog`), authorised by the owner: entries are kept
  90 days from `createdAt` and then deleted by the existing daily maintenance cron, in bounded batches
  of up to 100 (so deletion can lag behind the 90-day mark). Entries whose actor or affected account
  has an open security incident (`securityHoldAt` or `passwordResetRequiredAt` set) are kept until it
  is resolved; entries with no account reference are always kept. Deleting an account does not delete
  its audit entries immediately: they follow the same 90-day period. Protected entries do not block
  eligible ones, and each batch locks the affected accounts (`lockUserRow`) and re-checks the
  exception before deleting. No other table is affected and no migration is needed. The purge has not
  been run against any real database.

### Changed

- API responses are sent with `Cache-Control: no-store` unless the route already sets a private
  policy (`private` or `no-store`, e.g. gallery files with ETag). Without it, the hosting platform
  adds `public, max-age=0, must-revalidate`. This is hardening; no leak through caches was observed.
  Web asset caching is unchanged.
- The privacy page describes the audit log retention.
- After a successful password reset the web goes straight to the login page (replacing the reset
  link, so the token leaves the URL and the history) and shows an accessible "password reset"
  confirmation. Only a boolean travels in the navigation state; no automatic login. Errors stay on
  the reset form.

### Fixed

- Deleting a single property from the web no longer sends `Content-Type: application/json` without a
  body. Fastify 5 parses bodies on `DELETE`, so that request was rejected with
  `400 FST_ERR_CTP_EMPTY_JSON_BODY` before reaching the route, and the web showed a generic error.
  A regression test replays both request shapes against a listening Fastify instance (Prisma
  mocked). The fix has not yet been deployed or checked in production.

## 1.0.1 - 2026-11-17

Fixes found by the first continuous integration run on GitHub (Ubuntu runner), after 1.0.0.

### Fixed

- The API answers 503 instead of 500 when PostgreSQL is unreachable and `localhost` resolves to both
  `::1` and `127.0.0.1`. Node then tries both addresses and pg reports an `AggregateError` that the
  Prisma adapter does not convert, so Prisma exposes the Node network code; the availability
  classifier now recognises those codes on Prisma errors only, and errors from other services keep
  their status.
- Every database session uses UTC. `@prisma/adapter-pg` 7.9.1 replaces the offset of `timestamptz`
  values with `+00:00`, so with a server or database whose default time zone was not UTC the API read
  shifted instants, including expiry times. The pool now sets the session time zone when it connects.

### Changed

- Integration tests no longer depend on the database collation (seed photos are compared by property,
  not by sorted title) or on connections outside the pool under test (the pool test identifies its
  connections by `application_name` and waits, with a limit, until the server has removed them).

## 1.0.0 - 2026-11-17

First public version. It covers the work from August to November 2026.

### Added

- Property records with type, operation, features, condition and commercial status; search,
  sorting, filtering, pagination and bulk deletion.
- Listing drafts in Spanish or English with four tones, generated with a local template (no AI) or
  with an AI provider, editable before use, with a history per property.
- Photo gallery per property (up to 50 photos, ordering and cover) with content checks and private
  storage.
- Classic poster templates and a slideshow video with preset or uploaded soundtracks, composed in
  the browser; a random template option that needs no AI.
- Publication record for Idealista, Fotocasa, Pisos.com, Yaencontre, Habitaclia and other portals,
  with link validation. EstateForge does not publish on the portals. Portals are identified by name
  with a generic icon; their logos are not distributed.
- Bring-your-own-key AI: encrypted per-user connections to 15 text, image and video providers, a
  model catalogue with prices and sources, cost estimates and explicit confirmation before every
  billable call, moderation, human review, idempotency, limits and guided trial plans; a local
  simulator covers every flow without network access.
- Accounts with email verification, password recovery, email change, sessions, bot protection
  (Cloudflare Turnstile, optional) and account deletion.
- Administration panel for the OWNER role: users, suspensions, security holds, mandatory recovery
  after an incident and an audit log.
- Direct, signed uploads and downloads with private Vercel Blob storage, and a local simulator for
  development.
- Static public landing page, privacy and terms pages, robots.txt, sitemap and canonical metadata
  driven by the production origin.
- CI workflow with lint, type checks, tests (including PostgreSQL integration tests), builds,
  dependency audit and commit message checks.
- `third-party-notices.txt` in the web build with the license, copyright and NOTICE texts of every
  npm package whose code, styles or fonts are served; the build fails if one is missing.

### Changed

- Persistence moved from SQLite to PostgreSQL 17 with Prisma 7 and `@prisma/adapter-pg`.
- The authenticated dashboard moved from `/` to `/panel`; `/` is now the public landing page.
- Authenticated pages are loaded on demand, reducing the initial bundle from about 858 kB to 350 kB.

### Security

- Strict CORS, rate limits, security headers and a Content Security Policy for the web app,
  `X-Robots-Tag: noindex` on the API and private routes.
- Client IP resolution that ignores spoofable forwarding headers unless the Vercel source is
  explicitly enabled.
- Fastify updated to 5.12.8 (header and URL validation fixes), the shared package moved to Zod 4,
  and patched versions of vulnerable transitive dependencies are enforced with pnpm overrides
  within their major versions.

### Notes

- This version is ready for code publication. Deployment to Vercel, Neon and Vercel Blob and the
  calls to real AI providers have only been validated locally with simulators; see
  [docs/release/v1.0.0.md](docs/release/v1.0.0.md).

