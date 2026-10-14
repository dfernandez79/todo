import { TodoError } from "./errors.ts";
import { duplicateKey, mergeDuplicate } from "./merge.ts";
import { sortItems } from "./order.ts";
import { renderPrompt } from "./prompt.ts";
import {
  type ItemRow,
  type ListRow,
  byPosition,
  deleteItemRows,
  ensureWritableListRow,
  findReadableListRow,
  getActiveListRow,
  getItemRows,
  insertItemRow,
  loadItemRows,
  nextPosition,
  setItemPosition,
  toDraft,
  toItem,
  updateItemRow,
} from "./rows.ts";
import { type StoreContext, type TodoStore, inTransaction } from "./store.ts";
import {
  type Item,
  type ItemDraft,
  type ItemMove,
  type ItemSort,
  type Priority,
  parseDescription,
  parseListKey,
  parseSection,
} from "./types.ts";

/** One List of a store, by its List Key. It need not exist yet. */
type TodoList = { readonly store: TodoStore; readonly key: string };

const todoList = (store: TodoStore, key: string): TodoList => ({ store, key: parseListKey(key) });

type AddItemOptions = { section?: string; priority?: Priority; notes?: string };

/** Which Items to list; by default, all the pending ones. */
type ItemFilter = {
  /** Include Done Items. */
  all?: boolean;
  /** Only the Items in this Section; `""` means Items with no Section. */
  section?: string;
  /** Only the Items with this Priority; `"none"` means Items with no Priority. */
  priority?: Priority | "none";
  /** How to order the Items inside each Section; by default, by Position. */
  sort?: ItemSort;
};

/** Changes to an Item. `""` clears the Section or Notes, and `"none"` the Priority. */
type ItemChanges = {
  description?: string;
  section?: string;
  priority?: Priority | "none";
  notes?: string;
  done?: boolean;
  /** Moves the Item within its Section, after the other changes. */
  move?: ItemMove;
};

const blankToUndefined = (text: string): string | undefined =>
  text.trim() === "" ? undefined : text;

const addItem = (
  list: TodoList,
  description: string,
  options: AddItemOptions = {},
): Promise<Item> =>
  inTransaction(list.store, async tx => {
    const row = await ensureWritableListRow(tx, list.key);
    const item = await insertItemRow(tx, row, {
      description: parseDescription(description),
      section: options.section === undefined ? undefined : parseSection(options.section),
      priority: options.priority,
      notes: options.notes === undefined ? undefined : blankToUndefined(options.notes),
    });
    return toItem(item, row.key);
  });

const matches = (item: Item, filter: ItemFilter): boolean =>
  (filter.all === true || !item.done) &&
  (filter.section === undefined || (item.section ?? "") === filter.section.trim()) &&
  (filter.priority === undefined || (item.priority ?? "none") === filter.priority);

/** Keeps the Items, given by Position, that match, sorted into display order. */
const filterItems = (items: readonly Item[], filter: ItemFilter): Item[] =>
  sortItems(
    items.filter(item => matches(item, filter)),
    filter.sort,
  );

/** The Items of a List in display order, by default only the pending ones. */
const listItems = async (list: TodoList, filter: ItemFilter = {}): Promise<Item[]> => {
  const row = await findReadableListRow(list.store, list.key);
  if (row === undefined) return [];
  const rows = await loadItemRows(list.store, row.id);
  return filterItems(
    rows.map(item => toItem(item, row.key)),
    filter,
  );
};

/** The Items with the given Item IDs, in that order. */
const getItems = async (list: TodoList, ids: readonly number[]): Promise<Item[]> => {
  const row = await getActiveListRow(list.store, list.key);
  const rows = await getItemRows(list.store, row, ids);
  return rows.map(item => toItem(item, row.key));
};

const applyChanges = (draft: ItemDraft, changes: ItemChanges, now: string): ItemDraft => {
  const next = { ...draft };
  if (changes.description !== undefined) next.description = parseDescription(changes.description);
  if (changes.section !== undefined) next.section = parseSection(changes.section);
  if (changes.priority !== undefined) {
    next.priority = changes.priority === "none" ? undefined : changes.priority;
  }
  if (changes.notes !== undefined) next.notes = blankToUndefined(changes.notes);
  if (changes.done !== undefined) next.doneAt = changes.done ? (draft.doneAt ?? now) : undefined;
  return next;
};

const moveTarget = (move: ItemMove, from: number, last: number): number => {
  if (move === "up") return Math.max(from - 1, 0);
  if (move === "down") return Math.min(from + 1, last);
  return move === "top" ? 0 : last;
};

/**
 * Moves an Item within its Section. A pending Item steps over Done Items,
 * which `todo ls` hides, so every move shows. Renumbers the List's Positions.
 */
const moveRow = async (
  tx: StoreContext,
  list: ListRow,
  row: ItemRow,
  move: ItemMove,
): Promise<ItemRow> => {
  const rows = await loadItemRows(tx, list.id);
  const pending = row.done_at === null;
  const siblings = rows.filter(
    other =>
      other.section === row.section && (other.id === row.id || !pending || other.done_at === null),
  );
  const from = siblings.findIndex(other => other.id === row.id);
  const to = moveTarget(move, from, siblings.length - 1);
  if (to === from) return row;
  const others = rows.filter(other => other.id !== row.id);
  const at = others.indexOf(siblings[to]!) + (to > from ? 1 : 0);
  let moved = row;
  for (const [index, item] of others.toSpliced(at, 0, row).entries()) {
    const updated = await setItemPosition(tx, item, index + 1);
    if (item.id === row.id) moved = updated;
  }
  return moved;
};

/** Changes an Item. A new Section puts it last; a move doesn't change its `updatedAt`. */
const editItem = (list: TodoList, id: number, changes: ItemChanges): Promise<Item> =>
  inTransaction(list.store, async tx => {
    const row = await getActiveListRow(tx, list.key);
    const [item] = await getItemRows(tx, row, [id]);
    let updated = await updateItemRow(tx, item!, applyChanges(toDraft(item!), changes, tx.now()));
    if (updated.section !== item!.section) {
      updated = await setItemPosition(tx, updated, await nextPosition(tx, row));
    }
    if (changes.move !== undefined) updated = await moveRow(tx, row, updated, changes.move);
    return toItem(updated, row.key);
  });

const markRowsDone = async (tx: StoreContext, row: ListRow, items: readonly ItemRow[]) => {
  const now = tx.now();
  const updated = [];
  for (const item of items) {
    const draft = toDraft(item);
    updated.push(await updateItemRow(tx, item, { ...draft, doneAt: draft.doneAt ?? now }));
  }
  return updated.map(item => toItem(item, row.key));
};

/** Marks Items Done; ones already Done keep their done time. */
const markDone = (list: TodoList, ids: readonly number[]): Promise<Item[]> =>
  inTransaction(list.store, async tx => {
    const row = await getActiveListRow(tx, list.key);
    return markRowsDone(tx, row, await getItemRows(tx, row, ids));
  });

/** Marks Done the pending Items of a Section, or of the whole List; returns those. */
const markAllDone = (list: TodoList, options: { section?: string } = {}): Promise<Item[]> =>
  inTransaction(list.store, async tx => {
    const row = await getActiveListRow(tx, list.key);
    const section = options.section?.trim();
    const pending = (await loadItemRows(tx, row.id)).filter(
      item => item.done_at === null && (section === undefined || (item.section ?? "") === section),
    );
    return sortItems(await markRowsDone(tx, row, pending));
  });

/** Removes Items, returning them as they were. */
const removeItems = (list: TodoList, ids: readonly number[]): Promise<Item[]> =>
  inTransaction(list.store, async tx => {
    const row = await getActiveListRow(tx, list.key);
    const rows = await getItemRows(tx, row, ids);
    await deleteItemRows(tx, rows);
    return rows.map(item => toItem(item, row.key));
  });

/**
 * Adds drafts to a List, merging each Duplicate Item into the one already
 * there. Returns the resulting row for each draft, in order.
 */
const mergeIntoList = async (
  tx: StoreContext,
  target: ListRow,
  drafts: readonly ItemDraft[],
): Promise<ItemRow[]> => {
  const byKey = new Map<string, ItemRow>();
  for (const row of (await loadItemRows(tx, target.id)).toSorted((a, b) => a.number - b.number)) {
    const key = duplicateKey(toDraft(row));
    if (!byKey.has(key)) byKey.set(key, row);
  }
  const results: ItemRow[] = [];
  for (const draft of drafts) {
    const key = duplicateKey(draft);
    const existing = byKey.get(key);
    const row =
      existing === undefined
        ? await insertItemRow(tx, target, draft)
        : await updateItemRow(tx, existing, mergeDuplicate(toDraft(existing), draft));
    byKey.set(key, row);
    results.push(row);
  }
  return results;
};

const assertDifferentLists = (from: string, to: string) => {
  if (from === to)
    throw new TodoError("INVALID_INPUT", `source and target are the same list '${from}'`);
};

const transferItems = (list: TodoList, ids: readonly number[], targetKey: string, move: boolean) =>
  inTransaction(list.store, async tx => {
    const target = parseListKey(targetKey);
    assertDifferentLists(list.key, target);
    const source = await getActiveListRow(tx, list.key);
    const rows = byPosition(await getItemRows(tx, source, ids));
    const targetRow = await ensureWritableListRow(tx, target);
    const merged = await mergeIntoList(tx, targetRow, rows.map(toDraft));
    if (move) await deleteItemRows(tx, rows);
    return merged.map(item => toItem(item, targetRow.key));
  });

/** Copies Items to another List, merging Duplicate Items; returns them as in the target. */
const copyItems = (list: TodoList, ids: readonly number[], targetKey: string): Promise<Item[]> =>
  transferItems(list, ids, targetKey, false);

/** Like `copyItems`, then removes the source Items. */
const moveItems = (list: TodoList, ids: readonly number[], targetKey: string): Promise<Item[]> =>
  transferItems(list, ids, targetKey, true);

type PromptSelection = { ids?: readonly number[]; section?: string; sort?: ItemSort };

/** A Prompt for the selected pending Items; with no selection, all of them. */
const buildPrompt = async (list: TodoList, selection: PromptSelection = {}): Promise<string> => {
  const ids = selection.ids ?? [];
  const row =
    ids.length > 0
      ? await getActiveListRow(list.store, list.key)
      : await findReadableListRow(list.store, list.key);
  const rows =
    row === undefined
      ? []
      : ids.length > 0
        ? byPosition(await getItemRows(list.store, row, ids))
        : await loadItemRows(list.store, row.id);
  const items = filterItems(
    rows.map(item => toItem(item, list.key)),
    { section: selection.section, sort: selection.sort },
  );
  return renderPrompt(list.key, row?.description ?? undefined, items);
};

export {
  type AddItemOptions,
  type ItemChanges,
  type ItemFilter,
  type PromptSelection,
  type TodoList,
  addItem,
  buildPrompt,
  copyItems,
  editItem,
  filterItems,
  getItems,
  listItems,
  markAllDone,
  markDone,
  mergeIntoList,
  moveItems,
  removeItems,
  todoList,
};
