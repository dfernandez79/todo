import config from "@diegoux/oxc-config/oxlint";
import { defineConfig } from "oxlint";

const RUNS_ON_NODE = "src/ is built into a binary that runs on Node; use node: modules instead";

export default defineConfig({
  extends: [config],
  ignorePatterns: ["node_modules", "*.svg", "*.d2"],
  overrides: [
    {
      files: ["src/**"],
      rules: {
        "no-restricted-globals": ["error", { name: "Bun", message: RUNS_ON_NODE }],
        "no-restricted-imports": ["error", { paths: [{ name: "bun", message: RUNS_ON_NODE }] }],
      },
    },
    {
      // The SQL boundary, where NULL is a column value.
      files: ["src/rows.ts", "src/db/schema.ts"],
      rules: { "unicorn/no-null": "off" },
    },
    {
      // Tests, and what only they use, run on Bun.
      files: ["src/**/*.test.ts", "src/test-helpers/**"],
      rules: { "no-restricted-globals": "off", "no-restricted-imports": "off" },
    },
  ],
});
