import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppContext } from "../../src/context.ts";
import { buildServer } from "../../src/server.ts";

describe("custom-section MCP tool metadata", () => {
  let client: Client;
  let server: ReturnType<typeof buildServer>;

  beforeEach(async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    server = buildServer({} as AppContext);
    client = new Client({ name: "metadata-test", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it("publishes lifecycle tools with explicit mutation annotations", async () => {
    const response = await client.listTools();
    const byName = new Map(response.tools.map((tool) => [tool.name, tool]));

    expect(byName.get("wanderlog_add_section")?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    });
    expect(byName.get("wanderlog_update_section")?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
    expect(byName.get("wanderlog_delete_section")?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    });
  });

  it("keeps tool order and schemas deterministic across discovery calls", async () => {
    const first = (await client.listTools()).tools;
    const second = (await client.listTools()).tools;
    expect(first).toHaveLength(33);
    expect(second).toEqual(first);
    expect(new Set(first.map((tool) => tool.name)).size).toBe(first.length);
    for (const tool of first) expect(tool.inputSchema.type).toBe("object");
  });

  it("marks reads and additive mutations without calling hotel search read-only", async () => {
    const tools = (await client.listTools()).tools;
    const readNames = [
      "list_trips",
      "get_trip",
      "get_trip_url",
      "get_trip_forwarding_email",
      "search_places",
      "search_guides",
      "get_guide",
      "list_expenses",
      "list_journal",
    ];
    for (const name of readNames) {
      expect(
        tools.find((tool) => tool.name === `wanderlog_${name}`)?.annotations?.readOnlyHint,
      ).toBe(true);
    }
    const hotels = tools.find((tool) => tool.name === "wanderlog_search_hotels");
    // Hotel search may change the shared session's requested currency.
    expect(hotels?.annotations?.readOnlyHint ?? false).toBe(false);
    for (const tool of tools.filter((tool) => tool.name.startsWith("wanderlog_add_"))) {
      expect(tool.annotations?.destructiveHint).toBe(false);
      expect(tool.annotations?.idempotentHint ?? false).toBe(false);
    }
    for (const name of [
      "remove_place",
      "remove_note",
      "remove_expense",
      "remove_journal",
      "delete_section",
    ]) {
      const tool = tools.find((candidate) => candidate.name === `wanderlog_${name}`);
      expect(tool?.annotations?.destructiveHint ?? true).toBe(true);
      expect(tool?.annotations?.idempotentHint ?? false).toBe(false);
    }
  });

  it("retains journal consent and focused-read guidance in initialization", () => {
    const instructions = client.getInstructions() ?? "";
    expect(instructions).toContain("get_trip defaults to concise");
    expect(instructions).toContain("accepts day");
    expect(instructions).toContain("Never set allow_new_place");
    expect(Buffer.byteLength(instructions)).toBeLessThan(1500);
  });
});
