import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
  registerMainMenuItem,
} from "../toolkit/index.js";
import { listServices } from "../store.js";
import { formatServiceLine } from "../format.js";

registerMainMenuItem({ label: "💅 Services", data: "services:list", order: 10 });

const composer = new Composer<Ctx>();

const backToMenu = () => inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]);

composer.callbackQuery("services:list", async (ctx) => {
  await ctx.answerCallbackQuery();
  const services = await listServices();
  if (services.length === 0) {
    await ctx.editMessageText(
      "💅 No services yet.\nThe studio is setting up — check back soon!",
      { reply_markup: backToMenu() },
    );
    return;
  }
  const body = services.map(formatServiceLine).join("\n");
  const rows = services.map((s) => [
    inlineButton(`🔍 ${s.name}`, `services:detail:${encodeURIComponent(s.name)}`),
  ]);
  rows.push([inlineButton("⬅️ Back to menu", "menu:main")]);
  await ctx.editMessageText(`💅 Our services\n\n${body}`, {
    reply_markup: inlineKeyboard(rows),
  });
});

composer.callbackQuery(/^services:detail:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const name = decodeURIComponent(ctx.match![1]!);
  const services = await listServices();
  const s = services.find((x) => x.name === name);
  if (!s) {
    await ctx.editMessageText("That service is no longer available.", {
      reply_markup: backToMenu(),
    });
    return;
  }
  await ctx.editMessageText(
    `💅 ${s.name}\n\n${s.description}\n\nPrice: $${(s.priceCents / 100).toFixed(2)} · Duration: ${s.durationMinutes} min`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("📅 Book this service", `booking:start:${encodeURIComponent(s.name)}`)],
        [inlineButton("⬅️ Back to services", "services:list")],
      ]),
    },
  );
});

export default composer;