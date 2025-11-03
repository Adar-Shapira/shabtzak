// shabtzak-ui/src/components/VacationsModal.tsx
import { useState, useEffect } from "react";
import DeleteIcon from "@mui/icons-material/Delete";
import { api } from "../api";
import Modal from "./Modal";

type Vacation = {
  id?: number;
  soldier_id: number;
  soldier_name?: string | null;
  start_date: string; // YYYY-MM-DD
  end_date: string;   // YYYY-MM-DD
  note?: string | null;
};

type Soldier = {
  id: number;
  name: string;
  roles?: Array<{ id: number; name: string }>;
  department_id?: number | null;
  department_name?: string | null;
};

interface VacationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  soldier: Soldier | null;
  onVacationsUpdated?: () => void; // Optional callback to refresh parent data
}

export default function VacationsModal({ isOpen, onClose, soldier, onVacationsUpdated }: VacationsModalProps) {
  const [vacations, setVacations] = useState<Vacation[]>([]);
  const [vacEditId, setVacEditId] = useState<number | null>(null);
  const [vacStart, setVacStart] = useState<string>("");
  const [vacEnd, setVacEnd] = useState<string>("");
  const [vacNote, setVacNote] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Fetch vacations when soldier changes or modal opens
  useEffect(() => {
    if (isOpen && soldier) {
      fetchVacations(soldier.id);
      // Reset form
      setVacEditId(null);
      setVacStart("");
      setVacEnd("");
      setVacNote("");
    }
  }, [isOpen, soldier]);

  const fetchVacations = async (soldierId: number) => {
    setLoading(true);
    setErr(null);
    
    // Helper to normalize IDs to numbers
    const sameId = (x: any, y: any) => Number(x) === Number(y);

    try {
      // Use the correct soldier-scoped endpoint
      try {
        const res = await api.get(`/vacations/soldiers/${soldierId}`);
        setVacations(Array.isArray(res.data) ? res.data : []);
        return;
      } catch (_e) {
        // fall through
      }

      // Try global endpoint with different param names
      const tryGlobal = async (param: string) => {
        try {
          const r = await api.get(`/vacations`, { params: { [param]: soldierId, t: Date.now() } });
          const payload = r.data ?? [];
          const items = Array.isArray(payload) ? payload : (payload.items ?? payload.results ?? []);
          setVacations(items.filter((v: Vacation) => sameId(v.soldier_id, soldierId)));
          return true;
        } catch {
          return false;
        }
      };

      const ok =
        (await tryGlobal("soldier_id").catch(() => false)) ||
        (await tryGlobal("soldierId").catch(() => false)) ||
        (await tryGlobal("sid").catch(() => false));

      if (!ok) {
        setErr("Failed to load vacations: no matching endpoint");
      }
    } catch (e: any) {
      setErr(e?.response?.data?.detail ?? "Failed to load vacations");
      setVacations([]);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setVacations([]);
    setVacEditId(null);
    setVacStart("");
    setVacEnd("");
    setVacNote("");
    setErr(null);
    onClose();
  };

  const saveVacation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!soldier) return;

    if (vacStart && vacEnd && vacEnd < vacStart) {
      alert("תאריך סיום לא יכול להיות לפני תאריך התחלה");
      return;
    }

    setErr(null);
    try {
      const payload = { start_date: vacStart, end_date: vacEnd, note: vacNote || null };

      if (vacEditId == null) {
        // CREATE
        let created: Vacation | null = null;
        try {
          const r = await api.post(`/vacations/soldiers/${soldier.id}`, payload);
          created = r.data as Vacation;
        } catch (e: any) {
          if (e?.response?.status === 404) {
            const r = await api.post(`/vacations`, { ...payload, soldier_id: soldier.id });
            created = r.data as Vacation;
          } else {
            throw e;
          }
        }

        // If backend returned the created row, update immediately; otherwise refresh
        if (created && created.id) {
          setVacations(prev => [...prev, created!]);
        } else {
          await fetchVacations(soldier.id);
        }
      } else {
        // UPDATE - Note: There's no PATCH endpoint in the backend, only DELETE
        // For now, we'll skip UPDATE and let users delete/recreate if needed
        setErr("עדכון חופשה אינו נתמך. אנא מחק והגדר מחדש.");
        return;
      }

      // Reset form
      setVacEditId(null);
      setVacStart("");
      setVacEnd("");
      setVacNote("");

      // Notify parent if callback provided
      if (onVacationsUpdated) {
        onVacationsUpdated();
      }
    } catch (e: any) {
      setErr(e?.response?.data?.detail ?? "Failed to save vacation");
    }
  };

  const handleDelete = (v: Vacation) => {
    if (!soldier || !v.id) return;
    
    const dateRange = `${v.start_date} → ${v.end_date}`;
    if (!confirm(`האם למחוק את החופשה ${dateRange}?`)) return;

    setErr(null);
    setLoading(true);
    
    (async () => {
      try {
        let ok = false;
        try {
          const r = await api.delete(`/vacations/${v.id}`);
          ok = r.status >= 200 && r.status < 300;
        } catch (e: any) {
          throw e;
        }

        // Optimistic remove
        if (ok) {
          setVacations(prev => prev.filter(x => x.id !== v.id));
        } else {
          await fetchVacations(soldier.id);
        }

        // Notify parent if callback provided
        if (onVacationsUpdated) {
          onVacationsUpdated();
        }
      } catch (e: any) {
        setErr(e?.response?.data?.detail ?? "Failed to delete vacation");
      } finally {
        setLoading(false);
      }
    })();
  };

  return (
    <Modal
      open={isOpen}
      onClose={handleClose}
      title={soldier ? `חופשות — ${soldier.name}` : "חופשות"}
      maxWidth={720}
    >
      {!soldier ? (
        <div style={{ opacity: 0.7 }}>לא נבחר חייל</div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {/* Toolbar */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 12, opacity: 0.75 }}>
              הוסף טווח תאריכים בהם החייל בחופשה
            </div>
          </div>

          {/* Error message */}
          {err && <div style={{ color: "crimson", fontSize: 14 }}>{err}</div>}

          {/* Add/Edit form */}
          <form onSubmit={saveVacation} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 8, alignItems: "end" }}>
            <div>
              <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 4 }}>התחלה</div>
              <input 
                type="date" 
                value={vacStart} 
                onChange={(e) => setVacStart(e.target.value)} 
                required 
              />
            </div>
            <div>
              <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 4 }}>סיום</div>
              <input 
                type="date" 
                value={vacEnd} 
                onChange={(e) => setVacEnd(e.target.value)} 
                required 
              />
            </div>
            <div>
              <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 4 }}>הערות</div>
              <input 
                type="text" 
                value={vacNote} 
                onChange={(e) => setVacNote(e.target.value)} 
                placeholder="הערות" 
              />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="submit" disabled={loading}>
                {vacEditId == null ? "הוסף" : "שמור"}
              </button>
              {vacEditId != null && (
                <button
                  type="button"
                  onClick={() => {
                    setVacEditId(null);
                    setVacStart("");
                    setVacEnd("");
                    setVacNote("");
                  }}
                  disabled={loading}
                >
                  בטל
                </button>
              )}
            </div>
          </form>

          {/* Vacations list */}
          {loading && vacations.length === 0 ? (
            <div style={{ opacity: 0.7 }}>בטעינה...</div>
          ) : (
            <table width="100%" cellPadding={7} style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ width: 140 }}>התחלה</th>
                  <th style={{ width: 140 }}>סיום</th>
                  <th>הערות</th>
                  <th style={{ width: 160 }}>פעולות</th>
                </tr>
              </thead>
              <tbody>
                {vacations.map((v) => (
                  <tr key={v.id} style={{ borderTop: "1px solid #eee" }}>
                    <td>{v.start_date}</td>
                    <td>{v.end_date}</td>
                    <td>{v.note ?? <span style={{ opacity: 0.6 }}>(אין)</span>}</td>
                    <td>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleDelete(v);
                        }}
                        title="מחק"
                        disabled={loading}
                        style={{ 
                          padding: "4px 8px",
                          border: "none",
                          background: "transparent",
                          cursor: loading ? "not-allowed" : "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          color: "#e5e7eb",
                          opacity: loading ? 0.5 : 1,
                        }}
                      >
                        <DeleteIcon fontSize="small" />
                      </button>
                    </td>
                  </tr>
                ))}
                {vacations.length === 0 && !loading && (
                  <tr>
                    <td colSpan={4} style={{ opacity: 0.7 }}>(אין חופשות)</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}
    </Modal>
  );
}

