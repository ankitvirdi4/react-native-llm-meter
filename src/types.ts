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
}

export type MeterEventInput = Omit<MeterEvent, "timestamp" | "requestId" | "costUsd"> & {
  timestamp?: number;
  requestId?: string;
  costUsd?: number;
};
