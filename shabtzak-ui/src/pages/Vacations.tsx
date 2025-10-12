// src/pages/Vacations.tsx
import { useEffect, useState } from "react";
import { api } from "../api";

type Vacation = { id:number; soldier_id:number; soldier_name?:string; start_date:string; end_date:string };
type Soldier = { id:number; name:string };

export default function VacationsPage() {
  const [rows, setRows] = useState<Vacation[]>([]);
  const [soldiers, setSoldiers] = useState<Soldier[]>([]);
  const [sid, setSid] = useState<number | "">("");
  const [start, setStart] = useState<string>("");
  const [end, setEnd] = useState<string>("");

  const load = async () => {
    const [v, s] = await Promise.all([api.get<Vacation[]>("/vacations"), api.get<Soldier[]>("/soldiers")]);
    setRows(v.data); setSoldiers(s.data as any);
  };
  useEffect(()=>{ load(); }, []);

  const add = async (e:React.FormEvent) => {
    e.preventDefault();
    await api.post("/vacations", { soldier_id:Number(sid), start_date:start, end_date:end });
    setSid(""); setStart(""); setEnd("");
    await load();
  };
  const remove = async (id:number) => { await api.delete(`/vacations/${id}`); await load(); };

  return (
    <div style={{maxWidth:900, margin:"24px auto", padding:16}}>
      <h1>Vacations</h1>
      <form onSubmit={add} style={{display:"flex", gap:8, flexWrap:"wrap", marginBottom:12}}>
        <select value={sid} onChange={e=>setSid(e.target.value?Number(e.target.value):"")} required>
          <option value="">(choose soldier)</option>
          {soldiers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input type="date" value={start} onChange={e=>setStart(e.target.value)} required />
        <input type="date" value={end} onChange={e=>setEnd(e.target.value)} required />
        <button type="submit">Add</button>
      </form>
      <table width="100%" cellPadding={8} style={{borderCollapse:"collapse"}}>
        <thead><tr><th align="left">Soldier</th><th>Start</th><th>End</th><th>Actions</th></tr></thead>
        <tbody>
          {rows.map(v=>(
            <tr key={v.id} style={{borderTop:"1px solid #ddd"}}>
              <td>{v.soldier_name ?? v.soldier_id}</td>
              <td align="center">{v.start_date}</td>
              <td align="center">{v.end_date}</td>
              <td align="center"><button onClick={()=>remove(v.id)} style={{color:"crimson"}}>Delete</button></td>
            </tr>
          ))}
          {rows.length===0 && <tr><td colSpan={4} style={{opacity:.7}}>(No vacations)</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
