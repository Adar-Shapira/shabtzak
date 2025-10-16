// shabtzak-ui\src\api.ts
import axios, { AxiosError } from "axios";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:8000",
  // withCredentials: true, // enable if you later add cookies/auth
});

// --- Types ------------------------------------------------------------------

export type Mission = {
  id: number;
  name: string;
  // start/end are optional (backend may return null)
  start_hour?: string | null; // "HH:MM:SS" | null
  end_hour?: string | null;   // "HH:MM:SS" | null
  required_soldiers: number;
  required_commanders: number;
  required_officers: number;
  required_drivers: number;
};

export type MissionCreate = {
  name: string;
  required_soldiers?: number;
  required_commanders?: number;
  required_officers?: number;
  required_drivers?: number;
  // optional, usually omitted now
  start_hour?: string | null; // "HH:MM" | "HH:MM:SS" | null
  end_hour?: string | null;   // "HH:MM" | "HH:MM:SS" | null
};

export type MissionUpdate = Partial<MissionCreate>;

export type MissionSlot = {
  id: number;
  mission_id: number;
  start_time: string; // "HH:MM:SS"
  end_time: string;   // "HH:MM:SS"
};

// --- Small time helpers -----------------------------------------------------

/** If input is "HH:MM", returns "HH:MM:SS". If null/undefined, returns null. */
export function withSeconds(t?: string | null): string | null {
  if (!t) return null;
  return t.length === 5 ? `${t}:00` : t;
}

/** Safe "HH:MM" view for possibly null/undefined "HH:MM:SS". */
export function hhmm(iso?: string | null): string {
  if (!iso) return "—";
  return iso.slice(0, 5);
}

// --- Missions ---------------------------------------------------------------

export async function listMissions(): Promise<Mission[]> {
  const { data } = await api.get<Mission[]>("/missions");
  return data;
}

export async function createMission(payload: MissionCreate): Promise<Mission> {
  // Normalize times to include seconds if provided
  const body: MissionCreate = {
    ...payload,
    start_hour: withSeconds(payload.start_hour),
    end_hour: withSeconds(payload.end_hour),
  };
  const { data } = await api.post<Mission>("/missions", body);
  return data;
}

export async function updateMission(id: number, payload: MissionUpdate): Promise<Mission> {
  const body: MissionUpdate = {
    ...payload,
    start_hour: withSeconds(payload.start_hour ?? undefined),
    end_hour: withSeconds(payload.end_hour ?? undefined),
  };
  const { data } = await api.patch<Mission>(`/missions/${id}`, body);
  return data;
}

export async function deleteMission(id: number): Promise<void> {
  await api.delete(`/missions/${id}`);
}

// --- Mission Slots ----------------------------------------------------------

export async function listMissionSlots(missionId: number): Promise<MissionSlot[]> {
  const { data } = await api.get(`/missions/${missionId}/slots`);
  return data;
}

export async function createMissionSlot(
  missionId: number,
  payload: { start_time: string; end_time: string } // "HH:MM" or "HH:MM:SS"
): Promise<MissionSlot> {
  const body = {
    start_time: withSeconds(payload.start_time),
    end_time: withSeconds(payload.end_time),
  };
  const { data } = await api.post(`/missions/${missionId}/slots`, body);
  return data;
}

export async function deleteMissionSlot(missionId: number, slotId: number): Promise<void> {
  await api.delete(`/missions/${missionId}/slots/${slotId}`);
}

// --- Optional: simple error helper -----------------------------------------

export function getErrorMessage(err: unknown, fallback = "Something went wrong") {
  const e = err as AxiosError<any>;
  return e?.response?.data?.detail ?? e?.message ?? fallback;
}
