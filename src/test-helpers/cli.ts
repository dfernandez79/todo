import { runCli } from "../cli/run.ts";
import { captureOutput } from "./capture-output.ts";

type Run = { code: number; stdout: string; stderr: string };

type Todo = {
  /** Runs `todo` with these arguments, and `stdin` as its input. */
  (args: string[], stdin?: string): Promise<Run>;
  /** Runs `todo --json`, expecting success, and parses its output. */
  json: <T = unknown>(args: string[], stdin?: string) => Promise<T>;
};

/** Stands in for the editor: gets its command and the file, edits it, and returns its exit code. */
type FakeEditor = (command: string, file: string) => Promise<number>;

const noEditor: FakeEditor = () => {
  throw new Error("the test opened an editor it didn't expect");
};

/** A `todo` command line bound to one database, run in-process. */
const todoCli = (
  database: string,
  env: Record<string, string> = {},
  editor: FakeEditor = noEditor,
): Todo => {
  const run = async (args: string[], stdin = ""): Promise<Run> => {
    const stdout = captureOutput();
    const stderr = captureOutput();
    const code = await runCli(
      args,
      { stdout, stderr, readStdin: async () => stdin, runEditor: editor },
      { env: { TODO_DATABASE_URL: database, ...env }, homedir: "/nonexistent-home" },
    );
    return { code, stdout: stdout.text(), stderr: stderr.text() };
  };
  const json = async <T>(args: string[], stdin?: string): Promise<T> => {
    const result = await run([...args, "--json"], stdin);
    if (result.code !== 0) {
      throw new Error(
        `todo ${args.join(" ")} exited ${result.code}: ${result.stdout}${result.stderr}`,
      );
    }
    return JSON.parse(result.stdout) as T;
  };
  return Object.assign(run, { json });
};

export { type FakeEditor, type Run, type Todo, todoCli };
