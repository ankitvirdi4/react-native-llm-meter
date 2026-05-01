import type { Provider } from "../types.js";
import { PRICING } from "./table.js";

export function computeCost(
  provider: Provider,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const price = PRICING[provider]?.[model];
  if (!price) return 0;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}
