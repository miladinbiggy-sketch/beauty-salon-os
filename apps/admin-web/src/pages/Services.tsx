import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { ResourceType, ServiceCategory } from "@salon/shared";
import { api, ApiError, type Service, type ServiceAddon } from "../lib/api";
import { localizedName, useI18n } from "../lib/i18n";
import { btnGhost, btnPrimary, btnSmall, cardCls, Field, inputCls, Loading, Modal, useToast, useYen } from "../lib/ui";
import type { MessageKey } from "@salon/i18n";

const CATEGORIES: ServiceCategory[] = ["nail", "lash", "beauty", "other"];
const RESOURCE_TYPES: ResourceType[] = ["nail_table", "lash_bed", "beauty_bed", "chair", "room"];

interface ServiceForm {
  category: ServiceCategory;
  nameZh: string;
  nameJa: string;
  durationMinutes: string;
  bufferMinutes: string;
  priceJpy: string;
  resourceType: string;
  color: string;
  sortOrder: string;
  active: boolean;
}

const EMPTY_FORM: ServiceForm = {
  category: "nail",
  nameZh: "",
  nameJa: "",
  durationMinutes: "60",
  bufferMinutes: "10",
  priceJpy: "6000",
  resourceType: "",
  color: "#3b82f6",
  sortOrder: "0",
  active: true,
};

export default function ServicesPage() {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const yen = useYen();
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Service | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<ServiceForm>(EMPTY_FORM);
  const [addonForms, setAddonForms] = useState<Record<string, { nameZh: string; nameJa: string; priceJpy: string; durationMinutes: string }>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setServices(await api.get<Service[]>("/admin/services"));
    } catch {
      /* 保持 */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openEdit(s: Service) {
    setEditing(s);
    setForm({
      category: s.category,
      nameZh: s.nameZh,
      nameJa: s.nameJa,
      durationMinutes: String(s.durationMinutes),
      bufferMinutes: String(s.bufferMinutes),
      priceJpy: String(s.priceJpy),
      resourceType: s.resourceType ?? "",
      color: s.color,
      sortOrder: String(s.sortOrder),
      active: s.active,
    });
  }

  function openCreate() {
    setCreating(true);
    setEditing(null);
    setForm(EMPTY_FORM);
  }

  async function submitForm(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const body = {
      category: form.category,
      nameZh: form.nameZh.trim(),
      nameJa: form.nameJa.trim(),
      durationMinutes: Number(form.durationMinutes),
      bufferMinutes: Number(form.bufferMinutes),
      priceJpy: Number(form.priceJpy),
      resourceType: form.resourceType ? (form.resourceType as ResourceType) : null,
      color: form.color,
      sortOrder: Number(form.sortOrder),
      active: form.active,
    };
    try {
      if (editing) await api.put(`/admin/services/${editing.id}`, body);
      else await api.post("/admin/services", body);
      toast(t("common.saved"));
      setEditing(null);
      setCreating(false);
      await load();
    } catch (e) {
      toast(e instanceof ApiError && e.status === 409 ? t("admin.services.bookedConflict") : t("common.failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function deactivate(s: Service) {
    try {
      await api.del(`/admin/services/${s.id}`);
      toast(t("common.saved"));
      await load();
    } catch (e) {
      toast(e instanceof ApiError && e.status === 409 ? t("admin.services.bookedConflict") : t("common.failed"), "error");
    }
  }

  async function addAddon(serviceId: string) {
    const f = addonForms[serviceId];
    if (!f || !f.nameZh.trim() || !f.nameJa.trim()) return;
    try {
      await api.post(`/admin/services/${serviceId}/addons`, {
        nameZh: f.nameZh.trim(),
        nameJa: f.nameJa.trim(),
        priceJpy: Number(f.priceJpy || 0),
        durationMinutes: Number(f.durationMinutes || 0),
      });
      setAddonForms((prev) => ({ ...prev, [serviceId]: { nameZh: "", nameJa: "", priceJpy: "", durationMinutes: "" } }));
      await load();
    } catch {
      toast(t("common.failed"), "error");
    }
  }

  async function removeAddon(addon: ServiceAddon) {
    try {
      await api.del(`/admin/addons/${addon.id}`);
      await load();
    } catch {
      toast(t("common.failed"), "error");
    }
  }

  if (loading) return <Loading />;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold text-slate-800">{t("admin.nav.services")}</h1>
        <button type="button" className={`${btnPrimary} ml-auto`} onClick={openCreate}>
          {t("common.add")}
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {services.map((s) => (
          <div key={s.id} className={`p-4 ${cardCls} ${s.active ? "" : "opacity-60"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
              <span className="min-w-0 truncate text-base font-semibold text-slate-800">
                {localizedName(locale, s.nameZh, s.nameJa)}
              </span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                {t(`category.${s.category}` as MessageKey)}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-xs ${s.active ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400"}`}>
                {s.active ? t("common.active") : t("common.inactive")}
              </span>
              <span className="ml-auto flex shrink-0 gap-1">
                <button type="button" className={btnSmall} onClick={() => openEdit(s)}>
                  {t("common.edit")}
                </button>
                {s.active && (
                  <button type="button" className={btnSmall} onClick={() => void deactivate(s)}>
                    {t("common.inactive")}
                  </button>
                )}
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-slate-500">
              <span>
                {t("admin.services.price")}: {yen(s.priceJpy)}
              </span>
              <span>
                {t("admin.services.duration")}: {s.durationMinutes}
              </span>
              <span>
                {t("admin.services.buffer")}: {s.bufferMinutes}
              </span>
              <span>
                {t("admin.services.resourceType")}: {s.resourceType ? t(`resource.${s.resourceType}` as MessageKey) : t("admin.services.noResource")}
              </span>
            </div>

            <div className="mt-3 border-t border-slate-100 pt-3">
              <div className="mb-2 text-xs font-medium text-slate-500">{t("admin.services.addons")}</div>
              <div className="flex flex-wrap gap-2">
                {s.addons.map((ad) => (
                  <span
                    key={ad.id}
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${
                      ad.active ? "bg-slate-100 text-slate-600" : "bg-slate-50 text-slate-300 line-through"
                    }`}
                  >
                    {localizedName(locale, ad.nameZh, ad.nameJa)} +{yen(ad.priceJpy)} · {ad.durationMinutes}
                    {ad.active && (
                      <button type="button" className="text-slate-400 hover:text-red-500" onClick={() => void removeAddon(ad)}>
                        ×
                      </button>
                    )}
                  </span>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <input
                  className={`${inputCls} w-32`}
                  placeholder={t("admin.services.name")}
                  value={addonForms[s.id]?.nameZh ?? ""}
                  onChange={(e) =>
                    setAddonForms((p) => ({ ...p, [s.id]: { ...(p[s.id] ?? { nameZh: "", nameJa: "", priceJpy: "", durationMinutes: "" }), nameZh: e.target.value } }))
                  }
                />
                <input
                  className={`${inputCls} w-32`}
                  placeholder={t("admin.services.nameJa")}
                  value={addonForms[s.id]?.nameJa ?? ""}
                  onChange={(e) =>
                    setAddonForms((p) => ({ ...p, [s.id]: { ...(p[s.id] ?? { nameZh: "", nameJa: "", priceJpy: "", durationMinutes: "" }), nameJa: e.target.value } }))
                  }
                />
                <input
                  className={`${inputCls} w-24`}
                  type="number"
                  min={0}
                  placeholder={t("admin.services.price")}
                  value={addonForms[s.id]?.priceJpy ?? ""}
                  onChange={(e) =>
                    setAddonForms((p) => ({ ...p, [s.id]: { ...(p[s.id] ?? { nameZh: "", nameJa: "", priceJpy: "", durationMinutes: "" }), priceJpy: e.target.value } }))
                  }
                />
                <input
                  className={`${inputCls} w-24`}
                  type="number"
                  min={0}
                  placeholder={t("admin.services.duration")}
                  value={addonForms[s.id]?.durationMinutes ?? ""}
                  onChange={(e) =>
                    setAddonForms((p) => ({ ...p, [s.id]: { ...(p[s.id] ?? { nameZh: "", nameJa: "", priceJpy: "", durationMinutes: "" }), durationMinutes: e.target.value } }))
                  }
                />
                <button type="button" className={btnSmall} onClick={() => void addAddon(s.id)}>
                  {t("common.add")}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {(creating || editing) && (
        <Modal title={editing ? t("common.edit") : t("common.add")} onClose={() => { setCreating(false); setEditing(null); }}>
          <form className="flex flex-col gap-3" onSubmit={submitForm}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={t("admin.services.name")}>
                <input className={inputCls} value={form.nameZh} onChange={(e) => setForm({ ...form, nameZh: e.target.value })} required />
              </Field>
              <Field label={t("admin.services.nameJa")}>
                <input className={inputCls} value={form.nameJa} onChange={(e) => setForm({ ...form, nameJa: e.target.value })} required />
              </Field>
              <Field label={t("admin.services.category")}>
                <select className={inputCls} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as ServiceCategory })}>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {t(`category.${c}` as MessageKey)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("admin.services.resourceType")}>
                <select className={inputCls} value={form.resourceType} onChange={(e) => setForm({ ...form, resourceType: e.target.value })}>
                  <option value="">{t("admin.services.noResource")}</option>
                  {RESOURCE_TYPES.map((r) => (
                    <option key={r} value={r}>
                      {t(`resource.${r}` as MessageKey)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("admin.services.price")}>
                <input type="number" min={0} className={inputCls} value={form.priceJpy} onChange={(e) => setForm({ ...form, priceJpy: e.target.value })} required />
              </Field>
              <Field label={t("admin.services.duration")}>
                <input type="number" min={5} className={inputCls} value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })} required />
              </Field>
              <Field label={t("admin.services.buffer")}>
                <input type="number" min={0} className={inputCls} value={form.bufferMinutes} onChange={(e) => setForm({ ...form, bufferMinutes: e.target.value })} required />
              </Field>
              <Field label="color">
                <input type="color" className="h-10 w-full rounded-lg border border-slate-300 bg-white px-1" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
              </Field>
            </div>
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
