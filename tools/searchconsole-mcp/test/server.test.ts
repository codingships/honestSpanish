import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { TOOL_NAMES } from "../src/config.js";
import { createServer } from "../src/server.js";

test("MCP handshake exposes only the audited read-only tools", async (context) => {
  const server = createServer();
  const client = new Client({ name: "searchconsole-audit-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  context.after(async () => {
    await client.close();
    await server.close();
  });

  const listed = await client.listTools();
  assert.deepEqual(
    listed.tools.map((tool) => tool.name),
    [...TOOL_NAMES],
  );
  assert.equal(
    listed.tools.every(
      (tool) =>
        tool.annotations?.readOnlyHint === true &&
        tool.annotations.destructiveHint === false,
    ),
    true,
  );

  const ping = await client.callTool({
    name: "gsc_mcp_server_ping",
    arguments: {},
  });
  assert.equal(ping.isError, undefined);
  assert.match(JSON.stringify(ping.content), /sc-domain:espanolhonesto\.com/);
});
