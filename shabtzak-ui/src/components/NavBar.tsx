// shabtzak-ui\src\components\NavBar.tsx
import { NavLink } from "react-router-dom";

function linkClass({ isActive }: { isActive: boolean }) {
  return "nav-link" + (isActive ? " nav-link-active" : "");
}

export default function NavBar() {
  return (
    <header className="navbar">
      <div className="navbar-inner">
        <div className="brand">Shabtzak</div>
        <nav className="nav">
          {/*<NavLink to="/" end className={linkClass}>Home</NavLink>*/}
          {/*<NavLink to="/roles" className={linkClass}>Roles</NavLink>*/}
          {/*<NavLink to="/departments" className={linkClass}>Departments</NavLink>*/}
          <NavLink to="/missions" className={linkClass}>Missions</NavLink>
          <NavLink to="/soldiers" className={linkClass}>Soldiers</NavLink>
          <NavLink to="/planner" className={linkClass}>Planner</NavLink>
          {/*<NavLink to="/assignments" className={linkClass}>Assignments</NavLink>*/}
          {/*<NavLink to="/vacations" className={linkClass}>Vacations</NavLink>*/}
        </nav>
      </div>
    </header>
  );
}
