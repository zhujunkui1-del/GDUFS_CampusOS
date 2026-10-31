"use client";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { useRef, useState } from "react";
import "./account.css";
export function AccountFrame({
  title,
  children,
  backHref,
  home = false,
}: {
  title: string;
  children: React.ReactNode;
  backHref?: string;
  home?: boolean;
}) {
  return (
    <section
      className={`module-page account-page ${home ? "account-home" : ""}`}
    >
      <header className="account-header">
        {backHref && (
          <Link className="account-back" href={backHref} aria-label="返回">
            <ChevronLeft size={23} />
          </Link>
        )}
        <h1>{title}</h1>
      </header>
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
