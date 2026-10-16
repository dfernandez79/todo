import { afterAll, beforeAll } from "bun:test";

import { neonConfig } from "@neondatabase/serverless";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import {
  GenericContainer,
  Network,
  type StartedNetwork,
  type StartedTestContainer,
} from "testcontainers";

import { NEON_PROXIED_HOST, NO_DATABASE } from "./databases.ts";

/** One container for the whole run; tests create a database each in it. */
let container: StartedPostgreSqlContainer | undefined;
let network: StartedNetwork | undefined;
/** Neon's WebSocket proxy in front of the PostgreSQL container, for the Neon serverless driver. */
let proxy: StartedTestContainer | undefined;

beforeAll(async () => {
  if (NO_DATABASE) return;
  network = await new Network().start();
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withNetwork(network)
    .withNetworkAliases(NEON_PROXIED_HOST)
    .start();
  process.env.TEST_DATABASE_URL = container.getConnectionUri();
  proxy = await new GenericContainer("ghcr.io/neondatabase/wsproxy:latest")
    .withNetwork(network)
    .withEnvironment({ ALLOW_ADDR_REGEX: ".*" })
    .withExposedPorts(80)
    .start();
  const proxyAddress = `${proxy.getHost()}:${proxy.getMappedPort(80)}`;
  // The driver connects to Neon's proxy by default, as it does for any other host.
  neonConfig.wsProxy = (host, port) =>
    host === NEON_PROXIED_HOST ? `${proxyAddress}/v1?address=${host}:${port}` : `${host}/v2`;
  neonConfig.useSecureWebSocket = false;
  // The pipelined cleartext password fails SCRAM authentication, which the container uses.
  neonConfig.pipelineConnect = false;
}, 180_000);

afterAll(async () => {
  await proxy?.stop();
  await container?.stop();
  await network?.stop();
}, 60_000);
