import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { Kysely, SqliteDialect } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";

import { TodoError } from "../errors.ts";
import { openNodeSqlite } from "./node-sqlite.ts";
import type { Database } from "./schema.ts";

const isPostgresUrl = (database: string): boolean => /^postgres(ql)?:\/\//.test(database);

const DEFAULT_CONNECT_TIMEOUT = 30;

const isConnectTimeout = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "CONNECT_TIMEOUT";

/**
 * Connects to PostgreSQL for a `postgres://` URL, waiting `connectTimeout`
 * seconds (default 30) to connect, or else opens a SQLite file. Not
 * connecting in time fails with a `DB_CONNECT_TIMEOUT` TodoError.
 */
const connect = async (database: string, connectTimeout?: number): Promise<Kysely<Database>> => {
  if (isPostgresUrl(database)) {
    // postgres.js logs server notices to stdout, where they'd corrupt the output.
    const sql = postgres(database, {
      onnotice: () => {},
      ...(connectTimeout === undefined ? {} : { connect_timeout: connectTimeout }),
    });
    try {
      // postgres.js connects lazily; connect now so a timeout fails the open.
      await sql`select 1`;
    } catch (error) {
      await sql.end();
      if (!isConnectTimeout(error)) throw error;
      const seconds = connectTimeout ?? DEFAULT_CONNECT_TIMEOUT;
      throw new TodoError(
        "DB_CONNECT_TIMEOUT",
        `could not connect to the database within ${seconds} seconds; raise it with --db-timeout or TODO_DATABASE_TIMEOUT`,
        { cause: error },
      );
    }
    return new Kysely<Database>({ dialect: new PostgresJSDialect({ postgres: sql }) });
  }
  if (database !== ":memory:") await mkdir(dirname(database), { recursive: true });
  const sqlite = await openNodeSqlite(database);
  return new Kysely<Database>({ dialect: new SqliteDialect({ database: sqlite }) });
};

export { connect, isPostgresUrl };
