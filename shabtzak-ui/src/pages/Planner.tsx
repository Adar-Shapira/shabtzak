// shabtzak-ui/src/pages/Planner.tsx
import { useEffect, useMemo, useState } from "react";
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
import { getPlannerWarnings, type PlannerWarning } from "../api"
import { listSoldierVacations, type Vacation } from "../api";



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

// Always format a UTC ISO timestamp into APP_TZ for consistent slot labels
function fmtFromUTC(utcIso: string) {
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
  const [visibleCandidates, setVisibleCandidates] = useState<Soldier[]>([]);
  const [pendingAssignmentId, setPendingAssignmentId] = useState<number | null>(null);
  const [candidateSearch, setCandidateSearch] = useState<string>("");
  const [changeLoading, setChangeLoading] = useState(false);
  const [changeError, setChangeError] = useState<string | null>(null);
  const [pendingRoleName, setPendingRoleName] = useState<string | null>(null);

  const [pendingMissionId, setPendingMissionId] = useState<number | null>(null);
  const [vacationsCache] = useState<Map<number, Vacation[]>>(new Map());

  const [warnings, setWarnings] = useState<PlannerWarning[]>([])
  const [warnLoading, setWarnLoading] = useState(false)
  const [warnError, setWarnError] = useState<string | null>(null)

  const [pendingEmptySlot, setPendingEmptySlot] = useState<null | {
    missionId: number;
    roleId: number | null;      // if you want role-aware empty slots later
    startHHMM: string;          // "HH:MM"
    endHHMM: string;
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

      const minutesSinceMidnight = (isoLike: string) => {
        const dt = new Date(isoLike);
        const parts = new Intl.DateTimeFormat(undefined, {
          timeZone: APP_TZ,
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).formatToParts(dt);
        const get = (t: Intl.DateTimeFormatPartTypes) =>
          parts.find((p) => p.type === t)?.value ?? "00";
        const hh = parseInt(get("hour"), 10) || 0;
        const mm = parseInt(get("minute"), 10) || 0;
        return hh * 60 + mm;
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
      setResults(null);
      await loadAllAssignments();
      await loadWarnings(day);
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

    // === Candidate warning helpers for Change Soldier modal ===
  const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;

  function toMs(iso: string) {
    return new Date(iso).getTime();
  }

  /**
   * Given a soldier, check if assigning them to the currently pending assignment
   * (pendingAssignmentId) would create an OVERLAP or <8h REST issue
   * based on the current day's rows in memory.
   */
  function computeCandidateWarnings(s: Soldier): string[] {
    if (!pendingAssignmentId) return [];

    // The assignment we’re trying to fill
    const target = rows.find(r => r.id === pendingAssignmentId);
    if (!target) return [];

    const candStart = (target as any).start_epoch_ms ?? toMs(target.start_at);
    const candEnd   = (target as any).end_epoch_ms   ?? toMs(target.end_at);

    // Soldier’s existing assignments for the selected day we’ve already loaded
    const existing = rows.filter(r => r.soldier_id === s.id);

    // 1) OVERLAP: if candidate window intersects any existing window
    const hasOverlap = existing.some(r => {
      const sMs = (r as any).start_epoch_ms ?? toMs(r.start_at);
      const eMs = (r as any).end_epoch_ms   ?? toMs(r.end_at);
      return candStart < eMs && candEnd > sMs;
    });

    // 2) REST: include candidate among soldier’s intervals and check adjacent gaps
    const intervals = existing
      .map(r => ({
        start: (r as any).start_epoch_ms ?? toMs(r.start_at),
        end:   (r as any).end_epoch_ms   ?? toMs(r.end_at),
      }))
      .concat([{ start: candStart, end: candEnd }])
      .sort((a, b) => a.start - b.start);

    let hasRestViolation = false;
    for (let i = 0; i < intervals.length - 1; i++) {
      const a = intervals[i];
      const b = intervals[i + 1];
      const gap = b.start - a.end;
      // “REST” means non-negative gap but less than 8 hours.
      if (gap >= 0 && gap < EIGHT_HOURS_MS) {
        hasRestViolation = true;
        break;
      }
    }

    const labels: string[] = [];
    if (hasOverlap) labels.push("OVERLAP WARNING");
    if (hasRestViolation) labels.push("REST WARNING");
    return labels;
  }

  async function openChangeModal(assignmentId: number, roleName: string | null, missionId: number | null) {
    setPendingAssignmentId(assignmentId);
    setPendingRoleName(roleName);
    setPendingMissionId(missionId);
    setChangeError(null);
    setIsChangeOpen(true);
    setCandidateSearch("");

    try {
      const soldiers = await listSoldiers();
      const byRole = roleName ? soldiers.filter(s => (s.roles || []).some(r => r.name === roleName)) : soldiers;
      setAllSoldiers(byRole);

      const target = rows.find(r => r.id === assignmentId);
      if (!target) {
        setVisibleCandidates(byRole);
        return;
      }

      const dayISO = day; // YYYY-MM-DD selected in the planner
      const slotStartISO = target.start_local || target.start_at;
      const slotEndISO = target.end_local || target.end_at;

      const allowed: Soldier[] = [];
      for (const s of byRole) {
        const ok = await isSoldierAllowedForSlot(s.id, dayISO, slotStartISO, slotEndISO);
        if (ok) allowed.push(s);
      }
      setVisibleCandidates(allowed);
    } catch {
      setChangeError("Failed to load soldiers");
      setAllSoldiers([]);
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

    setPendingEmptySlot({ missionId, roleId: roleId ?? null, startHHMM, endHHMM });

    setPendingAssignmentId(null);
    setPendingRoleName(roleName ?? null);
    setPendingMissionId(missionId);
    setChangeError(null);
    setIsChangeOpen(true);
    setCandidateSearch("");

    // Build ISO strings in local time for vacation checks
    const startIsoLocal = startLabel.replace(" ", "T") + ":00";
    const endIsoLocal   = endLabel.replace(" ", "T") + ":00";

    // Load soldiers and prefilter by role (if provided), then apply vacation/overlap checks
    (async () => {
      try {
        const soldiers = await listSoldiers();
        const roleFiltered = roleName
          ? soldiers.filter(s => (s.roles || []).some(r => r.name === roleName))
          : soldiers;

        const allowed: Soldier[] = [];
        for (const s of roleFiltered) {
          const ok = await isSoldierAllowedForSlot(s.id, day, startIsoLocal, endIsoLocal);
          if (ok) allowed.push(s);
        }
        setAllSoldiers(roleFiltered);
        setVisibleCandidates(allowed);
      } catch {
        setChangeError("Failed to load soldiers");
        setAllSoldiers([]);
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

  async function isSoldierAllowedForSlot(
    soldierId: number,
    dayISO: string,
    slotStartISO: string,
    slotEndISO: string
  ): Promise<boolean> {
    const vacs = await ensureVacations(soldierId);
    const blocks = buildVacationBlocksForDayLocal(vacs, dayISO);
    if (blocks.length === 0) return true;

    const slotStartLocal = new Date(slotStartISO);
    const slotEndLocal = new Date(slotEndISO);
    for (const [bs, be] of blocks) {
      if (overlapsLocal(slotStartLocal, slotEndLocal, bs, be)) return false;
    }
    return true;
  }

  function buildVacationBlocksForDayLocal(vacs: Vacation[], dayISO: string): Array<[Date, Date]> {
    const blocks: Array<[Date, Date]> = [];
    const dayStart = new Date(`${dayISO}T00:00:00`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    for (const v of vacs) {
      const sd = v.start_date;
      const ed = v.end_date;

      const startLt = new Date(`${sd}T00:00:00`);
      const endLtEndOfDay = new Date(new Date(`${ed}T00:00:00`).getTime() + 24 * 60 * 60 * 1000);

      const isMiddleDay = startLt < dayStart && new Date(`${ed}T00:00:00`) > dayStart;
      const isStartDay = sd === dayISO && ed !== dayISO;
      const isEndDay = ed === dayISO && sd !== dayISO;
      const isSingleDay = sd === dayISO && ed === dayISO;

      if (isMiddleDay || isSingleDay) {
        blocks.push([dayStart, dayEnd]);
      } else if (isStartDay) {
        const start14 = new Date(dayStart);
        start14.setHours(14, 0, 0, 0);
        blocks.push([start14, dayEnd]);
      } else if (isEndDay) {
        const end14 = new Date(dayStart);
        end14.setHours(14, 0, 0, 0);
        blocks.push([dayStart, end14]);
      }
    }
    return blocks;
  }

  function overlapsLocal(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
    return bStart < aEnd && bEnd > aStart;
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

  const missionIdByName = useMemo(() => {
    const m = new Map<string, number>();
    allMissions.forEach(mm => m.set(mm.name, mm.id));
    return m;
  }, [allMissions]);

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
                          <span style={{ color: "red", fontWeight: 600, marginLeft: 6 }}>
                            *{warns.join(", ")}
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
                      // Figure out this mission's requirements so we can show per-role Assign buttons
                      const reqMeta = g.missionId != null ? requirementsByMission.get(g.missionId) : undefined;
                      const reqs = reqMeta?.requirements ?? [];
                      const explicitCount = reqs.reduce((sum: number, r) => sum + (r.count || 0), 0); // typed sum
                      const totalNeeded = reqMeta?.total_needed ?? 0;
                      const genericSlots = Math.max(0, Number(totalNeeded) - Number(explicitCount));

                      return (
                        <tr key={slot.key}>
                          {headerCell}
                          <td className="p-2 border italic text-gray-500" colSpan={2}>
                            <div>No assignees</div>

                            {/* Role-specific assignment buttons */}
                            <div className="mt-2 flex flex-wrap gap-6 items-center">
                              {reqs.map((r: any, idx: number) => {
                                const roleName = r?.role?.name ?? r?.role_name ?? `Role #${r?.role_id ?? "?"}`;
                                const count = r?.count ?? 0;
                                if (count <= 0) return null;
                                return (
                                  <div key={idx} className="flex items-center gap-2">
                                    <span className="text-sm text-gray-600">{roleName} × {count}</span>
                                    <button
                                      type="button"
                                      className="border rounded px-2 py-1"
                                      onClick={() =>
                                        g.missionId &&
                                        openChangeModalForEmptySlot(g.missionId, slot.startLabel, slot.endLabel, roleName, r?.role_id ?? null)
                                      }
                                    >
                                      Assign {roleName}
                                    </button>
                                  </div>
                                );
                              })}

                              {/* Generic (Any role) assignment button, if mission.total_needed requires more */}
                              {genericSlots > 0 && (
                                <div className="flex items-center gap-2">
                                  <span className="text-sm text-gray-600">Generic × {genericSlots}</span>
                                  <button
                                    type="button"
                                    className="border rounded px-2 py-1"
                                    onClick={() =>
                                      g.missionId &&
                                      openChangeModalForEmptySlot(g.missionId, slot.startLabel, slot.endLabel, null, null)
                                    }
                                  >
                                    Assign (Any)
                                  </button>
                                </div>
                              )}
                            </div>
                          </td>
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
            </>
          )}
        </div>
      )}
      </div>
    </div>
  );
}
