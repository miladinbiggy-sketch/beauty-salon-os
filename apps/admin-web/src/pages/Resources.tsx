import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { ResourceType } from "@salon/shared";
import { api, ApiError, type Resource } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { btnGhost, btnPrimary, btnSmall, cardCls, Field, inputCls, Loading, Modal, useToast } from "../lib/ui";
import type { MessageKey } from "@salon/i18n";

const TYPES: ResourceType[] = ["nail_table", "lash_bed", "beauty_bed", "chair", "room"];

export default function ResourcesPage() {
  const { t } = useI18n();
  const { toast } = useToast();
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Resource | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<{ type: ResourceType; name: string; active: boolean }>({ type: "nail_table", name: "", active: true });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setResources(await api.get<Resource[]>("/admin/resources"));
    } catch {
      /* 保持 */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => {
    const map = new Map<ResourceType, Resource[]>();
    for (const r of resources) {
      const arr = map.get(r.type) ?? [];
      arr.push(r);
      map.set(r.type, arr);
    }
    return TYPES.filter((ty) => map.has(ty)).map((ty) => ({ type: ty, items: map.get(ty) ?? [] }));
  }, [resources]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (editing) await api.put(`/admin/resources/${editing.id}`, form);
      else await api.post("/admin/resources", form);
      toast(t("common.saved"));
      setEditing(null);
      setCreating(false);
      await load();
    } catch (e) {
      toast(e instanceof ApiError && e.status === 409 ? t("admin.resources.futureConflict") : t("common.failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function deactivate(r: Resource) {
    try {
      await api.del(`/admin/resources/${r.id}`);
      toast(t("common.saved"));
      await load();
    } catch (e) {
      toast(e instanceof ApiError && e.status === 409 ? t("admin.resources.futureConflict") : t("common.failed"), "error");
    }
  }

  if (loading) return <Loading />;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold text-slate-800">{t("admin.nav.resources")}</h1>
        <button
          type="button"
          className={`${btnPrimary} ml-auto`}
          onClick={() => {
            setCreating(true);
            setEditing(null);
            setForm({ type: "nail_table", name: "", active: true });
          }}
        >
          {t("common.add")}
        </button>
      </div>

      <p className="text-xs leading-relaxed text-amber-700">{t("admin.resources.guardHint")}</p>
      {grouped.map((g) => (
        <section key={g.type}>
          <h2 className="mb-2 text-sm font-semibold text-slate-600">{t(`resource.${g.type}` as MessageKey)}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {g.items.map((r) => (
              <div key={r.id} className={`p-3 ${cardCls} ${r.active ? "" : "opacity-60"}`}>
                <div className="truncate font-medium text-slate-700">{r.name}</div>
                <div className="mt-1 flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${r.active ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400"}`}>
                    {r.active ? t("common.active") : t("common.inactive")}
                  </span>
                  <span className="ml-auto flex gap-1">
                    <button
                      type="button"
                      className={btnSmall}
                      onClick={() => {
                        setEditing(r);
                        setCreating(false);
                        setForm({ type: r.type, name: r.name, active: r.active });
                      }}
                    >
                      {t("common.edit")}
                    </button>
                    {r.active && (
                      <button type="button" className={btnSmall} onClick={() => void deactivate(r)}>
                        {t("common.inactive")}
                      </button>
                    )}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
      {resources.length === 0 && <div className="py-8 text-center text-sm text-slate-300">{t("common.none")}</div>}

      {(creating || editing) && (
        <Modal title={editing ? t("common.edit") : t("common.add")} onClose={() => { setCreating(false); setEditing(null); }}>
          <form className="flex flex-col gap-3" onSubmit={submit}>
            <Field label={t("admin.resources.name")}>
              <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </Field>
            <Field label={t("admin.resources.type")}>
              <select className={inputCls} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as ResourceType })}>
                {TYPES.map((ty) => (
                  <option key={ty} value={ty}>
                    {t(`resource.${ty}` as MessageKey)}
                  </option>
                ))}
              </select>
            </Field>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              {t("common.active")}
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" className={btnGhost} onClick={() => { setCreating(false); setEditing(null); }}>
                {t("common.cancel")}
              </button>
              <button type="submit" className={btnPrimary} disabled={busy}>
                {t("common.save")}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
