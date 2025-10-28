// shabtzak-ui\src\components\Sidebar.tsx
import { useLocation } from "react-router-dom";
import { useSidebar } from "../contexts/SidebarContext";
import { useRef } from "react";
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import AddBusinessIcon from '@mui/icons-material/AddBusiness';
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts';
import AddTaskIcon from '@mui/icons-material/AddTask';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import ShuffleIcon from '@mui/icons-material/Shuffle';
import DeleteIcon from '@mui/icons-material/Delete';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import PeopleIcon from '@mui/icons-material/People';
import LockIcon from '@mui/icons-material/Lock';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';


export default function Sidebar() {
  const { actions } = useSidebar();
  const location = useLocation();
  const path = location.pathname;
  const dateInputRef = useRef<HTMLInputElement>(null);
  const monthInputRef = useRef<HTMLInputElement>(null);
  
  // For Soldiers page
  if (path.includes('/soldiers')) {
    return (
      <aside className="sidebar">
        <div className="sidebar-section">
          <ul className="sidebar-actions">
            <li>
              <button 
                className="btn" 
                onClick={actions?.onAddSoldier}
                title="הוסף חייל"
              >
                <PersonAddIcon style={{ fontSize: 20 }} />
              </button>
            </li>
            <li>
              <button 
                className="btn" 
                onClick={actions?.onAddDepartment}
                title="הוסף מחלקה"
              >
                <AddBusinessIcon style={{ fontSize: 20 }} />
              </button>
            </li>
            <li>
              <button 
                className="btn" 
                onClick={actions?.onManageRoles}
                title="נהל תפקידים"
              >
                <ManageAccountsIcon style={{ fontSize: 20 }} />
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
          <ul className="sidebar-actions">
            <li>
              <button 
                className="btn" 
                onClick={actions?.onAddMission}
                title="הוסף משימה"
              >
                <AddTaskIcon style={{ fontSize: 20 }} />
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
          <ul className="sidebar-actions">
            <li>
              <input
                ref={dateInputRef}
                type="date"
                value={actions?.currentDay || ''}
                onChange={(e) => actions?.onDayChange?.(e.target.value)}
                style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: '1px', height: '1px' }}
              />
              <button 
                className="btn" 
                onClick={() => dateInputRef.current?.showPicker()}
                title="בחר תאריך"
              >
                <CalendarTodayIcon style={{ fontSize: 20 }} />
              </button>
            </li>
            <li>
              <button 
                className="btn" 
                onClick={actions?.onFillPlan}
                disabled={actions?.isLocked}
                title="מלא תכנית"
              >
                <PlayArrowIcon style={{ fontSize: 20 }} />
              </button>
            </li>
            <li>
              <button 
                className="btn" 
                onClick={actions?.onShufflePlan}
                disabled={actions?.isLocked}
                title="ערבב תכנית"
              >
                <ShuffleIcon style={{ fontSize: 20 }} />
              </button>
            </li>
            <li>
              <button 
                className="btn" 
                onClick={actions?.onDeletePlan}
                disabled={actions?.isLocked}
                title="מחק תכנית"
              >
                <DeleteIcon style={{ fontSize: 20 }} />
              </button>
            </li>
            <li>
              <button 
                className="btn" 
                onClick={actions?.onExportFile}
                title="ייצא קובץ"
              >
                <FileDownloadIcon style={{ fontSize: 20 }} />
              </button>
            </li>
            <li>
              <button 
                className="btn" 
                onClick={actions?.onAvailableSoldiers}
                title="חיילים זמינים"
              >
                <PeopleIcon style={{ fontSize: 20 }} />
              </button>
            </li>
            <li>
              <button 
                className="btn" 
                onClick={actions?.onLockToggle}
                title={actions?.lockedText || "נעל"}
              >
                {actions?.isLocked ? <LockIcon style={{ fontSize: 20 }} /> : <LockOpenIcon style={{ fontSize: 20 }} />}
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
          <ul className="sidebar-actions">
            <li>
              <input
                ref={monthInputRef}
                type="month"
                value={actions?.currentMonth || ''}
                onChange={(e) => actions?.onMonthChange?.(e.target.value)}
                style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: '1px', height: '1px' }}
              />
              <button 
                className="btn" 
                onClick={() => monthInputRef.current?.showPicker()}
                title="בחר חודש"
              >
                <CalendarTodayIcon style={{ fontSize: 20 }} />
              </button>
            </li>
            <li>
              <button 
                className="btn" 
                title={'סה"כ חיילים'}
                style={{ fontSize: '16px', fontWeight: 700, color: '#60a5fa' }}
              >
                {actions?.totalSoldiers || 0}
              </button>
            </li>
            <li>
              <button 
                className="btn" 
                title="זמינים היום"
                style={{ fontSize: '16px', fontWeight: 700, color: '#10b981' }}
              >
                {actions?.availableToday || 0}
              </button>
            </li>
            <li>
              <button 
                className="btn" 
                title="בחופשה היום"
                style={{ fontSize: '16px', fontWeight: 700, color: '#f59e0b' }}
              >
                {actions?.onVacationToday || 0}
              </button>
            </li>
          </ul>
        </div>
      </aside>
    );
  }
  
  return null;
}

