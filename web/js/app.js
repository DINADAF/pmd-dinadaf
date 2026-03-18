import {
  checkApiStatus, isApiOnline,
  buscarDeportista, getCatalogos, crearDeportista,
  registrarMovimiento, exportarDatos, actualizarCuenta,
} from './api-client.js';
import { renderDashboard } from './dashboard.js';

// ── State ────────────────────────────────────────────────
let tipoMovimiento = 'ING';
let deportistaActual = null;
let catalogos = null;
let sessionMovimientos = [];

// ── Init ─────────────────────────────────────────────────
async function init() {
  setupTabs();
  setupMovimientoButtons();
  setupDeportistaBusqueda();
  setupExpedientes();
  setupModalDeportista();
  setupCuentaModule();

  // Set current period display
  const now = new Date();
  const periodo = String(now.getFullYear()) + String(now.getMonth() + 1).padStart(2, '0');
  document.getElementById('periodo-actual').textContent = periodo;

  // Load dashboard data
  renderDashboard();

  // Check API status
  await refreshApiStatus();
  setInterval(refreshApiStatus, 15000); // re-check every 15 seconds
}

async function refreshApiStatus() {
  const online = await checkApiStatus();
  const dot   = document.getElementById('api-indicator');
  const label = document.getElementById('api-label');

  dot.className   = 'status-dot ' + (online ? 'online' : 'offline');
  label.textContent = online ? 'Módulo de gestión activo' : 'Módulo de gestión offline';

  // Show/hide management content
  setModuleVisibility('gestion', online);
  setModuleVisibility('cuenta', online);

  if (online && !catalogos) {
    catalogos = await getCatalogos();
    populateNiveles();
    populateAsociaciones();
  }
}

function setModuleVisibility(module, online) {
  document.getElementById(`${module}-offline`).classList.toggle('hidden', online);
  document.getElementById(`${module}-online`).classList.toggle('hidden', !online);
}

// ── Tabs ─────────────────────────────────────────────────
function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
  });
}

// ── Movement type buttons ─────────────────────────────────
function setupMovimientoButtons() {
  document.querySelectorAll('.mov-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mov-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      tipoMovimiento = btn.dataset.tipo;
      resetDeportistaSearch();
      updateFormForTipo();
    });
  });

  document.getElementById('btn-guardar').addEventListener('click', guardarMovimiento);
  document.getElementById('btn-limpiar').addEventListener('click', limpiarFormulario);
  document.getElementById('btn-exportar').addEventListener('click', exportar);
}

function updateFormForTipo() {
  const nivelAnteriorGrupo = document.getElementById('grupo-nivel-anterior');
  const nivelGrupo = document.getElementById('grupo-nivel');

  if (tipoMovimiento === 'CAMBNIV') {
    nivelAnteriorGrupo.classList.remove('hidden');
    nivelGrupo.querySelector('.form-label').textContent = 'Nivel nuevo';
  } else {
    nivelAnteriorGrupo.classList.add('hidden');
    nivelGrupo.querySelector('.form-label').textContent = 'Nivel';
  }
}

// ── Athlete search ────────────────────────────────────────
function setupDeportistaBusqueda() {
  document.getElementById('btn-buscar').addEventListener('click', buscarAtleta);
  document.getElementById('input-dni').addEventListener('keydown', e => {
    if (e.key === 'Enter') buscarAtleta();
  });
}

async function buscarAtleta() {
  const dni = document.getElementById('input-dni').value.trim();
  if (!dni) return;
  try {
    const data = await buscarDeportista(dni);
    if (data.found) {
      deportistaActual = data;
      mostrarDeportista(data.deportista, data.pad_records);
    } else {
      mostrarMensajeNoEncontrado(dni);
    }
  } catch (e) {
    showToast('Error al buscar deportista: ' + e.message, 'error');
  }
}

function mostrarDeportista(d, padRecords) {
  const info = document.getElementById('deportista-info');
  const activoTag = padRecords.filter(p => p.cod_estado_pad === 'ACT')
    .map(p => `<span class="badge-tipo badge-${p.cod_tipo_pad.toLowerCase()}">${p.cod_tipo_pad} ${p.cod_nivel}</span>`)
    .join(' ');

  info.innerHTML = `
    <div class="name">${d.ap_paterno} ${d.ap_materno}, ${d.nombres}</div>
    <div style="margin-top:4px; color:var(--text-muted)">
      ${d.tipo_documento}: ${d.num_documento} &nbsp;·&nbsp; ${d.sexo === 'M' ? 'Masculino' : 'Femenino'}
      &nbsp;·&nbsp; ${d.asociacion ?? 'Sin asociación'}
    </div>
    ${activoTag ? `<div style="margin-top:6px">${activoTag}</div>` : ''}
  `;
  info.classList.remove('hidden');
  document.getElementById('form-pad-details').classList.remove('hidden');

  // Pre-select tipo PAD if athlete already has one
  if (padRecords.length > 0) {
    const activo = padRecords.find(p => p.cod_estado_pad === 'ACT');
    if (activo) {
      document.getElementById('sel-tipo-pad').value = activo.cod_tipo_pad;
      filtrarNivelesPorTipo(activo.cod_tipo_pad);
      if (tipoMovimiento === 'CAMBNIV') {
        document.getElementById('sel-nivel-anterior').value = activo.cod_nivel;
      }
    }
  }
}

function mostrarMensajeNoEncontrado(dni) {
  const info = document.getElementById('deportista-info');
  info.innerHTML = `
    <div>No se encontró deportista con DNI <strong>${dni}</strong>.
    <button id="btn-nuevo-deportista" class="btn btn-link">+ Crear nuevo deportista</button></div>
  `;
  info.classList.remove('hidden');
  document.getElementById('btn-nuevo-deportista').addEventListener('click', () => {
    document.getElementById('new-num-doc').value = dni;
    openModal();
  });
}

function resetDeportistaSearch() {
  deportistaActual = null;
  document.getElementById('input-dni').value = '';
  document.getElementById('deportista-info').classList.add('hidden');
  document.getElementById('form-pad-details').classList.add('hidden');
}

// ── Niveles / Asociaciones dropdowns ──────────────────────
function populateNiveles() {
  if (!catalogos) return;
  const sel = document.getElementById('sel-nivel');
  const selAnt = document.getElementById('sel-nivel-anterior');
  sel.innerHTML = '';
  selAnt.innerHTML = '';
  for (const n of catalogos.niveles) {
    const opt = new Option(`${n.cod_nivel} — ${n.descripcion}`, n.cod_nivel);
    opt.dataset.tipo = n.cod_tipo_pad;
    sel.appendChild(opt);
    selAnt.appendChild(opt.cloneNode(true));
  }
  filtrarNivelesPorTipo('PAD1');

  document.getElementById('sel-tipo-pad').addEventListener('change', e => {
    filtrarNivelesPorTipo(e.target.value);
  });
}

function filtrarNivelesPorTipo(tipoPad) {
  ['sel-nivel', 'sel-nivel-anterior'].forEach(id => {
    Array.from(document.getElementById(id).options).forEach(opt => {
      opt.hidden = opt.dataset.tipo !== tipoPad;
    });
  });
}

function populateAsociaciones() {
  if (!catalogos) return;
  const sel = document.getElementById('new-asociacion');
  sel.innerHTML = '<option value="">— Seleccione —</option>';
  for (const a of catalogos.asociaciones) {
    sel.appendChild(new Option(a.nombre, a.cod_asociacion));
  }
}

// ── Expedientes ───────────────────────────────────────────
function setupExpedientes() {
  document.getElementById('btn-add-exp').addEventListener('click', addExpedienteRow);
  document.getElementById('expedientes-list').addEventListener('click', e => {
    if (e.target.classList.contains('btn-remove-exp')) {
      const rows = document.querySelectorAll('.expediente-row');
      if (rows.length > 1) e.target.closest('.expediente-row').remove();
    }
  });
}

function addExpedienteRow() {
  const row = document.createElement('div');
  row.className = 'expediente-row';
  row.innerHTML = `
    <select class="form-input exp-tipo" style="width:160px">
      <option value="INFORME">Informe</option>
      <option value="EXPEDIENTE" selected>Expediente</option>
      <option value="OFICIO">Oficio</option>
      <option value="RESOLUCION">Resolución</option>
      <option value="OTRO">Otro</option>
    </select>
    <input type="text" class="form-input exp-nro" placeholder="Nro. expediente" />
    <button class="btn btn-icon btn-remove-exp" title="Quitar">✕</button>
  `;
  document.getElementById('expedientes-list').appendChild(row);
}

function getExpedientes() {
  return Array.from(document.querySelectorAll('.expediente-row'))
    .map(row => ({
      tipo_documento: row.querySelector('.exp-tipo').value,
      nro_expediente: row.querySelector('.exp-nro').value.trim(),
    }))
    .filter(e => e.nro_expediente);
}

// ── Save movement ─────────────────────────────────────────
async function guardarMovimiento() {
  if (!deportistaActual) return showToast('Primero busque al deportista', 'error');

  const payload = {
    tipo_movimiento:   tipoMovimiento,
    cod_deportista:    deportistaActual.deportista.cod_deportista,
    cod_tipo_pad:      document.getElementById('sel-tipo-pad').value,
    cod_nivel:         document.getElementById('sel-nivel').value,
    cod_nivel_anterior:document.getElementById('sel-nivel-anterior').value || null,
    nro_informe:       document.getElementById('input-informe').value.trim(),
    periodo_vigencia:  document.getElementById('input-periodo').value.trim(),
    motivo:            document.getElementById('input-motivo').value.trim(),
    detalle_evento:    document.getElementById('input-detalle').value.trim(),
    expedientes:       getExpedientes(),
  };

  try {
    const result = await registrarMovimiento(payload);
    showToast(`Movimiento registrado correctamente (cod_cambio: ${result.cod_cambio})`, 'success');
    addToSessionTable(payload, result);
    limpiarFormulario();
    renderDashboard(); // refresh KPIs
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
}

function addToSessionTable(payload, result) {
  const tbody = document.getElementById('tabla-session-body');
  if (tbody.querySelector('.text-muted')) tbody.innerHTML = '';
  const tr = document.createElement('tr');
  const d = deportistaActual.deportista;
  tr.innerHTML = `
    <td><span class="badge-mov badge-${payload.tipo_movimiento.toLowerCase()}">${payload.tipo_movimiento}</span></td>
    <td>${d.ap_paterno} ${d.ap_materno}, ${d.nombres}</td>
    <td>${payload.cod_tipo_pad}</td>
    <td>${payload.cod_nivel}</td>
    <td>${payload.nro_informe || '—'}</td>
    <td><span class="badge-estado badge-act">OK cod_cambio=${result.cod_cambio}</span></td>
  `;
  tbody.prepend(tr);
}

function limpiarFormulario() {
  resetDeportistaSearch();
  document.getElementById('input-informe').value = '';
  document.getElementById('input-periodo').value = '';
  document.getElementById('input-motivo').value = '';
  document.getElementById('input-detalle').value = '';
  document.getElementById('expedientes-list').innerHTML = `
    <div class="expediente-row">
      <select class="form-input exp-tipo" style="width:160px">
        <option value="INFORME">Informe</option>
        <option value="EXPEDIENTE" selected>Expediente</option>
        <option value="OFICIO">Oficio</option>
        <option value="RESOLUCION">Resolución</option>
        <option value="OTRO">Otro</option>
      </select>
      <input type="text" class="form-input exp-nro" placeholder="Nro. expediente" />
      <button class="btn btn-icon btn-remove-exp" title="Quitar">✕</button>
    </div>`;
}

// ── Export ────────────────────────────────────────────────
async function exportar() {
  try {
    const r = await exportarDatos();
    showToast(`Datos exportados: ${r.registros} deportistas activos al ${new Date(r.exportado).toLocaleString('es-PE')}`, 'success');
  } catch (e) {
    showToast('Error exportando: ' + e.message, 'error');
  }
}

// ── Modal: new athlete ────────────────────────────────────
function setupModalDeportista() {
  document.querySelectorAll('.modal-close, .modal-close-btn').forEach(btn => {
    btn.addEventListener('click', closeModal);
  });
  document.querySelector('.modal-backdrop').addEventListener('click', closeModal);
  document.getElementById('btn-crear-deportista').addEventListener('click', crearNuevoDeportista);
}

function openModal() { document.getElementById('modal-deportista').classList.remove('hidden'); }
function closeModal() { document.getElementById('modal-deportista').classList.add('hidden'); }

async function crearNuevoDeportista() {
  const data = {
    num_documento: document.getElementById('new-num-doc').value.trim(),
    tipo_documento:document.getElementById('new-tipo-doc').value,
    ap_paterno:    document.getElementById('new-ap-paterno').value.trim().toUpperCase(),
    ap_materno:    document.getElementById('new-ap-materno').value.trim().toUpperCase(),
    nombres:       document.getElementById('new-nombres').value.trim().toUpperCase(),
    sexo:          document.getElementById('new-sexo').value,
    fecha_nac:     document.getElementById('new-fecha-nac').value,
    cod_asociacion:parseInt(document.getElementById('new-asociacion').value),
    correo:        document.getElementById('new-correo').value.trim(),
    telefono:      document.getElementById('new-telefono').value.trim(),
  };

  if (!data.num_documento || !data.ap_paterno || !data.nombres || !data.fecha_nac || !data.cod_asociacion) {
    return showToast('Complete los campos obligatorios', 'error');
  }

  try {
    const result = await crearDeportista(data);
    deportistaActual = {
      deportista: { ...data, cod_deportista: result.cod_deportista },
      pad_records: [],
    };
    closeModal();
    mostrarDeportista(deportistaActual.deportista, []);
    document.getElementById('form-pad-details').classList.remove('hidden');
    showToast('Deportista creado correctamente', 'success');
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
}

// ── Cuenta module ─────────────────────────────────────────
function setupCuentaModule() {
  let giroTipo = 'CUENTA';
  let cuentaDeportista = null;

  document.getElementById('btn-buscar-cuenta').addEventListener('click', async () => {
    const dni = document.getElementById('cuenta-dni').value.trim();
    if (!dni) return;
    try {
      const data = await buscarDeportista(dni);
      const info = document.getElementById('cuenta-deportista-info');
      if (data.found) {
        cuentaDeportista = data.deportista;
        info.innerHTML = `
          <div class="name">${data.deportista.ap_paterno} ${data.deportista.ap_materno}, ${data.deportista.nombres}</div>
          <div class="text-muted">Cuenta actual: ${data.deportista.num_cuenta ?? '<em>Sin cuenta registrada</em>'}</div>`;
        info.classList.remove('hidden');
        document.getElementById('form-cuenta').classList.remove('hidden');
        if (data.deportista.num_cuenta) {
          document.getElementById('input-num-cuenta').value = data.deportista.num_cuenta;
        }
      } else {
        info.innerHTML = `<div>No se encontró deportista con DNI <strong>${dni}</strong></div>`;
        info.classList.remove('hidden');
      }
    } catch (e) {
      showToast('Error: ' + e.message, 'error');
    }
  });

  document.querySelectorAll('.giro-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.giro-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      giroTipo = btn.dataset.giro;
      document.getElementById('grupo-num-cuenta').classList.toggle('hidden', giroTipo === 'OPE');
    });
  });

  document.getElementById('btn-guardar-cuenta').addEventListener('click', async () => {
    if (!cuentaDeportista) return;
    const num_cuenta = document.getElementById('input-num-cuenta').value.trim();
    if (giroTipo === 'CUENTA' && !num_cuenta) return showToast('Ingrese el número de cuenta', 'error');
    try {
      await actualizarCuenta(cuentaDeportista.cod_deportista, { num_cuenta, tipo_giro: giroTipo });
      showToast('Número de cuenta actualizado correctamente', 'success');
    } catch (e) {
      showToast('Error: ' + e.message, 'error');
    }
  });
}

// ── Toast ─────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  document.getElementById('toast-container').appendChild(t);
  setTimeout(() => t.remove(), 4500);
}

// ── Boot ──────────────────────────────────────────────────
init();
