// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  cleanup();
});
import { Meter } from "../meter.js";
import { MeterProvider, useBudget, useMeter, useMetrics } from "./hooks.js";

function wrapperFor(meter: Meter) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <MeterProvider meter={meter}>{children}</MeterProvider>;
  };
}

describe("useMeter", () => {
  it("returns the meter from context", () => {
    const meter = new Meter();
    const { result } = renderHook(() => useMeter(), {
      wrapper: wrapperFor(meter),
    });
    expect(result.current).toBe(meter);
  });

  it("throws when called outside MeterProvider", () => {
    expect(() => renderHook(() => useMeter())).toThrow(/MeterProvider/);
  });
});

describe("useMetrics", () => {
  it("loads, exposes summary, and refreshes when an event is recorded", async () => {
    const meter = new Meter();

    const { result } = renderHook(() => useMetrics(), {
      wrapper: wrapperFor(meter),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.summary?.count).toBe(0);

    await act(async () => {
      meter.record({
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        inputTokens: 1000,
        outputTokens: 500,
        latencyMs: 200,
      });
      await meter.flush();
    });

    await waitFor(() => expect(result.current.summary?.count).toBe(1));
    expect(result.current.summary?.inputTokens).toBe(1000);
    expect(result.current.summary?.outputTokens).toBe(500);
  });

  it("groups by model when groupBy is set", async () => {
    const meter = new Meter();
    const { result } = renderHook(() => useMetrics({ groupBy: "model" }), {
      wrapper: wrapperFor(meter),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      meter.record({
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        inputTokens: 100,
        outputTokens: 50,
        latencyMs: 100,
      });
      meter.record({
        provider: "anthropic",
        model: "claude-haiku-4-5",
        inputTokens: 10,
        outputTokens: 5,
        latencyMs: 50,
      });
      await meter.flush();
    });

    await waitFor(() => expect(result.current.summary?.count).toBe(2));
    expect(result.current.byGroup).not.toBeNull();
    expect(result.current.byGroup?.["claude-sonnet-4-6"].count).toBe(1);
    expect(result.current.byGroup?.["claude-haiku-4-5"].count).toBe(1);
  });

  it("refresh manually triggers a query", async () => {
    const meter = new Meter();
    const { result } = renderHook(() => useMetrics(), {
      wrapper: wrapperFor(meter),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.summary?.count).toBe(0);
  });

  it("respects from and to range", async () => {
    const meter = new Meter();
    meter.record({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
      timestamp: 1000,
    });
    meter.record({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
      timestamp: 5000,
    });
    await meter.flush();

    const { result } = renderHook(
      () => useMetrics({ from: 2000, to: 6000 }),
      { wrapper: wrapperFor(meter) },
    );

    await waitFor(() => expect(result.current.summary?.count).toBe(1));
  });
});

describe("useBudget", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-01T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns zero spend with no events", async () => {
    const meter = new Meter();
    const { result } = renderHook(() => useBudget(5, { timezone: "utc" }), {
      wrapper: wrapperFor(meter),
    });
    await waitFor(() => expect(result.current.spend).toBe(0));
    expect(result.current.threshold).toBe(5);
    expect(result.current.remaining).toBe(5);
    expect(result.current.overBudget).toBe(false);
  });

  it("sums today's UTC spend and flags overBudget when crossed", async () => {
    const meter = new Meter();

    const { result } = renderHook(() => useBudget(0.005, { timezone: "utc" }), {
      wrapper: wrapperFor(meter),
    });
    await waitFor(() => expect(result.current.spend).toBe(0));

    await act(async () => {
      meter.record({
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        inputTokens: 1000,
        outputTokens: 200,
        latencyMs: 100,
      });
      await meter.flush();
    });

    // 1000 * 3 + 200 * 15 = 6000 / 1M = 0.006
    await waitFor(() => expect(result.current.spend).toBeCloseTo(0.006, 6));
    expect(result.current.overBudget).toBe(true);
    expect(result.current.remaining).toBe(0);
  });

  it("ignores spend from previous UTC days", async () => {
    const meter = new Meter();

    meter.record({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      inputTokens: 1000,
      outputTokens: 1000,
      latencyMs: 100,
      timestamp: Date.parse("2026-04-30T22:00:00Z"),
    });
    await meter.flush();

    const { result } = renderHook(() => useBudget(0.001, { timezone: "utc" }), {
      wrapper: wrapperFor(meter),
    });

    await waitFor(() => expect(result.current.spend).toBe(0));
    expect(result.current.overBudget).toBe(false);
  });

  it("supports weekly period in UTC starting Monday", async () => {
    // 2026-05-01 is a Friday. Monday is 2026-04-27.
    const meter = new Meter();
    meter.record({
      provider: "anthropic",
      model: "claude-haiku-4-5",
      inputTokens: 1000,
      outputTokens: 1000,
      latencyMs: 1,
      timestamp: Date.parse("2026-04-28T08:00:00Z"), // Tuesday, in the same week
    });
    meter.record({
      provider: "anthropic",
      model: "claude-haiku-4-5",
      inputTokens: 1000,
      outputTokens: 1000,
      latencyMs: 1,
      timestamp: Date.parse("2026-04-26T08:00:00Z"), // Sunday, previous week
    });
    await meter.flush();

    const { result } = renderHook(
      () => useBudget(1, { period: "week", timezone: "utc" }),
      { wrapper: wrapperFor(meter) },
    );
    await waitFor(() => expect(result.current.spend).toBeGreaterThan(0));
    // Only the Tuesday event counts.
    expect(result.current.spend).toBeCloseTo(0.006, 6);
    expect(result.current.periodStart).toBe(Date.parse("2026-04-27T00:00:00Z"));
  });

  it("default timezone is local, day period exposes a periodStart", async () => {
    const meter = new Meter();
    const { result } = renderHook(() => useBudget(1), {
      wrapper: wrapperFor(meter),
    });
    await waitFor(() => expect(result.current.spend).toBe(0));
    // periodStart should be midnight in some timezone, not zero, not NaN.
    expect(result.current.periodStart).toBeGreaterThan(0);
    expect(Number.isFinite(result.current.periodStart)).toBe(true);
  });

  it("supports local weekly and monthly periods (smoke)", async () => {
    const meter = new Meter();

    const week = renderHook(
      () => useBudget(1, { period: "week", timezone: "local" }),
      { wrapper: wrapperFor(meter) },
    );
    const month = renderHook(
      () => useBudget(1, { period: "month", timezone: "local" }),
      { wrapper: wrapperFor(meter) },
    );

    await waitFor(() => expect(week.result.current.periodStart).toBeGreaterThan(0));
    await waitFor(() => expect(month.result.current.periodStart).toBeGreaterThan(0));
    // Both should be valid timestamps; their relation depends on the calendar.
    expect(Number.isFinite(week.result.current.periodStart)).toBe(true);
    expect(Number.isFinite(month.result.current.periodStart)).toBe(true);
  });

  it("supports monthly period in UTC", async () => {
    const meter = new Meter();
    meter.record({
      provider: "anthropic",
      model: "claude-haiku-4-5",
      inputTokens: 100,
      outputTokens: 100,
      latencyMs: 1,
      timestamp: Date.parse("2026-05-15T08:00:00Z"),
    });
    meter.record({
      provider: "anthropic",
      model: "claude-haiku-4-5",
      inputTokens: 100,
      outputTokens: 100,
      latencyMs: 1,
      timestamp: Date.parse("2026-04-29T08:00:00Z"),
    });
    await meter.flush();

    const { result } = renderHook(
      () => useBudget(1, { period: "month", timezone: "utc" }),
      { wrapper: wrapperFor(meter) },
    );
    await waitFor(() => expect(result.current.spend).toBeGreaterThan(0));
    expect(result.current.periodStart).toBe(Date.parse("2026-05-01T00:00:00Z"));
  });
});
