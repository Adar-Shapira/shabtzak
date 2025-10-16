// shabtzak-ui\src\layouts\Shell.tsx
import { Outlet } from "react-router-dom";
import NavBar from "../components/NavBar";

export default function Shell() {
  return (
    <div className="app-shell">
      <NavBar />
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
