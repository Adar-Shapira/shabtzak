// shabtzak-ui/src/pages/Missions.tsx
import { Fragment, useEffect, useState } from "react";
import { api } from "../api";
import Modal from "../components/Modal";
import { useDisclosure } from "../hooks/useDisclosure";
import { listMissionSlots, createMissionSlot, deleteMissionSlot, type MissionSlot } from "../api";

type Mission = {
  id: number;
  name: string;
  start_time?: string | null;
  end_time?: string | null;
  required_soldiers: number;
  required_commanders: number;
  required_officers: number;
  required_drivers: number;
};

export default function MissionsPage() {
  const [rows, setRows] = useState<Mission[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // slots state (per selected mission)
  const [slots, setSlots] = useState<MissionSlot[]>([]);
  const [start, setStart] = useState<string>("06:00");
  const [end, setEnd] = useState<string>("14:00");
  const [error, setError] = useState<string>("");
  const [openSlotsFor, setOpenSlotsFor] = useState<number | null>(null);

  // create modal
  const addDlg = useDisclosure(false);
  const [newName, setNewName] = useState("");
  const [reqSoldiers, setReqSoldiers] = useState(4);
  const [reqCommanders, setReqCommanders] = useState(1);
  const [reqOfficers, setReqOfficers] = useState(0);
  const [reqDrivers, setReqDrivers] = useState(1);

  // edit
  const [editId, setEditId] = useState<number | null>(null);
  const [eName, setEName] = useState("");
  const [eReq, setEReq] = useState({ soldiers: 0, commanders: 0, officers: 0, drivers: 0 });

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await api.get<Mission[]>("/missions");
      setRows(r.data);
    } catch (e: any) {
      setErr(e?.response?.data?.detail ?? "Failed to load missions");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const timeWithSeconds = (t: string) => (t.length === 5 ? `${t}:00` : t);

  const loadSlots = async (missionId: number) => {
    setError("");
    try {
      const data = await listMissionSlots(missionId);
      setSlots(data);
    } catch (e: any) {
      setSlots([]);
      setError(e?.response?.data?.detail ?? "Failed to load slots");
    }
  };

  const toggleSlots = async (missionId: number) => {
    if (openSlotsFor === missionId) {
      setOpenSlotsFor(null);
      setSlots([]);
      return;
    }
    setOpenSlotsFor(missionId);
    await loadSlots(missionId);
  };

  const addSlot = async (e: React.FormEvent, missionId: number) => {
    e.preventDefault();
    setError("");
    try {
      const created = await createMissionSlot(missionId, {
        start_time: timeWithSeconds(start),
        end_time: timeWithSeconds(end),
      });
      setSlots((prev) => [...prev, created].sort((a, b) => a.start_time.localeCompare(b.start_time)));
    } catch (err: any) {
      const msg = err?.response?.data?.detail ?? "Failed to create slot";
      setError(msg);
    }
  };

  const removeSlot = async (missionId: number, slotId: number) => {
    setError("");
    try {
      await deleteMissionSlot(missionId, slotId);
      setSlots((prev) => prev.filter((s) => s.id !== slotId));
    } catch (err: any) {
      const msg = err?.response?.data?.detail ?? "Failed to delete slot";
      setError(msg);
    }
  };

  const createRow = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/missions", {
        name: newName.trim(),
        // no start/end at mission level
        required_soldiers: reqSoldiers,
        required_commanders: reqCommanders,
        required_officers: reqOfficers,
        required_drivers: reqDrivers,
      });
      setNewName("");
      setReqSoldiers(4);
      setReqCommanders(1);
      setReqOfficers(0);
      setReqDrivers(1);
      addDlg.close();
      await load();
    } catch (e: any) {
      setErr(e?.response?.data?.detail ?? "Failed to create mission");
    }
  };

  const startEdit = (m: Mission) => {
    setEditId(m.id);
    setEName(m.name);
    setEReq({
      soldiers: m.required_soldiers,
      commanders: m.required_commanders,
      officers: m.required_officers,
      drivers: m.required_drivers,
    });
  };
  const cancelEdit = () => setEditId(null);

  const saveEdit = async (id: number) => {
    try {
      await api.patch(`/missions/${id}`, {
        name: eName.trim(),
        required_soldiers: eReq.soldiers,
        required_commanders: eReq.commanders,
        required_officers: eReq.officers,
        required_drivers: eReq.drivers,
      });
      setEditId(null);
      await load();
      if (openSlotsFor === id) await loadSlots(id);
    } catch (e: any) {
      setErr(e?.response?.data?.detail ?? "Failed to update mission");
    }
  };

  const remove = async (id: number) => {
    if (!confirm("Delete this mission? (blocked if it has assignments)")) return;
    try {
      await api.delete(`/missions/${id}`);
      await load();
      if (openSlotsFor === id) {
        setOpenSlotsFor(null);
        setSlots([]);
      }
    } catch (e: any) {
      setErr(e?.response?.data?.detail ?? "Failed to delete mission");
    }
  };

  return (
    <div style={{ maxWidth: 1100, margin: "24px auto", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Missions</h1>
        <button onClick={addDlg.open} style={{ padding: "8px 12px", borderRadius: 8 }}>
          Add Mission
        </button>
      </div>

      <Modal open={addDlg.isOpen} onClose={addDlg.close} title="Add Mission" maxWidth={640}>
        <form onSubmit={createRow} style={{ display: "grid", gridTemplateColumns: "2fr repeat(4,1fr)", gap: 10 }}>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Mission name" required />
          <label>
            Soldiers
            <input type="number" value={reqSoldiers} min={0} onChange={(e) => setReqSoldiers(+e.target.value || 0)} />
          </label>
          <label>
            Commanders
            <input type="number" value={reqCommanders} min={0} onChange={(e) => setReqCommanders(+e.target.value || 0)} />
          </label>
          <label>
            Officers
            <input type="number" value={reqOfficers} min={0} onChange={(e) => setReqOfficers(+e.target.value || 0)} />
          </label>
          <label>
            Drivers
            <input type="number" value={reqDrivers} min={0} onChange={(e) => setReqDrivers(+e.target.value || 0)} />
          </label>

          <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" onClick={addDlg.close}>Cancel</button>
            <button type="submit">Add</button>
          </div>
        </form>
      </Modal>

      {err && <div style={{ color: "crimson" }}>{err}</div>}
      {loading && <div>Loading…</div>}

      <table className="tbl-missions" width="100%" cellPadding={8} style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th align="left">Name</th>
            <th>Off</th>
            <th>Com</th>
            <th>Drv</th>
            <th>Sol</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => {
            const editing = editId === m.id;
            const isOpen = openSlotsFor === m.id;
            return (
              <Fragment key={m.id}>
                <tr style={{ borderTop: "1px solid #ddd" }}>
                  <td>{editing ? <input value={eName} onChange={(e) => setEName(e.target.value)} /> : m.name}</td>
                  <td align="center">
                    {editing ? (
                      <input
                        type="number"
                        min={0}
                        value={eReq.officers}
                        onChange={(e) => setEReq({ ...eReq, officers: +e.target.value })}
                      />
                    ) : (
                      m.required_officers
                    )}
                  </td>
                  <td align="center">
                    {editing ? (
                      <input
                        type="number"
                        min={0}
                        value={eReq.commanders}
                        onChange={(e) => setEReq({ ...eReq, commanders: +e.target.value })}
                      />
                    ) : (
                      m.required_commanders
                    )}
                  </td>
                  <td align="center">
                    {editing ? (
                      <input
                        type="number"
                        min={0}
                        value={eReq.drivers}
                        onChange={(e) => setEReq({ ...eReq, drivers: +e.target.value })}
                      />
                    ) : (
                      m.required_drivers
                    )}
                  </td>
                  <td align="center">
                    {editing ? (
                      <input
                        type="number"
                        min={0}
                        value={eReq.soldiers}
                        onChange={(e) => setEReq({ ...eReq, soldiers: +e.target.value })}
                      />
                    ) : (
                      m.required_soldiers
                    )}
                  </td>
                  <td align="center" style={{ whiteSpace: "nowrap" }}>
                    {editing ? (
                      <>
                        <button onClick={() => saveEdit(m.id)}>Save</button>
                        <button onClick={cancelEdit} style={{ marginLeft: 8 }}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => startEdit(m)}>Edit</button>
                        <button onClick={() => toggleSlots(m.id)} style={{ marginLeft: 8 }}>
                          {isOpen ? "Hide slots" : "Slots"}
                        </button>
                        <button onClick={() => remove(m.id)} style={{ marginLeft: 8, color: "crimson" }}>
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>

                {isOpen && (
                  <tr>
                    <td colSpan={6} style={{ background: "#fafafa", borderTop: "1px solid #eee" }}>
                      <div style={{ display: "grid", gap: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <strong>Time slots</strong>
                          {error && <span style={{ color: "crimson", fontSize: 12 }}>{error}</span>}
                        </div>

                        <form onSubmit={(e) => addSlot(e, m.id)} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <label>
                            Start
                            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} style={{ marginLeft: 6 }} required />
                          </label>
                          <label>
                            End
                            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} style={{ marginLeft: 6 }} required />
                          </label>
                          <button type="submit">Add slot</button>
                        </form>

                        <div style={{ border: "1px solid #e5e7eb", borderRadius: 6, overflow: "hidden" }}>
                          <table className="tbl-missions" width="100%" cellPadding={8} style={{ borderCollapse: "collapse" }}>
                            <thead>
                              <tr style={{ background: "#f6f7f8" }}>
                                <th align="left">Start</th>
                                <th align="left">End</th>
                                <th align="right">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {slots.map((s) => (
                                <tr key={s.id} style={{ borderTop: "1px solid #eee" }}>
                                  <td>{s.start_time.slice(0, 5)}</td>
                                  <td>{s.end_time.slice(0, 5)}</td>
                                  <td align="right">
                                    <button onClick={() => removeSlot(m.id, s.id)} style={{ color: "crimson" }}>
                                      Delete
                                    </button>
                                  </td>
                                </tr>
                              ))}
                              {slots.length === 0 && (
                                <tr>
                                  <td colSpan={3} style={{ opacity: 0.7 }}>(No slots yet)</td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                        <div style={{ fontSize: 12, color: "#6b7280" }}>
                          Overnight is supported (e.g., 22:00 → 06:00). Overlapping slots for the same mission are blocked.
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} style={{ opacity: 0.7 }}>(No missions)</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
