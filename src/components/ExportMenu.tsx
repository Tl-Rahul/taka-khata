"use client";
import { useEffect, useRef, useState } from "react";
import { Download, FileSpreadsheet, FileText, Printer } from "lucide-react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { downloadCSV, downloadXLSX, type Table } from "@/lib/export";
import { Button, useFeedback } from "./ui";

/** CSV / Excel / Print for whatever table the page builds on demand. */
export function ExportMenu({ build, filename, print = true }: { build: () => Table[]; filename: string; print?: boolean }) {
  const { t } = useI18n();
  const { toast } = useFeedback();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const run = async (kind: "csv" | "xlsx") => {
    setOpen(false);
    try {
      const tables = build();
      if (!tables.length || tables.every((x) => !x.rows.length)) return toast(t("export.empty"), "info");
      if (kind === "csv") tables.forEach((tb, i) => downloadCSV(tb, `${filename}${tables.length > 1 ? `-${i + 1}` : ""}.csv`));
      else await downloadXLSX(tables, `${filename}.xlsx`);
      toast(t("export.done"));
    } catch {
      toast(t("export.failed"), "neg");
    }
  };
  return (
    <div className="relative" ref={ref}>
      <Button variant="outline" icon={<Download className="size-4" />} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {t("export.button")}
      </Button>
      {open && (
        <div className="sheet-in absolute right-0 z-40 mt-1 w-48 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-card">
          <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-[15px] hover:bg-surface-2" onClick={() => run("csv")}>
            <FileText className="size-4 text-muted" /> CSV
          </button>
          <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-[15px] hover:bg-surface-2" onClick={() => run("xlsx")}>
            <FileSpreadsheet className="size-4 text-muted" /> Excel (.xlsx)
          </button>
          {print && (
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[15px] hover:bg-surface-2"
              onClick={() => {
                setOpen(false);
                setTimeout(() => window.print(), 50);
              }}
            >
              <Printer className="size-4 text-muted" /> {t("export.print")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
