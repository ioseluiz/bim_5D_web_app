import { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import axios from 'axios';

const API = 'http://localhost:8000/api';

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface BIMModel {
  id: number;
  nombre: string;
  archivo: string;
}

interface Project {
  id: number;
  nombre: string;
  descripcion: string;
  bim_models: BIMModel[];
}

interface Division {
  id: number;
  division_code: string;
  division_name: string;
}

interface KitActivity {
  id: number;
  codigo_actividad: string;
  descripcion: string;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  fase: string;
  sector: string;
  division: number | null;
  division_name?: string;
  division_code?: string;
  base_actividad: number | null;
  proyecto?: number | null;
  es_proyecto?: boolean;
}

interface ScheduleKit {
  id: number;
  codigo_kit: string;
  nombre: string;
  descripcion: string;
  proyecto: number | null;
  kit_actividades: KitActivity[];
}

type ActivityForm = {
  codigo_actividad: string;
  descripcion: string;
  fecha_inicio: string;
  fecha_fin: string;
  fase: string;
  sector: string;
  division: string;
  base_actividad: number | null;
};

const EMPTY_FORM: ActivityForm = {
  codigo_actividad: '',
  descripcion: '',
  fecha_inicio: '',
  fecha_fin: '',
  fase: '',
  sector: '',
  division: '',
  base_actividad: null,
};

// ─── Component ────────────────────────────────────────────────────────────────

const ProjectSchedule = () => {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [activeTab, setActiveTab] = useState<'kits' | 'actividades'>('kits');

  const [projectKits, setProjectKits] = useState<ScheduleKit[]>([]);
  const [masterKits, setMasterKits] = useState<ScheduleKit[]>([]);
  const [projectActivities, setProjectActivities] = useState<KitActivity[]>([]);
  const [masterActivities, setMasterActivities] = useState<KitActivity[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);

  const [loading, setLoading] = useState(true);

  // IFC schedule codes (read from sessionStorage set by BimViewer after scanning)
  const [ifcScheduleCodes, setIfcScheduleCodes] = useState<Set<string> | null>(null);

  // Kit modal
  const [showKitModal, setShowKitModal] = useState(false);
  const [showCopyMasterModal, setShowCopyMasterModal] = useState(false);
  const [isEditingKit, setIsEditingKit] = useState(false);
  const [currentKitId, setCurrentKitId] = useState<number | null>(null);
  const [kitForm, setKitForm] = useState({ nombre: '', descripcion: '', selectedActivities: [] as number[] });
  const [kitSearch, setKitSearch] = useState('');
  const [kitFaseFilter, setKitFaseFilter] = useState('');
  const [kitDivisionFilter, setKitDivisionFilter] = useState('');

  // Activity modal
  const [showActivityModal, setShowActivityModal] = useState(false);
  const [isEditingActivity, setIsEditingActivity] = useState(false);
  const [currentActivityId, setCurrentActivityId] = useState<number | null>(null);
  const [activityForm, setActivityForm] = useState<ActivityForm>({ ...EMPTY_FORM });

  const [savingKit, setSavingKit] = useState(false);
  const [savingActivity, setSavingActivity] = useState(false);
  const [copyingKitId, setCopyingKitId] = useState<number | null>(null);

  // ─── Fetch ──────────────────────────────────────────────────────────────────

  const fetchAll = async () => {
    if (!id) return;
    setLoading(true);
    const [projRes, projKitsRes, masterKitsRes, projActRes, masterActRes, divRes] = await Promise.all([
      axios.get(`${API}/projects/${id}/`),
      axios.get(`${API}/schedule-kits/?proyecto=${id}`),
      axios.get(`${API}/schedule-kits/`),
      axios.get(`${API}/schedule-activities/?proyecto=${id}`),
      axios.get(`${API}/schedule-activities/`),
      axios.get(`${API}/masterformat/`),
    ]);
    setProject(projRes.data);
    setProjectKits(projKitsRes.data);
    setMasterKits(masterKitsRes.data);
    setProjectActivities(projActRes.data);
    setMasterActivities(masterActRes.data);
    setDivisions(divRes.data);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, [id]);

  // Load IFC codes persisted by BimViewer after its scan
  useEffect(() => {
    if (!id) return;
    const raw = sessionStorage.getItem(`ifc_cronograma_codes_${id}`);
    if (raw) {
      try {
        setIfcScheduleCodes(new Set(JSON.parse(raw) as string[]));
      } catch {
        setIfcScheduleCodes(new Set());
      }
    } else {
      setIfcScheduleCodes(null); // viewer not opened yet
    }
  }, [id]);

  // ─── Derived data ───────────────────────────────────────────────────────────

  const allFases = useMemo(() => {
    const fases = new Set<string>();
    [...masterActivities, ...projectActivities].forEach(a => { if (a.fase) fases.add(a.fase); });
    return Array.from(fases).sort();
  }, [masterActivities, projectActivities]);

  const allActivitiesForKit = useMemo(() => {
    return [...masterActivities, ...projectActivities];
  }, [masterActivities, projectActivities]);

  const filteredKitActivities = useMemo(() => {
    return allActivitiesForKit.filter(a => {
      const ms = !kitSearch ||
        a.codigo_actividad.toLowerCase().includes(kitSearch.toLowerCase()) ||
        a.descripcion.toLowerCase().includes(kitSearch.toLowerCase());
      const mf = !kitFaseFilter || a.fase === kitFaseFilter;
      const md = !kitDivisionFilter || String(a.division) === kitDivisionFilter;
      return ms && mf && md;
    });
  }, [allActivitiesForKit, kitSearch, kitFaseFilter, kitDivisionFilter]);

  // Only show kits whose codigo_kit appears as codigo_cronograma in the IFC model
  const filteredProjectKits = useMemo(() => {
    if (!ifcScheduleCodes || ifcScheduleCodes.size === 0) return projectKits;
    return projectKits.filter(k => k.codigo_kit && ifcScheduleCodes.has(k.codigo_kit));
  }, [projectKits, ifcScheduleCodes]);

  const masterKitsNotCopied = useMemo(() => {
    const copiedCodes = new Set(projectKits.map(k => k.codigo_kit));
    return masterKits.filter(k => !copiedCodes.has(k.codigo_kit));
  }, [masterKits, projectKits]);

  // ─── Helpers ────────────────────────────────────────────────────────────────

  const divisionLabel = (act: KitActivity) => {
    if (act.division_code) return act.division_code;
    const d = divisions.find(d => d.id === act.division);
    return d ? d.division_code : '—';
  };

  // ─── Kit CRUD ───────────────────────────────────────────────────────────────

  const handleOpenKitModal = (kit?: ScheduleKit) => {
    if (kit) {
      setIsEditingKit(true);
      setCurrentKitId(kit.id);
      setKitForm({
        nombre: kit.nombre,
        descripcion: kit.descripcion || '',
        selectedActivities: kit.kit_actividades.map(a => a.id),
      });
    } else {
      setIsEditingKit(false);
      setCurrentKitId(null);
      setKitForm({ nombre: '', descripcion: '', selectedActivities: [] });
    }
    setKitSearch('');
    setKitFaseFilter('');
    setKitDivisionFilter('');
    setShowKitModal(true);
  };

  const handleKitSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setSavingKit(true);
    try {
      const payload = {
        nombre: kitForm.nombre,
        descripcion: kitForm.descripcion,
        proyecto: parseInt(id),
      };
      let kitId: number;
      if (isEditingKit && currentKitId) {
        await axios.patch(`${API}/schedule-kits/${currentKitId}/`, payload);
        kitId = currentKitId;
      } else {
        const res = await axios.post(`${API}/schedule-kits/`, payload);
        kitId = res.data.id;
      }

      const kit = projectKits.find(k => k.id === kitId);
      const existingIds = (kit?.kit_actividades || []).map(a => a.id);
      const toAdd = kitForm.selectedActivities.filter(aid => !existingIds.includes(aid));
      const toRemove = existingIds.filter(aid => !kitForm.selectedActivities.includes(aid));

      await Promise.all([
        ...toAdd.map(aid => axios.post(`${API}/schedule-kits/${kitId}/add_actividad/`, {
          base_actividad_id: aid,
        })),
        ...toRemove.map(aid => axios.delete(`${API}/schedule-activities/${aid}/`)),
      ]);

      setShowKitModal(false);
      await fetchAll();
    } finally {
      setSavingKit(false);
    }
  };

  const handleDeleteKit = async (kitId: number) => {
    if (!window.confirm('¿Eliminar este kit del proyecto?')) return;
    try {
      await axios.delete(`${API}/schedule-kits/${kitId}/`);
      await fetchAll();
    } catch (err) {
      console.error(err);
      alert('Error al eliminar el kit.');
    }
  };

  const handleCopyMasterKit = async (masterKitId: number) => {
    if (!id) return;
    setCopyingKitId(masterKitId);
    try {
      await axios.post(`${API}/schedule-kits/${masterKitId}/copy_to_project/`, {
        proyecto: parseInt(id),
      });
      setShowCopyMasterModal(false);
      await fetchAll();
    } finally {
      setCopyingKitId(null);
    }
  };

  // ─── Activity CRUD ──────────────────────────────────────────────────────────

  const handleOpenActivityModal = (act?: KitActivity) => {
    if (act) {
      setIsEditingActivity(true);
      setCurrentActivityId(act.id);
      setActivityForm({
        codigo_actividad: act.codigo_actividad,
        descripcion: act.descripcion,
        fecha_inicio: act.fecha_inicio || '',
        fecha_fin: act.fecha_fin || '',
        fase: act.fase || '',
        sector: act.sector || '',
        division: act.division != null ? String(act.division) : '',
        base_actividad: act.base_actividad,
      });
    } else {
      setIsEditingActivity(false);
      setCurrentActivityId(null);
      setActivityForm({ ...EMPTY_FORM });
    }
    setShowActivityModal(true);
  };

  const handleBaseActivityChange = (baseId: string) => {
    const master = masterActivities.find(a => a.id === parseInt(baseId));
    if (master) {
      setActivityForm({
        codigo_actividad: master.codigo_actividad,
        descripcion: master.descripcion,
        fecha_inicio: master.fecha_inicio || '',
        fecha_fin: master.fecha_fin || '',
        fase: master.fase || '',
        sector: master.sector || '',
        division: master.division != null ? String(master.division) : '',
        base_actividad: master.id,
      });
    } else {
      setActivityForm(prev => ({ ...prev, base_actividad: null }));
    }
  };

  const handleActivitySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setSavingActivity(true);
    try {
      const payload = {
        ...activityForm,
        fecha_inicio: activityForm.fecha_inicio || null,
        fecha_fin: activityForm.fecha_fin || null,
        division: activityForm.division ? parseInt(activityForm.division) : null,
        proyecto: parseInt(id),
      };
      if (isEditingActivity && currentActivityId) {
        await axios.patch(`${API}/schedule-activities/${currentActivityId}/`, payload);
      } else {
        await axios.post(`${API}/schedule-activities/`, payload);
      }
      setShowActivityModal(false);
      await fetchAll();
    } finally {
      setSavingActivity(false);
    }
  };

  const handleDeleteActivity = async (actId: number) => {
    if (!confirm('¿Eliminar esta actividad?')) return;
    await axios.delete(`${API}/schedule-activities/${actId}/`);
    await fetchAll();
  };

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="container mt-5 text-center">
        <div className="spinner-border text-success" />
      </div>
    );
  }

  return (
    <div className="container-fluid mt-4">
      {/* Header */}
      <div className="d-flex align-items-center gap-3 mb-4">
        <Link to={`/projects/${id}`} className="btn btn-outline-secondary btn-sm">
          <i className="bi bi-arrow-left me-1"></i>Volver
        </Link>
        <div>
          <h2 className="fw-bold mb-0">
            <i className="bi bi-calendar3 me-2 text-success"></i>Cronograma del Proyecto
          </h2>
          <small className="text-muted">{project?.nombre}</small>
        </div>
      </div>

      {/* Tabs */}
      <ul className="nav nav-tabs mb-3">
        <li className="nav-item">
          <button className={`nav-link ${activeTab === 'kits' ? 'active' : ''}`}
            onClick={() => setActiveTab('kits')}>
            <i className="bi bi-box-seam me-2"></i>Kits de Cronograma
            <span className="badge bg-success ms-2">{projectKits.length}</span>
          </button>
        </li>
        <li className="nav-item">
          <button className={`nav-link ${activeTab === 'actividades' ? 'active' : ''}`}
            onClick={() => setActiveTab('actividades')}>
            <i className="bi bi-list-task me-2"></i>Actividades del Proyecto
            <span className="badge bg-secondary ms-2">{projectActivities.length}</span>
          </button>
        </li>
      </ul>

      {/* ── TAB: Kits ─────────────────────────────────────────────────────────── */}
      {activeTab === 'kits' && (
        <>
          <div className="d-flex gap-2 mb-3">
            <button className="btn btn-success" onClick={() => handleOpenKitModal()}>
              <i className="bi bi-plus-circle me-2"></i>Nuevo Kit
            </button>
            {masterKitsNotCopied.length > 0 && (
              <button className="btn btn-outline-success" onClick={() => setShowCopyMasterModal(true)}>
                <i className="bi bi-copy me-2"></i>Copiar del Catálogo Maestro
              </button>
            )}
          </div>

          {/* IFC filter status banner */}
          {ifcScheduleCodes === null ? (
            <div className="alert alert-warning d-flex align-items-center gap-2 py-2 mb-3">
              <i className="bi bi-exclamation-triangle"></i>
              <span className="small">
                No se encontraron datos del modelo IFC. Abra el <strong>Visor BIM</strong> del proyecto para escanear el modelo y filtrar los kits por <code>codigo_cronograma</code>.
              </span>
            </div>
          ) : ifcScheduleCodes.size > 0 ? (
            <div className="alert alert-success d-flex align-items-center gap-2 py-2 mb-3">
              <i className="bi bi-funnel-fill"></i>
              <span className="small">
                Mostrando <strong>{filteredProjectKits.length}</strong> de {projectKits.length} kit{projectKits.length !== 1 ? 's' : ''} presentes en el modelo IFC
                {' '}(<strong>{ifcScheduleCodes.size}</strong> código{ifcScheduleCodes.size !== 1 ? 's' : ''} <code>codigo_cronograma</code> detectados).
              </span>
            </div>
          ) : (
            <div className="alert alert-secondary d-flex align-items-center gap-2 py-2 mb-3">
              <i className="bi bi-info-circle"></i>
              <span className="small">
                El modelo IFC no contiene el parámetro <code>codigo_cronograma</code>. Se muestran todos los kits del proyecto.
              </span>
            </div>
          )}

          {filteredProjectKits.length === 0 ? (
            <div className="alert alert-info">
              {projectKits.length === 0
                ? 'No hay kits de cronograma para este proyecto. Crea uno o copia del catálogo maestro.'
                : 'Ningún kit del proyecto coincide con los códigos de cronograma del modelo IFC.'}
            </div>
          ) : (
            filteredProjectKits.map(kit => (
              <div key={kit.id} className="card mb-3 shadow-sm">
                <div className="card-header d-flex justify-content-between align-items-center bg-success bg-opacity-10">
                  <div className="fw-bold">
                    <span className="badge bg-success me-2">{kit.codigo_kit || '—'}</span>
                    {kit.nombre}
                    <small className="text-muted fw-normal ms-2">
                      ({kit.kit_actividades.length} actividad{kit.kit_actividades.length !== 1 ? 'es' : ''})
                    </small>
                  </div>
                  <div className="d-flex gap-2">
                    <button className="btn btn-sm btn-outline-primary" onClick={() => handleOpenKitModal(kit)}>
                      <i className="bi bi-pencil me-1"></i>Editar
                    </button>
                    <button className="btn btn-sm btn-outline-danger" onClick={() => handleDeleteKit(kit.id)}>
                      <i className="bi bi-trash"></i>
                    </button>
                  </div>
                </div>
                <div className="card-body p-0">
                  <div className="table-responsive">
                    <table className="table table-sm table-hover mb-0">
                      <thead className="table-light">
                        <tr>
                          <th>División</th>
                          <th>Código</th>
                          <th>Descripción</th>
                          <th>Fecha Inicio</th>
                          <th>Fecha Fin</th>
                          <th>Fase</th>
                          <th>Sector</th>
                        </tr>
                      </thead>
                      <tbody>
                        {kit.kit_actividades.map(act => (
                          <tr key={act.id}>
                            <td>
                              <span className="badge bg-light text-dark border" title={act.division_name}>
                                {divisionLabel(act)}
                              </span>
                            </td>
                            <td><code>{act.codigo_actividad}</code></td>
                            <td>{act.descripcion}</td>
                            <td>{act.fecha_inicio || <span className="text-muted">—</span>}</td>
                            <td>{act.fecha_fin || <span className="text-muted">—</span>}</td>
                            <td>{act.fase || <span className="text-muted">—</span>}</td>
                            <td>{act.sector || <span className="text-muted">—</span>}</td>
                          </tr>
                        ))}
                        {kit.kit_actividades.length === 0 && (
                          <tr>
                            <td colSpan={7} className="text-center text-muted py-2">Sin actividades</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ))
          )}
        </>
      )}

      {/* ── TAB: Actividades ──────────────────────────────────────────────────── */}
      {activeTab === 'actividades' && (
        <>
          <div className="d-flex justify-content-between mb-3">
            <h5 className="mb-0">Actividades del Proyecto</h5>
            <button className="btn btn-success" onClick={() => handleOpenActivityModal()}>
              <i className="bi bi-plus-circle me-2"></i>Nueva Actividad
            </button>
          </div>

          {projectActivities.length === 0 ? (
            <div className="alert alert-info">No hay actividades de cronograma para este proyecto.</div>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover">
                <thead className="table-light">
                  <tr>
                    <th>División</th>
                    <th>Código</th>
                    <th>Descripción</th>
                    <th>Fecha Inicio</th>
                    <th>Fecha Fin</th>
                    <th>Fase</th>
                    <th>Sector</th>
                    <th style={{ width: 100 }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {projectActivities.map(act => (
                    <tr key={act.id}>
                      <td>
                        <span className="badge bg-light text-dark border" title={act.division_name}>
                          {divisionLabel(act)}
                        </span>
                      </td>
                      <td><code>{act.codigo_actividad}</code></td>
                      <td>{act.descripcion}</td>
                      <td>{act.fecha_inicio || <span className="text-muted">—</span>}</td>
                      <td>{act.fecha_fin || <span className="text-muted">—</span>}</td>
                      <td>{act.fase || <span className="text-muted">—</span>}</td>
                      <td>{act.sector || <span className="text-muted">—</span>}</td>
                      <td>
                        <button className="btn btn-sm btn-outline-primary me-1" onClick={() => handleOpenActivityModal(act)}>
                          <i className="bi bi-pencil"></i>
                        </button>
                        <button className="btn btn-sm btn-outline-danger" onClick={() => handleDeleteActivity(act.id)}>
                          <i className="bi bi-trash"></i>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── Kit Modal ──────────────────────────────────────────────────────────── */}
      {showKitModal && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-xl">
            <form className="modal-content" onSubmit={handleKitSubmit}>
              <div className="modal-header bg-success text-white">
                <h5 className="modal-title">
                  {isEditingKit ? 'Editar Kit de Cronograma' : 'Nuevo Kit de Cronograma'}
                </h5>
                <button type="button" className="btn-close btn-close-white" onClick={() => setShowKitModal(false)} />
              </div>
              <div className="modal-body">
                <div className="row">
                  {/* Left: kit info */}
                  <div className="col-md-4 border-end">
                    <div className="mb-3">
                      <label className="form-label fw-bold">Nombre <span className="text-danger">*</span></label>
                      <input className="form-control" required value={kitForm.nombre}
                        onChange={e => setKitForm({ ...kitForm, nombre: e.target.value })} />
                    </div>
                    <div className="mb-3">
                      <label className="form-label">Descripción</label>
                      <textarea className="form-control" rows={3} value={kitForm.descripcion}
                        onChange={e => setKitForm({ ...kitForm, descripcion: e.target.value })} />
                    </div>
                    <div className="alert alert-info py-2 small">
                      <i className="bi bi-info-circle me-1"></i>
                      Selecciona actividades del catálogo para incluir en el kit.
                    </div>
                  </div>

                  {/* Right: activity picker */}
                  <div className="col-md-8">
                    <div className="row g-2 mb-2">
                      <div className="col">
                        <input className="form-control form-control-sm" placeholder="Buscar actividades…"
                          value={kitSearch} onChange={e => setKitSearch(e.target.value)} />
                      </div>
                      <div className="col-auto">
                        <select className="form-select form-select-sm" value={kitDivisionFilter}
                          onChange={e => setKitDivisionFilter(e.target.value)}>
                          <option value="">Todas las divisiones</option>
                          {divisions.map(d => (
                            <option key={d.id} value={d.id}>{d.division_code} – {d.division_name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="col-auto">
                        <select className="form-select form-select-sm" value={kitFaseFilter}
                          onChange={e => setKitFaseFilter(e.target.value)}>
                          <option value="">Todas las fases</option>
                          {allFases.map(f => <option key={f} value={f}>{f}</option>)}
                        </select>
                      </div>
                    </div>
                    <div style={{ maxHeight: 350, overflowY: 'auto' }}>
                      <table className="table table-sm table-hover mb-0">
                        <thead className="table-light sticky-top">
                          <tr>
                            <th style={{ width: 40 }}></th>
                            <th>División</th>
                            <th>Código</th>
                            <th>Descripción</th>
                            <th>Fase</th>
                            <th>Sector</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredKitActivities.map(a => (
                            <tr key={a.id} className={kitForm.selectedActivities.includes(a.id) ? 'table-info' : ''}>
                              <td>
                                <input type="checkbox" className="form-check-input"
                                  checked={kitForm.selectedActivities.includes(a.id)}
                                  onChange={e => setKitForm(prev => ({
                                    ...prev,
                                    selectedActivities: e.target.checked
                                      ? [...prev.selectedActivities, a.id]
                                      : prev.selectedActivities.filter(x => x !== a.id),
                                  }))} />
                              </td>
                              <td>
                                <span className="badge bg-light text-dark border small" title={a.division_name}>
                                  {divisionLabel(a)}
                                </span>
                              </td>
                              <td><code className="small">{a.codigo_actividad}</code></td>
                              <td className="small">{a.descripcion}</td>
                              <td className="small">{a.fase || '—'}</td>
                              <td className="small">{a.sector || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="text-muted small mt-1">
                      {kitForm.selectedActivities.length} actividad(es) seleccionada(s)
                    </div>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowKitModal(false)}>Cancelar</button>
                <button type="submit" className="btn btn-success" disabled={savingKit}>
                  {savingKit ? 'Guardando…' : 'Guardar Kit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Copy Master Kit Modal ──────────────────────────────────────────────── */}
      {showCopyMasterModal && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header bg-secondary text-white">
                <h5 className="modal-title">Copiar Kit del Catálogo Maestro</h5>
                <button type="button" className="btn-close btn-close-white" onClick={() => setShowCopyMasterModal(false)} />
              </div>
              <div className="modal-body">
                {masterKitsNotCopied.length === 0 ? (
                  <div className="alert alert-info">Todos los kits maestros ya están en el proyecto.</div>
                ) : (
                  <div className="list-group">
                    {masterKitsNotCopied.map(kit => (
                      <div key={kit.id} className="list-group-item list-group-item-action d-flex justify-content-between align-items-center">
                        <div>
                          <span className="badge bg-success me-2">{kit.codigo_kit || '—'}</span>
                          <strong>{kit.nombre}</strong>
                          <div className="text-muted small">{kit.kit_actividades.length} actividades</div>
                        </div>
                        <button
                          className="btn btn-sm btn-success"
                          onClick={() => handleCopyMasterKit(kit.id)}
                          disabled={copyingKitId === kit.id}
                        >
                          {copyingKitId === kit.id ? 'Copiando…' : 'Copiar'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setShowCopyMasterModal(false)}>Cerrar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Activity Modal ─────────────────────────────────────────────────────── */}
      {showActivityModal && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-lg">
            <form className="modal-content" onSubmit={handleActivitySubmit}>
              <div className="modal-header bg-success text-white">
                <h5 className="modal-title">
                  {isEditingActivity ? 'Editar Actividad' : 'Nueva Actividad de Cronograma'}
                </h5>
                <button type="button" className="btn-close btn-close-white" onClick={() => setShowActivityModal(false)} />
              </div>
              <div className="modal-body">
                {!isEditingActivity && (
                  <div className="mb-3">
                    <label className="form-label">Basar en actividad maestra (opcional)</label>
                    <select className="form-select"
                      value={activityForm.base_actividad ?? ''}
                      onChange={e => handleBaseActivityChange(e.target.value)}>
                      <option value="">— Sin base —</option>
                      {masterActivities.map(a => (
                        <option key={a.id} value={a.id}>
                          {a.codigo_actividad} – {a.descripcion}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="row g-3">
                  <div className="col-md-12">
                    <label className="form-label fw-bold">División MasterFormat</label>
                    <select className="form-select" value={activityForm.division}
                      onChange={e => setActivityForm({ ...activityForm, division: e.target.value })}>
                      <option value="">— Sin división —</option>
                      {divisions.map(d => (
                        <option key={d.id} value={d.id}>{d.division_code} – {d.division_name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-md-4">
                    <label className="form-label fw-bold">Código <span className="text-danger">*</span></label>
                    <input className="form-control" required value={activityForm.codigo_actividad}
                      onChange={e => setActivityForm({ ...activityForm, codigo_actividad: e.target.value })} />
                  </div>
                  <div className="col-md-8">
                    <label className="form-label fw-bold">Descripción <span className="text-danger">*</span></label>
                    <input className="form-control" required value={activityForm.descripcion}
                      onChange={e => setActivityForm({ ...activityForm, descripcion: e.target.value })} />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">Fecha de Inicio</label>
                    <input type="date" className="form-control" value={activityForm.fecha_inicio}
                      onChange={e => setActivityForm({ ...activityForm, fecha_inicio: e.target.value })} />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">Fecha de Fin</label>
                    <input type="date" className="form-control" value={activityForm.fecha_fin}
                      onChange={e => setActivityForm({ ...activityForm, fecha_fin: e.target.value })} />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">Fase</label>
                    <input className="form-control" value={activityForm.fase}
                      onChange={e => setActivityForm({ ...activityForm, fase: e.target.value })}
                      placeholder="Ej: Diseño, Construcción…" />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">Sector</label>
                    <input className="form-control" value={activityForm.sector}
                      onChange={e => setActivityForm({ ...activityForm, sector: e.target.value })}
                      placeholder="Ej: A, B, Norte…" />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowActivityModal(false)}>Cancelar</button>
                <button type="submit" className="btn btn-success" disabled={savingActivity}>
                  {savingActivity ? 'Guardando…' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectSchedule;
