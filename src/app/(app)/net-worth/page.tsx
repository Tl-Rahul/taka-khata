"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { History, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useData } from "@/lib/data/DataProvider";
import { useDerived } from "@/lib/data/useDerived";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { errorText } from "@/lib/data/errors";
import { holdingValue, netWorthHistory } from "@/lib/finance/networth";
import { addMonths, monthStart } from "@/lib/finance/dates";
import { parseAmount } from "@/lib/finance/money";
import { ASSET_CATEGORIES, LIABILITY_CATEGORIES, type Holding, type HoldingKind, type HoldingValuation, type HoldingCategory } from "@/lib/finance/types";
import { Alert, Badge, Button, Card, CardHeader, Checkbox, Empty, Field, IconButton, Input, Modal, PageHeader, Select, Textarea, cx, useFeedback } from "@/components/ui";
import { AmountInput } from "@/components/fields";
import { NetWorthChart } from "@/components/charts";

export default function NetWorthPage() {
  const { ds, today, insert, update, remove } = useData();
  const { nw } = useDerived();
  const i = useI18n();
  const { t, money, date } = i;
  const { toast, confirm } = useFeedback();
  const [range, setRange] = useState(12);
  const history = useMemo(() => netWorthHistory(ds, monthStart(addMonths(today, -(range - 1))), today, today).map((h) => ({ ...h, label: i.month(h.month, true) })), [ds, today, range, i]);

  const [hForm, setHForm] = useState<null | { kind: HoldingKind; editing?: Holding }>(null);
  const [vForm, setVForm] = useState<null | { holding: Holding }>(null);
  const [histFor, setHistFor] = useState<Holding | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<HoldingCategory>("other");
  const [liquid, setLiquid] = useState(false);
  const [value, setValue] = useState("");
  const [vDate, setVDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const openHolding = (kind: HoldingKind, editing?: Holding) => {
    setHForm({ kind, editing });
    setName(editing?.name ?? "");
    setCategory(editing?.category ?? (kind === "asset" ? "investment" : "other_liability"));
    setLiquid(editing?.is_liquid ?? false);
    setValue("");
    setVDate(today);
    setNotes(editing?.notes ?? "");
    setErr(null);
  };
  const openValuation = (h: Holding) => {
    setVForm({ holding: h });
    const cur = holdingValue(h, ds.holding_valuations, today);
    setValue(cur ? String(cur / 100) : "");
    setVDate(today);
    setNotes("");
    setErr(null);
  };

  async function saveHolding(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setErr(t("v.name"));
    const v = value.trim() ? parseAmount(value) : null;
    if (!hForm?.editing && v === null) return setErr(t("v.amount"));
    setSaving(true);
    let createdId: string | null = null;
    try {
      const row: Partial<Holding> = { kind: hForm!.kind, name: name.trim(), category, is_liquid: hForm!.kind === "asset" ? liquid : false, notes: notes.trim() || null };
      if (hForm?.editing) await update<Holding>("holdings", hForm.editing.id, row);
      else {
        const h = await insert<Holding>("holdings", { ...row, archived: false });
        createdId = h.id;
        await insert<HoldingValuation>("holding_valuations", { holding_id: h.id, date: vDate, value: v! });
      }
      toast(t("toast.holding_saved"));
      setHForm(null);
    } catch (e2) {
      if (createdId) await remove("holdings", createdId).catch(() => {});
      setErr(errorText(e2, t));
    } finally {
      setSaving(false);
    }
  }

  async function saveValuation(e: React.FormEvent) {
    e.preventDefault();
    const v = parseAmount(value);
    if (v === null) return setErr(t("v.amount"));
    setSaving(true);
    try {
      const existing = ds.holding_valuations.find((x) => x.holding_id === vForm!.holding.id && x.date === vDate);
      if (existing) await update<HoldingValuation>("holding_valuations", existing.id, { value: v, notes: notes.trim() || null });
      else await insert<HoldingValuation>("holding_valuations", { holding_id: vForm!.holding.id, date: vDate, value: v, notes: notes.trim() || null });
      toast(t("toast.valuation_saved"));
      setVForm(null);
    } catch (e2) {
      setErr(errorText(e2, t));
    } finally {
      setSaving(false);
    }
  }

  const delHolding = async (h: Holding) => {
    if (!(await confirm({ title: t("hold.delete_title"), body: t("hold.delete_body", { name: h.name }), confirmLabel: t("common.delete"), cancelLabel: t("common.cancel"), danger: true }))) return;
    try {
      await remove("holdings", h.id);
      toast(t("toast.holding_deleted"));
    } catch (e) {
      toast(errorText(e, t), "neg");
    }
  };

  const Line = ({ label, value, href, tone, strong }: { label: string; value: number; href?: string; tone?: string; strong?: boolean }) => (
    <div className={cx("flex justify-between gap-3 py-1.5", strong && "border-t border-line pt-2.5 font-semibold")}>
      {href ? (
        <Link href={href} className="text-muted hover:text-ink hover:underline">
          {label}
        </Link>
      ) : (
        <span className={strong ? "" : "text-muted"}>{label}</span>
      )}
      <span className={cx("num", tone)}>{money(value)}</span>
    </div>
  );

  const holdings = (kind: HoldingKind) => ds.holdings.filter((h) => h.kind === kind && !h.archived);

  const HoldingList = ({ kind }: { kind: HoldingKind }) => {
    const items = holdings(kind);
    if (!items.length) return <p className="px-4 pb-4 text-sm text-muted sm:px-5">{t(kind === "asset" ? "hold.none_assets" : "hold.none_liabilities")}</p>;
    return (
      <ul className="divide-y divide-line">
        {items.map((h) => {
          const vals = ds.holding_valuations.filter((v) => v.holding_id === h.id).sort((a, b) => (a.date < b.date ? 1 : -1));
          const v = holdingValue(h, ds.holding_valuations, today);
          return (
            <li key={h.id} className="flex flex-wrap items-center gap-2 px-4 py-3 sm:px-5">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {h.name} {h.is_liquid && <Badge tone="info">{t("acc.liquid_badge")}</Badge>}
                </p>
                <p className="text-sm text-muted">
                  {t(`hold.cat.${h.category}`)} · {vals[0] ? t("hold.valued_on", { date: date(vals[0].date) }) : "—"}
                </p>
              </div>
              <span className={cx("num font-semibold", kind === "liability" && "text-neg")}>{money(v)}</span>
              <div className="flex">
                <IconButton label={t("hold.update_value")} onClick={() => openValuation(h)}>
                  <RefreshCw className="size-4" />
                </IconButton>
                <IconButton label={t("hold.history")} onClick={() => setHistFor(h)}>
                  <History className="size-4" />
                </IconButton>
                <IconButton label={t("common.edit")} onClick={() => openHolding(kind, h)}>
                  <Pencil className="size-4" />
                </IconButton>
                <IconButton label={t("common.delete")} onClick={() => delHolding(h)} className="hover:text-neg">
                  <Trash2 className="size-4" />
                </IconButton>
              </div>
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <>
      <PageHeader title={t("nav.networth")} sub={t("nw.sub")} />
      <Card className="p-4 sm:p-5">
        <p className="text-sm text-muted">{t("nw.net_worth")}</p>
        <p className={cx("num text-3xl font-semibold sm:text-4xl", nw.netWorth < 0 && "text-neg")}>{money(nw.netWorth)}</p>
        <p className="mt-1 text-sm text-muted">{t("nw.formula", { assets: money(nw.totalAssets), liabilities: money(nw.totalLiabilities) })}</p>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("nw.assets")} />
          <div className="px-4 pb-4 text-[15px] sm:px-5">
            <Line label={t("nw.liquid_accounts")} value={nw.liquidAccounts} href="/accounts" />
            <Line label={t("nw.non_liquid_accounts")} value={nw.nonLiquidAccounts} href="/accounts" />
            <Line label={t("nw.receivables")} value={nw.receivables} href="/receivables" />
            <Line label={t("nw.other_assets")} value={nw.holdingAssets} />
            <Line label={t("nw.total_assets")} value={nw.totalAssets} strong />
            <p className="pt-1 text-xs text-muted">{t("nw.liquid_total", { amount: money(nw.liquidAssets) })}</p>
          </div>
        </Card>
        <Card>
          <CardHeader title={t("nw.liabilities")} />
          <div className="px-4 pb-4 text-[15px] sm:px-5">
            <Line label={t("nw.card_balances")} value={nw.accountLiabilities} href="/accounts" />
            <Line label={t("nw.debts_principal")} value={nw.debtPrincipal} href="/debts" />
            <Line label={t("nw.debts_interest")} value={nw.debtInterestDue} href="/debts" />
            <Line label={t("nw.unpaid_bills")} value={nw.unpaidBills} href="/bills" />
            <Line label={t("nw.other_liabilities")} value={nw.holdingLiabilities} />
            <Line label={t("nw.total_liabilities")} value={nw.totalLiabilities} strong tone="text-neg" />
          </div>
        </Card>
      </div>
      <p className="mt-3 text-sm text-muted">{t("nw.rules")}</p>

      <Card className="mt-4">
        <CardHeader
          title={t("nw.history")}
          action={
            <Select value={String(range)} onChange={(e) => setRange(Number(e.target.value))} className="h-8 w-auto text-sm" aria-label={t("nw.range")}>
              {[6, 12, 24, 36].map((n) => (
                <option key={n} value={n}>
                  {t("nw.months", { n })}
                </option>
              ))}
            </Select>
          }
        />
        <div className="px-2 pb-3 sm:px-4">
          <NetWorthChart data={history} />
        </div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("hold.assets")} sub={t("hold.assets_sub")} action={<Button size="sm" icon={<Plus className="size-4" />} onClick={() => openHolding("asset")}>{t("hold.add_asset")}</Button>} />
          <HoldingList kind="asset" />
        </Card>
        <Card>
          <CardHeader title={t("hold.liabilities")} sub={t("hold.liabilities_sub")} action={<Button size="sm" variant="outline" icon={<Plus className="size-4" />} onClick={() => openHolding("liability")}>{t("hold.add_liability")}</Button>} />
          <HoldingList kind="liability" />
        </Card>
      </div>

      <Modal open={!!hForm} onClose={() => setHForm(null)} title={hForm?.editing ? t("hold.edit") : t(hForm?.kind === "asset" ? "hold.add_asset" : "hold.add_liability")}>
        <form onSubmit={saveHolding} className="space-y-4" noValidate>
          <Field label={t("hold.name")} htmlFor="h-name">
            <Input id="h-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={t(hForm?.kind === "asset" ? "hold.name_ph_asset" : "hold.name_ph_liab")} data-autofocus />
          </Field>
          <Field label={t("hold.category")} htmlFor="h-cat">
            <Select id="h-cat" value={category} onChange={(e) => setCategory(e.target.value as HoldingCategory)}>
              {(hForm?.kind === "asset" ? ASSET_CATEGORIES : LIABILITY_CATEGORIES).map((c) => (
                <option key={c} value={c}>
                  {t(`hold.cat.${c}`)}
                </option>
              ))}
            </Select>
          </Field>
          {!hForm?.editing && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t(hForm?.kind === "asset" ? "hold.current_value" : "hold.amount_owed")} htmlFor="h-val">
                <AmountInput id="h-val" value={value} onChange={setValue} />
              </Field>
              <Field label={t("hold.as_of")} htmlFor="h-date">
                <Input id="h-date" type="date" value={vDate} onChange={(e) => setVDate(e.target.value)} />
              </Field>
            </div>
          )}
          {hForm?.kind === "asset" && <Checkbox label={t("hold.is_liquid")} checked={liquid} onChange={setLiquid} />}
          <Field label={t("f.notes")} htmlFor="h-notes">
            <Textarea id="h-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
          </Field>
          {err && <Alert tone="neg">{err}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setHForm(null)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" loading={saving}>
              {t("common.save")}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!vForm} onClose={() => setVForm(null)} title={`${t("hold.update_value")} — ${vForm?.holding.name ?? ""}`} size="sm">
        <form onSubmit={saveValuation} className="space-y-4" noValidate>
          <Field label={t("hold.value")} htmlFor="v-val">
            <AmountInput id="v-val" value={value} onChange={setValue} big data-autofocus />
          </Field>
          <Field label={t("hold.as_of")} htmlFor="v-date">
            <Input id="v-date" type="date" value={vDate} onChange={(e) => setVDate(e.target.value)} />
          </Field>
          <Field label={t("f.notes")} htmlFor="v-notes">
            <Input id="v-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
          </Field>
          {err && <Alert tone="neg">{err}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setVForm(null)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" loading={saving}>
              {t("common.save")}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!histFor} onClose={() => setHistFor(null)} title={`${t("hold.history")} — ${histFor?.name ?? ""}`} size="sm">
        {histFor && (
          <ul className="divide-y divide-line">
            {ds.holding_valuations
              .filter((v) => v.holding_id === histFor.id)
              .sort((a, b) => (a.date < b.date ? 1 : -1))
              .map((v) => (
                <li key={v.id} className="flex items-center gap-3 py-2 text-sm">
                  <span className="w-28">{date(v.date)}</span>
                  <span className="min-w-0 flex-1 truncate text-muted">{v.notes}</span>
                  <span className="num font-medium">{money(v.value)}</span>
                  <IconButton
                    label={t("common.delete")}
                    className="hover:text-neg"
                    onClick={async () => {
                      try {
                        await remove("holding_valuations", v.id);
                      } catch (e) {
                        toast(errorText(e, t), "neg");
                      }
                    }}
                  >
                    <Trash2 className="size-4" />
                  </IconButton>
                </li>
              ))}
          </ul>
        )}
        {histFor && !ds.holding_valuations.some((v) => v.holding_id === histFor.id) && <Empty title={t("hold.no_values")} />}
      </Modal>
    </>
  );
}
