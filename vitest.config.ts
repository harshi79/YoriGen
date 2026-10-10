import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      // Scope is left at the default (modules reached by the unit tests) on
      // purpose: main.ts, generator-panel.ts, sorter-panel.ts and workspace.ts
      // are DOM wiring with no unit tests, and are exercised by the Playwright
      // suite instead. Listing them here would report a misleading ~40%.
      //
      // Floors, not targets: they sit just below the current numbers so a new
      // untested code path fails `npm run test:coverage` instead of quietly
      // eroding the suite. Raise them as coverage improves.
      thresholds: {
        statements: 96,
        branches: 93,
        functions: 96,
        lines: 97,
      },
    },
  },
});
