import { beforeEach, describe, expect, test } from "bun:test";
import { readFile, stat, writeFile } from "node:fs/promises";

import { type FakeEditor, type Todo, todoCli } from "../test-helpers/cli.ts";
import { DATABASES } from "../test-helpers/databases.ts";
import type { Item, ListSummary } from "../types.ts";

type Items = { list: string; items: Item[] };

type Imported = Items & { removed: number[] };

const ids = (result: { items: Item[] }) => result.items.map(item => item.id);

const descriptions = (result: { items: Item[] }) => result.items.map(item => item.description);

const exists = (file: string) =>
  stat(file).then(
    () => true,
    () => false,
  );

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
      expect((await todo(["add", "Third"])).stdout).toBe("Added `id:3`:\nThird\n");
      expect(other.list).toBe("list-2");
    });

    test("lists Items without their IDs with --no-ids, also as the default command", async () => {
      await todo(["add", "One"]);
      expect((await todo([])).stdout).toBe("# default\n\n- [ ] One `id:1`\n");
      expect((await todo(["--no-ids"])).stdout).toBe("# default\n\n- [ ] One\n");
      expect((await todo(["ls", "--no-ids"])).stdout).toBe("# default\n\n- [ ] One\n");
    });

    test("colors text output only when asked, or for a terminal", async () => {
      await todo(["add", "Fix **login**", "--section=UI"]);
      await todo(["add", "Old", "--section=UI"]);
      await todo(["done", "2"]);
      const colored = (await todo(["ls", "-a", "--color"])).stdout;
      expect(colored).toBe(
        [
          "\u001B[1m# default\u001B[22m",
          "",
          "\u001B[1m\u001B[34m## UI\u001B[39m\u001B[22m",
          "",
          "- [ ] Fix \u001B[1mlogin\u001B[22m \u001B[90m`id:1`\u001B[39m",
          "\u001B[90m- [x] Old \u001B[90m`id:2`\u001B[39m\u001B[39m",
          "",
        ].join("\n"),
      );
      expect((await todo(["ls"])).stdout).not.toContain("\u001B");
      expect((await todo(["ls", "--color", "--no-color"])).stdout).not.toContain("\u001B");
      expect((await todo(["ls", "--color", "--json"])).stdout).not.toContain("\u001B");
      expect((await todo(["export", "--color"])).stdout).not.toContain("\u001B");
      expect((await todo(["prompt", "--color"])).stdout).not.toContain("\u001B");

      const forced = todoCli(await database.fresh(), { FORCE_COLOR: "1" });
      expect((await forced(["add", "One"])).stdout).toBe(
        "Added \u001B[90m`id:1`\u001B[39m:\nOne\n",
      );
      const both = todoCli(await database.fresh(), { FORCE_COLOR: "1", NO_COLOR: "1" });
      expect((await both(["add", "One"])).stdout).toBe("Added `id:1`:\nOne\n");
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

    test("lists pending Items by Section, then Priority with --sort=priority", async () => {
      await todo(["add", "b-none", "--section=B"]);
      await todo(["add", "loose-low", "-p", "low"]);
      await todo(["add", "a-high", "--section=A", "--priority=high"]);
      await todo(["add", "loose"]);
      await todo(["add", "loose-high", "--priority=high"]);
      await todo(["add", "a-medium", "--section=A", "--priority=medium"]);
      await todo(["add", "done"]);
      await todo(["done", "7"]);

      expect(descriptions(await todo.json<Items>(["items", "--sort=priority"]))).toEqual([
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
      expect((await todo(["ls", "--sort=priority"])).stdout).toBe(
        [
          "# default",
          "",
          "- [ ] loose-high (!high) `id:5`",
          "- [ ] loose-low (!low) `id:2`",
          "- [ ] loose `id:4`",
          "",
          "## A",
          "",
          "- [ ] a-high (!high) `id:3`",
          "- [ ] a-medium (!medium) `id:6`",
          "",
          "## B",
          "",
          "- [ ] b-none `id:1`",
          "",
        ].join("\n"),
      );
    });

    test("lists Items by Section, then Position, by default", async () => {
      await todo(["add", "b-one", "--section=B"]);
      await todo(["add", "loose-low", "--priority=low"]);
      await todo(["add", "loose-high", "--priority=high"]);
      await todo(["add", "b-two", "--section=B", "--priority=high"]);
      expect(descriptions(await todo.json<Items>(["ls"]))).toEqual([
        "loose-low",
        "loose-high",
        "b-one",
        "b-two",
      ]);
      expect(await errorOf(todo, ["ls", "--sort=id"])).toMatchObject({ code: "INVALID_INPUT" });
    });

    test("moves an Item within its Section, stepping over hidden Done Items", async () => {
      for (const description of ["one", "two", "three", "four"]) await todo(["add", description]);
      await todo(["add", "other", "--section=S"]);
      await todo(["done", "2"]);
      const before = (await todo.json<Items>(["show", "3"])).items[0]!;

      const moved = await todo.json<Item>(["edit", "3", "--move=up"]);
      expect(moved.updatedAt).toBe(before.updatedAt);
      expect(descriptions(await todo.json<Items>(["ls"]))).toEqual([
        "three",
        "one",
        "four",
        "other",
      ]);
      expect(descriptions(await todo.json<Items>(["ls", "-a"]))).toEqual([
        "three",
        "one",
        "two",
        "four",
        "other",
      ]);

      await todo(["edit", "3", "--move=up"]);
      expect(descriptions(await todo.json<Items>(["ls"]))).toEqual([
        "three",
        "one",
        "four",
        "other",
      ]);
      await todo(["edit", "3", "--move=bottom"]);
      expect(descriptions(await todo.json<Items>(["ls"]))).toEqual([
        "one",
        "four",
        "three",
        "other",
      ]);
      await todo(["edit", "3", "--move=top"]);
      await todo(["edit", "1", "--move=down"]);
      expect(descriptions(await todo.json<Items>(["ls"]))).toEqual([
        "three",
        "four",
        "one",
        "other",
      ]);
      expect(await errorOf(todo, ["edit", "1", "--move=left"])).toMatchObject({
        code: "INVALID_INPUT",
      });
    });

    test("a new Section puts an Item last in it, before any move", async () => {
      await todo(["add", "one", "--section=S"]);
      await todo(["add", "two", "--section=S"]);
      await todo(["add", "three"]);
      await todo(["edit", "3", "--section=S"]);
      expect(descriptions(await todo.json<Items>(["ls"]))).toEqual(["one", "two", "three"]);
      await todo(["edit", "1", "--section=", "--move=top"]);
      await todo(["edit", "3", "--section=", "--move=top"]);
      expect(descriptions(await todo.json<Items>(["ls"]))).toEqual(["three", "one", "two"]);
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
        "# test-1 (archived)\n\n1 pending, 0 done\n\n- [ ] One `id:1`\n",
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
      expect((await todo(["list", "export", "test-1"])).stdout).toBe(
        "# test-1\n\nThe list.\n\n- [ ] One (!high) `id:1`\n  Some notes\n\n## 01 - UI\n\n- [x] Two `id:2`\n",
      );
      const markdown = (await todo(["list", "export", "test-1", "--no-ids", "--json"])).stdout;
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

    test("import updates the Items whose IDs it names, keeping their Positions", async () => {
      for (const description of ["One", "Two", "Three", "Four", "Five"]) {
        await todo(["add", description, "--list=test-1"]);
      }
      await todo(["edit", "2", "--notes=Old notes", "--list=test-1"]);
      const imported = await todo.json<Items>(
        ["list", "import", "test-1"],
        "# test-1\n\n- [x] `id:4` Four done (!high)\n- [ ] Two again (!low) `id:2`\n- [ ] Six `id:99`\n",
      );
      expect(imported.items.map(item => [item.id, item.description, item.done])).toEqual([
        [4, "Four done", true],
        [2, "Two again", false],
        [6, "Six", false],
      ]);
      const listed = await todo.json<Items>(["ls", "-a", "--list=test-1"]);
      expect(listed.items.map(item => [item.id, item.description])).toEqual([
        [1, "One"],
        [4, "Four done"],
        [3, "Three"],
        [2, "Two again"],
        [5, "Five"],
        [6, "Six"],
      ]);
      expect(listed.items[3]).toMatchObject({ priority: "low" });
      expect(listed.items[3]!.notes).toBeUndefined();
    });

    test("import merges the Duplicate Items an update makes", async () => {
      await todo(["add", "Same", "--list=test-1", "--priority=low"]);
      await todo(["add", "Other", "--list=test-1"]);
      const imported = await todo.json<Items>(
        ["list", "import", "test-1"],
        "- [ ] Same (!high) `id:2`\n",
      );
      expect(ids(imported)).toEqual([1]);
      expect((await todo.json<Items>(["ls", "--list=test-1"])).items).toMatchObject([
        { id: 1, description: "Same", priority: "high" },
      ]);
    });

    test("export and import work on the List from --list or TODO_LIST", async () => {
      const env = todoCli(await database.fresh(), { TODO_LIST: "proj-1" });
      await env(["add", "One"]);
      const markdown = (await env(["export"])).stdout;
      expect(markdown).toBe((await env(["list", "export", "proj-1"])).stdout);
      expect(markdown).toBe("# proj-1\n\n- [ ] One `id:1`\n");
      expect((await env(["export", "--no-ids"])).stdout).toBe("# proj-1\n\n- [ ] One\n");

      await env(["import", "--list=proj-2"], "- [ ] Two\n");
      await env(["import"], "- [ ] One again `id:1`\n");
      expect(descriptions(await env.json<Items>(["ls"]))).toEqual(["One again"]);
      expect(descriptions(await env.json<Items>(["ls", "--list=proj-2"]))).toEqual(["Two"]);
      expect((await env(["export", "proj-2"])).code).toBe(2);
    });

    test("import ignores the IDs of another List's Markdown", async () => {
      await todo(["add", "Mine", "--list=test-2"]);
      await todo(["add", "Theirs", "--list=test-1"]);
      const markdown = (await todo(["list", "export", "test-1"])).stdout;
      expect(markdown).toBe("# test-1\n\n- [ ] Theirs `id:1`\n");
      await todo(["list", "import", "test-2"], markdown);
      expect(descriptions(await todo.json<Items>(["ls", "--list=test-2"]))).toEqual([
        "Mine",
        "Theirs",
      ]);
    });

    test("copies Items last in the target, in their source order", async () => {
      await todo(["add", "Existing", "--list=test-2"]);
      for (const description of ["One", "Two", "Three"]) {
        await todo(["add", description, "--list=test-1"]);
      }
      await todo(["edit", "3", "--move=top", "--list=test-1"]);
      await todo(["cp", "1", "3", "test-2", "--list=test-1"]);
      expect(descriptions(await todo.json<Items>(["ls", "--list=test-2"]))).toEqual([
        "Existing",
        "Three",
        "One",
      ]);
    });

    test("import keeps a List's description and reports bad Markdown", async () => {
      await todo(["list", "add", "test-1", "--description=Mine"]);
      await todo(["list", "import", "test-1"], "# x\n\nTheirs\n\n- [ ] One\n");
      expect((await todo.json<ListSummary>(["list", "show-summary", "test-1"])).description).toBe(
        "Mine",
      );
      const bad = await todo(["list", "import", "test-1", "--json"], "- [ ] `id:1` One `id:2`\n");
      expect(JSON.parse(bad.stdout).error.code).toBe("INVALID_INPUT");
    });

    test("import reports no removed Items without --remove-missing", async () => {
      await todo(["add", "One", "--list=test-1"]);
      const imported = await todo.json<Imported>(["list", "import", "test-1"], "- [ ] Two\n");
      expect(imported.removed).toEqual([]);
      expect((await todo(["import", "--list=test-1"], "- [ ] Three\n")).stdout).toBe(
        "Imported 1 items into test-1, removed 0\n",
      );
    });

    test("import --remove-missing removes the Items no line matches", async () => {
      await todo(["list", "add", "test-1", "--description=Old"]);
      for (const description of ["One", "Two", "Three"]) {
        await todo(["add", description, "--list=test-1"]);
      }
      await todo(["add", "Four", "--list=test-1", "--section=UI"]);
      const imported = await todo.json<Imported>(
        ["list", "import", "test-1", "--remove-missing"],
        "# test-1\n\nNew.\n\n- [ ] One again `id:1`\n- [ ] Three\n- [ ] Five\n",
      );
      expect(ids(imported)).toEqual([1, 3, 5]);
      expect(imported.removed).toEqual([2, 4]);
      expect(descriptions(await todo.json<Items>(["ls", "-a", "--list=test-1"]))).toEqual([
        "One again",
        "Three",
        "Five",
      ]);
      expect((await todo.json<ListSummary>(["list", "show-summary", "test-1"])).description).toBe(
        "New.",
      );

      await todo(["import", "--list=test-1", "--remove-missing"], "- [ ] Three\n");
      const summary = await todo.json<ListSummary>(["list", "show-summary", "test-1"]);
      expect(summary).toMatchObject({ pending: 1 });
      expect(summary.description).toBeUndefined();
    });

    test("import --remove-missing rejects another List's Markdown", async () => {
      await todo(["add", "Mine", "--list=test-2"]);
      const theirs = await todo(
        ["list", "import", "test-2", "--remove-missing", "--json"],
        "# test-1\n\n- [ ] Theirs `id:1`\n",
      );
      expect(JSON.parse(theirs.stdout).error.code).toBe("INVALID_INPUT");
      expect(descriptions(await todo.json<Items>(["ls", "--list=test-2"]))).toEqual(["Mine"]);
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

  describe("editing a List", () => {
    let path: string;

    beforeEach(async () => {
      path = await database.fresh();
      todo = todoCli(path);
      await todo(["add", "One", "--priority=high"]);
      await todo(["add", "Two", "--section=UI"]);
      await todo(["add", "Three", "--section=UI"]);
      await todo(["done", "3"]);
    }, 30_000);

    /** A `todo` whose editor replaces the file's text with `edit`'s, recording what it saw. */
    const editing = (edit: (text: string) => string, env: Record<string, string> = {}) => {
      const seen: { command?: string; file?: string; text?: string } = {};
      const editor: FakeEditor = async (command, file) => {
        Object.assign(seen, { command, file, text: await readFile(file, "utf8") });
        await writeFile(file, edit(seen.text!));
        return 0;
      };
      return { cli: todoCli(path, { EDITOR: "ed", ...env }, editor), seen };
    };

    test("opens the List's Markdown and imports the edits, removing deleted lines", async () => {
      const { cli, seen } = editing(text =>
        text
          .replace("One (!high)", "One edited (!low)")
          .replace("- [ ] Two `id:2`\n", "Stray text\n")
          .concat("- [ ] Four\n"),
      );
      const result = await cli.json<Imported>(["edit"]);
      expect(seen.command).toBe("ed");
      expect(seen.text).toBe(
        "# default\n\n- [ ] One (!high) `id:1`\n\n## UI\n\n- [ ] Two `id:2`\n- [x] Three `id:3`\n",
      );
      expect(result).toMatchObject({ list: "default", removed: [2] });
      expect(ids(result)).toEqual([1, 3, 4]);
      const listed = await todo.json<Items>(["ls", "-a"]);
      expect(
        listed.items.map(item => [item.id, item.description, item.priority, item.done]),
      ).toEqual([
        [1, "One edited", "low", false],
        [3, "Three", undefined, true],
        [4, "Four", undefined, false],
      ]);
      expect(await exists(seen.file!)).toBe(false);
    });

    test("prefers $VISUAL to $EDITOR, and fails without either", async () => {
      const { cli, seen } = editing(text => text, { VISUAL: "vis" });
      await cli(["edit"]);
      expect(seen.command).toBe("vis");
      const none = todoCli(path);
      const result = await none(["edit"]);
      expect(result.code).toBe(2);
      expect(result.stderr).toStartWith("todo: set $VISUAL or $EDITOR to edit a List");
    });

    test("changes nothing when the file is saved unchanged", async () => {
      const { cli, seen } = editing(text => text);
      expect(await cli.json<Imported>(["edit"])).toEqual({
        list: "default",
        items: [],
        removed: [],
      });
      expect((await cli(["edit"])).stdout).toBe("No changes to default\n");
      expect(await exists(seen.file!)).toBe(false);
    });

    test("changes nothing when the editor fails", async () => {
      const cli = todoCli(path, { EDITOR: "ed" }, async (_command, file) => {
        await writeFile(file, "# default\n");
        return 1;
      });
      expect(await errorOf(cli, ["edit"])).toMatchObject({ code: "EDITOR_FAILED", exit: 1 });
      expect(ids(await todo.json<Items>(["ls", "-a"]))).toEqual([1, 2, 3]);
    });

    test("keeps the file of an invalid edit, changing nothing", async () => {
      const { cli, seen } = editing(text => text.replace("`id:2`", "`id:1`"));
      const error = await errorOf(cli, ["edit"]);
      expect(error.code).toBe("INVALID_INPUT");
      expect(error.message).toContain(seen.file!);
      expect(await readFile(seen.file!, "utf8")).toContain("- [ ] Two `id:1`");
      expect(ids(await todo.json<Items>(["ls", "-a"]))).toEqual([1, 2, 3]);
    });

    test("keeps the file when the List changed while the editor was open", async () => {
      let file = "";
      const cli = todoCli(path, { EDITOR: "ed" }, async (_command, opened) => {
        file = opened;
        await writeFile(opened, "# default\n\n- [ ] Only\n");
        await todo(["add", "Added meanwhile"]);
        return 0;
      });
      const error = await errorOf(cli, ["edit"]);
      expect(error.code).toBe("LIST_CHANGED");
      expect(error.message).toContain(file);
      expect(descriptions(await todo.json<Items>(["ls"]))).toEqual([
        "One",
        "Added meanwhile",
        "Two",
      ]);
    });

    test("fails on an Archived List before opening the editor", async () => {
      await todo(["add", "x", "--list=old"]);
      await todo(["list", "archive", "old"]);
      expect(await errorOf(todoCli(path, { EDITOR: "ed" }), ["edit", "--list=old"])).toMatchObject({
        code: "LIST_ARCHIVED",
      });
    });

    test("creates a missing List only if the edit adds to it", async () => {
      const blank = editing(text => `${text}\n## Later\n\nJust a thought.\n`);
      await blank.cli(["edit", "--list=new-1"]);
      expect(blank.seen.text).toBe("# new-1\n");
      expect(await errorOf(todo, ["list", "show", "new-1"])).toMatchObject({
        code: "LIST_NOT_FOUND",
      });
      const added = editing(text => `${text}\n- [ ] First\n`);
      expect(ids(await added.cli.json<Imported>(["edit", "--list=new-1"]))).toEqual([1]);
    });

    test("still needs an Item ID to take options", async () => {
      expect((await todoCli(path, { EDITOR: "ed" })(["edit", "--priority=low"])).code).toBe(2);
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

    test("takes the PostgreSQL connection timeout from --db-timeout or TODO_DATABASE_TIMEOUT", async () => {
      const path = await database.fresh();
      expect((await todoCli(path)(["add", "One", "--db-timeout=2.5"])).code).toBe(0);
      const env = todoCli(path, { TODO_DATABASE_TIMEOUT: "10" });
      expect((await env(["ls"])).code).toBe(0);
      for (const bad of ["0", "-1", "soon", ""]) {
        expect((await todoCli(path)(["ls", `--db-timeout=${bad}`])).code).toBe(2);
        const badEnv = todoCli(path, { TODO_DATABASE_TIMEOUT: bad || " " });
        expect((await badEnv(["ls"])).code).toBe(2);
      }
    });

    test("migrates on demand with TODO_NO_AUTO_MIGRATE", async () => {
      const manual = todoCli(await database.fresh(), { TODO_NO_AUTO_MIGRATE: "1" });
      expect((await manual(["add", "One"])).code).toBe(1);
      expect((await manual(["db", "migrate"])).code).toBe(0);
      expect((await manual(["add", "One"])).code).toBe(0);
    });
  });
});

describe("the PostgreSQL connection timeout", () => {
  test("is how long a command waits to connect", async () => {
    // A non-routable address, where connecting hangs instead of failing.
    const unreachable = todoCli("postgres://nobody@10.255.255.1:5432/none");
    const started = Date.now();
    expect((await unreachable(["ls", "--db-timeout=0.3"])).code).toBe(1);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
