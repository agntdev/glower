import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { listBookingsForUser, listServices } from "../store.js";
import { formatBookingLine } from "../format.js";

registerMainMenuItem({ label: "📖 My bookings", data: "bookings:history", order: 50 });

const composer = new Composer<Ctx>();

const backToMenu = () => inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]);

composer.callbackQuery("bookings:history", async (ctx) => {
  await ctx.answerCallbackQuery();
  const me = ctx.from?.id;
  if (!me) {
    await ctx.editMessageText("Could not detect your account. Try /start.", {
      reply_markup: backToMenu(),
    });
    return;
  }
  const [bookings, services] = await Promise.all([
    listBookingsForUser(me),
    listServices(),
  ]);
  const svcMap = new Map(services.map((s) => [s.id, s] as const));
  if (bookings.length === 0) {
    await ctx.editMessageText(
      "📖 No bookings yet — tap 📅 Book service to schedule your first visit!",
      { reply_markup: backToMenu() },
    );
    return;
  }
  const body = bookings.map((b) => formatBookingLine(b, svcMap)).join("\n");
  await ctx.editMessageText(`📖 Your bookings\n\n${body}`, {
    reply_markup: backToMenu(),
  });
});

export default composer;