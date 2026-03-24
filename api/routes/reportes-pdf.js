const express = require('express');
const router  = express.Router();
const PDFDocument = require('pdfkit');
const { query } = require('../db');
const logger = require('../logger');
const { validarParamsReporte } = require('../middleware/validate');

// ── Helpers ────────────────────────────────────────────────────────────────
const MESES = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio',
               'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function periodoLabel(p) {
  if (!p || p.length !== 6) return p || '';
  return MESES[parseInt(p.slice(4,6))] + ' ' + p.slice(0,4);
}
function formatSoles(n) {
  if (n == null) return '—';
  return 'S/ ' + Number(n).toLocaleString('es-PE', { minimumFractionDigits:2, maximumFractionDigits:2 });
}
function padLabel(cod) {
  return (cod||'').replace('PAD1','PAD I').replace('PAD2','PAD II');
}
function currentPeriodo() {
  const d = new Date();
  return d.getFullYear() + String(d.getMonth()+1).padStart(2,'0');
}

// ── Paleta exacta de los PDFs reales ──────────────────────────────────────
const C = {
  sectionBg:  '#404040',   // Bandas de sección + col headers Técnico/Económico
  cambiosBg:  '#808080',   // Col headers Cambios PAD (gris medio, texto negro)
  rowEven:    '#F2F2F2',   // Filas pares zebra
  rowOdd:     '#FFFFFF',
  totalBg:    '#404040',   // Fila de totales
  headerText: '#FFFFFF',   // Texto sobre fondos oscuros
  bodyText:   '#000000',
  border:     '#CCCCCC',   // Bordes 0.5pt
  ingreso:    '#1F7A50',   // Verde — estado INGRESO en Cambios PAD
  cambio:     '#D4820A',   // Ámbar — estado CAMBIO
  retiro:     '#C0392B',   // Rojo  — estado RETIRO
};

const FOOTER_H = 24;

// ── drawHeader3col ─────────────────────────────────────────────────────────
// Caja de 3 columnas: [IPD/DINADAF | TÍTULO | CÓDIGO/VERSIÓN]
// periodoGrande=true → Cambios PAD: período en 22pt en lugar del subtítulo bajo caja
function drawHeader3col(doc, titulo, subtitulo, codigo, periodoGrande) {
  const mL = doc.page.margins.left;
  const mT = doc.page.margins.top;
  const mR = doc.page.margins.right;
  const W  = doc.page.width - mL - mR;

  const BOX_H = 48;
  const LOGO_W = 90;
  const CODE_W = 90;
  const CTR_W  = W - LOGO_W - CODE_W;

  // Caja exterior y divisores
  doc.rect(mL, mT, W, BOX_H).lineWidth(0.5).stroke(C.border);
  doc.moveTo(mL + LOGO_W, mT).lineTo(mL + LOGO_W, mT + BOX_H).lineWidth(0.5).stroke(C.border);
  doc.moveTo(mL + LOGO_W + CTR_W, mT).lineTo(mL + LOGO_W + CTR_W, mT + BOX_H).lineWidth(0.5).stroke(C.border);

  // IZQUIERDA — nombre institucional
  doc.fontSize(7.5).font('Helvetica-Bold').fillColor(C.bodyText)
     .text('INSTITUTO PERUANO', mL + 2, mT + 6,  { width: LOGO_W - 4, align: 'center', lineBreak: false });
  doc.fontSize(7.5).font('Helvetica-Bold').fillColor(C.bodyText)
     .text('DEL DEPORTE',       mL + 2, mT + 17, { width: LOGO_W - 4, align: 'center', lineBreak: false });
  doc.fontSize(6.5).font('Helvetica').fillColor('#555')
     .text('IPD / DINADAF',     mL + 2, mT + 29, { width: LOGO_W - 4, align: 'center', lineBreak: false });
  doc.fontSize(6).font('Helvetica').fillColor('#777')
     .text('UF-PMD',            mL + 2, mT + 39, { width: LOGO_W - 4, align: 'center', lineBreak: false });

  // CENTRO — título + período grande (Cambios PAD) o solo título
  if (periodoGrande) {
    doc.fontSize(11).font('Helvetica-Bold').fillColor(C.bodyText)
       .text(titulo, mL + LOGO_W + 2, mT + 4, { width: CTR_W - 4, align: 'center', lineBreak: false });
    doc.fontSize(20).font('Helvetica-Bold').fillColor(C.bodyText)
       .text(subtitulo, mL + LOGO_W + 2, mT + 17, { width: CTR_W - 4, align: 'center', lineBreak: false });
  } else {
    doc.fontSize(11).font('Helvetica-Bold').fillColor(C.bodyText)
       .text(titulo, mL + LOGO_W + 2, mT + 17, { width: CTR_W - 4, align: 'center', lineBreak: false });
  }

  // DERECHA — código y versión
  const RX = mL + LOGO_W + CTR_W + 4;
  doc.fontSize(7.5).font('Helvetica').fillColor(C.bodyText)
     .text('Código :',    RX, mT + 9,  { width: CODE_W - 8, lineBreak: false });
  doc.fontSize(8).font('Helvetica-Bold').fillColor(C.bodyText)
     .text(codigo,        RX, mT + 20, { width: CODE_W - 8, lineBreak: false });
  doc.fontSize(7.5).font('Helvetica').fillColor(C.bodyText)
     .text('Versión : 01', RX, mT + 32, { width: CODE_W - 8, lineBreak: false });

  // Subtítulo (período) bajo la caja — solo Técnico/Económico
  let yAfter = mT + BOX_H;
  if (!periodoGrande) {
    yAfter += 5;
    doc.fontSize(9).font('Helvetica-Bold').fillColor(C.bodyText)
       .text(subtitulo, mL, yAfter, { width: W, align: 'center', lineBreak: false });
    yAfter += 14;
  } else {
    yAfter += 7;
  }
  return yAfter;
}

// ── drawPageFooter ──────────────────────────────────────────────────────────
function drawPageFooter(doc, pageNum, totalPages) {
  const mL = doc.page.margins.left;
  const mB = doc.page.margins.bottom;
  const W  = doc.page.width - mL - doc.page.margins.right;
  const FY = doc.page.height - mB + 6;
  doc.fontSize(8).font('Helvetica').fillColor('#888')
     .text(`Página ${pageNum} de ${totalPages}`, mL, FY, { width: W, align: 'right', lineBreak: false });
}

// ── drawSectionBanner ───────────────────────────────────────────────────────
function drawSectionBanner(doc, label, y, tableW, mL) {
  const H = 16;
  doc.rect(mL, y, tableW, H).fill(C.sectionBg);
  doc.fontSize(8).font('Helvetica-Bold').fillColor(C.headerText)
     .text(label, mL + 5, y + 4, { width: tableW - 10, lineBreak: false });
  return y + H;
}

// ── drawColHeader ───────────────────────────────────────────────────────────
function drawColHeader(doc, columns, y, mL, bgColor) {
  const bg = bgColor || C.sectionBg;
  const H  = 16;
  const TW = columns.reduce((s, c) => s + c.width, 0);
  doc.rect(mL, y, TW, H).fill(bg);
  const textColor = (bg === C.cambiosBg) ? C.bodyText : C.headerText;
  doc.fontSize(7).font('Helvetica-Bold').fillColor(textColor);
  let cx = mL;
  columns.forEach(col => {
    doc.text(col.label, cx + 2, y + 4,
             { width: col.width - 4, align: col.align || 'center', lineBreak: false });
    cx += col.width;
  });
  return y + H;
}

// ── drawDataRow ─────────────────────────────────────────────────────────────
// specialCells: [{colIdx, bg, color}] — sobreescribe fondo y color de texto de esa celda
function drawDataRow(doc, columns, row, y, idx, mL, rowH, specialCells) {
  const H  = rowH || 14;
  const TW = columns.reduce((s, c) => s + c.width, 0);

  // Fondo de fila (zebra)
  if (idx % 2 === 1) {
    doc.rect(mL, y, TW, H).fill(C.rowEven);
  }

  // Fondos de celdas especiales
  if (specialCells && specialCells.length) {
    let cx2 = mL;
    columns.forEach((col, j) => {
      const sp = specialCells.find(s => s.colIdx === j);
      if (sp && sp.bg) doc.rect(cx2, y, col.width, H).fill(sp.bg);
      cx2 += col.width;
    });
  }

  // Texto
  let cx = mL;
  columns.forEach((col, j) => {
    const val   = typeof col.value === 'function' ? col.value(row) : (row[col.key] ?? '');
    const sp    = specialCells?.find(s => s.colIdx === j);
    const color = sp ? sp.color : C.bodyText;
    const font  = sp ? 'Helvetica-Bold' : 'Helvetica';
    doc.fontSize(7).font(font).fillColor(color)
       .text(String(val), cx + 2, y + 3,
             { width: col.width - 4, align: col.align || 'left', lineBreak: false });
    cx += col.width;
  });

  // Borde inferior
  doc.moveTo(mL, y + H).lineTo(mL + TW, y + H).lineWidth(0.3).stroke(C.border);
  return y + H;
}

// ── drawTotalRow ─────────────────────────────────────────────────────────────
function drawTotalRow(doc, leftLabel, rightLabel, y, tableW, mL) {
  const H = 16;
  doc.rect(mL, y, tableW, H).fill(C.totalBg);
  doc.fontSize(7.5).font('Helvetica-Bold').fillColor(C.headerText);
  if (leftLabel)  doc.text(leftLabel,  mL + 5, y + 4, { width: tableW / 2, lineBreak: false });
  if (rightLabel) doc.text(rightLabel, mL,      y + 4, { width: tableW - 5, align: 'right', lineBreak: false });
  return y + H;
}

// ── needNewPage factory ───────────────────────────────────────────────────────
function makeNeedNewPage(doc, titulo, subtitulo, codigo, pageH, mB, yRef, periodoGrande) {
  return function(needed) {
    if (yRef.y + needed > pageH - mB - 25) {
      doc.addPage();
      yRef.y = drawHeader3col(doc, titulo, subtitulo, codigo, periodoGrande);
    }
  };
}

// ════════════════════════════════════════════════════════════════════════════
// CONSOLIDADO TÉCNICO (SUB-FO-25) — Portrait A4
// ════════════════════════════════════════════════════════════════════════════
router.get('/consolidado-tecnico', async (req, res) => {
  try {
    const tipo    = req.query.tipo    || 'PAD1';
    const periodo = req.query.periodo || currentPeriodo();
    const vErr = validarParamsReporte(tipo, periodo);
    if (vErr) return res.status(400).json({ error: vErr });

    const pCheck = await query(`SELECT cerrado FROM pad.periodos_cambios WHERE periodo = $1::VARCHAR`, [periodo]);
    if (!pCheck.recordset.length || !pCheck.recordset[0].cerrado) {
      return res.status(403).json({ error: `El periodo ${periodo} no esta cerrado. Solo se pueden emitir consolidados de periodos cerrados.` });
    }

    const movResult = await query(`
      SELECT c.cod_tip_mov, c.nivel_anterior, c.nivel_nuevo,
             d.ap_paterno, d.ap_materno, d.nombres, d.num_documento,
             p.cod_nivel, p.cod_tipo_pad, a.nombre AS asociacion
      FROM pad.cambios_PAD c
      JOIN pad.PAD p ON c.cod_pad = p.cod_pad
      JOIN pad.Deportistas d ON p.cod_deportista = d.cod_deportista
      LEFT JOIN pad.Asociacion_Deportiva a ON d.cod_asociacion = a.cod_asociacion
      WHERE c.periodo_vigencia = $1::VARCHAR AND p.cod_tipo_pad = $2::VARCHAR
      ORDER BY c.cod_tip_mov, a.nombre, d.ap_paterno
    `, [periodo, tipo]);

    const activosResult = await query(`
      SELECT d.ap_paterno, d.ap_materno, d.nombres, d.num_documento,
             p.cod_nivel, p.cod_tipo_pad, a.nombre AS asociacion
      FROM pad.PAD p
      JOIN pad.Deportistas d ON p.cod_deportista = d.cod_deportista
      LEFT JOIN pad.Asociacion_Deportiva a ON d.cod_asociacion = a.cod_asociacion
      WHERE p.cod_estado_pad = 'ACT' AND p.cod_tipo_pad = $1::VARCHAR
      ORDER BY a.nombre, d.ap_paterno, d.ap_materno
    `, [tipo]);

    const movRows    = movResult.recordset;
    const activoRows = activosResult.recordset;
    const grupos     = { ING: [], CAMBNIV: [], RET: [] };
    movRows.forEach(r => { if (grupos[r.cod_tip_mov]) grupos[r.cod_tip_mov].push(r); });
    const movByDNI   = {};
    movRows.forEach(r => { movByDNI[r.num_documento] = r; });

    const subtipoLabel = tipo === 'PAD1' ? 'I' : tipo === 'PAD2' ? 'II' : '(PNM)';
    const titulo    = 'CONSOLIDADO DEL INFORME TÉCNICO';
    const subtitulo = `PROGRAMA DE APOYO AL DEPORTISTA ${subtipoLabel} - ${periodoLabel(periodo).toUpperCase()}`;
    const codigo    = 'SUB-FO-25';
    const mL = 40, mT = 40, mB = 30, mR = 40;
    const pageH = 841.89; // A4 portrait

    // Usable width: 595.28 - 80 = 515pt
    const columns = [
      { label: 'Nº',         width:  25, key: '_n',      align: 'center' },
      { label: 'FEDERACIÓN', width: 125, key: 'asociacion' },
      { label: 'DEPORTISTA', width: 210, value: r => `${r.ap_paterno} ${r.ap_materno}, ${r.nombres}` },
      { label: 'ESTADO',     width:  90, key: '_estado',  align: 'center' },
      { label: 'NIVEL',      width:  65, key: 'cod_nivel', align: 'center' },
    ];
    const tableW = columns.reduce((s, c) => s + c.width, 0); // 515

    const doc = new PDFDocument({
      size: 'A4', layout: 'portrait',
      margins: { top: mT, bottom: 10, left: mL, right: mR },
      autoFirstPage: true, bufferPages: true,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `inline; filename=Consolidado_Tecnico_${padLabel(tipo).replace(/ /g,'_')}_${periodo}.pdf`);
    doc.pipe(res);

    const yRef = { y: drawHeader3col(doc, titulo, subtitulo, codigo, false) };
    const needNewPage = makeNeedNewPage(doc, titulo, subtitulo, codigo, pageH, mB, yRef, false);

    const movLabels = { ING: 'INGRESOS', CAMBNIV: 'CAMBIOS DE NIVEL', RET: 'RETIROS' };
    const estadoLbl = {
      ING:     () => 'INGRESO',
      CAMBNIV: r  => `${r.nivel_anterior || '—'} → ${r.nivel_nuevo || '—'}`,
      RET:     () => 'RETIRO',
    };
    const ESTADO_COL = 3; // índice de columna ESTADO

    // Secciones de movimientos
    for (const movType of ['ING', 'CAMBNIV', 'RET']) {
      const grp = grupos[movType];
      if (!grp.length) continue;
      needNewPage(16 + 16 + 14);
      yRef.y = drawSectionBanner(doc,
        `${movLabels[movType]}  (${grp.length} registro${grp.length > 1 ? 's' : ''})`,
        yRef.y, tableW, mL);
      yRef.y = drawColHeader(doc, columns, yRef.y, mL); // bg #404040

      grp.forEach((r, i) => {
        r._n      = i + 1;
        r._estado = estadoLbl[movType](r);
        needNewPage(14);
        // Celda ESTADO con fondo oscuro y texto blanco
        const sp = [{ colIdx: ESTADO_COL, bg: C.sectionBg, color: C.headerText }];
        yRef.y = drawDataRow(doc, columns, r, yRef.y, i, mL, 14, sp);
      });
      yRef.y += 8;
    }

    // Sección CONSOLIDADO (nómina completa)
    needNewPage(16 + 16 + 14);
    yRef.y = drawSectionBanner(doc,
      `CONSOLIDADO - PROGRAMA DE APOYO AL DEPORTISTA ${subtipoLabel}  (${activoRows.length} deportistas activos)`,
      yRef.y, tableW, mL);
    yRef.y = drawColHeader(doc, columns, yRef.y, mL);

    activoRows.forEach((r, i) => {
      r._n = i + 1;
      const mov = movByDNI[r.num_documento];
      r._estado = mov ? estadoLbl[mov.cod_tip_mov](mov) : '';
      needNewPage(14);
      const sp = mov ? [{ colIdx: ESTADO_COL, bg: C.sectionBg, color: C.headerText }] : [];
      yRef.y = drawDataRow(doc, columns, r, yRef.y, i, mL, 14, sp);
    });

    // Resumen por Federación y Nivel
    yRef.y += 12;
    needNewPage(16 + 16 + 14);
    yRef.y = drawSectionBanner(doc, 'RESUMEN POR FEDERACIÓN Y NIVEL', yRef.y, tableW, mL);
    
    const levels = [...new Set(activoRows.map(r => r.cod_nivel))].sort();
    const resumCols = [ { label: 'FEDERACIÓN', width: 225, key: 'fed' } ];
    levels.forEach(lv => resumCols.push({ label: lv, width: 45, key: lv, align: 'center' }));
    resumCols.push({ label: 'TOTAL', width: 65, key: 'total', align: 'center' });

    yRef.y = drawColHeader(doc, resumCols, yRef.y, mL);
    const fedGroup = {};
    activoRows.forEach(r => {
      const f = r.asociacion || '(Sin Asignar)';
      if (!fedGroup[f]) fedGroup[f] = { fed: f, total: 0 };
      fedGroup[f][r.cod_nivel] = (fedGroup[f][r.cod_nivel] || 0) + 1;
      fedGroup[f].total++;
    });

    Object.values(fedGroup).sort((a, b) => a.fed.localeCompare(b.fed)).forEach((fedData, i) => {
      needNewPage(14);
      levels.forEach(lv => { if (!fedData[lv]) fedData[lv] = '-'; });
      yRef.y = drawDataRow(doc, resumCols, fedData, yRef.y, i, mL, 14, []);
    });
    
    // Total general al final (solo si hay al menos un activo)
    if (activoRows.length > 0) {
      needNewPage(16);
      drawTotalRow(doc, `Total: ${activoRows.length} deportistas activos`, '', yRef.y, tableW, mL);
    }

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      drawPageFooter(doc, i + 1, range.count);
    }
    doc.flushPages();
    doc.end();
  } catch (err) {
    logger.error('reportes-pdf', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// CONSOLIDADO ECONÓMICO (SUB-FO-26) — Landscape A4
// ════════════════════════════════════════════════════════════════════════════
router.get('/consolidado-economico', async (req, res) => {
  try {
    const tipo    = req.query.tipo    || 'PAD1';
    const periodo = req.query.periodo || currentPeriodo();
    const vErr = validarParamsReporte(tipo, periodo);
    if (vErr) return res.status(400).json({ error: vErr });

    const pCheck = await query(`SELECT cerrado FROM pad.periodos_cambios WHERE periodo = $1::VARCHAR`, [periodo]);
    if (!pCheck.recordset.length || !pCheck.recordset[0].cerrado) {
      return res.status(403).json({ error: `El periodo ${periodo} no esta cerrado. Solo se pueden emitir consolidados de periodos cerrados.` });
    }

    const result = await query(`
      SELECT d.num_documento, d.ap_paterno, d.ap_materno, d.nombres,
             d.num_cuenta, p.cod_tipo_pad, p.cod_nivel,
             a.nombre AS asociacion, mr.monto_soles,
             ap.num_documento AS apo_documento,
             ap.ap_paterno AS apo_paterno, ap.ap_materno AS apo_materno,
             ap.nombres AS apo_nombres,
             CASE WHEN EXTRACT(YEAR FROM AGE(now(), d.fecha_nac)) < 18 THEN 1 ELSE 0 END AS es_menor
      FROM pad.PAD p
      JOIN pad.Deportistas d ON p.cod_deportista = d.cod_deportista
      LEFT JOIN pad.Asociacion_Deportiva a ON d.cod_asociacion = a.cod_asociacion
      LEFT JOIN pad.montos_referencia mr
             ON mr.cod_nivel = p.cod_nivel
            AND $1::VARCHAR BETWEEN mr.periodo_desde AND COALESCE(mr.periodo_hasta, '999999')
      LEFT JOIN pad.Apoderados ap ON d.cod_deportista = ap.cod_deportista
      WHERE p.cod_estado_pad = 'ACT' AND p.cod_tipo_pad = $2::VARCHAR
      ORDER BY a.nombre, d.ap_paterno, d.ap_materno
    `, [periodo, tipo]);

    const rows  = result.recordset;
    const total = rows.reduce((s, r) => s + (parseFloat(r.monto_soles) || 0), 0);

    const subtipoLabel = tipo === 'PAD1' ? 'I' : tipo === 'PAD2' ? 'II' : '(PNM)';
    const titulo    = 'CONSOLIDADO DEL INFORME ECONÓMICO';
    const subtitulo = `PROGRAMA DE APOYO AL DEPORTISTA ${subtipoLabel} - ${periodoLabel(periodo).toUpperCase()}`;
    const codigo    = 'SUB-FO-26';
    const mL = 30, mT = 40, mB = 30, mR = 30;
    const pageH = 841.89; // A4 portrait height

    // Portrait usable width: 515pt
    const columns = [
      { label: 'Nº',             width:  15, key: '_n',          align: 'center' },
      { label: 'FEDERACIÓN',     width:  80, key: 'asociacion' },
      { label: 'DEPORTISTA',     width: 100, value: r => `${r.ap_paterno} ${r.ap_materno}, ${r.nombres}` },
      { label: 'NRO. DE CUENTA', width:  65, value: r => r.num_cuenta || 'OPE', align: 'center' },
      { label: 'NRO. DOC.',      width:  50, key: 'num_documento', align: 'center' },
      { label: 'APODERADO',      width:  80, value: r => r.es_menor && r.apo_paterno
          ? `${r.apo_paterno} ${r.apo_materno||''}, ${r.apo_nombres||''}`.trim() : '' },
      { label: 'DNI APO.',       width:  45, value: r => r.es_menor && r.apo_documento ? r.apo_documento : '', align: 'center' },
      { label: 'NIVEL',          width:  35, key: 'cod_nivel',   align: 'center' },
      { label: 'MONTO',          width:  45, value: r => formatSoles(r.monto_soles), align: 'right' },
    ];
    const tableW = columns.reduce((s, c) => s + c.width, 0); // 515

    const doc = new PDFDocument({
      size: 'A4', layout: 'portrait',
      margins: { top: mT, bottom: 10, left: mL, right: mR },
      autoFirstPage: true, bufferPages: true,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `inline; filename=Consolidado_Economico_${padLabel(tipo).replace(/ /g,'_')}_${periodo}.pdf`);
    doc.pipe(res);

    const yRef = { y: drawHeader3col(doc, titulo, subtitulo, codigo, false) };
    const needNewPage = makeNeedNewPage(doc, titulo, subtitulo, codigo, pageH, mB, yRef, false);

    needNewPage(16 + 16 + 14);
    yRef.y = drawSectionBanner(doc,
      `CONSOLIDADO ECONÓMICO - PROGRAMA DE APOYO AL DEPORTISTA ${subtipoLabel}`,
      yRef.y, tableW, mL);
    yRef.y = drawColHeader(doc, columns, yRef.y, mL);

    rows.forEach((r, i) => {
      r._n = i + 1;
      needNewPage(14);
      yRef.y = drawDataRow(doc, columns, r, yRef.y, i, mL, 14, []);
    });

    needNewPage(16);
    drawTotalRow(doc, `Total: ${rows.length} deportistas`, formatSoles(total), yRef.y, tableW, mL);

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      drawPageFooter(doc, i + 1, range.count);
    }
    doc.flushPages();
    doc.end();
  } catch (err) {
    logger.error('reportes-pdf', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// REGISTRO DE CAMBIOS PAD (SUB-FO-24) — Landscape A4
// ════════════════════════════════════════════════════════════════════════════
router.get('/cambios-pad', async (req, res) => {
  try {
    const periodo = req.query.periodo || currentPeriodo();
    const tipo    = req.query.tipo;

    let whereClause = 'WHERE c.periodo_vigencia = $1::VARCHAR';
    const inputs = [periodo];
    if (tipo) {
      whereClause += ' AND p.cod_tipo_pad = $2::VARCHAR';
      inputs.push(tipo);
    }

    const result = await query(`
      SELECT c.cod_cambio, c.nro_informe, c.periodo_vigencia, c.motivo,
             c.nivel_anterior, c.nivel_nuevo, c.cod_tip_mov,
             d.num_documento, d.ap_paterno, d.ap_materno, d.nombres,
             p.cod_tipo_pad, a.nombre AS asociacion,
             (SELECT string_agg(e.nro_expediente, ' / ')
              FROM pad.expedientes_cambio e WHERE e.cod_cambio = c.cod_cambio) AS expedientes
      FROM pad.cambios_PAD c
      JOIN pad.PAD p ON c.cod_pad = p.cod_pad
      JOIN pad.Deportistas d ON p.cod_deportista = d.cod_deportista
      LEFT JOIN pad.Asociacion_Deportiva a ON d.cod_asociacion = a.cod_asociacion
      ${whereClause}
      ORDER BY c.cod_tip_mov, d.ap_paterno, d.ap_materno
    `, inputs);

    const rows   = result.recordset;
    const grupos = {};
    rows.forEach(r => {
      if (!grupos[r.cod_tip_mov]) grupos[r.cod_tip_mov] = [];
      grupos[r.cod_tip_mov].push(r);
    });

    const titulo    = 'REGISTRO DE CAMBIOS DEL PAD';
    const subtitulo = periodoLabel(periodo);  // "Febrero 2026" — se muestra grande
    const codigo    = 'SUB-FO-24';
    const mL = 30, mT = 40, mB = 30, mR = 30;
    const pageH = 595.28; // landscape

    // Landscape columnas — tableW ≈ 781
    const columns = [
      { label: 'Nro.',                            width:  22, key: '_n',         align: 'center' },
      { label: 'Programa',                         width:  60, value: r => padLabel(r.cod_tipo_pad), align: 'center' },
      { label: 'Estado',                           width:  60, key: '_estado',    align: 'center' },
      { label: 'Federación',                       width:  98, key: 'asociacion' },
      { label: 'Apellidos y Nombres',              width: 160, value: r => `${r.ap_paterno} ${r.ap_materno}, ${r.nombres}` },
      { label: 'DNI',                              width:  58, key: 'num_documento', align: 'center' },
      { label: 'Nivel',                            width:  55, value: r => r.cod_tip_mov === 'CAMBNIV'
          ? `${r.nivel_anterior||'—'} → ${r.nivel_nuevo||'—'}` : (r.nivel_nuevo || r.nivel_anterior || '—'),
          align: 'center' },
      { label: 'Nro. Informe',                     width:  80, key: 'nro_informe',  align: 'center' },
      { label: 'Nro. Expediente',                  width:  80, key: 'expedientes',  align: 'center' },
      { label: 'Motivo',                           width: 108, key: 'motivo' },
    ];
    const tableW = columns.reduce((s, c) => s + c.width, 0); // 781

    const doc = new PDFDocument({
      size: 'A4', layout: 'landscape',
      margins: { top: mT, bottom: 10, left: mL, right: mR },
      autoFirstPage: true, bufferPages: true,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `inline; filename=Cambios_PAD_${periodo}${tipo ? '_'+tipo : ''}.pdf`);
    doc.pipe(res);

    const yRef = { y: drawHeader3col(doc, titulo, subtitulo, codigo, true) };
    const needNewPage = makeNeedNewPage(doc, titulo, subtitulo, codigo, pageH, mB, yRef, true);

    const estadoText  = { ING: 'INGRESO', CAMBNIV: 'CAMBIO', RET: 'RETIRO' };
    const estadoColor = { ING: C.ingreso,  CAMBNIV: C.cambio,  RET: C.retiro  };
    const movLabels   = { ING: 'INGRESOS', CAMBNIV: 'CAMBIOS DE NIVEL', RET: 'RETIROS' };
    const PROG_COL    = 1;
    const ESTADO_COL  = 2;

    let globalN = 0;

    for (const movType of ['ING', 'CAMBNIV', 'RET']) {
      const grp = grupos[movType];
      if (!grp?.length) continue;

      needNewPage(16 + 16 + 20);
      yRef.y = drawSectionBanner(doc,
        `${movLabels[movType]}  (${grp.length} registro${grp.length > 1 ? 's' : ''})`,
        yRef.y, tableW, mL);
      // Col headers en gris medio (#808080) con texto negro
      yRef.y = drawColHeader(doc, columns, yRef.y, mL, C.cambiosBg);

      grp.forEach((r, i) => {
        globalN++;
        r._n      = globalN;
        r._estado = estadoText[r.cod_tip_mov];
        needNewPage(20);

        const rowBg = i % 2 === 1 ? C.rowEven : C.rowOdd;
        // Estado: texto de color (verde/ámbar/rojo), mismo fondo de fila
        const sp = [{ colIdx: ESTADO_COL, bg: rowBg, color: estadoColor[r.cod_tip_mov] }];
        // PAD II: texto ámbar en columna Programa
        if (r.cod_tipo_pad === 'PAD2') {
          sp.push({ colIdx: PROG_COL, bg: rowBg, color: C.cambio });
        }
        yRef.y = drawDataRow(doc, columns, r, yRef.y, i, mL, 20, sp);
      });
      yRef.y += 8;
    }

    // Total
    const ing  = (grupos.ING     || []).length;
    const camb = (grupos.CAMBNIV || []).length;
    const ret  = (grupos.RET     || []).length;
    needNewPage(16);
    drawTotalRow(doc,
      `Total: ${rows.length} registros — Ingresos: ${ing} | Cambios: ${camb} | Retiros: ${ret}`,
      '', yRef.y, tableW, mL);

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      drawPageFooter(doc, i + 1, range.count);
    }
    doc.flushPages();
    doc.end();
  } catch (err) {
    logger.error('reportes-pdf', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
