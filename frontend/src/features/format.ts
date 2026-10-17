/** Appointments are shown in the clinic's time zone, whatever the viewer's device is set to. */
export const CLINIC_TIME_ZONE = "America/New_York";
const zone = { timeZone: CLINIC_TIME_ZONE } as const;
const dayFmt = new Intl.DateTimeFormat("en-US", {
  ...zone,
  weekday: "short",
  month: "short",
  day: "numeric",
});
const longDayFmt = new Intl.DateTimeFormat("en-US", {
  ...zone,
  weekday: "long",
  month: "long",
  day: "numeric",
});
const timeFmt = new Intl.DateTimeFormat("en-US", {
  ...zone,
  hour: "numeric",
  minute: "2-digit",
});
const zoneFmt = new Intl.DateTimeFormat("en-US", {
  ...zone,
  timeZoneName: "short",
});
const keyFmt = new Intl.DateTimeFormat("en-CA", {
  ...zone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export const formatDay = (iso: string) => dayFmt.format(new Date(iso));
export const formatLongDay = (iso: string) => longDayFmt.format(new Date(iso));
export const formatTime = (iso: string) => timeFmt.format(new Date(iso));
/** Short zone name for a moment, e.g. "EDT" (it changes with daylight saving). */
export const formatZone = (iso: string) => zoneFmt.formatToParts(new Date(iso)).find((p) => p.type === "timeZoneName")?.value ?? "";
/** Clinic calendar day key, e.g. 2026-10-20. */
export const dayKey = (iso: string) => keyFmt.format(new Date(iso));
