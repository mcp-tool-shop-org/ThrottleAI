import type { SiteConfig } from '@mcptoolshop/site-theme';

export const config: SiteConfig = {
  title: 'ThrottleAI',
  description: 'A token-based lease governor for AI calls — small enough to embed anywhere, strict enough to prevent stampedes.',
  logoBadge: 'TA',
  brandName: 'ThrottleAI',
  repoUrl: 'https://github.com/mcp-tool-shop-org/ThrottleAI',
  npmUrl: 'https://www.npmjs.com/package/throttleai',
  footerText: 'MIT Licensed — built by <a href="https://github.com/mcp-tool-shop-org" style="color:var(--color-muted);text-decoration:underline">mcp-tool-shop-org</a>',

  hero: {
    badge: 'npm · throttleai',
    headline: 'Stop AI stampedes',
    headlineAccent: 'before they start.',
    description: 'Token-based lease governor for AI calls — small enough to embed anywhere, strict enough to enforce real limits on concurrency, tokens, and spend.',
    primaryCta: { href: '#usage', label: 'Get started' },
    secondaryCta: { href: 'handbook/', label: 'Read the Handbook' },
    previews: [
      { label: 'Install', code: 'npm install throttleai' },
      { label: 'Govern', code: `import { ThrottleAI } from 'throttleai';\n\nconst gov = new ThrottleAI({ rpm: 60, tpm: 100_000 });\nawait gov.acquire(estimatedTokens);` },
      { label: 'Wrap', code: `import { withThrottle } from 'throttleai/adapters/openai';\n\nconst openai = withThrottle(new OpenAI(), gov);` },
    ],
  },

  sections: [
    {
      kind: 'features',
      id: 'features',
      title: 'Features',
      subtitle: 'Governance that actually holds.',
      features: [
        {
          title: 'Lease-Based Flow',
          desc: 'Callers acquire a lease before any call is made. No lease, no call. Stampedes are structurally impossible, not just unlikely.',
        },
        {
          title: 'Token + Rate Aware',
          desc: 'Tracks RPM, TPM, and concurrent request counts independently. Enforce all three, any two, or just one — your choice.',
        },
        {
          title: 'Zero Dependencies',
          desc: 'Pure TypeScript, ships as ESM + CJS, runs in Node 18+ or any fetch-capable runtime. Nothing to install but the package itself.',
        },
      ],
    },
    {
      kind: 'data-table',
      id: 'adapters',
      title: 'Adapters',
      subtitle: 'Drop-in wrappers for the tools you already use.',
      columns: ['Adapter', 'Import', 'What it wraps'],
      rows: [
        ['fetch', 'throttleai/adapters/fetch', 'Global fetch — any HTTP call'],
        ['openai', 'throttleai/adapters/openai', 'OpenAI SDK client instance'],
        ['tools', 'throttleai/adapters/tools', 'MCP / tool-call dispatch functions'],
        ['express', 'throttleai/adapters/express', 'Express middleware — per-route or global'],
        ['hono', 'throttleai/adapters/hono', 'Hono middleware — edge-compatible'],
      ],
    },
    {
      kind: 'code-cards',
      id: 'usage',
      title: 'Usage',
      cards: [
        {
          title: 'Core governor',
          code: `import { ThrottleAI } from 'throttleai';

const gov = new ThrottleAI({
  rpm: 60,        // max requests per minute
  tpm: 100_000,   // max tokens per minute
  concurrency: 5, // max in-flight at once
});

// Acquire before every call
const lease = await gov.acquire(estimatedTokens);
const result = await myAICall();
lease.release(actualTokensUsed);`,
        },
        {
          title: 'OpenAI adapter',
          code: `import { withThrottle } from 'throttleai/adapters/openai';

const client = withThrottle(new OpenAI(), gov);

// Use exactly like the normal OpenAI client
const res = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Hello' }],
});`,
        },
      ],
    },
  ],
};
