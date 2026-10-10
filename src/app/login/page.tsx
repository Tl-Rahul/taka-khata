"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getSupabase } from "@/lib/supabase/client";
import { useStandaloneI18n } from "@/lib/i18n/I18nProvider";
import { Alert, Button, Field, Input, Segmented } from "@/components/ui";

type Mode = "signin" | "signup" | "reset";

function LoginInner() {
  const { t, locale, setLocale } = useStandaloneI18n();
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "neg" | "pos" | "info"; text: string } | null>(null);

  useEffect(() => {
    const e = params.get("error");
    if (e === "not_allowed") setMsg({ tone: "neg", text: t("auth.not_allowed") });
    else if (e === "link") setMsg({ tone: "neg", text: t("auth.bad_link") });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, locale]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const next = params.get("next");
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!/^\S+@\S+\.\S+$/.test(email)) return setMsg({ tone: "neg", text: t("auth.bad_email") });
    if (mode !== "reset" && password.length < 8) return setMsg({ tone: "neg", text: t("auth.short_password") });
    setBusy(true);
    try {
      const sb = getSupabase();
      if (mode === "signin") {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        window.location.href = safeNext;
        return;
      }
      if (mode === "signup") {
        const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: `${origin}/auth/callback` } });
        if (error) throw error;
        if (data.session) {
          window.location.href = "/";
          return;
        }
        setMsg({ tone: "pos", text: t("auth.check_email") });
      } else {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth/callback?next=/auth/reset` });
        if (error) throw error;
        setMsg({ tone: "pos", text: t("auth.reset_sent") });
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      const key = /invalid login/i.test(m)
        ? "auth.invalid"
        : /not confirmed/i.test(m)
          ? "auth.not_confirmed"
          : /already registered/i.test(m)
            ? "auth.exists"
            : /signups not allowed|signup is disabled/i.test(m)
              ? "auth.signup_disabled"
              : /rate limit/i.test(m)
                ? "auth.rate_limit"
                : null;
      setMsg({ tone: "neg", text: key ? t(key) : m });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src="/icon.svg" alt="" className="size-9" />
            <span className="text-xl font-semibold">{t("app.name")}</span>
          </div>
          <Segmented size="sm" value={locale} onChange={setLocale} options={[{ value: "bn", label: "বাংলা" }, { value: "en", label: "EN" }]} />
        </div>
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
          <h1 className="text-xl font-semibold">{t(`auth.title.${mode}`)}</h1>
          <p className="mt-1 text-sm text-muted">{t("auth.tagline")}</p>
          <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
            <Field label={t("auth.email")} htmlFor="email">
              <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value.trim())} required />
            </Field>
            {mode !== "reset" && (
              <Field label={t("auth.password")} htmlFor="password" hint={mode === "signup" ? t("auth.password_hint") : undefined}>
                <Input id="password" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
              </Field>
            )}
            {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
            <Button type="submit" className="w-full" size="lg" loading={busy}>
              {t(`auth.submit.${mode}`)}
            </Button>
          </form>
          <div className="mt-4 flex flex-wrap justify-between gap-2 text-sm">
            {mode !== "signin" && (
              <button type="button" className="text-brand hover:underline" onClick={() => setMode("signin")}>
                {t("auth.to_signin")}
              </button>
            )}
            {mode !== "signup" && (
              <button type="button" className="text-brand hover:underline" onClick={() => setMode("signup")}>
                {t("auth.to_signup")}
              </button>
            )}
            {mode !== "reset" && (
              <button type="button" className="text-muted hover:text-ink hover:underline" onClick={() => setMode("reset")}>
                {t("auth.forgot")}
              </button>
            )}
          </div>
        </div>
        <p className="mt-4 text-center text-xs text-muted">{t("auth.privacy")}</p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
