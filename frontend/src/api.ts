import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000/api',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token');
  if (token) config.headers.Authorization = `Token ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    // Solo redirigir a /login si YA había un token guardado (sesión expirada).
    // En el login inicial no hay token: 401/403 significa credenciales malas
    // y queremos que la página de login muestre el error, no recargar.
    const hadToken = !!localStorage.getItem('auth_token');
    if (hadToken && (err.response?.status === 401 || err.response?.status === 403)) {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  },
);

export default api;
