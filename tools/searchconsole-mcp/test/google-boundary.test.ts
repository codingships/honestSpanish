import assert from "node:assert/strict";
import test from "node:test";

import { GOOGLE_ENDPOINTS } from "../src/config.js";
import {
  BlockedGoogleRequestError,
  createGoogleRequester,
  UnsupportedGoogleCredentialError,
} from "../src/google.js";

test("outbound requests are blocked before credential discovery", async () => {
  let credentialLookups = 0;
  const requester = createGoogleRequester({
    async getClient(): Promise<unknown> {
      credentialLookups += 1;
      return {};
    },
  });

  await assert.rejects(
    requester.request({ method: "GET", url: "https://example.com/" }),
    BlockedGoogleRequestError,
  );
  await assert.rejects(
    requester.request({ method: "GET", url: GOOGLE_ENDPOINTS.searchAnalytics }),
    BlockedGoogleRequestError,
  );
  assert.equal(credentialLookups, 0);
});

test("credentials other than authorized_user are rejected before an API call", async () => {
  let requests = 0;
  const requester = createGoogleRequester({
    async getClient(): Promise<unknown> {
      return {
        async request(): Promise<never> {
          requests += 1;
          throw new Error("must not run");
        },
      };
    },
  });

  await assert.rejects(
    requester.request({ method: "GET", url: GOOGLE_ENDPOINTS.sitemaps }),
    UnsupportedGoogleCredentialError,
  );
  assert.equal(requests, 0);
});
