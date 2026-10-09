import { defineConfig } from "bunup";

/**
 * Bundles the API and the command for Node. Dependencies stay external, as
 * bunup leaves them.
 */
export default defineConfig({
  entry: ["src/index.ts", "src/todo.ts"],
  target: "node",
});
