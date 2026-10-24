import { z } from "zod";
import { SafeUrlSchema } from "./contracts";
import { CommandSchema } from "./contracts";

const PathPrefixSchema = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .regex(/^\/(?!\/)[^?#]*$/);

export const WebProfileConfigSchema = z
  .object({
    ruleVersion: z.string().min(1).max(80),
    configurationStatus: z.enum(["discovered", "verified"]).default("verified"),
    earliestImportDay: z.iso.date().optional(),
    latestImportDay: z.iso.date().optional(),
    entryUrls: z.array(SafeUrlSchema).min(1).max(50),
    articlePathPrefixes: z.array(PathPrefixSchema).min(1).max(50),
    titleSelector: z.string().trim().min(1).max(200).default("h1, title"),
    titleSuffix: z.string().max(100).default(""),
    dateSelector: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .default("time, .date, .time"),
    dateLabel: z.string().trim().min(1).max(40).default("发布时间"),
    bodySelector: z.string().trim().min(1).max(200).default("article, main"),
    allowQueryUrls: z.boolean().default(false),
    requestIntervalMs: z.number().int().min(0).max(300000).default(1000),
  })
  .strict();

export const WebProfileSaveSchema = CommandSchema.extend({
  configurationStatus: z.enum(["discovered", "verified"]).default("verified"),
  earliestImportDay: z.iso.date().optional(),
  latestImportDay: z.iso.date().optional(),
  entryUrls: z.array(SafeUrlSchema).min(1).max(50),
  articlePathPrefixes: z.array(PathPrefixSchema).min(1).max(50),
  titleSelector: z.string().trim().min(1).max(200),
  titleSuffix: z.string().max(100),
  dateSelector: z.string().trim().min(1).max(200),
  dateLabel: z.string().trim().min(1).max(40),
  bodySelector: z.string().trim().min(1).max(200),
  allowQueryUrls: z.boolean(),
  requestIntervalMs: z.number().int().min(0).max(300000),
}).strict();

export type WebProfileConfig = z.infer<typeof WebProfileConfigSchema>;
