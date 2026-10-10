import {
  addDays as dfAddDays,
  addMonths as dfAddMonths,
  addYears as dfAddYears,
  differenceInCalendarDays,
  endOfMonth,
  format,
  isValid,
  parse,
  parseISO,
  startOfMonth,
  startOfYear,
  endOfYear,
} from "date-fns";
import type { Frequency, ISODate } from "./types";
import { fromBanglaDigits } from "./money";

export const iso = (d: Date): ISODate => format(d, "yyyy-MM-dd");
export const toDate = (s: ISODate): Date => parseISO(s);

/** Today in the user's local timezone. */
export function today(now: Date = new Date()): ISODate {
  return iso(now);
}

export const addDays = (s: ISODate, n: number) => iso(dfAddDays(toDate(s), n));
export const addMonths = (s: ISODate, n: number) => iso(dfAddMonths(toDate(s), n));
export const daysBetween = (a: ISODate, b: ISODate) => differenceInCalendarDays(toDate(b), toDate(a));
export const monthStart = (s: ISODate) => iso(startOfMonth(toDate(s)));
export const monthEnd = (s: ISODate) => iso(endOfMonth(toDate(s)));
export const yearStart = (s: ISODate) => iso(startOfYear(toDate(s)));
export const yearEnd = (s: ISODate) => iso(endOfYear(toDate(s)));
export const monthKey = (s: ISODate) => s.slice(0, 7); // YYYY-MM

export function isISODate(s: unknown): s is ISODate {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = parseISO(s);
  return isValid(d) && iso(d) === s;
}

/** Inclusive date range check on ISO strings. */
export const inRange = (d: ISODate, from: ISODate, to: ISODate) => d >= from && d <= to;

/** Month keys (YYYY-MM) from `from` to `to`, inclusive. */
export function monthsBetween(from: ISODate, to: ISODate): string[] {
  const out: string[] = [];
  let cur = monthStart(from);
  const end = monthStart(to);
  while (cur <= end) {
    out.push(monthKey(cur));
    cur = addMonths(cur, 1);
  }
  return out;
}

/** n-th occurrence of a schedule anchored at `start` (n = 0 is start). Month-end dates clamp (Jan 31 -> Feb 28). */
export function nthOccurrence(start: ISODate, freq: Frequency, interval: number, n: number): ISODate {
  const d = toDate(start);
  switch (freq) {
    case "weekly":
      return iso(dfAddDays(d, 7 * interval * n));
    case "monthly":
      return iso(dfAddMonths(d, interval * n));
    case "quarterly":
      return iso(dfAddMonths(d, 3 * interval * n));
    case "yearly":
      return iso(dfAddYears(d, interval * n));
  }
}

/** Parse dates typed or imported in common Bangladeshi/ISO formats. */
export function parseLooseDate(input: string): ISODate | null {
  const s = fromBanglaDigits(String(input ?? "").trim());
  if (!s) return null;
  if (isISODate(s)) return s;
  const formats = ["dd/MM/yyyy", "d/M/yyyy", "dd-MM-yyyy", "d-M-yyyy", "dd.MM.yyyy", "yyyy/MM/dd", "d MMM yyyy", "dd MMM yyyy", "MMM d, yyyy", "M/d/yyyy"];
  for (const f of formats) {
    const d = parse(s, f, new Date(2000, 0, 1));
    if (isValid(d) && d.getFullYear() > 1969 && d.getFullYear() < 2201) return iso(d);
  }
  // ISO datetime from spreadsheets / exports
  const m = /^(\d{4}-\d{2}-\d{2})[T ]/.exec(s);
  if (m && isISODate(m[1])) return m[1];
  return null;
}

export type PeriodKind = "month" | "year" | "custom";
export interface Period {
  kind: PeriodKind;
  from: ISODate;
  to: ISODate;
}

export function monthPeriod(anchor: ISODate): Period {
  return { kind: "month", from: monthStart(anchor), to: monthEnd(anchor) };
}
export function yearPeriod(anchor: ISODate): Period {
  return { kind: "year", from: yearStart(anchor), to: yearEnd(anchor) };
}
export function shiftPeriod(p: Period, dir: 1 | -1): Period {
  if (p.kind === "month") return monthPeriod(addMonths(p.from, dir));
  if (p.kind === "year") return yearPeriod(iso(dfAddYears(toDate(p.from), dir)));
  const len = daysBetween(p.from, p.to) + 1;
  return { kind: "custom", from: addDays(p.from, dir * len), to: addDays(p.to, dir * len) };
}
