// shabtzak-ui\src\components\Sidebar.tsx
import { useLocation } from "react-router-dom";
import { useSidebar } from "../contexts/SidebarContext";

interface SidebarActions {
  onAddSoldier?: () => void;
  onAddDepartment?: () => void;
  onManageRoles?: () => void;
  onAddMission?: () => void;
  onFillPlan?: () => void;
  onShufflePlan?: () => void;
  onDeletePlan?: () => void;
  onExportFile?: () => void;
  onAvailableSoldiers?: () => void;
  onLockToggle?: () => void;
  currentDay?: string;
  onDayChange?: (day: string) => void;
  currentMonth?: string;
  onMonthChange?: (month: string) => void;
  totalSoldiers?: number;
  availableToday?: number;
  onVacationToday?: number;
}

interface SidebarProps {
  actions?: SidebarActions;
}

export default function Sidebar() {
  const { actions } = useSidebar();
  const location = useLocation();
  const path = location.pathname;
  
  // For Soldiers page
  if (path.includes('/soldiers')) {
    return (
      <aside className="sidebar">
        <div className="sidebar-section">
          <h3 className="sidebar-title">פעולות</h3>
          <ul className="sidebar-actions">
            <li>
              <button 
                className="btn primary" 
                onClick={actions?.onAddSoldier}
                style={{ width: '100%' }}
              >
                הוסף חייל
              </button>
            </li>
            <li>
              <button 
                className="btn" 
                onClick={actions?.onAddDepartment}
                style={{ width: '100%' }}
              >
                הוסף מחלקה
              </button>
            </li>
            <li>
              <button 
                className="btn" 
                onClick={actions?.onManageRoles}
                style={{ width: '100%' }}
              >
                נהל תפקידים
              </button>
            </li>
          </ul>
        </div>
      </aside>
    );
  }
  
  // For Missions page
  if (path.includes('/missions')) {
    return (
      <aside className="sidebar">
        <div className="sidebar-section">
          <h3 className="sidebar-title">פעולות</h3>
          <ul className="sidebar-actions">
            <li>
              <button 
                className="btn primary" 
                onClick={actions?.onAddMission}
                style={{ width: '100%' }}
              >
                הוסף משימה
              </button>
            </li>
          </ul>
        </div>
      </aside>
    );
  }
  
  // For Planner page
  if (path.includes('/planner')) {
    return (
      <aside className="sidebar">
        <div className="sidebar-section">
          <h3 className="sidebar-title">פעולות</h3>
          <ul className="sidebar-actions">
            <li>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 8 }}>תאריך</label>
              <input 
                type="date"
                value={actions?.currentDay || ''}
                onChange={(e) => actions?.onDayChange?.(e.target.value)}
                style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #4b5563', background: '#374151', color: '#e5e7eb' }}
              />
            </li>
            <li>
              <button 
                className="btn primary" 
                onClick={actions?.onFillPlan}
                style={{ width: '100%' }}
              >
                מלא
              </button>
            </li>
            <li>
              <button 
                className="btn" 
                onClick={actions?.onShufflePlan}
                style={{ width: '100%' }}
              >
                ערבב
              </button>
            </li>
            <li>
              <button 
                className="btn" 
                onClick={actions?.onDeletePlan}
                style={{ width: '100%' }}
              >
                מחק
              </button>
            </li>
            <li>
              <button 
                className="btn" 
                onClick={actions?.onExportFile}
                style={{ width: '100%' }}
              >
                ייצא קובץ
              </button>
            </li>
            <li>
              <button 
                className="btn" 
                onClick={actions?.onAvailableSoldiers}
                style={{ width: '100%' }}
              >
                חיילים זמינים
              </button>
            </li>
            <li>
              <button 
                className="btn" 
                onClick={actions?.onLockToggle}
                style={{ width: '100%' }}
              >
                נעל
              </button>
            </li>
          </ul>
        </div>
      </aside>
    );
  }
  
  // For Manpower (סד"ב) page
  if (path.includes('/manpower')) {
    return (
      <aside className="sidebar">
        <div className="sidebar-section">
          <h3 className="sidebar-title">פעולות</h3>
          <ul className="sidebar-actions">
            <li>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 8 }}>חודש</label>
              <input 
                type="month"
                value={actions?.currentMonth || ''}
                onChange={(e) => actions?.onMonthChange?.(e.target.value)}
                style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #4b5563', background: '#374151', color: '#e5e7eb' }}
              />
            </li>
            <li>
              <div style={{ textAlign: 'center', padding: 12, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#60a5fa' }}>
                  {actions?.totalSoldiers || 0}
                </div>
                <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>סה"כ חיילים</div>
              </div>
            </li>
            <li>
              <div style={{ textAlign: 'center', padding: 12, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#10b981' }}>
                  {actions?.availableToday || 0}
                </div>
                <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>זמינים היום</div>
              </div>
            </li>
            <li>
              <div style={{ textAlign: 'center', padding: 12, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#f59e0b' }}>
                  {actions?.onVacationToday || 0}
                </div>
                <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>בחופשה היום</div>
              </div>
            </li>
          </ul>
        </div>
      </aside>
    );
  }
  
  return null;
}

