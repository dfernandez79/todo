# Kysely over PostgreSQL and node:sqlite, with our own SQLite dialect adapter

The tool must store data in PostgreSQL or SQLite and run on both Bun and Node.
We use Kysely as the single query layer: `kysely-postgres-js` (on the `postgres`
driver, as in `schema-to-erd`) for PostgreSQL, and `node:sqlite` for SQLite on
both runtimes, since Bun implements `node:sqlite`. Kysely's built-in
`SqliteDialect` expects the better-sqlite3 statement API, which neither
`node:sqlite` nor `bun:sqlite` matches, so we write a small adapter that wraps
`DatabaseSync` instead of depending on a young community dialect.

## Considered Options

- Drizzle: needs a separate schema per dialect.
- Hand-written SQL behind a repository interface: two implementations to keep in
  sync.
- A runtime switch between `bun:sqlite` and `node:sqlite`: two SQLite code paths
  to test.
- better-sqlite3: fits the built-in dialect, but is a native addon that does not
  run on Bun.

## Consequences

- `node:sqlite` is experimental in Node 22 and 24, and the CLI suppresses its
  `ExperimentalWarning`. The engines field is `node >=22.16`: the adapter tells
  reading statements from writing ones with `StatementSync.columns()`, which
  Node 22.16 added.
- Migrations use the Kysely schema builder only, so one migration set serves
  both databases. SQLite migrations do not run in a transaction.
