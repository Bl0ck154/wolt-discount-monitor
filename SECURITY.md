# Security policy

## Supported version

Security fixes are applied to the current `main` branch.

## Reporting a vulnerability

Please use GitHub's private **Security → Advisories → Report a vulnerability** flow when it is available for this repository.

Do not post tokens, credentials, private infrastructure details, or a working exploit in a public issue.

For ordinary bugs that do not expose sensitive data or create a security impact, use the normal bug report issue template.

## Public deployment boundary

The dashboard is a public client application. Values intentionally delivered to the browser, such as a configured public API origin, must not be treated as secrets.

Credentials, private hostnames and IP addresses, private filesystem paths, runner/device details, chat IDs, access tokens, and deployment credentials must remain outside the repository and Git history.
