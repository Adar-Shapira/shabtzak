// shabtzak-ui/src/pages/Roles.tsx
import { useEffect, useState } from "react";
import Modal from "../components/Modal";
import { useDisclosure } from "../hooks/useDisclosure";
import { api } from "../api";

type Role = { id: number; name: string};

export default function RolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // create form
  const addDlg = useDisclosure(false);
  const [newRoleName, setNewRoleName] = useState("");

  // edit state
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");

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
      await api.post("/roles", { name: newRoleName.trim() });
      setNewRoleName("");
      addDlg.close();
      await load();
    } catch (e:any) {
      setErr(e?.response?.data?.detail ?? "Failed to create role");
    }
  };

  const startEdit = (r: Role) => { setEditId(r.id); setEditName(r.name); };
  const cancelEdit = () => { setEditId(null); setEditName(""); };
  const saveEdit = async (id: number) => {
    try {
      await api.patch(`/roles/${id}`, { name: editName.trim() });
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
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <h1>Roles</h1>
        <button onClick={addDlg.open} style={{ padding:"8px 12px", borderRadius:8 }}>Add Role</button>
      </div>

      <Modal open={addDlg.isOpen} onClose={addDlg.close} title="Add Role">
        <form onSubmit={createRole} style={{ display:"grid", gridTemplateColumns:"1fr auto", gap:10 }}>
          <input value={newRoleName} onChange={(e)=>setNewRoleName(e.target.value)} placeholder="Role name" required />
          <div style={{ display:"flex", gap:8 }}>
            <button type="button" onClick={addDlg.close}>Cancel</button>
            <button type="submit">Add</button>
          </div>
        </form>
      </Modal>

      {err && <div style={{color:"crimson"}}>{err}</div>}
      {loading && <div>Loading…</div>}

      <table className="tbl-missions" width="100%" cellPadding={8} style={{borderCollapse:"collapse"}}>
        <thead>
          <tr>
            <th align="left">Name</th>
            <th>Actions</th>
          </tr>
        </thead>
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
          {roles.length===0 && (
            <tr>
              <td colSpan={2} style={{opacity:.7}}>(No roles)</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
