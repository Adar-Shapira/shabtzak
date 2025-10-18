// shabtzak-ui/src/pages/Planner.tsx
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { listSoldiers, reassignAssignment, type Soldier } from "../api";
import Modal from "../components/Modal";
import { getPlannerWarnings, type PlannerWarning } from "../api"


type PlanResultItem = {
  mission: { id: number; name: string };
  created_count?: number | null;
  error?: string | null;
};

type PlanFillResponse = {
  day: string;
  results: PlanResultItem[];
};

type FlatRosterItem = {
  id: number;
  mission: { id: number | null; name: string | null } | null;
  role: string | null;
  soldier_id: number;
  soldier_name: string;
  start_at: string; // ISO
  end_at: string;   // ISO
  start_local: string;   // e.g. "2025-10-19T09:00:00+03:00"
  end_local: string;     // local Asia/Jerusalem string
  start_epoch_ms: number;
  end_epoch_ms: number;
};

type FlatRosterResp = {
  day: string;
  items: FlatRosterItem[];
};

function humanError(e: any, fallback: string) {
  const d = e?.response?.data;
  if (typeof d === "string") return d;
  if (d?.detail) {
    if (typeof d.detail === "string") return d.detail;
    try {
      return JSON.stringify(d.detail);
    } catch {
      return fallback;
    }
  }
  if (e?.message) return e.message;
  return fallback;
}

const APP_TZ =
  (import.meta as any)?.env?.VITE_APP_TZ ||
  Intl.DateTimeFormat().resolvedOptions().timeZone;

// Format to "YYYY-MM-DD HH:mm" in a specific TZ using Intl parts
function formatYMDHM(dtIso: string, fallbackTz: string) {
  try {
    const d = new Date(dtIso);
    const parts = new Intl.DateTimeFormat(undefined, {
      timeZone: fallbackTz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(d);

    const get = (t: Intl.DateTimeFormatPartTypes) =>
      parts.find(p => p.type === t)?.value ?? "";

    // Many locales emit different separators; assemble explicitly:
    const yyyy = get("year");
    const mm = get("month");
    const dd = get("day");
    const hh = get("hour");
    const min = get("minute");
    return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
  } catch {
    return dtIso;
  }
}

// Prefer server-provided local strings if you added them; otherwise compute
function fmtLocalShort(localIso: string | undefined, utcIso: string) {
  if (localIso) return formatYMDHM(localIso, APP_TZ);
  return formatYMDHM(utcIso, APP_TZ);
}

// Robust epoch getter (uses server epoch if present)
function epochMs(iso: string, serverEpoch?: number) {
  return typeof serverEpoch === "number" ? serverEpoch : new Date(iso).getTime();
}

// Stable slot key for grouping (mission + exact window)
function slotKey(missionName: string, startMs: number, endMs: number) {
  return `${missionName}__${startMs}__${endMs}`;
}

export default function Planner() {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [day, setDay] = useState<string>(today);

  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<PlanResultItem[] | null>(null);

  const [listBusy, setListBusy] = useState(false);
  const [rows, setRows] = useState<FlatRosterItem[]>([]);

  const [isChangeOpen, setIsChangeOpen] = useState(false);
  const [allSoldiers, setAllSoldiers] = useState<Soldier[]>([]);
  const [pendingAssignmentId, setPendingAssignmentId] = useState<number | null>(null);
  const [changeLoading, setChangeLoading] = useState(false);
  const [changeError, setChangeError] = useState<string | null>(null);
  const [pendingRoleName, setPendingRoleName] = useState<string | null>(null);

  const [pendingMissionId, setPendingMissionId] = useState<number | null>(null);

  const [warnings, setWarnings] = useState<PlannerWarning[]>([])
  const [warnLoading, setWarnLoading] = useState(false)
  const [warnError, setWarnError] = useState<string | null>(null)

  async function loadWarnings(forDay: string) {
    try {
      setWarnLoading(true);
      setWarnError(null);
      const items = await getPlannerWarnings(forDay); // <-- pass day
      setWarnings(items);
    } catch (e: any) {
      setWarnError(e?.message || "Failed to load warnings");
    } finally {
      setWarnLoading(false);
    }
  }


  useEffect(() => {
    // load warnings whenever the selected day changes
    loadWarnings(day);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day]);



  async function runPlanner() {
    setBusy(true);
    setResults(null);
    try {
      const { data } = await api.post<PlanFillResponse>("/plan/fill", { day, replace: true });
      setResults(data.results);
      await loadAllAssignments();
      await loadWarnings(day);
    } catch (e: any) {
      alert(humanError(e, "Planner failed"));
    } finally {
      setBusy(false);
    }
  }

  async function loadAllAssignments() {
    setListBusy(true);
    try {
      const { data } = await api.get<FlatRosterResp>("/assignments/roster", {
        params: { day },
      });
      setRows(data.items);
    } catch (e: any) {
      alert(humanError(e, "Failed to load assignments"));
      setRows([]);
    } finally {
      setListBusy(false);
    }
  }

  async function openChangeModal(assignmentId: number, roleName: string | null, missionId: number | null) {
    setPendingAssignmentId(assignmentId);
    setPendingRoleName(roleName);
    setPendingMissionId(missionId);
    setChangeError(null);
    setIsChangeOpen(true);

    try {
      const soldiers = await listSoldiers();
      const byRole = roleName ? soldiers.filter(s => (s.roles || []).some(r => r.name === roleName)) : soldiers;

      // If you want to pre-filter by restrictions on the client side, you can
      // fetch each soldier’s restrictions, but that is chatty. Prefer server-side enforcement.
      setAllSoldiers(byRole);
    } catch {
      setChangeError("Failed to load soldiers");
    }
  }


  async function handleReassign(soldierId: number) {
    if (!pendingAssignmentId) return;
    setChangeLoading(true);
    setChangeError(null);
    try {
      const updated = await reassignAssignment({
        assignment_id: pendingAssignmentId,
        soldier_id: soldierId,
      });

      // Update the local table state.
      // Replace the roster item whose id matches updated.id
      // The exact state variable may differ in your file.
      // If your items live in something like `roster` or `planItems`, update that array.
      setRows((prev: FlatRosterItem[]) =>
        prev.map((it: FlatRosterItem) =>
          it.id === updated.id
            ? { ...it, soldier_id: updated.soldier_id, soldier_name: updated.soldier_name }
            : it
        )
      );

      setIsChangeOpen(false);
      setPendingAssignmentId(null);
    } catch (e: any) {
      setChangeError(e?.response?.data?.detail ?? "Failed to reassign");
    } finally {
      setChangeLoading(false);
    }
  }


  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const mA = a.mission?.name ?? "";
      const mB = b.mission?.name ?? "";
      if (mA !== mB) return mA.localeCompare(mB);

      const tA = a.start_epoch_ms ?? new Date(a.start_at).getTime();
      const tB = b.start_epoch_ms ?? new Date(b.start_at).getTime();
      if (tA !== tB) return tA - tB;

      const rA = a.role ?? "\uFFFF";
      const rB = b.role ?? "\uFFFF";
      return rA.localeCompare(rB);
    });
  }, [rows]);

  type Grouped = Array<{
    missionName: string;
    slots: Array<{
      key: string;
      startLabel: string;
      endLabel: string;
      items: FlatRosterItem[];
    }>;
  }>;

  const grouped: Grouped = useMemo(() => {
    // Build: mission -> (slotKey -> items)
    const byMission = new Map<string, Map<string, { startLabel: string; endLabel: string; items: FlatRosterItem[] }>>();

    for (const r of sortedRows) {
      const missionName = r.mission?.name ?? "";
      const sMs = epochMs(r.start_at, (r as any).start_epoch_ms);
      const eMs = epochMs(r.end_at, (r as any).end_epoch_ms);

      const key = slotKey(missionName, sMs, eMs);

      const startLabel = fmtLocalShort(r.start_local, r.start_at); // YYYY-MM-DD HH:mm
      const endLabel   = fmtLocalShort(r.end_local,   r.end_at);

      if (!byMission.has(missionName)) byMission.set(missionName, new Map());
      const slots = byMission.get(missionName)!;

      if (!slots.has(key)) {
        slots.set(key, { startLabel, endLabel, items: [] });
      }
      slots.get(key)!.items.push(r);
    }

    // Convert to array form (preserve sorted order implicitly by iterating sortedRows)
    const result: Grouped = [];
    const missionOrder: string[] = [];
    const seenMission = new Set<string>();

    for (const r of sortedRows) {
      const m = r.mission?.name ?? "";
      if (!seenMission.has(m)) {
        missionOrder.push(m);
        seenMission.add(m);
      }
    }

    for (const m of missionOrder) {
      const slots = byMission.get(m)!;
      // Keep slot insertion order (already sortedRows order)
      const slotArr: Grouped[number]["slots"] = [];
      const seenSlots = new Set<string>();
      for (const r of sortedRows) {
        const mm = r.mission?.name ?? "";
        if (mm !== m) continue;
        const sMs = epochMs(r.start_at, (r as any).start_epoch_ms);
        const eMs = epochMs(r.end_at, (r as any).end_epoch_ms);
        const k = slotKey(m, sMs, eMs);
        if (!seenSlots.has(k)) {
          const v = slots.get(k)!;
          slotArr.push({ key: k, startLabel: v.startLabel, endLabel: v.endLabel, items: v.items });
          seenSlots.add(k);
        }
      }
      result.push({ missionName: m, slots: slotArr });
    }

    return result;
  }, [sortedRows]);

  useEffect(() => {
    loadAllAssignments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day]);

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-semibold">Planner</h1>

      <div className="flex items-center gap-3">
        <label className="text-sm">Day</label>
        <input
          type="date"
          value={day}
          onChange={(e) => setDay(e.target.value)}
          className="border rounded px-2 py-1"
        />
        <button
          onClick={runPlanner}
          disabled={busy}
          className="border rounded px-3 py-1 hover:bg-gray-50 disabled:opacity-50"
        >
          {busy ? "Planning…" : "Fill plan for day"}
        </button>
      </div>

      {results && (
        <div className="space-y-2">
          <h2 className="font-medium">Planner results</h2>
          <div className="border rounded divide-y">
            {results.map((r) => (
              <div key={r.mission.id} className="p-2 flex items-center justify-between gap-2">
                <div className="truncate">
                  <div className="font-medium">{r.mission.name}</div>
                  {r.error ? (
                    <div className="text-sm text-red-600">Error: {r.error}</div>
                  ) : (
                    <div className="text-sm text-gray-600">
                      Created assignments: {r.created_count ?? 0}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <section style={{ marginTop: 16, marginBottom: 16 }}>
        <h2 style={{ marginBottom: 8 }}>Warnings</h2>
        {warnLoading && <div>Loading…</div>}
        {!warnLoading && warnError && <div style={{ color: "crimson" }}>{warnError}</div>}
        {!warnLoading && !warnError && warnings.length === 0 && (
          <div style={{ opacity: 0.7 }}>(No warnings)</div>
        )}
        {!warnLoading && !warnError && warnings.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th className="border p-2 text-left">Type</th>
                  <th className="border p-2 text-left">Soldier</th>
                  <th className="border p-2 text-left">Mission</th>
                  <th className="border p-2 text-left">Start</th>
                  <th className="border p-2 text-left">End</th>
                  <th className="border p-2 text-left">Details</th>
                </tr>
              </thead>
              <tbody>
                {warnings.map((w, i) => (
                  <tr key={i}>
                    <td className="border p-2">{w.type}</td>
                    <td className="border p-2">{w.soldier_name} (#{w.soldier_id})</td>
                    <td className="border p-2">{w.mission_name} (#{w.mission_id})</td>
                    <td className="border p-2">{w.start_at}</td>
                    <td className="border p-2">{w.end_at}</td>
                    <td className="border p-2">{w.details || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="space-y-2">
        <h2 className="font-medium">Assignments</h2>

        {listBusy && <div className="border rounded p-3 text-gray-500">Loading…</div>}
        {!listBusy && rows.length === 0 && (
          <div className="border rounded p-3 text-gray-500">No assignments for the selected day.</div>
        )}

        {!listBusy && rows.length > 0 && (
          <div className="border rounded overflow-x-auto">
            <Modal open={isChangeOpen} onClose={() => setIsChangeOpen(false)} title="Change Soldier">
              {changeError && <div style={{ color: "red", marginBottom: 8 }}>{changeError}</div>}
              {changeLoading && <div>Applying change…</div>}
              {!changeLoading && (
                <div style={{ maxHeight: 360, overflowY: "auto" }}>
                  {allSoldiers.length === 0 && <div>No soldiers found</div>}
                  {allSoldiers.map((s) => (
                    <div key={s.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #eee" }}>
                      <span>
                        {s.name}
                        {s.roles && s.roles.length > 0 ? ` (${s.roles.map(r => r.name).join(", ")})` : ""}
                      </span>
                      <button type="button" onClick={() => handleReassign(s.id)}>
                        Assign
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Modal>

            <table className="min-w-[760px] w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left p-2 border w-[320px]">Mission &amp; Time Slot</th>
                  <th className="text-left p-2 border">Role</th>
                  <th className="text-left p-2 border">Soldier</th>
                </tr>
              </thead>
              <tbody>
                {grouped.map((g) =>
                  g.slots.map((slot) => {
                    const rowsForSlot = slot.items;
                    const headerCell = (
                      <td className="align-top p-2 border bg-gray-50" rowSpan={rowsForSlot.length || 1}>
                        <div className="font-semibold">{g.missionName || "—"}</div>
                        <div className="text-xs text-gray-600 mt-1">
                          {slot.startLabel} → {slot.endLabel}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          {rowsForSlot.length} assignment{rowsForSlot.length !== 1 ? "s" : ""}
                        </div>
                      </td>
                    );

                    if (rowsForSlot.length === 0) {
                      // Shouldn’t happen, but keep safe:
                      return (
                        <tr key={slot.key}>
                          {headerCell}
                          <td className="p-2 border italic text-gray-500" colSpan={2}>No assignees</td>
                        </tr>
                      );
                    }

                    return rowsForSlot.map((r, idx) => (
                      <tr key={`${slot.key}__${r.id}`} className="border-t">
                        {idx === 0 && headerCell}
                        <td className="p-2 border">{r.role ?? ""}</td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                            <span>{r.soldier_name || "Unassigned"}</span>
                            <button
                              type="button"
                              onClick={() => openChangeModal(r.id, r.role, r.mission?.id || null)}
                              style={{ padding: "2px 8px" }}
                            >
                              Change
                            </button>
                          </div>
                        </td>

                      </tr>
                    ));
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
