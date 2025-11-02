// shabtzak-ui\src\layouts\Shell.tsx
import { Outlet, useLocation } from "react-router-dom";
import { useState, useEffect } from "react";
import NavBar from "../components/NavBar";
import Sidebar from "../components/Sidebar";
import { SidebarProvider } from "../contexts/SidebarContext";
import { WarningsProvider, useWarnings } from "../contexts/WarningsContext";

export default function Shell() {
  return (
    <SidebarProvider>
      <WarningsProvider>
        <ShellContent />
      </WarningsProvider>
    </SidebarProvider>
  );
}

function ShellContent() {
  const [isWarningsCollapsed, setIsWarningsCollapsed] = useState(false);
  
  return (
    <div className="app-shell">
      <NavBar />
      <div className="app-content" style={{ display: 'flex', width: '100%' }}>
        <Sidebar />
        <main className="main" style={{ flex: 1 }}>
          <Outlet />
        </main>
        <WarningsPanelSlot isCollapsed={isWarningsCollapsed} onToggle={() => setIsWarningsCollapsed(!isWarningsCollapsed)} />
      </div>
    </div>
  );
}

function WarningsPanelSlot({ isCollapsed, onToggle }: { isCollapsed: boolean; onToggle: () => void }) {
  const location = useLocation();
  const { warnings, selectedWarning, setSelectedWarning } = useWarnings();
  
  // Only show on planner page
  if (!location.pathname.includes('/planner')) {
    return null;
  }
  
  const formatTime = (iso: string) => {
    try {
      // Extract date and time from ISO string directly without timezone conversion
      // Format: "2025-01-19T14:30:00" -> "19/01/2025 14:30"
      const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):\d{2}/);
      if (match) {
        const [, year, month, day, hour, minute] = match;
        return `${day}/${month}/${year} ${hour}:${minute}`;
      }
      return iso;
    } catch {
      return iso;
    }
  };
  
  // Determine the highest warning level
  const hasRed = warnings.some(w => w.level === "RED");
  const hasOrange = warnings.some(w => w.level === "ORANGE");
  const dotColor = hasRed ? "crimson" : hasOrange ? "#d97706" : null;
  
  return (
    <>
      <div className={`warnings-panel-container ${isCollapsed ? 'collapsed' : ''}`}>
        <button className="warnings-toggle" onClick={onToggle} style={{ position: 'relative' }}>
          !
          {dotColor && <span style={{
            position: 'absolute',
            top: 4,
            right: 4,
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: dotColor
          }} />}
        </button>
        <div className="warnings-panel">
          {warnings.length > 0 && (
            <>
              <h3 style={{ marginBottom: 8, fontSize: 14, fontWeight: 600 }}>התראות</h3>
              <div className="warnings-list">
                {[...warnings].sort((a, b) => {
                  const levelOrder = { RED: 0, ORANGE: 1, GRAY: 2, undefined: 3 };
                  return (levelOrder[a.level as keyof typeof levelOrder] ?? 3) - (levelOrder[b.level as keyof typeof levelOrder] ?? 3);
                }).map((w, i) => {
                  const color = w.level === "RED" ? "crimson" : w.level === "ORANGE" ? "#d97706" : "#374151";
                  return (
                    <div 
                      key={i} 
                      onClick={() => setSelectedWarning(w)}
                      style={{ 
                        fontSize: 11, 
                        padding: 8, 
                        borderRadius: 6, 
                        backgroundColor: 'rgba(255,255,255,0.03)', 
                        borderLeft: `3px solid ${color}`,
                        cursor: 'pointer',
                        transition: 'background 0.2s'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                    >
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>{w.type}</div>
                      <div style={{ fontSize: 10, opacity: 0.8 }}>{w.soldier_name}</div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
      
      {selectedWarning && (
        <div className="modal-overlay" onClick={() => setSelectedWarning(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ margin: 0 }}>פרטי התראה</h2>
              <button 
                onClick={() => setSelectedWarning(null)}
                style={{ 
                  background: 'none', 
                  border: 'none', 
                  color: 'var(--fg)', 
                  fontSize: 24, 
                  cursor: 'pointer',
                  padding: 0,
                  width: 30,
                  height: 30,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                ×
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <strong>סוג:</strong> {selectedWarning.type}
              </div>
              <div>
                <strong>חייל:</strong> {selectedWarning.soldier_name}
              </div>
              <div>
                <strong>משימה:</strong> {selectedWarning.mission_name}
              </div>
              <div>
                <strong>התחלה:</strong> {formatTime(selectedWarning.start_at)}
              </div>
              <div>
                <strong>סיום:</strong> {formatTime(selectedWarning.end_at)}
              </div>
              {selectedWarning.details && (
                <div>
                  <strong>פרטים:</strong> {selectedWarning.details}
                </div>
              )}
              {selectedWarning.level && (
                <div>
                  <strong>רמה:</strong> {selectedWarning.level}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
