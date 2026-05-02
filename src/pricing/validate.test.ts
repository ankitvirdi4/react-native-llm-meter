import { describe, expect, it } from "vitest";
import {
  isModelKnown,
  validatePricingTable,
} from "./validate.js";

describe("isModelKnown", () => {
  it("returns true for a model that exists in the table", () => {
    expect(isModelKnown("anthropic", "claude-sonnet-4-6")).toBe(true);
  });

  it("returns false for a model that does not exist", () => {
    expect(isModelKnown("anthropic", "claude-future-99")).toBe(false);
  });

  it("returns false for a provider that does not exist", () => {
    // @ts-expect-error provider is constrained
    expect(isModelKnown("nonexistent", "anything")).toBe(false);
  });
});

describe("validatePricingTable", () => {
  it("returns no issues for the shipped table", () => {
    const issues = validatePricingTable();
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("scopes to a specific provider when requested", () => {
    const issues = validatePricingTable({ provider: "anthropic" });
    expect(issues.every((i) => i.provider === "anthropic")).toBe(true);
  });

  it("flags an unknown model when scoped", () => {
    const issues = validatePricingTable({
      provider: "anthropic",
      model: "claude-does-not-exist",
    });
    expect(issues.some((i) => i.severity === "error")).toBe(true);
  });

  it("returns no issues when scoped to a known model", () => {
    const issues = validatePricingTable({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
    });
    expect(issues).toEqual([]);
  });

  it("flags zero or negative input or output prices", () => {
    const issues = validatePricingTable({
      table: {
        anthropic: { "bad-model": { input: 0, output: -1 } },
        openai: {},
        google: {},
      },
    });
    expect(issues.filter((i) => i.severity === "error").length).toBeGreaterThanOrEqual(2);
  });

  it("flags zero or negative cacheRead or cacheCreate when set", () => {
    const issues = validatePricingTable({
      table: {
        anthropic: {
          "bad-cache": { input: 1, output: 1, cacheRead: 0, cacheCreate: -1 },
        },
        openai: {},
        google: {},
      },
    });
    expect(issues.filter((i) => i.severity === "error").length).toBeGreaterThanOrEqual(2);
  });

  it("flags non positive longContext threshold", () => {
    const issues = validatePricingTable({
      table: {
        anthropic: {
          "bad-lc": {
            input: 1,
            output: 1,
            longContext: { threshold: 0, input: 2, output: 2 },
          },
        },
        openai: {},
        google: {},
      },
    });
    expect(issues.some((i) => /threshold/i.test(i.message))).toBe(true);
  });

  it("warns when longContext rates are lower than base rates", () => {
    const issues = validatePricingTable({
      table: {
        anthropic: {
          "weird-lc": {
            input: 10,
            output: 10,
            longContext: { threshold: 1000, input: 5, output: 5 },
          },
        },
        openai: {},
        google: {},
      },
    });
    const warnings = issues.filter((i) => i.severity === "warning");
    expect(warnings.length).toBeGreaterThanOrEqual(2);
  });

  it("flags a missing provider when overriding the table", () => {
    const issues = validatePricingTable({
      provider: "anthropic",
      table: { openai: {}, google: {} } as never,
    });
    expect(issues.some((i) => i.severity === "error" && i.model === null)).toBe(true);
  });
});
