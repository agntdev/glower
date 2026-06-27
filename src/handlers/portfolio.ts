import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { listPortfolio } from "../store.js";

registerMainMenuItem({ label: "📸 Portfolio", data: "portfolio:list", order: 30 });

const composer = new Composer<Ctx>();

const backToMenu = () => inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]);

composer.callbackQuery("portfolio:list", async (ctx) => {
  await ctx.answerCallbackQuery();
  const items = await listPortfolio();
  if (items.length === 0) {
    await ctx.editMessageText(
      "📸 Portfolio coming soon.\nCheck back after your first booking!",
      { reply_markup: backToMenu() },
    );
    return;
  }
  // Send the first image as its own message (so it actually renders with caption)
  // then a follow-up text-only index with the rest as inline buttons.
  const [first, ...rest] = items;
  await ctx.editMessageText("📸 Portfolio\n\nTap an item to view it.");
  if (first) {
    await ctx.replyWithPhoto(first.imageFileId, {
      caption: first.caption || undefined,
      reply_markup: inlineKeyboard([
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    });
  }
  if (rest.length > 0) {
    const rows = rest.map((p) => [
      inlineButton(`🖼 ${p.caption || "Untitled"}`, `portfolio:view:${p.id}`),
    ]);
    rows.push([inlineButton("⬅️ Back to menu", "menu:main")]);
    await ctx.reply("More from the studio:", { reply_markup: inlineKeyboard(rows) });
  }
});

composer.callbackQuery(/^portfolio:view:([A-Za-z0-9_-]+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const id = ctx.match![1]!;
  const items = await listPortfolio();
  const p = items.find((x) => x.id === id);
  if (!p) {
    await ctx.editMessageText("That portfolio item is no longer available.", {
      reply_markup: backToMenu(),
    });
    return;
  }
  await ctx.replyWithPhoto(p.imageFileId, {
    caption: p.caption || undefined,
    reply_markup: inlineKeyboard([
      [inlineButton("⬅️ Back to menu", "menu:main")],
    ]),
  });
});

export default composer;