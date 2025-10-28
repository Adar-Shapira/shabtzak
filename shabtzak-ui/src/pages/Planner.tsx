// shabtzak-ui/src/pages/Planner.tsx
import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import {
  listSoldiers,
  reassignAssignment,
  unassignAssignment,
  createAssignment,
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
import { useSidebar } from "../contexts/SidebarContext";


type FlatRosterItem = {
  id: number;
  mission: { id: number | null; name: string | null } | null;
  role: string | null;
  role_id: number | null;  // NEW: for exclusion feature
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

// ... existing code ...

async function fillPlanForDay(
  forDay: string,
  replace = false,
  opts?: { shuffle?: boolean; random_seed?: number; exclude_slots?: string[]; locked_assignments?: number[] }
) {
  await api.post("/plan/fill", { day: forDay, replace, ...(opts || {}) });
}

// Literal extractor: "YYYY-MM-DD HH:MM" from a timestamp string (ISO or "YYYY-MM-DD HH:MM[:SS]")
// No timeZone conversions.
function formatYMDHM(dtIso: string) {
  if (typeof dtIso === "string") {
    const s = dtIso.replace(" ", "T");
    // prefer the literal bits present in the string
    const datePart = s.slice(0, 10);
    const m = s.match(/T(\d{2}):(\d{2})/);
    if (datePart && m) return `${datePart} ${m[1]}:${m[2]}`;
    // fallback: try to extract directly from string without parsing
    if (s.length >= 16) {
      const datePart2 = s.slice(0, 10);
      const timePart2 = s.slice(11, 16);
      return `${datePart2} ${timePart2}`;
    }
  }
  return dtIso;
}

// Robust epoch getter (uses server epoch if present)
function epochMs(iso: string, serverEpoch?: number) {
  // Always prefer server-provided epoch to avoid timezone conversion
  if (typeof serverEpoch === "number") return serverEpoch;
  // For naive datetimes without server epoch, fall back to Date parsing (but prefer server epoch)
  return new Date(iso).getTime();
}

// Stable slot key for grouping (mission + exact window)
function slotKey(missionName: string, startMs: number, endMs: number) {
  return `${missionName}__${startMs}__${endMs}`;
}

// --- MissionRequirement helpers (schema-agnostic) ---
function reqRoleName(r: MissionRequirement): string | null {
  const x = r as any;
  // Check role_name first (this is what we get from the API)
  if (typeof x?.role_name === "string") return x.role_name;
  if (x?.role?.name) return String(x.role.name);
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

const fmtWarn = (iso: string) => formatYMDHM(iso);

function WarningPill({ type, color }: { type: string; color?: "red" | "orange" | "gray" }) {
  const style =
    color === "red"
      ? { color: "crimson" }
      : color === "orange"
      ? { color: "#d97706" } // orange-600 used in modal
      : { color: "#374151" }; // gray-700 fallback (for RESTRICTED)

  return (
    <span
      style={{
        ...style,
        border: "1px solid currentColor",
        borderRadius: 4,
        padding: "1px 6px",
        fontSize: "0.85em",
        fontWeight: 600,
        display: "inline-block",
        lineHeight: 1.3,
      }}
    >
      {type}
    </span>
  );
}

function WarningsCell({ items }: { items: Array<{ type: string; color?: "red" | "orange" | "gray" }> }) {
  if (!items || items.length === 0) return null;
  // Deduplicate by TYPE+COLOR so orange/red REST both show if ever mixed
  const uniq = new Map<string, { type: string; color?: "red" | "orange" | "gray" }>();
  for (const it of items) {
    const key = `${it.type}__${it.color ?? "none"}`;
    if (!uniq.has(key)) uniq.set(key, it);
  }
  return (
    <div className="flex flex-wrap gap-1">
      {Array.from(uniq.values()).map((it, i) => (
        <WarningPill key={`${it.type}-${it.color ?? "none"}-${i}`} type={it.type} color={it.color} />
      ))}
    </div>
  );
}

export default function Planner() {
  const { setActions } = useSidebar();
  
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [day, setDay] = useState<string>(today);

  const [busy, setBusy] = useState(false);
  const [lockedByDay, setLockedByDay] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem("planner.lockedByDay");
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  const locked = !!lockedByDay[day];

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

  const [soldiersById, setSoldiersById] = useState<Map<number, Soldier>>(new Map());
  
  // Track which slots should remain unassigned during fill/shuffle
  // Key: `${mission_id}_${role || 'GENERIC'}_${start_at}_${end_at}`
  const [excludedSlots, setExcludedSlots] = useState<Set<string>>(() => {
    try {
      const key = `planner.excludedSlots.${day}`;
      const raw = localStorage.getItem(key);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
      return new Set();
    }
  });

  // Track which assignments should be locked (not reassigned during fill/shuffle)
  // Key: assignment ID
  const [lockedAssignments, setLockedAssignments] = useState<Set<number>>(() => {
    try {
      const key = `planner.lockedAssignments.${day}`;
      const raw = localStorage.getItem(key);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
      return new Set();
    }
  });

  const warningsByAssignmentId = useMemo(() => {
  const map = new Map<number, PlannerWarning[]>();
  for (const w of warnings) {
    // Only attach warnings that point to a concrete assignment on this day
    if (w.assignment_id != null) {
      const arr = map.get(w.assignment_id) || [];
      arr.push(w);
      map.set(w.assignment_id, arr);
    }
  }
  return map;
}, [warnings]);

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
    // Build YYYY-MM-DD for (day-1), day, (day+1) without relying on shiftDay's position
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
    // Load excluded slots and locked assignments for the current day
    try {
      const excludedKey = `planner.excludedSlots.${day}`;
      const excludedRaw = localStorage.getItem(excludedKey);
      setExcludedSlots(excludedRaw ? new Set(JSON.parse(excludedRaw)) : new Set());
      
      const lockedKey = `planner.lockedAssignments.${day}`;
      const lockedRaw = localStorage.getItem(lockedKey);
      setLockedAssignments(lockedRaw ? new Set(JSON.parse(lockedRaw)) : new Set());
    } catch {
      setExcludedSlots(new Set());
      setLockedAssignments(new Set());
    }
    // load warnings whenever the selected day changes
    loadWarnings(day);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day]);

  useEffect(() => {
    (async () => {
      try {
        const all = await listSoldiers();
        const m = new Map<number, Soldier>();
        for (const s of all) m.set(s.id, s);
        setSoldiersById(m);
      } catch {
        setSoldiersById(new Map());
      }
    })();
  }, []);

async function runPlanner() {
  deletePlanForDay();
  setBusy(true);
  try {
    // 1) Ask the backend to fill the plan for the selected day
    // Include only currently excluded slots (those with checkboxes checked)
    const excludeSlots = Array.from(excludedSlots);
    const lockedAssignmentIds = Array.from(lockedAssignments);
    await fillPlanForDay(day, /* replace */ false, { exclude_slots: excludeSlots, locked_assignments: lockedAssignmentIds });

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
    const excludeSlots = Array.from(excludedSlots);
    const lockedAssignmentIds = Array.from(lockedAssignments);
    await fillPlanForDay(day, /* replace */ true, {
      shuffle: true,
      random_seed: Date.now(),
      exclude_slots: excludeSlots,
      locked_assignments: lockedAssignmentIds,
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

      // Helper: HH:MM taken verbatim from the timestamp string (no TZ conversion)
      const hhmmFrom = (isoLike: string) => {
        // Accepts: "YYYY-MM-DDTHH:MM:SS", "YYYY-MM-DD HH:MM[:SS]", or full ISO with offset
        // Prefer extracting the literal clock time as written.
        if (typeof isoLike === "string") {
          // Normalize space to 'T' for patterns like "YYYY-MM-DD HH:MM"
          const s = isoLike.replace(" ", "T");
          // Match "...T HH:MM"
          const m = s.match(/T(\d{2}):(\d{2})/);
          if (m) return `${m[1]}:${m[2]}`;
        }
        // Fallback: let Date parse and take UTC HH:MM (stable fallback)
        try {
          return new Date(isoLike).toISOString().slice(11, 16);
        } catch {
          return "00:00";
        }
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
      // Pass locked assignments to preserve them
      await clearPlan(day, undefined, Array.from(lockedAssignments));
      await loadAllAssignments();
      await loadWarnings(day);
      await loadDayRosterForWarnings(day);
    } catch (e: any) {
      alert(humanError(e, "Failed to delete plan for the day"));
    } finally {
      setBusy(false);
    }
  }

  async function loadAllAssignments(overrideDay?: string) {
    const targetDay = overrideDay ?? day;
    console.log(`[DEBUG] loadAllAssignments: targetDay=${targetDay}, overrideDay=${overrideDay}, current day=${day}`);
    setListBusy(true);
    try {
      const { data } = await api.get<FlatRosterResp>("/assignments/roster", {
        params: { day: targetDay },
      });
      console.log(`[DEBUG] loadAllAssignments: loaded ${data.items.length} items`);
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

    // We'll also figure out the target mission (id/name) for restriction checks
    let targetMissionId: number | null = null;
    let targetMissionName: string | null = null;

    if (pendingAssignmentId) {
      const target = rows.find(r => r.id === pendingAssignmentId);
      if (!target) return [];
      candStart = (target as any).start_epoch_ms ?? new Date(target.start_at).getTime();
      candEnd   = (target as any).end_epoch_ms   ?? new Date(target.end_at).getTime();

      targetMissionId = target.mission?.id ?? null;
      targetMissionName = target.mission?.name ?? null;
    } else if (pendingEmptySlot) {
      candStart = new Date(pendingEmptySlot.startLocalIso).getTime();
      candEnd   = new Date(pendingEmptySlot.endLocalIso).getTime();

      targetMissionId = pendingEmptySlot.missionId ?? null;
      if (targetMissionId != null) {
        const m = allMissions.find(mm => mm.id === targetMissionId);
        targetMissionName = m?.name ?? null;
      }
    } else {
      return [];
    }

    if (candStart == null || candEnd == null) return [];

    const existing = rowsForWarnings.filter(r => r.soldier_id === s.id);

    // 1) OVERLAP
    const hasOverlap = existing.some(r => {
      const sMs = (r as any).start_epoch_ms ?? new Date(r.start_at).getTime();
      const eMs = (r as any).end_epoch_ms   ?? new Date(r.end_at).getTime();
      return candStart! < eMs && candEnd! > sMs;
    });

    // 2) REST tiers
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

    if (hasOverlap) out.push({ text: "חפיפה", color: "red" });

    if (Number.isFinite(minPositiveGap)) {
      if (minPositiveGap < H8) out.push({ text: "מנוחה", color: "red" });
      else if (minPositiveGap < H16) out.push({ text: "מנוחה", color: "orange" });
    }

    // 3) RESTRICTED (orange) — based on the target mission of this slot
    if (isSoldierRestrictedForMission(s, targetMissionId, targetMissionName)) {
      out.push({ text: "מוגבל", color: "orange" });
    }

    return out;
  }

  function restTierForRow(row: FlatRosterItem): "red" | "orange" | "green" | null {
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
      const H8  = 8  * 60 * 60 * 1000;
      const H16 = 16 * 60 * 60 * 1000;
      const H20 = 20 * 60 * 60 * 1000;


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
      if (minGap > H20) return "green";
      return null;
    }

    // Compute gaps with immediate neighbors
    const cur = items[idx];
    const prev = items[idx - 1];
    const next = items[idx + 1];

    const H8  = 8 * 60 * 60 * 1000;
    const H16 = 16 * 60 * 60 * 1000;
    const H20 = 20 * 60 * 60 * 1000;

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
    if (minGap > H20) return "green";
    return null;
  }

  function pillItemsForRow(row: FlatRosterItem): Array<{ type: string; color?: "red" | "orange" | "gray" }> {
    if (!row.soldier_id) return [];

    const curStart = (row as any).start_epoch_ms ?? new Date(row.start_at).getTime();
    const curEnd   = (row as any).end_epoch_ms   ?? new Date(row.end_at).getTime();
    if (!(Number.isFinite(curStart) && Number.isFinite(curEnd))) return [];

    const mine = rowsForWarnings
      .filter(r => r.soldier_id === row.soldier_id)
      .map(r => ({
        id: r.id,
        s: (r as any).start_epoch_ms ?? new Date(r.start_at).getTime(),
        e: (r as any).end_epoch_ms   ?? new Date(r.end_at).getTime(),
      }))
      .filter(it => Number.isFinite(it.s) && Number.isFinite(it.e));

    const hasOverlap = mine.some(it => it.id !== row.id && curStart < it.e && curEnd > it.s);
    const tier = restTierForRow(row); // "red" | "orange" | "green" | null

    const out: Array<{ type: string; color?: "red" | "orange" | "gray" }> = [];
    if (hasOverlap) out.push({ type: "OVERLAP", color: "red" });
    if (tier === "red") out.push({ type: "REST", color: "red" });
    if (tier === "orange") out.push({ type: "REST", color: "orange" });

    return out;
  }

  // Replace your current getRestrictionRawList / getRestrictedMissionNames / getRestrictedMissionIds with this:

  function normalize(s?: string | null) {
    return (s || "").trim().toLowerCase();
  }

  function splitTokens(s: string): string[] {
    return s
      .replace(/;/g, ",")
      .split(",")
      .map(t => normalize(t))
      .filter(Boolean);
  }

  /** Collect restriction "atoms" from many shapes; split strings into tokens; include *_ids too. */
  function getRestrictionRawList(s?: Soldier | null): any[] {
    if (!s) return [];
    const out: any[] = [];

    const push = (v: any) => {
      if (v == null) return;
      if (Array.isArray(v)) {
        out.push(...v);
      } else if (typeof v === "string") {
        // split comma/semicolon strings into individual tokens
        out.push(...splitTokens(v));
      } else {
        out.push(v);
      }
    };

    // strings/arrays we may have
    push((s as any).restriction);
    push((s as any).restrictions);
    push((s as any).restrictions_tokens);       // already array of tokens
    push((s as any).restricted_missions);
    push((s as any).mission_restrictions);
    push((s as any).mission_restriction_ids);   // may be an array of numbers

    // nested object we've seen in a few shapes
    push((s as any).restrictions?.missions);

    return out;
  }

  function getRestrictedMissionNames(s?: Soldier | null): string[] {
    return getRestrictionRawList(s)
      .map(x => {
        if (!x) return "";
        if (typeof x === "string") return normalize(x);  // already split above
        if (typeof x === "object") {
          return normalize(
            (x as any).mission_name ??
            (x as any).name ??
            (x as any).mission?.name
          );
        }
        return "";
      })
      .filter(Boolean);
  }

  function getRestrictedMissionIds(s?: Soldier | null): number[] {
    return getRestrictionRawList(s)
      .map(x => {
        if (typeof x === "number") return x;
        if (typeof x === "string") {
          const n = Number(x);
          return Number.isFinite(n) ? n : null;
        }
        if (x && typeof x === "object") {
          const cand =
            (x as any).mission_id ??
            (x as any).missionId ??
            (x as any).mission?.id ??
            (x as any).id;
          const n = Number(cand);
          return Number.isFinite(n) ? n : null;
        }
        return null;
      })
      .filter((n): n is number => n != null);
  }

  /** True if the row's mission is restricted for its soldier (by name or id, id has fallback via allMissions). */
  function isRowRestricted(row: FlatRosterItem): boolean {
    if (!row?.soldier_id) return false;
    const s = soldiersById.get(row.soldier_id);
    if (!s) return false;

    const restrictedNames = getRestrictedMissionNames(s);
    const restrictedIds   = getRestrictedMissionIds(s);

    const missionName = normalize(row?.mission?.name ?? "");
    let missionId: number | null = row?.mission?.id ?? null;

    // If row has no id but soldier has id restrictions, derive id by name
    if (missionId == null && missionName && restrictedIds.length > 0) {
      const m = allMissions.find(mm => normalize(mm.name ?? "") === missionName);
      if (m?.id != null) missionId = m.id;
    }

    const nameHit = missionName && restrictedNames.includes(missionName);
    const idHit   = missionId != null && restrictedIds.includes(missionId);

    return !!(nameHit || idHit);
  }

  /** Extract a soldier's restricted mission names as lowercase strings. */
  function getRestrictedMissions(s?: Soldier | null): string[] {
    if (!s) return [];
    const any = (s as any).restriction ?? (s as any).restrictions ?? [];
    if (Array.isArray(any)) {
      // array of strings or objects
      return any
        .map((x) => {
          if (typeof x === "string") return normalize(x);
          if (x && typeof x === "object") {
            // common shapes: { mission_name: "Patrol" } or { name: "Patrol" }
            return normalize((x as any).mission_name ?? (x as any).name);
          }
          return "";
        })
        .filter(Boolean);
    }
    // single string
    if (typeof any === "string") return [normalize(any)];
    // single object
    if (any && typeof any === "object") {
      return [normalize((any as any).mission_name ?? (any as any).name)];
    }
    return [];
  }

  function isSoldierRestrictedForMission(
    s: Soldier,
    missionId?: number | null,
    missionName?: string | null
  ): boolean {
    const name = normalize(missionName);
    const ids = new Set(getRestrictedMissionIds(s));        // supports numeric IDs if present
    const names = new Set(getRestrictedMissionNames(s));    // supports objects/strings in various shapes

    // Also consider simple tokens returned by /soldiers (restrictions_tokens)
    const tokens = ((s as any).restrictions_tokens as string[] | undefined) || [];
    for (const t of tokens) names.add(normalize(t));

    // If we only have a name and no id, try to resolve id from allMissions
    let mid = missionId ?? null;
    if (mid == null && name) {
      const m = allMissions.find(mm => normalize(mm.name ?? "") === name);
      if (m?.id != null) mid = m.id;
    }

    // Match by id or name
    if (mid != null && ids.has(mid)) return true;
    if (name && names.has(name)) return true;

    return false;
  }

  async function openChangeModal(assignmentId: number, roleName: string | null) {
    if (locked) return;
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
    if (locked) return;
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
    // Handle empty slots (no pendingAssignmentId)
    if (!pendingAssignmentId && pendingEmptySlot) {
      setChangeLoading(true);
      setChangeError(null);
      try {
        // Parse the start/end times from the labels
        const startHHMM = pendingEmptySlot.startHHMM;
        const endHHMM = pendingEmptySlot.endHHMM;
        
        // Extract the day from the slot's start time (YYYY-MM-DD)
        const slotDay = pendingEmptySlot.startLocalIso.slice(0, 10);
        
        const mission = allMissions.find(m => m.id === pendingEmptySlot.missionId);
        if (!mission) {
          setChangeError("Mission not found");
          return;
        }

        console.log(`[DEBUG] Creating assignment:`, {
          day: slotDay,
          mission_id: pendingEmptySlot.missionId,
          role_id: pendingEmptySlot.roleId,
          start_time: startHHMM,
          end_time: endHHMM,
          soldier_id: soldierId,
        });

        const newAssignment = await createAssignment({
          day: slotDay,
          mission_id: pendingEmptySlot.missionId,
          role_id: pendingEmptySlot.roleId,
          start_time: startHHMM,
          end_time: endHHMM,
          soldier_id: soldierId,
        });

        console.log(`[DEBUG] Created assignment:`, newAssignment);

        // Refresh the entire list (use slotDay since we created the assignment for that day)
        await withPreservedScroll(async () => {
          await loadAllAssignments(slotDay);
          await loadWarnings(slotDay);
          await loadDayRosterForWarnings(slotDay);
        });

        setIsChangeOpen(false);
        setPendingAssignmentId(null);
        setPendingEmptySlot(null);
      } catch (e: any) {
        setChangeError(e?.response?.data?.detail ?? "Failed to assign");
      } finally {
        setChangeLoading(false);
      }
      return;
    }

    // Handle existing assignments (has pendingAssignmentId)
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
      await withPreservedScroll(async () => {
        await loadAllAssignments();
        // IMPORTANT: refresh warnings for the currently selected day
        await loadWarnings(day);
        await loadDayRosterForWarnings(day);
      });

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

      await withPreservedScroll(async () => {
        await loadAllAssignments();
        await loadWarnings(day);
        await loadDayRosterForWarnings(day);
      });


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
            // We'll keep a parallel map so we don't mutate Soldier type.
            (available as any)._markers = (available as any)._markers || new Map<number, { leavingToday: boolean; returningToday: boolean }>();
            (available as any)._markers.set(s.id, { leavingToday, returningToday });
            available.push(s);
          } else {
            onVacation.push({ soldier: s, leavingToday, returningToday });
          }
        }
      }

      // 5) Save to state
      // (we also keep assignedToday as a Set, but we'll recompute inside render from rowsForWarnings)
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
  function restTierForSoldier(dayISO: string, soldierId: number): "red" | "orange" | "green" | null {
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
    const H20 = 20 * 60 * 60 * 1000;

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
    if (minGap < H8) return "red";
    if (minGap < H16) return "orange";
    if (minGap > H20) return "green";
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

  // Convert a YYYY-MM-DD (local) + "HH:MM:SS" to epoch ms (local JS Date)
  function msFor(dayISO: string, hhmmss: string): number {
    const [y, m, d] = dayISO.split("-").map(Number);
    const [hh, mm] = hhmmss.slice(0, 5).split(":").map(Number);
    return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0).getTime();
  }

  // Overlap in ms between [aStart,aEnd) and [bStart,bEnd)
  function overlapMs(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
    const lo = Math.max(aStart, bStart);
    const hi = Math.min(aEnd, bEnd);
    return Math.max(0, hi - lo);
  }

  // Extract "HH:MM" from either "HH:MM:SS" or "YYYY-MM-DD HH:mm" or ISO string
  function hhmm(x: string | null | undefined): string | null {
    if (!x) return null;
    // If ISO or "YYYY-MM-DD HH:mm(:ss?)"
    if (x.length >= 16 && (x[4] === "-" || x[10] === " ")) {
      return x.slice(11, 16); // "HH:mm"
    }
    // If "HH:MM:SS"
    if (x.length >= 5 && x[2] === ":") {
      return x.slice(0, 5);
    }
    return null;
  }

  // Basic interval overlap check
  function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
    return aStart < bEnd && aEnd > bStart;
  }

  // Preserve page scroll while we do async refreshes that cause heavy re-rendering
  async function withPreservedScroll<T>(fn: () => Promise<T>): Promise<T> {
    const x = window.scrollX;
    const y = window.scrollY;
    try {
      const out = await fn();
      return out;
    } finally {
      // Restore on the next frame so layout is ready
      requestAnimationFrame(() => window.scrollTo(x, y));
    }
  }

  function nextDayISO(dayISO: string) {
    return shiftDay(dayISO, 1);
  }

  // Pretty-print a warning's time window by matching it to the configured MissionSlot for the selected day.
  // Falls back to APP_TZ formatting if no slot overlaps.
  function renderWarningTimeSlot(w: PlannerWarning): string {
    const mission = allMissions.find((m: Mission) => (m.name ?? "") === (w.mission_name ?? ""));
    if (!mission) {
      return `${fmtWarn(w.start_at)} → ${fmtWarn(w.end_at)}`;
    }

    const slots = slotsByMission.get(mission.id) || [];
    if (slots.length === 0) {
      return `${fmtWarn(w.start_at)} → ${fmtWarn(w.end_at)}`;
    }

    const wStartMs = new Date(w.start_at).getTime();
    const wEndMs   = new Date(w.end_at).getTime();

    let best: { startLabel: string; endLabel: string; ov: number } | null = null;

    for (const s of slots) {
      const endDayISO = isOvernight(s.start_time, s.end_time) ? nextDayISO(day) : day;

      const sStartMs = msFor(day, s.start_time);
      const sEndMs   = msFor(endDayISO, s.end_time);

      const ov = overlapMs(wStartMs, wEndMs, sStartMs, sEndMs);
      if (ov > 0 && (!best || ov > best.ov)) {
        best = {
          startLabel: labelFor(day, s.start_time),
          endLabel:   labelFor(endDayISO, s.end_time),
          ov
        };
      }
    }

    if (best) {
      return `${best.startLabel} → ${best.endLabel}`;
    }
    return `${fmtWarn(w.start_at)} → ${fmtWarn(w.end_at)}`;
  }

  const grouped: Grouped = useMemo(() => {
    const byMission = new Map<string, Map<string, { startLabel: string; endLabel: string; items: FlatRosterItem[] }>>();

    // 1) Seed all missions and their configured MissionSlots (labels always from MissionSlots)
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

        const dup = Array.from(slots.values()).some(v => v.startLabel === startLabel && v.endLabel === endLabel);
        if (dup) continue;

        const key = `seed__${missionName}__${startLabel}__${endLabel}`;
        if (!slots.has(key)) {
          slots.set(key, { startLabel, endLabel, items: [] });
        }
      }
    }

    // 2) Push existing rows into the single best-overlapping seeded slot for that mission
    for (const r of sortedRows) {
      const missionName = r.mission?.name ?? "";
      if (!byMission.has(missionName)) byMission.set(missionName, new Map());
      const slots = byMission.get(missionName)!;

      const rStartMs = epochMs(r.start_at, (r as any).start_epoch_ms);
      const rEndMs   = epochMs(r.end_at,   (r as any).end_epoch_ms);

      // Find this mission's configured slots
      const missionMeta = allMissions.find(mm => (mm.name ?? "") === missionName) || null;
      const missionSlots = missionMeta ? (slotsByMission.get(missionMeta.id) || []) : [];

      let bestKey: string | null = null;
      let bestOverlap = -1;

      for (const s of missionSlots) {
        const sStartMs = msFor(day, s.start_time);
        const sEndMs   = msFor(isOvernight(s.start_time, s.end_time) ? nextDayISO(day) : day, s.end_time);
        const ov = overlapMs(rStartMs, rEndMs, sStartMs, sEndMs);
        if (ov > bestOverlap) {
          const startLabel = labelFor(day, s.start_time);
          const endLabel   = labelFor(isOvernight(s.start_time, s.end_time) ? nextDayISO(day) : day, s.end_time);
          const seedKey    = `seed__${missionName}__${startLabel}__${endLabel}`;
          if (slots.has(seedKey)) {
            bestOverlap = ov;
            bestKey = seedKey;
          }
        }
      }

      // Only attach to a MissionSlot if there is any overlap (>0)
      if (bestKey && bestOverlap > 0) {
        slots.get(bestKey)!.items.push(r);
      }
      // IMPORTANT: no fallback that creates a display slot from the row window.
      // This guarantees the Time Slot column always uses MissionSlot labels.
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

      // Build slot array strictly from seeded slots (so labels are from MissionSlots)
      const entries = Array.from(slots.entries());
      // Optional: sort by startLabel/endLabel for stable ordering
      entries.sort(
        (a, b) =>
          a[1].startLabel.localeCompare(b[1].startLabel) ||
          a[1].endLabel.localeCompare(b[1].endLabel)
      );
      for (const [k, v] of entries) {
        slotArr.push({ key: k, startLabel: v.startLabel, endLabel: v.endLabel, items: v.items });
      }

      const meta = missionByName.get(m);
      const missionId = meta?.id ?? null;

      result.push({ missionId, missionName: m, slots: slotArr });
    }

    return result;
  }, [sortedRows, allMissions, slotsByMission, day]);

  // --- Warnings "Details" formatting helpers (fixed) ---

function hmFromMs(ms: number): string {
  try {
    // UTC slice, no TZ math
    return new Date(ms).toISOString().slice(11, 16);
  } catch {
    return "00:00";
  }
}

function ms(iso: string): number {
  return new Date(iso).getTime();
}

// Treat rows as the SAME assignment as the warning if they have (almost) identical window
function isSameAssignmentWindow(w: PlannerWarning, r: { s: number; e: number }): boolean {
  const wS = ms(w.start_at), wE = ms(w.end_at);
  const EPS = 60 * 1000; // 1 minute tolerance to avoid off-by-seconds
  return Math.abs(r.s - wS) < EPS && Math.abs(r.e - wE) < EPS;
}

function formatWarningDetails(w: PlannerWarning): string {
  const wStart = ms(w.start_at);
  const wEnd   = ms(w.end_at);

  // All rows for this soldier across prev/day/next
  const mine = rowsForWarnings
    .filter(r =>
      // match by id when we have it; fall back to name
      ((w as any).soldier_id != null ? r.soldier_id === (w as any).soldier_id : r.soldier_name === w.soldier_name)
    )
    .map(r => ({
      raw: r,
      s: (r as any).start_epoch_ms ?? ms(r.start_at),
      e: (r as any).end_epoch_ms   ?? ms(r.end_at),
    }))
    .filter(r => Number.isFinite(r.s) && Number.isFinite(r.e))
    .sort((a, b) => a.s - b.s);

  if (w.type === "OVERLAP") {
    // Find the OTHER assignment that overlaps this warning window the most
    let best: { raw: FlatRosterItem; s: number; e: number; ov: number } | null = null;
    for (const r of mine) {
      // skip the row that is effectively the same window as the warning itself
      if (isSameAssignmentWindow(w, r)) continue;

      const ov = Math.max(0, Math.min(wEnd, r.e) - Math.max(wStart, r.s));
      if (ov > 0 && (!best || ov > best.ov)) best = { ...r, ov };
    }

    if (best) {
      const otherMission = best.raw.mission?.name || "another mission";
      // End of the *overlap* window (this is what users expect to see)
      const overlapEndMs = Math.min(wEnd, best.e);
      return `Overlaps with ${otherMission} assignment`;
    }

    // fallback
    return w.details || "Overlaps with another assignment";
  }

  if (w.type === "REST") {
    // Compute the smallest non-negative gap adjacent to THIS warning window only
    const intervals = mine
      .map(r => ({ s: r.s, e: r.e }))
      .concat([{ s: wStart, e: wEnd }])
      .sort((a, b) => a.s - b.s);

    let minGap = Number.POSITIVE_INFINITY;
    for (let i = 0; i < intervals.length - 1; i++) {
      const gap = intervals[i + 1].s - intervals[i].e;
      if (gap >= 0 && gap < minGap) minGap = gap;
    }

    if (Number.isFinite(minGap)) {
      const totalMin = Math.max(0, Math.floor(minGap / 60000));
      const h = String(Math.floor(totalMin / 60)).padStart(2, "0");
      const m = String(totalMin % 60).padStart(2, "0");
      return `Rest between missions is ${h}:${m}`;
    }
    return w.details || "Rest between missions is 00:00";
  }

  return w.details || "";
}

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
                // Use total_needed from the Mission object (m.total_needed) as the primary source
                return [m.id, { total_needed: m.total_needed ?? null, requirements: r.requirements ?? [] }];
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

  useEffect(() => {
    try {
      localStorage.setItem("planner.lockedByDay", JSON.stringify(lockedByDay));
    } catch {
      // ignore persistence errors
    }
  }, [lockedByDay]);

  // Register sidebar actions
  useEffect(() => {
    setActions({
      currentDay: day,
      onDayChange: (newDay: string) => setDay(newDay),
      onFillPlan: () => runPlanner(),
      onShufflePlan: () => shufflePlanner(),
      onDeletePlan: () => deletePlanForDay(),
      onExportFile: () => exportCsv(),
      onAvailableSoldiers: () => openAvailableModal(),
      onLockToggle: () => {
        setLockedByDay(prev => ({ ...prev, [day]: !prev[day] }));
      },
    });
    return () => setActions({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setActions, day, lockedByDay]);

  useEffect(() => {
    try {
      const key = `planner.excludedSlots.${day}`;
      // Convert Set to Array for JSON serialization
      localStorage.setItem(key, JSON.stringify(Array.from(excludedSlots)));
    } catch {
      // ignore persistence errors
    }
  }, [excludedSlots, day]);

  useEffect(() => {
    try {
      const key = `planner.lockedAssignments.${day}`;
      // Convert Set to Array for JSON serialization
      localStorage.setItem(key, JSON.stringify(Array.from(lockedAssignments)));
    } catch {
      // ignore persistence errors
    }
  }, [lockedAssignments, day]);

  return (
    <div className="p-4 space-y-4">

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
        title={`חיילים זמינים — ${day}`}
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
                    זמין בתאריך {day} ({availSoldiers.length})
                  </h3>
                  {availSoldiers.length === 0 ? (
                    <div className="text-gray-500" style={{ marginBottom: 12 }}>
                      אין חיילים זמינים
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
                    בחופשה בתאריך {day} ({vacationSoldiers.length})
                  </h3>

                  {vacationSoldiers.length === 0 ? (
                    <div className="text-gray-500">אין חיילים בחופשה</div>
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
        <h2 style={{ marginBottom: 8 }}>התראות</h2>
        {warnLoading && <div>בטעינה...</div>}
        {!warnLoading && warnError && <div style={{ color: "crimson" }}>{warnError}</div>}
        {!warnLoading && !warnError && warnings.length === 0 && (
          <div style={{ opacity: 0.7 }}>(אין התראות)</div>
        )}
        {!warnLoading && !warnError && warnings.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th className="border p-2 text-left">סוג</th>
                  <th className="border p-2 text-left">חייל</th>
                  <th className="border p-2 text-left">משימה</th>
                  <th className="border p-2 text-left">חלון זמן</th>
                  <th className="border p-2 text-left">התראה</th>
                  <th className="border p-2 text-left">פרטים</th>
                </tr>
              </thead>
              <tbody>
                {warnings.map((w, i) => (
                  <tr key={i}>
                    <td className="border p-2">{w.type}</td>
                    <td className="border p-2">{w.soldier_name}</td>
                    <td className="border p-2">{w.mission_name}</td>
                    <td className="border p-2">{renderWarningTimeSlot(w)}</td>
                    <td className="border p-2">
                      {(() => {
                        const color =
                          w.level === "RED"
                            ? "red"
                            : w.level === "ORANGE"
                            ? "orange"
                            : w.type === "RESTRICTED"
                            ? "gray"
                            : undefined;
                        return <WarningsCell items={[{ type: w.type, color }]} />;
                      })()}
                    </td>
                    <td className="border p-2">{formatWarningDetails(w)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="space-y-2">
        <h2 className="font-medium">תכנית</h2>

        {listBusy && <div className="border rounded p-3 text-gray-500">בטעינה...</div>}

        {!listBusy && (
          <div className="border rounded overflow-x-auto">
            {/* If absolutely nothing to show (no missions/slots configured), show a tiny hint */}
            {grouped.every(g => g.slots.length === 0) ? (
              <div className="p-3 text-gray-500">No missions/slots configured for this day.</div>
            ) : (
              <>
                {/* your existing Modal and <table> stay exactly the same below */}
            <Modal open={isChangeOpen} onClose={() => setIsChangeOpen(false)} title="החלף חייל">
              {changeError && <div style={{ color: "red", marginBottom: 8 }}>{changeError}</div>}
              {changeLoading && <div>Applying change…</div>}
              {!changeLoading && (
                <div style={{ maxHeight: 360, overflowY: "auto" }}>
                  <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                    <input
                      type="text"
                      value={candidateSearch}
                      onChange={(e) => setCandidateSearch(e.target.value)}
                      placeholder="חפש חייל"
                      className="border rounded px-2 py-1 w-full"
                    />
                    {candidateSearch && (
                      <button
                        type="button"
                        onClick={() => setCandidateSearch("")}
                        className="border rounded px-2 py-1"
                        title="Clear search"
                      >
                        נקה
                      </button>
                    )}
                  </div>
                  {filteredCandidates.length === 0 && <div>אין חיילים</div>}
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
                                title={w.text === "מנוחה" ? (w.color === "red" ? "< 8 שעות" : "< 16 שעות") : w.text}
                              >
                                {w.text}
                              </span>
                            ))}
                          </span>
                        );
                      })()}
                    </span>
                    <button type="button" onClick={() => handleReassign(s.id)}>
                      שבץ
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
                    השאר ריק
                  </button>
                </div>
              )}
            </Modal>

            <table className="min-w-[760px] w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left p-2 border w-[220px]">משימה</th>
                  <th className="text-left p-2 border w-[260px]">חלון זמן</th>
                  <th className="text-left p-2 border w-[40px]">שבץ</th>
                  <th className="text-left p-2 border w-[40px]">נעל</th>
                  <th className="text-left p-2 border">תפקיד</th>
                  <th className="text-left p-2 border">חייל</th>
                  <th className="text-left p-2 border">התראות</th>
                </tr>
              </thead>
              <tbody>
                {grouped.map((g, gIdx) => (
                  <React.Fragment key={`g-${gIdx}`}>
                    {/* Mission divider (skip before the first mission) */}
                    {gIdx > 0 && (
                      <tr aria-hidden>
                        <td colSpan={7} style={{ padding: 0 }}>
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
                            <td colSpan={7} style={{ padding: 0 }}>
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

                      // EMPTY SLOT
                      if (rowsForSlot.length === 0) {
                        const reqMeta = g.missionId != null ? requirementsByMission.get(g.missionId) : undefined;
                        const reqs = reqMeta?.requirements ?? [];
                        const explicitCount = reqs.reduce((sum, r) => sum + reqCount(r), 0);
                        const totalNeeded = reqMeta?.total_needed ?? 0;
                        const genericSlots = Math.max(0, Number(totalNeeded) - Number(explicitCount));

                        // Build array of required roles (repeat each role based on its count)
                        const requiredSlots: Array<{ roleName: string | null; roleId: number | null; index: number }> = [];
                        
                        for (const r of reqs) {
                          const roleName = reqRoleName(r);
                          const roleId = reqRoleId(r);
                          const count = reqCount(r);
                          for (let i = 0; i < count; i++) {
                            requiredSlots.push({ roleName, roleId, index: i });
                          }
                        }
                        
                        // Add generic slots if needed
                        for (let i = 0; i < genericSlots; i++) {
                          requiredSlots.push({ roleName: null, roleId: null, index: i });
                        }
                        
                        // If no specific requirements, show one generic slot
                        if (requiredSlots.length === 0) {
                          requiredSlots.push({ roleName: guessRoleFromMissionName(g.missionName), roleId: null, index: 0 });
                        }

                        // Calculate row count for empty slots based on requiredSlots
                        const rowCount = requiredSlots.length || 1;

                        // missionCell and timeCell for empty slots
                        const missionCell = (
                          <td className="align-top p-2 border bg-gray-50" rowSpan={rowCount}>
                            <div className="font-semibold">{g.missionName || "—"}</div>
                          </td>
                        );

                        const timeCell = (
                          <td className="align-top p-2 border bg-gray-50" rowSpan={rowCount}>
                            <div className="text-xs text-gray-600">
                              {slot.startLabel} → {slot.endLabel}
                            </div>
                          </td>
                        );

                        return (
                          <React.Fragment key={slot.key}>
                            {slotDivider}
                            {requiredSlots.map((reqSlot, reqIdx) => {
                              const isFirstRow = reqIdx === 0;
                              
                              // Generate slot key for exclusion tracking
                              const missionSlots = slotsByMission.get(g.missionId || 0) || [];
                              let slotKey = `${g.missionId}_${reqSlot.roleId || 'GENERIC'}_${slot.startLabel}_${slot.endLabel}_${reqIdx}`;
                              if (missionSlots.length > sIdx) {
                                const missionSlot = missionSlots[sIdx];
                                const slotDay = day;
                                const startISO = `${slotDay}T${missionSlot.start_time}:00`;
                                const isOvernight = parseInt(missionSlot.start_time.split(':')[0]) >= parseInt(missionSlot.end_time.split(':')[0]);
                                const endDayISO = isOvernight ? shiftDay(day, 1) : day;
                                const endISO = `${endDayISO}T${missionSlot.end_time}:00`;
                                slotKey = `${g.missionId}_${reqSlot.roleId || 'GENERIC'}_${startISO}_${endISO}_${reqIdx}`;
                              }
                              const isExcluded = excludedSlots.has(slotKey);
                              
                              return (
                                <tr key={`${slot.key}-${reqIdx}`}>
                                  {isFirstRow && missionCell}
                                  {isFirstRow && timeCell}
                                  
                                  {/* Checkbox column */}
                                  <td className="p-2 border">
                                    <input
                                      type="checkbox"
                                      checked={isExcluded}
                                      onChange={(e) => {
                                        setExcludedSlots(prev => {
                                          const next = new Set(prev);
                                          if (e.target.checked) {
                                            next.add(slotKey);
                                          } else {
                                            next.delete(slotKey);
                                          }
                                          return next;
                                        });
                                      }}
                                    />
                                  </td>
                                  
                                  {/* Lock column - empty for unassigned slots */}
                                  <td className="p-2 border"></td>
                                  
                                  {/* Role column */}
                                  <td className="p-2 border">{reqSlot.roleName ?? ""}</td>
                                  
                                  {/* Soldier column */}
                                  <td className="p-2 border">
                                    <div className="flex items-center gap-2">
                                      <span className="italic text-gray-500" style={{ color: "crimson" }}>
                                        לא משובץ
                                      </span>

                                      <button
                                        type="button"
                                        className="border rounded px-2 py-1"
                                        disabled={locked}
                                        onClick={() =>
                                          g.missionId &&
                                          openChangeModalForEmptySlot(
                                            g.missionId,
                                            slot.startLabel,
                                            slot.endLabel,
                                            reqSlot.roleName,
                                            reqSlot.roleId
                                          )
                                        }
                                      >
                                        החלף
                                      </button>
                                    </div>
                                  </td>

                                  {/* Warnings column for empty slot */}
                                  <td className="p-2 border">{/* empty */}</td>
                                </tr>
                              );
                            })}
                          </React.Fragment>
                        );
                      }

                      // NON-EMPTY SLOT: Show assigned rows AND remaining empty slots
                      const reqMeta = g.missionId != null ? requirementsByMission.get(g.missionId) : undefined;
                      const reqs = reqMeta?.requirements ?? [];
                      const explicitCount = reqs.reduce((sum, r) => sum + reqCount(r), 0);
                      const totalNeeded = reqMeta?.total_needed ?? 0;
                      const genericSlots = Math.max(0, Number(totalNeeded) - Number(explicitCount));

                      // Build array of required roles (same as empty slot logic)
                      const requiredSlots: Array<{ roleName: string | null; roleId: number | null; index: number }> = [];
                      
                      for (const r of reqs) {
                        const roleName = reqRoleName(r);
                        const roleId = reqRoleId(r);
                        const count = reqCount(r);
                        for (let i = 0; i < count; i++) {
                          requiredSlots.push({ roleName, roleId, index: i });
                        }
                      }
                      
                      // Add generic slots if needed
                      for (let i = 0; i < genericSlots; i++) {
                        requiredSlots.push({ roleName: null, roleId: null, index: i });
                      }
                      
                      // If no specific requirements, show one generic slot
                      if (requiredSlots.length === 0) {
                        requiredSlots.push({ roleName: guessRoleFromMissionName(g.missionName), roleId: null, index: 0 });
                      }
                      
                      // Sort requiredSlots by role for stable row positions
                      // This ensures rows don't jump when assignments change
                      // The index field is preserved to maintain uniqueness in slot keys
                      requiredSlots.sort((a, b) => {
                        // Sort by roleName first, then by roleId
                        if (a.roleName !== b.roleName) {
                          if (a.roleName === null) return 1;
                          if (b.roleName === null) return -1;
                          return a.roleName.localeCompare(b.roleName);
                        }
                        if (a.roleId !== b.roleId) {
                          if (a.roleId === null) return 1;
                          if (b.roleId === null) return -1;
                          return a.roleId - b.roleId;
                        }
                        return a.index - b.index;
                      });

                      // Map existing assignments to their roles for efficient lookup
                      // Sort rowsForSlot by ID to ensure deterministic matching
                      const sortedRowsForSlot = [...rowsForSlot].sort((a, b) => a.id - b.id);
                      const assignmentByRoleId = new Map<number | null, FlatRosterItem>();
                      const assignmentByRoleName = new Map<string | null, FlatRosterItem>();
                      for (const r of sortedRowsForSlot) {
                        // Try to get role_id from the assignment (it might be in the API response even if not in the type)
                        const roleId = (r as any).role_id;
                        if (roleId != null) {
                          assignmentByRoleId.set(roleId, r);
                        }
                        if (r.role) {
                          assignmentByRoleName.set(r.role, r);
                        }
                      }

                      // Build complete list: required slots, marked as assigned or unassigned
                      // Track which assignments we've already used to avoid duplicates
                      const usedAssignmentIds = new Set<number>();
                      // Track assignments per role to ensure stable matching
                      const assignmentsByRoleIdList = new Map<number | null, FlatRosterItem[]>();
                      const assignmentsByRoleNameList = new Map<string | null, FlatRosterItem[]>();
                      for (const r of sortedRowsForSlot) {
                        const roleId = (r as any).role_id;
                        if (roleId != null) {
                          const list = assignmentsByRoleIdList.get(roleId) || [];
                          list.push(r);
                          assignmentsByRoleIdList.set(roleId, list);
                        }
                        if (r.role) {
                          const list = assignmentsByRoleNameList.get(r.role) || [];
                          list.push(r);
                          assignmentsByRoleNameList.set(r.role, list);
                        }
                      }
                      // Sort all lists by assignment ID for stable matching
                      for (const list of assignmentsByRoleIdList.values()) {
                        list.sort((a, b) => a.id - b.id);
                      }
                      for (const list of assignmentsByRoleNameList.values()) {
                        list.sort((a, b) => a.id - b.id);
                      }
                      
                      const completeRows: Array<{ 
                        requiredSlot: { roleName: string | null; roleId: number | null; index: number };
                        assignment: FlatRosterItem | null;
                        slotIndex: number;
                      }> = requiredSlots.map((reqSlot, slotIndex) => {
                        // Try to find matching assignment by roleId or roleName
                        let assignment: FlatRosterItem | null = null;
                        if (reqSlot.roleId != null) {
                          // Get ALL assignments for this role, sorted by ID for stability
                          const candidates = (assignmentsByRoleIdList.get(reqSlot.roleId) || []).filter(r => !usedAssignmentIds.has(r.id));
                          if (candidates.length > 0) {
                            assignment = candidates[0]; // Already sorted by ID
                            usedAssignmentIds.add(assignment.id);
                          }
                        }
                        if (!assignment && reqSlot.roleName != null) {
                          // Get ALL assignments for this role name, sorted by ID for stability
                          const candidates = (assignmentsByRoleNameList.get(reqSlot.roleName) || []).filter(r => !usedAssignmentIds.has(r.id));
                          if (candidates.length > 0) {
                            assignment = candidates[0]; // Already sorted by ID
                            usedAssignmentIds.add(assignment.id);
                          }
                        }
                        // For generic slots (roleId and roleName both null), try to find any available assignment
                        if (!assignment && reqSlot.roleId === null && reqSlot.roleName === null) {
                          // Find the first unused assignment in this slot (already sorted by ID)
                          const candidate = sortedRowsForSlot.find(r => !usedAssignmentIds.has(r.id));
                          if (candidate) {
                            assignment = candidate;
                            usedAssignmentIds.add(candidate.id);
                          }
                        }
                        return { requiredSlot: reqSlot, assignment, slotIndex };
                      });

                      const totalRowCount = completeRows.length || 1;

                      // missionCell and timeCell for non-empty slots
                      const nonEmptyMissionCell = (
                        <td className="align-top p-2 border bg-gray-50" rowSpan={totalRowCount}>
                          <div className="font-semibold">{g.missionName || "—"}</div>
                        </td>
                      );

                      const nonEmptyTimeCell = (
                        <td className="align-top p-2 border bg-gray-50" rowSpan={totalRowCount}>
                          <div className="text-xs text-gray-600">
                            {slot.startLabel} → {slot.endLabel}
                          </div>
                        </td>
                      );

                      return (
                        <React.Fragment key={slot.key}>
                          {slotDivider}
                          {completeRows.map((rowData) => {
                            const { requiredSlot, assignment, slotIndex } = rowData;
                            
                            // Create a unique key for this slot using mission slot times AND slot index
                            // The slotIndex ensures each slot within the same time window is unique and stable
                            // Use mission slot times (not assignment times) to keep keys stable across reloads
                            const slotKey = (() => {
                              // Get the actual ISO times from mission slots (same for assigned and empty slots)
                              const missionSlots = slotsByMission.get(g.missionId || 0) || [];
                              if (missionSlots.length > sIdx) {
                                const missionSlot = missionSlots[sIdx];
                                const slotDay = day;
                                const startISO = `${slotDay}T${missionSlot.start_time}:00`;
                                const isOvernight = parseInt(missionSlot.start_time.split(':')[0]) >= parseInt(missionSlot.end_time.split(':')[0]);
                                const endDayISO = isOvernight ? shiftDay(day, 1) : day;
                                const endISO = `${endDayISO}T${missionSlot.end_time}:00`;
                                // Use slotIndex to make each role slot unique within the same time window (stable across reorderings)
                                return `${g.missionId}_${requiredSlot.roleId || 'GENERIC'}_${startISO}_${endISO}_${slotIndex}`;
                              }
                              // Fallback if no slot data
                              return `${g.missionId}_${requiredSlot.roleId || 'GENERIC'}_${slot.startLabel}_${slot.endLabel}_${slotIndex}`;
                            })();
                            const isExcluded = excludedSlots.has(slotKey);
                            
                            if (!assignment) {
                              // This required slot is unassigned
                              return (
                                <tr key={`${slot.key}-${slotIndex}`}>
                                {slotIndex === 0 && nonEmptyMissionCell}
                                {slotIndex === 0 && nonEmptyTimeCell}
                                <td className="p-2 border">
                                  <input
                                    type="checkbox"
                                    checked={isExcluded}
                                    onChange={(e) => {
                                      setExcludedSlots(prev => {
                                        const next = new Set(prev);
                                        if (e.target.checked) {
                                          next.add(slotKey);
                                        } else {
                                          next.delete(slotKey);
                                        }
                                        return next;
                                      });
                                    }}
                                  />
                                </td>
                                <td className="p-2 border">{/* Lock column - empty for unassigned slots */}</td>
                                <td className="p-2 border">{requiredSlot.roleName ?? ""}</td>
                                  <td className="p-2 border">
                                    <div className="flex items-center gap-2">
                                      <span className="italic text-gray-500" style={{ color: "crimson" }}>
                                        לא משובץ
                                      </span>
                                      <button
                                        type="button"
                                        className="border rounded px-2 py-1"
                                        disabled={locked}
                                        onClick={() =>
                                          g.missionId &&
                                          openChangeModalForEmptySlot(
                                            g.missionId,
                                            slot.startLabel,
                                            slot.endLabel,
                                            requiredSlot.roleName,
                                            requiredSlot.roleId
                                          )
                                        }
                                      >
                                        החלף
                                      </button>
                                    </div>
                                  </td>
                                  <td className="p-2 border">{/* empty */}</td>
                                </tr>
                              );
                            }
                            
                            // This is an assigned slot
                            const r = assignment;
                            // ⛳ ANCHOR: merge RESTRICTED pill into Assignments->Warnings
                            const apiWarnings = warningsByAssignmentId.get(r.id) || [];

                            const coloredApi: Array<{ type: string; color?: "red" | "orange" | "gray" }> =
                              apiWarnings.map((w) => {
                                const levelColor =
                                  w.level === "RED" ? "red" : w.level === "ORANGE" ? "orange" : undefined;
                                return {
                                  type: w.type,
                                  // RESTRICTED stays gray; otherwise use level when present
                                  color: w.type === "RESTRICTED" ? "gray" : levelColor,
                                };
                              });

                            // if there are API pills we use them; if not, we fall back to local overlap/rest
                            const basePills =
                              coloredApi.length > 0 ? coloredApi : pillItemsForRow(r);
                            // add RESTRICTED (orange) if the soldier is restricted for this mission
                            const restrictedPill = isRowRestricted(r)
                              ? [{ type: "RESTRICTED", color: "orange" } as const]
                              : [];

                            // final set (WarningsCell already dedups)
                            const pillItems = [...basePills, ...restrictedPill];

                            return (
                              <tr key={`${slot.key}-${slotIndex}`}>
                                {slotIndex === 0 && nonEmptyMissionCell}
                                {slotIndex === 0 && nonEmptyTimeCell}
                                <td className="p-2 border">
                                  <input
                                    type="checkbox"
                                    checked={isExcluded}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        // When checking exclusion, uncheck lock
                                        setLockedAssignments(prev => {
                                          const next = new Set(prev);
                                          next.delete(r.id);
                                          return next;
                                        });
                                        setExcludedSlots(prev => {
                                          const next = new Set(prev);
                                          next.add(slotKey);
                                          return next;
                                        });
                                      } else {
                                        setExcludedSlots(prev => {
                                          const next = new Set(prev);
                                          next.delete(slotKey);
                                          return next;
                                        });
                                      }
                                    }}
                                  />
                                </td>
                                <td className="p-2 border">
                                  <input
                                    type="checkbox"
                                    checked={lockedAssignments.has(r.id)}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        // When checking lock, uncheck exclusion
                                        setExcludedSlots(prev => {
                                          const next = new Set(prev);
                                          next.delete(slotKey);
                                          return next;
                                        });
                                        setLockedAssignments(prev => {
                                          const next = new Set(prev);
                                          next.add(r.id);
                                          return next;
                                        });
                                      } else {
                                        setLockedAssignments(prev => {
                                          const next = new Set(prev);
                                          next.delete(r.id);
                                          return next;
                                        });
                                      }
                                    }}
                                  />
                                </td>
                                <td className="p-2 border">{r.role ?? ""}</td>
                                <td className="border">
                                  <div className="flex items-center gap-2">
                                    {(() => {
                                      if (!r.soldier_id || !r.soldier_name) {
                                        return <span style={{ color: "crimson" }}>לא משובץ</span>;
                                      }
                                      const tier = restTierForRow(r);
                                      const style =
                                        tier === "red"
                                          ? { color: "crimson", fontWeight: 600 }
                                          : tier === "orange"
                                          ? { color: "#d97706", fontWeight: 600 }
                                          : tier === "green"
                                          ? { color: "#15803d", fontWeight: 600 }
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
                                      onClick={() => openChangeModal(r.id, r.role)}
                                      className="border rounded px-2 py-1"
                                    >
                                      החלף
                                    </button>
                                  </div>
                                </td>
                                <td className="p-2 border">
                                  <WarningsCell items={pillItems} />
                                </td>
                              </tr>
                            );
                          })}
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
