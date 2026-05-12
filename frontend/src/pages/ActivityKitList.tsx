import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';

interface Activity {
  id: number;
  codigo_actividad: string;
  descripcion: string;
  unidad: string;
  cu_total: string;
  division_name?: string;
  division_code?: string;
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
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDivision, setSelectedDivision] = useState('');

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

  const divisions = useMemo(() => {
    const seen = new Map<string, string>();
    activities.forEach(act => {
      if (act.division_code && !seen.has(act.division_code)) {
        seen.set(act.division_code, act.division_name || act.division_code);
      }
    });
    return Array.from(seen.entries())
      .map(([code, name]) => ({ code, name }))
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [activities]);

  const filteredActivities = useMemo(() => {
    const term = searchTerm.toLowerCase().trim();
    return activities.filter(act => {
      const matchSearch = !term ||
        act.codigo_actividad.toLowerCase().includes(term) ||
        act.descripcion.toLowerCase().includes(term);
      const matchDivision = !selectedDivision || act.division_code === selectedDivision;
      return matchSearch && matchDivision;
    });
  }, [activities, searchTerm, selectedDivision]);

  const handleOpenModal = (kit?: ActivityKit) => {
    setSearchTerm('');
    setSelectedDivision('');
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
      setFormData({ nombre: '', descripcion: '', selectedActivities: [] });
    }
    setShowModal(true);
  };

  const handleToggleActivity = (activityId: number) => {
    setFormData(prev => {
      const isSelected = prev.selectedActivities.includes(activityId);
      return {
        ...prev,
        selectedActivities: isSelected
          ? prev.selectedActivities.filter(id => id !== activityId)
          : [...prev.selectedActivities, activityId]
      };
    });
  };

  const handleSelectVisible = () => {
    const visibleIds = filteredActivities.map(a => a.id);
    setFormData(prev => ({
      ...prev,
      selectedActivities: Array.from(new Set([...prev.selectedActivities, ...visibleIds]))
    }));
  };

  const handleClearAll = () => {
    setFormData(prev => ({ ...prev, selectedActivities: [] }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const data = {
      nombre: formData.nombre,
      descripcion: formData.descripcion,
      activities: formData.selectedActivities
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
        <button className="btn btn-primary shadow-sm" onClick={() => handleOpenModal()}>
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
                  <button className="btn btn-outline-dark btn-sm flex-grow-1 fw-bold" onClick={() => handleOpenModal(kit)}>
                    <i className="bi bi-pencil me-1"></i>Editar Kit
                  </button>
                  <button className="btn btn-outline-danger btn-sm px-3" onClick={() => handleDelete(kit.id)}>
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
              <button className="btn btn-primary" onClick={() => handleOpenModal()}>Crear mi primer Kit</button>
            </div>
          </div>
        )}
      </div>

      {/* Modal Crear/Editar Kit */}
      {showModal && (
        <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
            <div className="modal-content border-0 shadow-lg">
              <div className="modal-header bg-primary text-white py-3">
                <h5 className="modal-title fw-bold">
                  {isEditing ? 'Editar Kit' : 'Nuevo Kit de Actividades'}
                </h5>
                <button type="button" className="btn-close btn-close-white" onClick={() => setShowModal(false)}></button>
              </div>
              <form onSubmit={handleSubmit}>
                <div className="modal-body p-4">
                  <div className="row g-4">
                    {/* Columna izquierda: nombre y descripción */}
                    <div className="col-md-4">
                      <div className="mb-3">
                        <label className="form-label fw-bold">Nombre del Kit</label>
                        <input
                          type="text"
                          className="form-control"
                          value={formData.nombre}
                          onChange={e => setFormData(prev => ({ ...prev, nombre: e.target.value }))}
                          required
                          placeholder="Ej: Zapatas y Cimentación"
                        />
                      </div>
                      <div className="mb-3">
                        <label className="form-label fw-bold text-muted small">Descripción (Opcional)</label>
                        <textarea
                          className="form-control"
                          rows={3}
                          value={formData.descripcion}
                          onChange={e => setFormData(prev => ({ ...prev, descripcion: e.target.value }))}
                        ></textarea>
                      </div>
                      <div className="alert alert-info py-2 small mb-0">
                        <i className="bi bi-info-circle me-1"></i>
                        <strong>{formData.selectedActivities.length}</strong> actividades seleccionadas
                      </div>
                    </div>

                    {/* Columna derecha: selector de actividades */}
                    <div className="col-md-8">
                      <label className="form-label fw-bold">Seleccionar Actividades</label>

                      {/* Filtros */}
                      <div className="row g-2 mb-2">
                        <div className="col-7">
                          <div className="input-group input-group-sm">
                            <span className="input-group-text bg-white">
                              <i className="bi bi-search text-muted"></i>
                            </span>
                            <input
                              type="text"
                              className="form-control"
                              placeholder="Buscar por código o descripción..."
                              value={searchTerm}
                              onChange={e => setSearchTerm(e.target.value)}
                            />
                            {searchTerm && (
                              <button type="button" className="btn btn-outline-secondary" onClick={() => setSearchTerm('')}>
                                <i className="bi bi-x"></i>
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="col-5">
                          <select
                            className="form-select form-select-sm"
                            value={selectedDivision}
                            onChange={e => setSelectedDivision(e.target.value)}
                          >
                            <option value="">Todas las divisiones</option>
                            {divisions.map(div => (
                              <option key={div.code} value={div.code}>
                                {div.code} – {div.name.length > 22 ? div.name.slice(0, 22) + '…' : div.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* Contador y acciones rápidas */}
                      <div className="d-flex justify-content-between align-items-center mb-1 px-1">
                        <small className="text-muted">
                          <span className="fw-semibold text-primary">{formData.selectedActivities.length}</span> seleccionadas
                          {' · '}
                          <span>{filteredActivities.length}</span> visibles
                        </small>
                        <div className="d-flex gap-3">
                          <button type="button" className="btn btn-link btn-sm p-0 text-decoration-none" onClick={handleSelectVisible}>
                            <i className="bi bi-check2-all me-1"></i>Seleccionar visibles
                          </button>
                          <button type="button" className="btn btn-link btn-sm p-0 text-decoration-none text-danger" onClick={handleClearAll}>
                            <i className="bi bi-x-circle me-1"></i>Limpiar
                          </button>
                        </div>
                      </div>

                      {/* Tabla de actividades */}
                      <div className="border rounded" style={{ maxHeight: '340px', overflowY: 'auto' }}>
                        <table className="table table-sm table-hover mb-0">
                          <thead className="table-light" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                            <tr>
                              <th style={{ width: '36px' }}></th>
                              <th style={{ width: '115px' }}>Código</th>
                              <th>Descripción</th>
                              <th className="text-center" style={{ width: '70px' }}>Unidad</th>
                              <th className="text-end" style={{ width: '90px' }}>CU Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredActivities.map(act => {
                              const isSelected = formData.selectedActivities.includes(act.id);
                              return (
                                <tr
                                  key={act.id}
                                  className={isSelected ? 'table-primary' : ''}
                                  style={{ cursor: 'pointer' }}
                                  onClick={() => handleToggleActivity(act.id)}
                                >
                                  <td className="text-center align-middle">
                                    <input
                                      type="checkbox"
                                      className="form-check-input"
                                      checked={isSelected}
                                      onChange={() => handleToggleActivity(act.id)}
                                      onClick={e => e.stopPropagation()}
                                    />
                                  </td>
                                  <td className="align-middle">
                                    <small className="font-monospace fw-semibold text-primary">{act.codigo_actividad}</small>
                                  </td>
                                  <td className="align-middle">
                                    <small>{act.descripcion}</small>
                                  </td>
                                  <td className="text-center align-middle">
                                    <small className="text-muted">{act.unidad}</small>
                                  </td>
                                  <td className="text-end align-middle">
                                    <small className="fw-semibold">${parseFloat(act.cu_total).toFixed(2)}</small>
                                  </td>
                                </tr>
                              );
                            })}
                            {filteredActivities.length === 0 && (
                              <tr>
                                <td colSpan={5} className="text-center text-muted py-4">
                                  <i className="bi bi-search me-1"></i>No se encontraron actividades
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
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
