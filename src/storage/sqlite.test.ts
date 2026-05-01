import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { MeterEvent } from "../types.js";
import { AsyncStorageAdapter, type AsyncStorageLike } from "./async-storage.js";
import { MemoryStorage } from "./memory.js";
import {
  SqliteAdapter,
  type SqliteDatabaseLike,
  type SqliteParams,
} from "./sqlite.js";

function makeBetterSqliteDb(opts: { withTransaction?: boolean } = {}): SqliteDatabaseLike {
  const db = new Database(":memory:");
  const wrap = (params?: SqliteParams) => (params ? Array.from(params) : []);
  const adapter: SqliteDatabaseLike = {
    async execAsync(sql) {
      db.exec(sql);
    },
    async runAsync(sql, params) {
      db.prepare(sql).run(...wrap(params));
    },
    async getAllAsync(sql, params) {
      return db.prepare(sql).all(...wrap(params)) as never;
    },
  };
  if (opts.withTransaction !== false) {
    adapter.withTransactionAsync = async (fn) => {
      db.exec("BEGIN");
      try {
        await fn();
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    };
  }
  return adapter;
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

function makeEvent(overrides: Partial<MeterEvent> = {}): MeterEvent {
  return {
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    inputTokens: 100,
    outputTokens: 50,
    latencyMs: 200,
    costUsd: 0.001,
    timestamp: 1_000_000,
    requestId: `req-${Math.random().toString(36).slice(2, 10)}`,
    ...overrides,
  };
}

describe("SqliteAdapter", () => {
  it("appends and queries an event roundtrip", async () => {
    const adapter = new SqliteAdapter({ db: makeBetterSqliteDb() });
    await adapter.append(makeEvent({ requestId: "a" }));
    const events = await adapter.query();

    expect(events).toHaveLength(1);
    expect(events[0].requestId).toBe("a");
  });

  it("returns events sorted by timestamp ascending", async () => {
    const adapter = new SqliteAdapter({ db: makeBetterSqliteDb() });
    await adapter.append(makeEvent({ requestId: "second", timestamp: 2000 }));
    await adapter.append(makeEvent({ requestId: "first", timestamp: 1000 }));
    await adapter.append(makeEvent({ requestId: "third", timestamp: 3000 }));

    const events = await adapter.query();
    expect(events.map((e) => e.requestId)).toEqual(["first", "second", "third"]);
  });

  it("filters by from and to range", async () => {
    const adapter = new SqliteAdapter({ db: makeBetterSqliteDb() });
    await adapter.append(makeEvent({ requestId: "a", timestamp: 100 }));
    await adapter.append(makeEvent({ requestId: "b", timestamp: 500 }));
    await adapter.append(makeEvent({ requestId: "c", timestamp: 900 }));

    expect((await adapter.query({ from: 200, to: 800 })).map((e) => e.requestId)).toEqual(["b"]);
    expect((await adapter.query({ from: 200 })).map((e) => e.requestId)).toEqual(["b", "c"]);
    expect((await adapter.query({ to: 800 })).map((e) => e.requestId)).toEqual(["a", "b"]);
  });

  it("clears all events", async () => {
    const adapter = new SqliteAdapter({ db: makeBetterSqliteDb() });
    await adapter.append(makeEvent());
    await adapter.clear();
    expect(await adapter.query()).toEqual([]);
  });

  it("init runs once and is idempotent across many calls", async () => {
    const db = makeBetterSqliteDb();
    let execCount = 0;
    const original = db.execAsync.bind(db);
    db.execAsync = async (sql) => {
      execCount++;
      return original(sql);
    };

    const adapter = new SqliteAdapter({ db });
    await Promise.all([
      adapter.append(makeEvent({ requestId: "a" })),
      adapter.append(makeEvent({ requestId: "b" })),
      adapter.query(),
    ]);

    // Init should issue 4 exec calls (one CREATE TABLE + three CREATE INDEX) only once.
    expect(execCount).toBe(4);
  });

  it("upserts on duplicate requestId via INSERT OR REPLACE", async () => {
    const adapter = new SqliteAdapter({ db: makeBetterSqliteDb() });
    await adapter.append(makeEvent({ requestId: "same", inputTokens: 1 }));
    await adapter.append(makeEvent({ requestId: "same", inputTokens: 999 }));

    const events = await adapter.query();
    expect(events).toHaveLength(1);
    expect(events[0].inputTokens).toBe(999);
  });

  it("roundtrips events with and without ttftMs", async () => {
    const adapter = new SqliteAdapter({ db: makeBetterSqliteDb() });
    await adapter.append(makeEvent({ requestId: "stream", ttftMs: 80 }));
    await adapter.append(makeEvent({ requestId: "non-stream" }));

    const events = await adapter.query();
    const stream = events.find((e) => e.requestId === "stream");
    const nonStream = events.find((e) => e.requestId === "non-stream");

    expect(stream?.ttftMs).toBe(80);
    expect(nonStream?.ttftMs).toBeUndefined();
  });

  it("migrates an older schema by adding the ttft_ms column", async () => {
    // Simulate a v0.1.x database that predates ttft_ms.
    const db = makeBetterSqliteDb();
    await db.execAsync(
      `CREATE TABLE llm_meter_events (
         request_id TEXT PRIMARY KEY,
         provider TEXT NOT NULL,
         model TEXT NOT NULL,
         input_tokens INTEGER NOT NULL,
         output_tokens INTEGER NOT NULL,
         latency_ms INTEGER NOT NULL,
         cost_usd REAL NOT NULL,
         timestamp INTEGER NOT NULL
       )`,
    );
    await db.runAsync(
      `INSERT INTO llm_meter_events VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ["legacy-1", "anthropic", "claude-haiku-4-5", 10, 5, 100, 0, 1000],
    );

    const adapter = new SqliteAdapter({ db });
    // Trigger init via a query.
    const events = await adapter.query();

    // Existing row preserved with ttftMs undefined.
    expect(events).toHaveLength(1);
    expect(events[0].requestId).toBe("legacy-1");
    expect(events[0].ttftMs).toBeUndefined();
    expect(events[0].cacheReadInputTokens).toBeUndefined();
    expect(events[0].cacheCreationInputTokens).toBeUndefined();

    // New writes set the new columns successfully.
    await adapter.append(
      makeEvent({
        requestId: "fresh",
        ttftMs: 42,
        cacheReadInputTokens: 100,
        cacheCreationInputTokens: 50,
      }),
    );
    const after = await adapter.query();
    const fresh = after.find((e) => e.requestId === "fresh");
    expect(fresh?.ttftMs).toBe(42);
    expect(fresh?.cacheReadInputTokens).toBe(100);
    expect(fresh?.cacheCreationInputTokens).toBe(50);
  });

  it("migrates a v0.1.2 schema by adding cache columns only", async () => {
    // Simulate a v0.1.2 / v0.1.3 database that has ttft_ms but no cache columns.
    const db = makeBetterSqliteDb();
    await db.execAsync(
      `CREATE TABLE llm_meter_events (
         request_id TEXT PRIMARY KEY,
         provider TEXT NOT NULL,
         model TEXT NOT NULL,
         input_tokens INTEGER NOT NULL,
         output_tokens INTEGER NOT NULL,
         latency_ms INTEGER NOT NULL,
         cost_usd REAL NOT NULL,
         timestamp INTEGER NOT NULL,
         ttft_ms INTEGER NULL
       )`,
    );

    const adapter = new SqliteAdapter({ db });
    await adapter.append(
      makeEvent({
        requestId: "post-migration",
        cacheReadInputTokens: 200,
      }),
    );
    const events = await adapter.query();
    expect(events[0].cacheReadInputTokens).toBe(200);
  });

  it("roundtrips events with tags", async () => {
    const adapter = new SqliteAdapter({ db: makeBetterSqliteDb() });
    await adapter.append(
      makeEvent({
        requestId: "tagged",
        tags: { userId: "u1", session: "s1" },
      }),
    );
    await adapter.append(makeEvent({ requestId: "untagged" }));

    const events = await adapter.query();
    const tagged = events.find((e) => e.requestId === "tagged");
    const untagged = events.find((e) => e.requestId === "untagged");

    expect(tagged?.tags).toEqual({ userId: "u1", session: "s1" });
    expect(untagged?.tags).toBeUndefined();
  });

  it("treats a corrupted tags JSON as absent", async () => {
    const db = makeBetterSqliteDb();
    const adapter = new SqliteAdapter({ db });
    await adapter.append(makeEvent({ requestId: "ok" }));
    // Manually corrupt the tags column.
    await db.runAsync(
      `UPDATE llm_meter_events SET tags = '{not json' WHERE request_id = ?`,
      ["ok"],
    );
    const events = await adapter.query();
    expect(events[0].tags).toBeUndefined();
  });

  it("supports a custom tableName", async () => {
    const db = makeBetterSqliteDb();
    const adapter = new SqliteAdapter({ db, tableName: "custom_table" });
    await adapter.append(makeEvent({ requestId: "x" }));

    const rows = await db.getAllAsync<{ count: number }>(
      "SELECT COUNT(*) as count FROM custom_table",
    );
    expect(rows[0].count).toBe(1);
  });
});

describe("SqliteAdapter migration", () => {
  it("migrates events from MemoryStorage without loss", async () => {
    const source = new MemoryStorage();
    for (let i = 0; i < 50; i++) {
      await source.append(makeEvent({ requestId: `r${i}`, timestamp: i }));
    }

    const adapter = new SqliteAdapter({ db: makeBetterSqliteDb() });
    const moved = await adapter.migrateFrom(source);

    expect(moved).toBe(50);
    const events = await adapter.query();
    expect(events).toHaveLength(50);
    expect((await source.query())).toHaveLength(50); // source untouched by default
  });

  it("migrates events from AsyncStorageAdapter and clears source when asked", async () => {
    const fakeStorage = makeFakeAsyncStorage();
    const source = new AsyncStorageAdapter({ asyncStorage: fakeStorage });
    for (let i = 0; i < 10; i++) {
      await source.append(
        makeEvent({
          requestId: `r${i}`,
          timestamp: Date.parse("2026-05-01T12:00:00Z") + i,
        }),
      );
    }

    const adapter = new SqliteAdapter({ db: makeBetterSqliteDb() });
    const moved = await adapter.migrateFrom(source, { clearSource: true });

    expect(moved).toBe(10);
    expect(await adapter.query()).toHaveLength(10);
    expect(await source.query()).toHaveLength(0);
  });

  it("returns 0 when source is empty, still clears source if asked", async () => {
    const source = new MemoryStorage();
    const adapter = new SqliteAdapter({ db: makeBetterSqliteDb() });

    expect(await adapter.migrateFrom(source, { clearSource: true })).toBe(0);
    expect(await adapter.query()).toEqual([]);
  });

  it("falls back to sequential inserts when withTransactionAsync is unavailable", async () => {
    const source = new MemoryStorage();
    for (let i = 0; i < 5; i++) {
      await source.append(makeEvent({ requestId: `r${i}`, timestamp: i }));
    }

    const adapter = new SqliteAdapter({
      db: makeBetterSqliteDb({ withTransaction: false }),
    });
    const moved = await adapter.migrateFrom(source);

    expect(moved).toBe(5);
    expect(await adapter.query()).toHaveLength(5);
  });
});

describe("SqliteAdapter performance", () => {
  // The product target is "under 50ms on a real device" (Phase 6 ROADMAP entry).
  // GitHub-hosted CI runners have variable JS perf, so we loosen the bound on
  // CI to 250ms. That still catches real regressions like falling off the
  // index into a full-table scan, which on 10k events would take seconds.
  const PERF_THRESHOLD_MS = process.env.CI ? 250 : 50;

  it(`queries 10k events in under ${PERF_THRESHOLD_MS}ms after seeding`, async () => {
    const adapter = new SqliteAdapter({ db: makeBetterSqliteDb() });

    const seedSource = new MemoryStorage();
    for (let i = 0; i < 10_000; i++) {
      await seedSource.append(makeEvent({ requestId: `r${i}`, timestamp: i }));
    }
    await adapter.migrateFrom(seedSource);

    const start = performance.now();
    const events = await adapter.query();
    const elapsed = performance.now() - start;

    expect(events).toHaveLength(10_000);
    expect(elapsed).toBeLessThan(PERF_THRESHOLD_MS);
  });

  it(`range queries 10k events in under ${PERF_THRESHOLD_MS}ms`, async () => {
    const adapter = new SqliteAdapter({ db: makeBetterSqliteDb() });

    const seedSource = new MemoryStorage();
    for (let i = 0; i < 10_000; i++) {
      await seedSource.append(makeEvent({ requestId: `r${i}`, timestamp: i }));
    }
    await adapter.migrateFrom(seedSource);

    const start = performance.now();
    const events = await adapter.query({ from: 5000, to: 7500 });
    const elapsed = performance.now() - start;

    expect(events.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(PERF_THRESHOLD_MS);
  });
});
