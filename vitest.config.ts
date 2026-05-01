import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    alias: {
      "react-native": path.resolve(__dirname, "tests/rn-stub.tsx"),
    },
    coverage: {
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/types.ts",
        "src/storage/types.ts",
        "src/overlay/index.ts",
        "src/react/index.ts",
      ],
    },
  },
});
