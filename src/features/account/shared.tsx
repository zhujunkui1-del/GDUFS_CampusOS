"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import "./account.css";
export function AccountFrame({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="module-page account-page">
      <h1 className="module-heading-title">
        <Link className="module-brand" href="/map">
          广外通 <span>CampusOS</span>
        </Link>
        <span className="module-heading-separator" aria-hidden="true">
          {" "}
          |{" "}
        </span>
        <strong>{title}</strong>
      </h1>
      {children}
    </section>
  );
}
export function useAccountAction() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  const working = useRef(false);
  async function run(action: () => Promise<void>, message = "操作成功") {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await action();
      setSuccess(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作未完成，请重试。");
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  return { busy, error, success, run };
}
export function FormFeedback({
  error,
  success,
}: {
  error: string;
  success: string;
}) {
  return (
    <>
      {error && (
        <p className="account-error" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="account-success" role="status">
          {success}
        </p>
      )}
    </>
  );
}
export const recoveryWarning =
  "不绑定并验证邮箱，忘记密码后将无法通过邮件找回账号。";
