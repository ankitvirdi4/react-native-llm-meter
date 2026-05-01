# react-native-llm-meter

> 🚧 **Pre release.** v0.1.0 launching soon. Star to follow along.

LLM observability built for React Native and Expo. Track token usage, cost, and
latency for Claude, GPT, and Gemini calls. Runs on device, with optional remote sync.

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

## Pricing accuracy

Provider prices are hardcoded in [`src/pricing/table.ts`](src/pricing/table.ts), verified against published rates as of 2026-05-01. Prices change. If you spot a stale rate, open a PR updating the table and the verified date.

## Status

Currently reserving the npm name. Real release coming.

Built by [Ankit Virdi](https://github.com/ankitvirdi4).

## License

MIT
