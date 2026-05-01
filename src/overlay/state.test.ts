import { describe, expect, it } from "vitest";
import type { MeterEvent } from "../types.js";
import { buildOverlayState } from "./state.js";

function makeEvent(overrides: Partial<MeterEvent> = {}): MeterEvent {
  return {
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    inputTokens: 100,
    outputTokens: 50,
    latencyMs: 200,
    costUsd: 0.001,
    timestamp: Date.parse("2026-05-01T12:00:00Z"),
    requestId: "req",
    ...overrides,
  };
}

describe("buildOverlayState", () => {
  it("returns zeros for empty input", () => {
    const state = buildOverlayState([]);
    expect(state.recentEvents).toEqual([]);
    expect(state.todaySpend).toBe(0);
    expect(state.todayCount).toBe(0);
    expect(state.byModel).toEqual({});
  });

  it("filters today's spend by UTC day", () => {
    const now = Date.parse("2026-05-01T12:00:00Z");
    const events = [
      makeEvent({
        requestId: "yesterday",
        timestamp: Date.parse("2026-04-30T22:00:00Z"),
        costUsd: 0.5,
      }),
      makeEvent({
        requestId: "today",
        timestamp: Date.parse("2026-05-01T08:00:00Z"),
        costUsd: 0.25,
      }),
    ];

    const state = buildOverlayState(events, { now });
    expect(state.todayCount).toBe(1);
    expect(state.todaySpend).toBe(0.25);
  });

  it("returns recent events sorted by timestamp descending, limited", () => {
    const events = Array.from({ length: 20 }, (_, i) =>
      makeEvent({ requestId: `r${i}`, timestamp: 1000 + i }),
    );
    const state = buildOverlayState(events, { limit: 5 });

    expect(state.recentEvents).toHaveLength(5);
    expect(state.recentEvents.map((e) => e.requestId)).toEqual([
      "r19",
      "r18",
      "r17",
      "r16",
      "r15",
    ]);
  });

  it("default limit is 10", () => {
    const events = Array.from({ length: 25 }, (_, i) =>
      makeEvent({ requestId: `r${i}`, timestamp: i }),
    );
    const state = buildOverlayState(events);
    expect(state.recentEvents).toHaveLength(10);
  });

  it("groups today's events by model", () => {
    const now = Date.parse("2026-05-01T12:00:00Z");
    const events = [
      makeEvent({
        requestId: "a",
        model: "claude-sonnet-4-6",
        timestamp: Date.parse("2026-05-01T08:00:00Z"),
      }),
      makeEvent({
        requestId: "b",
        model: "claude-sonnet-4-6",
        timestamp: Date.parse("2026-05-01T09:00:00Z"),
      }),
      makeEvent({
        requestId: "c",
        model: "claude-haiku-4-5",
        timestamp: Date.parse("2026-05-01T10:00:00Z"),
      }),
      makeEvent({
        requestId: "old",
        model: "claude-haiku-4-5",
        timestamp: Date.parse("2026-04-30T08:00:00Z"),
      }),
    ];

    const state = buildOverlayState(events, { now });
    expect(state.byModel["claude-sonnet-4-6"].count).toBe(2);
    expect(state.byModel["claude-haiku-4-5"].count).toBe(1);
  });
});
