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

describe("renderMarkdown", () => {
  test("renders the List as a task list by Section, without IDs", () => {
    const items = [
      item(3, { section: "01 - UI", priority: "low" }),
      item(2, { done: true, doneAt: AT }),
      item(1, { priority: "high", notes: "Notes are indented.\n\nEven across blank lines." }),
    ];
    expect(renderMarkdown(list, items)).toBe(MARKDOWN);
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

  test("rejects an unknown priority mark", () => {
    expect(() => parseMarkdown("- [ ] One (!urgent)\n")).toThrow("invalid priority 'urgent'");
  });
});
