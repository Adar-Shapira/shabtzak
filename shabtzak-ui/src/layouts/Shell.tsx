// shabtzak-ui\src\layouts\Shell.tsx
import { Outlet } from "react-router-dom";
import NavBar from "../components/NavBar";
import Sidebar from "../components/Sidebar";
import { SidebarProvider } from "../contexts/SidebarContext";

export default function Shell() {
  return (
    <SidebarProvider>
      <div className="app-shell">
        <NavBar />
        <div className="app-content">
          <Sidebar />
          <main className="main">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
