import { describe, expect, it } from "vitest";
import { parseAmount, formatMoney, toDecimalString, toPaisa, toBanglaDigits } from "../money";
import { nthOccurrence, parseLooseDate, monthsBetween } from "../dates";
import { loanStatus, accrueSimpleInterest, suggestSplit } from "../loans";
import { scheduleOccurrences, paymentIndex, billsOverview, monthlyEquivalent } from "../recurring";
import { budgetRows, budgetLevel, budgetsToCopy } from "../budgets";
import { goalProgress, allocationSummary } from "../goals";
import { prepareImport, guessColumns } from "../importer";
import { buildNotices } from "../notifications";
import { checkDraft, hasErrors } from "../validation";
import { monthlySeries, categoryByMonth } from "../reports";
import { computeNetWorth, netWorthHistory } from "../networth";
import { tx, loan, recurring, world } from "./fixtures";
import type { Dataset } from "../types";

describe("money", () => {
  it("parses amounts safely", () => {
    expect(parseAmount("1,250.50")).toBe(125050);
    expect(parseAmount("১২৫০")).toBe(125000);
    expect(parseAmount("৳ 500")).toBe(50000);
    expect(parseAmount("120+45-5")).toBe(16000);
    expect(parseAmount("0.1+0.2")).toBe(30);
    expect(parseAmount("1.234")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("-5")).toBeNull();
    expect(parseAmount("-5", { allowNegative: true })).toBe(-500);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("1e5")).toBeNull();
    expect(parseAmount("999999999999999")).toBeNull();
  });
  it("round-trips the database decimal format", () => {
    for (const p of [0, 1, 99, 100, 12345, -12345, -5, 99_999_999_999_99]) expect(toPaisa(toDecimalString(p))).toBe(p);
    expect(toDecimalString(-5)).toBe("-0.05");
    expect(toPaisa("0.29")).toBe(29); // 0.29*100 = 28.999999 in floating point
  });
  it("formats taka with lakh grouping and Bangla digits", () => {
    expect(formatMoney(1234567_00)).toBe("৳12,34,567");
    expect(formatMoney(1050)).toBe("৳10.50");
    expect(formatMoney(-50000, { banglaDigits: true })).toBe("-৳৫০০");
    expect(formatMoney(250_000_00, { short: true })).toBe("৳2.5L");
    expect(toBanglaDigits("2026")).toBe("২০২৬");
  });
});

describe("dates", () => {
  it("clamps month-end schedules without drifting", () => {
    expect(nthOccurrence("2026-01-31", "monthly", 1, 1)).toBe("2026-02-28");
    expect(nthOccurrence("2026-01-31", "monthly", 1, 2)).toBe("2026-03-31");
    expect(nthOccurrence("2026-01-15", "quarterly", 1, 1)).toBe("2026-04-15");
    expect(nthOccurrence("2024-02-29", "yearly", 1, 1)).toBe("2025-02-28");
    expect(nthOccurrence("2026-10-01", "weekly", 2, 1)).toBe("2026-10-15");
  });
  it("parses common date formats", () => {
    expect(parseLooseDate("09/10/2026")).toBe("2026-10-09");
    expect(parseLooseDate("2026-10-09")).toBe("2026-10-09");
    expect(parseLooseDate("৯/১০/২০২৬")).toBe("2026-10-09");
    expect(parseLooseDate("9 Oct 2026")).toBe("2026-10-09");
    expect(parseLooseDate("31/02/2026")).toBeNull();
    expect(parseLooseDate("hello")).toBeNull();
  });
  it("lists months inclusively", () => {
    expect(monthsBetween("2026-11-15", "2027-02-01")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
  });
});

describe("loans", () => {
  it("tracks partial repayments, interest and installments", () => {
    const w = world();
    const l = loan({
      direction: "borrowed",
      start_date: "2026-01-01",
      interest_type: "fixed",
      fixed_interest: 1_200_00,
      installment_amount: 10_200_00,
      installment_frequency: "monthly",
      installment_count: 3,
      first_installment_date: "2026-02-01",
    });
    const txs = [
      tx({ type: "borrow", account_id: w.bank.id, amount: 30_000_00, loan_id: l.id, date: "2026-01-01" }),
      tx({ type: "debt_repayment", account_id: w.bank.id, amount: 9_800_00, interest: 400_00, loan_id: l.id, date: "2026-02-01" }),
    ];
    const s = loanStatus(l, txs, "2026-03-05");
    expect(s.outstanding).toBe(20_200_00);
    expect(s.interestDue).toBe(800_00);
    expect(s.installments.map((i) => i.status)).toEqual(["paid", "overdue", "upcoming"]);
    expect(s.isOverdue).toBe(true);
    expect(s.daysOverdue).toBe(4);
    expect(s.nextDue).toEqual({ date: "2026-03-01", amount: 10_200_00 });
  });

  it("accrues simple interest on the outstanding principal", () => {
    const w = world();
    const l = loan({ start_date: "2026-01-01", interest_type: "simple_annual", interest_rate: 36.5, opening_principal: 10_000_00 });
    // 0.1% per day on 10,000 for 10 days = 100, then 5,000 for 10 days = 50
    const pay = tx({ type: "debt_repayment", account_id: w.bank.id, amount: 5_000_00, loan_id: l.id, date: "2026-01-11" });
    expect(accrueSimpleInterest(l, [pay], "2026-01-21")).toBe(150_00);
    const s = loanStatus(l, [pay], "2026-01-21");
    expect(s.interestDue).toBe(150_00);
    expect(suggestSplit(1_000_00, s)).toEqual({ principal: 850_00, interest: 150_00, exceedsOutstanding: false });
  });

  it("supports multiple loans to the same person and overdue due dates", () => {
    const w = world();
    const a = loan({ direction: "lent", contact_id: "p1", due_date: "2026-09-30" });
    const b = loan({ direction: "lent", contact_id: "p1", due_date: "2026-12-31" });
    const txs = [
      tx({ type: "lend", account_id: w.cash.id, amount: 1_000_00, loan_id: a.id, date: "2026-09-01" }),
      tx({ type: "lend", account_id: w.cash.id, amount: 2_000_00, loan_id: b.id, date: "2026-09-02" }),
      tx({ type: "collection", account_id: w.cash.id, amount: 500_00, loan_id: a.id, date: "2026-09-20" }),
    ];
    const sa = loanStatus(a, txs, "2026-10-09");
    const sb = loanStatus(b, txs, "2026-10-09");
    expect(sa.outstanding).toBe(500_00);
    expect(sa.isOverdue).toBe(true);
    expect(sb.outstanding).toBe(2_000_00);
    expect(sb.isOverdue).toBe(false);
  });

  it("marks a fully repaid loan settled and reports overpayment", () => {
    const w = world();
    const l = loan({ opening_principal: 1_000_00 });
    const s = loanStatus(l, [tx({ type: "debt_repayment", account_id: w.cash.id, amount: 1_200_00, loan_id: l.id })], "2026-10-09");
    expect(s.isSettled).toBe(true);
    expect(s.outstanding).toBe(0);
    expect(s.overpaid).toBe(200_00);
  });
});

describe("recurring bills", () => {
  it("is never marked paid without a recorded payment", () => {
    const w = world();
    const r = recurring({ start_date: "2026-08-05" });
    const pay = tx({ type: "expense", account_id: w.bank.id, amount: 1_200_00, category_id: w.food.id, recurring_id: r.id, occurrence_date: "2026-09-05", date: "2026-09-06" });
    const occ = scheduleOccurrences(r, paymentIndex([pay]), "2026-10-04", 40);
    expect(occ.map((o) => [o.date, o.status])).toEqual([
      ["2026-08-05", "overdue"],
      ["2026-09-05", "paid"],
      ["2026-10-05", "due_soon"],
      ["2026-11-05", "upcoming"],
    ]);
  });

  it("respects skipped dates, end dates and inactive schedules", () => {
    const r = recurring({ start_date: "2026-08-05", skipped_dates: ["2026-08-05"], end_date: "2026-09-30" });
    const occ = scheduleOccurrences(r, new Map(), "2026-10-04", 60);
    expect(occ.map((o) => o.status)).toEqual(["skipped", "overdue"]);
    const ov = billsOverview([{ ...r, active: false }], [], "2026-10-04");
    expect(ov.overdue).toHaveLength(0);
  });

  it("computes monthly equivalents", () => {
    expect(monthlyEquivalent(recurring({ frequency: "yearly", amount: 12_000_00 }))).toBe(1_000_00);
    expect(monthlyEquivalent(recurring({ frequency: "weekly", amount: 1_200_00 }))).toBe(5_200_00);
  });
});

describe("budgets", () => {
  it("tracks actual vs budget with 75/90/100% levels", () => {
    expect([budgetLevel(74, 100), budgetLevel(75, 100), budgetLevel(90, 100), budgetLevel(100, 100)]).toEqual(["ok", "warn75", "warn90", "over"]);
    const w = world();
    const ds: Dataset = {
      ...w.ds,
      transactions: [
        tx({ type: "expense", account_id: w.cash.id, amount: 8_000_00, category_id: w.groceries.id, date: "2026-10-03" }),
        tx({ type: "expense", account_id: w.cash.id, amount: 1_500_00, category_id: w.food.id, date: "2026-10-04" }),
        tx({ type: "expense", account_id: w.cash.id, amount: 3_000_00, category_id: w.shopping.id, date: "2026-10-04" }),
        tx({ type: "refund", account_id: w.cash.id, amount: 500_00, category_id: w.shopping.id, date: "2026-10-05" }),
        tx({ type: "expense", account_id: w.cash.id, amount: 99_000_00, category_id: w.shopping.id, date: "2026-09-04" }),
      ],
      budgets: [
        { id: "b0", month: "2026-10-01", category_id: null, amount: 15_000_00 },
        { id: "b1", month: "2026-10-01", category_id: w.food.id, amount: 10_000_00 },
        { id: "b2", month: "2026-10-01", category_id: w.groceries.id, amount: 10_000_00 },
        { id: "b3", month: "2026-10-01", category_id: w.shopping.id, amount: 10_000_00 },
      ],
    };
    const rows = new Map(budgetRows(ds, "2026-10-20").map((r) => [r.budget.id, r]));
    expect(rows.get("b0")!.spent).toBe(12_000_00);
    expect(rows.get("b0")!.level).toBe("warn75");
    expect(rows.get("b1")!.spent).toBe(9_500_00); // includes subcategory
    expect(rows.get("b1")!.level).toBe("warn90");
    expect(rows.get("b2")!.spent).toBe(8_000_00);
    expect(rows.get("b3")!.spent).toBe(2_500_00); // refund reduces
    expect(rows.get("b3")!.remaining).toBe(7_500_00);
  });

  it("copies budgets to a new month without overwriting", () => {
    const b = [
      { id: "1", month: "2026-09-01", category_id: null, amount: 1 },
      { id: "2", month: "2026-09-01", category_id: "c", amount: 2 },
      { id: "3", month: "2026-10-01", category_id: "c", amount: 9 },
    ];
    expect(budgetsToCopy(b, "2026-09-01", "2026-10-01")).toEqual([{ category_id: null, amount: 1 }]);
  });
});

describe("goals", () => {
  it("tracks contributions, withdrawals and monthly need", () => {
    const g = { id: "g", name: "Laptop", target_amount: 120_000_00, target_date: "2027-04-09", account_id: null, color: null, icon: null, archived: false, notes: null };
    const p = goalProgress(g, [
      { id: "1", goal_id: "g", date: "2026-09-01", amount: 30_000_00, notes: null },
      { id: "2", goal_id: "g", date: "2026-09-10", amount: -6_000_00, notes: null },
    ], "2026-10-09");
    expect(p.saved).toBe(24_000_00);
    expect(p.remaining).toBe(96_000_00);
    expect(p.monthlyNeeded).toBeGreaterThan(15_000_00);
    expect(p.monthlyNeeded).toBeLessThan(16_500_00);
    expect(allocationSummary([p], 20_000_00)).toEqual({ allocated: 24_000_00, unallocated: -4_000_00, overAllocated: true });
  });
});

describe("csv import", () => {
  it("validates rows, maps names and detects duplicates", () => {
    const w = world();
    const existing = tx({ type: "expense", account_id: w.cash.id, amount: 250_00, category_id: w.food.id, date: "2026-10-01", description: "Lunch" });
    const ds = { ...w.ds, transactions: [existing] };
    const rows = [
      { Date: "01/10/2026", Amount: "-250", Account: "cash", Category: "Food", Description: "lunch" }, // dup of existing
      { Date: "02/10/2026", Amount: "-300", Account: "Cash", Category: "Food > Groceries", Description: "Bazar" },
      { Date: "02/10/2026", Amount: "-300", Account: "Cash", Category: "Groceries", Description: "Bazar" }, // dup in file
      { Date: "03/10/2026", Amount: "60000", Account: "DBBL", Category: "Salary", Description: "" },
      { Date: "bad", Amount: "x", Account: "Nope", Category: "", Description: "" },
    ];
    const map = guessColumns(Object.keys(rows[0]));
    expect(map).toMatchObject({ date: "Date", amount: "Amount", account: "Account", category: "Category", description: "Description" });
    const out = prepareImport(rows, map, ds);
    expect(out.map((r) => r.status)).toEqual(["duplicate", "ok", "duplicate", "ok", "error"]);
    expect(out[0].duplicateOf).toBe("existing");
    expect(out[2].duplicateOf).toBe("file");
    expect(out[1].tx).toMatchObject({ type: "expense", amount: 300_00, category_id: w.groceries.id, date: "2026-10-02" });
    expect(out[3].tx).toMatchObject({ type: "income", category_id: w.salary.id, account_id: w.bank.id });
    expect(out[4].errors).toEqual(expect.arrayContaining(["import.err.date", "import.err.amount", "import.err.account:Nope"]));
  });

  it("handles explicit types and transfers", () => {
    const w = world();
    const out = prepareImport(
      [{ type: "Transfer", amount: "1000", account: "DBBL", "to account": "bKash", date: "2026-10-05" }],
      { type: "type", amount: "amount", account: "account", to_account: "to account", date: "date" },
      w.ds,
    );
    expect(out[0].status).toBe("ok");
    expect(out[0].tx).toMatchObject({ type: "transfer", account_id: w.bank.id, to_account_id: w.bkash.id, category_id: null });
  });
});

describe("validation", () => {
  it("rejects invalid drafts and warns on duplicates and overdrafts", () => {
    const w = world();
    const base = tx({ type: "expense", account_id: w.cash.id, amount: 100_00, category_id: w.food.id, date: "2026-10-01" });
    const ds = { ...w.ds, transactions: [base] };
    expect(hasErrors(checkDraft({ ...base, id: "n", category_id: w.salary.id }, ds, "2026-10-09"))).toBe(true);
    expect(checkDraft({ ...base, id: "n", type: "transfer", to_account_id: w.cash.id, category_id: null }, ds, "2026-10-09").errors.to_account_id).toBe("v.same_account");
    const dup = checkDraft({ ...base, id: "n" }, ds, "2026-10-09");
    expect(hasErrors(dup)).toBe(false);
    expect(dup.warnings).toContain("w.duplicate");
    expect(checkDraft({ ...base, id: "n", amount: 1_000_000_00 }, ds, "2026-10-09").warnings).toContain("w.insufficient");
    expect(checkDraft({ ...base, id: "n", amount: 0 }, ds, "2026-10-09").errors.amount).toBeDefined();
    expect(checkDraft({ ...base, id: "n", date: "2026-02-30" }, ds, "2026-10-09").errors.date).toBe("v.date");
  });
});

describe("notifications", () => {
  it("collects overdue bills, installments, receivables and budget alerts", () => {
    const w = world();
    const r = recurring({ start_date: "2026-10-05", category_id: w.food.id });
    const debt = loan({ direction: "borrowed", opening_principal: 5_000_00, due_date: "2026-10-10" });
    const rec = loan({ direction: "lent", opening_principal: 1_000_00, due_date: "2026-09-01" });
    const ds: Dataset = {
      ...w.ds,
      recurring: [r],
      loans: [debt, rec],
      contacts: [{ id: "contact-1", name: "Karim", kind: "person", phone: null, notes: null }],
      budgets: [{ id: "b", month: "2026-10-01", category_id: null, amount: 1_000_00 }],
      transactions: [tx({ type: "expense", account_id: w.cash.id, amount: 950_00, category_id: w.food.id, date: "2026-10-02" })],
    };
    const kinds = buildNotices(ds, "2026-10-09").map((n) => n.kind).sort();
    expect(kinds).toEqual(["bill_overdue", "budget", "installment_due", "receivable_overdue"]);
    const off = buildNotices(ds, "2026-10-09", { bills: false, installments: false, receivables: false, budgets: false, browser: false, days_before: 3 });
    expect(off).toHaveLength(0);
  });
});

describe("reports", () => {
  it("builds monthly series, category comparisons and net worth history from real data only", () => {
    const w = world();
    const ds: Dataset = {
      ...w.ds,
      transactions: [
        tx({ type: "income", account_id: w.bank.id, amount: 50_000_00, category_id: w.salary.id, date: "2026-09-01" }),
        tx({ type: "expense", account_id: w.bank.id, amount: 20_000_00, category_id: w.groceries.id, date: "2026-09-10" }),
        tx({ type: "expense", account_id: w.bank.id, amount: 10_000_00, category_id: w.shopping.id, date: "2026-10-10" }),
      ],
    };
    const series = monthlySeries(ds, "2026-09-01", "2026-10-31");
    expect(series).toEqual([
      { month: "2026-09", income: 50_000_00, expense: 20_000_00, savings: 30_000_00, savingsRate: 0.6, netCashFlow: 30_000_00 },
      { month: "2026-10", income: 0, expense: 10_000_00, savings: -10_000_00, savingsRate: NaN, netCashFlow: -10_000_00 },
    ]);
    const cbm = categoryByMonth(ds, "2026-09-01", "2026-10-31");
    expect(cbm.rows[0]).toEqual({ categoryId: w.food.id, values: [20_000_00, 0], total: 20_000_00 });
    const hist = netWorthHistory(ds, "2026-08-01", "2026-10-31", "2026-10-09");
    const nwNow = computeNetWorth(ds, "2026-10-09").netWorth;
    expect(hist.map((h) => h.netWorth)).toEqual([nwNow - 30_000_00, nwNow, nwNow]); // Oct 10 expense is after "today"
  });
});
