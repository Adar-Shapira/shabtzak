// shabtzak-ui/src/pages/Planner.tsx
import { useMemo, useState } from "react";
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

type RosterItem = {
  id: number;
  soldier_id: number;
  soldier_name: string;
  start_at: string; // ISO
  end_at: string;   // ISO
};

type RosterResp = {
  mission: { id: number; name: string };
  day: string;
  items: RosterItem[];
};

export default function Planner() {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [day, setDay] = useState<string>(today);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<PlanResultItem[] | null>(null);

  const [rosterMissionId, setRosterMissionId] = useState<number | null>(null);
  const [roster, setRoster] = useState<RosterResp | null>(null);
  const [rosterBusy, setRosterBusy] = useState(false);

  async function runPlanner() {
    setBusy(true);
    setResults(null);
    try {
      const { data } = await api.post<PlanFillResponse>("/plan/fill", { day });
      setResults(data.results);
    } catch (e: any) {
      const msg =
        e?.response?.data?.detail ??
        e?.message ??
        "Planner failed";
      alert(String(msg));
    } finally {
      setBusy(false);
    }
  }

  async function viewRoster(missionId: number) {
    setRosterBusy(true);
    setRoster(null);
    setRosterMissionId(missionId);
    try {
      const { data } = await api.get<RosterResp>("/assignments/roster", {
        params: { mission_id: missionId, day },
      });
      setRoster(data);
    } catch (e: any) {
      const d = e?.response?.data?.detail;
      alert(typeof d === "string" ? d : "Failed to load roster");
    } finally {
      setRosterBusy(false);
    }
  }

  async function clearRoster(missionId: number) {
    if (!confirm("Delete all assignments for this mission on the selected day?")) {
      return;
    }
    try {
      await api.post("/assignments/clear", { mission_id: missionId, day });
      if (rosterMissionId === missionId) {
        await viewRoster(missionId);
      }
      // refresh results view numbers if present
      await runPlannerPreview(); // optional soft refresh
    } catch (e: any) {
      const d = e?.response?.data?.detail;
      alert(typeof d === "string" ? d : "Failed to clear roster");
    }
  }

  async function runPlannerPreview() {
    // optional: call /plan/fill but ignore DB writes — not implemented on server.
    // For now, just do nothing. This is here so the UI code path remains clean.
    return;
  }

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
          <h2 className="font-medium">Results</h2>
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
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => viewRoster(r.mission.id)}
                    className="border rounded px-2 py-1 hover:bg-gray-50"
                  >
                    View roster
                  </button>
                  <button
                    onClick={() => clearRoster(r.mission.id)}
                    className="border rounded px-2 py-1 hover:bg-gray-50"
                  >
                    Clear day
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {rosterMissionId && (
        <div className="space-y-2">
          <h2 className="font-medium">Roster</h2>
          {rosterBusy && <div className="text-sm text-gray-500">Loading roster…</div>}
          {!rosterBusy && roster && (
            <div className="border rounded overflow-x-auto">
              <table className="min-w-[600px] w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left p-2">Soldier</th>
                    <th className="text-left p-2">Start</th>
                    <th className="text-left p-2">End</th>
                  </tr>
                </thead>
                <tbody>
                  {roster.items.length === 0 && (
                    <tr>
                      <td className="p-2 text-gray-500" colSpan={3}>
                        No assignments for {roster.mission.name} on {roster.day}
                      </td>
                    </tr>
                  )}
                  {roster.items.map((it) => (
                    <tr key={it.id} className="border-t">
                      <td className="p-2">{it.soldier_name}</td>
                      <td className="p-2">{new Date(it.start_at).toLocaleString()}</td>
                      <td className="p-2">{new Date(it.end_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
