"use client";
import { useEffect, useRef, useState } from "react";
import { useAccountAction } from "./shared";
export function useEmailCodeAction(
  purpose: "registration" | "bind" | "unbind" | "reset",
) {
  const action = useAccountAction(),
    [seconds, setSeconds] = useState(0),
    deadline = useRef(0),
    key = "campusos:email-code:" + purpose;
  function storedDeadline() {
    try {
      return Number(localStorage.getItem(key)) || 0;
    } catch {
      return 0;
    }
  }
  useEffect(() => {
    const tick = () => {
      try {
        deadline.current = Math.max(
          deadline.current,
          Number(localStorage.getItem(key)) || 0,
        );
      } catch {}
      setSeconds(
        Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000)),
      );
    };
    const initial = setTimeout(tick, 0),
      timer = setInterval(tick, 1000);
    window.addEventListener("storage", tick);
    window.addEventListener("focus", tick);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
      window.removeEventListener("storage", tick);
      window.removeEventListener("focus", tick);
    };
  }, [key]);
  async function run(send: () => Promise<void>, message = "已发送") {
    if (Math.max(deadline.current, storedDeadline()) > Date.now()) return;
    await action.run(async () => {
      await send();
      deadline.current = Date.now() + 60000;
      setSeconds(60);
      try {
        localStorage.setItem(key, String(deadline.current));
      } catch {}
    }, message);
  }
  return {
    ...action,
    run,
    coolingDown: seconds > 0,
    label: seconds > 0 ? `${seconds}秒后重发` : "获取验证码",
  };
}
