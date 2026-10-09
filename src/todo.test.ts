import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";

import { tempDir } from "./test-helpers/databases.ts";

type Run = { code: number; stdout: string; stderr: string };

const ROOT = join(import.meta.dir, "..");

const run = async (command: string[], stdin?: string): Promise<Run> => {
  const proc = Bun.spawn(command, {
    cwd: ROOT,
    stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
};

/**
 * Node.js from the PATH, unless it's the `node` that `bun run` puts there
 * when Node.js isn't installed, which is Bun.
 */
const findNode = (): string | undefined => {
  const node = Bun.which("node");
  if (node === null) return undefined;
  const probe = Bun.spawnSync([node, "--print", "typeof Bun"]);
  return probe.stdout.toString().trim() === "undefined" ? node : undefined;
};

const NODE = findNode();

describe.skipIf(NODE === undefined)("the built command, on Node", () => {
  let db = "";
  const todo = (args: string[], stdin?: string) =>
    run([NODE!, "dist/todo.js", ...args, `--db=${db}`], stdin);

  beforeAll(async () => {
    const build = await run([process.execPath, "run", "build"]);
    if (build.code !== 0) throw new Error(`build failed:\n${build.stderr}`);
    db = join(await tempDir(), "nested", "todo.db");
  }, 60_000);

  test("keeps Items in SQLite through node:sqlite, without warnings", async () => {
    expect(await todo(["add", "From Node", "--section=UI"])).toEqual({
      code: 0,
      stdout: "Added 1. From Node\n",
      stderr: "",
    });
    expect((await todo(["ls"])).stdout).toBe("# default\n\n## UI\n\n- [ ] 1. From Node\n");
  });

  test("imports Markdown from stdin", async () => {
    const result = await todo(["list", "import", "imported"], "- [ ] One\n- [x] Two\n");
    expect(result).toEqual({ code: 0, stdout: "Imported 2 items into imported\n", stderr: "" });
  });

  test("exits 2 on a usage error", async () => {
    const result = await todo(["frobnicate"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toStartWith("todo: unknown command 'frobnicate'");
  });
});
