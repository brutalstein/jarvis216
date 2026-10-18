import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Tests run the engine from source; the build resolves it from its dist.
  resolve: {
    alias: {
      "@jarvis/action-engine": fileURLToPath(
        new URL("./packages/action-engine/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["tests/**/*.test.ts", "packages/*/tests/**/*.test.ts"],
    setupFiles: ["./tests/network-guard.ts"],
    testTimeout: 15_000,
  },
});
