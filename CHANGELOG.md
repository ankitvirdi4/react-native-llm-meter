# Changelog

## 0.1.0 (2026-05-01)

First public release. Track LLM token usage, cost, and latency from React Native and Expo apps.

### Features

- `Meter` class with sync `record`, async `getEvents`, `clear`, and `flush`.
- `meter.wrap(client)` provider detection and instrumentation for:
  - Anthropic (`messages.create`, streaming + non streaming).
  - OpenAI (`chat.completions.create`, streaming + non streaming).
  - Google (`models.generateContent`, `models.generateContentStream`, modern `@google/genai` shape).
- Storage adapters with a common `Storage` interface:
  - `MemoryStorage` (default).
  - `AsyncStorageAdapter` with day bucketed keys, queued writes, retention based eviction.
  - `SqliteAdapter` for `expo-sqlite` with indexes on timestamp / model / provider, queries 10k events under 50ms.
- React hooks under `<MeterProvider>`:
  - `useMetrics({ from, to, groupBy })` for live aggregated rollups.
  - `useBudget(threshold)` for today's UTC spend and over budget flag.
- Pure aggregation primitives: `summarize`, `summarizeBy`, `percentile`.
- Budget alerts via `meter.setBudget({ daily, weekly, monthly, onCross, state })` with single fire per period and persistence across reload via `AsyncStorageBudgetState`.
- Optional remote sink via `meter.attachRemoteSink({ sink, batchSize, batchIntervalMs, maxRetries, backoffBaseMs, onError })`. Includes `HttpRemoteSink` (with timeout) and `NoopRemoteSink`. Errors never propagate.
- Floating draggable `MeterOverlay` component on the `react-native-llm-meter/overlay` subpath. Today's spend, by model breakdown, recent calls with details. Defaults to `__DEV__`.
- Pricing table with 9 models across the three providers, dated 2026-05-01. PR template at `.github/PULL_REQUEST_TEMPLATE/pricing-update.md` for community updates.

### Privacy

Token counts, latency, model name, provider, and computed cost are captured. Prompt content and model output are never captured. Storage is on device by default. Remote sink is opt in.

### Tested

149 unit tests, 99% line coverage. Real SQLite via `better-sqlite3` in tests for migration and 10k event performance.
