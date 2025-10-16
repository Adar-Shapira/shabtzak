// shabtzak-ui/src/pages/Departments.tsx
import { useEffect, useState } from "react";
import { api } from "../api";
import Modal from "../components/Modal";
import { useDisclosure } from "../hooks/useDisclosure";

type Department = { id: number; name: string };

export default function DepartmentsPage() {
  const [rows, setRows] = useState<Department[]>([]);
  const [err, setErr] = useState<string|null>(null);
  const [loading, setLoading] = useState(false);

  const [editId, setEditId] = useState<number|null>(null);
  const [editName, setEditName] = useState("");

  const addDlg = useDisclosure(false);
  const [newDeptName, setNewDeptName] = useState("");

  const load = async () => {
    setLoading(true); setErr(null);
    try { const r = await api.get<Department[]>("/departments"); setRows(r.data); }
    catch (e:any){ setErr(e?.response?.data?.detail ?? "Failed to load departments"); }
    finally{ setLoading(false); }
  };
  useEffect(()=>{ load(); }, []);

  const createRow = async (e:React.FormEvent) => {
    e.preventDefault();
    try { 
      await api.post("/departments", { name: newDeptName.trim() });
      setNewDeptName("");
      addDlg.close();
      await load();
    }
    catch (e:any){ setErr(e?.response?.data?.detail ?? "Failed to create"); }
  };

  const startEdit = (d:Department)=>{ setEditId(d.id); setEditName(d.name); };
  const cancelEdit = ()=>{ setEditId(null); setEditName(""); };
  const saveEdit = async (id:number)=>{
    try { await api.patch(`/departments/${id}`, {name: editName.trim()}); setEditId(null); await load(); }
    catch (e:any){ setErr(e?.response?.data?.detail ?? "Failed to update"); }
  };
  const remove = async (id:number)=>{
    if(!confirm("Delete this department? (blocked if used by soldiers)")) return;
    try { await api.delete(`/departments/${id}`); await load(); }
    catch(e:any){ setErr(e?.response?.data?.detail ?? "Failed to delete"); }
  };

  return (
    <div style={{maxWidth:800, margin:"24px auto", padding:16}}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <h1>Departments</h1>
        <button onClick={addDlg.open} style={{ padding:"8px 12px", borderRadius:8 }}>Add Department</button>
      </div>

      <Modal open={addDlg.isOpen} onClose={addDlg.close} title="Add Department">
        <form onSubmit={createRow} style={{ display:"grid", gridTemplateColumns:"1fr auto", gap:10 }}>
          <input value={newDeptName} onChange={(e)=>setNewDeptName(e.target.value)} placeholder="Department name" required />
          <div style={{ display:"flex", gap:8 }}>
            <button type="button" onClick={addDlg.close}>Cancel</button>
            <button type="submit">Add</button>
          </div>
        </form>
      </Modal>

      {err && <div style={{color:"crimson"}}>{err}</div>}
      {loading && <div>Loading…</div>}

      <table width="100%" cellPadding={8} style={{borderCollapse:"collapse"}}>
        <thead><tr><th align="left">Name</th><th align="center">Actions</th></tr></thead>
        <tbody>
          {rows.map(d=>{
            const editing = editId===d.id;
            return (
              <tr key={d.id} style={{borderTop:"1px solid #ddd"}}>
                <td>
                  {editing ? <input value={editName} onChange={e=>setEditName(e.target.value)} />
                           : d.name}
                </td>
                <td align="center">
                  {editing ? <>
                    <button onClick={()=>saveEdit(d.id)}>Save</button>
                    <button onClick={cancelEdit} style={{marginLeft:8}}>Cancel</button>
                  </> : <>
                    <button onClick={()=>startEdit(d)}>Edit</button>
                    <button onClick={()=>remove(d.id)} style={{marginLeft:8, color:"crimson"}}>Delete</button>
                  </>}
                </td>
              </tr>
            );
          })}
          {rows.length===0 && <tr><td colSpan={2} style={{opacity:.7}}>(No departments)</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
