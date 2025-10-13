import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { api } from "../api";
import Modal from "../components/Modal";
import { useDisclosure } from "../hooks/useDisclosure";

type Role = { id: number; name: string; is_core: boolean };
type Department = { id: number; name: string };
type Mission = { id: number; name: string };

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
            <h1>Soldiers</h1>
            <button onClick={addDlg.open} style={{ padding: "8px 12px", borderRadius: 8 }}>Add Soldier</button>
        </div>

        <Modal open={addDlg.isOpen} onClose={addDlg.close} title="Add Soldier" maxWidth={720}>
            <form
                onSubmit={createSoldier}
                style={{ display: "grid", gridTemplateColumns: "1.6fr 1.2fr 1.2fr 1.2fr auto", gap: 10 }}
            >
                <input value={newName} onChange={(e)=>setNewName(e.target.value)} placeholder="Full name" required />

                {/* Roles multi */}
                <div>
                <div style={{ fontSize: 12, opacity:.8, marginBottom: 4 }}>Roles</div>
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
                <div style={{ fontSize: 12, opacity:.8, marginBottom: 4 }}>Department</div>
                <select value={newDeptId} onChange={(e)=>setNewDeptId(e.target.value ? Number(e.target.value) : "")} style={{ width: "100%" }}>
                    <option value="">(no department)</option>
                    {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                </div>

                {/* Restrictions */}
                <div>
                <div style={{ fontSize: 12, opacity:.8, marginBottom: 4 }}>Restrictions</div>
                <select multiple size={5} value={newRestrictions} onChange={(e)=>onMultiChangeStrings(e, setNewRestrictions)} style={{ width: "100%" }}>
                    {restrictionOptions.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
                </div>

                <div style={{ alignSelf: "end", display: "flex", gap: 8 }}>
                <button type="button" onClick={addDlg.close}>Cancel</button>
                <button type="submit">Add</button>
                </div>
            </form>
        </Modal>

        {err && <div style={{ color: "crimson", marginBottom: 12 }}>{err}</div>}
        {loading && <div>Loading…</div>}

        {/* List + Edit */}
        {!loading && (
            <table width="100%" cellPadding={8} style={{ borderCollapse: "collapse" }}>
                <thead>
                    <tr>
                    <th align="left" style={{ width: 60 }}>ID</th>
                    <th align="left">Name</th>
                    <th align="left" style={{ width: 320 }}>Roles</th>
                    <th align="left" style={{ width: 220 }}>Department</th>
                    <th align="left" style={{ width: 260 }}>Restrictions</th>
                    <th align="left" style={{ width: 180 }}>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {soldiers.map(s => {
                    const isEditing = editId === s.id;
                    return (
                        <tr key={s.id} style={{ borderTop: "1px solid #ddd" }}>
                        <td>{s.id}</td>

                        {/* name */}
                        <td>
                            {isEditing ? (
                            <input value={editName} onChange={(e)=>setEditName(e.target.value)} style={{ width: "100%" }} />
                            ) : s.name}
                        </td>

                        <td>
                            {isEditing ? (
                                <select
                                multiple
                                size={4}
                                value={editRoleIds.map(String)}
                                onChange={(e) => {
                                    const selected = Array.from(e.target.selectedOptions).map(o => Number(o.value));
                                    setEditRoleIds(selected);
                                }}
                                style={{ width: "100%" }}
                                >
                                {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                                </select>
                            ) : (
                                s.roles?.length ? s.roles.map(r => r.name).join(", ") : <span style={{opacity:.6}}>(none)</span>
                            )}
                        </td>

                        {/* department */}
                        <td>
                            {isEditing ? (
                            <select value={editDeptId} onChange={(e)=>setEditDeptId(e.target.value ? Number(e.target.value) : "")} style={{ width: "100%" }}>
                                <option value="">(no department)</option>
                                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                            </select>
                            ) : (s.department_name ?? <span style={{opacity:.6}}>(none)</span>)}
                        </td>

                        {/* restrictions multi */}
                        <td>
                            {isEditing ? (
                            <select multiple size={3} value={editRestrictions} onChange={(e)=>onMultiChangeStrings(e, setEditRestrictions)} style={{ width: "100%" }}>
                                {restrictionOptions.map(n => <option key={n} value={n}>{n}</option>)}
                            </select>
                            ) : (
                            (s.restrictions_tokens && s.restrictions_tokens.length)
                                ? s.restrictions_tokens.join(", ")
                                : <span style={{opacity:.6}}>(none)</span>
                            )}
                        </td>

                        <td>
                            {isEditing ? (
                                <>
                                    <button onClick={()=>saveEdit(s.id)}>Save</button>
                                    <button onClick={cancelEdit} style={{ marginLeft: 8 }}>Cancel</button>
                                </>
                                ) : (
                                <>
                                    <button onClick={()=>startEdit(s)}>Edit</button>
                                    <button onClick={()=>removeSoldier(s.id)} style={{ marginLeft: 8, color: "crimson" }}>
                                    Delete
                                    </button>
                                </>
                                )}
                        </td>
                        </tr>
                    );
                    })}
                    {soldiers.length === 0 && <tr><td colSpan={7} style={{ opacity:.7 }}>(No soldiers yet)</td></tr>}
                </tbody>
            </table>
        )}
        </div>
    );
}
