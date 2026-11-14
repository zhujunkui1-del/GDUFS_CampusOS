import { z } from "zod";

export const FeedbackInputSchema = z.object({
  nickname: z.string().trim().optional().default(""),
  content: z.string().trim().min(1),
});

export type FeedbackItem = {
  id: string;
  nickname: string;
  content: string;
  status: "pending" | "archived";
  submittedAt: string;
};

export type FeedbackInbox = {
  pending: FeedbackItem[];
  archived: FeedbackItem[];
};
