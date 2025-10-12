import { useEffect, useMemo, useState } from "react";
import { api } from "../api";

type Role = { id: number; name: string; is_core: boolean };
type Department = { id: number; name: string };
type Mission = { id: number; name: string };

type Soldier = {
  id: number;
  name: string;
  role_id: number;
  role_name?: string | null;
  extra_roles?: { id: number; name: string }[];
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
    () => Array.from(new Set(missions.map(m => m.name))).sort(),
    [missions]
  );

  const [soldiers, setSoldiers] = useState<Soldier[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // CREATE
  const [newName, setNewName] = useState("");
  const [newRoleId, setNewRoleId] = useState<number | "">("");
  const [newExtraRoleIds, setNewExtraRoleIds] = useState<number[]>([]);
  const [newDeptId, setNewDeptId] = useState<number | "">("");
  const [newRestrictions, setNewRestrictions] = useState<string[]>([]);

  // EDIT
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editRoleId, setEditRoleId] = useState<number | "">("");
  const [editExtraRoleIds, setEditExtraRoleIds] = useState<number[]>([]);
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
      setSoldiers(s.data as any);
      setMissions(m.data.map(x => ({ id: x.id, name: x.name })));
    } catch (e: any) {
      setErr(e?.response?.data?.detail ?? "Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  // helpers for <select multiple>
  const onMultiChangeNumbers = (ev: React.ChangeEvent<HTMLSelectElement>, setState: (vals: number[]) => void) => {
    const opts = Array.from(ev.target.selectedOptions).map(o => Number(o.value));
    setState(opts);
  };
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
            role_ids: [Number(newRoleId), ...newExtraRoleIds].filter((v,i,a)=>v && a.indexOf(v)===i),
            department_id: newDeptId === "" ? null : Number(newDeptId),
            restrictions: newRestrictions, // array OK
            missions_history: "",
        });
      setNewName(""); setNewRoleId(""); setNewExtraRoleIds([]); setNewDeptId(""); setNewRestrictions([]);
      await loadAll();
    } catch (e: any) {
      setErr(e?.response?.data?.detail ?? "Failed to create soldier");
    }
  };

  // EDIT
  const startEdit = (s: Soldier) => {
    setEditId(s.id);
    setEditName(s.name);
    setEditRoleId(s.role_id);
    setEditExtraRoleIds((s.extra_roles || []).map(r => r.id));
    setEditDeptId(s.department_id ?? "");
    setEditRestrictions(s.restrictions_tokens ?? tokensToArray(s.restrictions));
  };

  const cancelEdit = () => {
    setEditId(null); setEditName(""); setEditRoleId(""); setEditExtraRoleIds([]); setEditDeptId(""); setEditRestrictions([]);
  };

  const saveEdit = async (id: number) => {
    try {
        await api.patch(`/soldiers/${id}`, {
            name: editName.trim(),
            role_ids: [Number(editRoleId), ...editExtraRoleIds].filter((v,i,a)=>v && a.indexOf(v)===i),
            department_id: editDeptId === "" ? 0 : Number(editDeptId), // 0 → clear (backend supports this)
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
      <h1>Soldiers</h1>

      {/* Create form */}
      <section style={{ marginBottom: 24 }}>
        <h2>Create Soldier</h2>
        <form onSubmit={createSoldier} style={{ display: "grid", gridTemplateColumns: "2fr 1.2fr 1.5fr 1.5fr 1.5fr 1fr", gap: 8 }}>
          <input value={newName} onChange={(e)=>setNewName(e.target.value)} placeholder="Full name" required />
          <select value={newRoleId} onChange={(e)=>setNewRoleId(e.target.value ? Number(e.target.value) : "")} required>
            <option value="">(primary role)</option>
            {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>

          {/* extra roles multi */}
          <select multiple size={3} value={newExtraRoleIds.map(String)} onChange={(e)=>onMultiChangeNumbers(e, setNewExtraRoleIds)}>
            {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>

          {/* department */}
          <select value={newDeptId} onChange={(e)=>setNewDeptId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">(no department)</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>

          {/* restrictions multi */}
          <select multiple size={3} value={newRestrictions} onChange={(e)=>onMultiChangeStrings(e, setNewRestrictions)}>
            {restrictionOptions.map(n => <option key={n} value={n}>{n}</option>)}
          </select>

          <button type="submit">Add</button>
        </form>
      </section>

      {err && <div style={{ color: "crimson", marginBottom: 12 }}>{err}</div>}
      {loading && <div>Loading…</div>}

      {/* List + Edit */}
      {!loading && (
        <table width="100%" cellPadding={8} style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th align="left" style={{ width: 60 }}>ID</th>
              <th align="left">Name</th>
              <th align="left" style={{ width: 200 }}>Primary Role</th>
              <th align="left" style={{ width: 260 }}>Extra Roles</th>
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

                  {/* primary role */}
                  <td>
                    {isEditing ? (
                      <select value={editRoleId} onChange={(e)=>setEditRoleId(e.target.value ? Number(e.target.value) : "")} style={{ width: "100%" }}>
                        {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                    ) : (s.role_name ?? s.role_id)}
                  </td>

                  {/* extra roles multi */}
                  <td>
                    {isEditing ? (
                      <select multiple size={3} value={editExtraRoleIds.map(String)} onChange={(e)=>onMultiChangeNumbers(e, setEditExtraRoleIds)} style={{ width: "100%" }}>
                        {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                    ) : (
                      s.extra_roles && s.extra_roles.length
                        ? s.extra_roles.map(r => r.name).join(", ")
                        : <span style={{opacity:.6}}>(none)</span>
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
