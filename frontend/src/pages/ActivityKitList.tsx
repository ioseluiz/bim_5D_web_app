import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface Division {
  id: number;
  division_code: string;
  division_name: string;
}

interface MasterActivity {
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
}

interface KitActivity {
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
  base_actividad?: number | null;
}

interface ActivityKit {
  id: number;
  codigo_kit: string;
  nombre: string;
  descripcion: string;
  kit_activities: KitActivity[];
}

type ActivityFormData = {
  codigo_actividad: string;
  descripcion: string;
  unidad: string;
  cu_total: string;
  material: string;
  mano_obra: string;
  equipo: string;
  division: string;
  base_actividad: number | null;
};

const EMPTY_ACTIVITY: ActivityFormData = {
  codigo_actividad: '',
  descripcion: '',
  unidad: '',
  cu_total: '0',
  material: '0',
  mano_obra: '0',
  equipo: '0',
  division: '',
  base_actividad: null,
};

// ─── Component ────────────────────────────────────────────────────────────────

const exportKitCodes = (kits: ActivityKit[]) => {
  const codes = kits.map(k => k.codigo_kit).filter(Boolean).join('\n');
  const blob = new Blob([codes], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'kits_actividades.csv';
  a.click();
  URL.revokeObjectURL(url);
};

const ActivityKitList = () => {
  // Data
  const [kits, setKits] = useState<ActivityKit[]>([]);
  const [masterActivities, setMasterActivities] = useState<MasterActivity[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [loading, setLoading] = useState(true);

  // Kit modal
  const [showKitModal, setShowKitModal] = useState(false);
  const [currentKit, setCurrentKit] = useState<ActivityKit | null>(null);
  const [kitForm, setKitForm] = useState({ codigo_kit: '', nombre: '', descripcion: '' });
  const [savingKit, setSavingKit] = useState(false);

  // Inline activity form
  const [activityForm, setActivityForm] = useState<ActivityFormData | null>(null);
  const [editingActivityId, setEditingActivityId] = useState<number | null>(null);
  const [savingActivity, setSavingActivity] = useState(false);

  // Import picker modal
  const [showImport, setShowImport] = useState(false);
  const [importSearch, setImportSearch] = useState('');
  const [importDivision, setImportDivision] = useState('');
  const [selectedMasterIds, setSelectedMasterIds] = useState<Set<number>>(new Set());
  const [importing, setImporting] = useState(false);

  // Kit list filters
  const [filterText, setFilterText] = useState('');
  const [filterActivity, setFilterActivity] = useState('');

  useEffect(() => { fetchAll(); }, []);

  const filteredKits = useMemo(() => {
    const text = filterText.toLowerCase().trim();
    const act  = filterActivity.toLowerCase().trim();
    return kits.filter(kit => {
      const matchText = !text ||
        (kit.codigo_kit || '').toLowerCase().includes(text) ||
        kit.nombre.toLowerCase().includes(text);
      const matchAct = !act ||
        kit.kit_activities.some(a => a.codigo_actividad.toLowerCase().includes(act));
      return matchText && matchAct;
    });
  }, [kits, filterText, filterActivity]);

  const fetchAll = async () => {
    try {
      const [kitsRes, activitiesRes, divisionsRes] = await Promise.all([
        axios.get('http://localhost:8000/api/activity-kits/'),
        axios.get('http://localhost:8000/api/activities/'),
        axios.get('http://localhost:8000/api/masterformat/'),
      ]);
      setKits(kitsRes.data);
      setMasterActivities(activitiesRes.data);
      setDivisions(divisionsRes.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const refreshCurrentKit = async (kitId: number) => {
    const res = await axios.get(`http://localhost:8000/api/activity-kits/${kitId}/`);
    setCurrentKit(res.data);
    setKits(prev => prev.map(k => k.id === kitId ? res.data : k));
  };

  // ── Kit CRUD ──────────────────────────────────────────────────────────────

  const openNewKit = () => {
    setCurrentKit(null);
    setKitForm({ codigo_kit: '', nombre: '', descripcion: '' });
    setActivityForm(null);
    setEditingActivityId(null);
    setShowKitModal(true);
  };

  const openEditKit = (kit: ActivityKit) => {
    setCurrentKit(kit);
    setKitForm({ codigo_kit: kit.codigo_kit || '', nombre: kit.nombre, descripcion: kit.descripcion || '' });
    setActivityForm(null);
    setEditingActivityId(null);
    setShowKitModal(true);
  };

  const handleSaveKit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingKit(true);
    try {
      const data = { codigo_kit: kitForm.codigo_kit || null, nombre: kitForm.nombre, descripcion: kitForm.descripcion };
      if (currentKit) {
        const res = await axios.put(`http://localhost:8000/api/activity-kits/${currentKit.id}/`, data);
        setCurrentKit(res.data);
        setKits(prev => prev.map(k => k.id === currentKit.id ? res.data : k));
      } else {
        const res = await axios.post('http://localhost:8000/api/activity-kits/', data);
        setCurrentKit(res.data);
        setKits(prev => [...prev, res.data]);
      }
    } catch (err) {
      console.error(err);
      alert('Error al guardar el kit.');
    } finally {
      setSavingKit(false);
    }
  };

  const handleDeleteKit = async (id: number) => {
    if (!window.confirm('¿Eliminar este kit y todas sus actividades?')) return;
    try {
      await axios.delete(`http://localhost:8000/api/activity-kits/${id}/`);
      setKits(prev => prev.filter(k => k.id !== id));
    } catch (err) {
      console.error(err);
      alert('Error al eliminar el kit.');
    }
  };

  // ── Activity form (inline) ────────────────────────────────────────────────

  const openNewActivity = () => {
    setEditingActivityId(null);
    setActivityForm({ ...EMPTY_ACTIVITY });
  };

  const openEditActivity = (act: KitActivity) => {
    setEditingActivityId(act.id);
    setActivityForm({
      codigo_actividad: act.codigo_actividad,
      descripcion: act.descripcion,
      unidad: act.unidad,
      cu_total: act.cu_total,
      material: act.material,
      mano_obra: act.mano_obra,
      equipo: act.equipo,
      division: String(act.division),
      base_actividad: act.base_actividad ?? null,
    });
  };

  const handleSaveActivity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentKit || !activityForm) return;
    setSavingActivity(true);
    try {
      if (editingActivityId) {
        await axios.patch(`http://localhost:8000/api/activities/${editingActivityId}/`, {
          codigo_actividad: activityForm.codigo_actividad,
          descripcion: activityForm.descripcion,
          unidad: activityForm.unidad,
          cu_total: activityForm.cu_total,
          material: activityForm.material,
          mano_obra: activityForm.mano_obra,
          equipo: activityForm.equipo,
          division: activityForm.division,
        });
      } else {
        await axios.post(`http://localhost:8000/api/activity-kits/${currentKit.id}/add_activity/`, {
          codigo_actividad: activityForm.codigo_actividad,
          descripcion: activityForm.descripcion,
          unidad: activityForm.unidad,
          cu_total: activityForm.cu_total,
          material: activityForm.material,
          mano_obra: activityForm.mano_obra,
          equipo: activityForm.equipo,
          division: activityForm.division,
        });
      }
      await refreshCurrentKit(currentKit.id);
      setActivityForm(null);
      setEditingActivityId(null);
    } catch (err) {
      console.error(err);
      alert('Error al guardar la actividad.');
    } finally {
      setSavingActivity(false);
    }
  };

  const handleDeleteActivity = async (actId: number) => {
    if (!currentKit || !window.confirm('¿Eliminar esta actividad del kit?')) return;
    try {
      await axios.delete(`http://localhost:8000/api/activities/${actId}/`);
      setCurrentKit(prev => prev ? { ...prev, kit_activities: prev.kit_activities.filter(a => a.id !== actId) } : prev);
      setKits(prev => prev.map(k => k.id === currentKit.id
        ? { ...k, kit_activities: k.kit_activities.filter(a => a.id !== actId) }
        : k
      ));
    } catch (err) {
      console.error(err);
      alert('Error al eliminar la actividad.');
    }
  };

  // ── Import picker ─────────────────────────────────────────────────────────

  const openImport = () => {
    setSelectedMasterIds(new Set());
    setImportSearch('');
    setImportDivision('');
    setShowImport(true);
  };

  const toggleMasterId = (id: number) => {
    setSelectedMasterIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleImport = async () => {
    if (!currentKit || selectedMasterIds.size === 0) return;
    setImporting(true);
    try {
      await axios.post(`http://localhost:8000/api/activity-kits/${currentKit.id}/import_activities/`, {
        activity_ids: [...selectedMasterIds],
      });
      await refreshCurrentKit(currentKit.id);
      setShowImport(false);
    } catch (err) {
      console.error(err);
      alert('Error al importar actividades.');
    } finally {
      setImporting(false);
    }
  };

  // ── Filtered master activities for picker ────────────────────────────────

  const alreadyImportedBaseIds = useMemo(() => {
    if (!currentKit) return new Set<number>();
    return new Set(currentKit.kit_activities.map(a => a.base_actividad).filter(Boolean) as number[]);
  }, [currentKit]);

  const filteredMaster = useMemo(() => {
    const term = importSearch.toLowerCase().trim();
    return masterActivities.filter(a => {
      const matchDiv = !importDivision || a.division_code === importDivision;
      const matchTerm = !term || a.codigo_actividad.toLowerCase().includes(term) || a.descripcion.toLowerCase().includes(term);
      return matchDiv && matchTerm;
    });
  }, [masterActivities, importSearch, importDivision]);

  const importDivisions = useMemo(() => {
    const seen = new Map<string, string>();
    masterActivities.forEach(a => {
      if (a.division_code && !seen.has(a.division_code)) seen.set(a.division_code, a.division_name || a.division_code);
    });
    return Array.from(seen.entries()).map(([code, name]) => ({ code, name })).sort((a, b) => a.code.localeCompare(b.code));
  }, [masterActivities]);

  // ─────────────────────────────────────────────────────────────────────────

  if (loading) return <div className="text-center mt-5"><div className="spinner-border text-primary"></div></div>;

  return (
    <div className="container py-4">
      <div className="d-flex justify-content-between align-items-start mb-3">
        <div>
          <h2 className="mb-0">Kits de Costos</h2>
          <p className="text-muted mb-0">Defina los kits de costo y sus actividades para vincular elementos BIM</p>
        </div>
        <div className="d-flex gap-2">
          <button
            className="btn btn-outline-secondary shadow-sm"
            onClick={() => exportKitCodes(kits)}
            disabled={kits.filter(k => k.codigo_kit).length === 0}
            title="Exportar códigos de kits a CSV"
          >
            <i className="bi bi-download me-2"></i>Exportar códigos
          </button>
          <button className="btn btn-primary shadow-sm" onClick={openNewKit}>
            <i className="bi bi-box-seam me-2"></i>Nuevo Kit
          </button>
        </div>
      </div>

      {/* Search & filter bar */}
      <div className="row g-2 mb-4">
        <div className="col-md-5">
          <div className="input-group">
            <span className="input-group-text bg-white"><i className="bi bi-search text-muted"></i></span>
            <input
              type="text"
              className="form-control"
              placeholder="Buscar por código o nombre del kit…"
              value={filterText}
              onChange={e => setFilterText(e.target.value)}
            />
            {filterText && (
              <button className="btn btn-outline-secondary" onClick={() => setFilterText('')}>
                <i className="bi bi-x"></i>
              </button>
            )}
          </div>
        </div>
        <div className="col-md-4">
          <div className="input-group">
            <span className="input-group-text bg-white"><i className="bi bi-tag text-muted"></i></span>
            <input
              type="text"
              className="form-control"
              placeholder="Filtrar por código de actividad…"
              value={filterActivity}
              onChange={e => setFilterActivity(e.target.value)}
            />
            {filterActivity && (
              <button className="btn btn-outline-secondary" onClick={() => setFilterActivity('')}>
                <i className="bi bi-x"></i>
              </button>
            )}
          </div>
        </div>
        {(filterText || filterActivity) && (
          <div className="col-auto d-flex align-items-center">
            <span className="text-muted small">
              {filteredKits.length} de {kits.length} kit{kits.length !== 1 ? 's' : ''}
            </span>
            <button className="btn btn-link btn-sm text-decoration-none ms-2" onClick={() => { setFilterText(''); setFilterActivity(''); }}>
              Limpiar filtros
            </button>
          </div>
        )}
      </div>

      {/* Kit cards */}
      <div className="row">
        {filteredKits.length > 0 ? filteredKits.map(kit => (
          <div key={kit.id} className="col-md-6 mb-4">
            <div className="card h-100 shadow-sm border-0 border-top border-primary border-4">
              <div className="card-header bg-white py-3 d-flex justify-content-between align-items-start">
                <div>
                  {kit.codigo_kit && (
                    <span className="badge bg-dark font-monospace mb-1 d-inline-block" style={{ letterSpacing: '0.05em' }}>
                      {kit.codigo_kit}
                    </span>
                  )}
                  <h5 className="mb-0 fw-bold text-dark">{kit.nombre}</h5>
                </div>
                <span className="badge bg-primary rounded-pill ms-2">{kit.kit_activities.length} actividades</span>
              </div>
              <div className="card-body">
                <p className="text-muted small mb-3">{kit.descripcion || 'Sin descripción.'}</p>
                <div className="list-group list-group-flush border rounded" style={{ maxHeight: 260, overflowY: 'auto' }}>
                  {kit.kit_activities.map(act => (
                    <div key={act.id} className="list-group-item d-flex justify-content-between align-items-center p-2">
                      <div className="small">
                        <span className="fw-bold text-primary me-2">{act.codigo_actividad}</span>
                        {act.base_actividad && <span className="badge bg-light text-secondary border me-1" title="Derivada del catálogo">↑</span>}
                        <span className="text-truncate d-inline-block align-bottom" style={{ maxWidth: 220 }}>{act.descripcion}</span>
                      </div>
                      <span className="badge bg-white text-success border">${parseFloat(act.cu_total).toFixed(2)}</span>
                    </div>
                  ))}
                  {kit.kit_activities.length === 0 && (
                    <div className="list-group-item text-center text-muted small py-3">Sin actividades definidas</div>
                  )}
                </div>
              </div>
              <div className="card-footer bg-light border-0 d-flex gap-2 p-3">
                <button className="btn btn-outline-dark btn-sm flex-grow-1 fw-bold" onClick={() => openEditKit(kit)}>
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
              {kits.length === 0 ? (
                <>
                  <i className="bi bi-box-seam display-1 text-muted opacity-25"></i>
                  <p className="mt-3 fs-5 text-muted">Aún no hay kits definidos.</p>
                  <button className="btn btn-primary" onClick={openNewKit}>Crear primer Kit</button>
                </>
              ) : (
                <>
                  <i className="bi bi-search display-1 text-muted opacity-25"></i>
                  <p className="mt-3 fs-5 text-muted">No hay kits que coincidan con los filtros.</p>
                  <button className="btn btn-outline-secondary" onClick={() => { setFilterText(''); setFilterActivity(''); }}>
                    Limpiar filtros
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Kit Modal ──────────────────────────────────────────────────── */}
      {showKitModal && (
        <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.55)', zIndex: 1050 }}>
          <div className="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
            <div className="modal-content border-0 shadow-lg">
              <div className="modal-header bg-primary text-white py-3">
                <h5 className="modal-title fw-bold">
                  {currentKit ? `Editando Kit: ${currentKit.nombre}` : 'Nuevo Kit de Actividades'}
                </h5>
                <button type="button" className="btn-close btn-close-white" onClick={() => setShowKitModal(false)}></button>
              </div>

              <div className="modal-body p-0">
                <div className="row g-0" style={{ minHeight: 500 }}>

                  {/* Left: kit info */}
                  <div className="col-md-4 border-end bg-light p-4">
                    <form onSubmit={handleSaveKit}>
                      <h6 className="text-uppercase text-muted fw-bold small mb-3 letter-spacing-1">Información del Kit</h6>

                      <div className="mb-3">
                        <label className="form-label fw-semibold small">
                          Código del Kit <span className="text-danger">*</span>
                        </label>
                        <input
                          type="text"
                          className="form-control font-monospace"
                          value={kitForm.codigo_kit}
                          onChange={e => setKitForm(p => ({ ...p, codigo_kit: e.target.value.toUpperCase() }))}
                          required
                          placeholder="Ej: STRUCT-001"
                          maxLength={50}
                        />
                        <div className="form-text">Valor asignado al parámetro <code>codigo_kit_actividad</code> en el IFC.</div>
                      </div>

                      <div className="mb-3">
                        <label className="form-label fw-semibold small">Nombre <span className="text-danger">*</span></label>
                        <input
                          type="text"
                          className="form-control"
                          value={kitForm.nombre}
                          onChange={e => setKitForm(p => ({ ...p, nombre: e.target.value }))}
                          required
                          placeholder="Ej: Estructura de Concreto"
                        />
                      </div>

                      <div className="mb-4">
                        <label className="form-label fw-semibold small text-muted">Descripción</label>
                        <textarea
                          className="form-control"
                          rows={3}
                          value={kitForm.descripcion}
                          onChange={e => setKitForm(p => ({ ...p, descripcion: e.target.value }))}
                          placeholder="Descripción opcional…"
                        />
                      </div>

                      <button type="submit" className="btn btn-primary w-100 fw-bold" disabled={savingKit}>
                        {savingKit
                          ? <><span className="spinner-border spinner-border-sm me-2"></span>Guardando…</>
                          : currentKit ? <><i className="bi bi-check2 me-1"></i>Guardar Cambios</> : <><i className="bi bi-plus-circle me-1"></i>Crear Kit</>
                        }
                      </button>

                      {currentKit && (
                        <div className="mt-3 alert alert-info py-2 small mb-0">
                          <i className="bi bi-info-circle me-1"></i>
                          <strong>{currentKit.kit_activities.length}</strong> actividades en este kit
                        </div>
                      )}
                    </form>
                  </div>

                  {/* Right: activities */}
                  <div className="col-md-8 p-4 d-flex flex-column">
                    {!currentKit ? (
                      <div className="flex-grow-1 d-flex flex-column align-items-center justify-content-center text-center text-muted py-5">
                        <i className="bi bi-arrow-left-circle display-4 opacity-25 mb-3"></i>
                        <p>Completa la información del kit y haz clic en <strong>Crear Kit</strong> para luego agregar actividades.</p>
                      </div>
                    ) : (
                      <>
                        <div className="d-flex justify-content-between align-items-center mb-3">
                          <h6 className="text-uppercase text-muted fw-bold small mb-0">Actividades del Kit</h6>
                          <div className="d-flex gap-2">
                            <button className="btn btn-outline-secondary btn-sm" onClick={openImport}>
                              <i className="bi bi-download me-1"></i>Importar del catálogo
                            </button>
                            <button className="btn btn-outline-primary btn-sm" onClick={openNewActivity} disabled={activityForm !== null}>
                              <i className="bi bi-plus-circle me-1"></i>Nueva actividad
                            </button>
                          </div>
                        </div>

                        {/* Activities table */}
                        <div className="border rounded">
                          <table className="table table-sm table-hover mb-0">
                            <thead className="table-light" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                              <tr>
                                <th style={{ width: 110 }}>Código</th>
                                <th>Descripción</th>
                                <th className="text-center" style={{ width: 65 }}>Unidad</th>
                                <th className="text-end" style={{ width: 90 }}>CU Total</th>
                                <th style={{ width: 60 }}></th>
                              </tr>
                            </thead>
                            <tbody>
                              {currentKit.kit_activities.map(act => (
                                <tr key={act.id} className={editingActivityId === act.id ? 'table-warning' : ''}>
                                  <td className="align-middle">
                                    <small className="font-monospace fw-semibold text-primary">{act.codigo_actividad}</small>
                                    {act.base_actividad && (
                                      <span className="ms-1 badge bg-light text-secondary border" style={{ fontSize: 9 }} title="Derivada del catálogo">↑</span>
                                    )}
                                  </td>
                                  <td className="align-middle">
                                    <small className="text-truncate d-block" style={{ maxWidth: 220 }}>{act.descripcion}</small>
                                    <small className="text-muted" style={{ fontSize: 10 }}>{act.division_code}</small>
                                  </td>
                                  <td className="text-center align-middle"><small className="text-muted">{act.unidad}</small></td>
                                  <td className="text-end align-middle"><small className="fw-semibold">${parseFloat(act.cu_total).toFixed(2)}</small></td>
                                  <td className="align-middle">
                                    <div className="d-flex gap-1 justify-content-end">
                                      <button className="btn btn-link btn-sm p-0 text-primary" title="Editar" onClick={() => openEditActivity(act)}>
                                        <i className="bi bi-pencil"></i>
                                      </button>
                                      <button className="btn btn-link btn-sm p-0 text-danger" title="Eliminar" onClick={() => handleDeleteActivity(act.id)}>
                                        <i className="bi bi-trash"></i>
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                              {currentKit.kit_activities.length === 0 && (
                                <tr>
                                  <td colSpan={5} className="text-center text-muted py-4 small">
                                    <i className="bi bi-inbox me-1"></i>Sin actividades. Importa del catálogo o crea nuevas.
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>

                        {/* Inline activity form */}
                        {activityForm !== null && (
                          <form onSubmit={handleSaveActivity} className="border rounded p-3 mt-3 bg-light">
                            <h6 className="fw-bold small mb-3 text-uppercase text-muted">
                              {editingActivityId ? 'Editar Actividad' : 'Nueva Actividad'}
                              {activityForm.base_actividad && (
                                <span className="badge bg-secondary ms-2 fw-normal text-lowercase" style={{ fontSize: 10 }}>
                                  derivada del catálogo
                                </span>
                              )}
                            </h6>
                            <div className="row g-2">
                              <div className="col-md-4">
                                <label className="form-label small fw-semibold">Código <span className="text-danger">*</span></label>
                                <input
                                  type="text"
                                  className="form-control form-control-sm font-monospace"
                                  value={activityForm.codigo_actividad}
                                  onChange={e => setActivityForm(p => p && ({ ...p, codigo_actividad: e.target.value }))}
                                  required
                                />
                              </div>
                              <div className="col-md-5">
                                <label className="form-label small fw-semibold">Descripción <span className="text-danger">*</span></label>
                                <input
                                  type="text"
                                  className="form-control form-control-sm"
                                  value={activityForm.descripcion}
                                  onChange={e => setActivityForm(p => p && ({ ...p, descripcion: e.target.value }))}
                                  required
                                />
                              </div>
                              <div className="col-md-3">
                                <label className="form-label small fw-semibold">Unidad <span className="text-danger">*</span></label>
                                <input
                                  type="text"
                                  className="form-control form-control-sm"
                                  value={activityForm.unidad}
                                  onChange={e => setActivityForm(p => p && ({ ...p, unidad: e.target.value }))}
                                  required
                                />
                              </div>
                              <div className="col-md-3">
                                <label className="form-label small fw-semibold">CU Total <span className="text-danger">*</span></label>
                                <input
                                  type="number"
                                  step="0.0001"
                                  className="form-control form-control-sm"
                                  value={activityForm.cu_total}
                                  onChange={e => setActivityForm(p => p && ({ ...p, cu_total: e.target.value }))}
                                  required
                                />
                              </div>
                              <div className="col-md-3">
                                <label className="form-label small fw-semibold">Material</label>
                                <input type="number" step="0.0001" className="form-control form-control-sm" value={activityForm.material} onChange={e => setActivityForm(p => p && ({ ...p, material: e.target.value }))} />
                              </div>
                              <div className="col-md-3">
                                <label className="form-label small fw-semibold">Mano de Obra</label>
                                <input type="number" step="0.0001" className="form-control form-control-sm" value={activityForm.mano_obra} onChange={e => setActivityForm(p => p && ({ ...p, mano_obra: e.target.value }))} />
                              </div>
                              <div className="col-md-3">
                                <label className="form-label small fw-semibold">Equipo</label>
                                <input type="number" step="0.0001" className="form-control form-control-sm" value={activityForm.equipo} onChange={e => setActivityForm(p => p && ({ ...p, equipo: e.target.value }))} />
                              </div>
                              <div className="col-md-6">
                                <label className="form-label small fw-semibold">División MasterFormat <span className="text-danger">*</span></label>
                                <select
                                  className="form-select form-select-sm"
                                  value={activityForm.division}
                                  onChange={e => setActivityForm(p => p && ({ ...p, division: e.target.value }))}
                                  required
                                >
                                  <option value="">Seleccionar división…</option>
                                  {divisions.map(d => (
                                    <option key={d.id} value={d.id}>
                                      {d.division_code} – {d.division_name.length > 35 ? d.division_name.slice(0, 35) + '…' : d.division_name}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>
                            <div className="d-flex gap-2 mt-3">
                              <button type="submit" className="btn btn-primary btn-sm px-3" disabled={savingActivity}>
                                {savingActivity ? <span className="spinner-border spinner-border-sm"></span> : <><i className="bi bi-check2 me-1"></i>Guardar</>}
                              </button>
                              <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => { setActivityForm(null); setEditingActivityId(null); }}>
                                Cancelar
                              </button>
                            </div>
                          </form>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Import Modal ──────────────────────────────────────────────────── */}
      {showImport && (
        <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 1060 }}>
          <div className="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
            <div className="modal-content border-0 shadow-lg">
              <div className="modal-header">
                <h5 className="modal-title fw-bold">
                  <i className="bi bi-download me-2 text-primary"></i>Importar del catálogo
                </h5>
                <button type="button" className="btn-close" onClick={() => setShowImport(false)}></button>
              </div>
              <div className="modal-body p-3">
                <div className="row g-2 mb-3">
                  <div className="col-7">
                    <div className="input-group input-group-sm">
                      <span className="input-group-text bg-white"><i className="bi bi-search text-muted"></i></span>
                      <input
                        type="text"
                        className="form-control"
                        placeholder="Buscar por código o descripción…"
                        value={importSearch}
                        onChange={e => setImportSearch(e.target.value)}
                      />
                      {importSearch && <button type="button" className="btn btn-outline-secondary" onClick={() => setImportSearch('')}><i className="bi bi-x"></i></button>}
                    </div>
                  </div>
                  <div className="col-5">
                    <select className="form-select form-select-sm" value={importDivision} onChange={e => setImportDivision(e.target.value)}>
                      <option value="">Todas las divisiones</option>
                      {importDivisions.map(d => (
                        <option key={d.code} value={d.code}>{d.code} – {d.name.length > 25 ? d.name.slice(0, 25) + '…' : d.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="d-flex justify-content-between align-items-center mb-2 px-1">
                  <small className="text-muted">
                    <span className="fw-semibold text-primary">{selectedMasterIds.size}</span> seleccionadas · {filteredMaster.length} visibles
                  </small>
                  <div className="d-flex gap-3">
                    <button type="button" className="btn btn-link btn-sm p-0 text-decoration-none" onClick={() => setSelectedMasterIds(new Set(filteredMaster.map(a => a.id)))}>
                      <i className="bi bi-check2-all me-1"></i>Seleccionar visibles
                    </button>
                    <button type="button" className="btn btn-link btn-sm p-0 text-decoration-none text-danger" onClick={() => setSelectedMasterIds(new Set())}>
                      <i className="bi bi-x-circle me-1"></i>Limpiar
                    </button>
                  </div>
                </div>
                <div className="border rounded" style={{ maxHeight: 360, overflowY: 'auto' }}>
                  <table className="table table-sm table-hover mb-0">
                    <thead className="table-light" style={{ position: 'sticky', top: 0 }}>
                      <tr>
                        <th style={{ width: 36 }}></th>
                        <th style={{ width: 110 }}>Código</th>
                        <th>Descripción</th>
                        <th className="text-center" style={{ width: 65 }}>Unidad</th>
                        <th className="text-end" style={{ width: 85 }}>CU Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredMaster.map(act => {
                        const isSelected = selectedMasterIds.has(act.id);
                        const alreadyIn = alreadyImportedBaseIds.has(act.id);
                        return (
                          <tr
                            key={act.id}
                            className={isSelected ? 'table-primary' : alreadyIn ? 'table-secondary' : ''}
                            style={{ cursor: alreadyIn ? 'default' : 'pointer' }}
                            onClick={() => !alreadyIn && toggleMasterId(act.id)}
                          >
                            <td className="text-center align-middle">
                              {alreadyIn
                                ? <span className="text-muted small" title="Ya importada">✓</span>
                                : <input type="checkbox" className="form-check-input" checked={isSelected} onChange={() => toggleMasterId(act.id)} onClick={e => e.stopPropagation()} />
                              }
                            </td>
                            <td className="align-middle"><small className="font-monospace fw-semibold text-primary">{act.codigo_actividad}</small></td>
                            <td className="align-middle"><small>{act.descripcion}</small></td>
                            <td className="text-center align-middle"><small className="text-muted">{act.unidad}</small></td>
                            <td className="text-end align-middle"><small className="fw-semibold">${parseFloat(act.cu_total).toFixed(2)}</small></td>
                          </tr>
                        );
                      })}
                      {filteredMaster.length === 0 && (
                        <tr><td colSpan={5} className="text-center text-muted py-4 small"><i className="bi bi-search me-1"></i>Sin resultados</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="modal-footer bg-light border-0 p-3">
                <small className="text-muted me-auto">Las actividades importadas se copian al kit y se pueden editar de forma independiente.</small>
                <button type="button" className="btn btn-outline-secondary px-4" onClick={() => setShowImport(false)}>Cancelar</button>
                <button
                  type="button"
                  className="btn btn-primary px-4 fw-bold"
                  onClick={handleImport}
                  disabled={selectedMasterIds.size === 0 || importing}
                >
                  {importing
                    ? <><span className="spinner-border spinner-border-sm me-2"></span>Importando…</>
                    : <><i className="bi bi-download me-2"></i>Importar {selectedMasterIds.size > 0 ? `(${selectedMasterIds.size})` : ''}</>
                  }
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ActivityKitList;
