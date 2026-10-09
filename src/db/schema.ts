/**
 * The tables, prefixed so they can share a PostgreSQL database with other
 * applications. Timestamps are ISO 8601 UTC text on both databases, and a
 * done or archived mark is the time it was set, so no column is a boolean.
 */
type Database = {
  todo_lists: ListsTable;
  todo_items: ItemsTable;
};

type ListsTable = {
  id: string;
  key: string;
  description: string | null;
  archived_at: string | null;
  /** The Item ID the next Item added to the List gets. It only grows. */
  next_item_number: number;
  created_at: string;
  updated_at: string;
};

type ItemsTable = {
  id: string;
  list_id: string;
  number: number;
  description: string;
  notes: string | null;
  section: string | null;
  priority: string | null;
  done_at: string | null;
  created_at: string;
  updated_at: string;
};

export type { Database, ItemsTable, ListsTable };
