import { z } from "zod";
const reserved = new Set([
  "admin",
  "administrator",
  "system",
  "root",
  "support",
  "moderator",
  "campusos",
  "api",
  "console",
  "null",
  "undefined",
]);
export const UsernameSchema = z
  .string()
  .min(3)
  .max(24)
  .regex(/^[A-Za-z0-9_]+$/)
  .refine((s) => !reserved.has(s.toLowerCase()), "用户名不可用");
// Names that start with "admin" read as staff accounts, so they are reserved for
// accounts bound to an owner mailbox. The mailbox list is configuration: putting
// an address here would leak it into the client bundle.
export function parseOwnerMailboxes(value: string | undefined | null) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.includes("@"));
}
export function usernameNeedsOwnerMailbox(username: string) {
  return username.trim().toLowerCase().startsWith("admin");
}
export function ownerMailboxAllows(
  username: string,
  email: string | null | undefined,
  mailboxes: readonly string[] = [],
) {
  if (!usernameNeedsOwnerMailbox(username)) return true;
  const bound = (email || "").trim().toLowerCase();
  return !!bound && mailboxes.includes(bound);
}
export const EmailSchema = z.string().trim().toLowerCase().max(254).email();
export const PasswordSchema = z
  .string()
  .min(8)
  .max(256)
  .refine((s) => new TextEncoder().encode(s).length <= 1024);
export const TokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const OtpSchema = z.string().regex(/^\d{6}$/);
export const RegisterSchema = z
  .object({
    username: UsernameSchema,
    password: PasswordSchema,
    email: EmailSchema.optional(),
    challenge: TokenSchema.optional(),
    code: OtpSchema.optional(),
  })
  .strict()
  .refine(
    (v) => (v.email ? !!v.challenge && !!v.code : !v.challenge && !v.code),
    "请先验证邮箱",
  );
export const RegistrationCodeSchema = z
  .object({ username: UsernameSchema, email: EmailSchema })
  .strict();
export const LoginSchema = z
  .object({
    identifier: z.string().trim().min(1).max(254),
    password: z.string().min(1).max(256),
    selectAccount: z.boolean().optional(),
  })
  .strict();
export const EmailLoginSelectSchema = z
  .object({
    choiceToken: TokenSchema,
    index: z.number().int().nonnegative(),
  })
  .strict();
export type EmailLoginChoice = { choiceToken: string; accounts: string[] };
export const RenameSchema = z
  .object({
    username: UsernameSchema,
  })
  .strict();
export const PasswordChangeSchema = z
  .object({
    currentPassword: z.string().min(1).max(256),
    newPassword: PasswordSchema,
  })
  .strict();
export const EmailBindSchema = z.object({ email: EmailSchema }).strict();
export const EmailUnbindSchema = z
  .object({ challenge: TokenSchema, code: OtpSchema })
  .strict();
export const ResetRequestSchema = z
  .object({ email: EmailSchema, username: UsernameSchema.optional() })
  .strict();
export const ResetConfirmSchema = z
  .object({
    challenge: TokenSchema,
    code: OtpSchema,
    newPassword: PasswordSchema,
  })
  .strict();
export const VerifyEmailSchema = z
  .object({ challenge: TokenSchema, code: OtpSchema })
  .strict();
export type AccountProfile = {
  id: string;
  username: string;
  email: string | null;
  pendingEmail: string | null;
  emailVerified: boolean;
  showConsoleEntry: boolean;
  createdAt: string;
};
