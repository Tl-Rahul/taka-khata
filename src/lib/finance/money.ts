import type { Paisa } from "./types";

const BN_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];
export const MAX_AMOUNT: Paisa = 99_999_999_999_99; // fits numeric(14,2)

export function toBanglaDigits(s: string): string {
  return s.replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);
}

export function fromBanglaDigits(s: string): string {
  return s.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
}

/** DB numeric (string or number) -> paisa integer. */
export function toPaisa(v: string | number | null | undefined): Paisa {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function toPaisaOrNull(v: string | number | null | undefined): Paisa | null {
  if (v === null || v === undefined || v === "") return null;
  return toPaisa(v);
}

/** paisa -> exact decimal string for the database ("-12.05"). */
export function toDecimalString(p: Paisa): string {
  if (!Number.isInteger(p)) throw new Error("Money must be integer paisa");
  const neg = p < 0;
  const abs = Math.abs(p);
  const s = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  return neg ? `-${s}` : s;
}

/**
 * Parse user input: accepts Bangla or Latin digits, commas, "৳"/"tk" and simple sums
 * like "120+45-5". Returns integer paisa, or null if invalid. More than 2 decimals is invalid.
 */
export function parseAmount(input: string, opts: { allowNegative?: boolean } = {}): Paisa | null {
  if (typeof input !== "string") return null;
  let s = fromBanglaDigits(input)
    .replace(/[৳,\s]/g, "")
    .replace(/^tk\.?/i, "")
    .replace(/[−–]/g, "-");
  if (!s) return null;
  if (!/^[-+]?\d*(\.\d+)?([-+]\d*(\.\d+)?)*$/.test(s) || /^[-+]?$/.test(s)) return null;
  const terms = s.match(/[-+]?[^-+]+/g);
  if (!terms) return null;
  let total = 0;
  for (const t of terms) {
    const m = /^([-+]?)(\d*)(?:\.(\d+))?$/.exec(t);
    if (!m) return null;
    const [, sign, whole, frac = ""] = m;
    if (!whole && !frac) return null;
    if (frac.length > 2) return null;
    const p = Number(whole || "0") * 100 + Number(frac.padEnd(2, "0") || "0");
    total += sign === "-" ? -p : p;
  }
  if (!Number.isSafeInteger(total) || Math.abs(total) > MAX_AMOUNT) return null;
  if (total < 0 && !opts.allowNegative) return null;
  return total;
}

export interface MoneyFormatOptions {
  banglaDigits?: boolean;
  /** show + for positive values */
  signed?: boolean;
  /** hide paisa when zero (default true) */
  compactZeros?: boolean;
  symbol?: boolean;
  /** 1.2L / 3.4Cr style */
  short?: boolean;
}

const nfCache = new Map<string, Intl.NumberFormat>();
function nf(min: number, max: number) {
  const k = `${min}-${max}`;
  let f = nfCache.get(k);
  if (!f) {
    // en-IN gives the South Asian lakh/crore grouping: 12,34,567.89
    f = new Intl.NumberFormat("en-IN", { minimumFractionDigits: min, maximumFractionDigits: max });
    nfCache.set(k, f);
  }
  return f;
}

export function formatMoney(p: Paisa, o: MoneyFormatOptions = {}): string {
  const { banglaDigits = false, signed = false, compactZeros = true, symbol = true, short = false } = o;
  const abs = Math.abs(p);
  let body: string;
  if (short && abs >= 100_000_00) {
    const units: [number, string][] = [
      [100_000_00_00, banglaDigits ? " কোটি" : "Cr"],
      [100_000_00, banglaDigits ? " লাখ" : "L"],
    ];
    const [div, u] = units.find(([d]) => abs >= d)!;
    body = nf(0, 2).format(abs / div) + u;
  } else if (short && abs >= 1_000_00) {
    body = nf(0, 1).format(abs / 1_000_00) + (banglaDigits ? " হাজার" : "K");
  } else {
    const hasPaisa = abs % 100 !== 0;
    body = nf(compactZeros && !hasPaisa ? 0 : 2, 2).format(abs / 100);
  }
  const sign = p < 0 ? "-" : signed && p > 0 ? "+" : "";
  let out = `${sign}${symbol ? "৳" : ""}${body}`;
  if (banglaDigits) out = toBanglaDigits(out);
  return out;
}

export function formatNumber(n: number, banglaDigits = false, maxFrac = 0): string {
  const s = nf(0, maxFrac).format(n);
  return banglaDigits ? toBanglaDigits(s) : s;
}

export function formatPercent(ratio: number, banglaDigits = false): string {
  if (!Number.isFinite(ratio)) return "—";
  const s = `${nf(0, 1).format(ratio * 100)}%`;
  return banglaDigits ? toBanglaDigits(s) : s;
}

export const sum = (xs: Paisa[]) => xs.reduce((a, b) => a + b, 0);
