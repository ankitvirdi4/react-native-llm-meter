# Expo Dev Client example

A minimal Expo Dev Client app exercising `react-native-llm-meter`. The demo:

- Persists events with `AsyncStorageAdapter`
- Sets a daily budget with an alert callback
- Records sample calls for all three providers when you tap the button
- Renders today's spend, summary, and per provider breakdown via `useMetrics` and `useBudget`
- Shows the floating `<MeterOverlay />` overlay in dev

## Run

```bash
cd examples/expo-dev-client
npm install
npx expo run:ios       # or run:android
```

`react-native-llm-meter` is resolved via `file:../..`, so the example always
runs against the local source. To run against the published package instead,
swap the dependency to a version range:

```jsonc
// package.json
{
  "dependencies": {
    "react-native-llm-meter": "^0.2.0"
  }
}
```

## Wrap a real provider

The example simulates calls via `meter.record(...)` so it runs without API
keys. To wrap a real client, drop the snippet at the top of `App.tsx`:

```tsx
import Anthropic from "@anthropic-ai/sdk";

const claude = meter.wrap(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }));

const response = await claude.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hi" }],
});
```

The wrapped client has the same shape as the original. The meter records
provider, model, tokens, latency, and cost on every call.

## SQLite instead of AsyncStorage

```tsx
import * as SQLite from "expo-sqlite";
import { SqliteAdapter } from "react-native-llm-meter";

const db = await SQLite.openDatabaseAsync("llm-meter.db");
const meter = new Meter({ storage: new SqliteAdapter({ db }) });
```

Use SQLite once you outgrow AsyncStorage's per write rewrite cost.
