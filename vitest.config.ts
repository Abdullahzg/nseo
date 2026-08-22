import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Pure-function tests must run with NO provider keys so the deterministic
    // fallback paths are what get exercised.
    env: { GEMINI_API_KEY: "", OPENROUTER_API_KEY: "" },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@auth": path.resolve(__dirname, "./auth.ts"),
      "@config/*": path.resolve(__dirname, "./config/*"),
    },
  },
});
