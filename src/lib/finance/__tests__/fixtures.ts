import type { Account, Category, Dataset, Loan, Recurring, Transaction } from "../types";
import { EMPTY_DATASET } from "../types";

let n = 0;
const id = (p: string) => `${p}-${++n}`;

export function account(over: Partial<Account> = {}): Account {
  return {
    id: id("acc"),
    name: "Cash",
    type: "cash",
    institution: null,
    last4: null,
    opening_balance: 0,
    opening_date: "2026-01-01",
    credit_limit: null,
    is_liquid: true,
    maturity_date: null,
    interest_rate: null,
    color: null,
    sort_order: 0,
    archived: false,
    notes: null,
    ...over,
  };
}

export function category(over: Partial<Category> = {}): Category {
  return {
    id: id("cat"),
    kind: "expense",
    name: "Food",
    name_bn: null,
    parent_id: null,
    color: null,
    icon: null,
    system_key: null,
    sort_order: 0,
    archived: false,
    ...over,
  };
}

export function tx(over: Partial<Transaction> & Pick<Transaction, "type" | "account_id">): Transaction {
  return {
    id: id("tx"),
    date: "2026-10-01",
    amount: 0,
    interest: 0,
    fee: 0,
    to_account_id: null,
    category_id: null,
    contact_id: null,
    loan_id: null,
    recurring_id: null,
    occurrence_date: null,
    refund_of: null,
    description: null,
    notes: null,
    attachment_path: null,
    import_hash: null,
    ...over,
  };
}

export function loan(over: Partial<Loan> = {}): Loan {
  return {
    id: id("loan"),
    direction: "borrowed",
    contact_id: "contact-1",
    title: null,
    opening_principal: 0,
    opening_interest_due: 0,
    start_date: "2026-01-01",
    due_date: null,
    interest_type: "none",
    interest_rate: null,
    fixed_interest: null,
    installment_amount: null,
    installment_frequency: null,
    installment_count: null,
    first_installment_date: null,
    notes: null,
    closed: false,
    ...over,
  };
}

export function recurring(over: Partial<Recurring> = {}): Recurring {
  return {
    id: id("rec"),
    kind: "expense",
    name: "Internet",
    amount: 1200_00,
    account_id: null,
    category_id: null,
    contact_id: null,
    frequency: "monthly",
    interval_count: 1,
    start_date: "2026-01-05",
    end_date: null,
    skipped_dates: [],
    is_bill: true,
    remind_days_before: 3,
    active: true,
    notes: null,
    ...over,
  };
}

/** A small realistic world used by several tests. */
export function world() {
  const cash = account({ name: "Cash", opening_balance: 5_000_00 });
  const bank = account({ name: "DBBL", type: "bank", opening_balance: 50_000_00 });
  const bkash = account({ name: "bKash", type: "bkash", opening_balance: 2_000_00 });
  const card = account({ name: "Visa", type: "credit_card", opening_balance: -3_000_00 });
  const fd = account({ name: "FD", type: "fixed_deposit", is_liquid: false, opening_balance: 100_000_00 });
  const food = category({ name: "Food" });
  const groceries = category({ name: "Groceries", parent_id: food.id });
  const shopping = category({ name: "Shopping" });
  const salary = category({ name: "Salary", kind: "income" });
  const interestPaid = category({ name: "Interest paid", system_key: "interest_paid" });
  const fees = category({ name: "Fees", system_key: "fees" });
  const interestReceived = category({ name: "Interest received", kind: "income", system_key: "interest_received" });
  const ds: Dataset = {
    ...EMPTY_DATASET,
    accounts: [cash, bank, bkash, card, fd],
    categories: [food, groceries, shopping, salary, interestPaid, fees, interestReceived],
  };
  return { ds, cash, bank, bkash, card, fd, food, groceries, shopping, salary, interestPaid, fees, interestReceived };
}
