import type { Selectable } from "kysely";

import type { ItemsTable, ListsTable } from "./db/schema.ts";
import { TodoError } from "./errors.ts";
import type { StoreContext } from "./store.ts";
import { type Item, type ItemDraft, type List, isPriority } from "./types.ts";

type ListRow = Selectable<ListsTable>;
type ItemRow = Selectable<ItemsTable>;

/** The List used when none is given; it reads as empty before it exists. */
const DEFAULT_LIST_KEY = "default";

const toList = (row: ListRow): List => ({
  key: row.key,
  description: row.description ?? undefined,
  archived: row.archived_at !== null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  archivedAt: row.archived_at ?? undefined,
});

const toItem = (row: ItemRow, listKey: string): Item => ({
  list: listKey,
  id: row.number,
  description: row.description,
  notes: row.notes ?? undefined,
  section: row.section ?? undefined,
  priority: row.priority !== null && isPriority(row.priority) ? row.priority : undefined,
  done: row.done_at !== null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  doneAt: row.done_at ?? undefined,
});

const toDraft = (row: ItemRow): ItemDraft => {
  const { description, notes, section, priority, doneAt } = toItem(row, "");
  return { description, notes, section, priority, doneAt };
};

const listNotFound = (key: string) => new TodoError("LIST_NOT_FOUND", `list '${key}' not found`);

const assertNotArchived = (row: ListRow): ListRow => {
  if (row.archived_at !== null) {
    throw new TodoError(
      "LIST_ARCHIVED",
      `list '${row.key}' is archived; unarchive it with \`todo list unarchive ${row.key}\``,
    );
  }
  return row;
};

const findListRow = ({ db }: StoreContext, key: string): Promise<ListRow | undefined> =>
  db.selectFrom("todo_lists").selectAll().where("key", "=", key).executeTakeFirst();

const getListRow = async (context: StoreContext, key: string): Promise<ListRow> => {
  const row = await findListRow(context, key);
  if (row === undefined) throw listNotFound(key);
  return row;
};

/** A List whose Items can be used: it exists and isn't archived. */
const getActiveListRow = async (context: StoreContext, key: string): Promise<ListRow> =>
  assertNotArchived(await getListRow(context, key));

/** Like `getActiveListRow`, but the missing default List is `undefined`, i.e. empty. */
const findReadableListRow = async (
  context: StoreContext,
  key: string,
): Promise<ListRow | undefined> => {
  const row = await findListRow(context, key);
  if (row === undefined) {
    if (key === DEFAULT_LIST_KEY) return undefined;
    throw listNotFound(key);
  }
  return assertNotArchived(row);
};

const insertListRow = async (
  { db, now, newId }: StoreContext,
  key: string,
  description?: string,
): Promise<ListRow> => {
  const at = now();
  return db
    .insertInto("todo_lists")
    .values({
      id: newId(),
      key,
      description: description ?? null,
      archived_at: null,
      next_item_number: 1,
      created_at: at,
      updated_at: at,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
};

/** The List a write goes to, created if it doesn't exist. */
const ensureWritableListRow = async (context: StoreContext, key: string): Promise<ListRow> => {
  const row = await findListRow(context, key);
  return row === undefined ? insertListRow(context, key) : assertNotArchived(row);
};

const loadItemRows = ({ db }: StoreContext, listId: string): Promise<ItemRow[]> =>
  db.selectFrom("todo_items").selectAll().where("list_id", "=", listId).execute();

/** The rows of the given Item IDs, in the order given, or ITEM_NOT_FOUND naming the missing ones. */
const getItemRows = async (
  context: StoreContext,
  list: ListRow,
  ids: readonly number[],
): Promise<ItemRow[]> => {
  const unique = [...new Set(ids)];
  const rows =
    unique.length === 0
      ? []
      : await context.db
          .selectFrom("todo_items")
          .selectAll()
          .where("list_id", "=", list.id)
          .where("number", "in", unique)
          .execute();
  const byNumber = new Map(rows.map(row => [row.number, row]));
  const missing = unique.filter(id => !byNumber.has(id));
  if (missing.length > 0) {
    const noun = missing.length === 1 ? "item" : "items";
    throw new TodoError(
      "ITEM_NOT_FOUND",
      `${noun} ${missing.join(", ")} not found in list '${list.key}'`,
    );
  }
  return unique.map(id => byNumber.get(id)!);
};

/** Takes the next Item ID of a List; the counter only grows, so IDs are never reused. */
const allocateItemNumber = async ({ db }: StoreContext, list: ListRow): Promise<number> => {
  const { next_item_number } = await db
    .updateTable("todo_lists")
    .set(eb => ({ next_item_number: eb("next_item_number", "+", 1) }))
    .where("id", "=", list.id)
    .returning("next_item_number")
    .executeTakeFirstOrThrow();
  return Number(next_item_number) - 1;
};

const insertItemRow = async (
  context: StoreContext,
  list: ListRow,
  draft: ItemDraft,
): Promise<ItemRow> => {
  const number = await allocateItemNumber(context, list);
  const at = context.now();
  return context.db
    .insertInto("todo_items")
    .values({
      id: context.newId(),
      list_id: list.id,
      number,
      description: draft.description,
      notes: draft.notes ?? null,
      section: draft.section ?? null,
      priority: draft.priority ?? null,
      done_at: draft.doneAt ?? null,
      created_at: at,
      updated_at: at,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
};

/** Writes a row's new fields, leaving it untouched when nothing changed. */
const updateItemRow = async (
  context: StoreContext,
  row: ItemRow,
  draft: ItemDraft,
): Promise<ItemRow> => {
  const values = {
    description: draft.description,
    notes: draft.notes ?? null,
    section: draft.section ?? null,
    priority: draft.priority ?? null,
    done_at: draft.doneAt ?? null,
  };
  const changed = (Object.keys(values) as (keyof typeof values)[]).some(
    key => values[key] !== row[key],
  );
  if (!changed) return row;
  return context.db
    .updateTable("todo_items")
    .set({ ...values, updated_at: context.now() })
    .where("id", "=", row.id)
    .returningAll()
    .executeTakeFirstOrThrow();
};

const loadListRows = ({ db }: StoreContext, options: { archived: boolean }) => {
  const query = db.selectFrom("todo_lists").selectAll().orderBy("key");
  return (options.archived ? query : query.where("archived_at", "is", null)).execute();
};

const setListDescription = (context: StoreContext, list: ListRow, description?: string) =>
  touchListRow(context, list, { description: description ?? null });

const setListArchivedAt = (context: StoreContext, list: ListRow, archivedAt?: string) =>
  touchListRow(context, list, { archived_at: archivedAt ?? null });

const touchListRow = ({ db, now }: StoreContext, list: ListRow, values: Partial<ListRow> = {}) =>
  db
    .updateTable("todo_lists")
    .set({ ...values, updated_at: now() })
    .where("id", "=", list.id)
    .returningAll()
    .executeTakeFirstOrThrow();

export {
  DEFAULT_LIST_KEY,
  type ItemRow,
  type ListRow,
  ensureWritableListRow,
  findListRow,
  findReadableListRow,
  getActiveListRow,
  getItemRows,
  getListRow,
  insertItemRow,
  insertListRow,
  listNotFound,
  loadItemRows,
  loadListRows,
  setListArchivedAt,
  setListDescription,
  toDraft,
  toItem,
  toList,
  touchListRow,
  updateItemRow,
};
