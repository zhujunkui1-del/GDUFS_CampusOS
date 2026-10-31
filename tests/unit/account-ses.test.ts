import { it, expect, vi } from "vitest";
import { TencentSesMailer } from "@/lib/server/account/tencent-ses";
const config = {
  secretId: "fixture-id",
  secretKey: "fixture-secret",
  region: "ap-hongkong",
  from: "CampusOS <no-reply@example.com>",
  templateId: 123,
  noticeTemplateId: 124,
  verified: true,
};
it("sends a six-digit code only through its approved template and uses a separate notice template", async () => {
  const transport = vi.fn(async () =>
    Response.json({ Response: { MessageId: "fixture-message" } }),
  );
  const mailer = new TencentSesMailer(config, transport);
  await mailer.send({
    to: "student@example.com",
    purpose: "code",
    code: "001234",
    key: "fixture",
    subject: "邮箱验证",
  });
  const body = JSON.parse(
    String(
      (transport.mock.calls[0] as unknown as [string, RequestInit])[1].body,
    ),
  );
  expect(body.Template).toEqual({
    TemplateID: 123,
    TemplateData: '{"code":"001234"}',
  });
  expect(
    (transport.mock.calls[0] as unknown as [string, RequestInit])[1].redirect,
  ).toBe("manual");
  await mailer.send({
    to: "student@example.com",
    purpose: "notice",
    event: "邮箱已更换",
    key: "notice",
    subject: "安全通知",
  });
  expect(
    JSON.parse(
      String(
        (transport.mock.calls[1] as unknown as [string, RequestInit])[1].body,
      ),
    ).Template.TemplateID,
  ).toBe(124);
});
it("fails closed for unapproved configuration, eight-digit codes and upstream errors", async () => {
  const transport = vi.fn(async () =>
    Response.json({ Response: { Error: { Code: "Failure" } } }),
  );
  const mailer = new TencentSesMailer(config, transport);
  await expect(
    mailer.send({
      to: "a@example.com",
      purpose: "code",
      code: "12345678",
      key: "test",
      subject: "test",
    }),
  ).rejects.toThrow();
  expect(transport).not.toHaveBeenCalled();
  await expect(
    mailer.send({
      to: "a@example.com",
      purpose: "code",
      code: "123456",
      key: "test",
      subject: "test",
    }),
  ).rejects.toThrow("邮件");
  expect(
    new TencentSesMailer({ ...config, verified: false }, transport).available,
  ).toBe(false);
});
