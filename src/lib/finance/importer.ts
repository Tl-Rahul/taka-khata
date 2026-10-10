import type { Account, Category, Dataset, ISODate, Paisa, Transaction, TxType } from "./types";
import { parseLooseDate } from "./dates";
import { parseAmount } from "./money";
import { normalizeText, txFingerprint } from "./engine";

export type ImportField = "date" | "type" | "amount" | "account" | "to_account" | "category" | "description" | "notes";
export const IMPORT_FIELDS: ImportField[] = ["date", "type", "amount", "account", "to_account", "category", "description", "notes"];
export type ColumnMap = Partial<Record<ImportField, string>>;

const HEADER_GUESSES: Record<ImportField, string[]> = {
  date: ["date", "তারিখ", "transaction date", "txn date", "value date"],
  type: ["type", "ধরন", "transaction type", "dr/cr", "debit/credit"],
  amount: ["amount", "পরিমাণ", "টাকা", "value", "amount (bdt)", "amount (tk)"],
  account: ["account", "অ্যাকাউন্ট", "wallet", "from account", "from"],
  to_account: ["to account", "to", "destination"],
  category: ["category", "ক্যাটাগরি", "বিভাগ", "subcategory"],
  description: ["description", "বিবরণ", "details", "narration", "particulars", "payee", "title"],
  notes: ["notes", "note", "নোট", "memo", "remarks"],
};

export function guessColumns(headers: string[]): ColumnMap {
  const map: ColumnMap = {};
  const norm = headers.map((h) => normalizeText(h));
  for (const f of IMPORT_FIELDS) {
    const idx = norm.findIndex((h) => HEADER_GUESSES[f].includes(h));
    if (idx >= 0) map[f] = headers[idx];
  }
  return map;
}

const TYPE_WORDS: Record<string, TxType> = {
  income: "income", আয়: "income", credit: "income", cr: "income", deposit: "income", in: "income",
  expense: "expense", খরচ: "expense", ব্যয়: "expense", debit: "expense", dr: "expense", withdrawal: "expense", out: "expense",
  transfer: "transfer", ট্রান্সফার: "transfer", স্থানান্তর: "transfer",
  refund: "refund", রিফান্ড: "refund", ফেরত: "refund",
};

export interface ImportRow {
  line: number; // 1-based data row number
  raw: Record<string, string>;
  status: "ok" | "duplicate" | "error";
  errors: string[]; // i18n keys with optional ":detail"
  duplicateOf: "existing" | "file" | null;
  tx: Omit<Transaction, "id"> | null;
  hash: string | null;
}

function findAccount(name: string, accounts: Account[]): Account | undefined {
  const n = normalizeText(name);
  return accounts.find((a) => normalizeText(a.name) === n) ?? accounts.find((a) => a.last4 && n.endsWith(a.last4));
}

function findCategory(name: string, kind: "income" | "expense", cats: Category[]): Category | undefined {
  const raw = normalizeText(name);
  // allow "Parent > Child" / "Parent › Child" / "Parent / Child"
  const parts = raw.split(/\s*[>›/]\s*/).filter(Boolean);
  const pool = cats.filter((c) => c.kind === kind && !c.archived);
  const match = (c: Category, s: string) => normalizeText(c.name) === s || normalizeText(c.name_bn) === s;
  if (parts.length >= 2) {
    const parent = pool.find((c) => !c.parent_id && match(c, parts[0]));
    if (parent) {
      const child = pool.find((c) => c.parent_id === parent.id && match(c, parts[parts.length - 1]));
      if (child) return child;
    }
  }
  const last = parts[parts.length - 1] ?? raw;
  return pool.find((c) => !c.parent_id && match(c, last)) ?? pool.find((c) => match(c, last));
}

/**
 * Validate CSV rows into draft transactions. Nothing is saved here — the UI shows this preview
 * and imports only after explicit confirmation.
 * Supported types: income, expense, transfer, refund. Without a type column a negative amount
 * means expense and a positive amount means income.
 */
export function prepareImport(
  rows: Record<string, string>[],
  map: ColumnMap,
  ds: Pick<Dataset, "accounts" | "categories" | "transactions">,
  defaults: { accountId?: string } = {},
): ImportRow[] {
  const existing = new Set(ds.transactions.map((t) => txFingerprint(t)));
  const existingHashes = new Set(ds.transactions.map((t) => t.import_hash).filter(Boolean) as string[]);
  const seen = new Set<string>();
  const accounts = ds.accounts.filter((a) => !a.archived);
  return rows.map((raw, i) => {
    const get = (f: ImportField) => (map[f] ? String(raw[map[f]!] ?? "").trim() : "");
    const errors: string[] = [];

    const date: ISODate | null = parseLooseDate(get("date"));
    if (!date) errors.push("import.err.date");

    const amountRaw = get("amount").replace(/[()]/g, (m) => (m === "(" ? "-" : ""));
    const signed: Paisa | null = parseAmount(amountRaw, { allowNegative: true });
    if (signed === null || signed === 0) errors.push("import.err.amount");

    let type: TxType | undefined;
    const typeText = normalizeText(get("type"));
    if (typeText) {
      type = TYPE_WORDS[typeText];
      if (!type) errors.push(`import.err.type:${get("type")}`);
    } else if (signed !== null) {
      type = signed < 0 ? "expense" : "income";
    }

    const accName = get("account");
    const account = accName ? findAccount(accName, accounts) : accounts.find((a) => a.id === defaults.accountId);
    if (!account) errors.push(accName ? `import.err.account:${accName}` : "import.err.no_account");

    let toAccountId: string | null = null;
    if (type === "transfer") {
      const to = findAccount(get("to_account"), accounts);
      if (!to) errors.push("import.err.to_account");
      else if (account && to.id === account.id) errors.push("import.err.same_account");
      else toAccountId = to.id;
    }

    let categoryId: string | null = null;
    if (type === "income" || type === "expense" || type === "refund") {
      const kind = type === "income" ? "income" : "expense";
      const catName = get("category");
      const cat = catName ? findCategory(catName, kind, ds.categories) : undefined;
      if (!cat) errors.push(catName ? `import.err.category:${catName}` : "import.err.no_category");
      else categoryId = cat.id;
    }

    if (errors.length || !date || signed === null || !type || !account) {
      return { line: i + 1, raw, status: "error", errors, duplicateOf: null, tx: null, hash: null };
    }

    const tx: Omit<Transaction, "id"> = {
      type,
      date,
      amount: Math.abs(signed),
      interest: 0,
      fee: 0,
      account_id: account.id,
      to_account_id: toAccountId,
      category_id: categoryId,
      contact_id: null,
      loan_id: null,
      recurring_id: null,
      occurrence_date: null,
      refund_of: null,
      description: get("description").slice(0, 200) || null,
      notes: get("notes").slice(0, 2000) || null,
      attachment_path: null,
      import_hash: null,
    };
    const hash = txFingerprint(tx);
    tx.import_hash = hash;
    let duplicateOf: ImportRow["duplicateOf"] = null;
    if (existing.has(hash) || existingHashes.has(hash)) duplicateOf = "existing";
    else if (seen.has(hash)) duplicateOf = "file";
    seen.add(hash);
    return { line: i + 1, raw, status: duplicateOf ? "duplicate" : "ok", errors: [], duplicateOf, tx, hash };
  });
}
