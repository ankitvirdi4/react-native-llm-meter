# react-native-llm-meter

[![npm](https://img.shields.io/npm/v/react-native-llm-meter.svg)](https://www.npmjs.com/package/react-native-llm-meter)
[![CI](https://github.com/ankitvirdi4/react-native-llm-meter/actions/workflows/ci.yml/badge.svg)](https://github.com/ankitvirdi4/react-native-llm-meter/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/badge/coverage-99%25-brightgreen.svg)](#tests)
[![License](https://img.shields.io/npm/l/react-native-llm-meter.svg)](./LICENSE)
[![Bundle size](https://img.shields.io/bundlephobia/minzip/react-native-llm-meter)](https://bundlephobia.com/package/react-native-llm-meter)
[![Types](https://img.shields.io/npm/types/react-native-llm-meter.svg)](https://www.npmjs.com/package/react-native-llm-meter)

LLM observability built for React Native and Expo. Track token usage, cost, and
latency for Claude, GPT, and Gemini calls on device, with optional remote sync.

✅ Streaming TTFT &nbsp;•&nbsp; ✅ On device storage &nbsp;•&nbsp; ✅ Multi provider &nbsp;•&nbsp; ✅ Zero prompt content captured

## Install

```bash
npm install react-native-llm-meter
```

Optional peer deps depending on what you use:

```bash
# AsyncStorage adapter
npm install @react-native-async-storage/async-storage

# SQLite adapter (Expo Dev Client)
npx expo install expo-sqlite
```

## Quick start

Before:

```ts
import Anthropic from "@anthropic-ai/sdk";

const claude = new Anthropic({ apiKey: process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY });

const response = await claude.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hi" }],
});
```

After:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { Meter } from "react-native-llm-meter";

const meter = new Meter();
const claude = meter.wrap(new Anthropic({ apiKey: process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY }));

// same call, same response
const response = await claude.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hi" }],
});

// new: you now know everything about that call
console.log(await meter.summary({ groupBy: "model" }));
```

## What you get

After a few calls, `meter.summary({ groupBy: "model" })` returns aggregated metrics:

```js
{
  count: 47,
  inputTokens: 24_103,
  outputTokens: 7_379,
  totalTokens: 31_482,
  costUsd: 0.0894,
  latencyP50: 612,
  latencyP95: 1840,
  latencyMean: 738,
  ttftP50: 287,        // streaming time to first token
  ttftP95: 612,
  ttftMean: 312,
  ttftCount: 38,       // events that streamed
  byModel: {
    "claude-sonnet-4-6": { count: 38, costUsd: 0.0721, ttftP50: 264, /* ... */ },
    "gpt-4o-mini":        { count: 9,  costUsd: 0.0173, ttftP50: 410, /* ... */ },
  },
}
```

Same shape via the [`useMetrics` hook](#react-hooks) for live UI updates, or
query historical events with `meter.getEvents({ from, to })`.

## How it works

```
 ┌────────────────────────────────────────────────────────────────┐
 │  Your Expo / React Native app                                  │
 │                                                                │
 │  ┌──────────────┐    ┌─────────┐    ┌──────────────┐           │
 │  │  LLM SDK     │───▶│  Meter  │───▶│   Storage    │           │
 │  │  (wrapped)   │    │ .wrap() │    │ memory/AS/SQL│           │
 │  └──────────────┘    └─────────┘    └──────────────┘           │
 │         │                  │                │                  │
 │         │                  ▼                ▼                  │
 │         │           ┌─────────────┐   ┌──────────────┐         │
 │         ▼           │ useMetrics()│   │ Remote sink  │         │
 │   Provider API      │ MeterOverlay│   │  (optional)  │         │
 │   (Anthropic,       └─────────────┘   └──────────────┘         │
 │    OpenAI, Google)                                             │
 └────────────────────────────────────────────────────────────────┘
```

Token counts and metadata flow through the meter. Prompt content does not.

## Why

Server side LLM observability is a solved problem (Langfuse, Helicone,
PostHog). Mobile isn't. Try integrating any of those into an Expo app and
you'll hit Node only dependencies, missing AsyncStorage adapters, and broken
streaming.

`react-native-llm-meter` is built RN first:
- Pure TypeScript, no Node only APIs
- AsyncStorage and SQLite adapters
- Multi provider: Anthropic, OpenAI, Google
- Optional dev overlay
- Budget alerts, on device aggregation, optional remote sink
- Zero prompt content captured. Token counts and metadata only.

### vs server side observability

| Need                                    | react-native-llm-meter | Server side tools (Langfuse, Helicone, PostHog) |
|-----------------------------------------|:----------------------:|:-----------------------------------------------:|
| Works in Expo Go / Dev Client           | yes                    | partial (network only, no on device storage)    |
| Track usage offline                     | yes                    | no                                              |
| On device cost rollups                  | yes                    | no, requires server roundtrip                   |
| Streaming TTFT capture                  | yes                    | varies                                          |
| Backend infra required                  | optional               | yes                                             |
| Prompt content kept on device           | always                 | sent to their servers by default                |
| Bundle size                             | ~24 KB ESM             | ~50-200 KB plus a server                        |
| Free / self host                        | MIT, no server         | varies                                          |

These tools are excellent for backend usage. They are not the right fit when
your LLM calls happen from a phone.

## Providers

`meter.wrap(client)` detects the provider by client shape:

| Provider         | Detection                                | Notes                                                |
|------------------|------------------------------------------|------------------------------------------------------|
| Anthropic        | `client.messages.create`                 | Streaming and non streaming, prompt cache aware      |
| OpenAI           | `client.chat.completions.create`         | Streaming auto enables `stream_options.include_usage`|
| Google           | `client.models.generateContent`          | Modern `@google/genai` shape, plus stream variant    |
| Google legacy    | `client.getGenerativeModel`              | Legacy `@google/generative-ai` SDK                   |

```ts
// Anthropic
import Anthropic from "@anthropic-ai/sdk";
const claude = meter.wrap(new Anthropic({ apiKey }));

// OpenAI
import OpenAI from "openai";
const gpt = meter.wrap(new OpenAI({ apiKey }));

// Google (modern)
import { GoogleGenAI } from "@google/genai";
const gemini = meter.wrap(new GoogleGenAI({ apiKey }));

// Google (legacy)
import { GoogleGenerativeAI } from "@google/generative-ai";
const geminiLegacy = meter.wrap(new GoogleGenerativeAI(apiKey));
```

The wrapped client has the same interface as the original.

### Streaming TTFT

Streaming events also record `ttftMs`, the time from the request start to the
first content chunk that arrives back. Captures perceived responsiveness
separately from total stream duration.

| Provider  | Detection                                                        |
|-----------|------------------------------------------------------------------|
| Anthropic | First `content_block_delta` chunk (skips `message_start`)        |
| OpenAI    | First chunk where `choices[0].delta.content` is non empty        |
| Google    | First chunk where `candidates[0].content.parts[0].text` is non empty |

`latencyMs` stays as total wall clock. Non streaming events have `ttftMs`
undefined.

### Anthropic prompt cache

`MeterEvent.cacheReadInputTokens` and `cacheCreationInputTokens` are
captured automatically when Anthropic returns them. `computeCost` applies
0.1x input rate for reads and 1.25x for writes by default.

## Storage adapters

By default events live in memory and are lost on reload. Pass a `Storage`
adapter to persist them.

### AsyncStorage

```ts
import { Meter, AsyncStorageAdapter } from "react-native-llm-meter";
import AsyncStorage from "@react-native-async-storage/async-storage";

const meter = new Meter({
  storage: new AsyncStorageAdapter({
    asyncStorage: AsyncStorage,
    retentionDays: 30,
  }),
});
```

Day bucketed keys, automatic eviction past retention, queued writes for safety
under concurrent appends.

### SQLite (Expo Dev Client)

```ts
import { Meter, SqliteAdapter } from "react-native-llm-meter";
import * as SQLite from "expo-sqlite";

const db = await SQLite.openDatabaseAsync("llm-meter.db");
const meter = new Meter({ storage: new SqliteAdapter({ db }) });
```

Indexed on timestamp, model, provider. Queries 10k events under 50ms on a real
device.

### Migration

```ts
const sqlite = new SqliteAdapter({ db });
const asyncs = new AsyncStorageAdapter({ asyncStorage: AsyncStorage });
await sqlite.migrateFrom(asyncs, { clearSource: true });
```

## React hooks

Hooks live on the `react-native-llm-meter/react` subpath so non React consumers
do not pull `react` into their type graph.

```tsx
import { MeterProvider, useMetrics, useBudget } from "react-native-llm-meter/react";

export default function App() {
  return (
    <MeterProvider meter={meter}>
      <YourApp />
    </MeterProvider>
  );
}

function CostHud() {
  const { summary, byGroup } = useMetrics({ groupBy: "model" });
  const budget = useBudget(5, { period: "day", timezone: "local" });

  if (!summary) return null;
  return (
    <View>
      <Text>Today: ${budget.spend.toFixed(4)}</Text>
      <Text>{summary.count} calls, {summary.totalTokens} tokens</Text>
      {budget.overBudget ? <Text>Over budget</Text> : null}
    </View>
  );
}
```

`useMetrics({ from?, to?, groupBy? })` returns `{ summary, byGroup, loading, refresh }`.
Auto refreshes when the meter records.

`useBudget(threshold, options?)` returns `{ spend, threshold, remaining,
overBudget, periodStart }`.
Options: `period: 'day' | 'week' | 'month'` (default `day`),
`timezone: 'local' | 'utc'` (default `local`).

## Tagging

Attach arbitrary tags for grouping and filtering.

```ts
meter.record({
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  inputTokens: 100,
  outputTokens: 50,
  latencyMs: 200,
  tags: { userId: "u_42", feature: "chat", channel: "beta" },
});

const s = await meter.summary({ groupBy: { tag: "userId" } });
console.log(s.byTag?.userId.u_42.costUsd);
```

Events without the queried tag are skipped from the group result. SQLite
stores tags as JSON; AsyncStorage and Memory adapters preserve them as is.

## Dev overlay

A floating, draggable, opt in component that shows live spend, recent calls,
and a per model breakdown.

```tsx
import { MeterOverlay } from "react-native-llm-meter/overlay";

<MeterProvider meter={meter}>
  <YourApp />
  <MeterOverlay />
</MeterProvider>
```

`enabled` defaults to `__DEV__`. Tap the header to expand. Tap a recent call
to see full details. Drag to reposition.

## Budget alerts

Fire a callback once per period when a threshold is crossed. Persists across
reload via a `BudgetStateStore`.

```ts
import { AsyncStorageBudgetState } from "react-native-llm-meter";
import AsyncStorage from "@react-native-async-storage/async-storage";

meter.setBudget({
  daily: 5,
  weekly: 25,
  monthly: 80,
  state: new AsyncStorageBudgetState({ asyncStorage: AsyncStorage }),
  onCross: ({ period, threshold, spend }) => {
    Alert.alert("Budget alert", `${period}: $${spend.toFixed(2)} / $${threshold}`);
  },
});
```

## Remote sink

Push events to your own endpoint. Batched, retried with exponential backoff,
errors never propagate into your app code.

```ts
import { HttpRemoteSink } from "react-native-llm-meter";

meter.attachRemoteSink({
  sink: new HttpRemoteSink({
    url: "https://your-backend.example/llm-events",
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs: 10_000,
  }),
  batchSize: 25,
  batchIntervalMs: 5000,
  maxRetries: 3,
  onError: (err, dropped) => console.warn("dropped batch", dropped.length, err),
});
```

`RemoteSink` is just `{ send(events): Promise<void> }`. Implement your own to
write to Sentry, Datadog, a custom backend, anywhere.

### Server side deduplication

Treats any HTTP 2xx as success. If your endpoint returns 200 but fails to
persist, those events are dropped on the client. Deduplicate on the server
using `event.requestId` (a UUID v4 when available) as the idempotency key.
Server issued ack tokens are on the v0.3 roadmap.

## Pricing accuracy

Provider prices are hardcoded in [`src/pricing/table.ts`](src/pricing/table.ts),
50+ entries across providers, best effort verified as of 2026-05-01. The
library warns once per unknown `(provider, model)` pair via `console.warn` so
you spot the gap early. Pass `onUnknownModel` to route warnings to Sentry or
silence them.

```ts
const meter = new Meter({
  onUnknownModel: (provider, model) => {
    Sentry.captureMessage(`Unpriced model ${provider}/${model}`);
  },
});
```

If you spot a stale rate, open a PR using the
[pricing update template](.github/PULL_REQUEST_TEMPLATE/pricing-update.md).

## Privacy

The library captures token counts, latency, model name, provider, and
computed cost. **Prompt content and model output are never captured.**
Storage is on device by default. The remote sink is opt in and only ships the
same metadata.

## Roadmap

- **v0.3** — Server issued ack tokens for the remote sink. Bare React Native
  workflow support. Web support via IndexedDB.
- **v0.4** — Local LLM tracking (Llama, etc.). Removal of v0.2.0 deprecation
  shims.
- **v1.0** — API frozen, supported through 2027.

Track open work and milestones at
[github.com/ankitvirdi4/react-native-llm-meter/issues](https://github.com/ankitvirdi4/react-native-llm-meter/issues).

## FAQ

**Does this work in Expo Go?**
The core library and AsyncStorage adapter work in Expo Go. The SQLite adapter
needs an Expo Dev Client because `expo-sqlite` is a native module.

**What about the bare React Native workflow?**
Most things should work since the library is dependency injected, but Expo
Dev Client is the supported and tested target for v0.1.x and v0.2.x. Bare
support is a v0.3 goal.

**Why not use Langfuse or Helicone?**
They're great backend-side. They're not built for mobile. They assume a
server, send prompt content over the wire by default, and don't help you
display live cost in your app's UI. If your LLM calls happen from a phone,
this library is the right shape.

**How accurate is the cost?**
As accurate as the pricing table. The library ships ~50 model entries verified
against published rates. Unknown models log a warning and report 0 cost.
Anthropic prompt cache pricing is captured automatically. PRs welcome for
new models or rate corrections.

**What happens to my prompts and completions?**
Nothing. The library never sees them. Wrappers extract token counts from the
provider's `usage` field after the call returns; the request and response
bodies are passed through to your code untouched.

**What's the bundle impact?**
About 24 KB ESM for the main entry, 6.5 KB for the optional overlay. Hooks
are on a subpath so non React consumers don't pull `react` into their bundle.

**Can I use a different storage backend?**
Implement the `Storage` interface (`append`, `query`, `clear`) and pass it to
`new Meter({ storage })`. The shipped adapters (Memory, AsyncStorage, SQLite)
are reference implementations.

**Is this production ready?**
v0.2.x is the current line, tested at 99%+ line coverage with realistic
streaming, migration, and concurrency tests, and verified end to end via an
isolated `npm pack` plus install plus runtime smoke test. The API will freeze
at v1.0; anything before that may have small breaking changes documented in
CHANGELOG.

## Troubleshooting

**OpenAI streaming records zero tokens.**
Should not happen in v0.1.4+. The wrapper now auto enables
`stream_options.include_usage` and warns once. Pass the option explicitly to
silence and keep your choice.

**Cost is 0 for my model.**
The model name your provider returned is not in the pricing table. The
library warns once per unknown `(provider, model)` pair. Either pin to a
model in the table, pass `costUsd` directly to `meter.record`, route the
warning to Sentry via `onUnknownModel`, or open a PR adding the new entry.

**`Unsupported client` error from `meter.wrap`.**
Your client does not match any detection shape. Currently supported:
Anthropic SDK, OpenAI SDK, modern `@google/genai`, legacy
`@google/generative-ai`.

**Hooks throw `useMeter must be called inside a MeterProvider`.**
You forgot to wrap your tree. Place `<MeterProvider meter={meter}>` near the
root of your app.

**`react-native` import error from a Node script.**
Import from the main entry (`react-native-llm-meter`), not the overlay
subpath. The overlay imports React Native components which are not available
in Node.

**`latencyMs` looks higher than the API actually took.**
`latencyMs` reflects total wall clock from `client.method()` invocation to its
resolution. If the provider SDK retried internally on 429s or transient
errors, all retry attempts are folded into this number. Provider SDKs do not
expose retry counts via stable hooks, so the wrap layer cannot subtract them
out. If you can capture retry count yourself (custom fetch middleware, SDK
internals), pass it via `retryCount` to `meter.record` and we'll preserve it
on the event for your own analysis.

## About

Built by [Ankit Virdi](https://github.com/ankitvirdi4).

I built this because I was tracking LLM costs in production Expo apps with
`console.log` and grep. Server side observability tools are great for backend
calls; nothing fit when the calls were happening on a phone. So I wrote what
I wished existed.

If you're using this in production, I'd love to hear about it. Open a
[discussion](https://github.com/ankitvirdi4/react-native-llm-meter/discussions),
file an issue, or reach out on GitHub.

## Contributing

PRs and issues welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup,
test, and PR conventions, and the
[pricing update template](.github/PULL_REQUEST_TEMPLATE/pricing-update.md) for
rate updates.

## Security

See [SECURITY.md](./SECURITY.md) for the responsible disclosure path. Please
do not file public issues for security reports.

## License

MIT
