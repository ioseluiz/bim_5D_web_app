import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as OBC from '@thatopen/components';
import * as OBF from '@thatopen/components-front';
import * as FRAGS from '@thatopen/fragments';
import * as WEBIFC from 'web-ifc';
import * as BUI from '@thatopen/ui';
import * as THREE from 'three';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ActivityKit {
  id: number;
  codigo_kit: string;
  nombre: string;
  descripcion: string;
  kit_activities: { id: number; codigo_actividad: string }[];
  proyecto?: number | null;
}

interface BudgetItemSummary {
  id: number;
  cantidad: string;
  actividad_detail: {
    cu_total: string;
    activity_kit: number | null;
  };
}

interface KitBudgetEntry {
  kit: ActivityKit;
  total: number;
  itemCount: number;
}

interface BimViewerProps {
  ifcUrl: string;
  projectId?: string | number;
  onElementSelect?: (data: { guid: string; category: string; tipo: string }) => void;
  onActiveKitIdsChange?: (kitIds: Set<number> | null) => void;
}

interface ElementProperties {
  name?: string;
  guid?: string;
  category?: string;
  type?: string;
  description?: string;
  tag?: string;
  [key: string]: string | undefined;
}

/** value → { modelId → Set<localId> } */
type PropertyIndex = Map<string, OBC.ModelIdMap>;

/** propName → PropertyIndex */
type MultiPropertyIndex = Map<string, PropertyIndex>;

/** propName → Set of selected values */
type FilterState = Record<string, Set<string>>;

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Propiedades escaneadas del IFC — el orden aquí define el scan, no la UI */
const IFC_PROPS = ['division', 'codigo_kit_actividad', 'Master Format'] as const;

const PROP_LABELS: Record<string, string> = {
  'Master Format':        'Master Format',
  'codigo_kit_actividad': 'Código Kit Actividad',
  'division':             'División',
};

const PROP_ICONS: Record<string, string> = {
  'Master Format':        '◈',
  'codigo_kit_actividad': '⬡',
  'division':             '◉',
};

const PROP_COLORS: Record<string, string> = {
  'Master Format':        '#f59e0b',
  'codigo_kit_actividad': '#38bdf8',
  'division':             '#a78bfa',
};

const KIT_COLOR  = '#10b981';
const KIT_ICON   = '⬟';
const KIT_LABEL  = 'Kit Actividades';

// ─── Attribute helpers ─────────────────────────────────────────────────────────

function extractValue(attr: unknown): string | undefined {
  if (attr === null || attr === undefined) return undefined;
  if (typeof attr === 'string' || typeof attr === 'number' || typeof attr === 'boolean')
    return String(attr);
  if (typeof attr === 'object') {
    const obj = attr as Record<string, unknown>;
    if ('value' in obj && obj.value !== null && obj.value !== undefined)
      return String(obj.value);
  }
  return undefined;
}

function mapAttributes(data: FRAGS.ItemData): ElementProperties {
  const props: ElementProperties = {};
  const n = extractValue(data.Name); if (n) props.name = n;
  const g = extractValue(data.GlobalId); if (g) props.guid = g;
  const t = extractValue((data as any).ObjectType ?? (data as any).PredefinedType); if (t) props.type = t;
  const d = extractValue((data as any).Description); if (d) props.description = d;
  const tg = extractValue((data as any).Tag); if (tg) props.tag = tg;

  const ifcTypeKey = Object.keys(data).find(
    (k) => k.startsWith('IFC') && k !== 'IfcRelContainedInSpatialStructure',
  );
  if (ifcTypeKey) {
    props.category = ifcTypeKey.replace(/^IFC/, '').replace(/_/g, ' ')
      .toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  }

  const skip = new Set(['GlobalId','Name','ObjectType','PredefinedType','Description','Tag','OwnerHistory']);
  for (const [key, val] of Object.entries(data)) {
    if (skip.has(key) || key in props) continue;
    const ex = extractValue(val);
    if (ex && ex !== 'undefined' && ex !== 'null') props[key] = ex;
  }
  return props;
}

// ─── Multi-property scanner ────────────────────────────────────────────────────
/**
 * Opens the IFC buffer with a standalone IfcAPI instance (independent from
 * ifcLoader), scans all IfcPropertySet entities once, and builds a per-property
 * index mapping each detected value to the set of element expressIDs that have it.
 * Multiple target properties are processed in a single WASM pass.
 */
async function scanProperties(
  ifcBuffer: Uint8Array,
  fragmentsModelId: string,
  targetProps: readonly string[],
  wasmPath = 'https://unpkg.com/web-ifc@0.0.77/',
): Promise<MultiPropertyIndex> {
  const result: MultiPropertyIndex = new Map();
  for (const p of targetProps) result.set(p, new Map());

  // Normalised name → original name for fast lookup
  const normalTargets = new Map(targetProps.map((p) => [p.toLowerCase().trim(), p]));

  const api = new WEBIFC.IfcAPI();
  api.SetWasmPath(wasmPath, true);
  await api.Init();

  const modelId = api.OpenModel(ifcBuffer, {
    COORDINATE_TO_ORIGIN: false,
    USE_FAST_BOOLS: true,
  });

  try {
    const getLine = (id: number): any => {
      try { return api.GetLine(modelId, id, false); } catch { return null; }
    };

    // psetId → Map<originalPropName, value>
    const psetToProps = new Map<number, Map<string, string>>();

    const psetIds = api.GetLineIDsWithType(modelId, WEBIFC.IFCPROPERTYSET);
    for (let i = 0; i < psetIds.size(); i++) {
      const psetId = psetIds.get(i);
      const pset = getLine(psetId);
      if (!pset || !Array.isArray(pset.HasProperties)) continue;

      for (const propRef of pset.HasProperties) {
        const propId: number =
          typeof propRef === 'object' && propRef !== null && 'value' in propRef
            ? propRef.value : propRef;
        if (typeof propId !== 'number') continue;

        const prop = getLine(propId);
        if (!prop) continue;

        const propName: string =
          typeof prop.Name === 'object' && prop.Name !== null
            ? String(prop.Name.value ?? '') : String(prop.Name ?? '');

        const normalName = propName.toLowerCase().trim();
        if (!normalTargets.has(normalName)) continue;
        const originalName = normalTargets.get(normalName)!;

        const rawVal =
          typeof prop.NominalValue === 'object' && prop.NominalValue !== null
            ? prop.NominalValue.value : prop.NominalValue;
        const value = rawVal !== null && rawVal !== undefined ? String(rawVal).trim() : '';
        if (!value || value === 'null' || value === 'undefined') continue;

        if (!psetToProps.has(psetId)) psetToProps.set(psetId, new Map());
        psetToProps.get(psetId)!.set(originalName, value);
      }
    }

    console.log('[BIM Scan] Psets con parámetros objetivo:', psetToProps.size);

    const relIds = api.GetLineIDsWithType(modelId, WEBIFC.IFCRELDEFINESBYPROPERTIES);
    for (let i = 0; i < relIds.size(); i++) {
      const rel = getLine(relIds.get(i));
      if (!rel) continue;

      const psetRef = rel.RelatingPropertyDefinition;
      const psetExpressId: number =
        typeof psetRef === 'object' && psetRef !== null && 'value' in psetRef
          ? psetRef.value : psetRef;

      if (!psetToProps.has(psetExpressId)) continue;
      const propsMap = psetToProps.get(psetExpressId)!;

      const relatedObjects = rel.RelatedObjects;
      if (!Array.isArray(relatedObjects)) continue;

      for (const objRef of relatedObjects) {
        const eid: number =
          typeof objRef === 'object' && objRef !== null && 'value' in objRef
            ? objRef.value : objRef;
        if (typeof eid !== 'number') continue;

        for (const [propName, value] of propsMap) {
          const propIdx = result.get(propName)!;
          if (!propIdx.has(value)) propIdx.set(value, {});
          const map = propIdx.get(value)!;
          if (!map[fragmentsModelId]) map[fragmentsModelId] = new Set<number>();
          (map[fragmentsModelId] as Set<number>).add(eid);
        }
      }
    }

    for (const [prop, idx] of result) {
      console.log(`[BIM Scan] "${prop}": ${idx.size} valores detectados`);
    }
  } finally {
    api.CloseModel(modelId);
  }

  return result;
}

// ─── Filter helpers ────────────────────────────────────────────────────────────

function unionModelIdMaps(maps: OBC.ModelIdMap[]): OBC.ModelIdMap {
  const result: OBC.ModelIdMap = {};
  for (const map of maps) {
    for (const [modelId, ids] of Object.entries(map)) {
      if (!result[modelId]) result[modelId] = new Set<number>();
      for (const id of (ids as Set<number>)) (result[modelId] as Set<number>).add(id);
    }
  }
  return result;
}

function intersectModelIdMaps(a: OBC.ModelIdMap, b: OBC.ModelIdMap): OBC.ModelIdMap {
  const result: OBC.ModelIdMap = {};
  for (const modelId of Object.keys(a)) {
    if (!b[modelId]) continue;
    const inter = new Set<number>(
      [...(a[modelId] as Set<number>)].filter((id) => (b[modelId] as Set<number>).has(id)),
    );
    if (inter.size > 0) result[modelId] = inter;
  }
  return result;
}

/**
 * Computes the ModelIdMap to isolate based on active filters.
 * - Within each property: OR (union) of all selected values.
 * - Across properties: AND (intersection).
 * - kitDerivedCodes: when kits are selected but no explicit codigo_actividad
 *   values are chosen, automatically uses the kit's activity codes.
 * Returns null when no filters are active (show all).
 */
function computeFilteredMap(
  multiIndex: MultiPropertyIndex,
  filterState: FilterState,
  kitDerivedCodes: Set<string> | null = null,
): OBC.ModelIdMap | null {
  // Effective state: apply kit-derived codes when no manual code selection
  const effective: FilterState = { ...filterState };
  if (
    kitDerivedCodes &&
    kitDerivedCodes.size > 0 &&
    (!effective['codigo_kit_actividad'] || effective['codigo_kit_actividad'].size === 0)
  ) {
    effective['codigo_kit_actividad'] = new Set(kitDerivedCodes);
  }

  const activeFilters = Object.entries(effective).filter(([, vals]) => vals.size > 0);
  if (activeFilters.length === 0) return null;

  const perPropMaps: OBC.ModelIdMap[] = [];
  for (const [propName, selectedVals] of activeFilters) {

    const propIdx = multiIndex.get(propName);
    if (!propIdx) continue;
    const toUnion: OBC.ModelIdMap[] = [];
    for (const val of selectedVals) {
      const m = propIdx.get(val);
      if (m) toUnion.push(m);
    }
    if (toUnion.length === 0) continue;
    perPropMaps.push(unionModelIdMaps(toUnion));
  }

  if (perPropMaps.length === 0) return null;
  let result = perPropMaps[0];
  for (let i = 1; i < perPropMaps.length; i++) result = intersectModelIdMaps(result, perPropMaps[i]);
  return result;
}

function countModelIdMap(map: OBC.ModelIdMap): number {
  return Object.values(map).reduce((a, s) => a + (s as Set<number>).size, 0);
}

// ─── Filter Panel ──────────────────────────────────────────────────────────────

interface FilterPanelProps {
  multiIndex: MultiPropertyIndex;
  filterState: FilterState;
  scanning: boolean;
  kits: ActivityKit[];
  selectedKitIds: Set<number>;
  kitDerivedCodes: Set<string> | null;
  onToggle: (propName: string, value: string) => void;
  onClearProp: (propName: string) => void;
  onClearAll: () => void;
  onToggleKit: (kitId: number) => void;
  onClearKits: () => void;
  onClose: () => void;
}

const FilterPanel: React.FC<FilterPanelProps> = ({
  multiIndex, filterState, scanning,
  kits, selectedKitIds, kitDerivedCodes,
  onToggle, onClearProp, onClearAll,
  onToggleKit, onClearKits, onClose,
}) => {
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => ({
    division: true, __kits__: true, codigo_kit_actividad: true, 'Master Format': true,
  }));
  const [search, setSearch] = useState<Record<string, string>>(() => ({
    division: '', __kits__: '', codigo_kit_actividad: '', 'Master Format': '',
  }));

  const totalActive =
    Object.values(filterState).reduce((a, s) => a + s.size, 0) + selectedKitIds.size;
  const totalElems = (map: OBC.ModelIdMap) =>
    Object.values(map).reduce((a, s) => a + (s as Set<number>).size, 0);
  const toggleExpand = (p: string) => setExpanded((e) => ({ ...e, [p]: !e[p] }));

  /** Renders an IFC property section */
  const renderPropSection = (propName: string) => {
    const propIdx = multiIndex.get(propName);
    const color = PROP_COLORS[propName];
    const icon = PROP_ICONS[propName];
    const label = PROP_LABELS[propName];
    const selected = filterState[propName] ?? new Set<string>();
    const isExpanded = expanded[propName] ?? true;
    const q = search[propName] ?? '';

    // For codigo_actividad: restrict visible entries when kits are selected
    const entries = propIdx
      ? [...propIdx.entries()]
          .filter(([v]) => {
            if (propName === 'codigo_kit_actividad' && kitDerivedCodes && kitDerivedCodes.size > 0) {
              if (!kitDerivedCodes.has(v)) return false;
            }
            return v.toLowerCase().includes(q.toLowerCase());
          })
          .sort(([a], [b]) => a.localeCompare(b))
      : [];
    const activeCount = selected.size;

    return (
      <div key={propName} style={fpSt.section}>
        <div
          style={{ ...fpSt.sectionHeader, borderLeftColor: color }}
          onClick={() => toggleExpand(propName)}
        >
          <span style={{ ...fpSt.sectionIcon, color }}>{icon}</span>
          <span style={{ ...fpSt.sectionLabel, color }}>{label}</span>
          {activeCount > 0 && (
            <span style={{ ...fpSt.activeBadge, backgroundColor: `${color}28`, color }}>
              {activeCount}
            </span>
          )}
          <div style={{ flex: 1 }} />
          {propIdx && propIdx.size > 0 && (
            <span style={fpSt.totalCount}>
              {propName === 'codigo_kit_actividad' && kitDerivedCodes
                ? `${entries.length}/${propIdx.size}`
                : propIdx.size}
            </span>
          )}
          {activeCount > 0 && (
            <button
              style={fpSt.clearPropBtn}
              onClick={(e) => { e.stopPropagation(); onClearProp(propName); }}
              title={`Limpiar ${label}`}
            >✕</button>
          )}
          <span style={{ ...fpSt.chevron, transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)' }}>
            ▾
          </span>
        </div>
        {isExpanded && (
          <div>
            {!propIdx || propIdx.size === 0 ? (
              <div style={fpSt.emptySection}>No detectado en el modelo</div>
            ) : entries.length === 0 && !q ? (
              <div style={fpSt.emptySection}>
                Sin actividades del kit seleccionado en el modelo
              </div>
            ) : (
              <>
                {/* Show kit restriction notice */}
                {propName === 'codigo_kit_actividad' && kitDerivedCodes && kitDerivedCodes.size > 0 && (
                  <div style={fpSt.kitNotice}>
                    <span style={{ color: KIT_COLOR }}>{KIT_ICON}</span>
                    {' '}Filtrado por kit seleccionado
                  </div>
                )}
                {(propIdx.size > 6 || (propName === 'codigo_kit_actividad' && entries.length > 6)) && (
                  <div style={fpSt.searchWrap}>
                    <input
                      style={fpSt.searchInput}
                      placeholder={`Buscar en ${label}…`}
                      value={q}
                      onChange={(e) => setSearch((s) => ({ ...s, [propName]: e.target.value }))}
                    />
                  </div>
                )}
                <div style={fpSt.valueList}>
                  {entries.map(([value, map]) => {
                    const isActive = selected.has(value);
                    return (
                      <label
                        key={value}
                        style={{
                          ...fpSt.valueRow,
                          ...(isActive ? { backgroundColor: `${color}10`, borderLeftColor: color } : {}),
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isActive}
                          onChange={() => onToggle(propName, value)}
                          style={{ display: 'none' }}
                        />
                        <span style={{
                          ...fpSt.checkbox,
                          ...(isActive ? { backgroundColor: color, borderColor: color, color: '#0f1117' } : {}),
                        }}>
                          {isActive ? '✓' : ''}
                        </span>
                        <span style={{ ...fpSt.valueLabel, ...(isActive ? { color: '#e2e8f0' } : {}) }} title={value}>
                          {value}
                        </span>
                        <span style={{
                          ...fpSt.valueBadge,
                          ...(isActive ? { backgroundColor: `${color}28`, color } : {}),
                        }}>
                          {totalElems(map)}
                        </span>
                      </label>
                    );
                  })}
                  {entries.length === 0 && q && (
                    <div style={fpSt.noResults}>Sin resultados para "{q}"</div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  /** Renders the Kit Actividades section (API-based, not IFC) */
  const renderKitsSection = () => {
    const isExpanded = expanded['__kits__'] ?? true;
    const q = search['__kits__'] ?? '';
    const filteredKits = kits.filter(k =>
      k.nombre.toLowerCase().includes(q.toLowerCase()) ||
      (k.codigo_kit?.toLowerCase() ?? '').includes(q.toLowerCase()),
    );
    const activeCount = selectedKitIds.size;

    return (
      <div style={fpSt.section}>
        <div
          style={{ ...fpSt.sectionHeader, borderLeftColor: KIT_COLOR }}
          onClick={() => toggleExpand('__kits__')}
        >
          <span style={{ ...fpSt.sectionIcon, color: KIT_COLOR }}>{KIT_ICON}</span>
          <span style={{ ...fpSt.sectionLabel, color: KIT_COLOR }}>{KIT_LABEL}</span>
          {activeCount > 0 && (
            <span style={{ ...fpSt.activeBadge, backgroundColor: `${KIT_COLOR}28`, color: KIT_COLOR }}>
              {activeCount}
            </span>
          )}
          <div style={{ flex: 1 }} />
          {kits.length > 0 && <span style={fpSt.totalCount}>{kits.length}</span>}
          {activeCount > 0 && (
            <button
              style={fpSt.clearPropBtn}
              onClick={(e) => { e.stopPropagation(); onClearKits(); }}
              title="Limpiar kits"
            >✕</button>
          )}
          <span style={{ ...fpSt.chevron, transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)' }}>
            ▾
          </span>
        </div>
        {isExpanded && (
          <div>
            {kits.length === 0 ? (
              <div style={fpSt.emptySection}>No hay kits para este proyecto</div>
            ) : (
              <>
                {kits.length > 6 && (
                  <div style={fpSt.searchWrap}>
                    <input
                      style={fpSt.searchInput}
                      placeholder="Buscar kit…"
                      value={q}
                      onChange={(e) => setSearch((s) => ({ ...s, '__kits__': e.target.value }))}
                    />
                  </div>
                )}
                <div style={fpSt.valueList}>
                  {filteredKits.map(kit => {
                    const isActive = selectedKitIds.has(kit.id);
                    const isProject = kit.proyecto != null;
                    return (
                      <label
                        key={kit.id}
                        style={{
                          ...fpSt.valueRow,
                          ...(isActive ? { backgroundColor: `${KIT_COLOR}10`, borderLeftColor: KIT_COLOR } : {}),
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isActive}
                          onChange={() => onToggleKit(kit.id)}
                          style={{ display: 'none' }}
                        />
                        <span style={{
                          ...fpSt.checkbox,
                          ...(isActive ? { backgroundColor: KIT_COLOR, borderColor: KIT_COLOR, color: '#0f1117' } : {}),
                        }}>
                          {isActive ? '✓' : ''}
                        </span>
                        <span
                          style={{ ...fpSt.valueLabel, ...(isActive ? { color: '#e2e8f0' } : {}), whiteSpace: 'normal', lineHeight: 1.3 }}
                          title={`${kit.codigo_kit ? kit.codigo_kit + ' — ' : ''}${kit.nombre}`}
                        >
                          {isProject && <span style={{ color: '#f59e0b', marginRight: 3 }}>★</span>}
                          <span style={{ display: 'block', fontFamily: '"IBM Plex Mono",monospace', fontWeight: 700, fontSize: 10, color: isActive ? KIT_COLOR : '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {kit.codigo_kit || kit.nombre}
                          </span>
                          {kit.codigo_kit && (
                            <span style={{ display: 'block', fontSize: 9, color: isActive ? '#94a3b8' : '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {kit.nombre}
                            </span>
                          )}
                        </span>
                        <span style={{
                          ...fpSt.valueBadge,
                          ...(isActive ? { backgroundColor: `${KIT_COLOR}28`, color: KIT_COLOR } : {}),
                        }}>
                          {kit.kit_activities.length}
                        </span>
                      </label>
                    );
                  })}
                  {filteredKits.length === 0 && q && (
                    <div style={fpSt.noResults}>Sin resultados para "{q}"</div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={fpSt.container}>
      {/* Header */}
      <div style={fpSt.header}>
        <div style={fpSt.headerLeft}>
          <span style={fpSt.headerIcon}>⬡</span>
          <div>
            <div style={fpSt.headerTitle}>Filtros BIM</div>
            <div style={fpSt.headerSub}>
              {scanning
                ? 'Escaneando parámetros…'
                : totalActive > 0
                  ? `${totalActive} filtro${totalActive > 1 ? 's' : ''} activo${totalActive > 1 ? 's' : ''}`
                  : 'Sin filtros activos'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {totalActive > 0 && (
            <button style={fpSt.clearAllBtn} onClick={onClearAll} title="Limpiar todos los filtros">
              Limpiar todo
            </button>
          )}
          <button style={fpSt.closeBtn} onClick={onClose} title="Minimizar">—</button>
        </div>
      </div>

      {/* Body — orden: División → Kit → Código Actividad → Master Format */}
      <div style={fpSt.body}>
        {scanning && (
          <div style={fpSt.scanningWrap}>
            <div style={fpSt.spinner} />
            <span style={fpSt.scanningText}>Leyendo IfcPropertySets…</span>
          </div>
        )}
        {!scanning && (
          <>
            {renderPropSection('division')}
            {renderKitsSection()}
            {renderPropSection('codigo_kit_actividad')}
            {renderPropSection('Master Format')}
          </>
        )}
      </div>
    </div>
  );
};

// ─── Properties Panel ──────────────────────────────────────────────────────────

interface PropertiesPanelProps {
  properties: ElementProperties | null;
  loading: boolean;
  onClose: () => void;
}

const PropertiesPanel: React.FC<PropertiesPanelProps> = ({ properties, loading, onClose }) => {
  const MAIN: Array<keyof ElementProperties> = ['name','guid','category','type','description','tag'];
  const mainProps = MAIN.filter((k) => properties?.[k]);
  const extraKeys = properties
    ? Object.keys(properties).filter((k) => !MAIN.includes(k as any) && properties[k])
    : [];
  const labels: Record<string, string> = {
    name:'Nombre', guid:'GUID', category:'Categoría', type:'Tipo', description:'Descripción', tag:'Etiqueta',
  };

  return (
    <div style={propSt.container}>
      <div style={propSt.header}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:16, color:'#38bdf8' }}>⬡</span>
          <span style={propSt.headerText}>Propiedades</span>
        </div>
        <button style={propSt.closeBtn} onClick={onClose}>✕</button>
      </div>
      <div style={propSt.body}>
        {loading && (
          <div style={{ display:'flex', alignItems:'center', gap:10, padding:'20px 16px' }}>
            <div style={propSt.dot} />
            <span style={{ fontSize:12, color:'#64748b' }}>Cargando atributos…</span>
          </div>
        )}
        {!loading && !properties && (
          <div style={{ display:'flex',flexDirection:'column',alignItems:'center',padding:'28px 20px',gap:12,textAlign:'center' }}>
            <span style={{ fontSize:28, opacity:0.5 }}>🖱️</span>
            <p style={{ fontSize:12, color:'#475569', lineHeight:1.6, margin:0 }}>
              Haz clic en un elemento del modelo para ver sus propiedades.
            </p>
          </div>
        )}
        {!loading && properties && (
          <>
            <div style={propSt.section}>
              <div style={propSt.sectionLabel}>Información General</div>
              {mainProps.map((k) => (
                <div style={propSt.row} key={k}>
                  <span style={propSt.rowLabel}>{labels[k] ?? k}</span>
                  <span style={{ ...propSt.rowValue, ...(k==='guid'?{fontSize:'9.5px',color:'#94a3b8'}:{}) }} title={properties[k]}>
                    {properties[k]}
                  </span>
                </div>
              ))}
            </div>
            {extraKeys.length > 0 && (
              <div style={propSt.section}>
                <div style={propSt.sectionLabel}>Otros Atributos</div>
                {extraKeys.map((k) => (
                  <div style={propSt.row} key={k}>
                    <span style={propSt.rowLabel}>{k}</span>
                    <span style={propSt.rowValue} title={properties[k]}>{properties[k]}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

// ─── Styles ────────────────────────────────────────────────────────────────────

// ─── Budget Panel ──────────────────────────────────────────────────────────────

const fmtCur = (n: number) =>
  n.toLocaleString('es-PA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface BudgetPanelProps {
  entries: KitBudgetEntry[];
  activeBudgetKitIds: Set<number> | null;
  loading: boolean;
  onClose: () => void;
}

const BudgetPanel: React.FC<BudgetPanelProps> = ({
  entries, activeBudgetKitIds, loading, onClose,
}) => {
  const isFiltered = activeBudgetKitIds !== null && activeBudgetKitIds.size > 0;
  const activeEntries = isFiltered
    ? entries.filter(e => activeBudgetKitIds!.has(e.kit.id))
    : entries;
  const filteredTotal = activeEntries.reduce((s, e) => s + e.total, 0);
  const allTotal      = entries.reduce((s, e) => s + e.total, 0);

  return (
    <div style={bdgSt.container}>
      <div style={bdgSt.header}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ color:'#10b981', fontSize:16, fontWeight:700, lineHeight:1 }}>$</span>
          <div>
            <div style={bdgSt.headerTitle}>Presupuesto</div>
            <div style={bdgSt.headerSub}>
              {isFiltered
                ? `${activeEntries.length} de ${entries.length} kits seleccionados`
                : `${entries.length} kit${entries.length !== 1 ? 's' : ''}`}
            </div>
          </div>
        </div>
        <button style={bdgSt.closeBtn} onClick={onClose} title="Minimizar">—</button>
      </div>

      <div style={bdgSt.body}>
        {loading ? (
          <div style={{ padding:'20px 14px', fontSize:11, color:'#64748b', textAlign:'center' }}>
            <div style={{ width:18, height:18, borderRadius:'50%', border:'2px solid rgba(148,163,184,0.2)', borderTopColor:'#10b981', animation:'spin 0.8s linear infinite', margin:'0 auto 8px' }} />
            Cargando presupuesto…
          </div>
        ) : entries.length === 0 ? (
          <div style={{ padding:'20px 14px', fontSize:10, color:'#475569', textAlign:'center', fontStyle:'italic' }}>
            No hay presupuesto definido para este proyecto
          </div>
        ) : (
          entries.map(({ kit, total, itemCount }) => {
            const isActive = !isFiltered || activeBudgetKitIds!.has(kit.id);
            return (
              <div key={kit.id} style={{ ...bdgSt.kitRow, opacity: isActive ? 1 : 0.2 }}>
                <div style={{ display:'flex', alignItems:'center', gap:5, flex:1, minWidth:0 }}>
                  {kit.codigo_kit && (
                    <span style={{
                      ...bdgSt.kitCode,
                      ...(isActive ? {} : { color:'#475569', borderColor:'rgba(71,85,105,0.3)', backgroundColor:'rgba(71,85,105,0.1)' }),
                    }}>
                      {kit.codigo_kit}
                    </span>
                  )}
                  <div style={{ minWidth:0 }}>
                    <div style={{ ...bdgSt.kitName, color: isActive ? '#cbd5e1' : '#475569' }} title={kit.nombre}>
                      {kit.nombre}
                    </div>
                    <div style={{ fontSize:9, color:'#475569' }}>
                      {itemCount} actividad{itemCount !== 1 ? 'es' : ''}
                    </div>
                  </div>
                </div>
                <div style={{ ...bdgSt.kitTotal, color: isActive ? '#10b981' : '#334155' }}>
                  ${fmtCur(total)}
                </div>
              </div>
            );
          })
        )}
      </div>

      {entries.length > 0 && (
        <div style={bdgSt.footer}>
          {isFiltered ? (
            <>
              <div style={bdgSt.footerLabel}>Subtotal filtrado</div>
              <div style={bdgSt.footerTotal}>${fmtCur(filteredTotal)}</div>
              <div style={{ marginTop:5, paddingTop:5, borderTop:'1px solid rgba(255,255,255,0.06)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <span style={{ fontSize:9, color:'#475569' }}>Total proyecto</span>
                <span style={{ fontSize:10, color:'#475569', fontFamily:'"IBM Plex Mono",monospace' }}>
                  ${fmtCur(allTotal)}
                </span>
              </div>
            </>
          ) : (
            <>
              <div style={bdgSt.footerLabel}>Total general</div>
              <div style={bdgSt.footerTotal}>${fmtCur(allTotal)}</div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

const BASE: React.CSSProperties = {
  backgroundColor:'rgba(15,17,23,0.93)', backdropFilter:'blur(12px)',
  borderRadius:'10px', border:'1px solid rgba(255,255,255,0.08)',
  boxShadow:'0 8px 32px rgba(0,0,0,0.5)', fontFamily:'"IBM Plex Mono","Fira Code",monospace',
  color:'#e2e8f0', display:'flex', flexDirection:'column', overflow:'hidden',
};

const fpSt: Record<string, React.CSSProperties> = {
  container:    { ...BASE, position:'absolute', top:'16px', right:'16px', width:'280px', maxHeight:'calc(100% - 32px)', zIndex:1000 },
  header:       { display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 14px', borderBottom:'1px solid rgba(255,255,255,0.07)', backgroundColor:'rgba(255,255,255,0.03)', flexShrink:0 },
  headerLeft:   { display:'flex', alignItems:'center', gap:10 },
  headerIcon:   { fontSize:18, color:'#94a3b8' },
  headerTitle:  { fontSize:11, fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', color:'#94a3b8' },
  headerSub:    { fontSize:10, color:'#64748b', marginTop:2 },
  closeBtn:     { background:'none', border:'none', color:'#64748b', cursor:'pointer', fontSize:16, padding:'2px 5px', borderRadius:4, lineHeight:1 },
  clearAllBtn:  { background:'rgba(239,68,68,0.12)', border:'1px solid rgba(239,68,68,0.25)', color:'#f87171', cursor:'pointer', fontSize:9, padding:'3px 7px', borderRadius:4, fontFamily:'inherit', letterSpacing:'0.05em' },
  body:         { overflowY:'auto', flex:1 },
  scanningWrap: { display:'flex', flexDirection:'column', alignItems:'center', padding:'24px 16px', gap:12 },
  spinner:      { width:22, height:22, borderRadius:'50%', border:'2px solid rgba(148,163,184,0.2)', borderTopColor:'#94a3b8', animation:'spin 0.8s linear infinite' },
  scanningText: { fontSize:11, color:'#64748b', textAlign:'center' },
  section:      { borderBottom:'1px solid rgba(255,255,255,0.05)' },
  sectionHeader:{ display:'flex', alignItems:'center', gap:7, padding:'9px 12px 9px 10px', cursor:'pointer', userSelect:'none', borderLeft:'2px solid', transition:'background 0.12s' },
  sectionIcon:  { fontSize:13, flexShrink:0 },
  sectionLabel: { fontSize:10, fontWeight:700, letterSpacing:'0.12em', textTransform:'uppercase', flex:0 },
  activeBadge:  { fontSize:9, padding:'1px 5px', borderRadius:8, fontWeight:700, marginLeft:4 },
  totalCount:   { fontSize:9, color:'#475569', marginRight:2 },
  clearPropBtn: { background:'none', border:'none', color:'#475569', cursor:'pointer', fontSize:10, padding:'1px 4px', lineHeight:1, borderRadius:3 },
  chevron:      { fontSize:11, color:'#475569', transition:'transform 0.15s', marginLeft:2, flexShrink:0 },
  emptySection: { padding:'8px 14px 10px', fontSize:10, color:'#475569', fontStyle:'italic' },
  searchWrap:   { padding:'5px 10px 6px', borderBottom:'1px solid rgba(255,255,255,0.04)' },
  searchInput:  { width:'100%', boxSizing:'border-box', background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.09)', borderRadius:5, color:'#e2e8f0', fontSize:10, padding:'4px 7px', outline:'none', fontFamily:'inherit' },
  valueList:    { maxHeight:200, overflowY:'auto' },
  valueRow:     { display:'flex', alignItems:'center', gap:8, padding:'6px 12px', cursor:'pointer', borderLeft:'2px solid transparent', transition:'background 0.1s' },
  checkbox:     { flexShrink:0, width:13, height:13, borderRadius:3, border:'1px solid rgba(255,255,255,0.18)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:9, fontWeight:700 },
  valueLabel:   { flex:1, fontSize:10, color:'#64748b', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' },
  valueBadge:   { flexShrink:0, fontSize:9, backgroundColor:'rgba(255,255,255,0.06)', color:'#475569', padding:'1px 5px', borderRadius:8, minWidth:18, textAlign:'center' },
  noResults:    { padding:'8px 12px', fontSize:10, color:'#475569' },
  kitNotice:    { padding:'4px 12px 3px', fontSize:9, color:'#64748b', borderBottom:'1px solid rgba(16,185,129,0.12)', backgroundColor:'rgba(16,185,129,0.04)' },
};

const propSt: Record<string, React.CSSProperties> = {
  container:    { ...BASE, position:'absolute', bottom:'16px', left:'16px', width:300, maxHeight:'calc(100% - 32px)', zIndex:1000 },
  header:       { display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 14px', borderBottom:'1px solid rgba(255,255,255,0.07)', backgroundColor:'rgba(255,255,255,0.03)', flexShrink:0 },
  headerText:   { fontSize:11, fontWeight:700, letterSpacing:'0.12em', textTransform:'uppercase', color:'#94a3b8' },
  closeBtn:     { background:'none', border:'none', color:'#64748b', cursor:'pointer', fontSize:13, padding:'2px 4px', borderRadius:4, lineHeight:1 },
  body:         { overflowY:'auto', flex:1, padding:'10px 0' },
  dot:          { width:8, height:8, borderRadius:'50%', backgroundColor:'#38bdf8', display:'inline-block' },
  section:      { padding:'0 0 4px 0', marginBottom:4 },
  sectionLabel: { fontSize:9, fontWeight:700, letterSpacing:'0.15em', textTransform:'uppercase', color:'#38bdf8', padding:'8px 14px 6px', borderBottom:'1px solid rgba(56,189,248,0.12)', marginBottom:4 },
  row:          { display:'flex', padding:'5px 14px', gap:8, alignItems:'flex-start' },
  rowLabel:     { fontSize:11, color:'#64748b', minWidth:90, flexShrink:0, paddingTop:1 },
  rowValue:     { fontSize:11, color:'#e2e8f0', wordBreak:'break-all', flex:1, lineHeight:1.5 },
};

const bdgSt: Record<string, React.CSSProperties> = {
  container:   { ...BASE, position:'absolute', bottom:'16px', right:'16px', width:270, maxHeight:'calc(48% - 16px)', zIndex:1000 },
  header:      { display:'flex', alignItems:'center', justifyContent:'space-between', padding:'11px 14px', borderBottom:'1px solid rgba(255,255,255,0.07)', backgroundColor:'rgba(255,255,255,0.03)', flexShrink:0 },
  headerTitle: { fontSize:11, fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', color:'#94a3b8' },
  headerSub:   { fontSize:10, color:'#64748b', marginTop:2 },
  closeBtn:    { background:'none', border:'none', color:'#64748b', cursor:'pointer', fontSize:16, padding:'2px 5px', borderRadius:4, lineHeight:1 },
  body:        { overflowY:'auto', flex:1 },
  kitRow:      { display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, padding:'7px 12px', borderBottom:'1px solid rgba(255,255,255,0.04)', transition:'opacity 0.2s' },
  kitCode:     { flexShrink:0, fontSize:9, backgroundColor:'rgba(16,185,129,0.12)', color:'#10b981', border:'1px solid rgba(16,185,129,0.2)', borderRadius:3, padding:'1px 5px', fontFamily:'"IBM Plex Mono",monospace', fontWeight:700 },
  kitName:     { fontSize:10, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' },
  kitTotal:    { flexShrink:0, fontSize:10, fontFamily:'"IBM Plex Mono",monospace', fontWeight:600 },
  footer:      { padding:'10px 14px', borderTop:'1px solid rgba(255,255,255,0.08)', backgroundColor:'rgba(16,185,129,0.05)', flexShrink:0 },
  footerLabel: { fontSize:9, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:3 },
  footerTotal: { fontSize:15, fontWeight:700, color:'#10b981', fontFamily:'"IBM Plex Mono",monospace' },
};

// ─── Main BimViewer ────────────────────────────────────────────────────────────

const EMPTY_FILTER_STATE = (): FilterState =>
  Object.fromEntries(IFC_PROPS.map((p) => [p, new Set<string>()]));

const BimViewer: React.FC<BimViewerProps> = ({ ifcUrl, projectId, onElementSelect, onActiveKitIdsChange }) => {
  const containerRef  = useRef<HTMLDivElement>(null);
  const componentsRef = useRef<OBC.Components | null>(null);
  const hiderRef      = useRef<OBC.Hider | null>(null);
  const multiIndexRef = useRef<MultiPropertyIndex>(new Map());

  const [selectedProperties, setSelectedProperties] = useState<ElementProperties | null>(null);
  const [loadingProps,  setLoadingProps]  = useState(false);
  const [propPanelVis,  setPropPanelVis]  = useState(true);
  const [filterPanelVis, setFilterPanelVis] = useState(true);
  const [multiIndex,    setMultiIndex]    = useState<MultiPropertyIndex>(new Map());
  const [scanning,      setScanning]      = useState(false);
  const [filterState,   setFilterState]   = useState<FilterState>(EMPTY_FILTER_STATE);

  // Kit filter state
  const [kits,            setKits]            = useState<ActivityKit[]>([]);
  const [selectedKitIds,  setSelectedKitIds]  = useState<Set<number>>(new Set());
  const [kitDerivedCodes, setKitDerivedCodes] = useState<Set<string> | null>(null);


  const onElementSelectRef = useRef(onElementSelect);
  useEffect(() => { onElementSelectRef.current = onElementSelect; }, [onElementSelect]);

  // Fetch kits from API when projectId changes
  useEffect(() => {
    if (!projectId) return;
    const load = async () => {
      try {
        const [masterRes, projectRes] = await Promise.all([
          fetch('http://localhost:8000/api/activity-kits/').then(r => r.json()),
          fetch(`http://localhost:8000/api/activity-kits/?proyecto=${projectId}`).then(r => r.json()),
        ]);
        setKits([
          ...(masterRes as ActivityKit[]),
          ...(projectRes as ActivityKit[]),
        ]);
      } catch (err) {
        console.error('[BIM] Error cargando kits:', err);
      }
    };
    load();
  }, [projectId]);

  // ── Apply filter whenever filterState, multiIndex, or kitDerivedCodes changes
  useEffect(() => {
    const hider = hiderRef.current;
    if (!hider) return;
    const filtered = computeFilteredMap(multiIndex, filterState, kitDerivedCodes);
    (async () => {
      if (filtered === null) {
        await hider.set(true);
      } else {
        await hider.isolate(filtered);
      }
    })();
  }, [filterState, multiIndex, kitDerivedCodes]);

  // ── Filter handlers ──────────────────────────────────────────────────────
  const handleToggle = useCallback((propName: string, value: string) => {
    setFilterState((prev) => {
      const next = { ...prev };
      const s = new Set(prev[propName] ?? new Set<string>());
      if (s.has(value)) s.delete(value); else s.add(value);
      next[propName] = s;
      return next;
    });
  }, []);

  const handleClearProp = useCallback((propName: string) => {
    setFilterState((prev) => ({ ...prev, [propName]: new Set<string>() }));
  }, []);

  const handleClearAll = useCallback(() => {
    setFilterState(EMPTY_FILTER_STATE());
    setSelectedKitIds(new Set());
    setKitDerivedCodes(null);
  }, []);

  // ── Kit filter handlers ──────────────────────────────────────────────────
  const handleToggleKit = (kitId: number) => {
    setSelectedKitIds(prev => {
      const next = new Set(prev);
      if (next.has(kitId)) next.delete(kitId); else next.add(kitId);
      // Derive kit codes — these are the values stamped as codigo_kit_actividad in the IFC model
      const codes = new Set<string>();
      kits.filter(k => next.has(k.id) && k.codigo_kit).forEach(k => codes.add(k.codigo_kit));
      setKitDerivedCodes(next.size > 0 ? codes : null);
      return next;
    });
    // Clear manual selection so kit drives the filter
    setFilterState(prev => ({ ...prev, 'codigo_kit_actividad': new Set<string>() }));
  };

  const handleClearKits = () => {
    setSelectedKitIds(new Set());
    setKitDerivedCodes(null);
    setFilterState(prev => ({ ...prev, 'codigo_kit_actividad': new Set<string>() }));
  };

  // ── Budget filter computed ────────────────────────────────────────────────

  const activeBudgetKitIds = useMemo((): Set<number> | null => {
    if (selectedKitIds.size > 0) return selectedKitIds;
    const selectedCodes = filterState['codigo_kit_actividad'];
    if (selectedCodes && selectedCodes.size > 0) {
      const ids = new Set<number>();
      kits.forEach(k => { if (k.codigo_kit && selectedCodes.has(k.codigo_kit)) ids.add(k.id); });
      return ids;
    }
    return null;
  }, [selectedKitIds, filterState, kits]);

  useEffect(() => {
    onActiveKitIdsChange?.(activeBudgetKitIds);
  }, [activeBudgetKitIds]);

  // ── Setup ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    BUI.Manager.init();
    const components = new OBC.Components();
    componentsRef.current = components;

    const worlds = components.get(OBC.Worlds);
    const world  = worlds.create<OBC.SimpleScene, OBC.SimpleCamera, OBC.SimpleRenderer>();
    world.scene    = new OBC.SimpleScene(components);
    world.renderer = new OBC.SimpleRenderer(components, container);
    world.camera   = new OBC.SimpleCamera(components);
    world.scene.setup();
    components.init();

    world.scene.three.background = new THREE.Color(0xcccccc);
    if (world.renderer instanceof OBC.SimpleRenderer) world.renderer.showLogo = false;

    const fragments = components.get(OBC.FragmentsManager);
    const ifcLoader = components.get(OBC.IfcLoader);
    const grids     = components.get(OBC.Grids);
    const grid      = grids.create(world);
    const hider     = components.get(OBC.Hider);
    hiderRef.current = hider;

    components.get(OBC.Raycasters).get(world);

    const highlighter = components.get(OBF.Highlighter);
    highlighter.setup({
      world,
      selectMaterialDefinition: {
        color: new THREE.Color('#2563eb'),
        opacity: 1, transparent: false, renderedFaces: 0,
      },
    });

    highlighter.events.select.onHighlight.add(async (modelIdMap) => {
      setPropPanelVis(true);
      setLoadingProps(true);
      setSelectedProperties(null);
      try {
        const promises: Promise<FRAGS.ItemData[]>[] = [];
        for (const [modelId, localIds] of Object.entries(modelIdMap)) {
          const model = fragments.list.get(modelId);
          if (model) promises.push(model.getItemsData([...localIds]));
        }
        const first = (await Promise.all(promises)).flat()[0];
        if (first) {
          const props = mapAttributes(first);
          setSelectedProperties(props);
          onElementSelectRef.current?.({ guid: props.guid ?? '', category: props.category ?? '', tipo: props.type ?? '' });
        }
      } catch (e) { console.error(e); }
      finally { setLoadingProps(false); }
    });

    highlighter.events.select.onClear.add(() => setSelectedProperties(null));

    // Gear panel
    const panel = BUI.Component.create<BUI.Panel>(() => BUI.html`
      <bim-panel label="Controles del Visor" class="options-menu">
        <bim-panel-section label="Escena">
          <bim-color-input label="Color de Fondo" color="#cccccc"
            @input="${({ target }: { target: any }) => {
              world.scene.config.backgroundColor = new THREE.Color(target.color);
            }}">
          </bim-color-input>
          <bim-number-input slider step="0.1" label="Intensidad Luz" value="1.5" min="0.1" max="10"
            @change="${({ target }: { target: any }) => {
              world.scene.config.directionalIntensity = target.value;
            }}">
          </bim-number-input>
          <bim-checkbox label="Rejilla Visible" checked
            @change="${({ target }: { target: any }) => { grid.visible = target.value; }}">
          </bim-checkbox>
        </bim-panel-section>
      </bim-panel>
    `);
    panel.style.cssText = 'position:absolute;top:50px;right:10px;width:280px;z-index:1002;display:none';

    const toggleButton = document.createElement('button');
    toggleButton.innerHTML = '⚙️';
    Object.assign(toggleButton.style, {
      position:'absolute', top:'10px', right:'10px', zIndex:'1003',
      padding:'8px', borderRadius:'4px', border:'none',
      backgroundColor:'rgba(255,255,255,0.7)', cursor:'pointer',
    });
    toggleButton.onclick = () => {
      const hidden = panel.style.display === 'none';
      panel.style.display = hidden ? 'block' : 'none';
      toggleButton.style.backgroundColor = hidden ? 'white' : 'rgba(255,255,255,0.7)';
    };
    if (container.parentElement) container.parentElement.append(panel, toggleButton);

    // ── Load IFC ─────────────────────────────────────────────────────────
    const loadModel = async () => {
      try {
        const workerUrl = await OBC.FragmentsManager.getWorker();
        fragments.init(workerUrl);

        world.camera.controls.addEventListener('update', () => fragments.core.update());
        world.onCameraChanged.add((camera) => {
          for (const [, model] of fragments.list) model.useCamera(camera.three);
          fragments.core.update(true);
        });
        fragments.list.onItemSet.add(({ value: model }) => {
          if (world.camera.three) model.useCamera(world.camera.three);
          world.scene.three.add(model.object);
          fragments.core.update(true);
        });

        await ifcLoader.setup({
          autoSetWasm: false,
          wasm: { path: 'https://unpkg.com/web-ifc@0.0.77/', absolute: true },
        });

        const response = await fetch(ifcUrl);
        if (!response.ok) throw new Error('Error al descargar IFC');
        const rawBuffer = await response.arrayBuffer();
        const buffer = new Uint8Array(rawBuffer);

        await ifcLoader.load(buffer, false, 'BIM-Model');

        if (world.camera instanceof OBC.SimpleCamera) {
          await world.camera.controls.setLookAt(68, 23, -8.5, 21.5, -5.5, 23);
        }

        // ── Scan all target properties ────────────────────────────────────
        setScanning(true);
        setFilterPanelVis(true);

        try {
          const [fragmentsModelId] = [...fragments.list.keys()];
          if (!fragmentsModelId) throw new Error('No hay modelo cargado en fragments.list');

          const bufferCopy = new Uint8Array(rawBuffer.slice(0));

          const idx = await scanProperties(
            bufferCopy,
            fragmentsModelId,
            IFC_PROPS,
            'https://unpkg.com/web-ifc@0.0.77/',
          );

          multiIndexRef.current = idx;
          setMultiIndex(new Map(idx));
        } catch (scanErr) {
          console.error('[BIM Scan] Error durante el escaneo:', scanErr);
        } finally {
          setScanning(false);
        }
      } catch (err) {
        console.error('Error cargando el modelo:', err);
        setScanning(false);
      }
    };

    loadModel();

    return () => {
      panel.remove();
      toggleButton.remove();
      componentsRef.current?.dispose();
      componentsRef.current = null;
    };
  }, [ifcUrl]);

  // ── Status bar summary ───────────────────────────────────────────────────
  const activeFilterParts = [
    ...IFC_PROPS
      .filter((p) => (filterState[p]?.size ?? 0) > 0)
      .map((p) => `${PROP_LABELS[p]} (${filterState[p].size})`),
    ...(selectedKitIds.size > 0 ? [`${KIT_LABEL} (${selectedKitIds.size})`] : []),
  ];

  const filteredMap = computeFilteredMap(multiIndex, filterState, kitDerivedCodes);

  const totalActiveCount =
    IFC_PROPS.reduce((a, p) => a + (filterState[p]?.size ?? 0), 0) + selectedKitIds.size;

  const statusText = activeFilterParts.length > 0
    ? `Filtrando: ${activeFilterParts.join(' · ')} → ${filteredMap ? countModelIdMap(filteredMap) : 0} elementos`
    : 'Clic en elemento para propiedades · Selecciona parámetros para filtrar';

  return (
    <div className="w-100 h-100 position-relative" style={{ minHeight:'600px', overflow:'hidden' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <div ref={containerRef} className="w-100 h-100" style={{ backgroundColor:'#cccccc' }} />

      {/* Filter panel */}
      {filterPanelVis ? (
        <FilterPanel
          multiIndex={multiIndex}
          filterState={filterState}
          scanning={scanning}
          kits={kits}
          selectedKitIds={selectedKitIds}
          kitDerivedCodes={kitDerivedCodes}
          onToggle={handleToggle}
          onClearProp={handleClearProp}
          onClearAll={handleClearAll}
          onToggleKit={handleToggleKit}
          onClearKits={handleClearKits}
          onClose={() => setFilterPanelVis(false)}
        />
      ) : (
        <button
          onClick={() => setFilterPanelVis(true)}
          style={{
            position:'absolute', top:'16px', right:'16px', zIndex:1000,
            background:'rgba(15,17,23,0.85)', border:'1px solid rgba(255,255,255,0.1)',
            borderRadius:'8px', color:'#94a3b8', cursor:'pointer',
            padding:'8px 12px', fontSize:13, backdropFilter:'blur(8px)',
            fontFamily:'"IBM Plex Mono",monospace',
          }}
        >
          ⬡ Filtros BIM
          {totalActiveCount > 0 && (
            <span style={{
              marginLeft:6, backgroundColor:'#38bdf8', color:'#0f1117',
              borderRadius:8, fontSize:10, padding:'1px 6px', fontWeight:700,
            }}>
              {totalActiveCount}
            </span>
          )}
        </button>
      )}

      {/* Properties panel */}
      {propPanelVis ? (
        <PropertiesPanel
          properties={selectedProperties}
          loading={loadingProps}
          onClose={() => { setSelectedProperties(null); setPropPanelVis(false); }}
        />
      ) : (
        <button
          onClick={() => setPropPanelVis(true)}
          style={{
            position:'absolute', bottom:'16px', left:'16px', zIndex:1000,
            background:'rgba(15,17,23,0.85)', border:'1px solid rgba(255,255,255,0.1)',
            borderRadius:'8px', color:'#38bdf8', cursor:'pointer',
            padding:'8px 12px', fontSize:13, backdropFilter:'blur(8px)',
            fontFamily:'"IBM Plex Mono",monospace',
          }}
        >⬡ Propiedades</button>
      )}

      {/* Status bar */}
      <div style={{
        position:'absolute', bottom:'16px', left:'50%', transform:'translateX(-50%)',
        backgroundColor:'rgba(15,17,23,0.7)', color:'#94a3b8', fontSize:11,
        padding:'5px 12px', borderRadius:20, backdropFilter:'blur(8px)',
        pointerEvents:'none', fontFamily:'"IBM Plex Mono",monospace',
        letterSpacing:'0.05em', zIndex:999, whiteSpace:'nowrap',
        maxWidth:'60%', overflow:'hidden', textOverflow:'ellipsis',
      }}>
        {statusText}
      </div>
    </div>
  );
};

export default BimViewer;
