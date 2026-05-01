import type { Provider } from "../types.js";
import { PRICING } from "./table.js";

export interface ComputeCostExtras {
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

export function computeCost(
  provider: Provider,
  model: string,
  inputTokens: number,
  outputTokens: number,
  extras: ComputeCostExtras = {},
): number {
  const price = PRICING[provider]?.[model];
  if (!price) return 0;

  let cost = inputTokens * price.input + outputTokens * price.output;

  if (extras.cacheReadInputTokens) {
    const rate = price.cacheRead ?? price.input * 0.1;
    cost += extras.cacheReadInputTokens * rate;
  }
  if (extras.cacheCreationInputTokens) {
    const rate = price.cacheCreate ?? price.input * 1.25;
    cost += extras.cacheCreationInputTokens * rate;
  }

  return cost / 1_000_000;
}
