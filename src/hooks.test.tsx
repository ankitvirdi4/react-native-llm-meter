// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Meter } from "./meter.js";
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
    const { result } = renderHook(() => useBudget(5), {
      wrapper: wrapperFor(meter),
    });
    await waitFor(() => expect(result.current.spend).toBe(0));
    expect(result.current.threshold).toBe(5);
    expect(result.current.remaining).toBe(5);
    expect(result.current.overBudget).toBe(false);
  });

  it("sums today's UTC spend and flags overBudget when crossed", async () => {
    const meter = new Meter();

    const { result } = renderHook(() => useBudget(0.005), {
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

    const { result } = renderHook(() => useBudget(0.001), {
      wrapper: wrapperFor(meter),
    });

    await waitFor(() => expect(result.current.spend).toBe(0));
    expect(result.current.overBudget).toBe(false);
  });
});
