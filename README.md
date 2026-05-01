# react-native-llm-meter

[![npm](https://img.shields.io/npm/v/react-native-llm-meter.svg)](https://www.npmjs.com/package/react-native-llm-meter)
[![CI](https://github.com/ankitvirdi4/react-native-llm-meter/actions/workflows/ci.yml/badge.svg)](https://github.com/ankitvirdi4/react-native-llm-meter/actions/workflows/ci.yml)
[![License](https://img.shields.io/npm/l/react-native-llm-meter.svg)](./LICENSE)
[![Bundle size](https://img.shields.io/bundlephobia/minzip/react-native-llm-meter)](https://bundlephobia.com/package/react-native-llm-meter)
[![Types](https://img.shields.io/npm/types/react-native-llm-meter.svg)](https://www.npmjs.com/package/react-native-llm-meter)

LLM observability built for React Native and Expo. Track token usage, cost, and
latency for Claude, GPT, and Gemini calls on device, with optional remote sync.

## Why

Server side LLM observability is a solved problem (Langfuse, Helicone, Stripe).
Mobile isn't. Try integrating any of those into an Expo app and you'll hit
Node only dependencies, missing AsyncStorage adapters, and broken streaming.

`react-native-llm-meter` is built RN first:
- Pure TypeScript, no Node only APIs
- AsyncStorage and SQLite adapters
- Multi provider: Anthropic, OpenAI, Google
- Optional dev overlay
- Budget alerts, on device aggregation, optional remote sink
- Zero prompt content captured. Token counts and metadata only.

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

```tsx
import { Meter, MeterProvider } from "react-native-llm-meter";
import Anthropic from "@anthropic-ai/sdk";

// In Expo, expose your key via EXPO_PUBLIC_ANTHROPIC_API_KEY in .env.
// In bare RN, load from your secure config layer of choice.
const anthropic = new Anthropic({ apiKey: process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY });
const meter = new Meter();
const client = meter.wrap(anthropic);

export default function App() {
  return (
    <MeterProvider meter={meter}>
      <YourApp client={client} />
    </MeterProvider>
  );
}
```

Every call through `client.messages.create(...)` records an event with provider,
model, tokens, latency, and cost.

## Providers

`meter.wrap(client)` detects the provider by client shape. Today it supports:

| Provider  | Detection                              | Notes                                        |
|-----------|----------------------------------------|----------------------------------------------|
| Anthropic | `client.messages.create`               | Streaming and non streaming                  |
| OpenAI    | `client.chat.completions.create`       | For streaming, set `stream_options.include_usage = true` |
| Google    | `client.models.generateContent`        | Modern `@google/genai` shape, also `generateContentStream` |

```ts
// Anthropic
import Anthropic from "@anthropic-ai/sdk";
const claude = meter.wrap(new Anthropic({ apiKey }));

// OpenAI
import OpenAI from "openai";
const gpt = meter.wrap(new OpenAI({ apiKey }));

// Google
import { GoogleGenAI } from "@google/genai";
const gemini = meter.wrap(new GoogleGenAI({ apiKey }));
```

The wrapped client has the same interface as the original. You only change the
construction.

### Streaming TTFT

Streaming events also record `ttftMs`, the time from the request start to the
first content chunk that arrives back. It captures perceived responsiveness
separately from total stream duration.

```ts
const events = await meter.getEvents();
const streaming = events.filter((e) => e.ttftMs !== undefined);
console.log("p50 TTFT", summarize(streaming).ttftP50);
console.log("p50 total latency", summarize(events).latencyP50);
```

What counts as the "first content chunk" per provider:

| Provider  | Detection                                                        |
|-----------|------------------------------------------------------------------|
| Anthropic | First `content_block_delta` chunk (skips `message_start`)        |
| OpenAI    | First chunk where `choices[0].delta.content` is a non empty string |
| Google    | First chunk where `candidates[0].content.parts[0].text` is non empty |

`latencyMs` stays as total wall clock (request start to end of stream), so the
two fields are complementary, not interchangeable. Non streaming events have
`ttftMs` undefined since round trip latency equals first byte latency.

`Summary` from `summarize` exposes `ttftP50`, `ttftP95`, `ttftMean`, and
`ttftCount`. The first three are computed only from events with `ttftMs` set;
when no streaming events are in the slice, all three return 0.

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

Indexed on timestamp, model, and provider. Queries 10k events in under 50ms.
Use this once you outgrow AsyncStorage.

### Migration

```ts
const sqlite = new SqliteAdapter({ db });
const asyncs = new AsyncStorageAdapter({ asyncStorage: AsyncStorage });
await sqlite.migrateFrom(asyncs, { clearSource: true });
```

## React hooks

Wrap your tree in `<MeterProvider meter={...}>`, then use hooks anywhere.

```tsx
import { useMetrics, useBudget } from "react-native-llm-meter";

function CostHud() {
  const { summary, byGroup } = useMetrics({ groupBy: "model" });
  const budget = useBudget(5);

  if (!summary) return null;

  return (
    <View>
      <Text>Today's spend: ${budget.spend.toFixed(4)}</Text>
      <Text>{summary.count} calls, {summary.totalTokens} tokens</Text>
      {budget.overBudget ? <Text>Over budget!</Text> : null}
    </View>
  );
}
```

`useMetrics({ from?, to?, groupBy? })` returns `{ summary, byGroup, loading, refresh }`.
Auto refreshes when the meter records.

`useBudget(thresholdUsd)` returns today's UTC spend, threshold, remaining, and
an `overBudget` flag.

## Dev overlay

A floating, draggable, opt in component that shows live spend, recent calls,
and a per model breakdown. Imported from a subpath so non RN consumers do not
pull `react-native` into their bundle.

```tsx
import { MeterOverlay } from "react-native-llm-meter/overlay";

<MeterProvider meter={meter}>
  <YourApp />
  <MeterOverlay />
</MeterProvider>
```

`enabled` defaults to `__DEV__`. Tap the header to expand. Tap a recent call to
see full details. Drag to reposition.

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
    Alert.alert(`Daily limit hit`, `${period}: $${spend.toFixed(2)} / $${threshold}`);
  },
});
```

Each period (day, week, month) fires at most once per UTC period boundary. The
optional `state` store remembers the last fired timestamp so a reload does not
refire the same period.

## Remote sink

Push events to your own endpoint. Batched, retried with exponential backoff,
errors never propagate into your app code.

```ts
import { HttpRemoteSink } from "react-native-llm-meter";

meter.attachRemoteSink({
  sink: new HttpRemoteSink({
    url: "https://your-backend.example/llm-events",
    headers: { Authorization: `Bearer ${token}` },
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

The library treats any HTTP 2xx as success and moves on. If your endpoint
returns 200 but fails to persist, those events are dropped on the client.
To recover, deduplicate on the server using `event.requestId` (a UUID) as the
idempotency key. Every event has a stable `requestId`, generated via
`crypto.randomUUID()` when available with a Math-based fallback for older
runtimes. Acknowledged retries land on the same id, so the server can ignore
duplicates safely. Server-issued ack tokens are on the v0.3 roadmap.

## Pricing accuracy

Provider prices are hardcoded in [`src/pricing/table.ts`](src/pricing/table.ts),
verified against published rates as of 2026-05-01. Prices change. If you spot a
stale rate, open a PR using the
[pricing update template](.github/PULL_REQUEST_TEMPLATE/pricing-update.md) and
we'll merge it.

## Privacy

The library captures token counts, latency, model name, provider, and computed
cost. **Prompt content and model output are never captured.** Storage is on
device by default. The remote sink is opt in and only ships the same metadata.

## Troubleshooting

**OpenAI streaming records zero tokens.**
OpenAI only includes `usage` in the streaming response when you opt in. Pass
`stream_options: { include_usage: true }` to your `chat.completions.create`
call.

**Cost is 0 for my model.**
The model name your provider returned is not in the pricing table. The library
warns once per unknown (provider, model) pair via `console.warn` so you spot the
gap early. Either pin to a model in the table, pass `costUsd` directly to
`meter.record`, or open a PR adding the new entry to `src/pricing/table.ts`.

To route warnings somewhere else (Sentry, your logger), pass `onUnknownModel`:

```ts
const meter = new Meter({
  onUnknownModel: (provider, model) => {
    Sentry.captureMessage(`Unpriced model ${provider}/${model}`);
  },
});
```

Pass `() => {}` to silence.

**`Unsupported client` error from `meter.wrap`.**
Your client does not match any detection shape. The library currently supports
the Anthropic SDK, the OpenAI SDK, and the modern `@google/genai` SDK. Legacy
`@google/generative-ai` is not yet supported.

**Hooks throw `useMeter must be called inside a MeterProvider`.**
You forgot to wrap your tree. Place `<MeterProvider meter={meter}>` near the
root of your app.

**`react-native` import error from a Node script.**
Import the main entry, not the overlay subpath. The overlay path imports React
Native components which are not available in Node.

## Status

v0.1.1 is on npm. The library is built in public, with releases tagged on
GitHub and a tested 99% coverage suite. See [CHANGELOG.md](./CHANGELOG.md) for
release notes and [CONTRIBUTING.md](./CONTRIBUTING.md) to help shape what
ships next.

Built by [Ankit Virdi](https://github.com/ankitvirdi4).

## Security

Found a vulnerability? See [SECURITY.md](./SECURITY.md) for the disclosure
path. Please do not file public issues for security reports.

## Contributing

PRs and issues welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup,
test, and PR conventions, and the
[pricing update template](.github/PULL_REQUEST_TEMPLATE/pricing-update.md) for
rate updates.

## License

MIT
