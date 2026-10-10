"use client";
import { useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { useStandaloneI18n } from "@/lib/i18n/I18nProvider";
import { Alert, Button, Field, Input } from "@/components/ui";

export default function ResetPasswordPage() {
  const { t } = useStandaloneI18n();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "neg" | "pos"; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 8) return setMsg({ tone: "neg", text: t("auth.short_password") });
    if (pw !== pw2) return setMsg({ tone: "neg", text: t("auth.mismatch") });
    setBusy(true);
    const { error } = await getSupabase().auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setMsg({ tone: "neg", text: error.message });
    setMsg({ tone: "pos", text: t("auth.password_changed") });
    setTimeout(() => (window.location.href = "/"), 1200);
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-line bg-surface p-6 shadow-card" noValidate>
        <h1 className="text-xl font-semibold">{t("auth.new_password")}</h1>
        <Field label={t("auth.password")} htmlFor="pw" hint={t("auth.password_hint")}>
          <Input id="pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
        <Field label={t("auth.password_again")} htmlFor="pw2">
          <Input id="pw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </Field>
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <Button type="submit" className="w-full" loading={busy}>
          {t("auth.save_password")}
        </Button>
      </form>
    </main>
  );
}
