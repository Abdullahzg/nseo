import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    // Unit tests mock fetch; integration tests self-skip without DATABASE_URL / NEBIUS_API_KEY.
    setupFiles: ["tests/setup.ts"],
  },
  resolve: { alias: { "@": path.resolve(__dirname, "./src"), "@auth": path.resolve(__dirname, "./auth.ts") } },
});
