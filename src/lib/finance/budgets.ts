import type { Budget, Category, Dataset, ISODate, Paisa } from "./types";
import { categoryMap, summarize } from "./engine";
import { monthEnd, monthStart } from "./dates";

export type BudgetLevel = "ok" | "warn75" | "warn90" | "over";

export function budgetLevel(spent: Paisa, budget: Paisa): BudgetLevel {
  if (budget <= 0) return "ok";
  const r = spent / budget;
  if (r >= 1) return "over";
  if (r >= 0.9) return "warn90";
  if (r >= 0.75) return "warn75";
  return "ok";
}

export interface BudgetRow {
  budget: Budget;
  category: Category | null; // null = overall
  spent: Paisa;
  remaining: Paisa; // negative when over
  ratio: number;
  level: BudgetLevel;
}

/**
 * Actual spending vs budget for one month. A budget on a top-level category includes its
 * subcategories; a budget on a subcategory includes only that subcategory. Refunds reduce spending.
 */
export function budgetRows(ds: Pick<Dataset, "transactions" | "categories" | "budgets">, month: ISODate): BudgetRow[] {
  const from = monthStart(month);
  const to = monthEnd(month);
  const s = summarize(ds, from, to);
  const cmap = categoryMap(ds.categories);
  return ds.budgets
    .filter((b) => b.month === from)
    .map((b) => {
      let spent: Paisa;
      let category: Category | null = null;
      if (!b.category_id) spent = s.expense;
      else {
        category = cmap.get(b.category_id) ?? null;
        spent = category && !category.parent_id
          ? s.expenseByTopCategory.get(b.category_id) ?? 0
          : s.expenseByCategory.get(b.category_id) ?? 0;
      }
      spent = Math.max(0, spent);
      return {
        budget: b,
        category,
        spent,
        remaining: b.amount - spent,
        ratio: b.amount > 0 ? spent / b.amount : 0,
        level: budgetLevel(spent, b.amount),
      };
    })
    .sort((a, b) => (a.category ? 1 : 0) - (b.category ? 1 : 0) || b.ratio - a.ratio);
}

/** Budgets of `fromMonth` to copy into `toMonth`, skipping ones that already exist there. */
export function budgetsToCopy(budgets: Budget[], fromMonth: ISODate, toMonth: ISODate): Array<Pick<Budget, "category_id" | "amount">> {
  const existing = new Set(budgets.filter((b) => b.month === toMonth).map((b) => b.category_id ?? "overall"));
  return budgets
    .filter((b) => b.month === fromMonth && !existing.has(b.category_id ?? "overall"))
    .map((b) => ({ category_id: b.category_id, amount: b.amount }));
}
