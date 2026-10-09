import { groupBySection } from "./order.ts";
import type { Item } from "./types.ts";

const renderTask = (item: Item): string => {
  const priority = item.priority === undefined ? "" : ` (priority: ${item.priority})`;
  const line = `- #${item.id}: ${item.description}${priority}`;
  if (item.notes === undefined) return line;
  const notes = item.notes
    .split("\n")
    .map(text => (text === "" ? "" : `  ${text}`))
    .join("\n");
  return `${line}\n${notes}`;
};

/** A task brief for an agent: the Items by Section, and how to mark each one Done. */
const renderPrompt = (
  listKey: string,
  listDescription: string | undefined,
  items: readonly Item[],
): string => {
  if (items.length === 0) return `There are no pending tasks in the todo list \`${listKey}\`.\n`;

  const blocks = [`# Tasks from the todo list \`${listKey}\``];
  if (listDescription !== undefined) blocks.push(listDescription);
  for (const group of groupBySection(items)) {
    if (group.section !== undefined) blocks.push(`## ${group.section}`);
    blocks.push(group.items.map(renderTask).join("\n"));
  }
  const example = items[0]!.id;
  blocks.push(
    [
      "When you finish a task, mark it done with its ID:",
      "",
      `    todo done <id> --list=${listKey}`,
      "",
      `For example: \`todo done ${example} --list=${listKey}\`.`,
    ].join("\n"),
  );
  return `${blocks.join("\n\n")}\n`;
};

export { renderPrompt };
