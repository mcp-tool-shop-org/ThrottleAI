# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | Yes       |
| < 1.0   | No        |

## Reporting a Vulnerability

Email: **64996768+mcp-tool-shop@users.noreply.github.com**

Include:
- Description of the vulnerability
- Steps to reproduce
- Version affected
- Potential impact

### Response timeline

| Action | Target |
|--------|--------|
| Acknowledge report | 48 hours |
| Assess severity | 7 days |
| Release fix | 30 days |

## Scope

ThrottleAI is a **zero-dependency governance library** for AI call concurrency, rate limiting, and token budgets.

- **Data touched:** In-memory lease state, token counters, rate windows — all ephemeral
- **Data NOT touched:** No telemetry, no analytics, no persistent storage, no network calls, no credential handling
- **Permissions:** Pure in-memory library — no filesystem, no network, no OS-level access
- **No telemetry** is collected or sent
