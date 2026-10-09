import type { SQLInputValue, StatementSync } from "node:sqlite";

import type { SqliteDatabase, SqliteStatement } from "kysely";

/**
 * Wraps `node:sqlite`, which both Node and Bun provide, in the
 * better-sqlite3-like interface Kysely's `SqliteDialect` expects. It is
 * imported on first use so that loading this module doesn't load it.
 */
const openNodeSqlite = async (path: string): Promise<SqliteDatabase> => {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path);
  // Wait for other processes' writes instead of failing, and enforce the
  // foreign keys SQLite ignores by default.
  db.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  return {
    close: () => db.close(),
    prepare: sql => wrapStatement(db.prepare(sql)),
  };
};

/** Kysely passes only the values SQLite takes. */
const values = (parameters: ReadonlyArray<unknown>) => parameters as SQLInputValue[];

const wrapStatement = (statement: StatementSync): SqliteStatement => ({
  reader: statement.columns().length > 0,
  all: parameters => statement.all(...values(parameters)),
  run: parameters => statement.run(...values(parameters)),
  iterate: parameters => statement.iterate(...values(parameters)),
});

export { openNodeSqlite };
