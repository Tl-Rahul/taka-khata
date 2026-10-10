"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getSupabase } from "@/lib/supabase/client";
import type { Dataset, Profile, TableName } from "@/lib/finance/types";
import { DEFAULT_REMINDERS, EMPTY_DATASET } from "@/lib/finance/types";
import { fromDb, toDb } from "./mapping";
import { today as todayFn } from "@/lib/finance/dates";

const TABLES: TableName[] = [
  "accounts",
  "categories",
  "contacts",
  "loans",
  "recurring",
  "transactions",
  "budgets",
  "goals",
  "goal_entries",
  "holdings",
  "holding_valuations",
];
const PAGE = 1000;

type AnyRow = { id: string } & Record<string, unknown>;

export interface DataContextValue {
  ds: Dataset;
  status: "loading" | "ready" | "error";
  error: string | null;
  userId: string | null;
  email: string | null;
  today: string;
  reload: () => Promise<void>;
  insert: <T extends { id: string }>(table: TableName, row: Partial<T>) => Promise<T>;
  insertMany: <T extends { id: string }>(table: TableName, rows: Partial<T>[]) => Promise<T[]>;
  update: <T extends { id: string }>(table: TableName, id: string, patch: Partial<T>) => Promise<T>;
  remove: (table: TableName, id: string) => Promise<void>;
  removeMany: (table: TableName, ids: string[]) => Promise<void>;
  saveProfile: (patch: Partial<Profile>) => Promise<void>;
}

const Ctx = createContext<DataContextValue | null>(null);

export class DbError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

function raise(e: { message: string; code?: string } | null): never {
  throw new DbError(e?.message ?? "Unknown error", e?.code ?? "unknown");
}

async function fetchAll(table: TableName): Promise<AnyRow[]> {
  const sb = getSupabase();
  const out: AnyRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from(table)
      .select("*")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) raise(error);
    out.push(...(data as AnyRow[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

function normalizeProfile(p: Record<string, unknown> | null): Profile | null {
  if (!p) return null;
  return {
    ...(p as unknown as Profile),
    reminders: { ...DEFAULT_REMINDERS, ...((p.reminders as object) ?? {}) },
  };
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [ds, setDs] = useState<Dataset>(EMPTY_DATASET);
  const [status, setStatus] = useState<DataContextValue["status"]>("loading");
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [today, setToday] = useState(todayFn());
  const lastLoad = useRef(0);
  const loading = useRef(false);

  const load = useCallback(async (silent = false) => {
    if (loading.current) return;
    loading.current = true;
    if (!silent) setStatus("loading");
    try {
      const sb = getSupabase();
      const { data: u, error: ue } = await sb.auth.getUser();
      if (ue || !u.user) {
        window.location.href = "/login";
        return;
      }
      setUserId(u.user.id);
      setEmail(u.user.email ?? null);
      const { error: be } = await sb.rpc("bootstrap_user");
      if (be) raise(be);
      const [profileRes, ...tables] = await Promise.all([
        sb.from("profiles").select("*").eq("id", u.user.id).maybeSingle(),
        ...TABLES.map((t) => fetchAll(t)),
      ]);
      if (profileRes.error) raise(profileRes.error);
      const next: Dataset = { ...EMPTY_DATASET, profile: normalizeProfile(profileRes.data) };
      TABLES.forEach((t, i) => {
        (next as unknown as Record<string, unknown[]>)[t] = tables[i].map((r) => fromDb(t, r));
      });
      setDs(next);
      setStatus("ready");
      setError(null);
      lastLoad.current = Date.now();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (!silent) setStatus("error");
    } finally {
      loading.current = false;
    }
  }, []);

  useEffect(() => {
    load();
    const sb = getSupabase();
    const { data: sub } = sb.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") window.location.href = "/login";
    });
    // keep data fresh across devices: reload when returning to the tab after a while
    const onFocus = () => {
      setToday(todayFn());
      if (Date.now() - lastLoad.current > 60_000) load(true);
    };
    window.addEventListener("focus", onFocus);
    const tick = setInterval(() => setToday(todayFn()), 60_000);
    return () => {
      sub.subscription.unsubscribe();
      window.removeEventListener("focus", onFocus);
      clearInterval(tick);
    };
  }, [load]);

  const setTable = useCallback((table: TableName, fn: (rows: AnyRow[]) => AnyRow[]) => {
    setDs((prev) => ({ ...prev, [table]: fn(prev[table] as unknown as AnyRow[]) }));
  }, []);

  const insertMany = useCallback(
    async <T extends { id: string }>(table: TableName, rows: Partial<T>[]): Promise<T[]> => {
      if (!rows.length) return [];
      const sb = getSupabase();
      // client-generated ids make retries idempotent (a double-submit can't create two rows)
      const prepared = rows.map((r) => toDb(table, { ...r, id: r.id ?? crypto.randomUUID() } as Record<string, unknown>));
      const saved: T[] = [];
      for (let i = 0; i < prepared.length; i += 500) {
        const chunk = prepared.slice(i, i + 500);
        const { data, error } = await sb.from(table).insert(chunk).select("*");
        if (error) raise(error);
        saved.push(...(data as AnyRow[]).map((r) => fromDb<T>(table, r)));
      }
      setTable(table, (prev) => [...prev, ...(saved as unknown as AnyRow[])]);
      return saved;
    },
    [setTable],
  );

  const insert = useCallback(
    async <T extends { id: string }>(table: TableName, row: Partial<T>): Promise<T> => {
      const [r] = await insertMany<T>(table, [row]);
      return r;
    },
    [insertMany],
  );

  const update = useCallback(
    async <T extends { id: string }>(table: TableName, id: string, patch: Partial<T>): Promise<T> => {
      const sb = getSupabase();
      const body = toDb(table, patch as Record<string, unknown>);
      delete body.id;
      const { data, error } = await sb.from(table).update(body).eq("id", id).select("*").single();
      if (error) raise(error);
      const saved = fromDb<T>(table, data as AnyRow);
      setTable(table, (prev) => prev.map((r) => (r.id === id ? (saved as unknown as AnyRow) : r)));
      return saved;
    },
    [setTable],
  );

  const removeMany = useCallback(
    async (table: TableName, ids: string[]) => {
      if (!ids.length) return;
      const sb = getSupabase();
      for (let i = 0; i < ids.length; i += 200) {
        const { error } = await sb.from(table).delete().in("id", ids.slice(i, i + 200));
        if (error) raise(error);
      }
      const gone = new Set(ids);
      setTable(table, (prev) => prev.filter((r) => !gone.has(r.id)));
      // database cascades: mirror them locally so derived numbers stay correct
      if (table === "loans") setTable("transactions", (p) => p.filter((t) => !gone.has(t.loan_id as string)));
      if (table === "goals") setTable("goal_entries", (p) => p.filter((t) => !gone.has(t.goal_id as string)));
      if (table === "holdings") setTable("holding_valuations", (p) => p.filter((t) => !gone.has(t.holding_id as string)));
      if (table === "categories") setTable("budgets", (p) => p.filter((t) => !gone.has(t.category_id as string)));
      if (table === "recurring") setTable("transactions", (p) => p.map((t) => (gone.has(t.recurring_id as string) ? { ...t, recurring_id: null, occurrence_date: null } : t)));
      if (table === "transactions") setTable("transactions", (p) => p.map((t) => (gone.has(t.refund_of as string) ? { ...t, refund_of: null } : t)));
    },
    [setTable],
  );

  const remove = useCallback((table: TableName, id: string) => removeMany(table, [id]), [removeMany]);

  const saveProfile = useCallback(
    async (patch: Partial<Profile>) => {
      const sb = getSupabase();
      if (!userId) return;
      const { data, error } = await sb.from("profiles").update(patch).eq("id", userId).select("*").single();
      if (error) raise(error);
      setDs((prev) => ({ ...prev, profile: normalizeProfile(data) }));
    },
    [userId],
  );

  const value = useMemo<DataContextValue>(
    () => ({ ds, status, error, userId, email, today, reload: () => load(), insert, insertMany, update, remove, removeMany, saveProfile }),
    [ds, status, error, userId, email, today, load, insert, insertMany, update, remove, removeMany, saveProfile],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData(): DataContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useData must be used inside DataProvider");
  return v;
}
