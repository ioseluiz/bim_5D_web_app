import { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import axios from 'axios';

const API = 'http://localhost:8000/api';

interface MasterFormat {
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
  division_name?: string;
  division_code?: string;
  proyecto?: number | null;
  base_actividad?: number | null;
  es_proyecto?: boolean;
}

interface ActivityKit {
  id: number;
  nombre: string;
  descripcion: string;
  activities: Activity[];
  proyecto?: number | null;
}

interface Project {
  id: number;
  nombre: string;
  descripcion: string;
}

type ActivitySource = 'all' | 'master' | 'proyecto';

const ProjectKits = () => {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [activeTab, setActiveTab] = useState<'kits' | 'actividades'>('kits');

  const [projectKits, setProjectKits] = useState<ActivityKit[]>([]);
  const [masterKits, setMasterKits] = useState<ActivityKit[]>([]);
  const [projectActivities, setProjectActivities] = useState<Activity[]>([]);
  const [masterActivities, setMasterActivities] = useState<Activity[]>([]);
  const [divisions, setDivisions] = useState<MasterFormat[]>([]);

  const [loading, setLoading] = useState(true);

  // Kit modal
  const [showKitModal, setShowKitModal] = useState(false);
  const [showCopyMasterModal, setShowCopyMasterModal] = useState(false);
  const [isEditingKit, setIsEditingKit] = useState(false);
  const [currentKitId, setCurrentKitId] = useState<number | null>(null);
  const [kitForm, setKitForm] = useState({ nombre: '', descripcion: '', selectedActivities: [] as number[] });
  const [kitSearchTerm, setKitSearchTerm] = useState('');
  const [kitSelectedDivision, setKitSelectedDivision] = useState('');
  const [kitActivitySource, setKitActivitySource] = useState<ActivitySource>('all');

  // Activity modal
  const [showActivityModal, setShowActivityModal] = useState(false);
  const [isEditingActivity, setIsEditingActivity] = useState(false);
  const [currentActivityId, setCurrentActivityId] = useState<number | null>(null);
  const [activityForm, setActivityForm] = useState({
    codigo_actividad: '',
    descripcion: '',
    unidad: '',
    material: '0',
    mano_obra: '0',
    equipo: '0',
    division: '' as string | number,
    base_actividad: null as number | null,
  });
  const [activitySearchTerm, setActivitySearchTerm] = useState('');

  useEffect(() => { fetchAll(); }, [id]);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [projRes, projKitsRes, masterKitsRes, projActRes, masterActRes, divsRes] = await Promise.all([
        axios.get(`${API}/projects/${id}/`),
        axios.get(`${API}/activity-kits/?proyecto=${id}`),
        axios.get(`${API}/activity-kits/`),
        axios.get(`${API}/activities/?proyecto=${id}`),
        axios.get(`${API}/activities/`),
        axios.get(`${API}/masterformat/`),
      ]);
      setProject(projRes.data);
      setProjectKits(projKitsRes.data);
      setMasterKits(masterKitsRes.data);
      setProjectActivities(projActRes.data);
      setMasterActivities(masterActRes.data);
      setDivisions(divsRes.data);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  // --- Computed ---

  const allActivitiesForKit = useMemo(() => {
    if (kitActivitySource === 'master') return masterActivities;
    if (kitActivitySource === 'proyecto') return projectActivities;
    return [...masterActivities, ...projectActivities];
  }, [masterActivities, projectActivities, kitActivitySource]);

  const kitDivisions = useMemo(() => {
    const seen = new Map<string, string>();
    allActivitiesForKit.forEach(act => {
      if (act.division_code && !seen.has(act.division_code)) {
        seen.set(act.division_code, act.division_name || act.division_code);
      }
    });
    return Array.from(seen.entries())
      .map(([code, name]) => ({ code, name }))
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [allActivitiesForKit]);

  const filteredKitActivities = useMemo(() => {
    const term = kitSearchTerm.toLowerCase().trim();
    return allActivitiesForKit.filter(act => {
      const matchSearch = !term ||
        act.codigo_actividad.toLowerCase().includes(term) ||
        act.descripcion.toLowerCase().includes(term);
      const matchDiv = !kitSelectedDivision || act.division_code === kitSelectedDivision;
      return matchSearch && matchDiv;
    });
  }, [allActivitiesForKit, kitSearchTerm, kitSelectedDivision]);

  const filteredProjectActivities = useMemo(() => {
    const term = activitySearchTerm.toLowerCase().trim();
    return projectActivities.filter(act =>
      !term ||
      act.codigo_actividad.toLowerCase().includes(term) ||
      act.descripcion.toLowerCase().includes(term)
    );
  }, [projectActivities, activitySearchTerm]);

  const computedCuTotal = useMemo(() => {
    const m = parseFloat(activityForm.material) || 0;
    const mo = parseFloat(activityForm.mano_obra) || 0;
    const e = parseFloat(activityForm.equipo) || 0;
    return (m + mo + e).toFixed(4);
  }, [activityForm.material, activityForm.mano_obra, activityForm.equipo]);

  // --- Kit handlers ---

  const handleOpenKitModal = (kit?: ActivityKit) => {
    setKitSearchTerm('');
    setKitSelectedDivision('');
    setKitActivitySource('all');
    if (kit) {
      setIsEditingKit(true);
      setCurrentKitId(kit.id);
      setKitForm({
        nombre: kit.nombre,
        descripcion: kit.descripcion || '',
        selectedActivities: kit.activities.map(a => a.id),
      });
    } else {
      setIsEditingKit(false);
      setCurrentKitId(null);
      setKitForm({ nombre: '', descripcion: '', selectedActivities: [] });
    }
    setShowKitModal(true);
  };

  const handleToggleKitActivity = (actId: number) => {
    setKitForm(prev => {
      const isSelected = prev.selectedActivities.includes(actId);
      return {
        ...prev,
        selectedActivities: isSelected
          ? prev.selectedActivities.filter(i => i !== actId)
          : [...prev.selectedActivities, actId],
      };
    });
  };

  const handleKitSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const data = {
      nombre: kitForm.nombre,
      descripcion: kitForm.descripcion,
      activities: kitForm.selectedActivities,
      proyecto: parseInt(id!),
    };
    try {
      if (isEditingKit && currentKitId) {
        await axios.put(`${API}/activity-kits/${currentKitId}/`, data);
      } else {
        await axios.post(`${API}/activity-kits/`, data);
      }
      setShowKitModal(false);
      fetchAll();
    } catch (err) {
      console.error(err);
      alert('Error al guardar el kit.');
    }
  };

  const handleDeleteKit = async (kitId: number) => {
    if (!window.confirm('¿Está seguro de que desea eliminar este kit del proyecto?')) return;
    try {
      await axios.delete(`${API}/activity-kits/${kitId}/`);
      fetchAll();
    } catch (err) {
      console.error(err);
      alert('Error al eliminar el kit.');
    }
  };

  const handleCopyMasterKit = async (masterKitId: number) => {
    try {
      await axios.post(`${API}/activity-kits/${masterKitId}/copy_to_project/`, { proyecto: parseInt(id!) });
      setShowCopyMasterModal(false);
      fetchAll();
    } catch (err) {
      console.error(err);
      alert('Error al copiar el kit maestro.');
    }
  };

  // --- Activity handlers ---

  const handleOpenActivityModal = (activity?: Activity) => {
    if (activity) {
      setIsEditingActivity(true);
      setCurrentActivityId(activity.id);
      setActivityForm({
        codigo_actividad: activity.codigo_actividad,
        descripcion: activity.descripcion,
        unidad: activity.unidad,
        material: activity.material,
        mano_obra: activity.mano_obra,
        equipo: activity.equipo,
        division: activity.division,
        base_actividad: activity.base_actividad || null,
      });
    } else {
      setIsEditingActivity(false);
      setCurrentActivityId(null);
      setActivityForm({
        codigo_actividad: '',
        descripcion: '',
        unidad: '',
        material: '0',
        mano_obra: '0',
        equipo: '0',
        division: '',
        base_actividad: null,
      });
    }
    setShowActivityModal(true);
  };

  const handleBaseActivityChange = (masterActId: number) => {
    const act = masterActivities.find(a => a.id === masterActId);
    if (act) {
      setActivityForm(prev => ({
        ...prev,
        base_actividad: masterActId,
        codigo_actividad: act.codigo_actividad,
        descripcion: act.descripcion,
        unidad: act.unidad,
        material: act.material,
        mano_obra: act.mano_obra,
        equipo: act.equipo,
        division: act.division,
      }));
    } else {
      setActivityForm(prev => ({ ...prev, base_actividad: null }));
    }
  };

  const handleActivitySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const data = {
      ...activityForm,
      cu_total: computedCuTotal,
      proyecto: parseInt(id!),
    };
    try {
      if (isEditingActivity && currentActivityId) {
        await axios.put(`${API}/activities/${currentActivityId}/`, data);
      } else {
        await axios.post(`${API}/activities/`, data);
      }
      setShowActivityModal(false);
      fetchAll();
    } catch (err) {
      console.error(err);
      alert('Error al guardar la actividad.');
    }
  };

  const handleDeleteActivity = async (actId: number) => {
    if (!window.confirm('¿Está seguro de que desea eliminar esta actividad del proyecto?')) return;
    try {
      await axios.delete(`${API}/activities/${actId}/`);
      fetchAll();
    } catch (err) {
      console.error(err);
      alert('Error al eliminar la actividad.');
    }
  };

  if (loading) return <div className="text-center mt-5"><div className="spinner-border text-warning"></div></div>;
  if (!project) return <div className="alert alert-danger m-4">Proyecto no encontrado.</div>;

  return (
    <div className="container py-4">

      {/* Header */}
      <div className="d-flex justify-content-between align-items-center mb-4 bg-white p-3 shadow-sm rounded border-start border-warning border-4">
        <div>
          <nav aria-label="breadcrumb">
            <ol className="breadcrumb mb-1 small">
              <li className="breadcrumb-item"><Link to="/projects" className="text-decoration-none">Proyectos</Link></li>
              <li className="breadcrumb-item"><Link to={`/projects/${id}`} className="text-decoration-none">{project.nombre}</Link></li>
              <li className="breadcrumb-item active">Kits y Actividades</li>
            </ol>
          </nav>
          <h3 className="mb-0 fw-bold">{project.nombre}</h3>
          <p className="text-muted mb-0 small">Gestión de kits y actividades específicas del proyecto</p>
        </div>
        <Link to={`/projects/${id}`} className="btn btn-outline-secondary btn-sm">
          <i className="bi bi-arrow-left me-1"></i>Volver al Proyecto
        </Link>
      </div>

      {/* Tabs */}
      <ul className="nav nav-tabs mb-4">
        <li className="nav-item">
          <button
            className={`nav-link fw-bold ${activeTab === 'kits' ? 'active' : ''}`}
            onClick={() => setActiveTab('kits')}
          >
            <i className="bi bi-box-seam me-2"></i>Kits del Proyecto
            <span className="badge bg-warning text-dark ms-2 rounded-pill">{projectKits.length}</span>
          </button>
        </li>
        <li className="nav-item">
          <button
            className={`nav-link fw-bold ${activeTab === 'actividades' ? 'active' : ''}`}
            onClick={() => setActiveTab('actividades')}
          >
            <i className="bi bi-list-task me-2"></i>Actividades del Proyecto
            <span className="badge bg-warning text-dark ms-2 rounded-pill">{projectActivities.length}</span>
          </button>
        </li>
      </ul>

      {/* ===== TAB: KITS ===== */}
      {activeTab === 'kits' && (
        <>
          <div className="d-flex justify-content-between align-items-center mb-3">
            <p className="text-muted mb-0 small">
              Kits específicos del proyecto. Pueden copiarse desde los kits maestros o crearse desde cero.
            </p>
            <div className="d-flex gap-2">
              <button className="btn btn-outline-secondary btn-sm" onClick={() => setShowCopyMasterModal(true)}>
                <i className="bi bi-copy me-1"></i>Importar Kit Maestro
              </button>
              <button className="btn btn-warning btn-sm fw-bold shadow-sm" onClick={() => handleOpenKitModal()}>
                <i className="bi bi-plus-circle me-1"></i>Nuevo Kit
              </button>
            </div>
          </div>

          <div className="row">
            {projectKits.length > 0 ? projectKits.map(kit => (
              <div key={kit.id} className="col-md-6 mb-4">
                <div className="card h-100 shadow-sm border-0 border-top border-warning border-4">
                  <div className="card-header bg-white py-3 d-flex justify-content-between align-items-center">
                    <h5 className="mb-0 fw-bold text-dark">{kit.nombre}</h5>
                    <span className="badge bg-warning text-dark rounded-pill">{kit.activities.length} ítems</span>
                  </div>
                  <div className="card-body">
                    <p className="text-muted small mb-3">{kit.descripcion || 'Sin descripción adicional.'}</p>
                    <div className="list-group list-group-flush border rounded overflow-hidden" style={{ maxHeight: '200px', overflowY: 'auto' }}>
                      {kit.activities.length === 0 && (
                        <div className="list-group-item text-center text-muted small py-3">Sin actividades asignadas</div>
                      )}
                      {kit.activities.map((act, idx) => (
                        <div key={idx} className="list-group-item d-flex justify-content-between align-items-center p-2">
                          <div className="small">
                            <span className={`fw-bold me-2 ${act.es_proyecto ? 'text-warning' : 'text-primary'}`}>
                              {act.es_proyecto && <i className="bi bi-star-fill me-1" title="Actividad del proyecto"></i>}
                              {act.codigo_actividad}
                            </span>
                            <span className="text-truncate d-inline-block align-bottom" style={{ maxWidth: '220px' }}>
                              {act.descripcion}
                            </span>
                          </div>
                          <span className="badge bg-white text-success border shadow-sm">
                            ${parseFloat(act.cu_total).toFixed(2)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="card-footer bg-light border-0 d-flex gap-2 p-3">
                    <button className="btn btn-outline-dark btn-sm flex-grow-1 fw-bold" onClick={() => handleOpenKitModal(kit)}>
                      <i className="bi bi-pencil me-1"></i>Editar Kit
                    </button>
                    <button className="btn btn-outline-danger btn-sm px-3" onClick={() => handleDeleteKit(kit.id)}>
                      <i className="bi bi-trash"></i>
                    </button>
                  </div>
                </div>
              </div>
            )) : (
              <div className="col-12 text-center py-5">
                <div className="bg-light rounded p-5 border">
                  <i className="bi bi-folder2-open display-1 text-muted opacity-25"></i>
                  <p className="mt-3 fs-5 text-muted">No hay kits definidos para este proyecto.</p>
                  <div className="d-flex gap-2 justify-content-center">
                    <button className="btn btn-outline-secondary" onClick={() => setShowCopyMasterModal(true)}>
                      <i className="bi bi-copy me-1"></i>Importar Kit Maestro
                    </button>
                    <button className="btn btn-warning" onClick={() => handleOpenKitModal()}>
                      <i className="bi bi-plus-circle me-1"></i>Crear Nuevo Kit
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* ===== TAB: ACTIVIDADES ===== */}
      {activeTab === 'actividades' && (
        <>
          <div className="d-flex justify-content-between align-items-center mb-3">
            <p className="text-muted mb-0 small">
              Actividades específicas del proyecto. Pueden basarse en actividades maestras o crearse desde cero.
            </p>
            <button className="btn btn-warning btn-sm fw-bold shadow-sm" onClick={() => handleOpenActivityModal()}>
              <i className="bi bi-plus-circle me-1"></i>Nueva Actividad
            </button>
          </div>

          <div className="mb-3">
            <div className="input-group input-group-sm" style={{ maxWidth: '400px' }}>
              <span className="input-group-text bg-white"><i className="bi bi-search text-muted"></i></span>
              <input
                type="text"
                className="form-control"
                placeholder="Buscar por código o descripción..."
                value={activitySearchTerm}
                onChange={e => setActivitySearchTerm(e.target.value)}
              />
              {activitySearchTerm && (
                <button type="button" className="btn btn-outline-secondary" onClick={() => setActivitySearchTerm('')}>
                  <i className="bi bi-x"></i>
                </button>
              )}
            </div>
          </div>

          {filteredProjectActivities.length > 0 ? (
            <div className="table-responsive">
              <table className="table table-hover shadow-sm border rounded">
                <thead className="table-dark">
                  <tr>
                    <th>Código</th>
                    <th>Descripción</th>
                    <th>División</th>
                    <th className="text-center">Unidad</th>
                    <th className="text-end">Material</th>
                    <th className="text-end">Mano de Obra</th>
                    <th className="text-end">Equipo</th>
                    <th className="text-end">CU Total</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProjectActivities.map(act => (
                    <tr key={act.id}>
                      <td>
                        <span className="font-monospace fw-semibold text-warning">{act.codigo_actividad}</span>
                        {act.base_actividad && (
                          <span className="badge bg-light text-secondary border ms-1 small" title="Basada en actividad maestra">
                            <i className="bi bi-diagram-2"></i>
                          </span>
                        )}
                      </td>
                      <td><small>{act.descripcion}</small></td>
                      <td><small className="text-muted">{act.division_code} – {act.division_name}</small></td>
                      <td className="text-center"><small>{act.unidad}</small></td>
                      <td className="text-end"><small>${parseFloat(act.material).toFixed(2)}</small></td>
                      <td className="text-end"><small>${parseFloat(act.mano_obra).toFixed(2)}</small></td>
                      <td className="text-end"><small>${parseFloat(act.equipo).toFixed(2)}</small></td>
                      <td className="text-end"><strong className="text-success">${parseFloat(act.cu_total).toFixed(2)}</strong></td>
                      <td>
                        <div className="d-flex gap-1 justify-content-end">
                          <button className="btn btn-outline-secondary btn-sm" onClick={() => handleOpenActivityModal(act)} title="Editar">
                            <i className="bi bi-pencil"></i>
                          </button>
                          <button className="btn btn-outline-danger btn-sm" onClick={() => handleDeleteActivity(act.id)} title="Eliminar">
                            <i className="bi bi-trash"></i>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-5">
              <div className="bg-light rounded p-5 border">
                <i className="bi bi-list-task display-1 text-muted opacity-25"></i>
                <p className="mt-3 fs-5 text-muted">
                  {activitySearchTerm
                    ? 'No se encontraron actividades con ese criterio.'
                    : 'No hay actividades definidas para este proyecto.'}
                </p>
                {!activitySearchTerm && (
                  <button className="btn btn-warning" onClick={() => handleOpenActivityModal()}>
                    <i className="bi bi-plus-circle me-1"></i>Crear Primera Actividad
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* ===== MODAL: Crear/Editar Kit ===== */}
      {showKitModal && (
        <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
            <div className="modal-content border-0 shadow-lg">
              <div className="modal-header bg-warning py-3">
                <h5 className="modal-title fw-bold text-dark">
                  {isEditingKit ? 'Editar Kit del Proyecto' : 'Nuevo Kit del Proyecto'}
                </h5>
                <button type="button" className="btn-close" onClick={() => setShowKitModal(false)}></button>
              </div>
              <form onSubmit={handleKitSubmit}>
                <div className="modal-body p-4">
                  <div className="row g-4">

                    {/* Columna izquierda */}
                    <div className="col-md-4">
                      <div className="mb-3">
                        <label className="form-label fw-bold">Nombre del Kit</label>
                        <input
                          type="text"
                          className="form-control"
                          value={kitForm.nombre}
                          onChange={e => setKitForm(prev => ({ ...prev, nombre: e.target.value }))}
                          required
                          placeholder="Ej: Cimentación de Proyecto X"
                        />
                      </div>
                      <div className="mb-3">
                        <label className="form-label fw-bold text-muted small">Descripción (Opcional)</label>
                        <textarea
                          className="form-control"
                          rows={3}
                          value={kitForm.descripcion}
                          onChange={e => setKitForm(prev => ({ ...prev, descripcion: e.target.value }))}
                        />
                      </div>
                      <div className="alert alert-warning py-2 small mb-0">
                        <i className="bi bi-info-circle me-1"></i>
                        <strong>{kitForm.selectedActivities.length}</strong> actividades seleccionadas
                      </div>
                      <div className="mt-3 p-2 bg-light rounded border small text-muted">
                        <i className="bi bi-star-fill text-warning me-1"></i> Actividades del proyecto
                        <span className="ms-3 text-primary fw-bold">■</span> Actividades maestras
                      </div>
                    </div>

                    {/* Columna derecha */}
                    <div className="col-md-8">
                      <label className="form-label fw-bold">Seleccionar Actividades</label>

                      {/* Fuente de actividades */}
                      <div className="btn-group btn-group-sm w-100 mb-2" role="group">
                        {([
                          { key: 'all', label: 'Todas' },
                          { key: 'master', label: 'Solo Maestras' },
                          { key: 'proyecto', label: 'Solo del Proyecto' },
                        ] as { key: ActivitySource; label: string }[]).map(opt => (
                          <button
                            key={opt.key}
                            type="button"
                            className={`btn ${kitActivitySource === opt.key ? 'btn-dark' : 'btn-outline-dark'}`}
                            onClick={() => setKitActivitySource(opt.key)}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>

                      {/* Filtros de búsqueda */}
                      <div className="row g-2 mb-2">
                        <div className="col-7">
                          <div className="input-group input-group-sm">
                            <span className="input-group-text bg-white">
                              <i className="bi bi-search text-muted"></i>
                            </span>
                            <input
                              type="text"
                              className="form-control"
                              placeholder="Buscar..."
                              value={kitSearchTerm}
                              onChange={e => setKitSearchTerm(e.target.value)}
                            />
                            {kitSearchTerm && (
                              <button type="button" className="btn btn-outline-secondary" onClick={() => setKitSearchTerm('')}>
                                <i className="bi bi-x"></i>
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="col-5">
                          <select
                            className="form-select form-select-sm"
                            value={kitSelectedDivision}
                            onChange={e => setKitSelectedDivision(e.target.value)}
                          >
                            <option value="">Todas las divisiones</option>
                            {kitDivisions.map(div => (
                              <option key={div.code} value={div.code}>
                                {div.code} – {div.name.length > 22 ? div.name.slice(0, 22) + '…' : div.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* Acciones rápidas */}
                      <div className="d-flex justify-content-between align-items-center mb-1 px-1">
                        <small className="text-muted">
                          <span className="fw-semibold text-warning">{kitForm.selectedActivities.length}</span> seleccionadas
                          {' · '}
                          <span>{filteredKitActivities.length}</span> visibles
                        </small>
                        <div className="d-flex gap-3">
                          <button
                            type="button"
                            className="btn btn-link btn-sm p-0 text-decoration-none"
                            onClick={() => setKitForm(prev => ({
                              ...prev,
                              selectedActivities: Array.from(new Set([
                                ...prev.selectedActivities,
                                ...filteredKitActivities.map(a => a.id)
                              ]))
                            }))}
                          >
                            <i className="bi bi-check2-all me-1"></i>Seleccionar visibles
                          </button>
                          <button
                            type="button"
                            className="btn btn-link btn-sm p-0 text-decoration-none text-danger"
                            onClick={() => setKitForm(prev => ({ ...prev, selectedActivities: [] }))}
                          >
                            <i className="bi bi-x-circle me-1"></i>Limpiar
                          </button>
                        </div>
                      </div>

                      {/* Tabla de actividades */}
                      <div className="border rounded" style={{ maxHeight: '320px', overflowY: 'auto' }}>
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
                            {filteredKitActivities.map(act => {
                              const isSelected = kitForm.selectedActivities.includes(act.id);
                              return (
                                <tr
                                  key={act.id}
                                  className={isSelected ? 'table-warning' : ''}
                                  style={{ cursor: 'pointer' }}
                                  onClick={() => handleToggleKitActivity(act.id)}
                                >
                                  <td className="text-center align-middle">
                                    <input
                                      type="checkbox"
                                      className="form-check-input"
                                      checked={isSelected}
                                      onChange={() => handleToggleKitActivity(act.id)}
                                      onClick={e => e.stopPropagation()}
                                    />
                                  </td>
                                  <td className="align-middle">
                                    <small className={`font-monospace fw-semibold ${act.es_proyecto ? 'text-warning' : 'text-primary'}`}>
                                      {act.es_proyecto && <i className="bi bi-star-fill me-1"></i>}
                                      {act.codigo_actividad}
                                    </small>
                                  </td>
                                  <td className="align-middle"><small>{act.descripcion}</small></td>
                                  <td className="text-center align-middle">
                                    <small className="text-muted">{act.unidad}</small>
                                  </td>
                                  <td className="text-end align-middle">
                                    <small className="fw-semibold">${parseFloat(act.cu_total).toFixed(2)}</small>
                                  </td>
                                </tr>
                              );
                            })}
                            {filteredKitActivities.length === 0 && (
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
                  <button type="button" className="btn btn-outline-secondary px-4" onClick={() => setShowKitModal(false)}>
                    Cancelar
                  </button>
                  <button type="submit" className="btn btn-warning px-4 fw-bold">
                    {isEditingKit ? 'Guardar Cambios' : 'Crear Kit'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ===== MODAL: Importar Kit Maestro ===== */}
      {showCopyMasterModal && (
        <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
            <div className="modal-content border-0 shadow-lg">
              <div className="modal-header bg-secondary text-white py-3">
                <h5 className="modal-title fw-bold">Importar Kit de la Base Maestra</h5>
                <button type="button" className="btn-close btn-close-white" onClick={() => setShowCopyMasterModal(false)}></button>
              </div>
              <div className="modal-body p-4">
                <div className="alert alert-info small py-2 mb-3">
                  <i className="bi bi-info-circle me-1"></i>
                  Se creará una copia del kit seleccionado en este proyecto. Podrá modificarla sin afectar la base de datos maestra.
                </div>
                {masterKits.length === 0 ? (
                  <div className="text-center text-muted py-4">No hay kits maestros disponibles.</div>
                ) : (
                  <div className="list-group">
                    {masterKits.map(kit => (
                      <div key={kit.id} className="list-group-item d-flex justify-content-between align-items-center py-3">
                        <div>
                          <div className="fw-bold">{kit.nombre}</div>
                          <small className="text-muted">
                            {kit.descripcion || 'Sin descripción'} &nbsp;·&nbsp; {kit.activities.length} actividades
                          </small>
                        </div>
                        <button
                          className="btn btn-outline-warning btn-sm fw-bold"
                          onClick={() => handleCopyMasterKit(kit.id)}
                        >
                          <i className="bi bi-copy me-1"></i>Copiar al Proyecto
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="modal-footer bg-light border-0 p-3">
                <button type="button" className="btn btn-outline-secondary" onClick={() => setShowCopyMasterModal(false)}>
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== MODAL: Crear/Editar Actividad del Proyecto ===== */}
      {showActivityModal && (
        <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-lg modal-dialog-centered">
            <div className="modal-content border-0 shadow-lg">
              <div className="modal-header bg-warning py-3">
                <h5 className="modal-title fw-bold text-dark">
                  {isEditingActivity ? 'Editar Actividad del Proyecto' : 'Nueva Actividad del Proyecto'}
                </h5>
                <button type="button" className="btn-close" onClick={() => setShowActivityModal(false)}></button>
              </div>
              <form onSubmit={handleActivitySubmit}>
                <div className="modal-body p-4">

                  {/* Selector de base maestra (solo en creación) */}
                  {!isEditingActivity && (
                    <div className="mb-4 p-3 bg-light rounded border">
                      <label className="form-label fw-bold small text-muted">
                        Basar en actividad maestra (opcional)
                      </label>
                      <select
                        className="form-select form-select-sm"
                        value={activityForm.base_actividad || ''}
                        onChange={e => {
                          const val = parseInt(e.target.value);
                          if (val) handleBaseActivityChange(val);
                          else setActivityForm(prev => ({ ...prev, base_actividad: null }));
                        }}
                      >
                        <option value="">— Crear actividad desde cero —</option>
                        {masterActivities.map(act => (
                          <option key={act.id} value={act.id}>
                            {act.codigo_actividad} – {act.descripcion.slice(0, 60)}
                          </option>
                        ))}
                      </select>
                      {activityForm.base_actividad && (
                        <div className="mt-1 small text-muted">
                          <i className="bi bi-info-circle me-1"></i>
                          Campos pre-llenados desde la actividad maestra. Puede modificarlos libremente.
                        </div>
                      )}
                    </div>
                  )}

                  <div className="row g-3">
                    <div className="col-md-4">
                      <label className="form-label fw-bold small">Código de Actividad</label>
                      <input
                        type="text"
                        className="form-control"
                        value={activityForm.codigo_actividad}
                        onChange={e => setActivityForm(prev => ({ ...prev, codigo_actividad: e.target.value }))}
                        required
                        placeholder="Ej: 03 21 00.00-P"
                      />
                    </div>
                    <div className="col-md-5">
                      <label className="form-label fw-bold small">División MasterFormat</label>
                      <select
                        className="form-select"
                        value={activityForm.division}
                        onChange={e => setActivityForm(prev => ({ ...prev, division: parseInt(e.target.value) }))}
                        required
                      >
                        <option value="">Seleccione una división...</option>
                        {divisions.map(div => (
                          <option key={div.id} value={div.id}>
                            {div.division_code} – {div.division_name.slice(0, 35)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="col-md-3">
                      <label className="form-label fw-bold small">Unidad</label>
                      <input
                        type="text"
                        className="form-control"
                        value={activityForm.unidad}
                        onChange={e => setActivityForm(prev => ({ ...prev, unidad: e.target.value }))}
                        required
                        placeholder="m², m³, kg..."
                      />
                    </div>
                    <div className="col-12">
                      <label className="form-label fw-bold small">Descripción</label>
                      <textarea
                        className="form-control"
                        rows={2}
                        value={activityForm.descripcion}
                        onChange={e => setActivityForm(prev => ({ ...prev, descripcion: e.target.value }))}
                        required
                        placeholder="Descripción de la actividad..."
                      />
                    </div>
                    <div className="col-md-3">
                      <label className="form-label fw-bold small">Material</label>
                      <div className="input-group">
                        <span className="input-group-text">$</span>
                        <input
                          type="number" step="0.0001" min="0"
                          className="form-control"
                          value={activityForm.material}
                          onChange={e => setActivityForm(prev => ({ ...prev, material: e.target.value }))}
                        />
                      </div>
                    </div>
                    <div className="col-md-3">
                      <label className="form-label fw-bold small">Mano de Obra</label>
                      <div className="input-group">
                        <span className="input-group-text">$</span>
                        <input
                          type="number" step="0.0001" min="0"
                          className="form-control"
                          value={activityForm.mano_obra}
                          onChange={e => setActivityForm(prev => ({ ...prev, mano_obra: e.target.value }))}
                        />
                      </div>
                    </div>
                    <div className="col-md-3">
                      <label className="form-label fw-bold small">Equipo</label>
                      <div className="input-group">
                        <span className="input-group-text">$</span>
                        <input
                          type="number" step="0.0001" min="0"
                          className="form-control"
                          value={activityForm.equipo}
                          onChange={e => setActivityForm(prev => ({ ...prev, equipo: e.target.value }))}
                        />
                      </div>
                    </div>
                    <div className="col-md-3">
                      <label className="form-label fw-bold small">CU Total (calculado)</label>
                      <div className="input-group">
                        <span className="input-group-text">$</span>
                        <input
                          type="text"
                          className="form-control bg-light fw-bold text-success"
                          value={computedCuTotal}
                          readOnly
                        />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="modal-footer bg-light border-0 p-3">
                  <button type="button" className="btn btn-outline-secondary px-4" onClick={() => setShowActivityModal(false)}>
                    Cancelar
                  </button>
                  <button type="submit" className="btn btn-warning px-4 fw-bold">
                    {isEditingActivity ? 'Guardar Cambios' : 'Crear Actividad'}
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

export default ProjectKits;
