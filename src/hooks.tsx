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
} from "./aggregate.js";
import type { Meter } from "./meter.js";

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

export interface UseBudgetResult {
  spend: number;
  threshold: number;
  remaining: number;
  overBudget: boolean;
}

function startOfUtcDay(timestamp: number): number {
  const d = new Date(timestamp);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function useBudget(threshold: number): UseBudgetResult {
  const meter = useMeter();
  const [spend, setSpend] = useState(0);

  const refresh = useCallback(async () => {
    const from = startOfUtcDay(Date.now());
    const events = await meter.getEvents({ from });
    setSpend(summarize(events).costUsd);
  }, [meter]);

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
  };
}
