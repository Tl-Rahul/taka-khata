"use client";
import { useMemo } from "react";
import { useData } from "./DataProvider";
import { categoryMap, systemCategoryIds } from "@/lib/finance/engine";
import { computeNetWorth } from "@/lib/finance/networth";
import { loanStatus, type LoanStatus } from "@/lib/finance/loans";
import { buildNotices } from "@/lib/finance/notifications";
import { DEFAULT_REMINDERS, type Account, type Contact, type Loan } from "@/lib/finance/types";

/** Memoized numbers shared across pages. Recomputed whenever any saved data changes. */
export function useDerived() {
  const { ds, today } = useData();
  return useMemo(() => {
    const cmap = categoryMap(ds.categories);
    const sys = systemCategoryIds(ds.categories);
    const accountMap = new Map<string, Account>(ds.accounts.map((a) => [a.id, a]));
    const contactMap = new Map<string, Contact>(ds.contacts.map((c) => [c.id, c]));
    const loanMap = new Map<string, Loan>(ds.loans.map((l) => [l.id, l]));
    const nw = computeNetWorth(ds, today, { includeBills: true });
    const loanStatuses = new Map<string, LoanStatus>(ds.loans.map((l) => [l.id, loanStatus(l, ds.transactions, today)]));
    const notices = buildNotices(ds, today, ds.profile?.reminders ?? DEFAULT_REMINDERS);
    const activeAccounts = ds.accounts
      .filter((a) => !a.archived)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    return { cmap, sys, accountMap, contactMap, loanMap, nw, balances: nw.accountBalances, loanStatuses, notices, activeAccounts };
  }, [ds, today]);
}

export function loanName(loan: Loan, contacts: Map<string, Contact>): string {
  const person = contacts.get(loan.contact_id)?.name ?? "—";
  return loan.title ? `${person} · ${loan.title}` : person;
}
