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
  exception before deleting. No other table is affected and no migration is needed. In production it
  has only run once, manually, with no expired entries to delete; the scheduled run is still to be
  observed.
- Evidence of every authorised run of the daily maintenance: a `MaintenanceRun` row (additive
  migration `20261118120000_maintenance_runs`) with the trigger (`vercel-cron` when the user agent is
  exactly `vercel-cron/1.0`, otherwise `manual`), status, counters, remaining queue size and duration,
  plus one structured log line. It stores no personal data, storage keys or secrets, and an
  unauthenticated request writes nothing. Hobby function logs are kept for one hour, so this is what
  lets the scheduled run be proven afterwards. If the row cannot be written, the maintenance response
  does not change. The migration is applied in production and a manual run left its row; a manual run
  from the Vercel CLI sends the same user agent, so only a row inside the 04:00 UTC window proves the
  scheduled run, which has not been observed yet.
- A temporary, owner-only client IP diagnostic (`GET /api/admin/diagnostics/client-ip`) to close
  MD-4. It exists only while `CLIENT_IP_DIAGNOSTIC_UNTIL` holds a future ISO 8601 date at most 72 hours
  ahead, returns only the caller's own addresses and proxy headers, logs nothing and does not change
  the rate limit or Turnstile. Used once in production from a single network and then disabled (the
  route answers 404); MD-4 stays open and `CLIENT_IP_SOURCE` stays `socket`.
- Integration tests with two synthetic accounts that call every route taking an identifier with the
  other account's identifiers, combine own and foreign resources, compare each rejection with that of a
  non-existent identifier, and check that nothing of the first account changes or leaks.

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
- The landing page header shows the large anvil logo instead of the small icon and name, and adds a
  light/dark theme toggle that shares the app's saved preference and otherwise follows the system.

### Fixed

- Deleting a single property from the web no longer sends `Content-Type: application/json` without a
  body. Fastify 5 parses bodies on `DELETE`, so that request was rejected with
  `400 FST_ERR_CTP_EMPTY_JSON_BODY` before reaching the route, and the web showed a generic error.
  A regression test replays both request shapes against a listening Fastify instance (Prisma
  mocked). Deployed and checked in production by deleting a synthetic property from the web.
- A direct upload that was being confirmed when its 15-minute window ended could lose its file: a
  concurrent expiry (another request from the same user, or maintenance) marked it expired and the
  cleanup deleted the object mid-validation, so the user was told the file had not arrived. Attempts
  already being confirmed now get a 10-minute grace period before they expire, and the cleanup never
  deletes the file of an attempt in progress. If the attempt stops being in progress anyway, the
  confirmation answers `410 UPLOAD_EXPIRED` instead of `500`.
- Two storage cleanups running at the same time (the scheduled one and a manual one, or one started by
  a user request) no longer report every row already removed by the other as a failure. The final
  state was already correct; the counters and warnings were not.
- Asking for a listing from another account's property (`POST /api/generations/from-property`)
  answered `500` and was logged as an internal error; it now answers `404`, the same as for a property
  that does not exist. Nothing was leaked or changed. Checked in production with a synthetic property.
- The local Blob simulator ignores a malformed `Range` header such as `bytes=-` (serving the whole
  file with `200`, as RFC 9110 allows) instead of answering `206`. Development and tests only.

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

