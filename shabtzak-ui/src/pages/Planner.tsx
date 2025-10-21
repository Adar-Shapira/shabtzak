// shabtzak-ui/src/pages/Planner.tsx
import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import {
  listSoldiers,
  reassignAssignment,
  unassignAssignment, 
  type Soldier,
  clearPlan,
  listMissions,
  listMissionSlots,
  type Mission,
  type MissionSlot,
  getMissionRequirements,
  type MissionRequirement,
} from "../api";

import Modal from "../components/Modal";
import SoldierHistoryModal from "../components/SoldierHistoryModal";
import { getPlannerWarnings, type PlannerWarning } from "../api"
import { listSoldierVacations, type Vacation } from "../api";


type FlatRosterItem = {
  id: number;
  mission: { id: number | null; name: string | null } | null;
  role: string | null;
  soldier_id: number | null;
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

const APP_TZ = (import.meta as any)?.env?.VITE_APP_TZ || "UTC";

async function fillPlanForDay(
  forDay: string,
  replace = false,
  opts?: { shuffle?: boolean; random_seed?: number }
) {
  await api.post("/plan/fill", { day: forDay, replace, ...(opts || {}) });
}

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

// Robust epoch getter (uses server epoch if present)
function epochMs(iso: string, serverEpoch?: number) {
  return typeof serverEpoch === "number" ? serverEpoch : new Date(iso).getTime();
}

// Stable slot key for grouping (mission + exact window)
function slotKey(missionName: string, startMs: number, endMs: number) {
  return `${missionName}__${startMs}__${endMs}`;
}

// --- MissionRequirement helpers (schema-agnostic) ---
function reqRoleName(r: MissionRequirement): string | null {
  const x = r as any;
  if (x?.role?.name) return String(x.role.name);
  if (typeof x?.role_name === "string") return x.role_name;
  if (typeof x?.role_id === "number") return `Role #${x.role_id}`;
  return null;
}
function reqRoleId(r: MissionRequirement): number | null {
  const x = r as any;
  if (typeof x?.role_id === "number") return x.role_id;
  if (x?.role?.id != null) {
    const v = Number(x.role.id);
    return Number.isFinite(v) ? v : null;
  }
  return null;
}
function reqCount(r: MissionRequirement): number {
  const x = (r as any)?.count;
  return typeof x === "number" ? x : 0;
}

function rolePredicate(roleId?: number | null, roleName?: string | null) {
  return (s: Soldier) =>
    (s.roles || []).some((rr: any) => {
      if (roleId != null) {
        // match id first (object role or role_id field)
        return (typeof rr === "object" && rr?.id === roleId) ||
               (typeof rr === "object" && rr?.role_id === roleId);
      }
      if (roleName) {
        // fallback to name match (object or string)
        return (typeof rr === "string" && rr === roleName) ||
               (typeof rr === "object" && rr?.name === roleName);
      }
      return true;
    });
}

function guessRoleFromMissionName(missionName?: string | null): string | null {
  const n = (missionName || "").toLowerCase();
  if (n.includes("officer"))   return "Officer";
  if (n.includes("commander")) return "Commander";
  if (n.includes("driver"))    return "Driver";
  if (n.includes("guard"))     return "Guard";
  // add more heuristics if you have other canonical roles
  return null;
}

export default function Planner() {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [day, setDay] = useState<string>(today);

  const [busy, setBusy] = useState(false);

  const [listBusy, setListBusy] = useState(false);
  const [rows, setRows] = useState<FlatRosterItem[]>([]);

  const [isChangeOpen, setIsChangeOpen] = useState(false);
  const [visibleCandidates, setVisibleCandidates] = useState<Soldier[]>([]);
  const [pendingAssignmentId, setPendingAssignmentId] = useState<number | null>(null);
  const [candidateSearch, setCandidateSearch] = useState<string>("");
  const [changeLoading, setChangeLoading] = useState(false);
  const [changeError, setChangeError] = useState<string | null>(null);

  const [vacationsCache] = useState<Map<number, Vacation[]>>(new Map());

  const [warnings, setWarnings] = useState<PlannerWarning[]>([])
  const [warnLoading, setWarnLoading] = useState(false)
  const [warnError, setWarnError] = useState<string | null>(null)

  const [rowsForWarnings, setRowsForWarnings] = useState<FlatRosterItem[]>([]);

  // Available Soldiers modal state
  const [isAvailOpen, setIsAvailOpen] = useState(false);
  const [availLoading, setAvailLoading] = useState(false);
  const [availError, setAvailError] = useState<string | null>(null);
  const [availSoldiers, setAvailSoldiers] = useState<Soldier[]>([]);
  const [vacationSoldiers, setVacationSoldiers] = useState<
    { soldier: Soldier; leavingToday: boolean; returningToday: boolean }[]
  >([]);

  // Mission History modal state
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [historySoldierId, setHistorySoldierId] = useState<number | null>(null);
  const [historySoldierName, setHistorySoldierName] = useState<string>("");

  function openSoldierHistory(soldierId: number, soldierName: string) {
    setHistorySoldierId(soldierId);
    setHistorySoldierName(soldierName);
    setIsHistoryOpen(true);
  }

  const [pendingEmptySlot, setPendingEmptySlot] = useState<null | {
    missionId: number;
    roleId: number | null;      // if you want role-aware empty slots later
    startHHMM: string;          // "HH:MM"
    endHHMM: string;
    startLocalIso: string;
    endLocalIso: string;
  }>(null);

  const [requirementsByMission, setRequirementsByMission] = useState<
    Map<number, { total_needed?: number | null; requirements: MissionRequirement[] }>
  >(new Map());

  // missions and their slot patterns
  const [allMissions, setAllMissions] = useState<Mission[]>([]);
  const [slotsByMission, setSlotsByMission] = useState<Map<number, MissionSlot[]>>(new Map());

  const filteredCandidates = useMemo(() => {
    const q = candidateSearch.trim().toLowerCase();
    if (!q) return visibleCandidates;
    return visibleCandidates.filter(s => {
      const name = (s.name || "").toLowerCase();
      const roles = (s.roles || []).map(r => r.name.toLowerCase()).join(" ");
      return name.includes(q) || roles.includes(q);
    });
  }, [visibleCandidates, candidateSearch]);

  async function loadDayRosterForWarnings(forDay: string) {
    // Build YYYY-MM-DD for (day-1), day, (day+1) without relying on shiftDay’s position
    function addDays(iso: string, delta: number): string {
      const [y, m, d] = iso.split("-").map(Number);
      const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
      dt.setUTCDate(dt.getUTCDate() + delta);
      const yy = dt.getUTCFullYear();
      const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(dt.getUTCDate()).padStart(2, "0");
      return `${yy}-${mm}-${dd}`;
    }

    const days = [addDays(forDay, -1), forDay, addDays(forDay, 1)];

    try {
      const all: FlatRosterItem[] = [];
      for (const d of days) {
        const { data } = await api.get<FlatRosterResp>("/assignments/day-roster", {
          params: { day: d },
        });
        if (Array.isArray(data?.items)) {
          all.push(...data.items);
        }
      }
      setRowsForWarnings(all);
    } catch {
      setRowsForWarnings([]);
    }
  }

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
  try {
    // 1) Ask the backend to fill the plan for the selected day
    await fillPlanForDay(day, /* replace */ false);

    // 2) Refresh the UI
    await loadAllAssignments();
    await loadWarnings(day);
    await loadDayRosterForWarnings(day); // keep rowsForWarnings fresh
  } catch (e: any) {
    alert(humanError(e, "Planner failed"));
  } finally {
    setBusy(false);
  }
}

async function shufflePlanner() {
  setBusy(true);
  try {
    // Replace the current plan and ask backend to shuffle pools and RR cursors
    await fillPlanForDay(day, /* replace */ true, {
      shuffle: true,
      random_seed: Date.now(),
    });

    // Refresh UI & warning datasets
    await loadAllAssignments();
    await loadWarnings(day);
    await loadDayRosterForWarnings(day);
  } catch (e: any) {
    alert(humanError(e, "Shuffle failed"));
  } finally {
    setBusy(false);
  }
}

    // return YYYY-MM-DD offset by n days from a base YYYY-MM-DD
  function shiftDay(baseISO: string, days: number): string {
    const [y, m, d] = baseISO.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d)); // safe, no tz drift
    dt.setUTCDate(dt.getUTCDate() + days);
    const yy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(dt.getUTCDate()).padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
  }

  async function exportCsv() {
    setBusy(true);
    try {
      // Days: selected day and the previous two, oldest → newest
      const daysISO = [0, -1, -2].map((n) => shiftDay(day, n)).reverse();

      // Labels for headers: dd/MM (no year)
      const dayLabel = (iso: string) => {
        const [y, m, d] = iso.split("-").map(Number);
        const dt = new Date(Date.UTC(y, m - 1, d));
        const dd = String(dt.getUTCDate()).padStart(2, "0");
        const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
        return `${dd}/${mm}`;
      };
      const dayHeaders = daysISO.map(dayLabel);

      // Fetch rosters for the 3 days
      const responses = await Promise.all(
        daysISO.map((d) =>
          api
            .get<FlatRosterResp>("/assignments/roster", { params: { day: d } })
            .then((r) => ({ dayISO: d, items: r.data.items }))
        )
      );

      // Helper: HH:MM in app tz from ISO
      const hhmmFrom = (isoLike: string) => {
        const dt = new Date(isoLike);
        const parts = new Intl.DateTimeFormat(undefined, {
          timeZone: APP_TZ,
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).formatToParts(dt);
        const get = (t: Intl.DateTimeFormatPartTypes) =>
          parts.find((p) => p.type === t)?.value ?? "";
        return `${get("hour")}:${get("minute")}`;
      };

      // Parse "HH:MM-HH:MM" -> minutes since midnight for start & end
      const parseHoursToMinutes = (hours: string) => {
        const [startStr, endStr] = hours.split("-");
        const [sh, sm] = (startStr || "00:00").split(":").map(Number);
        const [eh, em] = (endStr || "00:00").split(":").map(Number);
        const startMin = (sh || 0) * 60 + (sm || 0);
        const endMinRaw = (eh || 0) * 60 + (em || 0);
        // Overnight shift normalization for comparisons (e.g., 22:00-06:00)
        const endMin = endMinRaw < startMin ? endMinRaw + 24 * 60 : endMinRaw;
        return { startMin, endMin };
      };

      // Priority for Role sorting
      const rolePriority = (role: string) => {
        const r = (role || "").toLowerCase();
        if (r === "commander") return 0;
        if (r === "driver") return 1;
        if (r === "officer") return 2;
        if (r.trim() === "") return 9; // blank roles last
        return 3; // other named roles in-between (alphabetical tie-break)
      };

      // Build rows keyed by unique slot: mission + role + hours
      // hours is "HH:MM-HH:MM" in APP_TZ
      type RowRec = {
        mission: string;
        role: string;
        hours: string;
        byDay: Record<string, string[]>; // collect names
        startMin: number;
        endMin: number;
      };

      const rowsMap = new Map<string, RowRec>();

      for (const resp of responses) {
        for (const it of resp.items) {
          const mission = it.mission?.name ?? "";
          const role = it.role ?? "";

          // Prefer server-provided local timestamps if present
          const startIsoLocal = it.start_local || it.start_at;
          const endIsoLocal = it.end_local || it.end_at;

          const startHM = hhmmFrom(startIsoLocal);
          const endHM = hhmmFrom(endIsoLocal);
          const hours = `${startHM}-${endHM}`;

          const key = `${mission}__${role}__${hours}`;
          if (!rowsMap.has(key)) {
            const { startMin, endMin } = parseHoursToMinutes(hours);
            rowsMap.set(key, {
              mission,
              role,
              hours,
              byDay: {},
              startMin,
              endMin,
            });
          }
          // append (preserve encounter order)
          const byDay = rowsMap.get(key)!.byDay;
          (byDay[resp.dayISO] ||= []).push(it.soldier_name || "");
        }
      }

      // Sort rows: Mission → Hours → Role
      const rowsArr = Array.from(rowsMap.values()).sort((a, b) => {
        // 1) Mission (A→Z)
        if (a.mission !== b.mission) return a.mission.localeCompare(b.mission);

        // 2) Hours (chronological within the mission, using start then end)
        if (a.startMin !== b.startMin) return a.startMin - b.startMin;
        if (a.endMin !== b.endMin) return a.endMin - b.endMin;

        // 3) Role (priority order, then alphabetical for ties; blank last)
        const rpA = rolePriority(a.role);
        const rpB = rolePriority(b.role);
        if (rpA !== rpB) return rpA - rpB;

        // tie-break by role name to keep deterministic output
        return a.role.localeCompare(b.role);
      });

      // CSV: columns => Mission, Role, Hours, <dd/MM>, <dd/MM>, <dd/MM>
      const header = ["Mission", "Hours", "Role", ...dayHeaders];

      // CSV escape helper
      const esc = (v: string) => {
        const s = String(v ?? "");
        if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
      };

      const lines: string[] = [];
      lines.push(header.map(esc).join(","));

      // For each slot, emit N rows where N = max assignees among the 3 days
      for (const r of rowsArr) {
        const counts = daysISO.map((d) => (r.byDay[d]?.length ?? 0));
        const maxRows = Math.max(...counts, 1);

        for (let i = 0; i < maxRows; i++) {
          const cells = [
            r.mission,
            r.hours,
            r.role,
            ...daysISO.map((d) => (r.byDay[d]?.[i] ?? "")),
          ];
          lines.push(cells.map(esc).join(","));
        }
      }

      const csv = lines.join("\n");

      // Download
      const bom = "\uFEFF";
      const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const first = daysISO[0];
      const last = daysISO[daysISO.length - 1];
      a.href = url;
      a.download = `assignments_${first}_to_${last}_by_slot.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(humanError(e, "Failed to export CSV"));
    } finally {
      setBusy(false);
    }
  }

  async function deletePlanForDay() {
    setBusy(true);
    try {
      await clearPlan(day);
      await loadAllAssignments();
      await loadWarnings(day);
      await loadDayRosterForWarnings(day);
    } catch (e: any) {
      alert(humanError(e, "Failed to delete plan for the day"));
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

  /**
   * Given a soldier, check if assigning them to the currently pending assignment
   * (pendingAssignmentId) would create an OVERLAP or <8h REST issue
   * based on the current day's rows in memory.
   */
  function computeCandidateWarnings(s: Soldier): Array<{ text: string; color: "red" | "orange" }> {
    // Determine the candidate window (ms) for the slot being assigned
    let candStart: number | null = null;
    let candEnd: number | null = null;

    if (pendingAssignmentId) {
      const target = rows.find(r => r.id === pendingAssignmentId);
      if (!target) return [];
      candStart = (target as any).start_epoch_ms ?? new Date(target.start_at).getTime();
      candEnd   = (target as any).end_epoch_ms   ?? new Date(target.end_at).getTime();
    } else if (pendingEmptySlot) {
      // Use the local ISO window captured when the empty-slot modal was opened
      candStart = new Date(pendingEmptySlot.startLocalIso).getTime();
      candEnd   = new Date(pendingEmptySlot.endLocalIso).getTime();
    } else {
      return [];
    }

    if (candStart == null || candEnd == null) return [];

    // Use the day-roster set that includes overnight overlaps
    const existing = rowsForWarnings.filter(r => r.soldier_id === s.id);

    // 1) OVERLAP: intersects any existing interval?
    const hasOverlap = existing.some(r => {
      const sMs = (r as any).start_epoch_ms ?? new Date(r.start_at).getTime();
      const eMs = (r as any).end_epoch_ms   ?? new Date(r.end_at).getTime();
      return candStart! < eMs && candEnd! > sMs;
    });

    // 2) REST tiers: compute minimum non-negative gap adjacent to the candidate
    const intervals = existing
      .map(r => ({
        start: (r as any).start_epoch_ms ?? new Date(r.start_at).getTime(),
        end:   (r as any).end_epoch_ms   ?? new Date(r.end_at).getTime(),
      }))
      .concat([{ start: candStart, end: candEnd }])
      .sort((a, b) => a.start - b.start);

    const H8 = 8 * 60 * 60 * 1000;
    const H16 = 16 * 60 * 60 * 1000;

    let minPositiveGap = Number.POSITIVE_INFINITY;
    for (let i = 0; i < intervals.length - 1; i++) {
      const a = intervals[i];
      const b = intervals[i + 1];
      const gap = b.start - a.end;
      if (gap >= 0 && gap < minPositiveGap) {
        minPositiveGap = gap;
      }
    }

    const out: Array<{ text: string; color: "red" | "orange" }> = [];

    if (hasOverlap) {
      out.push({ text: "OVERLAP", color: "red" });
    }

    // REST warnings:
    //   < 8h   => red
    //   8–16h  => orange
    if (Number.isFinite(minPositiveGap)) {
      if (minPositiveGap < H8) {
        out.push({ text: "REST", color: "red" });
      } else if (minPositiveGap < H16) {
        out.push({ text: "REST", color: "orange" });
      }
    }

    return out;
  }

  function restTierForRow(row: FlatRosterItem): "red" | "orange" | null {
    // Need a soldier and a valid interval
    if (!row.soldier_id) return null;

    const curStart = (row as any).start_epoch_ms ?? new Date(row.start_at).getTime();
    const curEnd   = (row as any).end_epoch_ms   ?? new Date(row.end_at).getTime();
    if (!(Number.isFinite(curStart) && Number.isFinite(curEnd))) return null;

    // Collect all intervals for this soldier on the roster used for warnings
    const items = rowsForWarnings
      .filter(r => r.soldier_id === row.soldier_id)
      .map(r => ({
        id: r.id,
        start: (r as any).start_epoch_ms ?? new Date(r.start_at).getTime(),
        end:   (r as any).end_epoch_ms   ?? new Date(r.end_at).getTime(),
      }))
      .filter(it => Number.isFinite(it.start) && Number.isFinite(it.end))
      .sort((a, b) => a.start - b.start);

    if (items.length === 0) return null;

    // Find this row in that set (prefer ID match; fall back to exact window match)
    let idx = items.findIndex(it => it.id === row.id);
    if (idx === -1) {
      idx = items.findIndex(it => it.start === curStart && it.end === curEnd);
    }
    if (idx === -1) {
      // If we can't pinpoint it, conservatively compute the nearest gaps to this window.
      // Insert position by start time:
      let pos = items.findIndex(it => it.start > curStart);
      if (pos === -1) pos = items.length;
      const prev = items[pos - 1];
      const next = items[pos];
      const H8  = 8 * 60 * 60 * 1000;
      const H16 = 16 * 60 * 60 * 1000;

      let minGap = Number.POSITIVE_INFINITY;
      if (prev) {
        const g = curStart - prev.end;
        if (g >= 0 && g < minGap) minGap = g;
      }
      if (next) {
        const g = next.start - curEnd;
        if (g >= 0 && g < minGap) minGap = g;
      }

      if (!Number.isFinite(minGap)) return null;
      if (minGap < H8) return "red";
      if (minGap < H16) return "orange";
      return null;
    }

    // Compute gaps with immediate neighbors
    const cur = items[idx];
    const prev = items[idx - 1];
    const next = items[idx + 1];

    const H8  = 8 * 60 * 60 * 1000;
    const H16 = 16 * 60 * 60 * 1000;

    let minGap = Number.POSITIVE_INFINITY;
    if (prev) {
      const g = cur.start - prev.end;
      if (g >= 0 && g < minGap) minGap = g;
    }
    if (next) {
      const g = next.start - cur.end;
      if (g >= 0 && g < minGap) minGap = g;
    }

    if (!Number.isFinite(minGap)) return null;
    if (minGap < H8) return "red";
    if (minGap < H16) return "orange";
    return null;
  }

  async function openChangeModal(assignmentId: number, roleName: string | null) {
    setPendingAssignmentId(assignmentId);
    setChangeError(null);
    setIsChangeOpen(true);
    setCandidateSearch("");

    try {
      const soldiers = await listSoldiers();
      const byRole = roleName
        ? soldiers.filter(s => (s.roles || []).some(r => r.name === roleName))
        : soldiers;

      const target = rows.find(r => r.id === assignmentId);
      if (!target) {
        setVisibleCandidates(byRole);
        return;
      }

      const slotStartISO = target.start_local || target.start_at;
      const slotEndISO = target.end_local || target.end_at;
      // Ensure warnings use the slot's own local day roster (not just the planner's selected day)
      const slotDayISO = (slotStartISO || "").slice(0, 10);
      await loadDayRosterForWarnings(slotDayISO);

      const allowed: Soldier[] = [];
      for (const s of byRole) {
        const ok = await isSoldierAllowedForSlot(s.id, slotStartISO, slotEndISO);
        if (ok) allowed.push(s);
      }

      setVisibleCandidates(allowed);
    } catch {
      setChangeError("Failed to load soldiers");
      setVisibleCandidates([]);
    }
  }

  function openChangeModalForEmptySlot(
    missionId: number,
    startLabel: string,    // "YYYY-MM-DD HH:MM"
    endLabel: string,      // "YYYY-MM-DD HH:MM"
    roleName?: string | null,
    roleId?: number | null
  ) {
    const startHHMM = startLabel.slice(-5);
    const endHHMM   = endLabel.slice(-5);

    const startIsoLocal = startLabel.replace(" ", "T") + ":00";
    const endIsoLocal   = endLabel.replace(" ", "T") + ":00";

    setPendingEmptySlot({
      missionId,
      roleId: roleId ?? null,
      startHHMM,
      endHHMM,
      startLocalIso: startIsoLocal,
      endLocalIso: endIsoLocal,
    });

    setPendingAssignmentId(null);
    setChangeError(null);
    setIsChangeOpen(true);
    setCandidateSearch("");

    (async () => {
      try {
        const soldiers = await listSoldiers();
        // Ensure warnings use the slot's own local day roster
        const slotDayISO = (startIsoLocal || "").slice(0, 10);
        await loadDayRosterForWarnings(slotDayISO);

        // 1) Decide the role to filter by
        let finalRoleId: number | null = roleId ?? null;
        let finalRoleName: string | null = roleName ?? null;

        // Try requirements if not provided
        if (finalRoleId == null && !finalRoleName) {
          const reqMeta = requirementsByMission.get(missionId);
          if (reqMeta && (reqMeta.requirements?.length || 0) > 0) {
            const activeReqs = (reqMeta.requirements || []).filter(r => reqCount(r) > 0);
            if (activeReqs.length === 1) {
              finalRoleId = reqRoleId(activeReqs[0]);
              finalRoleName = reqRoleName(activeReqs[0]);
            }
          }
        }

        // Fallback: infer from mission name if still missing
        if (finalRoleId == null && !finalRoleName) {
          const missionName = (allMissions.find(m => m.id === missionId)?.name) || "";
          finalRoleName = guessRoleFromMissionName(missionName);
        }

        // 2) Filter by that role (exact id first; else name)
        const pred = rolePredicate(finalRoleId, finalRoleName);
        const roleFiltered = soldiers.filter(pred);

        // 3) Then apply vacation/overlap checks (same as Unassigned path)
        const allowed: Soldier[] = [];
        for (const s of roleFiltered) {
          const ok = await isSoldierAllowedForSlot(s.id, startIsoLocal, endIsoLocal);
          if (ok) allowed.push(s);
        }

        setVisibleCandidates(allowed);
      } catch {
        setChangeError("Failed to load soldiers");
        setVisibleCandidates([]);
      }
    })();
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

      // Also refresh from server, in case slot groupings/times changed
      await loadAllAssignments();

      // IMPORTANT: refresh warnings for the currently selected day
      await loadWarnings(day);
      await loadDayRosterForWarnings(day);

      setIsChangeOpen(false);
      setPendingAssignmentId(null);

    } catch (e: any) {
      setChangeError(e?.response?.data?.detail ?? "Failed to reassign");
    } finally {
      setChangeLoading(false);
    }
  }

  async function handleUnassign() {
    if (!pendingAssignmentId) return;
    setChangeLoading(true);
    setChangeError(null);
    try {
      const updated = await unassignAssignment({ assignment_id: pendingAssignmentId });

      // Update the local table state (mirror of handleReassign)
      setRows((prev) =>
        prev.map((it) =>
          it.id === updated.id
            ? { ...it, soldier_id: updated.soldier_id, soldier_name: "" }
            : it
        )
      );

      await loadAllAssignments();
      await loadWarnings(day);
      await loadDayRosterForWarnings(day);

      setIsChangeOpen(false);
      setPendingAssignmentId(null);
    } catch (e: any) {
      setChangeError(e?.response?.data?.detail ?? "Failed to unassign");
    } finally {
      setChangeLoading(false);
    }
  }

  async function ensureVacations(soldierId: number): Promise<Vacation[]> {
    if (vacationsCache.has(soldierId)) return vacationsCache.get(soldierId)!;
    const data = await listSoldierVacations(soldierId);
    vacationsCache.set(soldierId, data);
    return data;
  }

  async function openAvailableModal() {
    setIsAvailOpen(true);
    setAvailLoading(true);
    setAvailError(null);

    try {
      // Make sure the warnings roster is up-to-date for the selected day
      await loadDayRosterForWarnings(day);

      // 1) Get all soldiers
      const soldiers = await listSoldiers();

      // 2) Make sure we have vacations cached for all soldiers
      await Promise.all(
        soldiers.map(async (s) => {
          if (!vacationsCache.has(s.id)) {
            const data = await listSoldierVacations(s.id);
            vacationsCache.set(s.id, data);
          }
        })
      );

      // 4) Split into available vs. on-vacation for the selected day
      const dayISO = day; // "YYYY-MM-DD"
      const available: Soldier[] = [];
      const onVacation: { soldier: Soldier; leavingToday: boolean; returningToday: boolean }[] = [];

      function isInRange(d: string, start: string, end: string): boolean {
        return d >= start && d <= end; // inclusive
      }

      for (const s of soldiers) {
        const vacs = vacationsCache.get(s.id) || [];
        const vacToday = vacs.find(v => isInRange(dayISO, v.start_date, v.end_date));

        if (!vacToday) {
          available.push(s);
        } else {
          const leavingToday = vacToday.start_date === dayISO;
          const returningToday = vacToday.end_date === dayISO;

          // Soldiers who leave today or return today are considered AVAILABLE.
          if (leavingToday || returningToday) {
            // Attach markers so we can show a note in the Available list.
            // We’ll keep a parallel map so we don’t mutate Soldier type.
            (available as any)._markers = (available as any)._markers || new Map<number, { leavingToday: boolean; returningToday: boolean }>();
            (available as any)._markers.set(s.id, { leavingToday, returningToday });
            available.push(s);
          } else {
            onVacation.push({ soldier: s, leavingToday, returningToday });
          }
        }
      }

      // 5) Save to state
      // (we also keep assignedToday as a Set, but we’ll recompute inside render from rowsForWarnings)
      setAvailSoldiers(available);
      setVacationSoldiers(onVacation);
    } catch (e: any) {
      setAvailError(e?.response?.data?.detail ?? "Failed to load availability");
    } finally {
      setAvailLoading(false);
    }
  }

  // Compute [start,end) UTC ms window for a day ISO ("YYYY-MM-DD")
  function dayBoundsMs(dayISO: string): { start: number; end: number } {
    const start = new Date(`${dayISO}T00:00:00Z`).getTime();
    return { start, end: start + 24 * 60 * 60 * 1000 };
  }

  // Worst warning tier ("red" | "orange" | null) for a soldier across ALL of their rows
  // that overlap the selected day window, using the same neighbor-gap logic as the table.
  function restTierForSoldier(dayISO: string, soldierId: number): "red" | "orange" | null {
    const { start: dayStart, end: dayEnd } = dayBoundsMs(dayISO);

    // Take only intervals that overlap the selected day (but rowsForWarnings contains prev/day/next).
    const items = rowsForWarnings
      .filter(r => r.soldier_id === soldierId)
      .filter(r => {
        const s = (r as any).start_epoch_ms ?? new Date(r.start_at).getTime();
        const e = (r as any).end_epoch_ms   ?? new Date(r.end_at).getTime();
        return s < dayEnd && e > dayStart; // overlaps the day window
      })
      .map(r => ({
        start: (r as any).start_epoch_ms ?? new Date(r.start_at).getTime(),
        end:   (r as any).end_epoch_ms   ?? new Date(r.end_at).getTime(),
      }))
      .filter(it => Number.isFinite(it.start) && Number.isFinite(it.end))
      .sort((a, b) => a.start - b.start);

    if (items.length === 0) return null;

    const H8  = 8 * 60 * 60 * 1000;
    const H16 = 16 * 60 * 60 * 1000;

    // Any overlap anywhere → red
    for (let i = 0; i < items.length - 1; i++) {
      if (items[i + 1].start < items[i].end) return "red";
    }

    // Min non-negative gap between neighboring intervals
    let minGap = Number.POSITIVE_INFINITY;
    for (let i = 0; i < items.length - 1; i++) {
      const gap = items[i + 1].start - items[i].end;
      if (gap >= 0 && gap < minGap) minGap = gap;
    }

    if (!Number.isFinite(minGap)) return null;
    if (minGap < H8)  return "red";
    if (minGap < H16) return "orange";
    return null;
  }

  // Compute color for an available soldier using the same logic as the table,
  // based purely on today's roster intervals in rowsForWarnings.
  function colorForAvailableSoldier(soldierId: number, assignedToday: boolean): string | undefined {
    //if (!assignedToday) return undefined;
    //const tier = restTierForSoldier(day, soldierId);
    //if (tier === "red")    return "#b91c1c"; // red-700
    //if (tier === "orange") return "#b45309"; // orange-700
    return undefined;
  }

  async function isSoldierAllowedForSlot(
    soldierId: number,
    slotStartISO: string,
    slotEndISO: string
  ): Promise<boolean> {
    const vacs = await ensureVacations(soldierId);

    // Derive the slot's local day (YYYY-MM-DD) and HH:MM parts directly from the ISO-ish strings we build.
    const slotDayISO = (slotStartISO || "").slice(0, 10);
    const startHM = (slotStartISO || "").slice(11, 16); // "HH:MM"
    const endHM   = (slotEndISO   || "").slice(11, 16); // "HH:MM"

    // Convert "HH:MM" to minutes from midnight
    const toMin = (hm: string) => {
      const [h, m] = hm.split(":").map(Number);
      return (h || 0) * 60 + (m || 0);
    };

    const startMin = toMin(startHM);
    let endMin = toMin(endHM);
    // Normalize overnight slot by extending past 24:00
    if (endMin <= startMin) endMin += 24 * 60;

    // Build vacation blocks (in minutes from midnight) for THIS slot's local day only
    const vacBlocks = buildVacationBlocksForDayMins(vacs, slotDayISO);
    if (vacBlocks.length === 0) return true;

    // Overlap test in minutes
    for (const [bStart, bEnd] of vacBlocks) {
      // Note: blocks are within [0,1440) on that day; our slot may extend to <2880
      const overlap = (startMin < bEnd) && (endMin > bStart);
      if (overlap) return false;
    }
    return true;
  }

  function buildVacationBlocksForDayMins(vacs: Vacation[], dayISO: string): Array<[number, number]> {
    const MIN_14 = 14 * 60;         // 14:00 in minutes
    const MIN_24 = 24 * 60;         // 24:00 in minutes

    const blocks: Array<[number, number]> = [];
    for (const v of vacs) {
      const sd = v.start_date;  // "YYYY-MM-DD"
      const ed = v.end_date;    // "YYYY-MM-DD"

      const isMiddleDay = sd < dayISO && ed > dayISO;
      const isStartDay  = sd === dayISO && ed !== dayISO;
      const isEndDay    = ed === dayISO && sd !== dayISO;
      const isSingleDay = sd === dayISO && ed === dayISO;

      if (isMiddleDay) {
        // Entire day blocked
        blocks.push([0, MIN_24]);
      } else if (isStartDay) {
        // Leaving day: blocked from 14:00 to 24:00
        blocks.push([MIN_14, MIN_24]);
      } else if (isEndDay) {
        // Return day: blocked from 00:00 to 14:00
        blocks.push([0, MIN_14]);
      } else if (isSingleDay) {
        // Single-day vacation: treat as leave day (available until 14:00, blocked after)
        blocks.push([MIN_14, MIN_24]);
      }
    }
    return blocks;
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
    missionId: number | null;
    missionName: string;
    slots: Array<{
      key: string;
      startLabel: string;
      endLabel: string;
      items: FlatRosterItem[];
    }>;
  }>;

  function labelFor(dayISO: string, hhmmss: string) {
    return `${dayISO} ${hhmmss.slice(0,5)}`;
  }

  function isOvernight(startHHMMSS: string, endHHMMSS: string) {
    return startHHMMSS.slice(0,5) > endHHMMSS.slice(0,5);
  }

  function nextDayISO(dayISO: string) {
    return shiftDay(dayISO, 1);
  }

  const grouped: Grouped = useMemo(() => {
    const byMission = new Map<string, Map<string, { startLabel: string; endLabel: string; items: FlatRosterItem[] }>>();

    // group existing rows by mission and time slot
    for (const r of sortedRows) {
      const missionName = r.mission?.name ?? "";
      const sMs = epochMs(r.start_at, (r as any).start_epoch_ms);
      const eMs = epochMs(r.end_at, (r as any).end_epoch_ms);
      const key = slotKey(missionName, sMs, eMs);
      const startLabel = r.start_local ? formatYMDHM(r.start_local, APP_TZ) : formatYMDHM(r.start_at, APP_TZ);
      const endLabel = r.end_local ? formatYMDHM(r.end_local, APP_TZ) : formatYMDHM(r.end_at, APP_TZ);

      if (!byMission.has(missionName)) byMission.set(missionName, new Map());
      const slots = byMission.get(missionName)!;
      if (!slots.has(key)) {
        slots.set(key, { startLabel, endLabel, items: [] });
      }
      slots.get(key)!.items.push(r);
    }

    // ensure all missions and their slots appear
    for (const m of allMissions) {
      const missionName = m.name ?? "";
      if (!byMission.has(missionName)) byMission.set(missionName, new Map());
      const slots = byMission.get(missionName)!;
      const ms = slotsByMission.get(m.id) || [];

      for (const s of ms) {
        const startDay = day;
        const endDay = isOvernight(s.start_time, s.end_time) ? nextDayISO(day) : day;
        const startLabel = labelFor(startDay, s.start_time);
        const endLabel = labelFor(endDay, s.end_time);

        // NEW: if a slot with same labels already exists (from real assignments),
        // do NOT add a seeded duplicate.
        const alreadyExists = Array.from(slots.values()).some(
          v => v.startLabel === startLabel && v.endLabel === endLabel
        );
        if (alreadyExists) continue;

        const key = `seed__${missionName}__${startLabel}__${endLabel}`;
        if (!slots.has(key)) {
          slots.set(key, { startLabel, endLabel, items: [] });
        }
      }
    }

    // map mission name -> Mission (for id & requirements)
    const missionByName = new Map<string, Mission>();
    for (const m of allMissions) {
      missionByName.set(m.name ?? "", m);
    }

    // collect missions alphabetically
    const missionOrder = Array.from(
      new Set([
        ...sortedRows.map(r => r.mission?.name ?? ""),
        ...allMissions.map(m => m.name ?? ""),
      ])
    ).sort((a, b) => a.localeCompare(b));

    const result: Grouped = [];

    for (const m of missionOrder) {
      const slots = byMission.get(m)!;
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

      // also include any seeded (empty) slots not yet added
      for (const [k, v] of slots) {
        if (seenSlots.has(k)) continue;
        slotArr.push({ key: k, startLabel: v.startLabel, endLabel: v.endLabel, items: v.items });
      }

      const meta = missionByName.get(m);
      const missionId = meta?.id ?? null;

      result.push({ missionId, missionName: m, slots: slotArr });
    }

    return result;
  }, [sortedRows, allMissions, slotsByMission, day]);

  useEffect(() => {
    loadAllAssignments();
    loadDayRosterForWarnings(day);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day]);

  useEffect(() => {
    (async () => {
      try {
        const missions = await listMissions();
        setAllMissions(missions);

        // slots
        const slotsEntries: Array<[number, MissionSlot[]]> = await Promise.all(
          missions.map(async (m) => [m.id, await listMissionSlots(m.id)] as [number, MissionSlot[]])
        );
        setSlotsByMission(new Map(slotsEntries));

        // requirements + total_needed
        const reqEntries: Array<[number, { total_needed?: number | null; requirements: MissionRequirement[] }]> =
          await Promise.all(
            missions.map(async (m) => {
              try {
                const r = await getMissionRequirements(m.id);
                return [m.id, { total_needed: r.total_needed ?? null, requirements: r.requirements ?? [] }];
              } catch {
                return [m.id, { total_needed: m.total_needed ?? null, requirements: [] }];
              }
            })
          );
        setRequirementsByMission(new Map(reqEntries));
      } catch {
        setAllMissions([]);
        setSlotsByMission(new Map());
        setRequirementsByMission(new Map());
      }
    })();
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
        <button
          onClick={shufflePlanner}
          disabled={busy}
          className="border rounded px-3 py-1 hover:bg-gray-50 disabled:opacity-50"
        >
          {busy ? "Shuffling…" : "Shuffle Plan"}
        </button>
        <button
          onClick={deletePlanForDay}
          disabled={busy}
          className="border rounded px-3 py-1 hover:bg-gray-50 disabled:opacity-50"
          style={{ marginLeft: 8 }}
        >
          {busy ? "Working…" : "Delete Plan"}
        </button>
        <button
          onClick={exportCsv}
          disabled={busy || listBusy}
          className="border rounded px-3 py-1 hover:bg-gray-50 disabled:opacity-50"
          style={{ marginLeft: 8 }}
        >
          {busy ? "Working…" : "Export csv"}
        </button>
                <button
          onClick={openAvailableModal}
          disabled={busy || listBusy}
          className="border rounded px-3 py-1 hover:bg-gray-50 disabled:opacity-50"
          style={{ marginLeft: 8 }}
        >
          Available Soldiers
        </button>
      </div>

      {/*results && (
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
      )*/}

            <Modal
        open={isAvailOpen}
        onClose={() => setIsAvailOpen(false)}
        title={`Available Soldiers — ${day}`}
      >
        {availLoading && <div>Loading…</div>}
        {!availLoading && availError && (
          <div style={{ color: "crimson", marginBottom: 8 }}>{availError}</div>
        )}
        {!availLoading && !availError && (
          <div style={{ maxHeight: 480, overflowY: "auto" }}>
            {/* Build assigned-today set from rowsForWarnings */}
            {(() => {
              const { start: dayStart, end: dayEnd } = dayBoundsMs(day);
              const assignedToday = new Set(
                rowsForWarnings
                  .filter(r => r.soldier_id != null)
                  .filter(r => {
                    const s = (r as any).start_epoch_ms ?? new Date(r.start_at).getTime();
                    const e = (r as any).end_epoch_ms   ?? new Date(r.end_at).getTime();
                    return s < dayEnd && e > dayStart; // overlaps selected day
                  })
                  .map(r => r.soldier_id as number)
              );

              return (
                <>
                  <h3 className="text-lg font-semibold" style={{ marginBottom: 8 }}>
                    Available on {day} ({availSoldiers.length})
                  </h3>
                  {availSoldiers.length === 0 ? (
                    <div className="text-gray-500" style={{ marginBottom: 12 }}>
                      No available soldiers for this date.
                    </div>
                  ) : (
                    <ul style={{ marginBottom: 16 }}>
                      {availSoldiers.map((s) => {
                        const assigned = assignedToday.has(s.id);
                        return (
                          <li
                            key={s.id}
                            style={{
                              display: "flex",
                              gap: 8,
                              alignItems: "center",
                              padding: "6px 0",
                              borderBottom: "1px solid #eee",
                            }}
                          >
                            <span style={{ minWidth: 18, textAlign: "center" }}>
                              {assigned ? "✓" : ""}
                            </span>
                            <span style={{ display: "flex", flexDirection: "column" }}>
                              <span>
                                {s.name}
                                {s.roles && s.roles.length > 0
                                  ? ` (${s.roles.map(r => r.name).join(", ")})`
                                  : ""}
                              </span>
                              {(() => {
                                const markers = (availSoldiers as any)._markers as Map<number, { leavingToday: boolean; returningToday: boolean }> | undefined;
                                const mark = markers?.get(s.id);
                                if (!mark) return null;
                                return (
                                  <span style={{ fontSize: 12, color: "#555" }}>
                                    {mark.leavingToday && "Leaving for vacation today"}
                                    {mark.leavingToday && mark.returningToday ? " · " : ""}
                                    {mark.returningToday && "Returning from vacation today"}
                                  </span>
                                );
                              })()}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  <h3 className="text-lg font-semibold" style={{ marginBottom: 8 }}>
                    On vacation on {day} ({vacationSoldiers.length})
                  </h3>

                  {vacationSoldiers.length === 0 ? (
                    <div className="text-gray-500">No soldiers on vacation this date.</div>
                  ) : (
                    <ul>
                      {vacationSoldiers.map(({ soldier, leavingToday, returningToday }) => (
                        <li
                          key={soldier.id}
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 2,
                            padding: "6px 0",
                            borderBottom: "1px solid #eee",
                          }}
                        >
                          <div>
                            {soldier.name}
                            {soldier.roles && soldier.roles.length > 0
                              ? ` (${soldier.roles.map(r => r.name).join(", ")})`
                              : ""}
                          </div>
                          {(leavingToday || returningToday) && (
                            <div style={{ fontSize: 12, color: "#555" }}>
                              {leavingToday && "Leaving for vacation today"}
                              {leavingToday && returningToday ? " · " : ""}
                              {returningToday && "Returning from vacation today"}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              );
            })()}
          </div>
        )}
      </Modal>

      <SoldierHistoryModal
        soldierId={historySoldierId ?? 0}
        soldierName={historySoldierName}
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
      />

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
                  <th className="border p-2 text-left">Time Slot</th>
                  <th className="border p-2 text-left">Details</th>
                </tr>
              </thead>
              <tbody>
                {warnings.map((w, i) => (
                  <tr key={i}>
                    <td className="border p-2">{w.type}</td>
                    <td className="border p-2">{w.soldier_name}</td>
                    <td className="border p-2">{w.mission_name}</td>
                    <td className="border p-2">{w.start_at} → {w.end_at}</td>
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

        {!listBusy && (
          <div className="border rounded overflow-x-auto">
            {/* If absolutely nothing to show (no missions/slots configured), show a tiny hint */}
            {grouped.every(g => g.slots.length === 0) ? (
              <div className="p-3 text-gray-500">No missions/slots configured for this day.</div>
            ) : (
              <>
                {/* your existing Modal and <table> stay exactly the same below */}
            <Modal open={isChangeOpen} onClose={() => setIsChangeOpen(false)} title="Change Soldier">
              {changeError && <div style={{ color: "red", marginBottom: 8 }}>{changeError}</div>}
              {changeLoading && <div>Applying change…</div>}
              {!changeLoading && (
                <div style={{ maxHeight: 360, overflowY: "auto" }}>
                  <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                    <input
                      type="text"
                      value={candidateSearch}
                      onChange={(e) => setCandidateSearch(e.target.value)}
                      placeholder="Search soldiers…"
                      className="border rounded px-2 py-1 w-full"
                    />
                    {candidateSearch && (
                      <button
                        type="button"
                        onClick={() => setCandidateSearch("")}
                        className="border rounded px-2 py-1"
                        title="Clear search"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  {filteredCandidates.length === 0 && <div>No soldiers found</div>}
                  {filteredCandidates.map((s) => (
                  <div
                    key={s.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "6px 0",
                      borderBottom: "1px solid #eee",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <span>
                      {s.name}
                      {s.roles && s.roles.length > 0 ? ` (${s.roles.map(r => r.name).join(", ")})` : ""}
                                            {(() => {
                        const warns = computeCandidateWarnings(s);
                        if (!warns.length) return null;
                        return (
                          <span style={{ marginLeft: 6, fontWeight: 600, display: "inline-flex", gap: 6 }}>
                            {warns.map((w, idx) => (
                              <span
                                key={idx}
                                style={{
                                  color: w.color === "red" ? "crimson" : "#d97706", // orange-600
                                  border: "1px solid currentColor",
                                  borderRadius: 4,
                                  padding: "1px 6px",
                                  fontSize: "0.85em",
                                }}
                                title={w.text === "REST" ? (w.color === "red" ? "Rest < 8h" : "Rest < 16h") : w.text}
                              >
                                {w.text}
                              </span>
                            ))}
                          </span>
                        );
                      })()}
                    </span>
                    <button type="button" onClick={() => handleReassign(s.id)}>
                      Assign
                    </button>
                  </div>
                  ))}
                </div>
              )}
              {/* Footer actions */}
              {!changeLoading && (
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                  <button
                    type="button"
                    className="border rounded px-2 py-1"
                    title="Leave this slot unassigned"
                    onClick={async () => {
                      if (pendingAssignmentId) {
                        await handleUnassign();     // actually unassign existing assignment
                      } else {
                        // empty slot: nothing to unassign, just close
                        setIsChangeOpen(false);
                        setPendingEmptySlot(null);
                        setPendingAssignmentId(null);
                      }
                    }}
                  >
                    No Assignee
                  </button>
                </div>
              )}
            </Modal>

            <table className="min-w-[760px] w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left p-2 border w-[220px]">Mission</th>
                  <th className="text-left p-2 border w-[260px]">Time Slot</th>
                  <th className="text-left p-2 border">Role</th>
                  <th className="text-left p-2 border">Soldier</th>
                </tr>
              </thead>
              <tbody>
                {grouped.map((g, gIdx) => (
                  <React.Fragment key={`g-${gIdx}`}>
                    {/* Mission divider (skip before the first mission) */}
                    {gIdx > 0 && (
                      <tr aria-hidden>
                        <td colSpan={4} style={{ padding: 0 }}>
                          <div
                            style={{
                              height: 1,
                              width: "100%",
                              backgroundColor: "#9ca3af", // gray-400
                              opacity: 0.9,
                            }}
                          />
                        </td>
                      </tr>
                    )}

                    {g.slots.map((slot, sIdx) => {
                      const rowsForSlot = slot.items;

                      // Slot divider (before every slot except the first within a mission)
                      const slotDivider =
                        sIdx > 0 ? (
                          <tr key={`ssep-${gIdx}-${sIdx}`} aria-hidden>
                            <td colSpan={4} style={{ padding: 0 }}>
                              <div
                                style={{
                                  height: 1,
                                  width: "100%",
                                  backgroundColor: "#9ca3af", // gray-400
                                  opacity: 0.7,
                                }}
                              />
                            </td>
                          </tr>
                        ) : null;

                      const missionCell = (
                        <td
                          className="align-top p-2 border bg-gray-50"
                          rowSpan={rowsForSlot.length || 1}
                        >
                          <div className="font-semibold">{g.missionName || "—"}</div>
                        </td>
                      );

                      const timeCell = (
                        <td
                          className="align-top p-2 border bg-gray-50"
                          rowSpan={rowsForSlot.length || 1}
                        >
                          <div className="text-xs text-gray-600">
                            {slot.startLabel} → {slot.endLabel}
                          </div>
                        </td>
                      );

                      // EMPTY SLOT (seeded by mission/slot config)
                      if (rowsForSlot.length === 0) {
                        const reqMeta =
                          g.missionId != null ? requirementsByMission.get(g.missionId) : undefined;
                        const reqs = reqMeta?.requirements ?? [];
                        const explicitCount = reqs.reduce((sum, r) => sum + reqCount(r), 0);
                        const totalNeeded = reqMeta?.total_needed ?? 0;
                        const genericSlots = Math.max(0, Number(totalNeeded) - Number(explicitCount));

                        return (
                          <React.Fragment key={slot.key}>
                            {slotDivider}
                            <tr>
                              {missionCell}
                              {timeCell}

                              {(() => {
                                    // Decide a display role for the empty slot
                                    const activeReqs = (reqs || []).filter((r) => reqCount(r) > 0);
                                    let displayRoleName: string | null = null;

                                    if (activeReqs.length === 1) {
                                      // exactly one explicit role required
                                      displayRoleName = reqRoleName(activeReqs[0]);
                                    } else if (activeReqs.length === 0) {
                                      // no explicit role – try to infer from the mission name (e.g., "Base Officer" -> "Officer")
                                      displayRoleName = guessRoleFromMissionName(g.missionName);
                                      // if nothing inferred but there are generic slots, show "Any"
                                      if (!displayRoleName && genericSlots > 0) displayRoleName = "Any";
                                    }

                                    return (
                                      // Role column (now shows the derived role)
                                      <td className="p-2 border">{displayRoleName ?? "—"}</td>
                                    );
                                  })()}

                              {/* Soldier column with "No assignees" + Change button */}
                              <td className="p-2 border">
                                <div className="flex items-center gap-2">
                                  <span className="italic text-gray-500" style={{ color: "crimson" }}>Unassigned</span>

                                  {(() => {
                                    // If exactly one explicit role is required, open the modal filtered to that role.
                                    const activeReqs = (reqs || []).filter((r) => reqCount(r) > 0);
                                    const singleRoleReq = activeReqs.length === 1 ? activeReqs[0] : null;
                                    const singleRoleName = singleRoleReq ? reqRoleName(singleRoleReq) : null;
                                    const singleRoleId = singleRoleReq ? reqRoleId(singleRoleReq) : null;

                                    return (
                                      <button
                                        type="button"
                                        className="border rounded px-2 py-1"
                                        onClick={() =>
                                          g.missionId &&
                                          openChangeModalForEmptySlot(
                                            g.missionId,
                                            slot.startLabel,
                                            slot.endLabel,
                                            singleRoleName,   // filter if exactly one role is required
                                            singleRoleId
                                          )
                                        }
                                      >
                                        Change
                                      </button>
                                    );
                                  })()}
                                </div>

                                {/* Optional: keep the role-specific quick-assign actions below */}
                                {(reqs.length > 0 || genericSlots > 0) && (
                                  <div className="mt-2 flex flex-wrap gap-6 items-center">
                                    {reqs.map((r, idx) => {
                                      const roleName = reqRoleName(r) ?? `Role #${reqRoleId(r) ?? "?"}`;
                                      const count = reqCount(r);
                                      if (count <= 0) return null;
                                      return (
                                        <div key={idx} className="flex items-center gap-2">
                                          <span className="text-sm text-gray-600">
                                            {roleName} × {count}
                                          </span>
                                          <button
                                            type="button"
                                            className="border rounded px-2 py-1"
                                            onClick={() =>
                                              g.missionId &&
                                              openChangeModalForEmptySlot(
                                                g.missionId,
                                                slot.startLabel,
                                                slot.endLabel,
                                                reqRoleName(r),
                                                reqRoleId(r)
                                              )
                                            }
                                          >
                                            Assign {roleName}
                                          </button>
                                        </div>
                                      );
                                    })}

                                    {genericSlots > 0 && (
                                      <div className="flex items-center gap-2">
                                        <span className="text-sm text-gray-600">
                                          Generic × {genericSlots}
                                        </span>
                                        <button
                                          type="button"
                                          className="border rounded px-2 py-1"
                                          onClick={() =>
                                            g.missionId &&
                                            openChangeModalForEmptySlot(
                                              g.missionId,
                                              slot.startLabel,
                                              slot.endLabel,
                                              null,
                                              null
                                            )
                                          }
                                        >
                                          Assign (Any)
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </td>
                            </tr>
                          </React.Fragment>
                        );
                      }

                      // NON-EMPTY SLOT (render actual assignments)
                      return (
                        <React.Fragment key={slot.key}>
                          {slotDivider}
                          {rowsForSlot.map((r, idx) => (
                            <tr key={`${slot.key}__${r.id}`}>
                              {idx === 0 && missionCell}
                              {idx === 0 && timeCell}
                              <td className="p-2 border">{r.role ?? ""}</td>
                                                            <td className="border">
                                <div className="flex items-center gap-2">
                                  {(() => {
                                    if (!r.soldier_id || !r.soldier_name) {
                                      return <span style={{ color: "crimson" }}>Unassigned</span>;
                                    }
                                    const tier = restTierForRow(r); // "red" | "orange" | null
                                    const style =
                                      tier === "red"
                                        ? { color: "crimson", fontWeight: 600 }
                                        : tier === "orange"
                                        ? { color: "#d97706", fontWeight: 600 } // orange-600
                                        : undefined;
                                    return (
                                      <button
                                        type="button"
                                        onClick={() => openSoldierHistory(r.soldier_id!, r.soldier_name)}
                                        className="underline"
                                        style={style}
                                        title="View Mission History"
                                      >
                                        {r.soldier_name}
                                      </button>
                                    );

                                  })()}
                                  <button
                                    type="button"
                                    onClick={() =>
                                      openChangeModal(r.id, r.role)
                                    }
                                    className="border rounded px-2 py-1"
                                  >
                                    Change
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </React.Fragment>
                      );
                    })}
                  </React.Fragment>
                ))}
              </tbody>
              </table>
            </>
          )}
        </div>
      )}
      </div>
    </div>
  );
}
