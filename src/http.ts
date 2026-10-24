#!/usr/bin/env node
import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { normalizeCookie, type Config } from "./config.js";
import { RestClient } from "./transport/rest.js";
import { ShareDBPool } from "./transport/sharedb.js";
import { TripCache } from "./cache/trip-cache.js";
import type { AppContext } from "./context.js";
import { buildServer } from "./server.js";

// --- per-user context cache keyed by cookie hash ---

type CachedContext = { ctx: AppContext; lastUsed: number; activeRequests: number };

const CTX_TTL_MS = 10 * 60 * 1000; // 10 minutes
const ctxCache = new Map<string, CachedContext>();
const ctxPending = new Map<string, Promise<CachedContext>>();

function hashCookie(cookie: string): string {
  return createHash("sha256").update(cookie).digest("hex");
}

function evictStaleContexts() {
  const now = Date.now();
  for (const [key, entry] of ctxCache) {
    if (entry.activeRequests === 0 && now - entry.lastUsed > CTX_TTL_MS) {
      entry.ctx.pool.closeAll();
      ctxCache.delete(key);
    }
  }
}

// Run eviction every 2 minutes
setInterval(evictStaleContexts, 2 * 60 * 1000).unref();

async function getOrCreateContext(cookieRaw: string): Promise<CachedContext> {
  const cookie = normalizeCookie(cookieRaw);
  const key = hashCookie(cookie);

  const cached = ctxCache.get(key);
  if (cached) {
    cached.lastUsed = Date.now();
    return cached;
  }

  // Deduplicate concurrent requests for the same cookie
  const pending = ctxPending.get(key);
  if (pending) return pending;

  const promise = (async () => {
    const config: Config = {
      cookieHeader: cookie,
      baseUrl: process.env.WANDERLOG_BASE_URL ?? "https://wanderlog.com",
      wsBaseUrl: process.env.WANDERLOG_WS_BASE_URL ?? "wss://wanderlog.com",
      defaultCurrency: process.env.WANDERLOG_DEFAULT_CURRENCY,
      userAgent:
        process.env.WANDERLOG_USER_AGENT ??
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
    };
    const rest = new RestClient(config);
    const pool = new ShareDBPool(config);
    const tripCache = new TripCache(rest, pool);

    const user = await rest.getUser();
    const ctx: AppContext = { config, rest, pool, tripCache, userId: user.id, authenticated: true };

    const entry = { ctx, lastUsed: Date.now(), activeRequests: 0 };
    ctxCache.set(key, entry);
    return entry;
  })();

  ctxPending.set(key, promise);
  try {
    return await promise;
  } finally {
    ctxPending.delete(key);
  }
}

// Credentials belong in headers: query strings leak through access logs and history.

function extractCookie(req: {
  headers: Record<string, string | undefined>;
  url?: string;
}): string | null {
  const auth = req.headers.authorization;
  if (auth) {
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (match?.[1]) return match[1];
  }

  return null;
}

// --- HTTP server ---

async function main() {
  const host = process.env.HOST ?? "127.0.0.1";
  const allowedHosts = process.env.MCP_ALLOWED_HOSTS?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const app = createMcpExpressApp({ host, allowedHosts });
  const allowedOrigins = new Set(
    process.env.MCP_ALLOWED_ORIGINS?.split(",")
      .map((value) => value.trim())
      .filter(Boolean) ?? [],
  );
  app.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.has(origin)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Origin not allowed" }));
      return;
    }
    next();
  });

  // All MCP methods (POST, GET, DELETE) go through auth + transport so
  // the transport itself decides what's allowed per the spec.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleMcp = async (req: any, res: any) => {
    const cookie = extractCookie(req);
    if (!cookie) {
      res.status(401).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message:
            "Missing Authorization header. Set Bearer token to your Wanderlog connect.sid cookie value.",
        },
        id: null,
      });
      return;
    }

    let entry: CachedContext;
    try {
      entry = await getOrCreateContext(cookie);
    } catch {
      console.error("[wanderdog] authentication failed");
      res.status(403).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message:
            "Authentication failed. Check your Wanderlog session cookie and upstream connectivity.",
        },
        id: null,
      });
      return;
    }

    if (res.destroyed) return;
    entry.activeRequests++;
    const server = buildServer(entry.ctx);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    // Register before handling: a completed response can close during handleRequest.
    res.once("close", () => {
      entry.activeRequests--;
      entry.lastUsed = Date.now();
      void server.close().catch(() => {
        console.error("[wanderdog] transport cleanup failed");
      });
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      console.error("[wanderdog] error handling request");
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  };

  app.post("/mcp", handleMcp);
  app.get("/mcp", handleMcp);
  app.delete("/mcp", handleMcp);

  // Health check for fly.io
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.get("/health", (_req: any, res: any) => {
    res.status(200).json({ status: "ok" });
  });

  // The SDK installs a JSON parser before our routes. Its default Express error
  // handler logs request-body excerpts, which can contain credentials or private data.
  app.use((err: unknown, _req: IncomingMessage, res: ServerResponse, _next: () => void) => {
    if (res.headersSent) {
      res.end();
      return;
    }
    const parserError = err as { status?: unknown; type?: unknown } | null;
    const status =
      typeof parserError?.status === "number" &&
      parserError.status >= 400 &&
      parserError.status < 500
        ? parserError.status
        : 500;
    const parseFailure = status === 400 && parserError?.type === "entity.parse.failed";
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: parseFailure ? -32700 : status < 500 ? -32600 : -32603,
          message: parseFailure
            ? "Invalid JSON"
            : status === 413
              ? "Request body too large"
              : status < 500
                ? "Invalid request"
                : "Internal server error",
        },
        id: null,
      }),
    );
  });

  const port = Number(process.env.PORT ?? "3000");
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("PORT must be an integer between 0 and 65535");
  }
  app.listen(port, host, () => {
    console.log(`[wanderdog] HTTP server listening on ${host}:${port}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`[wanderdog] ${signal} received, shutting down`);
    for (const [, entry] of ctxCache) {
      entry.ctx.pool.closeAll();
    }
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch(() => {
  console.error("[wanderdog] fatal: HTTP server startup failed");
  process.exit(1);
});
