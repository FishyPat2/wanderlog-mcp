/** Offline byte measurements through the real MCP SDK; no credentials or network. */
import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/server.ts";
import type { AppContext } from "../src/context.ts";
import { applyOp, type Json0Op } from "../src/ot/apply.ts";
import { buildLargeTrip } from "../tests/fixtures/large-trip.ts";

const trip = buildLargeTrip(134, 14);
const entry = { snapshot: trip, version: 1, geos: [] };
let submits = 0;
let restCalls = 0;
const ctx = {
  authenticated: true,
  userId: 1,
  config: { defaultCurrency: "USD" },
  rest: {
    listTrips: async () => {
      restCalls++;
      return Array.from({ length: 10 }, (_, i) => ({
        ...trip,
        key: `trip-${i}`,
        title: `Trip ${i}`,
      }));
    },
    searchPlacesAutocomplete: async () => {
      restCalls++;
      return [
        {
          place_id: "fixture-place",
          description: "Museum, Tokyo",
          structured_formatting: { main_text: "Museum", secondary_text: "Tokyo" },
        },
      ];
    },
    getPlacePhotos: async () => {
      restCalls++;
      return [];
    },
    getPlaceDetails: async () => {
      restCalls++;
      return {
        name: "Museum",
        place_id: "fixture-place",
        geometry: { location: { lat: 35.68, lng: 139.69 } },
      };
    },
    getGeo: async () => {
      restCalls++;
      return { id: 1, name: "Tokyo", countryName: "Japan", bounds: [139, 35, 140, 36] };
    },
    searchLodgings: async () => {
      restCalls++;
      return {
        isComplete: true,
        offers: [
          {
            lodging: {
              id: { type: "google", lodgingId: "hotel" },
              name: "Fixture Hotel",
              location: { latitude: 35.68, longitude: 139.69 },
              rating: { source: "google", value: 8.5 },
              amenities: [{ name: "WiFi", category: "internet" }],
            },
            priceRate: {
              amount: 100,
              currencyCode: "USD",
              site: "google",
              bookingUrl: "https://example.com/hotel",
            },
          },
        ],
      };
    },
  },
  pool: {
    get: () => ({
      isSubscribed: true,
      version: entry.version,
      submit: async () => {
        submits++;
      },
    }),
  },
  tripCache: {
    get: async () => entry.snapshot,
    getEntry: async () => entry,
    applyLocalOp: (_key: string, ops: Json0Op[], version: number) => {
      entry.snapshot = applyOp(entry.snapshot, ops);
      entry.version = version;
    },
    invalidate: () => {
      throw new Error("Unexpected benchmark cache invalidation");
    },
  },
} as unknown as AppContext;
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const server = buildServer(ctx);
const client = new Client({ name: "offline-benchmark", version: "1" });
await server.connect(serverTransport);
await client.connect(clientTransport);
const tools = (await client.listTools()).tools;
const bytes = (value: unknown) =>
  Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value));
const workloads = [
  ["list_trips", "wanderlog_list_trips", {}],
  ["multi_day", "wanderlog_get_trip", { trip_key: trip.key }],
  ["single_day", "wanderlog_get_trip", { trip_key: trip.key, day: "day 2" }],
  ["detailed_trip", "wanderlog_get_trip", { trip_key: trip.key, response_format: "detailed" }],
  [
    "place_search",
    "wanderlog_search_places",
    { trip_key: trip.key, query: "museum", response_format: "detailed" },
  ],
  [
    "hotel_search",
    "wanderlog_search_hotels",
    { geo_id: 1, check_in: "2026-11-01", check_out: "2026-11-03" },
  ],
  [
    "itinerary_add",
    "wanderlog_add_place",
    {
      trip_key: trip.key,
      place_id: "fixture-place",
      day: "day 1",
      note: "Book tickets ahead",
      start_time: "09:00",
      end_time: "10:00",
    },
  ],
  [
    "itinerary_edit",
    "wanderlog_annotate_place",
    {
      trip_key: trip.key,
      day: "day 1",
      place: "Museum on day 1",
      note: "Bring tickets",
      start_time: "09:30",
      end_time: "10:30",
    },
  ],
  ["failure", "wanderlog_get_trip", { trip_key: trip.key, day: "day 99" }],
] as const;
const responses: Record<string, unknown> = {};
try {
  for (const [label, name, args] of workloads) {
    const beforeRest = restCalls;
    const beforeSubmits = submits;
    const response = await client.callTool({ name, arguments: args });
    const expectError = label === "failure";
    if (!!response.isError !== expectError)
      throw new Error(`${label}: unexpected result ${JSON.stringify(response)}`);
    const hash = (value: unknown) =>
      createHash("sha256").update(JSON.stringify(value)).digest("hex");
    const hotelJson =
      label === "hotel_search"
        ? JSON.parse((response.content as { text: string }[])[0]!.text)
        : undefined;
    responses[label] = {
      bytes: bytes(response),
      sha256: hash(response),
      ...(hotelJson
        ? {
            semanticSha256: hash(hotelJson),
            // Compare this hash to the recorded baseline to prove only JSON whitespace changed.
            prettyEnvelopeSha256: hash({
              ...response,
              content: [{ type: "text", text: JSON.stringify(hotelJson, null, 2) }],
            }),
          }
        : {}),
      mcpCalls: 1,
      restCalls: restCalls - beforeRest,
      submits: submits - beforeSubmits,
    };
  }
  console.log(
    JSON.stringify(
      {
        method:
          "UTF-8 bytes, not model tokens; SDK in-memory transport, synthetic 134-place/14-day trip",
        tools: tools.length,
        definitionsBytes: bytes(tools),
        inputSchemasSha256: createHash("sha256")
          .update(JSON.stringify(tools.map(({ name, inputSchema }) => ({ name, inputSchema }))))
          .digest("hex"),
        instructionsBytes: bytes(client.getInstructions() ?? ""),
        responses,
      },
      null,
      2,
    ),
  );
} finally {
  await client.close();
  await server.close();
}
