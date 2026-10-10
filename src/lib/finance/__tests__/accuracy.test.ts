/**
 * One test per "Financial Accuracy" requirement, plus edge cases.
 */
import { describe, expect, it } from "vitest";
import { computeBalances, summarize, runningBalances, findPossibleDuplicates } from "../engine";
import { computeNetWorth } from "../networth";
import { loanStatus } from "../loans";
import { goalProgress } from "../goals";
import { tx, loan, world } from "./fixtures";
import type { Dataset, Transaction } from "../types";

const M = { from: "2026-10-01", to: "2026-10-31" };
const bal = (ds: Dataset, accId: string, asOf?: string) => computeBalances(ds.accounts, ds.transactions, asOf).get(accId)!;
const withTx = (ds: Dataset, ...txs: Transaction[]): Dataset => ({ ...ds, transactions: [...ds.transactions, ...txs] });

describe("financial accuracy rules", () => {
  it("every transaction updates the right account balance", () => {
    const w = world();
    const ds = withTx(
      w.ds,
      tx({ type: "income", account_id: w.bank.id, amount: 60_000_00, category_id: w.salary.id }),
      tx({ type: "expense", account_id: w.cash.id, amount: 450_50, category_id: w.groceries.id }),
    );
    expect(bal(ds, w.bank.id)).toBe(110_000_00);
    expect(bal(ds, w.cash.id)).toBe(4_549_50);
    expect(bal(ds, w.bkash.id)).toBe(2_000_00);
  });

  it("transfers move money but are neither income nor expense", () => {
    const w = world();
    const ds = withTx(w.ds, tx({ type: "transfer", account_id: w.bank.id, to_account_id: w.bkash.id, amount: 10_000_00 }));
    expect(bal(ds, w.bank.id)).toBe(40_000_00);
    expect(bal(ds, w.bkash.id)).toBe(12_000_00);
    const s = summarize(ds, M.from, M.to);
    expect(s.income).toBe(0);
    expect(s.expense).toBe(0);
    expect(s.netCashFlow).toBe(0);
    expect(computeNetWorth(ds, "2026-10-31").netWorth).toBe(computeNetWorth(w.ds, "2026-10-31").netWorth);
  });

  it("transfer fee (e.g. bKash cash-out charge) is an expense and leaves the source account", () => {
    const w = world();
    const ds = withTx(w.ds, tx({ type: "transfer", account_id: w.bkash.id, to_account_id: w.cash.id, amount: 1_000_00, fee: 18_50 }));
    expect(bal(ds, w.bkash.id)).toBe(2_000_00 - 1_018_50);
    expect(bal(ds, w.cash.id)).toBe(6_000_00);
    const s = summarize(ds, M.from, M.to);
    expect(s.expense).toBe(18_50);
    expect(s.expenseByCategory.get(w.fees.id)).toBe(18_50);
    expect(s.income).toBe(0);
  });

  it("borrowed money is not income and creates a liability", () => {
    const w = world();
    const l = loan({ direction: "borrowed" });
    const ds = { ...withTx(w.ds, tx({ type: "borrow", account_id: w.cash.id, amount: 20_000_00, loan_id: l.id })), loans: [l] };
    expect(bal(ds, w.cash.id)).toBe(25_000_00);
    expect(summarize(ds, M.from, M.to).income).toBe(0);
    const before = computeNetWorth(w.ds, "2026-10-31");
    const after = computeNetWorth(ds, "2026-10-31");
    expect(after.debtPrincipal).toBe(20_000_00);
    expect(after.netWorth).toBe(before.netWorth); // +cash, +debt
  });

  it("loan principal repayment is not an ordinary expense; interest and fees are", () => {
    const w = world();
    const l = loan({ direction: "borrowed", opening_principal: 50_000_00 });
    const ds: Dataset = {
      ...withTx(w.ds, tx({ type: "debt_repayment", account_id: w.bank.id, amount: 10_000_00, interest: 500_00, fee: 20_00, loan_id: l.id })),
      loans: [l],
    };
    expect(bal(ds, w.bank.id)).toBe(50_000_00 - 10_520_00);
    const s = summarize(ds, M.from, M.to);
    expect(s.expense).toBe(520_00);
    expect(s.expenseByCategory.get(w.interestPaid.id)).toBe(500_00);
    expect(s.expenseByCategory.get(w.fees.id)).toBe(20_00);
    const st = loanStatus(l, ds.transactions, "2026-10-31");
    expect(st.outstanding).toBe(40_000_00);
    expect(st.interestPaid).toBe(500_00);
  });

  it("lending reduces available cash and creates a receivable (not an expense)", () => {
    const w = world();
    const l = loan({ direction: "lent" });
    const ds: Dataset = { ...withTx(w.ds, tx({ type: "lend", account_id: w.cash.id, amount: 3_000_00, loan_id: l.id })), loans: [l] };
    const nw = computeNetWorth(ds, "2026-10-31");
    expect(bal(ds, w.cash.id)).toBe(2_000_00);
    expect(nw.availableBalance).toBe(computeNetWorth(w.ds, "2026-10-31").availableBalance - 3_000_00);
    expect(nw.receivables).toBe(3_000_00);
    expect(summarize(ds, M.from, M.to).expense).toBe(0);
    expect(nw.netWorth).toBe(computeNetWorth(w.ds, "2026-10-31").netWorth);
  });

  it("collecting lent principal increases cash and reduces receivables; interest received is income", () => {
    const w = world();
    const l = loan({ direction: "lent" });
    const ds: Dataset = {
      ...withTx(
        w.ds,
        tx({ type: "lend", account_id: w.cash.id, amount: 3_000_00, loan_id: l.id, date: "2026-09-01" }),
        tx({ type: "collection", account_id: w.bkash.id, amount: 1_000_00, interest: 100_00, loan_id: l.id, date: "2026-10-10" }),
      ),
      loans: [l],
    };
    expect(bal(ds, w.bkash.id)).toBe(3_100_00);
    const nw = computeNetWorth(ds, "2026-10-31");
    expect(nw.receivables).toBe(2_000_00);
    const s = summarize(ds, M.from, M.to);
    expect(s.income).toBe(100_00);
    expect(s.incomeByCategory.get(w.interestReceived.id)).toBe(100_00);
  });

  it("refunds reduce the expense of their category", () => {
    const w = world();
    const buy = tx({ type: "expense", account_id: w.card.id, amount: 5_000_00, category_id: w.shopping.id, date: "2026-10-02" });
    const refund = tx({ type: "refund", account_id: w.card.id, amount: 2_000_00, category_id: w.shopping.id, refund_of: buy.id, date: "2026-10-05" });
    const ds = withTx(w.ds, buy, refund);
    const s = summarize(ds, M.from, M.to);
    expect(s.expense).toBe(3_000_00);
    expect(s.expenseByTopCategory.get(w.shopping.id)).toBe(3_000_00);
    expect(bal(ds, w.card.id)).toBe(-6_000_00);
  });

  it("opening balances are not income", () => {
    const w = world();
    const s = summarize(w.ds, "2026-01-01", "2026-12-31");
    expect(s.income).toBe(0);
    expect(s.netCashFlow).toBe(0);
    expect(bal(w.ds, w.bank.id)).toBe(50_000_00);
  });

  it("savings goals do not create extra assets", () => {
    const w = world();
    const goal = { id: "g1", name: "Emergency", target_amount: 100_000_00, target_date: null, account_id: w.bank.id, color: null, icon: null, archived: false, notes: null };
    const ds: Dataset = { ...w.ds, goals: [goal], goal_entries: [{ id: "e1", goal_id: "g1", date: "2026-10-01", amount: 20_000_00, notes: null }] };
    expect(computeNetWorth(ds, "2026-10-31").totalAssets).toBe(computeNetWorth(w.ds, "2026-10-31").totalAssets);
    expect(goalProgress(goal, ds.goal_entries, "2026-10-01").saved).toBe(20_000_00);
  });

  it("net worth = total assets - total liabilities", () => {
    const w = world();
    const debt = loan({ direction: "borrowed", opening_principal: 30_000_00, opening_interest_due: 1_000_00 });
    const rec = loan({ direction: "lent", opening_principal: 4_000_00 });
    const ds: Dataset = {
      ...w.ds,
      loans: [debt, rec],
      holdings: [
        { id: "h1", kind: "asset", name: "Gold", category: "gold", is_liquid: false, archived: false, notes: null },
        { id: "h2", kind: "liability", name: "Tax due", category: "tax", is_liquid: false, archived: false, notes: null },
      ],
      holding_valuations: [
        { id: "v1", holding_id: "h1", date: "2026-05-01", value: 80_000_00, notes: null },
        { id: "v2", holding_id: "h1", date: "2026-09-01", value: 90_000_00, notes: null },
        { id: "v3", holding_id: "h1", date: "2026-11-01", value: 99_000_00, notes: null },
        { id: "v4", holding_id: "h2", date: "2026-09-01", value: 5_000_00, notes: null },
      ],
    };
    const nw = computeNetWorth(ds, "2026-10-31");
    // assets: cash 5000 + bank 50000 + bkash 2000 (liquid) ; FD 100000 + receivable 4000 + gold 90000 (non-liquid)
    expect(nw.liquidAssets).toBe(57_000_00);
    expect(nw.nonLiquidAssets).toBe(194_000_00);
    expect(nw.totalAssets).toBe(251_000_00);
    // liabilities: card 3000 + debt 30000 + interest 1000 + tax 5000
    expect(nw.totalLiabilities).toBe(39_000_00);
    expect(nw.netWorth).toBe(nw.totalAssets - nw.totalLiabilities);
    expect(nw.netWorth).toBe(212_000_00);
    expect(nw.availableBalance).toBe(57_000_00);
  });

  it("editing or deleting a transaction recalculates balances and reports", () => {
    const w = world();
    const e = tx({ type: "expense", account_id: w.cash.id, amount: 1_000_00, category_id: w.food.id });
    let ds = withTx(w.ds, e);
    expect(bal(ds, w.cash.id)).toBe(4_000_00);
    // edit amount and move to another account
    ds = { ...ds, transactions: ds.transactions.map((t) => (t.id === e.id ? { ...t, amount: 1_500_00, account_id: w.bkash.id } : t)) };
    expect(bal(ds, w.cash.id)).toBe(5_000_00);
    expect(bal(ds, w.bkash.id)).toBe(500_00);
    expect(summarize(ds, M.from, M.to).expense).toBe(1_500_00);
    // delete
    ds = { ...ds, transactions: ds.transactions.filter((t) => t.id !== e.id) };
    expect(bal(ds, w.bkash.id)).toBe(2_000_00);
    expect(summarize(ds, M.from, M.to).expense).toBe(0);
  });

  it("balance adjustments change balances without touching income/expense", () => {
    const w = world();
    const ds = withTx(w.ds, tx({ type: "adjustment", account_id: w.cash.id, amount: -250_00 }));
    expect(bal(ds, w.cash.id)).toBe(4_750_00);
    const s = summarize(ds, M.from, M.to);
    expect(s.income + s.expense).toBe(0);
  });

  it("balances as of a past date ignore later transactions and later opening dates", () => {
    const w = world();
    const ds = withTx(w.ds, tx({ type: "expense", account_id: w.cash.id, amount: 1_000_00, category_id: w.food.id, date: "2026-10-15" }));
    expect(bal(ds, w.cash.id, "2026-10-14")).toBe(5_000_00);
    expect(bal(ds, w.cash.id, "2026-10-15")).toBe(4_000_00);
    expect(bal(ds, w.cash.id, "2025-12-31")).toBe(0);
  });

  it("running balance follows chronological order", () => {
    const w = world();
    const a = tx({ type: "expense", account_id: w.cash.id, amount: 100_00, category_id: w.food.id, date: "2026-10-03" });
    const b = tx({ type: "income", account_id: w.cash.id, amount: 1_000_00, category_id: w.salary.id, date: "2026-10-01" });
    const rb = runningBalances(w.cash, [a, b]);
    expect(rb.get(b.id)).toBe(6_000_00);
    expect(rb.get(a.id)).toBe(5_900_00);
  });

  it("flags likely duplicates but not the record being edited", () => {
    const w = world();
    const e = tx({ type: "expense", account_id: w.cash.id, amount: 500_00, category_id: w.food.id });
    expect(findPossibleDuplicates({ ...e, id: "new" }, [e])).toHaveLength(1);
    expect(findPossibleDuplicates(e, [e])).toHaveLength(0);
    expect(findPossibleDuplicates({ ...e, id: "new", amount: 501_00 }, [e])).toHaveLength(0);
  });

  it("subcategory spending rolls up to its parent", () => {
    const w = world();
    const ds = withTx(
      w.ds,
      tx({ type: "expense", account_id: w.cash.id, amount: 300_00, category_id: w.groceries.id }),
      tx({ type: "expense", account_id: w.cash.id, amount: 200_00, category_id: w.food.id }),
    );
    const s = summarize(ds, M.from, M.to);
    expect(s.expenseByTopCategory.get(w.food.id)).toBe(500_00);
    expect(s.expenseByCategory.get(w.groceries.id)).toBe(300_00);
  });

  it("credit card spending is expense and a liability, paying the card is a transfer", () => {
    const w = world();
    const ds = withTx(
      w.ds,
      tx({ type: "expense", account_id: w.card.id, amount: 2_000_00, category_id: w.shopping.id }),
      tx({ type: "transfer", account_id: w.bank.id, to_account_id: w.card.id, amount: 5_000_00 }),
    );
    expect(bal(ds, w.card.id)).toBe(0);
    const s = summarize(ds, M.from, M.to);
    expect(s.expense).toBe(2_000_00);
    expect(computeNetWorth(ds, "2026-10-31").accountLiabilities).toBe(0);
  });
});
