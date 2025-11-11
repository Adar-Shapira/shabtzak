// shabtzak-ui/src/pages/ManpowerCalendar.tsx
import { useEffect, useState, useMemo, useRef } from "react";
import type React from "react";
import {
  api,
  exportManpowerData,
  importManpowerData,
  type ManpowerExportPackage,
  type ManpowerImportSummary,
} from "../api";
import Modal from "../components/Modal";
import VacationsModal from "../components/VacationsModal";
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
  const importFileRef = useRef<HTMLInputElement>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importSummary, setImportSummary] = useState<ManpowerImportSummary | null>(null);
  const [ioError, setIoError] = useState<string | null>(null);

  // Calendar state
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedModalDate, setSelectedModalDate] = useState<string | null>(null);
  
  // Modal for available soldiers
  const modal = useDisclosure(false);
  const [availableSoldiers, setAvailableSoldiers] = useState<Array<{ soldier: Soldier; leavingToday: boolean; returningToday: boolean; nextVacationDate?: string }>>([]);
  const [onVacationSoldiers, setOnVacationSoldiers] = useState<Array<{ soldier: Soldier; leavingToday: boolean; returningToday: boolean; returnDate?: string }>>([]);

  // Vacation modal state
  const vacDlg = useDisclosure(false);
  const [vacSoldier, setVacSoldier] = useState<Soldier | null>(null);

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

  const handleExport = async () => {
    setIoError(null);
    setImportSummary(null);
    setExportBusy(true);
    try {
      const data = await exportManpowerData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const stamp = new Date().toISOString().slice(0, 10);
      link.download = `manpower-${stamp}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      const message = e?.response?.data?.detail ?? e?.message ?? "Failed to export manpower data";
      setIoError(message);
    } finally {
      setExportBusy(false);
    }
  };

  const handleImportClick = () => {
    importFileRef.current?.click();
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIoError(null);
    setImportSummary(null);
    setImportBusy(true);
    try {
      const text = await file.text();
      let parsed: ManpowerExportPackage;
      try {
        parsed = JSON.parse(text) as ManpowerExportPackage;
      } catch {
        throw new Error("קובץ אינו במבנה JSON תקין");
      }
      if (!parsed?.vacations || !Array.isArray(parsed.vacations)) {
        throw new Error("הקובץ אינו מכיל נתוני חופשות");
      }
      const summary = await importManpowerData({ ...parsed, replace: true });
      setImportSummary(summary);
      await loadData();
    } catch (e: any) {
      const message = e?.response?.data?.detail ?? e?.message ?? "Failed to import manpower data";
      setIoError(message);
    } finally {
      setImportBusy(false);
      event.target.value = "";
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
  const openVacations = (s: Soldier) => {
    setVacSoldier(s);
    vacDlg.open();
  };

  // Close vacation modal
  const closeVacations = () => {
    setVacSoldier(null);
    vacDlg.close();
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
    const available: Array<{ soldier: Soldier; leavingToday: boolean; returningToday: boolean; nextVacationDate?: string }> = [];
    const onVacation: Array<{ soldier: Soldier; leavingToday: boolean; returningToday: boolean; returnDate?: string }> = [];
    
    for (const s of soldiers) {
      const vacs = vacations.filter(v => v.soldier_id === s.id);
      const vacToday = vacs.find(v => isInRange(dayISO, v.start_date, v.end_date));
      
      // Find next vacation after the selected day
      const futureVacations = vacs.filter(v => v.start_date > dayISO).sort((a, b) => a.start_date.localeCompare(b.start_date));
      const nextVacation = futureVacations.length > 0 ? futureVacations[0] : undefined;
      
      if (!vacToday) {
        // Not on vacation
        available.push({ 
          soldier: s, 
          leavingToday: false, 
          returningToday: false,
          nextVacationDate: nextVacation?.start_date 
        });
      } else {
        const leavingToday = vacToday.start_date === dayISO;
        const returningToday = vacToday.end_date === dayISO;
        
        // Soldiers who leave today or return today are considered AVAILABLE
        if (leavingToday || returningToday) {
          available.push({ 
            soldier: s, 
            leavingToday, 
            returningToday,
            nextVacationDate: nextVacation?.start_date 
          });
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
    <div style={{ maxWidth: 1200, padding: 0 }}>
      <div style={{ padding: "8px 16px", textAlign: "center", fontSize: 18, fontWeight: 600, marginBottom: 16 }}>
        {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
      </div>

      <input
        ref={importFileRef}
        type="file"
        accept="application/json"
        style={{ display: "none" }}
        onChange={handleImportFile}
      />

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "0 16px 16px" }}>
        <button
          type="button"
          onClick={handleExport}
          disabled={exportBusy}
          style={{
            padding: "8px 16px",
            borderRadius: 8,
            border: "1px solid #10b981",
            backgroundColor: exportBusy ? "rgba(16, 185, 129, 0.2)" : "rgba(16, 185, 129, 0.12)",
            color: "#10b981",
            cursor: exportBusy ? "wait" : "pointer",
            fontWeight: 600,
          }}
        >
          {exportBusy ? "מייצא..." : "ייצוא JSON"}
        </button>
        <button
          type="button"
          onClick={handleImportClick}
          disabled={importBusy}
          style={{
            padding: "8px 16px",
            borderRadius: 8,
            border: "1px solid #2563eb",
            backgroundColor: importBusy ? "rgba(37, 99, 235, 0.15)" : "rgba(37, 99, 235, 0.12)",
            color: "#bfdbfe",
            cursor: importBusy ? "wait" : "pointer",
            fontWeight: 600,
          }}
        >
          {importBusy ? "טוען..." : "ייבוא JSON"}
        </button>
      </div>

      {importSummary && (
        <div style={{ color: "#10b981", marginBottom: 12, padding: "0 16px", fontSize: 14 }}>
          {`ייבוא הושלם: נוספו ${importSummary.created_vacations} חופשות חדשות ונוצרו ${importSummary.created_soldiers} חיילים. נמחקו ${importSummary.cleared_vacations} חופשות קודמות, ${importSummary.skipped_vacations} דילוגים.`}
        </div>
      )}

      {ioError && (
        <div style={{ color: "crimson", marginBottom: 12, padding: "0 16px", fontSize: 14 }}>
          {ioError}
        </div>
      )}

      {err && <div style={{ color: "crimson", marginBottom: 12, marginTop: 12 }}>{err}</div>}


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
        <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
          {/* Search Bar and Filters */}
          <div style={{ display: "grid", gap: 8, flexShrink: 0 }}>
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
                  cursor: "pointer",
                  direction: "rtl",
                  textAlign: "right",
                }}
              >
                <option value="" style={{ backgroundColor: "rgba(17, 24, 39, 0.95)", color: "#e5e7eb" }}>כל המחלקות</option>
                {Array.from(new Set(availableSoldiers
                  .map(({ soldier }) => soldier.department_name)
                  .filter((d): d is string => typeof d === 'string' && d.length > 0)
                )).map(dept => (
                  <option key={dept} value={dept} style={{ backgroundColor: "rgba(17, 24, 39, 0.95)", color: "#e5e7eb" }}>{dept}</option>
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
                  cursor: "pointer",
                  direction: "rtl",
                  textAlign: "right",
                }}
              >
                <option value="" style={{ backgroundColor: "rgba(17, 24, 39, 0.95)", color: "#e5e7eb" }}>כל התפקידים</option>
                {Array.from(new Set(availableSoldiers.flatMap(({ soldier }) => 
                  soldier.roles?.map(r => r.name) || []
                ))).map(role => (
                  <option key={role} value={role} style={{ backgroundColor: "rgba(17, 24, 39, 0.95)", color: "#e5e7eb" }}>{role}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Soldiers Sections - Side by Side */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, flex: 1, minHeight: 0 }}>
            {/* Available Soldiers Section */}
            <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
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
                <div style={{ display: "grid", gap: 4, flex: 1, minHeight: 0, overflowY: "auto" }}>
                  {availableSoldiers.filter(({ soldier }) => {
                const matchesSearch = !searchQuery || 
                  soldier.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  soldier.department_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  soldier.roles?.some(r => r.name.toLowerCase().includes(searchQuery.toLowerCase()));
                const matchesRole = !filterRole || soldier.roles?.some(r => r.name === filterRole);
                const matchesDept = !filterDepartment || soldier.department_name === filterDepartment;
                return matchesSearch && matchesRole && matchesDept;
              }).sort((a, b) => {
                // Priority 1: Soldiers leaving today go to the top
                if (a.leavingToday && !b.leavingToday) return -1;
                if (!a.leavingToday && b.leavingToday) return 1;
                
                // Priority 2: Soldiers returning today go to the bottom
                if (a.returningToday && !b.returningToday) return 1;
                if (!a.returningToday && b.returningToday) return -1;
                
                // Priority 3: Sort by nextVacationDate (closest first)
                // If both have dates, sort by date ascending
                if (a.nextVacationDate && b.nextVacationDate) {
                  return a.nextVacationDate.localeCompare(b.nextVacationDate);
                }
                // If only one has a date, put it first
                if (a.nextVacationDate && !b.nextVacationDate) return -1;
                if (!a.nextVacationDate && b.nextVacationDate) return 1;
                // If neither has a date, maintain original order
                return 0;
              }).map(({ soldier, leavingToday, returningToday, nextVacationDate }) => (
                  <div key={soldier.id} style={{ padding: 10, border: "1px solid #1f2937", borderRadius: 8, backgroundColor: "rgba(255,255,255,0.02)" }}>
                    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => openVacations(soldier)}
                        className="underline"
                      >
                        {soldier.name}
                      </button>
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
                      {nextVacationDate && !leavingToday && !returningToday && (
                        <span style={{ 
                          fontSize: 11, 
                          color: "#9ca3af", 
                          backgroundColor: "rgba(255,255,255,0.05)", 
                          padding: "2px 6px", 
                          borderRadius: 4 
                        }}>
                          יוצא ב-{nextVacationDate}
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
            <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
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
                <div style={{ display: "grid", gap: 4, flex: 1, minHeight: 0, overflowY: "auto" }}>
                  {onVacationSoldiers.filter(({ soldier }) => {
                    const matchesSearch = !searchQuery || 
                      soldier.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      soldier.department_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      soldier.roles?.some(r => r.name.toLowerCase().includes(searchQuery.toLowerCase()));
                    const matchesRole = !filterRole || soldier.roles?.some(r => r.name === filterRole);
                    const matchesDept = !filterDepartment || soldier.department_name === filterDepartment;
                    return matchesSearch && matchesRole && matchesDept;
                  }).sort((a, b) => {
                    // Sort by returnDate (closest first)
                    // If both have dates, sort by date ascending
                    if (a.returnDate && b.returnDate) {
                      return a.returnDate.localeCompare(b.returnDate);
                    }
                    // If only one has a date, put it first
                    if (a.returnDate && !b.returnDate) return -1;
                    if (!a.returnDate && b.returnDate) return 1;
                    // If neither has a date, maintain original order
                    return 0;
                  }).map(({ soldier, returnDate }) => (
                    <div key={soldier.id} style={{ padding: 10, border: "1px solid #1f2937", borderRadius: 8, backgroundColor: "rgba(255,255,255,0.01)", opacity: 0.8 }}>
                      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                        <button
                          type="button"
                          onClick={() => openVacations(soldier)}
                          className="underline"
                        >
                          {soldier.name}
                        </button>
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
      <VacationsModal
        isOpen={vacDlg.isOpen}
        onClose={closeVacations}
        soldier={vacSoldier}
        onVacationsUpdated={loadData}
      />
    </div>
  );
}

