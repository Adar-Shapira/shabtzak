import { useEffect, useMemo, useState } from "react";
import { api } from "../api";

type Mission = {
  id: number;
  name: string;
  start_hour: string; // "HH:MM:SS"
  end_hour: string;   // "HH:MM:SS"
  required_soldiers: number;
  required_commanders: number;
  required_officers: number;
  required_drivers: number;
};

type RosterResp = {
  mission: { id: number; name: string; start_at: string; end_at: string };
  assigned: { id: number; soldier_id: number; name: string; role: string | null }[];
  still_needed: { officers: number; commanders: number; drivers: number; soldiers: number };
};

type AvailableResp = {
  available: { id: number; name: string; role: string | null }[];
  skipped?: { id: number; name: string; reason: string }[];
};

export default function AssignmentsPage() {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [missionId, setMissionId] = useState<number | "">("");
  const [day, setDay] = useState<string>(today);

  const [error, setError] = useState<string | null>(null);

  // Roster
  const [roster, setRoster] = useState<RosterResp | null>(null);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterErr, setRosterErr] = useState<string | null>(null);

  // Available
  const [avail, setAvail] = useState<AvailableResp | null>(null);
  const [availLoading, setAvailLoading] = useState(false);
  const [availErr, setAvailErr] = useState<string | null>(null);

  // Load missions for dropdown
  useEffect(() => {
    (async () => {
      try {
        const res = await api.get<Mission[]>("/missions");
        setMissions(res.data);
      } catch (e: any) {
        setError(e?.response?.data?.detail ?? "Failed to load missions");
      }
    })();
  }, []);

  const fetchRoster = async () => {
    if (!missionId || !day) return;
    setRosterLoading(true);
    setRosterErr(null);
    setRoster(null);
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

  const fetchAvailable = async () => {
    if (!missionId || !day) return;
    setAvailLoading(true);
    setAvailErr(null);
    setAvail(null);
    try {
      const res = await api.get<AvailableResp>("/assignments/available", {
        params: { mission_id: missionId, day, debug: 1 },
      });
      setAvail(res.data);
    } catch (e: any) {
      const d = e?.response?.data?.detail;
      setAvailErr(typeof d === "string" ? d : JSON.stringify(d ?? "Failed to load available"));
    } finally {
      setAvailLoading(false);
    }
  };

  const onSelectContextChange = () => {
    // When mission/day changes, refresh both panes
    fetchRoster();
    fetchAvailable();
  };

  useEffect(() => { onSelectContextChange(); }, [missionId, day]);

  const assignSoldier = async (soldierId: number) => {
    if (!missionId || !day) return;
    try {
      await api.post("/assignments", {
        mission_id: missionId,
        soldier_id: soldierId,
        day,
      });
      await Promise.all([fetchRoster(), fetchAvailable()]);
    } catch (e: any) {
      const d = e?.response?.data?.detail;
      alert(typeof d === "string" ? d : JSON.stringify(d ?? "Failed to create assignment"));
    }
  };

  const deleteAssignment = async (assignmentId: number) => {
    try {
      await api.delete(`/assignments/${assignmentId}`);
      await Promise.all([fetchRoster(), fetchAvailable()]);
    } catch (e: any) {
      const d = e?.response?.data?.detail;
      alert(typeof d === "string" ? d : "Failed to delete assignment");
    }
  };

  const clearRoster = async () => {
    if (!missionId || !day) return;
    try {
      await api.post("/assignments/clear", { mission_id: missionId, day });
      await Promise.all([fetchRoster(), fetchAvailable()]);
    } catch (e: any) {
      const d = e?.response?.data?.detail;
      alert(typeof d === "string" ? d : "Failed to clear roster");
    }
  };

  return (
    <div style={{ maxWidth: 1100, margin: "24px auto", padding: 16, fontFamily: "sans-serif" }}>
      <h1>Assignments</h1>

      {/* Context selectors */}
      <section style={{ marginBottom: 16, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <label style={{ display: "block", fontSize: 12, color: "#555" }}>Mission</label>
          <select
            value={missionId}
            onChange={(e) => setMissionId(e.target.value ? Number(e.target.value) : "")}
            style={{ minWidth: 220 }}
          >
            <option value="">(choose mission)</option>
            {missions.map(m => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.start_hour.slice(0,5)}–{m.end_hour.slice(0,5)})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={{ display: "block", fontSize: 12, color: "#555" }}>Day</label>
          <input type="date" value={day} onChange={(e)=>setDay(e.target.value)} />
        </div>
        <button onClick={onSelectContextChange}>Refresh</button>
        <button onClick={clearRoster} disabled={!missionId}>Clear roster</button>
      </section>

      {error && <div style={{ color: "crimson", marginBottom: 12 }}>{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Roster (assigned) */}
        <section style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
          <h2 style={{ marginTop: 0 }}>Roster</h2>
          {rosterLoading && <div>Loading roster…</div>}
          {rosterErr && <div style={{ color: "crimson", marginBottom: 8 }}>{rosterErr}</div>}
          {roster && (
            <>
              <div style={{ fontSize: 13, marginBottom: 8, color: "#555" }}>
                Window: {new Date(roster.mission.start_at).toLocaleString()} — {new Date(roster.mission.end_at).toLocaleString()}
              </div>
              <table width="100%" cellPadding={8} style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th align="left">Name</th>
                    <th align="left">Role</th>
                    <th align="left">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {roster.assigned.length === 0 && (
                    <tr><td colSpan={3} style={{ opacity: 0.7 }}>(no one assigned)</td></tr>
                  )}
                  {roster.assigned.map(a => (
                    <tr key={a.id} style={{ borderTop: "1px solid #eee" }}>
                      <td>{a.name}</td>
                      <td>{a.role ?? "Soldier"}</td>
                      <td>
                        <button onClick={() => deleteAssignment(a.id)}>Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
                <div style={{ background: "#fafafa", padding: 8, borderRadius: 6, border: "1px solid #eee" }}>
                  Still Officers: <b>{roster.still_needed.officers}</b>
                </div>
                <div style={{ background: "#fafafa", padding: 8, borderRadius: 6, border: "1px solid #eee" }}>
                  Still Commanders: <b>{roster.still_needed.commanders}</b>
                </div>
                <div style={{ background: "#fafafa", padding: 8, borderRadius: 6, border: "1px solid #eee" }}>
                  Still Drivers: <b>{roster.still_needed.drivers}</b>
                </div>
                <div style={{ background: "#fafafa", padding: 8, borderRadius: 6, border: "1px solid #eee" }}>
                  Still Soldiers: <b>{roster.still_needed.soldiers}</b>
                </div>
              </div>
            </>
          )}
        </section>

        {/* Available + Skipped */}
        <section style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
          <h2 style={{ marginTop: 0 }}>Available</h2>
          {availLoading && <div>Loading available…</div>}
          {availErr && <div style={{ color: "crimson", marginBottom: 8 }}>{availErr}</div>}
          {avail && (
            <>
              <table width="100%" cellPadding={8} style={{ borderCollapse: "collapse", marginBottom: 12 }}>
                <thead>
                  <tr>
                    <th align="left">Name</th>
                    <th align="left">Role</th>
                    <th align="left">Assign</th>
                  </tr>
                </thead>
                <tbody>
                  {avail.available.length === 0 && (
                    <tr><td colSpan={3} style={{ opacity: 0.7 }}>(no one available)</td></tr>
                  )}
                  {avail.available.map(s => (
                    <tr key={s.id} style={{ borderTop: "1px solid #eee" }}>
                      <td>{s.name}</td>
                      <td>{s.role ?? "Soldier"}</td>
                      <td>
                        <button onClick={() => assignSoldier(s.id)}>Assign</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <h3 style={{ marginTop: 0 }}>Skipped (debug)</h3>
              <table width="100%" cellPadding={8} style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th align="left">Name</th>
                    <th align="left">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {!avail.skipped || avail.skipped.length === 0 ? (
                    <tr><td colSpan={2} style={{ opacity: 0.7 }}>(none)</td></tr>
                  ) : (
                    avail.skipped.map(s => (
                      <tr key={s.id} style={{ borderTop: "1px solid #eee" }}>
                        <td>{s.name}</td>
                        <td>{s.reason}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
