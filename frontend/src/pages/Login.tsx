import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Login = () => {
  const { login } = useAuth();
  const navigate   = useNavigate();

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  // Traduce el fallo a un mensaje que diga qué pasó de verdad.
  //
  // Antes esto era `err?.response?.data?.error ?? 'Error al iniciar sesión.'`,
  // así que un 500 del servidor, un corte de red o un CORS bloqueado se veían
  // exactamente igual que una contraseña mal escrita. Cuando el login empezó a
  // devolver 500 en producción, los usuarios reportaron "mi contraseña es
  // correcta y no puedo entrar" — y el mensaje no ayudaba a distinguirlo.
  const describeError = (err: unknown): string => {
    const response = (err as { response?: { status?: number; data?: unknown } })?.response;

    // Sin respuesta: no se llegó al servidor (red caída, DNS, CORS, timeout).
    if (!response) {
      return 'No se pudo conectar con el servidor. Revisa tu conexión e intenta de nuevo.';
    }

    const status = response.status ?? 0;
    const backendMessage =
      typeof (response.data as { error?: unknown })?.error === 'string'
        ? (response.data as { error: string }).error
        : null;

    // 5xx: el problema es del servidor, no de las credenciales.
    if (status >= 500) {
      return 'El servidor no está disponible en este momento. Intenta de nuevo en unos minutos.';
    }

    // 429, 401, 400: el backend manda un mensaje útil en `error`.
    if (backendMessage) return backendMessage;

    if (status === 429) return 'Demasiados intentos. Intenta de nuevo en un minuto.';
    if (status === 401) return 'Credenciales incorrectas.';

    return 'Error al iniciar sesión.';
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/projects', { replace: true });
    } catch (err: unknown) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-vh-100 d-flex align-items-center justify-content-center bg-light">
      <div className="card shadow border-0" style={{ width: '100%', maxWidth: 420 }}>
        {/* Header */}
        <div className="card-header text-white py-4 text-center" style={{ backgroundColor: '#154b75' }}>
          <i className="bi bi-building-gear" style={{ fontSize: 36 }} />
          <div className="mt-2 fw-bold" style={{ fontSize: 22, letterSpacing: '0.06em' }}>INIO</div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>Ingeniería de Costos y Especificaciones</div>
        </div>

        <div className="card-body p-4">
          <h5 className="mb-4 fw-bold text-center text-secondary">Iniciar Sesión</h5>

          {error && (
            <div className="alert alert-danger py-2 small">
              <i className="bi bi-exclamation-triangle me-2" />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="mb-3">
              <label className="form-label fw-semibold small">Correo electrónico</label>
              <input
                type="email"
                className="form-control"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="usuario@ejemplo.com"
                required
                autoFocus
              />
            </div>
            <div className="mb-4">
              <label className="form-label fw-semibold small">Contraseña</label>
              <input
                type="password"
                className="form-control"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>
            <button
              type="submit"
              className="btn btn-primary w-100 fw-bold py-2"
              style={{ backgroundColor: '#154b75', borderColor: '#154b75' }}
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2" />
                  Verificando…
                </>
              ) : (
                <>
                  <i className="bi bi-box-arrow-in-right me-2" />
                  Ingresar
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Login;
