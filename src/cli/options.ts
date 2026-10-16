import { type ParseArgsOptionsConfig, parseArgs } from "node:util";

import { UsageError } from "../errors.ts";

const OPTIONS = {
  list: { type: "string", short: "l" },
  section: { type: "string", short: "s" },
  priority: { type: "string", short: "p" },
  notes: { type: "string", short: "n" },
  sort: { type: "string" },
  move: { type: "string" },
  "no-ids": { type: "boolean" },
  "remove-missing": { type: "boolean" },
  description: { type: "string" },
  all: { type: "boolean", short: "a" },
  "all-items": { type: "boolean" },
  done: { type: "boolean" },
  "not-done": { type: "boolean" },
  archived: { type: "boolean" },
  force: { type: "boolean", short: "f" },
  json: { type: "boolean" },
  color: { type: "boolean" },
  "no-color": { type: "boolean" },
  db: { type: "string" },
  "db-timeout": { type: "string" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
} as const satisfies ParseArgsOptionsConfig;

type OptionName = keyof typeof OPTIONS;

type OptionValues = {
  [K in OptionName]?: (typeof OPTIONS)[K]["type"] extends "string" ? string : boolean;
};

type ParsedArgs = {
  positionals: string[];
  values: OptionValues;
  /** The options given, by name, to check them against the command's. */
  given: OptionName[];
};

/** `--done=true` and `--done=false` are spellings of `--done` and `--not-done`. */
const normalizeDoneFlag = (arg: string): string => {
  if (!arg.startsWith("--done=")) return arg;
  const value = arg.slice("--done=".length);
  if (value === "true") return "--done";
  if (value === "false") return "--not-done";
  throw new UsageError(`--done takes true or false, got '${value}'`);
};

const parseArgv = (argv: readonly string[]): ParsedArgs => {
  const terminator = argv.indexOf("--");
  const args = argv.map((arg, index) =>
    terminator !== -1 && index > terminator ? arg : normalizeDoneFlag(arg),
  );
  try {
    const { values, positionals, tokens } = parseArgs({
      args,
      options: OPTIONS,
      strict: true,
      allowPositionals: true,
      tokens: true,
    });
    const given = tokens.flatMap(token =>
      token.kind === "option" ? [token.name as OptionName] : [],
    );
    return { positionals, values, given };
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
};

export { OPTIONS, type OptionName, type OptionValues, type ParsedArgs, parseArgv };
