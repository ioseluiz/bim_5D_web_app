import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Navbar = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

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

          {/* User info + logout */}
          {user && (
            <div className="d-flex align-items-center gap-3">
              <div className="d-flex align-items-center gap-2">
                <div
                  className="rounded-circle d-flex align-items-center justify-content-center fw-bold"
                  style={{
                    width: 32, height: 32, fontSize: 13,
                    backgroundColor: 'rgba(255,255,255,0.2)',
                    color: '#fff', flexShrink: 0,
                  }}
                >
                  {(user.username || user.email).charAt(0).toUpperCase()}
                </div>
                <div className="d-flex flex-column" style={{ lineHeight: 1.2 }}>
                  <span style={{ fontSize: 12, color: '#fff', fontWeight: 600 }}>
                    {user.username || user.email}
                  </span>
                  {user.is_staff && (
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)' }}>Administrador</span>
                  )}
                </div>
              </div>
              <button
                onClick={handleLogout}
                className="btn btn-sm"
                style={{
                  backgroundColor: 'rgba(255,255,255,0.1)',
                  border: '1px solid rgba(255,255,255,0.25)',
                  color: '#fff', fontSize: 12, padding: '4px 10px',
                }}
                title="Cerrar sesión"
              >
                <i className="bi bi-box-arrow-right me-1" />
                Salir
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
