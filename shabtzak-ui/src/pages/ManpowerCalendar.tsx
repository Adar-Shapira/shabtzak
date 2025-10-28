// shabtzak-ui/src/pages/ManpowerCalendar.tsx
import { useEffect, useState, useMemo } from "react";
import { api } from "../api";
import Modal from "../components/Modal";
import { useDisclosure } from "../hooks/useDisclosure";
import { useSidebar, type SidebarActions } from "../contexts/SidebarContext";

type Soldier = {
  id: number;
  name: string;
  roles?: Array<{ id: number; name: string }>;
  department_id?: number | null;
  department_name?: string | null;
};

type Vacation = {
  id?: number;
  soldier_id: number;
  soldier_name?: string | null;
  start_date: string; // YYYY-MM-DD
  end_date: string;   // YYYY-MM-DD
  note?: string | null;
};

function isInRange(d: string, start: string, end: string): boolean {
  return d >= start && d <= end; // inclusive
}

export default function ManpowerCalendarPage() {
  const { setActions } = useSidebar();
  
  const [soldiers, setSoldiers] = useState<Soldier[]>([]);
  const [vacations, setVacations] = useState<Vacation[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Calendar state
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedModalDate, setSelectedModalDate] = useState<string | null>(null);
  
  // Modal for available soldiers
  const modal = useDisclosure(false);
  const [availableSoldiers, setAvailableSoldiers] = useState<Array<{ soldier: Soldier; leavingToday: boolean; returningToday: boolean }>>([]);
  const [onVacationSoldiers, setOnVacationSoldiers] = useState<Array<{ soldier: Soldier; leavingToday: boolean; returningToday: boolean; returnDate?: string }>>([]);

  // Vacation modal state
  const vacDlg = useDisclosure(false);
  const [vacSoldier, setVacSoldier] = useState<Soldier | null>(null);
  const [soldierVacations, setSoldierVacations] = useState<Vacation[]>([]);
  const [vacEditId, setVacEditId] = useState<number | null>(null);
  const [vacStart, setVacStart] = useState<string>("");
  const [vacEnd, setVacEnd] = useState<string>("");
  const [vacNote, setVacNote] = useState<string>("");

  // Search state for the available soldiers modal
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [filterRole, setFilterRole] = useState<string>("");
  const [filterDepartment, setFilterDepartment] = useState<string>("");

  const loadData = async () => {
    setLoading(true);
    setErr(null);
    try {
      console.log("Loading soldiers and vacations...");
      const [soldiersRes, vacationsRes] = await Promise.all([
        api.get<Soldier[]>("/soldiers"),
        api.get<Vacation[]>("/vacations"),
      ]);
      console.log("Loaded soldiers:", soldiersRes.data.length);
      console.log("Loaded vacations:", vacationsRes.data.length);
      setSoldiers(soldiersRes.data);
      setVacations(vacationsRes.data);
    } catch (e: any) {
      console.error("Error loading data:", e);
      setErr(e?.response?.data?.detail ?? e?.message ?? "Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Register sidebar actions (will be updated when todayStats is calculated)
  useEffect(() => {
    return () => setActions({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setActions]);

  // Open vacation modal for a soldier
  const openVacations = async (s: Soldier) => {
    setVacSoldier(s);
    setVacEditId(null);
    setVacStart("");
    setVacEnd("");
    setVacNote("");
    await fetchSoldierVacations(s.id);
    vacDlg.open();
  };

  // Close vacation modal
  const closeVacations = () => {
    setVacSoldier(null);
    setSoldierVacations([]);
    setVacEditId(null);
    setVacStart("");
    setVacEnd("");
    setVacNote("");
    vacDlg.close();
  };

  // Fetch vacations for a soldier
  const fetchSoldierVacations = async (soldierId: number) => {
    try {
      const res = await api.get(`/vacations/soldiers/${soldierId}`);
      setSoldierVacations(Array.isArray(res.data) ? res.data : []);
    } catch (e: any) {
      setSoldierVacations([]);
    }
  };

  // Start adding a vacation
  const startAddVacation = () => {
    setVacEditId(null);
    setVacStart("");
    setVacEnd("");
    setVacNote("");
  };

  // Start editing a vacation
  const startEditVacation = (v: Vacation) => {
    setVacEditId(v.id!);
    setVacStart(v.start_date);
    setVacEnd(v.end_date);
    setVacNote(v.note ?? "");
  };

  // Save vacation
  const saveVacation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vacSoldier) return;

    if (vacStart && vacEnd && vacEnd < vacStart) {
      alert("תאריך סיום לא יכול להיות לפני תאריך התחלה");
      return;
    }

    try {
      const payload: any = { start_date: vacStart, end_date: vacEnd };
      if (vacNote) payload.note = vacNote;

      if (vacEditId == null) {
        // CREATE
        await api.post(`/vacations`, { ...payload, soldier_id: vacSoldier.id });
      } else {
        // UPDATE
        await api.patch(`/vacations/${vacEditId}`, payload);
      }

      await fetchSoldierVacations(vacSoldier.id);
      await loadData(); // Refresh main data
      
      // Reset form
      setVacEditId(null);
      setVacStart("");
      setVacEnd("");
      setVacNote("");
    } catch (e: any) {
      alert(e?.response?.data?.detail ?? "Failed to save vacation");
    }
  };

  // Delete vacation
  const deleteVacation = async (v: Vacation) => {
    if (!vacSoldier || !v.id) return;
    if (!confirm(`למחוק חופשה ${v.start_date} → ${v.end_date}?`)) return;
    
    try {
      await api.delete(`/vacations/${v.id}`);
      await fetchSoldierVacations(vacSoldier.id);
      await loadData(); // Refresh main data
    } catch (e: any) {
      alert(e?.response?.data?.detail ?? "Failed to delete vacation");
    }
  };

  // Calculate calendar days for the current month
  const calendarDays = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    
    const firstDay = new Date(year, month, 1);
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - startDate.getDay()); // Start from Sunday
    
    const days: Array<{ date: Date; isCurrentMonth: boolean }> = [];
    const currentDate = new Date(startDate);
    
    for (let i = 0; i < 42; i++) { // 6 weeks * 7 days
      days.push({
        date: new Date(currentDate),
        isCurrentMonth: currentDate.getMonth() === month,
      });
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    return days;
  }, [currentMonth]);

  const openAvailableModal = (dayISO: string) => {
    setSelectedModalDate(dayISO);
    setSearchQuery(""); // Reset search when opening modal
    setFilterRole(""); // Reset role filter
    setFilterDepartment(""); // Reset department filter
    
    // Calculate available soldiers for this day
    const available: Array<{ soldier: Soldier; leavingToday: boolean; returningToday: boolean }> = [];
    const onVacation: Array<{ soldier: Soldier; leavingToday: boolean; returningToday: boolean; returnDate?: string }> = [];
    
    for (const s of soldiers) {
      const vacs = vacations.filter(v => v.soldier_id === s.id);
      const vacToday = vacs.find(v => isInRange(dayISO, v.start_date, v.end_date));
      
      if (!vacToday) {
        // Not on vacation
        available.push({ soldier: s, leavingToday: false, returningToday: false });
      } else {
        const leavingToday = vacToday.start_date === dayISO;
        const returningToday = vacToday.end_date === dayISO;
        
        // Soldiers who leave today or return today are considered AVAILABLE
        if (leavingToday || returningToday) {
          available.push({ soldier: s, leavingToday, returningToday });
        } else {
          // Store the return date for soldiers who are on vacation
          onVacation.push({ soldier: s, leavingToday, returningToday, returnDate: vacToday.end_date });
        }
      }
    }
    
    setAvailableSoldiers(available);
    setOnVacationSoldiers(onVacation);
    modal.open();
  };

  // Helper function to get availability stats for a specific day
  const getAvailabilityStats = (dayISO: string) => {
    let availableCount = 0;
    
    for (const s of soldiers) {
      const vacs = vacations.filter(v => v.soldier_id === s.id);
      const vacToday = vacs.find(v => isInRange(dayISO, v.start_date, v.end_date));
      
      if (!vacToday) {
        // Not on vacation - available
        availableCount++;
      } else {
        const leavingToday = vacToday.start_date === dayISO;
        const returningToday = vacToday.end_date === dayISO;
        
        // Soldiers who leave or return today are also available
        if (leavingToday || returningToday) {
          availableCount++;
        }
      }
    }
    
    return { available: availableCount, total: soldiers.length };
  };


  const monthNames = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
  const weekDays = ["א", "ב", "ג", "ד", "ה", "ו", "ש"];

  // Calculate today's stats
  const todayISO = new Date().toISOString().slice(0, 10);
  const todayStats = useMemo(() => {
    let availableCount = 0;
    let onVacationCount = 0;
    
    for (const s of soldiers) {
      const vacs = vacations.filter(v => v.soldier_id === s.id);
      const vacToday = vacs.find(v => isInRange(todayISO, v.start_date, v.end_date));
      
      if (!vacToday) {
        availableCount++;
      } else {
        const leavingToday = vacToday.start_date === todayISO;
        const returningToday = vacToday.end_date === todayISO;
        
        if (leavingToday || returningToday) {
          availableCount++;
        } else {
          onVacationCount++;
        }
      }
    }
    
    return { available: availableCount, onVacation: onVacationCount, total: soldiers.length };
  }, [soldiers, vacations, todayISO]);

  // Update sidebar with current stats
  const currentMonthString = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = String(currentMonth.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }, [currentMonth]);

  useEffect(() => {
    const actions: SidebarActions = {
      currentMonth: currentMonthString,
      onMonthChange: (monthString: string) => {
        // monthString is in format YYYY-MM
        const [year, month] = monthString.split('-').map(Number);
        setCurrentMonth(new Date(year, month - 1));
      },
      totalSoldiers: todayStats.total,
      availableToday: todayStats.available,
      onVacationToday: todayStats.onVacation,
    };
    setActions(actions);
  }, [setActions, todayStats, currentMonthString]);

  if (loading) {
    return <div style={{ padding: 24 }}>בטעינה...</div>;
  }

  if (err) {
    return (
      <div style={{ padding: 24 }}>
        <h1>סד"כ</h1>
        <div style={{ color: "crimson", marginTop: 12 }}>שגיאה: {err}</div>
        <button onClick={loadData} style={{ marginTop: 12, padding: "8px 16px" }}>
          נסה שוב
        </button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1200, margin: "24px auto", padding: 16 }}>
      <div style={{ padding: "8px 16px", textAlign: "center", fontSize: 18, fontWeight: 600, marginBottom: 16 }}>
        {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
      </div>

      {err && <div style={{ color: "crimson", marginBottom: 12, marginTop: 12 }}>{err}</div>}

      {/* Summary stats for today */}
      <div style={{ 
        display: "grid", 
        gridTemplateColumns: "repeat(3, 1fr)", 
        gap: 16, 
        marginBottom: 24,
        padding: 16,
        backgroundColor: "rgba(255,255,255,0.02)",
        border: "1px solid #1f2937",
        borderRadius: 8,
        marginTop: 24,
      }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#60a5fa" }}>
            {todayStats.total}
          </div>
          <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 4 }}>סה"כ חיילים</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#10b981" }}>
            {todayStats.available}
          </div>
          <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 4 }}>זמינים היום</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#f59e0b" }}>
            {todayStats.onVacation}
          </div>
          <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 4 }}>בחופשה היום</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 1, border: "1px solid #1f2937" }}>
        {/* Week day headers */}
        {weekDays.map(day => (
          <div key={day} style={{ padding: 12, textAlign: "center", backgroundColor: "rgba(255,255,255,0.03)", fontWeight: 600 }}>
            {day}
          </div>
        ))}

        {/* Calendar days */}
        {calendarDays.map(({ date, isCurrentMonth }, idx) => {
          const dayISO = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
          const isToday = dayISO === new Date().toISOString().slice(0, 10);
          const availabilityStats = getAvailabilityStats(dayISO);
          
          return (
            <div
              key={idx}
              onClick={() => openAvailableModal(dayISO)}
              style={{
                minHeight: 80,
                padding: 8,
                backgroundColor: isCurrentMonth ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.01)",
                border: "1px solid #1f2937",
                cursor: "pointer",
                position: "relative",
                  borderTop: isToday ? "3px solid #60a5fa" : undefined,
              }}
            >
              <div style={{ 
                fontSize: 14, 
                fontWeight: isToday ? 700 : 400,
                marginBottom: 4 
              }}>
                {date.getDate()}
              </div>
              
              {/* Availability indicator */}
              <div style={{
                position: "absolute",
                bottom: 8,
                left: 8,
                right: 8,
                backgroundColor: "rgba(16, 185, 129, 0.15)",
                border: "1px solid rgba(16, 185, 129, 0.3)",
                borderRadius: 4,
                padding: "2px 4px",
                fontSize: 10,
                color: "#10b981",
                textAlign: "center",
              }}>
                {availabilityStats.available}
              </div>
            </div>
          );
        })}
      </div>

      {/* Available Soldiers Modal */}
      <Modal
        open={modal.isOpen}
        onClose={modal.close}
        title={selectedModalDate ? `חיילים זמינים — ${selectedModalDate}` : "חיילים זמינים"}
        maxWidth={720}
      >
        <div style={{ display: "grid", gap: 16 }}>
          {/* Search Bar and Filters */}
          <div style={{ display: "grid", gap: 8 }}>
            <input
              type="text"
              placeholder="חפש חייל..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid #1f2937",
                backgroundColor: "rgba(255,255,255,0.03)",
                color: "#e5e7eb",
                fontSize: 14,
              }}
            />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <select
                value={filterDepartment}
                onChange={(e) => setFilterDepartment(e.target.value)}
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid #1f2937",
                  backgroundColor: "rgba(255,255,255,0.03)",
                  color: "#e5e7eb",
                  fontSize: 14,
                }}
              >
                <option value="">כל המחלקות</option>
                {Array.from(new Set(availableSoldiers
                  .map(({ soldier }) => soldier.department_name)
                  .filter((d): d is string => typeof d === 'string' && d.length > 0)
                )).map(dept => (
                  <option key={dept} value={dept}>{dept}</option>
                ))}
              </select>
              <select
                value={filterRole}
                onChange={(e) => setFilterRole(e.target.value)}
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid #1f2937",
                  backgroundColor: "rgba(255,255,255,0.03)",
                  color: "#e5e7eb",
                  fontSize: 14,
                }}
              >
                <option value="">כל התפקידים</option>
                {Array.from(new Set(availableSoldiers.flatMap(({ soldier }) => 
                  soldier.roles?.map(r => r.name) || []
                ))).map(role => (
                  <option key={role} value={role}>{role}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Soldiers Sections - Side by Side */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {/* Available Soldiers Section */}
            <div>
                <h3 style={{ marginBottom: 12, fontSize: 18, fontWeight: 600, color: "#e5e7eb" }}>זמינים ({availableSoldiers.filter(({ soldier }) => {
                const matchesSearch = !searchQuery || 
                  soldier.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  soldier.department_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  soldier.roles?.some(r => r.name.toLowerCase().includes(searchQuery.toLowerCase()));
                const matchesRole = !filterRole || soldier.roles?.some(r => r.name === filterRole);
                const matchesDept = !filterDepartment || soldier.department_name === filterDepartment;
                return matchesSearch && matchesRole && matchesDept;
              }).length})</h3>
              {availableSoldiers.length === 0 ? (
                <div style={{ opacity: 0.7, padding: 8 }}>אין חיילים זמינים בתאריך זה</div>
              ) : availableSoldiers.filter(({ soldier }) => {
                const matchesSearch = !searchQuery || 
                  soldier.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  soldier.department_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  soldier.roles?.some(r => r.name.toLowerCase().includes(searchQuery.toLowerCase()));
                const matchesRole = !filterRole || soldier.roles?.some(r => r.name === filterRole);
                const matchesDept = !filterDepartment || soldier.department_name === filterDepartment;
                return matchesSearch && matchesRole && matchesDept;
              }).length === 0 ? (
                <div style={{ opacity: 0.7, padding: 8 }}>לא נמצאו תוצאות</div>
              ) : (
                <div style={{ display: "grid", gap: 4, maxHeight: 300, overflowY: "auto" }}>
                  {availableSoldiers.filter(({ soldier }) => {
                const matchesSearch = !searchQuery || 
                  soldier.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  soldier.department_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  soldier.roles?.some(r => r.name.toLowerCase().includes(searchQuery.toLowerCase()));
                const matchesRole = !filterRole || soldier.roles?.some(r => r.name === filterRole);
                const matchesDept = !filterDepartment || soldier.department_name === filterDepartment;
                return matchesSearch && matchesRole && matchesDept;
              }).map(({ soldier, leavingToday, returningToday }) => (
                  <div key={soldier.id} style={{ padding: 10, border: "1px solid #1f2937", borderRadius: 8, backgroundColor: "rgba(255,255,255,0.02)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div 
                        onClick={() => openVacations(soldier)}
                        style={{ fontWeight: 500, cursor: "pointer", color: "#60a5fa" }}
                      >
                        {soldier.name}
                      </div>
                      {leavingToday && (
                        <span style={{ 
                          fontSize: 11, 
                          color: "#f59e0b", 
                          backgroundColor: "rgba(245, 158, 11, 0.15)", 
                          padding: "2px 6px", 
                          borderRadius: 4 
                        }}>
                           יוצא היום הביתה
                        </span>
                      )}
                      {returningToday && (
                        <span style={{ 
                          fontSize: 11, 
                          color: "#10b981", 
                          backgroundColor: "rgba(16, 185, 129, 0.15)", 
                          padding: "2px 6px", 
                          borderRadius: 4 
                        }}>
                          חוזר היום מהבית
                        </span>
                      )}
                    </div>
                    {soldier.department_name && (
                      <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>מחלקה: {soldier.department_name}</div>
                    )}
                    {soldier.roles && soldier.roles.length > 0 && (
                      <div style={{ fontSize: 12, opacity: 0.6, marginTop: 2 }}>
                        {soldier.roles.map(r => r.name).join(", ")}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            </div>

            {/* On Vacation Soldiers Section */}
            <div>
              <h3 style={{ marginBottom: 12, fontSize: 18, fontWeight: 600, color: "#9ca3af" }}>בחופשה ({onVacationSoldiers.filter(({ soldier }) => {
                const matchesSearch = !searchQuery || 
                  soldier.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  soldier.department_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  soldier.roles?.some(r => r.name.toLowerCase().includes(searchQuery.toLowerCase()));
                const matchesRole = !filterRole || soldier.roles?.some(r => r.name === filterRole);
                const matchesDept = !filterDepartment || soldier.department_name === filterDepartment;
                return matchesSearch && matchesRole && matchesDept;
              }).length})</h3>
              {onVacationSoldiers.length === 0 ? (
                <div style={{ opacity: 0.7, padding: 8 }}>אין חיילים בחופשה בתאריך זה</div>
              ) : onVacationSoldiers.filter(({ soldier }) => {
                const matchesSearch = !searchQuery || 
                  soldier.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  soldier.department_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  soldier.roles?.some(r => r.name.toLowerCase().includes(searchQuery.toLowerCase()));
                const matchesRole = !filterRole || soldier.roles?.some(r => r.name === filterRole);
                const matchesDept = !filterDepartment || soldier.department_name === filterDepartment;
                return matchesSearch && matchesRole && matchesDept;
              }).length === 0 ? (
                <div style={{ opacity: 0.7, padding: 8 }}>לא נמצאו תוצאות</div>
              ) : (
                <div style={{ display: "grid", gap: 4, maxHeight: 300, overflowY: "auto" }}>
                  {onVacationSoldiers.filter(({ soldier }) => {
                    const matchesSearch = !searchQuery || 
                      soldier.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      soldier.department_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      soldier.roles?.some(r => r.name.toLowerCase().includes(searchQuery.toLowerCase()));
                    const matchesRole = !filterRole || soldier.roles?.some(r => r.name === filterRole);
                    const matchesDept = !filterDepartment || soldier.department_name === filterDepartment;
                    return matchesSearch && matchesRole && matchesDept;
                  }).map(({ soldier, returnDate }) => (
                    <div key={soldier.id} style={{ padding: 10, border: "1px solid #1f2937", borderRadius: 8, backgroundColor: "rgba(255,255,255,0.01)", opacity: 0.8 }}>
                      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                        <span 
                          onClick={() => openVacations(soldier)}
                          style={{ fontWeight: 500, cursor: "pointer", color: "#60a5fa" }}
                        >
                          {soldier.name}
                        </span>
                        {returnDate && (
                          <span style={{ 
                            fontSize: 11, 
                            color: "#9ca3af", 
                            backgroundColor: "rgba(255,255,255,0.05)", 
                            padding: "2px 6px", 
                            borderRadius: 4 
                          }}>
                            חוזר ב-{returnDate}
                          </span>
                        )}
                      </div>
                      {soldier.department_name && (
                        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>מחלקה: {soldier.department_name}</div>
                      )}
                      {soldier.roles && soldier.roles.length > 0 && (
                        <div style={{ fontSize: 12, opacity: 0.6, marginTop: 2 }}>
                          {soldier.roles.map(r => r.name).join(", ")}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </Modal>

      {/* Vacation Management Modal */}
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

            {/* Vacations list */}
            <table width="100%" cellPadding={7} style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ width: 140 }}>התחלה</th>
                  <th style={{ width: 140 }}>סיום</th>
                  <th>הערות</th>
                  <th style={{ width: 160 }}>פעולות</th>
                </tr>
              </thead>
              <tbody>
                {soldierVacations.map((v) => (
                  <tr key={v.id} style={{ borderTop: "1px solid #eee" }}>
                    <td>{v.start_date}</td>
                    <td>{v.end_date}</td>
                    <td>{v.note ?? <span style={{ opacity: 0.6 }}>(אין)</span>}</td>
                    <td>
                      <button onClick={() => startEditVacation(v)}>ערוך</button>
                      <button 
                        onClick={() => deleteVacation(v)} 
                        style={{ marginLeft: 8, color: "crimson" }}
                      >
                        מחק
                      </button>
                    </td>
                  </tr>
                ))}
                {soldierVacations.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ opacity: 0.7 }}>(אין חופשות)</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  );
}

