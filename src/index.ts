export const VERSION = "0.2.1";

export { Meter } from "./meter.js";
export type {
  MeterListener,
  MeterOptions,
  SummaryOptions,
  SummaryResult,
} from "./meter.js";
export { computeCost } from "./pricing/compute.js";
export { PRICING } from "./pricing/table.js";
export type { ModelPricing, PricingTable } from "./pricing/table.js";
export { isAnthropicClient, wrapAnthropic } from "./providers/anthropic.js";
export type {
  AnthropicCreateParams,
  AnthropicLike,
  AnthropicResponse,
  AnthropicStream,
  AnthropicStreamChunk,
} from "./providers/anthropic.js";
export { isOpenAIClient, wrapOpenAI } from "./providers/openai.js";
export type {
  OpenAICreateParams,
  OpenAILike,
  OpenAIResponse,
  OpenAIStream,
  OpenAIStreamChunk,
} from "./providers/openai.js";
export {
  isGoogleClient,
  isGoogleLegacyClient,
  wrapGoogle,
  wrapGoogleLegacy,
} from "./providers/google.js";
export type {
  GoogleGenerateParams,
  GoogleLegacyClient,
  GoogleLegacyModel,
  GoogleLegacyResult,
  GoogleLegacyStreamResult,
  GoogleLike,
  GoogleResponse,
  GoogleStream,
  GoogleStreamChunk,
} from "./providers/google.js";
export { MemoryStorage } from "./storage/memory.js";
export {
  AsyncStorageAdapter,
} from "./storage/async-storage.js";
export type {
  AsyncStorageAdapterOptions,
  AsyncStorageLike,
} from "./storage/async-storage.js";
export { SqliteAdapter } from "./storage/sqlite.js";
export type {
  SqliteAdapterOptions,
  SqliteDatabaseLike,
  SqliteParams,
} from "./storage/sqlite.js";
export type { QueryRange, Storage } from "./storage/types.js";
export {
  AsyncStorageBudgetState,
  MemoryBudgetState,
  setBudgetWatcher,
  startOfUtcDay,
  startOfUtcMonth,
  startOfUtcWeek,
} from "./budget.js";
export type {
  AsyncStorageBudgetStateOptions,
  BudgetCrossInfo,
  BudgetOptions,
  BudgetPeriod,
  BudgetStateStore,
} from "./budget.js";
export {
  attachRemoteSink,
  HttpRemoteSink,
  NoopRemoteSink,
} from "./remote.js";
export type {
  AttachRemoteSinkOptions,
  HttpRemoteSinkOptions,
  RemoteSink,
} from "./remote.js";
export { percentile, summarize, summarizeBy } from "./aggregate.js";
export type { GroupBy, Summary } from "./aggregate.js";
// Hooks moved to react-native-llm-meter/react in v0.2.0. The re-exports
// below are kept as a v0.1.x deprecation shim and will be removed in v0.3.
export {
  MeterProvider,
  useBudget,
  useMeter,
  useMetrics,
} from "./react/hooks.js";
export type {
  MeterProviderProps,
  UseBudgetResult,
  UseMetricsOptions,
  UseMetricsResult,
} from "./react/hooks.js";
export type { MeterEvent, MeterEventInput, Provider } from "./types.js";
