import { buildBot } from "./bot.js";
import { setDefaultCommands } from "./toolkit/index.js";
import { addAdmin } from "./store.js";
import { scheduleStaleReviewPrompts } from "./handlers/reviews.js";

/** Seed admins from ADMIN_TELEGRAM_IDS (comma-separated numeric Telegram IDs).
 *  Idempotent — runs once at startup, harmless duplicate calls. */
async function seedAdmins(): Promise<void> {
  const raw = process.env.ADMIN_TELEGRAM_IDS;
  if (!raw) return;
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  for (const id of ids) {
    await addAdmin(id);
  }
}

async function main() {
  const token = process.env.BOT_TOKEN;
  if (!token) {
    console.error("BOT_TOKEN is required");
    process.exit(1);
  }
  await seedAdmins();
  const bot = await buildBot(token);
  // Schedule review prompts for any completed bookings whose 1-hour window
  // has already elapsed while the bot was offline.
  scheduleStaleReviewPrompts(bot.api);
  // Publish the "/" command list to Telegram (discoverability). A button-first
  // bot exposes only /start + /help; everything else is reached via menu buttons.
  await setDefaultCommands(bot);
  bot.start();
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
