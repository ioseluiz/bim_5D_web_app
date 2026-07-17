import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as OBC from '@thatopen/components';
import * as OBF from '@thatopen/components-front';
import * as FRAGS from '@thatopen/fragments';
import * as WEBIFC from 'web-ifc';
import * as BUI from '@thatopen/ui';
import * as THREE from 'three';
import api from '../api';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ActivityKit {
  id: number;
  codigo_kit: string;
  nombre: string;
  descripcion: string;
  color?: string;
  kit_activities: { id: number; codigo_actividad: string; descripcion: string }[];
  proyecto?: number | null;
}

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
  nombre?: string;
  color?: string;
  fecha_inicio?: string | null;
  fecha_fin?: string | null;
  kit_actividades?: ScheduleActivity[];
}

interface IFCActivity {
  id: number;
  codigo_actividad: string;
  descripcion: string;
  kitId: number;
  kitCode: string;
}

interface BimViewerProps {
  ifcUrl: string;
  projectId?: string | number;
  onElementSelect?: (data: { guid: string; category: string; tipo: string }) => void;
  onActiveKitIdsChange?: (kitIds: Set<number> | null) => void;
  onTimelineUpdate?: (date: string | null) => void;
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
const IFC_PROPS = ['division', 'codigo_kit_actividad', 'codigo_cronograma', 'Master Format'] as const;

const PROP_LABELS: Record<string, string> = {
  'Master Format':        'Master Format',
  'codigo_kit_actividad': 'Código Kit Costo',
  'codigo_cronograma':    'Código Kit Cronograma',
  'division':             'División',
};

const PROP_ICONS: Record<string, string> = {
  'Master Format':        '◈',
  'codigo_kit_actividad': '⬡',
  'codigo_cronograma':    '◷',
  'division':             '◉',
};

const PROP_COLORS: Record<string, string> = {
  'Master Format':        '#f59e0b',
  'codigo_kit_actividad': '#38bdf8',
  'codigo_cronograma':    '#22c55e',
  'division':             '#a78bfa',
};

const KIT_COLOR  = '#10b981';
const KIT_ICON   = '⬟';
const KIT_LABEL  = 'Actividades';

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
  const normalTargets = new Map(targetProps.map((p) => [p.toLowerCase().trim().replace(/\s+/g, '_'), p]));

  const api = new WEBIFC.IfcAPI();
  api.SetWasmPath(wasmPath, true);
  await api.Init();

  const modelId = api.OpenModel(ifcBuffer, {
    COORDINATE_TO_ORIGIN: false,
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

        const normalName = propName.toLowerCase().trim().replace(/\s+/g, '_');
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

/**
 * Scans IFC entity types (Revit category) and ObjectType attribute (Revit family)
 * for every physical element found via IfcRelContainedInSpatialStructure.
 * Injects results as '__ifc_category__' and '__revit_family__' into a MultiPropertyIndex.
 */
async function scanEntityTypes(
  ifcBuffer: Uint8Array,
  fragmentsModelId: string,
  wasmPath = 'https://unpkg.com/web-ifc@0.0.77/',
): Promise<MultiPropertyIndex> {
  const categoryIdx: PropertyIndex = new Map();
  const familyIdx:   PropertyIndex = new Map();
  const result: MultiPropertyIndex = new Map([
    ['__ifc_category__', categoryIdx],
    ['__revit_family__',  familyIdx],
  ]);

  // Build numeric-type → label map from WEBIFC constants
  const typeNameMap: Record<number, string> = {};
  for (const [key, value] of Object.entries(WEBIFC)) {
    if (typeof value === 'number') {
      typeNameMap[value] = key.replace(/^IFC/, '').replace(/_/g, ' ')
        .toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
    }
  }

  const ifcApi = new WEBIFC.IfcAPI();
  ifcApi.SetWasmPath(wasmPath, true);
  await ifcApi.Init();

  const modelId = ifcApi.OpenModel(ifcBuffer, { COORDINATE_TO_ORIGIN: false });

  try {
    const getLine = (id: number): any => {
      try { return ifcApi.GetLine(modelId, id, false); } catch { return null; }
    };

    const addToIdx = (idx: PropertyIndex, label: string, eid: number) => {
      if (!idx.has(label)) idx.set(label, {});
      const m = idx.get(label)!;
      if (!m[fragmentsModelId]) m[fragmentsModelId] = new Set<number>();
      (m[fragmentsModelId] as Set<number>).add(eid);
    };

    const relIds = ifcApi.GetLineIDsWithType(modelId, WEBIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE);
    for (let i = 0; i < relIds.size(); i++) {
      const rel = getLine(relIds.get(i));
      if (!rel || !Array.isArray(rel.RelatedElements)) continue;

      for (const ref of rel.RelatedElements) {
        const eid: number = typeof ref === 'object' && ref !== null && 'value' in ref ? ref.value : ref;
        if (typeof eid !== 'number') continue;

        const elem = getLine(eid);
        if (!elem) continue;

        // Category from IFC entity type
        const typeLabel = typeof elem.type === 'number' ? typeNameMap[elem.type] : undefined;
        if (typeLabel) addToIdx(categoryIdx, typeLabel, eid);

        // Family from ObjectType attribute
        const rawOT = elem.ObjectType;
        const familyVal = typeof rawOT === 'object' && rawOT !== null && 'value' in rawOT
          ? String(rawOT.value ?? '') : String(rawOT ?? '');
        const family = familyVal.trim();
        if (family && family !== 'null' && family !== 'undefined' && family !== '') {
          addToIdx(familyIdx, family, eid);
        }
      }
    }

    console.log(`[BIM Scan] '__ifc_category__': ${categoryIdx.size} categorías`);
    console.log(`[BIM Scan] '__revit_family__': ${familyIdx.size} familias`);
  } finally {
    ifcApi.CloseModel(modelId);
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
 * - derivedCodes: codes derived from selected activities; intersected with manual
 *   codigo_kit_actividad selection when both are active.
 * Returns null when no filters are active (show all).
 */
function computeFilteredMap(
  multiIndex: MultiPropertyIndex,
  filterState: FilterState,
  derivedCodes: Set<string> | null = null,
): OBC.ModelIdMap | null {
  const effective: FilterState = { ...filterState };
  if (derivedCodes && derivedCodes.size > 0) {
    const manualCodes = effective['codigo_kit_actividad'];
    if (!manualCodes || manualCodes.size === 0) {
      effective['codigo_kit_actividad'] = new Set(derivedCodes);
    } else {
      // Both active: intersect so the model shows only elements matching both constraints
      effective['codigo_kit_actividad'] = new Set([...manualCodes].filter(c => derivedCodes.has(c)));
    }
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

// ─── Timeline helpers ─────────────────────────────────────────────────────────

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmtDateES(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('es', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b + 'T12:00:00').getTime() - new Date(a + 'T12:00:00').getTime()) / 86400000,
  );
}

// ─── Filter Panel ──────────────────────────────────────────────────────────────

interface FilterPanelProps {
  multiIndex: MultiPropertyIndex;
  filterState: FilterState;
  scanning: boolean;
  ifcActivities: IFCActivity[];
  selectedActivityIds: Set<number>;
  activityKitCodes: Set<string>;
  kitColorMap: Record<string, string>;
  colorByKit: boolean;
  scheduleKitColorMap: Record<string, string>;
  colorByCronKit: boolean;
  onToggle: (propName: string, value: string) => void;
  onClearProp: (propName: string) => void;
  onClearAll: () => void;
  onToggleActivity: (actId: number) => void;
  onClearActivities: () => void;
  onToggleColorByKit: () => void;
  onToggleColorByCronKit: () => void;
  onClose: () => void;
}

const FilterPanel: React.FC<FilterPanelProps> = ({
  multiIndex, filterState, scanning,
  ifcActivities, selectedActivityIds, activityKitCodes,
  kitColorMap, colorByKit,
  scheduleKitColorMap, colorByCronKit,
  onToggle, onClearProp, onClearAll,
  onToggleActivity, onClearActivities,
  onToggleColorByKit, onToggleColorByCronKit, onClose,
}) => {
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => ({
    division: true, codigo_kit_actividad: true, codigo_cronograma: true, __activities__: true, 'Master Format': true,
  }));
  const [search, setSearch] = useState<Record<string, string>>(() => ({
    division: '', codigo_kit_actividad: '', codigo_cronograma: '', __activities__: '', 'Master Format': '',
  }));

  const totalActive =
    Object.values(filterState).reduce((a, s) => a + s.size, 0) + selectedActivityIds.size;
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

    // For codigo_kit_actividad: restrict visible entries when activities are selected
    const entries = propIdx
      ? [...propIdx.entries()]
          .filter(([v]) => {
            if (propName === 'codigo_kit_actividad' && activityKitCodes.size > 0) {
              if (!activityKitCodes.has(v)) return false;
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
              {propName === 'codigo_kit_actividad' && activityKitCodes.size > 0
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
          {propName === 'codigo_kit_actividad' && propIdx && propIdx.size > 0 && (
            <button
              style={{
                background: colorByKit ? 'rgba(56,189,248,0.15)' : 'none',
                border: colorByKit ? '1px solid rgba(56,189,248,0.4)' : '1px solid rgba(255,255,255,0.08)',
                color: colorByKit ? '#38bdf8' : '#64748b',
                borderRadius: 4, fontSize: 11, padding: '1px 5px',
                cursor: 'pointer', marginRight: 2, lineHeight: 1,
              }}
              onClick={(e) => { e.stopPropagation(); onToggleColorByKit(); }}
              title={colorByKit ? 'Desactivar colores de kit' : 'Colorear objetos por kit'}
            >
              🎨
            </button>
          )}
          {propName === 'codigo_cronograma' && propIdx && propIdx.size > 0 && (
            <button
              style={{
                background: colorByCronKit ? 'rgba(34,197,94,0.15)' : 'none',
                border: colorByCronKit ? '1px solid rgba(34,197,94,0.4)' : '1px solid rgba(255,255,255,0.08)',
                color: colorByCronKit ? '#22c55e' : '#64748b',
                borderRadius: 4, fontSize: 11, padding: '1px 5px',
                cursor: 'pointer', marginRight: 2, lineHeight: 1,
              }}
              onClick={(e) => { e.stopPropagation(); onToggleColorByCronKit(); }}
              title={colorByCronKit ? 'Desactivar colores de kit cronograma' : 'Colorear objetos por kit cronograma'}
            >
              🎨
            </button>
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
                Sin códigos para las actividades seleccionadas
              </div>
            ) : (
              <>
                {propName === 'codigo_kit_actividad' && activityKitCodes.size > 0 && (
                  <div style={fpSt.kitNotice}>
                    <span style={{ color: KIT_COLOR }}>{KIT_ICON}</span>
                    {' '}Filtrado por actividades seleccionadas
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
                        {propName === 'codigo_kit_actividad' && kitColorMap[value] && (
                          <span style={{
                            width: 8, height: 8, borderRadius: '50%',
                            backgroundColor: kitColorMap[value],
                            flexShrink: 0, display: 'inline-block',
                            border: '1px solid rgba(255,255,255,0.15)',
                            marginRight: 2,
                          }} />
                        )}
                        {propName === 'codigo_cronograma' && scheduleKitColorMap[value] && (
                          <span style={{
                            width: 8, height: 8, borderRadius: '50%',
                            backgroundColor: scheduleKitColorMap[value],
                            flexShrink: 0, display: 'inline-block',
                            border: '1px solid rgba(255,255,255,0.15)',
                            marginRight: 2,
                          }} />
                        )}
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

  /** Renders the Actividades section — activities from kits present in the IFC model */
  const renderActivitiesSection = () => {
    const isExpanded = expanded['__activities__'] ?? true;
    const q = search['__activities__'] ?? '';
    const activeCount = selectedActivityIds.size;

    // Restrict visible activities by codes selected in codigo_kit_actividad
    const selectedCodes = filterState['codigo_kit_actividad'] ?? new Set<string>();
    const visibleActivities = ifcActivities.filter(act => {
      if (selectedCodes.size > 0 && !selectedCodes.has(act.kitCode)) return false;
      return act.descripcion.toLowerCase().includes(q.toLowerCase()) ||
             act.codigo_actividad.toLowerCase().includes(q.toLowerCase());
    });

    return (
      <div style={fpSt.section}>
        <div
          style={{ ...fpSt.sectionHeader, borderLeftColor: KIT_COLOR }}
          onClick={() => toggleExpand('__activities__')}
        >
          <span style={{ ...fpSt.sectionIcon, color: KIT_COLOR }}>{KIT_ICON}</span>
          <span style={{ ...fpSt.sectionLabel, color: KIT_COLOR }}>{KIT_LABEL}</span>
          {activeCount > 0 && (
            <span style={{ ...fpSt.activeBadge, backgroundColor: `${KIT_COLOR}28`, color: KIT_COLOR }}>
              {activeCount}
            </span>
          )}
          <div style={{ flex: 1 }} />
          {ifcActivities.length > 0 && (
            <span style={fpSt.totalCount}>
              {selectedCodes.size > 0
                ? `${visibleActivities.length}/${ifcActivities.length}`
                : ifcActivities.length}
            </span>
          )}
          {activeCount > 0 && (
            <button
              style={fpSt.clearPropBtn}
              onClick={(e) => { e.stopPropagation(); onClearActivities(); }}
              title="Limpiar actividades"
            >✕</button>
          )}
          <span style={{ ...fpSt.chevron, transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)' }}>
            ▾
          </span>
        </div>
        {isExpanded && (
          <div>
            {ifcActivities.length === 0 ? (
              <div style={fpSt.emptySection}>No hay actividades en los kits del modelo</div>
            ) : visibleActivities.length === 0 && !q ? (
              <div style={fpSt.emptySection}>Sin actividades para los códigos seleccionados</div>
            ) : (
              <>
                {selectedCodes.size > 0 && (
                  <div style={fpSt.kitNotice}>
                    <span style={{ color: '#38bdf8' }}>⬡</span>
                    {' '}Filtrado por código kit seleccionado
                  </div>
                )}
                {ifcActivities.length > 6 && (
                  <div style={fpSt.searchWrap}>
                    <input
                      style={fpSt.searchInput}
                      placeholder="Buscar actividad…"
                      value={q}
                      onChange={(e) => setSearch((s) => ({ ...s, '__activities__': e.target.value }))}
                    />
                  </div>
                )}
                <div style={fpSt.valueList}>
                  {visibleActivities.map(act => {
                    const isActive = selectedActivityIds.has(act.id);
                    return (
                      <label
                        key={act.id}
                        style={{
                          ...fpSt.valueRow,
                          ...(isActive ? { backgroundColor: `${KIT_COLOR}10`, borderLeftColor: KIT_COLOR } : {}),
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isActive}
                          onChange={() => onToggleActivity(act.id)}
                          style={{ display: 'none' }}
                        />
                        <span style={{
                          ...fpSt.checkbox,
                          ...(isActive ? { backgroundColor: KIT_COLOR, borderColor: KIT_COLOR, color: '#0f1117' } : {}),
                        }}>
                          {isActive ? '✓' : ''}
                        </span>
                        <span style={{ ...fpSt.valueLabel, ...(isActive ? { color: '#e2e8f0' } : {}) }} title={`${act.codigo_actividad} — ${act.descripcion}`}>
                          {act.descripcion || act.codigo_actividad}
                        </span>
                        <span style={{
                          ...fpSt.valueBadge,
                          fontSize: 8,
                          backgroundColor: isActive ? `${KIT_COLOR}28` : 'rgba(56,189,248,0.15)',
                          color: isActive ? KIT_COLOR : '#38bdf8',
                        }}>
                          {act.kitCode}
                        </span>
                      </label>
                    );
                  })}
                  {visibleActivities.length === 0 && q && (
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

      {/* Body — orden: Código Kit Costo → Actividades → Código Kit Cronograma → División → Master Format */}
      <div style={fpSt.body}>
        {scanning && (
          <div style={fpSt.scanningWrap}>
            <div style={fpSt.spinner} />
            <span style={fpSt.scanningText}>Leyendo IfcPropertySets…</span>
          </div>
        )}
        {!scanning && (
          <>
            {renderPropSection('codigo_kit_actividad')}
            {renderActivitiesSection()}
            {renderPropSection('codigo_cronograma')}
            {renderPropSection('division')}
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

// ─── Measure Panel ─────────────────────────────────────────────────────────────

interface MeasurePanelProps {
  activeTool: 'length' | 'area' | 'volume' | null;
  onToggle: (tool: 'length' | 'area' | 'volume') => void;
  onClear: () => void;
  onClose: () => void;
}

const MEASURE_TOOLS = [
  { id: 'length' as const, icon: '📏', label: 'Longitud',  color: '#f59e0b', hint: 'Doble clic: punto inicial → punto final · Enter para finalizar' },
  { id: 'area'   as const, icon: '⬜', label: 'Área',      color: '#38bdf8', hint: 'Doble clic: vértices del polígono · Enter para cerrar' },
  { id: 'volume' as const, icon: '⬛', label: 'Volumen',   color: '#a78bfa', hint: 'Doble clic: seleccionar elemento · Enter para confirmar · Esc para cancelar' },
];

const MeasurePanel: React.FC<MeasurePanelProps> = ({ activeTool, onToggle, onClear, onClose }) => (
  <div style={mSt.container}>
    <div style={mSt.header}>
      <span style={mSt.headerTitle}>⬢ Medición</span>
      <button style={mSt.closeBtn} onClick={onClose} title="Minimizar">—</button>
    </div>
    {MEASURE_TOOLS.map(({ id, icon, label, color, hint }) => {
      const isActive = activeTool === id;
      return (
        <div key={id}>
          <button
            style={{ ...mSt.toolBtn, ...(isActive ? { backgroundColor: `${color}18`, borderColor: `${color}50` } : {}) }}
            onClick={() => onToggle(id)}
            title={hint}
          >
            <span style={{ fontSize: 14 }}>{icon}</span>
            <span style={{ ...mSt.toolLabel, ...(isActive ? { color, fontWeight: 700 } : {}) }}>{label}</span>
            {isActive && <span style={{ ...mSt.activeDot, backgroundColor: color }} />}
          </button>
          {isActive && <div style={{ ...mSt.hint, color }}>{hint}</div>}
        </div>
      );
    })}
    {activeTool && (
      <button style={mSt.clearBtn} onClick={onClear} title="Limpiar todas las mediciones">
        ✕ Limpiar mediciones
      </button>
    )}
  </div>
);

const mSt: Record<string, React.CSSProperties> = {
  container: { ...BASE, position: 'absolute', top: '50%', left: '16px', transform: 'translateY(-50%)', width: 195, zIndex: 1001 },
  header:    { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px 9px', borderBottom: '1px solid rgba(255,255,255,0.07)', backgroundColor: 'rgba(255,255,255,0.03)', flexShrink: 0 },
  headerTitle: { fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: '#94a3b8' },
  closeBtn:  { background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 16, padding: '2px 5px', borderRadius: 4, lineHeight: 1 },
  toolBtn:   { display: 'flex', alignItems: 'center', gap: 8, width: 'calc(100% - 12px)', background: 'none', border: '1px solid transparent', borderRadius: 6, padding: '7px 10px', cursor: 'pointer', fontFamily: '"IBM Plex Mono",monospace', margin: '4px 6px 0', transition: 'background 0.15s, border-color 0.15s' },
  toolLabel: { flex: 1, fontSize: 11, color: '#94a3b8', transition: 'color 0.15s', textAlign: 'left' as const },
  activeDot: { width: 6, height: 6, borderRadius: '50%', flexShrink: 0 },
  hint:      { fontSize: 9, padding: '2px 12px 5px 28px', lineHeight: 1.5, fontFamily: '"IBM Plex Mono",monospace', opacity: 0.85 },
  clearBtn:  { display: 'block', width: 'calc(100% - 12px)', margin: '6px 6px 8px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171', borderRadius: 6, padding: '5px 8px', cursor: 'pointer', fontSize: 10, fontFamily: '"IBM Plex Mono",monospace' },
};

// ─── Timeline Panel ────────────────────────────────────────────────────────────

interface TimelinePanelProps {
  dateRange: { start: string; end: string } | null;
  currentDate: string;
  playing: boolean;
  duration: number;
  kits: ScheduleKit[];
  multiIndex: MultiPropertyIndex;
  doneColorMode: 'kit' | 'original' | 'uniform';
  doneUniformColor: string;
  recordingState: 'idle' | 'recording' | 'converting';
  onDateChange: (date: string) => void;
  onTogglePlay: () => void;
  onStop: () => void;
  onDurationChange: (secs: number) => void;
  onDoneColorModeChange: (mode: 'kit' | 'original' | 'uniform') => void;
  onDoneUniformColorChange: (color: string) => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onClose: () => void;
  hiddenKitCodes: Set<string>;
  onToggleHiddenKit: (code: string) => void;
  hiddenCategories: Set<string>;
  onToggleHiddenCategory: (cat: string) => void;
}

const DURATIONS = [
  { secs: 10,  label: '10s'  },
  { secs: 30,  label: '30s'  },
  { secs: 60,  label: '1min' },
  { secs: 120, label: '2min' },
  { secs: 300, label: '5min' },
];

const TICK_MS = 200;

const TimelinePanel: React.FC<TimelinePanelProps> = ({
  dateRange, currentDate, playing, duration, kits, multiIndex,
  doneColorMode, doneUniformColor, recordingState,
  onDateChange, onTogglePlay, onStop, onDurationChange,
  onDoneColorModeChange, onDoneUniformColorChange,
  onStartRecording, onStopRecording, onClose,
  hiddenKitCodes, onToggleHiddenKit,
  hiddenCategories, onToggleHiddenCategory,
}) => {
  const [collapsed, setCollapsed] = React.useState(false);

  // Auto-collapse when playback starts so the animation is visible
  React.useEffect(() => {
    if (playing) setCollapsed(true);
  }, [playing]);

  if (!dateRange || !currentDate) {
    return (
      <div style={tlSt.container}>
        <div style={tlSt.header}>
          <span style={tlSt.headerTitle}>◷ TIMELINER</span>
          <button style={tlSt.closeBtn} onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: '14px', fontSize: 11, color: '#64748b', textAlign: 'center' }}>
          Sin kits de cronograma con fechas detectadas en el modelo.
        </div>
      </div>
    );
  }

  const totalDays = Math.max(1, daysBetween(dateRange.start, dateRange.end));
  const elapsed   = Math.max(0, daysBetween(dateRange.start, currentDate));
  const progress  = Math.min(100, Math.round((elapsed / totalDays) * 100));
  const sliderVal = Math.max(0, Math.min(totalDays, elapsed));

  const kitCodeIdx = multiIndex.get('codigo_cronograma');
  const ifcKits    = kits.filter(k => k.codigo_kit && kitCodeIdx?.has(k.codigo_kit));

  const completed  = ifcKits.filter(k => k.fecha_fin   && currentDate > k.fecha_fin);
  const inProgress = ifcKits.filter(k => k.fecha_inicio && k.fecha_fin && currentDate >= k.fecha_inicio && currentDate <= k.fecha_fin);
  const notStarted = ifcKits.filter(k => k.fecha_inicio && currentDate < k.fecha_inicio);
  const todayStart    = ifcKits.filter(k => k.fecha_inicio === currentDate);
  const todayComplete = ifcKits.filter(k => k.fecha_fin    === currentDate);

  if (collapsed) {
    return (
      <div style={tlSt.container}>
        <div style={tlSt.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#f59e0b', fontSize: 15 }}>◷</span>
            <span style={tlSt.headerTitle}>TIMELINER</span>
            <span style={tlSt.headerSub}>{fmtDateES(dateRange.start)} → {fmtDateES(dateRange.end)}</span>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button style={tlSt.collapseBtn} onClick={() => setCollapsed(false)} title="Expandir panel">▼</button>
            <button style={tlSt.closeBtn} onClick={onClose} title="Cerrar timeliner">✕</button>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px 8px' }}>
          <button style={tlSt.ctrlBtn} onClick={onStop} title="Reiniciar">⏮</button>
          <button
            style={{ ...tlSt.ctrlBtn, ...(playing ? tlSt.pauseBtn : tlSt.playBtn) }}
            onClick={onTogglePlay}
            title={playing ? 'Pausar' : 'Reproducir'}
          >
            {playing ? '⏸' : '▶'}
          </button>
          <span style={tlSt.dateLabel}>{fmtDateES(currentDate)}</span>
          <span style={tlSt.progressPct}>{progress}%</span>
          <input
            type="range"
            min={0}
            max={totalDays}
            value={sliderVal}
            onChange={e => onDateChange(addDays(dateRange.start, Number(e.target.value)))}
            style={{ ...tlSt.slider, flex: 1 }}
          />
        </div>
        <div style={tlSt.progressBarWrap}>
          <div style={{ ...tlSt.progressFill, width: `${progress}%` }} />
        </div>
      </div>
    );
  }

  return (
    <div style={tlSt.container}>
      {/* Header */}
      <div style={tlSt.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#f59e0b', fontSize: 15 }}>◷</span>
          <span style={tlSt.headerTitle}>TIMELINER</span>
          <span style={tlSt.headerSub}>{fmtDateES(dateRange.start)} → {fmtDateES(dateRange.end)}</span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button style={tlSt.collapseBtn} onClick={() => setCollapsed(true)} title="Colapsar panel">▲</button>
          <button style={tlSt.closeBtn} onClick={onClose} title="Cerrar timeliner">✕</button>
        </div>
      </div>

      {/* Controls row */}
      <div style={tlSt.controlsRow}>
        {/* Playback buttons */}
        <div style={{ display: 'flex', gap: 4 }}>
          <button style={tlSt.ctrlBtn} onClick={onStop} title="Reiniciar al inicio">⏮</button>
          <button
            style={{ ...tlSt.ctrlBtn, ...(playing ? tlSt.pauseBtn : tlSt.playBtn) }}
            onClick={onTogglePlay}
            title={playing ? 'Pausar' : 'Reproducir'}
          >
            {playing ? '⏸' : '▶'}
          </button>
        </div>

        {/* Current date + progress */}
        <div style={{ flex: 1 }}>
          <span style={tlSt.dateLabel}>{fmtDateES(currentDate)}</span>
          <span style={tlSt.progressPct}>{progress}% · día {elapsed}/{totalDays}</span>
        </div>

        {/* Duration selector */}
        <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
          <span style={{ fontSize: 9, color: '#475569', marginRight: 2, letterSpacing: '0.08em' }}>DUR</span>
          {DURATIONS.map(({ secs, label }) => (
            <button
              key={secs}
              style={{ ...tlSt.speedBtn, ...(duration === secs ? tlSt.speedBtnActive : {}) }}
              onClick={() => onDurationChange(secs)}
            >
              {label}
            </button>
          ))}
          <input
            type="number"
            min={1}
            max={3600}
            value={duration}
            onChange={e => {
              const v = Math.max(1, Math.min(3600, Number(e.target.value)));
              if (!isNaN(v)) onDurationChange(v);
            }}
            style={tlSt.durationInput}
            title="Duración total en segundos"
          />
          <span style={{ fontSize: 9, color: '#475569' }}>s</span>
        </div>
      </div>

      {/* Computed info: días/tick + duración real */}
      {dateRange && (() => {
        const totalDays = Math.max(1, daysBetween(dateRange.start, dateRange.end));
        const totalTicks = (duration * 1000) / TICK_MS;
        const dpt = Math.max(1, Math.ceil(totalDays / totalTicks));
        const realSecs = Math.round((totalDays / dpt) * TICK_MS / 1000);
        const realLabel = realSecs < 60 ? `${realSecs}s` : `${Math.round(realSecs / 60)}min`;
        return (
          <div style={tlSt.durationInfo}>
            {dpt} día{dpt !== 1 ? 's' : ''}/tick · duración real ~{realLabel} · {totalDays} días totales
          </div>
        );
      })()}

      {/* Slider */}
      <div style={tlSt.sliderRow}>
        <span style={tlSt.sliderEdge}>{dateRange.start.slice(0, 7)}</span>
        <input
          type="range"
          min={0}
          max={totalDays}
          value={sliderVal}
          onChange={e => onDateChange(addDays(dateRange.start, Number(e.target.value)))}
          style={tlSt.slider}
        />
        <span style={tlSt.sliderEdge}>{dateRange.end.slice(0, 7)}</span>
      </div>

      {/* Progress bar */}
      <div style={tlSt.progressBarWrap}>
        <div style={{ ...tlSt.progressFill, width: `${progress}%` }} />
      </div>

      {/* Scrollable section: color mode + toggles + export + summary */}
      <div style={{ overflowY: 'auto', flex: 1 }}>

      {/* Done color mode selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 14px 4px', flexWrap: 'wrap' as const }}>
        <span style={{ fontSize: 9, color: '#64748b', letterSpacing: '0.06em', textTransform: 'uppercase' as const }}>Completados:</span>
        {(['kit', 'original', 'uniform'] as const).map(mode => (
          <button
            key={mode}
            onClick={() => onDoneColorModeChange(mode)}
            style={{
              ...tlSt.speedBtn,
              ...(doneColorMode === mode ? tlSt.speedBtnActive : {}),
              fontSize: 9,
            }}
          >
            {mode === 'kit' ? 'Color del kit' : mode === 'original' ? 'Color original' : 'Color único'}
          </button>
        ))}
        {doneColorMode === 'uniform' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input
              type="color"
              value={doneUniformColor}
              onChange={e => onDoneUniformColorChange(e.target.value)}
              style={{ width: 22, height: 18, border: 'none', borderRadius: 3, cursor: 'pointer', padding: 0, background: 'none' }}
            />
            <span style={{ fontSize: 9, color: '#94a3b8', fontFamily: '"IBM Plex Mono",monospace' }}>{doneUniformColor}</span>
          </label>
        )}
      </div>

      {/* Kit visibility toggles */}
      {ifcKits.length > 0 && (
        <div style={{ padding: '4px 14px 6px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
            <span style={{ fontSize: 9, color: '#64748b', letterSpacing: '0.06em', textTransform: 'uppercase' as const }}>
              Visibilidad en animación
            </span>
            {hiddenKitCodes.size > 0 && (
              <span style={{ ...tlSt.badge, background: 'rgba(239,68,68,0.1)', color: '#f87171', fontSize: 8 }}>
                {hiddenKitCodes.size} oculto{hiddenKitCodes.size !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 4, maxHeight: 90, overflowY: 'auto' }}>
            {ifcKits.map(kit => {
              const isHidden = hiddenKitCodes.has(kit.codigo_kit);
              return (
                <button
                  key={kit.codigo_kit}
                  onClick={() => onToggleHiddenKit(kit.codigo_kit)}
                  title={isHidden ? `Mostrar ${kit.codigo_kit} en animación` : `Ocultar ${kit.codigo_kit} de la animación`}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    background: isHidden ? 'rgba(239,68,68,0.07)' : 'rgba(255,255,255,0.05)',
                    border: `1px solid ${isHidden ? 'rgba(239,68,68,0.25)' : 'rgba(255,255,255,0.1)'}`,
                    borderRadius: 4, padding: '3px 8px', cursor: 'pointer',
                    fontFamily: '"IBM Plex Mono",monospace',
                    transition: 'all 0.15s',
                  }}
                >
                  <span style={{
                    width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                    background: isHidden ? 'rgba(239,68,68,0.4)' : (kit.color || '#22c55e'),
                  }} />
                  <span style={{
                    fontSize: 9,
                    color: isHidden ? '#f87171' : '#94a3b8',
                    textDecoration: isHidden ? 'line-through' : 'none',
                  }}>
                    {kit.codigo_kit}
                  </span>
                  <span style={{ fontSize: 9, color: isHidden ? '#f87171' : '#475569' }}>
                    {isHidden ? '⊘' : '●'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Category visibility toggles */}
      {(() => {
        const catIdx = multiIndex.get('__ifc_category__');
        const categories = catIdx ? [...catIdx.keys()].sort() : [];
        if (categories.length === 0) return null;
        return (
          <div style={{ padding: '4px 14px 6px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
              <span style={{ fontSize: 9, color: '#64748b', letterSpacing: '0.06em', textTransform: 'uppercase' as const }}>
                Filtrar por Categoría
              </span>
              {hiddenCategories.size > 0 && (
                <span style={{ ...tlSt.badge, background: 'rgba(239,68,68,0.1)', color: '#f87171', fontSize: 8 }}>
                  {hiddenCategories.size} oculta{hiddenCategories.size !== 1 ? 's' : ''}
                </span>
              )}
              {hiddenCategories.size > 0 && (
                <button
                  onClick={() => categories.forEach(c => hiddenCategories.has(c) && onToggleHiddenCategory(c))}
                  style={{ ...tlSt.badge, background: 'none', border: '1px solid rgba(100,116,139,0.3)', color: '#64748b', cursor: 'pointer', fontSize: 8 }}
                >
                  mostrar todas
                </button>
              )}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 4, maxHeight: 90, overflowY: 'auto' }}>
              {categories.map(cat => {
                const isHidden = hiddenCategories.has(cat);
                return (
                  <button
                    key={cat}
                    onClick={() => onToggleHiddenCategory(cat)}
                    title={isHidden ? `Mostrar ${cat} en animación` : `Ocultar ${cat} de la animación`}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      background: isHidden ? 'rgba(239,68,68,0.07)' : 'rgba(255,255,255,0.05)',
                      border: `1px solid ${isHidden ? 'rgba(239,68,68,0.25)' : 'rgba(255,255,255,0.1)'}`,
                      borderRadius: 4, padding: '3px 8px', cursor: 'pointer',
                      fontFamily: '"IBM Plex Mono",monospace',
                      transition: 'all 0.15s',
                    }}
                  >
                    <span style={{
                      width: 7, height: 7, borderRadius: 2, flexShrink: 0,
                      background: isHidden ? 'rgba(239,68,68,0.4)' : '#a78bfa',
                    }} />
                    <span style={{
                      fontSize: 9,
                      color: isHidden ? '#f87171' : '#94a3b8',
                      textDecoration: isHidden ? 'line-through' : 'none',
                    }}>
                      {cat}
                    </span>
                    <span style={{ fontSize: 9, color: isHidden ? '#f87171' : '#475569' }}>
                      {isHidden ? '⊘' : '●'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Export MP4 button */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '2px 14px 6px', gap: 8 }}>
        {recordingState === 'idle' && (
          <button
            onClick={onStartRecording}
            disabled={!dateRange}
            style={{
              ...tlSt.speedBtn,
              fontSize: 10, padding: '4px 12px',
              color: dateRange ? '#f43f5e' : '#475569',
              borderColor: dateRange ? 'rgba(244,63,94,0.35)' : 'rgba(255,255,255,0.08)',
              background: dateRange ? 'rgba(244,63,94,0.08)' : 'none',
              cursor: dateRange ? 'pointer' : 'not-allowed',
            }}
            title="Graba la animación completa y exporta como MP4"
          >
            ⏺ Exportar MP4
          </button>
        )}
        {recordingState === 'recording' && (
          <button
            onClick={onStopRecording}
            style={{
              ...tlSt.speedBtn,
              fontSize: 10, padding: '4px 12px',
              color: '#f43f5e',
              borderColor: 'rgba(244,63,94,0.5)',
              background: 'rgba(244,63,94,0.12)',
              cursor: 'pointer',
              animation: 'recordPulse 1.2s ease-in-out infinite',
            }}
          >
            ⏹ Grabando · Detener
          </button>
        )}
        {recordingState === 'converting' && (
          <span style={{ fontSize: 10, color: '#94a3b8', fontFamily: '"IBM Plex Mono",monospace', display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ display: 'inline-block', animation: 'spin 0.8s linear infinite' }}>⟳</span>
            Convirtiendo a MP4…
          </span>
        )}
      </div>

      {/* Summary + today events */}
      <div style={tlSt.bottomRow}>
        <div style={tlSt.summaryGroup}>
          <span style={{ ...tlSt.badge, background: 'rgba(34,197,94,0.12)', color: '#22c55e' }}>
            ✓ {completed.length} completados
          </span>
          <span style={{ ...tlSt.badge, background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}>
            ◑ {inProgress.length} en progreso
          </span>
          <span style={{ ...tlSt.badge, background: 'rgba(100,116,139,0.12)', color: '#64748b' }}>
            ○ {notStarted.length} por iniciar
          </span>
        </div>

        {(todayStart.length > 0 || todayComplete.length > 0) && (
          <div style={tlSt.eventsRow}>
            {todayStart.map(k => (
              <div key={`s${k.id}`} style={tlSt.eventChip}>
                <span style={{ color: '#f59e0b', marginRight: 3 }}>▶</span>
                <span style={{ color: k.color || '#22c55e', marginRight: 3, fontWeight: 700 }}>{k.codigo_kit}</span>
                {k.nombre && <span style={{ color: '#94a3b8' }}>{k.nombre}</span>}
              </div>
            ))}
            {todayComplete.map(k => (
              <div key={`c${k.id}`} style={tlSt.eventChip}>
                <span style={{ color: '#22c55e', marginRight: 3 }}>✓</span>
                <span style={{ color: k.color || '#22c55e', marginRight: 3, fontWeight: 700 }}>{k.codigo_kit}</span>
                {k.nombre && <span style={{ color: '#94a3b8' }}>{k.nombre}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      </div>{/* end scrollable section */}
    </div>
  );
};

const tlSt: Record<string, React.CSSProperties> = {
  container:      { ...BASE, position: 'absolute', bottom: '52px', left: '50%', transform: 'translateX(-50%)', width: 760, maxWidth: 'calc(100% - 32px)', zIndex: 1000, maxHeight: 'calc(100vh - 120px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header:         { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 14px', borderBottom: '1px solid rgba(255,255,255,0.07)', backgroundColor: 'rgba(245,158,11,0.04)', flexShrink: 0 },
  headerTitle:    { fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: '#f59e0b' },
  headerSub:      { fontSize: 9, color: '#64748b', marginLeft: 6 },
  closeBtn:       { background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 13, padding: '2px 4px', borderRadius: 4, lineHeight: 1 },
  collapseBtn:    { background: 'none', border: 'none', color: '#f59e0b', cursor: 'pointer', fontSize: 10, padding: '2px 5px', borderRadius: 4, lineHeight: 1, opacity: 0.8 },
  controlsRow:    { display: 'flex', alignItems: 'center', gap: 12, padding: '8px 14px 4px', flexShrink: 0 },
  dateLabel:      { fontSize: 13, fontWeight: 700, color: '#e2e8f0', fontFamily: '"IBM Plex Mono","Fira Code",monospace', marginRight: 8 },
  progressPct:    { fontSize: 9, color: '#64748b' },
  ctrlBtn:        { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', cursor: 'pointer', borderRadius: 5, padding: '4px 10px', fontSize: 13, lineHeight: 1, fontFamily: '"IBM Plex Mono",monospace' },
  playBtn:        { backgroundColor: 'rgba(245,158,11,0.18)', borderColor: 'rgba(245,158,11,0.4)', color: '#f59e0b' },
  pauseBtn:       { backgroundColor: 'rgba(148,163,184,0.1)', borderColor: 'rgba(148,163,184,0.25)', color: '#94a3b8' },
  speedBtn:       { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#475569', cursor: 'pointer', borderRadius: 4, padding: '3px 7px', fontSize: 9, fontFamily: '"IBM Plex Mono",monospace', lineHeight: 1 },
  speedBtnActive: { backgroundColor: 'rgba(56,189,248,0.15)', borderColor: 'rgba(56,189,248,0.3)', color: '#38bdf8' },
  sliderRow:      { display: 'flex', alignItems: 'center', gap: 8, padding: '2px 14px 4px', flexShrink: 0 },
  sliderEdge:     { fontSize: 9, color: '#475569', whiteSpace: 'nowrap' as const, flexShrink: 0, fontFamily: '"IBM Plex Mono",monospace' },
  slider:         { flex: 1, accentColor: '#f59e0b', cursor: 'pointer' },
  progressBarWrap:{ height: 3, backgroundColor: 'rgba(255,255,255,0.05)', margin: '0 14px 6px', borderRadius: 2, overflow: 'hidden', flexShrink: 0 },
  progressFill:   { height: '100%', backgroundColor: '#f59e0b', borderRadius: 2, transition: 'width 0.1s linear' },
  bottomRow:      { display: 'flex', alignItems: 'center', gap: 10, padding: '4px 14px 8px', flexWrap: 'wrap' as const },
  summaryGroup:   { display: 'flex', gap: 5 },
  badge:          { fontSize: 9, padding: '2px 8px', borderRadius: 8, fontWeight: 700, letterSpacing: '0.04em' },
  eventsRow:      { display: 'flex', gap: 5, flexWrap: 'wrap' as const, flex: 1 },
  eventChip:      { display: 'flex', alignItems: 'center', fontSize: 9, backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, padding: '2px 7px', fontFamily: '"IBM Plex Mono",monospace', letterSpacing: '0.04em', flexShrink: 0 },
  durationInfo:   { fontSize: 9, color: '#475569', padding: '0 14px 5px', fontFamily: '"IBM Plex Mono",monospace', letterSpacing: '0.04em' },
  durationInput:  { width: 42, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 4, color: '#e2e8f0', fontSize: 9, padding: '2px 5px', fontFamily: '"IBM Plex Mono",monospace', outline: 'none', textAlign: 'center' as const },
};

// ─── Main BimViewer ────────────────────────────────────────────────────────────

const EMPTY_FILTER_STATE = (): FilterState =>
  Object.fromEntries(IFC_PROPS.map((p) => [p, new Set<string>()]));

const BimViewer: React.FC<BimViewerProps> = ({ ifcUrl, projectId, onElementSelect, onActiveKitIdsChange, onTimelineUpdate }) => {
  const containerRef  = useRef<HTMLDivElement>(null);
  const componentsRef = useRef<OBC.Components | null>(null);
  const hiderRef      = useRef<OBC.Hider | null>(null);
  const multiIndexRef = useRef<MultiPropertyIndex>(new Map());

  const [selectedProperties, setSelectedProperties] = useState<ElementProperties | null>(null);
  const [loadingProps,  setLoadingProps]  = useState(false);
  const [propPanelVis,  setPropPanelVis]  = useState(false);
  const [filterPanelVis, setFilterPanelVis] = useState(false);
  const [multiIndex,    setMultiIndex]    = useState<MultiPropertyIndex>(new Map());
  const [scanning,      setScanning]      = useState(false);
  const [filterState,   setFilterState]   = useState<FilterState>(EMPTY_FILTER_STATE);

  // Kit + activity filter state
  const [kits,               setKits]               = useState<ActivityKit[]>([]);
  const [selectedActivityIds, setSelectedActivityIds] = useState<Set<number>>(new Set());
  const [colorByKit,         setColorByKit]         = useState(false);
  const kitColorGroupsRef = useRef<Set<string>>(new Set());

  // Schedule kit color state
  const [scheduleKits,       setScheduleKits]       = useState<ScheduleKit[]>([]);
  const [colorByCronKit,     setColorByCronKit]     = useState(false);
  const cronKitColorGroupsRef = useRef<Set<string>>(new Set());

  // Timeliner state
  const [timelinePanelVis,    setTimelinePanelVis]    = useState(false);
  const [timelineActive,      setTimelineActive]      = useState(false);
  const [timelineDateStr,     setTimelineDateStr]     = useState('');
  const [timelinePlaying,     setTimelinePlaying]     = useState(false);
  const [timelineDuration,    setTimelineDuration]    = useState(30);
  const [doneColorMode,       setDoneColorMode]       = useState<'kit' | 'original' | 'uniform'>('kit');
  const [doneUniformColor,    setDoneUniformColor]    = useState('#22c55e');
  const [hiddenKitCodes,      setHiddenKitCodes]      = useState<Set<string>>(new Set());
  const [hiddenCategories,    setHiddenCategories]    = useState<Set<string>>(new Set());
  const timelineStylesRef = useRef<Set<string>>(new Set());

  // Video export state
  const [recordingState, setRecordingState] = useState<'idle' | 'recording' | 'converting'>('idle');
  const mediaRecorderRef       = useRef<MediaRecorder | null>(null);
  const recordedChunksRef      = useRef<Blob[]>([]);
  const recordingHasPlayedRef  = useRef(false);

  // Measurement tools state
  const [activeMeasureTool, setActiveMeasureTool] = useState<'length' | 'area' | 'volume' | null>(null);
  const [measurePanelVis,   setMeasurePanelVis]   = useState(false);
  const activeMeasureToolRef = useRef<'length' | 'area' | 'volume' | null>(null);
  const lengthMeasurerRef    = useRef<OBF.LengthMeasurement | null>(null);
  const areaMeasurerRef      = useRef<OBF.AreaMeasurement   | null>(null);
  const volumeMeasurerRef    = useRef<OBF.VolumeMeasurement | null>(null);
  const highlighterRef       = useRef<OBF.Highlighter | null>(null);

  const onElementSelectRef = useRef(onElementSelect);
  useEffect(() => { onElementSelectRef.current = onElementSelect; }, [onElementSelect]);

  // Fetch kits from API when projectId changes
  useEffect(() => {
    if (!projectId) return;
    const load = async () => {
      try {
        const [masterRes, projectRes, masterSchedRes, projectSchedRes] = await Promise.all([
          api.get('/activity-kits/').then(r => r.data),
          api.get(`/activity-kits/?proyecto=${projectId}`).then(r => r.data),
          api.get('/schedule-kits/').then(r => r.data),
          api.get(`/schedule-kits/?proyecto=${projectId}`).then(r => r.data),
        ]);
        setKits([...(masterRes as ActivityKit[]), ...(projectRes as ActivityKit[])]);
        setScheduleKits([...(masterSchedRes as ScheduleKit[]), ...(projectSchedRes as ScheduleKit[])]);
      } catch (err) {
        console.error('[BIM] Error cargando kits:', err);
      }
    };
    load();
  }, [projectId]);

  // ── Derived values from kits + IFC scan ─────────────────────────────────
  const ifcKitCodes = useMemo(() => {
    const idx = multiIndex.get('codigo_kit_actividad');
    return idx ? new Set(idx.keys()) : new Set<string>();
  }, [multiIndex]);

  const ifcKits = useMemo(
    () => kits.filter(k => k.codigo_kit && ifcKitCodes.has(k.codigo_kit)),
    [kits, ifcKitCodes],
  );

  const ifcActivities = useMemo((): IFCActivity[] => {
    const acts: IFCActivity[] = [];
    for (const kit of ifcKits) {
      for (const act of kit.kit_activities) {
        acts.push({ id: act.id, codigo_actividad: act.codigo_actividad, descripcion: act.descripcion, kitId: kit.id, kitCode: kit.codigo_kit });
      }
    }
    return acts.sort((a, b) => a.descripcion.localeCompare(b.descripcion));
  }, [ifcKits]);

  const activityKitCodes = useMemo((): Set<string> => {
    if (selectedActivityIds.size === 0) return new Set();
    const codes = new Set<string>();
    ifcActivities.forEach(act => { if (selectedActivityIds.has(act.id)) codes.add(act.kitCode); });
    return codes;
  }, [selectedActivityIds, ifcActivities]);

  const kitColorMap = useMemo((): Record<string, string> => {
    const map: Record<string, string> = {};
    for (const kit of ifcKits) {
      if (kit.codigo_kit && kit.color) map[kit.codigo_kit] = kit.color;
    }
    return map;
  }, [ifcKits]);

  const ifcScheduleKitCodes = useMemo(() => {
    const idx = multiIndex.get('codigo_cronograma');
    return idx ? new Set(idx.keys()) : new Set<string>();
  }, [multiIndex]);

  const ifcScheduleKits = useMemo(
    () => scheduleKits.filter(k => k.codigo_kit && ifcScheduleKitCodes.has(k.codigo_kit)),
    [scheduleKits, ifcScheduleKitCodes],
  );

  const scheduleKitColorMap = useMemo((): Record<string, string> => {
    const map: Record<string, string> = {};
    for (const kit of ifcScheduleKits) {
      if (kit.codigo_kit && kit.color) map[kit.codigo_kit] = kit.color;
    }
    return map;
  }, [ifcScheduleKits]);

  // ── Timeline date range ──────────────────────────────────────────────────
  const timelineDateRange = useMemo(() => {
    const starts = ifcScheduleKits.filter(k => k.fecha_inicio).map(k => k.fecha_inicio!);
    const ends   = ifcScheduleKits.filter(k => k.fecha_fin).map(k => k.fecha_fin!);
    if (!starts.length || !ends.length) return null;
    return { start: [...starts].sort()[0], end: [...ends].sort().reverse()[0] };
  }, [ifcScheduleKits]);

  const daysPerTick = useMemo(() => {
    if (!timelineDateRange) return 1;
    const totalDays = Math.max(1, daysBetween(timelineDateRange.start, timelineDateRange.end));
    const totalTicks = (timelineDuration * 1000) / TICK_MS;
    return Math.max(1, Math.ceil(totalDays / totalTicks));
  }, [timelineDuration, timelineDateRange]);

  useEffect(() => {
    if (timelineDateRange && !timelineDateStr) {
      setTimelineDateStr(addDays(timelineDateRange.start, -1));
    }
  }, [timelineDateRange]);

  // ── Apply/clear schedule kit colors ─────────────────────────────────────
  useEffect(() => {
    const highlighter = highlighterRef.current;
    if (!highlighter) return;

    const clearPrev = async () => {
      for (const styleName of cronKitColorGroupsRef.current) {
        try { await highlighter.clear(styleName); } catch {}
        highlighter.styles.delete(styleName);
      }
      cronKitColorGroupsRef.current.clear();
    };

    if (!colorByCronKit || timelineActive) {
      clearPrev();
      return;
    }

    (async () => {
      await clearPrev();
      const kitCodeIdx = multiIndex.get('codigo_cronograma');
      if (!kitCodeIdx) return;
      for (const kit of ifcScheduleKits) {
        if (!kit.codigo_kit || !kit.color) continue;
        const codeMap = kitCodeIdx.get(kit.codigo_kit);
        if (!codeMap || Object.keys(codeMap).length === 0) continue;
        const styleName = `__croncolor_${kit.codigo_kit}`;
        highlighter.styles.set(styleName, {
          color: new THREE.Color(kit.color),
          renderedFaces: FRAGS.RenderedFaces.ONE,
          opacity: 1,
          transparent: false,
        });
        try {
          await highlighter.highlightByID(styleName, codeMap, false, false);
        } catch (e) {
          console.warn('[BIM] Color cronograma error:', kit.codigo_kit, e);
        }
        cronKitColorGroupsRef.current.add(styleName);
      }
    })();
  }, [colorByCronKit, multiIndex, ifcScheduleKits, timelineActive]);

  // ── Apply/clear kit colors when toggle or data changes ───────────────────
  useEffect(() => {
    const highlighter = highlighterRef.current;
    if (!highlighter) return;

    const clearPrev = async () => {
      for (const styleName of kitColorGroupsRef.current) {
        try { await highlighter.clear(styleName); } catch {}
        highlighter.styles.delete(styleName);
      }
      kitColorGroupsRef.current.clear();
    };

    if (!colorByKit || timelineActive) {
      clearPrev();
      return;
    }

    (async () => {
      await clearPrev();
      const kitCodeIdx = multiIndex.get('codigo_kit_actividad');
      if (!kitCodeIdx) return;
      for (const kit of ifcKits) {
        if (!kit.codigo_kit || !kit.color) continue;
        const codeMap = kitCodeIdx.get(kit.codigo_kit);
        if (!codeMap || Object.keys(codeMap).length === 0) continue;
        const styleName = `__kitcolor_${kit.codigo_kit}`;
        highlighter.styles.set(styleName, {
          color: new THREE.Color(kit.color),
          renderedFaces: FRAGS.RenderedFaces.ONE,
          opacity: 1,
          transparent: false,
        });
        try {
          await highlighter.highlightByID(styleName, codeMap, false, false);
        } catch (e) {
          console.warn('[BIM] Color kit error:', kit.codigo_kit, e);
        }
        kitColorGroupsRef.current.add(styleName);
      }
    })();
  }, [colorByKit, multiIndex, ifcKits, timelineActive]);

  // ── Timeline colors + visibility ─────────────────────────────────────────
  useEffect(() => {
    const highlighter = highlighterRef.current;
    const hider = hiderRef.current;
    if (!highlighter || !hider) return;

    const clearStyles = async () => {
      for (const sn of timelineStylesRef.current) {
        try { await highlighter.clear(sn); } catch {}
        highlighter.styles.delete(sn);
      }
      timelineStylesRef.current.clear();
    };

    if (!timelineActive || !timelineDateStr) {
      clearStyles();
      return;
    }

    (async () => {
      await clearStyles();
      const kitCodeIdx = multiIndex.get('codigo_cronograma');
      if (!kitCodeIdx) return;

      const visibleMap: OBC.ModelIdMap = {};

      for (const kit of ifcScheduleKits) {
        if (!kit.codigo_kit || !kit.fecha_inicio) continue;
        if (hiddenKitCodes.has(kit.codigo_kit)) continue; // excluido por usuario → ocultar siempre
        const codeMap = kitCodeIdx.get(kit.codigo_kit);
        if (!codeMap || Object.keys(codeMap).length === 0) continue;

        if (timelineDateStr < kit.fecha_inicio) continue; // no iniciado → ocultar

        for (const [modelId, ids] of Object.entries(codeMap)) {
          if (!visibleMap[modelId]) visibleMap[modelId] = new Set<number>();
          for (const id of (ids as Set<number>))
            (visibleMap[modelId] as Set<number>).add(id);
        }

        const isDone = !!(kit.fecha_fin && timelineDateStr > kit.fecha_fin);

        // Color original: no highlight applied, element stays with its IFC material
        if (isDone && doneColorMode === 'original') continue;

        const color   = isDone
          ? (doneColorMode === 'uniform' ? doneUniformColor : (kit.color || '#22c55e'))
          : '#f59e0b';
        const styleNm = `__tl_${isDone ? 'done' : 'wip'}_${kit.codigo_kit}`;

        highlighter.styles.set(styleNm, {
          color: new THREE.Color(color),
          renderedFaces: FRAGS.RenderedFaces.ONE,
          opacity: 1,
          transparent: false,
        });

        try {
          await highlighter.highlightByID(styleNm, codeMap, false, false);
          timelineStylesRef.current.add(styleNm);
        } catch (e) {
          console.warn('[Timeliner] Color error:', kit.codigo_kit, e);
        }
      }

      // ── Apply category filter ─────────────────────────────────────────────
      // If some categories are hidden, build the union of allowed-category elements
      // and intersect it with visibleMap so only matching elements remain visible.
      let finalMap = visibleMap;
      if (hiddenCategories.size > 0) {
        const catIdx = multiIndex.get('__ifc_category__');
        if (catIdx) {
          const allowedMaps: OBC.ModelIdMap[] = [];
          for (const [cat, catMap] of catIdx) {
            if (!hiddenCategories.has(cat)) allowedMaps.push(catMap);
          }
          if (allowedMaps.length > 0) {
            const allowedMap = unionModelIdMaps(allowedMaps);
            finalMap = Object.keys(visibleMap).length > 0
              ? intersectModelIdMaps(visibleMap, allowedMap)
              : {};
          } else {
            // All categories are hidden → show nothing
            finalMap = {};
          }
        }
      }

      try {
        // If no non-hidden kit has started yet, show everything in original state.
        // isolate({}) would hide all fragments leaving only the grey base mesh.
        if (Object.keys(finalMap).length === 0) {
          await hider.set(true);
        } else {
          await hider.isolate(finalMap);
        }
      } catch {}
    })();
  }, [timelineActive, timelineDateStr, multiIndex, ifcScheduleKits, doneColorMode, doneUniformColor, hiddenKitCodes, hiddenCategories]);

  // ── Timeline animation loop ───────────────────────────────────────────────
  useEffect(() => {
    if (!timelinePlaying || !timelineDateRange) return;
    const interval = setInterval(() => {
      setTimelineDateStr(prev => {
        const next = addDays(prev, daysPerTick);
        if (next >= timelineDateRange.end) {
          setTimelinePlaying(false);
          return timelineDateRange.end;
        }
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(interval);
  }, [timelinePlaying, daysPerTick, timelineDateRange]);

  // ── Apply filter whenever filterState, multiIndex, or activityKitCodes changes
  useEffect(() => {
    const hider = hiderRef.current;
    if (!hider) return;
    if (timelineActive) return;
    const filtered = computeFilteredMap(multiIndex, filterState, activityKitCodes.size > 0 ? activityKitCodes : null);
    (async () => {
      try {
        if (filtered === null) {
          await hider.set(true);
        } else {
          await hider.isolate(filtered);
        }
      } catch {
        // FragmentsManager may not be initialized yet (model still loading)
      }
    })();
  }, [filterState, multiIndex, activityKitCodes, timelineActive]);

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
    setSelectedActivityIds(new Set());
  }, []);

  // ── Activity filter handlers ─────────────────────────────────────────────
  const handleToggleActivity = useCallback((actId: number) => {
    setSelectedActivityIds(prev => {
      const next = new Set(prev);
      if (next.has(actId)) next.delete(actId); else next.add(actId);
      return next;
    });
  }, []);

  const handleClearActivities = useCallback(() => {
    setSelectedActivityIds(new Set());
  }, []);

  // ── Measurement tool handlers ────────────────────────────────────────────
  const handleToggleMeasureTool = useCallback((tool: 'length' | 'area' | 'volume') => {
    const next = activeMeasureToolRef.current === tool ? null : tool;
    activeMeasureToolRef.current = next;
    setActiveMeasureTool(next);
    if (lengthMeasurerRef.current) lengthMeasurerRef.current.enabled = false;
    if (areaMeasurerRef.current)   areaMeasurerRef.current.enabled   = false;
    if (volumeMeasurerRef.current) volumeMeasurerRef.current.enabled = false;
    if (next === 'length' && lengthMeasurerRef.current) lengthMeasurerRef.current.enabled = true;
    if (next === 'area'   && areaMeasurerRef.current)   areaMeasurerRef.current.enabled   = true;
    if (next === 'volume' && volumeMeasurerRef.current) volumeMeasurerRef.current.enabled = true;
    // Disable element selection while a measurement tool is active so clicks
    // aren't stolen by the highlighter. Re-enable and clear highlight on exit.
    if (highlighterRef.current) {
      highlighterRef.current.enabled = !next;
      if (!next) highlighterRef.current.clear();
    }
  }, []);

  const handleClearMeasurements = useCallback(() => {
    lengthMeasurerRef.current?.list.clear();
    areaMeasurerRef.current?.list.clear();
    volumeMeasurerRef.current?.list.clear();
  }, []);

  // ── Budget filter computed ────────────────────────────────────────────────

  const activeBudgetKitIds = useMemo((): Set<number> | null => {
    const selectedCodes = filterState['codigo_kit_actividad'];
    const hasManualCodes = selectedCodes && selectedCodes.size > 0;
    const hasActivityCodes = activityKitCodes.size > 0;

    let effectiveCodes: Set<string> | null = null;
    if (hasManualCodes && hasActivityCodes) {
      effectiveCodes = new Set([...selectedCodes].filter(c => activityKitCodes.has(c)));
    } else if (hasManualCodes) {
      effectiveCodes = selectedCodes;
    } else if (hasActivityCodes) {
      effectiveCodes = activityKitCodes;
    }

    if (!effectiveCodes || effectiveCodes.size === 0) return null;
    const ids = new Set<number>();
    kits.forEach(k => { if (k.codigo_kit && effectiveCodes!.has(k.codigo_kit)) ids.add(k.id); });
    return ids;
  }, [filterState, activityKitCodes, kits]);

  useEffect(() => {
    onActiveKitIdsChange?.(activeBudgetKitIds);
  }, [activeBudgetKitIds]);

  useEffect(() => {
    onTimelineUpdate?.(timelineActive && timelineDateStr ? timelineDateStr : null);
  }, [timelineActive, timelineDateStr]);

  // ── Video recording ──────────────────────────────────────────────────────
  const handleStartRecording = useCallback(() => {
    if (!timelineDateRange) return;
    const canvas = containerRef.current?.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) { alert('No se encontró el canvas del visor.'); return; }

    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm';

    const stream = canvas.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 });
    recordedChunksRef.current = [];
    recordingHasPlayedRef.current = false;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      setRecordingState('converting');
      const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
      const formData = new FormData();
      formData.append('video', blob, 'timeliner.webm');
      try {
        const response = await api.post('/convert-video/', formData, { responseType: 'blob' });
        const mp4Blob = response.data as Blob;
        const url = URL.createObjectURL(mp4Blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'timeliner_export.mp4';
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error('[Export]', err);
        alert('Error al conectar con el servidor para convertir el video.');
      } finally {
        setRecordingState('idle');
      }
    };

    // Reset timeliner and start recording
    setTimelineActive(true);
    setTimelineDateStr(addDays(timelineDateRange.start, -1));
    setRecordingState('recording');
    mediaRecorderRef.current = recorder;
    recorder.start(200);
    // Small delay so the reset renders before play starts
    setTimeout(() => {
      recordingHasPlayedRef.current = false;
      setTimelinePlaying(true);
    }, 200);
  }, [timelineDateRange]);

  const handleStopRecording = useCallback(() => {
    setTimelinePlaying(false);
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === 'recording') recorder.stop();
  }, []);

  // Detect animation end during recording
  useEffect(() => {
    if (recordingState !== 'recording') return;
    if (timelinePlaying) {
      recordingHasPlayedRef.current = true;
      return;
    }
    if (!recordingHasPlayedRef.current) return; // hasn't started yet
    // Playing stopped after having started → animation finished
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === 'recording') recorder.stop();
  }, [timelinePlaying, recordingState]);

  // ── Setup ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    BUI.Manager.init();
    const components = new OBC.Components();
    componentsRef.current = components;

    const worlds = components.get(OBC.Worlds);
    const world  = worlds.create<OBC.SimpleScene, OBC.SimpleCamera, OBF.PostproductionRenderer>();
    world.scene    = new OBC.SimpleScene(components);
    world.renderer = new OBF.PostproductionRenderer(components, container);
    world.camera   = new OBC.SimpleCamera(components);
    world.scene.setup();
    components.init();

    world.scene.three.background = new THREE.Color(0xcccccc);
    // PostproductionRenderer provides the CSS2D layer needed for measurement labels.
    // Postproduction effects are disabled by default — no action needed.

    const fragments = components.get(OBC.FragmentsManager);
    const ifcLoader = components.get(OBC.IfcLoader);
    const grids     = components.get(OBC.Grids);
    const grid      = grids.create(world);
    grid.visible    = false;
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
    highlighterRef.current = highlighter;

    highlighter.events.select.onHighlight.add(async (modelIdMap) => {
      if (activeMeasureToolRef.current) return;
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
              // La propiedad no está en el tipo de SimpleSceneConfigManager pero
              // sigue funcionando en runtime con @thatopen/components 3.4.
              (world.scene.config as any).directionalIntensity = target.value;
            }}">
          </bim-number-input>
          <bim-checkbox label="Rejilla Visible"
            @change="${({ target }: { target: any }) => { grid.visible = target.value; }}">
          </bim-checkbox>
        </bim-panel-section>
      </bim-panel>
    `);
    panel.style.cssText = 'position:absolute;top:50px;left:10px;width:280px;z-index:1002;display:none';

    const toggleButton = document.createElement('button');
    toggleButton.innerHTML = '⚙️';
    Object.assign(toggleButton.style, {
      position:'absolute', top:'10px', left:'10px', zIndex:'1003',
      padding:'8px', borderRadius:'4px', border:'none',
      backgroundColor:'rgba(255,255,255,0.7)', cursor:'pointer',
    });
    toggleButton.onclick = () => {
      const hidden = panel.style.display === 'none';
      panel.style.display = hidden ? 'block' : 'none';
      toggleButton.style.backgroundColor = hidden ? 'white' : 'rgba(255,255,255,0.7)';
    };
    if (container.parentElement) container.parentElement.append(panel, toggleButton);

    // Double-click dispatches to the active tool.
    // Volume: create() adds the picked element to a preview, then endCreation() finalizes.
    // Length/Area: create() places a point; Enter finalizes.
    const handleMeasureDblClick = () => {
      const tool = activeMeasureToolRef.current;
      if (tool === 'length') {
        lengthMeasurerRef.current?.create().catch(e => console.warn('[Measure length]', e));
      } else if (tool === 'area') {
        areaMeasurerRef.current?.create().catch(e => console.warn('[Measure area]', e));
      } else if (tool === 'volume') {
        volumeMeasurerRef.current?.create().catch(e => console.warn('[Measure volume]', e));
      }
    };
    container.addEventListener('dblclick', handleMeasureDblClick);

    // Delete = remove measurement under cursor · Enter = finalize · Escape = cancel in-progress
    const handleMeasureKey = (e: KeyboardEvent) => {
      const tool = activeMeasureToolRef.current;
      if (!tool) return;
      if (e.code === 'Delete' || e.code === 'Backspace') {
        if (tool === 'length') lengthMeasurerRef.current?.delete();
        else if (tool === 'area')   areaMeasurerRef.current?.delete();
        else if (tool === 'volume') volumeMeasurerRef.current?.delete().catch(e => console.warn('[Measure volume delete]', e));
      }
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        if (tool === 'length') lengthMeasurerRef.current?.endCreation();
        else if (tool === 'area') areaMeasurerRef.current?.endCreation();
        else if (tool === 'volume') volumeMeasurerRef.current?.endCreation();
      }
      if (e.key === 'Escape') {
        if (tool === 'length') {
          lengthMeasurerRef.current?.cancelCreation();
          lengthMeasurerRef.current?.list.clear();
        } else if (tool === 'area') {
          areaMeasurerRef.current?.cancelCreation();
          areaMeasurerRef.current?.list.clear();
        } else if (tool === 'volume') {
          volumeMeasurerRef.current?.cancelCreation();
          volumeMeasurerRef.current?.list.clear();
        }
      }
    };
    window.addEventListener('keydown', handleMeasureKey);

    // ── Load IFC ─────────────────────────────────────────────────────────
    const loadModel = async () => {
      try {
        const workerUrl = await OBC.FragmentsManager.getWorker();
        fragments.init(workerUrl);

        // Measurement tools: enabled setter requires FragmentsManager.init() first.
        // snappings activates the SnapResolver so the cursor snaps to vertices/edges
        // and the snap indicator (red square) appears near model boundaries.
        const lengthMeasurer = components.get(OBF.LengthMeasurement);
        lengthMeasurer.world = world;
        lengthMeasurer.color = new THREE.Color('#494cb6');
        lengthMeasurer.snappings = [FRAGS.SnappingClass.POINT];
        lengthMeasurer.enabled = false;
        lengthMeasurerRef.current = lengthMeasurer;

        const areaMeasurer = components.get(OBF.AreaMeasurement);
        areaMeasurer.world = world;
        areaMeasurer.color = new THREE.Color('#494cb6');
        areaMeasurer.snappings = [FRAGS.SnappingClass.POINT];
        areaMeasurer.enabled = false;
        areaMeasurerRef.current = areaMeasurer;

        const volumeMeasurer = components.get(OBF.VolumeMeasurement);
        volumeMeasurer.world = world;
        volumeMeasurer.color = new THREE.Color('#494cb6');
        volumeMeasurer.enabled = false;
        volumeMeasurerRef.current = volumeMeasurer;

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

          const bufferCopy  = new Uint8Array(rawBuffer.slice(0));
          const bufferCopy2 = new Uint8Array(rawBuffer.slice(0));

          const [idx, entityIdx] = await Promise.all([
            scanProperties(bufferCopy,  fragmentsModelId, IFC_PROPS, 'https://unpkg.com/web-ifc@0.0.77/'),
            scanEntityTypes(bufferCopy2, fragmentsModelId, 'https://unpkg.com/web-ifc@0.0.77/'),
          ]);

          // Merge entity type index into the main multiIndex
          for (const [key, val] of entityIdx) idx.set(key, val);

          multiIndexRef.current = idx;
          setMultiIndex(new Map(idx));

          // Persist codigo_cronograma codes so ProjectSchedule can filter without re-scanning
          if (projectId) {
            const schedIdx = idx.get('codigo_cronograma');
            const codes = schedIdx ? [...schedIdx.keys()] : [];
            sessionStorage.setItem(`ifc_cronograma_codes_${projectId}`, JSON.stringify(codes));
          }
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
      container.removeEventListener('dblclick', handleMeasureDblClick);
      window.removeEventListener('keydown', handleMeasureKey);
      lengthMeasurerRef.current = null;
      areaMeasurerRef.current   = null;
      volumeMeasurerRef.current = null;
      highlighterRef.current    = null;
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
    ...(selectedActivityIds.size > 0 ? [`${KIT_LABEL} (${selectedActivityIds.size})`] : []),
  ];

  const filteredMap = computeFilteredMap(multiIndex, filterState, activityKitCodes.size > 0 ? activityKitCodes : null);

  const totalActiveCount =
    IFC_PROPS.reduce((a, p) => a + (filterState[p]?.size ?? 0), 0) + selectedActivityIds.size;

  const statusText = activeFilterParts.length > 0
    ? `Filtrando: ${activeFilterParts.join(' · ')} → ${filteredMap ? countModelIdMap(filteredMap) : 0} elementos`
    : 'Clic en elemento para propiedades · Selecciona parámetros para filtrar';

  return (
    <div className="w-100 h-100 position-relative" style={{ overflow:'hidden' }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes recordPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
      `}</style>

      <div ref={containerRef} className="w-100 h-100" style={{ backgroundColor:'#cccccc' }} />

      {/* Measure panel */}
      {measurePanelVis ? (
        <MeasurePanel
          activeTool={activeMeasureTool}
          onToggle={handleToggleMeasureTool}
          onClear={handleClearMeasurements}
          onClose={() => { if (activeMeasureTool) handleToggleMeasureTool(activeMeasureTool); setMeasurePanelVis(false); }}
        />
      ) : (
        <button
          onClick={() => setMeasurePanelVis(true)}
          style={{
            position: 'absolute', top: '50%', left: '16px', transform: 'translateY(-50%)', zIndex: 1001,
            background: 'rgba(15,17,23,0.85)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '8px', color: '#94a3b8', cursor: 'pointer',
            padding: '8px 12px', fontSize: 13, backdropFilter: 'blur(8px)',
            fontFamily: '"IBM Plex Mono",monospace',
          }}
        >
          ⬢ Medición
          {activeMeasureTool && (
            <span style={{ marginLeft: 6, backgroundColor: '#f59e0b', color: '#0f1117', borderRadius: 8, fontSize: 10, padding: '1px 6px', fontWeight: 700 }}>
              1
            </span>
          )}
        </button>
      )}

      {/* Filter panel */}
      {filterPanelVis ? (
        <FilterPanel
          multiIndex={multiIndex}
          filterState={filterState}
          scanning={scanning}
          ifcActivities={ifcActivities}
          selectedActivityIds={selectedActivityIds}
          activityKitCodes={activityKitCodes}
          kitColorMap={kitColorMap}
          colorByKit={colorByKit}
          scheduleKitColorMap={scheduleKitColorMap}
          colorByCronKit={colorByCronKit}
          onToggle={handleToggle}
          onClearProp={handleClearProp}
          onClearAll={handleClearAll}
          onToggleActivity={handleToggleActivity}
          onClearActivities={handleClearActivities}
          onToggleColorByKit={() => setColorByKit(p => !p)}
          onToggleColorByCronKit={() => setColorByCronKit(p => !p)}
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

      {/* Timeliner panel / toggle button */}
      {timelinePanelVis ? (
        <TimelinePanel
          dateRange={timelineDateRange}
          currentDate={timelineDateStr}
          playing={timelinePlaying}
          duration={timelineDuration}
          kits={scheduleKits}
          multiIndex={multiIndex}
          doneColorMode={doneColorMode}
          doneUniformColor={doneUniformColor}
          recordingState={recordingState}
          onDateChange={d => { setTimelineDateStr(d); setTimelinePlaying(false); }}
          onTogglePlay={() => {
            if (!timelineDateRange) return;
            if (timelineDateStr >= timelineDateRange.end) setTimelineDateStr(addDays(timelineDateRange.start, -1));
            setTimelinePlaying(p => !p);
          }}
          onStop={() => {
            setTimelinePlaying(false);
            if (timelineDateRange) setTimelineDateStr(addDays(timelineDateRange.start, -1));
          }}
          onDurationChange={setTimelineDuration}
          onDoneColorModeChange={setDoneColorMode}
          onDoneUniformColorChange={setDoneUniformColor}
          onStartRecording={handleStartRecording}
          onStopRecording={handleStopRecording}
          onClose={() => {
            setTimelinePanelVis(false);
            setTimelineActive(false);
            setTimelinePlaying(false);
          }}
          hiddenKitCodes={hiddenKitCodes}
          onToggleHiddenKit={(code) => setHiddenKitCodes(prev => {
            const next = new Set(prev);
            next.has(code) ? next.delete(code) : next.add(code);
            return next;
          })}
          hiddenCategories={hiddenCategories}
          onToggleHiddenCategory={(cat) => setHiddenCategories(prev => {
            const next = new Set(prev);
            next.has(cat) ? next.delete(cat) : next.add(cat);
            return next;
          })}
        />
      ) : (
        <button
          onClick={() => {
            setTimelinePanelVis(true);
            if (timelineDateRange) {
              setTimelineActive(true);
              if (!timelineDateStr) setTimelineDateStr(addDays(timelineDateRange.start, -1));
            }
          }}
          style={{
            position: 'absolute', bottom: '44px', left: '50%', transform: 'translateX(-50%)',
            zIndex: 1000, background: 'rgba(15,17,23,0.85)',
            border: `1px solid ${timelineDateRange ? 'rgba(245,158,11,0.3)' : 'rgba(100,116,139,0.2)'}`,
            borderRadius: '8px',
            color: timelineDateRange ? '#f59e0b' : '#64748b',
            cursor: 'pointer', padding: '6px 14px', fontSize: 12,
            backdropFilter: 'blur(8px)', fontFamily: '"IBM Plex Mono",monospace',
            letterSpacing: '0.06em',
          }}
        >
          ◷ Timeliner
          {!timelineDateRange && (
            <span style={{ marginLeft: 6, fontSize: 9, opacity: 0.6 }}>
              {scanning ? 'escaneando…' : 'sin fechas'}
            </span>
          )}
        </button>
      )}

      {/* Status bar */}
      <div style={{
        position:'absolute', bottom:'16px', left:'50%', transform:'translateX(-50%)',
        backgroundColor:'rgba(15,17,23,0.7)', color: timelineActive ? '#f59e0b' : '#94a3b8', fontSize:11,
        padding:'5px 12px', borderRadius:20, backdropFilter:'blur(8px)',
        pointerEvents:'none', fontFamily:'"IBM Plex Mono",monospace',
        letterSpacing:'0.05em', zIndex:999, whiteSpace:'nowrap',
        maxWidth:'60%', overflow:'hidden', textOverflow:'ellipsis',
      }}>
        {timelineActive
          ? `◷ Timeliner activo · ${fmtDateES(timelineDateStr)}`
          : statusText}
      </div>
    </div>
  );
};

export default BimViewer;
