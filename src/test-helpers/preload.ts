import { afterAll, beforeAll } from "bun:test";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";

import { NO_DATABASE } from "./databases.ts";

/** One container for the whole run; tests create a database each in it. */
let container: StartedPostgreSqlContainer | undefined;

beforeAll(async () => {
  if (NO_DATABASE) return;
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  process.env.TEST_DATABASE_URL = container.getConnectionUri();
}, 180_000);

afterAll(async () => {
  await container?.stop();
}, 60_000);
