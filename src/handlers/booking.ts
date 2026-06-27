import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
  registerMainMenuItem,
} from "../toolkit/index.js";
import {
  getService,
  getStaff,
  hasOverlap,
  listAvailableSlots,
  listServices,
  listStaff,
  newId,
  saveBooking,
  saveUser,
} from "../store.js";

registerMainMenuItem({ label: "📅 Book service", data: "booking:start", order: 20 });

const composer = new Composer<Ctx>();

const backToMenu = () => inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]);

// Phone validation: digits, spaces, dashes, parens, leading +. At least 7 digits.
const PHONE_RE = /^\+?[\d\s\-()]{7,20}$/;

function startBooking(serviceId?: string): BookingFlowReset {
  return {
    step: serviceId ? "staff" : "service",
    ...(serviceId ? { serviceId } : {}),
  };
}

type BookingFlowReset = NonNullable<Ctx["session"]["booking"]>;

// ── Entry points ──────────────────────────────────────────────────────────────

composer.callbackQuery("booking:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  const services = await listServices();
  if (services.length === 0) {
    await ctx.editMessageText(
      "💅 No services available right now. Check back soon!",
      { reply_markup: backToMenu() },
    );
    return;
  }
  ctx.session.booking = startBooking();
  const rows = services.map((s) => [
    inlineButton(`💅 ${s.name}`, `booking:service:${encodeURIComponent(s.name)}`),
  ]);
  rows.push([inlineButton("⬅️ Back to menu", "menu:main")]);
  await ctx.editMessageText("📅 Choose a service:", {
    reply_markup: inlineKeyboard(rows),
  });
});

composer.callbackQuery(/^booking:start:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const name = decodeURIComponent(ctx.match![1]!);
  const services = await listServices();
  const svc = services.find((s) => s.name === name);
  if (!svc) {
    await ctx.editMessageText("That service is no longer available.", {
      reply_markup: inlineKeyboard([[inlineButton("📅 Pick another", "booking:start")]]),
    });
    return;
  }
  ctx.session.booking = startBooking(svc.id);
  await renderStaffStep(ctx);
});

// ── Step 1: service ──────────────────────────────────────────────────────────

composer.callbackQuery(/^booking:service:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const flow = ctx.session.booking;
  if (!flow || flow.step !== "service") return;
  const name = decodeURIComponent(ctx.match![1]!);
  const services = await listServices();
  const svc = services.find((s) => s.name === name);
  if (!svc) {
    await ctx.editMessageText("That service is no longer available.", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
    });
    return;
  }
  flow.serviceId = svc.id;
  flow.step = "staff";
  ctx.session.booking = flow;
  await renderStaffStep(ctx);
});

async function renderStaffStep(ctx: Ctx): Promise<void> {
  const flow = ctx.session.booking;
  if (!flow || !flow.serviceId) return;
  const staff = (await listStaff()).filter((s) =>
    s.specialties.length === 0 || s.specialties.includes(flow.serviceId!),
  );
  if (staff.length === 0) {
    flow.staffId = "";
    flow.step = "slot";
    ctx.session.booking = flow;
    await renderSlotStep(ctx);
    return;
  }
  const rows = staff.map((s) => [
    inlineButton(`👤 ${s.name}`, `booking:staff:${s.id}`),
  ]);
  rows.push([inlineButton("👤 No preference", "booking:staff:none")]);
  rows.push([inlineButton("⬅️ Back to menu", "menu:main")]);
  await ctx.editMessageText("👤 Choose a staff member:", {
    reply_markup: inlineKeyboard(rows),
  });
}

// ── Step 2: staff ────────────────────────────────────────────────────────────

composer.callbackQuery(/^booking:staff:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const flow = ctx.session.booking;
  if (!flow || flow.step !== "staff") return;
  const arg = ctx.match![1]!;
  if (arg !== "none") {
    const staff = await getStaff(arg);
    if (!staff) {
      await ctx.editMessageText("That staff member is no longer available.", {
        reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
      });
      return;
    }
    flow.staffId = arg;
  } else {
    flow.staffId = "";
  }
  flow.step = "slot";
  ctx.session.booking = flow;
  await renderSlotStep(ctx);
});

// ── Step 3: slot ─────────────────────────────────────────────────────────────

async function renderSlotStep(ctx: Ctx): Promise<void> {
  const slots = await listAvailableSlots();
  if (slots.length === 0) {
    await ctx.editMessageText(
      "📅 No available slots in the next two weeks.\nPlease check back later or message the studio.",
      { reply_markup: backToMenu() },
    );
    delete ctx.session.booking;
    return;
  }
  const rows = slots.slice(0, 12).map((s) => [
    inlineButton(`🕒 ${s.label}`, `booking:slot:${encodeURIComponent(s.datetime)}`),
  ]);
  rows.push([inlineButton("⬅️ Cancel booking", "booking:cancel")]);
  await ctx.editMessageText("📅 Choose a time slot:", {
    reply_markup: inlineKeyboard(rows),
  });
}

composer.callbackQuery(/^booking:slot:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const flow = ctx.session.booking;
  if (!flow || flow.step !== "slot") return;
  const iso = decodeURIComponent(ctx.match![1]!);
  // Defensive: re-check overlap before locking the slot in (in case two clients
  // race for the last seat — the slot list is best-effort).
  const svc = flow.serviceId ? await getService(flow.serviceId) : undefined;
  if (!svc || !flow.serviceId) {
    await ctx.editMessageText("That service is no longer available.", {
      reply_markup: backToMenu(),
    });
    delete ctx.session.booking;
    return;
  }
  const tentative = {
    id: "tentative",
    telegramId: ctx.from?.id ?? 0,
    serviceId: flow.serviceId,
    staffId: flow.staffId ?? "",
    datetime: iso,
    status: "confirmed" as const,
    clientName: "",
    clientPhone: "",
  };
  if (await hasOverlap(tentative)) {
    await ctx.editMessageText(
      "⏱ That slot was just taken. Pick another:",
      {
        reply_markup: inlineKeyboard([
          [inlineButton("📅 See other slots", "booking:retry-slot")],
          [inlineButton("⬅️ Back to menu", "menu:main")],
        ]),
      },
    );
    return;
  }
  flow.datetime = iso;
  flow.step = "name";
  ctx.session.booking = flow;
  await ctx.editMessageText(
    `📝 What's your name?\n\n(Type your name, then send.)`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("⬅️ Cancel booking", "booking:cancel")],
      ]),
    },
  );
});

composer.callbackQuery("booking:retry-slot", async (ctx) => {
  await ctx.answerCallbackQuery();
  const flow = ctx.session.booking;
  if (!flow) return;
  flow.step = "slot";
  ctx.session.booking = flow;
  await renderSlotStep(ctx);
});

// ── Step 4+5: free-text name + phone capture ─────────────────────────────────

composer.on("message:text", async (ctx, next) => {
  const flow = ctx.session.booking;
  if (!flow) return next();

  if (flow.step === "name") {
    const name = ctx.message.text.trim();
    if (name.length === 0 || name.length > 80) {
      await ctx.reply("Please enter a name (1–80 characters).");
      return;
    }
    flow.name = name;
    flow.step = "phone";
    ctx.session.booking = flow;
    await ctx.reply(
      "📱 What's your phone number?\n\nSend your number — digits, spaces, and + are fine.",
      {
        reply_markup: inlineKeyboard([
          [inlineButton("⬅️ Cancel booking", "booking:cancel")],
        ]),
      },
    );
    return;
  }

  if (flow.step === "phone") {
    const phone = ctx.message.text.trim();
    if (!PHONE_RE.test(phone)) {
      await ctx.reply(
        "That doesn't look like a phone number. Try again (digits, +, spaces, dashes, parens).",
      );
      return;
    }
    flow.phone = phone;
    flow.step = "confirm";
    ctx.session.booking = flow;

    const svc = flow.serviceId ? await getService(flow.serviceId) : undefined;
    const staff = flow.staffId ? await getStaff(flow.staffId) : null;
    const when = flow.datetime ? new Date(flow.datetime).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "?";
    const summary =
      "📋 Booking summary\n\n" +
      `Service: ${svc?.name ?? "?"}\n` +
      `Staff: ${staff?.name ?? "No preference"}\n` +
      `When: ${when}\n` +
      `Name: ${flow.name}\n` +
      `Phone: ${flow.phone}\n\n` +
      "Confirm?";

    await ctx.reply(summary, {
      reply_markup: inlineKeyboard([
        [
          inlineButton("✅ Confirm", "booking:confirm"),
          inlineButton("❌ Cancel", "booking:cancel"),
        ],
      ]),
    });
    return;
  }

  return next();
});

// ── Step 6: confirm ─────────────────────────────────────────────────────────

composer.callbackQuery("booking:confirm", async (ctx) => {
  await ctx.answerCallbackQuery();
  const flow = ctx.session.booking;
  if (!flow || flow.step !== "confirm") return;
  const me = ctx.from?.id;
  if (!me) return;
  if (!flow.serviceId || !flow.datetime || !flow.name || !flow.phone) {
    await ctx.editMessageText("Booking incomplete. Please try again.", {
      reply_markup: backToMenu(),
    });
    delete ctx.session.booking;
    return;
  }
  const svc = await getService(flow.serviceId);
  if (!svc) {
    await ctx.editMessageText("That service is no longer available.", {
      reply_markup: backToMenu(),
    });
    delete ctx.session.booking;
    return;
  }

  const booking = {
    id: newId(),
    telegramId: me,
    serviceId: flow.serviceId,
    staffId: flow.staffId ?? "",
    datetime: flow.datetime,
    status: "confirmed" as const,
    clientName: flow.name,
    clientPhone: flow.phone,
  };

  // Final overlap check (defence in depth — covers the rare case where the
  // service was edited shorter between slot-pick and confirm).
  if (await hasOverlap(booking)) {
    await ctx.editMessageText(
      "⏱ That slot was just taken. Please pick another:",
      {
        reply_markup: inlineKeyboard([
          [inlineButton("📅 Pick another slot", "booking:retry-slot")],
        ]),
      },
    );
    return;
  }

  await saveBooking(booking);
  await saveUser({
    telegramId: me,
    name: flow.name,
    phone: flow.phone,
    lastSeenAt: Date.now(),
  });
  delete ctx.session.booking;

  await ctx.editMessageText(
    `✅ Booked!\n\n${svc.name}\n${new Date(booking.datetime).toISOString().replace("T", " ").slice(0, 16)} UTC\n\n` +
      "We'll remind you when it's time. See you soon! 💅",
    { reply_markup: backToMenu() },
  );

  // Notify admins about the new booking. Swallowed errors — a notification
  // failure must not break the user-facing confirmation we just sent.
  const { notifyAdmins } = await import("../notify.js");
  await notifyAdmins(
    ctx,
    `📅 New booking\n\n${svc.name}\n${new Date(booking.datetime).toISOString().replace("T", " ").slice(0, 16)} UTC\nClient: ${booking.clientName} · ${booking.clientPhone}`,
  );
});

composer.callbackQuery("booking:cancel", async (ctx) => {
  await ctx.answerCallbackQuery();
  delete ctx.session.booking;
  await ctx.editMessageText("Booking cancelled.", { reply_markup: backToMenu() });
});

export default composer;