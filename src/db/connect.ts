import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { Kysely, SqliteDialect } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";

import { openNodeSqlite } from "./node-sqlite.ts";
import type { Database } from "./schema.ts";

const isPostgresUrl = (database: string): boolean => /^postgres(ql)?:\/\//.test(database);

/** Connects to PostgreSQL for a `postgres://` URL, or else opens a SQLite file. */
const connect = async (database: string): Promise<Kysely<Database>> => {
  if (isPostgresUrl(database)) {
    // postgres.js logs server notices to stdout, where they'd corrupt the output.
    const sql = postgres(database, { onnotice: () => {} });
    return new Kysely<Database>({ dialect: new PostgresJSDialect({ postgres: sql }) });
  }
  if (database !== ":memory:") await mkdir(dirname(database), { recursive: true });
  const sqlite = await openNodeSqlite(database);
  return new Kysely<Database>({ dialect: new SqliteDialect({ database: sqlite }) });
};

export { connect, isPostgresUrl };
