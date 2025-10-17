// shabtzak-ui/src/pages/Planner.tsx
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";

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

function fmt(dtIso: string) {
  try {
    const d = new Date(dtIso); // ISO from backend (UTC)
    return new Intl.DateTimeFormat(undefined, {
      timeZone: APP_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(d);
  } catch {
    return dtIso;
  }
}

function fmtLocal(localIso: string | undefined, utcIso: string) {
  // Prefer server-made local string (already correct & stable)
  if (localIso) return localIso.replace("T", " ");
  // Fallback: format UTC ISO using configured TZ (edge deployments)
  try {
    const d = new Date(utcIso);
    return new Intl.DateTimeFormat(undefined, {
      timeZone: APP_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(d);
  } catch {
    return utcIso;
  }
}


export default function Planner() {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [day, setDay] = useState<string>(today);

  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<PlanResultItem[] | null>(null);

  const [listBusy, setListBusy] = useState(false);
  const [rows, setRows] = useState<FlatRosterItem[]>([]);

  async function runPlanner() {
    setBusy(true);
    setResults(null);
    try {
      const { data } = await api.post<PlanFillResponse>("/plan/fill", { day, replace: true });
      setResults(data.results);
      await loadAllAssignments();
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

      <div className="space-y-2">
        <h2 className="font-medium">Assignments</h2>
        <div className="border rounded overflow-x-auto">
          <table className="min-w-[720px] w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-2 border">Mission</th>
                <th className="text-left p-2 border">Role</th>
                <th className="text-left p-2 border">Soldier</th>
                <th className="text-left p-2 border">Start</th>
                <th className="text-left p-2 border">End</th>
              </tr>
            </thead>
            <tbody>
              {listBusy && (
                <tr>
                  <td className="p-2 text-gray-500" colSpan={5}>Loading…</td>
                </tr>
              )}
              {!listBusy && rows.length === 0 && (
                <tr>
                  <td className="p-2 text-gray-500" colSpan={5}>
                    No assignments for the selected day.
                  </td>
                </tr>
              )}
              {!listBusy &&
                sortedRows.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="p-2">{r.mission?.name ?? ""}</td>
                    <td className="p-2">{r.role ?? ""}</td>
                    <td className="p-2">{r.soldier_name}</td>
                    <td className="p-2">{fmtLocal(r.start_local, r.start_at)}</td>
                    <td className="p-2">{fmtLocal(r.end_local, r.end_at)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
