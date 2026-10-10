// All money values inside the app are integer paisa (৳1 = 100) to avoid floating point errors.
// Conversion to/from the database numeric(14,2) happens only in the data layer.
export type Paisa = number;
/** Date-only string, `YYYY-MM-DD`. Lexicographic order == chronological order. */
export type ISODate = string;

export type TxType =
  | "income"
  | "expense"
  | "transfer"
  | "borrow"
  | "lend"
  | "debt_repayment"
  | "collection"
  | "refund"
  | "adjustment";

export const TX_TYPES: TxType[] = [
  "expense",
  "income",
  "transfer",
  "lend",
  "borrow",
  "debt_repayment",
  "collection",
  "refund",
  "adjustment",
];

export type AccountType =
  | "cash"
  | "bank"
  | "bkash"
  | "nagad"
  | "rocket"
  | "mfs_other"
  | "savings"
  | "fixed_deposit"
  | "credit_card"
  | "investment"
  | "other";

export const ACCOUNT_TYPES: AccountType[] = [
  "cash",
  "bank",
  "bkash",
  "nagad",
  "rocket",
  "mfs_other",
  "savings",
  "fixed_deposit",
  "credit_card",
  "investment",
  "other",
];

/** Default liquidity per account type (user can override). */
export const DEFAULT_LIQUID: Record<AccountType, boolean> = {
  cash: true,
  bank: true,
  bkash: true,
  nagad: true,
  rocket: true,
  mfs_other: true,
  savings: true,
  fixed_deposit: false,
  credit_card: true,
  investment: false,
  other: true,
};

export type Frequency = "weekly" | "monthly" | "quarterly" | "yearly";
export const FREQUENCIES: Frequency[] = ["weekly", "monthly", "quarterly", "yearly"];

export interface Profile {
  id: string;
  display_name: string | null;
  locale: "bn" | "en";
  currency: string;
  date_format: "dd/MM/yyyy" | "MM/dd/yyyy" | "yyyy-MM-dd" | "d MMM yyyy";
  bangla_digits: boolean;
  theme: "light" | "dark" | "system";
  week_start: number;
  reminders: ReminderSettings;
}

export interface ReminderSettings {
  bills: boolean;
  installments: boolean;
  receivables: boolean;
  budgets: boolean;
  browser: boolean;
  days_before: number;
}

export const DEFAULT_REMINDERS: ReminderSettings = {
  bills: true,
  installments: true,
  receivables: true,
  budgets: true,
  browser: false,
  days_before: 3,
};

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  institution: string | null;
  last4: string | null;
  opening_balance: Paisa;
  opening_date: ISODate;
  credit_limit: Paisa | null;
  is_liquid: boolean;
  maturity_date: ISODate | null;
  interest_rate: number | null;
  color: string | null;
  sort_order: number;
  archived: boolean;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
}

export type CategoryKind = "income" | "expense";
export type SystemKey = "interest_paid" | "fees" | "interest_received";

export interface Category {
  id: string;
  kind: CategoryKind;
  name: string;
  name_bn: string | null;
  parent_id: string | null;
  color: string | null;
  icon: string | null;
  system_key: SystemKey | null;
  sort_order: number;
  archived: boolean;
  created_at?: string;
  updated_at?: string;
}

export type ContactKind = "person" | "bank" | "institution" | "other";
export interface Contact {
  id: string;
  name: string;
  kind: ContactKind;
  phone: string | null;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
}

export type InterestType = "none" | "fixed" | "simple_annual";
export type LoanDirection = "borrowed" | "lent";

export interface Loan {
  id: string;
  direction: LoanDirection;
  contact_id: string;
  title: string | null;
  opening_principal: Paisa;
  opening_interest_due: Paisa;
  start_date: ISODate;
  due_date: ISODate | null;
  interest_type: InterestType;
  interest_rate: number | null;
  fixed_interest: Paisa | null;
  installment_amount: Paisa | null;
  installment_frequency: Frequency | null;
  installment_count: number | null;
  first_installment_date: ISODate | null;
  notes: string | null;
  closed: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface Recurring {
  id: string;
  kind: CategoryKind;
  name: string;
  amount: Paisa;
  account_id: string | null;
  category_id: string | null;
  contact_id: string | null;
  frequency: Frequency;
  interval_count: number;
  start_date: ISODate;
  end_date: ISODate | null;
  skipped_dates: ISODate[];
  is_bill: boolean;
  remind_days_before: number;
  active: boolean;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Transaction {
  id: string;
  type: TxType;
  date: ISODate;
  /** Main amount. For debt_repayment/collection this is the PRINCIPAL part. For adjustment it is signed. */
  amount: Paisa;
  interest: Paisa;
  fee: Paisa;
  account_id: string;
  to_account_id: string | null;
  category_id: string | null;
  contact_id: string | null;
  loan_id: string | null;
  recurring_id: string | null;
  occurrence_date: ISODate | null;
  refund_of: string | null;
  description: string | null;
  notes: string | null;
  attachment_path: string | null;
  import_hash: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Budget {
  id: string;
  month: ISODate; // first day of month
  category_id: string | null; // null = overall
  amount: Paisa;
  created_at?: string;
  updated_at?: string;
}

export interface Goal {
  id: string;
  name: string;
  target_amount: Paisa;
  target_date: ISODate | null;
  account_id: string | null;
  color: string | null;
  icon: string | null;
  archived: boolean;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface GoalEntry {
  id: string;
  goal_id: string;
  date: ISODate;
  amount: Paisa; // + contribution, - withdrawal
  notes: string | null;
  created_at?: string;
}

export type HoldingKind = "asset" | "liability";
export type HoldingCategory =
  | "investment"
  | "property"
  | "vehicle"
  | "gold"
  | "business"
  | "provident_fund"
  | "other"
  | "bill"
  | "tax"
  | "loan"
  | "other_liability";

export const ASSET_CATEGORIES: HoldingCategory[] = [
  "investment",
  "property",
  "vehicle",
  "gold",
  "business",
  "provident_fund",
  "other",
];
export const LIABILITY_CATEGORIES: HoldingCategory[] = ["bill", "tax", "loan", "other_liability"];

export interface Holding {
  id: string;
  kind: HoldingKind;
  name: string;
  category: HoldingCategory;
  is_liquid: boolean;
  archived: boolean;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface HoldingValuation {
  id: string;
  holding_id: string;
  date: ISODate;
  value: Paisa;
  notes: string | null;
  created_at?: string;
}

export interface Dataset {
  profile: Profile | null;
  accounts: Account[];
  categories: Category[];
  contacts: Contact[];
  loans: Loan[];
  recurring: Recurring[];
  transactions: Transaction[];
  budgets: Budget[];
  goals: Goal[];
  goal_entries: GoalEntry[];
  holdings: Holding[];
  holding_valuations: HoldingValuation[];
}

export const EMPTY_DATASET: Dataset = {
  profile: null,
  accounts: [],
  categories: [],
  contacts: [],
  loans: [],
  recurring: [],
  transactions: [],
  budgets: [],
  goals: [],
  goal_entries: [],
  holdings: [],
  holding_valuations: [],
};

export type TableName = Exclude<keyof Dataset, "profile">;
