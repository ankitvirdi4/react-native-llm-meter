import type { MeterEvent } from "../types.js";
import type { QueryRange, Storage } from "./types.js";

export interface AsyncStorageLike {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
  multiRemove(keys: readonly string[]): Promise<void>;
}

export interface AsyncStorageAdapterOptions {
  asyncStorage: AsyncStorageLike;
  retentionDays?: number;
  keyPrefix?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PREFIX = "llm-meter:events:";
const DEFAULT_RETENTION_DAYS = 30;

function dayBucket(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export class AsyncStorageAdapter implements Storage {
  private readonly asyncStorage: AsyncStorageLike;
  private readonly retentionDays: number;
  private readonly prefix: string;
  private chain: Promise<void> = Promise.resolve();

  constructor(opts: AsyncStorageAdapterOptions) {
    this.asyncStorage = opts.asyncStorage;
    this.retentionDays = opts.retentionDays ?? DEFAULT_RETENTION_DAYS;
    this.prefix = opts.keyPrefix ?? DEFAULT_PREFIX;
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn);
    this.chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  append(event: MeterEvent): Promise<void> {
    return this.enqueue(async () => {
      const key = this.prefix + dayBucket(event.timestamp);
      const raw = await this.asyncStorage.getItem(key);
      const events: MeterEvent[] = raw ? JSON.parse(raw) : [];
      events.push(event);
      await this.asyncStorage.setItem(key, JSON.stringify(events));
    });
  }

  query(range?: QueryRange): Promise<MeterEvent[]> {
    return this.enqueue(async () => {
      const cutoff = Date.now() - this.retentionDays * DAY_MS;
      await this.evictInternal(cutoff);

      const allKeys = await this.asyncStorage.getAllKeys();
      const ourKeys = allKeys.filter((k) => k.startsWith(this.prefix));

      const events: MeterEvent[] = [];
      for (const key of ourKeys) {
        const raw = await this.asyncStorage.getItem(key);
        if (!raw) continue;
        const parsed: MeterEvent[] = JSON.parse(raw);
        for (const event of parsed) {
          if (range?.from !== undefined && event.timestamp < range.from) continue;
          if (range?.to !== undefined && event.timestamp > range.to) continue;
          events.push(event);
        }
      }
      return events.sort((a, b) => a.timestamp - b.timestamp);
    });
  }

  clear(): Promise<void> {
    return this.enqueue(async () => {
      const allKeys = await this.asyncStorage.getAllKeys();
      const ourKeys = allKeys.filter((k) => k.startsWith(this.prefix));
      if (ourKeys.length > 0) {
        await this.asyncStorage.multiRemove(ourKeys);
      }
    });
  }

  evict(olderThanTimestamp: number): Promise<number> {
    return this.enqueue(() => this.evictInternal(olderThanTimestamp));
  }

  private async evictInternal(olderThanTimestamp: number): Promise<number> {
    const allKeys = await this.asyncStorage.getAllKeys();
    const ourKeys = allKeys.filter((k) => k.startsWith(this.prefix));
    const cutoffDay = dayBucket(olderThanTimestamp);
    const toRemove = ourKeys.filter((k) => {
      const day = k.slice(this.prefix.length);
      return day < cutoffDay;
    });
    if (toRemove.length > 0) {
      await this.asyncStorage.multiRemove(toRemove);
    }
    return toRemove.length;
  }
}
