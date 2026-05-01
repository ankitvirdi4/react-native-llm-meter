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
}

export type MeterEventInput = Omit<MeterEvent, "timestamp" | "requestId" | "costUsd"> & {
  timestamp?: number;
  requestId?: string;
  costUsd?: number;
};
