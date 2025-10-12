// src/pages/Planner.tsx
import { useMemo, useState } from "react";
import { api } from "../api";

type PlanResultItem = {
  mission: { id: number; name: string };
  created_count?: number;
  error?: unknown;
};

type PlanFillResponse = {
  day: string;
  results: PlanResultItem[];
};

type RosterResp = {
  mission: { id: number; name: string; start_at: string; end_at: string };
  assigned: { id: number; soldier_id: number; name: string; role: string | null }[];
  still_needed: { officers: number; commanders: number; drivers: number; soldiers: number };
};

export default function PlannerPage() {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [day, setDay] = useState(today);
  const [acceptPartial, setAcceptPartial] = useState(true);
  const [maxPerMission, setMaxPerMission] = useState<string>("");

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PlanFillResponse | null>(null);

  // roster viewer state
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterErr, setRosterErr] = useState<string | null>(null);
  const [roster, setRoster] = useState<RosterResp | null>(null);
  const [rosterMissionId, setRosterMissionId] = useState<number | null>(null);

  const runPlanner = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    setRoster(null);
    setRosterMissionId(null);

    try {
      const payload: any = {
        day,
        accept_partial: acceptPartial,
      };
      if (maxPerMission.trim() !== "") {
        payload.max_per_mission = Number(maxPerMission);
      }

      const res = await api.post<PlanFillResponse>("/plan/fill", payload);
      setResult(res.data);
    } catch (e: any) {
      const d = e?.response?.data?.detail;
      setError(typeof d === "string" ? d : JSON.stringify(d ?? "Planner failed"));
    } finally {
      setRunning(false);
    }
  };

  const viewRoster = async (missionId: number) => {
    setRosterLoading(true);
    setRosterErr(null);
    setRoster(null);
    setRosterMissionId(missionId);
    try {
      const res = await api.get<RosterResp>("/assignments/roster", {
        params: { mission_id: missionId, day },
      });
      setRoster(res.data);
    } catch (e: any) {
      const d = e?.response?.data?.detail;
      setRosterErr(typeof d === "string" ? d : JSON.stringify(d ?? "Failed to load roster"));
    } finally {
      setRosterLoading(false);
    }
  };

  const clearRoster = async (missionId: number) => {
    // POST /assignments/clear { mission_id, day }
    try {
      await api.post("/assignments/clear", { mission_id: missionId, day });
      // refresh roster if open
      if (rosterMissionId === missionId) {
        await viewRoster(missionId);
      }
    } catch (e: any) {
      const d = e?.response?.data?.detail;
      alert(typeof d === "string" ? d : "Failed to clear roster");
    }
  };

  return (
    <div style={{ maxWidth: 1000, margin: "24px auto", padding: 16, fontFamily: "sans-serif" }}>
      <h1>Planner</h1>

      <section style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <label style={{ display: "block", fontSize: 12, color: "#555" }}>Day</label>
            <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={acceptPartial}
              onChange={(e) => setAcceptPartial(e.target.checked)}
            />
            Accept partial
          </label>
          <div>
            <label style={{ display: "block", fontSize: 12, color: "#555" }}>Max per mission (optional)</label>
            <input
              type="number"
              min={0}
              value={maxPerMission}
              onChange={(e) => setMaxPerMission(e.target.value)}
              placeholder="e.g. 3"
              style={{ width: 120 }}
            />
          </div>
          <button onClick={runPlanner} disabled={running}>
            {running ? "Planning…" : "Run Planner"}
          </button>
        </div>
      </section>

      {error && <div style={{ color: "crimson", marginBottom: 12 }}>{error}</div>}

      {/* Results summary */}
      {result && (
        <section style={{ marginTop: 8 }}>
          <h2>Results for {result.day}</h2>
          {result.results.length === 0 ? (
            <div style={{ opacity: 0.7 }}>No missions found.</div>
          ) : (
            <table width="100%" cellPadding={8} style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th align="left">Mission</th>
                  <th align="left">Outcome</th>
                  <th align="left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {result.results.map((r, i) => (
                  <tr key={i} style={{ borderTop: "1px solid #ddd" }}>
                    <td>{r.mission.name}</td>
                    <td>
                      {"created_count" in r
                        ? `Created ${r.created_count} assignment(s)`
                        : r.error
                          ? (typeof r.error === "string" ? r.error : JSON.stringify(r.error))
                          : "—"}
                    </td>
                    <td style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => viewRoster(r.mission.id)}>View roster</button>
                      <button onClick={() => clearRoster(r.mission.id)}>Clear roster</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {/* Roster viewer */}
      {rosterMissionId && (
        <section style={{ marginTop: 24, borderTop: "1px solid #eee", paddingTop: 16 }}>
          <h2>
            Roster — {roster?.mission?.name ?? `Mission #${rosterMissionId}`} ({day})
          </h2>
          {rosterLoading && <div>Loading roster…</div>}
          {rosterErr && <div style={{ color: "crimson", marginBottom: 8 }}>{rosterErr}</div>}
          {roster && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, maxWidth: 640, marginBottom: 12 }}>
                <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
                  <h3 style={{ marginTop: 0 }}>Assigned</h3>
                  {roster.assigned.length === 0 ? (
                    <div style={{ opacity: 0.7 }}>(none)</div>
                  ) : (
                    <ul>
                      {roster.assigned.map(a => (
                        <li key={a.id}>
                          {a.name} {a.role ? `— ${a.role}` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
                  <h3 style={{ marginTop: 0 }}>Still Needed</h3>
                  <ul>
                    <li>Officers: {roster.still_needed.officers}</li>
                    <li>Commanders: {roster.still_needed.commanders}</li>
                    <li>Drivers: {roster.still_needed.drivers}</li>
                    <li>Soldiers: {roster.still_needed.soldiers}</li>
                  </ul>
                </div>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
