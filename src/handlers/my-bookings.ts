import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { getBooking, getService, getStaff, listBookingsForUser, listServices } from "../store.js";
import { formatBookingLine, formatPrice } from "../format.js";

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
  const rows = bookings.map((b) => [
    inlineButton(
      `📅 ${new Date(b.datetime).toISOString().slice(0, 10)} — ${svcMap.get(b.serviceId)?.name ?? "?"}`,
      `bookings:detail:${b.id}`,
    ),
  ]);
  rows.push([inlineButton("⬅️ Back to menu", "menu:main")]);
  await ctx.editMessageText(`📖 Your bookings\n\n${body}`, {
    reply_markup: inlineKeyboard(rows),
  });
});

composer.callbackQuery(/^bookings:detail:([A-Za-z0-9_-]+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const me = ctx.from?.id;
  if (!me) return;
  const id = ctx.match![1]!;
  const [b, services] = await Promise.all([getBooking(id), listServices()]);
  if (!b || b.telegramId !== me) {
    await ctx.editMessageText("Booking not found.", {
      reply_markup: backToMenu(),
    });
    return;
  }
  const svc = services.find((s) => s.id === b.serviceId);
  const svcName = svc?.name ?? "(deleted)";
  const price = svc ? formatPrice(svc.priceCents) : "?";
  const duration = svc ? `${svc.durationMinutes} min` : "?";
  const staff = b.staffId
    ? (await getStaff(b.staffId))?.name ?? "(unknown)"
    : "No preference";
  const when = new Date(b.datetime).toISOString().replace("T", " ").slice(0, 16);
  const status =
    b.status === "confirmed" ? "🟢 Confirmed" : b.status === "completed" ? "✅ Completed" : "⚪ Cancelled";

  const detail =
    `📅 Booking detail\n\n` +
    `Service: ${svcName}\n` +
    `Price: ${price} · Duration: ${duration}\n` +
    `Staff: ${staff}\n` +
    `When: ${when}\n` +
    `Status: ${status}\n` +
    `Name: ${b.clientName}\n` +
    `Phone: ${b.clientPhone}`;

  await ctx.editMessageText(detail, {
    reply_markup: inlineKeyboard([
      [inlineButton("⬅️ Back to bookings", "bookings:history")],
    ]),
  });
});

export default composer;