import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MeterEvent } from "../types.js";
import {
  AsyncStorageAdapter,
  type AsyncStorageLike,
} from "./async-storage.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function makeEvent(overrides: Partial<MeterEvent> = {}): MeterEvent {
  return {
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    inputTokens: 1,
    outputTokens: 1,
    latencyMs: 1,
    costUsd: 0,
    timestamp: Date.parse("2026-05-01T12:00:00Z"),
    requestId: "req",
    ...overrides,
  };
}

function makeFakeAsyncStorage(): AsyncStorageLike & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async getItem(key) {
      return store.get(key) ?? null;
    },
    async setItem(key, value) {
      store.set(key, value);
    },
    async removeItem(key) {
      store.delete(key);
    },
    async getAllKeys() {
      return Array.from(store.keys());
    },
    async multiRemove(keys) {
      for (const k of keys) store.delete(k);
    },
  };
}

describe("AsyncStorageAdapter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("appends and queries an event roundtrip", async () => {
    const fake = makeFakeAsyncStorage();
    const adapter = new AsyncStorageAdapter({ asyncStorage: fake });

    await adapter.append(makeEvent({ requestId: "a" }));
    const events = await adapter.query();

    expect(events).toHaveLength(1);
    expect(events[0].requestId).toBe("a");
  });

  it("groups events into day buckets by UTC date", async () => {
    const fake = makeFakeAsyncStorage();
    const adapter = new AsyncStorageAdapter({ asyncStorage: fake });

    await adapter.append(makeEvent({
      timestamp: Date.parse("2026-05-01T23:59:00Z"),
      requestId: "may1",
    }));
    await adapter.append(makeEvent({
      timestamp: Date.parse("2026-05-02T00:00:01Z"),
      requestId: "may2",
    }));

    const keys = await fake.getAllKeys();
    expect(keys).toContain("llm-meter:events:2026-05-01");
    expect(keys).toContain("llm-meter:events:2026-05-02");
  });

  it("query returns events sorted by timestamp ascending", async () => {
    const fake = makeFakeAsyncStorage();
    const adapter = new AsyncStorageAdapter({ asyncStorage: fake });

    await adapter.append(makeEvent({ timestamp: Date.parse("2026-05-01T10:00:00Z"), requestId: "second" }));
    await adapter.append(makeEvent({ timestamp: Date.parse("2026-05-01T08:00:00Z"), requestId: "first" }));

    const events = await adapter.query();
    expect(events.map((e) => e.requestId)).toEqual(["first", "second"]);
  });

  it("query filters by from and to", async () => {
    const fake = makeFakeAsyncStorage();
    const adapter = new AsyncStorageAdapter({ asyncStorage: fake });

    await adapter.append(makeEvent({ timestamp: Date.parse("2026-05-01T08:00:00Z"), requestId: "early" }));
    await adapter.append(makeEvent({ timestamp: Date.parse("2026-05-01T12:00:00Z"), requestId: "mid" }));
    await adapter.append(makeEvent({ timestamp: Date.parse("2026-05-01T18:00:00Z"), requestId: "late" }));

    const events = await adapter.query({
      from: Date.parse("2026-05-01T10:00:00Z"),
      to: Date.parse("2026-05-01T15:00:00Z"),
    });

    expect(events.map((e) => e.requestId)).toEqual(["mid"]);
  });

  it("clears only its own keys, leaving unrelated keys", async () => {
    const fake = makeFakeAsyncStorage();
    fake.store.set("unrelated:foo", "bar");
    const adapter = new AsyncStorageAdapter({ asyncStorage: fake });

    await adapter.append(makeEvent());
    await adapter.clear();

    const keys = await fake.getAllKeys();
    expect(keys).toEqual(["unrelated:foo"]);
  });

  it("clear is a noop when no keys exist", async () => {
    const fake = makeFakeAsyncStorage();
    const adapter = new AsyncStorageAdapter({ asyncStorage: fake });
    const spy = vi.spyOn(fake, "multiRemove");

    await adapter.clear();
    expect(spy).not.toHaveBeenCalled();
  });

  it("evicts buckets older than the cutoff", async () => {
    const fake = makeFakeAsyncStorage();
    const adapter = new AsyncStorageAdapter({ asyncStorage: fake, retentionDays: 100 });

    await adapter.append(makeEvent({ timestamp: Date.parse("2026-04-01T00:00:00Z"), requestId: "old" }));
    await adapter.append(makeEvent({ timestamp: Date.parse("2026-05-01T00:00:00Z"), requestId: "new" }));

    const removed = await adapter.evict(Date.parse("2026-04-15T00:00:00Z"));
    expect(removed).toBe(1);

    const events = await adapter.query();
    expect(events.map((e) => e.requestId)).toEqual(["new"]);
  });

  it("auto-evicts on query based on retentionDays", async () => {
    const fake = makeFakeAsyncStorage();
    const adapter = new AsyncStorageAdapter({ asyncStorage: fake, retentionDays: 30 });

    const old = Date.parse("2026-05-01T12:00:00Z") - 60 * DAY_MS;
    await adapter.append(makeEvent({ timestamp: old, requestId: "old" }));
    await adapter.append(makeEvent({ requestId: "new" }));

    const events = await adapter.query();
    expect(events.map((e) => e.requestId)).toEqual(["new"]);

    const keys = await fake.getAllKeys();
    expect(keys).toEqual(["llm-meter:events:2026-05-01"]);
  });

  it("uses a custom keyPrefix when provided", async () => {
    const fake = makeFakeAsyncStorage();
    const adapter = new AsyncStorageAdapter({ asyncStorage: fake, keyPrefix: "myapp:" });

    await adapter.append(makeEvent());

    const keys = await fake.getAllKeys();
    expect(keys[0]).toMatch(/^myapp:/);
  });

  it("serializes concurrent appends to the same bucket without losing updates", async () => {
    const fake = makeFakeAsyncStorage();
    const adapter = new AsyncStorageAdapter({ asyncStorage: fake });

    const promises: Promise<void>[] = [];
    for (let i = 0; i < 20; i++) {
      promises.push(adapter.append(makeEvent({ requestId: `r${i}` })));
    }
    await Promise.all(promises);

    const events = await adapter.query();
    expect(events).toHaveLength(20);
    const ids = new Set(events.map((e) => e.requestId));
    for (let i = 0; i < 20; i++) {
      expect(ids.has(`r${i}`)).toBe(true);
    }
  });

  it("query returns empty for fresh store", async () => {
    const fake = makeFakeAsyncStorage();
    const adapter = new AsyncStorageAdapter({ asyncStorage: fake });

    expect(await adapter.query()).toEqual([]);
  });

  it("ignores buckets that contain null after eviction race", async () => {
    const fake = makeFakeAsyncStorage();
    fake.store.set("llm-meter:events:2026-05-01", "");
    const adapter = new AsyncStorageAdapter({ asyncStorage: fake });

    expect(await adapter.query()).toEqual([]);
  });

  it("treats a corrupted bucket as empty rather than throwing on append", async () => {
    const fake = makeFakeAsyncStorage();
    fake.store.set("llm-meter:events:2026-05-01", "{not json");
    const adapter = new AsyncStorageAdapter({ asyncStorage: fake });

    await adapter.append(makeEvent({ requestId: "fresh" }));
    const events = await adapter.query();
    expect(events.map((e) => e.requestId)).toEqual(["fresh"]);
  });

  it("treats a non-array bucket as empty on query", async () => {
    const fake = makeFakeAsyncStorage();
    fake.store.set("llm-meter:events:2026-05-01", '{"oops":true}');
    const adapter = new AsyncStorageAdapter({ asyncStorage: fake });

    expect(await adapter.query()).toEqual([]);
  });
});
