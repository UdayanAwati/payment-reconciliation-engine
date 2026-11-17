const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

/** Returns the YYYY-MM-DD prefix of an ISO date/timestamp if it is a real calendar date, else null. */
export function toIsoDate(input: string | null | undefined): string | null {
  if (!input) return null;
  const m = ISO_DATE.exec(input.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** Whole calendar days from a to b (b - a). Both must be YYYY-MM-DD. */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** Add whole days to a YYYY-MM-DD date. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Inclusive range check on YYYY-MM-DD strings (lexicographic order is chronological). */
export function inRange(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}
