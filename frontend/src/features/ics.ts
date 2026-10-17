import type { Booking } from "../api";

function stamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** A calendar file built in the browser. Contains the visit time and place only, no personal details. */
export function bookingIcs(booking: Booking, clinicName: string, clinicAddress: string, now = new Date()): string {
  const start = new Date(booking.slot.starts_at);
  const end = new Date(start.getTime() + booking.slot.duration_minutes * 60_000);
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Maple Grove demo//Onboarding//EN",
    "BEGIN:VEVENT",
    `UID:${booking.id}@maple-grove.example`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:Visit at ${clinicName}`,
    `LOCATION:${clinicAddress}`,
    `DESCRIPTION:Confirmation code ${booking.confirmation_code}. Bring your photo ID.`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
