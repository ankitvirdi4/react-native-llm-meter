import {
  type GroupBy,
  type Summary,
  summarize,
  summarizeBy,
} from "./aggregate.js";
import { type BudgetOptions, setBudgetWatcher } from "./budget.js";
import { computeCost } from "./pricing/compute.js";
import { PRICING } from "./pricing/table.js";
import {
  type ValidationIssue,
  type ValidationOptions,
  validatePricingTable,
} from "./pricing/validate.js";
import { isAnthropicClient, wrapAnthropic } from "./providers/anthropic.js";
import {
  isGoogleClient,
  isGoogleLegacyClient,
  wrapGoogle,
  wrapGoogleLegacy,
} from "./providers/google.js";
import { isOpenAIClient, wrapOpenAI } from "./providers/openai.js";
import {
  type AttachRemoteSinkOptions,
  attachRemoteSink as attachRemoteSinkFn,
} from "./remote.js";
import { MemoryStorage } from "./storage/memory.js";
import type { QueryRange, Storage } from "./storage/types.js";
import type { MeterEvent, MeterEventInput, Provider } from "./types.js";

function generateId(): string {
  const crypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof crypto?.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface MeterOptions {
  storage?: Storage;
  onError?: (err: unknown) => void;
  onUnknownModel?: (provider: Provider, model: string) => void;
}

export interface SummaryOptions {
  from?: number;
  to?: number;
  groupBy?: GroupBy | readonly GroupBy[];
}

export interface SummaryResult extends Summary {
  byModel?: Record<string, Summary>;
  byProvider?: Record<string, Summary>;
  byDay?: Record<string, Summary>;
  byTag?: Record<string, Record<string, Summary>>;
}

export type MeterListener = (event: MeterEvent) => void | Promise<void>;

function defaultUnknownModelWarning(provider: Provider, model: string): void {
  if (typeof console !== "undefined" && typeof console.warn === "function") {
    console.warn(
      `[react-native-llm-meter] Unknown model "${model}" for provider "${provider}". ` +
        `Cost will be 0 for this model. Add it to src/pricing/table.ts and submit a PR ` +
        `via the pricing-update template, or pass costUsd directly to meter.record.`,
    );
  }
}

export class Meter {
  private readonly storage: Storage;
  private readonly onError: (err: unknown) => void;
  private readonly onUnknownModel: (provider: Provider, model: string) => void;
  private pending: Set<Promise<unknown>> = new Set();
  private listeners: Set<MeterListener> = new Set();
  private warnedModels: Set<string> = new Set();

  constructor(opts: MeterOptions = {}) {
    this.storage = opts.storage ?? new MemoryStorage();
    this.onError = opts.onError ?? (() => {});
    this.onUnknownModel = opts.onUnknownModel ?? defaultUnknownModelWarning;
  }

  private maybeWarnUnknownModel(provider: Provider, model: string): void {
    const key = `${provider}:${model}`;
    if (this.warnedModels.has(key)) return;
    if (PRICING[provider]?.[model]) return;
    this.warnedModels.add(key);
    try {
      this.onUnknownModel(provider, model);
    } catch {
      // Warning handler errors must not break recording.
    }
  }

  record(input: MeterEventInput): MeterEvent {
    if (input.costUsd === undefined) {
      this.maybeWarnUnknownModel(input.provider, input.model);
    }

    const event: MeterEvent = {
      provider: input.provider,
      model: input.model,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      latencyMs: input.latencyMs,
      costUsd:
        input.costUsd ??
        computeCost(input.provider, input.model, input.inputTokens, input.outputTokens, {
          cacheReadInputTokens: input.cacheReadInputTokens,
          cacheCreationInputTokens: input.cacheCreationInputTokens,
        }),
      timestamp: input.timestamp ?? Date.now(),
      requestId: input.requestId ?? generateId(),
      ...(input.ttftMs !== undefined ? { ttftMs: input.ttftMs } : {}),
      ...(input.cacheReadInputTokens !== undefined
        ? { cacheReadInputTokens: input.cacheReadInputTokens }
        : {}),
      ...(input.cacheCreationInputTokens !== undefined
        ? { cacheCreationInputTokens: input.cacheCreationInputTokens }
        : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
      ...(input.retryCount !== undefined ? { retryCount: input.retryCount } : {}),
    };

    const promise = this.storage
      .append(event)
      .then(async () => {
        for (const listener of this.listeners) {
          try {
            await listener(event);
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

  async purge(olderThanTimestamp: number): Promise<number> {
    if (typeof this.storage.evict !== "function") return 0;
    return this.storage.evict(olderThanTimestamp);
  }

  validate(opts?: ValidationOptions): ValidationIssue[] {
    return validatePricingTable(opts);
  }

  async summary(opts: SummaryOptions = {}): Promise<SummaryResult> {
    const events = await this.storage.query({ from: opts.from, to: opts.to });
    const flat = summarize(events);
    const result: SummaryResult = { ...flat };

    const groups = opts.groupBy === undefined
      ? []
      : Array.isArray(opts.groupBy)
        ? opts.groupBy
        : [opts.groupBy];

    for (const g of groups) {
      if (g === "model") result.byModel = summarizeBy(events, "model");
      else if (g === "provider") result.byProvider = summarizeBy(events, "provider");
      else if (g === "day") result.byDay = summarizeBy(events, "day");
      else if (typeof g === "object" && "tag" in g) {
        result.byTag = result.byTag ?? {};
        result.byTag[g.tag] = summarizeBy(events, g);
      }
    }
    return result;
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

  setBudget(opts: BudgetOptions): () => void {
    return setBudgetWatcher(this, opts);
  }

  attachRemoteSink(opts: AttachRemoteSinkOptions): () => void {
    return attachRemoteSinkFn(this, opts);
  }

  wrap<T>(client: T): T {
    if (isAnthropicClient(client)) return wrapAnthropic(client, this) as T;
    if (isOpenAIClient(client)) return wrapOpenAI(client, this) as T;
    if (isGoogleClient(client)) return wrapGoogle(client, this) as T;
    if (isGoogleLegacyClient(client)) return wrapGoogleLegacy(client, this) as T;
    throw new Error(
      "Unsupported client. react-native-llm-meter supports Anthropic, OpenAI, Google (modern @google/genai), and legacy @google/generative-ai.",
    );
  }
}
