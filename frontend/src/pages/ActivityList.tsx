import { useState, useEffect } from 'react';
import axios from 'axios';

interface Division {
  id: number;
  division_code: string;
  division_name: string;
}

interface Activity {
  id: number;
  codigo_actividad: string;
  descripcion: string;
  unidad: string;
  cu_total: string;
  material: string;
  mano_obra: string;
  equipo: string;
  division: number;
  division_name: string;
  division_code: string;
}

const ActivityList = () => {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({
    codigo_actividad: '',
    descripcion: '',
    unidad: '',
    material: '0',
    mano_obra: '0',
    equipo: '0',
    division: ''
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [actRes, divRes] = await Promise.all([
        axios.get('http://localhost:8000/api/activities/'),
        axios.get('http://localhost:8000/api/masterformat/')
      ]);
      setActivities(actRes.data);
      setDivisions(divRes.data);
      setLoading(false);
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // Calculate total
      const cu_total = (parseFloat(formData.material) + parseFloat(formData.mano_obra) + parseFloat(formData.equipo)).toString();
      
      await axios.post('http://localhost:8000/api/activities/', {
        ...formData,
        cu_total
      });
      
      setShowModal(false);
      setFormData({
        codigo_actividad: '',
        descripcion: '',
        unidad: '',
        material: '0',
        mano_obra: '0',
        equipo: '0',
        division: ''
      });
      fetchData();
    } catch (err) {
      console.error(err);
      alert('Error al crear la actividad. Verifique los datos.');
    }
  };

  // Group activities by division
  const groupedActivities = activities.reduce((acc, activity) => {
    const label = activity.division_code && activity.division_name 
      ? `${activity.division_code} - ${activity.division_name}`
      : activity.division_name || 'Sin División';
    
    if (!acc[label]) acc[label] = [];
    acc[label].push(activity);
    return acc;
  }, {} as Record<string, Activity[]>);

  if (loading) return <div className="text-center mt-5"><div className="spinner-border text-primary"></div></div>;

  return (
    <div className="container py-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h2 className="mb-0">Catálogo de Actividades</h2>
          <p className="text-muted">Gestión de costos y partidas por MasterFormat</p>
        </div>
        <button 
          className="btn btn-primary shadow-sm"
          onClick={() => setShowModal(true)}
        >
          <i className="bi bi-plus-circle me-2"></i>Nueva Actividad
        </button>
      </div>

      {Object.entries(groupedActivities).length > 0 ? (
        Object.entries(groupedActivities).map(([divName, divActivities]) => (
          <div key={divName} className="mb-5">
            <h4 className="bg-light p-3 border-start border-primary border-4 rounded shadow-sm mb-3">
              {divName}
            </h4>
            <div className="card shadow-sm border-0 overflow-hidden">
              <div className="table-responsive">
                <table className="table table-hover align-middle mb-0">
                  <thead className="table-dark">
                    <tr>
                      <th style={{ width: '120px' }}>Código</th>
                      <th>Descripción</th>
                      <th>Unidad</th>
                      <th className="text-end">Material</th>
                      <th className="text-end">M. Obra</th>
                      <th className="text-end">Equipo</th>
                      <th className="text-end">C.U. Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {divActivities.map(activity => (
                      <tr key={activity.id}>
                        <td className="fw-bold text-primary">{activity.codigo_actividad}</td>
                        <td className="small">{activity.descripcion}</td>
                        <td><span className="badge bg-light text-dark border">{activity.unidad}</span></td>
                        <td className="text-end text-muted">${parseFloat(activity.material).toFixed(2)}</td>
                        <td className="text-end text-muted">${parseFloat(activity.mano_obra).toFixed(2)}</td>
                        <td className="text-end text-muted">${parseFloat(activity.equipo).toFixed(2)}</td>
                        <td className="text-end fw-bold text-success">${parseFloat(activity.cu_total).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ))
      ) : (
        <div className="text-center py-5 bg-light rounded border border-dashed">
          <i className="bi bi-folder-x display-1 text-muted opacity-25"></i>
          <p className="mt-3 text-muted">No hay actividades registradas en la base de datos.</p>
        </div>
      )}

      {/* Modal Nueva Actividad */}
      {showModal && (
        <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-lg modal-dialog-centered">
            <div className="modal-content shadow-lg">
              <div className="modal-header bg-primary text-white">
                <h5 className="modal-title">Nueva Actividad</h5>
                <button type="button" className="btn-close btn-close-white" onClick={() => setShowModal(false)}></button>
              </div>
              <form onSubmit={handleSubmit}>
                <div className="modal-body p-4">
                  <div className="row g-3">
                    <div className="col-md-4">
                      <label className="form-label fw-bold">Código</label>
                      <input 
                        type="text" 
                        name="codigo_actividad" 
                        className="form-control" 
                        value={formData.codigo_actividad} 
                        onChange={handleChange} 
                        required 
                        placeholder="Ej: ACT-001"
                      />
                    </div>
                    <div className="col-md-8">
                      <label className="form-label fw-bold">División MasterFormat</label>
                      <select 
                        name="division" 
                        className="form-select" 
                        value={formData.division} 
                        onChange={handleChange} 
                        required
                      >
                        <option value="">Seleccione una división...</option>
                        {divisions.map(div => (
                          <option key={div.id} value={div.id}>{div.division_code} - {div.division_name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="col-12">
                      <label className="form-label fw-bold">Descripción</label>
                      <textarea 
                        name="descripcion" 
                        className="form-control" 
                        rows={3} 
                        value={formData.descripcion} 
                        onChange={handleChange} 
                        required
                      ></textarea>
                    </div>
                    <div className="col-md-3">
                      <label className="form-label fw-bold">Unidad</label>
                      <input 
                        type="text" 
                        name="unidad" 
                        className="form-control" 
                        value={formData.unidad} 
                        onChange={handleChange} 
                        required 
                        placeholder="Ej: m2, m3, kg"
                      />
                    </div>
                    <div className="col-md-3">
                      <label className="form-label fw-bold">Material ($)</label>
                      <input 
                        type="number" 
                        step="0.01" 
                        name="material" 
                        className="form-control" 
                        value={formData.material} 
                        onChange={handleChange} 
                        required
                      />
                    </div>
                    <div className="col-md-3">
                      <label className="form-label fw-bold">Mano de Obra ($)</label>
                      <input 
                        type="number" 
                        step="0.01" 
                        name="mano_obra" 
                        className="form-control" 
                        value={formData.mano_obra} 
                        onChange={handleChange} 
                        required
                      />
                    </div>
                    <div className="col-md-3">
                      <label className="form-label fw-bold">Equipo ($)</label>
                      <input 
                        type="number" 
                        step="0.01" 
                        name="equipo" 
                        className="form-control" 
                        value={formData.equipo} 
                        onChange={handleChange} 
                        required
                      />
                    </div>
                  </div>
                </div>
                <div className="modal-footer bg-light">
                  <button type="button" className="btn btn-outline-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
                  <button type="submit" className="btn btn-primary px-4">Guardar Actividad</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ActivityList;
