---
name: todo
description:
  Track a project's to-do list with the `todo` CLI (`@diegoux/todo`). Use when
  the user wants to record, review, reorder, prioritize, or finish things to do;
  manage to-do lists; or export a list to Markdown. Works with a cloud database,
  so the list persists when the agent runs in the cloud.
---

Manage to-do lists with the `todo` CLI from the `@diegoux/todo` package. The
database can live in the cloud (`TODO_DATABASE_URL=postgres://...`), so the list
survives across sessions and machines, including cloud agent runs.

## Setup

1. Find the CLI: run `todo --help`. If `todo` isn't on the `PATH`, use a package
   runner in its place for every command below: `bunx --bun @diegoux/todo` if
   Bun is available (`bun --version`), otherwise `npx -y @diegoux/todo`.
2. Run `todo guide` once per session, before the first other `todo` command. It
   is the source of truth for commands, flags, JSON output and rules; follow it
   where this skill and the guide differ.
3. Choose the List (see below).
4. Pass `--json` (or set `TODO_FORMAT=json` in the command) when you need to
   parse output. Show results to the user as text, not raw JSON.

## Choosing the List

Without `--list` or `TODO_LIST`, `todo` uses the `default` List. That is often
not what the user wants.

- If `TODO_LIST` is set in the environment (`echo "$TODO_LIST"`), use it.
- Otherwise, before the first command that reads or writes Items, ask the user
  which List to use. Run `todo list ls` and offer the existing Lists, the option
  to create a new one, and `default`.
- Remember the answer for the rest of the session: pass `--list=<key>` on every
  later Item command (`add`, `ls`, `show`, `edit`, `done`, `rm`, `cp`, `mv`,
  `prompt`, `export`, `import`). Don't ask again unless the user wants to switch
  Lists.
- Writing to a List that doesn't exist creates it, so check the key against
  `todo list ls` before writing, to avoid creating a List from a typo.

## Working on tasks

When the user asks you to work through the list:

1. See what's pending: `todo ls` (or `todo prompt` for a task brief; filter with
   Item IDs or `--section`).
2. Read an Item's notes with `todo show <id>` before starting it.
3. Mark each Item done as soon as it is finished (`todo done <id>`), not in a
   batch at the end.
4. Record follow-up work you discover as new Items (`todo add`), with a Section,
   Priority, and notes when they help. Don't mark an Item done if the work is
   incomplete; add notes explaining what's left instead.

Refer to Items only by their Item ID. IDs never change within a List.

## What the user can ask for

| Request                    | Command                                                                    |
| -------------------------- | -------------------------------------------------------------------------- |
| Add an Item                | `todo add "<description>" --section=<s> --priority=<p> --notes=<text>`     |
| Edit an Item               | `todo edit <id> ["<description>"] --notes=<text>` (`--done`, `--not-done`) |
| Change its order           | `todo edit <id> --move=up\|down\|top\|bottom` (moves within its Section)   |
| Change its priority        | `todo edit <id> --priority=high\|medium\|low\|none`                        |
| Put it in a Section        | `todo edit <id> --section=<name>` (`--section=""` removes it)              |
| Create a new List          | `todo list add <key>`                                                      |
| Rename a List              | `todo list mv <from> <to>`                                                 |
| Describe a List            | `todo list edit <key> --description="<text>"`                              |
| Export to Markdown         | `todo list export <key> > TODO.md` (`--no-ids` for a clean copy)           |
| Edit the List in an editor | Ask the user to run `todo edit --list=<key>` (see below)                   |

Notes:

- Sections sort alphabetically. Suggest numbered names (`01 - UI`, `02 - API`)
  when the user wants Sections in a specific order.
- `--move` only moves within a Section. To move an Item to another Section's
  position, change its Section first, then move it.
- After renaming the List in use, use the new key for later calls.
- Ask before an export overwrites an existing file.
- Confirm with the user before `todo rm`, `todo list rm`,
  `todo done --all-items`, or `import --remove-missing`: they remove or change
  many Items and can't be undone.

## Editing in an editor

`todo edit` with no Item ID opens the whole List as Markdown in `$VISUAL` or
`$EDITOR`. It needs an interactive terminal, so don't run it yourself. Give the
user the exact command, `todo edit --list=<key>`, to run in their own terminal.
After they save and close the editor, run `todo ls --list=<key>` to see the
result.
