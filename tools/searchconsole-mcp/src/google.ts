import { GoogleAuth, UserRefreshClient } from "google-auth-library";

import { GOOGLE_ENDPOINTS, GSC_READONLY_SCOPE } from "./config.js";

export interface GoogleRequest {
  method: "GET" | "POST";
  url: string;
  data?: unknown;
}

export interface GoogleRequester {
  request<T>(request: GoogleRequest): Promise<T>;
}

export interface GoogleCredentialProvider {
  getClient(): Promise<unknown>;
}

export class BlockedGoogleRequestError extends Error {
  override readonly name = "BlockedGoogleRequestError";
}

export class UnsupportedGoogleCredentialError extends Error {
  override readonly name = "UnsupportedGoogleCredentialError";
}

const allowedRequests = new Map<string, GoogleRequest["method"]>([
  [GOOGLE_ENDPOINTS.searchAnalytics, "POST"],
  [GOOGLE_ENDPOINTS.inspectUrl, "POST"],
  [GOOGLE_ENDPOINTS.sitemaps, "GET"],
]);

function assertAllowedRequest(request: GoogleRequest): void {
  if (allowedRequests.get(request.url) !== request.method) {
    throw new BlockedGoogleRequestError(
      "Google request is outside the audited Search Console allowlist.",
    );
  }
}

export function createGoogleRequester(
  credentialProvider?: GoogleCredentialProvider,
): GoogleRequester {
  const auth =
    credentialProvider ?? new GoogleAuth({ scopes: [GSC_READONLY_SCOPE] });

  return {
    async request<T>(request: GoogleRequest): Promise<T> {
      assertAllowedRequest(request);
      const client = await auth.getClient();

      if (!(client instanceof UserRefreshClient)) {
        throw new UnsupportedGoogleCredentialError(
          "Only end-user authorized_user credentials are accepted.",
        );
      }

      const options = {
        method: request.method,
        url: request.url,
        ...(request.data === undefined ? {} : { data: request.data }),
      };
      const response = await client.request<T>(options);
      return response.data;
    },
  };
}

export function classifyGoogleError(error: unknown): string {
  if (error instanceof BlockedGoogleRequestError) {
    return "Search Console blocked a request outside its audited allowlist.";
  }
  if (error instanceof UnsupportedGoogleCredentialError) {
    return "Search Console requires end-user OAuth Application Default Credentials.";
  }
  if (!error || typeof error !== "object") {
    return "Search Console request failed.";
  }

  const candidate = error as {
    code?: string | number;
    response?: { status?: number; data?: { error?: { status?: string } } };
  };
  const status = candidate.response?.status;
  const googleStatus = candidate.response?.data?.error?.status;
  const code = candidate.code;

  if (status === 401 || googleStatus === "UNAUTHENTICATED") {
    return "Search Console authentication failed.";
  }
  if (status === 403 || googleStatus === "PERMISSION_DENIED") {
    return "The authenticated Google identity cannot access the configured Search Console property.";
  }
  if (status === 404 || googleStatus === "NOT_FOUND") {
    return "The configured Search Console property or URL was not found.";
  }
  if (status === 429 || googleStatus === "RESOURCE_EXHAUSTED") {
    return "Search Console quota was exceeded. Retry later.";
  }
  if (status === 400 || googleStatus === "INVALID_ARGUMENT") {
    return "Search Console rejected the request parameters.";
  }
  if (code === "ENOTFOUND" || code === "ECONNRESET" || code === "ETIMEDOUT") {
    return "Search Console could not be reached.";
  }

  return "Search Console request failed.";
}
