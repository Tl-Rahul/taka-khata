"use client";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { FileDown, Upload } from "lucide-react";
import { useData } from "@/lib/data/DataProvider";
import { useDerived } from "@/lib/data/useDerived";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { errorText } from "@/lib/data/errors";
import { guessColumns, prepareImport, IMPORT_FIELDS, type ColumnMap, type ImportField } from "@/lib/finance/importer";
import { compareTxDesc } from "@/lib/finance/engine";
import { downloadBlob, transactionsTable } from "@/lib/export";
import type { Transaction } from "@/lib/finance/types";
import { Alert, Badge, Button, Card, CardHeader, Field, PageHeader, Select, cx, useFeedback } from "@/components/ui";
import { AccountSelect } from "@/components/fields";
import { ExportMenu } from "@/components/ExportMenu";

const TEMPLATE = "date,type,amount,account,to_account,category,description,notes\n2026-10-01,expense,450,Cash,,Food & Dining > Groceries,Bazar,\n2026-10-01,income,60000,Bank,,Salary,October salary,\n2026-10-02,transfer,2000,Bank,bKash,,Top up,\n";
const MAX_ROWS = 5000;

export default function ImportPage() {
  const { ds, insertMany } = useData();
  const { activeAccounts } = useDerived();
  const i = useI18n();
  const { t, money, date, catName } = i;
  const { confirm, toast } = useFeedback();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [map, setMap] = useState<ColumnMap>({});
  const [defaultAccount, setDefaultAccount] = useState(activeAccounts[0]?.id ?? "");
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [included, setIncluded] = useState<Set<number>>(new Set()); // duplicates explicitly included
  const [parseError, setParseError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const prepared = useMemo(() => (rows.length ? prepareImport(rows, map, ds, { accountId: defaultAccount }) : []), [rows, map, ds, defaultAccount]);
  const willImport = prepared.filter((r) => r.tx && (r.status === "ok" ? !excluded.has(r.line) : included.has(r.line)));
  const counts = { ok: prepared.filter((r) => r.status === "ok").length, dup: prepared.filter((r) => r.status === "duplicate").length, err: prepared.filter((r) => r.status === "error").length };
  const accName = new Map(ds.accounts.map((a) => [a.id, a.name]));
  const catLabel = (id: string | null) => {
    const c = ds.categories.find((x) => x.id === id);
    return c ? catName(c) : "";
  };

  const onFile = (f: File | undefined) => {
    setParseError(null);
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) return setParseError(t("import.too_big"));
    setFileName(f.name);
    Papa.parse<Record<string, string>>(f, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.replace(/^﻿/, "").trim(),
      complete: (res) => {
        const data = res.data.filter((r) => Object.values(r).some((v) => String(v ?? "").trim()));
        if (!data.length) return setParseError(t("import.empty_file"));
        if (data.length > MAX_ROWS) return setParseError(t("import.too_many", { n: MAX_ROWS }));
        const hs = res.meta.fields ?? Object.keys(data[0]);
        setHeaders(hs);
        setRows(data);
        setMap(guessColumns(hs));
        setExcluded(new Set());
        setIncluded(new Set());
      },
      error: () => setParseError(t("import.parse_failed")),
    });
  };

  const reset = () => {
    setRows([]);
    setHeaders([]);
    setFileName("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const doImport = async () => {
    if (!willImport.length) return;
    const ok = await confirm({ title: t("import.confirm_title"), body: t("import.confirm_body", { n: willImport.length }), confirmLabel: t("import.confirm"), cancelLabel: t("common.cancel") });
    if (!ok) return;
    setBusy(true);
    try {
      await insertMany<Transaction>("transactions", willImport.map((r) => r.tx!));
      toast(t("import.done", { n: willImport.length }));
      reset();
    } catch (e) {
      toast(errorText(e, t), "neg");
    } finally {
      setBusy(false);
    }
  };

  const errText = (k: string) => {
    const [key, detail] = k.split(/:(.*)/);
    return t(key, { value: detail ?? "" });
  };

  return (
    <>
      <PageHeader
        title={t("nav.import")}
        sub={t("import.sub")}
        actions={
          <ExportMenu
            filename="all-transactions"
            build={() => [transactionsTable([...ds.transactions].sort(compareTxDesc), ds, t, catName)]}
          />
        }
      />

      {!rows.length ? (
        <Card className="p-5 sm:p-6">
          <div className="flex flex-col items-start gap-4">
            <div>
              <h2 className="text-[17px] font-semibold">{t("import.step1")}</h2>
              <p className="mt-1 max-w-prose text-sm text-muted">{t("import.step1_body")}</p>
            </div>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            <div className="flex flex-wrap gap-2">
              <Button icon={<Upload className="size-4" />} onClick={() => fileRef.current?.click()} disabled={!activeAccounts.length}>
                {t("import.choose_file")}
              </Button>
              <Button variant="outline" icon={<FileDown className="size-4" />} onClick={() => downloadBlob(new Blob([TEMPLATE], { type: "text/csv" }), "import-template.csv")}>
                {t("import.template")}
              </Button>
            </div>
            {!activeAccounts.length && (
              <Alert tone="info">
                {t("tx.need_account_body")}{" "}
                <Link href="/accounts?new=1" className="font-medium underline">
                  {t("acc.add")}
                </Link>
              </Alert>
            )}
            {parseError && <Alert tone="neg">{parseError}</Alert>}
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
              <li>{t("import.rule_columns")}</li>
              <li>{t("import.rule_sign")}</li>
              <li>{t("import.rule_names")}</li>
              <li>{t("import.rule_confirm")}</li>
            </ul>
          </div>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader title={t("import.step2")} sub={t("import.file_rows", { name: fileName, n: rows.length })} action={<Button variant="ghost" size="sm" onClick={reset}>{t("import.start_over")}</Button>} />
            <div className="grid gap-3 px-4 pb-4 sm:grid-cols-2 sm:px-5 lg:grid-cols-4">
              {IMPORT_FIELDS.map((f: ImportField) => (
                <Field key={f} label={t(`import.field.${f}`)} htmlFor={`map-${f}`}>
                  <Select id={`map-${f}`} value={map[f] ?? ""} onChange={(e) => setMap({ ...map, [f]: e.target.value || undefined })}>
                    <option value="">{t("import.not_in_file")}</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </Select>
                </Field>
              ))}
              {!map.account && (
                <Field label={t("import.default_account")} htmlFor="map-def">
                  <AccountSelect id="map-def" value={defaultAccount} onChange={setDefaultAccount} showBalance={false} />
                </Field>
              )}
            </div>
          </Card>

          <Card className="mt-4">
            <CardHeader
              title={t("import.step3")}
              sub={t("import.summary", { ok: counts.ok, dup: counts.dup, err: counts.err })}
              action={
                <Button onClick={doImport} loading={busy} disabled={!willImport.length}>
                  {t("import.import_n", { n: willImport.length })}
                </Button>
              }
            />
            {counts.dup > 0 && <Alert tone="warn" className="mx-4 mb-3 sm:mx-5">{t("import.dup_note")}</Alert>}
            <div className="max-h-[60dvh] overflow-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="sticky top-0 bg-surface text-left text-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t("import.col.include")}</th>
                    <th className="px-3 py-2 font-medium">#</th>
                    <th className="px-3 py-2 font-medium">{t("f.date")}</th>
                    <th className="px-3 py-2 font-medium">{t("filter.type")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("f.amount")}</th>
                    <th className="px-3 py-2 font-medium">{t("f.account")}</th>
                    <th className="px-3 py-2 font-medium">{t("f.category")}</th>
                    <th className="px-3 py-2 font-medium">{t("f.description")}</th>
                    <th className="px-3 py-2 font-medium">{t("import.col.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {prepared.map((r) => {
                    const checked = r.status === "ok" ? !excluded.has(r.line) : r.status === "duplicate" ? included.has(r.line) : false;
                    return (
                      <tr key={r.line} className={cx("border-t border-line", r.status === "error" && "bg-neg-soft/40", !checked && r.status !== "error" && "opacity-60")}>
                        <td className="px-3 py-1.5">
                          <input
                            type="checkbox"
                            className="size-4 accent-[var(--brand)]"
                            disabled={r.status === "error"}
                            checked={checked}
                            aria-label={t("import.col.include")}
                            onChange={(e) => {
                              const on = e.target.checked;
                              if (r.status === "ok") {
                                const n = new Set(excluded);
                                on ? n.delete(r.line) : n.add(r.line);
                                setExcluded(n);
                              } else {
                                const n = new Set(included);
                                on ? n.add(r.line) : n.delete(r.line);
                                setIncluded(n);
                              }
                            }}
                          />
                        </td>
                        <td className="num px-3 py-1.5 text-muted">{i.digits(r.line)}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap">{r.tx ? date(r.tx.date) : r.raw[map.date ?? ""] ?? ""}</td>
                        <td className="px-3 py-1.5">{r.tx ? t(`type.${r.tx.type}`) : r.raw[map.type ?? ""] ?? ""}</td>
                        <td className="num px-3 py-1.5 text-right">{r.tx ? money(r.tx.amount) : r.raw[map.amount ?? ""] ?? ""}</td>
                        <td className="px-3 py-1.5">{r.tx ? `${accName.get(r.tx.account_id)}${r.tx.to_account_id ? ` → ${accName.get(r.tx.to_account_id)}` : ""}` : r.raw[map.account ?? ""] ?? ""}</td>
                        <td className="px-3 py-1.5">{r.tx ? catLabel(r.tx.category_id) : r.raw[map.category ?? ""] ?? ""}</td>
                        <td className="max-w-[200px] truncate px-3 py-1.5">{r.tx?.description ?? r.raw[map.description ?? ""] ?? ""}</td>
                        <td className="px-3 py-1.5">
                          {r.status === "ok" && <Badge tone="pos">{t("import.status.ok")}</Badge>}
                          {r.status === "duplicate" && <Badge tone="warn">{t(r.duplicateOf === "file" ? "import.status.dup_file" : "import.status.dup")}</Badge>}
                          {r.status === "error" && <span className="text-neg">{r.errors.map(errText).join("; ")}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  );
}
