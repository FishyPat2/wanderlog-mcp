import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../../src/context.ts";
import { WanderlogError } from "../../src/errors.ts";
import { applyOp, type Json0Op } from "../../src/ot/apply.ts";
import { submitOp } from "../../src/tools/shared.ts";
import { ShareDBClient } from "../../src/transport/sharedb.ts";

const ops: Json0Op[] = [{ p: ["days"], od: 3, oi: 5 }];

function makeFakeContext(failures: Array<Error | null>): {
  ctx: AppContext;
  submitCalls: () => number;
  invalidateCount: () => number;
  applyLocalOpCount: () => number;
} {
  let callIndex = 0;
  let invalidateCount = 0;
  let applyLocalOpCount = 0;

  const fakeClient = {
    isSubscribed: true,
    version: 0,
    async submit(_ops: Json0Op[]): Promise<void> {
      const failure = failures[callIndex++];
      if (failure) throw failure;
      this.version += 1;
    },
  };
  const entry = {
    snapshot: {} as never,
    version: 0,
    geos: [],
  };

  const ctx = {
    pool: { get: () => fakeClient },
    tripCache: {
      getEntry: async () => entry,
      applyLocalOp: () => {
        applyLocalOpCount++;
      },
      invalidate: () => {
        invalidateCount++;
      },
    },
  } as unknown as AppContext;

  return {
    ctx,
    submitCalls: () => callIndex,
    invalidateCount: () => invalidateCount,
    applyLocalOpCount: () => applyLocalOpCount,
  };
}

const rateLimitError = () =>
  new WanderlogError("Wanderlog rejected the request (4001): Too many requests", "rate_limited");

describe("submitOp rate-limit retry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries after a rate_limited error and succeeds", async () => {
    const fake = makeFakeContext([rateLimitError(), null]);
    const promise = submitOp(fake.ctx, "tripA", (_entry, submit) => submit(ops));
    await vi.advanceTimersByTimeAsync(2_000);
    await promise;
    expect(fake.submitCalls()).toBe(2);
    expect(fake.applyLocalOpCount()).toBe(1);
    expect(fake.invalidateCount()).toBe(0);
  });

  it("does not retry stale numeric paths after a remote insertion during backoff", async () => {
    const entry = {
      snapshot: { itinerary: { sections: [{ blocks: [{ id: 1, text: "original" }] }] } },
      version: 0,
    };
    const client = {
      isSubscribed: true,
      version: 0,
      submit: vi.fn().mockRejectedValue(rateLimitError()),
    };
    const invalidate = vi.fn();
    const applyLocalOp = vi.fn();
    const ctx = {
      pool: { get: () => client },
      tripCache: { getEntry: async () => entry, invalidate, applyLocalOp },
    } as unknown as AppContext;
    const edit: Json0Op[] = [
      {
        p: ["itinerary", "sections", 0, "blocks", 0, "text"],
        od: "original",
        oi: "edited",
      },
    ];
    const mutation = submitOp(ctx, "tripA", (_entry, submit) => submit(edit));
    const assertion = expect(mutation).rejects.toMatchObject({ code: "stale_snapshot" });
    await vi.advanceTimersByTimeAsync(10);
    entry.snapshot = applyOp(entry.snapshot, [
      {
        p: ["itinerary", "sections", 0, "blocks", 0],
        li: { id: 2, text: "remote insert" },
      },
    ]);
    entry.version = client.version = 1;
    await vi.advanceTimersByTimeAsync(2_000);
    await assertion;
    expect(client.submit).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledExactlyOnceWith("tripA");
    expect(applyLocalOp).not.toHaveBeenCalled();
    expect(entry.snapshot.itinerary.sections[0]!.blocks).toEqual([
      { id: 2, text: "remote insert" },
      { id: 1, text: "original" },
    ]);
  });

  it("invalidates the cache after exhausting retries", async () => {
    const fake = makeFakeContext([
      rateLimitError(),
      rateLimitError(),
      rateLimitError(),
      rateLimitError(),
    ]);
    const promise = submitOp(fake.ctx, "tripA", (_entry, submit) => submit(ops));
    const assertion = expect(promise).rejects.toMatchObject({
      code: "rate_limited",
    });
    await vi.advanceTimersByTimeAsync(2_000 + 4_000 + 8_000);
    await assertion;
    expect(fake.submitCalls()).toBe(4);
    expect(fake.applyLocalOpCount()).toBe(0);
    expect(fake.invalidateCount()).toBe(1);
  });

  it.each(["empty_op", "ws_not_open", "ws_op_rejected"])(
    "invalidates the cache after rejected submit %s",
    async (code) => {
      const fake = makeFakeContext([new WanderlogError("rejected", code)]);
      await expect(
        submitOp(fake.ctx, "tripA", (_entry, submit) => submit(ops)),
      ).rejects.toMatchObject({ code });
      expect(fake.submitCalls()).toBe(1);
      expect(fake.invalidateCount()).toBe(1);
    },
  );

  it("invalidates after an ambiguous non-rate-limit error", async () => {
    const fake = makeFakeContext([new WanderlogError("Submit op timeout", "submit_timeout")]);
    await expect(
      submitOp(fake.ctx, "tripA", (_entry, submit) => submit(ops)),
    ).rejects.toMatchObject({
      code: "submit_timeout",
    });
    expect(fake.submitCalls()).toBe(1);
    expect(fake.invalidateCount()).toBe(1);
  });
});

describe("ShareDBClient bare {code, message} rejection frames", () => {
  const config = {
    cookieHeader: "connect.sid=test",
    baseUrl: "https://example.test",
    wsBaseUrl: "wss://example.test",
    userAgent: "test",
  };

  function clientWithPendingOp(): {
    client: ShareDBClient;
    pending: Promise<void>;
  } {
    const client = new ShareDBClient(config, "tripA");
    const internals = client as unknown as {
      handshakeComplete: boolean;
      pendingOps: Map<
        number,
        { resolve: () => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
      >;
      handleFrame: (
        frame: Record<string, unknown>,
        handshakeTimeout: NodeJS.Timeout,
        connectResolve: () => void,
        connectReject: (err: Error) => void,
      ) => void;
    };
    internals.handshakeComplete = true;
    const pending = new Promise<void>((resolve, reject) => {
      internals.pendingOps.set(1, {
        resolve,
        reject,
        timer: setTimeout(() => {}, 60_000),
      });
    });
    return { client, pending };
  }

  function deliverFrame(client: ShareDBClient, frame: Record<string, unknown>) {
    (
      client as unknown as {
        handleFrame: (
          frame: Record<string, unknown>,
          handshakeTimeout: NodeJS.Timeout,
          connectResolve: () => void,
          connectReject: (err: Error) => void,
        ) => void;
      }
    ).handleFrame(
      frame,
      setTimeout(() => {}, 60_000),
      () => {},
      () => {},
    );
  }

  it("attributes bare rejection frames carrying a sequence without failing other operations", async () => {
    const { client, pending } = clientWithPendingOp();
    const internals = client as unknown as {
      pendingOps: Map<
        number,
        { resolve: () => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
      >;
    };
    const unrelated = { resolve: vi.fn(), reject: vi.fn(), timer: setTimeout(() => {}, 60_000) };
    internals.pendingOps.set(2, unrelated);
    try {
      deliverFrame(client, { code: 4001, message: "Too many requests", seq: 1 });
      await expect(pending).rejects.toMatchObject({ code: "rate_limited" });
      expect(internals.pendingOps.has(2)).toBe(true);
      expect(unrelated.reject).not.toHaveBeenCalled();
    } finally {
      clearTimeout(unrelated.timer);
    }
  });

  it.each([
    { code: 4001, message: 123 },
    { error: { message: 123 }, seq: 1 },
  ])("handles malformed non-string upstream diagnostics without crashing", async (frame) => {
    const { client, pending } = clientWithPendingOp();
    expect(() => deliverFrame(client, frame)).not.toThrow();
    await expect(pending).rejects.toThrow("123");
  });

  it("redacts the session value in upstream WebSocket errors", async () => {
    const { client, pending } = clientWithPendingOp();
    deliverFrame(client, { error: "Cookie connect.sid=test was rejected", seq: 1 });
    await expect(pending).rejects.toMatchObject({
      code: "ws_op_rejected",
      message: "Cookie [REDACTED] was rejected",
    });
  });

  it("maps code 4001 to a rate_limited error on pending ops", async () => {
    const { client, pending } = clientWithPendingOp();
    deliverFrame(client, {
      code: 4001,
      message: "Too many requests; please try again later",
    });
    await expect(pending).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("maps other bare codes to ws_rejected", async () => {
    const { client, pending } = clientWithPendingOp();
    deliverFrame(client, { code: 4999, message: "nope" });
    await expect(pending).rejects.toMatchObject({ code: "ws_rejected" });
  });

  it("maps a targeted op error to ws_op_rejected", async () => {
    const { client, pending } = clientWithPendingOp();
    deliverFrame(client, { error: "bad path", seq: 1 });
    await expect(pending).rejects.toMatchObject({ code: "ws_op_rejected" });
  });

  it("keeps an unscoped op error ambiguous", async () => {
    const { client, pending } = clientWithPendingOp();
    deliverFrame(client, { error: "unknown failure" });
    await expect(pending).rejects.toMatchObject({ code: "ws_error" });
  });

  it("does not treat op acks (which carry `a`) as rejections", async () => {
    const { client, pending } = clientWithPendingOp();
    const internals = client as unknown as { sessionId?: string };
    internals.sessionId = "session-1";
    deliverFrame(client, {
      a: "op",
      src: "session-1",
      seq: 1,
      v: 7,
      c: "TripPlans",
      d: "tripA",
    });
    await expect(pending).resolves.toBeUndefined();
    expect(client.version).toBe(8);
  });
});
