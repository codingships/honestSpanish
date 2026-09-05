import assert from "node:assert/strict";
import test from "node:test";

import {
  ALLOWED_PROPERTY,
  GOOGLE_ENDPOINTS,
} from "../src/config.js";
import type {
  GoogleRequest,
  GoogleRequester,
} from "../src/google.js";
import { createToolHandlers } from "../src/tools.js";

function recordingRequester(requests: GoogleRequest[]): GoogleRequester {
  return {
    async request<T>(request: GoogleRequest): Promise<T> {
      requests.push(request);
      return { ok: true } as T;
    },
  };
}

test("analytics uses the fixed property endpoint and a read query", async () => {
  const requests: GoogleRequest[] = [];
  const handlers = createToolHandlers(recordingRequester(requests));

  const result = await handlers.searchAnalytics({
    start_date: "2026-08-01",
    end_date: "2026-08-31",
    dimensions: ["page", "query"],
    row_limit: 250,
  });

  assert.equal(result.isError, undefined);
  assert.deepEqual(requests, [
    {
      method: "POST",
      url: GOOGLE_ENDPOINTS.searchAnalytics,
      data: {
        startDate: "2026-08-01",
        endDate: "2026-08-31",
        dimensions: ["page", "query"],
        type: "web",
        rowLimit: 250,
        startRow: 0,
      },
    },
  ]);
  assert.ok(GOOGLE_ENDPOINTS.searchAnalytics.includes(encodeURIComponent(ALLOWED_PROPERTY)));
});

test("URL inspection always supplies the fixed property", async () => {
  const requests: GoogleRequest[] = [];
  const handlers = createToolHandlers(recordingRequester(requests));

  await handlers.inspectUrl({
    inspection_url: "https://www.espanolhonesto.com/en/",
    language_code: "es-ES",
  });

  assert.deepEqual(requests, [
    {
      method: "POST",
      url: GOOGLE_ENDPOINTS.inspectUrl,
      data: {
        siteUrl: ALLOWED_PROPERTY,
        inspectionUrl: "https://www.espanolhonesto.com/en/",
        languageCode: "es-ES",
      },
    },
  ]);
});

test("sitemap listing is GET-only and accepts no property input", async () => {
  const requests: GoogleRequest[] = [];
  const handlers = createToolHandlers(recordingRequester(requests));

  const result = await handlers.listSitemaps({});

  assert.equal(result.isError, undefined);
  assert.deepEqual(requests, [
    { method: "GET", url: GOOGLE_ENDPOINTS.sitemaps },
  ]);
});
