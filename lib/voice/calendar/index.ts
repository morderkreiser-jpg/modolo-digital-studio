// The calendar of a tenant: one provider instance per tenant id for the life of the process, so
// bookings made in one turn are there in the next.
//
// Only the built-in memory calendar exists today. Tenants configured for Google or Microsoft get a
// provider that answers "unavailable" to everything: the assistant then says it could not book,
// which is the truth, instead of pretending a booking worked.
import type { CalendarProvider, VoiceTenantConfig } from "@/lib/voice/types";
import { createMemoryCalendar } from "./memory";

export { createMemoryCalendar, nameKey, normalizeBookingRef } from "./memory";
export type { MemoryCalendarOptions } from "./memory";

const calendars = new Map<string, CalendarProvider>();

/** The tenant's calendar, or null when the tenant has none. Never throws. */
export function getCalendar(tenant: VoiceTenantConfig): CalendarProvider | null {
  const config = tenant.calendar;
  if (!config) return null;
  const existing = calendars.get(tenant.id);
  if (existing) return existing;
  const calendar =
    config.provider === "memory"
      ? // Demo businesses are fictional: a third of their slots are "taken" so that callers also meet
        // a full calendar. A live tenant's memory calendar starts empty.
        createMemoryCalendar(config, tenant.hours, tenant.kind === "demo" ? { busySeed: tenant.id } : {})
      : unconnectedCalendar();
  calendars.set(tenant.id, calendar);
  return calendar;
}

/** Forgets every calendar instance (and so every booking). Tests only. */
export function resetCalendarsForTests(): void {
  calendars.clear();
}

/** An external calendar that is not connected yet: every call fails honestly. */
function unconnectedCalendar(): CalendarProvider {
  const unavailable = async () => ({ ok: false as const, code: "unavailable" as const });
  return { findSlots: unavailable, book: unavailable, cancel: unavailable, reschedule: unavailable };
}
