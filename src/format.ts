// Tiny display helpers shared across handlers. Pure (no I/O) so they're easy
// to unit-test and don't pull grammY in.

import type { Booking, Service } from "./store.js";

/** "$42.00" from integer cents. */
export function formatPrice(priceCents: number): string {
  const sign = priceCents < 0 ? "-" : "";
  const abs = Math.abs(priceCents);
  const dollars = Math.floor(abs / 100);
  const cents = String(abs % 100).padStart(2, "0");
  return `${sign}$${dollars}.${cents}`;
}

/** One-line service card for the catalogue list. */
export function formatServiceLine(s: Service): string {
  return `• ${s.name} — ${formatPrice(s.priceCents)} · ${s.durationMinutes} min`;
}

/** One-line service detail for the booking flow. */
export function formatServiceDetail(s: Service): string {
  return (
    `💅 ${s.name}\n` +
    `${s.description}\n` +
    `Price: ${formatPrice(s.priceCents)} · Duration: ${s.durationMinutes} min`
  );
}

/** One-line booking summary used in history and admin lists. */
export function formatBookingLine(b: Booking, services: Map<string, Service>): string {
  const svc = services.get(b.serviceId);
  const svcName = svc?.name ?? "(deleted service)";
  const when = new Date(b.datetime);
  const iso = when.toISOString().replace("T", " ").slice(0, 16);
  const status = b.status === "confirmed" ? "🟢 confirmed" : b.status === "completed" ? "✅ completed" : "⚪ cancelled";
  return `• ${iso} — ${svcName} (${status})`;
}

/** CSV-escape a single field per RFC 4180. */
export function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}