import { NavLink } from 'react-router-dom';

const Navbar = () => {
  return (
    <nav className="navbar navbar-expand-lg navbar-navy mb-4 shadow">
      <div className="container">
        <NavLink className="navbar-brand d-flex align-items-center gap-2 text-decoration-none" to="/">
          <i className="bi bi-building-gear" style={{ fontSize: 26, color: '#fff', flexShrink: 0 }} />
          <div className="d-flex flex-column" style={{ lineHeight: 1.15 }}>
            <span style={{ fontSize: 18, fontWeight: 800, color: '#fff', letterSpacing: '0.06em' }}>
              INIO
            </span>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.82)', letterSpacing: '0.03em', fontWeight: 400 }}>
              Ingeniería de Costos y Especificaciones
            </span>
          </div>
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
            <li className="nav-item">
              <NavLink className="nav-link" to="/schedule-kits">Kits de Cronograma</NavLink>
            </li>
          </ul>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
