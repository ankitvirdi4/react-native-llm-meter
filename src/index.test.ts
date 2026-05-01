import { afterEach, describe, expect, it, vi } from "vitest";
import { PRICING } from "./pricing/table.js";
import { Meter, VERSION, computeCost } from "./index.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("VERSION", () => {
  it("matches package version", () => {
    expect(VERSION).toBe("0.2.1");
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

describe("computeCost with cache", () => {
  it("adds cache read cost at 0.1x input rate by default", () => {
    // Sonnet input is $3 per 1M. Cache read = $0.30 per 1M.
    // 100k regular + 1M cache reads = 100k*3 + 1M*0.3 = 300k + 300k = 600k = $0.60
    expect(
      computeCost("anthropic", "claude-sonnet-4-6", 100_000, 0, {
        cacheReadInputTokens: 1_000_000,
      }),
    ).toBeCloseTo(0.6, 6);
  });

  it("adds cache create cost at 1.25x input rate by default", () => {
    // 100k regular at $3/1M + 100k cache creates at $3.75/1M
    // = 100_000 * 3 + 100_000 * 3.75 = 300_000 + 375_000 = 675_000
    // / 1M = $0.675
    expect(
      computeCost("anthropic", "claude-sonnet-4-6", 100_000, 0, {
        cacheCreationInputTokens: 100_000,
      }),
    ).toBeCloseTo(0.675, 6);
  });

  it("returns 0 for unknown model regardless of cache extras", () => {
    expect(
      computeCost("anthropic", "totally-made-up", 100, 100, {
        cacheReadInputTokens: 1000,
      }),
    ).toBe(0);
  });
});

describe("generateId", () => {
  it("uses crypto.randomUUID when available", async () => {
    const meter = new Meter();
    const event = meter.record({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
    });
    await meter.flush();
    // Node 18+ has globalThis.crypto.randomUUID. Result is a UUID v4.
    expect(event.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("falls back to a non UUID id when crypto.randomUUID is missing", async () => {
    const original = globalThis.crypto;
    Object.defineProperty(globalThis, "crypto", {
      value: { ...original, randomUUID: undefined },
      configurable: true,
    });
    try {
      const meter = new Meter();
      const event = meter.record({
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        inputTokens: 1,
        outputTokens: 1,
        latencyMs: 1,
      });
      await meter.flush();
      expect(event.requestId).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
    } finally {
      Object.defineProperty(globalThis, "crypto", {
        value: original,
        configurable: true,
      });
    }
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
    expect(event.requestId.length).toBeGreaterThan(0);
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

  it("summary returns flat aggregation", async () => {
    const meter = new Meter();
    meter.record({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      inputTokens: 1000,
      outputTokens: 500,
      latencyMs: 200,
      ttftMs: 80,
    });
    meter.record({
      provider: "openai",
      model: "gpt-4o-mini",
      inputTokens: 500,
      outputTokens: 100,
      latencyMs: 150,
    });
    await meter.flush();

    const s = await meter.summary();
    expect(s.count).toBe(2);
    expect(s.inputTokens).toBe(1500);
    expect(s.outputTokens).toBe(600);
    expect(s.totalTokens).toBe(2100);
    expect(s.byModel).toBeUndefined();
  });

  it("summary with groupBy returns nested aggregations", async () => {
    const meter = new Meter();
    meter.record({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      inputTokens: 100,
      outputTokens: 50,
      latencyMs: 100,
      tags: { userId: "alice" },
    });
    meter.record({
      provider: "openai",
      model: "gpt-4o-mini",
      inputTokens: 50,
      outputTokens: 25,
      latencyMs: 80,
      tags: { userId: "bob" },
    });
    await meter.flush();

    const s = await meter.summary({
      groupBy: ["model", "provider", "day", { tag: "userId" }],
    });
    expect(s.byModel?.["claude-sonnet-4-6"].count).toBe(1);
    expect(s.byModel?.["gpt-4o-mini"].count).toBe(1);
    expect(s.byProvider?.anthropic.count).toBe(1);
    expect(s.byProvider?.openai.count).toBe(1);
    expect(Object.keys(s.byDay ?? {})).toHaveLength(1);
    expect(s.byTag?.userId.alice.count).toBe(1);
    expect(s.byTag?.userId.bob.count).toBe(1);
  });

  it("summary accepts a single GroupBy without an array", async () => {
    const meter = new Meter();
    meter.record({
      provider: "anthropic",
      model: "claude-haiku-4-5",
      inputTokens: 10,
      outputTokens: 5,
      latencyMs: 20,
    });
    await meter.flush();

    const s = await meter.summary({ groupBy: "model" });
    expect(s.byModel?.["claude-haiku-4-5"].count).toBe(1);
    expect(s.byProvider).toBeUndefined();
  });

  it("summary respects from and to range", async () => {
    const meter = new Meter();
    meter.record({
      provider: "anthropic",
      model: "claude-haiku-4-5",
      inputTokens: 10,
      outputTokens: 5,
      latencyMs: 20,
      timestamp: 1000,
    });
    meter.record({
      provider: "anthropic",
      model: "claude-haiku-4-5",
      inputTokens: 10,
      outputTokens: 5,
      latencyMs: 20,
      timestamp: 5000,
    });
    await meter.flush();

    const s = await meter.summary({ from: 2000, to: 6000 });
    expect(s.count).toBe(1);
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
