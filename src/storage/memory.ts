import type { MeterEvent } from "../types.js";
import type { QueryRange, Storage } from "./types.js";

export class MemoryStorage implements Storage {
  private events: MeterEvent[] = [];

  async append(event: MeterEvent): Promise<void> {
    this.events.push(event);
  }

  async query(range?: QueryRange): Promise<MeterEvent[]> {
    return this.events.filter((e) => {
      if (range?.from !== undefined && e.timestamp < range.from) return false;
      if (range?.to !== undefined && e.timestamp > range.to) return false;
      return true;
    });
  }

  async clear(): Promise<void> {
    this.events = [];
  }

  async evict(olderThanTimestamp: number): Promise<number> {
    const before = this.events.length;
    this.events = this.events.filter((e) => e.timestamp >= olderThanTimestamp);
    return before - this.events.length;
  }
}
