import { TodoError } from "./errors.ts";
import { groupBySection } from "./order.ts";
import {
  type Item,
  type ItemDraft,
  type List,
  type Priority,
  parseDescription,
  parsePriority,
  parseSection,
} from "./types.ts";

/** An Item read from Markdown, before it has a done time, with its Item ID if the line had one. */
type ParsedItem = Omit<ItemDraft, "doneAt"> & { id?: number; done: boolean };

type ParsedList = {
  key?: string;
  description?: string;
  items: ParsedItem[];
};

const priorityMark = (priority: Priority | undefined) =>
  priority === undefined ? "" : ` (!${priority})`;

const identity = (text: string) => text;

const indent = (text: string, prefix: string) =>
  text
    .split("\n")
    .map(line => (line === "" ? "" : `${prefix}${line}`))
    .join("\n");

/** An Item ID as Markdown writes it: `` `id:3` ``. */
const itemIdMark = (id: number): string => `\`id:${id}\``;

/** Formats the parts of a task line, as for a terminal; by default, each is left as is. */
type TaskLineFormat = {
  id?: (text: string) => string;
  done?: (text: string) => string;
  description?: (text: string, options: { muted: boolean }) => string;
};

/** An Item's task line: `` - [ ] Fix login (!high) `id:3` ``, or without the ID. */
const taskLine = (item: Item, options: { ids: boolean; format?: TaskLineFormat }): string => {
  const { id = identity, done = identity, description = identity } = options.format ?? {};
  const mark = options.ids ? ` ${id(itemIdMark(item.id))}` : "";
  const text = description(item.description, { muted: item.done });
  const line = `- [${item.done ? "x" : " "}] ${text}${priorityMark(item.priority)}${mark}`;
  return item.done ? done(line) : line;
};

type RenderOptions = {
  /** Write each Item's ID at the end of its line; by default, true. */
  ids?: boolean;
};

/** A List, its Items given in display order, as a GitHub-flavored Markdown task list. */
const renderMarkdown = (
  list: List,
  items: readonly Item[],
  options: RenderOptions = {},
): string => {
  const ids = options.ids ?? true;
  const renderItem = (item: Item) => {
    const line = taskLine(item, { ids });
    return item.notes === undefined ? line : `${line}\n${indent(item.notes, "  ")}`;
  };
  const blocks = [`# ${list.key}`];
  if (list.description !== undefined) blocks.push(list.description);
  for (const group of groupBySection(items)) {
    if (group.section !== undefined) blocks.push(`## ${group.section}`);
    blocks.push(group.items.map(renderItem).join("\n"));
  }
  return `${blocks.join("\n\n")}\n`;
};

const HEADING = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const TASK = /^[-*+]\s+(?:\[([ xX])\](?:\s+|$))?(.*)$/;
const PRIORITY_MARK = /\s*\(!(\w+)\)\s*$/;
const LEADING_ID = /^`id:(\d+)`\s*/;
const TRAILING_ID = /\s*`id:(\d+)`\s*$/;
const INDENTED = /^(?:\s{2,}|\t)\S/;

/** Splits off the Item ID at the start of a task's text, or else at its very end. */
const splitItemId = (text: string): { id?: number; rest: string } => {
  const leading = LEADING_ID.exec(text);
  const trailing = TRAILING_ID.exec(text);
  if (leading !== null && trailing !== null) {
    throw new TodoError("INVALID_INPUT", `item '${text}' has an ID at both the start and the end`);
  }
  if (leading !== null) return { id: Number(leading[1]), rest: text.slice(leading[0].length) };
  if (trailing !== null) return { id: Number(trailing[1]), rest: text.slice(0, trailing.index) };
  return { rest: text };
};

const parseTask = (done: string | undefined, text: string, section?: string): ParsedItem => {
  const { id, rest } = splitItemId(text);
  const mark = PRIORITY_MARK.exec(rest);
  const description = mark === null ? rest : rest.slice(0, mark.index);
  const item: ParsedItem = {
    description: parseDescription(description),
    section,
    priority: mark === null ? undefined : parsePriority(mark[1]!),
    done: done === "x" || done === "X",
  };
  return id === undefined ? item : { id, ...item };
};

const dedent = (lines: readonly string[]): string => {
  const trimmed = lines.join("\n").replace(/\s+$/, "").split("\n");
  const margin = Math.min(
    ...trimmed.filter(line => line.trim() !== "").map(line => /^\s*/.exec(line)![0].length),
  );
  return trimmed.map(line => line.slice(margin)).join("\n");
};

/**
 * Reads a Markdown task list: `# key`, an optional description paragraph,
 * `## Section` headings, and `- [ ]` / `- [x]` items with an optional
 * `(!priority)` mark and indented notes. An item's ID, `` `id:3` ``, may start
 * or end its line; the same ID twice is INVALID_INPUT.
 */
const parseMarkdown = (markdown: string): ParsedList => {
  const result: ParsedList = { items: [] };
  const description: string[] = [];
  let section: string | undefined;
  let started = false;
  let current: ParsedItem | undefined;
  let notes: string[] = [];
  const ids = new Set<number>();

  const finishItem = () => {
    if (current === undefined) return;
    const text = notes.some(line => line.trim() !== "") ? dedent(notes) : undefined;
    result.items.push(text === undefined ? current : { ...current, notes: text });
    current = undefined;
    notes = [];
  };

  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  lines.forEach((line, index) => {
    if (current !== undefined && (line.trim() === "" || INDENTED.test(line))) {
      notes.push(line);
      return;
    }
    finishItem();
    if (line.trim() === "") return;

    const heading = HEADING.exec(line);
    if (heading !== null) {
      const [, hashes, text = ""] = heading;
      if (hashes === "#" && !started && result.key === undefined) result.key = text;
      else section = parseSection(text);
      started = started || hashes !== "#";
      return;
    }
    const task = TASK.exec(line);
    if (task !== null) {
      started = true;
      current = parseTask(task[1], task[2] ?? "", section);
      if (current.id !== undefined) {
        if (ids.has(current.id)) {
          throw new TodoError(
            "INVALID_INPUT",
            `line ${index + 1}: item ${current.id} appears twice`,
          );
        }
        ids.add(current.id);
      }
      return;
    }
    if (!started) {
      description.push(line.trim());
      return;
    }
    throw new TodoError(
      "INVALID_INPUT",
      `line ${index + 1}: expected a '- [ ]' item or a '## Section' heading, got '${line.trim()}'`,
    );
  });
  finishItem();

  if (description.length > 0) result.description = description.join("\n");
  return result;
};

export {
  type ParsedItem,
  type ParsedList,
  type RenderOptions,
  type TaskLineFormat,
  itemIdMark,
  parseMarkdown,
  renderMarkdown,
  taskLine,
};
