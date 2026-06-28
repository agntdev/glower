import { Composer, InputFile } from "grammy";
import type { AdminFlow, Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
} from "../toolkit/index.js";
import {
  addAdmin,
  deletePortfolioItem,
  deleteService,
  deleteStaff,
  getBooking,
  getReview,
  getSettings,
  hasOverlap,
  isAdmin,
  listAdmins,
  listBookings,
  listPortfolio,
  listReviews,
  listServices,
  listStaff,
  newId,
  removeAdmin,
  saveBooking,
  savePortfolioItem,
  saveService,
  saveSettings,
  saveStaff,
  updateReview,
} from "../store.js";
import { csvEscape, formatBookingLine, formatPrice, formatServiceDetail } from "../format.js";

const composer = new Composer<Ctx>();

const backToMenu = () => inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]);

const backToAdmin = () =>
  inlineKeyboard([[inlineButton("⬅️ Back to admin", "admin:menu")]]);

// ── /admin entry + ownership claim ──────────────────────────────────────────

composer.command("admin", async (ctx) => {
  const me = ctx.from?.id;
  if (!me) return;
  const admins = await listAdmins();
  if (admins.length === 0) {
    // Bootstrap: when no admin exists, let the first invoker claim ownership.
    // Subsequent calls also work — the claim button remains available until an
    // admin is set.
    await ctx.reply(
      "🔐 No admin set yet.\n\nTap below to claim owner access. Once set, " +
        "you can add more admins from the admin menu.",
      {
        reply_markup: inlineKeyboard([
          [inlineButton("🔐 Claim owner access", "admin:claim")],
          [inlineButton("⬅️ Back to menu", "menu:main")],
        ]),
      },
    );
    return;
  }
  if (!(await isAdmin(me))) {
    await ctx.reply("🔐 You're not authorized for admin tools.", {
      reply_markup: backToMenu(),
    });
    return;
  }
  await renderAdminMenu(ctx);
});

composer.callbackQuery("admin:claim", async (ctx) => {
  await ctx.answerCallbackQuery();
  const me = ctx.from?.id;
  if (!me) return;
  const admins = await listAdmins();
  if (admins.length > 0) {
    await ctx.editMessageText("🔐 Admin already exists.", {
      reply_markup: backToMenu(),
    });
    return;
  }
  await addAdmin(me);
  await ctx.editMessageText("🔐 You're now the owner.", {
    reply_markup: backToAdmin(),
  });
});

async function renderAdminMenu(ctx: Ctx): Promise<void> {
  await ctx.reply(
    "🛠 Admin menu\n\nPick what to manage:",
    {
      reply_markup: inlineKeyboard([
        [inlineButton("💅 Services", "admin:services")],
        [inlineButton("👤 Staff", "admin:staff")],
        [inlineButton("📸 Portfolio", "admin:portfolio")],
        [inlineButton("⭐ Reviews", "admin:reviews")],
        [inlineButton("📅 Bookings", "admin:bookings")],
        [inlineButton("🔐 Admins", "admin:admins")],
        [inlineButton("⚙ Settings", "admin:settings")],
        [inlineButton("📤 Export bookings CSV", "admin:export")],
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    },
  );
}

composer.callbackQuery("admin:menu", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await isAdmin(ctx.from?.id ?? 0))) return;
  await renderAdminMenu(ctx);
});

// ── Services CRUD ─────────────────────────────────────────────────────────────

composer.callbackQuery("admin:services", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await isAdmin(ctx.from?.id ?? 0))) return;
  const services = await listServices();
  const rows = services.map((s) => [
    inlineButton(`✏️ ${s.name}`, `admin:service-edit:${encodeURIComponent(s.name)}`),
  ]);
  rows.push([inlineButton("➕ Add service", "admin:service-new")]);
  rows.push([inlineButton("⬅️ Back to admin", "admin:menu")]);
  const body =
    services.length === 0
      ? "No services yet."
      : services.map(formatServiceDetail).join("\n\n");
  await ctx.editMessageText(`💅 Services\n\n${body}`, {
    reply_markup: inlineKeyboard(rows),
  });
});

composer.callbackQuery("admin:service-new", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await isAdmin(ctx.from?.id ?? 0))) return;
  ctx.session.admin = { step: "service_name", pendingService: {} };
  await ctx.editMessageText(
    "💅 New service\n\nSend the service name:",
    { reply_markup: inlineKeyboard([[inlineButton("⬅️ Cancel", "admin:cancel-flow")]]) },
  );
});

composer.on("message:text", async (ctx, next) => {
  const flow = ctx.session.admin;
  if (!flow) return next();
  const me = ctx.from?.id;
  if (!me || !(await isAdmin(me))) return next();
  const text = ctx.message.text.trim();

  if (flow.step === "admin_new_id") {
    const id = Number(text);
    if (!Number.isInteger(id) || id <= 0) {
      await ctx.reply("Send a valid numeric Telegram ID.");
      return;
    }
    await addAdmin(id);
    delete ctx.session.admin;
    await ctx.reply(`🔐 Added admin ${id}.`, { reply_markup: backToAdmin() });
    return;
  }
  if (flow.step === "service_name") {
    if (text.length === 0 || text.length > 80) {
      await ctx.reply("Name must be 1–80 characters.");
      return;
    }
    flow.pendingService = { ...flow.pendingService, name: text };
    flow.step = "service_desc";
    ctx.session.admin = flow;
    await ctx.reply("📝 Send the description:");
    return;
  }
  if (flow.step === "service_desc") {
    if (text.length === 0 || text.length > 500) {
      await ctx.reply("Description must be 1–500 characters.");
      return;
    }
    flow.pendingService = { ...flow.pendingService, description: text };
    flow.step = "service_price";
    ctx.session.admin = flow;
    await ctx.reply("💵 Send the price in dollars (e.g. 49.99):");
    return;
  }
  if (flow.step === "service_price") {
    const dollars = Number(text.replace(/[$,\s]/g, ""));
    if (!Number.isFinite(dollars) || dollars < 0 || dollars > 100000) {
      await ctx.reply("Send a number between 0 and 100000.");
      return;
    }
    flow.pendingService = { ...flow.pendingService, priceCents: Math.round(dollars * 100) };
    flow.step = "service_duration";
    ctx.session.admin = flow;
    await ctx.reply("⏱ Send the duration in minutes (e.g. 60):");
    return;
  }
  if (flow.step === "service_duration") {
    const mins = Number(text);
    if (!Number.isInteger(mins) || mins < 5 || mins > 480) {
      await ctx.reply("Send an integer between 5 and 480.");
      return;
    }
    const ps = flow.pendingService ?? {};
    if (!ps.name || !ps.description || ps.priceCents === undefined) return;
    const svc = {
      id: newId(),
      name: ps.name,
      description: ps.description,
      priceCents: ps.priceCents,
      durationMinutes: mins,
    };
    await saveService(svc);
    delete ctx.session.admin;
    await ctx.reply(
      `✅ Added “${svc.name}” — ${formatPrice(svc.priceCents)}, ${svc.durationMinutes} min.`,
      { reply_markup: backToAdmin() },
    );
    return;
  }
  if (flow.step === "staff_name") {
    if (text.length === 0 || text.length > 80) {
      await ctx.reply("Name must be 1–80 characters.");
      return;
    }
    flow.pendingStaff = { ...flow.pendingStaff, name: text };
    flow.step = "staff_specialties";
    ctx.session.admin = flow;
    const services = await listServices();
    await ctx.reply(
      `👤 Send the service ids this staff member can perform, separated by commas.\n\n` +
        `Available ids:\n${services.map((s) => `• ${s.id} — ${s.name}`).join("\n") || "(none)"}\n\n` +
        `Or send "all" for any service.`,
    );
    return;
  }
  if (flow.step === "staff_specialties") {
    const services = await listServices();
    const ids = new Set(services.map((s) => s.id));
    let specialties: string[];
    if (text.toLowerCase() === "all") {
      specialties = [];
    } else {
      specialties = text
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const bad = specialties.filter((id) => !ids.has(id));
      if (bad.length > 0) {
        await ctx.reply(`Unknown service id(s): ${bad.join(", ")}. Try again.`);
        return;
      }
    }
    const ps = flow.pendingStaff ?? {};
    if (!ps.name) return;
    const staff = { id: newId(), name: ps.name, specialties };
    await saveStaff(staff);
    delete ctx.session.admin;
    await ctx.reply(
      `✅ Added staff “${staff.name}” (specialties: ${specialties.length === 0 ? "any" : specialties.join(", ")}).`,
      { reply_markup: backToAdmin() },
    );
    return;
  }
  if (flow.step === "portfolio_caption") {
    if (text.length > 200) {
      await ctx.reply("Caption must be 200 characters or fewer.");
      return;
    }
    flow.pendingPortfolio = { ...flow.pendingPortfolio, caption: text };
    flow.step = "portfolio_tags";
    ctx.session.admin = flow;
    const services = await listServices();
    await ctx.reply(
      `🏷 Send the service tags this portfolio item belongs to, separated by commas.\n\n` +
        `Available:\n${services.map((s) => `• ${s.id} — ${s.name}`).join("\n") || "(none)"}\n\n` +
        `Or send "none".`,
    );
    return;
  }
  if (flow.step === "portfolio_tags") {
    const services = await listServices();
    const ids = new Set(services.map((s) => s.id));
    let tags: string[];
    if (text.toLowerCase() === "none") {
      tags = [];
    } else {
      tags = text.split(",").map((s) => s.trim()).filter(Boolean);
      const bad = tags.filter((id) => !ids.has(id));
      if (bad.length > 0) {
        await ctx.reply(`Unknown service id(s): ${bad.join(", ")}. Try again.`);
        return;
      }
    }
    const pp = flow.pendingPortfolio ?? {};
    if (!pp.caption || !pp.imageFileId) return;
    const item = {
      id: newId(),
      imageFileId: pp.imageFileId,
      caption: pp.caption,
      serviceTags: tags,
    };
    await savePortfolioItem(item);
    delete ctx.session.admin;
    await ctx.reply(
      `✅ Added portfolio item “${item.caption}” (tags: ${tags.length === 0 ? "none" : tags.join(", ")}).`,
      { reply_markup: backToAdmin() },
    );
    return;
  }
  if (flow.step === "service_edit_field") {
    const svcId = flow.editingServiceId;
    if (!svcId) return;
    const services = await listServices();
    const svc = services.find((s) => s.id === svcId);
    if (!svc) {
      delete ctx.session.admin;
      await ctx.reply("Service not found.", { reply_markup: backToAdmin() });
      return;
    }
    // The field to edit is stored in pendingService.name as the field key.
    const field = flow.pendingService?.name;
    if (field === "edit_name") {
      if (text.length === 0 || text.length > 80) {
        await ctx.reply("Name must be 1–80 characters.");
        return;
      }
      await saveService({ ...svc, name: text });
      delete ctx.session.admin;
      await ctx.reply(`✅ Renamed to “${text}”.`, { reply_markup: backToAdmin() });
      return;
    }
    if (field === "edit_description") {
      if (text.length === 0 || text.length > 500) {
        await ctx.reply("Description must be 1–500 characters.");
        return;
      }
      await saveService({ ...svc, description: text });
      delete ctx.session.admin;
      await ctx.reply("✅ Description updated.", { reply_markup: backToAdmin() });
      return;
    }
    if (field === "edit_price") {
      const dollars = Number(text.replace(/[$,\s]/g, ""));
      if (!Number.isFinite(dollars) || dollars < 0 || dollars > 100000) {
        await ctx.reply("Send a number between 0 and 100000.");
        return;
      }
      await saveService({ ...svc, priceCents: Math.round(dollars * 100) });
      delete ctx.session.admin;
      await ctx.reply(`✅ Price set to ${formatPrice(Math.round(dollars * 100))}.`, { reply_markup: backToAdmin() });
      return;
    }
    if (field === "edit_duration") {
      const mins = Number(text);
      if (!Number.isInteger(mins) || mins < 5 || mins > 480) {
        await ctx.reply("Send an integer between 5 and 480.");
        return;
      }
      await saveService({ ...svc, durationMinutes: mins });
      delete ctx.session.admin;
      await ctx.reply(`✅ Duration set to ${mins} min.`, { reply_markup: backToAdmin() });
      return;
    }
    return;
  }
  if (flow.step === "review_response_text") {
    if (!flow.pendingReviewId) return;
    if (text.length === 0 || text.length > 500) {
      await ctx.reply("Response must be 1–500 characters.");
      return;
    }
    const r = await getReview(flow.pendingReviewId);
    if (!r) {
      delete ctx.session.admin;
      await ctx.reply("Review not found.", { reply_markup: backToAdmin() });
      return;
    }
    await updateReview({ ...r, adminResponse: text });
    delete ctx.session.admin;
    await ctx.reply("✅ Response posted.", { reply_markup: backToAdmin() });
    return;
  }
  if (flow.step === "settings_start_hour") {
    const h = Number(text);
    if (!Number.isInteger(h) || h < 0 || h > 23) {
      await ctx.reply("Send an integer between 0 and 23.");
      return;
    }
    const s = await getSettings();
    if (h >= s.endHour) {
      await ctx.reply("Start hour must be before end hour. Try again.");
      return;
    }
    await saveSettings({ ...s, startHour: h });
    delete ctx.session.admin;
    await ctx.reply(`✅ Start hour set to ${h}:00.`, { reply_markup: backToAdmin() });
    return;
  }
  if (flow.step === "settings_end_hour") {
    const h = Number(text);
    if (!Number.isInteger(h) || h < 0 || h > 23) {
      await ctx.reply("Send an integer between 0 and 23.");
      return;
    }
    const s = await getSettings();
    if (h <= s.startHour) {
      await ctx.reply("End hour must be after start hour. Try again.");
      return;
    }
    await saveSettings({ ...s, endHour: h });
    delete ctx.session.admin;
    await ctx.reply(`✅ End hour set to ${h}:00.`, { reply_markup: backToAdmin() });
    return;
  }
  if (flow.step === "settings_slot_minutes") {
    const mins = Number(text);
    if (!Number.isInteger(mins) || mins < 5 || mins > 240) {
      await ctx.reply("Send an integer between 5 and 240.");
      return;
    }
    const s = await getSettings();
    await saveSettings({ ...s, slotMinutes: mins });
    delete ctx.session.admin;
    await ctx.reply(`✅ Slot interval set to ${mins} min.`, { reply_markup: backToAdmin() });
    return;
  }
  if (flow.step === "settings_horizon_days") {
    const days = Number(text);
    if (!Number.isInteger(days) || days < 1 || days > 90) {
      await ctx.reply("Send an integer between 1 and 90.");
      return;
    }
    const s = await getSettings();
    await saveSettings({ ...s, horizonDays: days });
    delete ctx.session.admin;
    await ctx.reply(`✅ Booking horizon set to ${days} days.`, { reply_markup: backToAdmin() });
    return;
  }
  if (flow.step === "settings_timezone") {
    const tz = text.trim();
    if (tz.length === 0 || tz.length > 80) {
      await ctx.reply("Send a valid IANA timezone string.");
      return;
    }
    // Basic validation: must contain a / or be "UTC"
    if (!tz.includes("/") && tz !== "UTC") {
      await ctx.reply("Send a valid IANA timezone (e.g. America/New_York, Europe/London, UTC).");
      return;
    }
    const s = await getSettings();
    await saveSettings({ ...s, timezone: tz });
    delete ctx.session.admin;
    await ctx.reply(`✅ Timezone set to ${tz}.`, { reply_markup: backToAdmin() });
    return;
  }
  return next();
});

composer.callbackQuery("admin:cancel-flow", async (ctx) => {
  await ctx.answerCallbackQuery();
  delete ctx.session.admin;
  await ctx.editMessageText("Cancelled.", { reply_markup: backToAdmin() });
});

composer.callbackQuery(/^admin:service-edit:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await isAdmin(ctx.from?.id ?? 0))) return;
  const name = decodeURIComponent(ctx.match![1]!);
  const services = await listServices();
  const svc = services.find((s) => s.name === name);
  if (!svc) {
    await ctx.editMessageText("Service not found.", { reply_markup: backToAdmin() });
    return;
  }
  await ctx.editMessageText(formatServiceDetail(svc), {
    reply_markup: inlineKeyboard([
      [inlineButton("✏️ Edit this service", `admin:service-edit-field:${encodeURIComponent(svc.name)}`)],
      [inlineButton("🗑 Delete service", `admin:service-delete:${encodeURIComponent(svc.name)}`)],
      [inlineButton("⬅️ Back to services", "admin:services")],
    ]),
  });
});

composer.callbackQuery(/^admin:service-edit-field:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await isAdmin(ctx.from?.id ?? 0))) return;
  const name = decodeURIComponent(ctx.match![1]!);
  const services = await listServices();
  const svc = services.find((s) => s.name === name);
  if (!svc) {
    await ctx.editMessageText("Service not found.", { reply_markup: backToAdmin() });
    return;
  }
  await ctx.editMessageText(
    `✏️ Edit “${svc.name}”\n\nPick a field to update:`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("📝 Name", `admin:service-edit-do:${encodeURIComponent(svc.name)}:edit_name`)],
        [inlineButton("📄 Description", `admin:service-edit-do:${encodeURIComponent(svc.name)}:edit_description`)],
        [inlineButton("💵 Price", `admin:service-edit-do:${encodeURIComponent(svc.name)}:edit_price`)],
        [inlineButton("⏱ Duration", `admin:service-edit-do:${encodeURIComponent(svc.name)}:edit_duration`)],
        [inlineButton("⬅️ Back to service", `admin:service-edit:${encodeURIComponent(svc.name)}`)],
      ]),
    },
  );
});

composer.callbackQuery(
  /^admin:service-edit-do:(.+):(edit_name|edit_description|edit_price|edit_duration)$/,
  async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await isAdmin(ctx.from?.id ?? 0))) return;
    const name = decodeURIComponent(ctx.match![1]!);
    const field = ctx.match![2]!;
    const services = await listServices();
    const svc = services.find((s) => s.name === name);
    if (!svc) {
      await ctx.editMessageText("Service not found.", { reply_markup: backToAdmin() });
      return;
    }
    ctx.session.admin = { step: "service_edit_field", editingServiceId: svc.id, pendingService: { name: field } };
    const prompts: Record<string, string> = {
      edit_name: "📝 Send the new name:",
      edit_description: "📄 Send the new description:",
      edit_price: "💵 Send the new price in dollars (e.g. 49.99):",
      edit_duration: "⏱ Send the new duration in minutes (e.g. 60):",
    };
    await ctx.editMessageText(prompts[field] ?? "Send new value:", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Cancel", "admin:cancel-flow")]]),
    });
  },
);

composer.callbackQuery(/^admin:service-delete:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await isAdmin(ctx.from?.id ?? 0))) return;
  const name = decodeURIComponent(ctx.match![1]!);
  const services = await listServices();
  const svc = services.find((s) => s.name === name);
  if (!svc) {
    await ctx.editMessageText("Service not found.", { reply_markup: backToAdmin() });
    return;
  }
  await deleteService(svc.id);
  await ctx.editMessageText("🗑 Service deleted.", {
    reply_markup: backToAdmin(),
  });
});

// ── Staff CRUD ───────────────────────────────────────────────────────────────

composer.callbackQuery("admin:staff", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await isAdmin(ctx.from?.id ?? 0))) return;
  const staff = await listStaff();
  const rows = staff.map((s) => [
    inlineButton(`👤 ${s.name}`, `admin:staff-edit:${encodeURIComponent(s.name)}`),
  ]);
  rows.push([inlineButton("➕ Add staff", "admin:staff-new")]);
  rows.push([inlineButton("⬅️ Back to admin", "admin:menu")]);
  const body =
    staff.length === 0
      ? "No staff yet."
      : staff.map((s) => `• ${s.name} — ${s.specialties.length === 0 ? "any service" : `${s.specialties.length} service(s)`}`).join("\n");
  await ctx.editMessageText(`👤 Staff\n\n${body}`, {
    reply_markup: inlineKeyboard(rows),
  });
});

composer.callbackQuery("admin:staff-new", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await isAdmin(ctx.from?.id ?? 0))) return;
  ctx.session.admin = { step: "staff_name", pendingStaff: {} };
  await ctx.editMessageText("👤 New staff member\n\nSend their name:", {
    reply_markup: inlineKeyboard([[inlineButton("⬅️ Cancel", "admin:cancel-flow")]]),
  });
});

composer.callbackQuery(/^admin:staff-edit:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await isAdmin(ctx.from?.id ?? 0))) return;
  const name = decodeURIComponent(ctx.match![1]!);
  const staff = await listStaff();
  const s = staff.find((x) => x.name === name);
  if (!s) {
    await ctx.editMessageText("Staff not found.", { reply_markup: backToAdmin() });
    return;
  }
  await ctx.editMessageText(
    `👤 ${s.name}\nSpecialties: ${s.specialties.length === 0 ? "any" : s.specialties.join(", ")}`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("🗑 Remove", `admin:staff-delete:${encodeURIComponent(s.name)}`)],
        [inlineButton("⬅️ Back to staff", "admin:staff")],
      ]),
    },
  );
});

composer.callbackQuery(/^admin:staff-delete:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await isAdmin(ctx.from?.id ?? 0))) return;
  const name = decodeURIComponent(ctx.match![1]!);
  const staff = await listStaff();
  const s = staff.find((x) => x.name === name);
  if (!s) {
    await ctx.editMessageText("Staff not found.", { reply_markup: backToAdmin() });
    return;
  }
  await deleteStaff(s.id);
  await ctx.editMessageText("🗑 Staff removed.", { reply_markup: backToAdmin() });
});

// ── Portfolio ────────────────────────────────────────────────────────────────

composer.callbackQuery("admin:portfolio", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await isAdmin(ctx.from?.id ?? 0))) return;
  const items = await listPortfolio();
  const rows: ReturnType<typeof inlineButton>[][] = items.map((p) => [
    inlineButton(`🖼 ${p.caption || "(untitled)"}`, `admin:portfolio-edit:${p.id}`),
  ]);
  rows.push([inlineButton("➕ Add portfolio item", "admin:portfolio-new")]);
  rows.push([inlineButton("⬅️ Back to admin", "admin:menu")]);
  await ctx.editMessageText(
    `📸 Portfolio (${items.length} item${items.length === 1 ? "" : "s"})\n\n` +
      "Tap an item to manage it, or add a new one by sending a photo after tapping Add.",
    { reply_markup: inlineKeyboard(rows) },
  );
});

composer.callbackQuery("admin:portfolio-new", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await isAdmin(ctx.from?.id ?? 0))) return;
  ctx.session.admin = { step: "portfolio_caption", pendingPortfolio: {} };
  await ctx.editMessageText(
    "📸 New portfolio item\n\nSend the photo first (any caption is ignored — you'll be asked for one next).",
    {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Cancel", "admin:cancel-flow")]]),
    },
  );
});

composer.on("message:photo", async (ctx, next) => {
  const flow = ctx.session.admin;
  const me = ctx.from?.id;
  if (!flow || !me || !(await isAdmin(me))) return next();
  if (flow.step !== "portfolio_caption") return next();
  const photos = ctx.message.photo;
  if (!photos || photos.length === 0) return;
  const largest = photos[photos.length - 1]!;
  flow.pendingPortfolio = { ...flow.pendingPortfolio, imageFileId: largest.file_id };
  // Stay on portfolio_caption so the next text input captures the caption;
  // the caption handler advances to portfolio_tags.
  ctx.session.admin = flow;
  await ctx.reply("📝 Photo received. Send a caption (or send “none”):");
});

composer.callbackQuery(/^admin:portfolio-edit:([A-Za-z0-9_-]+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await isAdmin(ctx.from?.id ?? 0))) return;
  const id = ctx.match![1]!;
  const items = await listPortfolio();
  const p = items.find((x) => x.id === id);
  if (!p) {
    await ctx.editMessageText("Portfolio item not found.", { reply_markup: backToAdmin() });
    return;
  }
  await ctx.editMessageText(
    `🖼 ${p.caption || "(untitled)"}\nTags: ${p.serviceTags.join(", ") || "none"}`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("🗑 Delete", `admin:portfolio-delete:${id}`)],
        [inlineButton("⬅️ Back to portfolio", "admin:portfolio")],
      ]),
    },
  );
});

composer.callbackQuery(/^admin:portfolio-delete:([A-Za-z0-9_-]+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await isAdmin(ctx.from?.id ?? 0))) return;
  const id = ctx.match![1]!;
  await deletePortfolioItem(id);
  await ctx.editMessageText("🗑 Portfolio item deleted.", { reply_markup: backToAdmin() });
});

// ── Reviews (respond) ────────────────────────────────────────────────────────

composer.callbackQuery("admin:reviews", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await isAdmin(ctx.from?.id ?? 0))) return;
  const reviews = await listReviews();
  if (reviews.length === 0) {
    await ctx.editMessageText("No reviews yet.", { reply_markup: backToAdmin() });
    return;
  }
  const rows = reviews.slice(0, 10).map((r) => [
    inlineButton(
      `${"★".repeat(r.rating)} ${r.text.slice(0, 30) || "(no text)"}`,
      `admin:review-edit:${r.id}`,
    ),
  ]);
  rows.push([inlineButton("⬅️ Back to admin", "admin:menu")]);
  await ctx.editMessageText("⭐ Reviews\n\nTap to respond.", {
    reply_markup: inlineKeyboard(rows),
  });
});

composer.callbackQuery(/^admin:review-edit:([A-Za-z0-9_-]+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await isAdmin(ctx.from?.id ?? 0))) return;
  const id = ctx.match![1]!;
  const r = await getReview(id);
  if (!r) {
    await ctx.editMessageText("Review not found.", { reply_markup: backToAdmin() });
    return;
  }
  await ctx.editMessageText(
    `⭐ ${"★".repeat(r.rating)}\n${r.text || "(no text)"}\n${r.photoFileIds.length ? `${r.photoFileIds.length} photo(s)` : ""}\n\n` +
      `Response: ${r.adminResponse ?? "(none)"}`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("💬 Respond", `admin:review-respond:${id}`)],
        [inlineButton("⬅️ Back to reviews", "admin:reviews")],
      ]),
    },
  );
});

composer.callbackQuery(/^admin:review-respond:([A-Za-z0-9_-]+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await isAdmin(ctx.from?.id ?? 0))) return;
  const id = ctx.match![1]!;
  ctx.session.admin = { step: "review_response_text", pendingReviewId: id };
  await ctx.editMessageText("💬 Send your response:", {
    reply_markup: inlineKeyboard([[inlineButton("⬅️ Cancel", "admin:cancel-flow")]]),
  });
});

// ── Bookings (mark completed) ────────────────────────────────────────────────

composer.callbackQuery("admin:bookings", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await isAdmin(ctx.from?.id ?? 0))) return;
  const [bookings, services] = await Promise.all([listBookings(), listServices()]);
  const svcMap = new Map(services.map((s) => [s.id, s] as const));
  if (bookings.length === 0) {
    await ctx.editMessageText("No bookings yet.", { reply_markup: backToAdmin() });
    return;
  }
  const upcoming = bookings.filter((b) => b.status === "confirmed").slice(0, 15);
  const rows = upcoming.map((b) => [
    inlineButton(
      `📅 ${new Date(b.datetime).toISOString().slice(0, 10)} — ${svcMap.get(b.serviceId)?.name ?? "?"}`,
      `admin:booking-edit:${b.id}`,
    ),
  ]);
  rows.push([inlineButton("⬅️ Back to admin", "admin:menu")]);
  await ctx.editMessageText(
    "📅 Upcoming bookings\n\n" +
      bookings.slice(0, 10).map((b) => formatBookingLine(b, svcMap)).join("\n"),
    { reply_markup: inlineKeyboard(rows) },
  );
});

composer.callbackQuery("admin:complete-first", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await isAdmin(ctx.from?.id ?? 0))) return;
  const bookings = await listBookings();
  const confirmed = bookings.filter((b) => b.status === "confirmed");
  if (confirmed.length === 0) {
    await ctx.editMessageText("No confirmed bookings to complete.", { reply_markup: backToAdmin() });
    return;
  }
  const b = confirmed[0]!;
  const updated = { ...b, status: "completed" as const, completedAt: Date.now() };
  await saveBooking(updated);
  await ctx.editMessageText(
    `✅ Booking completed.\n\nThe client can now leave a review from the Reviews menu.`,
    { reply_markup: backToAdmin() },
  );
  try {
    await ctx.api.sendMessage(
      b.telegramId,
      `✅ Your booking has been marked completed. You can leave a review from the Reviews menu.`,
    );
  } catch {
    // Non-fatal
  }
  const { pushReviewPrompt } = await import("./reviews.js");
  pushReviewPrompt(ctx.api, b.id);
});

composer.callbackQuery(/^admin:booking-edit:([A-Za-z0-9_-]+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await isAdmin(ctx.from?.id ?? 0))) return;
  const id = ctx.match![1]!;
  const b = await getBooking(id);
  if (!b) {
    await ctx.editMessageText("Booking not found.", { reply_markup: backToAdmin() });
    return;
  }
  const services = await listServices();
  const svcMap = new Map(services.map((s) => [s.id, s] as const));
  await ctx.editMessageText(
    `📅 Booking\n\n${formatBookingLine(b, svcMap)}\nClient: ${b.clientName} · ${b.clientPhone}`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("✅ Mark completed", `admin:booking-complete:${id}`)],
        [inlineButton("⚪ Cancel booking", `admin:booking-cancel:${id}`)],
        [inlineButton("⬅️ Back to bookings", "admin:bookings")],
      ]),
    },
  );
});

composer.callbackQuery(/^admin:booking-complete:([A-Za-z0-9_-]+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await isAdmin(ctx.from?.id ?? 0))) return;
  const id = ctx.match![1]!;
  const b = await getBooking(id);
  if (!b) {
    await ctx.editMessageText("Booking not found.", { reply_markup: backToAdmin() });
    return;
  }
  const updated = { ...b, status: "completed" as const, completedAt: Date.now() };
  await saveBooking(updated);
  await ctx.editMessageText(
    `✅ Booking marked completed.\n\nThe client can now leave a review from the Reviews menu.`,
    { reply_markup: backToAdmin() },
  );
  try {
    await ctx.api.sendMessage(
      b.telegramId,
      `✅ Your booking has been marked completed. You can leave a review from the Reviews menu.`,
    );
  } catch {
    // Non-fatal: client may have blocked the bot.
  }
  // Schedule push review prompt after 1 hour.
  const { pushReviewPrompt } = await import("./reviews.js");
  pushReviewPrompt(ctx.api, id);
});

composer.callbackQuery(/^admin:booking-cancel:([A-Za-z0-9_-]+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await isAdmin(ctx.from?.id ?? 0))) return;
  const id = ctx.match![1]!;
  const b = await getBooking(id);
  if (!b) {
    await ctx.editMessageText("Booking not found.", { reply_markup: backToAdmin() });
    return;
  }
  await saveBooking({ ...b, status: "cancelled" });
  await ctx.editMessageText("⚪ Booking cancelled.", { reply_markup: backToAdmin() });
  try {
    await ctx.api.sendMessage(
      b.telegramId,
      `Your booking has been cancelled. Contact the studio if you have questions.`,
    );
  } catch {
    // Non-fatal: client may have blocked the bot.
  }
});

// ── Admins management ────────────────────────────────────────────────────────

composer.callbackQuery("admin:admins", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await isAdmin(ctx.from?.id ?? 0))) return;
  const admins = await listAdmins();
  const rows = admins.map((id) => [
    inlineButton(`🔐 ${id}`, `admin:admin-remove:${id}`),
  ]);
  rows.push([inlineButton("➕ Add admin by id", "admin:admin-new")]);
  rows.push([inlineButton("⬅️ Back to admin", "admin:menu")]);
  await ctx.editMessageText(
    `🔐 Admins (${admins.length})\n\nTap an id to remove it.`,
    { reply_markup: inlineKeyboard(rows) },
  );
});

composer.callbackQuery(/^admin:admin-remove:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await isAdmin(ctx.from?.id ?? 0))) return;
  const id = Number(ctx.match![1]);
  await removeAdmin(id);
  await ctx.editMessageText(`🔐 Removed admin ${id}.`, { reply_markup: backToAdmin() });
});

composer.callbackQuery("admin:admin-new", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await isAdmin(ctx.from?.id ?? 0))) return;
  ctx.session.admin = { step: "admin_new_id" };
  await ctx.editMessageText("🔐 Send the Telegram ID of the new admin:", {
    reply_markup: inlineKeyboard([[inlineButton("⬅️ Cancel", "admin:cancel-flow")]]),
  });
});

// ── CSV export ───────────────────────────────────────────────────────────────

composer.callbackQuery("admin:export", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await isAdmin(ctx.from?.id ?? 0))) return;
  const [bookings, services] = await Promise.all([listBookings(), listServices()]);
  const svcMap = new Map(services.map((s) => [s.id, s] as const));
  const head = ["id", "datetime", "service", "staff_id", "client_name", "client_phone", "status"];
  const lines = [head.join(",")];
  for (const b of bookings) {
    lines.push(
      [
        b.id,
        b.datetime,
        svcMap.get(b.serviceId)?.name ?? "(deleted)",
        b.staffId,
        b.clientName,
        b.clientPhone,
        b.status,
      ]
        .map((v) => csvEscape(String(v)))
        .join(","),
    );
  }
  const csv = lines.join("\n");
  await ctx.replyWithDocument(
    new InputFile(Buffer.from(csv, "utf8"), `bookings-${new Date().toISOString().slice(0, 10)}.csv`),
  );
  await ctx.reply("📤 Sent.", { reply_markup: backToAdmin() });
});

// ── Settings ─────────────────────────────────────────────────────────────────

composer.callbackQuery("admin:settings", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await isAdmin(ctx.from?.id ?? 0))) return;
  const s = await getSettings();
  await ctx.editMessageText(
    "⚙ Settings\n\n" +
      `Start hour: ${s.startHour}:00\n` +
      `End hour: ${s.endHour}:00\n` +
      `Slot interval: ${s.slotMinutes} min\n` +
      `Booking horizon: ${s.horizonDays} days\n` +
      `Timezone: ${s.timezone}`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("🕐 Start hour", "admin:settings-edit:start_hour")],
        [inlineButton("🕐 End hour", "admin:settings-edit:end_hour")],
        [inlineButton("⏱ Slot interval", "admin:settings-edit:slot_minutes")],
        [inlineButton("📆 Horizon", "admin:settings-edit:horizon_days")],
        [inlineButton("🌍 Timezone", "admin:settings-edit:timezone")],
        [inlineButton("⬅️ Back to admin", "admin:menu")],
      ]),
    },
  );
});

composer.callbackQuery(
  /^admin:settings-edit:(start_hour|end_hour|slot_minutes|horizon_days|timezone)$/,
  async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await isAdmin(ctx.from?.id ?? 0))) return;
    const field = ctx.match![1]!;
    const prompts: Record<string, { step: string; text: string }> = {
      start_hour: { step: "settings_start_hour", text: "🕐 Send start hour (0–23, e.g. 9):" },
      end_hour: { step: "settings_end_hour", text: "🕐 Send end hour (0–23, e.g. 17):" },
      slot_minutes: { step: "settings_slot_minutes", text: "⏱ Send slot interval in minutes (5–240):" },
      horizon_days: { step: "settings_horizon_days", text: "📆 Send booking horizon in days (1–90):" },
      timezone: { step: "settings_timezone", text: "🌍 Send IANA timezone (e.g. America/New_York, Europe/London, UTC):" },
    };
    const p = prompts[field];
    if (!p) return;
    ctx.session.admin = { step: p.step as AdminFlow["step"] };
    await ctx.editMessageText(p.text, {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Cancel", "admin:cancel-flow")]]),
    });
  },
);

// ── Overlap sanity check (exported helper for tests; not used at runtime) ────

export async function checkNoOverlapForTest(
  serviceId: string,
  staffId: string,
  datetime: string,
  ignoreId?: string,
): Promise<boolean> {
  const tentative = {
    id: ignoreId ?? "t",
    telegramId: 0,
    serviceId,
    staffId,
    datetime,
    status: "confirmed" as const,
    clientName: "",
    clientPhone: "",
  };
  return !(await hasOverlap(tentative));
}

export default composer;