import { describe, expect, it } from "vitest";
import type { MeterEvent } from "../types.js";
import { MemoryStorage } from "./memory.js";

function makeEvent(overrides: Partial<MeterEvent> = {}): MeterEvent {
  return {
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    inputTokens: 1,
    outputTokens: 1,
    latencyMs: 1,
    costUsd: 0,
    timestamp: 1000,
    requestId: "req",
    ...overrides,
  };
}

describe("MemoryStorage", () => {
  it("appends and queries events", async () => {
    const storage = new MemoryStorage();
    await storage.append(makeEvent({ requestId: "a" }));
    await storage.append(makeEvent({ requestId: "b" }));

    const events = await storage.query();
    expect(events).toHaveLength(2);
  });

  it("filters by from", async () => {
    const storage = new MemoryStorage();
    await storage.append(makeEvent({ timestamp: 100 }));
    await storage.append(makeEvent({ timestamp: 500 }));

    expect(await storage.query({ from: 200 })).toHaveLength(1);
  });

  it("filters by to", async () => {
    const storage = new MemoryStorage();
    await storage.append(makeEvent({ timestamp: 100 }));
    await storage.append(makeEvent({ timestamp: 500 }));

    expect(await storage.query({ to: 200 })).toHaveLength(1);
  });

  it("filters by from and to combined", async () => {
    const storage = new MemoryStorage();
    await storage.append(makeEvent({ timestamp: 100 }));
    await storage.append(makeEvent({ timestamp: 500 }));
    await storage.append(makeEvent({ timestamp: 900 }));

    expect(await storage.query({ from: 200, to: 800 })).toHaveLength(1);
  });

  it("clears events", async () => {
    const storage = new MemoryStorage();
    await storage.append(makeEvent());
    await storage.clear();
    expect(await storage.query()).toHaveLength(0);
  });

  it("evict removes events older than the cutoff", async () => {
    const storage = new MemoryStorage();
    await storage.append(makeEvent({ requestId: "old", timestamp: 100 }));
    await storage.append(makeEvent({ requestId: "new", timestamp: 500 }));

    const removed = await storage.evict(200);
    expect(removed).toBe(1);
    expect((await storage.query()).map((e) => e.requestId)).toEqual(["new"]);
  });

  it("query returns a fresh array, mutation does not affect store", async () => {
    const storage = new MemoryStorage();
    await storage.append(makeEvent());

    const snapshot = await storage.query();
    snapshot.pop();

    expect(await storage.query()).toHaveLength(1);
  });
});
