// Si se accede desde la API local (puerto 8080), usar URLs relativas; si desde GitHub Pages, apuntar a localhost
const IS_LOCAL_API = location.port === '8080';
const API = IS_LOCAL_API ? '' : 'http://localhost:8080';
let online = false;
let cats = { asociaciones: [], niveles: [] };
let depData = [];
let depFilter = '';
let depSel = null;
let currentModule = null;

// Pagination for periodos list
let perioPage = 0;
const PERIO_PAGE_SIZE = 5;
let periodosFiltrados = [];

// Nomina PAD
let nominaData = [];
let nominaFilter = '';

// ── MSAL / ONEDRIVE ────────────────────────────────────────
const IS_LOCALHOST = ['localhost','127.0.0.1'].includes(location.hostname) || location.port === '8080';
const GESTION_PAD_USERS = ['apoyo19dinadaf@ipd.gob.pe', 'dzuta@ipd.gob.pe'];
const MSAL_CONFIG = {
  auth: {
    clientId: '4ebfc360-a6b5-4330-8a73-682768a95b64',
    authority: 'https://login.microsoftonline.com/19ccc9d6-ff9b-4dc4-914e-f195773cb1a2',
    redirectUri: location.origin + location.pathname,
    navigateToLoginRequestUrl: true,
  },
  cache: { cacheLocation: 'localStorage', storeAuthStateInCookie: true },
  system: { loggerOptions: { logLevel: 3 } }
};
const DRIVE_ID = 'b!T9pa18s7Q0ucS14QcR9bATc7WiT-ztVPqEwNfjLw_AOIF3HTHWRESYYKCB6vvSsO';
const GRAPH_SCOPES = ['https://graph.microsoft.com/Files.Read'];
let msalApp = null;
if (!IS_LOCALHOST) {
  try { msalApp = new msal.PublicClientApplication(MSAL_CONFIG); } catch(e) { showLoadingMsg('Error MSAL: ' + e.message); console.error('MSAL init failed:', e); }
}

async function getMsalToken() {
  if (!msalApp) return null;
  const accounts = msalApp.getAllAccounts();
  if (!accounts.length) return null;
  try {
    const r = await msalApp.acquireTokenSilent({ scopes: GRAPH_SCOPES, account: accounts[0] });
    return r.accessToken;
  } catch { return null; }
}

async function oneDriveJson(filename) {
  const token = await getMsalToken();
  if (!token) return null;
  try {
    const url = `https://graph.microsoft.com/v1.0/drives/${DRIVE_ID}/root:/pad-data/${filename}:/content`;
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    return r.ok ? r.json() : null;
  } catch { return null; }
}

function updateAuthUI() {
  const accounts = msalApp?.getAllAccounts() || [];
  const signed = accounts.length > 0;
  const btn = document.getElementById('btn-signin');
  if (btn) {
    btn.textContent = signed ? ('● ' + accounts[0].username) : '⬡ Iniciar sesión';
    btn.title = signed ? 'Sesión activa — datos OneDrive disponibles' : 'Iniciar sesión para ver datos en modo offline';
  }
}

async function msalSignIn() {
  if (!msalApp) return;
  const btn = document.getElementById('btn-signin');
  if (btn) btn.textContent = 'Redirigiendo...';
  try {
    await msalApp.loginRedirect({ scopes: GRAPH_SCOPES });
    // La página se redirige a Microsoft — el retorno lo maneja handleRedirectPromise() en INIT
  } catch(e) {
    toast('Error al iniciar sesión: ' + (e.errorCode || e.message), 'error');
    updateAuthUI();
  }
}

function showApp(account) {
  document.getElementById('loading-screen').style.display = 'none';
  document.getElementById('home-screen').classList.remove('hidden');
  if (account) {
    const userEmail = (account.username || '').toLowerCase();
    const email = document.getElementById('home-user-email');
    if (email) email.textContent = account.username || '';
    const btn = document.getElementById('btn-signin');
    if (btn) { btn.textContent = '● ' + (account.username||'Sesion activa'); btn.title = 'Sesion activa'; }

    // Mostrar tarjeta Gestion PAD solo a usuarios autorizados
    const mcGestion = document.getElementById('mc-gestion');
    const hasGestionAccess = IS_LOCALHOST || GESTION_PAD_USERS.includes(userEmail);
    if (mcGestion) mcGestion.style.display = hasGestionAccess ? 'block' : 'none';
  }
}

// ── API CHECK ──────────────────────────────────────────────
async function checkApi() {
  try {
    const r = await fetch(API + '/health', { signal: AbortSignal.timeout(2500) });
    online = r.ok;
  } catch { online = false; }

  // Sidebar indicator
  const dot = document.getElementById('api-dot');
  const txt = document.getElementById('api-txt');
  if (dot) dot.className = 'api-dot' + (online ? ' online' : '');
  if (txt) txt.textContent = online ? 'API local activa' : 'API local inactiva';

  // Home screen module card status
  const dotHome = document.getElementById('api-dot-home');
  const txtHome = document.getElementById('api-txt-home');
  if (dotHome) dotHome.className = 'api-dot' + (online ? ' online' : '');
  if (txtHome) txtHome.textContent = online ? 'API activa' : 'API inactiva';
  const mcStatus = document.getElementById('mc-gestion-status');
  if (mcStatus) {
    if (IS_LOCALHOST) {
      mcStatus.innerHTML = online
        ? '<span class="dot pulse"></span> API activa &mdash; disponible'
        : '<span class="dot gray"></span> API no disponible';
    } else {
      mcStatus.innerHTML = '<span class="dot gray"></span> Solo red local';
    }
  }
  const mc = document.getElementById('mc-gestion');
  if (mc) mc.classList.toggle('disabled', IS_LOCALHOST ? !online : true);

  // Inside-app offline bar
  const bar = document.getElementById('offline-bar');
  if (bar) bar.className = 'offline-bar' + (online ? '' : ' show');

  const exp = document.getElementById('btn-export');
  if (exp) exp.style.display = online ? 'inline-flex' : 'none';
  const nDep = document.getElementById('btn-nuevo-dep');
  if (nDep) nDep.style.display = online ? 'inline-flex' : 'none';

  return online;
}

// ── SECURITY: HTML ESCAPING ──────────────────────────────────
// Prevents XSS when inserting server/user data into innerHTML templates
function esc(str) {
  if (str == null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── FETCH HELPERS ──────────────────────────────────────────
// API key stored in sessionStorage — user enters once per session, never hardcoded.
function getApiKey() {
  let k = sessionStorage.getItem('pad_api_key');
  if (!k) {
    k = prompt('Ingrese la clave de acceso API:');
    if (k) sessionStorage.setItem('pad_api_key', k.trim());
  }
  return k || '';
}
function apiHeaders(extra = {}) {
  const h = { ...extra };
  if (IS_LOCAL_API) h['x-api-key'] = getApiKey();
  return h;
}
// Descarga segura: fetch con header + Blob (no expone key en URL)
async function fetchDownload(path, filename) {
  const r = await fetch(API + path, { headers: apiHeaders() });
  if (!r.ok) { toast('Error al generar reporte: ' + r.statusText, 'error'); return; }
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
async function apiGet(path) {
  const r = await fetch(API + path, { headers: apiHeaders() });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function apiPost(path, body) {
  const r = await fetch(API + path, { method: 'POST', headers: apiHeaders({'Content-Type':'application/json'}), body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Error');
  return j;
}
async function apiPut(path, body) {
  const r = await fetch(API + path, { method: 'PUT', headers: apiHeaders({'Content-Type':'application/json'}), body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Error');
  return j;
}
async function apiPatch(path, body) {
  const r = await fetch(API + path, { method: 'PATCH', headers: apiHeaders({'Content-Type':'application/json'}), body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Error');
  return j;
}

// ── TOAST SYSTEM ──
function toast(msg, tipo = 'success', titulo = null, dur = 5000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
  const el = document.createElement('div');
  el.className = `toast toast-${tipo}`;
  el.style.setProperty('--toast-dur', dur + 'ms');
  el.innerHTML = `
    <span class="toast-icon">${icons[tipo]||'ℹ'}</span>
    <div class="toast-body">
      ${titulo ? `<div class="toast-title">${esc(titulo)}</div>` : ''}
      <div class="toast-msg">${esc(msg)}</div>
    </div>
    <span class="toast-close">×</span>`;
  const dismiss = () => {
    el.classList.add('closing');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  };
  el.addEventListener('click', dismiss);
  container.appendChild(el);
  if (dur > 0) setTimeout(dismiss, dur);
  return el;
}

// ── CONFIRM DIALOG ──
function showConfirm(titulo, mensaje, onConfirm) {
  const overlay = document.getElementById('modal-confirm');
  document.getElementById('confirm-titulo').textContent = titulo;
  document.getElementById('confirm-msg').textContent = mensaje;
  document.getElementById('btn-confirm-ok')._handler = onConfirm;
  openModal('modal-confirm');
}
async function staticJson(f) {
  // Try OneDrive first (requires MSAL auth), then fall back to local static file
  const od = await oneDriveJson(f);
  if (od) return od;
  try { const r = await fetch('./data/' + f); return r.ok ? r.json() : null; } catch { return null; }
}

// ── DASHBOARD ──────────────────────────────────────────────
async function loadDashboard() {
  await Promise.all([loadKpis(), loadDashboardCharts()]);
}

async function loadKpis() {
  let k;
  try { k = online ? await apiGet('/api/reportes/kpi') : await staticJson('kpi.json'); } catch { k = await staticJson('kpi.json'); }
  if (!k) return;
  
  // Dashboard view
  const eDTotal = document.getElementById('d-total'); if (eDTotal) eDTotal.textContent = k.total_activos ?? '—';
  const eDMonto = document.getElementById('d-monto'); if (eDMonto && k.monto_mensual_total != null) eDMonto.textContent = 'S/ ' + Number(k.monto_mensual_total).toLocaleString('es-PE', {minimumFractionDigits:2});
  const eDPeriodo = document.getElementById('d-periodo'); if (eDPeriodo && k.periodo_actual) eDPeriodo.textContent = 'Subvención de ' + k.periodo_actual.slice(0,4) + '-' + k.periodo_actual.slice(4,6);

  // Home view stats
  const eKTotal = document.getElementById('k-total-mod'); if(eKTotal) eKTotal.textContent = k.total_activos ?? '—';
  const eKMonto = document.getElementById('k-monto-mod'); if(eKMonto && k.monto_mensual_total != null) eKMonto.textContent = 'Inversión mensual: S/ ' + Number(k.monto_mensual_total).toLocaleString('es-PE',{minimumFractionDigits:2});
  const eKPeriodo = document.getElementById('k-periodo-actual'); 
  if(eKPeriodo && k.periodo_actual) {
    eKPeriodo.textContent = k.periodo_actual.slice(0,4) + '-' + k.periodo_actual.slice(4,6);
    const ekest = document.getElementById('k-periodo-estado'); if(ekest) ekest.textContent = 'Subvención en curso';
  }
  
  if (k.exportado) document.getElementById('last-update').textContent = 'Al ' + new Date(k.exportado).toLocaleString('es-PE',{dateStyle:'short',timeStyle:'short'});
}

let chartFed, chartDemoPad1, chartDemoPad2, chartDemoPnm;
async function loadDashboardCharts() {
  let d;
  try {
    if (!online) return; // Charts currently require the live API
    d = await apiGet('/api/reportes/dashboard');
  } catch (err) { console.error(err); return; }
  if (!d) return;

  // 1. KPI Retention/Lesionados
  const cont = d.continuidad || {};
  const sumLes = (cont.lesionados_les || 0) + (cont.lesionados_lss || 0);
  const eDLes = document.getElementById('d-les'); if (eDLes) eDLes.textContent = sumLes;
  const eDLesDet = document.getElementById('d-les-det'); if (eDLesDet) eDLesDet.textContent = `LES: ${cont.lesionados_les||0} | LSS: ${cont.lesionados_lss||0}`;
  const eDVenc = document.getElementById('d-venc'); if (eDVenc) eDVenc.textContent = cont.vencimientos_30_dias || '0';

  // 2. Table of Federations
  const tbody = document.getElementById('t-feds');
  const feds = d.finanzas_federaciones || [];
  if (tbody) {
    if (feds.length) {
      tbody.innerHTML = feds.map(f => `<tr>
        <td>${esc(f.asociacion)}</td>
        <td style="text-align:center">${f.deportistas}</td>
        <td style="text-align:right;font-family:'JetBrains Mono',monospace">S/ ${Number(f.total_inversion).toLocaleString('es-PE',{minimumFractionDigits:2})}</td>
      </tr>`).join('');
    } else {
      tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:24px;color:var(--text3)">Sin datos</td></tr>';
    }
  }

  // 3. Render Chart - Federations (Top 10)
  if (chartFed) chartFed.destroy();
  const ctxFed = document.getElementById('chart-fed');
  if (ctxFed) {
    chartFed = new Chart(ctxFed, {
      type: 'bar',
      data: {
        labels: feds.slice(0,10).map(f => f.asociacion.slice(0,15)+'...'),
        datasets: [{
          label: 'S/',
          data: feds.slice(0,10).map(f => f.total_inversion),
          backgroundColor: '#C8102E',
          borderRadius: 4
        }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
  }

  // 4. Render Chart - Demographics
  [chartDemoPad1, chartDemoPad2, chartDemoPnm].forEach(c => c && c.destroy());
  const demo = d.demografia || [];
  const grouped = {};
  demo.forEach(r => {
    const type = r.cod_tipo_pad;
    if (!grouped[type]) grouped[type] = {M:0, F:0};
    if (r.sexo==='M') grouped[type].M += r.cantidad;
    else grouped[type].F += r.cantidad;
  });
  const colorMap = { PAD1: ['#2563EB','#93C5FD'], PAD2: ['#16A34A','#86EFAC'], PNM: ['#9333EA','#D8B4FE'] };
  const demoConfig = [
    { id: 'chart-demo-pad1', key: 'PAD1', ref: 'chartDemoPad1' },
    { id: 'chart-demo-pad2', key: 'PAD2', ref: 'chartDemoPad2' },
    { id: 'chart-demo-pnm',  key: 'PNM',  ref: 'chartDemoPnm'  },
  ];
  const makePieTooltip = () => ({
    callbacks: {
      label: ctx => {
        const total = ctx.dataset.data.reduce((a,b)=>a+b,0);
        const pct = total ? ((ctx.parsed / total)*100).toFixed(1) : 0;
        return ` ${ctx.label}: ${ctx.parsed} (${pct}%)`;
      }
    }
  });
  const charts = [null, null, null];
  demoConfig.forEach((cfg, i) => {
    const ctx = document.getElementById(cfg.id);
    if (!ctx) return;
    const g = grouped[cfg.key] || {M:0, F:0};
    const [cM, cF] = colorMap[cfg.key] || ['#64748B','#CBD5E1'];
    charts[i] = new Chart(ctx, {
      type: 'pie',
      data: {
        labels: ['Masculino', 'Femenino'],
        datasets: [{ data: [g.M, g.F], backgroundColor: [cM, cF], borderWidth: 2, borderColor: '#fff' }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 8 } },
          tooltip: makePieTooltip()
        }
      }
    });
  });
  [chartDemoPad1, chartDemoPad2, chartDemoPnm] = charts;
}

// ── DEPORTISTAS ──────────────────────────────────────────────
let depPage = 1;
const DEP_PER_PAGE = 25;
let depFiltered = [];

async function loadDep() {
  let d;
  try { d = online ? await apiGet('/api/reportes/todos') : (await staticJson('activos.json'))?.data ?? await staticJson('activos.json'); } catch { d = null; }
  depData = d || [];
  depFiltered = [...depData];
  depPage = 1;
  renderDep();
  // Poblar select de asociaciones en modal de edición
  if (cats.asociaciones && cats.asociaciones.length) {
    const sel = document.getElementById('ed-asoc');
    if (sel && sel.options.length <= 1) {
      cats.asociaciones.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a.cod_asociacion;
        opt.textContent = a.nombre;
        sel.appendChild(opt);
      });
    }
  }
}

function setDepPage(page) {
  depPage = page;
  renderDep();
}

function renderDep() {
  document.getElementById('dep-count').textContent = depFiltered.length + ' registros';
  const tbody = document.getElementById('t-dep');
  const pag = document.getElementById('dep-pagination');
  
  if (!depFiltered.length) { 
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text3)">Sin registros</td></tr>'; 
    pag.innerHTML = '';
    return; 
  }
  
  const totalPages = Math.ceil(depFiltered.length / DEP_PER_PAGE);
  if (depPage < 1) depPage = 1;
  if (depPage > totalPages) depPage = totalPages;
  
  const start = (depPage - 1) * DEP_PER_PAGE;
  const pageData = depFiltered.slice(start, start + DEP_PER_PAGE);
  
  tbody.innerHTML = pageData.map(r => `<tr>
    <td class="mono">${r.num_documento||'—'}</td>
    <td>${esc(r.deportista||(r.ap_paterno+' '+r.ap_materno+', '+r.nombres))}</td>
    <td>${esc(r.asociacion)||'—'}</td>
    <td style="text-align:center">${r.sexo||'—'}</td>
    <td><span class="badge badge-${(r.cod_estado_pad||'ret').toLowerCase()}">${r.cod_estado_pad==='ACT'?'Activo':'Retirado'}</span></td>
    <td>${online?`<button class="btn-edit" onclick="verDep(${r.cod_deportista||0})">&#9998; Editar</button>`:''}</td></tr>`).join('');
    
  // Render controls
  let pagHtml = '';
  if (totalPages > 1) {
    pagHtml += `<button class="btn btn-secondary" style="padding:4px 8px; font-size:12px;" onclick="setDepPage(1)" ${depPage === 1 ? 'disabled' : ''}>&laquo;</button>`;
    pagHtml += `<button class="btn btn-secondary" style="padding:4px 8px; font-size:12px;" onclick="setDepPage(${depPage - 1})" ${depPage === 1 ? 'disabled' : ''}>&lsaquo;</button>`;
    pagHtml += `<span style="font-size:12px; align-self:center; color:var(--text2);">Pág ${depPage} de ${totalPages}</span>`;
    pagHtml += `<button class="btn btn-secondary" style="padding:4px 8px; font-size:12px;" onclick="setDepPage(${depPage + 1})" ${depPage === totalPages ? 'disabled' : ''}>&rsaquo;</button>`;
    pagHtml += `<button class="btn btn-secondary" style="padding:4px 8px; font-size:12px;" onclick="setDepPage(${totalPages})" ${depPage === totalPages ? 'disabled' : ''}>&raquo;</button>`;
  }
  pag.innerHTML = pagHtml;
}

function filterDep() {
  const q = document.getElementById('q-dep').value.toLowerCase();
  const f = depFilter;
  depFiltered = depData.filter(r => {
    const nombre = (r.deportista||(r.ap_paterno+' '+r.ap_materno+' '+r.nombres)||'').toLowerCase();
    const match = !q || nombre.includes(q) || (r.num_documento||'').includes(q) || (r.asociacion||'').toLowerCase().includes(q);
    const filt = !f || r.cod_tipo_pad === f || r.cod_estado_pad === f;
    return match && filt;
  });
  depPage = 1;
  renderDep();
}

function verDep(cod) {
  if (!online) return;
  apiGet('/api/deportistas/' + cod).then(d => {
    if (!d) return;
    document.getElementById('ed-cod').value       = d.cod_deportista;
    document.getElementById('ed-doc').value        = d.num_documento || '';
    document.getElementById('ed-tipo-doc').value   = d.tipo_documento || 'DNI';
    document.getElementById('ed-ap-pat').value     = d.ap_paterno || '';
    document.getElementById('ed-ap-mat').value     = d.ap_materno || '';
    document.getElementById('ed-nombres').value    = d.nombres || '';
    document.getElementById('ed-sexo').value       = d.sexo || 'M';
    document.getElementById('ed-fecha-nac').value  = d.fecha_nac ? d.fecha_nac.slice(0,10) : '';
    document.getElementById('ed-asoc').value       = d.cod_asociacion || '';
    document.getElementById('ed-cuenta').value     = d.num_cuenta || '';
    document.getElementById('ed-correo').value     = d.correo || '';
    document.getElementById('ed-telefono').value   = d.telefono || '';
    document.getElementById('ed-agrupacion').value = d.agrupacion || '';
    document.getElementById('modal-edit-dep-titulo').textContent =
      d.ap_paterno + ' ' + d.ap_materno + ', ' + d.nombres;
    openModal('modal-edit-dep');
  }).catch(e => toast(e.message, 'error'));
}

// ── CAMBIOS PAD — PERIODOS ─────────────────────────────────
let periodosData = [];
let periodoDetalle = null;
let periodoDetalleData = [];

async function loadCambios() {
  const offMsg = document.getElementById('cambios-offline-msg');
  const btnNuevo = document.getElementById('btn-nuevo-cambio');
  if (!online) {
    if (offMsg) offMsg.style.display = 'flex';
    if (btnNuevo) btnNuevo.style.display = 'none';
    document.getElementById('t-periodos').innerHTML = '<tr><td colspan="5" style="text-align:center;padding:32px;color:var(--text3)">API no disponible.</td></tr>';
    return;
  }
  if (offMsg) offMsg.style.display = 'none';
  if (btnNuevo) btnNuevo.style.display = 'inline-flex';
  try {
    periodosData = await apiGet('/api/movimientos/periodos');
    renderPeriodos(periodosData);
  } catch(e) {
    document.getElementById('t-periodos').innerHTML = `<tr><td colspan="5" style="text-align:center;padding:32px;color:var(--danger)">Error: ${esc(e.message)}</td></tr>`;
  }
}

function renderPeriodos(data) {
  periodosFiltrados = data || [];
  perioPage = 0;
  renderPeriodosPage();
}

function renderPeriodosPage() {
  const data = periodosFiltrados;
  const tbody = document.getElementById('t-periodos');
  const paginEl = document.getElementById('periodos-pagination');

  if (!data?.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:32px;color:var(--text3)">No hay periodos registrados.</td></tr>';
    if (paginEl) paginEl.innerHTML = '';
    return;
  }

  const start = perioPage * PERIO_PAGE_SIZE;
  const page  = data.slice(start, start + PERIO_PAGE_SIZE);
  const totalPages = Math.ceil(data.length / PERIO_PAGE_SIZE);

  tbody.innerHTML = page.map(p => {
    const per = p.periodo;
    const label = per.slice(0,4)+'-'+per.slice(4,6);
    const cerrado = p.cerrado == 1;
    return `<tr class="${cerrado?'period-closed':''}">
      <td style="font-weight:600;font-family:'JetBrains Mono',monospace">${label}</td>
      <td style="text-align:center;font-weight:600">${p.cantidad_registros}</td>
      <td style="text-align:center"><span class="${cerrado?'period-badge-closed':'period-badge-open'}">${cerrado?'Cerrado':'Abierto'}</span></td>
      <td style="text-align:center">
        <div style="display:flex;gap:6px;justify-content:center">
          <button class="btn-icon btn-dl" title="Exportar PDF" onclick="descargarCambiosPeriodo('pdf','${per}')">&#8595;pdf</button>
        </div>
      </td>
      <td style="text-align:center">
        <button class="btn-icon btn-edit" title="${cerrado?'Ver cambios del periodo':'Ver y editar cambios del periodo'}" onclick="verDetallePeriodo('${per}')">${cerrado?'&#128269;':'&#9998;'}</button>
      </td>
    </tr>`;
  }).join('');

  // Pagination controls
  if (paginEl) {
    if (totalPages <= 1) {
      paginEl.innerHTML = '';
    } else {
      paginEl.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:flex-end;gap:10px;padding:10px 16px;border-top:1px solid var(--border);font-size:13px">
          <button class="btn btn-secondary btn-sm" ${perioPage===0?'disabled':''} onclick="goPerioPage(${perioPage-1})">&#8592;</button>
          <span style="color:var(--text2);font-weight:600">${perioPage+1} / ${totalPages}</span>
          <button class="btn btn-secondary btn-sm" ${perioPage>=totalPages-1?'disabled':''} onclick="goPerioPage(${perioPage+1})">&#8594;</button>
        </div>`;
    }
  }
}

function goPerioPage(page) {
  perioPage = page;
  renderPeriodosPage();
}

function filterPeriodos() {
  const q = document.getElementById('q-periodos').value.toLowerCase().replace('-','');
  renderPeriodos(periodosData.filter(p => p.periodo.toLowerCase().includes(q)));
}

async function verDetallePeriodo(periodo) {
  periodoDetalle = periodo;
  document.getElementById('cambios-periodos-view').style.display = 'none';
  document.getElementById('cambios-detalle-view').style.display = 'block';
  const label = periodo.slice(0,4)+'-'+periodo.slice(4,6);
  document.getElementById('detalle-periodo-titulo').textContent = 'Periodo '+label;
  // Check if closed
  const pd = periodosData.find(p => p.periodo === periodo);
  const cerrado = pd?.cerrado == 1;
  document.getElementById('detalle-estado-badge').innerHTML = cerrado
    ? '<span class="period-badge-closed">Cerrado</span>'
    : '<span class="period-badge-open">Abierto</span>';
  document.getElementById('btn-cerrar-periodo').style.display = cerrado ? 'none' : 'inline-flex';
  document.getElementById('btn-nuevo-en-periodo').style.display = cerrado ? 'none' : 'inline-flex';
  // Set periodo in the form's period field when creating new
  const inp = document.getElementById('inp-periodo');
  if (inp) inp.value = periodo.slice(0,4)+'-'+periodo.slice(4,6);
  await loadDetallePeriodo(periodo);
}

async function loadDetallePeriodo(periodo) {
  const tbody = document.getElementById('t-detalle-cambios');
  tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:32px;color:var(--text3)">Cargando...</td></tr>';
  try {
    periodoDetalleData = await apiGet('/api/movimientos/periodo/'+periodo);
    renderDetalle(periodoDetalleData);
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:32px;color:var(--danger)">Error: ${esc(e.message)}</td></tr>`;
  }
}

function renderDetalle(data) {
  const lbl = {ING:'Ingreso',CAMBNIV:'Cambio nivel',RET:'Retiro'};
  const cls = {ING:'badge-ing',CAMBNIV:'badge-cambniv',RET:'badge-retiro'};
  const tbody = document.getElementById('t-detalle-cambios');
  if (!data?.length) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:32px;color:var(--text3)">Sin cambios en este periodo.</td></tr>';
    return;
  }
  // Check if period is closed
  const pd = periodosData.find(p => p.periodo === periodoDetalle);
  const cerrado = pd?.cerrado == 1;
  tbody.innerHTML = data.map((r,i) => `<tr>
    <td style="color:var(--text3)">${i+1}</td>
    <td><span class="badge ${cls[r.cod_tip_mov]||''}" style="font-size:10px">${lbl[r.cod_tip_mov]||r.cod_tip_mov}</span></td>
    <td style="font-size:12px">${esc(r.deportista||r.num_documento)}</td>
    <td class="mono" style="font-size:11px">${r.num_documento||'—'}</td>
    <td><span class="badge badge-${(r.cod_tipo_pad||'').toLowerCase()}" style="font-size:10px">${(r.cod_tipo_pad||'').replace('PAD1','P.I').replace('PAD2','P.II')}</span></td>
    <td style="font-size:11px">${r.nivel_anterior||'—'}</td>
    <td style="font-size:11px">${r.nivel_nuevo||'—'}</td>
    <td class="mono" style="font-size:10px">${r.nro_informe||'—'}</td>
    <td class="mono" style="font-size:10px">${r.expedientes||'—'}</td>
    <td>${cerrado ? '' : `<button class="btn btn-ghost btn-sm" style="font-size:11px" onclick="editarCambio(${r.cod_cambio})">&#9998;</button>`}</td>
  </tr>`).join('');
}

let detalleSortCol = null;
let detalleSortAsc = true;

function sortDetalle(col) {
  if (detalleSortCol === col) detalleSortAsc = !detalleSortAsc;
  else { detalleSortCol = col; detalleSortAsc = true; }
  const sorted = [...periodoDetalleData].sort((a,b) => {
    const va = (a[col]||'').toString().toLowerCase();
    const vb = (b[col]||'').toString().toLowerCase();
    return detalleSortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
  });
  renderDetalle(sorted);
}

// ── GENERIC TABLE SORTING ─────────────────────────────────
let tableSortState = {};
function sortTable(table, col) {
  if (!tableSortState[table]) tableSortState[table] = { col: null, asc: true };
  const st = tableSortState[table];
  if (st.col === col) st.asc = !st.asc;
  else { st.col = col; st.asc = true; }

  const getVal = (r, col) => {
    switch(col) {
      case 'nombre': return (r.deportista||(r.ap_paterno+' '+r.ap_materno+', '+r.nombres)||'').toLowerCase();
      case 'asociacion': return (r.asociacion||'').toLowerCase();
      case 'programa': return (r.cod_tipo_pad||'').toLowerCase();
      case 'nivel': return (r.nivel_desc||r.cod_nivel||'').toLowerCase();
      case 'estado': return (r.cod_estado_pad||'').toLowerCase();
      case 'sexo': return (r.sexo||'').toLowerCase();
      case 'fecha_ingreso': return r.fecha_ingreso||'';
      case 'monto': return parseFloat(r.monto_soles||0);
      default: return (r[col]||'').toString().toLowerCase();
    }
  };

  const sorter = (a,b) => {
    const va = getVal(a, col), vb = getVal(b, col);
    const cmp = typeof va === 'number' ? va - vb : va.toString().localeCompare(vb.toString());
    return st.asc ? cmp : -cmp;
  };

  if (table === 'dep') { depData.sort(sorter); filterDep(); }
  else if (table === 'nomina') { nominaData.sort(sorter); filterNomina(); }
  else if (table === 'cons') { consData.sort(sorter); renderConsTable(); }
  else if (table === 'eco') { ecoData.sort(sorter); renderEcoTable(); }
}

function filterDetalle() {
  const q = document.getElementById('q-detalle').value.toLowerCase();
  renderDetalle(periodoDetalleData.filter(r => {
    return !q || (r.deportista||'').toLowerCase().includes(q)
      || (r.num_documento||'').includes(q)
      || (r.expedientes||'').toLowerCase().includes(q)
      || (r.nro_informe||'').toLowerCase().includes(q);
  }));
}

function volverAPeriodos() {
  periodoDetalle = null;
  document.getElementById('cambios-detalle-view').style.display = 'none';
  document.getElementById('cambios-periodos-view').style.display = 'block';
  loadCambios();
}

async function cerrarPeriodoActual() {
  if (!periodoDetalle) return;
  const label = periodoDetalle.slice(0,4)+'-'+periodoDetalle.slice(4,6);
  if (!confirm(`¿Cerrar el periodo ${label}? Una vez cerrado no se podran agregar ni editar cambios en este periodo.`)) return;
  try {
    await apiPost('/api/movimientos/periodos/'+periodoDetalle+'/cerrar', { usuario: document.getElementById('home-user-email')?.textContent || 'sistema' });
    await loadCambios(); // refresh periods data
    await verDetallePeriodo(periodoDetalle);
  } catch(e) { alert('Error al cerrar: '+e.message); }
}

function descargarCambiosPeriodo(format, periodo) {
  if (!online) { alert('API local no disponible'); return; }
  fetchDownload(`/api/pdf/cambios-pad?periodo=${periodo}`, `cambios-pad-${periodo}.pdf`);
}

function abrirNuevoCambio() {
  if (!online) { alert('API local no disponible'); return; }
  openModal('modal-cambio');
  // Pre-set period if we're in a period detail view
  if (periodoDetalle) {
    const inp = document.getElementById('inp-periodo');
    if (inp) inp.value = periodoDetalle.slice(0,4)+'-'+periodoDetalle.slice(4,6);
  }
  fillNiveles();
  // Initialize expedientes
  initExpedientes();
}

function toggleNivelesCambio() {
  const esCambniv = document.getElementById('ec-tipo-mov').value === 'CAMBNIV';
  document.getElementById('ec-grupo-nivel-ant').style.display = esCambniv ? '' : 'none';
  document.getElementById('ec-grupo-nivel-nuevo').style.display = esCambniv ? '' : 'none';
}

function editarCambio(cod_cambio) {
  const r = periodoDetalleData?.find(x => x.cod_cambio === cod_cambio);
  if (!r) return;
  document.getElementById('ec-cod').value        = cod_cambio;
  document.getElementById('ec-tipo-mov').value   = r.cod_tip_mov || 'ING';
  document.getElementById('ec-nro-informe').value= r.nro_informe || '';
  document.getElementById('ec-nivel-anterior').value = r.nivel_anterior || '';
  document.getElementById('ec-nivel-nuevo').value    = r.nivel_nuevo    || '';
  document.getElementById('ec-motivo').value     = r.motivo || '';
  document.getElementById('modal-edit-cambio-sub').textContent =
    `${r.deportista || r.num_documento} · Periodo ${periodoDetalle?.slice(0,4)+'-'+periodoDetalle?.slice(4,6)}`;
  toggleNivelesCambio();
  openModal('modal-edit-cambio');
}

async function saveEditCambio() {
  const cod_cambio = parseInt(document.getElementById('ec-cod').value);
  const tipo = document.getElementById('ec-tipo-mov').value;
  const body = {
    cod_tip_mov:    tipo,
    nro_informe:    document.getElementById('ec-nro-informe').value.trim() || null,
    motivo:         document.getElementById('ec-motivo').value.trim() || null,
    nivel_anterior: tipo === 'CAMBNIV' ? document.getElementById('ec-nivel-anterior').value.trim() || null : null,
    nivel_nuevo:    tipo === 'CAMBNIV' ? document.getElementById('ec-nivel-nuevo').value.trim() || null : null,
  };
  const btn = document.getElementById('btn-save-cambio');
  btn.setAttribute('aria-busy','true');
  try {
    await apiPatch(`/api/movimientos/${cod_cambio}`, body);
    closeModal('modal-edit-cambio');
    toast('Cambio actualizado correctamente', 'success');
    await loadDetallePeriodo(periodoDetalle);
  } catch(e) {
    toast('Error al guardar: ' + e.message, 'error');
  } finally {
    btn.removeAttribute('aria-busy');
  }
}

// ── EXPEDIENTES MULTIPLES ─────────────────────────────────
function initExpedientes() {
  const c = document.getElementById('expedientes-container');
  c.innerHTML = '';
  agregarExpediente();
}

function agregarExpediente() {
  const c = document.getElementById('expedientes-container');
  const idx = c.children.length;
  const div = document.createElement('div');
  div.className = 'exp-row';
  div.innerHTML = `
    <div class="form-group" style="margin:0">
      <input placeholder="Nro. expediente" class="exp-nro" style="padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius);font-size:13px;width:100%">
    </div>
    <div class="form-group" style="margin:0">
      <select class="exp-tipo" style="padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius);font-size:13px;width:100%;font-family:inherit">
        <option value="EXPEDIENTE">Expediente</option>
        <option value="INFORME">Informe</option>
        <option value="OFICIO">Oficio</option>
        <option value="RESOLUCION">Resolucion</option>
        <option value="OTRO">Otro</option>
      </select>
    </div>
    <button type="button" class="btn-icon btn-lock" title="Eliminar" onclick="this.parentElement.remove()" style="flex-shrink:0">&times;</button>`;
  c.appendChild(div);
}

function getExpedientes() {
  return Array.from(document.querySelectorAll('#expedientes-container .exp-row'))
    .map(row => ({
      nro_expediente: row.querySelector('.exp-nro').value.trim(),
      tipo_documento: row.querySelector('.exp-tipo').value
    }))
    .filter(e => e.nro_expediente);
}

// ── GIRO PREVIEW ──────────────────────────────────────────
async function previewGiro() {
  if (!online) { alert('API local no disponible'); return; }
  const tipo = document.getElementById('sel-tipo-giro')?.value || 'PAD1';
  const inp = document.getElementById('inp-periodo-giro');
  const periodo = inp?.value ? inp.value.replace('-','') : currentPeriodo();
  const tipoLabel = tipo === 'PAD1' ? 'PAD I' : tipo === 'PAD2' ? 'PAD II' : 'PNM';
  document.getElementById('giro-preview-wrap').style.display = 'block';
  document.getElementById('giro-preview-title').textContent = `Preview GIRO — ${tipoLabel} Periodo ${periodo.slice(0,4)}-${periodo.slice(4,6)}`;
  document.getElementById('t-giro-preview').innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--text3)">Cargando...</td></tr>';
  try {
    const d = await apiGet(`/api/reportes/activos?tipo=${tipo}&periodo=${periodo}`);
    const rows = d.slice(0,25);
    document.getElementById('giro-preview-count').textContent = `Mostrando ${rows.length} de ${d.length} registros`;
    document.getElementById('t-giro-preview').innerHTML = rows.map((r,i) => `<tr>
      <td>${i+1}</td>
      <td style="font-size:11px">${esc(r.asociacion)||'—'}</td>
      <td>${esc(r.deportista||(r.ap_paterno+' '+r.ap_materno+', '+r.nombres))}</td>
      <td class="mono" style="font-size:11px">${r.num_documento||'—'}</td>
      <td style="font-size:11px">${r.nivel_desc||r.cod_nivel||'—'}</td>
      <td class="mono" style="font-size:11px">${r.num_cuenta||'—'}</td>
      <td class="mono">S/ ${r.monto_soles?Number(r.monto_soles).toLocaleString('es-PE',{minimumFractionDigits:2}):'—'}</td>
      <td style="text-align:center">${!r.num_cuenta?'<span class="badge badge-retiro" style="font-size:10px">OPE</span>':''}</td>
    </tr>`).join('');
  } catch(e) {
    document.getElementById('t-giro-preview').innerHTML = `<tr><td colspan="8" style="color:var(--danger);padding:16px">${esc(e.message)}</td></tr>`;
  }
}

// ── REPORT DOWNLOADS ──────────────────────────────────────
function currentPeriodo() {
  const d = new Date();
  return d.getFullYear() + String(d.getMonth()+1).padStart(2,'0');
}

async function descargarReporte(format, report, selId) {
  if (!online) { alert('API local no disponible'); return; }
  const tipo = document.getElementById(selId || 'sel-tipo-cons')?.value || 'PAD1';
  const periodoInput = report.includes('economico')
    ? document.getElementById('inp-periodo-cons-eco')
    : document.getElementById('inp-periodo-cons-tec');
  const periodo = periodoInput?.value ? periodoInput.value.replace('-','') : currentPeriodo();

  if (report === 'consolidado-tecnico' || report === 'consolidado-economico') {
    try {
      const perList = await apiGet('/api/movimientos/periodos');
      const pData = perList.find(p => p.periodo === periodo);
      if (!pData || !pData.cerrado) {
        alert(`❌ El periodo ${periodo.slice(0,4)}-${periodo.slice(4,6)} no está cerrado.\nSolo se pueden generar consolidados de periodos finalizados y cerrados en Cambio PAD.`);
        return;
      }
    } catch(e) {
      console.warn('Period verification failed', e);
    }
  }

  const ext = format === 'excel' ? 'xlsx' : 'pdf';
  fetchDownload(`/api/${format}/${report}?tipo=${tipo}&periodo=${periodo}`, `${report}_${tipo}_${periodo}.${ext}`);
}

function descargarCambiosPdf() {
  if (!online) { alert('API local no disponible'); return; }
  const inp = document.getElementById('inp-periodo-cambios');
  const periodo = inp?.value ? inp.value.replace('-','') : currentPeriodo();
  fetchDownload(`/api/pdf/cambios-pad?periodo=${periodo}`, `cambios-pad-${periodo}.pdf`);
}

async function descargarGiro() {
  if (!online) { alert('API local no disponible'); return; }
  const tipo = document.getElementById('sel-tipo-giro')?.value || 'PAD1';
  const inp = document.getElementById('inp-periodo-giro');
  const periodo = inp?.value ? inp.value.replace('-','') : currentPeriodo();
  // Validar que el periodo esté cerrado
  try {
    const perList = await apiGet('/api/movimientos/periodos');
    const pData = perList.find(p => p.periodo === periodo);
    if (!pData || !pData.cerrado) {
      alert(`❌ El periodo ${periodo.slice(0,4)}-${periodo.slice(4,6)} no está cerrado.\nSolo se pueden generar giros de periodos finalizados y cerrados en Cambio PAD.`);
      return;
    }
  } catch(e) { console.warn('Period verification failed', e); }
  fetchDownload(`/api/excel/giro?tipo=${tipo}&periodo=${periodo}`, `GIRO_${tipo}_${periodo}.xlsx`);
}

// ── ORGANIZACIONES ──────────────────────────────────────────
async function loadOrgs() {
  const tbody = document.getElementById('t-orgs');
  if (!tbody) return;
  try {
    const data = online
      ? await apiGet('/api/deportistas/organizaciones/lista')
      : (await staticJson('asociaciones.json')) || [];
    document.getElementById('orgs-count').textContent = data.length + ' organizaciones';
    tbody.innerHTML = data.map(o => `<tr>
      <td class="mono">${o.cod_asociacion}</td>
      <td><strong>${o.nombre}</strong></td>
      <td style="font-size:12px;color:var(--text2)">${o.nombre_formal||'—'}</td>
      <td><span class="badge" style="background:var(--blue-light);color:var(--blue)">${o.tipo_organizacion||'—'}</span></td>
      <td>${o.activo ? '<span class="badge badge-act">Activo</span>' : '<span class="badge badge-ret">Inactivo</span>'}</td>
      <td>${online ? `<button class="btn-edit" onclick="editOrg(${o.cod_asociacion})">&#9998; Editar</button>` : ''}</td>
    </tr>`).join('');
  } catch(e) { toast('Error cargando organizaciones: '+e.message, 'error'); }
}

function editOrg(cod) {
  apiGet('/api/deportistas/organizaciones/lista').then(data => {
    const o = data.find(x => x.cod_asociacion === cod);
    if (!o) return;
    document.getElementById('eo-cod').value          = o.cod_asociacion;
    document.getElementById('eo-nombre').value       = o.nombre || '';
    document.getElementById('eo-nombre-formal').value= o.nombre_formal || '';
    document.getElementById('eo-tipo').value         = o.tipo_organizacion || 'FEDERACION';
    document.getElementById('eo-disciplina').value   = o.disciplina || '';
    document.getElementById('eo-activo').checked     = !!o.activo;
    document.getElementById('modal-edit-org-titulo').textContent = o.nombre;
    openModal('modal-edit-org');
  }).catch(e => toast(e.message, 'error'));
}

async function saveEditOrg() {
  const cod = document.getElementById('eo-cod').value;
  const body = {
    nombre:            document.getElementById('eo-nombre').value.trim(),
    nombre_formal:     document.getElementById('eo-nombre-formal').value.trim() || null,
    tipo_organizacion: document.getElementById('eo-tipo').value,
    disciplina:        document.getElementById('eo-disciplina').value.trim() || null,
    activo:            document.getElementById('eo-activo').checked,
  };
  // Doble confirmación
  showConfirm(
    'Confirmar edición de organización',
    `¿Guardar los cambios en <strong>${body.nombre}</strong>? Esta acción actualiza los datos en la base de datos.`,
    async () => {
      const btn = document.getElementById('btn-save-org');
      btn.setAttribute('aria-busy','true');
      try {
        await apiPut('/api/deportistas/organizaciones/' + cod, body);
        closeModal('modal-edit-org');
        toast('Organización actualizada correctamente', 'success');
        await loadOrgs();
      } catch(e) {
        toast('Error al guardar: ' + e.message, 'error');
      } finally {
        btn.removeAttribute('aria-busy');
      }
    }
  );
}

async function saveEditDep() {
  const cod = document.getElementById('ed-cod').value;
  const nombre = document.getElementById('ed-ap-pat').value.trim() + ' ' +
                 document.getElementById('ed-ap-mat').value.trim() + ', ' +
                 document.getElementById('ed-nombres').value.trim();
  const body = {
    num_documento:  document.getElementById('ed-doc').value.trim(),
    tipo_documento: document.getElementById('ed-tipo-doc').value,
    ap_paterno:     document.getElementById('ed-ap-pat').value.trim(),
    ap_materno:     document.getElementById('ed-ap-mat').value.trim(),
    nombres:        document.getElementById('ed-nombres').value.trim(),
    sexo:           document.getElementById('ed-sexo').value,
    fecha_nac:      document.getElementById('ed-fecha-nac').value,
    cod_asociacion: parseInt(document.getElementById('ed-asoc').value),
    num_cuenta:     document.getElementById('ed-cuenta').value.trim() || null,
    correo:         document.getElementById('ed-correo').value.trim() || null,
    telefono:       document.getElementById('ed-telefono').value.trim() || null,
    agrupacion:     document.getElementById('ed-agrupacion').value.trim() || null,
  };
  // Doble confirmación
  showConfirm(
    'Confirmar edición de deportista',
    `¿Guardar los cambios en <strong>${nombre}</strong>?<br><small style="color:var(--text3)">Se actualizarán todos los datos personales, número de cuenta y asociación.</small>`,
    async () => {
      const btn = document.getElementById('btn-save-dep');
      btn.setAttribute('aria-busy','true');
      try {
        await apiPut('/api/deportistas/' + cod, body);
        closeModal('modal-edit-dep');
        toast('Deportista actualizado correctamente', 'success', nombre);
        await loadDep();
      } catch(e) {
        toast('Error al guardar: ' + e.message, 'error');
      } finally {
        btn.removeAttribute('aria-busy');
      }
    }
  );
}

// ── CATALOGOS ──────────────────────────────────────────────
async function loadCats() {
  if (!online) return;
  try { cats = await apiGet('/api/deportistas/catalogos'); } catch { return; }
  // Tabla asociaciones
  const tAsoc = document.getElementById('t-asoc');
  if (tAsoc) tAsoc.innerHTML = cats.asociaciones.map(a =>
    `<tr><td class="mono" style="font-size:12px">${a.cod_asociacion}</td><td>${a.nombre}</td></tr>`).join('');
  // Tabla orgs (misma data)
  const tOrgs = document.getElementById('t-orgs');
  if (tOrgs) { tOrgs.innerHTML = tAsoc?.innerHTML||''; document.getElementById('orgs-count').textContent = cats.asociaciones.length+' registros'; }
  // Tabla niveles
  const tNiv = document.getElementById('t-niv');
  if (tNiv) tNiv.innerHTML = cats.niveles.map(n =>
    `<tr><td class="mono" style="font-size:12px">${n.cod_nivel}</td><td>${n.descripcion||n.cod_nivel}</td>
    <td><span class="badge badge-${(n.cod_tipo_pad||'').toLowerCase()}">${(n.cod_tipo_pad||'').replace('PAD1','PAD I').replace('PAD2','PAD II')}</span></td></tr>`).join('');
  // Fill asociacion select in deportista form
  const sel = document.getElementById('d-asoc');
  if (sel && sel.options.length <= 1) cats.asociaciones.forEach(a => {
    const o = document.createElement('option'); o.value = a.cod_asociacion; o.textContent = a.nombre; sel.appendChild(o);
  });
  fillNiveles();
}

// ── CONSOLIDADO ECONOMICO ─────────────────────────────────
let ecoData = [];
async function generarEconomico() {
  let d;
  try { d = online ? await apiGet('/api/reportes/activos') : (await staticJson('activos.json'))?.data ?? await staticJson('activos.json'); } catch { return; }
  if (!d) return;
  const tipo = document.getElementById('sel-tipo-eco').value;
  ecoData = tipo ? d.filter(r => r.cod_tipo_pad === tipo) : d;
  document.getElementById('eco-titulo').textContent = 'Consolidado Economico ' + (tipo ? tipo.replace('PAD1','PAD I').replace('PAD2','PAD II') : 'General');
  renderEcoTable();
}
function renderEcoTable() {
  document.getElementById('eco-count').textContent = ecoData.length + ' registros';
  document.getElementById('t-economico').innerHTML = ecoData.map((r,i) => `<tr>
    <td>${i+1}</td><td style="font-size:11px">${esc(r.asociacion)||'—'}</td>
    <td>${esc(r.deportista||(r.ap_paterno+' '+r.ap_materno+', '+r.nombres))}</td>
    <td class="mono" style="font-size:12px">${r.num_documento}</td>
    <td class="mono" style="font-size:11px">${r.num_cuenta||'<span style="color:var(--coral)">OPE</span>'}</td>
    <td class="mono">S/ ${r.monto_soles?Number(r.monto_soles).toLocaleString('es-PE',{minimumFractionDigits:2}):'—'}</td></tr>`).join('');
}

function fillNiveles() {
  const prog = document.getElementById('sel-prog')?.value || 'PAD1';
  const filt = cats.niveles.filter(n => n.cod_tipo_pad === prog);
  ['sel-niv','sel-niv-ant'].forEach(id => {
    const s = document.getElementById(id); if (!s) return;
    s.innerHTML = filt.map(n => `<option value="${n.cod_nivel}">${n.descripcion||n.cod_nivel}</option>`).join('');
  });
}

// ── CONSOLIDADO ──────────────────────────────────────────────
let consData = [];
async function generarConsolidado() {
  let d;
  try { d = online ? await apiGet('/api/reportes/activos') : (await staticJson('activos.json'))?.data ?? await staticJson('activos.json'); } catch { return; }
  if (!d) return;
  const tipo = document.getElementById('sel-tipo-cons').value;
  consData = tipo ? d.filter(r => r.cod_tipo_pad === tipo) : d;
  document.getElementById('cons-titulo').textContent = 'Consolidado Tecnico — ' + (tipo ? tipo.replace('PAD1','PAD I').replace('PAD2','PAD II') : 'General');
  renderConsTable();
}
function renderConsTable() {
  document.getElementById('cons-count').textContent = consData.length + ' registros';
  document.getElementById('t-consolidado').innerHTML = consData.map((r,i) => `<tr>
    <td>${i+1}</td><td style="font-size:11px">${esc(r.asociacion)||'—'}</td>
    <td>${esc(r.deportista||(r.ap_paterno+' '+r.ap_materno+', '+r.nombres))}</td>
    <td class="mono" style="font-size:12px">${r.num_documento}</td>
    <td style="text-align:center">${r.sexo||'—'}</td>
    <td>${r.nivel_desc||r.cod_nivel}</td>
    <td style="font-size:12px">${r.fecha_ingreso?new Date(r.fecha_ingreso).toLocaleDateString('es-PE'):(r.es_permanente?'Permanente':'—')}</td></tr>`).join('');
}

// ── NOMINA PAD (Consulta, solo lectura) ───────────────────
async function loadNomina() {
  let d;
  try {
    d = online
      ? await apiGet('/api/reportes/activos')
      : (await staticJson('activos.json'))?.data ?? await staticJson('activos.json');
  } catch { d = null; }
  nominaData = d || [];
  renderNomina(nominaData);
}

function renderNomina(data) {
  const filtered = nominaFilter
    ? data.filter(r => r.cod_tipo_pad === nominaFilter)
    : data;
  document.getElementById('nomina-count').textContent = filtered.length + ' deportistas';
  const tbody = document.getElementById('t-nomina');
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text3)">Sin registros</td></tr>';
    return;
  }
  tbody.innerHTML = filtered.map(r => `<tr>
    <td class="mono" style="color:${r.num_documento?'inherit':'var(--text3)'}">${r.num_documento||'—'}</td>
    <td>${esc(r.deportista||(r.ap_paterno+' '+r.ap_materno+', '+r.nombres))}</td>
    <td>${esc(r.asociacion)||'—'}</td>
    <td><span class="badge badge-${(r.cod_tipo_pad||'').toLowerCase()}">${(r.cod_tipo_pad||'').replace('PAD1','PAD I').replace('PAD2','PAD II')}</span></td>
    <td>${r.nivel_desc||r.cod_nivel||'—'}</td>
    <td><span class="badge badge-${(r.cod_estado_pad||'act').toLowerCase()}">${r.cod_estado_pad||'ACT'}</span></td>
  </tr>`).join('');
}

function filterNomina() {
  const q = document.getElementById('q-nomina').value.toLowerCase();
  const filtered = nominaData.filter(r => {
    const nombre = (r.deportista||(r.ap_paterno+' '+r.ap_materno+' '+r.nombres)||'').toLowerCase();
    const match  = !q || nombre.includes(q) || (r.num_documento||'').includes(q) || (r.asociacion||'').toLowerCase().includes(q);
    const filt   = !nominaFilter || r.cod_tipo_pad === nominaFilter;
    return match && filt;
  });
  renderNomina(filtered);
}

// ── MODAL: CAMBIO ──────────────────────────────────────────
function toggleMov() {
  const v = document.getElementById('sel-tipo-mov').value;
  // Col 2 = evento (ING/CAMBNIV) or retiro section inside col 1
  const secEv = document.getElementById('sec-evento');
  secEv.style.display = (v==='ING'||v==='CAMBNIV') ? 'block' : 'none';
  document.getElementById('sec-retiro').style.display = v==='RET' ? 'block' : 'none';
  document.getElementById('sec-nivel').style.display = v==='' ? 'none' : 'block';
  document.getElementById('fg-niv-ant').style.display = v==='CAMBNIV' ? 'block' : 'none';
  // Update modal title
  const titles = {ING:'Registrar Ingreso al PAD', CAMBNIV:'Registrar Cambio de Nivel', RET:'Registrar Retiro del PAD'};
  const tEl = document.getElementById('modal-cambio-titulo');
  if (tEl) tEl.textContent = titles[v]||'Registrar cambio PAD';
}

async function buscarDNI() {
  if (!online) { showAlert('alert-cambio','danger','API no disponible'); return; }
  const dni = document.getElementById('inp-dni').value.trim();
  if (!dni) return;
  try {
    const data = await apiGet('/api/deportistas/buscar?dni=' + encodeURIComponent(dni));
    const box = document.getElementById('found-box');
    if (data.found) {
      depSel = data.deportista;
      document.getElementById('found-nombre').textContent = data.deportista.ap_paterno+' '+data.deportista.ap_materno+', '+data.deportista.nombres;
      const pad = (data.pad_records||[]).find(p => p.cod_estado_pad==='ACT');
      document.getElementById('found-info').textContent = pad ? '('+pad.cod_tipo_pad.replace('PAD1','PAD I').replace('PAD2','PAD II')+' Niv. '+(pad.nivel_desc||pad.cod_nivel)+')' : '(sin PAD activo)';
      box.classList.add('show');
    } else {
      depSel = null; box.classList.remove('show');
      showAlert('alert-cambio','warning','Deportista no encontrado. Use &ldquo;+ Nuevo&rdquo; para registrarlo.');
    }
  } catch(e) { showAlert('alert-cambio','danger','Error: '+e.message); }
}

async function guardarCambio() {
  if (!online) return;
  if (!depSel) { showAlert('alert-cambio','warning','Busque y seleccione un deportista primero'); return; }
  const tipo = document.getElementById('sel-tipo-mov').value;
  if (!tipo) { showAlert('alert-cambio','warning','Seleccione el tipo de movimiento'); return; }
  const btn = document.getElementById('btn-guardar');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Guardando...';
  const periodoRaw = document.getElementById('inp-periodo').value;
  const periodo = periodoRaw ? periodoRaw.replace('-','') : '';
  const causalEl = document.getElementById('sel-causal');

  const finEv = document.getElementById('inp-ev-fin').value;
  const nomEv = document.getElementById('inp-ev-nombre').value.trim();
  if (tipo !== 'RET' && nomEv && !finEv) {
    showAlert('alert-cambio','danger','Debe obligatoriamente ingresar la Fecha de fin del evento para poder calcular los meses de beneficio correspondientes.');
    btn.disabled=false; btn.innerHTML='Registrar cambio';
    return;
  }

  const body = {
    tipo_movimiento: tipo,
    cod_deportista: depSel.cod_deportista,
    cod_tipo_pad: document.getElementById('sel-prog').value,
    cod_nivel: document.getElementById('sel-niv').value,
    cod_nivel_anterior: document.getElementById('sel-niv-ant')?.value || null,
    periodo_vigencia: periodo,
    nro_informe: document.getElementById('inp-informe').value.trim() || null,
    motivo: tipo==='RET' ? (causalEl.options[causalEl.selectedIndex]?.text||null) : null,
    detalle_evento: tipo==='RET' ? (document.getElementById('inp-det-retiro').value.trim()||null) : (document.getElementById('inp-ev-nombre').value.trim()||null),
    fecha_inicio_evento: tipo!=='RET' ? (document.getElementById('inp-ev-ini').value || null) : null,
    fecha_fin_evento: tipo!=='RET' ? (document.getElementById('inp-ev-fin').value || null) : null,
    lugar_evento: tipo!=='RET' ? (document.getElementById('inp-ev-lugar').value.trim() || null) : null,
    modalidad: tipo!=='RET' ? (document.getElementById('inp-ev-modalidad').value.trim() || null) : null,
    categoria: tipo!=='RET' ? (document.getElementById('inp-ev-cat')?.value.trim() || null) : null,
    resultado: tipo!=='RET' ? (document.getElementById('sel-resultado').value || null) : null,
    expedientes: getExpedientes(),
  };
  try {
    const res = await apiPost('/api/movimientos', body);
    showAlert('alert-cambio','success','&#10003; Registrado. cod_cambio: '+res.cod_cambio);
    setTimeout(() => {
      closeModal('modal-cambio'); resetCambio(); loadDashboard();
      if (periodoDetalle) loadDetallePeriodo(periodoDetalle); else loadCambios();
    }, 1800);
  } catch(e) { showAlert('alert-cambio','danger','Error: '+e.message); }
  finally { btn.disabled=false; btn.textContent='Registrar cambio'; }
}

function resetCambio() {
  depSel=null;
  document.getElementById('inp-dni').value='';
  document.getElementById('sel-tipo-mov').value='';
  document.getElementById('found-box').classList.remove('show');
  document.getElementById('alert-cambio').innerHTML='';
  ['inp-ev-nombre','inp-ev-ini','inp-ev-fin','inp-ev-lugar','inp-ev-modalidad','inp-ev-cat'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('sel-resultado').value = '';
  initExpedientes();
  toggleMov();
}

// ── MODAL: DEPORTISTA ──────────────────────────────────────
async function guardarDeportista() {
  if (!online) return;
  const body = {
    num_documento: document.getElementById('d-doc').value.trim(),
    tipo_documento: document.getElementById('d-tipodoc').value,
    ap_paterno: document.getElementById('d-pat').value.trim().toUpperCase(),
    ap_materno: document.getElementById('d-mat').value.trim().toUpperCase(),
    nombres: document.getElementById('d-nom').value.trim().toUpperCase(),
    sexo: document.getElementById('d-sexo').value,
    fecha_nac: document.getElementById('d-fnac').value || null,
    cod_asociacion: parseInt(document.getElementById('d-asoc').value) || null,
    num_cuenta: document.getElementById('d-cuenta').value.trim() || null,
    agrupacion: document.getElementById('d-agrup').value || null,
    correo: document.getElementById('d-correo').value.trim() || null,
    telefono: document.getElementById('d-tel').value.trim() || null,
  };
  if (!body.num_documento||!body.ap_paterno||!body.nombres) {
    showAlert('alert-dep','warning','Complete: numero de documento, apellido paterno y nombres'); return;
  }
  if (!body.fecha_nac) {
    showAlert('alert-dep','warning','La fecha de nacimiento es requerida'); return;
  }
  if (!body.cod_asociacion) {
    showAlert('alert-dep','warning','Seleccione una federación o asociación'); return;
  }
  try {
    const res = await apiPost('/api/deportistas', body);
    showAlert('alert-dep','success','&#10003; Deportista registrado. Cod: '+res.cod_deportista);
    if (document.getElementById('inp-dni')) document.getElementById('inp-dni').value = body.num_documento;
    setTimeout(() => { closeModal('modal-deportista'); loadDep(); }, 1500);
  } catch(e) { showAlert('alert-dep','danger','Error: '+e.message); }
}

// ── EXPORT ────────────────────────────────────────────────
async function doExport() {
  const btn = document.getElementById('btn-export');
  btn.disabled=true; btn.innerHTML='<span class="spinner" style="border-color:rgba(0,0,0,0.15);border-top-color:var(--text)"></span>';
  try {
    const res = await apiPost('/api/reportes/exportar', {});
    document.getElementById('last-update').textContent = 'Exportado: '+new Date(res.exportado).toLocaleString('es-PE',{dateStyle:'short',timeStyle:'short'});
    toast(`Datos exportados a OneDrive (${res.registros} activos). Los especialistas veran los datos actualizados en Consulta PAD.`, 'success', 'Exportacion completa', 6000);
    await loadDashboard();
  } catch(e) { toast('Error al exportar: '+e.message, 'error'); }
  finally { btn.disabled=false; btn.innerHTML='&#8593; Exportar datos'; }
}

// ── UI HELPERS ────────────────────────────────────────────
function showAlert(id, type, msg) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = `<div class="alert alert-${type}">${esc(msg)}</div>`;
}
function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = 'flex';
  el.offsetHeight; // force reflow
  el.classList.add('show');
  el.classList.remove('closing');
  el._esc = e => { if (e.key === 'Escape') closeModal(id); };
  document.addEventListener('keydown', el._esc);
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('closing');
  el.classList.remove('show');
  document.removeEventListener('keydown', el._esc);
  el.addEventListener('transitionend', () => {
    el.style.display = 'none';
    el.classList.remove('closing');
  }, { once: true });
}
function switchTab(el, tabId) {
  el.parentElement.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  const page = el.closest('.page')||el.closest('.tab-content')?.parentElement||document.body;
  page.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
  document.getElementById(tabId)?.classList.add('active');
}
// ── MODULE NAVIGATION ─────────────────────────────────────
function enterModule(mod) {
  if (mod === 'gestion') {
    // Desde GitHub Pages: no se puede usar Gestion PAD, informar
    if (!IS_LOCALHOST) {
      toast('Gestion PAD solo esta disponible en la red local de la institucion. Accede desde el PC de trabajo o solicita la URL de red interna.', 'info', 'Modulo local', 6000);
      return;
    }
    const userEmail = (document.getElementById('home-user-email')?.textContent || '').toLowerCase();
    const isAuthorized = IS_LOCALHOST || GESTION_PAD_USERS.includes(userEmail);
    if (!isAuthorized) {
      toast('No tienes acceso al modulo de Gestion PAD.', 'error');
      return;
    }
    if (!online) {
      toast('La API local no esta activa. Inicia el servidor antes de acceder a este modulo.', 'warning');
      return;
    }
  }

  currentModule = mod;
  document.getElementById('home-screen').classList.add('hidden');
  document.getElementById('sidebar').style.display = 'flex';
  document.getElementById('main-app').style.display = 'flex';
  // Hide "← Modulos" on local API (sidebar "Inicio" item serves same purpose)
  const navBack = document.getElementById('nav-back-btn');
  if (navBack) navBack.style.display = IS_LOCAL_API ? 'none' : 'flex';

  // Show correct sidebar navigation
  document.getElementById('nav-gestion').style.display  = mod === 'gestion'  ? 'block' : 'none';
  document.getElementById('nav-consulta').style.display = mod === 'consulta' ? 'block' : 'none';

  if (mod === 'gestion') {
    document.getElementById('sidebar-module-title').textContent = 'Gestion PAD';
    showPage('home', null);
    loadHomeModule();
  } else if (mod === 'consulta') {
    document.getElementById('sidebar-module-title').textContent = 'Consulta PAD';
    showPage('dashboard', null);
    loadDashboard();
  }
}

function goHome() {
  if (IS_LOCAL_API) {
    // En API local, "Inicio" va a la página principal del módulo, no al selector
    showPage('home', null);
    loadHomeModule();
    return;
  }
  document.getElementById('home-screen').classList.remove('hidden');
  document.getElementById('sidebar').style.display = 'none';
  document.getElementById('main-app').style.display = 'none';
}

async function loadHomeModule() {
  if (!online) {
    document.getElementById('home-offline-note').style.display = 'flex';
    return;
  }
  document.getElementById('home-offline-note').style.display = 'none';
  try {
    const k = await apiGet('/api/reportes/kpi');
    if (k) {
      document.getElementById('k-total-mod').textContent = k.total_activos ?? '—';
      if (k.monto_mensual_total != null) {
        document.getElementById('k-monto-mod').textContent = 'S/ '+Number(k.monto_mensual_total).toLocaleString('es-PE',{minimumFractionDigits:2})+' / mes';
      }
    }
    const periodos = await apiGet('/api/movimientos/periodos');
    const hoy = new Date();
    const perActual = hoy.getFullYear()+String(hoy.getMonth()+1).padStart(2,'0');
    const perData = periodos.find(p => p.periodo === perActual);
    document.getElementById('k-cambios-mes').textContent = perData ? perData.cantidad_registros : 0;
    const MESES_HOME = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    const mesNum = parseInt(perActual.slice(4,6),10);
    document.getElementById('k-periodo-actual').textContent = MESES_HOME[mesNum]+' '+perActual.slice(0,4);
    document.getElementById('k-periodo-estado').textContent = perData?.cerrado == 1 ? 'Cerrado' : 'Abierto';
    const userEl = document.getElementById('home-user');
    if (userEl) userEl.textContent = document.getElementById('home-user-email')?.textContent || '';
  } catch(e) { console.warn('loadHomeModule:', e.message); }
}

function showPage(id, el) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-'+id)?.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  el?.classList.add('active');
  const titles = {home:'Gestion PAD',dashboard:'Dashboard',deportistas:'Deportistas',nomina:'Nomina PAD',cambios:'Cambios PAD',consolidados:'Consolidados',giros:'Giros',orgs:'Organizaciones deportivas',montos:'Montos de referencia'};
  document.getElementById('page-title').textContent = titles[id]||id;
  const btnNuevo = document.getElementById('btn-nuevo');
  if (btnNuevo) btnNuevo.style.display = 'none'; // btn is inside each page now
  if (id==='deportistas') loadDep();
  if (id==='nomina') loadNomina();
  if (id==='cambios') { volverAPeriodos && (periodoDetalle=null); document.getElementById('cambios-periodos-view').style.display='block'; document.getElementById('cambios-detalle-view').style.display='none'; loadCambios(); }
  if (id==='orgs') loadOrgs();
  if (id==='montos') populateDirectivaSelect().then(() => loadMontos());
  if (id==='home') loadHomeModule();
  if (id==='dashboard') loadDashboard();
}

// ── PILLS ────────────────────────────────────────────────
document.querySelectorAll('.filter-pills').forEach(group => {
  group.querySelectorAll('.pill').forEach(p => {
    p.addEventListener('click', () => {
      group.querySelectorAll('.pill').forEach(pp => pp.classList.remove('active'));
      p.classList.add('active');
      if (group.id === 'pills-dep') { depFilter = p.dataset.f||''; filterDep(); }
      if (group.id === 'pills-nomina') { nominaFilter = p.dataset.f||''; filterNomina(); }
    });
  });
});

// Close modal on overlay click
document.querySelectorAll('.modal-overlay').forEach(m => {
  m.addEventListener('click', e => { if (e.target===m) closeModal(m.id); });
});

// Set default periods — regular inputs get current month (giro excluded: needs last closed)
const now = new Date();
const defPer = now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
['inp-periodo','inp-periodo-cambios'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.value = defPer;
});

// Consolidado selectors: default to last CLOSED period from server
(async () => {
  try {
    if (online) {
      const perList = await apiGet('/api/movimientos/periodos');
      const lastClosed = perList.find(p => p.cerrado);
      if (lastClosed) {
        const lc = lastClosed.periodo;
        const lcFmt = lc.slice(0,4) + '-' + lc.slice(4,6);
        ['inp-periodo-cons-tec','inp-periodo-cons-eco','inp-periodo-giro'].forEach(id => {
          const el = document.getElementById(id); if (el) el.value = lcFmt;
        });
        return;
      }
    }
  } catch(e) { /* fallback below */ }
  // Fallback: previous month
  const prev = new Date(); prev.setMonth(prev.getMonth()-1);
  const prevFmt = prev.getFullYear()+'-'+String(prev.getMonth()+1).padStart(2,'0');
  ['inp-periodo-cons-tec','inp-periodo-cons-eco','inp-periodo-giro'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = prevFmt;
  });
})();

// ── MONTOS DE REFERENCIA ─────────────────────────────────────
let montosData = [];

// Pobla el selector de directivas cargando desde API y selecciona la más reciente
async function populateDirectivaSelect() {
  const sel = document.getElementById('sel-directiva-montos');
  if (!sel) return;
  if (!online) {
    sel.innerHTML = '<option value="">API no disponible</option>';
    return;
  }
  try {
    const data = await apiGet('/api/montos/directivas');
    sel.innerHTML = '';
    // Mostrar más reciente primero (invertir el orden)
    const TIPO_LABEL_DIR = { PAD1: 'PAD I', PAD2: 'PAD II', PNM: 'PNM' };
    [...data].reverse().forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.periodo_ref;
      if (d.valor_uit) {
        // Directiva vigente con año de UIT conocido
        const uitFmt = 'S/ ' + Number(d.valor_uit).toLocaleString('es-PE', {minimumFractionDigits:2});
        opt.textContent = `${d.normativa} — ${d.anio} (UIT ${uitFmt})`;
      } else {
        // Directivas históricas — limpiar prefijo verbose
        opt.textContent = d.normativa;
      }
      sel.appendChild(opt);
    });
    if (sel.options.length > 0) sel.selectedIndex = 0;
  } catch (err) {
    sel.innerHTML = '<option value="">Error al cargar directivas</option>';
  }
}

async function loadMontos() {
  const sel     = document.getElementById('sel-directiva-montos');
  const selTipo = document.getElementById('sel-tipo-montos');
  const tbody   = document.getElementById('t-montos');
  const bar     = document.getElementById('montos-uit-bar');

  if (!online) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:32px;color:var(--text3)">Requiere API local activa</td></tr>';
    if (bar) bar.style.display = 'none';
    return;
  }

  const periodo = sel?.value || '';
  const tipo    = selTipo?.value || '';
  const label   = sel?.options[sel?.selectedIndex]?.textContent || '';

  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:32px;color:var(--text3)"><span class="spinner"></span> Cargando...</td></tr>';

  try {
    const params = new URLSearchParams();
    if (periodo) params.set('periodo', periodo);
    if (tipo)    params.set('tipo', tipo);
    const data = await apiGet('/api/montos' + (params.toString() ? '?' + params.toString() : ''));
    montosData = data;
    renderMontos(data, periodo, label);
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:32px;color:var(--text3)">Error al cargar montos</td></tr>';
    if (bar) bar.style.display = 'none';
  }
}

function renderMontos(data, periodo, directivaLabel) {
  const tbody = document.getElementById('t-montos');
  const bar   = document.getElementById('montos-uit-bar');
  const count = document.getElementById('montos-count');

  if (!data || !data.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:32px;color:var(--text3)">Sin montos para el periodo seleccionado</td></tr>';
    if (bar) bar.style.display = 'none';
    if (count) count.textContent = '';
    return;
  }

  // Barra de info
  const first = data[0];
  const esBloqueado = periodo && periodo < '202505';
  if (bar) {
    bar.style.display = 'flex';
    document.getElementById('montos-lbl-periodo').textContent = directivaLabel || periodo || 'Actual';
    document.getElementById('montos-lbl-uit').textContent =
      first.valor_uit ? 'S/ ' + Number(first.valor_uit).toLocaleString('es-PE', {minimumFractionDigits:2}) : '—';
    const dsEl = document.getElementById('montos-lbl-ds');
    if (dsEl) dsEl.textContent = first.ref_ds_uit || '';
    const bloqueoEl = document.getElementById('montos-lbl-bloqueo');
    if (bloqueoEl) {
      bloqueoEl.innerHTML = esBloqueado
        ? '&#128274; Periodo cerrado'
        : '<span style="color:var(--green)">&#9679;</span> Vigente';
      bloqueoEl.style.background = esBloqueado ? 'var(--border)' : 'rgba(0,160,80,0.1)';
      bloqueoEl.style.color = esBloqueado ? 'var(--text3)' : 'var(--green)';
    }
  }

  // ¿Aplica % UIT? Solo cuando el periodo tiene valor_uit conocido (Dir. 003-2025)
  const mostrarUIT = data.some(r => r.valor_uit != null);
  const TIPO_LABEL = { PAD1: 'PAD I', PAD2: 'PAD II', PNM: 'PNM' };

  // Cabecera dinámica
  const thead = tbody.closest('table')?.querySelector('thead tr');
  if (thead) {
    thead.innerHTML = `
      <th>Tipo PAD</th>
      <th>Nivel</th>
      ${mostrarUIT ? '<th style="text-align:right">% UIT</th>' : ''}
      <th style="text-align:right">Monto mensual (S/)</th>
      <th>Normativa</th>`;
  }

  tbody.innerHTML = data.map(r => {
    const monto = 'S/ ' + Number(r.monto_soles).toLocaleString('es-PE', {minimumFractionDigits:2, maximumFractionDigits:2});
    return `<tr>
      <td><strong>${TIPO_LABEL[r.cod_tipo_pad] || r.cod_tipo_pad}</strong></td>
      <td>${r.nombre_nivel || r.cod_nivel} <span style="font-size:11px;color:var(--text3)">${r.cod_nivel}</span></td>
      ${mostrarUIT ? `<td style="text-align:right;font-family:var(--mono)">${r.pct_uit != null ? (r.pct_uit * 100).toFixed(0) + ' %' : '—'}</td>` : ''}
      <td style="text-align:right;font-family:var(--mono);font-weight:600">${monto}</td>
      <td style="font-size:11px;color:var(--text3)">${r.normativa || '—'}</td>
    </tr>`;
  }).join('');
  if (count) count.textContent = data.length + ' niveles';
}

// ── Modal Generar Montos ──────────────────────────────────────
function abrirModalGenerarMontos() {
  if (!online) { toast('Requiere API local activa', 'error'); return; }
  document.getElementById('inp-generar-anio').value = '';
  document.getElementById('inp-generar-uit').value  = '';
  document.getElementById('inp-generar-ds').value   = '';
  document.getElementById('t-montos-preview').innerHTML = '';
  document.getElementById('montos-preview-total').textContent = '';
  document.getElementById('montos-preview-wrap').style.display = 'none';
  document.getElementById('btn-confirmar-generar').disabled = true;
  openModal('modal-generar-montos');
}

async function calcPrevMontos() {
  const anio = parseInt(document.getElementById('inp-generar-anio').value, 10);
  const uit  = parseFloat(document.getElementById('inp-generar-uit').value);
  if (!anio || anio < 2025 || isNaN(uit) || uit <= 0) {
    toast('Ingresa un año válido (≥ 2025) y un valor UIT mayor a cero', 'error');
    return;
  }
  try {
    const data = await apiGet(`/api/montos/preview?anio=${anio}&valor_uit=${uit}`);
    const TIPO_LABEL = { PAD1: 'PAD I', PAD2: 'PAD II', PNM: 'PNM' };
    const tbody = document.getElementById('t-montos-preview');
    tbody.innerHTML = data.niveles.map(n =>
      `<tr>
        <td>${n.nombre_nivel} <span style="font-size:10px;color:var(--text3)">${n.cod_nivel}</span></td>
        <td>${TIPO_LABEL[n.cod_tipo_pad] || n.cod_tipo_pad}</td>
        <td style="text-align:right;font-family:var(--mono)">${(n.pct_uit * 100).toFixed(0)} %</td>
        <td style="text-align:right;font-family:var(--mono);font-weight:600">S/ ${Number(n.monto_soles).toLocaleString('es-PE',{minimumFractionDigits:2})}</td>
      </tr>`
    ).join('');
    const totalMensual = data.niveles.reduce((s, n) => s + n.monto_soles, 0);
    document.getElementById('montos-preview-total').textContent =
      `Suma de montos: S/ ${totalMensual.toLocaleString('es-PE',{minimumFractionDigits:2})}`;
    document.getElementById('montos-preview-wrap').style.display = 'block';
    document.getElementById('btn-confirmar-generar').disabled = false;
  } catch (err) {
    toast('Error al calcular preview: ' + err.message, 'error');
  }
}

async function confirmarGenerarMontos() {
  const anio  = parseInt(document.getElementById('inp-generar-anio').value, 10);
  const uit   = parseFloat(document.getElementById('inp-generar-uit').value);
  const refDs = document.getElementById('inp-generar-ds').value.trim();
  if (!anio || isNaN(uit)) { toast('Completa el año y el valor UIT', 'error'); return; }

  const btn = document.getElementById('btn-confirmar-generar');
  btn.setAttribute('aria-busy', 'true');
  btn.disabled = true;

  try {
    const r = await apiPost('/api/montos/generar', { anio, valor_uit: uit, ref_ds: refDs || null });
    closeModal('modal-generar-montos');
    toast(`✓ Generados ${r.registros_insertados} montos para ${r.periodos.length} meses del año ${r.anio}`, 'success');
    // Recargar vista mostrando el primer mes generado
    const primerMes = r.periodos[0];
    const inp = document.getElementById('inp-periodo-montos');
    if (inp) inp.value = primerMes.slice(0, 4) + '-' + primerMes.slice(4, 6);
    await loadMontos();
  } catch (err) {
    toast('Error al generar montos: ' + err.message, 'error');
    btn.removeAttribute('aria-busy');
    btn.disabled = false;
  }
}

// ── FASE 5: REGULARIZACIÓN TEMPORAL ─────────────────────────
async function openPendientes() {
  if (!online) { alert('API local no disponible'); return; }
  const tbody = document.getElementById('t-pendientes');
  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:32px;color:var(--text3)"><span class="spinner"></span> Cargando pendientes...</td></tr>';
  openModal('modal-pendientes');
  try {
    const data = await apiGet('/api/deportistas/pendientes-regularizacion');
    if (data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:32px;color:var(--green)">&#10003; No hay deportistas pendientes de regularizar. ¡Todo al día!</td></tr>';
      return;
    }
    tbody.innerHTML = data.map(r => {
      const faltan = [];
      if (!r.nro_informe) faltan.push('<span class="badge" style="background:#fef2f2;color:#dc2626;border-color:#fca5a5">Informe</span>');
      if (!r.detalle_evento || !r.cod_resultado) faltan.push('<span class="badge" style="background:#fff7ed;color:#c2410c;border-color:#fdba74">Evento</span>');
      if (!r.cant_expedientes) faltan.push('<span class="badge" style="background:#fefce8;color:#a16207;border-color:#fde047">Exp.</span>');
      if (!r.num_cuenta) faltan.push('<span class="badge" style="background:#f0f9ff;color:#0369a1;border-color:#7dd3fc">Cuenta</span>');
      const depName = r.ap_paterno + ' ' + r.ap_materno + ', ' + r.nombres;
      return `<tr>
        <td class="mono" style="font-size:12px">${r.num_documento}</td>
        <td>${depName}</td>
        <td style="font-size:11px">${(r.cod_tipo_pad||'').replace('PAD1','PAD I').replace('PAD2','PAD II')} / ${r.cod_nivel}</td>
        <td>${faltan.join(' ')}</td>
        <td><button class="btn-edit" onclick="regularizar(\'${encodeURIComponent(JSON.stringify(r))}\')">&#9998; Regularizar</button></td>
      </tr>`;
    }).join('');
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="5" style="color:var(--danger);padding:16px">${esc(e.message)}</td></tr>`;
  }
}

function regularizar(encodedR) {
  const r = JSON.parse(decodeURIComponent(encodedR));
  const nombre = r.ap_paterno + ' ' + r.ap_materno + ', ' + r.nombres;
  document.getElementById('reg-titulo').textContent = 'Regularizar Deportista';
  document.getElementById('reg-subtitulo').textContent = nombre;
  document.getElementById('reg-cod-cambio').value = r.cod_cambio;
  document.getElementById('reg-cod-deportista').value = r.cod_deportista;
  document.getElementById('alert-reg').innerHTML = '';

  // Pre-cargar informe si ya existe, o limpiar si falta
  const infoEl = document.getElementById('reg-informe');
  if (infoEl) {
    infoEl.value = r.nro_informe || '';
    // Marcar visualmente si ya estaba registrado
    infoEl.style.background = r.nro_informe ? 'var(--green-light, #f0fdf4)' : '';
    infoEl.title = r.nro_informe ? '✓ Ya registrado anteriormente' : '';
  }

  // Limpiar campos de evento (siempre vacíos — si ya hay detalle_evento el deportista no aparecería aquí)
  ['reg-ev-nombre','reg-ev-ini','reg-ev-fin','reg-ev-mod','reg-ev-cat'].forEach(id => {
    const el = document.getElementById(id); if(el) el.value = '';
  });
  document.getElementById('reg-ev-res').value = '';

  // Mostrar estado de num_cuenta directamente en el campo
  const cuentaEl = document.getElementById('reg-num-cuenta');
  const cuentaHint = document.getElementById('reg-cuenta-hint');
  if (cuentaEl) {
    if (r.num_cuenta) {
      cuentaEl.value = r.num_cuenta;
      cuentaEl.readOnly = true;
      cuentaEl.style.background = '#f0fdf4';
      cuentaEl.style.color = 'var(--green, #16a34a)';
      cuentaEl.style.cursor = 'default';
      if (cuentaHint) cuentaHint.innerHTML = '<span style="color:var(--green,#16a34a)">&#10003; Ya registrada</span>';
    } else {
      cuentaEl.value = '';
      cuentaEl.readOnly = false;
      cuentaEl.style.background = '';
      cuentaEl.style.color = '';
      cuentaEl.style.cursor = '';
      if (cuentaHint) cuentaHint.innerHTML = '<span style="color:var(--danger)">Sin cuenta — ingresar para actualizar</span>';
    }
  }

  // Pre-cargar expedientes ya registrados, o abrir fila vacía si no hay
  const c = document.getElementById('reg-exp-container');
  c.innerHTML = '';
  const exps = r.expedientes_existentes || [];
  if (exps.length > 0) {
    exps.forEach(exp => agregarExpReg(exp.nro_expediente, exp.tipo_documento, true));
  } else {
    agregarExpReg();
  }
  openModal('modal-form-reg');
}

function agregarExpReg(nroExistente, tipoExistente, esPrecargado) {
  const c = document.getElementById('reg-exp-container');
  const div = document.createElement('div');
  div.className = 'exp-row';
  div.style.display = 'flex'; div.style.gap = '8px';
  const tipos = ['EXPEDIENTE','INFORME','OFICIO','RESOLUCION','OTRO'];
  const opcionesTipo = tipos.map(t => `<option value="${t}" ${tipoExistente===t?'selected':''}>${t.charAt(0)+t.slice(1).toLowerCase()}</option>`).join('');
  const bgPre = esPrecargado ? 'background:var(--green-light,#f0fdf4);' : '';
  const titlePre = esPrecargado ? 'title="✓ Ya registrado"' : '';
  div.innerHTML = `
    <input placeholder="Nro. exp." class="reg-exp-nro" value="${nroExistente||''}" ${titlePre} style="flex:1;padding:8px;border:1px solid var(--border);border-radius:var(--radius);font-size:13px;${bgPre}">
    <select class="reg-exp-tipo" style="width:120px;padding:8px;border:1px solid var(--border);border-radius:var(--radius);font-size:13px;${bgPre}">
      ${opcionesTipo}
    </select>
    <button type="button" class="btn-icon" onclick="this.parentElement.remove()" style="color:var(--danger)">&times;</button>`;
  c.appendChild(div);
}

async function guardarRegularizacion() {
  const btn = document.getElementById('btn-save-reg');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Guardando...';
  
  const expedientes = Array.from(document.querySelectorAll('#reg-exp-container .exp-row'))
    .map(row => ({
      nro_expediente: row.querySelector('.reg-exp-nro').value.trim(),
      tipo_documento: row.querySelector('.reg-exp-tipo').value
    }))
    .filter(e => e.nro_expediente);

  const finEv = document.getElementById('reg-ev-fin').value;
  if (!finEv && document.getElementById('reg-ev-nombre').value.trim()) {
    document.getElementById('alert-reg').innerHTML = `<div class="alert alert-danger">Debe ingresar la Fecha de fin del evento para calcular el beneficio.</div>`;
    btn.disabled = false; btn.innerHTML = '&#10003; Guardar Datos';
    return;
  }

  const body = {
    cod_cambio: document.getElementById('reg-cod-cambio').value,
    cod_deportista: document.getElementById('reg-cod-deportista').value,
    nro_informe: document.getElementById('reg-informe').value.trim() || null,
    detalle_evento: document.getElementById('reg-ev-nombre').value.trim() || null,
    fecha_inicio_evento: document.getElementById('reg-ev-ini').value || null,
    fecha_fin_evento: finEv || null,
    modalidad: document.getElementById('reg-ev-mod').value.trim() || null,
    categoria: document.getElementById('reg-ev-cat').value.trim() || null,
    resultado: document.getElementById('reg-ev-res').value || null,
    num_cuenta: (() => { const el = document.getElementById('reg-num-cuenta'); return (el && !el.readOnly) ? el.value.trim() || null : null; })(),
    expedientes
  };

  try {
    await apiPost('/api/deportistas/regularizar', body);
    closeModal('modal-form-reg');
    toast('Registro regularizado exitosamente', 'success');
    openPendientes(); // recargar
    await loadDashboard(); // actualizar kpis
  } catch(e) {
    document.getElementById('alert-reg').innerHTML = `<div class="alert alert-danger">${esc(e.message)}</div>`;
  } finally {
    btn.disabled = false; btn.innerHTML = '&#10003; Guardar Datos';
  }
}


// ── INIT ──────────────────────────────────────────────────
(async () => {
  // Splash screen para API local: mostrarlo inmediatamente
  if (IS_LOCAL_API) {
    const splash = document.getElementById('splash-overlay');
    if (splash) splash.style.display = 'flex';
  }

  // Manejar redirect de MSAL si viene de un login previo (no bloqueante)
  if (msalApp) {
    try {
      const rr = await msalApp.handleRedirectPromise();
      if (rr?.account) {
        // Retorno exitoso de loginRedirect — ya tenemos la cuenta
        showApp(rr.account);
        updateAuthUI();
        return; // showApp ya se llamó, no hace falta llamarlo de nuevo abajo
      }
    } catch(e) {
      console.warn('MSAL redirect error:', e.errorCode, e.message);
    }
  }

  // Mostrar la app inmediatamente — MSAL es opcional para Consulta PAD
  const accounts = msalApp?.getAllAccounts() || [];
  const account = IS_LOCALHOST
    ? { username: 'localhost' }
    : (accounts[0] || null);
  showApp(account);
  await checkApi();
  await loadCats();
  setInterval(checkApi, 30000);

  // Si es la API local, entrar directo a Gestión PAD sin pasar por el home screen
  if (IS_LOCAL_API && online) {
    enterModule('gestion');
    // Desvanecer splash después de 1.5s
    setTimeout(() => {
      const splash = document.getElementById('splash-overlay');
      if (splash) {
        splash.classList.add('fade-out');
        setTimeout(() => splash.style.display = 'none', 700);
      }
    }, 1500);
  }
})();
