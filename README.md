# Sistema de Estimación de Costos BIM 5D

Plataforma para relacionar elementos de modelos BIM (IFC) con bases de datos de costos siguiendo el estándar MasterFormat. Arquitectura desacoplada: backend Django con API REST y frontend React/Vite con visor IFC integrado.

## Funcionalidades

- **Gestión de Costos**: Base de datos de actividades con costos unitarios (Material, Mano de Obra, Equipo) organizados por divisiones MasterFormat.
- **Kits de Actividades**: Agrupación de múltiples actividades para asignar a tipos de elementos BIM.
- **Gestión de Proyectos**: Organización de modelos BIM por proyectos.
- **Visor BIM**: Visualización de modelos IFC en el navegador usando [ThatOpen Components](https://thatopen.com/).

## Arquitectura

```
├── backend/              # Django (API REST)
│   ├── accounts/         # Autenticación de usuarios
│   ├── bim/              # Proyectos y modelos IFC
│   ├── costs/            # Actividades MasterFormat y kits
│   └── config/           # Configuración Django (settings, URLs, API)
│
└── frontend/             # React + Vite (SPA)
    └── src/
        ├── components/   # Navbar, BimViewer
        └── pages/        # ProjectList, ProjectDetail, ActivityList, ActivityKitList
```

## Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Backend | Django 6, Django REST Framework, django-cors-headers |
| Frontend | React 19, TypeScript, Vite 8 |
| Visor BIM | ThatOpen Components 3.4, Three.js |
| UI | Bootstrap 5, Bootstrap Icons |
| HTTP | Axios |
| Routing | React Router DOM 7 |

## Instalación

### Backend

```bash
python -m venv venv
.\venv\Scripts\activate          # Windows
pip install -r requirements.txt
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver       # http://localhost:8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev                      # http://localhost:5173
```

Ambos servidores deben estar corriendo simultáneamente en desarrollo.

## Variables de entorno

Crea un archivo `.env` en la raíz del proyecto:

```
SECRET_KEY=tu_clave_secreta
DEBUG=True
```

## Uso

- El frontend React es la interfaz principal: `http://localhost:5173`
- Panel de administración Django en `http://localhost:8000/admin/` para cargar actividades MasterFormat.
- La API REST está disponible en `http://localhost:8000/api/`.

## Desarrollo

```bash
# Lint del frontend
cd frontend && npm run lint

# Build de producción del frontend
cd frontend && npm run build

# Tests backend
pytest
```
