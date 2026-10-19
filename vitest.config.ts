import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Tests run the engine from source; the build resolves it from its dist.
  resolve: {
    alias: {
      "@jarvis/action-engine": fileURLToPath(
        new URL("./packages/action-engine/src/index.ts", import.meta.url),
      ),
      "@jarvis/brain": fileURLToPath(new URL("./packages/brain/src/index.ts", import.meta.url)),
      "@jarvis/integration-hub": fileURLToPath(
        new URL("./packages/integration-hub/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["tests/**/*.test.ts", "packages/*/tests/**/*.test.ts"],
    setupFiles: ["./tests/network-guard.ts"],
    // PGlite initialization times out when Vitest fans out across this 32-thread Windows host.
    maxWorkers: 4,
    testTimeout: 15_000,
    // npm run coverage; CI fails when coverage drops below these floors.
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts", "packages/*/src/**/*.ts"],
      // Process entry points: covered by the end-to-end suite through createCore.
      exclude: ["src/main.ts", "src/cli.ts"],
      reporter: ["text-summary", "json-summary"],
      reportsDirectory: "artifacts/coverage",
      // Measured 2026-10-19: lines 96.2, statements 94.2, functions 93.9, branches 85.8.
      thresholds: { lines: 95, statements: 93, functions: 92, branches: 84 },
    },
  },
});
