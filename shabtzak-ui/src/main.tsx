import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider, Navigate } from "react-router-dom";
import Shell from "./layouts/Shell";
//import RolesPage from "./pages/Roles";
import MissionsPage from "./pages/Missions";
import SoldiersPage from "./pages/Soldiers";
import PlannerPage from "./pages/Planner";
import AssignmentsPage from "./pages/Assignments";
import ManpowerCalendarPage from "./pages/ManpowerCalendar";
import SettingsPage from "./pages/Settings";
//import DepartmentsPage from "./pages/Departments";
//import VacationsPage from "./pages/Vacations";
import "./index.css";

const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { index: true, element: <Navigate to="/soldiers" replace /> },
      //{ path: "roles", element: <RolesPage /> },
      //{ path: "departments", element: <DepartmentsPage /> },
      { path: "missions", element: <MissionsPage /> },
      { path: "soldiers", element: <SoldiersPage /> },
      { path: "planner", element: <PlannerPage /> },
      { path: "assignments", element: <AssignmentsPage /> },
      { path: "manpower", element: <ManpowerCalendarPage /> },
      { path: "settings", element: <SettingsPage /> },
      //{ path: "vacations", element: <VacationsPage /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
