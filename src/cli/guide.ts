/** `todo guide`: how an agent uses todo, printed as Markdown. */
const GUIDE = `# Using todo from an agent

todo keeps to-do lists in a database. Each **List** has a **List Key** (such
as \`proj-1\`) and holds **Items**. An Item has a one-line description,
optional notes, an optional **Section** (a name grouping Items), an optional
**Priority** (high, medium, low), and a done mark.

## Setup

| Setting      | Flag         | Environment variable       | Default            |
| ------------ | ------------ | -------------------------- | ------------------ |
| Database     | \`--db\`       | \`TODO_DATABASE_URL\`        | \`~/.todo/todo.db\`  |
| Default list | \`--list\`     | \`TODO_LIST\`                | \`default\`          |
| JSON output  | \`--json\`     | \`TODO_FORMAT=json\`         | text               |

A database starting with \`postgres://\` is PostgreSQL; anything else is a
SQLite file. Set \`TODO_LIST\` and \`TODO_FORMAT=json\` once instead of passing
the flags on every call.

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
- \`todo ls\`: list Items (\`--all\`, \`--section\`, \`--priority\`).
- \`todo show <id>...\`: Item details, with notes.
- \`todo edit <id> [<description>]\`: change \`--section\`, \`--priority\`,
  \`--notes\`, \`--done\` or \`--not-done\`. \`--section=""\` and \`--notes=""\`
  clear; \`--priority=none\` clears.
- \`todo done <id>...\`, \`todo done --section=<name>\`, \`todo done --all-items\`.
- \`todo rm <id>...\`: remove Items.
- \`todo cp <id>... <list>\` / \`todo mv <id>... <list>\`: copy or move Items.
- \`todo prompt [<id>...] [--section=<name>]\`: a task brief of pending Items.
- \`todo list ls\`, \`todo list add <key>\`, \`todo list show <key>\`,
  \`todo list show-summary <key>\`, \`todo list edit <key> --description=...\`,
  \`todo list archive <key>\`, \`todo list unarchive <key>\`,
  \`todo list rm <key> [--force]\`, \`todo list copy <from> <to>\`,
  \`todo list mv <from> <to>\`, \`todo list cleanup <key>\`,
  \`todo list export <key> > TODO.md\`, \`todo list import <key> < TODO.md\`.

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
  (name them \`01 - UI\`, \`02 - API\` to order them); within each, by Priority,
  then ID.

## JSON output

With \`--json\` or \`TODO_FORMAT=json\`, commands print one JSON value:

- \`todo ls\`, \`todo show\`, \`todo done\`, \`todo cp\`, \`todo mv\`, \`todo list import\`:
  \`{"list": "<key>", "items": [Item, ...]}\`
- \`todo add\`, \`todo edit\`: \`Item\`
- \`todo rm\`, \`todo list cleanup\`: \`{"list": "<key>", "removed": [Item, ...]}\`
- \`todo list ls\`: \`{"lists": [List, ...]}\`
- \`todo list show\`: \`{"list": List, "items": [Item, ...]}\`
- other \`todo list\` commands: \`List\`

An Item is \`{"list", "id", "description", "notes"?, "section"?, "priority"?,
"done", "createdAt", "updatedAt", "doneAt"?}\`. A List is \`{"key",
"description"?, "archived", "createdAt", "updatedAt", "archivedAt"?,
"pending", "done"}\`. Absent optional fields are left out.

\`todo prompt\`, \`todo list export\`, \`todo guide\` and \`--help\` always print text.

Errors exit non-zero (2 for a bad invocation, 1 otherwise). In JSON mode they
print \`{"error": {"code": "...", "message": "..."}}\` on stdout. Codes:
\`USAGE\`, \`LIST_NOT_FOUND\`, \`LIST_EXISTS\`, \`LIST_ARCHIVED\`, \`LIST_NOT_EMPTY\`,
\`ITEM_NOT_FOUND\`, \`INVALID_INPUT\`, \`INTERNAL\`.
`;

export { GUIDE };
