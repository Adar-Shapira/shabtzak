import { useEffect, useState } from "react";
import { api } from "../api";

type Mission = {
  id: number;
  name: string;
  start_hour: string; // "HH:MM:SS"
  end_hour: string;   // "HH:MM:SS"
  required_soldiers: number;
  required_commanders: number;
  required_officers: number;
  required_drivers: number;
};

const hhmm = (iso: string) => (iso ?? "").slice(0,5) || "";

export default function MissionsPage() {
  const [rows, setRows] = useState<Mission[]>([]);
  const [err, setErr] = useState<string|null>(null);
  const [loading, setLoading] = useState(false);

  // create
  const [newName, setNewName] = useState("");
  const [newStart, setNewStart] = useState("08:00");
  const [newEnd, setNewEnd] = useState("12:00");
  const [newReq, setNewReq] = useState({ soldiers:0, commanders:0, officers:0, drivers:0 });

  // edit
  const [editId, setEditId] = useState<number|null>(null);
  const [eName, setEName] = useState("");
  const [eStart, setEStart] = useState("08:00");
  const [eEnd, setEEnd] = useState("12:00");
  const [eReq, setEReq] = useState({ soldiers:0, commanders:0, officers:0, drivers:0 });

  const load = async () => {
    setLoading(true); setErr(null);
    try { const r = await api.get<Mission[]>("/missions"); setRows(r.data); }
    catch (e:any){ setErr(e?.response?.data?.detail ?? "Failed to load missions"); }
    finally{ setLoading(false); }
  };
  useEffect(()=>{ load(); }, []);

  const createRow = async (e:React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/missions", {
        name: newName.trim(),
        start_hour: newStart,
        end_hour: newEnd,
        required_soldiers: newReq.soldiers,
        required_commanders: newReq.commanders,
        required_officers: newReq.officers,
        required_drivers: newReq.drivers,
      });
      setNewName(""); setNewStart("08:00"); setNewEnd("12:00"); setNewReq({soldiers:0,commanders:0,officers:0,drivers:0});
      await load();
    } catch(e:any){ setErr(e?.response?.data?.detail ?? "Failed to create mission"); }
  };

  const startEdit = (m:Mission) => {
    setEditId(m.id);
    setEName(m.name);
    setEStart(hhmm(m.start_hour));
    setEEnd(hhmm(m.end_hour));
    setEReq({
      soldiers: m.required_soldiers,
      commanders: m.required_commanders,
      officers: m.required_officers,
      drivers: m.required_drivers,
    });
  };
  const cancelEdit = ()=>{ setEditId(null); };
  const saveEdit = async (id:number)=>{
    try {
      await api.patch(`/missions/${id}`, {
        name: eName.trim(),
        start_hour: eStart,
        end_hour: eEnd,
        required_soldiers: eReq.soldiers,
        required_commanders: eReq.commanders,
        required_officers: eReq.officers,
        required_drivers: eReq.drivers,
      });
      setEditId(null); await load();
    } catch(e:any){ setErr(e?.response?.data?.detail ?? "Failed to update mission"); }
  };
  const remove = async (id:number)=>{
    if(!confirm("Delete this mission? (blocked if it has assignments)")) return;
    try { await api.delete(`/missions/${id}`); await load(); }
    catch(e:any){ setErr(e?.response?.data?.detail ?? "Failed to delete mission"); }
  };

  return (
    <div style={{maxWidth:1100, margin:"24px auto", padding:16}}>
      <h1>Missions</h1>

      <form onSubmit={createRow} style={{display:"grid", gridTemplateColumns:"2fr repeat(2,1fr) repeat(4,1fr) 1fr", gap:8, marginBottom:16}}>
        <input placeholder="Name" value={newName} onChange={e=>setNewName(e.target.value)} required />
        <input type="time" value={newStart} onChange={e=>setNewStart(e.target.value)} />
        <input type="time" value={newEnd} onChange={e=>setNewEnd(e.target.value)} />
        <input type="number" min={0} value={newReq.officers}   onChange={e=>setNewReq({...newReq, officers:+e.target.value})} placeholder="Off" />
        <input type="number" min={0} value={newReq.commanders} onChange={e=>setNewReq({...newReq, commanders:+e.target.value})} placeholder="Com" />
        <input type="number" min={0} value={newReq.drivers}    onChange={e=>setNewReq({...newReq, drivers:+e.target.value})} placeholder="Drv" />
        <input type="number" min={0} value={newReq.soldiers}   onChange={e=>setNewReq({...newReq, soldiers:+e.target.value})} placeholder="Sol" />
        <button type="submit">Add</button>
      </form>

      {err && <div style={{color:"crimson"}}>{err}</div>}
      {loading && <div>Loading…</div>}

      <table width="100%" cellPadding={8} style={{borderCollapse:"collapse"}}>
        <thead>
          <tr>
            <th align="left">Name</th>
            <th>Start</th>
            <th>End</th>
            <th>Off</th>
            <th>Com</th>
            <th>Drv</th>
            <th>Sol</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(m=>{
            const editing = editId===m.id;
            return (
              <tr key={m.id} style={{borderTop:"1px solid #ddd"}}>
                <td>{editing ? <input value={eName} onChange={e=>setEName(e.target.value)} /> : m.name}</td>
                <td align="center">{editing ? <input type="time" value={eStart} onChange={e=>setEStart(e.target.value)} /> : hhmm(m.start_hour)}</td>
                <td align="center">{editing ? <input type="time" value={eEnd} onChange={e=>setEEnd(e.target.value)} /> : hhmm(m.end_hour)}</td>
                <td align="center">{editing ? <input type="number" min={0} value={eReq.officers}   onChange={e=>setEReq({...eReq, officers:+e.target.value})} />   : m.required_officers}</td>
                <td align="center">{editing ? <input type="number" min={0} value={eReq.commanders} onChange={e=>setEReq({...eReq, commanders:+e.target.value})} /> : m.required_commanders}</td>
                <td align="center">{editing ? <input type="number" min={0} value={eReq.drivers}    onChange={e=>setEReq({...eReq, drivers:+e.target.value})} />    : m.required_drivers}</td>
                <td align="center">{editing ? <input type="number" min={0} value={eReq.soldiers}   onChange={e=>setEReq({...eReq, soldiers:+e.target.value})} />   : m.required_soldiers}</td>
                <td align="center">
                  {editing ? (
                    <>
                      <button onClick={()=>saveEdit(m.id)}>Save</button>
                      <button onClick={cancelEdit} style={{marginLeft:8}}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button onClick={()=>startEdit(m)}>Edit</button>
                      <button onClick={()=>remove(m.id)} style={{marginLeft:8, color:"crimson"}}>Delete</button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
          {rows.length===0 && <tr><td colSpan={8} style={{opacity:.7}}>(No missions)</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
