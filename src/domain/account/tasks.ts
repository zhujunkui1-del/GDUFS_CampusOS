import { z } from "zod";
import { ConsoleIdSchema } from "@/domain/console/contracts";

export const TaskSourceSchema = z
  .object({
    articleId: ConsoleIdSchema,
    eventId: z
      .string()
      .regex(/^event-[a-f0-9]{40}$/)
      .optional(),
    day: z.iso.date().optional(),
  })
  .strict();
export const TaskFieldsSchema = z.object({
  title: z.string().trim().min(1).max(200),
  dueAt: z.iso.datetime({ offset: true }).nullable(),
  notes: z.string().max(2000),
});
export const CreateTaskSchema = TaskFieldsSchema.extend({
  key: z.uuid(),
  source: TaskSourceSchema.optional(),
}).strict();
const target = { id: z.uuid(), version: z.number().int().positive() };
export const ChangeTaskSchema = z.discriminatedUnion("action", [
  TaskFieldsSchema.extend({ ...target, action: z.literal("edit") }).strict(),
  z.object({ ...target, action: z.enum(["complete", "delete"]) }).strict(),
]);
export type TaskStatus = "pending" | "completed" | "overdue";
export type PersonalTask = z.infer<typeof TaskFieldsSchema> & {
  id: string;
  version: number;
  status: TaskStatus;
  source:
    | (z.infer<typeof TaskSourceSchema> & {
        articleAvailable: boolean;
        articleUrl: string | null;
        eventChanged: boolean;
      })
    | null;
};
