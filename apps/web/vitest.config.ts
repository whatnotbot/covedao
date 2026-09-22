import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Unit tests live under src/**; Playwright E2E lives in tests/ (excluded).
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["tests/**", "node_modules/**"],
  },
});
