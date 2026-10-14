import { itemIdMark, taskLine } from "../markdown.ts";
import { groupBySection } from "../order.ts";
import type { Item, ListSummary } from "../types.ts";
import { PLAIN, type Style } from "./style.ts";

type RenderOptions = {
  /** Show each Item's ID; by default, true. */
  ids?: boolean;
  style?: Style;
};

/**
 * The Items of a List, given in display order, by Section, as `todo items` shows them, with optional
 * paragraphs between the heading and the Items.
 */
const renderItems = (
  listKey: string,
  items: readonly Item[],
  intro: readonly string[] = [],
  options: RenderOptions = {},
): string => {
  const { ids = true, style = PLAIN } = options;
  const format = { id: style.id, done: style.done, description: style.inline };
  const itemLine = (item: Item) => taskLine(item, { ids, format });
  const blocks = [style.heading(`# ${listKey}`), ...intro];
  if (items.length === 0) blocks.push("No items.");
  for (const group of groupBySection(items)) {
    if (group.section !== undefined) blocks.push(style.section(`## ${group.section}`));
    blocks.push(group.items.map(itemLine).join("\n"));
  }
  return `${blocks.join("\n\n")}\n`;
};

/** What `todo add` prints: the new Item's ID, then its description. */
const renderAdded = (item: Item, style: Style = PLAIN): string =>
  `Added ${style.id(itemIdMark(item.id))}:\n${style.inline(item.description)}\n`;

const renderItemDetails = (item: Item, style: Style): string => {
  const lines = [
    `${style.id(`#${item.id}`)} ${style.inline(item.description)}`,
    `List: ${item.list}`,
  ];
  if (item.section !== undefined) lines.push(`Section: ${item.section}`);
  if (item.priority !== undefined) lines.push(`Priority: ${item.priority}`);
  lines.push(`Done: ${item.done ? "yes" : "no"}`);
  if (item.notes !== undefined) {
    lines.push("Notes:", ...item.notes.split("\n").map(line => (line === "" ? "" : `  ${line}`)));
  }
  return lines.join("\n");
};

const renderItemsDetails = (items: readonly Item[], style: Style = PLAIN): string =>
  `${items.map(item => renderItemDetails(item, style)).join("\n\n")}\n`;

/** One line per Item, after a heading such as "Marked done:". */
const renderItemsChanged = (
  heading: string,
  items: readonly Item[],
  style: Style = PLAIN,
): string => {
  if (items.length === 0) return `${heading} none\n`;
  const line = (item: Item) => `  ${style.id(`${item.id}.`)} ${style.inline(item.description)}`;
  return `${heading}\n${items.map(line).join("\n")}\n`;
};

const counts = (list: ListSummary) => `${list.pending} pending, ${list.done} done`;

const renderSummary = (list: ListSummary): string => {
  const title = list.archived ? `${list.key} (archived)` : list.key;
  const description = list.description === undefined ? "" : `${list.description}\n`;
  return `${title}\n${description}${counts(list)}\n`;
};

/** A List's heading, description and counts, then its Items. */
const renderListWithItems = (
  list: ListSummary,
  items: readonly Item[],
  style: Style = PLAIN,
): string => {
  const title = list.archived ? `${list.key} (archived)` : list.key;
  const intro = list.description === undefined ? [counts(list)] : [list.description, counts(list)];
  return renderItems(title, items, intro, { style });
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
  renderAdded,
  renderItems,
  renderItemsChanged,
  renderItemsDetails,
  renderListWithItems,
  renderLists,
  renderSummary,
};
