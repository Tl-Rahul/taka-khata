"use client";
import { useState } from "react";
import { Archive, ArchiveRestore, Pencil, Plus, Trash2 } from "lucide-react";
import { useData } from "@/lib/data/DataProvider";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { errorText } from "@/lib/data/errors";
import type { Category, CategoryKind } from "@/lib/finance/types";
import { Alert, Badge, Button, Dot, Field, IconButton, Input, Modal, Segmented, Select, cx, useFeedback } from "./ui";

export function CategoryManager() {
  const { ds, insert, update, remove } = useData();
  const { t, catName } = useI18n();
  const { toast, confirm } = useFeedback();
  const [kind, setKind] = useState<CategoryKind>("expense");
  const [showArchived, setShowArchived] = useState(false);
  const [form, setForm] = useState<null | { editing?: Category; parentId?: string | null }>(null);
  const [name, setName] = useState("");
  const [nameBn, setNameBn] = useState("");
  const [parentId, setParentId] = useState("");
  const [color, setColor] = useState("#7a8580");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const cats = ds.categories.filter((c) => c.kind === kind && (showArchived || !c.archived));
  const parents = cats.filter((c) => !c.parent_id).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  const usage = (id: string) => ds.transactions.filter((x) => x.category_id === id).length + ds.recurring.filter((r) => r.category_id === id).length;

  const open = (o: { editing?: Category; parentId?: string | null }) => {
    setForm(o);
    setName(o.editing?.name ?? "");
    setNameBn(o.editing?.name_bn ?? "");
    setParentId(o.editing?.parent_id ?? o.parentId ?? "");
    setColor(o.editing?.color ?? "#7a8580");
    setErr(null);
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() && !nameBn.trim()) return setErr(t("v.name"));
    const n = name.trim() || nameBn.trim();
    const siblings = ds.categories.filter((c) => c.kind === kind && (c.parent_id ?? "") === parentId && c.id !== form?.editing?.id);
    if (siblings.some((c) => c.name.toLowerCase() === n.toLowerCase())) return setErr(t("cat.exists"));
    setSaving(true);
    try {
      const row: Partial<Category> = { kind, name: n, name_bn: nameBn.trim() || null, parent_id: parentId || null, color };
      if (form?.editing) await update<Category>("categories", form.editing.id, row);
      else await insert<Category>("categories", { ...row, sort_order: 1000 + ds.categories.length, archived: false });
      toast(t("toast.category_saved"));
      setForm(null);
    } catch (e2) {
      setErr(errorText(e2, t));
    } finally {
      setSaving(false);
    }
  }

  const del = async (c: Category) => {
    const children = ds.categories.filter((x) => x.parent_id === c.id);
    if (usage(c.id) || children.length || c.system_key) {
      toast(t(c.system_key ? "cat.system_no_delete" : "cat.in_use"), "neg");
      return;
    }
    const budgets = ds.budgets.filter((b) => b.category_id === c.id).length;
    if (!(await confirm({ title: t("cat.delete_title"), body: budgets ? t("cat.delete_budgets", { n: budgets }) : t("cat.delete_body", { name: catName(c) }), confirmLabel: t("common.delete"), cancelLabel: t("common.cancel"), danger: true }))) return;
    try {
      await remove("categories", c.id);
      toast(t("toast.category_deleted"));
    } catch (e) {
      toast(errorText(e, t), "neg");
    }
  };

  const toggleArchive = async (c: Category) => {
    try {
      await update<Category>("categories", c.id, { archived: !c.archived });
    } catch (e) {
      toast(errorText(e, t), "neg");
    }
  };

  const Row = ({ c, child }: { c: Category; child?: boolean }) => (
    <li className={cx("flex items-center gap-2 py-2", child && "pl-6", c.archived && "opacity-60")}>
      <Dot color={c.color} />
      <span className="min-w-0 flex-1 truncate">
        {catName(c)}
        {c.name_bn && c.name !== c.name_bn && <span className="ml-2 text-sm text-muted">{catName(c) === c.name ? c.name_bn : c.name}</span>}
      </span>
      {c.system_key && <Badge tone="info">{t("cat.system")}</Badge>}
      {c.archived && <Badge>{t("acc.archived_badge")}</Badge>}
      {!child && !c.archived && (
        <IconButton label={t("cat.add_sub")} onClick={() => open({ parentId: c.id })}>
          <Plus className="size-4" />
        </IconButton>
      )}
      <IconButton label={t("common.edit")} onClick={() => open({ editing: c })}>
        <Pencil className="size-4" />
      </IconButton>
      {!c.system_key && (
        <IconButton label={c.archived ? t("acc.unarchive") : t("acc.archive")} onClick={() => toggleArchive(c)}>
          {c.archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
        </IconButton>
      )}
      {!c.system_key && (
        <IconButton label={t("common.delete")} onClick={() => del(c)} className="hover:text-neg">
          <Trash2 className="size-4" />
        </IconButton>
      )}
    </li>
  );

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented size="sm" value={kind} onChange={setKind} options={[{ value: "expense", label: t("cat.expense") }, { value: "income", label: t("cat.income") }]} />
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-sm text-muted">
            <input type="checkbox" className="accent-[var(--brand)]" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            {t("cat.show_archived")}
          </label>
          <Button size="sm" icon={<Plus className="size-4" />} onClick={() => open({ parentId: null })}>
            {t("cat.add")}
          </Button>
        </div>
      </div>
      <ul className="mt-3 divide-y divide-line">
        {parents.map((p) => (
          <li key={p.id}>
            <ul>
              <Row c={p} />
              {cats
                .filter((c) => c.parent_id === p.id)
                .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
                .map((c) => (
                  <Row key={c.id} c={c} child />
                ))}
            </ul>
          </li>
        ))}
      </ul>

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.editing ? t("cat.edit") : form?.parentId ? t("cat.add_sub") : t("cat.add")} size="sm">
        <form onSubmit={save} className="space-y-4" noValidate>
          <Field label={t("cat.name_en")} htmlFor="c-name">
            <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} data-autofocus />
          </Field>
          <Field label={t("cat.name_bn")} htmlFor="c-bn">
            <Input id="c-bn" value={nameBn} onChange={(e) => setNameBn(e.target.value)} maxLength={60} />
          </Field>
          {!form?.editing?.system_key && !(form?.editing && ds.categories.some((c) => c.parent_id === form.editing!.id)) && (
            <Field label={t("cat.parent")} htmlFor="c-parent">
              <Select id="c-parent" value={parentId} onChange={(e) => setParentId(e.target.value)}>
                <option value="">{t("cat.no_parent")}</option>
                {ds.categories
                  .filter((c) => c.kind === kind && !c.parent_id && !c.archived && c.id !== form?.editing?.id && !c.system_key)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {catName(c)}
                    </option>
                  ))}
              </Select>
            </Field>
          )}
          <Field label={t("acc.color")} htmlFor="c-color">
            <input id="c-color" type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-10 w-14 cursor-pointer rounded-lg border border-line bg-surface" />
          </Field>
          {err && <Alert tone="neg">{err}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setForm(null)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" loading={saving}>
              {t("common.save")}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
