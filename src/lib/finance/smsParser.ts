/**
 * Understands transaction SMS from Bangladeshi mobile wallets and banks
 * (bKash, Nagad, Rocket, Upay, and common bank debit/credit alerts).
 *
 * Rule based and free: no data leaves the device. Anything it can't read
 * confidently is reported with `confidence: "low"` so the person reviews it.
 */
import type { Account, Category, ISODate, Paisa, TxType } from "./types";
import { parseLooseDate } from "./dates";
import { fromBanglaDigits } from "./money";

export type SmsProvider = "bkash" | "nagad" | "rocket" | "upay" | "bank" | "unknown";
export type SmsKind =
  | "received" // money came in from a person
  | "sent" // send money to a person
  | "payment" // merchant payment
  | "cash_out"
  | "cash_in"
  | "recharge"
  | "bill"
  | "add_money" // wallet <- bank/card
  | "transfer_out" // wallet/bank -> bank/card
  | "salary"
  | "credit" // generic bank credit
  | "debit" // generic bank debit
  | "refund"
  | "unknown";

export interface ParsedSms {
  provider: SmsProvider;
  kind: SmsKind;
  direction: "in" | "out" | null;
  amount: Paisa | null;
  fee: Paisa;
  balance: Paisa | null;
  trxId: string | null;
  counterparty: string | null;
  last4: string | null;
  date: ISODate | null;
  confidence: "high" | "low";
  /** short readable summary, e.g. "bKash · Send Money · 01712XXXXXX" */
  summary: string;
}

const MONEY = String.raw`(?:tk\.?|bdt|taka|৳)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)`;
const MONEY_AFTER = String.raw`([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(?:tk\.?|bdt|taka|৳)`;

function toPaisaStr(s: string | undefined): Paisa | null {
  if (!s) return null;
  const n = Number(s.replace(/,/g, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function firstMoney(text: string, near?: RegExp): Paisa | null {
  if (near) {
    const m = new RegExp(near.source + String.raw`[:\s]*` + MONEY, "i").exec(text) ?? new RegExp(near.source + String.raw`[:\s]*` + MONEY_AFTER, "i").exec(text);
    if (m) return toPaisaStr(m[1]);
    const m2 = new RegExp(near.source + String.raw`[:\s]*([0-9][0-9,]*(?:\.[0-9]{1,2})?)`, "i").exec(text);
    if (m2) return toPaisaStr(m2[1]);
    return null;
  }
  const m = new RegExp(MONEY, "i").exec(text) ?? new RegExp(MONEY_AFTER, "i").exec(text);
  return m ? toPaisaStr(m[1]) : null;
}

export function detectProvider(text: string, sender?: string | null): SmsProvider {
  const s = `${sender ?? ""} ${text}`.toLowerCase();
  if (/bkash/.test(s)) return "bkash";
  if (/nagad/.test(s)) return "nagad";
  if (/rocket|16216|dbbl ?mobile/.test(s)) return "rocket";
  if (/upay/.test(s)) return "upay";
  if (/a\/c|acct|account|card|debited|credited|bank|atm|pos\b|npsb|beftn|rtgs/.test(s)) return "bank";
  // wallet SMS rarely name the brand; the sender does (bKash/NAGAD). Pasted text: use the ID style.
  if (/\btrx\s*id\b/.test(s)) return "bkash";
  if (/\btxn\s*id\b/.test(s)) return "nagad";
  return "unknown";
}

const KIND_RULES: Array<[RegExp, SmsKind]> = [
  [/cash\s*out/i, "cash_out"],
  [/cash\s*in/i, "cash_in"],
  [/add\s*money|added\s+to\s+your\s+(?:bkash|nagad|wallet)/i, "add_money"],
  [/(?:transfer(?:red)?|send)\s+(?:money\s+)?to\s+(?:your\s+)?(?:bank|card|a\/c)|bkash\s*to\s*bank|nagad\s*to\s*bank/i, "transfer_out"],
  [/mobile\s*recharge|recharge|top\s*-?\s*up|airtime/i, "recharge"],
  [/pay\s*bill|bill\s*payment|bill\s+paid/i, "bill"],
  [/salary|disburs/i, "salary"],
  [/refund|reversal|reversed/i, "refund"],
  [/(?:you\s+have\s+)?received|money\s+received|receive\s+money/i, "received"],
  [/send\s*money|sent\s+(?:tk|bdt|৳)|you\s+have\s+sent|money\s+sent/i, "sent"],
  [/payment|paid\s+to|merchant|make\s+payment/i, "payment"],
  [/credited|deposit(?:ed)?|cr\.?\s/i, "credit"],
  [/debited|withdraw(?:n|al)?|purchase|pos\s|dr\.?\s/i, "debit"],
];

const DIRECTION: Record<SmsKind, "in" | "out" | null> = {
  received: "in",
  sent: "out",
  payment: "out",
  cash_out: "out",
  cash_in: "in",
  recharge: "out",
  bill: "out",
  add_money: "in",
  transfer_out: "out",
  salary: "in",
  credit: "in",
  debit: "out",
  refund: "in",
  unknown: null,
};

const KIND_LABEL: Record<SmsKind, string> = {
  received: "Received",
  sent: "Send Money",
  payment: "Payment",
  cash_out: "Cash Out",
  cash_in: "Cash In",
  recharge: "Recharge",
  bill: "Bill",
  add_money: "Add Money",
  transfer_out: "Transfer",
  salary: "Salary",
  credit: "Credit",
  debit: "Debit",
  refund: "Refund",
  unknown: "Unknown",
};

const PROVIDER_LABEL: Record<SmsProvider, string> = {
  bkash: "bKash",
  nagad: "Nagad",
  rocket: "Rocket",
  upay: "Upay",
  bank: "Bank",
  unknown: "SMS",
};

/** Does this look like a money SMS at all (vs OTP, promo)? */
export function isTransactionSms(text: string): boolean {
  const t = fromBanglaDigits(text);
  if (/\b(otp|verification code|one[- ]time|pin is|password)\b/i.test(t)) return false;
  if (!new RegExp(MONEY, "i").test(t) && !new RegExp(MONEY_AFTER, "i").test(t)) return false;
  return /received|sent|payment|paid|cash\s*(?:out|in)|recharge|debited|credited|deposit|withdraw|transfer|add\s*money|bill|trx|txn|refund|salary|purchase/i.test(t);
}

export function parseSms(raw: string, sender?: string | null): ParsedSms {
  const text = fromBanglaDigits(raw).replace(/\s+/g, " ").trim();
  const provider = detectProvider(text, sender);

  let kind: SmsKind = "unknown";
  for (const [re, k] of KIND_RULES) {
    if (re.test(text)) {
      kind = k;
      break;
    }
  }
  // "Money Received" banners that also mention "Send Money" by the sender
  if (kind === "sent" && /^(?:money\s+)?received|you\s+have\s+received/i.test(text)) kind = "received";

  // amount: prefer the number right after the action word, else the first money value
  let amount: Paisa | null =
    firstMoney(text, /amount/) ??
    firstMoney(text, /(?:received|sent|payment(?:\s+of)?|paid|cash\s*out|cash\s*in|recharge|debited\s+(?:by|with|for)?|credited\s+(?:by|with)?|deposit(?:ed)?(?:\s+of)?|withdrawn?|transfer(?:red)?|add\s*money)/) ??
    firstMoney(text);
  const fee = firstMoney(text, /(?:fee|charge|vat)/) ?? 0;
  const balance = firstMoney(text, /(?:balance|bal\.?|avl\.?\s*bal|available\s+balance|current\s+balance)/);
  // never take the balance as the amount
  if (amount !== null && balance !== null && amount === balance) {
    const all = [...text.matchAll(new RegExp(MONEY, "gi"))].map((m) => toPaisaStr(m[1])).filter((x): x is Paisa => x !== null);
    const other = all.find((x) => x !== balance && x !== fee);
    if (other !== undefined) amount = other;
  }

  const trx = /(?:trx\s*id|txn\s*id|trxid|txnid|transaction\s*id|ref(?:erence)?\s*(?:no|id)?)[:.\s#]*([A-Z0-9]{6,})/i.exec(text);
  const trxId = trx ? trx[1].toUpperCase() : null;

  const phone = /(?:to|from|sender|receiver|recipient)[:\s]*(?:a\/c\s*)?(\+?8?801[0-9X*]{9}|01[0-9X*]{9})/i.exec(text) ?? /(\+?8?801[0-9]{9}|01[0-9]{9})/.exec(text);
  const merchant = /(?:to|at|merchant)[:\s]+([A-Z][A-Za-z0-9&.' -]{2,40}?)(?:\s+(?:successful|is|was|on|at|ref|trx|txn|fee|balance)\b|[.,]|$)/.exec(text);
  const counterparty = phone ? phone[1] : merchant ? merchant[1].trim() : null;

  const last4m = /(?:a\/c|acct?|account|card)(?:\s*no\.?)?[\s:#]*(?:[x*]+|\d+[x*]+)?(\d{3,4})\b/i.exec(text);
  const last4 = provider === "bank" && last4m ? last4m[1].padStart(4, "0").slice(-4) : null;

  let date: ISODate | null = null;
  const dm =
    /(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/.exec(text) ??
    /(\d{1,2}[- ](?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[- ,]+\d{2,4})/i.exec(text) ??
    /(\d{4}-\d{2}-\d{2})/.exec(text);
  if (dm) {
    let d = dm[1].replace(/-(\d{2})$/, (_, y) => `-20${y}`).replace(/\/(\d{2})$/, (_, y) => `/20${y}`);
    d = d.replace(/^(\d{1,2})[- ]([a-z]+)[- ,]+(\d{4})$/i, "$1 $2 $3");
    date = parseLooseDate(d);
  }

  const direction = DIRECTION[kind];
  const confidence: ParsedSms["confidence"] = amount !== null && amount > 0 && direction !== null && provider !== "unknown" ? "high" : "low";
  const summary = [PROVIDER_LABEL[provider], KIND_LABEL[kind], counterparty].filter(Boolean).join(" · ");
  return { provider, kind, direction, amount, fee, balance, trxId, counterparty, last4, date, confidence, summary };
}

/** Split pasted text that may contain several SMS into separate messages. */
export function splitMessages(text: string): string[] {
  const parts = text
    .split(/\n\s*\n|(?=(?:You have received|You have sent|Money Received|Send Money|Cash Out|Cash In|Payment|Your A\/C|Dear Customer)\b)/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 15);
  return parts.length ? parts : [text.trim()].filter(Boolean);
}

// ---------------------------------------------------------------------------
// Turning a parsed SMS into a suggested transaction
// ---------------------------------------------------------------------------

export interface SmsSuggestion {
  type: TxType;
  accountId: string | null;
  toAccountId: string | null;
  categoryId: string | null;
  amount: Paisa;
  fee: Paisa;
  date: ISODate;
  description: string;
  importHash: string;
}

const PROVIDER_ACCOUNT: Partial<Record<SmsProvider, Account["type"]>> = { bkash: "bkash", nagad: "nagad", rocket: "rocket", upay: "mfs_other" };

export function findAccountFor(p: ParsedSms, accounts: Account[]): Account | null {
  const active = accounts.filter((a) => !a.archived);
  const t = PROVIDER_ACCOUNT[p.provider];
  if (t) return active.find((a) => a.type === t) ?? active.find((a) => a.name.toLowerCase().includes(p.provider)) ?? null;
  if (p.provider === "bank") {
    if (p.last4) {
      const byLast4 = active.find((a) => a.last4 === p.last4);
      if (byLast4) return byLast4;
    }
    const banks = active.filter((a) => a.type === "bank" || a.type === "savings" || a.type === "credit_card");
    return banks.length === 1 ? banks[0] : null;
  }
  return null;
}

function categoryByName(categories: Category[], kind: "income" | "expense", names: string[]): string | null {
  const pool = categories.filter((c) => c.kind === kind && !c.archived);
  for (const n of names) {
    const c = pool.find((x) => x.name.toLowerCase() === n.toLowerCase());
    if (c) return c.id;
  }
  return null;
}

/** Simple hash so the same SMS is never imported twice. */
export function smsHash(p: ParsedSms, raw: string): string {
  if (p.trxId) return `sms:${p.provider}:${p.trxId}`;
  let h = 0;
  const s = raw.replace(/\s+/g, " ").trim();
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return `sms:${p.provider}:h${(h >>> 0).toString(36)}`;
}

export function suggestTransaction(
  p: ParsedSms,
  raw: string,
  ctx: { accounts: Account[]; categories: Category[]; today: ISODate },
): SmsSuggestion | null {
  if (p.amount === null || p.amount <= 0 || p.direction === null) return null;
  const account = findAccountFor(p, ctx.accounts);
  const cash = ctx.accounts.find((a) => a.type === "cash" && !a.archived) ?? null;
  const date = p.date ?? ctx.today;
  const base = { accountId: account?.id ?? null, amount: p.amount, fee: p.fee, date, importHash: smsHash(p, raw) };
  const desc = p.summary;
  switch (p.kind) {
    case "cash_out":
      // wallet -> cash in hand: a transfer, the fee is an expense
      return { ...base, type: "transfer", toAccountId: cash?.id ?? null, categoryId: null, description: desc };
    case "cash_in":
      return { ...base, type: "transfer", accountId: cash?.id ?? null, toAccountId: account?.id ?? null, categoryId: null, fee: 0, description: desc };
    case "add_money": {
      const bank = ctx.accounts.find((a) => (a.type === "bank" || a.type === "credit_card") && !a.archived) ?? null;
      return { ...base, type: "transfer", accountId: bank?.id ?? null, toAccountId: account?.id ?? null, categoryId: null, fee: 0, description: desc };
    }
    case "transfer_out": {
      const bank = ctx.accounts.find((a) => a.type === "bank" && !a.archived && a.id !== account?.id) ?? null;
      return { ...base, type: "transfer", toAccountId: bank?.id ?? null, categoryId: null, description: desc };
    }
    case "refund":
      return { ...base, type: "refund", toAccountId: null, fee: 0, categoryId: categoryByName(ctx.categories, "expense", ["Shopping", "Other expense"]), description: desc };
    case "salary":
      return { ...base, type: "income", toAccountId: null, categoryId: categoryByName(ctx.categories, "income", ["Basic salary", "Salary"]), description: desc };
    case "recharge":
      return { ...base, type: "expense", toAccountId: null, fee: 0, categoryId: categoryByName(ctx.categories, "expense", ["Mobile recharge", "Bills & Utilities"]), description: desc };
    case "bill":
      return { ...base, type: "expense", toAccountId: null, fee: 0, categoryId: categoryByName(ctx.categories, "expense", ["Bills & Utilities"]), description: desc };
    default:
      if (p.direction === "in") return { ...base, type: "income", toAccountId: null, categoryId: categoryByName(ctx.categories, "income", ["Other income"]), description: desc };
      // expenses carry no separate fee in the ledger: fold the fee into a "Fees" line via the amount? keep it explicit:
      return { ...base, type: "expense", toAccountId: null, fee: 0, amount: p.amount + p.fee, categoryId: categoryByName(ctx.categories, "expense", ["Other expense"]), description: p.fee ? `${desc} (incl. fee)` : desc };
  }
}
