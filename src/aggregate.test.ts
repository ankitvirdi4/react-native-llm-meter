import { describe, expect, it } from "vitest";
import { percentile, summarize, summarizeBy } from "./aggregate.js";
import type { MeterEvent } from "./types.js";

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

describe("percentile", () => {
  it("returns 0 for an empty array", () => {
    expect(percentile([], 50)).toBe(0);
  });

  it("returns the only value for a single element", () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 95)).toBe(42);
  });

  it("computes p50 and p95 from a sorted distribution", () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(values, 50)).toBe(60);
    expect(percentile(values, 95)).toBe(100);
  });

  it("handles unsorted input", () => {
    // Sorted: [10, 20, 30, 50, 100]. p50 picks the middle element.
    expect(percentile([100, 10, 50, 20, 30], 50)).toBe(30);
  });
});

describe("summarize", () => {
  it("returns zeros for empty input", () => {
    const s = summarize([]);
    expect(s).toEqual({
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
    });
  });

  it("sums tokens, cost, and computes latency stats", () => {
    const events = [
      makeEvent({ inputTokens: 100, outputTokens: 50, costUsd: 0.001, latencyMs: 100 }),
      makeEvent({ inputTokens: 200, outputTokens: 100, costUsd: 0.002, latencyMs: 200 }),
      makeEvent({ inputTokens: 300, outputTokens: 150, costUsd: 0.003, latencyMs: 300 }),
    ];
    const s = summarize(events);

    expect(s.count).toBe(3);
    expect(s.inputTokens).toBe(600);
    expect(s.outputTokens).toBe(300);
    expect(s.totalTokens).toBe(900);
    expect(s.costUsd).toBeCloseTo(0.006, 6);
    expect(s.latencyMean).toBeCloseTo(200, 6);
    expect(s.latencyP50).toBe(200);
    expect(s.latencyP95).toBe(300);
  });
});

describe("summarize ttft", () => {
  it("returns zeros for ttft fields when no events have ttftMs", () => {
    const events = [
      makeEvent({ requestId: "a" }),
      makeEvent({ requestId: "b" }),
    ];
    const s = summarize(events);
    expect(s.ttftP50).toBe(0);
    expect(s.ttftP95).toBe(0);
    expect(s.ttftMean).toBe(0);
    expect(s.ttftCount).toBe(0);
  });

  it("computes ttft stats from events that have ttftMs set", () => {
    const events = [
      makeEvent({ requestId: "a", ttftMs: 100 }),
      makeEvent({ requestId: "b", ttftMs: 200 }),
      makeEvent({ requestId: "c", ttftMs: 300 }),
      makeEvent({ requestId: "d" }), // non streaming, no ttft
    ];
    const s = summarize(events);
    expect(s.ttftCount).toBe(3);
    expect(s.ttftMean).toBeCloseTo(200, 6);
    expect(s.ttftP50).toBe(200);
    expect(s.ttftP95).toBe(300);
    // Latency stats include all four events
    expect(s.count).toBe(4);
  });
});

describe("summarizeBy", () => {
  it("groups by model", () => {
    const events = [
      makeEvent({ model: "claude-sonnet-4-6", inputTokens: 100 }),
      makeEvent({ model: "claude-haiku-4-5", inputTokens: 50 }),
      makeEvent({ model: "claude-sonnet-4-6", inputTokens: 200 }),
    ];
    const result = summarizeBy(events, "model");

    expect(Object.keys(result).sort()).toEqual([
      "claude-haiku-4-5",
      "claude-sonnet-4-6",
    ]);
    expect(result["claude-sonnet-4-6"].count).toBe(2);
    expect(result["claude-sonnet-4-6"].inputTokens).toBe(300);
    expect(result["claude-haiku-4-5"].count).toBe(1);
  });

  it("groups by provider", () => {
    const events = [
      makeEvent({ provider: "anthropic" }),
      makeEvent({ provider: "openai", model: "gpt-4o" }),
      makeEvent({ provider: "anthropic" }),
      makeEvent({ provider: "google", model: "gemini-2.0-flash" }),
    ];
    const result = summarizeBy(events, "provider");

    expect(result.anthropic.count).toBe(2);
    expect(result.openai.count).toBe(1);
    expect(result.google.count).toBe(1);
  });

  it("groups by UTC day", () => {
    const events = [
      makeEvent({ timestamp: Date.parse("2026-05-01T08:00:00Z") }),
      makeEvent({ timestamp: Date.parse("2026-05-01T18:00:00Z") }),
      makeEvent({ timestamp: Date.parse("2026-05-02T01:00:00Z") }),
    ];
    const result = summarizeBy(events, "day");

    expect(result["2026-05-01"].count).toBe(2);
    expect(result["2026-05-02"].count).toBe(1);
  });

  it("returns an empty record for empty input", () => {
    expect(summarizeBy([], "model")).toEqual({});
  });

  it("groups by tag value, skipping events without that tag", () => {
    const events = [
      makeEvent({ requestId: "a", tags: { userId: "alice" } }),
      makeEvent({ requestId: "b", tags: { userId: "bob" } }),
      makeEvent({ requestId: "c", tags: { userId: "alice" } }),
      makeEvent({ requestId: "d" }), // no tags
      makeEvent({ requestId: "e", tags: { sessionId: "x" } }), // wrong tag
    ];
    const result = summarizeBy(events, { tag: "userId" });

    expect(Object.keys(result).sort()).toEqual(["alice", "bob"]);
    expect(result.alice.count).toBe(2);
    expect(result.bob.count).toBe(1);
  });
});
