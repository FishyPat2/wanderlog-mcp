import { describe, expect, it, vi } from "vitest";
import type { AppContext } from "../../src/context.ts";
import { requireAuth } from "../../src/server.ts";

const successResponse = {
  content: [{ type: "text" as const, text: "ok" }],
};

function createContext(getUser: ReturnType<typeof vi.fn>, authenticated = false): AppContext {
  return {
    authenticated,
    rest: { getUser } as unknown as AppContext["rest"],
  } as AppContext;
}

describe("requireAuth", () => {
  it("does not probe again after startup authentication succeeds", async () => {
    const getUser = vi.fn();
    const handler = vi.fn().mockResolvedValue(successResponse);
    const guarded = requireAuth(createContext(getUser, true), handler);

    await expect(guarded({})).resolves.toEqual(successResponse);
    expect(getUser).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledOnce();
  });

  it("recovers a valid session after the startup probe failed", async () => {
    const getUser = vi.fn().mockResolvedValue({ id: 42, username: "traveler" });
    const ctx = createContext(getUser);
    const handler = vi.fn().mockResolvedValue(successResponse);
    const guarded = requireAuth(ctx, handler);

    await expect(guarded({})).resolves.toEqual(successResponse);
    expect(getUser).toHaveBeenCalledOnce();
    expect(ctx.authenticated).toBe(true);
    expect(ctx.userId).toBe(42);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("preserves the authentication error when the retry fails", async () => {
    const getUser = vi.fn().mockRejectedValue(new Error("secret transport detail"));
    const handler = vi.fn().mockResolvedValue(successResponse);
    const guarded = requireAuth(createContext(getUser), handler);

    const response = await guarded({});

    expect(response).toMatchObject({
      isError: true,
      content: [{ text: expect.stringContaining("Authentication required") }],
    });
    expect(response.content[0]?.text).not.toContain("secret transport detail");
    expect(handler).not.toHaveBeenCalled();
  });

  it("shares one in-flight retry across concurrent tool calls", async () => {
    let resolveUser: ((user: { id: number; username: string }) => void) | undefined;
    const getUser = vi.fn(
      () =>
        new Promise<{ id: number; username: string }>((resolve) => {
          resolveUser = resolve;
        }),
    );
    const ctx = createContext(getUser);
    const firstHandler = vi.fn().mockResolvedValue(successResponse);
    const secondHandler = vi.fn().mockResolvedValue(successResponse);

    const firstCall = requireAuth(ctx, firstHandler)({});
    const secondCall = requireAuth(ctx, secondHandler)({});

    expect(getUser).toHaveBeenCalledOnce();
    resolveUser?.({ id: 7, username: "traveler" });
    await expect(Promise.all([firstCall, secondCall])).resolves.toEqual([
      successResponse,
      successResponse,
    ]);
    expect(firstHandler).toHaveBeenCalledOnce();
    expect(secondHandler).toHaveBeenCalledOnce();
  });

  it("caches a failed retry to prevent repeated invalid-cookie probes", async () => {
    const getUser = vi.fn().mockRejectedValue(new Error("invalid cookie"));
    const handler = vi.fn().mockResolvedValue(successResponse);
    const guarded = requireAuth(createContext(getUser), handler);

    await guarded({});
    await guarded({});

    expect(getUser).toHaveBeenCalledOnce();
    expect(handler).not.toHaveBeenCalled();
  });

  it.each([false, true])("redacts credentials from tool text with isError=%s", async (isError) => {
    const cookie = "s%3Atest-session.signature";
    const ctx = createContext(vi.fn(), true);
    ctx.config = {
      cookieHeader: `connect.sid=${cookie}; secondary=other-secret`,
    } as AppContext["config"];
    const handler = vi.fn().mockResolvedValue({
      content: [
        {
          type: "text",
          text: `Upstream echoed ${cookie}, ${decodeURIComponent(cookie)}, ${ctx.config.cookieHeader}`,
        },
      ],
      isError,
    });
    const result = await requireAuth(ctx, handler)({});
    expect(result.isError).toBe(isError);
    expect(result.content[0]?.text).toBe("Upstream echoed [REDACTED], [REDACTED], [REDACTED]");
  });

  it("returns a redacted MCP tool error for an uncaught handler failure", async () => {
    const ctx = createContext(vi.fn(), true);
    ctx.config = { cookieHeader: "connect.sid=s%3Aprivate.signature" } as AppContext["config"];
    const handler = vi.fn().mockRejectedValue(new Error("Socket URL echoed s:private.signature"));
    await expect(requireAuth(ctx, handler)({})).resolves.toEqual({
      content: [{ type: "text", text: "Unexpected error: Socket URL echoed [REDACTED]" }],
      isError: true,
    });
  });
});
