"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { format as dfFormat } from "date-fns";
import { bn as bnLocale } from "date-fns/locale";
import { DICT, type Locale } from "./dict";
import { formatMoney, formatNumber, formatPercent, toBanglaDigits, type MoneyFormatOptions } from "@/lib/finance/money";
import { toDate } from "@/lib/finance/dates";
import type { Category, Paisa, Profile } from "@/lib/finance/types";

type Params = Record<string, string | number>;

export interface I18n {
  locale: Locale;
  t: (key: string, params?: Params) => string;
  has: (key: string) => boolean;
  money: (p: Paisa, o?: MoneyFormatOptions) => string;
  num: (n: number, maxFrac?: number) => string;
  pct: (ratio: number) => string;
  date: (iso: string | null | undefined, fmt?: string) => string;
  month: (monthKey: string, short?: boolean) => string;
  digits: (s: string | number) => string;
  catName: (c: Category | undefined | null) => string;
  bangla: boolean;
  setLocalePreview: (l: Locale) => void;
}

const Ctx = createContext<I18n | null>(null);

export function interpolate(s: string, params?: Params) {
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in params ? String(params[k]) : `{${k}}`));
}

export function I18nProvider({ profile, children }: { profile: Profile | null; children: ReactNode }) {
  const [preview, setPreview] = useState<Locale | null>(null);
  const [stored, setStored] = useState<Locale>("bn");
  useEffect(() => {
    try {
      const s = localStorage.getItem("locale");
      if (s === "bn" || s === "en") setStored(s);
    } catch {}
  }, []);
  const locale: Locale = preview ?? profile?.locale ?? stored;
  useEffect(() => {
    document.documentElement.lang = locale;
    try {
      localStorage.setItem("locale", locale);
    } catch {}
  }, [locale]);
  useEffect(() => setPreview(null), [profile?.locale]);

  const bangla = locale === "bn" && (profile?.bangla_digits ?? true);
  const dateFormat = profile?.date_format ?? "dd/MM/yyyy";

  const t = useCallback(
    (key: string, params?: Params) => {
      const raw = DICT[locale][key] ?? DICT.en[key] ?? key;
      const s = interpolate(raw, params);
      return bangla ? toBanglaDigits(s) : s;
    },
    [locale, bangla],
  );

  const value = useMemo<I18n>(() => {
    const dfLoc = locale === "bn" ? { locale: bnLocale } : undefined;
    const fix = (s: string) => (bangla ? toBanglaDigits(s) : s);
    return {
      locale,
      t,
      has: (k) => k in DICT[locale] || k in DICT.en,
      bangla,
      money: (p, o) => formatMoney(p, { banglaDigits: bangla, ...o }),
      num: (n, maxFrac) => formatNumber(n, bangla, maxFrac),
      pct: (r) => formatPercent(r, bangla),
      digits: (s) => fix(String(s)),
      date: (iso, fmt) => {
        if (!iso) return "—";
        try {
          return fix(dfFormat(toDate(iso), fmt ?? dateFormat, dfLoc));
        } catch {
          return iso;
        }
      },
      month: (mk, short) => fix(dfFormat(toDate(`${mk}-01`), short ? "MMM yy" : "MMMM yyyy", dfLoc)),
      catName: (c) => (c ? (locale === "bn" ? c.name_bn || c.name : c.name) : "—"),
      setLocalePreview: setPreview,
    };
  }, [locale, bangla, t, dateFormat]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error("useI18n must be used inside I18nProvider");
  return v;
}

/** Minimal i18n for pages outside the app shell (login, setup). */
export function useStandaloneI18n() {
  const [locale, setLocale] = useState<Locale>("bn");
  useEffect(() => {
    try {
      const s = localStorage.getItem("locale");
      if (s === "bn" || s === "en") setLocale(s);
    } catch {}
  }, []);
  const change = (l: Locale) => {
    setLocale(l);
    try {
      localStorage.setItem("locale", l);
    } catch {}
    document.documentElement.lang = l;
  };
  const t = (key: string, params?: Params) => interpolate(DICT[locale][key] ?? DICT.en[key] ?? key, params);
  return { locale, setLocale: change, t };
}
