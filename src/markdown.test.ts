import { describe, expect, test } from "bun:test";

import { TodoError } from "./errors.ts";
import { parseMarkdown, renderMarkdown } from "./markdown.ts";
import type { Item, List } from "./types.ts";

const AT = "2026-01-01T00:00:00.000Z";

const list: List = {
  key: "list-1",
  description: "The list.",
  archived: false,
  createdAt: AT,
  updatedAt: AT,
};

const item = (id: number, fields: Partial<Item> = {}): Item => ({
  list: "list-1",
  id,
  description: `Item ${id}`,
  done: false,
  createdAt: AT,
  updatedAt: AT,
  ...fields,
});

const MARKDOWN = `# list-1

The list.

- [ ] Item 1 (!high)
  Notes are indented.

  Even across blank lines.
- [x] Item 2

## 01 - UI

- [ ] Item 3 (!low)
`;

const ITEMS = [
  item(1, { priority: "high", notes: "Notes are indented.\n\nEven across blank lines." }),
  item(3, { section: "01 - UI", priority: "low" }),
  item(2, { done: true, doneAt: AT }),
];

describe("renderMarkdown", () => {
  test("renders the List as a task list by Section, keeping the order inside each", () => {
    expect(renderMarkdown(list, ITEMS, { ids: false })).toBe(MARKDOWN);
  });

  test("ends each Item's line with its ID by default", () => {
    expect(renderMarkdown(list, ITEMS)).toBe(
      MARKDOWN.replace("Item 1 (!high)", "Item 1 (!high) `id:1`")
        .replace("Item 2", "Item 2 `id:2`")
        .replace("Item 3 (!low)", "Item 3 (!low) `id:3`"),
    );
  });
});

describe("parseMarkdown", () => {
  test("reads what renderMarkdown writes", () => {
    expect(parseMarkdown(MARKDOWN)).toEqual({
      key: "list-1",
      description: "The list.",
      items: [
        {
          description: "Item 1",
          priority: "high",
          section: undefined,
          done: false,
          notes: "Notes are indented.\n\nEven across blank lines.",
        },
        { description: "Item 2", priority: undefined, section: undefined, done: true },
        { description: "Item 3", priority: "low", section: "01 - UI", done: false },
      ],
    });
  });

  test("accepts other bullets, X marks, and bullets without a checkbox", () => {
    const parsed = parseMarkdown("* [X] Done\n+ Plain\n- [ ] Medium (!MEDIUM)\n");
    expect(parsed.items.map(i => [i.description, i.done, i.priority])).toEqual([
      ["Done", true, undefined],
      ["Plain", false, undefined],
      ["Medium", false, "medium"],
    ]);
  });

  test("rejects text between items, naming the line", () => {
    expect(() => parseMarkdown("- [ ] One\n\nA stray paragraph.\n")).toThrow(
      new TodoError(
        "INVALID_INPUT",
        "line 3: expected a '- [ ]' item or a '## Section' heading, got 'A stray paragraph.'",
      ),
    );
  });

  test("reads an Item ID at the start or the very end of a line", () => {
    const parsed = parseMarkdown(
      "- [ ] `id:3` Start (!high)\n- [ ] End (!low) `id:12`\n- [ ] None\n",
    );
    expect(parsed.items.map(i => [i.id, i.description, i.priority])).toEqual([
      [3, "Start", "high"],
      [12, "End", "low"],
      [undefined, "None", undefined],
    ]);
    expect(parsed.items[2]).not.toHaveProperty("id");
  });

  test("keeps an ID in the middle of a line as part of the description", () => {
    const [parsed] = parseMarkdown("- [ ] Rename `id:3` to key (!low)\n").items;
    expect(parsed).toEqual({
      description: "Rename `id:3` to key",
      priority: "low",
      section: undefined,
      done: false,
    });
  });

  test("rejects the same Item ID twice, or two IDs on one line", () => {
    expect(() => parseMarkdown("- [ ] `id:3` One\n- [ ] Two `id:3`\n")).toThrow(
      new TodoError("INVALID_INPUT", "line 2: item 3 appears twice"),
    );
    expect(() => parseMarkdown("- [ ] `id:3` One `id:4`\n")).toThrow(
      "an ID at both the start and the end",
    );
  });

  test("rejects an unknown priority mark", () => {
    expect(() => parseMarkdown("- [ ] One (!urgent)\n")).toThrow("invalid priority 'urgent'");
  });
});
