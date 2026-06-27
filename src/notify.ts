// Admin notification helper — used by booking + reviews handlers to alert the
// studio's admin(s) about new activity. The admin list lives in the persistent
// store (see store.ts). Errors are swallowed: a notification failure must not
// break the user-facing flow that triggered it.

import type { Ctx } from "./bot.js";
import { listAdmins } from "./store.js";

/** Send `text` to every admin in the store. Awaited so callers know when the
 *  fan-out finishes; per-recipient errors are logged but don't abort the rest. */
export async function notifyAdmins(ctx: Ctx, text: string): Promise<void> {
  const ids = await listAdmins();
  if (ids.length === 0) return;
  await Promise.all(
    ids.map(async (id) => {
      try {
        await ctx.api.sendMessage(id, text);
      } catch (err) {
        // Logged for ops visibility; never rethrown — a notification failure
        // shouldn't fail the user-facing action that triggered it.
        console.error("[notify] failed to reach admin", id, err);
      }
    }),
  );
}