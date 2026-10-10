import type { Dataset, ISODate, Transaction } from "./types";
import { isISODate } from "./dates";
import { MAX_AMOUNT } from "./money";
import { computeBalances, findPossibleDuplicates } from "./engine";
import { loanStatus } from "./loans";

export type TxDraft = Omit<Transaction, "created_at" | "updated_at">;

export interface DraftCheck {
  errors: Partial<Record<keyof TxDraft | "total", string>>; // i18n keys
  warnings: string[]; // i18n keys
  duplicates: Transaction[];
}

const LOAN_TYPES = new Set(["borrow", "lend", "debt_repayment", "collection"]);

/** Mirrors the database constraints so problems are shown before saving, plus soft warnings. */
export function checkDraft(d: TxDraft, ds: Dataset, today: ISODate): DraftCheck {
  const errors: DraftCheck["errors"] = {};
  const warnings: string[] = [];
  const isInt = (n: number) => Number.isSafeInteger(n);

  if (!isISODate(d.date)) errors.date = "v.date";
  if (!d.account_id || !ds.accounts.some((a) => a.id === d.account_id)) errors.account_id = "v.account";

  for (const k of ["amount", "interest", "fee"] as const) {
    if (!isInt(d[k]) || Math.abs(d[k]) > MAX_AMOUNT) errors[k] = "v.amount";
  }
  if (d.type === "adjustment") {
    if (d.amount === 0) errors.amount = "v.amount_nonzero";
  } else {
    if (d.amount < 0) errors.amount = "v.amount_positive";
    if (d.interest < 0) errors.interest = "v.amount_positive";
    if (d.fee < 0) errors.fee = "v.amount_positive";
    const needsMain = !["debt_repayment", "collection"].includes(d.type);
    if (needsMain && d.amount <= 0) errors.amount = "v.amount_positive";
    if (!needsMain && d.amount + d.interest <= 0) errors.total = "v.payment_empty";
  }

  if (d.type === "transfer") {
    if (!d.to_account_id || !ds.accounts.some((a) => a.id === d.to_account_id)) errors.to_account_id = "v.to_account";
    else if (d.to_account_id === d.account_id) errors.to_account_id = "v.same_account";
  }

  if (d.type === "income" || d.type === "expense" || d.type === "refund") {
    const cat = ds.categories.find((c) => c.id === d.category_id);
    const want = d.type === "income" ? "income" : "expense";
    if (!cat) errors.category_id = "v.category";
    else if (cat.kind !== want) errors.category_id = "v.category_kind";
  }

  if (LOAN_TYPES.has(d.type)) {
    const loan = ds.loans.find((l) => l.id === d.loan_id);
    if (!loan) errors.loan_id = "v.loan";
    else {
      const wantDir = d.type === "borrow" || d.type === "debt_repayment" ? "borrowed" : "lent";
      if (loan.direction !== wantDir) errors.loan_id = "v.loan_direction";
      if (d.type === "debt_repayment" || d.type === "collection") {
        const others = ds.transactions.filter((t) => t.id !== d.id);
        const s = loanStatus(loan, others, today);
        if (d.amount > s.outstanding) warnings.push(d.type === "debt_repayment" ? "w.repay_exceeds" : "w.collect_exceeds");
      }
    }
  }

  // spending more than the account holds (allowed: cards / overdrafts / data entry order)
  if (!errors.account_id && ["expense", "transfer", "lend", "debt_repayment"].includes(d.type)) {
    const acc = ds.accounts.find((a) => a.id === d.account_id)!;
    if (acc.type !== "credit_card") {
      const bal = computeBalances([acc], ds.transactions.filter((t) => t.id !== d.id)).get(acc.id) ?? 0;
      const out = d.amount + d.interest + d.fee;
      if (out > bal) warnings.push("w.insufficient");
    }
  }

  if (!errors.date && d.date > today) warnings.push("w.future_date");
  const duplicates = Object.keys(errors).length ? [] : findPossibleDuplicates(d, ds.transactions);
  if (duplicates.length) warnings.push("w.duplicate");
  return { errors, warnings, duplicates };
}

export const hasErrors = (c: DraftCheck) => Object.keys(c.errors).length > 0;
