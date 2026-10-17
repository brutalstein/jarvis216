import { defineConfig } from "vitest/config";

export default defineConfig({ test: { setupFiles: ["./tests/network-guard.ts"], testTimeout: 15_000 } });
