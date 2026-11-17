import { z } from "zod";

export const PersonalConflictTaskSchema = z.object({
  intent: z.literal("detect_schedule_conflicts"),
  dataSource: z.literal("personal_todos"),
  scope: z.enum(["all", "named"]),
  titles: z.tuple([z.string(), z.string()]).optional(),
  date: z.iso.date().optional(),
  status: z.enum(["ready", "awaiting_clarification", "completed", "partial"]),
});
export type PersonalConflictTask = z.infer<typeof PersonalConflictTaskSchema>;
