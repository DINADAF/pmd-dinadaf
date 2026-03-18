import { getKpi, getActivos, getMovimientosRecientes } from './api-client.js';

export async function renderDashboard() {
  await Promise.all([loadKpis(), loadActivos(), loadMovimientos()]);
}

async function loadKpis() {
  try {
    const kpi = await getKpi();
    document.getElementById('kpi-pad1').textContent = kpi.activos_pad1 ?? '—';
    document.getElementById('kpi-pad2').textContent = kpi.activos_pad2 ?? '—';
    document.getElementById('kpi-pnm').textContent = kpi.activos_pnm ?? '—';
    document.getElementById('kpi-total').textContent = kpi.total_activos ?? '—';
    document.getElementById('kpi-les').textContent = kpi.total_les ?? '—';
    if (kpi.exportado) {
      document.getElementById('last-update').textContent =
        'Datos al: ' + new Date(kpi.exportado).toLocaleString('es-PE');
    }
  } catch (e) {
    console.error('Error cargando KPIs:', e);
  }
}

async function loadActivos() {
  try {
    const data = await getActivos();
    const tbody = document.getElementById('tabla-activos-body');
    tbody.innerHTML = '';

    for (const r of data) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${r.deportista ?? `${r.ap_paterno} ${r.ap_materno}, ${r.nombres}`}</td>
        <td>${r.num_documento}</td>
        <td><span class="badge-tipo badge-${r.cod_tipo_pad.toLowerCase()}">${r.cod_tipo_pad}</span></td>
        <td>${r.nivel_desc ?? r.cod_nivel}</td>
        <td>${r.asociacion ?? '—'}</td>
        <td class="text-right">${r.monto_soles ? 'S/ ' + Number(r.monto_soles).toLocaleString('es-PE', {minimumFractionDigits: 2}) : '—'}</td>
        <td><span class="badge-estado badge-${r.cod_estado_pad?.toLowerCase()}">${r.cod_estado_pad ?? 'ACT'}</span></td>
      `;
      tbody.appendChild(tr);
    }

    document.getElementById('activos-count').textContent = `${data.length} deportistas activos`;
  } catch (e) {
    document.getElementById('tabla-activos-body').innerHTML =
      '<tr><td colspan="7" class="text-center text-muted">Sin datos disponibles</td></tr>';
    console.error('Error cargando activos:', e);
  }
}

async function loadMovimientos() {
  try {
    const data = await getMovimientosRecientes();
    const tbody = document.getElementById('tabla-movimientos-body');
    tbody.innerHTML = '';

    const iconos = { ING: '↑', CAMBNIV: '⇄', RET: '↓' };
    const clases = { ING: 'ing', CAMBNIV: 'cambniv', RET: 'ret' };

    for (const r of data.slice(0, 20)) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="badge-mov badge-${clases[r.cod_tipo_movimiento]}">${iconos[r.cod_tipo_movimiento] ?? ''} ${r.cod_tipo_movimiento}</span></td>
        <td>${r.deportista ?? r.num_documento}</td>
        <td>${r.cod_tipo_pad}</td>
        <td>${r.nivel_anterior ? r.nivel_anterior + ' → ' + r.nivel_nuevo : (r.nivel_nuevo ?? '—')}</td>
        <td>${r.nro_informe ?? '—'}</td>
        <td>${r.periodo_vigencia ?? '—'}</td>
        <td>${r.fecha_cambio ? new Date(r.fecha_cambio).toLocaleDateString('es-PE') : '—'}</td>
      `;
      tbody.appendChild(tr);
    }
  } catch (e) {
    console.error('Error cargando movimientos:', e);
  }
}
