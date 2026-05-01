import { afterEach, describe, expect, it, vi } from "vitest";
import { PRICING } from "./pricing/table.js";
import { Meter, VERSION, computeCost } from "./index.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("VERSION", () => {
  it("matches package version", () => {
    expect(VERSION).toBe("0.1.3");
  });
});

describe("pricing breadth", () => {
  it("covers at least 10 Anthropic models", () => {
    expect(Object.keys(PRICING.anthropic).length).toBeGreaterThanOrEqual(10);
  });
  it("covers at least 10 OpenAI models", () => {
    expect(Object.keys(PRICING.openai).length).toBeGreaterThanOrEqual(10);
  });
  it("covers at least 10 Google models", () => {
    expect(Object.keys(PRICING.google).length).toBeGreaterThanOrEqual(10);
  });
  it("every entry has positive input and output prices", () => {
    for (const provider of Object.keys(PRICING) as Array<keyof typeof PRICING>) {
      for (const [model, price] of Object.entries(PRICING[provider])) {
        expect(price.input, `${provider}:${model}.input`).toBeGreaterThan(0);
        expect(price.output, `${provider}:${model}.output`).toBeGreaterThan(0);
      }
    }
  });
});

describe("computeCost", () => {
  it("computes Anthropic Sonnet cost from token counts", () => {
    expect(computeCost("anthropic", "claude-sonnet-4-6", 1_000_000, 500_000)).toBeCloseTo(10.5, 6);
  });

  it("computes OpenAI gpt-4o-mini cost from token counts", () => {
    expect(computeCost("openai", "gpt-4o-mini", 1_000_000, 1_000_000)).toBeCloseTo(0.75, 6);
  });

  it("computes Google gemini-1.5-pro cost from token counts", () => {
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
  it("records an event and reads it back", async () => {
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

    await meter.flush();
    const stored = await meter.getEvents();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toEqual(event);
  });

  it("respects user supplied timestamp, requestId, and costUsd", async () => {
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

  it("getEvents returns a fresh array on each call", async () => {
    const meter = new Meter();
    meter.record({
      provider: "anthropic",
      model: "claude-haiku-4-5",
      inputTokens: 10,
      outputTokens: 10,
      latencyMs: 10,
    });
    await meter.flush();

    const snapshot = await meter.getEvents();
    snapshot.pop();
    expect(await meter.getEvents()).toHaveLength(1);
  });

  it("clear empties the meter", async () => {
    const meter = new Meter();
    meter.record({
      provider: "google",
      model: "gemini-2.0-flash",
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
    });
    await meter.flush();
    await meter.clear();
    expect(await meter.getEvents()).toHaveLength(0);
  });

  it("filters getEvents by from/to range", async () => {
    const meter = new Meter();
    meter.record({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
      timestamp: 1000,
    });
    meter.record({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
      timestamp: 2000,
    });
    meter.record({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
      timestamp: 3000,
    });
    await meter.flush();

    expect(await meter.getEvents({ from: 1500, to: 2500 })).toHaveLength(1);
    expect(await meter.getEvents({ from: 1500 })).toHaveLength(2);
    expect(await meter.getEvents({ to: 2500 })).toHaveLength(2);
  });

  it("flush awaits pending storage writes", async () => {
    let resolveAppend: (() => void) | undefined;
    const slowStorage = {
      async append() {
        await new Promise<void>((resolve) => {
          resolveAppend = resolve;
        });
      },
      async query() {
        return [];
      },
      async clear() {},
    };

    const meter = new Meter({ storage: slowStorage });
    meter.record({
      provider: "anthropic",
      model: "claude-haiku-4-5",
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
    });

    let flushed = false;
    const flushPromise = meter.flush().then(() => {
      flushed = true;
    });
    expect(flushed).toBe(false);
    resolveAppend?.();
    await flushPromise;
    expect(flushed).toBe(true);
  });

  it("invokes onError when storage append fails", async () => {
    const failure = new Error("disk full");
    const errors: unknown[] = [];
    const meter = new Meter({
      storage: {
        async append() {
          throw failure;
        },
        async query() {
          return [];
        },
        async clear() {},
      },
      onError: (err) => errors.push(err),
    });

    meter.record({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
    });
    await meter.flush();

    expect(errors).toEqual([failure]);
  });

  it("subscribe fires after storage commits, can be unsubscribed", async () => {
    const meter = new Meter();
    const received: string[] = [];

    const unsubscribe = meter.subscribe((e) => received.push(e.requestId));
    meter.record({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
      requestId: "first",
    });
    await meter.flush();
    expect(received).toEqual(["first"]);

    unsubscribe();
    meter.record({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
      requestId: "second",
    });
    await meter.flush();
    expect(received).toEqual(["first"]);
  });

  it("subscribe supports multiple listeners and swallows listener errors", async () => {
    const meter = new Meter();
    const a: string[] = [];
    const b: string[] = [];

    meter.subscribe((e) => a.push(e.requestId));
    meter.subscribe(() => {
      throw new Error("listener boom");
    });
    meter.subscribe((e) => b.push(e.requestId));

    meter.record({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
      requestId: "x",
    });
    await meter.flush();

    expect(a).toEqual(["x"]);
    expect(b).toEqual(["x"]);
  });

  it("warns once per unknown (provider, model) pair via onUnknownModel", async () => {
    const warnings: Array<[string, string]> = [];
    const meter = new Meter({
      onUnknownModel: (provider, model) => warnings.push([provider, model]),
    });

    meter.record({
      provider: "anthropic",
      model: "claude-future-99",
      inputTokens: 100,
      outputTokens: 50,
      latencyMs: 100,
    });
    meter.record({
      provider: "anthropic",
      model: "claude-future-99",
      inputTokens: 100,
      outputTokens: 50,
      latencyMs: 100,
    });
    await meter.flush();

    expect(warnings).toEqual([["anthropic", "claude-future-99"]]);
  });

  it("warns separately for distinct unknown models", async () => {
    const warnings: Array<[string, string]> = [];
    const meter = new Meter({
      onUnknownModel: (provider, model) => warnings.push([provider, model]),
    });

    meter.record({
      provider: "openai",
      model: "gpt-future",
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
    });
    meter.record({
      provider: "google",
      model: "gemini-future",
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
    });
    await meter.flush();

    expect(warnings).toEqual([
      ["openai", "gpt-future"],
      ["google", "gemini-future"],
    ]);
  });

  it("does not warn for a known model", async () => {
    const warnings: Array<[string, string]> = [];
    const meter = new Meter({
      onUnknownModel: (provider, model) => warnings.push([provider, model]),
    });

    meter.record({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
    });
    await meter.flush();

    expect(warnings).toEqual([]);
  });

  it("does not warn when the user supplies costUsd directly", async () => {
    const warnings: Array<[string, string]> = [];
    const meter = new Meter({
      onUnknownModel: (provider, model) => warnings.push([provider, model]),
    });

    meter.record({
      provider: "anthropic",
      model: "claude-future-99",
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
      costUsd: 0.0042,
    });
    await meter.flush();

    expect(warnings).toEqual([]);
  });

  it("default handler logs to console.warn", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const meter = new Meter();

    meter.record({
      provider: "openai",
      model: "gpt-totally-new",
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
    });
    await meter.flush();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/Unknown model "gpt-totally-new"/);
  });

  it("swallows onUnknownModel handler errors", async () => {
    const meter = new Meter({
      onUnknownModel: () => {
        throw new Error("handler boom");
      },
    });

    expect(() =>
      meter.record({
        provider: "anthropic",
        model: "claude-future-99",
        inputTokens: 1,
        outputTokens: 1,
        latencyMs: 1,
      }),
    ).not.toThrow();
    await meter.flush();
  });

  it("swallows storage errors silently when no onError given", async () => {
    const meter = new Meter({
      storage: {
        async append() {
          throw new Error("boom");
        },
        async query() {
          return [];
        },
        async clear() {},
      },
    });

    meter.record({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
    });

    await expect(meter.flush()).resolves.toBeUndefined();
  });
});
