import { join } from "node:path";

import { TodoError, UsageError } from "../errors.ts";
import { type TodoStore, todoListStore } from "../store.ts";
import { parseListKey } from "../types.ts";
import { type Command, GROUPS, ITEM_COMMANDS, findCommand, itemsCommand } from "./commands.ts";
import { GUIDE } from "./guide.ts";
import { GENERAL_HELP, GLOBAL_OPTIONS, commandHelp, groupHelp } from "./help.ts";
import { type OptionValues, parseArgv } from "./options.ts";
import { styleFor } from "./style.ts";

/** Where the command writes: `process.stdout` and `process.stderr`, or a test's capture. */
type Output = {
  write: (text: string) => unknown;
  /** Whether it's a terminal, which gets color by default. */
  isTTY?: boolean;
};

type CliIo = {
  stdout: Output;
  stderr: Output;
  /** All of stdin, for `todo list import`. */
  readStdin: () => Promise<string>;
  /** Runs an editor command, such as `code --wait`, on a file, returning its exit code. */
  runEditor: (command: string, file: string) => Promise<number>;
};

type CliSystem = {
  env: Readonly<Record<string, string | undefined>>;
  homedir: string;
};

/** A command to run, or the text to print instead (help, the guide). */
type Resolved =
  | { kind: "command"; command: Command; prefix: string; args: string[] }
  | { kind: "text"; text: string };

const helpFor = (topic: readonly string[]): string => {
  const [name, sub] = topic;
  if (name === undefined) return GENERAL_HELP;
  const group = GROUPS[name];
  if (group !== undefined) {
    const command = sub === undefined ? undefined : findCommand(group, sub);
    if (command !== undefined) return commandHelp(`${name} `, command);
    if (sub === undefined) return groupHelp(name, group);
    throw new UsageError(`unknown command '${name} ${sub}'`);
  }
  const command = findCommand(ITEM_COMMANDS, name);
  if (command === undefined) throw new UsageError(`unknown command '${name}'`);
  return commandHelp("", command);
};

const resolveCommand = (positionals: readonly string[], help: boolean): Resolved => {
  const [name, ...rest] = positionals;
  if (name === undefined) {
    return help
      ? { kind: "text", text: GENERAL_HELP }
      : { kind: "command", command: itemsCommand, prefix: "", args: [] };
  }
  if (name === "help") return { kind: "text", text: helpFor(rest) };
  if (name === "guide") return { kind: "text", text: help ? helpFor([]) : GUIDE };
  if (help) return { kind: "text", text: helpFor(positionals.slice(0, 2)) };

  const group = GROUPS[name];
  if (group !== undefined) {
    const [sub, ...args] = rest;
    if (sub === undefined) return { kind: "text", text: groupHelp(name, group) };
    const command = findCommand(group, sub);
    if (command === undefined) throw new UsageError(`unknown command '${name} ${sub}'`);
    return { kind: "command", command, prefix: `${name} `, args };
  }
  const command = findCommand(ITEM_COMMANDS, name);
  if (command === undefined) throw new UsageError(`unknown command '${name}'`);
  return { kind: "command", command, prefix: "", args: rest };
};

const checkOptions = (command: Command, prefix: string, given: readonly string[]) => {
  const allowed = new Set<string>([...command.options, ...GLOBAL_OPTIONS]);
  const unknown = given.find(name => !allowed.has(name));
  if (unknown !== undefined) {
    throw new UsageError(`--${unknown} is not an option of 'todo ${prefix}${command.name}'`);
  }
};

const nonEmpty = (value: string | undefined) => (value === "" ? undefined : value);

const resolveDatabase = (values: OptionValues, system: CliSystem): string => {
  if (values.db === "") throw new UsageError("--db cannot be empty");
  const database =
    values.db ?? nonEmpty(system.env.TODO_DATABASE_URL) ?? join(system.homedir, ".todo", "todo.db");
  return database.startsWith("~/") ? join(system.homedir, database.slice(2)) : database;
};

/**
 * The PostgreSQL connection timeout in seconds, from `--db-timeout`,
 * then `TODO_DATABASE_TIMEOUT`, or undefined for the default.
 */
const resolveConnectTimeout = (values: OptionValues, env: CliSystem["env"]): number | undefined => {
  const [source, text] =
    values["db-timeout"] === undefined
      ? ["TODO_DATABASE_TIMEOUT", nonEmpty(env.TODO_DATABASE_TIMEOUT)]
      : ["--db-timeout", values["db-timeout"]];
  if (text === undefined) return undefined;
  const seconds = Number(text);
  if (text.trim() === "" || !Number.isFinite(seconds) || seconds <= 0) {
    throw new UsageError(`${source} must be a positive number of seconds, got '${text}'`);
  }
  return seconds;
};

const resolveJson = (values: OptionValues, env: CliSystem["env"]): boolean => {
  const format = nonEmpty(env.TODO_FORMAT);
  if (format !== undefined && format !== "json" && format !== "text") {
    throw new UsageError(`TODO_FORMAT must be json or text, got '${format}'`);
  }
  return values.json === true || format === "json";
};

/**
 * Color goes only to text output: `--no-color`, then `--color`, then
 * `NO_COLOR`, then `FORCE_COLOR` decide, and otherwise whether stdout is a terminal.
 */
const resolveColor = (values: OptionValues, env: CliSystem["env"], stdout: Output): boolean => {
  if (values["no-color"] === true) return false;
  if (values.color === true) return true;
  if (nonEmpty(env.NO_COLOR) !== undefined) return false;
  const force = nonEmpty(env.FORCE_COLOR);
  if (force !== undefined) return force !== "0";
  return stdout.isTTY === true;
};

/** Opens a file in `$VISUAL`, or else `$EDITOR`; EDITOR_FAILED if it exits with an error. */
const openEditor = async (file: string, io: CliIo, env: CliSystem["env"]): Promise<void> => {
  const command = nonEmpty(env.VISUAL) ?? nonEmpty(env.EDITOR);
  if (command === undefined) throw new UsageError("set $VISUAL or $EDITOR to edit a List");
  const code = await io.runEditor(command, file);
  if (code !== 0) {
    throw new TodoError("EDITOR_FAILED", `the editor '${command}' exited with code ${code}`);
  }
};

const errorBody = (error: unknown): { code: string; message: string } => {
  if (error instanceof UsageError) return { code: "USAGE", message: error.message };
  if (error instanceof TodoError) return { code: error.code, message: error.message };
  return { code: "INTERNAL", message: error instanceof Error ? error.message : String(error) };
};

/** Reports an error once, on stdout as JSON in JSON mode, else on stderr. */
const report = (error: unknown, json: boolean, io: CliIo): number => {
  const body = errorBody(error);
  if (json) io.stdout.write(`${JSON.stringify({ error: body }, undefined, 2)}\n`);
  else {
    const hint = error instanceof UsageError ? "\nRun 'todo --help' for usage.\n" : "\n";
    io.stderr.write(`todo: ${body.message}${hint}`);
  }
  return error instanceof UsageError ? 2 : 1;
};

/** Runs the `todo` command line, returning its exit code. */
const runCli = async (argv: readonly string[], io: CliIo, system: CliSystem): Promise<number> => {
  let json = system.env.TODO_FORMAT === "json";
  let store: TodoStore | undefined;
  try {
    const { positionals, values, given } = parseArgv(argv);
    json = resolveJson(values, system.env);
    const resolved = resolveCommand(positionals, values.help === true);
    if (resolved.kind === "text") {
      io.stdout.write(resolved.text);
      return 0;
    }
    const { command, prefix, args } = resolved;
    checkOptions(command, prefix, given);
    const database = resolveDatabase(values, system);
    const connectTimeout = resolveConnectTimeout(values, system.env);
    const autoMigrate = system.env.TODO_NO_AUTO_MIGRATE !== "1";
    const usesList = command.options.includes("list");
    const result = await command.run({
      args,
      values,
      style: styleFor(!json && resolveColor(values, system.env, io.stdout)),
      listKey: usesList
        ? parseListKey(values.list ?? nonEmpty(system.env.TODO_LIST) ?? "default")
        : "default",
      openStore: async () => {
        store ??= await todoListStore(database, { autoMigrate, connectTimeout });
        return store;
      },
      readStdin: io.readStdin,
      openEditor: file => openEditor(file, io, system.env),
    });
    io.stdout.write(
      json && result.json !== undefined
        ? `${JSON.stringify(result.json, undefined, 2)}\n`
        : result.text,
    );
    return 0;
  } catch (error) {
    return report(error, json, io);
  } finally {
    await store?.close();
  }
};

export { type CliIo, type CliSystem, type Output, runCli };
