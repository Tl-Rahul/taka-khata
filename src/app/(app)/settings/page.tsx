"use client";
import { useEffect, useRef, useState } from "react";
import { Database, Download, KeyRound, LogOut, Pencil, Trash2, Upload } from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";
import { useData } from "@/lib/data/DataProvider";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { errorText } from "@/lib/data/errors";
import { buildBackup, downloadBlob, validateBackup, transactionsTable, downloadXLSX } from "@/lib/export";
import { compareTxDesc } from "@/lib/finance/engine";
import type { Contact, Profile, ReminderSettings } from "@/lib/finance/types";
import { Alert, Button, Card, CardHeader, Field, IconButton, Input, Modal, Segmented, Select, Switch, Textarea, useFeedback } from "@/components/ui";
import { CategoryManager } from "@/components/CategoryManager";

const BACKUP_KEY = "lastBackupAt";

export default function SettingsPage() {
  const { ds, saveProfile, email, reload, update, remove } = useData();
  const i = useI18n();
  const { t, date } = i;
  const { toast, confirm } = useFeedback();
  const p = ds.profile;
  const [displayName, setDisplayName] = useState(p?.display_name ?? "");
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pw, setPw] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [contactEdit, setContactEdit] = useState<Contact | null>(null);
  const [cName, setCName] = useState("");
  const [cPhone, setCPhone] = useState("");
  const [cNotes, setCNotes] = useState("");

  useEffect(() => {
    try {
      setLastBackup(localStorage.getItem(BACKUP_KEY));
    } catch {}
  }, []);

  const set = async (patch: Partial<Profile>) => {
    try {
      await saveProfile(patch);
      toast(t("toast.settings_saved"));
    } catch (e) {
      toast(errorText(e, t), "neg");
    }
  };
  const setRem = (patch: Partial<ReminderSettings>) => p && set({ reminders: { ...p.reminders, ...patch } });

  const enableBrowser = async (on: boolean) => {
    if (on && typeof Notification !== "undefined" && Notification.permission !== "granted") {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return toast(t("set.browser_denied"), "neg");
    }
    setRem({ browser: on });
  };

  const backup = () => {
    const data = buildBackup(ds);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBlob(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" }), `taka-khata-backup-${stamp}.json`);
    const now = new Date().toISOString();
    try {
      localStorage.setItem(BACKUP_KEY, now);
    } catch {}
    setLastBackup(now);
    toast(t("backup.downloaded"));
  };

  const restore = async (f: File | undefined) => {
    if (!f) return;
    let json: unknown;
    try {
      json = JSON.parse(await f.text());
    } catch {
      toast(t("backup.err.not_json"), "neg");
      return;
    }
    const v = validateBackup(json);
    if (!v.ok) {
      toast(t(v.error), "neg");
      return;
    }
    const ok = await confirm({
      title: t("backup.restore_title"),
      body: (
        <>
          <p>{t("backup.restore_body", { tx: v.counts.transactions, acc: v.counts.accounts })}</p>
          <p className="mt-2 font-medium text-neg">{t("backup.restore_warning")}</p>
        </>
      ),
      confirmLabel: t("backup.restore_confirm"),
      cancelLabel: t("common.cancel"),
      danger: true,
    });
    if (fileRef.current) fileRef.current.value = "";
    if (!ok) return;
    setRestoring(true);
    try {
      const { error } = await getSupabase().rpc("restore_backup", { payload: json });
      if (error) throw Object.assign(new Error(error.message), { code: error.code });
      await reload();
      toast(t("backup.restored"));
    } catch (e) {
      toast(`${t("backup.restore_failed")} ${e instanceof Error ? e.message : ""}`, "neg");
    } finally {
      setRestoring(false);
    }
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) return toast(t("auth.short_password"), "neg");
    setPwBusy(true);
    const { error } = await getSupabase().auth.updateUser({ password: pw });
    setPwBusy(false);
    if (error) return toast(error.message, "neg");
    setPw("");
    toast(t("auth.password_changed"));
  };

  const contactUsage = (id: string) => ds.loans.filter((l) => l.contact_id === id).length + ds.transactions.filter((x) => x.contact_id === id).length;

  if (!p) return null;
  const daysSinceBackup = lastBackup ? Math.floor((Date.now() - new Date(lastBackup).getTime()) / 864e5) : null;

  return (
    <>
      <h1 className="ledger-rule mb-5 pb-2 text-2xl font-semibold sm:text-[28px]">{t("nav.settings")}</h1>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card id="preferences">
          <CardHeader title={t("set.preferences")} />
          <div className="space-y-4 px-4 pb-5 sm:px-5">
            <Field label={t("set.name")} htmlFor="s-name">
              <div className="flex gap-2">
                <Input id="s-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={80} />
                <Button variant="outline" onClick={() => set({ display_name: displayName.trim() || null })} disabled={(p.display_name ?? "") === displayName.trim()}>
                  {t("common.save")}
                </Button>
              </div>
            </Field>
            <Field label={t("set.language")}>
              <Segmented value={p.locale} onChange={(v) => set({ locale: v })} options={[{ value: "bn", label: "বাংলা" }, { value: "en", label: "English" }]} />
            </Field>
            {p.locale === "bn" && <Switch label={t("set.bangla_digits")} checked={p.bangla_digits} onChange={(v) => set({ bangla_digits: v })} />}
            <Field label={t("set.date_format")} htmlFor="s-df">
              <Select id="s-df" value={p.date_format} onChange={(e) => set({ date_format: e.target.value as Profile["date_format"] })}>
                {(["dd/MM/yyyy", "d MMM yyyy", "yyyy-MM-dd", "MM/dd/yyyy"] as const).map((f) => (
                  <option key={f} value={f}>
                    {f} — {date("2026-10-09", f)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("set.theme")}>
              <Segmented value={p.theme} onChange={(v) => set({ theme: v })} options={[{ value: "light", label: t("set.light") }, { value: "dark", label: t("set.dark") }, { value: "system", label: t("set.system") }]} />
            </Field>
            <p className="text-sm text-muted">{t("set.currency_note")}</p>
          </div>
        </Card>

        <Card id="reminders">
          <CardHeader title={t("set.reminders")} sub={t("set.reminders_sub")} />
          <div className="divide-y divide-line px-4 pb-4 sm:px-5">
            <Switch label={t("set.rem.bills")} checked={p.reminders.bills} onChange={(v) => setRem({ bills: v })} />
            <Switch label={t("set.rem.installments")} checked={p.reminders.installments} onChange={(v) => setRem({ installments: v })} />
            <Switch label={t("set.rem.receivables")} checked={p.reminders.receivables} onChange={(v) => setRem({ receivables: v })} />
            <Switch label={t("set.rem.budgets")} checked={p.reminders.budgets} onChange={(v) => setRem({ budgets: v })} />
            <Switch label={t("set.rem.browser")} checked={p.reminders.browser} onChange={enableBrowser} />
            <div className="flex items-center justify-between gap-3 py-2">
              <label htmlFor="s-days" className="text-[15px]">
                {t("set.rem.days_before")}
              </label>
              <Select id="s-days" className="w-24" value={String(p.reminders.days_before)} onChange={(e) => setRem({ days_before: Number(e.target.value) })}>
                {[0, 1, 2, 3, 5, 7, 10, 14].map((n) => (
                  <option key={n} value={n}>
                    {i.digits(n)}
                  </option>
                ))}
              </Select>
            </div>
            <p className="pt-2 text-xs text-muted">{t("set.rem.note")}</p>
          </div>
        </Card>

        <Card id="categories" className="lg:col-span-2">
          <CardHeader title={t("set.categories")} sub={t("set.categories_sub")} />
          <div className="px-4 pb-4 sm:px-5">
            <CategoryManager />
          </div>
        </Card>

        <Card id="people">
          <CardHeader title={t("set.people")} sub={t("set.people_sub")} />
          {ds.contacts.length ? (
            <ul className="divide-y divide-line px-4 pb-3 sm:px-5">
              {[...ds.contacts]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((c) => (
                  <li key={c.id} className="flex items-center gap-2 py-2">
                    <span className="min-w-0 flex-1 truncate">
                      {c.name}
                      {c.phone && <span className="ml-2 text-sm text-muted">{c.phone}</span>}
                    </span>
                    <span className="text-xs text-muted">{t("set.people_loans", { n: ds.loans.filter((l) => l.contact_id === c.id).length })}</span>
                    <IconButton
                      label={t("common.edit")}
                      onClick={() => {
                        setContactEdit(c);
                        setCName(c.name);
                        setCPhone(c.phone ?? "");
                        setCNotes(c.notes ?? "");
                      }}
                    >
                      <Pencil className="size-4" />
                    </IconButton>
                    <IconButton
                      label={t("common.delete")}
                      className="hover:text-neg"
                      onClick={async () => {
                        if (contactUsage(c.id)) return toast(t("set.people_in_use"), "neg");
                        if (!(await confirm({ title: t("set.people_delete"), body: c.name, confirmLabel: t("common.delete"), cancelLabel: t("common.cancel"), danger: true }))) return;
                        try {
                          await remove("contacts", c.id);
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
          ) : (
            <p className="px-4 pb-4 text-sm text-muted sm:px-5">{t("set.people_empty")}</p>
          )}
        </Card>

        <Card id="data">
          <CardHeader title={t("set.data")} sub={t("set.data_sub")} />
          <div className="space-y-3 px-4 pb-5 sm:px-5">
            {daysSinceBackup === null || daysSinceBackup > 30 ? <Alert tone="warn">{daysSinceBackup === null ? t("backup.never") : t("backup.old", { n: daysSinceBackup })}</Alert> : <p className="text-sm text-muted">{t("backup.last", { date: date(lastBackup!.slice(0, 10)) })}</p>}
            <div className="flex flex-wrap gap-2">
              <Button icon={<Database className="size-4" />} onClick={backup}>
                {t("backup.download")}
              </Button>
              <Button
                variant="outline"
                icon={<Download className="size-4" />}
                onClick={async () => {
                  try {
                    await downloadXLSX([transactionsTable([...ds.transactions].sort(compareTxDesc), ds, t, i.catName)], "transactions.xlsx");
                  } catch {
                    toast(t("export.failed"), "neg");
                  }
                }}
              >
                {t("backup.export_excel")}
              </Button>
            </div>
            <div className="border-t border-line pt-3">
              <p className="text-sm text-muted">{t("backup.restore_help")}</p>
              <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => restore(e.target.files?.[0])} />
              <Button className="mt-2" variant="outline" icon={<Upload className="size-4" />} loading={restoring} onClick={() => fileRef.current?.click()}>
                {t("backup.restore")}
              </Button>
            </div>
          </div>
        </Card>

        <Card id="security" className="lg:col-span-2">
          <CardHeader title={t("set.security")} sub={t("set.signed_in_as", { email: email ?? "" })} />
          <div className="grid gap-4 px-4 pb-5 sm:px-5 md:grid-cols-2">
            <form onSubmit={changePassword} className="space-y-2">
              <Field label={t("auth.new_password")} htmlFor="s-pw" hint={t("auth.password_hint")}>
                <Input id="s-pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
              </Field>
              <Button type="submit" variant="outline" icon={<KeyRound className="size-4" />} loading={pwBusy}>
                {t("auth.save_password")}
              </Button>
            </form>
            <div className="space-y-3">
              <Alert tone="info">{t("set.security_note")}</Alert>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" icon={<LogOut className="size-4" />} onClick={() => getSupabase().auth.signOut()}>
                  {t("set.sign_out")}
                </Button>
                <Button variant="ghost" onClick={() => getSupabase().auth.signOut({ scope: "global" })}>
                  {t("set.sign_out_all")}
                </Button>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <Modal open={!!contactEdit} onClose={() => setContactEdit(null)} title={t("set.people_edit")} size="sm">
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!cName.trim()) return;
            try {
              await update<Contact>("contacts", contactEdit!.id, { name: cName.trim(), phone: cPhone.trim() || null, notes: cNotes.trim() || null });
              setContactEdit(null);
              toast(t("toast.settings_saved"));
            } catch (er) {
              toast(errorText(er, t), "neg");
            }
          }}
        >
          <Field label={t("set.people_name")} htmlFor="ct-name">
            <Input id="ct-name" value={cName} onChange={(e) => setCName(e.target.value)} maxLength={120} data-autofocus />
          </Field>
          <Field label={t("set.people_phone")} htmlFor="ct-phone">
            <Input id="ct-phone" inputMode="tel" value={cPhone} onChange={(e) => setCPhone(e.target.value)} maxLength={30} />
          </Field>
          <Field label={t("f.notes")} htmlFor="ct-notes">
            <Textarea id="ct-notes" value={cNotes} onChange={(e) => setCNotes(e.target.value)} maxLength={2000} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setContactEdit(null)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit">{t("common.save")}</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
