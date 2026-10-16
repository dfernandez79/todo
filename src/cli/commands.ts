import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describeDatabase } from "../db/connect.ts";
import { TodoError, UsageError } from "../errors.ts";
import {
  type ItemChanges,
  type ItemFilter,
  addItem,
  buildPrompt,
  copyItems,
  editItem,
  getItems,
  listItems,
  markAllDone,
  markDone,
  moveItems,
  removeItems,
  todoList,
} from "../items.ts";
import {
  archiveList,
  cleanupList,
  copyList,
  createList,
  editList,
  exportList,
  getListSummary,
  type ImportResult,
  importEditedList,
  importList,
  listLists,
  listMarkdownToEdit,
  moveList,
  removeList,
  showList,
  unarchiveList,
} from "../lists.ts";
import { type StoreOptions, type TodoStore, migrateStore, storeStatus } from "../store.ts";
import { type Priority, parseItemMove, parseItemSort, parsePriority } from "../types.ts";
import type { OptionName, OptionValues } from "./options.ts";
import {
  renderAdded,
  renderItems,
  renderItemsChanged,
  renderItemsDetails,
  renderListWithItems,
  renderLists,
  renderSummary,
} from "./render.ts";
import type { Style } from "./style.ts";

type CommandContext = {
  /** The positional arguments after the command's name. */
  args: string[];
  values: OptionValues;
  /** How text output looks; plain unless it goes to a terminal that takes color. */
  style: Style;
  /** The List Key from `--list`, `TODO_LIST`, or the default. */
  listKey: string;
  /** The database from `--db`, `TODO_DATABASE_URL`, or the default. */
  database: string;
  /** Opens the database once; `overrides` count only on the first call. */
  openStore: (overrides?: Pick<StoreOptions, "autoMigrate">) => Promise<TodoStore>;
  readStdin: () => Promise<string>;
  /** Opens a file in the user's editor, returning once they close it. */
  openEditor: (file: string) => Promise<void>;
};

/** What a command prints: `text`, or `json` in JSON mode. Without `json`, always `text`. */
type CommandResult = { text: string; json?: unknown };

type Command = {
  name: string;
  aliases: readonly string[];
  /** The arguments, after `todo <name>`. */
  usage: string;
  summary: string;
  options: readonly OptionName[];
  run: (context: CommandContext) => Promise<CommandResult>;
};

const ITEM_ID = /^#?(\d+)$/;

const parseItemId = (arg: string): number => {
  const match = ITEM_ID.exec(arg);
  if (match === null) throw new UsageError(`'${arg}' is not an item ID`);
  return Number(match[1]);
};

const parseItemIds = (args: readonly string[]): number[] => {
  if (args.length === 0) throw new UsageError("give at least one item ID");
  return args.map(parseItemId);
};

const noArgs = (args: readonly string[]) => {
  if (args.length > 0) throw new UsageError(`unexpected argument '${args[0]}'`);
};

const oneArg = (args: readonly string[], what: string): string => {
  const [first, extra] = args;
  if (first === undefined) throw new UsageError(`missing ${what}`);
  if (extra !== undefined) throw new UsageError(`unexpected argument '${extra}'`);
  return first;
};

const twoArgs = (args: readonly string[], first: string, second: string): [string, string] => {
  const [a, b, extra] = args;
  if (a === undefined) throw new UsageError(`missing ${first}`);
  if (b === undefined) throw new UsageError(`missing ${second}`);
  if (extra !== undefined) throw new UsageError(`unexpected argument '${extra}'`);
  return [a, b];
};

/** Several words without quotes are one description. */
const joinWords = (args: readonly string[]) => args.join(" ");

const priorityFilter = (value: string | undefined): Priority | "none" | undefined => {
  if (value === undefined) return undefined;
  return value.toLowerCase() === "none" ? "none" : parsePriority(value);
};

const itemFilter = (values: OptionValues): ItemFilter => ({
  all: values.all,
  section: values.section,
  priority: priorityFilter(values.priority),
  sort: values.sort === undefined ? undefined : parseItemSort(values.sort),
});

const withStore = async <T>(context: CommandContext, work: (store: TodoStore) => Promise<T>) =>
  work(await context.openStore());

const itemsCommand: Command = {
  name: "items",
  aliases: ["ls"],
  usage:
    "[--all] [--section=<name>] [--priority=<high|medium|low|none>] [--sort=<position|priority>] [--no-ids]",
  summary: "List the pending Items, or all of them with --all. The default command.",
  options: ["list", "all", "section", "priority", "sort", "no-ids"],
  run: context =>
    withStore(context, async store => {
      noArgs(context.args);
      const items = await listItems(todoList(store, context.listKey), itemFilter(context.values));
      const text = renderItems(context.listKey, items, [], {
        ids: context.values["no-ids"] !== true,
        style: context.style,
      });
      return { text, json: { list: context.listKey, items } };
    }),
};

const ITEM_COMMANDS: readonly Command[] = [
  {
    name: "add",
    aliases: ["a"],
    usage: "<description> [--section=<name>] [--priority=<high|medium|low>] [--notes=<text>]",
    summary: "Add an Item. Creates the List if it doesn't exist.",
    options: ["list", "section", "priority", "notes"],
    run: context =>
      withStore(context, async store => {
        if (context.args.length === 0) throw new UsageError("missing the item description");
        const { section, priority, notes } = context.values;
        const item = await addItem(todoList(store, context.listKey), joinWords(context.args), {
          section,
          priority: priority === undefined ? undefined : parsePriority(priority),
          notes,
        });
        return { text: renderAdded(item, context.style), json: item };
      }),
  },
  {
    name: "remove",
    aliases: ["rm"],
    usage: "<id>...",
    summary: "Remove Items.",
    options: ["list"],
    run: context =>
      withStore(context, async store => {
        const removed = await removeItems(
          todoList(store, context.listKey),
          parseItemIds(context.args),
        );
        return {
          text: renderItemsChanged("Removed:", removed, context.style),
          json: { list: context.listKey, removed },
        };
      }),
  },
  {
    name: "done",
    aliases: ["d", "x"],
    usage: "<id>... | --section=<name> | --all-items",
    summary: "Mark Items done: by ID, every pending Item of a Section, or of the whole List.",
    options: ["list", "section", "all-items"],
    run: context =>
      withStore(context, async store => {
        const list = todoList(store, context.listKey);
        const { section } = context.values;
        const allItems = context.values["all-items"] === true;
        const ways = [context.args.length > 0, section !== undefined, allItems].filter(Boolean);
        if (ways.length !== 1) {
          throw new UsageError("give item IDs, --section=<name>, or --all-items (only one)");
        }
        const items =
          context.args.length > 0
            ? await markDone(list, parseItemIds(context.args))
            : await markAllDone(list, { section });
        return {
          text: renderItemsChanged("Marked done:", items, context.style),
          json: { list: context.listKey, items },
        };
      }),
  },
  {
    name: "edit",
    aliases: ["e"],
    usage:
      "[<id> [<description>] [--section=<name>] [--priority=<high|medium|low|none>] [--notes=<text>] [--done | --not-done] [--move=<up|down|top|bottom>]]",
    summary:
      'Change an Item. --section="" and --notes="" clear them; --priority=none clears it. --move moves it within its Section. Without an <id>, edit the whole List as Markdown in $VISUAL or $EDITOR.',
    options: ["list", "section", "priority", "notes", "done", "not-done", "move"],
    run: context => {
      const { values } = context;
      const changeOptions = [values.section, values.priority, values.notes, values.move];
      const noOptions =
        changeOptions.every(value => value === undefined) &&
        values.done !== true &&
        values["not-done"] !== true;
      if (context.args.length === 0 && noOptions) return editMarkdown(context);
      return withStore(context, async store => {
        const [id, ...words] = context.args;
        if (id === undefined) throw new UsageError("missing the item ID");
        if (values.done === true && values["not-done"] === true) {
          throw new UsageError("--done and --not-done conflict");
        }
        const changes: ItemChanges = {
          description: words.length > 0 ? joinWords(words) : undefined,
          section: values.section,
          priority: priorityFilter(values.priority),
          notes: values.notes,
          done: values.done === true ? true : values["not-done"] === true ? false : undefined,
          move: values.move === undefined ? undefined : parseItemMove(values.move),
        };
        if (Object.values(changes).every(value => value === undefined)) {
          throw new UsageError("nothing to change: give a description or an option");
        }
        const item = await editItem(todoList(store, context.listKey), parseItemId(id), changes);
        return { text: renderItemsDetails([item], context.style), json: item };
      });
    },
  },
  itemsCommand,
  {
    name: "show",
    aliases: [],
    usage: "<id>...",
    summary: "Show the details of Items, including their notes.",
    options: ["list"],
    run: context =>
      withStore(context, async store => {
        const items = await getItems(todoList(store, context.listKey), parseItemIds(context.args));
        return {
          text: renderItemsDetails(items, context.style),
          json: { list: context.listKey, items },
        };
      }),
  },
  {
    name: "copy",
    aliases: ["cp"],
    usage: "<id>... <target-list>",
    summary: "Copy Items to another List, merging Duplicate Items. Copies get new IDs.",
    options: ["list"],
    run: context => transfer(context, false),
  },
  {
    name: "move",
    aliases: ["mv"],
    usage: "<id>... <target-list>",
    summary: "Like copy, then remove the source Items.",
    options: ["list"],
    run: context => transfer(context, true),
  },
  {
    name: "prompt",
    aliases: [],
    usage: "[<id>...] [--section=<name>] [--sort=<position|priority>]",
    summary: "Print a task brief for an agent from the pending Items, or the selected ones.",
    options: ["list", "section", "sort"],
    run: context =>
      withStore(context, async store => ({
        text: await buildPrompt(todoList(store, context.listKey), {
          ids: context.args.map(parseItemId),
          section: context.values.section,
          sort: itemFilter(context.values).sort,
        }),
      })),
  },
  {
    name: "export",
    aliases: [],
    usage: "[--no-ids] > TODO.md",
    summary: "Like `list export`, on the List from --list, $TODO_LIST, or 'default'.",
    options: ["list", "no-ids"],
    run: context => {
      noArgs(context.args);
      return exportMarkdown(context, context.listKey);
    },
  },
  {
    name: "import",
    aliases: [],
    usage: "[--remove-missing] < TODO.md",
    summary: "Like `list import`, on the List from --list, $TODO_LIST, or 'default'.",
    options: ["list", "remove-missing"],
    run: context => {
      noArgs(context.args);
      return importMarkdown(context, context.listKey);
    },
  },
];

const imported = (key: string, { items, removed }: ImportResult): CommandResult => ({
  text: `Imported ${items.length} items into ${key}, removed ${removed.length}\n`,
  json: { list: key, items, removed },
});

const importMarkdown = (context: CommandContext, key: string) =>
  withStore(context, async store => {
    const markdown = await context.readStdin();
    const removeMissing = context.values["remove-missing"] === true;
    return imported(key, await importList(store, key, markdown, { removeMissing }));
  });

/**
 * Opens the List's Markdown in the editor and imports the edits with
 * --remove-missing. If they can't be imported, the file is kept for the user.
 */
const editMarkdown = (context: CommandContext) =>
  withStore(context, async store => {
    const key = context.listKey;
    const original = await listMarkdownToEdit(store, key);
    const dir = await mkdtemp(join(tmpdir(), "todo-edit-"));
    const file = join(dir, `${key}.md`);
    let keep = false;
    try {
      await writeFile(file, original);
      await context.openEditor(file);
      const edited = await readFile(file, "utf8");
      if (edited === original) {
        return { text: `No changes to ${key}\n`, json: { list: key, items: [], removed: [] } };
      }
      try {
        return imported(key, await importEditedList(store, key, original, edited));
      } catch (error) {
        if (!(error instanceof TodoError)) throw error;
        keep = true;
        throw new TodoError(error.code, `${error.message}; the edits are kept in ${file}`);
      }
    } finally {
      if (!keep) await rm(dir, { recursive: true, force: true });
    }
  });

const exportMarkdown = (context: CommandContext, key: string) =>
  withStore(context, async store => ({
    text: await exportList(store, key, { ids: context.values["no-ids"] !== true }),
  }));

const transfer = (context: CommandContext, move: boolean) =>
  withStore(context, async store => {
    const target = context.args.at(-1);
    const ids = context.args.slice(0, -1);
    if (target === undefined || ids.length === 0) {
      throw new UsageError("give item IDs and then the target list");
    }
    if (ITEM_ID.test(target)) throw new UsageError("the last argument must be the target list");
    const list = todoList(store, context.listKey);
    const items = await (move ? moveItems : copyItems)(list, parseItemIds(ids), target);
    const verb = move ? "Moved" : "Copied";
    return {
      text: renderItemsChanged(`${verb} to ${target}:`, items, context.style),
      json: { list: target, items },
    };
  });

const LIST_COMMANDS: readonly Command[] = [
  {
    name: "add",
    aliases: [],
    usage: "<key> [--description=<text>]",
    summary: "Create an empty List.",
    options: ["description"],
    run: context =>
      withStore(context, async store => {
        const key = oneArg(context.args, "the list key");
        const list = await createList(store, key, { description: context.values.description });
        return { text: `Created list ${list.key}\n`, json: list };
      }),
  },
  {
    name: "ls",
    aliases: [],
    usage: "[--archived]",
    summary: "List the Lists, with Archived Lists if --archived.",
    options: ["archived"],
    run: context =>
      withStore(context, async store => {
        noArgs(context.args);
        const lists = await listLists(store, { archived: context.values.archived });
        return { text: renderLists(lists), json: { lists } };
      }),
  },
  {
    name: "show",
    aliases: [],
    usage:
      "<key> [--all] [--section=<name>] [--priority=<high|medium|low|none>] [--sort=<position|priority>]",
    summary: "Show a List's description and Items. Works on Archived Lists.",
    options: ["all", "section", "priority", "sort"],
    run: context =>
      withStore(context, async store => {
        const key = oneArg(context.args, "the list key");
        const { list, items } = await showList(store, key, itemFilter(context.values));
        return { text: renderListWithItems(list, items, context.style), json: { list, items } };
      }),
  },
  {
    name: "show-summary",
    aliases: [],
    usage: "<key>",
    summary: "Show a List's description and Item counts.",
    options: [],
    run: context =>
      withStore(context, async store => {
        const list = await getListSummary(store, oneArg(context.args, "the list key"));
        return { text: renderSummary(list), json: list };
      }),
  },
  {
    name: "remove",
    aliases: ["rm"],
    usage: "<key> [--force]",
    summary: "Remove a List. A List with Items needs --force, and its Items go with it.",
    options: ["force"],
    run: context =>
      withStore(context, async store => {
        const key = oneArg(context.args, "the list key");
        const removed = await removeList(store, key, { force: context.values.force });
        return { text: `Removed list ${removed.key}\n`, json: { removed } };
      }),
  },
  {
    name: "archive",
    aliases: [],
    usage: "<key>",
    summary: "Archive a List: its Items can't be used until it's unarchived.",
    options: [],
    run: context =>
      withStore(context, async store => {
        const list = await archiveList(store, oneArg(context.args, "the list key"));
        return { text: `Archived list ${list.key}\n`, json: list };
      }),
  },
  {
    name: "unarchive",
    aliases: [],
    usage: "<key>",
    summary: "Unarchive a List.",
    options: [],
    run: context =>
      withStore(context, async store => {
        const list = await unarchiveList(store, oneArg(context.args, "the list key"));
        return { text: `Unarchived list ${list.key}\n`, json: list };
      }),
  },
  {
    name: "edit",
    aliases: ["e"],
    usage: "<key> --description=<text>",
    summary: 'Change a List\'s description; --description="" clears it.',
    options: ["description"],
    run: context =>
      withStore(context, async store => {
        const key = oneArg(context.args, "the list key");
        if (context.values.description === undefined) {
          throw new UsageError("nothing to change: give --description");
        }
        const list = await editList(store, key, { description: context.values.description });
        return { text: renderSummary(list), json: list };
      }),
  },
  {
    name: "import",
    aliases: [],
    usage: "<key> [--remove-missing] < TODO.md",
    summary:
      "Merge a Markdown task list from stdin into a List, creating it if missing. Lines with this List's Item IDs update those Items. --remove-missing removes the Items it leaves out.",
    options: ["remove-missing"],
    run: context => importMarkdown(context, oneArg(context.args, "the list key")),
  },
  {
    name: "export",
    aliases: [],
    usage: "<key> [--no-ids] > TODO.md",
    summary:
      "Print a List as a Markdown task list, with Item IDs unless --no-ids. Always Markdown, even in JSON mode.",
    options: ["no-ids"],
    run: context => exportMarkdown(context, oneArg(context.args, "the list key")),
  },
  {
    name: "copy",
    aliases: ["cp"],
    usage: "<from> <to>",
    summary: "Copy a List's Items on top of another List, merging Duplicate Items.",
    options: [],
    run: context =>
      withStore(context, async store => {
        const [from, to] = twoArgs(context.args, "the source list", "the target list");
        const list = await copyList(store, from, to);
        return { text: `Copied ${from} to ${to}\n${renderSummary(list)}`, json: list };
      }),
  },
  {
    name: "move",
    aliases: ["mv"],
    usage: "<from> <to>",
    summary:
      "Rename a List if <to> doesn't exist (keeping Item IDs); otherwise copy it on top of <to> and remove it.",
    options: [],
    run: context =>
      withStore(context, async store => {
        const [from, to] = twoArgs(context.args, "the source list", "the target list");
        const list = await moveList(store, from, to);
        return { text: `Moved ${from} to ${to}\n${renderSummary(list)}`, json: list };
      }),
  },
  {
    name: "cleanup",
    aliases: [],
    usage: "<key>",
    summary: "Merge the Duplicate Items of a List into the oldest one.",
    options: [],
    run: context =>
      withStore(context, async store => {
        const key = oneArg(context.args, "the list key");
        const removed = await cleanupList(store, key);
        return {
          text: renderItemsChanged("Merged duplicates, removing:", removed, context.style),
          json: { list: key, removed },
        };
      }),
  },
];

const DB_COMMANDS: readonly Command[] = [
  {
    name: "migrate",
    aliases: [],
    usage: "",
    summary: "Run the pending database migrations. Needed only with TODO_NO_AUTO_MIGRATE=1.",
    options: [],
    run: context =>
      withStore(context, async store => {
        noArgs(context.args);
        await migrateStore(store);
        return { text: "Database is up to date.\n", json: { migrated: true } };
      }),
  },
  {
    name: "ping",
    aliases: [],
    usage: "",
    summary:
      "Test the database connection: connect, then report the driver, the server version and the pending migrations, without running them.",
    options: [],
    run: async context => {
      noArgs(context.args);
      const started = Date.now();
      const store = await context.openStore({ autoMigrate: false });
      const connectMs = Date.now() - started;
      const status = await storeStatus(store);
      const database = describeDatabase(context.database);
      const { pendingMigrations } = status;
      const migrations =
        pendingMigrations.length === 0
          ? "up to date"
          : `${pendingMigrations.length} pending (${pendingMigrations.join(", ")}); run 'todo db migrate'`;
      return {
        text: `Connected to ${database} in ${connectMs} ms\nDriver: ${status.driver}\nServer: ${status.server}\nMigrations: ${migrations}\n`,
        json: { database, connectMs, ...status },
      };
    },
  },
];

/** Commands that hold other commands, such as `todo list add`. */
const GROUPS: Record<string, readonly Command[]> = { list: LIST_COMMANDS, db: DB_COMMANDS };

const findCommand = (commands: readonly Command[], name: string): Command | undefined =>
  commands.find(command => command.name === name || command.aliases.includes(name));

export {
  type Command,
  type CommandContext,
  type CommandResult,
  DB_COMMANDS,
  GROUPS,
  ITEM_COMMANDS,
  LIST_COMMANDS,
  findCommand,
  itemsCommand,
};
