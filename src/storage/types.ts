import type { MeterEvent } from "../types.js";

export interface QueryRange {
  from?: number;
  to?: number;
}

export interface Storage {
  append(event: MeterEvent): Promise<void>;
  query(range?: QueryRange): Promise<MeterEvent[]>;
  clear(): Promise<void>;
  // Evict events older than the given timestamp. Returns the number of events
  // (or buckets, depending on adapter granularity) removed. Optional because
  // not every adapter benefits from explicit eviction, but the shipped
  // adapters (Memory, AsyncStorage, SQLite) all implement it.
  evict?(olderThanTimestamp: number): Promise<number>;
}
