import type { Account, Dataset, Holding, HoldingValuation, ISODate, Paisa } from "./types";
import { computeBalances } from "./engine";
import { loanStatus } from "./loans";
import { billsOverview } from "./recurring";
import { monthEnd, monthsBetween } from "./dates";

export interface NetWorth {
  asOf: ISODate;
  /** cash, bank, MFS, savings and other liquid accounts with a positive balance */
  liquidAssets: Paisa;
  /** fixed deposits, investments, non-liquid holdings, money others owe you */
  nonLiquidAssets: Paisa;
  liquidAccounts: Paisa;
  nonLiquidAccounts: Paisa;
  totalAssets: Paisa;
  /** credit card / overdrawn balances */
  accountLiabilities: Paisa;
  debtPrincipal: Paisa;
  debtInterestDue: Paisa;
  receivables: Paisa;
  holdingAssets: Paisa;
  holdingLiabilities: Paisa;
  unpaidBills: Paisa;
  totalLiabilities: Paisa;
  netWorth: Paisa;
  /** money available to spend right now (liquid accounts, net of credit card debt NOT subtracted) */
  availableBalance: Paisa;
  accountBalances: Map<string, Paisa>;
}

/** Latest valuation on or before asOf. */
export function holdingValue(h: Holding, vals: HoldingValuation[], asOf: ISODate): Paisa {
  let best: HoldingValuation | null = null;
  for (const v of vals) {
    if (v.holding_id !== h.id || v.date > asOf) continue;
    if (!best || v.date > best.date) best = v;
  }
  return best?.value ?? 0;
}

/**
 * Net worth = total assets - total liabilities.
 *  - account balances: positive = asset (liquid or not per account), negative = liability
 *  - receivables: outstanding principal lent (non-liquid asset). Interest not yet received is NOT counted.
 *  - debts: outstanding principal + unpaid interest
 *  - goals are earmarks of account money and are deliberately NOT added (no double counting)
 *  - unpaid bills: overdue unpaid bill occurrences (only for today's figure)
 */
export function computeNetWorth(ds: Dataset, asOf: ISODate, opts: { includeBills?: boolean } = {}): NetWorth {
  const balances = computeBalances(ds.accounts, ds.transactions, asOf);
  let liquid = 0,
    nonLiquid = 0,
    accLiab = 0,
    available = 0;
  for (const acc of ds.accounts) {
    const b = balances.get(acc.id) ?? 0;
    if (b >= 0) {
      if (acc.is_liquid) liquid += b;
      else nonLiquid += b;
    } else accLiab += -b;
    if (acc.is_liquid && acc.type !== "credit_card" && !acc.archived) available += b;
  }

  let debtPrincipal = 0,
    debtInterest = 0,
    receivables = 0;
  const txsAsOf = ds.transactions.filter((t) => t.date <= asOf);
  for (const loan of ds.loans) {
    if (loan.closed || loan.start_date > asOf) continue;
    const s = loanStatus(loan, txsAsOf, asOf);
    if (loan.direction === "borrowed") {
      debtPrincipal += s.outstanding;
      debtInterest += s.interestDue;
    } else {
      receivables += s.outstanding;
    }
  }

  let holdingAssets = 0,
    holdingLiab = 0,
    holdingLiquid = 0;
  for (const h of ds.holdings) {
    const v = holdingValue(h, ds.holding_valuations, asOf);
    if (h.kind === "asset") {
      holdingAssets += v;
      if (h.is_liquid) holdingLiquid += v;
    } else holdingLiab += v;
  }

  let unpaidBills = 0;
  if (opts.includeBills) {
    const bills = billsOverview(
      ds.recurring.filter((r) => r.kind === "expense" && r.is_bill),
      ds.transactions,
      asOf,
      0,
    );
    unpaidBills = bills.overdue.reduce((a, o) => a + o.amount, 0);
  }

  const liquidAssets = liquid + holdingLiquid;
  const nonLiquidAssets = nonLiquid + receivables + (holdingAssets - holdingLiquid);
  const totalAssets = liquidAssets + nonLiquidAssets;
  const totalLiabilities = accLiab + debtPrincipal + debtInterest + holdingLiab + unpaidBills;
  return {
    asOf,
    liquidAssets,
    nonLiquidAssets,
    liquidAccounts: liquid,
    nonLiquidAccounts: nonLiquid,
    totalAssets,
    accountLiabilities: accLiab,
    debtPrincipal,
    debtInterestDue: debtInterest,
    receivables,
    holdingAssets,
    holdingLiabilities: holdingLiab,
    unpaidBills,
    totalLiabilities,
    netWorth: totalAssets - totalLiabilities,
    availableBalance: available,
    accountBalances: balances,
  };
}

/** Net worth at each month end between from and to (the current month uses `today`). */
export function netWorthHistory(ds: Dataset, from: ISODate, to: ISODate, today: ISODate) {
  return monthsBetween(from, to).map((mk) => {
    const end = monthEnd(`${mk}-01`);
    const asOf = end > today ? today : end;
    const nw = computeNetWorth(ds, asOf);
    return { month: mk, asOf, assets: nw.totalAssets, liabilities: nw.totalLiabilities, netWorth: nw.netWorth };
  });
}

export function accountsByType(accounts: Account[]) {
  const groups = new Map<string, Account[]>();
  for (const a of accounts) {
    const g = groups.get(a.type) ?? [];
    g.push(a);
    groups.set(a.type, g);
  }
  return groups;
}
