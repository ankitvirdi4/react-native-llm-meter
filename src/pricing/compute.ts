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

  const useLongContext =
    price.longContext !== undefined &&
    inputTokens >= price.longContext.threshold;

  const inputRate = useLongContext ? price.longContext!.input : price.input;
  const outputRate = useLongContext ? price.longContext!.output : price.output;

  let cost = inputTokens * inputRate + outputTokens * outputRate;

  if (extras.cacheReadInputTokens) {
    const rate = price.cacheRead ?? inputRate * 0.1;
    cost += extras.cacheReadInputTokens * rate;
  }
  if (extras.cacheCreationInputTokens) {
    const rate = price.cacheCreate ?? inputRate * 1.25;
    cost += extras.cacheCreationInputTokens * rate;
  }

  return cost / 1_000_000;
}
