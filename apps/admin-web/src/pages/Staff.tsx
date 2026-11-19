import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { addDaysTokyo, fromIso, toIso, todayTokyo, tokyoDateOf, tokyoMs, tokyoTimeOf, weekdayOfTokyoDate } from "@salon/shared";
import { api, ApiError, type BlockedTime, type Service, type Shift, type StaffMember } from "../lib/api";
import { localizedName, useI18n } from "../lib/i18n";
import { btnGhost, btnPrimary, btnSmall, cardCls, Field, inputCls, Loading, Modal, useToast } from "../lib/ui";
import type { MessageKey } from "@salon/i18n";

interface StaffForm {
  name: string;
  nameJa: string;
  color: string;
  sortOrder: string;
  active: boolean;
  skillServiceIds: string[];
}

interface GenItem {
  staffId: string;
  weekday: number;
  startTime: string;
  endTime: string;
}

export default function StaffPage() {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const [staffs, setStaffs] = useState<StaffMember[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<StaffForm>({ name: "", nameJa: "", color: "#3b82f6", sortOrder: "0", active: true, skillServiceIds: [] });
  const [busy, setBusy] = useState(false);

  /* 排班 */
  const [shiftStaffId, setShiftStaffId] = useState<string>("");
  const [weekStart, setWeekStart] = useState<string>(() => addDaysTokyo(todayTokyo(), -(weekdayOfTokyoDate(todayTokyo()) - 1)));
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [shiftForm, setShiftForm] = useState({ date: todayTokyo(), startTime: "10:00", endTime: "19:00", breakStart: "", breakEnd: "" });

  /* 模板生成 */
  const [genItems, setGenItems] = useState<GenItem[]>([]);
  const [genForm, setGenForm] = useState<GenItem>({ staffId: "", weekday: 1, startTime: "10:00", endTime: "19:00" });

  /* 请假/封锁 */
  const [blocked, setBlocked] = useState<BlockedTime[]>([]);
  const [blockForm, setBlockForm] = useState({ staffId: "", startDate: todayTokyo(), startTime: "00:00", endDate: todayTokyo(), endTime: "23:59", reason: "" });

  const loadBase = useCallback(async () => {
    try {
      const [st, sv, bl] = await Promise.all([
        api.get<StaffMember[]>("/admin/staff"),
        api.get<Service[]>("/admin/services"),
        api.get<BlockedTime[]>("/admin/blocked-times"),
      ]);
      setStaffs(st);
      setServices(sv);
      setBlocked(bl);
      setShiftStaffId((prev) => prev || st.find((s) => s.active)?.id || st[0]?.id || "");
      setGenForm((prev) => (prev.staffId ? prev : { ...prev, staffId: st[0]?.id ?? "" }));
      setBlockForm((prev) => (prev.staffId ? prev : { ...prev, staffId: st[0]?.id ?? "" }));
    } catch {
      /* 保持 */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  const loadShifts = useCallback(async () => {
    try {
      const rows = await api.get<Shift[]>(
        `/admin/shifts?from=${weekStart}&to=${addDaysTokyo(weekStart, 7)}`,
      );
      setShifts(rows);
    } catch {
      setShifts([]);
    }
  }, [weekStart]);

  useEffect(() => {
    void loadShifts();
  }, [loadShifts]);

  const myShifts = useMemo(() => shifts.filter((s) => s.staffId === shiftStaffId), [shifts, shiftStaffId]);
  const staffName = useCallback((id: string | null) => staffs.find((s) => s.id === id)?.name ?? "", [staffs]);

  /* ---------- 员工 CRUD ---------- */
  function openCreate() {
    setCreating(true);
    setEditing(null);
    setForm({ name: "", nameJa: "", color: "#3b82f6", sortOrder: String(staffs.length), active: true, skillServiceIds: [] });
  }

  function openEdit(s: StaffMember) {
    setEditing(s);
    setCreating(false);
    setForm({
      name: s.name,
      nameJa: s.nameJa ?? "",
      color: s.color,
      sortOrder: String(s.sortOrder),
      active: s.active,
      skillServiceIds: [...s.skillServiceIds],
    });
  }

  async function submitStaff(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const body = {
      name: form.name.trim(),
      nameJa: form.nameJa.trim() || null,
      color: form.color,
      sortOrder: Number(form.sortOrder),
      active: form.active,
      skillServiceIds: form.skillServiceIds,
    };
    try {
      if (editing) await api.put(`/admin/staff/${editing.id}`, body);
      else await api.post("/admin/staff", body);
      toast(t("common.saved"));
      setEditing(null);
      setCreating(false);
      await loadBase();
    } catch (e) {
      toast(e instanceof ApiError && e.status === 409 ? t("admin.staff.futureConflict") : t("common.failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function deactivateStaff(s: StaffMember) {
    try {
      await api.del(`/admin/staff/${s.id}`);
      toast(t("common.saved"));
      await loadBase();
    } catch (e) {
      toast(e instanceof ApiError && e.status === 409 ? t("admin.staff.futureConflict") : t("common.failed"), "error");
    }
  }

  const scheduleError = (error: unknown, kind: "shift" | "block"): string => {
    if (error instanceof ApiError && error.status === 409) {
      return t(kind === "shift" ? "admin.staff.shiftConflict" : "admin.staff.blockConflict");
    }
    if (error instanceof ApiError && error.status === 400) {
      return t(kind === "shift" ? "admin.staff.shiftInvalid" : "admin.staff.blockInvalid");
    }
    return t("common.failed");
  };

  /* ---------- 排班 ---------- */
  async function addShift(e: FormEvent) {
    e.preventDefault();
    if (!shiftStaffId) return;
    if (Boolean(shiftForm.breakStart) !== Boolean(shiftForm.breakEnd)) {
      toast(t("admin.staff.shiftInvalid"), "error");
      return;
    }
    try {
      await api.post("/admin/shifts", {
        staffId: shiftStaffId,
        date: shiftForm.date,
        startTime: shiftForm.startTime,
        endTime: shiftForm.endTime,
        breaks:
          shiftForm.breakStart && shiftForm.breakEnd
            ? [{ startTime: shiftForm.breakStart, endTime: shiftForm.breakEnd }]
            : [],
      });
      toast(t("common.saved"));
      await loadShifts();
    } catch (error) {
      toast(scheduleError(error, "shift"), "error");
    }
  }

  async function deleteShift(id: string) {
    try {
      await api.del(`/admin/shifts/${id}`);
      await loadShifts();
    } catch (error) {
      toast(scheduleError(error, "shift"), "error");
    }
  }

  async function generateShifts() {
    if (genItems.length === 0) return;
    try {
      const res = await api.post<{ created: number; skipped: number }>("/admin/shifts/generate", {
        fromDate: todayTokyo(),
        weeks: 4,
        items: genItems,
      });
      toast(`${t("common.saved")} +${res.created} / skip ${res.skipped}`);
      await loadShifts();
    } catch (error) {
      toast(scheduleError(error, "shift"), "error");
    }
  }

  /* ---------- 请假 ---------- */
  async function addBlocked(e: FormEvent) {
    e.preventDefault();
    if (!blockForm.staffId) return;
    try {
      await api.post("/admin/blocked-times", {
        staffId: blockForm.staffId,
        type: "leave",
        startAt: toIso(tokyoMs(blockForm.startDate, blockForm.startTime)),
        endAt: toIso(tokyoMs(blockForm.endDate, blockForm.endTime)),
        reason: blockForm.reason.trim() || undefined,
      });
      toast(t("common.saved"));
      await loadBase();
    } catch (error) {
      toast(scheduleError(error, "block"), "error");
    }
  }

  async function deleteBlocked(id: string) {
    try {
      await api.del(`/admin/blocked-times/${id}`);
      await loadBase();
    } catch {
      toast(t("common.failed"), "error");
    }
  }

  if (loading) return <Loading />;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-4">
      {/* 员工列表 */}
      <section>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold text-slate-800">{t("admin.nav.staff")}</h1>
          <button type="button" className={`${btnPrimary} ml-auto`} onClick={openCreate}>
            {t("common.add")}
          </button>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {staffs.map((s) => (
            <div key={s.id} className={`p-4 ${cardCls} ${s.active ? "" : "opacity-60"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                <span className="min-w-0 truncate font-semibold text-slate-800">{s.name}</span>
                {s.nameJa && <span className="text-xs text-slate-400">{s.nameJa}</span>}
                <span className={`rounded-full px-2 py-0.5 text-xs ${s.active ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400"}`}>
                  {s.active ? t("common.active") : t("common.inactive")}
                </span>
                <span className="ml-auto flex shrink-0 gap-1">
                  <button type="button" className={btnSmall} onClick={() => openEdit(s)}>
                    {t("common.edit")}
                  </button>
                  {s.active && (
                    <button type="button" className={btnSmall} onClick={() => void deactivateStaff(s)}>
                      {t("common.inactive")}
                    </button>
                  )}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {s.skillServiceIds.length === 0 && <span className="text-xs text-slate-300">{t("common.none")}</span>}
                {s.skillServiceIds.map((sid) => {
                  const svc = services.find((x) => x.id === sid);
                  return svc ? (
                    <span key={sid} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                      {localizedName(locale, svc.nameZh, svc.nameJa)}
                    </span>
                  ) : null;
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 排班 */}
      <section className={`p-4 ${cardCls}`}>
        <h2 className="mb-3 text-base font-semibold text-slate-800">{t("admin.staff.shifts")}</h2>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <select className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={shiftStaffId} onChange={(e) => setShiftStaffId(e.target.value)}>
            {staffs.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button type="button" className={btnSmall} onClick={() => setWeekStart(addDaysTokyo(weekStart, -7))}>
            {t("admin.calendar.prev")}
          </button>
          <input
            type="date"
            className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
            value={weekStart}
            onChange={(e) => {
              if (e.target.value) setWeekStart(e.target.value);
            }}
          />
          <button type="button" className={btnSmall} onClick={() => setWeekStart(addDaysTokyo(weekStart, 7))}>
            {t("admin.calendar.next")}
          </button>
        </div>
        <div className="mb-4 flex flex-col gap-1.5">
          {myShifts.length === 0 && <div className="text-sm text-slate-300">{t("common.none")}</div>}
          {myShifts.map((sh) => (
            <div key={sh.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
              <span className="font-medium text-slate-700">
                {sh.date}（{t(`weekday.${weekdayOfTokyoDate(sh.date)}` as MessageKey)}）
              </span>
              <span>
                {sh.startTime}–{sh.endTime}
              </span>
              {sh.breaks.map((b, i) => (
                <span key={i} className="text-xs text-slate-400">
                  {t("admin.staff.break")} {b.startTime}–{b.endTime}
                </span>
              ))}
              <button type="button" className="ml-auto text-xs text-red-500" onClick={() => void deleteShift(sh.id)}>
                {t("common.delete")}
              </button>
            </div>
          ))}
        </div>
        <form className="flex flex-wrap items-end gap-2" onSubmit={addShift}>
          <div className="w-40">
            <Field label={t("common.date")}>
              <input type="date" className={inputCls} value={shiftForm.date} onChange={(e) => setShiftForm({ ...shiftForm, date: e.target.value })} required />
            </Field>
          </div>
          <div className="w-28">
            <Field label={t("admin.staff.start")}>
              <input type="time" className={inputCls} value={shiftForm.startTime} onChange={(e) => setShiftForm({ ...shiftForm, startTime: e.target.value })} required />
            </Field>
          </div>
          <div className="w-28">
            <Field label={t("admin.staff.end")}>
              <input type="time" className={inputCls} value={shiftForm.endTime} onChange={(e) => setShiftForm({ ...shiftForm, endTime: e.target.value })} required />
            </Field>
          </div>
          <div className="w-28">
            <Field label={`${t("admin.staff.break")} ${t("admin.staff.start")}`}>
              <input type="time" className={inputCls} value={shiftForm.breakStart} onChange={(e) => setShiftForm({ ...shiftForm, breakStart: e.target.value })} />
            </Field>
          </div>
          <div className="w-28">
            <Field label={`${t("admin.staff.break")} ${t("admin.staff.end")}`}>
              <input type="time" className={inputCls} value={shiftForm.breakEnd} onChange={(e) => setShiftForm({ ...shiftForm, breakEnd: e.target.value })} />
            </Field>
          </div>
          <button type="submit" className={btnGhost}>
            {t("admin.staff.addShift")}
          </button>
        </form>

        <div className="mt-5 border-t border-slate-100 pt-4">
          <div className="mb-2 text-sm font-medium text-slate-700">{t("admin.staff.generateShifts")}</div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-36">
              <Field label={t("admin.staff.name")}>
                <select className={inputCls} value={genForm.staffId} onChange={(e) => setGenForm({ ...genForm, staffId: e.target.value })}>
                  {staffs.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="w-28">
              <Field label={t("admin.staff.weekday")}>
                <select className={inputCls} value={genForm.weekday} onChange={(e) => setGenForm({ ...genForm, weekday: Number(e.target.value) })}>
                  {[1, 2, 3, 4, 5, 6, 7].map((wd) => (
                    <option key={wd} value={wd}>
                      {t(`weekday.${wd}` as MessageKey)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="w-28">
              <Field label={t("admin.staff.start")}>
                <input type="time" className={inputCls} value={genForm.startTime} onChange={(e) => setGenForm({ ...genForm, startTime: e.target.value })} />
              </Field>
            </div>
            <div className="w-28">
              <Field label={t("admin.staff.end")}>
                <input type="time" className={inputCls} value={genForm.endTime} onChange={(e) => setGenForm({ ...genForm, endTime: e.target.value })} />
              </Field>
            </div>
            <button
              type="button"
              className={btnGhost}
              onClick={() => {
                if (genForm.staffId) setGenItems((prev) => [...prev, { ...genForm }]);
              }}
            >
              {t("common.add")}
            </button>
          </div>
          {genItems.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {genItems.map((g, i) => (
                <span key={i} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
                  {staffName(g.staffId)} · {t(`weekday.${g.weekday}` as MessageKey)} {g.startTime}–{g.endTime}
                  <button type="button" className="text-slate-400 hover:text-red-500" onClick={() => setGenItems((prev) => prev.filter((_, x) => x !== i))}>
                    ×
                  </button>
                </span>
              ))}
              <button type="button" className={btnPrimary} onClick={() => void generateShifts()}>
                {t("common.confirm")}
              </button>
            </div>
          )}
        </div>
      </section>

      {/* 请假 / 封锁 */}
      <section className={`p-4 ${cardCls}`}>
        <h2 className="mb-3 text-base font-semibold text-slate-800">{t("admin.staff.leave")}</h2>
        <p className="mb-3 text-xs leading-relaxed text-amber-700">{t("admin.staff.guardHint")}</p>
        <div className="mb-4 flex flex-col gap-1.5">
          {blocked.length === 0 && <div className="text-sm text-slate-300">{t("common.none")}</div>}
          {blocked.map((b) => (
            <div key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
              <span className="font-medium text-slate-700">{staffName(b.staffId)}</span>
              <span>
                {tokyoDateOf(fromIso(b.startAt))} {tokyoTimeOf(fromIso(b.startAt))} – {tokyoDateOf(fromIso(b.endAt))} {tokyoTimeOf(fromIso(b.endAt))}
              </span>
              {b.reason && <span className="min-w-0 truncate text-xs text-slate-400">{b.reason}</span>}
              <button type="button" className="ml-auto text-xs text-red-500" onClick={() => void deleteBlocked(b.id)}>
                {t("common.delete")}
              </button>
            </div>
          ))}
        </div>
        <form className="flex flex-wrap items-end gap-2" onSubmit={addBlocked}>
          <div className="w-36">
            <Field label={t("admin.staff.name")}>
              <select className={inputCls} value={blockForm.staffId} onChange={(e) => setBlockForm({ ...blockForm, staffId: e.target.value })}>
                {staffs.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="w-40">
            <Field label={`${t("common.date")} ${t("admin.staff.start")}`}>
              <input type="date" className={inputCls} value={blockForm.startDate} onChange={(e) => setBlockForm({ ...blockForm, startDate: e.target.value })} required />
            </Field>
          </div>
          <div className="w-28">
            <Field label={t("admin.staff.start")}>
              <input type="time" className={inputCls} value={blockForm.startTime} onChange={(e) => setBlockForm({ ...blockForm, startTime: e.target.value })} required />
            </Field>
          </div>
          <div className="w-40">
            <Field label={`${t("common.date")} ${t("admin.staff.end")}`}>
              <input type="date" className={inputCls} value={blockForm.endDate} onChange={(e) => setBlockForm({ ...blockForm, endDate: e.target.value })} required />
            </Field>
          </div>
          <div className="w-28">
            <Field label={t("admin.staff.end")}>
              <input type="time" className={inputCls} value={blockForm.endTime} onChange={(e) => setBlockForm({ ...blockForm, endTime: e.target.value })} required />
            </Field>
          </div>
          <div className="min-w-32 flex-1">
            <Field label={t("common.note")}>
              <input className={inputCls} value={blockForm.reason} onChange={(e) => setBlockForm({ ...blockForm, reason: e.target.value })} />
            </Field>
          </div>
          <button type="submit" className={btnGhost}>
            {t("common.add")}
          </button>
        </form>
      </section>

      {/* 员工编辑弹窗 */}
      {(creating || editing) && (
        <Modal title={editing ? t("common.edit") : t("common.add")} onClose={() => { setCreating(false); setEditing(null); }} wide>
          <form className="flex flex-col gap-3" onSubmit={submitStaff}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={t("admin.staff.name")}>
                <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </Field>
              <Field label={t("admin.services.nameJa")}>
                <input className={inputCls} value={form.nameJa} onChange={(e) => setForm({ ...form, nameJa: e.target.value })} />
              </Field>
              <Field label="color">
                <input type="color" className="h-10 w-full rounded-lg border border-slate-300 bg-white px-1" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
              </Field>
              <Field label={t("common.active")}>
                <select className={inputCls} value={form.active ? "1" : "0"} onChange={(e) => setForm({ ...form, active: e.target.value === "1" })}>
                  <option value="1">{t("common.active")}</option>
                  <option value="0">{t("common.inactive")}</option>
                </select>
              </Field>
            </div>
            <div>
              <div className="mb-1.5 text-xs font-medium text-slate-500">{t("admin.staff.skills")}</div>
              <div className="flex flex-wrap gap-2">
                {services.map((svc) => {
                  const on = form.skillServiceIds.includes(svc.id);
                  return (
                    <button
                      key={svc.id}
                      type="button"
                      className={`rounded-full px-3 py-1.5 text-xs ${on ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          skillServiceIds: on ? f.skillServiceIds.filter((x) => x !== svc.id) : [...f.skillServiceIds, svc.id],
                        }))
                      }
                    >
                      {localizedName(locale, svc.nameZh, svc.nameJa)}
                    </button>
                  );
                })}
              </div>
            </div>
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
