import type { Dataset, ISODate, Paisa, ReminderSettings } from "./types";
import { DEFAULT_REMINDERS } from "./types";
import { billsOverview } from "./recurring";
import { loanStatus } from "./loans";
import { budgetRows } from "./budgets";
import { addDays, daysBetween } from "./dates";

export type NoticeKind = "bill_overdue" | "bill_due" | "installment_overdue" | "installment_due" | "receivable_overdue" | "receivable_due" | "budget";
export type Severity = "danger" | "warning" | "info";

export interface Notice {
  id: string; // stable, so the UI can remember dismissals
  kind: NoticeKind;
  severity: Severity;
  title: string; // name of the bill/person/category (data, not UI text)
  date: ISODate | null;
  amount: Paisa | null;
  days: number | null; // days until (negative = overdue)
  ratio?: number;
  href: string;
  refId: string;
}

export function buildNotices(ds: Dataset, today: ISODate, settings: ReminderSettings = DEFAULT_REMINDERS): Notice[] {
  const out: Notice[] = [];
  const contactName = new Map(ds.contacts.map((c) => [c.id, c.name]));

  if (settings.bills) {
    const ov = billsOverview(ds.recurring.filter((r) => r.kind === "expense"), ds.transactions, today, settings.days_before);
    for (const o of ov.overdue)
      out.push({ id: `bill:${o.recurring.id}:${o.date}`, kind: "bill_overdue", severity: "danger", title: o.recurring.name, date: o.date, amount: o.amount, days: o.daysUntil, href: "/bills", refId: o.recurring.id });
    for (const o of [...ov.dueSoon, ...ov.upcoming].filter((o) => o.daysUntil <= Math.max(o.recurring.remind_days_before, settings.days_before)))
      out.push({ id: `bill:${o.recurring.id}:${o.date}`, kind: "bill_due", severity: o.daysUntil <= 1 ? "warning" : "info", title: o.recurring.name, date: o.date, amount: o.amount, days: o.daysUntil, href: "/bills", refId: o.recurring.id });
  }

  const horizon = addDays(today, settings.days_before);
  for (const loan of ds.loans) {
    if (loan.closed) continue;
    const borrowed = loan.direction === "borrowed";
    if (borrowed ? !settings.installments : !settings.receivables) continue;
    const s = loanStatus(loan, ds.transactions, today);
    if (s.isSettled || !s.nextDue) continue;
    const name = loan.title || contactName.get(loan.contact_id) || "—";
    const href = `/${borrowed ? "debts" : "receivables"}/${loan.id}`;
    if (s.isOverdue) {
      out.push({ id: `loan:${loan.id}:${s.nextDue.date}`, kind: borrowed ? "installment_overdue" : "receivable_overdue", severity: "danger", title: name, date: s.nextDue.date, amount: s.nextDue.amount, days: -s.daysOverdue, href, refId: loan.id });
    } else if (s.nextDue.date <= horizon) {
      out.push({ id: `loan:${loan.id}:${s.nextDue.date}`, kind: borrowed ? "installment_due" : "receivable_due", severity: "warning", title: name, date: s.nextDue.date, amount: s.nextDue.amount, days: daysBetween(today, s.nextDue.date), href, refId: loan.id });
    }
  }

  if (settings.budgets) {
    for (const row of budgetRows(ds, today)) {
      if (row.level === "ok") continue;
      out.push({
        id: `budget:${row.budget.id}:${row.level}`,
        kind: "budget",
        severity: row.level === "over" ? "danger" : row.level === "warn90" ? "warning" : "info",
        title: row.category ? row.category.name_bn || row.category.name : "",
        date: null,
        amount: row.remaining,
        days: null,
        ratio: row.ratio,
        href: "/budgets",
        refId: row.budget.id,
      });
    }
  }

  const rank: Record<Severity, number> = { danger: 0, warning: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.days ?? 0) - (b.days ?? 0));
}
