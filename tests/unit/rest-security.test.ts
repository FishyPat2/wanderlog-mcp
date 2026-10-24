import { afterEach, describe, expect, it, vi } from "vitest";
import { RestClient } from "../../src/transport/rest.ts";
import { normalizeCookie, redactCredentials } from "../../src/config.ts";

const secret = "s%3Aprivate-sentinel.signature";
const client = () =>
  new RestClient({
    cookieHeader: `connect.sid=${secret}`,
    baseUrl: "https://wanderlog.test",
    wsBaseUrl: "wss://wanderlog.test",
    userAgent: "test",
  });
afterEach(() => vi.unstubAllGlobals());

describe("REST security boundaries", () => {
  it("bounds requests and prevents redirects from forwarding the session cookie", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"success":true}'));
    vi.stubGlobal("fetch", fetch);
    await client().listTrips();
    expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: "error" });
    expect(fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("never echoes network diagnostics that contain credentials", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error(`Cookie: ${secret}`)));
    await expect(client().listTrips()).rejects.toThrow("failed or timed out");
    await client()
      .listTrips()
      .catch((err: Error) => {
        expect(err.stack).not.toContain(secret);
      });
  });

  it("never echoes response contents through JSON parser diagnostics", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => Promise.resolve(new Response(secret))),
    );
    await expect(client().listTrips()).rejects.toMatchObject({ code: "parse_error" });
    await client()
      .listTrips()
      .catch((err: Error) => expect(err.stack).not.toContain(secret));
  });

  it("rejects logical failure envelopes even with HTTP 200 and plausible data", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ success: false, user: { id: 1 }, message: secret })),
        ),
    );
    await expect(client().getUser()).rejects.toMatchObject({
      code: "upstream_rejected",
      message: "Wanderlog rejected the request",
    });
  });

  it.each([
    `connect.sid=${secret}\r\nX-Test: value`,
    `connect.sid=${secret}\0`,
    "other_connect.sid=value",
  ])("rejects malformed cookie headers without echoing input", (value) => {
    expect(() => normalizeCookie(value)).toThrow();
    try {
      normalizeCookie(value);
    } catch (err) {
      expect(String(err)).not.toContain(secret);
    }
  });
});

describe("credential redaction", () => {
  it("removes complete headers and encoded and decoded session values", () => {
    const header = `connect.sid=${secret}; other=another-private-value`;
    const text = `${header} ${decodeURIComponent(secret)}`;
    expect(redactCredentials(text, header)).not.toContain("private");
    expect(redactCredentials("plain error", "")).toBe("plain error");
  });
  it("preserves ordinary numeric data when an auxiliary cookie is short", () => {
    const data = '{"day":1,"price":100,"date":"2026-01-01"}';
    expect(redactCredentials(data, `connect.sid=${secret}; other=1`)).toBe(data);
  });
});
