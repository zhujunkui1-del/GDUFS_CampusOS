import type { AccountMailer, MailMessage } from "./store";
import { tokenHash } from "../assistant/crypto";
import { ApiError } from "../errors";
const encoder = new TextEncoder();
async function hmac(key: Uint8Array, data: string) {
  const k = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", k, encoder.encode(data)),
  );
}
export async function sesHeaders(
  secretId: string,
  secretKey: string,
  region: string,
  action: string,
  payload: string,
  now = Date.now(),
) {
  const host = "ses.tencentcloudapi.com",
    date = new Date(now).toISOString().slice(0, 10),
    timestamp = Math.floor(now / 1000);
  const canonical = `POST\n/\n\ncontent-type:application/json; charset=utf-8\nhost:${host}\n\ncontent-type;host\n${await tokenHash(payload)}`;
  const scope = date + "/ses/tc3_request";
  const signing = await hmac(
    await hmac(await hmac(encoder.encode("TC3" + secretKey), date), "ses"),
    "tc3_request",
  );
  const signature = Array.from(
    await hmac(
      signing,
      `TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${await tokenHash(canonical)}`,
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  return {
    "Content-Type": "application/json; charset=utf-8",
    Authorization: `TC3-HMAC-SHA256 Credential=${secretId}/${scope}, SignedHeaders=content-type;host, Signature=${signature}`,
    "X-TC-Action": action,
    "X-TC-Version": "2020-10-02",
    "X-TC-Region": region,
    "X-TC-Timestamp": String(timestamp),
  };
}
export class TencentSesMailer implements AccountMailer {
  readonly available: boolean;
  constructor(
    private config: {
      secretId: string;
      secretKey: string;
      region: string;
      from: string;
      templateId: number;
      noticeTemplateId: number;
      verified: boolean;
    },
    private transport: typeof fetch = fetch,
  ) {
    this.available =
      !!config.secretId &&
      !!config.secretKey &&
      ["ap-guangzhou", "ap-hongkong"].includes(config.region) &&
      config.templateId > 0 &&
      config.verified &&
      config.noticeTemplateId > 0 &&
      config.from.includes("@");
  }
  async send(message: MailMessage) {
    if (!this.available)
      throw new ApiError("SERVICE_UNAVAILABLE", "邮件验证暂不可用。", true);
    const codeMessage = message.purpose === "code";
    if (codeMessage && !/^\d{6}$/.test(message.code))
      throw new ApiError("INTERNAL_ERROR", "邮件暂时无法发送。");
    const payload = JSON.stringify({
      FromEmailAddress: this.config.from,
      Destination: [message.to],
      Subject: message.subject,
      Template: {
        TemplateID: codeMessage
          ? this.config.templateId
          : this.config.noticeTemplateId,
        TemplateData: JSON.stringify(
          codeMessage ? { code: message.code } : { event: message.event },
        ),
      },
    });
    let response: Response;
    try {
      response = await this.transport("https://ses.tencentcloudapi.com", {
        method: "POST",
        headers: await sesHeaders(
          this.config.secretId,
          this.config.secretKey,
          this.config.region,
          "SendEmail",
          payload,
        ),
        body: payload,
        signal: AbortSignal.timeout(10000),
        redirect: "manual",
      });
    } catch {
      throw new ApiError(
        "UPSTREAM_ERROR",
        "邮件暂时无法发送，请稍后重试。",
        true,
      );
    }
    let result: {
      Response?: { Error?: { Code?: string }; MessageId?: string };
    };
    try {
      result = await response.json();
    } catch {
      throw new ApiError(
        "UPSTREAM_ERROR",
        "邮件暂时无法发送，请稍后重试。",
        true,
      );
    }
    if (!response.ok || result.Response?.Error || !result.Response?.MessageId)
      throw new ApiError(
        "UPSTREAM_ERROR",
        "邮件暂时无法发送，请稍后重试。",
        true,
      );
  }
}
