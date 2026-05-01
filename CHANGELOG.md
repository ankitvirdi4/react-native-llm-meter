# Changelog

## 0.1.2 (2026-05-01)

### Added

- `ttftMs` on `MeterEvent`. Time to first content token, set on streaming events only. Anthropic captures it on the first `content_block_delta` chunk. OpenAI on the first chunk where `choices[0].delta.content` is non empty. Google on the first chunk where `candidates[0].content.parts[0].text` is non empty.
- `Summary` gains `ttftP50`, `ttftP95`, `ttftMean`, `ttftCount`. Computed only from events that have `ttftMs` defined. All zero when the slice has no streaming events.
- `MeterOverlay` shows `ttft: Xms` in the row details panel when present.
- README documents streaming TTFT under Providers.

### Migrations

- `SqliteAdapter` adds a `ttft_ms` column on init. v0.1.x databases without the column are upgraded transparently via `ALTER TABLE ADD COLUMN`. Existing rows keep `ttftMs` undefined.

### Notes

- `latencyMs` continues to mean total wall clock (request start to end of stream for streaming, request start to response for non streaming). TTFT is additive, not a replacement.

## 0.1.1 (2026-05-01)

### Added

- `onUnknownModel(provider, model)` option on `MeterOptions`. The meter calls it once per unique (provider, model) pair when an event is recorded against a model missing from the pricing table. Default handler logs to `console.warn` with a pointer to the pricing PR template. Pass `() => {}` to silence, or route to Sentry / your logger.
- `record` skips the warning when the caller supplies `costUsd` directly. No spurious warnings for users with custom pricing.

### Fixed

- Surfaces the cost = 0 friction reviewers flagged. Previously a model missing from the table silently returned `costUsd: 0`, which forced users to debug.

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
