"use client";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, CheckCheck, ClipboardPaste, MessageSquareText, Pencil, Smartphone, X } from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";
import { useData } from "@/lib/data/DataProvider";
import { useDerived } from "@/lib/data/useDerived";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { errorText } from "@/lib/data/errors";
import { isTransactionSms, parseSms, smsHash, splitMessages, suggestTransaction, type ParsedSms, type SmsSuggestion } from "@/lib/finance/smsParser";
import type { Transaction } from "@/lib/finance/types";
import { Alert, Badge, Button, Card, Empty, PageHeader, Segmented, Spinner, Textarea, cx, useFeedback } from "@/components/ui";
import { useTxForm } from "@/components/TxFormProvider";

interface InboxRow {
  id: string;
  sender: string | null;
  body: string;
  received_at: string;
  source: "paste" | "share" | "android";
  hash: string;
  status: "pending" | "imported" | "ignored";
  transaction_id: string | null;
}

interface Item extends InboxRow {
  parsed: ParsedSms;
  suggestion: SmsSuggestion | null;
  ready: boolean; // can be added with one tap
  duplicateOf: string | null; // an existing transaction with the same hash
}

function SmsInner() {
  const { ds, today, insert } = useData();
  const { accountMap, cmap } = useDerived();
  const i = useI18n();
  const { t, money, date, catName } = i;
  const { toast } = useFeedback();
  const { openTx } = useTxForm();
  const params = useSearchParams();
  const router = useRouter();
  const [rows, setRows] = useState<InboxRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [view, setView] = useState<"pending" | "done">("pending");
  const [busy, setBusy] = useState<string | null>(null);
  const sharedHandled = useRef(false);

  const load = useCallback(async () => {
    const { data, error } = await getSupabase().from("sms_inbox").select("*").order("received_at", { ascending: false }).limit(300);
    if (error) {
      setLoadError(error.code === "PGRST205" || /sms_inbox/.test(error.message) ? t("sms.setup_needed") : errorText(error, t));
      setRows([]);
      return;
    }
    setLoadError(null);
    setRows(data as InboxRow[]);
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const items: Item[] = useMemo(() => {
    const hashes = new Map(ds.transactions.filter((x) => x.import_hash).map((x) => [x.import_hash!, x.id]));
    return (rows ?? []).map((r) => {
      const parsed = parseSms(r.body, r.sender);
      const suggestion = suggestTransaction(parsed, r.body, { accounts: ds.accounts, categories: ds.categories, today });
      const needsCat = suggestion && ["income", "expense", "refund"].includes(suggestion.type);
      const needsTo = suggestion?.type === "transfer";
      const ready = !!suggestion && !!suggestion.accountId && (!needsCat || !!suggestion.categoryId) && (!needsTo || !!suggestion.toAccountId) && suggestion.accountId !== suggestion.toAccountId;
      return { ...r, parsed, suggestion, ready, duplicateOf: hashes.get(r.hash) ?? null };
    });
  }, [rows, ds.transactions, ds.accounts, ds.categories, today]);

  const pending = items.filter((x) => x.status === "pending");
  const done = items.filter((x) => x.status !== "pending");

  /** Save pasted/shared SMS into the inbox (duplicates are skipped by the unique hash). */
  const addMessages = useCallback(
    async (raw: string, source: InboxRow["source"]) => {
      const msgs = splitMessages(raw).filter(isTransactionSms);
      if (!msgs.length) {
        toast(t("sms.none_found"), "info");
        return 0;
      }
      const payload = msgs.map((body) => {
        const p = parseSms(body);
        return { body: body.slice(0, 2000), source, hash: smsHash(p, body), sender: null };
      });
      const { data, error } = await getSupabase().from("sms_inbox").upsert(payload, { onConflict: "user_id,hash", ignoreDuplicates: true }).select("id");
      if (error) {
        toast(errorText(error, t), "neg");
        return 0;
      }
      const added = data?.length ?? 0;
      toast(added ? t("sms.added", { n: added }) : t("sms.already_there"), added ? "pos" : "info");
      await load();
      return added;
    },
    [load, t, toast],
  );

  // text shared from the SMS app (Android share sheet) arrives as ?text=
  useEffect(() => {
    if (sharedHandled.current || rows === null || loadError) return;
    const shared = [params.get("title"), params.get("text")].filter(Boolean).join("\n");
    if (!shared) return;
    sharedHandled.current = true;
    addMessages(shared, "share").finally(() => router.replace("/sms"));
  }, [params, rows, loadError, addMessages, router]);

  const setStatus = async (id: string, status: InboxRow["status"], transactionId: string | null = null) => {
    const { error } = await getSupabase().from("sms_inbox").update({ status, transaction_id: transactionId }).eq("id", id);
    if (error) throw error;
    setRows((prev) => (prev ?? []).map((r) => (r.id === id ? { ...r, status, transaction_id: transactionId } : r)));
  };

  const approve = async (it: Item) => {
    if (!it.suggestion || !it.ready) return edit(it);
    if (it.duplicateOf) {
      await setStatus(it.id, "imported", it.duplicateOf);
      return;
    }
    setBusy(it.id);
    try {
      const s = it.suggestion;
      const tx = await insert<Transaction>("transactions", {
        type: s.type,
        date: s.date,
        amount: s.amount,
        interest: 0,
        fee: s.type === "transfer" || s.type === "income" ? s.fee : 0,
        account_id: s.accountId!,
        to_account_id: s.toAccountId,
        category_id: s.categoryId,
        description: s.description.slice(0, 200),
        notes: it.body.slice(0, 2000),
        import_hash: s.importHash,
      });
      await setStatus(it.id, "imported", tx.id);
      toast(t("toast.tx_saved"));
    } catch (e) {
      toast(errorText(e, t), "neg");
    } finally {
      setBusy(null);
    }
  };

  const edit = (it: Item) => {
    const s = it.suggestion;
    openTx({
      preset: {
        type: s?.type ?? (it.parsed.direction === "in" ? "income" : "expense"),
        amount: s?.amount ?? it.parsed.amount ?? undefined,
        fee: s && (s.type === "transfer" || s.type === "income") ? s.fee : 0,
        account_id: s?.accountId ?? undefined,
        to_account_id: s?.toAccountId ?? null,
        category_id: s?.categoryId ?? null,
        date: s?.date ?? it.parsed.date ?? today,
        description: s?.description ?? it.parsed.summary,
        notes: it.body.slice(0, 2000),
        import_hash: s?.importHash ?? it.hash,
      },
      onSaved: (tx) => {
        setStatus(it.id, "imported", tx.id).catch((e) => toast(errorText(e, t), "neg"));
      },
    });
  };

  const ignore = async (it: Item) => {
    try {
      await setStatus(it.id, "ignored");
    } catch (e) {
      toast(errorText(e, t), "neg");
    }
  };

  const approveAll = async () => {
    const ready = pending.filter((x) => x.ready);
    setBusy("all");
    let n = 0;
    for (const it of ready) {
      try {
        await approve(it);
        n++;
      } catch {
        /* reported per item */
      }
    }
    setBusy(null);
    if (n) toast(t("sms.approved_n", { n }));
  };

  const typeTone = (type?: string) => (type === "income" || type === "refund" ? "pos" : type === "transfer" ? "info" : "neg");

  const Row = ({ it }: { it: Item }) => {
    const s = it.suggestion;
    const acc = s?.accountId ? accountMap.get(s.accountId) : null;
    const to = s?.toAccountId ? accountMap.get(s.toAccountId) : null;
    const cat = s?.categoryId ? cmap.get(s.categoryId) : null;
    return (
      <li className="px-4 py-3 sm:px-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {s ? <Badge tone={typeTone(s.type)}>{t(`type.${s.type}`)}</Badge> : <Badge>{t("sms.unreadable")}</Badge>}
              <span className="text-sm font-medium">{it.parsed.summary}</span>
              {it.parsed.confidence === "low" && <Badge tone="warn">{t("sms.check")}</Badge>}
              {it.duplicateOf && <Badge tone="info">{t("sms.already_recorded")}</Badge>}
            </div>
            {s && (
              <p className="mt-1 text-sm text-muted">
                {date(s.date)}
                {" · "}
                {acc ? acc.name : <span className="text-warn">{t("sms.no_account")}</span>}
                {s.type === "transfer" && <> → {to ? to.name : <span className="text-warn">{t("sms.no_account")}</span>}</>}
                {cat && ` · ${catName(cat)}`}
                {s.fee > 0 && s.type !== "expense" && ` · ${t("tx.incl_fee", { amount: money(s.fee) })}`}
              </p>
            )}
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-muted hover:text-ink">{t("sms.show_message")}</summary>
              <p className="mt-1 whitespace-pre-wrap rounded-md bg-surface-2 p-2 text-xs text-muted">{it.body}</p>
            </details>
          </div>
          <div className="flex items-center justify-between gap-2 sm:block sm:text-right">
            {s && <p className={cx("num text-lg font-semibold", typeTone(s.type) === "neg" ? "text-neg" : typeTone(s.type) === "pos" ? "text-brand" : "")}>{money(s.amount)}</p>}
            {it.status === "pending" ? (
              <div className="flex justify-end gap-1 sm:mt-1">
                <Button size="sm" icon={<Check className="size-4" />} loading={busy === it.id} disabled={!!busy && busy !== it.id} onClick={() => approve(it)}>
                  {it.duplicateOf ? t("sms.mark_done") : it.ready ? t("sms.add") : t("sms.complete")}
                </Button>
                {it.ready && !it.duplicateOf && (
                  <Button size="sm" variant="ghost" aria-label={t("common.edit")} onClick={() => edit(it)}>
                    <Pencil className="size-4" />
                  </Button>
                )}
                <Button size="sm" variant="ghost" aria-label={t("sms.ignore")} onClick={() => ignore(it)}>
                  <X className="size-4" />
                </Button>
              </div>
            ) : (
              <p className="mt-1 text-xs text-muted">{it.status === "imported" ? t("sms.status_imported") : t("sms.status_ignored")}</p>
            )}
          </div>
        </div>
      </li>
    );
  };

  return (
    <>
      <PageHeader title={t("nav.sms")} sub={t("sms.sub")} />

      {loadError ? (
        <Alert tone="warn" title={t("sms.setup_title")}>
          {loadError}
        </Alert>
      ) : (
        <>
          <Card className="p-4 sm:p-5">
            <label htmlFor="sms-paste" className="mb-1.5 flex items-center gap-2 font-medium">
              <ClipboardPaste className="size-4 text-muted" /> {t("sms.paste_label")}
            </label>
            <Textarea id="sms-paste" value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder={t("sms.paste_ph")} className="text-sm" />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted">{t("sms.paste_hint")}</p>
              <Button
                icon={<MessageSquareText className="size-4" />}
                disabled={!text.trim()}
                loading={busy === "paste"}
                onClick={async () => {
                  setBusy("paste");
                  const n = await addMessages(text, "paste");
                  if (n >= 0) setText("");
                  setBusy(null);
                }}
              >
                {t("sms.read")}
              </Button>
            </div>
          </Card>

          <Alert tone="info" className="mt-3">
            <span className="flex items-start gap-2">
              <Smartphone className="mt-0.5 size-4 shrink-0" />
              <span>{t("sms.share_tip")}</span>
            </span>
          </Alert>

          <div className="mt-5 mb-3 flex flex-wrap items-center justify-between gap-2">
            <Segmented
              size="sm"
              value={view}
              onChange={setView}
              options={[
                { value: "pending", label: `${t("sms.pending")} (${i.digits(pending.length)})` },
                { value: "done", label: t("sms.history") },
              ]}
            />
            {view === "pending" && pending.some((x) => x.ready) && (
              <Button size="sm" variant="secondary" icon={<CheckCheck className="size-4" />} loading={busy === "all"} onClick={approveAll}>
                {t("sms.add_all", { n: pending.filter((x) => x.ready).length })}
              </Button>
            )}
          </div>

          <Card className="overflow-clip">
            {rows === null ? (
              <Spinner className="py-10" />
            ) : (view === "pending" ? pending : done).length === 0 ? (
              <Empty icon={<MessageSquareText />} title={view === "pending" ? t("sms.empty") : t("sms.history_empty")} body={view === "pending" ? t("sms.empty_body") : undefined} />
            ) : (
              <ul className="divide-y divide-line">
                {(view === "pending" ? pending : done.slice(0, 100)).map((it) => (
                  <Row key={it.id} it={it} />
                ))}
              </ul>
            )}
          </Card>
          {pending.some((x) => !x.ready && x.suggestion) && <p className="mt-2 text-xs text-muted">{t("sms.incomplete_hint")}</p>}
        </>
      )}
    </>
  );
}

export default function SmsPage() {
  return (
    <Suspense>
      <SmsInner />
    </Suspense>
  );
}
