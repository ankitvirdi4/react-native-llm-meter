export type Provider = "anthropic" | "openai" | "google";

export interface MeterEvent {
  provider: Provider;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  costUsd: number;
  timestamp: number;
  requestId: string;
  // Time to first content token, milliseconds. Set on streaming events only.
  // Undefined for non streaming responses where the request returns the full
  // body in a single round trip.
  ttftMs?: number;
  // Anthropic prompt caching. Only set when the provider returns a cache hit
  // or write. cacheReadInputTokens are billed at 0.1x input rate;
  // cacheCreationInputTokens at 1.25x input rate.
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  // Free form tags for grouping and filtering. Useful for userId, sessionId,
  // featureName, releaseChannel, etc. Stored as JSON in SQLite.
  tags?: Record<string, string>;
  // Number of internal retries the provider SDK performed before this call
  // resolved or rejected. Currently optional and user supplied. Provider SDKs
  // do not expose retry counts via stable hooks, so the wrap layer cannot
  // auto populate this. See README troubleshooting for the full caveat.
  retryCount?: number;
}

export type MeterEventInput = Omit<MeterEvent, "timestamp" | "requestId" | "costUsd"> & {
  timestamp?: number;
  requestId?: string;
  costUsd?: number;
};
