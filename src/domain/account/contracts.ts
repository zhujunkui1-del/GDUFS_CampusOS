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
  })
  .strict();
export const LoginSchema = z
  .object({
    identifier: z.string().trim().min(1).max(254),
    password: z.string().min(1).max(256),
  })
  .strict();
export const RenameSchema = z
  .object({
    username: UsernameSchema,
    currentPassword: z.string().min(1).max(256),
  })
  .strict();
export const PasswordChangeSchema = z
  .object({
    currentPassword: z.string().min(1).max(256),
    newPassword: PasswordSchema,
  })
  .strict();
export const EmailBindSchema = z
  .object({ email: EmailSchema, currentPassword: z.string().min(1).max(256) })
  .strict();
export const EmailUnbindSchema = z
  .object({ currentPassword: z.string().min(1).max(256) })
  .strict();
export const ResetRequestSchema = z.object({ email: EmailSchema }).strict();
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
  createdAt: string;
  usernameChangeAvailableAt: number;
};
