# ThrottleAI

**Token-based lease governor for AI service calls.**

ThrottleAI is a zero-dependency governor for concurrency, rate, and token budgets. It sits between your application code and AI model calls, preventing stampedes, enforcing fairness, and keeping costs under control.

## Key capabilities

- **Concurrency control** -- cap in-flight calls with weighted slots and interactive reserve
- **Rate limiting** -- requests/min and tokens/min with rolling windows
- **Fairness** -- prevent any single actor from monopolizing capacity
- **Lease management** -- acquire before, release after, auto-expire on timeout
- **Observability** -- `snapshot()`, `onEvent`, and `formatEvent()` for debugging
- **Adapters** -- tree-shakeable wrappers for fetch, OpenAI, tools, Express, and Hono

## Quick install

```bash
pnpm add throttleai
```

## Requirements

- Node.js 18+
- Zero runtime dependencies

## Documentation

| Document | Description |
|----------|-------------|
| [Tuning cheatsheet](tuning-cheatsheet.md) | Scenario-based config guide, decision tree, knob reference |
| [Troubleshooting](troubleshooting.md) | Common issues: always denied, stalls, adaptive oscillation |
| [API stability](api-stability.md) | What is public API vs internal |
| [Release manifest](release-manifest.md) | Release process and artifact details |
| [Repo hygiene](repo-hygiene.md) | Asset policy and history rewrite log |

## Links

- [npm package](https://www.npmjs.com/package/throttleai)
- [GitHub repository](https://github.com/mcp-tool-shop-org/ThrottleAI)
- [Examples](https://github.com/mcp-tool-shop-org/ThrottleAI/tree/main/examples)

## License

MIT
