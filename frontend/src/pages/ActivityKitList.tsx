import { useState, useEffect } from 'react';
import axios from 'axios';

interface Activity {
  id: number;
  codigo_actividad: string;
  descripcion: string;
  cu_total: string;
  division_name?: string;
}

interface ActivityKit {
  id: number;
  nombre: string;
  descripcion: string;
  activities: Activity[];
}

const ActivityKitList = () => {
  const [kits, setKits] = useState<ActivityKit[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [currentKitId, setCurrentKitId] = useState<number | null>(null);
  const [formData, setFormData] = useState({
    nombre: '',
    descripcion: '',
    selectedActivities: [] as number[]
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [kitsRes, actRes] = await Promise.all([
        axios.get('http://localhost:8000/api/activity-kits/'),
        axios.get('http://localhost:8000/api/activities/')
      ]);
      setKits(kitsRes.data);
      setActivities(actRes.data);
      setLoading(false);
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  };

  const handleOpenModal = (kit?: ActivityKit) => {
    if (kit) {
      setIsEditing(true);
      setCurrentKitId(kit.id);
      setFormData({
        nombre: kit.nombre,
        descripcion: kit.descripcion || '',
        selectedActivities: kit.activities.map(a => (a as any).id || 0)
      });
    } else {
      setIsEditing(false);
      setCurrentKitId(null);
      setFormData({
        nombre: '',
        descripcion: '',
        selectedActivities: []
      });
    }
    setShowModal(true);
  };

  const handleToggleActivity = (activityId: number) => {
    setFormData(prev => {
      const isSelected = prev.selectedActivities.includes(activityId);
      if (isSelected) {
        return { ...prev, selectedActivities: prev.selectedActivities.filter(id => id !== activityId) };
      } else {
        return { ...prev, selectedActivities: [...prev.selectedActivities, activityId] };
      }
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const data = {
      nombre: formData.nombre,
      descripcion: formData.descripcion,
      activities: formData.selectedActivities // Backend expects list of IDs
    };

    try {
      if (isEditing && currentKitId) {
        await axios.put(`http://localhost:8000/api/activity-kits/${currentKitId}/`, data);
      } else {
        await axios.post('http://localhost:8000/api/activity-kits/', data);
      }
      setShowModal(false);
      fetchData();
    } catch (err) {
      console.error(err);
      alert('Error al guardar el kit.');
    }
  };

  const handleDelete = async (id: number) => {
    if (window.confirm('¿Está seguro de que desea eliminar este kit?')) {
      try {
        await axios.delete(`http://localhost:8000/api/activity-kits/${id}/`);
        fetchData();
      } catch (err) {
        console.error(err);
        alert('Error al eliminar el kit.');
      }
    }
  };

  if (loading) return <div className="text-center mt-5"><div className="spinner-border text-primary"></div></div>;

  return (
    <div className="container py-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h2 className="mb-0">Kits de Actividades (Presupuesto)</h2>
          <p className="text-muted">Agrupe partidas comunes para vincularlas a elementos BIM</p>
        </div>
        <button 
          className="btn btn-primary shadow-sm"
          onClick={() => handleOpenModal()}
        >
          <i className="bi bi-box-seam me-2"></i>Crear Nuevo Kit
        </button>
      </div>

      <div className="row">
        {kits.length > 0 ? (
          kits.map(kit => (
            <div key={kit.id} className="col-md-6 mb-4">
              <div className="card h-100 shadow-sm border-0 border-top border-primary border-4">
                <div className="card-header bg-white py-3 d-flex justify-content-between align-items-center">
                  <h5 className="mb-0 fw-bold text-dark">{kit.nombre}</h5>
                  <span className="badge bg-primary rounded-pill">{kit.activities.length} ítems</span>
                </div>
                <div className="card-body">
                  <p className="text-muted small mb-3">{kit.descripcion || 'Sin descripción adicional.'}</p>
                  <div className="list-group list-group-flush border rounded overflow-hidden" style={{ maxHeight: '200px', overflowY: 'auto' }}>
                    {kit.activities.map((act, idx) => (
                      <div key={idx} className="list-group-item d-flex justify-content-between align-items-center p-2 bg-light-hover">
                        <div className="small">
                          <span className="fw-bold text-primary me-2">{act.codigo_actividad}</span>
                          <span className="text-truncate d-inline-block align-bottom" style={{ maxWidth: '250px' }}>{act.descripcion}</span>
                        </div>
                        <span className="badge bg-white text-success border shadow-xs">${parseFloat(act.cu_total).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="card-footer bg-light border-0 d-flex gap-2 p-3">
                  <button 
                    className="btn btn-outline-dark btn-sm flex-grow-1 fw-bold"
                    onClick={() => handleOpenModal(kit)}
                  >
                    <i className="bi bi-pencil me-1"></i>Editar Kit
                  </button>
                  <button 
                    className="btn btn-outline-danger btn-sm px-3"
                    onClick={() => handleDelete(kit.id)}
                  >
                    <i className="bi bi-trash"></i>
                  </button>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="col-12 text-center py-5">
            <div className="bg-light rounded p-5 border border-dashed">
              <i className="bi bi-folder2-open display-1 text-muted opacity-25"></i>
              <p className="mt-3 fs-5 text-muted">Aún no se han definido kits de actividades.</p>
              <button className="btn btn-primary" onClick={() => handleOpenModal()}>
                Crear mi primer Kit
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal Crear/Editar Kit */}
      {showModal && (
        <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-lg modal-dialog-centered">
            <div className="modal-content border-0 shadow-lg">
              <div className="modal-header bg-primary text-white py-3">
                <h5 className="modal-title fw-bold">
                  {isEditing ? 'Editar Kit' : 'Nuevo Kit de Actividades'}
                </h5>
                <button type="button" className="btn-close btn-close-white" onClick={() => setShowModal(false)}></button>
              </div>
              <form onSubmit={handleSubmit}>
                <div className="modal-body p-4">
                  <div className="mb-3">
                    <label className="form-label fw-bold">Nombre del Kit</label>
                    <input 
                      type="text" 
                      className="form-control form-control-lg" 
                      value={formData.nombre} 
                      onChange={e => setFormData(prev => ({ ...prev, nombre: e.target.value }))} 
                      required 
                      placeholder="Ej: Zapatas y Cimentación"
                    />
                  </div>
                  <div className="mb-4">
                    <label className="form-label fw-bold text-muted small">Descripción (Opcional)</label>
                    <textarea 
                      className="form-control" 
                      rows={2} 
                      value={formData.descripcion} 
                      onChange={e => setFormData(prev => ({ ...prev, descripcion: e.target.value }))} 
                    ></textarea>
                  </div>
                  
                  <h6 className="fw-bold mb-3 border-bottom pb-2">Seleccionar Actividades ({formData.selectedActivities.length})</h6>
                  <div className="row g-2 overflow-auto" style={{ maxHeight: '300px' }}>
                    {activities.map(act => {
                      const isSelected = formData.selectedActivities.includes(act.id);
                      return (
                        <div key={act.id} className="col-12">
                          <div 
                            className={`p-2 border rounded d-flex justify-content-between align-items-center transition-all ${isSelected ? 'bg-primary border-primary text-white shadow-sm' : 'bg-white border-light text-dark'}`}
                            style={{ cursor: 'pointer' }}
                            onClick={() => handleToggleActivity(act.id)}
                          >
                            <div className="d-flex align-items-center overflow-hidden">
                              <i className={`bi ${isSelected ? 'bi-check-circle-fill' : 'bi-circle'} me-3`}></i>
                              <div className="text-truncate">
                                <div className="fw-bold small">{act.codigo_actividad}</div>
                                <div className={`small ${isSelected ? 'text-white-50' : 'text-muted'} text-truncate`}>{act.descripcion}</div>
                              </div>
                            </div>
                            <span className={`badge ${isSelected ? 'bg-white text-primary' : 'bg-light text-success'} ms-2`}>
                              ${parseFloat(act.cu_total).toFixed(2)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="modal-footer bg-light border-0 p-3">
                  <button type="button" className="btn btn-outline-secondary px-4" onClick={() => setShowModal(false)}>Cancelar</button>
                  <button type="submit" className="btn btn-primary px-4 fw-bold" disabled={formData.selectedActivities.length === 0}>
                    {isEditing ? 'Guardar Cambios' : 'Crear Kit'}
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

export default ActivityKitList;
