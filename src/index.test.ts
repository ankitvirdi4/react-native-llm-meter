import { describe, expect, it } from "vitest";
import { VERSION } from "./index.js";

describe("react-native-llm-meter", () => {
  it("exposes a version string", () => {
    expect(typeof VERSION).toBe("string");
  });
});
