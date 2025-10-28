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
  total_needed?: number | null;
};

export type MissionCreate = {
  name: string;
  total_needed?: number | null;
};

export type MissionUpdate = Partial<MissionCreate>;

export type MissionSlot = {
  id: number;
  mission_id: number;
  start_time: string; // "HH:MM:SS"
  end_time: string;   // "HH:MM:SS"
};

export type MissionRequirement = {
  id: number;
  role_id: number;
  role_name: string;
  count: number;
};

export type MissionRequirementsBatch = {
  total_needed?: number | null;
  requirements: MissionRequirement[];
};

export async function getMissionRequirements(missionId: number): Promise<MissionRequirementsBatch> {
  // Fetch requirements list
  const { data } = await api.get<MissionRequirement[]>(`/missions/${missionId}/requirements`);
  return { total_needed: null, requirements: data };
}

export async function putMissionRequirements(
  missionId: number,
  payload: MissionRequirementsBatch
): Promise<MissionRequirementsBatch[]> {
  const { data } = await api.put(`/missions/${missionId}/requirements`, payload);
  return data as MissionRequirementsBatch[];
}

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
  const { data } = await api.post<Mission>("/missions", payload);
  return data;
}

export async function updateMission(id: number, payload: MissionUpdate): Promise<Mission> {
  const { data } = await api.patch<Mission>(`/missions/${id}`, payload);
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

export type Soldier = {
  id: number;
  name: string;
  department_id?: number | null;
  roles?: Array<{ id: number; name: string }>;
};

export async function listSoldiers(): Promise<Soldier[]> {
  const { data } = await api.get("/soldiers");
  return data;
}

type ReassignPayload = {
  assignment_id: number;
  soldier_id: number;
  ignore_rules?: boolean; // optional for backward compatibility
};

export async function reassignAssignment(payload: ReassignPayload) {
  const body = { ignore_rules: true, ...payload };
  const { data } = await api.post("/assignments/reassign", body);
  return data;
}

export async function getSoldierMissionRestrictions(soldierId: number): Promise<{ soldier_id: number; mission_ids: number[] }> {
  const { data } = await api.get(`/soldiers/${soldierId}/mission_restrictions`);
  return data;
}

export async function putSoldierMissionRestrictions(soldierId: number, missionIds: number[]): Promise<{ soldier_id: number; mission_ids: number[] }> {
  const { data } = await api.put(`/soldiers/${soldierId}/mission_restrictions`, { mission_ids: missionIds });
  return data;
}

export type MissionHistoryItem = {
  mission_id: number
  mission_name: string
  slot_date?: string
  start_time?: string
  end_time?: string
  fellow_soldiers: string[]
}

export async function getSoldierMissionHistory(soldierId: number): Promise<MissionHistoryItem[]> {
  const res = await api.get(`/soldiers/${soldierId}/mission-history`)
  return res.data as MissionHistoryItem[]
}

// keep your existing imports and api instance

export type PlannerWarning = {
  type: "RESTRICTED" | "OVERLAP" | "REST";
  level?: 'RED' | 'ORANGE';
  soldier_id: number;
  soldier_name: string;
  mission_id: number;
  mission_name: string;
  start_at: string;
  end_at: string;
  details: string | null;
  assignment_id?: number | null; // NEW
};

// UPDATED: now accepts the plan day and sends it as a query param
export async function getPlannerWarnings(day: string): Promise<PlannerWarning[]> {
  const { data } = await api.get<PlannerWarning[]>("/plan/warnings", {
    params: { day }, // <-- critical line
  });
  return data;
}

export async function clearPlan(day: string, missionIds?: number[], lockedAssignmentIds?: number[]): Promise<void> {
  const body: any = { day };
  if (Array.isArray(missionIds) && missionIds.length > 0) {
    body.mission_ids = missionIds;
  }
  if (Array.isArray(lockedAssignmentIds) && lockedAssignmentIds.length > 0) {
    body.locked_assignment_ids = lockedAssignmentIds;
  }
  await api.post("/assignments/clear", body);
}

export type Vacation = {
  id?: number;
  soldier_id: number;
  start_date: string; // YYYY-MM-DD
  end_date: string;   // YYYY-MM-DD
};

export async function listSoldierVacations(soldierId: number): Promise<Vacation[]> {
  const r = await api.get(`/vacations/soldiers/${soldierId}`);
  return r.data as Vacation[];
}

export async function createAssignment(payload: {
  day: string;              // "YYYY-MM-DD"
  mission_id: number;
  role_id?: number | null;  // optional/nullable
  start_time: string;       // "HH:MM"
  end_time: string;         // "HH:MM"
  soldier_id?: number | null;
}) {
  const { data } = await api.post("/assignments/create", payload);
  return data; // should match FlatRosterItem-ish shape
}

export async function deleteAssignment(id: number) {
  await api.delete(`/assignments/${id}`);
}

export async function unassignAssignment(payload: { assignment_id: number }): Promise<{ id: number; soldier_id: number | null; soldier_name: string | null; }> {
  const { data } = await api.post("/plan/unassign_assignment", payload);
  return data;
}
