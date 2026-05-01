import type { Meter } from "./meter.js";
import type { AsyncStorageLike } from "./storage/async-storage.js";

export type BudgetPeriod = "day" | "week" | "month";

export interface BudgetCrossInfo {
  period: BudgetPeriod;
  threshold: number;
  spend: number;
  periodStart: number;
}

export interface BudgetOptions {
  daily?: number;
  weekly?: number;
  monthly?: number;
  onCross: (info: BudgetCrossInfo) => void;
  state?: BudgetStateStore;
}

export interface BudgetStateStore {
  get(period: BudgetPeriod): Promise<number | null>;
  set(period: BudgetPeriod, timestamp: number): Promise<void>;
}

export class MemoryBudgetState implements BudgetStateStore {
  private map = new Map<BudgetPeriod, number>();
  async get(period: BudgetPeriod): Promise<number | null> {
    return this.map.get(period) ?? null;
  }
  async set(period: BudgetPeriod, timestamp: number): Promise<void> {
    this.map.set(period, timestamp);
  }
}

export interface AsyncStorageBudgetStateOptions {
  asyncStorage: AsyncStorageLike;
  keyPrefix?: string;
}

export class AsyncStorageBudgetState implements BudgetStateStore {
  private readonly asyncStorage: AsyncStorageLike;
  private readonly prefix: string;

  constructor(opts: AsyncStorageBudgetStateOptions) {
    this.asyncStorage = opts.asyncStorage;
    this.prefix = opts.keyPrefix ?? "llm-meter:budget:";
  }

  async get(period: BudgetPeriod): Promise<number | null> {
    const raw = await this.asyncStorage.getItem(this.prefix + period);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }

  async set(period: BudgetPeriod, timestamp: number): Promise<void> {
    await this.asyncStorage.setItem(this.prefix + period, String(timestamp));
  }
}

const DAY_MS = 86_400_000;

export function startOfUtcDay(timestamp: number): number {
  const d = new Date(timestamp);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function startOfUtcWeek(timestamp: number): number {
  const d = new Date(timestamp);
  const utcDay = d.getUTCDay();
  const daysSinceMonday = (utcDay + 6) % 7;
  return startOfUtcDay(timestamp) - daysSinceMonday * DAY_MS;
}

export function startOfUtcMonth(timestamp: number): number {
  const d = new Date(timestamp);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

function periodStart(period: BudgetPeriod, now: number): number {
  if (period === "day") return startOfUtcDay(now);
  if (period === "week") return startOfUtcWeek(now);
  return startOfUtcMonth(now);
}

export function setBudgetWatcher(meter: Meter, opts: BudgetOptions): () => void {
  const state = opts.state ?? new MemoryBudgetState();

  const periods: Array<{ period: BudgetPeriod; threshold: number }> = [];
  if (opts.daily !== undefined) periods.push({ period: "day", threshold: opts.daily });
  if (opts.weekly !== undefined) periods.push({ period: "week", threshold: opts.weekly });
  if (opts.monthly !== undefined) periods.push({ period: "month", threshold: opts.monthly });

  let detached = false;

  const checkAndFire = async (): Promise<void> => {
    if (detached) return;
    const now = Date.now();

    for (const { period, threshold } of periods) {
      if (detached) return;
      const start = periodStart(period, now);
      const lastFired = await state.get(period);
      if (lastFired !== null && lastFired >= start) continue;

      const events = await meter.getEvents({ from: start });
      let spend = 0;
      for (const event of events) spend += event.costUsd;

      if (spend >= threshold) {
        await state.set(period, now);
        try {
          opts.onCross({ period, threshold, spend, periodStart: start });
        } catch {
          // user callback errors must not break recording
        }
      }
    }
  };

  const unsubscribe = meter.subscribe(() => checkAndFire());

  return () => {
    detached = true;
    unsubscribe();
  };
}
