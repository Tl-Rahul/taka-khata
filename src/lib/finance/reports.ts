import type { Budget, Category, Dataset, ISODate, Paisa } from "./types";
import { categoryMap, summarize, topCategoryId } from "./engine";
import { monthEnd, monthsBetween } from "./dates";

export interface MonthRow {
  month: string; // YYYY-MM
  income: Paisa;
  expense: Paisa;
  savings: Paisa;
  savingsRate: number;
  netCashFlow: Paisa;
}

export function monthlySeries(ds: Pick<Dataset, "transactions" | "categories">, from: ISODate, to: ISODate): MonthRow[] {
  return monthsBetween(from, to).map((m) => {
    const s = summarize(ds, `${m}-01`, monthEnd(`${m}-01`));
    return { month: m, income: s.income, expense: s.expense, savings: s.savings, savingsRate: s.savingsRate, netCashFlow: s.netCashFlow };
  });
}

/** Top-level expense category totals for each month — for month-over-month comparison. */
export function categoryByMonth(
  ds: Pick<Dataset, "transactions" | "categories">,
  from: ISODate,
  to: ISODate,
): { months: string[]; rows: Array<{ categoryId: string; values: Paisa[]; total: Paisa }> } {
  const months = monthsBetween(from, to);
  const totals = new Map<string, Paisa[]>();
  months.forEach((m, i) => {
    const s = summarize(ds, `${m}-01`, monthEnd(`${m}-01`));
    for (const [cat, v] of s.expenseByTopCategory) {
      const arr = totals.get(cat) ?? new Array(months.length).fill(0);
      arr[i] += v;
      totals.set(cat, arr);
    }
  });
  const rows = [...totals.entries()]
    .map(([categoryId, values]) => ({ categoryId, values, total: values.reduce((a, b) => a + b, 0) }))
    .filter((r) => r.total !== 0)
    .sort((a, b) => b.total - a.total);
  return { months, rows };
}

/** Budget vs actual for each month in range (overall budgets). */
export function budgetVsActual(ds: Pick<Dataset, "transactions" | "categories" | "budgets">, from: ISODate, to: ISODate) {
  return monthsBetween(from, to).map((m) => {
    const s = summarize(ds, `${m}-01`, monthEnd(`${m}-01`));
    const monthBudgets = ds.budgets.filter((b: Budget) => b.month === `${m}-01`);
    const overall = monthBudgets.find((b) => !b.category_id)?.amount ?? null;
    const categorySum = monthBudgets.filter((b) => b.category_id).reduce((a, b) => a + b.amount, 0);
    return { month: m, budget: overall ?? (categorySum || null), actual: s.expense };
  });
}

/** Change of a category's spend vs the previous period, for "spending trends". */
export function trendVsPrevious(current: Map<string, Paisa>, previous: Map<string, Paisa>) {
  const keys = new Set([...current.keys(), ...previous.keys()]);
  return [...keys]
    .map((k) => {
      const c = current.get(k) ?? 0;
      const p = previous.get(k) ?? 0;
      return { categoryId: k, current: c, previous: p, change: c - p, ratio: p > 0 ? (c - p) / p : null };
    })
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
}

export function categoryLabel(id: string, cats: Map<string, Category>, locale: "bn" | "en", fallback: Record<string, string>): string {
  const c = cats.get(id);
  if (!c) return fallback[id] ?? "—";
  const name = locale === "bn" ? c.name_bn || c.name : c.name;
  if (!c.parent_id) return name;
  const p = cats.get(c.parent_id);
  const pn = p ? (locale === "bn" ? p.name_bn || p.name : p.name) : "";
  return pn ? `${pn} › ${name}` : name;
}

export { categoryMap, topCategoryId };
