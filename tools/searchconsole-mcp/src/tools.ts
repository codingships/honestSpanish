import { ALLOWED_PROPERTY, GOOGLE_ENDPOINTS } from "./config.js";
import {
  classifyGoogleError,
  type GoogleRequest,
  type GoogleRequester,
} from "./google.js";
import {
  inspectUrlInputSchema,
  searchAnalyticsInputSchema,
} from "./schemas.js";

export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

function success(data: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

function failure(message: string): ToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

async function execute(
  requester: GoogleRequester,
  request: GoogleRequest,
): Promise<ToolResult> {
  try {
    return success(await requester.request(request));
  } catch (error) {
    return failure(classifyGoogleError(error));
  }
}

export function createToolHandlers(requester: GoogleRequester) {
  return {
    ping(): ToolResult {
      return success({ status: "pong", property: ALLOWED_PROPERTY });
    },

    async searchAnalytics(input: unknown): Promise<ToolResult> {
      const parsed = searchAnalyticsInputSchema.safeParse(input);
      if (!parsed.success) {
        return failure("Invalid Search Console analytics parameters.");
      }

      const value = parsed.data;
      const requestBody = {
        startDate: value.start_date,
        endDate: value.end_date,
        ...(value.dimensions === undefined
          ? { dimensions: ["query"] }
          : { dimensions: value.dimensions }),
        type: value.type ?? "web",
        rowLimit: value.row_limit ?? 100,
        startRow: value.start_row ?? 0,
        ...(value.dimension_filter_groups === undefined
          ? {}
          : { dimensionFilterGroups: value.dimension_filter_groups }),
        ...(value.aggregation_type === undefined
          ? {}
          : { aggregationType: value.aggregation_type }),
        ...(value.data_state === undefined
          ? {}
          : { dataState: value.data_state }),
      };

      return execute(requester, {
        method: "POST",
        url: GOOGLE_ENDPOINTS.searchAnalytics,
        data: requestBody,
      });
    },

    async inspectUrl(input: unknown): Promise<ToolResult> {
      const parsed = inspectUrlInputSchema.safeParse(input);
      if (!parsed.success) {
        return failure("Invalid Search Console inspection parameters.");
      }

      return execute(requester, {
        method: "POST",
        url: GOOGLE_ENDPOINTS.inspectUrl,
        data: {
          siteUrl: ALLOWED_PROPERTY,
          inspectionUrl: parsed.data.inspection_url,
          languageCode: parsed.data.language_code ?? "en-US",
        },
      });
    },

    async listSitemaps(input: unknown): Promise<ToolResult> {
      if (
        !input ||
        typeof input !== "object" ||
        Array.isArray(input) ||
        Object.keys(input).length !== 0
      ) {
        return failure("The sitemap tool does not accept parameters.");
      }

      return execute(requester, {
        method: "GET",
        url: GOOGLE_ENDPOINTS.sitemaps,
      });
    },
  };
}
