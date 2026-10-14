import { sql } from "kysely";

import { TodoError } from "./errors.ts";
import { type ItemFilter, filterItems, mergeIntoList } from "./items.ts";
import { type ParsedList, type RenderOptions, parseMarkdown, renderMarkdown } from "./markdown.ts";
import { duplicateKey, mergeDuplicate } from "./merge.ts";
import {
  type ItemRow,
  type ListRow,
  deleteItemRows,
  ensureWritableListRow,
  findListRow,
  getActiveListRow,
  getListRow,
  insertListRow,
  loadItemRows,
  loadListRows,
  setItemPosition,
  setListArchivedAt,
  setListDescription,
  toDraft,
  toItem,
  toList,
  touchListRow,
  updateItemRow,
} from "./rows.ts";
import { type StoreContext, type TodoStore, inTransaction } from "./store.ts";
import { type Item, type ItemDraft, type ListSummary, parseListKey } from "./types.ts";

type Counts = { pending: number; done: number };

const countItems = async ({ db }: StoreContext, listIds?: readonly string[]) => {
  let query = db
    .selectFrom("todo_items")
    .select(["list_id", sql<number>`count(*)`.as("total"), sql<number>`count(done_at)`.as("done")])
    .groupBy("list_id");
  if (listIds !== undefined) query = query.where("list_id", "in", [...listIds]);
  const rows = listIds?.length === 0 ? [] : await query.execute();
  // PostgreSQL counts are bigints, which arrive as text.
  return new Map<string, Counts>(
    rows.map(row => [
      row.list_id,
      { pending: Number(row.total) - Number(row.done), done: Number(row.done) },
    ]),
  );
};

const summarize = (row: ListRow, counts: Map<string, Counts>): ListSummary => ({
  ...toList(row),
  ...(counts.get(row.id) ?? { pending: 0, done: 0 }),
});

const summaryOf = async (context: StoreContext, row: ListRow) =>
  summarize(row, await countItems(context, [row.id]));

const normalizeDescription = (description: string | undefined) =>
  description === undefined || description.trim() === "" ? undefined : description.trim();

/** Creates an empty List; LIST_EXISTS if the key is taken. */
const createList = (
  store: TodoStore,
  key: string,
  options: { description?: string } = {},
): Promise<ListSummary> =>
  inTransaction(store, async tx => {
    const listKey = parseListKey(key);
    if ((await findListRow(tx, listKey)) !== undefined) {
      throw new TodoError("LIST_EXISTS", `list '${listKey}' already exists`);
    }
    return summaryOf(
      tx,
      await insertListRow(tx, listKey, normalizeDescription(options.description)),
    );
  });

/** The Lists sorted by key, without Archived Lists unless asked for. */
const listLists = async (
  store: TodoStore,
  options: { archived?: boolean } = {},
): Promise<ListSummary[]> => {
  const rows = await loadListRows(store, { archived: options.archived === true });
  const counts = await countItems(store);
  return rows.map(row => summarize(row, counts));
};

/** A List's details and Item counts; works on Archived Lists too. */
const getListSummary = async (store: TodoStore, key: string): Promise<ListSummary> =>
  summaryOf(store, await getListRow(store, parseListKey(key)));

/** A List's summary and its Items; works on Archived Lists too. */
const showList = async (
  store: TodoStore,
  key: string,
  filter: ItemFilter = {},
): Promise<{ list: ListSummary; items: Item[] }> => {
  const row = await getListRow(store, parseListKey(key));
  const items = (await loadItemRows(store, row.id)).map(item => toItem(item, row.key));
  return { list: await summaryOf(store, row), items: filterItems(items, filter) };
};

/** Changes a List's description; `""` clears it. */
const editList = (
  store: TodoStore,
  key: string,
  changes: { description?: string },
): Promise<ListSummary> =>
  inTransaction(store, async tx => {
    const row = await getListRow(tx, parseListKey(key));
    if (changes.description === undefined) return summaryOf(tx, row);
    const updated = await setListDescription(tx, row, normalizeDescription(changes.description));
    return summaryOf(tx, updated);
  });

const setArchived = (store: TodoStore, key: string, archived: boolean) =>
  inTransaction(store, async tx => {
    const row = await getListRow(tx, parseListKey(key));
    if ((row.archived_at !== null) === archived) return summaryOf(tx, row);
    const updated = await setListArchivedAt(tx, row, archived ? tx.now() : undefined);
    return summaryOf(tx, updated);
  });

const archiveList = (store: TodoStore, key: string): Promise<ListSummary> =>
  setArchived(store, key, true);

const unarchiveList = (store: TodoStore, key: string): Promise<ListSummary> =>
  setArchived(store, key, false);

/** Removes a List and its Items; LIST_NOT_EMPTY unless empty or forced. */
const removeList = (
  store: TodoStore,
  key: string,
  options: { force?: boolean } = {},
): Promise<ListSummary> =>
  inTransaction(store, async tx => {
    const row = await getListRow(tx, parseListKey(key));
    const summary = await summaryOf(tx, row);
    if (summary.pending + summary.done > 0 && options.force !== true) {
      throw new TodoError(
        "LIST_NOT_EMPTY",
        `list '${row.key}' has ${summary.pending + summary.done} items; pass --force to remove it with them`,
      );
    }
    await tx.db.deleteFrom("todo_items").where("list_id", "=", row.id).execute();
    await tx.db.deleteFrom("todo_lists").where("id", "=", row.id).execute();
    return summary;
  });

const keysOf = (from: string, to: string) => {
  const source = parseListKey(from);
  const target = parseListKey(to);
  if (source === target) {
    throw new TodoError("INVALID_INPUT", `source and target are the same list '${source}'`);
  }
  return { source, target };
};

const copyRows = async (tx: StoreContext, source: ListRow, targetKey: string) => {
  const existing = await findListRow(tx, targetKey);
  const target = await ensureWritableListRow(tx, targetKey);
  const withDescription =
    existing === undefined && source.description !== null
      ? await touchListRow(tx, target, { description: source.description })
      : target;
  const rows = await loadItemRows(tx, source.id);
  await mergeIntoList(tx, withDescription, rows.map(toDraft));
  return withDescription;
};

/** Copies a List's Items on top of another List, which is created if missing. */
const copyList = (store: TodoStore, from: string, to: string): Promise<ListSummary> =>
  inTransaction(store, async tx => {
    const { source, target } = keysOf(from, to);
    const sourceRow = await getListRow(tx, source);
    return summaryOf(tx, await copyRows(tx, sourceRow, target));
  });

/**
 * Renames a List when the target doesn't exist, keeping Item IDs. Otherwise
 * copies its Items on top of the target and removes it.
 */
const moveList = (store: TodoStore, from: string, to: string): Promise<ListSummary> =>
  inTransaction(store, async tx => {
    const { source, target } = keysOf(from, to);
    const sourceRow = await getListRow(tx, source);
    if ((await findListRow(tx, target)) === undefined) {
      return summaryOf(tx, await touchListRow(tx, sourceRow, { key: target }));
    }
    const targetRow = await copyRows(tx, sourceRow, target);
    await tx.db.deleteFrom("todo_items").where("list_id", "=", sourceRow.id).execute();
    await tx.db.deleteFrom("todo_lists").where("id", "=", sourceRow.id).execute();
    return summaryOf(tx, targetRow);
  });

/**
 * Merges each group of Duplicate Items into the one with the lowest Item ID,
 * which keeps its Position. With `only`, merges just the groups holding one of
 * those row IDs. Returns the rows removed, and the survivor of every merged row.
 */
const mergeDuplicateRows = async (
  tx: StoreContext,
  rows: readonly ItemRow[],
  only?: ReadonlySet<string>,
) => {
  const groups = Map.groupBy(
    rows.toSorted((a, b) => a.number - b.number),
    row => duplicateKey(toDraft(row)),
  );
  const removed: ItemRow[] = [];
  const survivorOf = new Map<string, ItemRow>();
  for (const group of groups.values()) {
    if (group.length < 2 || (only !== undefined && !group.some(row => only.has(row.id)))) continue;
    const [first, ...rest] = group as [ItemRow, ...ItemRow[]];
    const draft = rest.reduce(
      (merged, row) => mergeDuplicate(merged, toDraft(row)),
      toDraft(first),
    );
    const survivor = await updateItemRow(tx, first, draft);
    for (const row of group) survivorOf.set(row.id, survivor);
    removed.push(...rest);
  }
  await deleteItemRows(tx, removed);
  return { removed: removed.toSorted((a, b) => a.number - b.number), survivorOf };
};

/**
 * Merges the Duplicate Items of a List into the one with the lowest Item ID.
 * Returns the Items removed.
 */
const cleanupList = (store: TodoStore, key: string): Promise<Item[]> =>
  inTransaction(store, async tx => {
    const row = await getActiveListRow(tx, parseListKey(key));
    const { removed } = await mergeDuplicateRows(tx, await loadItemRows(tx, row.id));
    return removed.map(item => toItem(item, row.key));
  });

const renderRows = async (
  context: StoreContext,
  row: ListRow,
  options: RenderOptions = {},
): Promise<string> => {
  const items = (await loadItemRows(context, row.id)).map(item => toItem(item, row.key));
  return renderMarkdown(toList(row), items, options);
};

/** A List as Markdown, by Position, with Item IDs unless `ids` is false; works on Archived Lists too. */
const exportList = async (
  store: TodoStore,
  key: string,
  options: RenderOptions = {},
): Promise<string> => renderRows(store, await getListRow(store, parseListKey(key)), options);

type ImportOptions = {
  /**
   * Make the List match the Markdown: remove the Items no line matches, and
   * replace the List's description with the Markdown's.
   */
  removeMissing?: boolean;
};

/** The resulting Item for each line, and the Item IDs of the Items removed. */
type ImportResult = { items: Item[]; removed: number[] };

const importRows = async (
  tx: StoreContext,
  listKey: string,
  parsed: ParsedList,
  options: ImportOptions,
): Promise<ImportResult> => {
  const useIds = parsed.key === undefined || parsed.key === listKey;
  if (options.removeMissing === true && !useIds) {
    throw new TodoError(
      "INVALID_INPUT",
      `the Markdown is list '${parsed.key}', not '${listKey}'; removing missing Items would remove them all`,
    );
  }
  let row = await ensureWritableListRow(tx, listKey);
  const description =
    options.removeMissing === true ? parsed.description : (row.description ?? parsed.description);
  if (description !== (row.description ?? undefined)) {
    row = await setListDescription(tx, row, description);
  }
  const now = tx.now();
  const byNumber = new Map((await loadItemRows(tx, row.id)).map(item => [item.number, item]));
  const results: ItemRow[] = [];
  const updated: { index: number; row: ItemRow }[] = [];
  const added: { index: number; draft: ItemDraft }[] = [];
  for (const [index, { id, done, ...fields }] of parsed.items.entries()) {
    const existing = useIds && id !== undefined ? byNumber.get(id) : undefined;
    if (existing === undefined) {
      added.push({ index, draft: { ...fields, doneAt: done ? now : undefined } });
      continue;
    }
    const doneAt = done ? (existing.done_at ?? now) : undefined;
    updated.push({ index, row: await updateItemRow(tx, existing, { ...fields, doneAt }) });
  }

  const slots = updated.map(item => item.row.position).toSorted((a, b) => a - b);
  for (const [i, item] of updated.entries()) {
    item.row = await setItemPosition(tx, item.row, slots[i]!);
  }
  const { survivorOf } = await mergeDuplicateRows(
    tx,
    await loadItemRows(tx, row.id),
    new Set(updated.map(item => item.row.id)),
  );
  for (const item of updated) results[item.index] = survivorOf.get(item.row.id) ?? item.row;

  const merged = await mergeIntoList(
    tx,
    row,
    added.map(item => item.draft),
  );
  for (const [i, item] of added.entries()) results[item.index] = merged[i]!;

  let removed: ItemRow[] = [];
  if (options.removeMissing === true) {
    const matched = new Set(results.map(item => item.id));
    removed = (await loadItemRows(tx, row.id)).filter(item => !matched.has(item.id));
    await deleteItemRows(tx, removed);
  }
  return {
    items: results.map(item => toItem(item, row.key)),
    removed: removed.map(item => item.number).toSorted((a, b) => a - b),
  };
};

/**
 * Imports a Markdown task list into a List, which is created if missing. The
 * Markdown's description is used only if the List has none.
 *
 * When the Markdown's `# key` is the List's, or it has none, an Item ID on a
 * line updates that Item, and the updated Items swap into the Positions they
 * held, in the Markdown's order; an update that makes Duplicate Items merges
 * them. Every other line merges into the List as a copy would, and new Items
 * go last.
 *
 * Import never removes an Item that the Markdown leaves out, unless
 * `removeMissing` is set: then it removes every Item that no line updated or
 * merged into, and the Markdown's description replaces the List's. With
 * `removeMissing`, Markdown of another List is INVALID_INPUT.
 */
const importList = (
  store: TodoStore,
  key: string,
  markdown: string,
  options: ImportOptions = {},
): Promise<ImportResult> =>
  inTransaction(store, async tx =>
    importRows(tx, parseListKey(key), parseMarkdown(markdown), options),
  );

/** A List's Markdown to edit: its export, or `# key` if it doesn't exist. LIST_ARCHIVED if archived. */
const listMarkdownToEdit = async (context: StoreContext, key: string): Promise<string> => {
  const listKey = parseListKey(key);
  if ((await findListRow(context, listKey)) === undefined) return `# ${listKey}\n`;
  return renderRows(context, await getActiveListRow(context, listKey));
};

/**
 * Imports a List's edited Markdown with `removeMissing`, if the List is still
 * as it was when `original` was read from it; otherwise LIST_CHANGED. Edits
 * that give a missing List no Items or description don't create it.
 */
const importEditedList = (
  store: TodoStore,
  key: string,
  original: string,
  edited: string,
): Promise<ImportResult> =>
  inTransaction(store, async tx => {
    const listKey = parseListKey(key);
    if ((await listMarkdownToEdit(tx, listKey)) !== original) {
      throw new TodoError("LIST_CHANGED", `list '${listKey}' changed while it was being edited`);
    }
    const parsed = parseMarkdown(edited);
    const missing = (await findListRow(tx, listKey)) === undefined;
    if (missing && parsed.items.length === 0 && parsed.description === undefined) {
      return { items: [], removed: [] };
    }
    return importRows(tx, listKey, parsed, { removeMissing: true });
  });

export {
  type ImportOptions,
  type ImportResult,
  archiveList,
  cleanupList,
  copyList,
  createList,
  editList,
  exportList,
  getListSummary,
  importEditedList,
  importList,
  listLists,
  listMarkdownToEdit,
  moveList,
  removeList,
  showList,
  unarchiveList,
};
