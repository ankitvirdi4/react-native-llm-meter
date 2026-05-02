import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  type GroupBy,
  type Summary,
  summarize,
  summarizeBy,
} from "../aggregate.js";
import type { Meter } from "../meter.js";
import type { QueryRange } from "../storage/types.js";
import type { MeterEvent } from "../types.js";

const MeterContext = createContext<Meter | null>(null);

export interface MeterProviderProps {
  meter: Meter;
  children: ReactNode;
}

export function MeterProvider({ meter, children }: MeterProviderProps) {
  return <MeterContext.Provider value={meter}>{children}</MeterContext.Provider>;
}

export function useMeter(): Meter {
  const meter = useContext(MeterContext);
  if (!meter) {
    throw new Error(
      "useMeter must be called inside a <MeterProvider meter={...}>.",
    );
  }
  return meter;
}

export interface UseMetricsOptions {
  from?: number;
  to?: number;
  groupBy?: GroupBy;
}

export interface UseMetricsResult {
  summary: Summary | null;
  byGroup: Record<string, Summary> | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useMetrics(opts: UseMetricsOptions = {}): UseMetricsResult {
  const meter = useMeter();
  const { from, to, groupBy } = opts;
  const [summary, setSummary] = useState<Summary | null>(null);
  const [byGroup, setByGroup] = useState<Record<string, Summary> | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const events = await meter.getEvents({ from, to });
    setSummary(summarize(events));
    setByGroup(groupBy ? summarizeBy(events, groupBy) : null);
    setLoading(false);
  }, [meter, from, to, groupBy]);

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    void refreshRef.current();
    const unsubscribe = meter.subscribe(() => {
      void refreshRef.current();
    });
    return unsubscribe;
  }, [meter]);

  return { summary, byGroup, loading, refresh };
}

export interface UseEventsOptions extends QueryRange {}

export interface UseEventsResult {
  events: MeterEvent[];
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useEvents(opts: UseEventsOptions = {}): UseEventsResult {
  const meter = useMeter();
  const { from, to } = opts;
  const [events, setEvents] = useState<MeterEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const list = await meter.getEvents({ from, to });
    setEvents(list);
    setLoading(false);
  }, [meter, from, to]);

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    void refreshRef.current();
    return meter.subscribe(() => {
      void refreshRef.current();
    });
  }, [meter]);

  return { events, loading, refresh };
}

export type BudgetPeriod = "day" | "week" | "month";
export type BudgetTimezone = "local" | "utc";

export interface UseBudgetOptions {
  period?: BudgetPeriod;
  timezone?: BudgetTimezone;
}

export interface UseBudgetResult {
  spend: number;
  threshold: number;
  remaining: number;
  overBudget: boolean;
  periodStart: number;
}

function periodStart(
  now: number,
  period: BudgetPeriod,
  timezone: BudgetTimezone,
): number {
  const d = new Date(now);
  if (timezone === "utc") {
    if (period === "day") {
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    }
    if (period === "month") {
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    }
    // week: Monday start
    const day = d.getUTCDay();
    const daysSinceMonday = (day + 6) % 7;
    const startOfDay = Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth(),
      d.getUTCDate(),
    );
    return startOfDay - daysSinceMonday * 86_400_000;
  }
  // local timezone
  if (period === "day") {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }
  if (period === "month") {
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  }
  const day = d.getDay();
  const daysSinceMonday = (day + 6) % 7;
  const startOfDay = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
  ).getTime();
  return startOfDay - daysSinceMonday * 86_400_000;
}

export function useBudget(
  threshold: number,
  options: UseBudgetOptions = {},
): UseBudgetResult {
  const meter = useMeter();
  const period = options.period ?? "day";
  const timezone = options.timezone ?? "local";
  const [spend, setSpend] = useState(0);
  const [from, setFrom] = useState(() => periodStart(Date.now(), period, timezone));

  const refresh = useCallback(async () => {
    const start = periodStart(Date.now(), period, timezone);
    setFrom(start);
    const events = await meter.getEvents({ from: start });
    setSpend(summarize(events).costUsd);
  }, [meter, period, timezone]);

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    void refreshRef.current();
    const unsubscribe = meter.subscribe(() => {
      void refreshRef.current();
    });
    return unsubscribe;
  }, [meter]);

  return {
    spend,
    threshold,
    remaining: Math.max(0, threshold - spend),
    overBudget: spend >= threshold,
    periodStart: from,
  };
}
