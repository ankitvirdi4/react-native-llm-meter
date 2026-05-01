// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { MeterProvider } from "../react/hooks.js";
import { Meter } from "../meter.js";
import { MeterOverlay } from "./MeterOverlay.js";

afterEach(() => {
  cleanup();
});

function wrap(meter: Meter) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <MeterProvider meter={meter}>{children}</MeterProvider>;
  };
}

describe("MeterOverlay", () => {
  it("renders nothing when enabled is false", () => {
    const meter = new Meter();
    const { container } = render(<MeterOverlay enabled={false} />, {
      wrapper: wrap(meter),
    });
    expect(container.querySelector('[data-testid="meter-overlay"]')).toBeNull();
  });

  it("renders the header with zero spend when no events", async () => {
    const meter = new Meter();
    render(<MeterOverlay />, { wrapper: wrap(meter) });

    const header = await screen.findByTestId("meter-overlay-header");
    expect(header.textContent).toMatch(/\$0\.0000/);
  });

  it("expands the body on header tap and shows recent events", async () => {
    const meter = new Meter();
    meter.record({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      inputTokens: 100,
      outputTokens: 50,
      latencyMs: 150,
      requestId: "req-1",
    });
    await meter.flush();

    render(<MeterOverlay />, { wrapper: wrap(meter) });

    expect(screen.queryByTestId("meter-overlay-body")).toBeNull();

    const header = await screen.findByTestId("meter-overlay-header");
    await act(async () => {
      header.click();
    });

    expect(await screen.findByTestId("meter-overlay-body")).toBeTruthy();
    expect(await screen.findByTestId("meter-overlay-row-req-1")).toBeTruthy();
  });

  it("toggles the details panel when a recent row is tapped", async () => {
    const meter = new Meter();
    meter.record({
      provider: "openai",
      model: "gpt-4o-mini",
      inputTokens: 10,
      outputTokens: 5,
      latencyMs: 50,
      requestId: "req-x",
    });
    await meter.flush();

    render(<MeterOverlay />, { wrapper: wrap(meter) });
    const header = await screen.findByTestId("meter-overlay-header");
    await act(async () => {
      header.click();
    });

    const row = await screen.findByTestId("meter-overlay-row-req-x");
    await act(async () => {
      row.click();
    });
    expect(await screen.findByTestId("meter-overlay-details")).toBeTruthy();

    await act(async () => {
      row.click();
    });
    expect(screen.queryByTestId("meter-overlay-details")).toBeNull();
  });

  it("shows 'no events yet' placeholders when expanded with empty meter", async () => {
    const meter = new Meter();
    render(<MeterOverlay />, { wrapper: wrap(meter) });
    const header = await screen.findByTestId("meter-overlay-header");
    await act(async () => {
      header.click();
    });

    const body = await screen.findByTestId("meter-overlay-body");
    expect(body.textContent).toMatch(/no events yet/);
  });

  it("shows ttft in the details panel when the event has ttftMs", async () => {
    const meter = new Meter();
    meter.record({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      inputTokens: 100,
      outputTokens: 50,
      latencyMs: 500,
      ttftMs: 80,
      requestId: "stream-1",
    });
    await meter.flush();

    render(<MeterOverlay />, { wrapper: wrap(meter) });
    const header = await screen.findByTestId("meter-overlay-header");
    await act(async () => {
      header.click();
    });
    const row = await screen.findByTestId("meter-overlay-row-stream-1");
    await act(async () => {
      row.click();
    });
    const details = await screen.findByTestId("meter-overlay-details");
    expect(details.textContent).toMatch(/ttft: 80ms/);
  });

  it("hides the ttft line when the event has no ttftMs", async () => {
    const meter = new Meter();
    meter.record({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      inputTokens: 100,
      outputTokens: 50,
      latencyMs: 500,
      requestId: "nostream-1",
    });
    await meter.flush();

    render(<MeterOverlay />, { wrapper: wrap(meter) });
    const header = await screen.findByTestId("meter-overlay-header");
    await act(async () => {
      header.click();
    });
    const row = await screen.findByTestId("meter-overlay-row-nostream-1");
    await act(async () => {
      row.click();
    });
    const details = await screen.findByTestId("meter-overlay-details");
    expect(details.textContent).not.toMatch(/ttft:/);
  });

  it("refreshes when the meter records a new event", async () => {
    const meter = new Meter();
    render(<MeterOverlay />, { wrapper: wrap(meter) });

    const header = await screen.findByTestId("meter-overlay-header");
    expect(header.textContent).toMatch(/• 0/);

    await act(async () => {
      meter.record({
        provider: "anthropic",
        model: "claude-haiku-4-5",
        inputTokens: 100,
        outputTokens: 50,
        latencyMs: 80,
      });
      await meter.flush();
    });

    expect(header.textContent).toMatch(/• 1/);
  });
});
