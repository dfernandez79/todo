This repository is similar to the `../schema-to-erd` repository, and the idea is
to create a "to-do list" for use in the code. This "to-do list" will be stored
in a database. The database will hold a list of "todos," and I will be able to
view the list of "todos" for the project. It is a command-line tool that can be
run from an agent.

Terms are defined in [GLOSSARY.md](../GLOSSARY.md). Architectural decisions are
in [docs/adr](./adr).

# Tech stack

- Development in Bun; usage supports both Bun and Node.js (`node >=22.16`).
- Copy configuration from the project `../schema-to-erd`: oxlint, oxfmt, husky +
  lint-staged, `bun test`, and `node:util` `parseArgs` for argument parsing.
  Generate the package with `bunup` targeting Node.
- Package name `@diegoux/todo`, bin `todo`.
- It supports PostgreSQL or SQLite as the database backend, through Kysely
  ([ADR 0001](./adr/0001-kysely-with-node-sqlite-adapter.md)):
  - PostgreSQL via `kysely-postgres-js` on the `postgres` driver.
  - SQLite via `node:sqlite` on both Bun and Node, through our own small Kysely
    dialect adapter. The CLI suppresses the `node:sqlite` `ExperimentalWarning`.
- PostgreSQL tests use testcontainers and are skipped with `SKIP_DB_TESTS=1`.

# Concepts

- **List:** a collection of Items. Inside a List, there can be Sections and
  Items.
  - A List has a short key, e.g. `list-1`, which is used to quickly identify it.
    Keys start with a letter and don't have spaces or `/` in them.
  - A descriptive name or longer description is optional.
  - A List can be archived. Item commands on an Archived List fail until it's
    unarchived. `todo list show` still works on it.
  - Marking all the Items of a List done does not archive it.
- **Section:** a name that groups Items. A List can have zero or more Sections.
  There are no sub-sections.
  - A Section is a label on Items: it exists only while at least one Item has
    it. Empty Sections disappear.
- **Item:**
  - It belongs to a List.
  - Has a short text (called `description`).
  - Has a done mark.
  - Optionally, it can have a longer description (called `notes`).
  - Optionally, it can be categorized in a Section.
  - Optionally, it can have a priority: High, Medium, Low.
  - Has an Item ID: an integer counter per List, starting at 1. It's never
    reused within the List, even after deletes, and doesn't depend on the Item's
    contents or Position.
  - Has a Position: its place in the order the user keeps for the List. The
    Position is independent of the Item ID and the Priority.
  - Stores created, updated, and done-at timestamps.
- **Duplicate Item:** an Item whose `description` and Section exactly match
  (case-sensitive) another Item in the same List.

# Features

- AI agent-friendly: it's a CLI designed to be used by an agent. It supports
  JSON output and provides help on how to use the tool.
  - Every command has `--help` with its syntax.
  - `todo guide` prints a Markdown usage guide for agents: workflow, environment
    variables, JSON shapes, and examples.
  - Commands never ask for interactive confirmation. `todo edit` with no Item ID
    is the only command that opens an editor, and only when a person runs it.
- Items are referenced only by their Item ID.
- It can return a Prompt based on selected Items or Sections (see
  `todo prompt`).
- The user can mark a whole Section or List as done.
- Sections are displayed in alphabetical order, which allows using the Section
  name to determine the display order: `01 - UI`.
- It can import or export a List from Markdown.
- A person can edit a whole List as Markdown in their editor (`todo edit`).

## Configuration

| Setting            | Flag                    | Environment variable                 | Default           |
| ------------------ | ----------------------- | ------------------------------------ | ----------------- |
| Database           | `--db`                  | `TODO_DATABASE_URL`                  | `~/.todo/todo.db` |
| PG connect timeout | `--db-timeout=<s>`      | `TODO_DATABASE_TIMEOUT`              | 30 seconds        |
| Default list       | `--list`                | `TODO_LIST`                          | `default`         |
| Output format      | `--json`                | `TODO_FORMAT=json`                   | text              |
| Color              | `--color`, `--no-color` | `FORCE_COLOR=1`, `NO_COLOR=1`        | on in a terminal  |
| Auto-migrate       |                         | `TODO_NO_AUTO_MIGRATE=1` disables it | enabled           |
| Editor             |                         | `VISUAL`, then `EDITOR`              | none: an error    |

- A flag wins over the environment variable, which wins over the default.
- A database value starting with `postgres://` (or `postgresql://`) selects
  PostgreSQL. Any other value is a SQLite file path.
- The connection timeout is a positive number of seconds to wait to connect to
  PostgreSQL. SQLite ignores it.
- Environment variables allow setting up the environment for Claude Cloud.

## Output

- Text output is the default. `--json` or `TODO_FORMAT=json` switches every
  command to JSON.
- JSON output includes the Item timestamps; text output hides them.
- Text output is in color when stdout is a terminal. `--no-color` turns color
  off, then `--color` turns it on, then `NO_COLOR` turns it off, then
  `FORCE_COLOR` (anything but `0`) turns it on.
  - Item IDs and Done Items are dark gray, and Section headings are bold blue.
  - Item descriptions show their inline Markdown: `**bold**`, `*italic*`, and
    `` `code` ``.
  - JSON, `todo prompt`, `todo export`, `todo list export`, `todo guide`, and
    `--help` are never in color.
- Errors exit with a non-zero code. In JSON mode they print
  `{"error": {"code": "...", "message": "..."}}`. Giving up on connecting to
  PostgreSQL after `--db-timeout` is `DB_CONNECT_TIMEOUT`; the message tells how
  to raise the timeout.

## Display order

1. Items without a Section come first, then Sections in alphabetical order.
2. Inside each group, Items sort by Position. With `--sort=priority`, they sort
   by priority (High, Medium, Low, then no priority), then by Position.

`todo ls`, `todo list show`, and `todo prompt` take `--sort=position` (the
default) or `--sort=priority`. `todo list export` always uses Position order.

## Position

- `add` puts a new Item last in its List.
- Changing an Item's Section puts it last in the new Section.
- `cp`, `mv`, `list copy`, and `list mv` onto an existing List put the copies
  last in the target, in their source order. A merged Duplicate Item keeps the
  Position of the Item already there.
- `todo edit <id> --move=up|down|top|bottom` moves an Item within its Section. A
  pending Item steps over Done Items, which `todo ls` hides, so every move
  shows. Moving the first Item up, or the last one down, changes nothing.
- A move changes no Item's `updatedAt`, because it changes no Item's content.
- Upgrading the database gives existing Items Positions in the display order
  from before Positions existed (Section, priority, then Item ID), so Lists look
  the same.

## Merge rule

Copying, moving, importing, and `todo list cleanup` all merge Duplicate Items
the same way:

- The Item that was in the List first survives and keeps its Item ID.
- The higher priority wins.
- The result stays pending unless both Items are done.
- Notes that differ are appended to the surviving Item's notes.

For example, an Item with priority High in `list-1` is copied to `list-2`.
`list-2` already has the same Item with priority Low; the result is the `list-2`
Item with priority High.

## Database migrations

Migrations run automatically every time the CLI starts or the API opens a store.
Set `TODO_NO_AUTO_MIGRATE=1` to disable this and run `todo db migrate`
explicitly.

# CLI behavior

The CLI has commands that apply to Items or to List management.

For convenience, Item handling doesn't have an `item` sub-command, but List
management is always under the `list` sub-command.

All the Item commands have an optional `--list` argument that indicates the List
to work on. If the List is not specified, the CLI uses `TODO_LIST` to determine
the default List, or uses the key `default`.

Write commands (`add`, `cp`, `mv`, `import`, `list import`, `list copy`,
`list mv`) create the target List if it doesn't exist. Read commands on a
missing List fail, except for the `default` List, which reads as empty.

## Item Commands

- `add` (alias `a`); accepts `--section`, `--priority`, and `--notes`
- `remove` (alias `rm`)
- `done` (alias `d`, `x`); accepts Item IDs, `--section`, or `--all-items`
- `edit` (alias `e`); accepts `--section`, `--priority`, `--notes`, `--done`,
  `--not-done`, and `--move`. Without an Item ID or options, it opens the List
  in an editor (see [Editing a List](#editing-a-list)).
- `items` (alias `ls`; also used when no command is given); accepts `--all`,
  `--section`, `--priority`, `--sort`, and `--no-ids`
- `show` (show the details of one or more Items)
- `copy` (alias `cp`; copies Items to another List, which gives them new Item
  IDs)
- `move` (alias `mv`; same as `cp` but removes the source Items afterwards)
- `prompt` (prints a Prompt for the selected Items)
- `export` (same as `todo list export <key>` on the List from `--list`,
  `TODO_LIST`, or `default`); accepts `--no-ids`
- `import` (same as `todo list import <key>` on that List); accepts
  `--remove-missing`

In `cp` and `mv`, the last argument is the target List Key. Because List Keys
start with a letter, it can't be confused with an Item ID.

### Examples

```bash
# Add a todo on the default list
todo add 'Create an example'
# Add a todo into a section (the section is created if it doesn't exist)
todo add 'Other' --section='List Testing'
# Add a todo with priority and notes
todo add 'Fix login' --priority=high --notes='Fails on Safari'
# Add items to a non-default list
todo add 'Item' --list=list-2
# Set the default list using an env var
export TODO_LIST=proj-1
todo add "Test" # adds to proj-1

# List the items in the default list (only pending items)
todo items
# List all the items (including done)
todo items --all
# List the items with the ls alias
todo ls
# List all items with the -a shortcut
todo ls -a
# List the items in the default list
todo
# List the items in the "List Testing" section
todo --section="List Testing"
# List the items in the "List Testing" section (including done)
todo --section="List Testing" --all
# Show the high-priority items in the list
todo ls --priority=high
# Sort the items by priority instead of by position
todo ls --sort=priority
# Output as JSON
todo ls --json

# Edit an item to change its description (123 is the ID in the default list)
todo edit 123 "New description"
# Change the priority of an item
todo edit 123 --priority=high
# Change the description, priority, and section
todo edit 123 "Description new" --priority=low --section="Testing"
# Change the notes
todo edit 123 --notes="More details"
# Move an item up one place in its section
todo edit 123 --move=up
# Move an item to the end of its section
todo edit 123 --move=bottom

# Mark an item as done
todo done 123
# Mark multiple items as done
todo done 123 575 578
# Mark all the items in a section as done
todo done --section="List Testing"
# Mark all the items in the list as done
todo done --all-items

# Mark item as done using the edit command
todo edit 123 --done=true
# Edit the item using the done shortcut
todo edit 123 --done

# Unmark an item as done
todo edit 123 --done=false
# Unmark an item using the not-done shortcut
todo edit 123 --not-done

# Show details of an item
todo show 123
# Show details of multiple items
todo show 123 575

# Copy multiple items to another list
todo cp 123 757 564 list-2
# Move the items to another list
todo mv 124 464 list-2
# Remove items
todo rm 132 443

# Print a prompt with all the pending items in the list
todo prompt
# Print a prompt for some items
todo prompt 3 7
# Print a prompt for the pending items of a section
todo prompt --section="01 - UI"

# Export the default list to Markdown, and import it back
todo export > TODO.md
todo import < TODO.md
# Import it back, removing the Items the file leaves out
todo import --remove-missing < TODO.md

# Edit the default list as Markdown in $VISUAL or $EDITOR
todo edit

# Print the usage guide for agents
todo guide
```

### Prompt

`todo prompt` prints a Markdown task brief for an agent:

- The List Key, then the selected Items grouped under their Section headings, in
  display order.
- Each Item shows its Item ID, description, and notes.
- A footer tells the agent to run `todo done <id>` when an Item is finished.

With no Item IDs or `--section`, it includes all the pending Items in the List.
Item IDs and `--section` narrow the selection. Done Items are never included.

### Item copy behavior

Copying skips Duplicate Items and merges them into the target using the
[merge rule](#merge-rule). Non-duplicate Items get new Item IDs in the target
List.

## List Management Commands

- `add`
- `ls` (lists the Lists; `--archived` includes Archived Lists)
- `show` / `show-summary`
- `remove` (alias `rm`); a non-empty List requires `--force`
- `archive` / `unarchive`
- `edit` (alias `e`)
- `import`; accepts `--remove-missing`
- `export`
- `copy`
- `move` (alias `mv`)
- `cleanup`

### Examples

```bash
# Create an empty list with the key 'test-1'
todo list add test-1
# Create an empty list with a description
todo list add test-1 --description="A test list"

# Show the lists (archived lists are hidden)
todo list ls
# Show all the lists, including archived ones
todo list ls --archived

# Remove an empty list
todo list remove test-1
# Remove a list and all the items in it
todo list remove test-1 --force

# Archive a list
todo list archive test-1
# Unarchive a list
todo list unarchive test-1

# Change the description of a list
todo list edit test-1 --description="New description"

# Show the description and contents of a list
todo list show test-1
# Show can take the same parameters as `ls`
todo list show test-1 --all --priority=high
# Display only the description and count of tasks
todo list show-summary test-1

# Merge duplicated items in the list
todo list cleanup test-1

# Export the list to Markdown
todo list export test-1 > TODO.md
# Export the list to Markdown without Item IDs
todo list export test-1 --no-ids > TODO.md

# Import the list from Markdown
todo list import test-1 < TODO.md
# Make the list match the Markdown, removing the Items it leaves out
todo list import test-1 --remove-missing < TODO.md

# Make a copy of a list
todo list copy test-1 test-2

# Move a list to another
todo list mv test-1 test-2

# Run database migrations explicitly
todo db migrate
```

### List copy behavior

The List copy copies the Items of one List on top of the other. It's exactly the
same as calling `todo cp ...` with all the Items in the List.

### List move behavior

- If the target List doesn't exist, `todo list mv` renames the List. Item IDs
  are kept.
- If the target List exists, it copies the Items on top of it (as
  `todo list copy` does), then deletes the source List. Copied Items get new
  Item IDs.

### List cleanup behavior

`todo list cleanup` merges the Duplicate Items in a List using the
[merge rule](#merge-rule). The Item with the lowest Item ID survives.

### Markdown format

`todo list export` writes, and `todo list import` reads, GitHub-flavored
Markdown task lists:

<!-- prettier-ignore -->
```markdown
# list-1

Optional list description.

- [ ] Item without a section (!high) `id:1`
  Notes are indented under the item.

## 01 - UI

- [ ] Pending item (!low) `id:2`
- [x] Done item `id:3`
```

- `# <key>` is followed by the optional List description.
- `## <Section>` headings group Items.
- Items are `- [ ]` (pending) or `- [x]` (done), with an optional trailing
  `(!high)`, `(!medium)`, or `(!low)` priority marker.
- Notes are indented text under the Item.
- Items are in Position order.
- An Item's ID is written `` `id:3` ``. Export writes it as the very last token
  of the line, after the priority marker; `--no-ids` leaves it out. Import also
  reads it at the start of the line: ``- [ ] `id:2` Pending item (!low)``. An ID
  at both ends of a line, or the same ID on two lines, is invalid input.
- `todo ls` prints Items in the same line format, with their IDs.
- Import ignores any other line, such as a paragraph between Items.

Without `--remove-missing`, import never deletes Items: Items the file leaves
out stay as they are.

The Item IDs in the file apply when its `# <key>` is the target List's, or when
it has no `# <key>`. Otherwise the import ignores them, because IDs are unique
only within their List. When they apply:

- A line whose ID is an Item of the List updates that Item: its description,
  done mark, priority, notes, and Section. A line without notes clears them.
- The updated Items swap into the Positions they already held, in the file's
  order. For example, with Items 1–5 and a file listing `id:4` then `id:2`, Item
  4 takes Item 2's Position and Item 2 takes Item 4's; Items 1, 3, and 5 stay.
- If an update makes Duplicate Items, they merge using the
  [merge rule](#merge-rule).
- A line with an unknown ID adds a new Item, ignoring the ID.

Lines without an applicable ID merge into the List using the
[merge rule](#merge-rule), and new Items go last, in the file's order.

The output lists the resulting Item of each line, and the IDs of the Items it
removed: `{"list": "<key>", "items": [...], "removed": [3, 7]}`. In text, it is
`Imported 4 items into list-1, removed 2`. Without `--remove-missing`, `removed`
is always empty.

### Import with `--remove-missing`

`--remove-missing` makes the List match the file:

- After the lines are imported, it removes every Item that no line matched. A
  line matches the Item whose ID it has, or the Item it merged into as a
  Duplicate Item.
- The file's description replaces the List's, and a file without one clears it.
- A file whose `# <key>` names another List is invalid input, because none of
  its IDs would apply and every Item would be removed.

### Editing a List

`todo edit` with no Item ID and no options edits the List from `--list`,
`TODO_LIST`, or `default` as Markdown:

1. It writes `todo export` of the List, with all Items and their IDs, to a
   temporary file. A List that doesn't exist yet is just `# <key>`. An Archived
   List fails before the editor opens.
2. It opens the file in `$VISUAL`, or else `$EDITOR`, run through the shell so
   commands like `code --wait` work. Without either, it fails.
3. After the editor exits, it imports the file with `--remove-missing`:
   - A line with an Item's ID updates that Item.
   - A removed line removes its Item.
   - A new line adds an Item, or merges into its Duplicate Item.
   - Other lines are ignored.

Nothing changes when:

- The editor exits with an error (`EDITOR_FAILED`), or the file is saved
  unchanged.
- The file is invalid (`INVALID_INPUT`), or the List changed while the editor
  was open (`LIST_CHANGED`). The error names the temporary file, which is kept
  so the edits can be fixed and imported with `todo import --remove-missing`.

A List that doesn't exist is created only if the file has Items or a
description. The output is the same as the import's.

## TypeScript API

The package also provides a TypeScript API to manage a todo list. The API covers
the same functionality available in the CLI.

```typescript
import { addItem, importList, todoList, todoListStore } from "@diegoux/todo";

// a postgres:// URL or a SQLite file path; runs pending migrations
const store = await todoListStore("/path/to/todo.db");
try {
  // a list by key; it's created on the first write
  const list = todoList(store, "list-1");
  // add item to the list
  await addItem(list, "New Description");
  // make the list match a Markdown task list
  const { items, removed } = await importList(store, "list-1", markdown, {
    removeMissing: true,
  });
} finally {
  await store.close();
}
```
