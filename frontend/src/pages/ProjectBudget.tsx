import { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import axios from 'axios';

const API = 'http://localhost:8000/api';

interface Activity {
  id: number;
  codigo_actividad: string;
  descripcion: string;
  unidad: string;
  cu_total: string;
  division: number;
  division_name?: string;
  division_code?: string;
  es_proyecto?: boolean;
}

interface BudgetItem {
  id: number;
  proyecto: number;
  actividad: number;
  cantidad: string;
  actividad_detail: Activity;
  costo_total: number;
}

interface ActivityKit {
  id: number;
  nombre: string;
  descripcion: string;
  activities: Activity[];
}

interface Project {
  id: number;
  nombre: string;
  descripcion: string;
}

type ViewMode = 'division' | 'kits';

const fmt = (n: number) =>
  n.toLocaleString('es-PA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ProjectBudget = () => {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [budgetItems, setBudgetItems] = useState<BudgetItem[]>([]);
  const [projectKits, setProjectKits] = useState<ActivityKit[]>([]);
  const [masterActivities, setMasterActivities] = useState<Activity[]>([]);
  const [projectActivities, setProjectActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('division');
  const [showAddModal, setShowAddModal] = useState(false);
  const [addSearchTerm, setAddSearchTerm] = useState('');
  const [localQty, setLocalQty] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => { fetchAll(); }, [id]);

  useEffect(() => {
    const map: Record<number, string> = {};
    budgetItems.forEach(i => { map[i.id] = i.cantidad; });
    setLocalQty(map);
  }, [budgetItems]);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [projRes, itemsRes, kitsRes, masterActRes, projActRes] = await Promise.all([
        axios.get(`${API}/projects/${id}/`),
        axios.get(`${API}/budget-items/?proyecto=${id}`),
        axios.get(`${API}/activity-kits/?proyecto=${id}`),
        axios.get(`${API}/activities/`),
        axios.get(`${API}/activities/?proyecto=${id}`),
      ]);
      setProject(projRes.data);
      setBudgetItems(itemsRes.data);
      setProjectKits(kitsRes.data);
      setMasterActivities(masterActRes.data);
      setProjectActivities(projActRes.data);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  // --- Computed ---

  const byDivision = useMemo(() => {
    const map = new Map<string, { code: string; name: string; items: BudgetItem[] }>();
    budgetItems.forEach(item => {
      const code = item.actividad_detail.division_code || 'SIN CÓDIGO';
      const name = item.actividad_detail.division_name || '';
      if (!map.has(code)) map.set(code, { code, name, items: [] });
      map.get(code)!.items.push(item);
    });
    return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
  }, [budgetItems]);

  const budgetByActivity = useMemo(() => {
    const map = new Map<number, BudgetItem>();
    budgetItems.forEach(i => map.set(i.actividad, i));
    return map;
  }, [budgetItems]);

  const getItemTotal = (item: BudgetItem) => {
    const qty = parseFloat(localQty[item.id] ?? item.cantidad) || 0;
    return qty * parseFloat(item.actividad_detail.cu_total);
  };

  const getDivisionTotal = (items: BudgetItem[]) =>
    items.reduce((s, i) => s + getItemTotal(i), 0);

  const getKitTotal = (kit: ActivityKit) =>
    kit.activities.reduce((s, act) => {
      const bi = budgetByActivity.get(act.id);
      return bi ? s + getItemTotal(bi) : s;
    }, 0);

  const grandTotal = useMemo(
    () => budgetItems.reduce((s, i) => s + getItemTotal(i), 0),
    [budgetItems, localQty]
  );

  const allActivities = useMemo(
    () => [...masterActivities, ...projectActivities],
    [masterActivities, projectActivities]
  );
  const budgetActivityIds = useMemo(
    () => new Set(budgetItems.map(i => i.actividad)),
    [budgetItems]
  );
  const availableToAdd = useMemo(() => {
    const term = addSearchTerm.toLowerCase().trim();
    return allActivities.filter(act => {
      if (budgetActivityIds.has(act.id)) return false;
      if (!term) return true;
      return (
        act.codigo_actividad.toLowerCase().includes(term) ||
        act.descripcion.toLowerCase().includes(term)
      );
    });
  }, [allActivities, budgetActivityIds, addSearchTerm]);

  // Activities in budget but not in any project kit (for "Sin Kit" group)
  const kitActivityIds = useMemo(
    () => new Set(projectKits.flatMap(k => k.activities.map(a => a.id))),
    [projectKits]
  );
  const orphanItems = useMemo(
    () => budgetItems.filter(i => !kitActivityIds.has(i.actividad)),
    [budgetItems, kitActivityIds]
  );

  // --- Handlers ---

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await axios.post(`${API}/budget-items/generate_from_kits/`, {
        proyecto: parseInt(id!),
      });
      alert(res.data.message || 'Presupuesto generado.');
      fetchAll();
    } catch {
      alert('Error al generar el presupuesto desde los kits.');
    }
    setGenerating(false);
  };

  const handleQtyChange = (itemId: number, val: string) =>
    setLocalQty(prev => ({ ...prev, [itemId]: val }));

  const handleQtyBlur = async (itemId: number) => {
    const original = budgetItems.find(i => i.id === itemId)?.cantidad;
    const current = localQty[itemId];
    if (current === original) return;
    setSavingId(itemId);
    try {
      await axios.patch(`${API}/budget-items/${itemId}/`, { cantidad: current || '0' });
      setBudgetItems(prev =>
        prev.map(i =>
          i.id === itemId
            ? { ...i, cantidad: current || '0', costo_total: (parseFloat(current || '0')) * parseFloat(i.actividad_detail.cu_total) }
            : i
        )
      );
    } catch {
      console.error('Error al guardar cantidad');
    }
    setSavingId(null);
  };

  const handleAddActivity = async (actId: number) => {
    try {
      await axios.post(`${API}/budget-items/`, {
        proyecto: parseInt(id!),
        actividad: actId,
        cantidad: 0,
      });
      setShowAddModal(false);
      setAddSearchTerm('');
      fetchAll();
    } catch {
      alert('Error al agregar la actividad.');
    }
  };

  const handleRemoveItem = async (itemId: number) => {
    try {
      await axios.delete(`${API}/budget-items/${itemId}/`);
      setBudgetItems(prev => prev.filter(i => i.id !== itemId));
    } catch {
      console.error('Error al eliminar ítem');
    }
  };

  // --- Reusable row component ---
  const BudgetRow = ({ item }: { item: BudgetItem }) => {
    const qty = parseFloat(localQty[item.id] ?? item.cantidad) || 0;
    const cu = parseFloat(item.actividad_detail.cu_total);
    const total = qty * cu;
    const isSaving = savingId === item.id;
    return (
      <tr>
        <td className="align-middle">
          <small className={`font-monospace fw-semibold ${item.actividad_detail.es_proyecto ? 'text-warning' : 'text-primary'}`}>
            {item.actividad_detail.es_proyecto && (
              <i className="bi bi-star-fill me-1" title="Actividad del proyecto"></i>
            )}
            {item.actividad_detail.codigo_actividad}
          </small>
        </td>
        <td className="align-middle"><small>{item.actividad_detail.descripcion}</small></td>
        <td className="text-center align-middle">
          <small className="text-muted">{item.actividad_detail.unidad}</small>
        </td>
        <td className="text-center align-middle">
          <div className="d-flex align-items-center justify-content-center gap-1">
            <input
              type="number"
              className="form-control form-control-sm text-center"
              style={{ width: '85px' }}
              value={localQty[item.id] ?? item.cantidad}
              min="0"
              step="0.01"
              onChange={e => handleQtyChange(item.id, e.target.value)}
              onBlur={() => handleQtyBlur(item.id)}
            />
            {isSaving && (
              <span
                className="spinner-border spinner-border-sm text-secondary"
                style={{ width: '12px', height: '12px', flexShrink: 0 }}
              />
            )}
          </div>
        </td>
        <td className="text-end align-middle"><small>${fmt(cu)}</small></td>
        <td className="text-end align-middle">
          <strong className={total > 0 ? 'text-success' : 'text-muted'}>${fmt(total)}</strong>
        </td>
        <td className="align-middle text-center no-print">
          <button
            className="btn btn-link text-danger p-0"
            title="Quitar del presupuesto"
            onClick={() => handleRemoveItem(item.id)}
          >
            <i className="bi bi-x-circle"></i>
          </button>
        </td>
      </tr>
    );
  };

  const TableHeader = () => (
    <thead className="table-light">
      <tr>
        <th style={{ width: '130px' }}>Código</th>
        <th>Descripción</th>
        <th className="text-center" style={{ width: '70px' }}>Unidad</th>
        <th className="text-center" style={{ width: '115px' }}>Cantidad</th>
        <th className="text-end" style={{ width: '110px' }}>Costo Unit.</th>
        <th className="text-end" style={{ width: '130px' }}>Costo Total</th>
        <th className="no-print" style={{ width: '36px' }}></th>
      </tr>
    </thead>
  );

  if (loading) return <div className="text-center mt-5"><div className="spinner-border text-success"></div></div>;
  if (!project) return <div className="alert alert-danger m-4">Proyecto no encontrado.</div>;

  return (
    <>
      {/* Print-only styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .navbar { display: none !important; }
          body { font-size: 11px; }
          .table th, .table td { padding: 3px 6px !important; }
        }
      `}</style>

      <div className="container-fluid py-4">

        {/* Header */}
        <div className="d-flex justify-content-between align-items-start mb-4 bg-white p-3 shadow-sm rounded border-start border-success border-4">
          <div>
            <nav aria-label="breadcrumb">
              <ol className="breadcrumb mb-1 small">
                <li className="breadcrumb-item">
                  <Link to="/projects" className="text-decoration-none">Proyectos</Link>
                </li>
                <li className="breadcrumb-item">
                  <Link to={`/projects/${id}`} className="text-decoration-none">{project.nombre}</Link>
                </li>
                <li className="breadcrumb-item active">Presupuesto</li>
              </ol>
            </nav>
            <h3 className="mb-0 fw-bold">{project.nombre}</h3>
            <p className="text-muted mb-0 small">
              Presupuesto resumen —{' '}
              {viewMode === 'division' ? 'Vista por División MasterFormat' : 'Vista por Kits de Actividades'}
            </p>
          </div>
          <div className="d-flex gap-2 no-print">
            <Link to={`/projects/${id}`} className="btn btn-outline-secondary btn-sm">
              <i className="bi bi-arrow-left me-1"></i>Volver
            </Link>
            <button className="btn btn-outline-dark btn-sm" onClick={() => window.print()}>
              <i className="bi bi-printer me-1"></i>Imprimir
            </button>
          </div>
        </div>

        {/* Controls */}
        <div className="d-flex flex-wrap justify-content-between align-items-center mb-3 gap-2 no-print">
          <div className="btn-group shadow-sm" role="group">
            <button
              className={`btn btn-sm fw-bold ${viewMode === 'division' ? 'btn-success' : 'btn-outline-success'}`}
              onClick={() => setViewMode('division')}
            >
              <i className="bi bi-diagram-3 me-1"></i>Por División MasterFormat
            </button>
            <button
              className={`btn btn-sm fw-bold ${viewMode === 'kits' ? 'btn-success' : 'btn-outline-success'}`}
              onClick={() => setViewMode('kits')}
            >
              <i className="bi bi-box-seam me-1"></i>Por Kits
            </button>
          </div>
          <div className="d-flex gap-2">
            <button
              className="btn btn-outline-secondary btn-sm"
              onClick={handleGenerate}
              disabled={generating}
            >
              {generating
                ? <><span className="spinner-border spinner-border-sm me-1"></span>Generando...</>
                : <><i className="bi bi-magic me-1"></i>Generar desde Kits del Proyecto</>}
            </button>
            <button
              className="btn btn-success btn-sm fw-bold shadow-sm"
              onClick={() => { setShowAddModal(true); setAddSearchTerm(''); }}
            >
              <i className="bi bi-plus-circle me-1"></i>Agregar Actividad
            </button>
          </div>
        </div>

        {/* Grand Total Banner */}
        <div className="card border-0 bg-success text-white shadow mb-4">
          <div className="card-body py-3 px-4 d-flex justify-content-between align-items-center">
            <div>
              <div className="small opacity-75 text-uppercase fw-bold">Costo Total del Proyecto</div>
              <div className="display-6 fw-bold font-monospace">${fmt(grandTotal)}</div>
            </div>
            <div className="text-end opacity-75 small">
              <div>{budgetItems.length} actividades presupuestadas</div>
              <div>
                {viewMode === 'division'
                  ? `${byDivision.length} divisiones MasterFormat`
                  : `${projectKits.length} kits`}
              </div>
            </div>
          </div>
        </div>

        {/* Empty state */}
        {budgetItems.length === 0 && (
          <div className="text-center py-5 no-print">
            <div className="bg-light rounded p-5 border">
              <i className="bi bi-table display-1 text-muted opacity-25"></i>
              <p className="mt-3 fs-5 text-muted">El presupuesto está vacío.</p>
              <p className="small text-muted">
                Use <strong>Generar desde Kits del Proyecto</strong> para poblar el presupuesto automáticamente,
                o agregue actividades manualmente.
              </p>
              <div className="d-flex gap-2 justify-content-center mt-3">
                <button className="btn btn-outline-secondary" onClick={handleGenerate} disabled={generating}>
                  <i className="bi bi-magic me-1"></i>Generar desde Kits
                </button>
                <button className="btn btn-success" onClick={() => setShowAddModal(true)}>
                  <i className="bi bi-plus-circle me-1"></i>Agregar Actividad
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ===== VISTA: Por División ===== */}
        {viewMode === 'division' && budgetItems.length > 0 && (
          <>
            {byDivision.map(div => {
              const divTotal = getDivisionTotal(div.items);
              return (
                <div key={div.code} className="mb-4">
                  {/* Division header */}
                  <div className="d-flex justify-content-between align-items-center bg-dark text-white px-3 py-2 rounded-top">
                    <span className="fw-bold">
                      <span className="font-monospace me-2 opacity-50">{div.code}</span>
                      {div.name}
                    </span>
                    <span className="fw-bold bg-white text-success px-3 py-1 rounded-pill small font-monospace">
                      ${fmt(divTotal)}
                    </span>
                  </div>
                  <div className="table-responsive border border-top-0 rounded-bottom shadow-sm">
                    <table className="table table-sm table-hover mb-0">
                      <TableHeader />
                      <tbody>
                        {div.items.map(item => <BudgetRow key={item.id} item={item} />)}
                      </tbody>
                      <tfoot className="table-light border-top">
                        <tr>
                          <td colSpan={5} className="text-end fw-bold text-muted small pe-3">
                            Subtotal {div.code}:
                          </td>
                          <td className="text-end fw-bold text-success font-monospace">
                            ${fmt(divTotal)}
                          </td>
                          <td className="no-print"></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              );
            })}

            {/* Grand total row */}
            <div className="d-flex justify-content-end mt-1 mb-4">
              <div className="d-flex align-items-center bg-success text-white px-4 py-2 rounded shadow">
                <span className="fw-bold me-4 text-uppercase small">Total General</span>
                <span className="fw-bold fs-5 font-monospace">${fmt(grandTotal)}</span>
              </div>
            </div>
          </>
        )}

        {/* ===== VISTA: Por Kits ===== */}
        {viewMode === 'kits' && budgetItems.length > 0 && (
          <>
            {projectKits.length === 0 && (
              <div className="alert alert-info no-print">
                <i className="bi bi-info-circle me-1"></i>
                Este proyecto no tiene kits. &nbsp;
                <Link to={`/projects/${id}/kits`}>Crear kits del proyecto</Link>
                &nbsp;para organizar el presupuesto por kits.
              </div>
            )}

            {projectKits.map(kit => {
              const kitTotal = getKitTotal(kit);
              const kitItems = kit.activities
                .map(act => budgetByActivity.get(act.id))
                .filter(Boolean) as BudgetItem[];

              if (kitItems.length === 0) return null;

              return (
                <div key={kit.id} className="mb-4">
                  <div className="d-flex justify-content-between align-items-center bg-warning px-3 py-2 rounded-top">
                    <span className="fw-bold text-dark">
                      <i className="bi bi-box-seam me-2"></i>{kit.nombre}
                    </span>
                    <span className="fw-bold bg-white text-success px-3 py-1 rounded-pill small font-monospace">
                      ${fmt(kitTotal)}
                    </span>
                  </div>
                  {kit.descripcion && (
                    <div className="px-3 py-1 bg-warning bg-opacity-10 border-start border-warning border-3">
                      <small className="text-muted">{kit.descripcion}</small>
                    </div>
                  )}
                  <div className="table-responsive border border-top-0 rounded-bottom shadow-sm">
                    <table className="table table-sm table-hover mb-0">
                      <TableHeader />
                      <tbody>
                        {kitItems.map(item => <BudgetRow key={item.id} item={item} />)}
                      </tbody>
                      <tfoot className="table-light border-top">
                        <tr>
                          <td colSpan={5} className="text-end fw-bold text-muted small pe-3">
                            Subtotal {kit.nombre}:
                          </td>
                          <td className="text-end fw-bold text-success font-monospace">
                            ${fmt(kitTotal)}
                          </td>
                          <td className="no-print"></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              );
            })}

            {/* Activities without a kit */}
            {orphanItems.length > 0 && (
              <div className="mb-4">
                <div className="d-flex justify-content-between align-items-center bg-secondary text-white px-3 py-2 rounded-top">
                  <span className="fw-bold">
                    <i className="bi bi-question-circle me-2"></i>Sin Kit Asignado
                  </span>
                  <span className="fw-bold bg-white text-success px-3 py-1 rounded-pill small font-monospace">
                    ${fmt(getDivisionTotal(orphanItems))}
                  </span>
                </div>
                <div className="table-responsive border border-top-0 rounded-bottom shadow-sm">
                  <table className="table table-sm table-hover mb-0">
                    <TableHeader />
                    <tbody>
                      {orphanItems.map(item => <BudgetRow key={item.id} item={item} />)}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Grand total row */}
            <div className="d-flex justify-content-end mt-1 mb-4">
              <div className="d-flex align-items-center bg-success text-white px-4 py-2 rounded shadow">
                <span className="fw-bold me-4 text-uppercase small">Total General</span>
                <span className="fw-bold fs-5 font-monospace">${fmt(grandTotal)}</span>
              </div>
            </div>
          </>
        )}

        {/* ===== MODAL: Agregar Actividad ===== */}
        {showAddModal && (
          <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
            <div className="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
              <div className="modal-content border-0 shadow-lg">
                <div className="modal-header bg-success text-white py-3">
                  <h5 className="modal-title fw-bold">Agregar Actividad al Presupuesto</h5>
                  <button
                    type="button"
                    className="btn-close btn-close-white"
                    onClick={() => setShowAddModal(false)}
                  />
                </div>
                <div className="modal-body p-3">
                  <div className="input-group mb-3">
                    <span className="input-group-text bg-white">
                      <i className="bi bi-search text-muted"></i>
                    </span>
                    <input
                      type="text"
                      className="form-control"
                      placeholder="Buscar por código o descripción..."
                      value={addSearchTerm}
                      onChange={e => setAddSearchTerm(e.target.value)}
                      autoFocus
                    />
                    {addSearchTerm && (
                      <button
                        type="button"
                        className="btn btn-outline-secondary"
                        onClick={() => setAddSearchTerm('')}
                      >
                        <i className="bi bi-x"></i>
                      </button>
                    )}
                  </div>
                  <div style={{ maxHeight: '420px', overflowY: 'auto' }}>
                    <table className="table table-sm table-hover mb-0">
                      <thead className="table-dark" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                        <tr>
                          <th style={{ width: '120px' }}>Código</th>
                          <th>Descripción</th>
                          <th className="text-center" style={{ width: '70px' }}>Unidad</th>
                          <th className="text-end" style={{ width: '100px' }}>CU Total</th>
                          <th style={{ width: '50px' }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {availableToAdd.map(act => (
                          <tr key={act.id}>
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
                              <small className="fw-semibold">
                                ${parseFloat(act.cu_total).toFixed(2)}
                              </small>
                            </td>
                            <td className="align-middle text-center">
                              <button
                                className="btn btn-success btn-sm"
                                onClick={() => handleAddActivity(act.id)}
                                title="Agregar al presupuesto"
                              >
                                <i className="bi bi-plus-lg"></i>
                              </button>
                            </td>
                          </tr>
                        ))}
                        {availableToAdd.length === 0 && (
                          <tr>
                            <td colSpan={5} className="text-center text-muted py-5">
                              <i className="bi bi-check2-circle display-6 d-block mb-2 opacity-25"></i>
                              {addSearchTerm
                                ? 'No se encontraron actividades con ese criterio.'
                                : 'Todas las actividades disponibles ya están en el presupuesto.'}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="modal-footer bg-light border-0 p-3">
                  <button
                    type="button"
                    className="btn btn-outline-secondary"
                    onClick={() => setShowAddModal(false)}
                  >
                    Cerrar
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default ProjectBudget;
