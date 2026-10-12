import { ApiError } from "./errors";

// The session must come from a server-side verifier/DAO, never a request body.
export type VerifiedSession = {
  user: { id: string; role: "user" | "admin" };
  expiresAt: number;
  revokedAt: number | null;
};

export function requireUser(session: VerifiedSession | null, now = Date.now()) {
  if (!session || session.expiresAt <= now || session.revokedAt !== null) {
    throw new ApiError("UNAUTHORIZED", "此操作需要有效的登录会话。");
  }
  return session.user;
}

export function requireAdmin(
  session: VerifiedSession | null,
  now = Date.now(),
) {
  const user = requireUser(session, now);
  if (user.role !== "admin")
    throw new ApiError("FORBIDDEN", "此操作需要内容管理员权限。");
  return user;
}

export function requireOwner(
  session: VerifiedSession | null,
  ownerId: string,
  now = Date.now(),
) {
  const user = requireUser(session, now);
  if (ownerId !== user.id)
    throw new ApiError("FORBIDDEN", "无法访问其他账号的私人数据。");
  return user;
}
