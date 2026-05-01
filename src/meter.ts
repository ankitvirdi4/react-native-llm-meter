import { computeCost } from "./pricing/compute.js";
import { isAnthropicClient, wrapAnthropic } from "./providers/anthropic.js";
import { isGoogleClient, wrapGoogle } from "./providers/google.js";
import { isOpenAIClient, wrapOpenAI } from "./providers/openai.js";
import { MemoryStorage } from "./storage/memory.js";
import type { QueryRange, Storage } from "./storage/types.js";
import type { MeterEvent, MeterEventInput } from "./types.js";

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface MeterOptions {
  storage?: Storage;
  onError?: (err: unknown) => void;
}

export type MeterListener = (event: MeterEvent) => void;

export class Meter {
  private readonly storage: Storage;
  private readonly onError: (err: unknown) => void;
  private pending: Set<Promise<unknown>> = new Set();
  private listeners: Set<MeterListener> = new Set();

  constructor(opts: MeterOptions = {}) {
    this.storage = opts.storage ?? new MemoryStorage();
    this.onError = opts.onError ?? (() => {});
  }

  record(input: MeterEventInput): MeterEvent {
    const event: MeterEvent = {
      provider: input.provider,
      model: input.model,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      latencyMs: input.latencyMs,
      costUsd:
        input.costUsd ??
        computeCost(input.provider, input.model, input.inputTokens, input.outputTokens),
      timestamp: input.timestamp ?? Date.now(),
      requestId: input.requestId ?? generateId(),
    };

    const promise = this.storage
      .append(event)
      .then(() => {
        for (const listener of this.listeners) {
          try {
            listener(event);
          } catch {
            // Listener errors must not break recording.
          }
        }
      })
      .catch((err: unknown) => this.onError(err));
    this.pending.add(promise);
    promise.finally(() => this.pending.delete(promise));
    return event;
  }

  getEvents(range?: QueryRange): Promise<MeterEvent[]> {
    return this.storage.query(range);
  }

  async clear(): Promise<void> {
    await this.storage.clear();
  }

  async flush(): Promise<void> {
    await Promise.all(this.pending);
  }

  subscribe(listener: MeterListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  wrap<T>(client: T): T {
    if (isAnthropicClient(client)) return wrapAnthropic(client, this) as T;
    if (isOpenAIClient(client)) return wrapOpenAI(client, this) as T;
    if (isGoogleClient(client)) return wrapGoogle(client, this) as T;
    throw new Error(
      "Unsupported client. react-native-llm-meter supports Anthropic, OpenAI, and Google.",
    );
  }
}
