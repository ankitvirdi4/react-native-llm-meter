import type { MeterEvent, Provider } from "../types.js";
import type { QueryRange, Storage } from "./types.js";

export type SqliteParams = ReadonlyArray<string | number | null>;

export interface SqliteDatabaseLike {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params?: SqliteParams): Promise<unknown>;
  getAllAsync<T = unknown>(sql: string, params?: SqliteParams): Promise<T[]>;
  withTransactionAsync?(fn: () => Promise<void>): Promise<void>;
}

export interface SqliteAdapterOptions {
  db: SqliteDatabaseLike;
  tableName?: string;
}

interface EventRow {
  request_id: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  cost_usd: number;
  timestamp: number;
  ttft_ms: number | null;
}

interface ColumnInfo {
  name: string;
}

const DEFAULT_TABLE = "llm_meter_events";

function rowToEvent(row: EventRow): MeterEvent {
  const event: MeterEvent = {
    requestId: row.request_id,
    provider: row.provider as Provider,
    model: row.model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    latencyMs: row.latency_ms,
    costUsd: row.cost_usd,
    timestamp: row.timestamp,
  };
  if (row.ttft_ms !== null && row.ttft_ms !== undefined) {
    event.ttftMs = row.ttft_ms;
  }
  return event;
}

export class SqliteAdapter implements Storage {
  private readonly db: SqliteDatabaseLike;
  private readonly table: string;
  private initPromise: Promise<void> | null = null;

  constructor(opts: SqliteAdapterOptions) {
    this.db = opts.db;
    this.table = opts.tableName ?? DEFAULT_TABLE;
  }

  private init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.runInit();
    }
    return this.initPromise;
  }

  private async runInit(): Promise<void> {
    await this.db.execAsync(
      `CREATE TABLE IF NOT EXISTS ${this.table} (
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
    // Migrate older v0.1.x databases that predate the ttft_ms column.
    const cols = await this.db.getAllAsync<ColumnInfo>(
      `PRAGMA table_info(${this.table})`,
    );
    if (!cols.some((c) => c.name === "ttft_ms")) {
      await this.db.execAsync(
        `ALTER TABLE ${this.table} ADD COLUMN ttft_ms INTEGER NULL`,
      );
    }
    await this.db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_${this.table}_timestamp ON ${this.table}(timestamp)`,
    );
    await this.db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_${this.table}_model ON ${this.table}(model)`,
    );
    await this.db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_${this.table}_provider ON ${this.table}(provider)`,
    );
  }

  async append(event: MeterEvent): Promise<void> {
    await this.init();
    await this.db.runAsync(
      `INSERT OR REPLACE INTO ${this.table}
         (request_id, provider, model, input_tokens, output_tokens, latency_ms, cost_usd, timestamp, ttft_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.requestId,
        event.provider,
        event.model,
        event.inputTokens,
        event.outputTokens,
        event.latencyMs,
        event.costUsd,
        event.timestamp,
        event.ttftMs ?? null,
      ],
    );
  }

  async query(range?: QueryRange): Promise<MeterEvent[]> {
    await this.init();
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    if (range?.from !== undefined) {
      conditions.push("timestamp >= ?");
      params.push(range.from);
    }
    if (range?.to !== undefined) {
      conditions.push("timestamp <= ?");
      params.push(range.to);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = await this.db.getAllAsync<EventRow>(
      `SELECT * FROM ${this.table} ${where} ORDER BY timestamp ASC`,
      params,
    );
    return rows.map(rowToEvent);
  }

  async clear(): Promise<void> {
    await this.init();
    await this.db.execAsync(`DELETE FROM ${this.table}`);
  }

  async migrateFrom(
    other: Storage,
    opts: { clearSource?: boolean } = {},
  ): Promise<number> {
    await this.init();
    const events = await other.query();
    if (events.length === 0) {
      if (opts.clearSource) await other.clear();
      return 0;
    }

    if (this.db.withTransactionAsync) {
      await this.db.withTransactionAsync(async () => {
        for (const event of events) {
          await this.append(event);
        }
      });
    } else {
      for (const event of events) {
        await this.append(event);
      }
    }

    if (opts.clearSource) await other.clear();
    return events.length;
  }
}
