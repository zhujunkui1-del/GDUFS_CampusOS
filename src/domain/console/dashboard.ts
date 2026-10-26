import { z } from "zod";

export const SourceSessionStateSchema = z.enum([
  "logged_in",
  "login_required",
  "verification_required",
  "unknown",
  "unavailable",
]);
export const SourceControlInputSchema = z
  .object({
    kind: z.literal("session_control"),
    action: z.enum(["status", "login"]),
  })
  .strict();
export const SourceSessionResultSchema = z
  .object({
    state: SourceSessionStateSchema,
    checkedAt: z.number().int().positive(),
    qr: z
      .string()
      .max(180000)
      .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/)
      .nullable()
      .default(null),
    qrExpiresAt: z.number().int().positive().nullable().default(null),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      v.qr &&
      (v.state !== "login_required" ||
        !v.qrExpiresAt ||
        v.qrExpiresAt > v.checkedAt + 240000)
    )
      c.addIssue({ code: "custom", message: "Invalid login challenge" });
  });
export type SourceSession = z.infer<typeof SourceSessionResultSchema>;
// Short-lived administrator-only browser access; never persisted as session status.
export const CloudVerificationSchema = z
  .object({
    url: z
      .string()
      .max(6000)
      .url()
      .refine((value) => {
        const url = new URL(value);
        return (
          url.origin === "https://live.browser.run" &&
          url.pathname.startsWith("/ui/")
        );
      }),
    expiresAt: z.number().int().positive(),
  })
  .strict();
export const SourceControlWorkSchema = z
  .object({
    id: z.string().uuid(),
    control: SourceControlInputSchema,
  })
  .strict();
export const SourceControlFinishSchema = z
  .object({
    id: z.string().uuid(),
    runnerId: z.string().uuid(),
    result: SourceSessionResultSchema,
  })
  .strict();
export type TrafficSummary = {
  startedAt: number;
  measuredAt: number;
  today: number;
  last7: number;
  last30: number;
  total: number;
  days: { day: string; views: number | null }[];
};
