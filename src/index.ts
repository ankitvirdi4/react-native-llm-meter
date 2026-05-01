export const VERSION = "0.0.3";

export { Meter } from "./meter.js";
export { computeCost } from "./pricing/compute.js";
export { PRICING } from "./pricing/table.js";
export type { ModelPricing, PricingTable } from "./pricing/table.js";
export { isAnthropicClient, wrapAnthropic } from "./providers/anthropic.js";
export type {
  AnthropicCreateParams,
  AnthropicLike,
  AnthropicResponse,
} from "./providers/anthropic.js";
export type { MeterEvent, MeterEventInput, Provider } from "./types.js";
