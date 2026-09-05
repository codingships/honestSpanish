import { pathToFileURL } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { SERVER_NAME, SERVER_VERSION } from "./config.js";
import { createGoogleRequester } from "./google.js";
import {
  emptyInputSchema,
  inspectUrlInputSchema,
  searchAnalyticsInputSchema,
} from "./schemas.js";
import { createToolHandlers } from "./tools.js";

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export function createServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });
  const handlers = createToolHandlers(createGoogleRequester());

  server.registerTool(
    "gsc_mcp_server_ping",
    {
      description:
        "Checks the local MCP process. Does not call Google Search Console.",
      inputSchema: emptyInputSchema,
      annotations: {
        ...readOnlyAnnotations,
        openWorldHint: false,
      },
    },
    () => handlers.ping(),
  );

  server.registerTool(
    "gsc_search_analytics",
    {
      description:
        "Reads Search Console performance for sc-domain:espanolhonesto.com.",
      inputSchema: searchAnalyticsInputSchema,
      annotations: readOnlyAnnotations,
    },
    (input) => handlers.searchAnalytics(input),
  );

  server.registerTool(
    "gsc_inspect_url",
    {
      description:
        "Reads Google index information for an HTTPS URL on espanolhonesto.com.",
      inputSchema: inspectUrlInputSchema,
      annotations: readOnlyAnnotations,
    },
    (input) => handlers.inspectUrl(input),
  );

  server.registerTool(
    "gsc_list_sitemaps",
    {
      description:
        "Lists submitted sitemaps for sc-domain:espanolhonesto.com.",
      inputSchema: emptyInputSchema,
      annotations: readOnlyAnnotations,
    },
    (input) => handlers.listSitemaps(input),
  );

  return server;
}

async function main(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
  console.error("[espanolhonesto-searchconsole] MCP server ready on stdio.");
}

const entryPoint = process.argv[1];

if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  main().catch(() => {
    console.error("[espanolhonesto-searchconsole] MCP server failed to start.");
    process.exitCode = 1;
  });
}
