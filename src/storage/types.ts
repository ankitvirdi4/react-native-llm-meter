import type { MeterEvent } from "../types.js";

export interface QueryRange {
  from?: number;
  to?: number;
}

export interface Storage {
  append(event: MeterEvent): Promise<void>;
  query(range?: QueryRange): Promise<MeterEvent[]>;
  clear(): Promise<void>;
}
