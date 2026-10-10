/**
 * The accounting rules. Every balance, total and chart in the app is derived here from the
 * raw ledger, so there is exactly one definition of each number.
 */
import type { Account, Category, Dataset, ISODate, Paisa, SystemKey, Transaction } from "./types";
import { inRange } from "./dates";

// ---------------------------------------------------------------------------
// Account effects
// ---------------------------------------------------------------------------

/** Signed change each transaction makes to account balances. */
export function accountEffects(tx: Transaction): Array<{ accountId: string; delta: Paisa }> {
  const a = tx.account_id;
  switch (tx.type) {
    case "income":
      return [{ accountId: a, delta: tx.amount - tx.fee }];
    case "expense":
      return [{ accountId: a, delta: -tx.amount }];
    case "transfer":
      return [
        { accountId: a, delta: -(tx.amount + tx.fee) },
        { accountId: tx.to_account_id!, delta: tx.amount },
      ];
    case "borrow":
      return [{ accountId: a, delta: tx.amount - tx.fee }];
    case "lend":
      return [{ accountId: a, delta: -(tx.amount + tx.fee) }];
    case "debt_repayment":
      return [{ accountId: a, delta: -(tx.amount + tx.interest + tx.fee) }];
    case "collection":
      return [{ accountId: a, delta: tx.amount + tx.interest - tx.fee }];
    case "refund":
      return [{ accountId: a, delta: tx.amount }];
    case "adjustment":
      return [{ accountId: a, delta: tx.amount }];
  }
}

/** Balance of every account as of `asOf` (inclusive). Without asOf: all transactions. */
export function computeBalances(
  accounts: Account[],
  txs: Transaction[],
  asOf?: ISODate,
): Map<string, Paisa> {
  const bal = new Map<string, Paisa>();
  for (const acc of accounts) {
    bal.set(acc.id, !asOf || asOf >= acc.opening_date ? acc.opening_balance : 0);
  }
  for (const tx of txs) {
    if (asOf && tx.date > asOf) continue;
    for (const { accountId, delta } of accountEffects(tx)) {
      if (bal.has(accountId)) bal.set(accountId, bal.get(accountId)! + delta);
    }
  }
  return bal;
}

/** Running balance per transaction for one account (newest first, matching list order). */
export function runningBalances(account: Account, txs: Transaction[]): Map<string, Paisa> {
  const relevant = txs
    .filter((t) => t.account_id === account.id || t.to_account_id === account.id)
    .sort(compareTxAsc);
  const out = new Map<string, Paisa>();
  let bal = account.opening_balance;
  for (const t of relevant) {
    for (const e of accountEffects(t)) if (e.accountId === account.id) bal += e.delta;
    out.set(t.id, bal);
  }
  return out;
}

export function compareTxAsc(a: Transaction, b: Transaction): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const ca = a.created_at ?? "";
  const cb = b.created_at ?? "";
  if (ca !== cb) return ca < cb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
export const compareTxDesc = (a: Transaction, b: Transaction) => -compareTxAsc(a, b);

// ---------------------------------------------------------------------------
// Income / expense classification
// ---------------------------------------------------------------------------

export interface CategoryAmount {
  categoryId: string;
  amount: Paisa; // negative for refunds
}

export interface Classification {
  income: CategoryAmount[];
  expense: CategoryAmount[];
}

/** id used when a system category is missing (e.g. deleted by the user) */
export const SYSTEM_FALLBACK: Record<SystemKey, string> = {
  interest_paid: "sys:interest_paid",
  fees: "sys:fees",
  interest_received: "sys:interest_received",
};

export function systemCategoryIds(categories: Category[]): Record<SystemKey, string> {
  const out = { ...SYSTEM_FALLBACK };
  for (const c of categories) if (c.system_key) out[c.system_key] = c.id;
  return out;
}

/**
 * What a transaction contributes to income and expenses.
 *  - transfers, borrowing, lending, principal repayments/collections, adjustments: nothing
 *  - interest paid & all fees: expense;  interest received: income
 *  - refunds: negative expense in the refunded category
 */
export function classify(tx: Transaction, sys: Record<SystemKey, string>): Classification {
  const income: CategoryAmount[] = [];
  const expense: CategoryAmount[] = [];
  switch (tx.type) {
    case "income":
      income.push({ categoryId: tx.category_id!, amount: tx.amount });
      break;
    case "expense":
      expense.push({ categoryId: tx.category_id!, amount: tx.amount });
      break;
    case "refund":
      expense.push({ categoryId: tx.category_id!, amount: -tx.amount });
      break;
    case "debt_repayment":
      if (tx.interest) expense.push({ categoryId: sys.interest_paid, amount: tx.interest });
      break;
    case "collection":
      if (tx.interest) income.push({ categoryId: sys.interest_received, amount: tx.interest });
      break;
    default:
      break;
  }
  if (tx.fee) expense.push({ categoryId: sys.fees, amount: tx.fee });
  return { income, expense };
}

// ---------------------------------------------------------------------------
// Category helpers
// ---------------------------------------------------------------------------

export function categoryMap(categories: Category[]) {
  return new Map(categories.map((c) => [c.id, c]));
}

/** Top-level category id for a (sub)category id. */
export function topCategoryId(id: string, map: Map<string, Category>): string {
  const c = map.get(id);
  return c?.parent_id ?? id;
}

// ---------------------------------------------------------------------------
// Period summary
// ---------------------------------------------------------------------------

export interface PeriodSummary {
  income: Paisa;
  expense: Paisa;
  /** income - expense */
  savings: Paisa;
  savingsRate: number; // savings / income, NaN when no income
  /** Net change of all account balances (includes loans, excludes internal transfers except fees). */
  netCashFlow: Paisa;
  expenseByCategory: Map<string, Paisa>; // leaf category id -> amount
  expenseByTopCategory: Map<string, Paisa>;
  incomeByCategory: Map<string, Paisa>;
  incomeByTopCategory: Map<string, Paisa>;
  txCount: number;
}

export function summarize(ds: Pick<Dataset, "transactions" | "categories">, from: ISODate, to: ISODate): PeriodSummary {
  const sys = systemCategoryIds(ds.categories);
  const cmap = categoryMap(ds.categories);
  const s: PeriodSummary = {
    income: 0,
    expense: 0,
    savings: 0,
    savingsRate: NaN,
    netCashFlow: 0,
    expenseByCategory: new Map(),
    expenseByTopCategory: new Map(),
    incomeByCategory: new Map(),
    incomeByTopCategory: new Map(),
    txCount: 0,
  };
  const add = (m: Map<string, Paisa>, k: string, v: Paisa) => m.set(k, (m.get(k) ?? 0) + v);
  for (const tx of ds.transactions) {
    if (!inRange(tx.date, from, to)) continue;
    s.txCount++;
    const c = classify(tx, sys);
    for (const x of c.income) {
      s.income += x.amount;
      add(s.incomeByCategory, x.categoryId, x.amount);
      add(s.incomeByTopCategory, topCategoryId(x.categoryId, cmap), x.amount);
    }
    for (const x of c.expense) {
      s.expense += x.amount;
      add(s.expenseByCategory, x.categoryId, x.amount);
      add(s.expenseByTopCategory, topCategoryId(x.categoryId, cmap), x.amount);
    }
    for (const e of accountEffects(tx)) s.netCashFlow += e.delta;
  }
  s.savings = s.income - s.expense;
  s.savingsRate = s.income > 0 ? s.savings / s.income : NaN;
  return s;
}

/** Sorted [categoryId, amount] pairs, largest first, dropping zero/negative totals. */
export function rankCategories(m: Map<string, Paisa>): Array<[string, Paisa]> {
  return [...m.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
}

// ---------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------

export function normalizeText(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function txFingerprint(t: Pick<Transaction, "type" | "date" | "amount" | "account_id" | "to_account_id" | "description">): string {
  return [t.type, t.date, t.amount, t.account_id, t.to_account_id ?? "", normalizeText(t.description)].join("|");
}

/** Likely duplicates of a draft: same type, date, amount and account (ignores itself when editing). */
export function findPossibleDuplicates(
  draft: Pick<Transaction, "id" | "type" | "date" | "amount" | "account_id" | "to_account_id">,
  txs: Transaction[],
): Transaction[] {
  return txs.filter(
    (t) =>
      t.id !== draft.id &&
      t.type === draft.type &&
      t.date === draft.date &&
      t.amount === draft.amount &&
      t.account_id === draft.account_id &&
      (t.to_account_id ?? null) === (draft.to_account_id ?? null),
  );
}
