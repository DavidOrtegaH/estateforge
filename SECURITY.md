# Security policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.0.x   | Yes       |
| < 1.0   | No        |

## Reporting a vulnerability

Please report vulnerabilities **privately**. Do not open a public issue, pull request or
discussion that describes the problem.

- Preferred channel: GitHub private vulnerability reporting for this repository (the "Report a
  vulnerability" button under the **Security** tab), once the maintainer has enabled it.
- Alternative private contact: **pending**. It will be published here before the service is
  opened to the public.

Include the affected version or commit, the steps to reproduce, the impact you observed and, if
possible, a minimal proof of concept. Do not access, modify or delete other users' data, and do
not run tests that degrade the service or generate costs for other users (for example, calls to
AI providers with someone else's key).

The maintainer will acknowledge the report, investigate it and coordinate a fix and its
disclosure with you. There is no bug bounty.

## Scope notes

- Users connect their own AI provider keys. Keys are encrypted at rest with
  `ESTATEFORGE_API_KEY_ENCRYPTION_KEY`, are only decrypted on the server and are never returned to
  the browser.
- Uploaded files are stored privately and served through short-lived signed URLs.
- Secrets are never committed. Configuration templates (`*.env.example`) contain no real values.
