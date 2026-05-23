import { useState, useEffect, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';

const API = 'http://localhost:8000/api';

interface ScheduleActivity {
  id: number;
  codigo_actividad: string;
  descripcion: string;
  fecha_inicio: string | null;
  fecha_fin: string | null;
}

interface ScheduleKit {
  id: number;
  codigo_kit: string;
  nombre: string;
  color?: string;
  fecha_inicio?: string | null;
  fecha_fin?: string | null;
  kit_actividades: ScheduleActivity[];
}

const FALLBACK_COLORS = [
  '#154b75', '#1a7a52', '#6f42c1', '#e67e22',
  '#c0392b', '#16a085', '#8e44ad', '#2980b9',
];

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b + 'T12:00:00').getTime() - new Date(a + 'T12:00:00').getTime()) / 86400000
  );
}

function fmtDate(d: string): string {
  return new Date(d + 'T12:00:00').toLocaleDateString('es', {
    day: 'numeric', month: 'short', year: '2-digit',
  });
}

function GanttBar({ start, end, projectStart, totalDays, color, height, opacity, todayPct }: {
  start: string | null; end: string | null;
  projectStart: string; totalDays: number;
  color: string; height: number; opacity: number;
  todayPct?: number;
}) {
  if (!start || !end || !projectStart || totalDays === 0) {
    return <div style={{ height, background: '#f8f9fa' }} />;
  }
  const left  = Math.max(0, (daysBetween(projectStart, start) / totalDays) * 100);
  const width = Math.max(0.4, ((daysBetween(start, end) + 1) / totalDays) * 100);
  return (
    <div style={{ position: 'relative', height, background: '#f8f9fa' }}>
      <div style={{
        position: 'absolute', left: `${left}%`, width: `${width}%`,
        top: 3, height: height - 6, borderRadius: 3,
        backgroundColor: color, opacity,
      }} title={`${start} → ${end}`} />
      {todayPct !== undefined && todayPct >= 0 && todayPct <= 100 && (
        <div style={{
          position: 'absolute', left: `${todayPct}%`,
          top: 0, bottom: 0, width: 2,
          backgroundColor: '#ef4444', opacity: 0.85, zIndex: 2,
          pointerEvents: 'none',
        }} />
      )}
    </div>
  );
}

function MonthHeaders({ projectStart, projectEnd, totalDays }: {
  projectStart: string; projectEnd: string; totalDays: number;
}) {
  const headers = useMemo(() => {
    if (!projectStart || !projectEnd || totalDays === 0) return [];
    const result: { label: string; pct: number }[] = [];
    const start = new Date(projectStart + 'T12:00:00');
    const end   = new Date(projectEnd   + 'T12:00:00');
    let cur = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cur <= end) {
      const segStart  = cur < start ? start : new Date(cur);
      const nextMonth = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      const segEnd    = nextMonth > end ? end : new Date(nextMonth.getTime() - 86400000);
      const days = Math.round((segEnd.getTime() - segStart.getTime()) / 86400000) + 1;
      result.push({
        label: cur.toLocaleDateString('es', { month: 'short', year: '2-digit' }),
        pct: (days / totalDays) * 100,
      });
      cur = nextMonth;
    }
    return result;
  }, [projectStart, projectEnd, totalDays]);

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%' }}>
      {headers.map((h, i) => (
        <div key={i} style={{
          width: `${h.pct}%`, fontSize: 10, fontWeight: 600, color: '#6c757d',
          borderRight: '1px solid #dee2e6', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden', flexShrink: 0,
        }}>
          {h.pct > 3 ? h.label : ''}
        </div>
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const GanttSection = ({ projectId, panel = false, timelineDate }: {
  projectId: string;
  panel?: boolean;
  timelineDate?: string | null;
}) => {
  const [projectKits, setProjectKits] = useState<ScheduleKit[]>([]);
  const [masterKits,  setMasterKits]  = useState<ScheduleKit[]>([]);
  const [loading, setLoading]         = useState(true);
  const [collapsed, setCollapsed]     = useState<Set<number>>(new Set());
  const initializedRef                = useRef(false);
  const rowRefs                       = useRef<Map<number, HTMLTableRowElement>>(new Map());
  const prevActiveKitRef              = useRef<number | null>(null);

  // IFC codes scanned by BimViewer and saved to sessionStorage
  const ifcCodes = useMemo<Set<string> | null>(() => {
    const raw = sessionStorage.getItem(`ifc_cronograma_codes_${projectId}`);
    if (!raw) return null;
    try { return new Set(JSON.parse(raw) as string[]); } catch { return null; }
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    Promise.all([
      axios.get(`${API}/schedule-kits/?proyecto=${projectId}`),
      axios.get(`${API}/schedule-kits/`),           // master catalog (proyecto=null)
    ]).then(([projRes, masterRes]) => {
      setProjectKits(projRes.data);
      setMasterKits(masterRes.data);
    }).finally(() => setLoading(false));
  }, [projectId]);

  // Merge: project kits + master kits whose codigo_kit appears in the IFC
  const kits = useMemo<ScheduleKit[]>(() => {
    const projectCodes = new Set(projectKits.map(k => k.codigo_kit));

    if (!ifcCodes) {
      // No IFC data yet → show project kits only
      return projectKits;
    }

    // Project kits that match IFC codes
    const projMatching = projectKits.filter(k => k.codigo_kit && ifcCodes.has(k.codigo_kit));

    // Master kits that match IFC codes and are not already covered by a project kit
    const masterMatching = masterKits.filter(
      k => k.codigo_kit && ifcCodes.has(k.codigo_kit) && !projectCodes.has(k.codigo_kit)
    );

    return [...projMatching, ...masterMatching];
  }, [projectKits, masterKits, ifcCodes]);

  const { projectStart, projectEnd, totalDays } = useMemo(() => {
    const starts = kits.flatMap(k => k.fecha_inicio ? [k.fecha_inicio] : []);
    const ends   = kits.flatMap(k => k.fecha_fin   ? [k.fecha_fin]   : []);
    if (!starts.length || !ends.length) return { projectStart: '', projectEnd: '', totalDays: 0 };
    const projectStart = starts.reduce((a, b) => (a < b ? a : b));
    const projectEnd   = ends.reduce((a, b)   => (a > b ? a : b));
    return { projectStart, projectEnd, totalDays: Math.max(1, daysBetween(projectStart, projectEnd)) };
  }, [kits]);

  // Collapse all kits by default on first load
  useEffect(() => {
    if (kits.length > 0 && !initializedRef.current) {
      initializedRef.current = true;
      setCollapsed(new Set(kits.map(k => k.id)));
    }
  }, [kits]);

  const hasDates = kits.some(k => k.fecha_inicio && k.fecha_fin);

  // Timeline position — must stay before early returns (Rules of Hooks)
  const todayPct = useMemo(() => {
    if (!timelineDate || !projectStart || totalDays === 0) return undefined;
    const pct = (daysBetween(projectStart, timelineDate) / totalDays) * 100;
    return Math.max(0, Math.min(100, pct));
  }, [timelineDate, projectStart, totalDays]);

  // Auto-scroll to the active kit row when the highlighted kit changes
  useEffect(() => {
    if (!timelineDate) { prevActiveKitRef.current = null; return; }
    const activeKit = kits.find(k =>
      k.fecha_inicio && k.fecha_fin &&
      timelineDate >= k.fecha_inicio && timelineDate <= k.fecha_fin
    );
    const activeId = activeKit?.id ?? null;
    if (activeId !== prevActiveKitRef.current) {
      prevActiveKitRef.current = activeId;
      if (activeId !== null) {
        rowRefs.current.get(activeId)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [timelineDate, kits]);

  const toggleKit = (id: number) =>
    setCollapsed(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const kitStatus = (kit: ScheduleKit): 'inprogress' | 'done' | 'pending' | 'none' => {
    if (!timelineDate || !kit.fecha_inicio || !kit.fecha_fin) return 'none';
    if (timelineDate < kit.fecha_inicio) return 'pending';
    if (timelineDate > kit.fecha_fin)    return 'done';
    return 'inprogress';
  };

  if (loading) {
    const inner = (
      <div className="text-center py-4">
        <span className="spinner-border spinner-border-sm text-primary me-2" />
        <span className="text-muted small">Cargando cronograma…</span>
      </div>
    );
    if (panel) return inner;
    return <div className="card shadow-sm border-0 mt-3"><div className="card-body">{inner}</div></div>;
  }

  if (kits.length === 0) {
    const inner = (
      <div className="text-center py-4 text-muted small">
        {ifcCodes === null ? (
          <><i className="bi bi-eye me-2" />Abra el <strong>Visor BIM</strong> para detectar los kits de cronograma.</>
        ) : (
          <><i className="bi bi-calendar-x me-2" />No se detectaron kits en el modelo IFC. <Link to={`/projects/${projectId}/schedule`}>Gestionar →</Link></>
        )}
      </div>
    );
    if (panel) return inner;
    return (
      <div className="card shadow-sm border-0 mt-3">
        <div className="card-header bg-primary text-white py-2 px-3">
          <i className="bi bi-bar-chart-steps me-2" /><span className="fw-bold small">Gantt de Cronograma</span>
        </div>
        <div className="card-body">{inner}</div>
      </div>
    );
  }

  const GANTT_COL = 480;

  const tableContent = (
    <div style={{ overflowX: 'auto' }}>
        <table className="table table-sm mb-0" style={{ minWidth: 820, tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: 120 }} />
            <col style={{ width: 200 }} />
            <col style={{ width: 90 }} />
            <col style={{ width: 90 }} />
            <col style={{ width: 55 }} />
            <col style={{ width: GANTT_COL }} />
          </colgroup>

          <thead className="table-light">
            <tr>
              <th>Código</th>
              <th>Descripción</th>
              <th>Inicio</th>
              <th>Fin</th>
              <th className="text-center">Días</th>
              <th style={{ padding: 0, borderLeft: '1px solid #dee2e6' }}>
                <div style={{ height: 33, display: 'flex', alignItems: 'center' }}>
                  {hasDates
                    ? <MonthHeaders projectStart={projectStart} projectEnd={projectEnd} totalDays={totalDays} />
                    : <span style={{ fontSize: 10, color: '#6c757d', paddingLeft: 8 }}>Línea de tiempo</span>
                  }
                </div>
              </th>
            </tr>
          </thead>

          <tbody>
            {kits.map((kit, ki) => {
              const color   = kit.color || FALLBACK_COLORS[ki % FALLBACK_COLORS.length];
              const kitDays = kit.fecha_inicio && kit.fecha_fin
                ? daysBetween(kit.fecha_inicio, kit.fecha_fin) + 1 : null;
              const isOpen  = !collapsed.has(kit.id);
              const status  = kitStatus(kit);

              const rowBg =
                status === 'inprogress' ? 'rgba(245,158,11,0.15)' :
                status === 'done'       ? 'rgba(26,122,82,0.12)'  :
                status === 'pending'    ? 'rgba(0,0,0,0.03)'      :
                `${color}14`;

              const rowBorder =
                status === 'inprogress' ? '3px solid #f59e0b' :
                status === 'done'       ? '3px solid #1a7a52' :
                'none';

              return (
                <>
                  <tr
                    key={`k-${kit.id}`}
                    ref={el => { if (el) rowRefs.current.set(kit.id, el); else rowRefs.current.delete(kit.id); }}
                    style={{ backgroundColor: rowBg, borderLeft: rowBorder }}
                  >
                    <td style={{ verticalAlign: 'middle' }}>
                      <button
                        className="btn btn-link p-0 me-1 text-decoration-none"
                        style={{ fontSize: 10, lineHeight: 1 }}
                        onClick={() => toggleKit(kit.id)}
                      >
                        <i className={`bi bi-chevron-${isOpen ? 'down' : 'right'}`} />
                      </button>
                      <span className="badge" style={{ backgroundColor: color, fontSize: 10 }}>
                        {kit.codigo_kit || '—'}
                      </span>
                      {status === 'inprogress' && (
                        <span className="ms-1" style={{ fontSize: 10, color: '#b45309', fontWeight: 600 }}>●</span>
                      )}
                      {status === 'done' && (
                        <span className="ms-1" style={{ fontSize: 10, color: '#1a7a52', fontWeight: 600 }}>✓</span>
                      )}
                    </td>
                    <td className="fw-semibold small" style={{ verticalAlign: 'middle' }}>{kit.nombre}</td>
                    <td className="small text-muted" style={{ verticalAlign: 'middle' }}>
                      {kit.fecha_inicio ? fmtDate(kit.fecha_inicio) : <span className="text-warning">—</span>}
                    </td>
                    <td className="small text-muted" style={{ verticalAlign: 'middle' }}>
                      {kit.fecha_fin ? fmtDate(kit.fecha_fin) : <span className="text-warning">—</span>}
                    </td>
                    <td className="text-center fw-bold small" style={{ verticalAlign: 'middle' }}>
                      {kitDays ?? <span className="text-warning">—</span>}
                    </td>
                    <td style={{ padding: '2px 0', borderLeft: '1px solid #dee2e6', verticalAlign: 'middle' }}>
                      <GanttBar
                        start={kit.fecha_inicio ?? null} end={kit.fecha_fin ?? null}
                        projectStart={projectStart} totalDays={totalDays}
                        color={color} height={22} opacity={0.85}
                        todayPct={todayPct}
                      />
                    </td>
                  </tr>

                  {isOpen && kit.kit_actividades.map(act => {
                    const actDays = act.fecha_inicio && act.fecha_fin
                      ? daysBetween(act.fecha_inicio, act.fecha_fin) + 1 : null;
                    return (
                      <tr key={`a-${act.id}`}>
                        <td className="ps-4 small text-muted" style={{ verticalAlign: 'middle' }}>
                          <code style={{ fontSize: 10 }}>{act.codigo_actividad}</code>
                        </td>
                        <td className="small text-muted ps-2" style={{ verticalAlign: 'middle' }}>
                          {act.descripcion}
                        </td>
                        <td className="small text-muted" style={{ verticalAlign: 'middle' }}>
                          {act.fecha_inicio ? fmtDate(act.fecha_inicio) : <span className="text-warning">—</span>}
                        </td>
                        <td className="small text-muted" style={{ verticalAlign: 'middle' }}>
                          {act.fecha_fin ? fmtDate(act.fecha_fin) : <span className="text-warning">—</span>}
                        </td>
                        <td className="text-center small text-muted" style={{ verticalAlign: 'middle' }}>
                          {actDays ?? <span className="text-warning">—</span>}
                        </td>
                        <td style={{ padding: '2px 0', borderLeft: '1px solid #dee2e6', verticalAlign: 'middle' }}>
                          <GanttBar
                            start={act.fecha_inicio} end={act.fecha_fin}
                            projectStart={projectStart} totalDays={totalDays}
                            color={color} height={18} opacity={0.55}
                            todayPct={todayPct}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </>
              );
            })}
          </tbody>
        </table>
    </div>
  );

  if (panel) return tableContent;

  return (
    <div className="card shadow-sm border-0 mt-3">
      <div className="card-header bg-primary text-white py-2 px-3 d-flex align-items-center gap-2">
        <i className="bi bi-bar-chart-steps" />
        <span className="fw-bold small flex-grow-1">Gantt de Cronograma</span>
        {hasDates ? (
          <span style={{ fontSize: 11, opacity: 0.75 }}>
            {fmtDate(projectStart)} → {fmtDate(projectEnd)} · {totalDays + 1} días
          </span>
        ) : (
          <span className="badge bg-warning text-dark" style={{ fontSize: 10 }}>
            <i className="bi bi-exclamation-triangle me-1" />Sin fechas
          </span>
        )}
        <Link to={`/projects/${projectId}/schedule`} className="btn btn-sm btn-outline-light py-0 px-2" style={{ fontSize: '0.75rem' }}>
          Gestionar →
        </Link>
      </div>
      {!hasDates && (
        <div className="alert alert-warning d-flex align-items-center gap-2 py-2 mb-0 rounded-0 border-0 border-bottom">
          <i className="bi bi-info-circle" />
          <span className="small">
            Los kits no tienen fechas. Asígnalas desde <Link to={`/projects/${projectId}/schedule`}>Cronograma</Link>.
          </span>
        </div>
      )}
      <div className="card-body p-0">{tableContent}</div>
    </div>
  );
};

export default GanttSection;
