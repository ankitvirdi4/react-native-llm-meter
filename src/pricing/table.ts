import type { Provider } from "../types.js";

// Prices in USD per 1,000,000 tokens.
//
// Best effort verified against published provider rates as of 2026-05-01.
// Some entries are approximate (older snapshots, less common variants).
// Provider prices change. If you spot a stale or wrong rate, open a PR using
// the pricing-update template in .github/PULL_REQUEST_TEMPLATE/.
//
// Sources:
//   https://www.anthropic.com/pricing
//   https://platform.openai.com/docs/pricing
//   https://ai.google.dev/pricing

export interface ModelPricing {
  input: number;
  output: number;
  // Anthropic prompt cache rates. When unset, computeCost falls back to
  // input * 0.1 for reads and input * 1.25 for writes (Anthropic standard).
  cacheRead?: number;
  cacheCreate?: number;
}

export type PricingTable = Record<Provider, Record<string, ModelPricing>>;

export const PRICING: PricingTable = {
  anthropic: {
    // Claude 4 family
    "claude-opus-4-7": { input: 15, output: 75 },
    "claude-opus-4-6": { input: 15, output: 75 },
    "claude-opus-4-1": { input: 15, output: 75 },
    "claude-opus-4-0": { input: 15, output: 75 },
    "claude-sonnet-4-7": { input: 3, output: 15 },
    "claude-sonnet-4-6": { input: 3, output: 15 },
    "claude-sonnet-4-5": { input: 3, output: 15 },
    "claude-sonnet-4-0": { input: 3, output: 15 },
    "claude-haiku-4-5": { input: 1, output: 5 },
    "claude-haiku-4-0": { input: 0.8, output: 4 },
    // Claude 3.7
    "claude-3-7-sonnet-latest": { input: 3, output: 15 },
    "claude-3-7-sonnet-20250219": { input: 3, output: 15 },
    // Claude 3.5
    "claude-3-5-sonnet-latest": { input: 3, output: 15 },
    "claude-3-5-sonnet-20241022": { input: 3, output: 15 },
    "claude-3-5-sonnet-20240620": { input: 3, output: 15 },
    "claude-3-5-haiku-latest": { input: 0.8, output: 4 },
    "claude-3-5-haiku-20241022": { input: 0.8, output: 4 },
    // Claude 3
    "claude-3-opus-latest": { input: 15, output: 75 },
    "claude-3-opus-20240229": { input: 15, output: 75 },
    "claude-3-sonnet-20240229": { input: 3, output: 15 },
    "claude-3-haiku-20240307": { input: 0.25, output: 1.25 },
  },

  openai: {
    // GPT-4.1 family
    "gpt-4.1": { input: 2, output: 8 },
    "gpt-4.1-mini": { input: 0.4, output: 1.6 },
    "gpt-4.1-nano": { input: 0.1, output: 0.4 },
    // GPT-4o family
    "gpt-4o": { input: 2.5, output: 10 },
    "gpt-4o-2024-11-20": { input: 2.5, output: 10 },
    "gpt-4o-2024-08-06": { input: 2.5, output: 10 },
    "gpt-4o-2024-05-13": { input: 5, output: 15 },
    "gpt-4o-mini": { input: 0.15, output: 0.6 },
    "gpt-4o-mini-2024-07-18": { input: 0.15, output: 0.6 },
    // GPT-4 / Turbo (legacy)
    "gpt-4-turbo": { input: 10, output: 30 },
    "gpt-4-turbo-2024-04-09": { input: 10, output: 30 },
    "gpt-4": { input: 30, output: 60 },
    // o-series reasoning
    "o1": { input: 15, output: 60 },
    "o1-2024-12-17": { input: 15, output: 60 },
    "o1-preview": { input: 15, output: 60 },
    "o1-mini": { input: 3, output: 12 },
    "o3": { input: 10, output: 40 },
    "o3-mini": { input: 1.1, output: 4.4 },
    "o4-mini": { input: 1.1, output: 4.4 },
    // GPT-3.5 (legacy)
    "gpt-3.5-turbo": { input: 0.5, output: 1.5 },
    "gpt-3.5-turbo-0125": { input: 0.5, output: 1.5 },
  },

  google: {
    // Gemini 2.5 family
    "gemini-2.5-pro": { input: 1.25, output: 10 },
    "gemini-2.5-flash": { input: 0.3, output: 2.5 },
    "gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
    // Gemini 2.0 family
    "gemini-2.0-flash": { input: 0.1, output: 0.4 },
    "gemini-2.0-flash-001": { input: 0.1, output: 0.4 },
    "gemini-2.0-flash-lite": { input: 0.075, output: 0.3 },
    "gemini-2.0-flash-lite-001": { input: 0.075, output: 0.3 },
    "gemini-2.0-pro-exp": { input: 1.25, output: 5 },
    // Gemini 1.5 family
    "gemini-1.5-pro": { input: 1.25, output: 5 },
    "gemini-1.5-pro-002": { input: 1.25, output: 5 },
    "gemini-1.5-pro-001": { input: 1.25, output: 5 },
    "gemini-1.5-flash": { input: 0.075, output: 0.3 },
    "gemini-1.5-flash-002": { input: 0.075, output: 0.3 },
    "gemini-1.5-flash-001": { input: 0.075, output: 0.3 },
    "gemini-1.5-flash-8b": { input: 0.0375, output: 0.15 },
    "gemini-1.5-flash-8b-001": { input: 0.0375, output: 0.15 },
  },
};
