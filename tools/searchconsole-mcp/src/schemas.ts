import { z } from "zod";

import { ALLOWED_HOST } from "./config.js";

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().startsWith(value);
  }, "Invalid calendar date");

const dimensionSchema = z.enum([
  "query",
  "page",
  "country",
  "device",
  "searchAppearance",
  "date",
]);

const filterDimensionSchema = z.enum([
  "query",
  "page",
  "country",
  "device",
  "searchAppearance",
]);

const filterSchema = z
  .object({
    dimension: filterDimensionSchema,
    operator: z.enum([
      "contains",
      "equals",
      "notContains",
      "notEquals",
      "includingRegex",
      "excludingRegex",
    ]),
    expression: z.string().min(1).max(512),
  })
  .strict();

const filterGroupSchema = z
  .object({
    groupType: z.literal("and").optional(),
    filters: z.array(filterSchema).min(1).max(20),
  })
  .strict();

export const searchAnalyticsInputSchema = z
  .object({
    start_date: dateSchema,
    end_date: dateSchema,
    dimensions: z.array(dimensionSchema).min(1).max(5).optional(),
    type: z
      .enum(["web", "image", "video", "news", "discover", "googleNews"])
      .optional(),
    row_limit: z.number().int().min(1).max(5_000).optional(),
    start_row: z.number().int().min(0).max(24_999).optional(),
    dimension_filter_groups: z.array(filterGroupSchema).max(5).optional(),
    aggregation_type: z.enum(["auto", "byProperty", "byPage"]).optional(),
    data_state: z.enum(["final", "all"]).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.start_date > value.end_date) {
      context.addIssue({
        code: "custom",
        message: "start_date must be on or before end_date",
        path: ["start_date"],
      });
    }
  });

function isAllowedInspectionUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();

    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.hash === "" &&
      url.port === "" &&
      (hostname === ALLOWED_HOST || hostname.endsWith(`.${ALLOWED_HOST}`))
    );
  } catch {
    return false;
  }
}

export const inspectUrlInputSchema = z
  .object({
    inspection_url: z
      .string()
      .min(1)
      .max(2_048)
      .refine(isAllowedInspectionUrl, {
        message: "URL must be HTTPS on espanolhonesto.com or one of its subdomains",
      }),
    language_code: z
      .string()
      .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/)
      .max(35)
      .optional(),
  })
  .strict();

export const emptyInputSchema = z.object({}).strict();

export type SearchAnalyticsInput = z.infer<typeof searchAnalyticsInputSchema>;
export type InspectUrlInput = z.infer<typeof inspectUrlInputSchema>;
