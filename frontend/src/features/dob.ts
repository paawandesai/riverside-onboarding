export type DobParts = { month: string; day: string; year: string };

export function splitDob(iso: string | null | undefined): DobParts {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  return m ? { year: m[1], month: String(Number(m[2])), day: String(Number(m[3])) } : { month: "", day: "", year: "" };
}

/** ISO date if the three parts form a real calendar date, else null. */
export function dobToIso({ month, day, year }: DobParts): string | null {
  if (!/^\d{1,2}$/.test(month) || !/^\d{1,2}$/.test(day) || !/^\d{4}$/.test(year)) return null;
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function ageOn(iso: string, today = new Date()): number {
  const [y, m, d] = iso.split("-").map(Number);
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) age -= 1;
  return age;
}
