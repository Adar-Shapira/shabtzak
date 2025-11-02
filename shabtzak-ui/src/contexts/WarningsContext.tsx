import { createContext, useContext, useState, ReactNode } from 'react';

export interface Warning {
  type: string;
  soldier_name: string;
  soldier_id: number;
  mission_name: string;
  mission_id: number;
  start_at: string;
  end_at: string;
  start_local?: string;
  end_local?: string;
  details: string | null;
  level?: string;
  assignment_id?: number | null;
}

interface WarningsContextType {
  warnings: Warning[];
  setWarnings: (warnings: Warning[]) => void;
  selectedWarning: Warning | null;
  setSelectedWarning: (warning: Warning | null) => void;
}

const WarningsContext = createContext<WarningsContextType | undefined>(undefined);

export function WarningsProvider({ children }: { children: ReactNode }) {
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [selectedWarning, setSelectedWarning] = useState<Warning | null>(null);

  return (
    <WarningsContext.Provider value={{ warnings, setWarnings, selectedWarning, setSelectedWarning }}>
      {children}
    </WarningsContext.Provider>
  );
}

export function useWarnings() {
  const context = useContext(WarningsContext);
  if (!context) {
    throw new Error('useWarnings must be used within a WarningsProvider');
  }
  return context;
}

