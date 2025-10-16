// shabtzak-ui\src\components\MissionSlotsModal.tsx
import { useEffect, useState } from "react";
import Modal from "./Modal";
import { listMissionSlots, createMissionSlot, deleteMissionSlot, type MissionSlot } from "../api";

type Props = {
  missionId: number;
  missionName: string;
  open: boolean;
  onClose: () => void;
};

export default function MissionSlotsModal({ missionId, missionName, open, onClose }: Props) {
  const [slots, setSlots] = useState<MissionSlot[]>([]);
  const [start, setStart] = useState("06:00");
  const [end, setEnd] = useState("14:00");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await listMissionSlots(missionId);
      setSlots(r);
    } catch (e: any) {
      setErr(e?.response?.data?.detail ?? "Failed to load slots");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) load();
  }, [open]);

  const addSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await createMissionSlot(missionId, {
        start_time: start + ":00",
        end_time: end + ":00",
      });
      setStart("06:00");
      setEnd("14:00");
      await load();
    } catch (e: any) {
      setErr(e?.response?.data?.detail ?? "Failed to add slot");
    }
  };

  const remove = async (slotId: number) => {
    if (!confirm("Delete this slot?")) return;
    setErr(null);
    try {
      await deleteMissionSlot(missionId, slotId);
      await load();
    } catch (e: any) {
      setErr(e?.response?.data?.detail ?? "Failed to delete slot");
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Slots: ${missionName}`} maxWidth={520}>
      <div
        style={{
          display: "grid",
          gap: 12,
          backgroundColor: "#1f2937",   // match desired background
          color: "white",               // ensure text remains visible
          borderRadius: 8,
          padding: 16,
        }}
      >
        <form onSubmit={addSlot} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          <span>→</span>
          <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          <button type="submit">Add</button>
        </form>

        {err && <div style={{ color: "crimson" }}>{err}</div>}
        {loading && <div>Loading…</div>}

        <table
          width="100%"
          cellPadding={6}
          style={{
            borderCollapse: "collapse",
            backgroundColor: "#1f2937",
            color: "white",
          }}
        >
          <thead style={{ backgroundColor: "#1f2937" }}>
            <tr style={{ borderBottom: "1px solid #374151" }}>
              <th align="left" style={{ backgroundColor: "#1f2937", color: "#e5e7eb" }}>Start</th>
              <th align="left" style={{ backgroundColor: "#1f2937", color: "#e5e7eb" }}>End</th>
              <th style={{ backgroundColor: "#1f2937", color: "#e5e7eb" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {slots.map((s) => (
              <tr key={s.id} style={{ borderTop: "1px solid #374151" }}>
                <td>{s.start_time.slice(0, 5)}</td>
                <td>{s.end_time.slice(0, 5)}</td>
                <td align="center">
                  <button
                    onClick={() => remove(s.id)}
                    style={{
                      color: "#f87171",
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {slots.length === 0 && (
              <tr>
                <td colSpan={3} style={{ opacity: 0.7 }}>
                  (No slots)
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
