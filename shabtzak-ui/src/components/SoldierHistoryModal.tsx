// shabtzak-ui\src\components\SoldierHistoryModal.tsx
import { useEffect, useState } from "react"
import Modal from "./Modal"
import {
  api,
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

// "YYYY-MM-DD HH:MM" formatter from ISO-ish strings we get from the API
function toYMDHM(isoLike: string | undefined | null): string {
  if (!isoLike) return ""
  // Prefer strings that already include local offset (start_local/end_local)
  // Examples: "2025-10-22T14:00:00+03:00" -> "2025-10-22 14:00"
  //           "2025-10-22T14:00:00Z"      -> "2025-10-22 14:00"
  //           "2025-10-22 14:00"          -> stays as-is
  const s = String(isoLike)
  // If already "YYYY-MM-DD HH:MM"
  if (s.length >= 16 && s[4] === "-" && (s[10] === " " || s[10] === "T")) {
    const datePart = s.slice(0, 10)
    const timePart = s.slice(11, 16)
    return `${datePart} ${timePart}`
  }
  return s
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
  const [rostersByDay, setRostersByDay] = useState<Map<string, any[]>>(new Map())
  const [slotsByMission, setSlotsByMission] = useState<Map<number, MissionSlot[]>>(new Map())

  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    setLoading(true)
    setError(null)

    ;(async () => {
        try {
        const hist = await getSoldierMissionHistory(soldierId)
        if (cancelled) return
        setItems(hist)

        // Gather unique dates from history
        const dates = Array.from(new Set(hist.map(h => h.slot_date).filter(Boolean))) as string[]

        // Fetch the roster for each date and store in a Map
        const entries: Array<[string, any[]]> = []
        for (const d of dates) {
            try {
            const { data } = await api.get("/assignments/day-roster", { params: { day: d } })
            const arr = Array.isArray(data?.items) ? data.items : []
            entries.push([d, arr])
            } catch {
            entries.push([d, []])
            }
        }
        if (!cancelled) {
            setRostersByDay(new Map(entries))
        }
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
                <th className="border p-2 text-left">Time Slot</th>
                <th className="border p-2 text-left">Fellow Soldiers</th>
              </tr>
            </thead>
            <tbody>
            {items.map((it) => {
                // Try to find the exact assignment row for this soldier, mission, and date
                const dayISO = it.slot_date || ""
                const dayRoster = rostersByDay.get(dayISO) || []
                const match = dayRoster.find((r: any) =>
                r?.soldier_id === soldierId &&
                (r?.mission?.id === it.mission_id)
                )

                let startLabel = ""
                let endLabel = ""

                if (match) {
                // Prefer server-provided local timestamps if present
                const sLocal = match.start_local || match.start_at
                const eLocal = match.end_local || match.end_at
                startLabel = toYMDHM(sLocal)
                endLabel = toYMDHM(eLocal)
                } else {
                // Fallback to raw history times if no roster match found
                // This keeps the UI populated even in rare mismatch cases
                startLabel = dayISO && it.start_time ? `${dayISO} ${String(it.start_time).slice(0,5)}` : ""
                endLabel = dayISO && it.end_time ? `${dayISO} ${String(it.end_time).slice(0,5)}` : ""
                }

                const timeSlot = startLabel && endLabel ? `${startLabel} → ${endLabel}` : ""

                return (
                <tr key={`${it.mission_id}-${it.slot_date}-${it.start_time}`}>
                    <td className="border p-2">{it.mission_name}</td>
                    <td className="border p-2">{timeSlot}</td>
                    <td className="border p-2">
                    {it.fellow_soldiers?.length ? it.fellow_soldiers.join(", ") : ""}
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
