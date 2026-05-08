import { useState, useEffect } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';

interface Project {
  id: number;
  nombre: string;
  descripcion: string;
  bim_models: any[];
}

const ProjectList = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [currentProjectId, setCurrentProjectId] = useState<number | null>(null);
  const [formData, setFormData] = useState({
    nombre: '',
    descripcion: ''
  });

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    try {
      const res = await axios.get('http://localhost:8000/api/projects/');
      setProjects(res.data);
      setLoading(false);
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  };

  const handleOpenModal = (project?: Project) => {
    if (project) {
      setIsEditing(true);
      setCurrentProjectId(project.id);
      setFormData({
        nombre: project.nombre,
        descripcion: project.descripcion || ''
      });
    } else {
      setIsEditing(false);
      setCurrentProjectId(null);
      setFormData({
        nombre: '',
        descripcion: ''
      });
    }
    setShowModal(true);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (isEditing && currentProjectId) {
        await axios.put(`http://localhost:8000/api/projects/${currentProjectId}/`, formData);
      } else {
        await axios.post('http://localhost:8000/api/projects/', formData);
      }
      setShowModal(false);
      fetchProjects();
    } catch (err) {
      console.error(err);
      alert('Error al guardar el proyecto.');
    }
  };

  const handleDelete = async (id: number) => {
    if (window.confirm('¿Está seguro de que desea eliminar este proyecto? Se eliminarán todos los modelos asociados.')) {
      try {
        await axios.delete(`http://localhost:8000/api/projects/${id}/`);
        fetchProjects();
      } catch (err) {
        console.error(err);
        alert('Error al eliminar el proyecto.');
      }
    }
  };

  if (loading) return <div className="text-center mt-5"><div className="spinner-border text-primary"></div></div>;

  return (
    <div className="container py-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h2 className="mb-0">Gestión de Proyectos</h2>
          <p className="text-muted">Administre sus proyectos BIM y modelos asociados</p>
        </div>
        <button 
          className="btn btn-primary shadow-sm"
          onClick={() => handleOpenModal()}
        >
          <i className="bi bi-plus-lg me-2"></i>Nuevo Proyecto
        </button>
      </div>

      <div className="row">
        {projects.length > 0 ? (
          projects.map(project => (
            <div key={project.id} className="col-md-4 mb-4">
              <div className="card h-100 shadow-sm border-0 transition-hover">
                <div className="card-body p-4">
                  <div className="d-flex justify-content-between align-items-start mb-2">
                    <h5 className="card-title fw-bold text-primary mb-0">{project.nombre}</h5>
                    <div className="dropdown">
                      <button className="btn btn-link text-muted p-0" data-bs-toggle="dropdown">
                        <i className="bi bi-three-dots-vertical"></i>
                      </button>
                      <ul className="dropdown-menu dropdown-menu-end shadow border-0">
                        <li>
                          <button 
                            className="dropdown-item" 
                            onClick={() => handleOpenModal(project)}
                          >
                            <i className="bi bi-pencil me-2 text-warning"></i>Editar
                          </button>
                        </li>
                        <li>
                          <button 
                            className="dropdown-item text-danger" 
                            onClick={() => handleDelete(project.id)}
                          >
                            <i className="bi bi-trash me-2"></i>Eliminar
                          </button>
                        </li>
                      </ul>
                    </div>
                  </div>
                  <p className="card-text text-muted small" style={{ minHeight: '3rem' }}>
                    {project.descripcion || 'Sin descripción adicional'}
                  </p>
                  <div className="mt-3">
                    <span className="badge bg-light text-primary border border-primary px-3 py-2 rounded-pill">
                      <i className="bi bi-layers me-1"></i>
                      {project.bim_models.length} {project.bim_models.length === 1 ? 'Modelo' : 'Modelos'}
                    </span>
                  </div>
                </div>
                <div className="card-footer bg-light border-0 p-3">
                  <Link 
                    to={`/projects/${project.id}`} 
                    className="btn btn-outline-primary btn-sm w-100 fw-bold"
                  >
                    Abrir Proyecto <i className="bi bi-arrow-right ms-1"></i>
                  </Link>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="col-12 text-center py-5">
            <div className="bg-light rounded p-5 border border-dashed">
              <i className="bi bi-building display-1 text-muted opacity-25"></i>
              <p className="mt-3 fs-5 text-muted">Aún no tiene proyectos registrados.</p>
              <button className="btn btn-primary" onClick={() => handleOpenModal()}>
                Crear mi primer proyecto
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal Crear/Editar Proyecto */}
      {showModal && (
        <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content shadow-lg border-0">
              <div className="modal-header bg-primary text-white border-0 py-3">
                <h5 className="modal-title fw-bold">
                  {isEditing ? 'Editar Proyecto' : 'Nuevo Proyecto'}
                </h5>
                <button type="button" className="btn-close btn-close-white" onClick={() => setShowModal(false)}></button>
              </div>
              <form onSubmit={handleSubmit}>
                <div className="modal-body p-4">
                  <div className="mb-3">
                    <label className="form-label fw-bold">Nombre del Proyecto</label>
                    <input 
                      type="text" 
                      name="nombre" 
                      className="form-control form-control-lg" 
                      value={formData.nombre} 
                      onChange={handleChange} 
                      required 
                      placeholder="Ej: Edificio Central"
                    />
                  </div>
                  <div className="mb-0">
                    <label className="form-label fw-bold">Descripción (Opcional)</label>
                    <textarea 
                      name="descripcion" 
                      className="form-control" 
                      rows={4} 
                      value={formData.descripcion} 
                      onChange={handleChange} 
                      placeholder="Detalles sobre el proyecto..."
                    ></textarea>
                  </div>
                </div>
                <div className="modal-footer bg-light border-0 p-3">
                  <button type="button" className="btn btn-outline-secondary px-4" onClick={() => setShowModal(false)}>Cancelar</button>
                  <button type="submit" className="btn btn-primary px-4 fw-bold">
                    {isEditing ? 'Guardar Cambios' : 'Crear Proyecto'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectList;
