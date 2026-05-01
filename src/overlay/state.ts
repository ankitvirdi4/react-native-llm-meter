import { type Summary, summarize, summarizeBy } from "../aggregate.js";
import type { MeterEvent } from "../types.js";

export interface OverlayState {
  recentEvents: MeterEvent[];
  todaySpend: number;
  todayCount: number;
  byModel: Record<string, Summary>;
}

export interface BuildOverlayStateOptions {
  limit?: number;
  now?: number;
}

function startOfUtcDay(timestamp: number): number {
  const d = new Date(timestamp);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function buildOverlayState(
  events: MeterEvent[],
  opts: BuildOverlayStateOptions = {},
): OverlayState {
  const limit = opts.limit ?? 10;
  const now = opts.now ?? Date.now();
  const todayStart = startOfUtcDay(now);

  const todayEvents = events.filter((e) => e.timestamp >= todayStart);
  const todaySummary = summarize(todayEvents);

  const recentEvents = [...events]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);

  return {
    recentEvents,
    todaySpend: todaySummary.costUsd,
    todayCount: todaySummary.count,
    byModel: summarizeBy(todayEvents, "model"),
  };
}
