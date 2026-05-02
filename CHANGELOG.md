# Changelog

## 0.3.1

### Patch Changes

- v0.3.1 patch with three small additive items.

  Added:

  - **Long context tier pricing.** `ModelPricing` gains an optional `longContext: { threshold, input, output }` block. When `inputTokens` reaches the threshold, the entire input and output (and any cache rates that fall back to a multiple of input) are billed at the long context rates instead of the base rates. Anthropic Sonnet 4 family (4-0, 4-5, 4-6, 4-7) is now populated with the standard $6 input / $22.5 output rates above 200k tokens.
  - **`meter.validate(opts?)` and `validatePricingTable(opts?)`.** Returns an array of `ValidationIssue` objects describing structural problems with the pricing table: zero or negative prices, malformed `longContext` blocks, low long context rates relative to base. Useful for catching drift after community PRs to the pricing table. Also exports `isModelKnown(provider, model)` as a small public helper.
  - **`MeterEvent.retryCount`** as an optional field. Provider SDKs do not expose retry counts via stable hooks, so the wrap layer cannot auto populate it. Users who can capture retry count themselves (custom fetch middleware, SDK internals) can pass it through `meter.record` and we'll preserve it on the event for analysis. README troubleshooting documents the current limitation honestly.

  Notes:

  - One pre existing test had to be updated. `computeCost("anthropic", "claude-sonnet-4-6", 1_000_000, 500_000)` previously expected $10.50 at the base rate. With the new long context tier it now correctly returns $17.25. The test was rewritten to use 100k input + 50k output so it explicitly verifies the base rate path.

## 0.3.0

### Minor Changes

- v0.3.0 closes the remaining v0.2.x review gaps and adds a few small DX wins.

  Added:

  - `useEvents(opts?)` hook on the `react-native-llm-meter/react` subpath. Returns `{ events, loading, refresh }` and auto refreshes when the meter records, mirroring `useMetrics` semantics. Useful for "recent calls" lists in dev UIs.
  - `meter.purge(olderThanTimestamp)` public API. Delegates to `storage.evict` if implemented; returns the number of events removed. All shipped adapters (Memory, AsyncStorage, SQLite) now expose `evict`.
  - Server issued ack tokens for `RemoteSink`. The `send` method may now resolve with `{ accepted: false, reason? }` to trigger retry. Resolving with void or `{ accepted: true }` continues to indicate success. `HttpRemoteSink` gains an `expectAckResponse` option (default false) to parse the response body and honour the ack.
  - `MemoryStorage` and `SqliteAdapter` gained `evict(olderThanTimestamp)` to match the optional method on the `Storage` interface. `AsyncStorageAdapter.evict` already existed.
  - Coverage badge in README. 99 percent line coverage, manually maintained for now.

  Adoption:

  - Project now uses [changesets](https://github.com/changesets/changesets) for release management. Each change adds a `.changeset/*.md` file with the version impact; `npx changeset version` bumps the version and updates the CHANGELOG, `npx changeset publish` runs npm publish. Eliminates the version mismatch slips that bit us during the v0.0.x to v0.2.x run.

## 0.2.2 (2026-05-01)

### Fixed

- `buildOverlayState` and `OverlayState` are now also exported from the main entry. Previously they only lived on the `/overlay` subpath, which forced a runtime `react-native` import. Non React consumers (CI pipelines, server preprocessing, Node tooling) can now use the pure aggregation helper without touching the React component bundle.
- Caught by an isolated `npm pack` plus install plus runtime smoke test against the published tarball. The bundle, exports, types, and end to end Meter API all resolve cleanly in a fresh Node 22 dir with only the package installed.

## 0.2.1 (2026-05-01)

### Added

- `meter.summary(opts?)` convenience method. Returns a `SummaryResult` with the same flat fields as `summarize` plus optional `byModel`, `byProvider`, `byDay`, and `byTag` rollups when `opts.groupBy` is set. Same shape and source data as the existing `summarize` and `summarizeBy` primitives, just one call.

### Documentation

- README rewritten with a before / after Quick start, a "What you get" code block showing realistic `meter.summary` output, an ASCII architecture diagram, a comparison table vs server side observability, an FAQ, a roadmap section, and an About section.

## 0.2.0 (2026-05-01)

Closes the remaining four review weaknesses. Breaking changes ship under `next` dist tag first; promote to `latest` after a soak window.

### Breaking

- Hooks moved to `react-native-llm-meter/react` subpath. The main entry still re-exports them as a deprecation shim; will be removed in v0.3.
- `useBudget` signature changed: `useBudget(threshold, options?)`. Default timezone is now `local` (was implicit UTC). Pass `{ timezone: "utc" }` to keep the v0.1.x behavior. New options: `{ period: "day" | "week" | "month"; timezone: "local" | "utc" }`. Returns now include `periodStart`.

### Added

- **Tagging** (closes review #4). `MeterEvent.tags?: Record<string, string>` for grouping events by `userId`, `sessionId`, `featureName`, etc. `summarizeBy(events, { tag: "userId" })` groups by tag value, skipping events that lack the tag. SQLite schema gains a `tags` column (JSON), migrated transparently for existing databases.
- **Budget periods + local timezone** (closes review #5). `useBudget` and `setBudget` accept `period` and `timezone`. Local is the new default for hooks; matches user expectations for end facing budget UIs.
- **Google legacy SDK support** (closes review #8). `wrapGoogleLegacy` and `isGoogleLegacyClient` for the older `@google/generative-ai` shape (`client.getGenerativeModel(...)`). Streaming, non streaming, and TTFT all supported. `Meter.wrap` dispatcher tries modern first, legacy second.
- **Bundle split for hooks** (closes review #1). Subpath `react-native-llm-meter/react` exports the React side (MeterProvider, useMeter, useMetrics, useBudget). Non React consumers importing the main entry no longer pull `react` into their type graph.

### Migrations

- SqliteAdapter adds a `tags` column. Older databases upgrade transparently via `ALTER TABLE ADD COLUMN`.

### Notes

- Test count: 196 (up from 181). Coverage 99.44% lines, 97.14% branches.
- Recommended publish flow: `npm publish --tag next --access public`. After a soak window: `npm dist-tag add react-native-llm-meter@0.2.0 latest`.

## 0.1.4 (2026-05-01)

### Added

- Anthropic prompt cache cost detail. `MeterEvent` gains optional `cacheReadInputTokens` and `cacheCreationInputTokens`. The Anthropic wrapper extracts both from `response.usage` (and from `message_start.message.usage` on streams). `computeCost` adds cache cost at 0.1x input rate for reads and 1.25x for writes by default; `ModelPricing` accepts explicit `cacheRead` and `cacheCreate` overrides.
- OpenAI streaming auto enables `stream_options.include_usage` when the user did not set it. Without this option OpenAI omits token counts from the stream entirely. The library logs a one time warning per wrapped client. Pass the option explicitly (true or false) to silence and keep your choice.
- IDs use `globalThis.crypto.randomUUID()` when available (Node 19 plus, modern Hermes), with a Math based fallback for older runtimes.

### Migrations

- SqliteAdapter adds `cache_read_input_tokens` and `cache_creation_input_tokens` columns. Existing v0.1.x databases are upgraded transparently via `ALTER TABLE ADD COLUMN` checks during init.

### Documentation

- README Remote sink section now documents server side deduplication via `requestId` so that retries land idempotently. Server issued ack tokens are on the v0.3 roadmap.

## 0.1.3 (2026-05-01)

### Added

- Pricing table expanded from 9 models to 50+ across the three providers. Anthropic Claude 3, 3.5, 3.7, 4 family. OpenAI GPT-3.5, GPT-4, GPT-4 Turbo, GPT-4o, GPT-4.1, o1/o3/o4 reasoning. Google Gemini 1.5, 2.0, 2.5 family. Best effort verified as of 2026-05-01; PR template at `.github/PULL_REQUEST_TEMPLATE/pricing-update.md` for community corrections.
- Test that asserts at least 10 entries per provider so regressions in breadth are caught.

### Fixed

- Example app at `examples/expo-dev-client/` now uses the version pins Expo SDK 53 actually expects: `@react-native-async-storage/async-storage@2.1.2`, `expo-dev-client@~5.2.4`, `expo-sqlite@~15.2.14`, `expo-status-bar@~2.2.3`, `react-native@0.79.6`, `typescript@~5.8.3`. Previously the pins were guesses and would have produced dependency conflicts on a fresh install. Verified via `npm install` and `npx expo-doctor`.

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
