import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppContext } from "./context.js";
import { redactCredentials } from "./config.js";
import { VERSION } from "./version.js";
import {
  addChecklist,
  addChecklistDescription,
  addChecklistInputSchema,
} from "./tools/add-checklist.js";
import { addExpense, addExpenseDescription, addExpenseInputSchema } from "./tools/add-expense.js";
import {
  annotatePlace,
  annotatePlaceDescription,
  annotatePlaceInputSchema,
} from "./tools/annotate-place.js";
import { addHotel, addHotelDescription, addHotelInputSchema } from "./tools/add-hotel.js";
import { addNote, addNoteDescription, addNoteInputSchema } from "./tools/add-note.js";
import { addPlace, addPlaceDescription, addPlaceInputSchema } from "./tools/add-place.js";
import { createTrip, createTripDescription, createTripInputSchema } from "./tools/create-trip.js";
import { getTrip, getTripDescription, getTripInputSchema } from "./tools/get-trip.js";
import { getTripUrl, getTripUrlDescription, getTripUrlInputSchema } from "./tools/get-trip-url.js";
import {
  getTripForwardingEmail,
  getTripForwardingEmailDescription,
  getTripForwardingEmailInputSchema,
} from "./tools/get-trip-forwarding-email.js";
import { listTrips, listTripsDescription, listTripsInputSchema } from "./tools/list-trips.js";
import {
  removePlace,
  removePlaceDescription,
  removePlaceInputSchema,
} from "./tools/remove-place.js";
import { moveBlock, moveBlockDescription, moveBlockInputSchema } from "./tools/move-block.js";
import {
  searchPlaces,
  searchPlacesDescription,
  searchPlacesInputSchema,
} from "./tools/search-places.js";
import {
  searchHotels,
  searchHotelsDescription,
  searchHotelsInputSchema,
} from "./tools/search-hotels.js";
import {
  updateTripDates,
  updateTripDatesDescription,
  updateTripDatesInputSchema,
} from "./tools/update-trip-dates.js";
import { renameDay, renameDayDescription, renameDayInputSchema } from "./tools/rename-day.js";
import { editNote, editNoteDescription, editNoteInputSchema } from "./tools/edit-note.js";
import { removeNote, removeNoteDescription, removeNoteInputSchema } from "./tools/remove-note.js";
import {
  listExpenses,
  listExpensesDescription,
  listExpensesInputSchema,
} from "./tools/list-expenses.js";
import {
  removeExpense,
  removeExpenseDescription,
  removeExpenseInputSchema,
} from "./tools/remove-expense.js";
import {
  editExpense,
  editExpenseDescription,
  editExpenseInputSchema,
} from "./tools/edit-expense.js";
import {
  searchGuides,
  searchGuidesDescription,
  searchGuidesInputSchema,
} from "./tools/search-guides.js";
import { getGuide, getGuideDescription, getGuideInputSchema } from "./tools/get-guide.js";
import {
  listJournal,
  listJournalDescription,
  listJournalInputSchema,
} from "./tools/list-journal.js";
import { addJournal, addJournalDescription, addJournalInputSchema } from "./tools/add-journal.js";
import {
  editJournal,
  editJournalDescription,
  editJournalInputSchema,
} from "./tools/edit-journal.js";
import {
  removeJournal,
  removeJournalDescription,
  removeJournalInputSchema,
} from "./tools/remove-journal.js";
import { addSection, addSectionDescription, addSectionInputSchema } from "./tools/add-section.js";
import {
  updateSection,
  updateSectionDescription,
  updateSectionInputSchema,
} from "./tools/update-section.js";
import {
  deleteSection,
  deleteSectionDescription,
  deleteSectionInputSchema,
} from "./tools/delete-section.js";
import { addTransit, addTransitDescription, addTransitInputSchema } from "./tools/add-transit.js";
import {
  addCarRental,
  addCarRentalDescription,
  addCarRentalInputSchema,
} from "./tools/add-car-rental.js";

const AUTH_ERROR_RESPONSE = {
  content: [
    {
      type: "text" as const,
      text: "Authentication required. Update WANDERLOG_COOKIE with a valid connect.sid cookie from wanderlog.com and restart the server.",
    },
  ],
  isError: true,
};

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: { type: "text"; text: string }[];
  isError?: boolean;
}>;

const lazyAuthAttempts = new WeakMap<AppContext, Promise<boolean>>();

async function ensureAuthenticated(ctx: AppContext): Promise<boolean> {
  if (ctx.authenticated) return true;

  let attempt = lazyAuthAttempts.get(ctx);
  if (!attempt) {
    attempt = ctx.rest
      .getUser()
      .then((user) => {
        ctx.userId = user.id;
        ctx.authenticated = true;
        return true;
      })
      .catch(() => false);
    lazyAuthAttempts.set(ctx, attempt);
  }

  return attempt;
}

export function requireAuth(ctx: AppContext, handler: ToolHandler) {
  return async (args: Record<string, unknown>) => {
    if (!(await ensureAuthenticated(ctx))) return AUTH_ERROR_RESPONSE;
    const redact = (text: string) => redactCredentials(text, ctx.config?.cookieHeader ?? "");
    try {
      const result = await handler(args);
      return {
        ...result,
        content: result.content.map((item) => ({ ...item, text: redact(item.text) })),
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: redact(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`),
          },
        ],
        isError: true,
      };
    }
  };
}

const SERVER_INSTRUCTIONS = `
Wanderlog trip tools accept natural-language place, day, and section references. Use list_trips
for an unknown trip_key; get_trip defaults to concise output and accepts day for focused reads.
Request detailed output for full notes, addresses, or reservation details. Unknown block types
may be shown as unsupported; do not infer their contents.

Follow the user's requested scope. Add a known place directly with add_place; combine its
note and start_time/end_time in that call. Use add_note for freestanding commentary and
annotate_place to edit an existing place. Search places with detailed output once when an
exact candidate place_id is needed. Search hotels to compare prices and filters before
add_hotel. Search_guides/get_guide read other people's published guides; get_trip reads trips.

Journal tools record actual visits. Add_journal reuses trip places; if it asks about a new
place, ask the user whether to add it to the itinerary or explicitly allow a new journal place.
Never set allow_new_place on the user's behalf without asking. Resolve ambiguous references
before retrying mutations; do not blindly retry a failed mutation, which may have applied.
`.trim();

export function buildServer(ctx: AppContext): McpServer {
  const server = new McpServer(
    { name: "wanderlog-mcp", version: VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );

  server.registerTool(
    "wanderlog_list_trips",
    {
      title: "List Wanderlog trips",
      description: listTripsDescription,
      inputSchema: listTripsInputSchema,
      annotations: { readOnlyHint: true },
    },
    requireAuth(ctx, async (args) => listTrips(ctx, args as Parameters<typeof listTrips>[1])),
  );

  server.registerTool(
    "wanderlog_get_trip",
    {
      title: "Get a Wanderlog trip",
      description: getTripDescription,
      inputSchema: getTripInputSchema,
      annotations: { readOnlyHint: true },
    },
    requireAuth(ctx, async (args) => getTrip(ctx, args as Parameters<typeof getTrip>[1])),
  );

  server.registerTool(
    "wanderlog_get_trip_url",
    {
      title: "Get the wanderlog.com URL for a trip",
      description: getTripUrlDescription,
      inputSchema: getTripUrlInputSchema,
      annotations: { readOnlyHint: true },
    },
    requireAuth(ctx, async (args) => getTripUrl(ctx, args as Parameters<typeof getTripUrl>[1])),
  );

  server.registerTool(
    "wanderlog_get_trip_forwarding_email",
    {
      title: "Get a trip's email-import address",
      description: getTripForwardingEmailDescription,
      inputSchema: getTripForwardingEmailInputSchema,
      annotations: { readOnlyHint: true },
    },
    requireAuth(ctx, async (args) =>
      getTripForwardingEmail(ctx, args as Parameters<typeof getTripForwardingEmail>[1]),
    ),
  );

  server.registerTool(
    "wanderlog_search_places",
    {
      title: "Search places near a Wanderlog trip",
      description: searchPlacesDescription,
      inputSchema: searchPlacesInputSchema,
      annotations: { readOnlyHint: true },
    },
    requireAuth(ctx, async (args) => searchPlaces(ctx, args as Parameters<typeof searchPlaces>[1])),
  );

  server.registerTool(
    "wanderlog_search_guides",
    {
      title: "Search Wanderlog travel guides",
      description: searchGuidesDescription,
      inputSchema: searchGuidesInputSchema,
      annotations: { readOnlyHint: true },
    },
    requireAuth(ctx, async (args) => searchGuides(ctx, args as Parameters<typeof searchGuides>[1])),
  );

  server.registerTool(
    "wanderlog_get_guide",
    {
      title: "Read a Wanderlog travel guide",
      description: getGuideDescription,
      inputSchema: getGuideInputSchema,
      annotations: { readOnlyHint: true },
    },
    requireAuth(ctx, async (args) => getGuide(ctx, args as Parameters<typeof getGuide>[1])),
  );

  server.registerTool(
    "wanderlog_search_hotels",
    {
      title: "Search hotels for a destination",
      description: searchHotelsDescription,
      inputSchema: searchHotelsInputSchema,
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    requireAuth(ctx, async (args) => searchHotels(ctx, args as Parameters<typeof searchHotels>[1])),
  );

  server.registerTool(
    "wanderlog_create_trip",
    {
      title: "Create a Wanderlog trip",
      description: createTripDescription,
      inputSchema: createTripInputSchema,
      annotations: { destructiveHint: false },
    },
    requireAuth(ctx, async (args) => createTrip(ctx, args as Parameters<typeof createTrip>[1])),
  );

  server.registerTool(
    "wanderlog_add_place",
    {
      title: "Add a place to a Wanderlog trip",
      description: addPlaceDescription,
      inputSchema: addPlaceInputSchema,
      annotations: { destructiveHint: false },
    },
    requireAuth(ctx, async (args) => addPlace(ctx, args as Parameters<typeof addPlace>[1])),
  );

  server.registerTool(
    "wanderlog_add_hotel",
    {
      title: "Add a hotel booking to a Wanderlog trip",
      description: addHotelDescription,
      inputSchema: addHotelInputSchema,
      annotations: { destructiveHint: false },
    },
    requireAuth(ctx, async (args) => addHotel(ctx, args as Parameters<typeof addHotel>[1])),
  );

  server.registerTool(
    "wanderlog_add_note",
    {
      title: "Add a note to a Wanderlog trip",
      description: addNoteDescription,
      inputSchema: addNoteInputSchema,
      annotations: { destructiveHint: false },
    },
    requireAuth(ctx, async (args) => addNote(ctx, args as Parameters<typeof addNote>[1])),
  );

  server.registerTool(
    "wanderlog_add_checklist",
    {
      title: "Add a checklist to a Wanderlog trip",
      description: addChecklistDescription,
      inputSchema: addChecklistInputSchema,
      annotations: { destructiveHint: false },
    },
    requireAuth(ctx, async (args) => addChecklist(ctx, args as Parameters<typeof addChecklist>[1])),
  );

  server.registerTool(
    "wanderlog_annotate_place",
    {
      title: "Update a place with notes, times, or both",
      description: annotatePlaceDescription,
      inputSchema: annotatePlaceInputSchema,
    },
    requireAuth(ctx, async (args) =>
      annotatePlace(ctx, args as Parameters<typeof annotatePlace>[1]),
    ),
  );

  server.registerTool(
    "wanderlog_add_expense",
    {
      title: "Add a budget expense to a Wanderlog trip",
      description: addExpenseDescription,
      inputSchema: addExpenseInputSchema,
      annotations: { destructiveHint: false },
    },
    requireAuth(ctx, async (args) => addExpense(ctx, args as Parameters<typeof addExpense>[1])),
  );

  server.registerTool(
    "wanderlog_list_expenses",
    {
      title: "List budget expenses on a Wanderlog trip",
      description: listExpensesDescription,
      inputSchema: listExpensesInputSchema,
      annotations: { readOnlyHint: true },
    },
    requireAuth(ctx, async (args) => listExpenses(ctx, args as Parameters<typeof listExpenses>[1])),
  );

  server.registerTool(
    "wanderlog_remove_expense",
    {
      title: "Remove a budget expense from a Wanderlog trip",
      description: removeExpenseDescription,
      inputSchema: removeExpenseInputSchema,
    },
    requireAuth(ctx, async (args) =>
      removeExpense(ctx, args as Parameters<typeof removeExpense>[1]),
    ),
  );

  server.registerTool(
    "wanderlog_edit_expense",
    {
      title: "Edit a budget expense on a Wanderlog trip",
      description: editExpenseDescription,
      inputSchema: editExpenseInputSchema,
    },
    requireAuth(ctx, async (args) => editExpense(ctx, args as Parameters<typeof editExpense>[1])),
  );

  server.registerTool(
    "wanderlog_remove_place",
    {
      title: "Remove a place from a Wanderlog trip",
      description: removePlaceDescription,
      inputSchema: removePlaceInputSchema,
    },
    requireAuth(ctx, async (args) => removePlace(ctx, args as Parameters<typeof removePlace>[1])),
  );

  server.registerTool(
    "wanderlog_move_block",
    {
      title: "Move a block within its itinerary section",
      description: moveBlockDescription,
      inputSchema: moveBlockInputSchema,
    },
    requireAuth(ctx, async (args) => moveBlock(ctx, args as Parameters<typeof moveBlock>[1])),
  );

  server.registerTool(
    "wanderlog_edit_note",
    {
      title: "Edit note content in a Wanderlog trip",
      description: editNoteDescription,
      inputSchema: editNoteInputSchema,
    },
    requireAuth(ctx, async (args) => editNote(ctx, args as Parameters<typeof editNote>[1])),
  );

  server.registerTool(
    "wanderlog_remove_note",
    {
      title: "Remove a note from a Wanderlog trip",
      description: removeNoteDescription,
      inputSchema: removeNoteInputSchema,
    },
    requireAuth(ctx, async (args) => removeNote(ctx, args as Parameters<typeof removeNote>[1])),
  );

  server.registerTool(
    "wanderlog_update_trip_dates",
    {
      title: "Update a Wanderlog trip's date range",
      description: updateTripDatesDescription,
      inputSchema: updateTripDatesInputSchema,
    },
    requireAuth(ctx, async (args) =>
      updateTripDates(ctx, args as Parameters<typeof updateTripDates>[1]),
    ),
  );

  server.registerTool(
    "wanderlog_rename_day",
    {
      title: "Rename a day heading in a Wanderlog trip",
      description: renameDayDescription,
      inputSchema: renameDayInputSchema,
      annotations: { idempotentHint: true },
    },
    requireAuth(ctx, async (args) => renameDay(ctx, args as Parameters<typeof renameDay>[1])),
  );

  server.registerTool(
    "wanderlog_list_journal",
    {
      title: "List journal stops in a Wanderlog trip",
      description: listJournalDescription,
      inputSchema: listJournalInputSchema,
      annotations: { readOnlyHint: true },
    },
    requireAuth(ctx, async (args) => listJournal(ctx, args as Parameters<typeof listJournal>[1])),
  );

  server.registerTool(
    "wanderlog_add_journal",
    {
      title: "Add a journal stop to a Wanderlog trip",
      description: addJournalDescription,
      inputSchema: addJournalInputSchema,
      annotations: { destructiveHint: false },
    },
    requireAuth(ctx, async (args) => addJournal(ctx, args as Parameters<typeof addJournal>[1])),
  );

  server.registerTool(
    "wanderlog_edit_journal",
    {
      title: "Edit a journal stop or summary in a Wanderlog trip",
      description: editJournalDescription,
      inputSchema: editJournalInputSchema,
    },
    requireAuth(ctx, async (args) => editJournal(ctx, args as Parameters<typeof editJournal>[1])),
  );

  server.registerTool(
    "wanderlog_remove_journal",
    {
      title: "Remove a journal stop from a Wanderlog trip",
      description: removeJournalDescription,
      inputSchema: removeJournalInputSchema,
    },
    requireAuth(ctx, async (args) =>
      removeJournal(ctx, args as Parameters<typeof removeJournal>[1]),
    ),
  );

  server.registerTool(
    "wanderlog_add_section",
    {
      title: "Add a custom section to a Wanderlog trip",
      description: addSectionDescription,
      inputSchema: addSectionInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    requireAuth(ctx, async (args) => addSection(ctx, args as Parameters<typeof addSection>[1])),
  );

  server.registerTool(
    "wanderlog_update_section",
    {
      title: "Rename a custom section in a Wanderlog trip",
      description: updateSectionDescription,
      inputSchema: updateSectionInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    requireAuth(ctx, async (args) =>
      updateSection(ctx, args as Parameters<typeof updateSection>[1]),
    ),
  );

  server.registerTool(
    "wanderlog_delete_section",
    {
      title: "Delete a custom section from a Wanderlog trip",
      description: deleteSectionDescription,
      inputSchema: deleteSectionInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    requireAuth(ctx, async (args) =>
      deleteSection(ctx, args as Parameters<typeof deleteSection>[1]),
    ),
  );

  server.registerTool(
    "wanderlog_add_transit",
    {
      title: "Add a ferry, bus, or train leg",
      description: addTransitDescription,
      inputSchema: addTransitInputSchema,
      annotations: { destructiveHint: false },
    },
    requireAuth(ctx, async (args) => addTransit(ctx, args as Parameters<typeof addTransit>[1])),
  );

  server.registerTool(
    "wanderlog_add_car_rental",
    {
      title: "Add a rental car",
      description: addCarRentalDescription,
      inputSchema: addCarRentalInputSchema,
      annotations: { destructiveHint: false },
    },
    requireAuth(ctx, async (args) => addCarRental(ctx, args as Parameters<typeof addCarRental>[1])),
  );

  return server;
}
