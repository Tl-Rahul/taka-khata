"use client";
import { useEffect, type ReactNode } from "react";
import { DataProvider, useData } from "@/lib/data/DataProvider";
import { I18nProvider } from "@/lib/i18n/I18nProvider";
import { FeedbackProvider } from "@/components/ui";
import { TxFormProvider } from "@/components/TxFormProvider";
import { AppShell } from "@/components/AppShell";

function ThemeSync() {
  const { ds } = useData();
  const theme = ds.profile?.theme;
  useEffect(() => {
    if (!theme) return;
    try {
      localStorage.setItem("theme", theme);
    } catch {}
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && mq.matches));
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
  return null;
}

function WithProfile({ children }: { children: ReactNode }) {
  const { ds } = useData();
  return (
    <I18nProvider profile={ds.profile}>
      <FeedbackProvider>
        <TxFormProvider>
          <ThemeSync />
          <AppShell>{children}</AppShell>
        </TxFormProvider>
      </FeedbackProvider>
    </I18nProvider>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <DataProvider>
      <WithProfile>{children}</WithProfile>
    </DataProvider>
  );
}
