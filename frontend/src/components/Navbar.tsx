import { NavLink } from 'react-router-dom';

const Navbar = () => {
  return (
    <nav className="navbar navbar-expand-lg navbar-dark bg-dark mb-4 shadow-sm">
      <div className="container">
        <NavLink className="navbar-brand fw-bold" to="/">
          <i className="bi bi-building-gear me-2"></i>INIO BIM 5D
        </NavLink>
        <button className="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNav">
          <span className="navbar-toggler-icon"></span>
        </button>
        <div className="collapse navbar-collapse" id="navbarNav">
          <ul className="navbar-nav me-auto">
            <li className="nav-item">
              <NavLink className="nav-link" to="/projects">Proyectos</NavLink>
            </li>
            <li className="nav-item">
              <NavLink className="nav-link" to="/activities">Actividades</NavLink>
            </li>
            <li className="nav-item">
              <NavLink className="nav-link" to="/kits">Kits de Costos</NavLink>
            </li>
          </ul>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
