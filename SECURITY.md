# Security policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.0.x   | Yes       |
| < 1.0   | No        |

## Reporting a vulnerability

Please report vulnerabilities **privately**, using GitHub's private vulnerability reporting for this
repository: the **Report a vulnerability** button in the **Security** tab. Do not open a public issue,
pull request or discussion that describes the problem.

If that button is not available, the private channel has not been enabled yet: do not disclose the
details publicly, and wait until it appears. No other reporting channel is offered at the moment.

Include the affected version or commit, the steps to reproduce, the impact you observed and, if
possible, a minimal proof of concept. Do not access, modify or delete other users' data, and do not
run tests that degrade a service or generate costs for others (for example, calls to AI providers
with someone else's key).

The maintainer will review the report and coordinate the fix and its disclosure with you. There is no
bug bounty.

Requests that are not about security (for example, permission to use the code) are not handled
through this channel; see [LICENSE](LICENSE).

## Scope notes

- EstateForge does not use a global AI provider key of its own. Each user's provider keys are stored
  encrypted on the server (AES-256-GCM, with the server-side `ESTATEFORGE_API_KEY_ENCRYPTION_KEY`),
  decrypted only on the server to perform an operation the user confirms, and never returned to the
  browser.
- Uploaded files are stored privately and read and written through short-lived signed URLs.
- Secrets are never committed. Configuration templates (`*.env.example`) contain no real values.
