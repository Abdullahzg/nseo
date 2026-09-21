import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "_private/**",
    "test-results/**",
  ]),
  {
    rules: {
      // Supabase rows and model JSON arrive untyped at the edges; the validators are the type guards.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // Fetch-on-mount into state is the pattern every screen uses; the compiler heuristic flags it.
      "react-hooks/set-state-in-effect": "off",
      "react/no-unescaped-entities": "off",
      // /api/auth/signin is an API route, not a page.
      "@next/next/no-html-link-for-pages": "off",
    },
  },
]);

export default eslintConfig;
