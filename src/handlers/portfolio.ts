import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { listPortfolio, listServices } from "../store.js";

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
  const services = await listServices();
  const svcName = new Map(services.map((s) => [s.id, s.name] as const));

  // Group items by service tag; items with no tags go under "Other".
  const groups = new Map<string, typeof items>();
  for (const item of items) {
    const tags = item.serviceTags.length > 0 ? item.serviceTags : ["Other"];
    for (const tag of tags) {
      const key = svcName.get(tag) ?? tag;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    }
  }

  let body = "📸 Portfolio\n\n";
  for (const [group, groupItems] of groups) {
    body += `▸ ${group}\n`;
    body += groupItems.map((p) => `  • ${p.caption || "Untitled"}`).join("\n") + "\n\n";
  }

  // Build buttons for viewing individual items.
  const rows: ReturnType<typeof inlineButton>[][] = [];
  for (const item of items.slice(0, 10)) {
    rows.push([inlineButton(`🖼 ${item.caption || "Untitled"}`, `portfolio:view:${item.id}`)]);
  }
  rows.push([inlineButton("⬅️ Back to menu", "menu:main")]);
  await ctx.editMessageText(body, { reply_markup: inlineKeyboard(rows) });

  // Send first photo inline when viewing the gallery.
  const first = items[0];
  if (first) {
    await ctx.replyWithPhoto(first.imageFileId, {
      caption: first.caption || undefined,
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
    });
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