import { describe, expect, it, beforeEach } from "vitest";
import {
  _resetStoreForTests,
  hasOverlap,
  listAvailableSlots,
  listBookings,
  saveBooking,
  saveService,
} from "../src/store.js";

// Store-level tests for the overlap detector + slot generator. These cover the
// "time slot validation for overbooking prevention" required test from the
// blueprint at the data-layer boundary, since the full flow is exercised by
// the dialog specs.

beforeEach(() => {
  _resetStoreForTests();
});

describe("overlap detection", () => {
  it("returns false when there are no bookings", async () => {
    const b = {
      id: "a",
      telegramId: 1,
      serviceId: "svc",
      staffId: "",
      datetime: "2099-01-01T10:00:00.000Z",
      status: "confirmed" as const,
      clientName: "",
      clientPhone: "",
    };
    await saveService({ id: "svc", name: "Facial", description: "", priceCents: 5000, durationMinutes: 60 });
    expect(await hasOverlap(b)).toBe(false);
  });

  it("detects an overlap when two bookings use the same staff + slot", async () => {
    await saveService({ id: "svc", name: "Facial", description: "", priceCents: 5000, durationMinutes: 60 });
    await saveBooking({
      id: "first",
      telegramId: 2,
      serviceId: "svc",
      staffId: "s1",
      datetime: "2099-01-01T10:00:00.000Z",
      status: "confirmed",
      clientName: "A",
      clientPhone: "1",
    });
    const second = {
      id: "second",
      telegramId: 1,
      serviceId: "svc",
      staffId: "s1",
      datetime: "2099-01-01T10:00:00.000Z",
      status: "confirmed" as const,
      clientName: "B",
      clientPhone: "2",
    };
    expect(await hasOverlap(second)).toBe(true);
  });

  it("does not flag overlap across different staff", async () => {
    await saveService({ id: "svc", name: "Facial", description: "", priceCents: 5000, durationMinutes: 60 });
    await saveBooking({
      id: "first",
      telegramId: 2,
      serviceId: "svc",
      staffId: "s1",
      datetime: "2099-01-01T10:00:00.000Z",
      status: "confirmed",
      clientName: "A",
      clientPhone: "1",
    });
    const second = {
      id: "second",
      telegramId: 1,
      serviceId: "svc",
      staffId: "s2",
      datetime: "2099-01-01T10:00:00.000Z",
      status: "confirmed" as const,
      clientName: "B",
      clientPhone: "2",
    };
    expect(await hasOverlap(second)).toBe(false);
  });

  it("ignores cancelled bookings when checking overlap", async () => {
    await saveService({ id: "svc", name: "Facial", description: "", priceCents: 5000, durationMinutes: 60 });
    await saveBooking({
      id: "first",
      telegramId: 2,
      serviceId: "svc",
      staffId: "s1",
      datetime: "2099-01-01T10:00:00.000Z",
      status: "cancelled",
      clientName: "A",
      clientPhone: "1",
    });
    const second = {
      id: "second",
      telegramId: 1,
      serviceId: "svc",
      staffId: "s1",
      datetime: "2099-01-01T10:00:00.000Z",
      status: "confirmed" as const,
      clientName: "B",
      clientPhone: "2",
    };
    expect(await hasOverlap(second)).toBe(false);
  });

  it("flags overlap when one booking has staff and the other has no preference", async () => {
    await saveService({ id: "svc", name: "Facial", description: "", priceCents: 5000, durationMinutes: 60 });
    await saveBooking({
      id: "first",
      telegramId: 2,
      serviceId: "svc",
      staffId: "s1",
      datetime: "2099-01-01T10:00:00.000Z",
      status: "confirmed",
      clientName: "A",
      clientPhone: "1",
    });
    const second = {
      id: "second",
      telegramId: 1,
      serviceId: "svc",
      staffId: "",
      datetime: "2099-01-01T10:00:00.000Z",
      status: "confirmed" as const,
      clientName: "B",
      clientPhone: "2",
    };
    // No-preference could be assigned to any staff → conservatively flagged.
    expect(await hasOverlap(second)).toBe(true);
  });

  it("detects overlap when bookings are back-to-back within duration window", async () => {
    await saveService({ id: "svc", name: "Facial", description: "", priceCents: 5000, durationMinutes: 60 });
    await saveBooking({
      id: "first",
      telegramId: 2,
      serviceId: "svc",
      staffId: "s1",
      datetime: "2099-01-01T10:00:00.000Z",
      status: "confirmed",
      clientName: "A",
      clientPhone: "1",
    });
    const second = {
      id: "second",
      telegramId: 1,
      serviceId: "svc",
      staffId: "s1",
      // 10:30 is inside [10:00, 11:00) → overlap.
      datetime: "2099-01-01T10:30:00.000Z",
      status: "confirmed" as const,
      clientName: "B",
      clientPhone: "2",
    };
    expect(await hasOverlap(second)).toBe(true);
  });
});

describe("slot generation", () => {
  it("filters out slots in the past", async () => {
    await saveService({ id: "svc", name: "Facial", description: "", priceCents: 5000, durationMinutes: 60 });
    // Anchor "now" at a fixed instant; past slots must be filtered.
    const slots = await listAvailableSlots(new Date("2099-01-01T05:00:00.000Z"));
    for (const s of slots) {
      expect(new Date(s.datetime).getTime()).toBeGreaterThan(0);
    }
    // The earliest slot is the next 09:00 boundary on or after `now`.
    expect(slots[0]?.datetime).toBe("2099-01-01T09:00:00.000Z");
  });

  it("filters out slots that collide with an existing booking", async () => {
    await saveService({ id: "svc", name: "Facial", description: "", priceCents: 5000, durationMinutes: 60 });
    await saveBooking({
      id: "x",
      telegramId: 1,
      serviceId: "svc",
      staffId: "",
      datetime: "2099-01-02T09:00:00.000Z",
      status: "confirmed",
      clientName: "A",
      clientPhone: "1",
    });
    const slots = await listAvailableSlots(new Date("2099-01-01T00:00:00.000Z"));
    const taken = slots.find((s) => s.datetime === "2099-01-02T09:00:00.000Z");
    expect(taken).toBeUndefined();
  });

  it("lists bookings in chronological order", async () => {
    await saveService({ id: "svc", name: "Facial", description: "", priceCents: 5000, durationMinutes: 60 });
    await saveBooking({ id: "b", telegramId: 1, serviceId: "svc", staffId: "", datetime: "2099-01-03T10:00:00.000Z", status: "confirmed", clientName: "A", clientPhone: "1" });
    await saveBooking({ id: "a", telegramId: 1, serviceId: "svc", staffId: "", datetime: "2099-01-01T10:00:00.000Z", status: "confirmed", clientName: "A", clientPhone: "1" });
    const list = await listBookings();
    expect(list.map((b) => b.id)).toEqual(["a", "b"]);
  });
});