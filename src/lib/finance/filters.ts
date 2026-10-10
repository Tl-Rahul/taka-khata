import type { Category, Contact, ISODate, Loan, Paisa, Transaction, TxType } from "./types";
import { accountEffects, compareTxAsc, normalizeText } from "./engine";

export interface TxFilters {
  q: string;
  types: TxType[];
  accountId: string;
  categoryId: string; // matches category or its subcategories
  contactId: string;
  from: ISODate | "";
  to: ISODate | "";
  min: Paisa | null;
  max: Paisa | null;
  sort: "date_desc" | "date_asc" | "amount_desc" | "amount_asc";
}

export const EMPTY_FILTERS: TxFilters = { q: "", types: [], accountId: "", categoryId: "", contactId: "", from: "", to: "", min: null, max: null, sort: "date_desc" };

/** Total money that moved in a transaction (what the user thinks of as "the amount"). */
export function grossAmount(t: Transaction): Paisa {
  switch (t.type) {
    case "debt_repayment":
      return t.amount + t.interest + t.fee;
    case "collection":
      return t.amount + t.interest;
    case "adjustment":
      return Math.abs(t.amount);
    default:
      return t.amount;
  }
}

/** +1 money in, -1 money out, 0 internal move (from the user's overall perspective). */
export function direction(t: Transaction): 1 | -1 | 0 {
  switch (t.type) {
    case "income":
    case "borrow":
    case "collection":
    case "refund":
      return 1;
    case "expense":
    case "lend":
    case "debt_repayment":
      return -1;
    case "transfer":
      return 0;
    case "adjustment":
      return t.amount >= 0 ? 1 : -1;
  }
}

/** Change to one specific account. */
export function deltaFor(t: Transaction, accountId: string): Paisa {
  return accountEffects(t)
    .filter((e) => e.accountId === accountId)
    .reduce((a, e) => a + e.delta, 0);
}

export function applyFilters(
  txs: Transaction[],
  f: TxFilters,
  ctx: { categories: Category[]; loans: Loan[]; contacts: Contact[]; accountsById: Map<string, { name: string }> },
): Transaction[] {
  const q = normalizeText(f.q);
  const catSet = f.categoryId ? new Set([f.categoryId, ...ctx.categories.filter((c) => c.parent_id === f.categoryId).map((c) => c.id)]) : null;
  const loanContact = new Map(ctx.loans.map((l) => [l.id, l.contact_id]));
  const catName = new Map(ctx.categories.map((c) => [c.id, `${c.name} ${c.name_bn ?? ""}`]));
  const contactName = new Map(ctx.contacts.map((c) => [c.id, c.name]));
  const out = txs.filter((t) => {
    if (f.types.length && !f.types.includes(t.type)) return false;
    if (f.accountId && t.account_id !== f.accountId && t.to_account_id !== f.accountId) return false;
    if (catSet && !(t.category_id && catSet.has(t.category_id))) return false;
    if (f.contactId) {
      const cid = t.contact_id ?? (t.loan_id ? loanContact.get(t.loan_id) : null);
      if (cid !== f.contactId) return false;
    }
    if (f.from && t.date < f.from) return false;
    if (f.to && t.date > f.to) return false;
    const g = grossAmount(t);
    if (f.min !== null && g < f.min) return false;
    if (f.max !== null && g > f.max) return false;
    if (q) {
      const person = t.loan_id ? contactName.get(loanContact.get(t.loan_id) ?? "") : t.contact_id ? contactName.get(t.contact_id) : "";
      const hay = normalizeText(
        [t.description, t.notes, catName.get(t.category_id ?? ""), person, ctx.accountsById.get(t.account_id)?.name, ctx.accountsById.get(t.to_account_id ?? "")?.name, String(g / 100)].join(" "),
      );
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const cmp: Record<TxFilters["sort"], (a: Transaction, b: Transaction) => number> = {
    date_desc: (a, b) => -compareTxAsc(a, b),
    date_asc: compareTxAsc,
    amount_desc: (a, b) => grossAmount(b) - grossAmount(a),
    amount_asc: (a, b) => grossAmount(a) - grossAmount(b),
  };
  return out.sort(cmp[f.sort]);
}
