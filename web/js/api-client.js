// API Client — tries localhost:3001 (local API) or falls back to static JSON files
const API_BASE = 'http://localhost:3001';
const DATA_BASE = './data'; // static JSON exports (always available)

let apiOnline = false;

export async function checkApiStatus() {
  try {
    const res = await fetch(`${API_BASE}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    apiOnline = res.ok;
  } catch {
    apiOnline = false;
  }
  return apiOnline;
}

export function isApiOnline() {
  return apiOnline;
}

// --- Read-only (works from static files when API offline) ---

export async function getKpi() {
  if (apiOnline) {
    const res = await fetch(`${API_BASE}/api/reportes/kpi`);
    return res.json();
  }
  const res = await fetch(`${DATA_BASE}/kpi.json`);
  return res.json();
}

export async function getActivos() {
  if (apiOnline) {
    const res = await fetch(`${API_BASE}/api/reportes/activos`);
    return res.json();
  }
  const res = await fetch(`${DATA_BASE}/activos.json`);
  const json = await res.json();
  return json.data ?? json;
}

export async function getMovimientosRecientes(periodo = null) {
  if (apiOnline) {
    const qs = periodo ? `?periodo=${periodo}` : '';
    const res = await fetch(`${API_BASE}/api/movimientos/recientes${qs}`);
    return res.json();
  }
  const res = await fetch(`${DATA_BASE}/movimientos_recientes.json`);
  const json = await res.json();
  return json.data ?? json;
}

// --- Write operations (require API online) ---

export async function buscarDeportista(dni) {
  const res = await fetch(`${API_BASE}/api/deportistas/buscar?dni=${encodeURIComponent(dni)}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getCatalogos() {
  const res = await fetch(`${API_BASE}/api/deportistas/catalogos`);
  return res.json();
}

export async function crearDeportista(data) {
  const res = await fetch(`${API_BASE}/api/deportistas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error((await res.json()).error);
  return res.json();
}

export async function registrarMovimiento(data) {
  const res = await fetch(`${API_BASE}/api/movimientos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error((await res.json()).error);
  return res.json();
}

export async function exportarDatos() {
  const res = await fetch(`${API_BASE}/api/reportes/exportar`, { method: 'POST' });
  if (!res.ok) throw new Error((await res.json()).error);
  return res.json();
}

export async function actualizarCuenta(cod_deportista, data) {
  const res = await fetch(`${API_BASE}/api/deportistas/${cod_deportista}/cuenta`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error((await res.json()).error);
  return res.json();
}
