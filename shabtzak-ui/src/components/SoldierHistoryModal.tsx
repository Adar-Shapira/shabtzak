// shabtzak-ui\src\components\SoldierHistoryModal.tsx
import { useEffect, useState } from "react"
import Modal from "./Modal"
import { getSoldierMissionHistory, type MissionHistoryItem } from "../api"

type Props = {
  soldierId: number
  soldierName: string
  isOpen: boolean
  onClose: () => void
}

export default function SoldierHistoryModal({ soldierId, soldierName, isOpen, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<MissionHistoryItem[]>([])

  useEffect(() => {
    if (!isOpen) return
    setLoading(true)
    setError(null)
    getSoldierMissionHistory(soldierId)
      .then(setItems)
      .catch((e) => setError(e?.message || "Failed to load history"))
      .finally(() => setLoading(false))
  }, [isOpen, soldierId])

  return (
    <Modal open={isOpen} onClose={onClose} title={`Mission History — ${soldierName}`}>
      {loading && <div>Loading…</div>}
      {!loading && error && <div style={{ color: "red" }}>{error}</div>}
      {!loading && !error && items.length === 0 && <div>No missions found.</div>}
      {!loading && !error && items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse">
            <thead>
              <tr>
                <th className="border p-2 text-left">Mission</th>
                <th className="border p-2 text-left">Date</th>
                <th className="border p-2 text-left">Start</th>
                <th className="border p-2 text-left">End</th>
                <th className="border p-2 text-left">Fellow Soldiers</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={`${it.mission_id}-${it.slot_date}-${it.start_time}`}>
                  <td className="border p-2">{it.mission_name}</td>
                  <td className="border p-2">{it.slot_date || ""}</td>
                  <td className="border p-2">{it.start_time || ""}</td>
                  <td className="border p-2">{it.end_time || ""}</td>
                  <td className="border p-2">
                    {it.fellow_soldiers && it.fellow_soldiers.length > 0 ? it.fellow_soldiers.join(", ") : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}
