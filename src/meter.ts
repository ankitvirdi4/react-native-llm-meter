import { computeCost } from "./pricing/compute.js";
import { isAnthropicClient, wrapAnthropic } from "./providers/anthropic.js";
import type { MeterEvent, MeterEventInput } from "./types.js";

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class Meter {
  private events: MeterEvent[] = [];

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
    this.events.push(event);
    return event;
  }

  getEvents(): MeterEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events = [];
  }

  wrap<T>(client: T): T {
    if (isAnthropicClient(client)) {
      return wrapAnthropic(client, this) as T;
    }
    throw new Error(
      "Unsupported client. react-native-llm-meter currently supports Anthropic. OpenAI and Google land in Phase 4.",
    );
  }
}
