import { type Command, DB_COMMANDS, ITEM_COMMANDS, LIST_COMMANDS } from "./commands.ts";
import type { OptionName } from "./options.ts";

const OPTION_HELP: Record<OptionName, string> = {
  list: "--list=<key>, -l      The List to work on (default: $TODO_LIST, or 'default')",
  section: "--section=<name>, -s  The Section",
  priority: "--priority=<p>, -p    The Priority: high, medium, low (none to clear or filter)",
  notes: "--notes=<text>, -n    The Item's longer notes",
  sort: "--sort=<s>            Order inside each Section: position (default) or priority",
  move: "--move=<m>            Move the Item within its Section: up, down, top, bottom",
  "no-ids": "--no-ids              Leave the Item IDs out",
  "remove-missing":
    "--remove-missing      Remove the Items the Markdown leaves out, and take its description",
  description: "--description=<text>  The List's description",
  all: "--all, -a             Include Done Items",
  "all-items": "--all-items           Every pending Item of the List",
  done: "--done, --done=true   Mark the Item done",
  "not-done": "--not-done, --done=false  Mark the Item pending",
  archived: "--archived            Include Archived Lists",
  force: "--force, -f           Also remove the List's Items",
  json: "--json                Print JSON (or set TODO_FORMAT=json)",
  color:
    "--color               Color the output even when it isn't a terminal (or set FORCE_COLOR=1)",
  "no-color": "--no-color            Don't color the output (or set NO_COLOR=1)",
  db: "--db=<url|path>       A postgres:// URL or SQLite file (default: $TODO_DATABASE_URL, or ~/.todo/todo.db)",
  "db-timeout":
    "--db-timeout=<s>      Seconds to wait to connect to PostgreSQL (default: $TODO_DATABASE_TIMEOUT, or 30)",
  "db-use-neon-serverless":
    "--db-use-neon-serverless  Connect to PostgreSQL with the Neon serverless driver, over WebSockets (or set TODO_USE_NEON_SERVERLESS=1)",
  help: "--help, -h            Show help",
  version: "--version, -v         Show the version",
};

const GLOBAL_OPTIONS: readonly OptionName[] = [
  "json",
  "color",
  "no-color",
  "db",
  "db-timeout",
  "db-use-neon-serverless",
  "help",
];

const commandLines = (prefix: string, commands: readonly Command[]): string[] => {
  const names = commands.map(command =>
    [`${prefix}${command.name}`, ...command.aliases].join(", "),
  );
  const width = Math.max(...names.map(name => name.length));
  return commands.map((command, i) => `  ${names[i]!.padEnd(width)}  ${command.summary}`);
};

const GENERAL_HELP = `todo: a to-do list for coding agents

Usage: todo [<command>] [<arguments>] [options]

Item commands, on the List from --list, $TODO_LIST, or 'default':
${commandLines("", ITEM_COMMANDS).join("\n")}

List commands:
${commandLines("list ", LIST_COMMANDS).join("\n")}

Database commands:
${commandLines("db ", DB_COMMANDS).join("\n")}

Options for every command:
${GLOBAL_OPTIONS.map(name => `  ${OPTION_HELP[name]}`).join("\n")}
  ${OPTION_HELP.version}

Run 'todo <command> --help' for a command's options, and 'todo guide' for a
guide to using todo from an agent.
`;

const commandHelp = (prefix: string, command: Command): string => {
  const aliases = command.aliases.length === 0 ? "" : `\nAliases: ${command.aliases.join(", ")}\n`;
  const options = [...command.options, ...GLOBAL_OPTIONS]
    .map(name => `  ${OPTION_HELP[name]}`)
    .join("\n");
  return `Usage: todo ${prefix}${command.name} ${command.usage}\n\n${command.summary}\n${aliases}\nOptions:\n${options}\n`;
};

const groupHelp = (group: string, commands: readonly Command[]): string =>
  `Usage: todo ${group} <command> [<arguments>] [options]\n\n${commandLines(`${group} `, commands).join("\n")}\n`;

export { GENERAL_HELP, GLOBAL_OPTIONS, commandHelp, groupHelp };
