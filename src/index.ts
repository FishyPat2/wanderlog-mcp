#!/usr/bin/env node
import type { AppContext } from "./context.ts";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createContext } from "./context.js";
import { WanderlogError } from "./errors.js";
import { buildServer } from "./server.js";

async function main() {
  let ctx: AppContext;
  try {
    ctx = createContext();
  } catch (err) {
    const msg = err instanceof WanderlogError ? err.toUserMessage() : (err as Error).message;
    process.stderr.write(`[wanderdog] startup failed: ${msg}\n`);
    process.exit(1);
  }

  try {
    const user = await ctx.rest.getUser();
    ctx.userId = user.id;
    ctx.authenticated = true;
    process.stderr.write("[wanderdog] authenticated\n");
  } catch (err) {
    const msg = err instanceof WanderlogError ? err.toUserMessage() : (err as Error).message;
    process.stderr.write(
      `[wanderdog] auth probe failed: ${msg}\n` +
        `[wanderdog] server will start but all tools will require valid credentials\n`,
    );
  }

  const server = buildServer(ctx);
  const transport = new StdioServerTransport();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stderr.write(`[wanderdog] ${signal} received, shutting down\n`);
    ctx.pool.closeAll();
    await server.close();
    process.exit(0);
  };
  // The SDK transport does not handle stdin EOF; persistent trip sockets otherwise
  // keep the process alive after its client has disconnected.
  process.stdin.once("end", () => void shutdown("stdin EOF"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await server.connect(transport);
  process.stderr.write("[wanderdog] ready (stdio)\n");
}

main().catch((err) => {
  process.stderr.write(`[wanderdog] fatal: ${(err as Error).stack ?? err}\n`);
  process.exit(1);
});
