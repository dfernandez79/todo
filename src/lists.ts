import { sql } from "kysely";

import { TodoError } from "./errors.ts";
import { type ItemFilter, filterItems, mergeIntoList } from "./items.ts";
import { parseMarkdown, renderMarkdown } from "./markdown.ts";
import { duplicateKey, mergeDuplicate } from "./merge.ts";
import {
  type ListRow,
  ensureWritableListRow,
  findListRow,
  getActiveListRow,
  getListRow,
  insertListRow,
  loadItemRows,
  loadListRows,
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
const createList = (store: TodoStore, key: string, options: { description?: string } = {}) =>
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
const editList = (store: TodoStore, key: string, changes: { description?: string }) =>
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

const archiveList = (store: TodoStore, key: string) => setArchived(store, key, true);

const unarchiveList = (store: TodoStore, key: string) => setArchived(store, key, false);

/** Removes a List and its Items; LIST_NOT_EMPTY unless empty or forced. */
const removeList = (store: TodoStore, key: string, options: { force?: boolean } = {}) =>
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
  const rows = (await loadItemRows(tx, source.id)).toSorted((a, b) => a.number - b.number);
  await mergeIntoList(tx, withDescription, rows.map(toDraft));
  return withDescription;
};

/** Copies a List's Items on top of another List, which is created if missing. */
const copyList = (store: TodoStore, from: string, to: string) =>
  inTransaction(store, async tx => {
    const { source, target } = keysOf(from, to);
    const sourceRow = await getListRow(tx, source);
    return summaryOf(tx, await copyRows(tx, sourceRow, target));
  });

/**
 * Renames a List when the target doesn't exist, keeping Item IDs. Otherwise
 * copies its Items on top of the target and removes it.
 */
const moveList = (store: TodoStore, from: string, to: string) =>
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
 * Merges the Duplicate Items of a List into the one with the lowest Item ID.
 * Returns the Items removed.
 */
const cleanupList = (store: TodoStore, key: string) =>
  inTransaction(store, async tx => {
    const row = await getActiveListRow(tx, parseListKey(key));
    const rows = (await loadItemRows(tx, row.id)).toSorted((a, b) => a.number - b.number);
    const kept = new Map<string, { row: (typeof rows)[number]; draft: ItemDraft }>();
    const removed: typeof rows = [];
    for (const item of rows) {
      const draft = toDraft(item);
      const duplicate = duplicateKey(draft);
      const survivor = kept.get(duplicate);
      if (survivor === undefined) kept.set(duplicate, { row: item, draft });
      else {
        survivor.draft = mergeDuplicate(survivor.draft, draft);
        removed.push(item);
      }
    }
    for (const { row: item, draft } of kept.values()) await updateItemRow(tx, item, draft);
    if (removed.length > 0) {
      await tx.db
        .deleteFrom("todo_items")
        .where(
          "id",
          "in",
          removed.map(item => item.id),
        )
        .execute();
    }
    return removed.map(item => toItem(item, row.key));
  });

/** A List as Markdown; works on Archived Lists too. */
const exportList = async (store: TodoStore, key: string): Promise<string> => {
  const row = await getListRow(store, parseListKey(key));
  const items = (await loadItemRows(store, row.id)).map(item => toItem(item, row.key));
  return renderMarkdown(toList(row), items);
};

/**
 * Merges the Items of a Markdown task list into a List, which is created if
 * missing. The Markdown's description is used only if the List has none.
 * Returns the resulting Items.
 */
const importList = (store: TodoStore, key: string, markdown: string) =>
  inTransaction(store, async tx => {
    const parsed = parseMarkdown(markdown);
    const listKey = parseListKey(key);
    let row = await ensureWritableListRow(tx, listKey);
    if (row.description === null && parsed.description !== undefined) {
      row = await touchListRow(tx, row, { description: parsed.description });
    }
    const now = tx.now();
    const drafts = parsed.items.map(({ done, ...item }) => ({
      ...item,
      doneAt: done ? now : undefined,
    }));
    const rows = await mergeIntoList(tx, row, drafts);
    return rows.map(item => toItem(item, row.key));
  });

export {
  archiveList,
  cleanupList,
  copyList,
  createList,
  editList,
  exportList,
  getListSummary,
  importList,
  listLists,
  moveList,
  removeList,
  showList,
  unarchiveList,
};
