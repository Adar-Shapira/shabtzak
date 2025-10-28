// shabtzak-ui/src/App.tsx
import { Routes, Route, Navigate } from "react-router-dom";
import Shell from "./layouts/Shell";

// Pages
import Soldiers from "./pages/Soldiers";
import Missions from "./pages/Missions";
import Planner from "./pages/Planner";
import Assignments from "./pages/Assignments";
import ManpowerCalendar from "./pages/ManpowerCalendar";

export default function App() {
  return (
    <Routes>
      <Route path="/*" element={<Shell />}>
        <Route index element={<Navigate to="/soldiers" replace />} />
        <Route path="soldiers" element={<Soldiers />} />
        <Route path="missions" element={<Missions />} />
        <Route path="planner" element={<Planner />} />
        <Route path="assignments" element={<Assignments />} />
        <Route path="manpower" element={<ManpowerCalendar />} />
      </Route>
    </Routes>
  );
}
