import React, { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import axios from 'axios';
import * as WEBIFC from 'web-ifc';

const API = 'http://localhost:8000/api';
const WASM_PATH = 'https://unpkg.com/web-ifc@0.0.77/';

// ── Interfaces ────────────────────────────────────────────────────────────────

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
  activity_kit?: number | null;
}

interface BudgetItem {
  id: number;
  proyecto: number;
  actividad: number;
  cantidad: string;
  actividad_detail: Activity;
  costo_total: number;
}

interface KitActivity {
  id: number;
  codigo_actividad: string;
  descripcion: string;
  unidad: string;
  cu_total: string;
}

interface ConsolidatedActivity {
  codigo_actividad: string;
  descripcion: string;
  unidad: string;
  cu_total: number;
  cantidad: number;
  costo_total: number;
}

interface ActivityKit {
  id: number;
  codigo_kit: string;
  nombre: string;
  descripcion: string;
  kit_activities: KitActivity[];
}

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

type ViewMode = 'kits' | 'division';

// ── IFC scanner — only extracts codigo_kit_actividad values ──────────────────

async function scanKitCodesFromIFC(ifcBuffer: Uint8Array): Promise<Set<string>> {
  const api = new WEBIFC.IfcAPI();
  api.SetWasmPath(WASM_PATH, true);
  await api.Init();
  const modelId = api.OpenModel(ifcBuffer, { COORDINATE_TO_ORIGIN: false, USE_FAST_BOOLS: true });
  const codes = new Set<string>();
  const TARGET = 'codigo_kit_actividad';

  try {
    const psetIds = api.GetLineIDsWithType(modelId, WEBIFC.IFCPROPERTYSET);
    for (let i = 0; i < psetIds.size(); i++) {
      let pset: any;
      try { pset = api.GetLine(modelId, psetIds.get(i), false); } catch { continue; }
      if (!pset || !Array.isArray(pset.HasProperties)) continue;

      for (const propRef of pset.HasProperties) {
        const propId =
          typeof propRef === 'object' && propRef !== null && 'value' in propRef
            ? propRef.value : propRef;
        if (typeof propId !== 'number') continue;

        let prop: any;
        try { prop = api.GetLine(modelId, propId, false); } catch { continue; }
        if (!prop) continue;

        const name =
          typeof prop.Name === 'object' && prop.Name !== null
            ? String(prop.Name.value ?? '') : String(prop.Name ?? '');
        if (name.toLowerCase().trim() !== TARGET) continue;

        const rawVal =
          typeof prop.NominalValue === 'object' && prop.NominalValue !== null
            ? prop.NominalValue.value : prop.NominalValue;
        const val = rawVal !== null && rawVal !== undefined ? String(rawVal).trim() : '';
        if (val && val !== 'null' && val !== 'undefined') codes.add(val);
      }
    }
  } finally {
    api.CloseModel(modelId);
  }

  return codes;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  n.toLocaleString('es-PA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── Component ─────────────────────────────────────────────────────────────────

const ProjectBudget = () => {
  const { id } = useParams<{ id: string }>();
  const [project, setProject]               = useState<Project | null>(null);
  const [budgetItems, setBudgetItems]       = useState<BudgetItem[]>([]);
  const [masterKits, setMasterKits]         = useState<ActivityKit[]>([]);
  const [masterActivities, setMasterActivities] = useState<Activity[]>([]);
  const [projectActivities, setProjectActivities] = useState<Activity[]>([]);
  const [loading, setLoading]               = useState(true);
  const [viewMode, setViewMode]             = useState<ViewMode>('kits');
  const [showAddModal, setShowAddModal]     = useState(false);
  const [addSearchTerm, setAddSearchTerm]   = useState('');
  const [localQty, setLocalQty]             = useState<Record<number, string>>({});
  const [savingId, setSavingId]             = useState<number | null>(null);
  const [syncingIFC, setSyncingIFC]         = useState(false);
  const [syncStatus, setSyncStatus]         = useState<string | null>(null);
  const [savingAll, setSavingAll]           = useState(false);
  const [saveStatus, setSaveStatus]         = useState<'idle' | 'saved' | 'error'>('idle');

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
        axios.get(`${API}/activity-kits/`),
        axios.get(`${API}/activities/`),
        axios.get(`${API}/activities/?proyecto=${id}`),
      ]);
      setProject(projRes.data);
      setBudgetItems(itemsRes.data);
      setMasterKits(kitsRes.data);
      setMasterActivities(masterActRes.data);
      setProjectActivities(projActRes.data);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  // ── Computed ──────────────────────────────────────────────────────────────

  const getItemTotal = (item: BudgetItem) => {
    const qty = parseFloat(localQty[item.id] ?? item.cantidad) || 0;
    return qty * parseFloat(item.actividad_detail.cu_total);
  };

  const getGroupTotal = (items: BudgetItem[]) =>
    items.reduce((s, i) => s + getItemTotal(i), 0);

  const grandTotal = useMemo(
    () => budgetItems.reduce((s, i) => s + getItemTotal(i), 0),
    [budgetItems, localQty],
  );

  // Group by activity_kit FK (already on every kit activity)
  const byKit = useMemo(() => {
    const kitIndex = new Map(masterKits.map(k => [k.id, k]));
    const map = new Map<number, { kit: ActivityKit; items: BudgetItem[] }>();
    for (const item of budgetItems) {
      const kitId = item.actividad_detail.activity_kit;
      if (!kitId) continue;
      const kit = kitIndex.get(kitId);
      if (!kit) continue;
      if (!map.has(kitId)) map.set(kitId, { kit, items: [] });
      map.get(kitId)!.items.push(item);
    }
    return [...map.values()].sort((a, b) =>
      (a.kit.codigo_kit || '').localeCompare(b.kit.codigo_kit || ''),
    );
  }, [budgetItems, masterKits]);

  const orphanItems = useMemo(
    () => budgetItems.filter(i => !i.actividad_detail.activity_kit),
    [budgetItems],
  );

  const byDivision = useMemo(() => {
    type DivEntry = { code: string; name: string; actMap: Map<string, { qty: number; cu: number; act: Activity }> };
    const divMap = new Map<string, DivEntry>();

    for (const item of budgetItems) {
      const code = item.actividad_detail.division_code || 'SIN CÓDIGO';
      const name = item.actividad_detail.division_name || '';
      const actCode = item.actividad_detail.codigo_actividad;
      const qty = parseFloat(localQty[item.id] ?? item.cantidad) || 0;
      const cu = parseFloat(item.actividad_detail.cu_total) || 0;

      if (!divMap.has(code)) divMap.set(code, { code, name, actMap: new Map() });
      const entry = divMap.get(code)!;

      if (!entry.actMap.has(actCode)) entry.actMap.set(actCode, { qty: 0, cu, act: item.actividad_detail });
      entry.actMap.get(actCode)!.qty += qty;
    }

    return [...divMap.values()]
      .sort((a, b) => a.code.localeCompare(b.code))
      .map(({ code, name, actMap }) => ({
        code,
        name,
        activities: [...actMap.values()]
          .map(({ qty, cu, act }) => ({
            codigo_actividad: act.codigo_actividad,
            descripcion: act.descripcion,
            unidad: act.unidad,
            cu_total: cu,
            cantidad: qty,
            costo_total: qty * cu,
          } as ConsolidatedActivity))
          .sort((a, b) => a.codigo_actividad.localeCompare(b.codigo_actividad)),
      }));
  }, [budgetItems, localQty]);

  const budgetActivityIds = useMemo(
    () => new Set(budgetItems.map(i => i.actividad)),
    [budgetItems],
  );

  const allActivities = useMemo(
    () => [...masterActivities, ...projectActivities],
    [masterActivities, projectActivities],
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

  // ── Save all ──────────────────────────────────────────────────────────────

  const hasUnsavedChanges = useMemo(
    () => budgetItems.some(i => {
      const local = localQty[i.id];
      return local !== undefined && local !== i.cantidad;
    }),
    [budgetItems, localQty],
  );

  const handleSaveAll = async () => {
    const changed = budgetItems.filter(i => {
      const local = localQty[i.id];
      return local !== undefined && local !== i.cantidad;
    });
    if (changed.length === 0) return;
    setSavingAll(true);
    setSaveStatus('idle');
    try {
      await Promise.all(
        changed.map(i =>
          axios.patch(`${API}/budget-items/${i.id}/`, { cantidad: localQty[i.id] || '0' }),
        ),
      );
      setBudgetItems(prev =>
        prev.map(i => {
          const local = localQty[i.id];
          return local !== undefined && local !== i.cantidad
            ? { ...i, cantidad: local }
            : i;
        }),
      );
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 4000);
    } catch {
      setSaveStatus('error');
    }
    setSavingAll(false);
  };

  // ── IFC Sync ──────────────────────────────────────────────────────────────

  const handleSyncFromIFC = async () => {
    const models = project?.bim_models ?? [];
    if (models.length === 0) {
      alert('Este proyecto no tiene modelos IFC cargados.');
      return;
    }

    setSyncingIFC(true);
    setSyncStatus('Preparando escaneo…');
    try {
      // Collect all codigo_kit_actividad values across all models
      const allCodes = new Set<string>();
      for (const model of models) {
        setSyncStatus(`Escaneando "${model.nombre}"…`);
        const response = await fetch(model.archivo);
        if (!response.ok) continue;
        const buffer = new Uint8Array(await response.arrayBuffer());
        const codes = await scanKitCodesFromIFC(buffer);
        codes.forEach(c => allCodes.add(c));
      }

      if (allCodes.size === 0) {
        alert(
          'No se encontró el parámetro "codigo_kit_actividad" en los modelos IFC.\n' +
          'Verifica que los elementos tengan ese parámetro asignado en el modelo.',
        );
        return;
      }

      // Match found codes to master kits
      const matchedKits = masterKits.filter(k => k.codigo_kit && allCodes.has(k.codigo_kit));
      if (matchedKits.length === 0) {
        alert(
          `Se encontraron los códigos: ${[...allCodes].join(', ')}\n\n` +
          'Pero ninguno coincide con un Kit de Costos definido. ' +
          'Verifica que los kits tengan el "Código del Kit" correcto.',
        );
        return;
      }

      // Create budget items for each kit activity not yet in the budget
      setSyncStatus(`Creando ítems para ${matchedKits.length} kit(s)…`);
      let added = 0;
      for (const kit of matchedKits) {
        for (const act of kit.kit_activities) {
          if (!budgetActivityIds.has(act.id)) {
            await axios.post(`${API}/budget-items/`, {
              proyecto: parseInt(id!),
              actividad: act.id,
              cantidad: 0,
            });
            added++;
          }
        }
      }

      await fetchAll();
      const msg = `${matchedKits.length} kit(s) importados · ${added} actividad(es) añadida(s)`;
      setSyncStatus(msg);
      setTimeout(() => setSyncStatus(null), 6000);
    } catch (err) {
      console.error(err);
      alert('Error al sincronizar desde el IFC.');
      setSyncStatus(null);
    } finally {
      setSyncingIFC(false);
    }
  };

  // ── Budget handlers ───────────────────────────────────────────────────────

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
            ? { ...i, cantidad: current || '0', costo_total: parseFloat(current || '0') * parseFloat(i.actividad_detail.cu_total) }
            : i,
        ),
      );
    } catch { console.error('Error al guardar cantidad'); }
    setSavingId(null);
  };

  const handleAddActivity = async (actId: number) => {
    try {
      await axios.post(`${API}/budget-items/`, { proyecto: parseInt(id!), actividad: actId, cantidad: 0 });
      setShowAddModal(false);
      setAddSearchTerm('');
      fetchAll();
    } catch { alert('Error al agregar la actividad.'); }
  };

  const handleRemoveItem = async (itemId: number) => {
    try {
      await axios.delete(`${API}/budget-items/${itemId}/`);
      setBudgetItems(prev => prev.filter(i => i.id !== itemId));
    } catch { console.error('Error al eliminar ítem'); }
  };

  // ── Sub-components ────────────────────────────────────────────────────────

  const TableHeader = () => (
    <thead className="table-light">
      <tr>
        <th style={{ width: 130 }}>Código</th>
        <th>Descripción</th>
        <th className="text-center" style={{ width: 70 }}>Unidad</th>
        <th className="text-center" style={{ width: 115 }}>Cantidad</th>
        <th className="text-end" style={{ width: 110 }}>Costo Unit.</th>
        <th className="text-end" style={{ width: 130 }}>Costo Total</th>
        <th className="no-print" style={{ width: 36 }}></th>
      </tr>
    </thead>
  );

  const BudgetRow = ({ item }: { item: BudgetItem }) => {
    const qty   = parseFloat(localQty[item.id] ?? item.cantidad) || 0;
    const cu    = parseFloat(item.actividad_detail.cu_total);
    const total = qty * cu;
    const isSaving = savingId === item.id;
    return (
      <tr>
        <td className="align-middle">
          <small className={`font-monospace fw-semibold ${item.actividad_detail.es_proyecto ? 'text-warning' : 'text-primary'}`}>
            {item.actividad_detail.es_proyecto && <i className="bi bi-star-fill me-1" title="Actividad del proyecto" />}
            {item.actividad_detail.codigo_actividad}
          </small>
        </td>
        <td className="align-middle"><small>{item.actividad_detail.descripcion}</small></td>
        <td className="text-center align-middle"><small className="text-muted">{item.actividad_detail.unidad}</small></td>
        <td className="text-center align-middle">
          <div className="d-flex align-items-center justify-content-center gap-1">
            <input
              type="number"
              className="form-control form-control-sm text-center"
              style={{ width: 85 }}
              value={localQty[item.id] ?? item.cantidad}
              min="0"
              step="0.01"
              onChange={e => handleQtyChange(item.id, e.target.value)}
              onBlur={() => handleQtyBlur(item.id)}
            />
            {isSaving && <span className="spinner-border spinner-border-sm text-secondary" style={{ width: 12, height: 12, flexShrink: 0 }} />}
          </div>
        </td>
        <td className="text-end align-middle"><small>${fmt(cu)}</small></td>
        <td className="text-end align-middle">
          <strong className={total > 0 ? 'text-success' : 'text-muted'}>${fmt(total)}</strong>
        </td>
        <td className="align-middle text-center no-print">
          <button className="btn btn-link text-danger p-0" title="Quitar" onClick={() => handleRemoveItem(item.id)}>
            <i className="bi bi-x-circle" />
          </button>
        </td>
      </tr>
    );
  };

  const KitSection = ({ kit, items }: { kit: ActivityKit; items: BudgetItem[] }) => {
    const total = getGroupTotal(items);
    return (
      <div className="mb-4">
        <div className="d-flex justify-content-between align-items-center bg-warning px-3 py-2 rounded-top">
          <span className="fw-bold text-dark d-flex align-items-center gap-2">
            {kit.codigo_kit && (
              <span className="font-monospace bg-dark text-white rounded px-2 py-1 small">{kit.codigo_kit}</span>
            )}
            <i className="bi bi-box-seam" />
            {kit.nombre}
            <span className="text-muted small fw-normal">({items.length} actividades)</span>
          </span>
          <span className="fw-bold bg-white text-success px-3 py-1 rounded-pill small font-monospace">
            ${fmt(total)}
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
              {items.map(i => (
                <React.Fragment key={i.id}>{BudgetRow({ item: i })}</React.Fragment>
              ))}
            </tbody>
            <tfoot className="table-light border-top">
              <tr>
                <td colSpan={5} className="text-end fw-bold text-muted small pe-3">
                  Subtotal {kit.codigo_kit || kit.nombre}:
                </td>
                <td className="text-end fw-bold text-success font-monospace">${fmt(total)}</td>
                <td className="no-print" />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    );
  };

  const ConsolidatedRow = ({ act }: { act: ConsolidatedActivity }) => (
    <tr>
      <td className="align-middle">
        <small className="font-monospace fw-semibold text-primary">{act.codigo_actividad}</small>
      </td>
      <td className="align-middle"><small>{act.descripcion}</small></td>
      <td className="text-center align-middle"><small className="text-muted">{act.unidad}</small></td>
      <td className="text-center align-middle">
        <small className="fw-semibold">{act.cantidad % 1 === 0 ? act.cantidad.toFixed(0) : act.cantidad.toFixed(2)}</small>
      </td>
      <td className="text-end align-middle"><small>${fmt(act.cu_total)}</small></td>
      <td className="text-end align-middle">
        <strong className={act.costo_total > 0 ? 'text-success' : 'text-muted'}>${fmt(act.costo_total)}</strong>
      </td>
      <td className="no-print" />
    </tr>
  );

  const GrandTotalRow = () => (
    <div className="d-flex justify-content-end mt-1 mb-4">
      <div className="d-flex align-items-center bg-success text-white px-4 py-2 rounded shadow">
        <span className="fw-bold me-4 text-uppercase small">Total General</span>
        <span className="fw-bold fs-5 font-monospace">${fmt(grandTotal)}</span>
      </div>
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) return <div className="text-center mt-5"><div className="spinner-border text-success" /></div>;
  if (!project) return <div className="alert alert-danger m-4">Proyecto no encontrado.</div>;

  const hasBimModels = (project.bim_models?.length ?? 0) > 0;

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .navbar { display: none !important; }
          body { font-size: 11px; }
          .table th, .table td { padding: 3px 6px !important; }
        }
      `}</style>

      <div className="container-fluid py-4">

        {/* ── Header ── */}
        <div className="d-flex justify-content-between align-items-start mb-4 bg-white p-3 shadow-sm rounded border-start border-success border-4">
          <div>
            <nav aria-label="breadcrumb">
              <ol className="breadcrumb mb-1 small">
                <li className="breadcrumb-item"><Link to="/projects" className="text-decoration-none">Proyectos</Link></li>
                <li className="breadcrumb-item"><Link to={`/projects/${id}`} className="text-decoration-none">{project.nombre}</Link></li>
                <li className="breadcrumb-item active">Presupuesto</li>
              </ol>
            </nav>
            <h3 className="mb-0 fw-bold">{project.nombre}</h3>
            <p className="text-muted mb-0 small">
              Presupuesto — {viewMode === 'kits' ? 'Vista por Kits de Costos' : 'Vista por División MasterFormat'}
            </p>
          </div>
          <div className="d-flex gap-2 no-print">
            <Link to={`/projects/${id}`} className="btn btn-outline-secondary btn-sm">
              <i className="bi bi-arrow-left me-1" />Volver
            </Link>
            <button className="btn btn-outline-dark btn-sm" onClick={() => window.print()}>
              <i className="bi bi-printer me-1" />Imprimir
            </button>
          </div>
        </div>

        {/* ── Controls ── */}
        <div className="d-flex flex-wrap justify-content-between align-items-center mb-3 gap-2 no-print">
          <div className="btn-group shadow-sm">
            <button
              className={`btn btn-sm fw-bold ${viewMode === 'kits' ? 'btn-success' : 'btn-outline-success'}`}
              onClick={() => setViewMode('kits')}
            >
              <i className="bi bi-box-seam me-1" />Por Kits de Costos
            </button>
            <button
              className={`btn btn-sm fw-bold ${viewMode === 'division' ? 'btn-success' : 'btn-outline-success'}`}
              onClick={() => setViewMode('division')}
            >
              <i className="bi bi-diagram-3 me-1" />Por División MasterFormat
            </button>
          </div>

          <div className="d-flex gap-2 align-items-center">
            {!syncingIFC && syncStatus && (
              <span className="text-success small">
                <i className="bi bi-check-circle me-1" />{syncStatus}
              </span>
            )}
            <button
              className="btn btn-outline-primary btn-sm"
              onClick={handleSyncFromIFC}
              disabled={syncingIFC || !hasBimModels}
              title={!hasBimModels ? 'Carga un modelo IFC al proyecto primero' : 'Leer kits del modelo IFC y poblar el presupuesto'}
            >
              {syncingIFC
                ? <><span className="spinner-border spinner-border-sm me-1" />{syncStatus}</>
                : <><i className="bi bi-arrow-repeat me-1" />Sincronizar desde IFC</>}
            </button>
            <button
              className={`btn btn-sm fw-bold ${
                saveStatus === 'error'
                  ? 'btn-danger'
                  : hasUnsavedChanges
                  ? 'btn-warning'
                  : saveStatus === 'saved'
                  ? 'btn-outline-success'
                  : 'btn-outline-secondary'
              }`}
              onClick={handleSaveAll}
              disabled={savingAll || (!hasUnsavedChanges && saveStatus !== 'error')}
              title={
                saveStatus === 'error'
                  ? 'Error al guardar — haz clic para reintentar'
                  : hasUnsavedChanges
                  ? 'Hay cantidades sin guardar'
                  : 'El presupuesto está guardado'
              }
            >
              {savingAll ? (
                <><span className="spinner-border spinner-border-sm me-1" />Guardando…</>
              ) : saveStatus === 'saved' ? (
                <><i className="bi bi-check-circle-fill me-1" />Guardado</>
              ) : saveStatus === 'error' ? (
                <><i className="bi bi-exclamation-triangle me-1" />Error — reintentar</>
              ) : (
                <><i className="bi bi-floppy me-1" />Guardar{hasUnsavedChanges ? ' *' : ''}</>
              )}
            </button>
            <button
              className="btn btn-success btn-sm fw-bold shadow-sm"
              onClick={() => { setShowAddModal(true); setAddSearchTerm(''); }}
            >
              <i className="bi bi-plus-circle me-1" />Agregar actividad
            </button>
          </div>
        </div>

        {/* ── Grand Total Banner ── */}
        <div className="card border-0 bg-success text-white shadow mb-4">
          <div className="card-body py-3 px-4 d-flex justify-content-between align-items-center">
            <div>
              <div className="small opacity-75 text-uppercase fw-bold">Costo Total del Proyecto</div>
              <div className="display-6 fw-bold font-monospace">${fmt(grandTotal)}</div>
            </div>
            <div className="text-end opacity-75 small">
              <div>{budgetItems.length} actividades presupuestadas</div>
              <div>{viewMode === 'kits' ? `${byKit.length} kit(s)` : `${byDivision.length} divisiones`}</div>
            </div>
          </div>
        </div>

        {/* ── Empty state ── */}
        {budgetItems.length === 0 && (
          <div className="text-center py-5 no-print">
            <div className="bg-light rounded p-5 border">
              <i className="bi bi-table display-1 text-muted opacity-25" />
              <p className="mt-3 fs-5 text-muted">El presupuesto está vacío.</p>
              <p className="text-muted small mb-4">
                Usa <strong>Sincronizar desde IFC</strong> para poblar automáticamente el presupuesto
                con los kits y actividades detectados en el modelo, o agrega actividades manualmente.
              </p>
              <div className="d-flex gap-2 justify-content-center flex-wrap">
                <button
                  className="btn btn-outline-primary"
                  onClick={handleSyncFromIFC}
                  disabled={syncingIFC || !hasBimModels}
                >
                  {syncingIFC
                    ? <><span className="spinner-border spinner-border-sm me-1" />Leyendo IFC…</>
                    : <><i className="bi bi-arrow-repeat me-1" />Sincronizar desde IFC</>}
                </button>
                <button className="btn btn-success" onClick={() => setShowAddModal(true)}>
                  <i className="bi bi-plus-circle me-1" />Agregar actividad manualmente
                </button>
              </div>
              {!hasBimModels && (
                <p className="small text-muted mt-3">
                  <i className="bi bi-info-circle me-1" />
                  Para sincronizar debes <Link to={`/projects/${id}`}>cargar un modelo IFC</Link> al proyecto.
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── Vista: Por Kits ── */}
        {viewMode === 'kits' && budgetItems.length > 0 && (
          <>
            {byKit.length === 0 && orphanItems.length === 0 && (
              <div className="alert alert-info no-print">
                <i className="bi bi-info-circle me-1" />
                Las actividades del presupuesto no están vinculadas a kits.
                Usa <strong>Sincronizar desde IFC</strong> para importar actividades organizadas por kit.
              </div>
            )}

            {byKit.map(({ kit, items }) => (
              <React.Fragment key={kit.id}>{KitSection({ kit, items })}</React.Fragment>
            ))}

            {orphanItems.length > 0 && (
              <div className="mb-4">
                <div className="d-flex justify-content-between align-items-center bg-secondary text-white px-3 py-2 rounded-top">
                  <span className="fw-bold"><i className="bi bi-question-circle me-2" />Sin Kit de Costos</span>
                  <span className="fw-bold bg-white text-success px-3 py-1 rounded-pill small font-monospace">
                    ${fmt(getGroupTotal(orphanItems))}
                  </span>
                </div>
                <div className="table-responsive border border-top-0 rounded-bottom shadow-sm">
                  <table className="table table-sm table-hover mb-0">
                    <TableHeader />
                    <tbody>
                      {orphanItems.map(i => (
                        <React.Fragment key={i.id}>{BudgetRow({ item: i })}</React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <GrandTotalRow />
          </>
        )}

        {/* ── Vista: Por División ── */}
        {viewMode === 'division' && budgetItems.length > 0 && (
          <>
            <div className="alert alert-info py-2 px-3 small no-print mb-3">
              <i className="bi bi-info-circle me-1" />
              Vista de resumen — actividades con el mismo código se consolidan sumando cantidades.
              Para editar cantidades usa la vista <strong>Por Kits de Costos</strong>.
            </div>
            {byDivision.map(div => {
              const total = div.activities.reduce((s, a) => s + a.costo_total, 0);
              return (
                <div key={div.code} className="mb-4">
                  <div className="d-flex justify-content-between align-items-center bg-dark text-white px-3 py-2 rounded-top">
                    <span className="fw-bold">
                      <span className="font-monospace me-2 opacity-50">{div.code}</span>{div.name}
                    </span>
                    <span className="fw-bold bg-white text-success px-3 py-1 rounded-pill small font-monospace">
                      ${fmt(total)}
                    </span>
                  </div>
                  <div className="table-responsive border border-top-0 rounded-bottom shadow-sm">
                    <table className="table table-sm table-hover mb-0">
                      <TableHeader />
                      <tbody>
                        {div.activities.map(a => (
                          <ConsolidatedRow key={a.codigo_actividad} act={a} />
                        ))}
                      </tbody>
                      <tfoot className="table-light border-top">
                        <tr>
                          <td colSpan={5} className="text-end fw-bold text-muted small pe-3">
                            Subtotal {div.code}:
                          </td>
                          <td className="text-end fw-bold text-success font-monospace">${fmt(total)}</td>
                          <td className="no-print" />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              );
            })}
            <GrandTotalRow />
          </>
        )}

        {/* ── Modal: Agregar actividad manual ── */}
        {showAddModal && (
          <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
            <div className="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
              <div className="modal-content border-0 shadow-lg">
                <div className="modal-header bg-success text-white py-3">
                  <h5 className="modal-title fw-bold">Agregar Actividad al Presupuesto</h5>
                  <button type="button" className="btn-close btn-close-white" onClick={() => setShowAddModal(false)} />
                </div>
                <div className="modal-body p-3">
                  <div className="input-group mb-3">
                    <span className="input-group-text bg-white"><i className="bi bi-search text-muted" /></span>
                    <input
                      type="text"
                      className="form-control"
                      placeholder="Buscar por código o descripción..."
                      value={addSearchTerm}
                      onChange={e => setAddSearchTerm(e.target.value)}
                      autoFocus
                    />
                    {addSearchTerm && (
                      <button type="button" className="btn btn-outline-secondary" onClick={() => setAddSearchTerm('')}>
                        <i className="bi bi-x" />
                      </button>
                    )}
                  </div>
                  <div style={{ maxHeight: 420, overflowY: 'auto' }}>
                    <table className="table table-sm table-hover mb-0">
                      <thead className="table-dark" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                        <tr>
                          <th style={{ width: 120 }}>Código</th>
                          <th>Descripción</th>
                          <th className="text-center" style={{ width: 70 }}>Unidad</th>
                          <th className="text-end" style={{ width: 100 }}>CU Total</th>
                          <th style={{ width: 50 }} />
                        </tr>
                      </thead>
                      <tbody>
                        {availableToAdd.map(act => (
                          <tr key={act.id}>
                            <td className="align-middle">
                              <small className={`font-monospace fw-semibold ${act.es_proyecto ? 'text-warning' : 'text-primary'}`}>
                                {act.es_proyecto && <i className="bi bi-star-fill me-1" />}
                                {act.codigo_actividad}
                              </small>
                            </td>
                            <td className="align-middle"><small>{act.descripcion}</small></td>
                            <td className="text-center align-middle"><small className="text-muted">{act.unidad}</small></td>
                            <td className="text-end align-middle">
                              <small className="fw-semibold">${parseFloat(act.cu_total).toFixed(2)}</small>
                            </td>
                            <td className="align-middle text-center">
                              <button className="btn btn-success btn-sm" onClick={() => handleAddActivity(act.id)}>
                                <i className="bi bi-plus-lg" />
                              </button>
                            </td>
                          </tr>
                        ))}
                        {availableToAdd.length === 0 && (
                          <tr>
                            <td colSpan={5} className="text-center text-muted py-5">
                              <i className="bi bi-check2-circle display-6 d-block mb-2 opacity-25" />
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
                  <button type="button" className="btn btn-outline-secondary" onClick={() => setShowAddModal(false)}>
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
