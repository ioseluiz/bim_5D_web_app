import { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import axios from 'axios';
import BimViewer from '../components/BimViewer';

interface BIMModel {
  id: number;
  nombre: string;
  archivo: string;
  version?: string;
  cargado_el: string;
}

interface Project {
  id: number;
  nombre: string;
  descripcion: string;
  bim_models: BIMModel[];
}

interface KitSummary {
  id: number;
  codigo_kit: string;
  nombre: string;
}

interface BudgetItem {
  id: number;
  cantidad: string;
  actividad_detail: { cu_total: string; activity_kit: number | null };
}

interface KitBudgetEntry {
  kit: KitSummary;
  total: number;
  itemCount: number;
}

const fmtBudget = (n: number) =>
  n.toLocaleString('es-PA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ProjectDetail = () => {
  const { id } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [selectedModel, setSelectedModel] = useState<BIMModel | null>(null);
  const [selectedElement, setSelectedElement] = useState<{ guid: string; category: string; tipo: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadData, setUploadData] = useState({
    nombre: '',
    version: '',
    archivo: null as File | null
  });
  const [isUploading, setIsUploading] = useState(false);

  // Budget summary state
  const [activeKitIds,  setActiveKitIds]  = useState<Set<number> | null>(null);
  const [masterKits,    setMasterKits]    = useState<KitSummary[]>([]);
  const [budgetItems,   setBudgetItems]   = useState<BudgetItem[]>([]);
  const [loadingBudget, setLoadingBudget] = useState(false);

  useEffect(() => {
    fetchProject();
  }, [id]);

  const fetchProject = async () => {
    try {
      const res = await axios.get(`http://localhost:8000/api/projects/${id}/`);
      setProject(res.data);
      // Mantener el modelo seleccionado si aún existe, o seleccionar el primero
      if (res.data.bim_models.length > 0) {
        if (!selectedModel || !res.data.bim_models.find((m: BIMModel) => m.id === selectedModel.id)) {
          setSelectedModel(res.data.bim_models[0]);
        }
      } else {
        setSelectedModel(null);
      }
      setLoading(false);
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  };

  // Fetch kits and budget whenever project id changes
  useEffect(() => {
    if (!id) return;
    fetch('http://localhost:8000/api/activity-kits/')
      .then(r => r.json())
      .then(setMasterKits)
      .catch(console.error);

    setLoadingBudget(true);
    fetch(`http://localhost:8000/api/budget-items/?proyecto=${id}`)
      .then(r => r.json())
      .then((data: BudgetItem[]) => { setBudgetItems(data); setLoadingBudget(false); })
      .catch(() => setLoadingBudget(false));
  }, [id]);

  // Group budget items by kit
  const budgetByKit = useMemo((): KitBudgetEntry[] => {
    const kitIndex = new Map(masterKits.map(k => [k.id, k]));
    const map = new Map<number, KitBudgetEntry>();
    for (const item of budgetItems) {
      const kitId = item.actividad_detail.activity_kit;
      if (!kitId) continue;
      const kit = kitIndex.get(kitId);
      if (!kit) continue;
      const cost = (parseFloat(item.cantidad) || 0) * (parseFloat(item.actividad_detail.cu_total) || 0);
      if (!map.has(kitId)) map.set(kitId, { kit, total: 0, itemCount: 0 });
      const e = map.get(kitId)!;
      e.total += cost;
      e.itemCount++;
    }
    return [...map.values()].sort((a, b) => (a.kit.codigo_kit || '').localeCompare(b.kit.codigo_kit || ''));
  }, [budgetItems, masterKits]);

  const filteredBudgetTotal = useMemo(() =>
    (activeKitIds ? budgetByKit.filter(e => activeKitIds.has(e.kit.id)) : budgetByKit)
      .reduce((s, e) => s + e.total, 0),
    [budgetByKit, activeKitIds],
  );

  const allBudgetTotal = useMemo(() =>
    budgetByKit.reduce((s, e) => s + e.total, 0),
    [budgetByKit],
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setUploadData(prev => ({ ...prev, archivo: e.target.files![0] }));
    }
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadData.archivo || !uploadData.nombre) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('proyecto', id!);
    formData.append('nombre', uploadData.nombre);
    formData.append('version', uploadData.version);
    formData.append('archivo', uploadData.archivo);

    try {
      await axios.post('http://localhost:8000/api/bim-models/', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      setShowUploadModal(false);
      setUploadData({ nombre: '', version: '', archivo: null });
      fetchProject();
    } catch (err) {
      console.error(err);
      alert('Error al subir el modelo IFC.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteModel = async (modelId: number) => {
    if (window.confirm('¿Desea eliminar este modelo BIM?')) {
      try {
        await axios.delete(`http://localhost:8000/api/bim-models/${modelId}/`);
        fetchProject();
      } catch (err) {
        console.error(err);
        alert('Error al eliminar el modelo.');
      }
    }
  };

  const handleElementSelect = (data: { guid: string; category: string; tipo: string }) => {
    setSelectedElement(data);
  };

  if (loading) return <div className="text-center mt-5"><div className="spinner-border text-primary"></div></div>;
  if (!project) return <div className="alert alert-danger">Proyecto no encontrado</div>;

  return (
    <div className="container-fluid py-3">
      <div className="row mb-3">
        <div className="col-12 d-flex justify-content-between align-items-center bg-white p-3 shadow-sm rounded border-start border-primary border-4">
          <div>
            <h3 className="mb-0 fw-bold">{project.nombre}</h3>
            <p className="text-muted mb-0 small">{project.descripcion || 'Sin descripción'}</p>
          </div>
          <div className="d-flex gap-2">
            <Link to="/projects" className="btn btn-outline-secondary btn-sm">
              <i className="bi bi-arrow-left me-1"></i>Volver
            </Link>
            <Link to={`/projects/${id}/kits`} className="btn btn-warning btn-sm fw-bold shadow-sm">
              <i className="bi bi-box-seam me-2"></i>Kits del Proyecto
            </Link>
            <Link to={`/projects/${id}/budget`} className="btn btn-success btn-sm fw-bold shadow-sm">
              <i className="bi bi-table me-2"></i>Presupuesto
            </Link>
            <button
              className="btn btn-primary btn-sm px-3 shadow-sm"
              onClick={() => setShowUploadModal(true)}
            >
              <i className="bi bi-cloud-upload me-2"></i>Subir IFC
            </button>
          </div>
        </div>
      </div>

      <div className="row g-3">
        <div className="col-lg-3">
          <div className="card shadow-sm border-0 mb-3">
            <div className="card-header bg-dark text-white fw-bold py-3 d-flex justify-content-between align-items-center">
              <span>Modelos BIM</span>
              <span className="badge bg-primary rounded-pill">{project.bim_models.length}</span>
            </div>
            <div className="list-group list-group-flush" style={{ maxHeight: '30vh', overflowY: 'auto' }}>
              {project.bim_models.length === 0 && (
                <div className="list-group-item text-center py-4 text-muted small italic">
                  <i className="bi bi-info-circle me-1"></i>No hay modelos cargados.
                </div>
              )}
              {project.bim_models.map(model => (
                <div 
                  key={model.id}
                  className={`list-group-item list-group-item-action d-flex justify-content-between align-items-center py-3 border-0 border-bottom ${selectedModel?.id === model.id ? 'bg-light border-start border-primary border-3 active-model' : ''}`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setSelectedModel(model)}
                >
                  <div className="d-flex align-items-center overflow-hidden">
                    <i className={`bi bi-box-fill me-3 ${selectedModel?.id === model.id ? 'text-primary' : 'text-muted'}`}></i>
                    <div className="text-truncate">
                      <div className={`fw-bold text-truncate ${selectedModel?.id === model.id ? 'text-primary' : ''}`}>{model.nombre}</div>
                      <div className="small text-muted">{model.version || 'v1.0'}</div>
                    </div>
                  </div>
                  <button 
                    className="btn btn-link text-danger p-0 ms-2 opacity-50 hover-opacity-100"
                    onClick={(e) => { e.stopPropagation(); handleDeleteModel(model.id); }}
                    title="Eliminar modelo"
                  >
                    <i className="bi bi-trash"></i>
                  </button>
                </div>
              ))}
            </div>
          </div>
          
          <div className="card shadow-sm border-0">
            <div className="card-header bg-primary text-white fw-bold">Propiedades del Elemento</div>
            <div className="card-body">
              {selectedElement ? (
                <div className="small">
                  <div className="mb-2">
                    <label className="text-muted d-block small">GUID</label>
                    <div className="fw-bold text-break font-monospace" style={{ fontSize: '0.8rem' }}>{selectedElement.guid}</div>
                  </div>
                  <div className="mb-2">
                    <label className="text-muted d-block small">Categoría / Nombre</label>
                    <div className="fw-bold">{selectedElement.category}</div>
                  </div>
                  <div className="mb-0">
                    <label className="text-muted d-block small">Tipo / ObjectType</label>
                    <div className="fw-bold text-truncate" title={selectedElement.tipo}>{selectedElement.tipo}</div>
                  </div>
                </div>
              ) : (
                <div className="d-flex flex-column align-items-center py-3 text-muted small">
                  <i className="bi bi-info-square display-6 mb-3 opacity-25"></i>
                  <p className="text-center mb-0">Haz <b>doble clic</b> en un elemento del visor para ver sus datos.</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="col-lg-9">
          <div className="card shadow-sm border-0 bg-dark rounded-3 overflow-hidden" style={{ height: '78vh', position: 'relative' }}>
            {selectedModel ? (
              <BimViewer
                ifcUrl={selectedModel.archivo}
                projectId={id}
                onElementSelect={handleElementSelect}
                onActiveKitIdsChange={setActiveKitIds}
              />
            ) : (
              <div className="h-100 d-flex flex-column align-items-center justify-content-center bg-light text-muted border border-dashed rounded-3">
                <div className="text-center p-5">
                  <i className="bi bi-view-stacked display-1 opacity-25 mb-4"></i>
                  <h4 className="fw-light">Visor BIM</h4>
                  <p>Seleccione un modelo del panel lateral para comenzar la visualización.</p>
                  {project.bim_models.length === 0 && (
                    <button className="btn btn-primary mt-2" onClick={() => setShowUploadModal(true)}>
                      Subir mi primer IFC
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Resumen de Presupuesto ── */}
      <div className="row mt-3">
        <div className="col-12">
          <div className="card shadow-sm border-0">
            <div className="card-header d-flex justify-content-between align-items-center bg-success text-white py-2 px-3">
              <span className="fw-bold small">
                <i className="bi bi-table me-2" />Resumen de Presupuesto
              </span>
              <div className="d-flex align-items-center gap-2">
                {activeKitIds && activeKitIds.size > 0 && (
                  <span className="badge bg-white text-success fw-bold">
                    <i className="bi bi-funnel-fill me-1" />
                    {activeKitIds.size} kit{activeKitIds.size !== 1 ? 's' : ''} filtrado{activeKitIds.size !== 1 ? 's' : ''} desde el visor
                  </span>
                )}
                <Link to={`/projects/${id}/budget`} className="btn btn-sm btn-outline-light py-0 px-2" style={{ fontSize: '0.75rem' }}>
                  Ver presupuesto completo →
                </Link>
              </div>
            </div>
            <div className="card-body p-0">
              {loadingBudget ? (
                <div className="text-center py-4">
                  <span className="spinner-border spinner-border-sm text-success me-2" />
                  <span className="text-muted small">Cargando presupuesto…</span>
                </div>
              ) : budgetByKit.length === 0 ? (
                <div className="text-center py-4 text-muted small">
                  <i className="bi bi-info-circle me-1" />
                  No hay presupuesto definido.{' '}
                  <Link to={`/projects/${id}/budget`}>Ir al presupuesto</Link> para sincronizarlo desde el IFC.
                </div>
              ) : (
                <div className="table-responsive">
                  <table className="table table-sm table-hover mb-0">
                    <thead className="table-light">
                      <tr>
                        <th className="ps-3" style={{ width: 110 }}>Código Kit</th>
                        <th>Kit de Costos</th>
                        <th className="text-center" style={{ width: 100 }}>Actividades</th>
                        <th className="text-end pe-3" style={{ width: 150 }}>Costo Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {budgetByKit.map(({ kit, total, itemCount }) => {
                        const isActive = !activeKitIds || activeKitIds.size === 0 || activeKitIds.has(kit.id);
                        return (
                          <tr key={kit.id} style={{ opacity: isActive ? 1 : 0.3, transition: 'opacity 0.2s' }}>
                            <td className="ps-3 align-middle">
                              <span className="badge bg-success font-monospace">{kit.codigo_kit || '—'}</span>
                            </td>
                            <td className="align-middle small">{kit.nombre}</td>
                            <td className="text-center align-middle small text-muted">{itemCount}</td>
                            <td className="text-end pe-3 align-middle fw-bold text-success font-monospace small">
                              ${fmtBudget(total)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="table-success">
                        <td colSpan={3} className="ps-3 fw-bold small">
                          {activeKitIds && activeKitIds.size > 0 ? 'Subtotal filtrado' : 'Total General'}
                        </td>
                        <td className="text-end pe-3 fw-bold font-monospace small">
                          ${fmtBudget(filteredBudgetTotal)}
                        </td>
                      </tr>
                      {activeKitIds && activeKitIds.size > 0 && (
                        <tr className="table-light">
                          <td colSpan={3} className="ps-3 text-muted small">Total proyecto</td>
                          <td className="text-end pe-3 text-muted small font-monospace">
                            ${fmtBudget(allBudgetTotal)}
                          </td>
                        </tr>
                      )}
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Modal Subir IFC */}
      {showUploadModal && (
        <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content border-0 shadow-lg">
              <div className="modal-header bg-primary text-white border-0 py-3">
                <h5 className="modal-title fw-bold">Cargar Modelo IFC</h5>
                <button type="button" className="btn-close btn-close-white" onClick={() => setShowUploadModal(false)}></button>
              </div>
              <form onSubmit={handleUploadSubmit}>
                <div className="modal-body p-4">
                  <div className="mb-3">
                    <label className="form-label fw-bold small">Nombre del Modelo</label>
                    <input 
                      type="text" 
                      className="form-control" 
                      value={uploadData.nombre} 
                      onChange={e => setUploadData(prev => ({ ...prev, nombre: e.target.value }))} 
                      required 
                      placeholder="Ej: Estructura Planta 1"
                    />
                  </div>
                  <div className="mb-3">
                    <label className="form-label fw-bold small">Versión</label>
                    <input 
                      type="text" 
                      className="form-control" 
                      value={uploadData.version} 
                      onChange={e => setUploadData(prev => ({ ...prev, version: e.target.value }))} 
                      placeholder="Ej: Rev-01"
                    />
                  </div>
                  <div className="mb-0">
                    <label className="form-label fw-bold small">Archivo IFC (.ifc)</label>
                    <input 
                      type="file" 
                      className="form-control" 
                      accept=".ifc" 
                      onChange={handleFileChange} 
                      required 
                    />
                    <div className="form-text mt-2 small">
                      <i className="bi bi-info-circle me-1"></i>
                      Se recomienda que el archivo no exceda los 50MB para un rendimiento óptimo en el visor.
                    </div>
                  </div>
                </div>
                <div className="modal-footer bg-light border-0 p-3">
                  <button type="button" className="btn btn-outline-secondary px-4" onClick={() => setShowUploadModal(false)}>Cancelar</button>
                  <button type="submit" className="btn btn-primary px-4 fw-bold" disabled={isUploading}>
                    {isUploading ? (
                      <>
                        <span className="spinner-border spinner-border-sm me-2"></span>
                        Cargando...
                      </>
                    ) : (
                      'Subir Modelo'
                    )}
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

export default ProjectDetail;
