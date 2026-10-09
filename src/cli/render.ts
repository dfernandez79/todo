import { groupBySection } from "../order.ts";
import type { Item, ListSummary } from "../types.ts";

const priorityMark = (item: Item) => (item.priority === undefined ? "" : ` (!${item.priority})`);

const itemLine = (item: Item) =>
  `- [${item.done ? "x" : " "}] ${item.id}. ${item.description}${priorityMark(item)}`;

/**
 * The Items of a List by Section, as `todo items` shows them, with optional
 * paragraphs between the heading and the Items.
 */
const renderItems = (
  listKey: string,
  items: readonly Item[],
  intro: readonly string[] = [],
): string => {
  const blocks = [`# ${listKey}`, ...intro];
  if (items.length === 0) blocks.push("No items.");
  for (const group of groupBySection(items)) {
    if (group.section !== undefined) blocks.push(`## ${group.section}`);
    blocks.push(group.items.map(itemLine).join("\n"));
  }
  return `${blocks.join("\n\n")}\n`;
};

const renderItemDetails = (item: Item): string => {
  const lines = [`#${item.id} ${item.description}`, `List: ${item.list}`];
  if (item.section !== undefined) lines.push(`Section: ${item.section}`);
  if (item.priority !== undefined) lines.push(`Priority: ${item.priority}`);
  lines.push(`Done: ${item.done ? "yes" : "no"}`);
  if (item.notes !== undefined) {
    lines.push("Notes:", ...item.notes.split("\n").map(line => (line === "" ? "" : `  ${line}`)));
  }
  return lines.join("\n");
};

const renderItemsDetails = (items: readonly Item[]): string =>
  `${items.map(renderItemDetails).join("\n\n")}\n`;

/** One line per Item, after a heading such as "Marked done:". */
const renderItemsChanged = (heading: string, items: readonly Item[]): string => {
  if (items.length === 0) return `${heading} none\n`;
  return `${heading}\n${items.map(item => `  ${item.id}. ${item.description}`).join("\n")}\n`;
};

const counts = (list: ListSummary) => `${list.pending} pending, ${list.done} done`;

const renderSummary = (list: ListSummary): string => {
  const title = list.archived ? `${list.key} (archived)` : list.key;
  const description = list.description === undefined ? "" : `${list.description}\n`;
  return `${title}\n${description}${counts(list)}\n`;
};

/** A List's heading, description and counts, then its Items. */
const renderListWithItems = (list: ListSummary, items: readonly Item[]): string => {
  const title = list.archived ? `${list.key} (archived)` : list.key;
  const intro = list.description === undefined ? [counts(list)] : [list.description, counts(list)];
  return renderItems(title, items, intro);
};

const renderLists = (lists: readonly ListSummary[]): string => {
  if (lists.length === 0) return "No lists.\n";
  const width = Math.max(...lists.map(list => list.key.length));
  const lines = lists.map(list => {
    const archived = list.archived ? " [archived]" : "";
    const description =
      list.description === undefined ? "" : `  ${list.description.split("\n")[0]}`;
    return `${list.key.padEnd(width)}  ${counts(list)}${archived}${description}`;
  });
  return `${lines.join("\n")}\n`;
};

export {
  renderItems,
  renderItemsChanged,
  renderItemsDetails,
  renderListWithItems,
  renderLists,
  renderSummary,
};
