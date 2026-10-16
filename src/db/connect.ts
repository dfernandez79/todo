import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { Kysely, PostgresDialect, SqliteDialect } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";

import { TodoError } from "../errors.ts";
import { openNodeSqlite } from "./node-sqlite.ts";
import type { Database } from "./schema.ts";

const isPostgresUrl = (database: string): boolean => /^postgres(ql)?:\/\//.test(database);

/** What connects to the database: `postgres` and `neon-serverless` for PostgreSQL. */
type Driver = "sqlite" | "postgres" | "neon-serverless";

type ConnectOptions = {
  /** Seconds to wait to connect to PostgreSQL. Defaults to 30. */
  connectTimeout?: number;
  /** Connect to PostgreSQL with the Neon serverless driver, over WebSockets. */
  useNeonServerless?: boolean;
};

const DEFAULT_CONNECT_TIMEOUT = 30;

/** The driver `connect` picks for a database with these options. */
const driverFor = (database: string, useNeonServerless = false): Driver => {
  if (!isPostgresUrl(database)) return "sqlite";
  return useNeonServerless ? "neon-serverless" : "postgres";
};

/** The database as given, with the password of a PostgreSQL URL hidden. */
const describeDatabase = (database: string): string => {
  if (!isPostgresUrl(database)) return database;
  try {
    const url = new URL(database);
    if (url.password !== "") url.password = "***";
    return url.toString();
  } catch {
    return database;
  }
};

const errorText = (error: unknown): string =>
  error instanceof Error
    ? `${error.message} ${error.cause instanceof Error ? error.cause.message : ""}`
    : "";

const isPostgresJsTimeout = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "CONNECT_TIMEOUT";

/** pg's pool, client and connection each time out with their own message. */
const isNeonTimeout = (error: unknown): boolean =>
  /timeout exceeded when trying to connect|timeout expired|connection timeout/.test(
    errorText(error),
  );

const hostOf = (database: string): string => {
  try {
    return new URL(database).host;
  } catch {
    return database;
  }
};

/**
 * A WebSocket that can't open rejects with an `ErrorEvent`, not an Error, and
 * on Node without a message. Says what failed, and where, instead.
 */
const neonConnectError = (error: unknown, database: string): unknown => {
  if (error instanceof Error || typeof error !== "object" || error === null) return error;
  const event = error as { message?: unknown; error?: unknown };
  const detail = [event.message, (event.error as { message?: unknown } | undefined)?.message].find(
    (text): text is string => typeof text === "string" && text !== "",
  );
  return new Error(
    `could not open a WebSocket to ${hostOf(database)} for the Neon serverless driver: ${detail ?? "the connection failed"}; check that it's a Neon database, reachable over HTTPS from here`,
    { cause: error },
  );
};

const connectTimeoutError = (connectTimeout: number | undefined, cause: unknown): TodoError => {
  const seconds = connectTimeout ?? DEFAULT_CONNECT_TIMEOUT;
  return new TodoError(
    "DB_CONNECT_TIMEOUT",
    `could not connect to the database within ${seconds} seconds; raise it with --db-timeout or TODO_DATABASE_TIMEOUT`,
    { cause },
  );
};

const connectPostgres = async (
  database: string,
  connectTimeout: number | undefined,
): Promise<Kysely<Database>> => {
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
    if (!isPostgresJsTimeout(error)) throw error;
    throw connectTimeoutError(connectTimeout, error);
  }
  return new Kysely<Database>({ dialect: new PostgresJSDialect({ postgres: sql }) });
};

/**
 * The Neon serverless driver carries PostgreSQL over a WebSocket, so it works
 * where only HTTP leaves the network. Its `Pool` is node-postgres compatible,
 * which Kysely's `PostgresDialect` takes. The driver loads on first use.
 */
const connectNeonServerless = async (
  database: string,
  connectTimeout: number | undefined,
): Promise<Kysely<Database>> => {
  const { Pool } = await import("@neondatabase/serverless");
  const pool = new Pool({
    connectionString: database,
    connectionTimeoutMillis: (connectTimeout ?? DEFAULT_CONNECT_TIMEOUT) * 1000,
  });
  // An error on an idle connection is nothing to a command that's done with it,
  // but without a listener it would crash the process.
  pool.on("error", () => {});
  try {
    // The pool connects lazily; connect now so a timeout fails the open.
    await pool.query("select 1");
  } catch (error) {
    await pool.end();
    if (!isNeonTimeout(error)) throw neonConnectError(error, database);
    throw connectTimeoutError(connectTimeout, error);
  }
  // Only what the dialect uses: its optional `Client` member types differently in pg.
  const dialect = new PostgresDialect({
    pool: { connect: () => pool.connect(), end: () => pool.end(), options: pool.options },
  });
  return new Kysely<Database>({ dialect });
};

/**
 * Connects to PostgreSQL for a `postgres://` URL, waiting `connectTimeout`
 * seconds (default 30) to connect, or else opens a SQLite file. Not
 * connecting in time fails with a `DB_CONNECT_TIMEOUT` TodoError.
 */
const connect = async (
  database: string,
  options: ConnectOptions = {},
): Promise<Kysely<Database>> => {
  switch (driverFor(database, options.useNeonServerless)) {
    case "postgres":
      return connectPostgres(database, options.connectTimeout);
    case "neon-serverless":
      return connectNeonServerless(database, options.connectTimeout);
    case "sqlite": {
      if (database !== ":memory:") await mkdir(dirname(database), { recursive: true });
      const sqlite = await openNodeSqlite(database);
      return new Kysely<Database>({ dialect: new SqliteDialect({ database: sqlite }) });
    }
  }
};

export { type ConnectOptions, type Driver, connect, describeDatabase, driverFor, isPostgresUrl };
