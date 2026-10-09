import type { ItemDraft, Priority } from "./types.ts";

const PRIORITY_RANK: Record<Priority, number> = { high: 3, medium: 2, low: 1 };

/** Higher is more important; no Priority ranks below Low. */
const priorityRank = (priority: Priority | undefined): number =>
  priority === undefined ? 0 : PRIORITY_RANK[priority];

/** Items with the same key are Duplicate Items. */
const duplicateKey = ({ description, section }: Pick<ItemDraft, "description" | "section">) =>
  JSON.stringify([section ?? "", description]);

const higherPriority = (a: Priority | undefined, b: Priority | undefined) =>
  priorityRank(b) > priorityRank(a) ? b : a;

/** Appends Notes the target doesn't already hold. */
const mergeNotes = (target: string | undefined, source: string | undefined) => {
  if (source === undefined || source === "") return target;
  if (target === undefined || target === "") return source;
  return target.includes(source) ? target : `${target}\n\n${source}`;
};

/**
 * Merges a Duplicate Item into the one that was in the List first: the higher
 * Priority wins, the result stays pending unless both are Done, and differing
 * Notes are appended.
 */
const mergeDuplicate = (target: ItemDraft, source: ItemDraft): ItemDraft => ({
  description: target.description,
  section: target.section,
  priority: higherPriority(target.priority, source.priority),
  notes: mergeNotes(target.notes, source.notes),
  doneAt: target.doneAt !== undefined && source.doneAt !== undefined ? target.doneAt : undefined,
});

export { duplicateKey, mergeDuplicate, priorityRank };
