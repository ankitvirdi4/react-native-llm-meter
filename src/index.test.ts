import { describe, expect, it } from "vitest";
import { Meter, VERSION, computeCost } from "./index.js";

describe("VERSION", () => {
  it("matches package version", () => {
    expect(VERSION).toBe("0.0.3");
  });
});

describe("computeCost", () => {
  it("computes Anthropic Sonnet cost from token counts", () => {
    // 1M input * $3 + 500k output * $15 = $3 + $7.5 = $10.5
    expect(computeCost("anthropic", "claude-sonnet-4-6", 1_000_000, 500_000)).toBeCloseTo(10.5, 6);
  });

  it("computes OpenAI gpt-4o-mini cost from token counts", () => {
    // 1M input * $0.15 + 1M output * $0.60 = $0.75
    expect(computeCost("openai", "gpt-4o-mini", 1_000_000, 1_000_000)).toBeCloseTo(0.75, 6);
  });

  it("computes Google gemini-1.5-pro cost from token counts", () => {
    // 100k input * $1.25/1M + 50k output * $5/1M = $0.125 + $0.25 = $0.375
    expect(computeCost("google", "gemini-1.5-pro", 100_000, 50_000)).toBeCloseTo(0.375, 6);
  });

  it("returns 0 for unknown model", () => {
    expect(computeCost("anthropic", "totally-made-up-model", 1000, 1000)).toBe(0);
  });

  it("returns 0 for zero tokens", () => {
    expect(computeCost("anthropic", "claude-sonnet-4-6", 0, 0)).toBe(0);
  });
});

describe("Meter", () => {
  it("records an event and reads it back", () => {
    const meter = new Meter();
    const event = meter.record({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      inputTokens: 1000,
      outputTokens: 500,
      latencyMs: 420,
    });

    expect(event.timestamp).toBeGreaterThan(0);
    expect(event.requestId).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
    expect(event.costUsd).toBeCloseTo((1000 * 3 + 500 * 15) / 1_000_000, 6);

    const stored = meter.getEvents();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toEqual(event);
  });

  it("respects user supplied timestamp, requestId, and costUsd", () => {
    const meter = new Meter();
    const event = meter.record({
      provider: "openai",
      model: "gpt-4o",
      inputTokens: 100,
      outputTokens: 50,
      latencyMs: 200,
      timestamp: 12345,
      requestId: "req_abc",
      costUsd: 0.99,
    });

    expect(event.timestamp).toBe(12345);
    expect(event.requestId).toBe("req_abc");
    expect(event.costUsd).toBe(0.99);
  });

  it("getEvents returns a copy, not the internal array", () => {
    const meter = new Meter();
    meter.record({
      provider: "anthropic",
      model: "claude-haiku-4-5",
      inputTokens: 10,
      outputTokens: 10,
      latencyMs: 10,
    });

    const snapshot = meter.getEvents();
    snapshot.pop();
    expect(meter.getEvents()).toHaveLength(1);
  });

  it("clear empties the meter", () => {
    const meter = new Meter();
    meter.record({
      provider: "google",
      model: "gemini-2.0-flash",
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
    });
    meter.clear();
    expect(meter.getEvents()).toHaveLength(0);
  });
});
