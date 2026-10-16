/** `todo guide`: how an agent uses todo, printed as Markdown. */
const GUIDE = `# Using todo from an agent

todo keeps to-do lists in a database. Each **List** has a **List Key** (such
as \`proj-1\`) and holds **Items**. An Item has a one-line description,
optional notes, an optional **Section** (a name grouping Items), an optional
**Priority** (high, medium, low), a done mark, and a **Position** in the
order the user keeps for the List.

## Setup

| Setting            | Flag           | Environment variable    | Default           |
| ------------------ | -------------- | ----------------------- | ----------------- |
| Database           | \`--db\`         | \`TODO_DATABASE_URL\`     | \`~/.todo/todo.db\` |
| PG connect timeout | \`--db-timeout\` | \`TODO_DATABASE_TIMEOUT\` | 30 seconds        |
| Neon serverless    | \`--db-use-neon-serverless\` | \`TODO_USE_NEON_SERVERLESS=1\` | off      |
| Default list       | \`--list\`       | \`TODO_LIST\`             | \`default\`         |
| JSON output        | \`--json\`       | \`TODO_FORMAT=json\`      | text              |
| Color              | \`--no-color\`   | \`NO_COLOR=1\`            | on in a terminal  |

A database starting with \`postgres://\` is PostgreSQL; anything else is a
SQLite file. With \`--db-use-neon-serverless\` or \`TODO_USE_NEON_SERVERLESS=1\`,
PostgreSQL is reached through the Neon serverless driver, over a WebSocket
instead of a TCP connection on port 5432: use it for a Neon database when the
network lets only HTTPS out, as a sandbox often does. Set \`TODO_LIST\` and
\`TODO_FORMAT=json\` once instead of passing the flags on every call.

Check the setup with \`todo db ping\`: it connects, then prints the driver, the
server version and the pending migrations, without running them.

## Workflow

1. See what's pending: \`todo ls\` (add \`--all\` to include done Items).
2. Get a task brief: \`todo prompt\`, \`todo prompt 3 7\`, or
   \`todo prompt --section="01 - UI"\`.
3. Read an Item's notes: \`todo show 3\`.
4. Mark work done as you finish it: \`todo done 3\`.
5. Record new work: \`todo add "Fix login" --section=Auth --priority=high --notes="Fails on Safari"\`.

## Referring to Items

Items are referred to only by their **Item ID**, a number unique within the
List (\`3\` or \`#3\`). IDs never change and are never reused, even after
deletes. Copying or moving an Item to another List gives it a new ID there.

## Commands

- \`todo add <description>\`: add an Item (\`--section\`, \`--priority\`, \`--notes\`).
- \`todo ls\`: list Items (\`--all\`, \`--section\`, \`--priority\`,
  \`--sort=priority\`, \`--no-ids\`).
- \`todo show <id>...\`: Item details, with notes.
- \`todo edit <id> [<description>]\`: change \`--section\`, \`--priority\`,
  \`--notes\`, \`--done\` or \`--not-done\`. \`--section=""\` and \`--notes=""\`
  clear; \`--priority=none\` clears. \`--move=up|down|top|bottom\` moves the
  Item within its Section.
- \`todo done <id>...\`, \`todo done --section=<name>\`, \`todo done --all-items\`.
- \`todo rm <id>...\`: remove Items.
- \`todo cp <id>... <list>\` / \`todo mv <id>... <list>\`: copy or move Items.
- \`todo prompt [<id>...] [--section=<name>] [--sort=priority]\`: a task brief
  of pending Items.
- \`todo list ls\`, \`todo list add <key>\`, \`todo list show <key>\`,
  \`todo list show-summary <key>\`, \`todo list edit <key> --description=...\`,
  \`todo list archive <key>\`, \`todo list unarchive <key>\`,
  \`todo list rm <key> [--force]\`, \`todo list copy <from> <to>\`,
  \`todo list mv <from> <to>\`, \`todo list cleanup <key>\`,
  \`todo list export <key> [--no-ids] > TODO.md\`,
  \`todo list import <key> [--remove-missing] < TODO.md\`.
- \`todo export [--no-ids]\`, \`todo import [--remove-missing]\`: the same, on
  the List from \`--list\` or \`TODO_LIST\`.
- \`todo edit\` with no Item ID opens the List in \`$VISUAL\` or \`$EDITOR\` for a
  person. Agents should use the commands above instead.
- \`todo db ping\`: test the database connection. \`todo db migrate\`: run the
  pending migrations, needed only with \`TODO_NO_AUTO_MIGRATE=1\`.

Run \`todo <command> --help\` for details.

## Rules worth knowing

- Writing to a List that doesn't exist creates it. Reading one fails, except
  the \`default\` List, which reads as empty.
- An archived List can't be read or changed through Item commands until
  \`todo list unarchive\`.
- Copying, moving, importing and \`list cleanup\` merge **Duplicate Items** (same
  description and Section): the Item already there keeps its ID, the higher
  Priority wins, it stays pending unless both are done, and differing notes are
  appended.
- \`todo ls\` shows Items without a Section first, then Sections alphabetically
  (name them \`01 - UI\`, \`02 - API\` to order them); within each, by
  Position, or with \`--sort=priority\`, by Priority, then Position. New Items
  go last; a new Section puts an Item last in it.
- \`todo ls\` and \`todo list export\` write an Item as
  \`\` - [ ] Fix login (!high) \`id:3\` \`\`. Importing Markdown of the same List updates
  the Items whose IDs it names (at the start or the very end of a line) and
  keeps the rest. With \`--remove-missing\`, it removes the Items the file
  leaves out and takes the file's description. Text that isn't an Item is
  ignored.

## Troubleshooting

Start with \`todo db ping\` (or \`todo db ping --json\`). It uses the same
\`--db\`, \`--db-timeout\` and driver settings as every other command, so it
fails the way they do, and when it connects it shows which database and driver
todo resolved, how long connecting took, the server version, and whether
migrations are pending.

- \`could not connect to the database within 30 seconds\` (exit 1, JSON code
  \`DB_CONNECT_TIMEOUT\`): todo gave up connecting to PostgreSQL after the connect
  timeout, 30 seconds by default.
  A slow network or a database that wakes on demand may need longer: pass
  \`--db-timeout=<seconds>\` or set \`TODO_DATABASE_TIMEOUT\`, for example
  \`todo db ping --db-timeout=90\`. If it still fails, check that the database
  URL is reachable from where todo runs.
- The connection hangs or is refused (\`ECONNREFUSED\`, \`ETIMEDOUT\`, JSON code
  \`INTERNAL\`) while the URL is right: the network may allow only HTTPS out.
  For a Neon database, retry with \`--db-use-neon-serverless\` (or
  \`TODO_USE_NEON_SERVERLESS=1\`), which connects over a WebSocket on port 443.
- \`could not open a WebSocket to <host> for the Neon serverless driver\`: the
  Neon driver is on, but the host isn't a Neon database or isn't reachable over
  HTTPS. Check the URL, or turn the driver off for a plain PostgreSQL.
- \`db ping\` reports pending migrations: run \`todo db migrate\`, or unset
  \`TODO_NO_AUTO_MIGRATE\` so commands migrate on start.
- \`db ping\` shows an unexpected database: \`--db\` wins over
  \`TODO_DATABASE_URL\`, which wins over the default \`~/.todo/todo.db\`.

## JSON output

With \`--json\` or \`TODO_FORMAT=json\`, commands print one JSON value:

- \`todo ls\`, \`todo show\`, \`todo done\`, \`todo cp\`, \`todo mv\`:
  \`{"list": "<key>", "items": [Item, ...]}\`
- \`todo import\`, \`todo list import\`, \`todo edit\` with no Item ID:
  \`{"list": "<key>", "items": [Item, ...], "removed": [<id>, ...]}\`
- \`todo add\`, \`todo edit <id>\`: \`Item\`
- \`todo rm\`, \`todo list cleanup\`: \`{"list": "<key>", "removed": [Item, ...]}\`
- \`todo list ls\`: \`{"lists": [List, ...]}\`
- \`todo list show\`: \`{"list": List, "items": [Item, ...]}\`
- other \`todo list\` commands: \`List\`

An Item is \`{"list", "id", "description", "notes"?, "section"?, "priority"?,
"done", "createdAt", "updatedAt", "doneAt"?}\`. A List is \`{"key",
"description"?, "archived", "createdAt", "updatedAt", "archivedAt"?,
"pending", "done"}\`. Absent optional fields are left out.

\`todo prompt\`, \`todo export\`, \`todo list export\`, \`todo guide\` and \`--help\` always print text.

Errors exit non-zero (2 for a bad invocation, 1 otherwise). In JSON mode they
print \`{"error": {"code": "...", "message": "..."}}\` on stdout. Codes:
\`USAGE\`, \`LIST_NOT_FOUND\`, \`LIST_EXISTS\`, \`LIST_ARCHIVED\`, \`LIST_NOT_EMPTY\`,
\`ITEM_NOT_FOUND\`, \`INVALID_INPUT\`, \`LIST_CHANGED\`, \`EDITOR_FAILED\`,
\`DB_CONNECT_TIMEOUT\`, \`INTERNAL\`.
`;

export { GUIDE };
