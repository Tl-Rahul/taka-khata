import type { ISODate, Paisa, Recurring, Transaction } from "./types";
import { addDays, daysBetween, nthOccurrence } from "./dates";

export type OccurrenceStatus = "paid" | "skipped" | "overdue" | "due_today" | "due_soon" | "upcoming";

export interface Occurrence {
  recurring: Recurring;
  date: ISODate;
  amount: Paisa;
  status: OccurrenceStatus;
  payment: Transaction | null;
  daysUntil: number; // negative = days overdue
}

/** All scheduled dates between from and to (inclusive), within the schedule's own start/end. */
export function occurrenceDates(r: Recurring, from: ISODate, to: ISODate, limit = 2000): ISODate[] {
  const out: ISODate[] = [];
  const end = r.end_date && r.end_date < to ? r.end_date : to;
  for (let n = 0; n < limit; n++) {
    const d = nthOccurrence(r.start_date, r.frequency, r.interval_count, n);
    if (d > end) break;
    if (d >= from) out.push(d);
  }
  return out;
}

/** Index of payments by "recurringId|occurrenceDate". */
export function paymentIndex(txs: Transaction[]): Map<string, Transaction> {
  const m = new Map<string, Transaction>();
  for (const t of txs) if (t.recurring_id && t.occurrence_date) m.set(`${t.recurring_id}|${t.occurrence_date}`, t);
  return m;
}

/**
 * Occurrences of a schedule from its start up to today + horizonDays.
 * An occurrence is "paid" ONLY when a transaction was recorded for it — never automatically.
 */
export function scheduleOccurrences(
  r: Recurring,
  payments: Map<string, Transaction>,
  today: ISODate,
  horizonDays = 60,
  remindDays = r.remind_days_before,
): Occurrence[] {
  const to = addDays(today, horizonDays);
  return occurrenceDates(r, r.start_date, to).map((date) => {
    const payment = payments.get(`${r.id}|${date}`) ?? null;
    const daysUntil = daysBetween(today, date);
    let status: OccurrenceStatus;
    if (payment) status = "paid";
    else if (r.skipped_dates.includes(date)) status = "skipped";
    else if (date < today) status = "overdue";
    else if (date === today) status = "due_today";
    else if (daysUntil <= remindDays) status = "due_soon";
    else status = "upcoming";
    return { recurring: r, date, amount: payment ? payment.amount : r.amount, status, payment, daysUntil };
  });
}

export interface BillsOverview {
  overdue: Occurrence[];
  dueSoon: Occurrence[]; // today + within reminder window
  upcoming: Occurrence[]; // later within horizon
  recentPaid: Occurrence[];
}

export function billsOverview(
  schedules: Recurring[],
  txs: Transaction[],
  today: ISODate,
  horizonDays = 30,
): BillsOverview {
  const payments = paymentIndex(txs);
  const out: BillsOverview = { overdue: [], dueSoon: [], upcoming: [], recentPaid: [] };
  for (const r of schedules) {
    if (!r.active) continue;
    for (const o of scheduleOccurrences(r, payments, today, horizonDays)) {
      if (o.status === "overdue") out.overdue.push(o);
      else if (o.status === "due_today" || o.status === "due_soon") out.dueSoon.push(o);
      else if (o.status === "upcoming") out.upcoming.push(o);
      else if (o.status === "paid" && o.daysUntil >= -45) out.recentPaid.push(o);
    }
  }
  const byDate = (a: Occurrence, b: Occurrence) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  out.overdue.sort(byDate);
  out.dueSoon.sort(byDate);
  out.upcoming.sort(byDate);
  out.recentPaid.sort((a, b) => -byDate(a, b));
  return out;
}

/** Next unpaid, unskipped occurrence on/after today (or the oldest overdue one). */
export function nextOccurrence(r: Recurring, txs: Transaction[], today: ISODate): Occurrence | null {
  const occ = scheduleOccurrences(r, paymentIndex(txs), today, 400);
  return occ.find((o) => o.status === "overdue" || o.status === "due_today" || o.status === "due_soon" || o.status === "upcoming") ?? null;
}

/** Approximate monthly cost of a schedule (for "monthly commitments"). */
export function monthlyEquivalent(r: Recurring): Paisa {
  const perYear = { weekly: 52, monthly: 12, quarterly: 4, yearly: 1 }[r.frequency] / r.interval_count;
  return Math.round((r.amount * perYear) / 12);
}
