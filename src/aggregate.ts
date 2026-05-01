import type { MeterEvent } from "./types.js";

export type GroupBy = "model" | "provider" | "day" | { tag: string };

export interface Summary {
  count: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  latencyP50: number;
  latencyP95: number;
  latencyMean: number;
  ttftP50: number;
  ttftP95: number;
  ttftMean: number;
  ttftCount: number;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

const EMPTY_SUMMARY: Summary = {
  count: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  costUsd: 0,
  latencyP50: 0,
  latencyP95: 0,
  latencyMean: 0,
  ttftP50: 0,
  ttftP95: 0,
  ttftMean: 0,
  ttftCount: 0,
};

export function summarize(events: MeterEvent[]): Summary {
  const count = events.length;
  if (count === 0) return { ...EMPTY_SUMMARY };

  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  let latencySum = 0;
  const latencies: number[] = new Array(count);

  let ttftSum = 0;
  const ttftValues: number[] = [];

  for (let i = 0; i < count; i++) {
    const e = events[i];
    inputTokens += e.inputTokens;
    outputTokens += e.outputTokens;
    costUsd += e.costUsd;
    latencySum += e.latencyMs;
    latencies[i] = e.latencyMs;
    if (e.ttftMs !== undefined) {
      ttftSum += e.ttftMs;
      ttftValues.push(e.ttftMs);
    }
  }

  return {
    count,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    costUsd,
    latencyP50: percentile(latencies, 50),
    latencyP95: percentile(latencies, 95),
    latencyMean: latencySum / count,
    ttftP50: percentile(ttftValues, 50),
    ttftP95: percentile(ttftValues, 95),
    ttftMean: ttftValues.length > 0 ? ttftSum / ttftValues.length : 0,
    ttftCount: ttftValues.length,
  };
}

function groupKey(event: MeterEvent, by: GroupBy): string | undefined {
  if (by === "model") return event.model;
  if (by === "provider") return event.provider;
  if (by === "day") return new Date(event.timestamp).toISOString().slice(0, 10);
  return event.tags?.[by.tag];
}

export function summarizeBy(
  events: MeterEvent[],
  by: GroupBy,
): Record<string, Summary> {
  const groups = new Map<string, MeterEvent[]>();
  for (const event of events) {
    const key = groupKey(event, by);
    if (key === undefined) continue;
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = [];
      groups.set(key, bucket);
    }
    bucket.push(event);
  }

  const result: Record<string, Summary> = {};
  for (const [key, bucket] of groups) {
    result[key] = summarize(bucket);
  }
  return result;
}
