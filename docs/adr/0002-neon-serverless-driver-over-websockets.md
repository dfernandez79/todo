# Neon serverless driver over WebSockets, as an opt-in PostgreSQL driver

Agents often run in sandboxes that let only HTTPS out, where a TCP connection to
PostgreSQL on port 5432 hangs or is refused. Neon's
[serverless driver](https://github.com/neondatabase/serverless) carries the
PostgreSQL protocol over a WebSocket on port 443, through Neon's proxy. We add
it as an opt-in driver, `--db-use-neon-serverless` or
`TODO_USE_NEON_SERVERLESS=1`, and keep postgres.js as the default, since the
Neon driver only reaches Neon databases, or a self-hosted
[wsproxy](https://github.com/neondatabase/wsproxy).

We use the driver's `Pool`, which is node-postgres compatible, with Kysely's
built-in `PostgresDialect`, so the queries, migrations and transactions are the
same as on postgres.js. The driver is imported on first use, so a SQLite or
postgres.js run doesn't load it.

## Considered Options

- The driver's `neon()` HTTP function with the `kysely-neon` dialect: one
  request per query, with no interactive transactions, which copying and moving
  Items need.
- Replacing postgres.js with the Neon driver everywhere: it can't reach a
  PostgreSQL that isn't behind Neon's proxy.
- Detecting a Neon host name and switching automatically: a TCP connection works
  for Neon too when the network allows it, and is faster; the user knows their
  network.

## Consequences

- `@neondatabase/serverless` is a dependency. Node 22 provides the global
  `WebSocket` it needs, so no `ws` package.
- The pg pool's connect timeout maps to `--db-timeout`, and failing it raises
  the same `DB_CONNECT_TIMEOUT` as postgres.js.
- Tests reach the PostgreSQL container through Neon's `wsproxy` container on a
  Docker network, with `pipelineConnect` off, since the pipelined cleartext
  password fails the container's SCRAM authentication.
- `todo db ping` reports the driver in use, so a setup can be checked.
