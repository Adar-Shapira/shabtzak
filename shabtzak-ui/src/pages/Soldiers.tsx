// shabtzak-ui/src/pages/Soldiers.tsx
import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { api } from "../api";
import Modal from "../components/Modal";
import { useDisclosure } from "../hooks/useDisclosure";
import { listMissions, getSoldierMissionRestrictions, putSoldierMissionRestrictions, type Mission } from "../api";
import SoldierHistoryModal from "../components/SoldierHistoryModal"


type Role = { 
    id: number; 
    name: string; 
 };

type Department = { 
    id: number; 
    name: string 
};

type Vacation = {
    id: number;
    soldier_id: number;
    start_date: string; // ISO yyyy-mm-dd
    end_date: string;   // ISO yyyy-mm-dd
    note?: string | null;
};

type Soldier = {
    id: number;
    name: string;
    roles: { id: number; name: string }[];  // ← server already returns this
    department_id?: number | null;
    department_name?: string | null;
    restrictions: string;
    restrictions_tokens?: string[];
};


function tokensToArray(s: string | undefined | null): string[] {
    if (!s) return [];
    return s.split(/[;,]/).map(x => x.trim()).filter(Boolean);
}

function byName(a: Soldier, b: Soldier) {
  return a.name.localeCompare(b.name);
}

export default function SoldiersPage() {
    const [roles, setRoles] = useState<Role[]>([]);
    const [departments, setDepartments] = useState<Department[]>([]);
    const [missions, setMissions] = useState<Mission[]>([]);
    const restrictionOptions = useMemo(
        () => Array.from(new Set(missions.map(m => m.name))).sort(), [missions]);

    const [soldiers, setSoldiers] = useState<Soldier[]>([]);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const addDlg = useDisclosure(false);

    // CREATE
    const [newName, setNewName] = useState("");
    const [newRoleIds, setNewRoleIds] = useState<number[]>([]);
    const [newDeptId, setNewDeptId] = useState<number | "">("");
    const [newRestrictions, setNewRestrictions] = useState<string[]>([]);

    // EDIT
    const [editId, setEditId] = useState<number | null>(null);
    const [editName, setEditName] = useState("");
    const [editRoleIds, setEditRoleIds] = useState<number[]>([]);
    const [editDeptId, setEditDeptId] = useState<number | "">("");
    const [editRestrictions, setEditRestrictions] = useState<string[]>([]);

    // --- Department CRUD (moved from Departments page) ---
    const deptDlg = useDisclosure(false);           // controls the add/edit department modal
    const [deptEditId, setDeptEditId] = useState<number | null>(null);
    const [deptName, setDeptName] = useState("");  // input for add/rename

    const [allMissions, setAllMissions] = useState<Mission[]>([]);
    const [savingRestr, setSavingRestr] = useState<number | null>(null); // soldier id being saved
    const [restrCache, setRestrCache] = useState<Record<number, number[]>>({}); // soldier_id -> mission_ids

    const restrDlg = useDisclosure(false);
    const [restrSoldier, setRestrSoldier] = useState<Soldier | null>(null);

    const [historyFor, setHistoryFor] = useState<{ id: number; name: string } | null>(null)


    const openRestrictions = async (s: Soldier) => {
    setErr(null);
    setRestrSoldier(s);
    if (!restrCache[s.id]) {
        try {
        const res = await getSoldierMissionRestrictions(s.id);
        setRestrCache(prev => ({ ...prev, [s.id]: res.mission_ids }));
        } catch {
        setRestrCache(prev => ({ ...prev, [s.id]: [] }));
        }
    }
    restrDlg.open();
    };

    const closeRestrictions = () => {
    setRestrSoldier(null);
    restrDlg.close();
    };

    useEffect(() => {
    listMissions().then(setAllMissions).catch(() => setAllMissions([]));
    }, []);

    const startAddDept = () => {
    setDeptEditId(null);
    setDeptName("");
    deptDlg.open();
    };

    const startEditDept = (id: number, name: string) => {
    setDeptEditId(id);
    setDeptName(name);
    deptDlg.open();
    };

    const cancelDeptDialog = () => {
    setDeptEditId(null);
    setDeptName("");
    deptDlg.close();
    };

    const saveDept = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
        if (deptEditId == null) {
        // create
        await api.post("/departments", { name: deptName.trim() });
        } else {
        // rename
        await api.patch(`/departments/${deptEditId}`, { name: deptName.trim() });
        }
        cancelDeptDialog();
        await loadAll(); // refresh groups and selects
    } catch (e: any) {
        setErr(e?.response?.data?.detail ?? "Failed to save department");
    }
    };

    const deleteDept = async (id: number, name: string) => {
    if (!confirm(`Delete department "${name}"? (blocked if soldiers are assigned)`)) return;
    setErr(null);
    try {
        await api.delete(`/departments/${id}`);
        await loadAll();
    } catch (e: any) {
        setErr(e?.response?.data?.detail ?? "Failed to delete department");
    }
    };

    // --- Roles CRUD (moved from Roles page) ---
    const rolesDlg = useDisclosure(false);
    const [roleEditId, setRoleEditId] = useState<number | null>(null);
    const [roleName, setRoleName] = useState("");
    const [isRoleFormOpen, setIsRoleFormOpen] = useState(false);

    const startAddRole = () => {
    setRoleEditId(null);
    setRoleName("");
    setIsRoleFormOpen(true);
    rolesDlg.open();
    };

    const startEditRole = (id: number, name: string) => {
    setRoleEditId(id);
    setRoleName(name);
    setIsRoleFormOpen(true);
    rolesDlg.open();
    };

    const cancelRoleDialog = () => {
    setRoleEditId(null);
    setRoleName("");
    setIsRoleFormOpen(false);
    rolesDlg.close();
    };

    const saveRole = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
        if (roleEditId == null) {
        await api.post("/roles", { name: roleName.trim() });
        } else {
        await api.patch(`/roles/${roleEditId}`, { name: roleName.trim() });
        }
        // reset + refresh
        setIsRoleFormOpen(false);
        setRoleEditId(null);
        setRoleName("");
        await loadAll();
    } catch (e: any) {
        setErr(e?.response?.data?.detail ?? "Failed to save role");
    }
    };

    const deleteRole = async (id: number, name: string) => {
    if (!confirm(`Delete role "${name}"? (blocked if assigned to soldiers)`)) return;
    setErr(null);
    try {
        await api.delete(`/roles/${id}`);
        await loadAll();
    } catch (e: any) {
        setErr(e?.response?.data?.detail ?? "Failed to delete role");
    }
    };

    // --- Vacations per Soldier ---
    const vacDlg = useDisclosure(false);
    const [vacSoldier, setVacSoldier] = useState<Soldier | null>(null);
    const [vacations, setVacations] = useState<Vacation[]>([]);

    // vacation form state
    const [vacEditId, setVacEditId] = useState<number | null>(null);
    const [vacStart, setVacStart] = useState<string>("");
    const [vacEnd, setVacEnd] = useState<string>("");
    const [vacNote, setVacNote] = useState<string>("");

    const openVacations = async (s: Soldier) => {
        setErr(null);
        setVacSoldier(s);

        // Reset form
        setVacEditId(null);
        setVacStart("");
        setVacEnd("");
        setVacNote("");

        await fetchVacations(s.id);   // load first
        vacDlg.open();                // then open with data already in state
    };

    const closeVacations = () => {
    setVacSoldier(null);
    setVacations([]);
    setVacEditId(null);
    setVacStart("");
    setVacEnd("");
    setVacNote("");
    vacDlg.close();
    };

    const startAddVacation = () => {
    setVacEditId(null);
    setVacStart("");
    setVacEnd("");
    setVacNote("");
    };

    const startEditVacation = (v: Vacation) => {
    setVacEditId(v.id);
    setVacStart(v.start_date);
    setVacEnd(v.end_date);
    setVacNote(v.note ?? "");
    };

    const saveVacation = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!vacSoldier) return;

        if (vacStart && vacEnd && vacEnd < vacStart) {
            alert("End date cannot be before start date.");
            return;
        }

        setErr(null);
        try {
            const payload = { start_date: vacStart, end_date: vacEnd, note: vacNote || null };

            if (vacEditId == null) {
            // CREATE
            let created: Vacation | null = null;
            try {
                const r = await api.post(`/soldiers/${vacSoldier.id}/vacations`, payload);
                created = r.data as Vacation;
            } catch (e: any) {
                if (e?.response?.status === 404) {
                const r = await api.post(`/vacations`, { ...payload, soldier_id: vacSoldier.id });
                created = r.data as Vacation;
                } else {
                throw e;
                }
            }

            // If backend returned the created row, update immediately; otherwise hard refresh.
            if (created && created.id) {
                setVacations(prev => [...prev, created!]);
            } else {
                await fetchVacations(vacSoldier.id);
            }
            } else {
            // UPDATE
            let updated: Vacation | null = null;
            try {
                const r = await api.patch(`/soldiers/${vacSoldier.id}/vacations/${vacEditId}`, payload);
                updated = r.data as Vacation;
            } catch (e: any) {
                if (e?.response?.status === 404) {
                const r = await api.patch(`/vacations/${vacEditId}`, { ...payload, soldier_id: vacSoldier.id });
                updated = r.data as Vacation;
                } else {
                throw e;
                }
            }

            // If backend returned the updated row, merge it; otherwise hard refresh.
            if (updated && updated.id) {
                setVacations(prev => prev.map(v => (v.id === updated!.id ? updated! : v)));
            } else {
                await fetchVacations(vacSoldier.id);
            }
            }

            // Reset form
            setVacEditId(null);
            setVacStart("");
            setVacEnd("");
            setVacNote("");

        } catch (e: any) {
            setErr(e?.response?.data?.detail ?? "Failed to save vacation");
        }
    };

    const fetchVacations = async (soldierId: number) => {
        // helper to normalize IDs to numbers (handles string/number mismatches)
        const sameId = (x: any, y: any) => Number(x) === Number(y);

        try {
            // 1) Try soldier-scoped endpoint
            try {
            const r = await api.get(`/soldiers/${soldierId}/vacations`, { params: { t: Date.now() } });
            const payload = r.data ?? [];
            const items = Array.isArray(payload) ? payload : (payload.items ?? payload.results ?? []);
            // Even if the API misbehaves, enforce client-side filter:
            setVacations(items.filter((v: Vacation) => sameId(v.soldier_id, soldierId)));

            return;
            } catch (_e) {
            // fall through
            }

            // 2) Try global endpoint with common param names
            const tryGlobal = async (param: string) => {
            const r = await api.get(`/vacations`, { params: { [param]: soldierId, t: Date.now() } });
            const payload = r.data ?? [];
            const items = Array.isArray(payload) ? payload : (payload.items ?? payload.results ?? []);
            // Force client-side filter in case the backend ignores the param:
            setVacations(items.filter((v: Vacation) => sameId(v.soldier_id, soldierId)));

            return true;
            };

            const ok =
            (await tryGlobal("soldier_id").catch(() => false)) ||
            (await tryGlobal("soldierId").catch(() => false)) ||
            (await tryGlobal("sid").catch(() => false));

            if (!ok) {
            setErr("Failed to load vacations: no matching endpoint");
            // Keep whatever we had; don't clear the list
            }
        } catch (e: any) {
            setErr(e?.response?.data?.detail ?? "Failed to load vacations");
        } finally {
        }
    };

    const deleteVacation = async (v: Vacation) => {
        if (!vacSoldier) return;
        if (!confirm(`Delete vacation ${v.start_date} → ${v.end_date}?`)) return;
        setErr(null);
        try {
            let ok = false;
            try {
            const r = await api.delete(`/soldiers/${vacSoldier.id}/vacations/${v.id}`);
            ok = r.status >= 200 && r.status < 300;
            } catch (e: any) {
            if (e?.response?.status === 404) {
                const r = await api.delete(`/vacations/${v.id}`);
                ok = r.status >= 200 && r.status < 300;
            } else {
                throw e;
            }
            }
            // Optimistic remove
            if (ok) {
            setVacations(prev => prev.filter(x => x.id !== v.id));
            } else {
            await fetchVacations(vacSoldier.id);
            }
        } catch (e: any) {
            setErr(e?.response?.data?.detail ?? "Failed to delete vacation");
        }
    };

    // DELETE
    const removeSoldier = async (id: number) => {
        if (!confirm("Delete this soldier? (blocked if they have assignments)")) return;
        setErr(null);
        try {
            await api.delete(`/soldiers/${id}`);
            await loadAll();
        } catch (e: any) {
            setErr(e?.response?.data?.detail ?? "Failed to delete soldier");
        }
    };

    const loadAll = async () => {
        setLoading(true); setErr(null);
        try {
            const [r, d, s, m] = await Promise.all([
                api.get<Role[]>("/roles"),
                api.get<Department[]>("/departments"),
                api.get<Soldier[]>("/soldiers"),
                api.get<Mission[]>("/missions"),
            ]);
            setRoles(r.data);
            setDepartments(d.data);
            setSoldiers(s.data as Soldier[]);
            setMissions(m.data.map(x => ({ id: x.id, name: x.name })));
        } catch (e: any) {
            setErr(e?.response?.data?.detail ?? "Failed to load data");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadAll(); }, []);

    // Always refresh the list whenever the Vacations modal opens
    useEffect(() => {
        if (vacDlg.isOpen && vacSoldier) {
            fetchVacations(vacSoldier.id);
        }
    }, [vacDlg.isOpen, vacSoldier?.id]);

    // Build a department → soldiers map that also includes empty departments
    const { groupsByDeptId, unassigned } = useMemo(() => {
        const byId = new Map<number, Soldier[]>();
        // Ensure every known department exists, even if empty
        for (const d of departments) byId.set(d.id, []);

        const none: Soldier[] = [];
        for (const s of soldiers) {
            if (s.department_id != null && byId.has(s.department_id)) {
            byId.get(s.department_id)!.push(s);
            } else {
            // includes null/undefined or stale dept_id not in list
            none.push(s);
            }
        }
        // sort each department’s soldiers
        for (const [, arr] of byId) arr.sort(byName);
        none.sort(byName);

        return { groupsByDeptId: byId, unassigned: none };
        }, [departments, soldiers]);

        // Sorted departments A→Z (drive UI from departments, not soldiers)
        const sortedDepartments = useMemo(
        () => [...departments].sort((a, b) => a.name.localeCompare(b.name)),
        [departments]
    );

    // helpers for <select multiple>
    const onMultiChangeStrings = (ev: React.ChangeEvent<HTMLSelectElement>, setState: (vals: string[]) => void) => {
        const opts = Array.from(ev.target.selectedOptions).map(o => String(o.value));
        setState(opts);
    };

    // CREATE
    const createSoldier = async (e: React.FormEvent) => {
        e.preventDefault();
        setErr(null);
        try {
            await api.post("/soldiers", {
            name: newName.trim(),
            role_ids: newRoleIds,
            department_id: newDeptId === "" ? null : Number(newDeptId),   // ← null instead of 0
            restrictions: newRestrictions,
            });

            // resets:
            setNewName("");
            setNewRoleIds([]);
            setNewDeptId("");
            setNewRestrictions([]);
            addDlg.close();
            await loadAll();

        } catch (e: any) {
            setErr(e?.response?.data?.detail ?? "Failed to create soldier");
        }
    };



    // EDIT
    const startEdit = (s: Soldier) => {
        setEditId(s.id);
        setEditName(s.name);
        setEditRoleIds((s.roles ?? []).map(r => r.id));   // ← use roles array
        setEditDeptId(s.department_id ?? "");
        setEditRestrictions(s.restrictions_tokens ?? tokensToArray(s.restrictions));
    };


    const cancelEdit = () => {
        setEditId(null);
        setEditName("");
        setEditRoleIds([]);          // ← reset roles
        setEditDeptId("");
        setEditRestrictions([]);
    };


    const saveEdit = async (id: number) => {
        try {
            await api.patch(`/soldiers/${id}`, {
                name: editName.trim(),
                role_ids: editRoleIds,
                department_id: editDeptId === "" ? null : Number(editDeptId),   // ← null instead of 0
                restrictions: editRestrictions,
            });


            setEditId(null);
            await loadAll();
        } catch (e: any) {
            setErr(e?.response?.data?.detail ?? "Failed to update soldier");
        }   
    };

    return (
        <div style={{ maxWidth: 1200, margin: "24px auto", padding: 16, fontFamily: "sans-serif" }}>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <h1>חיילים</h1>
                <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => rolesDlg.open()} style={{ padding: "8px 12px", borderRadius: 8 }}>
                    נהל תפקידים
                    </button>
                    <button onClick={startAddDept} style={{ padding: "8px 12px", borderRadius: 8 }}>
                    הוסף מחלקה
                    </button>
                    <button onClick={addDlg.open} style={{ padding: "8px 12px", borderRadius: 8 }}>
                    הוסף חייל
                    </button>
                </div>
            </div>

            <Modal open={addDlg.isOpen} onClose={addDlg.close} title="Add Soldier" maxWidth={720}>
                <form
                    onSubmit={createSoldier}
                    style={{ display: "grid", gridTemplateColumns: "1.6fr 1.2fr 1.2fr 1.2fr auto", gap: 10 }}
                >
                    <input value={newName} onChange={(e)=>setNewName(e.target.value)} placeholder="Full name" required />

                    {/* Roles multi */}
                    <div>
                    <div style={{ fontSize: 12, opacity:.8, marginBottom: 4 }}>תפקיד</div>
                    <select
                        multiple
                        size={5}
                        value={newRoleIds.map(String)}
                        onChange={(e) => {
                        const selected = Array.from(e.target.selectedOptions).map(o => Number(o.value));
                        setNewRoleIds(selected);
                        }}
                        style={{ width: "100%" }}
                    >
                        {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                    </div>

                    {/* Department */}
                    <div>
                    <div style={{ fontSize: 12, opacity:.8, marginBottom: 4 }}>מחלקה</div>
                    <select value={newDeptId} onChange={(e)=>setNewDeptId(e.target.value ? Number(e.target.value) : "")} style={{ width: "100%" }}>
                        <option value="">(-)</option>
                        {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                    </div>

                    {/* Restrictions */}
                    <div>
                    <div style={{ fontSize: 12, opacity:.8, marginBottom: 4 }}>הגבלות</div>
                    <select multiple size={5} value={newRestrictions} onChange={(e)=>onMultiChangeStrings(e, setNewRestrictions)} style={{ width: "100%" }}>
                        {restrictionOptions.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                    </div>

                    <div style={{ alignSelf: "end", display: "flex", gap: 8 }}>
                    <button type="button" onClick={addDlg.close}>בטל</button>
                    <button type="submit">הוסף</button>
                    </div>
                </form>
            </Modal>

            {/* Add/Rename Department Modal */}
            <Modal open={deptDlg.isOpen} onClose={cancelDeptDialog} title={deptEditId == null ? "הוסף מחלקה" : "שנה שם"} maxWidth={480}>
                <form onSubmit={saveDept} style={{ display: "grid", gap: 10 }}>
                    <input
                    value={deptName}
                    onChange={(e) => setDeptName(e.target.value)}
                    placeholder="שם מחלקה"
                    required
                    />
                    <div style={{ display: "flex", justifyContent: "end", gap: 8 }}>
                        <button type="button" onClick={cancelDeptDialog}>בטל</button>
                        <button type="submit">{deptEditId == null ? "הוסף" : "שמור"}</button>
                    </div>
                </form>
            </Modal>

            {/* Roles Modal */}
            <Modal open={rolesDlg.isOpen} onClose={cancelRoleDialog} title="תפקיד" maxWidth={640}>
                <div style={{ display: "grid", gap: 12 }}>
                    {/* Toolbar */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 12, opacity: 0.75 }}>
                        נהל תפקידים
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={startAddRole}>הוסף תפקיד</button>
                        <button onClick={cancelRoleDialog}>סגור</button>
                    </div>
                    </div>

                    {/* When adding or editing, show the small form at top */}
                    {isRoleFormOpen && (
                        <form onSubmit={saveRole} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8, alignItems: "center", padding: 8, border: "1px solid #eee", borderRadius: 8 }}>
                            <input
                            value={roleName}
                            onChange={(e) => setRoleName(e.target.value)}
                            placeholder="תפקיד"
                            required
                            />
                            <div style={{ display: "flex", gap: 8 }}>
                            <button type="submit">{roleEditId == null ? "הוסף" : "שמור"}</button>
                            <button
                                type="button"
                                onClick={() => {
                                setIsRoleFormOpen(false);
                                setRoleEditId(null);
                                setRoleName("");
                                }}
                            >
                                Cancel
                            </button>
                            </div>
                        </form>
                    )}

                    {/* Roles list */}
                    <table width="100%" cellPadding={7} style={{ borderCollapse: "collapse" }}>
                    <thead>
                        <tr>
                        {/*<th align="left" style={{ width: 60 }}>ID</th>*/}
                        <th align="left">תפקיד</th>
                        <th align="left" style={{ width: 180 }}>פעולות</th>
                        </tr>
                    </thead>
                    <tbody>
                        {roles.map((r) => (
                        <tr key={r.id} style={{ borderTop: "1px solid #eee" }}>
                            <td>{r.id}</td>
                            <td>{r.name}</td>
                            <td>
                            <button onClick={() => startEditRole(r.id, r.name)}>ערוך</button>
                            <button
                                onClick={() => deleteRole(r.id, r.name)}
                                style={{ marginLeft: 8, color: "crimson" }}
                            >
                                מחק
                            </button>
                            </td>
                        </tr>
                        ))}
                        {roles.length === 0 && (
                        <tr>
                            <td colSpan={4} style={{ opacity: 0.7 }}>(-)</td>
                        </tr>
                        )}
                    </tbody>
                    </table>

                </div>
            </Modal>

            {/* Vacations Modal */}
            <Modal
            open={vacDlg.isOpen}
            onClose={closeVacations}
            title={vacSoldier ? `חופשות — ${vacSoldier.name}` : "חופשות"}
            maxWidth={720}
            >
                {!vacSoldier ? (
                    <div style={{ opacity: 0.7 }}>לא נבחר חייל</div>
                ) : (
                    <div style={{ display: "grid", gap: 12 }}>
                    {/* Toolbar */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ fontSize: 12, opacity: 0.75 }}>
                            הוסף טווח תאריכים בהם החייל בחופשה
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={startAddVacation}>הוסף</button>
                        <button onClick={closeVacations}>סגור</button>
                        </div>
                    </div>

                    {/* Add/Edit form */}
                    <form onSubmit={saveVacation} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 8, alignItems: "center" }}>
                        <div>
                        <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 4 }}>התחלה</div>
                        <input type="date" value={vacStart} onChange={(e) => setVacStart(e.target.value)} required />
                        </div>
                        <div>
                        <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 4 }}>סיום</div>
                        <input type="date" value={vacEnd} onChange={(e) => setVacEnd(e.target.value)} required />
                        </div>
                        <div>
                        <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 4 }}>הערות</div>
                        <input type="text" value={vacNote} onChange={(e) => setVacNote(e.target.value)} placeholder="Optional" />
                        </div>
                        <div style={{ display: "flex", gap: 8, alignItems: "end" }}>
                        <button type="submit">{vacEditId == null ? "הוסף" : "שמור"}</button>
                        {vacEditId != null && (
                            <button
                            type="button"
                            onClick={() => {
                                setVacEditId(null);
                                setVacStart("");
                                setVacEnd("");
                                setVacNote("");
                            }}
                            >
                            בטל
                            </button>
                        )}
                        </div>
                    </form>

                    <Modal
                    open={restrDlg.isOpen}
                    onClose={closeRestrictions}
                    title={restrSoldier ? `Mission Restrictions — ${restrSoldier.name}` : "Mission Restrictions"}
                    maxWidth={720}
                    >
                    {!restrSoldier ? (
                        <div style={{ opacity: 0.7 }}>לא נבחר חייל</div>
                    ) : (
                        <div style={{ display: "grid", gap: 12 }}>
                        <div style={{ fontSize: 12, opacity: 0.75 }}>
                            חיילים לא ישובצו למשימות שנבחרו
                        </div>

                        <div className="flex flex-wrap gap-2">
                            {allMissions.map((m) => {
                            const selected = (restrCache[restrSoldier.id] || []).includes(m.id);
                            return (
                                <label key={m.id} className="inline-flex items-center gap-1 border rounded px-2 py-1">
                                <input
                                    type="checkbox"
                                    checked={selected}
                                    onChange={(e) => {
                                    const next = new Set(restrCache[restrSoldier.id] || []);
                                    if (e.target.checked) next.add(m.id); else next.delete(m.id);
                                    setRestrCache(prev => ({ ...prev, [restrSoldier.id]: Array.from(next) }));
                                    }}
                                />
                                <span>{m.name}</span>
                                </label>
                            );
                            })}
                        </div>

                        <div style={{ display: "flex", justifyContent: "end", gap: 8 }}>
                            <button onClick={closeRestrictions}>סגור</button>
                            <button
                            onClick={async () => {
                                try {
                                if (!restrSoldier) return;
                                setSavingRestr(restrSoldier.id);
                                await putSoldierMissionRestrictions(restrSoldier.id, restrCache[restrSoldier.id] || []);
                                } finally {
                                setSavingRestr(null);
                                }
                            }}
                            className="border rounded px-3 py-1 text-sm hover:bg-gray-50 disabled:opacity-50"
                            disabled={!!(restrSoldier && savingRestr === restrSoldier.id)}
                            >
                            {restrSoldier && savingRestr === restrSoldier.id ? "בשמירה..." : "שמור"}
                            </button>
                        </div>
                        </div>
                    )}
                    </Modal>

                    {/* Vacations list */}
                    <table width="100%" cellPadding={7} style={{ borderCollapse: "collapse" }}>
                        <thead>
                        <tr>
                            {/*<th align="left" style={{ width: 60 }}>ID</th>*/}
                            <th align="left" style={{ width: 140 }}>התחלה</th>
                            <th align="left" style={{ width: 140 }}>סיום</th>
                            <th align="left">הערות</th>
                            <th align="left" style={{ width: 160 }}>פעולות</th>
                        </tr>
                        </thead>
                        <tbody>
                        {vacations.map((v) => (
                            <tr key={v.id} style={{ borderTop: "1px solid #eee" }}>
                            <td>{v.id}</td>
                            <td>{v.start_date}</td>
                            <td>{v.end_date}</td>
                            <td>{v.note ?? <span style={{ opacity: 0.6 }}>(אין)</span>}</td>
                            <td>
                                <button onClick={() => startEditVacation(v)}>ערוך</button>
                                <button onClick={() => deleteVacation(v)} style={{ marginLeft: 8, color: "crimson" }}>
                                מחק
                                </button>
                            </td>
                            </tr>
                        ))}
                        {vacations.length === 0 && (
                            <tr>
                            <td colSpan={5} style={{ opacity: 0.7 }}>(אין חופשות)</td>
                            </tr>
                        )}
                        </tbody>
                    </table>
                    </div>
                )}
            </Modal>

            {err && <div style={{ color: "crimson", marginBottom: 12 }}>{err}</div>}
            {loading && <div>בטעינה...</div>}

            {/* Grouped by Department (collapsible) */}
            {!loading && (
                <>
                    {!loading && departments.length === 0 && (
                    <div style={{ opacity: 0.7 }}>(אין מחלקות)</div>
                    )}

                    <div style={{ display: "grid", gap: 10 }}>
                    {sortedDepartments.map((dep) => {
                        const list = groupsByDeptId.get(dep.id) ?? [];
                        return (
                        <details
                            key={dep.id}
                            style={{ border: "1px solid #ddd", borderRadius: 10, padding: "8px 12px" }}
                        >
                            <summary style={{ cursor: "pointer", userSelect: "none" }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontWeight: 600 }}>{dep.name}</span>
                                <span style={{ opacity: 0.7, fontSize: 12 }}>({list.length})</span>
                                </div>
                                <div
                                onClick={(e) => e.preventDefault()} // avoid toggling <details> via buttons
                                style={{ display: "flex", gap: 8 }}
                                >
                                <button onClick={() => startEditDept(dep.id, dep.name)} title="Rename department">
                                    ערוך
                                </button>
                                <button
                                    onClick={() => deleteDept(dep.id, dep.name)}
                                    style={{ color: "crimson" }}
                                    title="Delete department"
                                >
                                    מחק
                                </button>
                                </div>
                            </div>
                            </summary>

                            <div style={{ marginTop: 8 }}>
                            {list.length === 0 ? (
                                <div style={{ border: "1px dashed #ddd", padding: 12, borderRadius: 8, opacity: 0.75 }}>
                                אין חיילים במחלקה
                                </div>
                            ) : (
                                <table width="100%" cellPadding={7} style={{ borderCollapse: "collapse" }}>
                                <thead>
                                    <tr>
                                    {/*<th align="left" style={{ width: 60 }}>ID</th>*/}
                                    <th align="left">שם</th>
                                    <th align="left" style={{ width: 320 }}>תפקיד</th>
                                    <th align="left" style={{ width: 220 }}>מחלקה</th>
                                    <th align="left" style={{ width: 260 }}>הגבלות</th>
                                    <th align="left" style={{ width: 160 }}>חופשות</th>
                                    <th align="left" style={{ width: 180 }}>פעולות</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {list.map((s) => {
                                    const isEditing = editId === s.id;
                                    return (
                                        <tr key={s.id} style={{ borderTop: "1px solid #eee" }}>
                                        {/*<td>{s.id}</td>*/}

                                        {/* name */}
                                        <td>
                                            {isEditing ? (
                                            <input
                                                value={editName}
                                                onChange={(e) => setEditName(e.target.value)}
                                                style={{ width: "100%" }}
                                            />
                                            ) : (
                                            s.name
                                            )}
                                        </td>

                                        {/* roles */}
                                        <td>
                                            {isEditing ? (
                                            <select
                                                multiple
                                                size={4}
                                                value={editRoleIds.map(String)}
                                                onChange={(e) => {
                                                const selected = Array.from(e.target.selectedOptions).map((o) => Number(o.value));
                                                setEditRoleIds(selected);
                                                }}
                                                style={{ width: "100%" }}
                                            >
                                                {roles.map((r) => (
                                                <option key={r.id} value={r.id}>{r.name}</option>
                                                ))}
                                            </select>
                                            ) : s.roles?.length ? (
                                            s.roles.map((r) => r.name).join(", ")
                                            ) : (
                                            <span style={{ opacity: 0.6 }}>(אין)</span>
                                            )}
                                        </td>

                                        {/* department (editable when editing) */}
                                        <td>
                                            {isEditing ? (
                                            <select
                                                value={editDeptId}
                                                onChange={(e) => setEditDeptId(e.target.value ? Number(e.target.value) : "")}
                                                style={{ width: "100%" }}
                                            >
                                                <option value="">(אין מחלקה)</option>
                                                {departments.map((d) => (
                                                <option key={d.id} value={d.id}>{d.name}</option>
                                                ))}
                                            </select>
                                            ) : (
                                            s.department_name ?? <span style={{ opacity: 0.6 }}>(אין)</span>
                                            )}
                                        </td>

                                        {/* restrictions */}
                                        <td>
                                            {isEditing ? (
                                            <select
                                                multiple
                                                size={3}
                                                value={editRestrictions}
                                                onChange={(e) => onMultiChangeStrings(e, setEditRestrictions)}
                                                style={{ width: "100%" }}
                                            >
                                                {restrictionOptions.map((n) => (
                                                <option key={n} value={n}>{n}</option>
                                                ))}
                                            </select>
                                            ) : s.restrictions_tokens && s.restrictions_tokens.length ? (
                                            s.restrictions_tokens.join(", ")
                                            ) : (
                                            <span style={{ opacity: 0.6 }}>(אין)</span>
                                            )}
                                        </td>

                                        {/* vacations */}
                                        <td>
                                            <button onClick={() => openVacations(s)}>חופשות</button>
                                        </td>
                                        <td>
                                            <button onClick={() => setHistoryFor({ id: s.id, name: s.name })}>
                                                היסטוריה
                                            </button>
                                        </td>
                                        {/* actions */}
                                        <td>
                                        {isEditing ? (
                                            <>
                                            <button onClick={() => saveEdit(s.id)}>שמור</button>
                                            <button onClick={cancelEdit} style={{ marginLeft: 8 }}>בטל</button>
                                            </>
                                        ) : (
                                            <>
                                            <button onClick={() => startEdit(s)} style={{ marginLeft: 8 }}>
                                                ערוך
                                            </button>
                                            <button
                                                onClick={() => removeSoldier(s.id)}
                                                style={{ marginLeft: 8, color: "crimson" }}
                                            >
                                                מחק
                                            </button>
                                            </>
                                        )}
                                        </td>
                                        </tr>
                                    );
                                    })}
                                </tbody>
                                </table>
                            )}
                            </div>
                        </details>
                        );
                    })}
                    </div>

                    {/* Optional: Unassigned section */}
                    {unassigned.length > 0 && (
                    <details style={{ border: "1px solid #ddd", borderRadius: 10, padding: "8px 12px", marginTop: 10 }}>
                        <summary style={{ cursor: "pointer", userSelect: "none" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontWeight: 600 }}>לא משובץ</span>
                            <span style={{ opacity: 0.7, fontSize: 12 }}>({unassigned.length})</span>
                            </div>
                        </div>
                        </summary>
                        {/* reuse the same table markup, mapping over `unassigned` */}
                        {/* ... you can copy the table above and replace `list` with `unassigned` */}
                    </details>
                    )}

                    {historyFor && (
                    <SoldierHistoryModal
                        soldierId={historyFor.id}
                        soldierName={historyFor.name}
                        isOpen={true}
                        onClose={() => setHistoryFor(null)}
                    />
                    )}

                </>
            )}

        </div>
    );
}
