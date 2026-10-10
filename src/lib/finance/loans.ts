import type { ISODate, Loan, Paisa, Transaction } from "./types";
import { compareTxAsc } from "./engine";
import { daysBetween, nthOccurrence } from "./dates";

export interface Installment {
  index: number; // 1-based
  date: ISODate;
  amount: Paisa;
  /** cumulative amount (principal + interest) that should be paid by this installment */
  cumulative: Paisa;
  status: "paid" | "partial" | "due" | "overdue" | "upcoming";
}

export interface LoanStatus {
  loan: Loan;
  transactions: Transaction[]; // oldest first
  /** opening principal + all disbursements */
  principalTotal: Paisa;
  disbursed: Paisa;
  principalPaid: Paisa;
  /** principal still owed (never below 0) */
  outstanding: Paisa;
  /** principal paid/collected beyond what was owed */
  overpaid: Paisa;
  interestAccrued: Paisa;
  interestPaid: Paisa;
  /** unpaid interest = opening interest due + accrued - paid (never below 0) */
  interestDue: Paisa;
  feesPaid: Paisa;
  totalPaid: Paisa; // principal + interest (fees excluded)
  lastPaymentDate: ISODate | null;
  isSettled: boolean;
  isOverdue: boolean;
  daysOverdue: number;
  nextDue: { date: ISODate; amount: Paisa } | null;
  installments: Installment[];
}

const DISBURSE = new Set(["borrow", "lend"]);
const PAYMENT = new Set(["debt_repayment", "collection"]);

/**
 * Simple interest accrued from start_date to asOf on the outstanding principal, day by day
 * (annual rate / 365). Each disbursement and principal payment changes the base from its date.
 */
export function accrueSimpleInterest(loan: Loan, txs: Transaction[], asOf: ISODate): Paisa {
  if (loan.interest_type !== "simple_annual" || !loan.interest_rate) return 0;
  const daily = loan.interest_rate / 100 / 365;
  const events: Array<{ date: ISODate; delta: Paisa }> = [{ date: loan.start_date, delta: loan.opening_principal }];
  for (const t of txs) {
    if (DISBURSE.has(t.type)) events.push({ date: t.date, delta: t.amount });
    else if (PAYMENT.has(t.type)) events.push({ date: t.date, delta: -t.amount });
  }
  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let principal = 0;
  let cursor: ISODate | null = null;
  let interest = 0;
  for (const e of events) {
    if (e.date > asOf) break;
    if (cursor !== null && principal > 0) interest += principal * daily * daysBetween(cursor, e.date);
    principal = Math.max(0, principal + e.delta);
    cursor = e.date;
  }
  if (cursor !== null && principal > 0 && asOf > cursor) interest += principal * daily * daysBetween(cursor, asOf);
  return Math.round(interest);
}

export function installmentSchedule(loan: Loan): Array<{ index: number; date: ISODate; amount: Paisa }> {
  if (!loan.installment_amount || !loan.installment_frequency || !loan.first_installment_date) return [];
  const count = loan.installment_count ?? 0;
  if (count <= 0) return [];
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({
      index: i + 1,
      date: nthOccurrence(loan.first_installment_date, loan.installment_frequency, 1, i),
      amount: loan.installment_amount,
    });
  }
  return out;
}

export function loanStatus(loan: Loan, allTxs: Transaction[], today: ISODate): LoanStatus {
  const txs = allTxs.filter((t) => t.loan_id === loan.id).sort(compareTxAsc);
  let disbursed = 0,
    principalPaid = 0,
    interestPaid = 0,
    feesPaid = 0;
  let lastPaymentDate: ISODate | null = null;
  for (const t of txs) {
    if (DISBURSE.has(t.type)) disbursed += t.amount;
    else if (PAYMENT.has(t.type)) {
      principalPaid += t.amount;
      interestPaid += t.interest;
      lastPaymentDate = t.date;
    }
    feesPaid += t.fee;
  }
  const principalTotal = loan.opening_principal + disbursed;
  const rawOutstanding = principalTotal - principalPaid;
  const outstanding = Math.max(0, rawOutstanding);
  const overpaid = Math.max(0, -rawOutstanding);

  let interestAccrued = 0;
  if (loan.interest_type === "fixed") interestAccrued = loan.fixed_interest ?? 0;
  else if (loan.interest_type === "simple_annual") interestAccrued = accrueSimpleInterest(loan, txs, today);
  const interestDue = Math.max(0, loan.opening_interest_due + interestAccrued - interestPaid);
  const totalPaid = principalPaid + interestPaid;
  const isSettled = loan.closed || (outstanding === 0 && interestDue === 0 && principalTotal > 0);

  // installment tracking: payments (principal + interest) fill installments in order
  const schedule = installmentSchedule(loan);
  let cumulative = 0;
  const installments: Installment[] = schedule.map((s) => {
    const before = cumulative;
    cumulative += s.amount;
    let status: Installment["status"];
    if (totalPaid >= cumulative) status = "paid";
    else if (totalPaid > before) status = s.date < today ? "overdue" : "partial";
    else if (s.date < today) status = "overdue";
    else if (s.date === today) status = "due";
    else status = "upcoming";
    return { ...s, cumulative, status };
  });

  let nextDue: LoanStatus["nextDue"] = null;
  let isOverdue = false;
  let daysOverdue = 0;
  if (!isSettled) {
    const firstUnpaid = installments.find((i) => i.status !== "paid");
    if (firstUnpaid) {
      const remaining = Math.min(firstUnpaid.cumulative - totalPaid, outstanding + interestDue || firstUnpaid.amount);
      nextDue = { date: firstUnpaid.date, amount: Math.max(0, remaining) };
      if (firstUnpaid.date < today) {
        isOverdue = true;
        daysOverdue = daysBetween(firstUnpaid.date, today);
      }
    } else if (loan.due_date) {
      nextDue = { date: loan.due_date, amount: outstanding + interestDue };
      if (loan.due_date < today) {
        isOverdue = true;
        daysOverdue = daysBetween(loan.due_date, today);
      }
    }
  }

  return {
    loan,
    transactions: txs,
    principalTotal,
    disbursed,
    principalPaid,
    outstanding,
    overpaid,
    interestAccrued,
    interestPaid,
    interestDue,
    feesPaid,
    totalPaid,
    lastPaymentDate,
    isSettled,
    isOverdue,
    daysOverdue,
    nextDue,
    installments,
  };
}

export interface LoanTotals {
  outstanding: Paisa;
  interestDue: Paisa;
  overdueCount: number;
  activeCount: number;
}

export function loanTotals(statuses: LoanStatus[]): LoanTotals {
  return statuses.reduce<LoanTotals>(
    (acc, s) => {
      if (s.loan.closed) return acc;
      acc.outstanding += s.outstanding;
      acc.interestDue += s.interestDue;
      if (!s.isSettled) acc.activeCount++;
      if (s.isOverdue) acc.overdueCount++;
      return acc;
    },
    { outstanding: 0, interestDue: 0, overdueCount: 0, activeCount: 0 },
  );
}

/**
 * Split a payment into interest and principal: interest due is settled first (common practice),
 * the rest goes to principal. Used to pre-fill repayment/collection forms; user can override.
 */
export function suggestSplit(total: Paisa, status: Pick<LoanStatus, "interestDue" | "outstanding">) {
  const interest = Math.min(total, status.interestDue);
  const principal = total - interest;
  return { principal, interest, exceedsOutstanding: principal > status.outstanding };
}
