import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
  registerMainMenuItem,
} from "../toolkit/index.js";
import {
  getReview,
  listBookingsForUser,
  listReviews,
  newId,
  saveReview,
} from "../store.js";

registerMainMenuItem({ label: "⭐ Reviews", data: "reviews:list", order: 40 });

const composer = new Composer<Ctx>();

const backToMenu = () => inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]);

composer.callbackQuery("reviews:list", async (ctx) => {
  await ctx.answerCallbackQuery();
  const all = await listReviews();
  const me = ctx.from?.id;
  const mine = me ? all.filter((r) => r.telegramId === me) : [];

  // Build header. If user has any completed bookings without a review yet, the
  // first row offers to leave one — that's how the post-appointment review
  // prompt surfaces in the UI (the 1-hour delay is a runtime concern; here we
  // expose the action whenever a completed booking has no review).
  let header = "⭐ Reviews\n\n";
  let rows: ReturnType<typeof inlineButton>[][] = [];
  if (me) {
    const myBookings = await listBookingsForUser(me);
    const completed = myBookings.filter((b) => b.status === "completed");
    const reviewedBookingIds = new Set(mine.map((r) => r.bookingId));
    const pending = completed.filter((b) => !reviewedBookingIds.has(b.id));
    if (pending.length > 0) {
      header += "You have completed bookings awaiting a review:\n";
      for (const b of pending.slice(0, 3)) {
        rows.push([
          inlineButton(`✍️ Review booking`, `review:start:${b.id}`),
        ]);
      }
      header += "\n";
    }
  }

  if (all.length === 0) {
    header += "No reviews yet — be the first!";
    rows.push([inlineButton("⬅️ Back to menu", "menu:main")]);
    await ctx.editMessageText(header, { reply_markup: inlineKeyboard(rows) });
    return;
  }

  header += all
    .slice(0, 5)
    .map((r) => {
      const stars = "⭐".repeat(r.rating);
      const photoCount = r.photoFileIds.length;
      const tail = photoCount > 0 ? ` · ${photoCount} 📷` : "";
      const adminLine = r.adminResponse ? `\n   💬 ${r.adminResponse}` : "";
      return `${stars} ${r.text || "(no text)"}${tail}${adminLine}`;
    })
    .join("\n\n");

  rows.push([inlineButton("📄 Show more reviews", "reviews:list")]);
  rows.push([inlineButton("⬅️ Back to menu", "menu:main")]);
  await ctx.editMessageText(header, { reply_markup: inlineKeyboard(rows) });
});

// ── Submit flow ──────────────────────────────────────────────────────────────

composer.callbackQuery(/^review:start:([A-Za-z0-9_-]+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const bookingId = ctx.match![1]!;
  const me = ctx.from?.id;
  if (!me) {
    await ctx.editMessageText("Could not detect your account. Try /start.", {
      reply_markup: backToMenu(),
    });
    return;
  }
  const bookings = await listBookingsForUser(me);
  const b = bookings.find((x) => x.id === bookingId);
  if (!b || b.status !== "completed") {
    await ctx.editMessageText("That booking isn't ready for a review yet.", {
      reply_markup: backToMenu(),
    });
    return;
  }
  ctx.session.review = { step: "rating", bookingId, photoFileIds: [] };
  await ctx.editMessageText(
    "⭐ How would you rate your appointment?\n\nTap a number:",
    {
      reply_markup: inlineKeyboard([
        [
          inlineButton("1", "review:rate:1"),
          inlineButton("2", "review:rate:2"),
          inlineButton("3", "review:rate:3"),
          inlineButton("4", "review:rate:4"),
          inlineButton("5", "review:rate:5"),
        ],
        [inlineButton("⬅️ Cancel", "review:cancel")],
      ]),
    },
  );
});

composer.callbackQuery(/^review:rate:([1-5])$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const flow = ctx.session.review;
  if (!flow || flow.step !== "rating") return;
  flow.rating = Number(ctx.match![1]);
  flow.step = "text";
  ctx.session.review = flow;
  await ctx.editMessageText(
    "✍️ Tell us about your experience (or tap Skip):",
    {
      reply_markup: inlineKeyboard([
        [inlineButton("⏭ Skip text", "review:skip-text")],
        [inlineButton("⬅️ Cancel", "review:cancel")],
      ]),
    },
  );
});

composer.callbackQuery("review:skip-text", async (ctx) => {
  await ctx.answerCallbackQuery();
  const flow = ctx.session.review;
  if (!flow) return;
  flow.text = "";
  flow.step = "photos";
  ctx.session.review = flow;
  await ctx.editMessageText(
    "📷 Send one or more photos of your result, then tap Done.",
    {
      reply_markup: inlineKeyboard([
        [inlineButton("✅ Done", "review:done")],
        [inlineButton("⏭ Skip photos", "review:skip-photos")],
        [inlineButton("⬅️ Cancel", "review:cancel")],
      ]),
    },
  );
});

composer.on("message:photo", async (ctx) => {
  const flow = ctx.session.review;
  if (!flow || flow.step !== "photos") return;
  const photos = ctx.message.photo;
  if (!photos || photos.length === 0) return;
  // Telegram sends multiple sizes; take the largest.
  const largest = photos[photos.length - 1]!;
  flow.photoFileIds.push(largest.file_id);
  ctx.session.review = flow;
  await ctx.reply(
    `📷 Photo added (${flow.photoFileIds.length}). Send more, or tap Done.`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("✅ Done", "review:done")],
        [inlineButton("⏭ Skip photos", "review:skip-photos")],
      ]),
    },
  );
});

composer.callbackQuery("review:done", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("📷 Add photos or tap Skip photos.");
});

composer.callbackQuery("review:skip-photos", async (ctx) => {
  await ctx.answerCallbackQuery();
  await submitReview(ctx);
});

composer.callbackQuery("review:cancel", async (ctx) => {
  await ctx.answerCallbackQuery();
  delete ctx.session.review;
  await ctx.editMessageText("Review cancelled.", { reply_markup: backToMenu() });
});

async function submitReview(ctx: Ctx): Promise<void> {
  const flow = ctx.session.review;
  if (!flow || !flow.bookingId || !flow.rating) {
    await ctx.editMessageText("Review incomplete. Try again.", {
      reply_markup: backToMenu(),
    });
    return;
  }
  const me = ctx.from?.id;
  if (!me) return;
  const review = {
    id: newId(),
    telegramId: me,
    bookingId: flow.bookingId,
    rating: flow.rating,
    text: flow.text ?? "",
    photoFileIds: flow.photoFileIds,
    createdAt: Date.now(),
  };
  await saveReview(review);
  delete ctx.session.review;
  await ctx.editMessageText(
    "✅ Thanks for your review!",
    { reply_markup: backToMenu() },
  );
  // Notify admins so they can respond from the Reviews admin view.
  const { notifyAdmins } = await import("../notify.js");
  await notifyAdmins(
    ctx,
    `⭐ New review (${review.rating}/5)\n${review.text || "(no text)"}${review.photoFileIds.length ? ` · ${review.photoFileIds.length} 📷` : ""}`,
  );
}

// ── Free-text review step ────────────────────────────────────────────────────

composer.on("message:text", async (ctx, next) => {
  const flow = ctx.session.review;
  if (!flow || flow.step !== "text") return next();
  flow.text = ctx.message.text;
  flow.step = "photos";
  ctx.session.review = flow;
  await ctx.reply(
    "📷 Send one or more photos of your result, then tap Done.",
    {
      reply_markup: inlineKeyboard([
        [inlineButton("✅ Done", "review:done")],
        [inlineButton("⏭ Skip photos", "review:skip-photos")],
        [inlineButton("⬅️ Cancel", "review:cancel")],
      ]),
    },
  );
});

// Helper used by the admin handler to acknowledge a new review.
export async function formatReviewSummary(reviewId: string): Promise<string> {
  const r = await getReview(reviewId);
  if (!r) return "(review gone)";
  return `⭐ ${"★".repeat(r.rating)} ${r.text || "(no text)"}`;
}

export default composer;