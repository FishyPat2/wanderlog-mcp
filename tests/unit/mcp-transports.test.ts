import { createServer, get, type Server } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { WebSocketServer } from "ws";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { queenstownTrip } from "../fixtures/queenstown-trip.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// These tests exercise dist/ exactly as a client does; run npm run build first.
describe("compiled MCP transports (offline REST fixture)", () => {
  let upstream: Server;
  let baseUrl: string;
  let authStatus: number;
  let authCalls: number;
  let proc: ChildProcess | undefined;
  let client: Client | undefined;
  let stderr: string;
  const cookie = "s%3Aoffline-test-cookie";

  beforeEach(async () => {
    authStatus = 200;
    authCalls = 0;
    stderr = "";
    upstream = createServer((req, res) => {
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/api/user") {
        authCalls++;
        res.statusCode = authStatus;
        // Invalid JSON intentionally resembles an upstream error containing a credential.
        res.end(
          authStatus === 200 ? JSON.stringify({ user: { id: 1, username: "fixture" } }) : cookie,
        );
      } else if (req.url === "/api/tripPlans/home") {
        res.end(JSON.stringify({ ownTripPlans: [], friendsTripPlans: [] }));
      } else {
        res.statusCode = 404;
        res.end("{}");
      }
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const address = upstream.address();
    if (!address || typeof address === "string") throw new Error("Missing fixture address");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await client?.close();
    if (proc && proc.exitCode === null) {
      const exited = once(proc, "exit");
      proc.kill("SIGTERM");
      await exited;
    }
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    proc = undefined;
    client = undefined;
  });

  const env = () => ({
    ...process.env,
    WANDERLOG_COOKIE: cookie,
    WANDERLOG_BASE_URL: baseUrl,
    HOST: "127.0.0.1",
    MCP_ALLOWED_HOSTS: "127.0.0.1,localhost",
    MCP_ALLOWED_ORIGINS: "https://trusted.example",
  });

  async function startHttp(): Promise<string> {
    const reservation = createServer();
    await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
    const address = reservation.address();
    if (!address || typeof address === "string") throw new Error("Missing port");
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    proc = spawn(process.execPath, ["dist/http.js"], {
      env: { ...env(), PORT: String(address.port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    proc.stderr?.on("data", (chunk) => (stderr += chunk.toString()));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("HTTP startup timeout")), 5000);
      proc!.once("exit", () => {
        clearTimeout(timer);
        reject(new Error("HTTP server exited before ready"));
      });
      proc!.stdout?.on("data", (chunk) => {
        if (chunk.toString().includes("HTTP server listening")) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    return `http://127.0.0.1:${address.port}`;
  }

  async function checkTools() {
    const first = await client!.listTools();
    const second = await client!.listTools();
    expect(first.tools.length).toBeGreaterThanOrEqual(33);
    expect(first).toEqual(second);
    expect(new Set(first.tools.map((tool) => tool.name)).size).toBe(first.tools.length);
    for (const tool of first.tools) expect(tool.inputSchema.type).toBe("object");
    const result = await client!.callTool({ name: "wanderlog_list_trips", arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "text" })]),
    );
    const invalid = await client!.callTool({ name: "wanderlog_get_trip", arguments: {} });
    expect(invalid.isError).toBe(true);
  }

  it("initializes stdio, discovers stable schemas, calls tools, and closes", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["dist/index.js"],
      env: env() as Record<string, string>,
      stderr: "pipe",
    });
    transport.stderr?.on("data", (chunk) => (stderr += chunk.toString()));
    client = new Client({ name: "offline-stdio", version: "1" });
    await client.connect(transport);
    expect(client.getServerVersion()?.name).toBeTruthy();
    await checkTools();
    await client.close();
    client = undefined;
    expect(stderr).not.toContain(cookie);
    expect(authCalls).toBe(1);
  });

  it("reads and mutates through REST/ShareDB, then exits on plain stdin EOF", async () => {
    const trip = structuredClone(queenstownTrip);
    const socketServer = new WebSocketServer({ server: upstream });
    const receivedOps: unknown[] = [];
    let socketClosed: Promise<unknown[]> | undefined;
    socketServer.on("connection", (socket) => {
      socketClosed = once(socket, "close");
      socket.send(
        JSON.stringify({
          a: "init",
          id: "offline-session",
          protocol: 1,
          protocolMinor: 2,
          type: "json0",
        }),
      );
      socket.on("message", (raw) => {
        const frame = JSON.parse(raw.toString());
        if (frame.a === "hs") {
          socket.send(
            JSON.stringify({
              a: "hs",
              id: "offline-session",
              protocol: 1,
              protocolMinor: 2,
              type: "json0",
            }),
          );
        } else if (frame.a === "s") {
          socket.send(
            JSON.stringify({ a: "s", c: "TripPlans", d: trip.key, data: { v: 1, data: trip } }),
          );
        } else if (frame.a === "op") {
          receivedOps.push(frame);
          socket.send(
            JSON.stringify({
              a: "op",
              c: "TripPlans",
              d: trip.key,
              src: "offline-session",
              seq: frame.seq,
              v: frame.v,
            }),
          );
        }
      });
    });
    upstream.removeAllListeners("request");
    upstream.on("request", (req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify(
          req.url === "/api/user"
            ? { user: { id: 1, username: "fixture" } }
            : { tripPlan: trip, resources: { geos: [] } },
        ),
      );
    });
    proc = spawn(process.execPath, ["dist/index.js"], {
      env: { ...env(), WANDERLOG_WS_BASE_URL: baseUrl.replace("http:", "ws:") },
      stdio: ["pipe", "pipe", "pipe"],
    });
    proc.stderr!.on("data", (chunk) => (stderr += chunk.toString()));
    const lines = createInterface({ input: proc.stdout! });
    // Own the pipes so EOF is observable without the SDK's signal escalation.
    const transport: Transport = {
      async start() {
        lines.on("line", (line) => transport.onmessage?.(JSON.parse(line)));
      },
      async send(message) {
        proc!.stdin!.write(`${JSON.stringify(message)}\n`);
      },
      async close() {
        proc!.stdin!.end();
      },
    };
    client = new Client({ name: "offline-mutation", version: "1" });
    try {
      await client.connect(transport);
      const before = await client.callTool({
        name: "wanderlog_get_trip",
        arguments: { trip_key: trip.key },
      });
      expect(before.isError).not.toBe(true);
      expect(JSON.stringify(before)).toContain(trip.title);
      const added = await client.callTool({
        name: "wanderlog_add_note",
        arguments: { trip_key: trip.key, section: "Notes", text: "Offline integration note" },
      });
      expect(added.isError).not.toBe(true);
      expect(receivedOps).toEqual([
        expect.objectContaining({
          v: 1,
          op: [
            expect.objectContaining({
              p: ["itinerary", "sections", 0, "blocks", 0],
              li: expect.objectContaining({ type: "note" }),
            }),
          ],
        }),
      ]);
      const after = await client.callTool({
        name: "wanderlog_get_trip",
        arguments: { trip_key: trip.key },
      });
      expect(after.isError).not.toBe(true);
      expect(JSON.stringify(after)).toContain("Offline integration note");
      const exited = once(proc, "exit", { signal: AbortSignal.timeout(2_000) });
      proc.stdin!.end();
      expect(await exited).toEqual([0, null]);
      await socketClosed;
      expect(stderr).toContain("stdin EOF received");
      expect(stderr).not.toMatch(/SIGTERM|SIGINT/);
    } finally {
      for (const socket of socketServer.clients) socket.terminate();
      await new Promise<void>((resolve) => socketServer.close(() => resolve()));
      lines.close();
    }
  });

  it("keeps failed-auth stdio usable and returns an MCP tool error", async () => {
    authStatus = 401;
    client = new Client({ name: "offline-auth", version: "1" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ["dist/index.js"],
        env: env() as Record<string, string>,
        stderr: "pipe",
      }),
    );
    expect((await client.listTools()).tools.length).toBeGreaterThan(0);
    const result = await client.callTool({ name: "wanderlog_list_trips", arguments: {} });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain(cookie);
  });

  it("initializes stateless HTTP, calls tools, and reuses authenticated context", async () => {
    const url = await startHttp();
    client = new Client({ name: "offline-http", version: "1" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${cookie}` } },
      }),
    );
    await checkTools();
    expect(authCalls).toBe(1);
    const health = await fetch(`${url}/health`);
    expect(await health.json()).toEqual({ status: "ok" });
    expect(stderr).not.toContain(cookie);
  });

  it("rejects missing and query credentials before contacting upstream", async () => {
    const url = await startHttp();
    for (const path of ["/mcp", `/mcp?token=${cookie}`]) {
      const response = await fetch(`${url}${path}`);
      expect(response.status).toBe(401);
      expect(await response.text()).not.toContain(cookie);
    }
    const reboundStatus = await new Promise<number | undefined>((resolve, reject) => {
      get(`${url}/health`, { headers: { Host: "attacker.invalid" } }, (response) => {
        response.resume();
        resolve(response.statusCode);
      }).on("error", reject);
    });
    expect(reboundStatus).toBe(403);
    const crossOrigin = await fetch(`${url}/mcp`, {
      headers: { Origin: "https://attacker.invalid", Authorization: `Bearer ${cookie}` },
    });
    expect(crossOrigin.status).toBe(403);
    const allowedOrigin = await fetch(`${url}/health`, {
      headers: { Origin: "https://trusted.example" },
    });
    expect(allowedOrigin.status).toBe(200);
    expect(authCalls).toBe(0);
  });

  it("returns private-data-safe JSON errors for malformed request bodies", async () => {
    const url = await startHttp();
    for (const body of [cookie, `{"cookie":${cookie}}`, "{"]) {
      const response = await fetch(`${url}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://attacker.invalid",
          Authorization: `Bearer ${cookie}`,
        },
        body,
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        jsonrpc: "2.0",
        error: { code: -32700, message: "Invalid JSON" },
        id: null,
      });
    }
    expect(stderr).not.toContain(cookie);
    expect(stderr).not.toContain("s%3A");
    expect(stderr).not.toContain("SyntaxError");
    expect(authCalls).toBe(0);
  });

  it("returns a generic error for oversized request bodies", async () => {
    const url = await startHttp();
    const response = await fetch(`${url}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cookie}` },
      body: JSON.stringify({ value: cookie.repeat(6_000) }),
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      jsonrpc: "2.0",
      error: { code: -32600, message: "Request body too large" },
      id: null,
    });
    expect(stderr).not.toContain(cookie);
    expect(stderr).not.toContain("PayloadTooLargeError");
    expect(authCalls).toBe(0);
  });

  it("never reflects upstream parse failures or credentials in HTTP auth errors", async () => {
    authStatus = 200;
    upstream.removeAllListeners("request");
    upstream.on("request", (_req, res) => res.end(cookie));
    const url = await startHttp();
    const response = await fetch(`${url}/mcp`, { headers: { Authorization: `Bearer ${cookie}` } });
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain(cookie);
    expect(stderr).not.toContain(cookie);
  });
});
