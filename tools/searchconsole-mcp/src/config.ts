export const SERVER_NAME = "espanolhonesto-searchconsole";
export const SERVER_VERSION = "0.1.0";

export const GSC_READONLY_SCOPE =
  "https://www.googleapis.com/auth/webmasters.readonly";

export const ALLOWED_PROPERTY = "sc-domain:espanolhonesto.com";
export const ALLOWED_HOST = "espanolhonesto.com";

const propertyPath = encodeURIComponent(ALLOWED_PROPERTY);

export const GOOGLE_ENDPOINTS = Object.freeze({
  searchAnalytics: `https://www.googleapis.com/webmasters/v3/sites/${propertyPath}/searchAnalytics/query`,
  inspectUrl:
    "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect",
  sitemaps: `https://www.googleapis.com/webmasters/v3/sites/${propertyPath}/sitemaps`,
});

export const TOOL_NAMES = Object.freeze([
  "gsc_mcp_server_ping",
  "gsc_search_analytics",
  "gsc_inspect_url",
  "gsc_list_sitemaps",
] as const);
