import type { Provider } from "../types.js";

// Prices in USD per 1,000,000 tokens.
// Verified as of 2026-05-01 against provider pricing pages.
// Submit a PR to update when providers change rates.

export interface ModelPricing {
  input: number;
  output: number;
}

export type PricingTable = Record<Provider, Record<string, ModelPricing>>;

export const PRICING: PricingTable = {
  anthropic: {
    "claude-opus-4-7": { input: 15, output: 75 },
    "claude-sonnet-4-6": { input: 3, output: 15 },
    "claude-haiku-4-5": { input: 1, output: 5 },
  },
  openai: {
    "gpt-4o": { input: 2.5, output: 10 },
    "gpt-4o-mini": { input: 0.15, output: 0.6 },
    "o1": { input: 15, output: 60 },
  },
  google: {
    "gemini-2.0-flash": { input: 0.1, output: 0.4 },
    "gemini-1.5-pro": { input: 1.25, output: 5 },
    "gemini-1.5-flash": { input: 0.075, output: 0.3 },
  },
};
