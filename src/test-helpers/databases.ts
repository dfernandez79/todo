import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import postgres from "postgres";

/** Set to 1 to run without Docker, on SQLite only. */
const NO_DATABASE = process.env.SKIP_DB_TESTS === "1";

type TestDatabase = {
  name: string;
  /** A connection string or path to a new, empty database. */
  fresh: () => Promise<string>;
};

const tempDir = () => mkdtemp(join(tmpdir(), "todo-test-"));

const sqlite: TestDatabase = {
  name: "SQLite",
  fresh: async () => join(await tempDir(), "todo.db"),
};

let counter = 0;

const postgresql: TestDatabase = {
  name: "PostgreSQL",
  fresh: async () => {
    const url = process.env.TEST_DATABASE_URL ?? "";
    if (url === "") throw new Error("TEST_DATABASE_URL not set; is Docker running?");
    const name = `todo_test_${process.pid}_${++counter}`;
    const admin = postgres(url, { onnotice: () => {} });
    try {
      await admin.unsafe(`CREATE DATABASE ${name}`);
    } finally {
      await admin.end();
    }
    const fresh = new URL(url);
    fresh.pathname = `/${name}`;
    return fresh.toString();
  },
};

/** The databases every store test runs against. */
const DATABASES: TestDatabase[] = NO_DATABASE ? [sqlite] : [sqlite, postgresql];

/** The PostgreSQL container's name on the Docker network, which Neon's proxy connects to. */
const NEON_PROXIED_HOST = "postgres";

/**
 * A fresh PostgreSQL database addressed through Neon's WebSocket proxy, for
 * the Neon serverless driver. Only that driver, configured by the test preload,
 * can reach it.
 */
const freshNeonDatabase = async (): Promise<string> => {
  const url = new URL(await postgresql.fresh());
  url.host = `${NEON_PROXIED_HOST}:5432`;
  return url.toString();
};

export { DATABASES, NEON_PROXIED_HOST, NO_DATABASE, type TestDatabase, freshNeonDatabase, tempDir };
