import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/test/**/*.test.ts"],
    // Self-host spike tests require the module-alias profile (vitest.selfhost.config.ts)
    exclude: ["src/selfhost/**"],
    clearMocks: true,
    globals: true,
    testTimeout: 10000,
    hookTimeout: 10000,
  },
});
