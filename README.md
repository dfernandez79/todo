# todo

A to-do list for coding agents. It stores lists of items in SQLite or
PostgreSQL, and every command can output JSON, allowing an agent to read its
work queue, brief itself, and mark items as done as it goes.

## Install

`todo` runs on Node.js 22.16 or later, or on Bun. Run it without installing:

```bash
npx @diegoux/todo add 'Fix login'
# or
bunx @diegoux/todo add 'Fix login'
```

Or install it globally:

```bash
npm install -g @diegoux/todo
# or
bun add -g @diegoux/todo
```

To use the TypeScript API, add it to a project:

```bash
npm install @diegoux/todo
# or
bun add @diegoux/todo
```

## Usage

```bash
todo add 'Fix login' --section='01 - UI' --priority=high --notes='Fails on Safari'
todo                       # list the pending Items of the default List
todo ls --all              # include done Items
todo show 3                # an Item's details, with its notes
todo done 3 5              # mark Items done
todo edit 3 --priority=low --section=Backlog
todo prompt --section='01 - UI'   # a task brief for an agent
todo cp 3 5 proj-2         # copy Items to another List
todo list export proj-1 > TODO.md
todo list import proj-1 < TODO.md
todo guide                 # the usage guide for agents
todo --help
```

Item commands operate on the list specified by `--list`, then on `$TODO_LIST`,
then on the list named `default`. Writing to a non-existent list creates it.
Reading a list fails, except for `default`, which reads as empty.

Items are identified by their ID (`3` or `#3`). Each ID is a number unique
within the List. It never changes or gets reused, even after you delete an item.

## Commands

### Items

| Command               | Alias    | Does                                                                                |
| --------------------- | -------- | ----------------------------------------------------------------------------------- |
| `add <description>`   | `a`      | Add an Item. Takes `--section`, `--priority`, `--notes`.                            |
| `items`               | `ls`     | List pending Items. The default command. Takes `--all`, `--section`, `--priority`.  |
| `show <id>...`        |          | Show Items with their notes.                                                        |
| `edit <id> [<desc>]`  | `e`      | Change an Item. Takes `--section`, `--priority`, `--notes`, `--done`, `--not-done`. |
| `done <id>...`        | `d`, `x` | Mark Items done. `--section=<name>` or `--all-items` mark many.                     |
| `remove <id>...`      | `rm`     | Remove Items.                                                                       |
| `copy <id>... <list>` | `cp`     | Copy Items to another List. Copies get new IDs.                                     |
| `move <id>... <list>` | `mv`     | Copy, then remove the source Items.                                                 |
| `prompt [<id>...]`    |          | Print a task brief of the pending Items. Takes `--section`.                         |
| `guide`               |          | Print the usage guide for agents.                                                   |

In `edit`, `--section=""` and `--notes=""` clear the field, and
`--priority=none` clears the Priority. `--done=true` and `--done=false` also
work.

### Lists

| Command                   | Does                                                                         |
| ------------------------- | ---------------------------------------------------------------------------- |
| `list ls [--archived]`    | List the Lists with their counts.                                            |
| `list add <key>`          | Create an empty List. Takes `--description`.                                 |
| `list show <key>`         | Show a List and its Items. Takes the same filters as `ls`.                   |
| `list show-summary <key>` | Show a List's description and counts.                                        |
| `list edit <key>`         | Change the description with `--description`.                                 |
| `list archive <key>`      | Archive a List. Its Items can't be used until it's unarchived.               |
| `list unarchive <key>`    | Unarchive a List.                                                            |
| `list rm <key> [--force]` | Remove a List. A List with Items needs `--force`.                            |
| `list copy <from> <to>`   | Copy a List's Items on top of another List.                                  |
| `list mv <from> <to>`     | Rename a List if `<to>` doesn't exist; otherwise copy onto it and remove it. |
| `list cleanup <key>`      | Merge the List's Duplicate Items.                                            |
| `list export <key>`       | Print the List as a Markdown task list.                                      |
| `list import <key>`       | Merge a Markdown task list from stdin into the List.                         |
| `db migrate`              | Run database migrations. Needed only with `TODO_NO_AUTO_MIGRATE=1`.          |

Run `todo <command> --help` for a command's options.

### Merging Duplicate Items

Copying, moving, importing, and `list cleanup` merge Duplicate Items the same
way:

- The item that was in the list first keeps its ID.
- The higher Priority wins.
- The result stays pending unless both Items are done.
- Notes that differ are appended.

## Configuration

| Setting      | Flag     | Environment variable     | Default           |
| ------------ | -------- | ------------------------ | ----------------- |
| Database     | `--db`   | `TODO_DATABASE_URL`      | `~/.todo/todo.db` |
| Default list | `--list` | `TODO_LIST`              | `default`         |
| JSON output  | `--json` | `TODO_FORMAT=json`       | text              |
| Migrations   |          | `TODO_NO_AUTO_MIGRATE=1` | run on start      |

A database value starting with `postgres://` or `postgresql://` indicates
PostgreSQL; anything else is a SQLite file path. On PostgreSQL, the tables are
prefixed with `todo_` so they can share a database with other applications.

To set up an agent's environment, such as Claude Code on the web, export
`TODO_DATABASE_URL`, `TODO_LIST` and `TODO_FORMAT=json` once.

## Output

Text is the default. With `--json` or `TODO_FORMAT=json`, each command prints
one JSON value: `todo ls` prints `{"list": "<key>", "items": [...]}`, `todo add`
prints the new Item, and so on. `todo guide` lists every shape.

`todo prompt`, `todo list export`, `todo guide` and `--help` always print text.

## Markdown

`list export` writes, and `list import` reads, GitHub-flavored task lists:

```markdown
# proj-1

Optional List description.

- [ ] Item without a Section (!high) Notes are indented under the Item.

## 01 - UI

- [ ] Pending Item (!low)
- [x] Done Item
```

The file has no Item IDs. Importing merges into the List and never removes
Items. The file's description is used only if the List has none.

## Exit codes

| Code | Meaning                                                                             |
| ---- | ----------------------------------------------------------------------------------- |
| 0    | Success, and `--help`.                                                              |
| 1    | The command failed: a List or Item not found, an Archived List, invalid input, etc. |
| 2    | Usage error: an unknown command or option, or missing arguments.                    |

In JSON mode, errors print `{"error": {"code": "...", "message": "..."}}` on
stdout. Otherwise they print on stderr.

## TypeScript API

The package also exports the same operations as functions:

```typescript
import { addItem, listItems, todoList, todoListStore } from "@diegoux/todo";

// a postgres:// URL or a SQLite file path; runs pending migrations
const store = await todoListStore("/path/to/todo.db");
try {
  const list = todoList(store, "proj-1");
  await addItem(list, "New Description", { priority: "high" });
  console.log(await listItems(list));
} finally {
  await store.close();
}
```

## Development

The project uses Bun for development. To build `todo` from source and put it on
your PATH:

```bash
bun install
bun run build
bun link
```

`bun run build` bundles it into `dist/` with [bunup](https://bunup.dev), and
`bun link` puts `todo` on your PATH. Without it, run `node dist/todo.js` with
the same arguments, or skip the build and run `bun run src/todo.ts`.

## Tests

```bash
bun test           # SQLite and PostgreSQL; needs Docker
bun run test:unit  # SQLite only, no Docker
```

Both also build the package and run its command on the Node.js in your PATH.
Without Node.js, those tests are skipped.

## License

[MIT](LICENSE)
