import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { TOOL_NAMES } from "../src/config.js";

test("compiled entry point completes an MCP handshake over stdio", async (context) => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../dist/server.js", import.meta.url))],
    stderr: "pipe",
  });
  const client = new Client({ name: "searchconsole-stdio-test", version: "1.0.0" });

  context.after(async () => {
    await client.close();
  });

  await client.connect(transport);
  const listed = await client.listTools();

  assert.deepEqual(
    listed.tools.map((tool) => tool.name),
    [...TOOL_NAMES],
  );
});
