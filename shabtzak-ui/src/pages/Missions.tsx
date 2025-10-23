// shabtzak-ui/src/pages/Missions.tsx
import { Fragment, useEffect, useState } from "react";
import { api } from "../api";
import Modal from "../components/Modal";
import MissionSlotsModal from "../components/MissionSlotsModal";
import { useDisclosure } from "../hooks/useDisclosure";
import {
  listMissionSlots,
  createMissionSlot,
  deleteMissionSlot,
  type MissionSlot,
  // We'll call api.get/api.put directly for requirements
} from "../api";


// Minimal Mission type for this page
type Mission = {
  id: number;
  name: string;
  total_needed?: number | null;
};

// For role selector in requirements editor
type Role = {
  id: number;
  name: string;
};

/* ------------------------------ Requirements ------------------------------ */

function MissionRequirementsEditor({ missionId, roles, initialTotal }: { missionId: number; roles: Role[]; initialTotal: number | null }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [total, setTotal] = useState<number | "">(initialTotal ?? "");
  const [rows, setRows] = useState<{ role_id: number | ""; count: number | "" }[]>([]);
  

  const sum = rows.reduce((acc, r) => acc + (Number(r.count) || 0), 0);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const reqs = await api.get<Array<{ id: number; role_id: number; role_name: string; count: number }>>(
        `/missions/${missionId}/requirements`
      );
      setRows(reqs.data.map(r => ({ role_id: r.role_id, count: r.count })));
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load requirements");
    } finally {
      setLoading(false);
    }
  };



  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionId]);

  const addRow = () => setRows((prev) => [...prev, { role_id: "", count: "" }]);
  const removeRow = (idx: number) => setRows((prev) => prev.filter((_, i) => i !== idx));
  const updateRow = (idx: number, patch: Partial<{ role_id: number | ""; count: number | "" }>) =>
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const save = async () => {
    setLoading(true);
    setErr(null);
    try {
      // 1) Save total_needed on the mission
      await api.patch(`/missions/${missionId}`, {
        total_needed: total === "" ? null : Number(total),
      });

      // 2) Save requirements as a plain array
      const clean = rows
        .filter(r => r.role_id !== "" && r.count !== "")
        .map(r => ({ role_id: Number(r.role_id), count: Number(r.count) }));

      await api.put(`/missions/${missionId}/requirements`, clean, {
        headers: { "Content-Type": "application/json" },
      });

      await load();
    } catch (e: any) {
      setErr(e?.response?.data?.detail ?? e?.message ?? "Failed to save requirements");
    } finally {
      setLoading(false);
    }
  };


  return (
    <div style={{ marginTop: 12, border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <strong>דרישות</strong>
        <span style={{ fontSize: 12, opacity: 0.8 }}>
          סהכ: {sum}
          {typeof total === "number" ? ` / ${total}` : ""}
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
        <label style={{ fontSize: 14, width: 120 }}>סה"כ חיילים:</label>
        <input
          type="number"
          min={1}
          value={total}
          onChange={(e) => setTotal(e.target.value === "" ? "" : Number(e.target.value))}
          style={{ border: "1px solid #ddd", borderRadius: 6, padding: "4px 8px", width: 120 }}
          placeholder="e.g. 8"
        />
        {typeof total === "number" && sum > total && (
          <span style={{ fontSize: 12, color: "crimson" }}>חריגה מכמות החיילים</span>
        )}
      </div>

      <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
        {rows.map((row, idx) => (
          <div key={idx} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select
              value={row.role_id}
              onChange={(e) => updateRow(idx, { role_id: e.target.value === "" ? "" : Number(e.target.value) })}
              style={{ border: "1px solid #ddd", borderRadius: 6, padding: "4px 8px" }}
            >
              <option value="">בחר תפקיד</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              value={row.count}
              onChange={(e) => updateRow(idx, { count: e.target.value === "" ? "" : Number(e.target.value) })}
              placeholder="כמות"
              style={{ border: "1px solid #ddd", borderRadius: 6, padding: "4px 8px", width: 100 }}
            />
            <button onClick={() => removeRow(idx)} style={{ color: "crimson" }}>
              הסר
            </button>
          </div>
        ))}
        <button onClick={addRow}>הוסף תפקיד +</button>
      </div>

      <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
        <button onClick={save} disabled={loading}>
          {loading ? "בשמירה..." : "שמור"}
        </button>
        {err && <span style={{ color: "crimson", fontSize: 12 }}>{err}</span>}
      </div>
    </div>
  );
}

/* --------------------------------- Page ---------------------------------- */

export default function MissionsPage() {
  const [rows, setRows] = useState<Mission[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
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
  const [newTotal, setNewTotal] = useState<number | "">("");

  const [slotsModal, setSlotsModal] = useState<{ open: boolean; id: number | null; name: string }>(
    { open: false, id: null, name: "" }
  );

  // edit
  const [editId, setEditId] = useState<number | null>(null);
  const [eName, setEName] = useState("");
  const [eTotal, setETotal] = useState<number | "">("");

  const timeWithSeconds = (t: string) => (t.length === 5 ? `${t}:00` : t);

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

  // missions
  useEffect(() => {
    load();
  }, []);

  // roles for requirements editor
  useEffect(() => {
    (async () => {
      try {
        const r = await api.get<Role[]>("/roles");
        setRoles(r.data);
      } catch {
        setRoles([]);
      }
    })();
  }, []);

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
        total_needed: newTotal === "" ? null : newTotal,
      });
      setNewName("");
      setNewTotal("");
      addDlg.close();
      await load();
    } catch (e: any) {
      setErr(e?.response?.data?.detail ?? "Failed to create mission");
    }
  };

  const startEdit = (m: Mission) => {
    setEditId(m.id);
    setEName(m.name);
    setETotal(m.total_needed ?? "");
  };

  const cancelEdit = () => setEditId(null);

  const saveEdit = async (id: number) => {
    try {
      await api.patch(`/missions/${id}`, {
        name: eName.trim(),
        total_needed: eTotal === "" ? null : eTotal,
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
        <h1>משימות</h1>
        <button onClick={addDlg.open} style={{ padding: "8px 12px", borderRadius: 8 }}>
          הוסף משימה
        </button>
      </div>

      <Modal open={addDlg.isOpen} onClose={addDlg.close} title="הוסף משימה" maxWidth={640}>
        <form onSubmit={createRow} style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="משימה" required />
          <label>
            סה"כ חיילים
            <input
              type="number"
              min={1}
              value={newTotal === "" ? "" : newTotal}
              onChange={(e) => setNewTotal(e.target.value === "" ? "" : +e.target.value)}
            />
          </label>

          <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" onClick={addDlg.close}>
              בטל
            </button>
            <button type="submit">הוסף</button>
          </div>
        </form>
      </Modal>

      {err && <div style={{ color: "crimson" }}>{err}</div>}
      {loading && <div>בטעינה...</div>}

      <table className="tbl-missions" width="100%" cellPadding={8} style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th align="left">משימה</th>
            <th align="center">סה"כ חיילים</th>
            <th>פעולות</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => {
            const editing = editId === m.id;
            const isOpen = openSlotsFor === m.id;
            return (
              <Fragment key={m.id}>
                <tr style={{ borderTop: "1px solid #ddd" }}>
                  <td>
                    {editing ? (
                      <input value={eName} onChange={(e) => setEName(e.target.value)} />
                    ) : (
                      m.name
                    )}
                  </td>
                  <td align="center">
                    {editing ? (
                      <input
                        type="number"
                        min={1}
                        value={eTotal}
                        onChange={(e) => setETotal(e.target.value === "" ? "" : +e.target.value)}
                      />
                    ) : (
                      m.total_needed ?? "—"
                    )}
                  </td>
                  <td align="center" style={{ whiteSpace: "nowrap" }}>
                    {editing ? (
                      <>
                        <button onClick={() => saveEdit(m.id)}>שמור</button>
                        <button onClick={cancelEdit} style={{ marginLeft: 8 }}>
                          בטל
                        </button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => startEdit(m)}>ערוך</button>
                        <button onClick={() => toggleSlots(m.id)} style={{ marginLeft: 8 }}>
                          {isOpen ? "הסתר" : "חלונות זמן"}
                        </button>
                        <button onClick={() => remove(m.id)} style={{ marginLeft: 8, color: "crimson" }}>
                          מחק
                        </button>
                      </>
                    )}
                  </td>
                </tr>

                {isOpen && (
                  <tr>
                    <td colSpan={3} style={{ background: "#1f2937", borderTop: "1px solid #eee" }}>
                      <div style={{ display: "grid", gap: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <strong>חלונות זמן</strong>
                          {error && <span style={{ color: "crimson", fontSize: 12 }}>{error}</span>}
                        </div>

                        <form
                          onSubmit={(e) => addSlot(e, m.id)}
                          style={{ display: "flex", gap: 8, alignItems: "center" }}
                        >
                          <label>
                            התחלה
                            <input
                              type="time"
                              value={start}
                              onChange={(e) => setStart(e.target.value)}
                              style={{ marginLeft: 6 }}
                              required
                            />
                          </label>
                          <label>
                            סיום
                            <input
                              type="time"
                              value={end}
                              onChange={(e) => setEnd(e.target.value)}
                              style={{ marginLeft: 6 }}
                              required
                            />
                          </label>
                          <button type="submit">הוסף חלון</button>
                        </form>

                        <div style={{ border: "1px solid #e5e7eb", borderRadius: 6, overflow: "hidden" }}>
                          <table
                            className="tbl-missions"
                            width="100%"
                            cellPadding={8}
                            style={{ borderCollapse: "collapse" }}
                          >
                            <thead style={{ backgroundColor: "#1f2937" }}>
                              <tr style={{ backgroundColor: "#1f2937", borderBottom: "1px solid #374151" }}>
                                <th
                                  align="left"
                                  style={{
                                    backgroundColor: "#1f2937",
                                    color: "#e5e7eb",
                                    fontWeight: "500",
                                    padding: "8px",
                                  }}
                                >
                                  התחלה
                                </th>
                                <th
                                  align="left"
                                  style={{
                                    backgroundColor: "#1f2937",
                                    color: "#e5e7eb",
                                    fontWeight: "500",
                                    padding: "8px",
                                  }}
                                >
                                  סיום
                                </th>
                                <th
                                  style={{
                                    backgroundColor: "#1f2937",
                                    color: "#e5e7eb",
                                    fontWeight: "500",
                                    padding: "8px",
                                  }}
                                >
                                  פעולות
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {slots.map((s) => (
                                <tr key={s.id} style={{ borderTop: "1px solid #eee" }}>
                                  <td>{s.start_time.slice(0, 5)}</td>
                                  <td>{s.end_time.slice(0, 5)}</td>
                                  <td align="right">
                                    <button onClick={() => removeSlot(m.id, s.id)} style={{ color: "crimson" }}>
                                      מחק
                                    </button>
                                  </td>
                                </tr>
                              ))}
                              {slots.length === 0 && (
                                <tr>
                                  <td colSpan={3} style={{ opacity: 0.7 }}>
                                    (אין חלונות זמן)
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>

                        {/* Requirements editor */}
                        <MissionRequirementsEditor missionId={m.id} roles={roles} initialTotal={m.total_needed ?? null} />
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={3} style={{ opacity: 0.7 }}>
                (אין משימות)
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
