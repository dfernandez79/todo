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

/** An Item read from Markdown, before it has a done time. */
type ParsedItem = Omit<ItemDraft, "doneAt"> & { done: boolean };

type ParsedList = {
  key?: string;
  description?: string;
  items: ParsedItem[];
};

const priorityMark = (priority: Priority | undefined) =>
  priority === undefined ? "" : ` (!${priority})`;

const indent = (text: string, prefix: string) =>
  text
    .split("\n")
    .map(line => (line === "" ? "" : `${prefix}${line}`))
    .join("\n");

const renderItem = (item: Item): string => {
  const line = `- [${item.done ? "x" : " "}] ${item.description}${priorityMark(item.priority)}`;
  return item.notes === undefined ? line : `${line}\n${indent(item.notes, "  ")}`;
};

/** A List as a GitHub-flavored Markdown task list, without Item IDs. */
const renderMarkdown = (list: List, items: readonly Item[]): string => {
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
const INDENTED = /^(?:\s{2,}|\t)\S/;

const parseTask = (done: string | undefined, text: string, section?: string): ParsedItem => {
  const mark = PRIORITY_MARK.exec(text);
  const description = mark === null ? text : text.slice(0, mark.index);
  return {
    description: parseDescription(description),
    section,
    priority: mark === null ? undefined : parsePriority(mark[1]!),
    done: done === "x" || done === "X",
  };
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
 * `(!priority)` mark and indented notes.
 */
const parseMarkdown = (markdown: string): ParsedList => {
  const result: ParsedList = { items: [] };
  const description: string[] = [];
  let section: string | undefined;
  let started = false;
  let current: ParsedItem | undefined;
  let notes: string[] = [];

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

export { type ParsedItem, type ParsedList, parseMarkdown, renderMarkdown };
