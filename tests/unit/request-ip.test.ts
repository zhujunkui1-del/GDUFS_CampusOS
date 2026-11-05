import { describe, expect, it } from "vitest";
import { normalizeClientIp, trustedClientIp } from "@/lib/server/request-ip";

const SECRET = "0123456789abcdef0123456789abcdef";

function request(headers: Record<string, string>) {
  return new Request("https://campusos.example/api/auth/login", { headers });
}

describe("trusted client ip", () => {
  it("uses Cloudflare's address when no proxy secret is present", () => {
    const value = trustedClientIp(
      request({
        "cf-connecting-ip": "203.0.113.9",
        "x-campusos-client-ip": "198.51.100.7",
      }),
      undefined,
    );
    expect(value).toBe("203.0.113.9");
  });

  it("accepts the forwarded address only with the exact secret", () => {
    const value = trustedClientIp(
      request({
        "cf-connecting-ip": "203.0.113.9",
        "x-campusos-proxy-secret": SECRET,
        "x-campusos-client-ip": "198.51.100.7",
      }),
      SECRET,
    );
    expect(value).toBe("198.51.100.7");
  });

  it("ignores a spoofed address with the wrong or missing secret", () => {
    const value = trustedClientIp(
      request({
        "cf-connecting-ip": "203.0.113.9",
        "x-campusos-proxy-secret": "wrong-secret",
        "x-campusos-client-ip": "198.51.100.7",
      }),
      SECRET,
    );
    expect(value).toBe("203.0.113.9");
  });

  it("rejects malformed addresses and falls back to Cloudflare", () => {
    for (const candidate of ["not-an-ip", "999.1.1.1", "1.2.3.4, 5.6.7.8"]) {
      const value = trustedClientIp(
        request({
          "cf-connecting-ip": "203.0.113.9",
          "x-campusos-proxy-secret": SECRET,
          "x-campusos-client-ip": candidate,
        }),
        SECRET,
      );
      expect(value).toBe("203.0.113.9");
    }
  });

  it("supports IPv6 and bracketed IPv6", () => {
    expect(normalizeClientIp("2001:db8::1")).toBe("2001:db8::1");
    expect(normalizeClientIp("[2001:db8::1]")).toBe("2001:db8::1");
    expect(normalizeClientIp("::ffff:192.0.2.1")).toBe("::ffff:192.0.2.1");
  });
});
