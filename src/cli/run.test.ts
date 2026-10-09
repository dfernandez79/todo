import { beforeEach, describe, expect, test } from "bun:test";

import { type Todo, todoCli } from "../test-helpers/cli.ts";
import { DATABASES } from "../test-helpers/databases.ts";
import type { Item, ListSummary } from "../types.ts";

type Items = { list: string; items: Item[] };

const ids = (result: { items: Item[] }) => result.items.map(item => item.id);

const descriptions = (result: { items: Item[] }) => result.items.map(item => item.description);

const errorOf = async (todo: Todo, args: string[]) => {
  const result = await todo([...args, "--json"]);
  return {
    exit: result.code,
    ...(JSON.parse(result.stdout) as { error: { code: string; message: string } }).error,
  };
};

describe.each(DATABASES)("todo on $name", database => {
  let todo: Todo;

  beforeEach(async () => {
    todo = todoCli(await database.fresh());
  }, 30_000);

  describe("items", () => {
    test("the default List reads as empty before it exists", async () => {
      expect(await todo.json<Items>([])).toEqual({ list: "default", items: [] });
      expect((await todo(["ls"])).stdout).toBe("# default\n\nNo items.\n");
    });

    test("adds Items, numbering them per List", async () => {
      const first = await todo.json<Item>(["add", "Create an example"]);
      const second = await todo.json<Item>(["add", "Other", "--section=List Testing"]);
      const other = await todo.json<Item>(["add", "Item", "--list=list-2"]);
      expect([first.id, second.id, other.id]).toEqual([1, 2, 1]);
      expect(first).toMatchObject({
        list: "default",
        description: "Create an example",
        done: false,
      });
      expect(second.section).toBe("List Testing");
      expect(other.list).toBe("list-2");
    });

    test("joins unquoted words into one description", async () => {
      expect((await todo.json<Item>(["add", "Fix", "the", "bug"])).description).toBe("Fix the bug");
    });

    test("uses TODO_LIST, which --list overrides", async () => {
      const env = todoCli(await database.fresh(), { TODO_LIST: "proj-1" });
      expect((await env.json<Item>(["add", "Test"])).list).toBe("proj-1");
      expect((await env.json<Item>(["add", "Other", "--list=proj-2"])).list).toBe("proj-2");
    });

    test("never reuses an Item ID", async () => {
      await todo(["add", "One"]);
      await todo(["add", "Two"]);
      await todo(["rm", "2"]);
      expect((await todo.json<Item>(["add", "Three"])).id).toBe(3);
    });

    test("lists pending Items by Section, then Priority, then ID", async () => {
      await todo(["add", "b-none", "--section=B"]);
      await todo(["add", "loose-low", "-p", "low"]);
      await todo(["add", "a-high", "--section=A", "--priority=high"]);
      await todo(["add", "loose"]);
      await todo(["add", "loose-high", "--priority=high"]);
      await todo(["add", "a-medium", "--section=A", "--priority=medium"]);
      await todo(["add", "done"]);
      await todo(["done", "7"]);

      expect(descriptions(await todo.json<Items>(["items"]))).toEqual([
        "loose-high",
        "loose-low",
        "loose",
        "a-high",
        "a-medium",
        "b-none",
      ]);
      expect(descriptions(await todo.json<Items>(["ls", "-a"]))).toContain("done");
      expect(descriptions(await todo.json<Items>(["--section=A"]))).toEqual(["a-high", "a-medium"]);
      expect(descriptions(await todo.json<Items>(["ls", "--priority=high"]))).toEqual([
        "loose-high",
        "a-high",
      ]);
      expect(descriptions(await todo.json<Items>(["ls", "--priority=none"]))).toEqual([
        "loose",
        "b-none",
      ]);
      expect((await todo(["ls"])).stdout).toBe(
        [
          "# default",
          "",
          "- [ ] 5. loose-high (!high)",
          "- [ ] 2. loose-low (!low)",
          "- [ ] 4. loose",
          "",
          "## A",
          "",
          "- [ ] 3. a-high (!high)",
          "- [ ] 6. a-medium (!medium)",
          "",
          "## B",
          "",
          "- [ ] 1. b-none",
          "",
        ].join("\n"),
      );
    });

    test("reading a missing List other than the default fails", async () => {
      expect(await errorOf(todo, ["ls", "--list=nope"])).toEqual({
        exit: 1,
        code: "LIST_NOT_FOUND",
        message: "list 'nope' not found",
      });
    });

    test("edits the description, Priority, Section and notes", async () => {
      await todo(["add", "Old", "--notes=Some notes", "--section=S"]);
      expect(
        await todo.json<Item>([
          "edit",
          "1",
          "Description new",
          "--priority=low",
          "--section=Testing",
        ]),
      ).toMatchObject({
        description: "Description new",
        priority: "low",
        section: "Testing",
        notes: "Some notes",
      });

      const cleared = await todo.json<Item>([
        "e",
        "1",
        "--priority=none",
        "--section=",
        "--notes=",
      ]);
      expect(cleared.priority).toBeUndefined();
      expect(cleared.section).toBeUndefined();
      expect(cleared.notes).toBeUndefined();
    });

    test("marks Items done and pending with edit", async () => {
      await todo(["add", "Task"]);
      expect((await todo.json<Item>(["edit", "1", "--done=true"])).done).toBe(true);
      expect((await todo.json<Item>(["edit", "1", "--done=false"])).done).toBe(false);
      expect((await todo.json<Item>(["edit", "1", "--done"])).done).toBe(true);
      expect((await todo.json<Item>(["edit", "1", "--not-done"])).done).toBe(false);
      expect((await todo(["edit", "1", "--done", "--not-done"])).code).toBe(2);
      expect((await todo(["edit", "1"])).code).toBe(2);
    });

    test("marks Items done by ID, keeping the first done time", async () => {
      await todo(["add", "One"]);
      await todo(["add", "Two"]);
      await todo(["add", "Three"]);
      const [first] = (await todo.json<Items>(["done", "1"])).items;
      expect(ids(await todo.json<Items>(["x", "1", "#3"]))).toEqual([1, 3]);
      const [again] = (await todo.json<Items>(["d", "1"])).items;
      expect(again!.doneAt).toBe(first!.doneAt!);
      expect(descriptions(await todo.json<Items>([]))).toEqual(["Two"]);
    });

    test("marks a whole Section or List done", async () => {
      await todo(["add", "A1", "--section=A"]);
      await todo(["add", "A2", "--section=A"]);
      await todo(["add", "B1", "--section=B"]);
      await todo(["add", "Loose"]);
      expect(ids(await todo.json<Items>(["done", "--section=A"]))).toEqual([1, 2]);
      expect(descriptions(await todo.json<Items>([]))).toEqual(["Loose", "B1"]);
      expect(ids(await todo.json<Items>(["done", "--all-items"]))).toEqual([4, 3]);
      expect((await todo.json<Items>([])).items).toEqual([]);
      expect((await todo(["done", "1", "--all-items"])).code).toBe(2);
      expect((await todo(["done"])).code).toBe(2);
    });

    test("shows Items with their notes", async () => {
      await todo([
        "add",
        "Fix login",
        "--priority=high",
        "--notes=Fails on Safari",
        "--section=Auth",
      ]);
      expect((await todo(["show", "1"])).stdout).toBe(
        "#1 Fix login\nList: default\nSection: Auth\nPriority: high\nDone: no\nNotes:\n  Fails on Safari\n",
      );
      expect(await errorOf(todo, ["show", "1", "4", "5"])).toMatchObject({
        code: "ITEM_NOT_FOUND",
        message: "items 4, 5 not found in list 'default'",
      });
    });

    test("removes Items", async () => {
      await todo(["add", "One"]);
      await todo(["add", "Two"]);
      expect(
        descriptions({ items: (await todo.json<{ removed: Item[] }>(["rm", "1"])).removed }),
      ).toEqual(["One"]);
      expect(descriptions(await todo.json<Items>(["ls"]))).toEqual(["Two"]);
    });

    test("rejects what isn't an Item ID", async () => {
      expect(await errorOf(todo, ["done", "abc"])).toMatchObject({ code: "USAGE" });
    });
  });

  describe("copy and move", () => {
    test("copies Items to a new List with new IDs", async () => {
      await todo(["add", "Skip"]);
      await todo(["add", "One", "--notes=n"]);
      await todo(["add", "Two", "--section=S"]);
      const copied = await todo.json<Items>(["cp", "2", "3", "list-2"]);
      expect(copied.list).toBe("list-2");
      expect(
        copied.items.map(item => [item.id, item.description, item.notes, item.section]),
      ).toEqual([
        [1, "One", "n", undefined],
        [2, "Two", undefined, "S"],
      ]);
      expect((await todo.json<Items>(["ls"])).items).toHaveLength(3);
    });

    test("merges Duplicate Items into the target", async () => {
      await todo(["add", "Item", "--priority=high", "--notes=from list-1"]);
      await todo(["add", "Item", "--list=list-2", "--priority=low", "--notes=from list-2"]);
      await todo(["add", "Filler", "--list=list-2"]);
      await todo(["done", "1", "--list=list-2"]);

      const [merged] = (await todo.json<Items>(["cp", "1", "list-2"])).items;
      expect(merged).toMatchObject({
        list: "list-2",
        id: 1,
        priority: "high",
        done: false,
        notes: "from list-2\n\nfrom list-1",
      });
      expect((await todo.json<Items>(["ls", "-a", "--list=list-2"])).items).toHaveLength(2);
    });

    test("keeps the merged Item done only if both were done", async () => {
      await todo(["add", "Item"]);
      await todo(["done", "1"]);
      await todo(["add", "Item", "--list=list-2"]);
      await todo(["done", "1", "--list=list-2"]);
      expect((await todo.json<Items>(["cp", "1", "list-2"])).items[0]!.done).toBe(true);
    });

    test("moves Items, removing them from the source", async () => {
      await todo(["add", "One"]);
      await todo(["add", "Two"]);
      expect(ids(await todo.json<Items>(["mv", "1", "list-2"]))).toEqual([1]);
      expect(descriptions(await todo.json<Items>(["ls"]))).toEqual(["Two"]);
    });

    test("rejects copying to the same List, or without a target", async () => {
      await todo(["add", "One"]);
      expect(await errorOf(todo, ["cp", "1", "default"])).toMatchObject({ code: "INVALID_INPUT" });
      expect(await errorOf(todo, ["cp", "1", "2"])).toMatchObject({ code: "USAGE" });
      expect(await errorOf(todo, ["mv", "1"])).toMatchObject({ code: "USAGE" });
    });
  });

  describe("prompt", () => {
    test("briefs the pending Items, with how to mark them done", async () => {
      await todo(["list", "add", "proj", "--description=The project."]);
      await todo([
        "add",
        "Fix login",
        "--list=proj",
        "--section=01 - UI",
        "--priority=high",
        "--notes=Fails on Safari",
      ]);
      await todo(["add", "Write docs", "--list=proj"]);
      await todo(["add", "Done already", "--list=proj"]);
      await todo(["done", "3", "--list=proj"]);
      expect((await todo(["prompt", "--list=proj"])).stdout).toBe(
        [
          "# Tasks from the todo list `proj`",
          "",
          "The project.",
          "",
          "- #2: Write docs",
          "",
          "## 01 - UI",
          "",
          "- #1: Fix login (priority: high)",
          "  Fails on Safari",
          "",
          "When you finish a task, mark it done with its ID:",
          "",
          "    todo done <id> --list=proj",
          "",
          "For example: `todo done 2 --list=proj`.",
          "",
        ].join("\n"),
      );
    });

    test("narrows to the given IDs or Section, never including done Items", async () => {
      await todo(["add", "One", "--section=A"]);
      await todo(["add", "Two"]);
      await todo(["add", "Three"]);
      await todo(["done", "3"]);
      const two = (await todo(["prompt", "2", "3"])).stdout;
      expect(two).toContain("#2: Two");
      expect(two).not.toContain("Three");
      expect(two).not.toContain("One");
      expect((await todo(["prompt", "--section=A"])).stdout).toContain("#1: One");
      expect((await todo(["prompt", "--section=A"])).stdout).not.toContain("Two");
    });

    test("is text even in JSON mode", async () => {
      expect((await todo(["prompt", "--json"])).stdout).toBe(
        "There are no pending tasks in the todo list `default`.\n",
      );
    });
  });

  describe("list management", () => {
    test("creates Lists, rejecting a taken or invalid key", async () => {
      expect(
        await todo.json<ListSummary>(["list", "add", "test-1", "--description=A test list"]),
      ).toMatchObject({
        key: "test-1",
        description: "A test list",
        archived: false,
        pending: 0,
        done: 0,
      });
      expect(await errorOf(todo, ["list", "add", "test-1"])).toMatchObject({ code: "LIST_EXISTS" });
      expect(await errorOf(todo, ["list", "add", "1abc"])).toMatchObject({ code: "INVALID_INPUT" });
      expect(await errorOf(todo, ["list", "add", "a/b"])).toMatchObject({ code: "INVALID_INPUT" });
      expect(await errorOf(todo, ["add", "x", "--list=has space"])).toMatchObject({
        code: "INVALID_INPUT",
      });
    });

    test("lists Lists with counts, hiding Archived Lists unless asked", async () => {
      await todo(["add", "One", "--list=b-list"]);
      await todo(["add", "Two", "--list=b-list"]);
      await todo(["done", "1", "--list=b-list"]);
      await todo(["list", "add", "a-list"]);
      await todo(["list", "add", "old"]);
      await todo(["list", "archive", "old"]);
      const { lists } = await todo.json<{ lists: ListSummary[] }>(["list", "ls"]);
      expect(lists.map(list => [list.key, list.pending, list.done])).toEqual([
        ["a-list", 0, 0],
        ["b-list", 1, 1],
      ]);
      const all = await todo.json<{ lists: ListSummary[] }>(["list", "ls", "--archived"]);
      expect(all.lists.map(list => [list.key, list.archived])).toEqual([
        ["a-list", false],
        ["b-list", false],
        ["old", true],
      ]);
    });

    test("an Archived List's Items can't be used until it's unarchived", async () => {
      await todo(["add", "One", "--list=test-1"]);
      await todo(["list", "archive", "test-1"]);
      for (const args of [["ls"], ["add", "Two"], ["done", "1"], ["prompt"], ["show", "1"]]) {
        expect(await errorOf(todo, [...args, "--list=test-1"])).toMatchObject({
          code: "LIST_ARCHIVED",
        });
      }
      await todo(["add", "Elsewhere"]);
      expect(await errorOf(todo, ["cp", "1", "test-1"])).toMatchObject({ code: "LIST_ARCHIVED" });
      expect((await todo(["list", "show", "test-1"])).stdout).toBe(
        "# test-1 (archived)\n\n1 pending, 0 done\n\n- [ ] 1. One\n",
      );
      await todo(["list", "unarchive", "test-1"]);
      expect(descriptions(await todo.json<Items>(["ls", "--list=test-1"]))).toEqual(["One"]);
    });

    test("removes a List, needing --force when it has Items", async () => {
      await todo(["list", "add", "empty"]);
      await todo(["add", "One", "--list=full"]);
      expect((await todo(["list", "remove", "empty"])).code).toBe(0);
      expect(await errorOf(todo, ["list", "rm", "full"])).toMatchObject({ code: "LIST_NOT_EMPTY" });
      expect((await todo(["list", "rm", "full", "--force"])).code).toBe(0);
      expect(await errorOf(todo, ["list", "show", "full"])).toMatchObject({
        code: "LIST_NOT_FOUND",
      });
    });

    test("edits a List's description", async () => {
      await todo(["list", "add", "test-1"]);
      expect(
        (await todo.json<ListSummary>(["list", "edit", "test-1", "--description=New"])).description,
      ).toBe("New");
      expect(
        (await todo.json<ListSummary>(["list", "e", "test-1", "--description="])).description,
      ).toBeUndefined();
    });

    test("shows a List with the same filters as ls, or only its summary", async () => {
      await todo(["list", "add", "test-1", "--description=Desc"]);
      await todo(["add", "High", "--list=test-1", "--priority=high"]);
      await todo(["add", "Low", "--list=test-1", "--priority=low"]);
      await todo(["done", "1", "--list=test-1"]);
      const shown = await todo.json<{ list: ListSummary; items: Item[] }>([
        "list",
        "show",
        "test-1",
        "--all",
        "--priority=high",
      ]);
      expect(shown.list).toMatchObject({ key: "test-1", pending: 1, done: 1 });
      expect(descriptions(shown)).toEqual(["High"]);
      expect((await todo(["list", "show-summary", "test-1"])).stdout).toBe(
        "test-1\nDesc\n1 pending, 1 done\n",
      );
    });

    test("cleanup merges Duplicate Items into the oldest", async () => {
      await todo(["add", "Same", "--priority=low", "--notes=first"]);
      await todo(["add", "Same", "--priority=high", "--notes=second"]);
      await todo(["add", "Same", "--section=Other"]);
      await todo(["add", "Same"]);
      await todo(["done", "1"]);
      const { removed } = await todo.json<{ removed: Item[] }>(["list", "cleanup", "default"]);
      expect(removed.map(item => item.id)).toEqual([2, 4]);
      const [kept] = (await todo.json<Items>(["show", "1"])).items;
      expect(kept).toMatchObject({ priority: "high", done: false, notes: "first\n\nsecond" });
      expect(ids(await todo.json<Items>(["ls", "-a"]))).toEqual([1, 3]);
    });

    test("exports and imports Markdown, merging into an existing List", async () => {
      await todo(["list", "add", "test-1", "--description=The list."]);
      await todo(["add", "One", "--list=test-1", "--priority=high", "--notes=Some notes"]);
      await todo(["add", "Two", "--list=test-1", "--section=01 - UI"]);
      await todo(["done", "2", "--list=test-1"]);
      const markdown = (await todo(["list", "export", "test-1", "--json"])).stdout;
      expect(markdown).toBe(
        "# test-1\n\nThe list.\n\n- [ ] One (!high)\n  Some notes\n\n## 01 - UI\n\n- [x] Two\n",
      );

      const imported = await todo.json<Items>(["list", "import", "test-2"], markdown);
      expect(imported.items.map(item => [item.id, item.description, item.done])).toEqual([
        [1, "One", false],
        [2, "Two", true],
      ]);
      expect((await todo.json<ListSummary>(["list", "show-summary", "test-2"])).description).toBe(
        "The list.",
      );

      const again = await todo.json<Items>(
        ["list", "import", "test-2"],
        `${markdown}- [ ] Three\n`,
      );
      expect(ids(again)).toEqual([1, 2, 3]);
      expect((await todo.json<Items>(["show", "1", "--list=test-2"])).items[0]!.notes).toBe(
        "Some notes",
      );
    });

    test("import keeps a List's description and reports bad Markdown", async () => {
      await todo(["list", "add", "test-1", "--description=Mine"]);
      await todo(["list", "import", "test-1"], "# x\n\nTheirs\n\n- [ ] One\n");
      expect((await todo.json<ListSummary>(["list", "show-summary", "test-1"])).description).toBe(
        "Mine",
      );
      const bad = await todo(["list", "import", "test-1", "--json"], "- [ ] One\n\nStray text\n");
      expect(JSON.parse(bad.stdout).error.code).toBe("INVALID_INPUT");
    });

    test("copies a List on top of another, creating it with the description", async () => {
      await todo(["list", "add", "test-1", "--description=Desc"]);
      await todo(["add", "One", "--list=test-1"]);
      await todo(["add", "Two", "--list=test-1"]);
      await todo(["add", "Two", "--list=test-3"]);
      expect(await todo.json<ListSummary>(["list", "copy", "test-1", "test-2"])).toMatchObject({
        key: "test-2",
        description: "Desc",
        pending: 2,
      });
      expect(await todo.json<ListSummary>(["list", "cp", "test-1", "test-3"])).toMatchObject({
        pending: 2,
      });
      expect(descriptions(await todo.json<Items>(["ls", "--list=test-3"]))).toEqual(["Two", "One"]);
    });

    test("moving to a new key renames, keeping Item IDs", async () => {
      await todo(["add", "One", "--list=test-1"]);
      await todo(["add", "Two", "--list=test-1"]);
      await todo(["rm", "1", "--list=test-1"]);
      await todo(["list", "mv", "test-1", "test-2"]);
      expect(ids(await todo.json<Items>(["ls", "--list=test-2"]))).toEqual([2]);
      expect(await errorOf(todo, ["list", "show", "test-1"])).toMatchObject({
        code: "LIST_NOT_FOUND",
      });
    });

    test("moving onto an existing List merges and removes the source", async () => {
      await todo(["add", "One", "--list=test-1"]);
      await todo(["add", "Existing", "--list=test-2"]);
      await todo(["list", "move", "test-1", "test-2"]);
      expect(descriptions(await todo.json<Items>(["ls", "--list=test-2"]))).toEqual([
        "Existing",
        "One",
      ]);
      expect(await errorOf(todo, ["list", "show", "test-1"])).toMatchObject({
        code: "LIST_NOT_FOUND",
      });
    });
  });

  describe("invocation", () => {
    test("rejects options the command doesn't take", async () => {
      const result = await todo(["add", "x", "--all"]);
      expect(result.code).toBe(2);
      expect(result.stderr).toBe(
        "todo: --all is not an option of 'todo add'\nRun 'todo --help' for usage.\n",
      );
    });

    test("rejects unknown commands", async () => {
      expect((await todo(["frobnicate"])).code).toBe(2);
      expect((await todo(["list", "frobnicate"])).code).toBe(2);
    });

    test("prints help without touching the database", async () => {
      const bad = todoCli("postgres://nobody@127.0.0.1:1/none");
      expect((await bad(["--help"])).stdout).toStartWith("todo: a to-do list for coding agents");
      expect((await bad(["help", "add"])).stdout).toStartWith("Usage: todo add <description>");
      expect((await bad(["list", "rm", "--help"])).stdout).toStartWith(
        "Usage: todo list remove <key>",
      );
      expect((await bad(["list"])).stdout).toStartWith("Usage: todo list <command>");
      expect((await bad(["guide"])).stdout).toStartWith("# Using todo from an agent");
    });

    test("switches to JSON with TODO_FORMAT", async () => {
      const json = todoCli(await database.fresh(), { TODO_FORMAT: "json" });
      expect(JSON.parse((await json(["add", "One"])).stdout)).toMatchObject({ id: 1 });
      expect((await todoCli(await database.fresh(), { TODO_FORMAT: "yaml" })(["ls"])).code).toBe(2);
    });

    test("migrates on demand with TODO_NO_AUTO_MIGRATE", async () => {
      const manual = todoCli(await database.fresh(), { TODO_NO_AUTO_MIGRATE: "1" });
      expect((await manual(["add", "One"])).code).toBe(1);
      expect((await manual(["db", "migrate"])).code).toBe(0);
      expect((await manual(["add", "One"])).code).toBe(0);
    });
  });
});
