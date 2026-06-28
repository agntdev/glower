import { Composer } from "grammy";
import { readdirSync } from "node:fs";
import { createBot, type BotContext } from "./toolkit/index.js";
import { _resetStoreForTests } from "./store.js";

// The per-chat session shape (ephemeral conversation state only). Durable
// domain data (services, bookings, reviews, etc.) lives in src/store.ts; the
// session carries only multi-step FSM state for flows in progress.
export interface BookingFlow {
  step: "service" | "staff" | "slot" | "name" | "phone" | "confirm";
  serviceId?: string;
  staffId?: string;
  datetime?: string;
  name?: string;
  phone?: string;
}

export interface ReviewFlow {
  step: "rating" | "text" | "photos";
  bookingId?: string;
  rating?: number;
  text?: string;
  /** Buffered photo file_ids awaiting the "Done" tap. */
  photoFileIds: string[];
}

export interface AdminFlow {
  step:
    | "menu"
    | "admin_new_id"
    | "service_name"
    | "service_desc"
    | "service_price"
    | "service_duration"
    | "service_edit_field"
    | "staff_name"
    | "staff_specialties"
    | "portfolio_caption"
    | "portfolio_tags"
    | "review_response_text"
    | "settings_start_hour"
    | "settings_end_hour"
    | "settings_slot_minutes"
    | "settings_horizon_days"
    | "settings_timezone";
  editingServiceId?: string;
  pendingService?: { name?: string; description?: string; priceCents?: number; durationMinutes?: number };
  pendingStaff?: { name?: string; specialties?: string[] };
  pendingPortfolio?: { caption?: string; serviceTags?: string[]; imageFileId?: string };
  pendingReviewId?: string;
}

export interface Session {
  booking?: BookingFlow;
  review?: ReviewFlow;
  admin?: AdminFlow;
}

export type Ctx = BotContext<Session>;

/**
 * buildBot — assembles the bot, AUTO-LOADS every feature handler from
 * src/handlers/, then registers the global fallback. Does NOT start the bot.
 * Add a feature by creating src/handlers/<name>.ts that default-exports a grammY
 * Composer — NEVER edit this file (concurrent feature PRs would conflict).
 */
export async function buildBot(token: string) {
  // Each bot build gets a fresh domain store. In production this is a no-op
  // (buildBot is called once per process); in the test harness each spec gets
  // a fresh bot, so the in-memory store starts empty — without this reset the
  // domain store leaks state across specs and trips overlap/seed logic.
  _resetStoreForTests();
  const bot = createBot<Session>(token, {
    initial: () => ({}),
  });

  const dir = new URL("./handlers/", import.meta.url);
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter(
      (f) =>
        (f.endsWith(".js") || f.endsWith(".ts")) &&
        !f.endsWith(".d.ts") &&
        !f.includes(".test.") &&
        !f.includes(".spec."),
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    files = []; // no handlers/ dir yet → nothing to load
  }
  for (const file of files.sort()) {
    const mod = (await import(new URL(file, dir).href)) as { default?: Composer<Ctx> };
    if (!mod.default) {
      throw new Error(`handler ${file} must default-export a grammY Composer`);
    }
    bot.use(mod.default);
  }

  bot.on("message", (ctx) => ctx.reply("Sorry, I didn't understand that. Try /help."));

  return bot;
}
