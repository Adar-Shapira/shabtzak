import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import Shell from "./layouts/Shell";
import App from "./App";
import RolesPage from "./pages/Roles";
import MissionsPage from "./pages/Missions";
import SoldiersPage from "./pages/Soldiers";
import PlannerPage from "./pages/Planner";
import AssignmentsPage from "./pages/Assignments";
import DepartmentsPage from "./pages/Departments";
import VacationsPage from "./pages/Vacations";
import "./index.css";

const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { index: true, element: <App /> },            // Home
      { path: "roles", element: <RolesPage /> },
      { path: "departments", element: <DepartmentsPage /> },
      { path: "missions", element: <MissionsPage /> },
      { path: "soldiers", element: <SoldiersPage /> },
      { path: "planner", element: <PlannerPage /> },
      { path: "assignments", element: <AssignmentsPage /> },
      { path: "vacations", element: <VacationsPage /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
