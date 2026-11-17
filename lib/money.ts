/**
 * Exact money arithmetic.
 *
 * All amounts are stored as integers in "units" of 1/10,000 of a dollar
 * (4 decimal places). This avoids IEEE-754 drift: 25 * 10.0040 is exactly
 * 2_501_000 units, never 250.10000000000002.
 */

export const UNITS_PER_DOLLAR = 10_000;
export const UNITS_PER_CENT = 100;

/**
 * Parse a decimal string ("10.0040", "-42.5", "$1,234.50") into integer units.
 * Digits beyond the 4th decimal place are rounded half-up (away from zero).
 * Returns null when the input is not a plain decimal number.
 */
export function parseUnits(input: string | null | undefined): number | null {
  if (input == null) return null;
  const cleaned = input.trim().replace(/^\$/, "").replace(/,/g, "");
  const m = /^([+-])?(\d+)(?:\.(\d+))?$/.exec(cleaned);
  if (!m) return null;
  const sign = m[1] === "-" ? -1 : 1;
  const whole = Number(m[2]);
  const fracDigits = m[3] ?? "";
  const frac4 = Number((fracDigits + "0000").slice(0, 4));
  let units = whole * UNITS_PER_DOLLAR + frac4;
  if (fracDigits.length > 4 && Number(fracDigits[4]) >= 5) units += 1;
  if (!Number.isSafeInteger(units)) return null;
  return sign * units;
}

/** ROUND_HALF_UP to whole cents (ties go away from zero), returned in units. */
export function roundHalfUpToCents(units: number): number {
  const sign = units < 0 ? -1 : 1;
  const abs = Math.abs(units);
  return sign * Math.floor((abs + UNITS_PER_CENT / 2) / UNITS_PER_CENT) * UNITS_PER_CENT;
}

/** Convert units to a JS number (for display/tests only, never for summing). */
export function unitsToNumber(units: number): number {
  return units / UNITS_PER_DOLLAR;
}

/** Format units as a plain decimal string with `dp` (2 or 4) decimals. */
export function unitsToDecimalString(units: number, dp: 2 | 4 = 2): string {
  const v = dp === 2 ? roundHalfUpToCents(units) : units;
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  const whole = Math.floor(abs / UNITS_PER_DOLLAR);
  const frac = String(abs % UNITS_PER_DOLLAR).padStart(4, "0");
  return `${sign}${whole}.${dp === 2 ? frac.slice(0, 2) : frac}`;
}

/** Format units as currency, e.g. -$1,234.50 or +$0.10 with `signed`. */
export function formatUsd(units: number, opts: { dp?: 2 | 4; signed?: boolean } = {}): string {
  const dp = opts.dp ?? 2;
  const v = dp === 2 ? roundHalfUpToCents(units) : units;
  const abs = Math.abs(v);
  const whole = Math.floor(abs / UNITS_PER_DOLLAR);
  const frac = String(abs % UNITS_PER_DOLLAR).padStart(4, "0").slice(0, dp);
  const wholeStr = whole.toLocaleString("en-US");
  const sign = v < 0 ? "-" : opts.signed && v > 0 ? "+" : "";
  return `${sign}$${wholeStr}.${frac}`;
}
