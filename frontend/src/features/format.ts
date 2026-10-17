const dayFmt = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" });
const longDayFmt = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" });
const timeFmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

export const formatDay = (iso: string) => dayFmt.format(new Date(iso));
export const formatLongDay = (iso: string) => longDayFmt.format(new Date(iso));
export const formatTime = (iso: string) => timeFmt.format(new Date(iso));
/** Local calendar day key, e.g. 2026-10-20. */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
