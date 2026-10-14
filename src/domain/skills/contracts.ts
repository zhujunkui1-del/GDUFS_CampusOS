import type { z } from "zod";
import type { ErrorCode } from "@/lib/server/errors";

export type SourceReference = {
  title: string;
  url: string;
  publishedAt?: string;
};
export type SkillResult<T> =
  | { ok: true; data: T; sources?: SourceReference[]; warnings?: string[] }
  | {
      ok: false;
      error: { code: ErrorCode; message: string; retryable: boolean };
    };

export type SkillContext = {
  requestId: string;
  sessionId: string;
  user: { id: string; role: "user" | "admin" } | null;
  campusId: "gdufs_university_town";
  permissions: string[];
  confirmedActionId?: string;
  signal?: AbortSignal;
};

export type SkillDefinition<I, O> = {
  name: string;
  version: string;
  description: string;
  inputSchema: z.ZodType<I>;
  outputSchema: z.ZodType<O>;
  auth: "public" | "user" | "school_authorized" | "admin";
  sideEffect: "none" | "user_data_write" | "external_sync";
  requiresConfirmation: boolean;
  timeoutMs: number;
  permissions?: readonly string[];
  execute: (input: I, context: SkillContext) => Promise<SkillResult<O>>;
};
