#!/usr/bin/env node
import { homedir } from "node:os";
import { text } from "node:stream/consumers";

import { runCli } from "./cli/run.ts";
import { UsageError } from "./errors.ts";

// node:sqlite warns that it's experimental on the Node versions that support
// it; that's known and accepted, and the warning would only confuse users.
const emitWarning = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const message = typeof warning === "string" ? warning : warning.message;
  if (message.includes("SQLite is an experimental feature")) return;
  // oxlint-disable-next-line typescript/no-explicit-any -- forwarding the overloads as given
  emitWarning(warning, ...(rest as any[]));
}) as typeof process.emitWarning;

const readStdin = async (): Promise<string> => {
  if (process.stdin.isTTY) {
    throw new UsageError("pipe the Markdown into stdin, as in: todo list import <key> < TODO.md");
  }
  return text(process.stdin);
};

// Not process.exit(), which would cut short output still flushing to a pipe.
process.exitCode = await runCli(
  process.argv.slice(2),
  { stdout: process.stdout, stderr: process.stderr, readStdin },
  { env: process.env, homedir: homedir() },
);
