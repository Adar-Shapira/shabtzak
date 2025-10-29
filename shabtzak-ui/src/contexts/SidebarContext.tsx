// shabtzak-ui\src\contexts\SidebarContext.tsx
import React, { createContext, useContext, useState, ReactNode } from 'react';

export interface SidebarActions {
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
  onSavePlan?: () => void;
  onLoadSavedPlans?: () => void;
  currentDay?: string;
  onDayChange?: (day: string) => void;
  currentMonth?: string;
  onMonthChange?: (month: string) => void;
  totalSoldiers?: number;
  availableToday?: number;
  onVacationToday?: number;
  isLocked?: boolean;
  lockedText?: string;
}

interface SidebarContextType {
  actions: SidebarActions;
  setActions: (actions: SidebarActions) => void;
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<SidebarActions>({});
  
  return (
    <SidebarContext.Provider value={{ actions, setActions }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error('useSidebar must be used within a SidebarProvider');
  }
  return context;
}

