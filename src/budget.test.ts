import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AsyncStorageBudgetState,
  type BudgetCrossInfo,
  MemoryBudgetState,
  startOfUtcDay,
  startOfUtcMonth,
  startOfUtcWeek,
} from "./budget.js";
import { Meter } from "./meter.js";
import type { AsyncStorageLike } from "./storage/async-storage.js";

function makeFakeAsyncStorage(): AsyncStorageLike {
  const store = new Map<string, string>();
  return {
    async getItem(k) {
      return store.get(k) ?? null;
    },
    async setItem(k, v) {
      store.set(k, v);
    },
    async removeItem(k) {
      store.delete(k);
    },
    async getAllKeys() {
      return Array.from(store.keys());
    },
    async multiRemove(keys) {
      for (const k of keys) store.delete(k);
    },
  };
}

describe("UTC period helpers", () => {
  it("startOfUtcDay zeros the time portion", () => {
    expect(startOfUtcDay(Date.parse("2026-05-01T15:30:42Z"))).toBe(
      Date.parse("2026-05-01T00:00:00Z"),
    );
  });

  it("startOfUtcWeek snaps to Monday for any day in the week", () => {
    // 2026-05-01 is a Friday
    expect(startOfUtcWeek(Date.parse("2026-05-01T12:00:00Z"))).toBe(
      Date.parse("2026-04-27T00:00:00Z"),
    );
    // 2026-05-03 is a Sunday
    expect(startOfUtcWeek(Date.parse("2026-05-03T23:59:00Z"))).toBe(
      Date.parse("2026-04-27T00:00:00Z"),
    );
    // 2026-04-27 is a Monday
    expect(startOfUtcWeek(Date.parse("2026-04-27T00:00:00Z"))).toBe(
      Date.parse("2026-04-27T00:00:00Z"),
    );
  });

  it("startOfUtcMonth snaps to the first of the month", () => {
    expect(startOfUtcMonth(Date.parse("2026-05-15T08:00:00Z"))).toBe(
      Date.parse("2026-05-01T00:00:00Z"),
    );
  });
});

describe("MemoryBudgetState", () => {
  it("returns null for unset period and stores values", async () => {
    const state = new MemoryBudgetState();
    expect(await state.get("day")).toBeNull();
    await state.set("day", 42);
    expect(await state.get("day")).toBe(42);
  });
});

describe("AsyncStorageBudgetState", () => {
  it("persists timestamps via the AsyncStorage interface", async () => {
    const fake = makeFakeAsyncStorage();
    const state = new AsyncStorageBudgetState({ asyncStorage: fake });

    expect(await state.get("week")).toBeNull();
    await state.set("week", 12345);
    expect(await state.get("week")).toBe(12345);
  });

  it("returns null for malformed stored values", async () => {
    const fake = makeFakeAsyncStorage();
    await fake.setItem("llm-meter:budget:day", "not-a-number");
    const state = new AsyncStorageBudgetState({ asyncStorage: fake });
    expect(await state.get("day")).toBeNull();
  });

  it("respects custom keyPrefix", async () => {
    const fake = makeFakeAsyncStorage();
    const state = new AsyncStorageBudgetState({
      asyncStorage: fake,
      keyPrefix: "myapp:",
    });
    await state.set("day", 99);
    expect(await fake.getItem("myapp:day")).toBe("99");
  });
});

describe("setBudget", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-01T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires daily callback exactly once per day when threshold is crossed", async () => {
    const meter = new Meter();
    const calls: BudgetCrossInfo[] = [];
    const detach = meter.setBudget({
      daily: 0.005,
      onCross: (info) => calls.push(info),
    });

    // Each call: 1000 * 3 + 200 * 15 = 6000 / 1M = 0.006
    meter.record({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      inputTokens: 1000,
      outputTokens: 200,
      latencyMs: 100,
    });
    await meter.flush();

    expect(calls).toHaveLength(1);
    expect(calls[0].period).toBe("day");
    expect(calls[0].threshold).toBe(0.005);
    expect(calls[0].spend).toBeCloseTo(0.006, 6);

    // Second event same day: should not refire
    meter.record({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      inputTokens: 1000,
      outputTokens: 200,
      latencyMs: 100,
    });
    await meter.flush();
    expect(calls).toHaveLength(1);

    detach();
  });

  it("fires again on the next day when threshold is crossed again", async () => {
    const meter = new Meter();
    const calls: BudgetCrossInfo[] = [];
    meter.setBudget({
      daily: 0.001,
      onCross: (info) => calls.push(info),
    });

    meter.record({
      provider: "anthropic",
      model: "claude-haiku-4-5",
      inputTokens: 1000,
      outputTokens: 1000,
      latencyMs: 100,
    });
    await meter.flush();
    expect(calls).toHaveLength(1);

    // Advance to next UTC day
    vi.setSystemTime(new Date("2026-05-02T12:00:00Z"));

    meter.record({
      provider: "anthropic",
      model: "claude-haiku-4-5",
      inputTokens: 1000,
      outputTokens: 1000,
      latencyMs: 100,
    });
    await meter.flush();
    expect(calls).toHaveLength(2);
  });

  it("persists fired state via AsyncStorageBudgetState across reload", async () => {
    const fake = makeFakeAsyncStorage();
    const meter = new Meter();
    const state = new AsyncStorageBudgetState({ asyncStorage: fake });
    const callsA: BudgetCrossInfo[] = [];

    meter.setBudget({
      daily: 0.001,
      state,
      onCross: (info) => callsA.push(info),
    });

    meter.record({
      provider: "anthropic",
      model: "claude-haiku-4-5",
      inputTokens: 500,
      outputTokens: 500,
      latencyMs: 100,
    });
    await meter.flush();
    expect(callsA).toHaveLength(1);

    // Simulate reload: new Meter, new watcher, same state store, same day
    const meterB = new Meter();
    // seed meterB with the prior event so today's spend is still over threshold
    meterB.record({
      provider: "anthropic",
      model: "claude-haiku-4-5",
      inputTokens: 500,
      outputTokens: 500,
      latencyMs: 100,
    });
    await meterB.flush();

    const callsB: BudgetCrossInfo[] = [];
    meterB.setBudget({
      daily: 0.001,
      state,
      onCross: (info) => callsB.push(info),
    });

    meterB.record({
      provider: "anthropic",
      model: "claude-haiku-4-5",
      inputTokens: 100,
      outputTokens: 100,
      latencyMs: 50,
    });
    await meterB.flush();

    expect(callsB).toHaveLength(0);
  });

  it("supports multiple thresholds (daily, weekly, monthly)", async () => {
    const meter = new Meter();
    const calls: BudgetCrossInfo[] = [];

    meter.setBudget({
      daily: 0.001,
      weekly: 0.002,
      monthly: 0.003,
      onCross: (info) => calls.push(info),
    });

    // 0.006 cost crosses all three on a single event
    meter.record({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      inputTokens: 1000,
      outputTokens: 200,
      latencyMs: 100,
    });
    await meter.flush();

    const periods = calls.map((c) => c.period).sort();
    expect(periods).toEqual(["day", "month", "week"]);
  });

  it("does not fire when no threshold is crossed", async () => {
    const meter = new Meter();
    const calls: BudgetCrossInfo[] = [];
    meter.setBudget({
      daily: 1000,
      onCross: (info) => calls.push(info),
    });

    meter.record({
      provider: "anthropic",
      model: "claude-haiku-4-5",
      inputTokens: 10,
      outputTokens: 5,
      latencyMs: 50,
    });
    await meter.flush();

    expect(calls).toEqual([]);
  });

  it("swallows callback errors so recording stays healthy", async () => {
    const meter = new Meter();
    meter.setBudget({
      daily: 0.001,
      onCross: () => {
        throw new Error("user callback boom");
      },
    });

    expect(() => {
      meter.record({
        provider: "anthropic",
        model: "claude-haiku-4-5",
        inputTokens: 1000,
        outputTokens: 1000,
        latencyMs: 100,
      });
    }).not.toThrow();

    await meter.flush();
  });

  it("detach stops the watcher", async () => {
    const meter = new Meter();
    const calls: BudgetCrossInfo[] = [];
    const detach = meter.setBudget({
      daily: 0.001,
      onCross: (info) => calls.push(info),
    });

    detach();

    meter.record({
      provider: "anthropic",
      model: "claude-haiku-4-5",
      inputTokens: 1000,
      outputTokens: 1000,
      latencyMs: 100,
    });
    await meter.flush();

    expect(calls).toEqual([]);
  });
});
