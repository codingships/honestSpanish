import assert from "node:assert/strict";
import test from "node:test";

import { TOOL_NAMES } from "../src/config.js";
import type {
  GoogleRequest,
  GoogleRequester,
} from "../src/google.js";
import { createToolHandlers } from "../src/tools.js";

function rejectingRequester(): GoogleRequester {
  return {
    async request<T>(_request: GoogleRequest): Promise<T> {
      throw new Error(
        "token=secret-value path=C:\\Users\\Alin\\secret.json url=https://private.example",
      );
    },
  };
}

test("tool surface contains no property enumeration or write operation", () => {
  assert.deepEqual(TOOL_NAMES, [
    "gsc_mcp_server_ping",
    "gsc_search_analytics",
    "gsc_inspect_url",
    "gsc_list_sitemaps",
  ]);
  assert.equal(TOOL_NAMES.some((name) => /submit|delete|add|list_sites/.test(name)), false);
});

test("inspection rejects URLs outside the allowed domain before a request", async () => {
  let calls = 0;
  const requester: GoogleRequester = {
    async request<T>(_request: GoogleRequest): Promise<T> {
      calls += 1;
      return {} as T;
    },
  };
  const handlers = createToolHandlers(requester);

  for (const inspection_url of [
    "https://example.com/",
    "http://espanolhonesto.com/",
    "https://espanolhonesto.com:8443/",
    "https://espanolhonesto.com.evil.example/",
    "https://user:password@espanolhonesto.com/",
    "https://espanolhonesto.com/#fragment",
  ]) {
    const result = await handlers.inspectUrl({ inspection_url });
    assert.equal(result.isError, true);
  }

  assert.equal(calls, 0);
});

test("strict schemas reject attempts to inject a different property", async () => {
  let calls = 0;
  const requester: GoogleRequester = {
    async request<T>(_request: GoogleRequest): Promise<T> {
      calls += 1;
      return {} as T;
    },
  };
  const handlers = createToolHandlers(requester);

  const result = await handlers.searchAnalytics({
    site_url: "sc-domain:example.com",
    start_date: "2026-08-01",
    end_date: "2026-08-31",
  });

  assert.equal(result.isError, true);
  assert.equal(calls, 0);
});

test("unexpected upstream errors cannot leak their message", async () => {
  const handlers = createToolHandlers(rejectingRequester());
  const result = await handlers.listSitemaps({});
  const text = result.content[0]?.text ?? "";

  assert.equal(result.isError, true);
  assert.equal(text, "Search Console request failed.");
  assert.equal(text.includes("secret-value"), false);
  assert.equal(text.includes("private.example"), false);
  assert.equal(text.includes("Users"), false);
});
