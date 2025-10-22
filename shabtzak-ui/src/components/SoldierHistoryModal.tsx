// shabtzak-ui\src\components\SoldierHistoryModal.tsx
import { useEffect, useState } from "react"
import Modal from "./Modal"
import {
  getSoldierMissionHistory,
  listMissionSlots,
  type MissionHistoryItem,
  type MissionSlot,
} from "../api"


type Props = {
  soldierId: number
  soldierName: string
  isOpen: boolean
  onClose: () => void
}

// "HH:MM" from "HH:MM:SS"
function hhmm(hhmmss: string | null | undefined): string {
  if (!hhmmss) return ""
  return hhmmss.slice(0, 5)
}

// Is a slot overnight based on start/end "HH:MM:SS"
function isOvernight(startHHMMSS: string, endHHMMSS: string): boolean {
  return startHHMMSS.slice(0, 5) > endHHMMSS.slice(0, 5)
}

// Convert YYYY-MM-DD + "HH:MM:SS" to local epoch ms (no timezones involved)
function msFor(dayISO: string, hhmmss: string): number {
  const [y, m, d] = dayISO.split("-").map(Number)
  const [hh, mm] = hhmmss.slice(0, 5).split(":").map(Number)
  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0).getTime()
}

// Overlap length in ms between [a,b) and [c,d)
function overlapMs(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  const lo = Math.max(aStart, bStart)
  const hi = Math.min(aEnd, bEnd)
  return Math.max(0, hi - lo)
}

export default function SoldierHistoryModal({ soldierId, soldierName, isOpen, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<MissionHistoryItem[]>([])
  const [slotsByMission, setSlotsByMission] = useState<Map<number, MissionSlot[]>>(new Map())

  useEffect(() => {
    if (!isOpen) return
    let cancelled = false

    ;(async () => {
        setLoading(true)
        setError(null)
        try {
        const history = await getSoldierMissionHistory(soldierId)
        if (cancelled) return

        setItems(history)

        // Collect unique mission ids
        const missionIds = Array.from(
            new Set(history.map(h => h.mission_id).filter((v): v is number => typeof v === "number"))
        )

        // Load slots for those missions
        const entries: Array<[number, MissionSlot[]]> = await Promise.all(
            missionIds.map(async (mid) => {
            try {
                const slots = await listMissionSlots(mid)
                return [mid, slots] as [number, MissionSlot[]]
            } catch {
                return [mid, []] as [number, MissionSlot[]]
            }
            })
        )

        if (cancelled) return
        setSlotsByMission(new Map(entries))
        } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load history")
        } finally {
        if (!cancelled) setLoading(false)
        }
    })()

    return () => {
        cancelled = true
    }
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
            {items.map((it) => {
                // Fallbacks
                const dayISO = it.slot_date || ""
                const rawStart = it.start_time || ""
                const rawEnd = it.end_time || ""

                // Default display (raw) if we fail to match any slot
                let displayStart = hhmm(rawStart)
                let displayEnd = hhmm(rawEnd)

                // Try to snap to the best-overlapping MissionSlot for this mission & date
                if (it.mission_id && dayISO && rawStart && rawEnd) {
                const slots = slotsByMission.get(it.mission_id) || []
                const rowStartMs = msFor(dayISO, rawStart)
                const rowEndMs   = msFor(isOvernight(rawStart, rawEnd) ? dayISO /* overnight handled below */ : dayISO, rawEnd)
                // If overnight by times, the end is on next day
                const rowEndFixed = isOvernight(rawStart, rawEnd) ? rowEndMs + 24 * 60 * 60 * 1000 : rowEndMs

                let bestIdx = -1
                let bestOv = -1

                for (let i = 0; i < slots.length; i++) {
                    const s = slots[i]
                    const sStartMs = msFor(dayISO, s.start_time)
                    const sEndBase = msFor(isOvernight(s.start_time, s.end_time) ? dayISO : dayISO, s.end_time)
                    const sEndMs   = isOvernight(s.start_time, s.end_time) ? sEndBase + 24 * 60 * 60 * 1000 : sEndBase
                    const ov = overlapMs(rowStartMs, rowEndFixed, sStartMs, sEndMs)
                    if (ov > bestOv) {
                    bestOv = ov
                    bestIdx = i
                    }
                }

                if (bestIdx >= 0 && bestOv > 0) {
                    const best = slots[bestIdx]
                    displayStart = hhmm(best.start_time)
                    displayEnd   = hhmm(best.end_time)
                }
                }

                return (
                <tr key={`${it.mission_id}-${it.slot_date}-${it.start_time}`}>
                    <td className="border p-2">{it.mission_name}</td>
                    <td className="border p-2">{dayISO}</td>
                    <td className="border p-2">{displayStart}</td>
                    <td className="border p-2">{displayEnd}</td>
                    <td className="border p-2">
                    {it.fellow_soldiers && it.fellow_soldiers.length > 0 ? it.fellow_soldiers.join(", ") : ""}
                    </td>
                </tr>
                )
            })}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}
