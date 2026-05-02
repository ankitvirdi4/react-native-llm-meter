import type { Provider } from "../types.js";
import { PRICING, type PricingTable } from "./table.js";

export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
  severity: ValidationSeverity;
  provider: Provider | null;
  model: string | null;
  message: string;
}

export interface ValidationOptions {
  // When set, only this provider's entries are checked.
  provider?: Provider;
  // When set, only this exact model id is checked.
  model?: string;
  // Override the table being validated. Defaults to the shipped PRICING.
  // Primarily for testing malformed shapes.
  table?: PricingTable;
}

export function isModelKnown(provider: Provider, model: string): boolean {
  return PRICING[provider]?.[model] !== undefined;
}

export function validatePricingTable(
  opts: ValidationOptions = {},
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const table = opts.table ?? PRICING;
  const providers = opts.provider
    ? [opts.provider]
    : (Object.keys(table) as Provider[]);

  for (const provider of providers) {
    const models = table[provider];
    if (!models) {
      issues.push({
        severity: "error",
        provider,
        model: null,
        message: `Provider "${provider}" has no entries in the pricing table`,
      });
      continue;
    }

    const modelIds = opts.model
      ? Object.keys(models).filter((m) => m === opts.model)
      : Object.keys(models);

    if (opts.model && modelIds.length === 0) {
      issues.push({
        severity: "error",
        provider,
        model: opts.model,
        message: `Model "${opts.model}" not found for provider "${provider}"`,
      });
    }

    for (const model of modelIds) {
      const price = models[model];

      if (!(price.input > 0)) {
        issues.push({
          severity: "error",
          provider,
          model,
          message: "Input price must be a positive number",
        });
      }
      if (!(price.output > 0)) {
        issues.push({
          severity: "error",
          provider,
          model,
          message: "Output price must be a positive number",
        });
      }
      if (price.cacheRead !== undefined && !(price.cacheRead > 0)) {
        issues.push({
          severity: "error",
          provider,
          model,
          message: "cacheRead must be a positive number when set",
        });
      }
      if (price.cacheCreate !== undefined && !(price.cacheCreate > 0)) {
        issues.push({
          severity: "error",
          provider,
          model,
          message: "cacheCreate must be a positive number when set",
        });
      }
      if (price.longContext) {
        if (!(price.longContext.threshold > 0)) {
          issues.push({
            severity: "error",
            provider,
            model,
            message: "longContext.threshold must be a positive number",
          });
        }
        if (price.longContext.input < price.input) {
          issues.push({
            severity: "warning",
            provider,
            model,
            message:
              "longContext.input is lower than the base input rate, which is unusual",
          });
        }
        if (price.longContext.output < price.output) {
          issues.push({
            severity: "warning",
            provider,
            model,
            message:
              "longContext.output is lower than the base output rate, which is unusual",
          });
        }
      }
    }
  }

  return issues;
}
