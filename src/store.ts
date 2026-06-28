// Persistent domain store for the GlowEr bot.
//
// Durable entities (services, bookings, reviews, portfolio, users, admins,
// settings) survive restarts via the toolkit's Redis-or-memory storage adapter.
// Session state is ephemeral and lives in the grammY session middleware; this
// store is for everything that must persist across deploys.
//
// All keys are namespaced with a per-entity prefix so a single Redis (or memory
// map) cleanly separates domains. The harness uses the same MemorySessionStorage
// the toolkit picks for sessions — fine for the test gate (the platform spins a
// fresh in-memory bot per spec) and a no-op risk in production (REDIS_URL is set).

import { resolveSessionStorage } from "./toolkit/session/redis.js";
import type { StorageAdapter } from "grammy";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Service {
  id: string;
  name: string;
  description: string;
  /** Price in minor units (cents) — integer to avoid float drift. */
  priceCents: number;
  durationMinutes: number;
}

export interface Staff {
  id: string;
  name: string;
  /** Service ids this staff member can perform. */
  specialties: string[];
}

export interface Booking {
  id: string;
  telegramId: number;
  serviceId: string;
  /** Empty string when user picked "no preference". */
  staffId: string;
  /** ISO-8601 datetime, UTC. */
  datetime: string;
  /** "confirmed" (auto-confirmed) | "completed" | "cancelled". */
  status: BookingStatus;
  clientName: string;
  clientPhone: string;
  /** Set when an admin marks the booking completed; ms since epoch. */
  completedAt?: number;
  /** Set after the 1-hour delayed review prompt has been sent. */
  reviewPromptSent?: boolean;
}

export type BookingStatus = "confirmed" | "completed" | "cancelled";

export interface PortfolioItem {
  id: string;
  /** Telegram file_id of the uploaded photo. */
  imageFileId: string;
  caption: string;
  serviceTags: string[];
}

export interface Review {
  id: string;
  telegramId: number;
  bookingId: string;
  /** 1..5 inclusive. */
  rating: number;
  text: string;
  photoFileIds: string[];
  adminResponse?: string;
  createdAt: number;
}

export interface UserProfile {
  telegramId: number;
  phone?: string;
  name?: string;
  lastSeenAt: number;
}

export interface Settings {
  /** Hour-of-day (0..23) the studio opens, local time. */
  startHour: number;
  /** Hour-of-day (0..23, exclusive) the studio closes. */
  endHour: number;
  /** Slot length in minutes. */
  slotMinutes: number;
  /** How many days ahead users can book. */
  horizonDays: number;
  /** IANA timezone string, e.g. "America/New_York". Defaults to "UTC". */
  timezone: string;
}

// ── Defaults & keys ───────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: Settings = {
  startHour: 9,
  endHour: 17,
  slotMinutes: 60,
  horizonDays: 14,
  timezone: "UTC",
};

const KEY = {
  service: (id: string) => `service:${id}`,
  staff: (id: string) => `staff:${id}`,
  booking: (id: string) => `booking:${id}`,
  portfolio: (id: string) => `portfolio:${id}`,
  review: (id: string) => `review:${id}`,
  user: (telegramId: number) => `user:${telegramId}`,
  adminList: () => "admin:list",
  settings: () => "settings",
  serviceIndex: () => "index:service",
  staffIndex: () => "index:staff",
  bookingIndex: () => "index:booking",
  portfolioIndex: () => "index:portfolio",
  reviewIndex: () => "index:review",
  userIndex: () => "index:user",
  bookingByUser: (telegramId: number) => `index:bookingByUser:${telegramId}`,
  reviewByUser: (telegramId: number) => `index:reviewByUser:${telegramId}`,
} as const;

// ── Singleton storage (initialized lazily) ────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let store: StorageAdapter<any> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(): StorageAdapter<any> {
  if (!store) store = resolveSessionStorage<any>(undefined);
  return store;
}

/** Test-only: reset the singleton so unit tests start clean. */
export function _resetStoreForTests(): void {
  store = null;
}

// ── ID generation ─────────────────────────────────────────────────────────────

/** A short, URL-safe id. Uses crypto.randomUUID when available, falls back to a
 *  time-based string for the (rare) environment without it. */
export function newId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ── Index helpers ─────────────────────────────────────────────────────────────

async function readIndex(name: string): Promise<string[]> {
  const raw = await db().read(name);
  return Array.isArray(raw) ? (raw as string[]) : [];
}

async function writeIndex(name: string, ids: string[]): Promise<void> {
  await db().write(name, ids);
}

async function addToIndex(name: string, id: string): Promise<void> {
  const ids = await readIndex(name);
  if (!ids.includes(id)) {
    ids.push(id);
    await writeIndex(name, ids);
  }
}

async function removeFromIndex(name: string, id: string): Promise<void> {
  const ids = await readIndex(name);
  const next = ids.filter((x) => x !== id);
  if (next.length !== ids.length) await writeIndex(name, next);
}

// ── Services ──────────────────────────────────────────────────────────────────

export async function listServices(): Promise<Service[]> {
  const ids = await readIndex(KEY.serviceIndex());
  const out: Service[] = [];
  for (const id of ids) {
    const s = (await db().read(KEY.service(id))) as Service | undefined;
    if (s) out.push(s);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getService(id: string): Promise<Service | undefined> {
  return (await db().read(KEY.service(id))) as Service | undefined;
}

export async function saveService(s: Service): Promise<void> {
  await db().write(KEY.service(s.id), s);
  await addToIndex(KEY.serviceIndex(), s.id);
}

export async function deleteService(id: string): Promise<void> {
  await db().delete(KEY.service(id));
  await removeFromIndex(KEY.serviceIndex(), id);
}

// ── Staff ─────────────────────────────────────────────────────────────────────

export async function listStaff(): Promise<Staff[]> {
  const ids = await readIndex(KEY.staffIndex());
  const out: Staff[] = [];
  for (const id of ids) {
    const s = (await db().read(KEY.staff(id))) as Staff | undefined;
    if (s) out.push(s);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getStaff(id: string): Promise<Staff | undefined> {
  return (await db().read(KEY.staff(id))) as Staff | undefined;
}

export async function saveStaff(s: Staff): Promise<void> {
  await db().write(KEY.staff(s.id), s);
  await addToIndex(KEY.staffIndex(), s.id);
}

export async function deleteStaff(id: string): Promise<void> {
  await db().delete(KEY.staff(id));
  await removeFromIndex(KEY.staffIndex(), id);
}

// ── Bookings ──────────────────────────────────────────────────────────────────

export async function listBookings(): Promise<Booking[]> {
  const ids = await readIndex(KEY.bookingIndex());
  const out: Booking[] = [];
  for (const id of ids) {
    const b = (await db().read(KEY.booking(id))) as Booking | undefined;
    if (b) out.push(b);
  }
  return out.sort((a, b) => a.datetime.localeCompare(b.datetime));
}

export async function getBooking(id: string): Promise<Booking | undefined> {
  return (await db().read(KEY.booking(id))) as Booking | undefined;
}

export async function listBookingsForUser(telegramId: number): Promise<Booking[]> {
  const ids = await readIndex(KEY.bookingByUser(telegramId));
  const out: Booking[] = [];
  for (const id of ids) {
    const b = (await db().read(KEY.booking(id))) as Booking | undefined;
    if (b) out.push(b);
  }
  return out.sort((a, b) => b.datetime.localeCompare(a.datetime));
}

export async function saveBooking(b: Booking): Promise<void> {
  await db().write(KEY.booking(b.id), b);
  await addToIndex(KEY.bookingIndex(), b.id);
  await addToIndex(KEY.bookingByUser(b.telegramId), b.id);
}

export async function updateBooking(b: Booking): Promise<void> {
  await db().write(KEY.booking(b.id), b);
}

/** Return true iff `b` overlaps any other confirmed/completed booking for the
 *  same staff member (or any staff when `b.staffId` is empty). */
export async function hasOverlap(b: Booking): Promise<boolean> {
  const all = await listBookings();
  const start = new Date(b.datetime).getTime();
  const svc = await getService(b.serviceId);
  const dur = svc?.durationMinutes ?? 60;
  const end = start + dur * 60_000;
  for (const other of all) {
    if (other.id === b.id) continue;
    if (other.status === "cancelled") continue;
    // Different staff: skip (only collision is on the same staff member).
    if (b.staffId && other.staffId && b.staffId !== other.staffId) continue;
    // If either is "no preference", assume it could be the same staff → check
    // collision conservatively.
    const oStart = new Date(other.datetime).getTime();
    const oSvc = await getService(other.serviceId);
    const oDur = oSvc?.durationMinutes ?? 60;
    const oEnd = oStart + oDur * 60_000;
    if (start < oEnd && oStart < end) return true;
  }
  return false;
}

// ── Portfolio ─────────────────────────────────────────────────────────────────

export async function listPortfolio(): Promise<PortfolioItem[]> {
  const ids = await readIndex(KEY.portfolioIndex());
  const out: PortfolioItem[] = [];
  for (const id of ids) {
    const p = (await db().read(KEY.portfolio(id))) as PortfolioItem | undefined;
    if (p) out.push(p);
  }
  return out.sort((a, b) => a.caption.localeCompare(b.caption));
}

export async function getPortfolioItem(id: string): Promise<PortfolioItem | undefined> {
  return (await db().read(KEY.portfolio(id))) as PortfolioItem | undefined;
}

export async function savePortfolioItem(p: PortfolioItem): Promise<void> {
  await db().write(KEY.portfolio(p.id), p);
  await addToIndex(KEY.portfolioIndex(), p.id);
}

export async function deletePortfolioItem(id: string): Promise<void> {
  await db().delete(KEY.portfolio(id));
  await removeFromIndex(KEY.portfolioIndex(), id);
}

// ── Reviews ───────────────────────────────────────────────────────────────────

export async function listReviews(): Promise<Review[]> {
  const ids = await readIndex(KEY.reviewIndex());
  const out: Review[] = [];
  for (const id of ids) {
    const r = (await db().read(KEY.review(id))) as Review | undefined;
    if (r) out.push(r);
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getReview(id: string): Promise<Review | undefined> {
  return (await db().read(KEY.review(id))) as Review | undefined;
}

export async function listReviewsForUser(telegramId: number): Promise<Review[]> {
  const ids = await readIndex(KEY.reviewByUser(telegramId));
  const out: Review[] = [];
  for (const id of ids) {
    const r = (await db().read(KEY.review(id))) as Review | undefined;
    if (r) out.push(r);
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveReview(r: Review): Promise<void> {
  await db().write(KEY.review(r.id), r);
  await addToIndex(KEY.reviewIndex(), r.id);
  await addToIndex(KEY.reviewByUser(r.telegramId), r.id);
}

export async function updateReview(r: Review): Promise<void> {
  await db().write(KEY.review(r.id), r);
}

// ── Users ─────────────────────────────────────────────────────────────────────

export async function getUser(telegramId: number): Promise<UserProfile | undefined> {
  return (await db().read(KEY.user(telegramId))) as UserProfile | undefined;
}

export async function saveUser(u: UserProfile): Promise<void> {
  await db().write(KEY.user(u.telegramId), u);
  await addToIndex(KEY.userIndex(), String(u.telegramId));
}

// ── Admins ────────────────────────────────────────────────────────────────────

export async function listAdmins(): Promise<number[]> {
  const raw = await db().read(KEY.adminList());
  return Array.isArray(raw) ? (raw as number[]) : [];
}

export async function isAdmin(telegramId: number): Promise<boolean> {
  const list = await listAdmins();
  return list.includes(telegramId);
}

export async function addAdmin(telegramId: number): Promise<void> {
  const list = await listAdmins();
  if (!list.includes(telegramId)) {
    list.push(telegramId);
    await db().write(KEY.adminList(), list);
  }
}

export async function removeAdmin(telegramId: number): Promise<void> {
  const list = await listAdmins();
  const next = list.filter((id) => id !== telegramId);
  if (next.length !== list.length) await db().write(KEY.adminList(), next);
}

// ── Settings ──────────────────────────────────────────────────────────────────

export async function getSettings(): Promise<Settings> {
  const raw = (await db().read(KEY.settings())) as Partial<Settings> | undefined;
  return { ...DEFAULT_SETTINGS, ...(raw ?? {}) };
}

export async function saveSettings(s: Settings): Promise<void> {
  await db().write(KEY.settings(), s);
}

// ── Slots ─────────────────────────────────────────────────────────────────────

export interface Slot {
  /** ISO-8601, UTC. */
  datetime: string;
  /** Human-friendly local label, e.g. "Mon Jun 30, 10:00". */
  label: string;
}

/** Generate available slots for the next `settings.horizonDays` days, between
 *  startHour and endHour (exclusive), every `settings.slotMinutes` minutes.
 *  Slots that already have an overlapping booking are filtered out using
 *  duration-aware overlap logic (same semantics as hasOverlap). */
export async function listAvailableSlots(now: Date = new Date()): Promise<Slot[]> {
  const settings = await getSettings();
  const [allBookings, services] = await Promise.all([listBookings(), listServices()]);
  const svcMap = new Map(services.map((s) => [s.id, s] as const));
  const bookings = allBookings.filter((b) => b.status !== "cancelled");
  const out: Slot[] = [];
  const start0 = new Date(now);
  start0.setUTCHours(0, 0, 0, 0);

  for (let d = 0; d < settings.horizonDays; d++) {
    const day = new Date(start0);
    day.setUTCDate(day.getUTCDate() + d);
    for (let m = settings.startHour * 60; m < settings.endHour * 60; m += settings.slotMinutes) {
      const dt = new Date(day);
      dt.setUTCHours(0, m, 0, 0);
      if (dt.getTime() <= now.getTime()) continue;
      const slotStart = dt.getTime();
      const slotEnd = slotStart + settings.slotMinutes * 60_000;
      const conflict = bookings.some((b) => {
        const bStart = new Date(b.datetime).getTime();
        const bDur = (svcMap.get(b.serviceId)?.durationMinutes ?? settings.slotMinutes) * 60_000;
        const bEnd = bStart + bDur;
        return slotStart < bEnd && bStart < slotEnd;
      });
      if (conflict) continue;
      const iso = dt.toISOString();
      out.push({ datetime: iso, label: formatSlotLabel(dt, settings.timezone) });
    }
  }
  return out;
}

function formatSlotLabel(dt: Date, timezone: string): string {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(dt);
    const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
    const month = parts.find((p) => p.type === "month")?.value ?? "";
    const day = parts.find((p) => p.type === "day")?.value ?? "";
    const hour = parts.find((p) => p.type === "hour")?.value ?? "";
    const minute = parts.find((p) => p.type === "minute")?.value ?? "";
    return `${weekday} ${month} ${day}, ${hour}:${minute}`;
  } catch {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const day = days[dt.getUTCDay()];
    const mon = months[dt.getUTCMonth()];
    const dd = String(dt.getUTCDate()).padStart(2, "0");
    const hh = String(dt.getUTCHours()).padStart(2, "0");
    const mm = String(dt.getUTCMinutes()).padStart(2, "0");
    return `${day} ${mon} ${dd}, ${hh}:${mm}`;
  }
}