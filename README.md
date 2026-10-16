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

## Claude Code plugin

The repository is also a Claude Code plugin marketplace, with a skill that
teaches the agent to track a project's to-do list using this CLI. Add the
marketplace and install the plugin:

```bash
claude plugin marketplace add dfernandez79/todo
claude plugin install todo@todo
```

In Claude Desktop, use **Customize > Plugins > Add marketplace** with
`dfernandez79/todo`, then install `todo`.

The plugin has no `version`, so the latest commit is the version. To get a newer
one:

```bash
claude plugin marketplace update todo
claude plugin update todo@todo
```

For local development, add the marketplace from a clone instead, so the plugin
loads the skill in place: `claude plugin marketplace add ./` from the repository
root. Edits to `skill/SKILL.md` take effect at the next session start, or with
`/reload-plugins` in a running session.

## Usage

```bash
todo add 'Fix login' --section='01 - UI' --priority=high --notes='Fails on Safari'
todo                       # list the pending Items of the default List
todo ls --all              # include done Items
todo show 3                # an Item's details, with its notes
todo done 3 5              # mark Items done
todo edit 3 --priority=low --section=Backlog
todo edit 3 --move=up      # move an Item up within its Section
todo ls --sort=priority    # sort by Priority instead of Position
todo prompt --section='01 - UI'   # a task brief for an agent
todo cp 3 5 proj-2         # copy Items to another List
todo list export proj-1 > TODO.md
todo list import proj-1 < TODO.md
todo export > TODO.md      # same as list export, on the default List
todo import < TODO.md      # same as list import, on the default List
todo import --remove-missing < TODO.md   # also remove the Items the file leaves out
todo edit                  # edit the default List as Markdown in $VISUAL or $EDITOR
todo guide                 # the usage guide for agents
todo --help
```

Item commands operate on the list specified by `--list`, then on `$TODO_LIST`,
then on the list named `default`. Writing to a non-existent list creates it.
Reading a list fails, except for `default`, which reads as empty.

Items are identified by their ID (`3` or `#3`). Each ID is a number unique
within the List. It never changes or gets reused, even after you delete an item.

Each Item also has a Position: its place in the order you keep for the List.
`todo ls` shows Items by Section, then by Position. New Items go last, and
`todo edit <id> --move=up|down|top|bottom` moves an Item within its Section.

## Commands

### Items

| Command               | Alias    | Does                                                                                                     |
| --------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| `add <description>`   | `a`      | Add an Item. Takes `--section`, `--priority`, `--notes`.                                                 |
| `items`               | `ls`     | List pending Items. The default command. Takes `--all`, `--section`, `--priority`, `--sort`, `--no-ids`. |
| `show <id>...`        |          | Show Items with their notes.                                                                             |
| `edit <id> [<desc>]`  | `e`      | Change an Item. Takes `--section`, `--priority`, `--notes`, `--done`, `--not-done`, `--move`.            |
| `edit`                | `e`      | Edit the whole List as Markdown in `$VISUAL` or `$EDITOR`. See [Editing a List](#editing-a-list).        |
| `done <id>...`        | `d`, `x` | Mark Items done. `--section=<name>` or `--all-items` mark many.                                          |
| `remove <id>...`      | `rm`     | Remove Items.                                                                                            |
| `copy <id>... <list>` | `cp`     | Copy Items to another List. Copies get new IDs.                                                          |
| `move <id>... <list>` | `mv`     | Copy, then remove the source Items.                                                                      |
| `prompt [<id>...]`    |          | Print a task brief of the pending Items. Takes `--section`, `--sort`.                                    |
| `export`              |          | `list export` on the List from `--list`, `$TODO_LIST`, or `default`. Takes `--no-ids`.                   |
| `import`              |          | `list import` on that List. Takes `--remove-missing`.                                                    |
| `guide`               |          | Print the usage guide for agents.                                                                        |

In `edit`, `--section=""` and `--notes=""` clear the field, and
`--priority=none` clears the Priority. `--done=true` and `--done=false` also
work. A new Section puts the Item last in it. `--move` steps a pending Item over
Done Items, which `todo ls` hides, and doesn't change the Item's `updatedAt`.

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
| `list export <key>`       | Print the List as a Markdown task list. `--no-ids` leaves the Item IDs out.  |
| `list import <key>`       | Merge a Markdown task list from stdin. Takes `--remove-missing`.             |
| `db migrate`              | Run database migrations. Needed only with `TODO_NO_AUTO_MIGRATE=1`.          |
| `db ping`                 | Test the database connection: driver, server version, pending migrations.    |

Run `todo <command> --help` for a command's options.

### Merging Duplicate Items

Copying, moving, importing, and `list cleanup` merge Duplicate Items the same
way:

- The item that was in the list first keeps its ID.
- The higher Priority wins.
- The result stays pending unless both Items are done.
- Notes that differ are appended.

## Configuration

| Setting            | Flag                       | Environment variable          | Default           |
| ------------------ | -------------------------- | ----------------------------- | ----------------- |
| Database           | `--db`                     | `TODO_DATABASE_URL`           | `~/.todo/todo.db` |
| PG connect timeout | `--db-timeout=<s>`         | `TODO_DATABASE_TIMEOUT`       | 30 seconds        |
| Neon serverless    | `--db-use-neon-serverless` | `TODO_USE_NEON_SERVERLESS=1`  | off               |
| Default list       | `--list`                   | `TODO_LIST`                   | `default`         |
| JSON output        | `--json`                   | `TODO_FORMAT=json`            | text              |
| Color              | `--color`, `--no-color`    | `FORCE_COLOR=1`, `NO_COLOR=1` | on in a terminal  |
| Migrations         |                            | `TODO_NO_AUTO_MIGRATE=1`      | run on start      |

A database value starting with `postgres://` or `postgresql://` indicates
PostgreSQL; anything else is a SQLite file path. On PostgreSQL, the tables are
prefixed with `todo_` so they can share a database with other applications. The
connection timeout is the seconds to wait to connect to PostgreSQL; SQLite
ignores it.

PostgreSQL is reached with [postgres.js](https://github.com/porsager/postgres)
over TCP by default. `--db-use-neon-serverless` or `TODO_USE_NEON_SERVERLESS=1`
switches to the
[Neon serverless driver](https://github.com/neondatabase/serverless), which
carries the connection over a WebSocket on port 443. Use it for a
[Neon](https://neon.com) database from a sandbox that lets only HTTPS out, such
as a cloud coding agent. SQLite ignores it.

To set up an agent's environment, such as Claude Code on the web, export
`TODO_DATABASE_URL`, `TODO_LIST` and `TODO_FORMAT=json` once, and check it with
`todo db ping`.

## Output

Text is the default. With `--json` or `TODO_FORMAT=json`, each command prints
one JSON value: `todo ls` prints `{"list": "<key>", "items": [...]}`, `todo add`
prints the new Item, and so on. `todo guide` lists every shape.

`todo prompt`, `todo export`, `todo list export`, `todo guide` and `--help`
always print text.

In a terminal, text output is in color: IDs and Done Items are dark gray,
Section headings stand out, and Markdown in descriptions shows as bold, italic,
or code. `--no-color` or `NO_COLOR=1` turns it off; `--color` or `FORCE_COLOR=1`
turns it on when the output isn't a terminal. JSON, the prompt and exports are
never in color.

## Markdown

`list export` writes, and `list import` reads, GitHub-flavored task lists:

<!-- prettier-ignore -->
```markdown
# proj-1

Optional List description.

- [ ] Item without a Section (!high) `id:1`
  Notes are indented under the Item.

## 01 - UI

- [ ] Pending Item (!low) `id:2`
- [x] Done Item `id:3`
```

Items are in Position order. Each line ends with the Item ID, written
`` `id:3` ``; `list export --no-ids` leaves it out. `todo ls` prints the same
lines.

When the file's `# <key>` is the List's, or it has none, a line's ID (at its
start, or as its very last token) updates that Item, which keeps its Position
among the updated Items in the file's order. Other task lines merge into the
List as Duplicate Items do, and new Items go last. Any other text is ignored.

By default, importing never removes Items, and the file's description is used
only if the List has none. With `--remove-missing`, the List matches the file:
Items that no line updated or merged into are removed, and the file's
description replaces the List's. A file of another List is then an error.

## Editing a List

`todo edit` with no Item ID opens the List's Markdown, as `todo export` writes
it, in `$VISUAL` or `$EDITOR`. When the editor exits, the file is imported with
`--remove-missing`: changed lines update their Items, deleted lines remove them,
and new lines add Items.

Nothing changes if the editor fails or the file is saved unchanged. If the file
is invalid, or the List changed while the editor was open, nothing changes and
the error names the file, which is kept.

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
