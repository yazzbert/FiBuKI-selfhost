/**
 * Self-host spike test profile: runs REAL application code with the
 * Firebase module surface swapped for self-host shims at resolution time.
 * Zero application-code changes — that's the point being proven.
 *
 *   npx vitest run --config vitest.selfhost.config.ts
 */

import { defineConfig } from "vitest/config";
import path from "path";

const shim = (f: string) => path.resolve(__dirname, "src/selfhost", f);

export default defineConfig({
  resolve: {
    alias: {
      "firebase-admin/firestore": shim("firestore-shim.ts"),
      "firebase-functions/v2/firestore": shim("trigger-shim.ts"),
      "firebase-functions/v2/https": shim("https-shim.ts"),
      "firebase-admin/auth": shim("auth-shim.ts"),
      "firebase-admin/storage": shim("storage-shim.ts"),
      "firebase-functions/v2/scheduler": shim("scheduler-shim.ts"),
      "firebase-functions/params": shim("params-shim.ts"),
      "@google-cloud/vertexai": shim("vertexai-stub.ts"),
    },
  },
  test: {
    include: ["src/selfhost/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
