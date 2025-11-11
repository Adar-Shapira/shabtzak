// shabtzak-ui/src/pages/Missions.tsx
import { useEffect, useState, useRef } from "react";
import type React from "react";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import AddIcon from "@mui/icons-material/Add";
import RemoveIcon from "@mui/icons-material/Remove";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import Modal from "../components/Modal";
import { useDisclosure } from "../hooks/useDisclosure";
import { useSidebar } from "../contexts/SidebarContext";
import {
  api,
  listMissionSlots,
  createMissionSlot,
  deleteMissionSlot,
  type MissionSlot,
  exportMissionsData,
  importMissionsData,
  type MissionsExportPackage,
  type MissionsImportSummary,
} from "../api";

// Minimal Mission type for this page
type Mission = {
  id: number;
  name: string;
  total_needed?: number | null;
  order: number;
};

// For role selector in requirements editor
type Role = {
  id: number;
  name: string;
};

/* ------------------------------ Requirements Editor ------------------------------ */

function MissionRequirementsEditor({ missionId, roles, initialTotal }: { missionId: number; roles: Role[]; initialTotal: number | null }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [total, setTotal] = useState<number>(initialTotal && initialTotal > 0 ? initialTotal : 1);
  const [rows, setRows] = useState<{ role_id: number | ""; count: number }[]>([]);

  const sum = rows.reduce((acc, r) => acc + (Number(r.count) || 0), 0);

  const incrementTotal = () => {
    setTotal(prev => prev + 1);
  };

  const decrementTotal = () => {
    if (total > 1) {
      setTotal(prev => prev - 1);
    }
  };

  const incrementRoleCount = (idx: number) => {
    setRows(prev => prev.map((r, i) => {
      if (i === idx) {
        const currentCount = Number(r.count) || 1;
        const newCount = currentCount + 1;
        // Don't allow role count to exceed total
        return { ...r, count: newCount > total ? currentCount : newCount };
      }
      return r;
    }));
  };

  const decrementRoleCount = (idx: number) => {
    setRows(prev => prev.map((r, i) => {
      if (i === idx) {
        const currentCount = Number(r.count) || 1;
        // Don't allow below 1
        return { ...r, count: currentCount > 1 ? currentCount - 1 : 1 };
      }
      return r;
    }));
  };

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const reqs = await api.get<Array<{ id: number; role_id: number; role_name: string; count: number }>>(
        `/missions/${missionId}/requirements`
      );
      setRows(reqs.data.map(r => ({ role_id: r.role_id, count: r.count || 1 })));
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

  const addRow = () => setRows((prev) => [...prev, { role_id: "", count: 1 }]);
  const removeRow = (idx: number) => setRows((prev) => prev.filter((_, i) => i !== idx));
  const updateRow = (idx: number, patch: Partial<{ role_id: number | ""; count: number }>) =>
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const save = async () => {
    setLoading(true);
    setErr(null);
    try {
      // 1) Save total_needed on the mission
      await api.patch(`/missions/${missionId}`, {
        total_needed: total,
      });

      // 2) Save requirements as a plain array
      const clean = rows
        .filter(r => r.role_id !== "")
        .map(r => ({ role_id: Number(r.role_id), count: Number(r.count) || 1 }));

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
    <details style={{ border: "1px solid #1f2937", borderRadius: 8, padding: "8px 12px", backgroundColor: "rgba(255,255,255,0.03)" }}>
      <summary style={{ cursor: "pointer", userSelect: "none", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <strong style={{ color: "#e5e7eb" }}>דרישות</strong>
        <span style={{ fontSize: 12, opacity: 0.8, color: "#e5e7eb" }}>
          סה"כ: {total} / {sum}
        </span>
      </summary>

      <div style={{ marginTop: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "auto auto auto auto 1fr", gap: 8, alignItems: "center", marginTop: 8 }}>
          <label style={{ fontSize: 14, color: "#e5e7eb" }}>סה"כ חיילים:</label>
          <button
            onClick={decrementTotal}
            disabled={total <= 1}
            title="הפחת"
            style={{
              padding: "4px 6px",
              border: "1px solid #1f2937",
              borderRadius: 6,
              backgroundColor: "rgba(255,255,255,0.03)",
              color: "#e5e7eb",
              cursor: total <= 1 ? "not-allowed" : "pointer",
              opacity: total <= 1 ? 0.5 : 1,
              display: "inline-flex",
              alignItems: "center",
              justifySelf: "start",
            }}
          >
            <RemoveIcon fontSize="small" />
          </button>
          <span style={{ minWidth: 30, textAlign: "center", color: "#e5e7eb", fontSize: 14 }}>
            {total}
          </span>
          <button
            onClick={incrementTotal}
            title="הגבר"
            style={{
              padding: "4px 6px",
              border: "1px solid #1f2937",
              borderRadius: 6,
              backgroundColor: "rgba(255,255,255,0.03)",
              color: "#e5e7eb",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifySelf: "start",
            }}
          >
            <AddIcon fontSize="small" />
          </button>
          {sum > total && (
            <span style={{ fontSize: 12, color: "crimson" }}>חריגה מכמות החיילים</span>
          )}
        </div>

        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          {rows.map((row, idx) => {
            // Get all role IDs that are selected in other rows (excluding current row)
            const selectedRoleIds = rows
              .filter((r, i) => i !== idx && r.role_id !== "")
              .map(r => Number(r.role_id));
            
            // Filter roles: show current role if selected, plus all unselected roles
            const availableRoles = roles.filter(r => 
              !selectedRoleIds.includes(r.id) || r.id === row.role_id
            );
            
            return (
            <div key={idx} style={{ display: "grid", gridTemplateColumns: "auto auto auto auto 1fr", gap: 8, alignItems: "center" }}>
              <select
                value={row.role_id === "" ? "" : String(row.role_id)}
                onChange={(e) => updateRow(idx, { role_id: e.target.value === "" ? "" : Number(e.target.value) })}
                style={{
                  border: "1px solid #1f2937",
                  borderRadius: 8,
                  padding: "10px 12px",
                  backgroundColor: "rgba(255,255,255,0.03)",
                  color: "#e5e7eb",
                  fontSize: 14,
                  cursor: "pointer",
                  direction: "rtl",
                  textAlign: "right",
                }}
              >
                <option value="" style={{ backgroundColor: "rgba(17, 24, 39, 0.95)", color: "#e5e7eb" }}>
                  בחר תפקיד...
                </option>
                {availableRoles.map((r) => (
                  <option key={r.id} value={r.id} style={{ backgroundColor: "rgba(17, 24, 39, 0.95)", color: "#e5e7eb" }}>
                    {r.name}
                  </option>
                ))}
              </select>
              <button
                onClick={() => decrementRoleCount(idx)}
                disabled={Number(row.count) <= 1}
                title="הפחת"
                style={{
                  padding: "4px 6px",
                  border: "1px solid #1f2937",
                  borderRadius: 6,
                  backgroundColor: "rgba(255,255,255,0.03)",
                  color: "#e5e7eb",
                  cursor: Number(row.count) <= 1 ? "not-allowed" : "pointer",
                  opacity: Number(row.count) <= 1 ? 0.5 : 1,
                  display: "inline-flex",
                  alignItems: "center",
                  justifySelf: "start",
                }}
              >
                <RemoveIcon fontSize="small" />
              </button>
              <span style={{ minWidth: 30, textAlign: "center", color: "#e5e7eb", fontSize: 14 }}>
                {row.count || 1}
              </span>
              <button
                onClick={() => incrementRoleCount(idx)}
                disabled={Number(row.count) >= total}
                title="הגבר"
                style={{
                  padding: "4px 6px",
                  border: "1px solid #1f2937",
                  borderRadius: 6,
                  backgroundColor: "rgba(255,255,255,0.03)",
                  color: "#e5e7eb",
                  cursor: Number(row.count) >= total ? "not-allowed" : "pointer",
                  opacity: Number(row.count) >= total ? 0.5 : 1,
                  display: "inline-flex",
                  alignItems: "center",
                  justifySelf: "start",
                }}
              >
                <AddIcon fontSize="small" />
              </button>
              <button
                onClick={() => removeRow(idx)}
                title="הסר"
                style={{
                  color: "#e5e7eb",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: "4px 8px",
                  display: "inline-flex",
                  alignItems: "center",
                }}
              >
                <DeleteIcon fontSize="small" />
              </button>
            </div>
            );
          })}
          <button onClick={addRow} style={{ padding: "4px 8px", border: "1px solid #1f2937", borderRadius: 6, backgroundColor: "rgba(255,255,255,0.03)", color: "#e5e7eb", cursor: "pointer" }}>
            הוסף תפקיד +
          </button>
        </div>

        <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
          <button onClick={save} disabled={loading} style={{ padding: "6px 12px", border: "1px solid #1f2937", borderRadius: 6, backgroundColor: "rgba(255,255,255,0.03)", color: "#e5e7eb", cursor: loading ? "not-allowed" : "pointer" }}>
            {loading ? "בשמירה..." : "שמור"}
          </button>
          {err && <span style={{ color: "crimson", fontSize: 12 }}>{err}</span>}
        </div>
      </div>
    </details>
  );
}

/* ------------------------------ Time Slots Component ------------------------------ */

function MissionTimeSlots({ missionId }: { missionId: number }) {
  const [slots, setSlots] = useState<MissionSlot[]>([]);
  const [start, setStart] = useState<string>("06:00");
  const [end, setEnd] = useState<string>("14:00");
  const [error, setError] = useState<string>("");
  const [loadingSlots, setLoadingSlots] = useState(false);

  const timeWithSeconds = (t: string) => (t.length === 5 ? `${t}:00` : t);

  const loadSlots = async () => {
    setLoadingSlots(true);
    setError("");
    try {
      const data = await listMissionSlots(missionId);
      setSlots(data);
    } catch (e: any) {
      setSlots([]);
      setError(e?.response?.data?.detail ?? "Failed to load slots");
    } finally {
      setLoadingSlots(false);
    }
  };

  useEffect(() => {
    loadSlots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionId]);

  const addSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const created = await createMissionSlot(missionId, {
        start_time: timeWithSeconds(start),
        end_time: timeWithSeconds(end),
      });
      setSlots((prev) => [...prev, created].sort((a, b) => a.start_time.localeCompare(b.start_time)));
      setStart("06:00");
      setEnd("14:00");
    } catch (err: any) {
      const msg = err?.response?.data?.detail ?? "Failed to create slot";
      setError(msg);
    }
  };

  const removeSlot = async (slotId: number) => {
    if (!confirm("האם למחוק את חלון הזמן הזה?")) return;
    setError("");
    try {
      await deleteMissionSlot(missionId, slotId);
      setSlots((prev) => prev.filter((s) => s.id !== slotId));
    } catch (err: any) {
      const msg = err?.response?.data?.detail ?? "Failed to delete slot";
      setError(msg);
    }
  };

  return (
    <details style={{ border: "1px solid #1f2937", borderRadius: 8, padding: "8px 12px", backgroundColor: "rgba(255,255,255,0.03)" }}>
      <summary style={{ cursor: "pointer", userSelect: "none", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <strong style={{ color: "#e5e7eb" }}>חלונות זמן</strong>
        {error && <span style={{ color: "crimson", fontSize: 12 }}>{error}</span>}
      </summary>

      <div style={{ marginTop: 12 }}>
        <form
          onSubmit={addSlot}
          style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}
        >
          <label style={{ color: "#e5e7eb", fontSize: 14 }}>
            התחלה
            <input
              type="time"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              style={{
                marginLeft: 6,
                padding: "6px 8px",
                borderRadius: 6,
                border: "1px solid #1f2937",
                backgroundColor: "rgba(255,255,255,0.03)",
                color: "#e5e7eb",
              }}
              required
            />
          </label>
          <label style={{ color: "#e5e7eb", fontSize: 14 }}>
            סיום
            <input
              type="time"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              style={{
                marginLeft: 6,
                padding: "6px 8px",
                borderRadius: 6,
                border: "1px solid #1f2937",
                backgroundColor: "rgba(255,255,255,0.03)",
                color: "#e5e7eb",
              }}
              required
            />
          </label>
          <button type="submit" style={{ padding: "6px 12px", border: "1px solid #1f2937", borderRadius: 6, backgroundColor: "rgba(255,255,255,0.03)", color: "#e5e7eb", cursor: "pointer" }}>
            הוסף חלון
          </button>
        </form>

        <div style={{ border: "1px solid #1f2937", borderRadius: 6, overflow: "hidden" }}>
          <table
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
                    direction: "rtl",
                    textAlign: "right",
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
                    direction: "rtl",
                    textAlign: "right",
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
              {loadingSlots ? (
                <tr>
                  <td colSpan={3} style={{ opacity: 0.7, color: "#e5e7eb", textAlign: "center", padding: 16 }}>
                    בטעינה...
                  </td>
                </tr>
              ) : slots.length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ opacity: 0.7, color: "#e5e7eb", textAlign: "center", padding: 16 }}>
                    (אין חלונות זמן)
                  </td>
                </tr>
              ) : (
                slots.map((s) => (
                  <tr key={s.id} style={{ borderTop: "1px solid #374151" }}>
                    <td style={{ color: "#e5e7eb", padding: "8px" }}>{s.start_time.slice(0, 5)}</td>
                    <td style={{ color: "#e5e7eb", padding: "8px" }}>{s.end_time.slice(0, 5)}</td>
                    <td align="right" style={{ padding: "8px" }}>
                      <button
                        onClick={() => removeSlot(s.id)}
                        title="מחק"
                        style={{
                          color: "#e5e7eb",
                          background: "transparent",
                          border: "none",
                          cursor: "pointer",
                          padding: "4px 8px",
                          display: "inline-flex",
                          alignItems: "center",
                        }}
                      >
                        <DeleteIcon fontSize="small" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}

/* --------------------------------- Page ---------------------------------- */

export default function MissionsPage() {
  const { setActions } = useSidebar();

  const [rows, setRows] = useState<Mission[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importSummary, setImportSummary] = useState<MissionsImportSummary | null>(null);

  // create modal
  const addDlg = useDisclosure(false);
  const [newName, setNewName] = useState("");
  const [newTotal, setNewTotal] = useState<number>(1);

  // edit
  const [editId, setEditId] = useState<number | null>(null);
  const [eName, setEName] = useState("");

  // confirmation modal
  const confirmDlg = useDisclosure(false);
  const [confirmMessage, setConfirmMessage] = useState<string>("");
  const [pendingDelete, setPendingDelete] = useState<{ id: number; name: string } | null>(null);

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

  // Register sidebar actions
  useEffect(() => {
    setActions({
      onAddMission: () => addDlg.open(),
    });
    return () => setActions({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setActions]);

  const incrementNewTotal = () => {
    setNewTotal(prev => prev + 1);
  };

  const decrementNewTotal = () => {
    if (newTotal > 1) {
      setNewTotal(prev => prev - 1);
    }
  };

  const createRow = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/missions", {
        name: newName.trim(),
        total_needed: newTotal,
      });
      setNewName("");
      setNewTotal(1);
      addDlg.close();
      await load();
    } catch (e: any) {
      setErr(e?.response?.data?.detail ?? "Failed to create mission");
    }
  };

  const startEdit = (m: Mission) => {
    setEditId(m.id);
    setEName(m.name);
  };

  const cancelEdit = () => {
    setEditId(null);
    setEName("");
  };

  const saveEdit = async (id: number) => {
    try {
      await api.patch(`/missions/${id}`, {
        name: eName.trim(),
      });
      setEditId(null);
      await load();
    } catch (e: any) {
      setErr(e?.response?.data?.detail ?? "Failed to update mission");
    }
  };

  const showConfirmDelete = (id: number, name: string) => {
    setConfirmMessage(`האם למחוק את המשימה "${name}"? (חסום אם יש שיבוצים)`);
    setPendingDelete({ id, name });
    confirmDlg.open();
  };

  const executeDelete = async () => {
    if (!pendingDelete) return;
    
    setErr(null);
    try {
      await api.delete(`/missions/${pendingDelete.id}`);
      await load();
      setPendingDelete(null);
      confirmDlg.close();
    } catch (e: any) {
      setErr(e?.response?.data?.detail ?? "Failed to delete mission");
      setPendingDelete(null);
      confirmDlg.close();
    }
  };

  const moveMission = async (missionId: number, direction: 'up' | 'down') => {
    const currentIndex = rows.findIndex(m => m.id === missionId);
    if (currentIndex === -1) return;

    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (newIndex < 0 || newIndex >= rows.length) return;

    const currentMission = rows[currentIndex];
    const targetMission = rows[newIndex];

    try {
      // Swap orders
      await Promise.all([
        api.patch(`/missions/${currentMission.id}`, { order: targetMission.order }),
        api.patch(`/missions/${targetMission.id}`, { order: currentMission.order }),
      ]);
      await load();
    } catch (e: any) {
      setErr(e?.response?.data?.detail ?? "Failed to reorder missions");
    }
  };

  const handleExport = async () => {
    setErr(null);
    setImportSummary(null);
    setExportBusy(true);
    try {
      const data = await exportMissionsData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const stamp = new Date().toISOString().slice(0, 10);
      link.download = `missions-export-${stamp}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setErr(e?.response?.data?.detail ?? e?.message ?? "Failed to export missions");
    } finally {
      setExportBusy(false);
    }
  };

  const handleImportClick = () => {
    importFileRef.current?.click();
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setErr(null);
    setImportSummary(null);
    setImportBusy(true);
    try {
      const text = await file.text();
      let parsed: MissionsExportPackage;
      try {
        parsed = JSON.parse(text) as MissionsExportPackage;
      } catch {
        throw new Error("קובץ אינו במבנה JSON תקין");
      }
      if (!parsed?.missions || !Array.isArray(parsed.missions)) {
        throw new Error("הקובץ אינו מכיל נתוני משימות");
      }
      const summary = await importMissionsData(parsed);
      setImportSummary(summary);
      await load();
    } catch (e: any) {
      const message = e?.response?.data?.detail ?? e?.message ?? "Failed to import missions";
      setErr(message);
    } finally {
      setImportBusy(false);
      event.target.value = "";
    }
  };

  return (
    <div style={{ maxWidth: 1100, margin: "24px auto", padding: 16 }}>
      <Modal open={addDlg.isOpen} onClose={addDlg.close} title="הוסף משימה" maxWidth={640}>
        <form onSubmit={createRow} style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
          <label style={{ color: "#e5e7eb", fontSize: 14 }}>
            משימה
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="משימה"
              required
              style={{
                marginTop: 4,
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid #1f2937",
                backgroundColor: "rgba(255,255,255,0.03)",
                color: "#e5e7eb",
                fontSize: 14,
                width: "100%",
              }}
            />
          </label>
          <label style={{ color: "#e5e7eb", fontSize: 14 }}>
            סה"כ חיילים
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
              <button
                type="button"
                onClick={decrementNewTotal}
                disabled={newTotal <= 1}
                title="הפחת"
                style={{
                  padding: "4px 6px",
                  border: "1px solid #1f2937",
                  borderRadius: 6,
                  backgroundColor: "rgba(255,255,255,0.03)",
                  color: "#e5e7eb",
                  cursor: newTotal <= 1 ? "not-allowed" : "pointer",
                  opacity: newTotal <= 1 ? 0.5 : 1,
                  display: "inline-flex",
                  alignItems: "center",
                }}
              >
                <RemoveIcon fontSize="small" />
              </button>
              <span style={{ minWidth: 30, textAlign: "center", color: "#e5e7eb", fontSize: 14 }}>
                {newTotal}
              </span>
              <button
                type="button"
                onClick={incrementNewTotal}
                title="הגבר"
                style={{
                  padding: "4px 6px",
                  border: "1px solid #1f2937",
                  borderRadius: 6,
                  backgroundColor: "rgba(255,255,255,0.03)",
                  color: "#e5e7eb",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                }}
              >
                <AddIcon fontSize="small" />
              </button>
            </div>
          </label>

          <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" onClick={addDlg.close} style={{ padding: "8px 16px", border: "1px solid #1f2937", borderRadius: 8, backgroundColor: "rgba(255,255,255,0.03)", color: "#e5e7eb", cursor: "pointer" }}>
              בטל
            </button>
            <button type="submit" style={{ padding: "8px 16px", border: "1px solid #1f2937", borderRadius: 8, backgroundColor: "rgba(255,255,255,0.03)", color: "#e5e7eb", cursor: "pointer" }}>
              הוסף
            </button>
          </div>
        </form>
      </Modal>

      <input
        ref={importFileRef}
        type="file"
        accept="application/json"
        style={{ display: "none" }}
        onChange={handleImportFile}
      />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 12 }}>
        <div style={{ fontSize: 20, fontWeight: 600, color: "#e5e7eb" }}>ניהול משימות</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={handleExport}
            disabled={exportBusy}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid #10b981",
              backgroundColor: exportBusy ? "rgba(16, 185, 129, 0.2)" : "rgba(16, 185, 129, 0.12)",
              color: "#10b981",
              cursor: exportBusy ? "wait" : "pointer",
              fontWeight: 600,
            }}
          >
            {exportBusy ? "מייצא..." : "ייצוא"}
          </button>
          <button
            type="button"
            onClick={handleImportClick}
            disabled={importBusy}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid #2563eb",
              backgroundColor: importBusy ? "rgba(37, 99, 235, 0.15)" : "rgba(37, 99, 235, 0.12)",
              color: "#bfdbfe",
              cursor: importBusy ? "wait" : "pointer",
              fontWeight: 600,
            }}
          >
            {importBusy ? "טוען..." : "ייבוא"}
          </button>
        </div>
      </div>

      {importSummary && (
        <div style={{ color: "#10b981", marginBottom: 12, fontSize: 14 }}>
          {`ייבוא הושלם: נוצרו ${importSummary.created_missions} משימות, עודכנו ${importSummary.updated_missions}, נוספו ${importSummary.created_roles} תפקידים, הוחלפו ${importSummary.slots_replaced} חלונות ו-${importSummary.requirements_replaced} דרישות.`}
        </div>
      )}

      {err && <div style={{ color: "crimson", marginBottom: 12 }}>{err}</div>}
      {loading && <div style={{ color: "#e5e7eb" }}>בטעינה...</div>}

      {!loading && (
        <>
          {rows.length === 0 && (
            <div style={{ opacity: 0.7, color: "#e5e7eb" }}>(אין משימות)</div>
          )}

          <div style={{ display: "grid", gap: 10 }}>
            {rows.map((m, index) => {
              const editing = editId === m.id;
              const canMoveUp = index > 0;
              const canMoveDown = index < rows.length - 1;
              return (
                <details
                  key={m.id}
                  style={{ border: "1px solid #ddd", borderRadius: 10, padding: "8px 12px" }}
                >
                  <summary style={{ cursor: "pointer", userSelect: "none" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
                        {editing ? (
                          <input
                            value={eName}
                            onChange={(e) => setEName(e.target.value)}
                            style={{
                              flex: 1,
                              padding: "6px 8px",
                              borderRadius: 6,
                              border: "1px solid #1f2937",
                              backgroundColor: "rgba(255,255,255,0.03)",
                              color: "#e5e7eb",
                              fontSize: 14,
                            }}
                          />
                        ) : (
                          <>
                            <span style={{ fontWeight: 600, color: "#e5e7eb" }}>
                              {m.name}
                            </span>
                            {m.total_needed && (
                              <span style={{ opacity: 0.7, fontSize: 12, color: "#e5e7eb" }}>
                                ({m.total_needed} חיילים)
                              </span>
                            )}
                          </>
                        )}
                      </div>
                      <div
                        onClick={(e) => e.preventDefault()} // avoid toggling <details> via buttons
                        style={{ display: "flex", gap: 4, alignItems: "center" }}
                      >
                        {!editing && (
                          <>
                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                moveMission(m.id, 'up');
                              }}
                              disabled={!canMoveUp}
                              title="הזז למעלה"
                              style={{
                                padding: "4px 6px",
                                border: "none",
                                background: "transparent",
                                cursor: canMoveUp ? "pointer" : "not-allowed",
                                display: "inline-flex",
                                alignItems: "center",
                                color: "#e5e7eb",
                                opacity: canMoveUp ? 1 : 0.3,
                              }}
                            >
                              <ArrowUpwardIcon fontSize="small" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                moveMission(m.id, 'down');
                              }}
                              disabled={!canMoveDown}
                              title="הזז למטה"
                              style={{
                                padding: "4px 6px",
                                border: "none",
                                background: "transparent",
                                cursor: canMoveDown ? "pointer" : "not-allowed",
                                display: "inline-flex",
                                alignItems: "center",
                                color: "#e5e7eb",
                                opacity: canMoveDown ? 1 : 0.3,
                              }}
                            >
                              <ArrowDownwardIcon fontSize="small" />
                            </button>
                          </>
                        )}
                        {editing ? (
                          <>
                            <button
                              onClick={() => saveEdit(m.id)}
                              title="שמור"
                              style={{
                                padding: "4px 8px",
                                border: "none",
                                background: "transparent",
                                cursor: "pointer",
                                display: "inline-flex",
                                alignItems: "center",
                                color: "#e5e7eb",
                              }}
                            >
                              <CheckIcon fontSize="small" />
                            </button>
                            <button
                              onClick={cancelEdit}
                              title="בטל"
                              style={{
                                padding: "4px 8px",
                                border: "none",
                                background: "transparent",
                                cursor: "pointer",
                                display: "inline-flex",
                                alignItems: "center",
                                color: "#e5e7eb",
                              }}
                            >
                              <CloseIcon fontSize="small" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                startEdit(m);
                              }}
                              title="ערוך"
                              style={{
                                padding: "4px 8px",
                                border: "none",
                                background: "transparent",
                                cursor: "pointer",
                                display: "inline-flex",
                                alignItems: "center",
                                color: "#e5e7eb",
                              }}
                            >
                              <EditIcon fontSize="small" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                showConfirmDelete(m.id, m.name);
                              }}
                              title="מחק"
                              style={{
                                padding: "4px 8px",
                                border: "none",
                                background: "transparent",
                                cursor: "pointer",
                                display: "inline-flex",
                                alignItems: "center",
                                color: "#e5e7eb",
                              }}
                            >
                              <DeleteIcon fontSize="small" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </summary>

                  <div style={{ marginTop: 8, padding: "8px 0", display: "grid", gap: 16 }}>
                    <MissionTimeSlots missionId={m.id} />
                    <MissionRequirementsEditor missionId={m.id} roles={roles} initialTotal={m.total_needed ?? null} />
                  </div>
                </details>
              );
            })}
          </div>
        </>
      )}

      {/* Confirmation Modal */}
      <Modal 
        open={confirmDlg.isOpen} 
        onClose={() => {
          setPendingDelete(null);
          confirmDlg.close();
        }} 
        title="אישור מחיקה"
        maxWidth={480}
      >
        <div style={{ display: "grid", gap: 16 }}>
          <p style={{ margin: 0, color: "#e5e7eb" }}>{confirmMessage}</p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button 
              type="button"
              onClick={() => {
                setPendingDelete(null);
                confirmDlg.close();
              }}
              style={{
                padding: "8px 16px",
                border: "1px solid #1f2937",
                borderRadius: 8,
                background: "rgba(255,255,255,0.03)",
                color: "#e5e7eb",
                cursor: "pointer",
              }}
            >
              בטל
            </button>
            <button 
              type="button"
              onClick={executeDelete}
              style={{
                padding: "8px 16px",
                border: "1px solid #dc2626",
                borderRadius: 8,
                background: "rgba(220, 38, 38, 0.1)",
                color: "#f87171",
                cursor: "pointer",
              }}
            >
              מחק
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
