import { useEffect, useState } from "react";
import { api } from "../api";

type Role = { id: number; name: string; is_core: boolean };

export default function RolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // create form
  const [newName, setNewName] = useState("");
  const [newCore, setNewCore] = useState(false);

  // edit state
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editCore, setEditCore] = useState(false);

  const load = async () => {
    setLoading(true); setErr(null);
    try {
      const r = await api.get<Role[]>("/roles");
      setRoles(r.data);
    } catch (e:any) {
      setErr(e?.response?.data?.detail ?? "Failed to load roles");
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const createRole = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await api.post("/roles", { name: newName.trim(), is_core: newCore });
      setNewName(""); setNewCore(false);
      await load();
    } catch (e:any) {
      setErr(e?.response?.data?.detail ?? "Failed to create role");
    }
  };

  const startEdit = (r: Role) => { setEditId(r.id); setEditName(r.name); setEditCore(r.is_core); };
  const cancelEdit = () => { setEditId(null); setEditName(""); setEditCore(false); };
  const saveEdit = async (id: number) => {
    try {
      await api.patch(`/roles/${id}`, { name: editName.trim(), is_core: editCore });
      setEditId(null);
      await load();
    } catch (e:any) {
      setErr(e?.response?.data?.detail ?? "Failed to update role");
    }
  };
  const remove = async (id: number) => {
    if (!confirm("Delete this role? (won't delete if used)")) return;
    try { await api.delete(`/roles/${id}`); await load(); }
    catch (e:any) { setErr(e?.response?.data?.detail ?? "Failed to delete role"); }
  };

  return (
    <div style={{maxWidth:800, margin:"24px auto", padding:16}}>
      <h1>Roles</h1>
      <form onSubmit={createRole} style={{display:"flex", gap:8, marginBottom:12}}>
        <input placeholder="New role name" value={newName} onChange={e=>setNewName(e.target.value)} required />
        <label style={{display:"flex", alignItems:"center", gap:4}}>
          <input type="checkbox" checked={newCore} onChange={e=>setNewCore(e.target.checked)} /> Core
        </label>
        <button type="submit">Add</button>
      </form>

      {err && <div style={{color:"crimson"}}>{err}</div>}
      {loading && <div>Loading…</div>}

      <table width="100%" cellPadding={8} style={{borderCollapse:"collapse"}}>
        <thead><tr><th align="left">Name</th><th>Core</th><th>Actions</th></tr></thead>
        <tbody>
          {roles.map(r => {
            const editing = editId === r.id;
            return (
              <tr key={r.id} style={{borderTop:"1px solid #ddd"}}>
                <td>
                  {editing ? <input value={editName} onChange={e=>setEditName(e.target.value)} /> : r.name}
                </td>
                <td align="center">
                  {editing ? (
                    <input type="checkbox" checked={editCore} onChange={e=>setEditCore(e.target.checked)} />
                  ) : (r.is_core ? "✓" : "")}
                </td>
                <td align="center">
                  {editing ? (
                    <>
                      <button onClick={()=>saveEdit(r.id)}>Save</button>
                      <button onClick={cancelEdit} style={{marginLeft:8}}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button onClick={()=>startEdit(r)}>Edit</button>
                      <button onClick={()=>remove(r.id)} style={{marginLeft:8, color:"crimson"}}>Delete</button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
          {roles.length===0 && <tr><td colSpan={3} style={{opacity:.7}}>(No roles)</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
