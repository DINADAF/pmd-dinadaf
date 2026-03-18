const express = require('express');
const router = express.Router();
const PDFDocument = require('pdfkit');
const { query, sql } = require('../db');

// ── Helpers ────────────────────────────────────────────────
const MESES = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function periodoLabel(p) {
  if (!p || p.length !== 6) return p || '';
  return MESES[parseInt(p.slice(4,6))] + ' ' + p.slice(0,4);
}
function formatSoles(n) {
  if (n == null) return '—';
  return 'S/ ' + Number(n).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function padLabel(cod) {
  return (cod || '').replace('PAD1','PAD I').replace('PAD2','PAD II');
}
function currentPeriodo() {
  const d = new Date();
  return d.getFullYear() + String(d.getMonth()+1).padStart(2,'0');
}

// ── Design constants (grayscale, matching real PDF) ────────
const COL_HDR_BG   = '#404040';
const SEC_BAN_BG   = '#808080';
const ROW_ALT_BG   = '#F2F2F2';
const TOTAL_ROW_BG = '#404040';
const BORDER_C     = '#CCCCCC';
const FOOTER_H     = 24;

// ── drawPageHeader ─────────────────────────────────────────
// 3-column box: [IPD logo text | TITLE | CODE/VERSION]
// Returns y after subtitle line
function drawPageHeader(doc, titulo, subtitulo, codigo) {
  const mL = doc.page.margins.left;
  const mT = doc.page.margins.top;
  const mR = doc.page.margins.right;
  const w  = doc.page.width - mL - mR;
  const hdrH = 36;
  const logoW = 90;
  const codeW = 90;
  const centerW = w - logoW - codeW;

  // Outer border
  doc.rect(mL, mT, w, hdrH).lineWidth(0.5).stroke(BORDER_C);
  // Vertical dividers
  doc.moveTo(mL + logoW, mT).lineTo(mL + logoW, mT + hdrH).lineWidth(0.5).stroke(BORDER_C);
  doc.moveTo(mL + logoW + centerW, mT).lineTo(mL + logoW + centerW, mT + hdrH).lineWidth(0.5).stroke(BORDER_C);

  // LEFT: IPD
  doc.fontSize(7).font('Helvetica-Bold').fillColor('#111')
    .text('INSTITUTO PERUANO', mL, mT + 5, { width: logoW, align: 'center' });
  doc.fontSize(7).font('Helvetica-Bold').fillColor('#111')
    .text('DEL DEPORTE', mL, mT + 14, { width: logoW, align: 'center' });
  doc.fontSize(6.5).font('Helvetica').fillColor('#555')
    .text('IPD / DINADAF', mL, mT + 25, { width: logoW, align: 'center' });

  // CENTER: title
  doc.fontSize(11).font('Helvetica-Bold').fillColor('#000')
    .text(titulo, mL + logoW, mT + 11, { width: centerW, align: 'center' });

  // RIGHT: code + version
  const rx = mL + logoW + centerW;
  doc.fontSize(7.5).font('Helvetica').fillColor('#000')
    .text('Código:', rx, mT + 5, { width: codeW, align: 'center' });
  doc.fontSize(8).font('Helvetica-Bold').fillColor('#000')
    .text(codigo, rx, mT + 14, { width: codeW, align: 'center' });
  doc.fontSize(7.5).font('Helvetica').fillColor('#000')
    .text('Versión: 01', rx, mT + 24, { width: codeW, align: 'center' });

  // Subtitle
  const subY = mT + hdrH + 5;
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#000')
    .text(subtitulo, mL, subY, { width: w, align: 'center' });

  return subY + 17; // y after header
}

// ── drawPageFooter ─────────────────────────────────────────
function drawPageFooter(doc, pageNum, totalPages) {
  const mL  = doc.page.margins.left;
  const mB  = doc.page.margins.bottom;
  const mR  = doc.page.margins.right;
  const w   = doc.page.width - mL - mR;
  const fy  = doc.page.height - mB + 6;
  doc.fontSize(8).font('Helvetica').fillColor('#888')
    .text(`Página ${pageNum} de ${totalPages}`, mL, fy, { width: w, align: 'right' });
}

// ── drawSectionBanner ──────────────────────────────────────
function drawSectionBanner(doc, label, y, tableW, mL) {
  const h = 16;
  doc.rect(mL, y, tableW, h).fill(SEC_BAN_BG);
  doc.fontSize(8).font('Helvetica-Bold').fillColor('#FFFFFF')
    .text(label, mL + 5, y + 4, { width: tableW - 10, lineBreak: false });
  return y + h;
}

// ── drawColHeader ──────────────────────────────────────────
function drawColHeader(doc, columns, y, mL) {
  const h = 16;
  const totalW = columns.reduce((s, c) => s + c.width, 0);
  doc.rect(mL, y, totalW, h).fill(COL_HDR_BG);
  doc.fontSize(7).font('Helvetica-Bold').fillColor('#FFFFFF');
  let cx = mL;
  columns.forEach(col => {
    doc.text(col.label, cx + 2, y + 4, { width: col.width - 4, align: col.align || 'center', lineBreak: false });
    cx += col.width;
  });
  return y + h;
}

// ── drawDataRow ────────────────────────────────────────────
function drawDataRow(doc, columns, row, y, idx, mL) {
  const h = 14;
  const totalW = columns.reduce((s, c) => s + c.width, 0);
  if (idx % 2 === 1) {
    doc.rect(mL, y, totalW, h).fill(ROW_ALT_BG);
  }
  doc.fontSize(7).font('Helvetica').fillColor('#1A1A18');
  let cx = mL;
  columns.forEach(col => {
    const val = typeof col.value === 'function' ? col.value(row) : (row[col.key] ?? '');
    doc.text(String(val), cx + 2, y + 3, { width: col.width - 4, align: col.align || 'left', lineBreak: false });
    cx += col.width;
  });
  doc.moveTo(mL, y + h).lineTo(mL + totalW, y + h).lineWidth(0.3).stroke(BORDER_C);
  return y + h;
}

// ── drawTotalRow ───────────────────────────────────────────
function drawTotalRow(doc, leftLabel, rightLabel, y, tableW, mL) {
  const h = 16;
  doc.rect(mL, y, tableW, h).fill(TOTAL_ROW_BG);
  doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#FFFFFF');
  if (leftLabel)  doc.text(leftLabel,  mL + 5,           y + 4, { width: tableW / 2 - 10, lineBreak: false });
  if (rightLabel) doc.text(rightLabel, mL,                y + 4, { width: tableW - 5, align: 'right', lineBreak: false });
  return y + h;
}

// ── CONSOLIDADO TÉCNICO (SUB-FO-25) ───────────────────────
router.get('/consolidado-tecnico', async (req, res) => {
  try {
    const tipo    = req.query.tipo    || 'PAD1';
    const periodo = req.query.periodo || currentPeriodo();

    // Movements for this period
    const movResult = await query(`
      SELECT
        c.cod_tip_mov, c.nivel_anterior, c.nivel_nuevo,
        d.ap_paterno, d.ap_materno, d.nombres, d.num_documento,
        p.cod_nivel, p.cod_tipo_pad,
        a.nombre AS asociacion
      FROM pad.cambios_PAD c
      JOIN pad.PAD p ON c.cod_pad = p.cod_pad
      JOIN pad.Deportistas d ON p.cod_deportista = d.cod_deportista
      LEFT JOIN pad.Asociacion_Deportiva a ON d.cod_asociacion = a.cod_asociacion
      WHERE c.periodo_vigencia = @periodo AND p.cod_tipo_pad = @tipo
      ORDER BY c.cod_tip_mov, a.nombre, d.ap_paterno, d.ap_materno
    `, [
      { name: 'periodo', type: sql.VarChar(6), value: periodo },
      { name: 'tipo',    type: sql.VarChar(5), value: tipo }
    ]);

    // Active athletes (consolidated roster)
    const activosResult = await query(`
      SELECT
        d.ap_paterno, d.ap_materno, d.nombres, d.num_documento,
        p.cod_nivel, p.cod_tipo_pad,
        a.nombre AS asociacion
      FROM pad.PAD p
      JOIN pad.Deportistas d ON p.cod_deportista = d.cod_deportista
      LEFT JOIN pad.Asociacion_Deportiva a ON d.cod_asociacion = a.cod_asociacion
      WHERE p.cod_estado_pad = 'ACT' AND p.cod_tipo_pad = @tipo
      ORDER BY a.nombre, d.ap_paterno, d.ap_materno
    `, [{ name: 'tipo', type: sql.VarChar(5), value: tipo }]);

    const movRows    = movResult.recordset;
    const activoRows = activosResult.recordset;

    // Group movements by type
    const grupos = { ING: [], CAMBNIV: [], RET: [] };
    movRows.forEach(r => { if (grupos[r.cod_tip_mov]) grupos[r.cod_tip_mov].push(r); });
    // Map DNI → movement for the consolidated section
    const movByDNI = {};
    movRows.forEach(r => { movByDNI[r.num_documento] = r; });

    // Portrait A4: 515pt usable width (595.28 - 40*2)
    const columns = [
      { label: 'Nº',          width:  25, key: '_n',       align: 'center' },
      { label: 'FEDERACIÓN',  width: 130, key: 'asociacion' },
      { label: 'DEPORTISTA',  width: 200, value: r => `${r.ap_paterno} ${r.ap_materno}, ${r.nombres}` },
      { label: 'ESTADO',      width:  90, key: '_estado',  align: 'center' },
      { label: 'NIVEL',       width:  70, key: 'cod_nivel', align: 'center' },
    ];
    const tableW = columns.reduce((s, c) => s + c.width, 0); // 515

    const mL = 40, mT = 40, mB = 30, mR = 40;
    const subtipoLabel = tipo === 'PAD1' ? 'I' : tipo === 'PAD2' ? 'II' : '(PNM)';
    const titulo    = 'CONSOLIDADO DEL INFORME TÉCNICO';
    const subtitulo = `PROGRAMA DE APOYO AL DEPORTISTA ${subtipoLabel} - ${periodoLabel(periodo).toUpperCase()}`;
    const codigo    = 'SUB-FO-25';
    const pageH     = 841.89; // A4 portrait

    const doc = new PDFDocument({
      size: 'A4', layout: 'portrait',
      margins: { top: mT, bottom: mB, left: mL, right: mR },
      bufferPages: true,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `inline; filename=Consolidado_Tecnico_${padLabel(tipo).replace(/ /g,'_')}_${periodo}.pdf`);
    doc.pipe(res);

    let y = drawPageHeader(doc, titulo, subtitulo, codigo);

    function needNewPage(needed) {
      if (y + needed > pageH - mB - FOOTER_H) {
        doc.addPage();
        y = drawPageHeader(doc, titulo, subtitulo, codigo);
      }
    }

    const movLabels  = { ING: 'INGRESOS', CAMBNIV: 'CAMBIOS DE NIVEL', RET: 'RETIROS' };
    const estadoLbl  = {
      ING:     () => 'INGRESO',
      CAMBNIV: r  => `${r.nivel_anterior || '—'} → ${r.nivel_nuevo || '—'}`,
      RET:     () => 'RETIRO',
    };

    // Movement sections
    for (const movType of ['ING', 'CAMBNIV', 'RET']) {
      const grp = grupos[movType];
      if (!grp.length) continue;
      needNewPage(16 + 16 + 14);
      y = drawSectionBanner(doc, `${movLabels[movType]}  (${grp.length} registro${grp.length > 1 ? 's' : ''})`, y, tableW, mL);
      y = drawColHeader(doc, columns, y, mL);
      grp.forEach((r, i) => {
        r._n = i + 1;
        r._estado = estadoLbl[movType](r);
        needNewPage(14);
        y = drawDataRow(doc, columns, r, y, i, mL);
      });
      y += 10;
    }

    // Consolidated section
    needNewPage(16 + 16 + 14);
    y = drawSectionBanner(doc,
      `CONSOLIDADO - PROGRAMA DE APOYO AL DEPORTISTA ${subtipoLabel}  (${activoRows.length} deportistas activos)`,
      y, tableW, mL);
    y = drawColHeader(doc, columns, y, mL);
    activoRows.forEach((r, i) => {
      r._n = i + 1;
      const mov = movByDNI[r.num_documento];
      r._estado = mov ? estadoLbl[mov.cod_tip_mov](mov) : '';
      needNewPage(14);
      y = drawDataRow(doc, columns, r, y, i, mL);
    });

    // Summary section: RESUMEN POR NIVEL
    y += 12;
    needNewPage(16 + 16 + 14);
    y = drawSectionBanner(doc, 'RESUMEN POR NIVEL', y, tableW, mL);
    const resumCols = [
      { label: 'NIVEL', width: 100, key: '_niv', align: 'center' },
      { label: 'CANTIDAD', width: 80, key: '_n', align: 'center' },
    ];
    y = drawColHeader(doc, resumCols, y, mL);
    const nivelGroup = {};
    activoRows.forEach(r => {
      nivelGroup[r.cod_nivel] = (nivelGroup[r.cod_nivel] || 0) + 1;
    });
    Object.entries(nivelGroup).sort().forEach(([niv, cnt], i) => {
      needNewPage(14);
      y = drawDataRow(doc, resumCols, { _niv: niv, _n: cnt }, y, i, mL);
    });
    needNewPage(16);
    drawTotalRow(doc, `Total: ${activoRows.length} deportistas activos`, '', y, tableW, mL);

    // Add footers to all pages
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      drawPageFooter(doc, i + 1, range.count);
    }
    doc.flushPages();
    doc.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CONSOLIDADO ECONÓMICO (SUB-FO-26) ─────────────────────
router.get('/consolidado-economico', async (req, res) => {
  try {
    const tipo    = req.query.tipo    || 'PAD1';
    const periodo = req.query.periodo || currentPeriodo();

    const result = await query(`
      SELECT
        d.num_documento, d.ap_paterno, d.ap_materno, d.nombres,
        d.num_cuenta,
        p.cod_tipo_pad, p.cod_nivel,
        a.nombre AS asociacion,
        mr.monto_soles,
        ap.num_documento AS apo_documento,
        ap.ap_paterno AS apo_paterno, ap.ap_materno AS apo_materno, ap.nombres AS apo_nombres,
        CASE WHEN DATEDIFF(YEAR, d.fecha_nac, GETDATE()) < 18 THEN 1 ELSE 0 END AS es_menor
      FROM pad.PAD p
      JOIN pad.Deportistas d ON p.cod_deportista = d.cod_deportista
      LEFT JOIN pad.Asociacion_Deportiva a ON d.cod_asociacion = a.cod_asociacion
      LEFT JOIN pad.montos_referencia mr ON mr.cod_nivel = p.cod_nivel
        AND @periodo BETWEEN mr.periodo_desde AND ISNULL(mr.periodo_hasta, '999999')
      LEFT JOIN pad.Apoderados ap ON d.cod_deportista = ap.cod_deportista
      WHERE p.cod_estado_pad = 'ACT' AND p.cod_tipo_pad = @tipo
      ORDER BY a.nombre, d.ap_paterno, d.ap_materno
    `, [
      { name: 'tipo',    type: sql.VarChar(5), value: tipo },
      { name: 'periodo', type: sql.VarChar(6), value: periodo }
    ]);

    const rows  = result.recordset;
    const total = rows.reduce((s, r) => s + (parseFloat(r.monto_soles) || 0), 0);

    const mL = 30, mT = 40, mB = 30, mR = 30;
    const subtipoLabel = tipo === 'PAD1' ? 'I' : tipo === 'PAD2' ? 'II' : '(PNM)';
    const titulo    = 'CONSOLIDADO DEL INFORME ECONÓMICO';
    const subtitulo = `PROGRAMA DE APOYO AL DEPORTISTA ${subtipoLabel} - ${periodoLabel(periodo).toUpperCase()}`;
    const codigo    = 'SUB-FO-26';
    const pageH     = 595.28; // A4 landscape height

    // Landscape A4: 841.89 - 60 = 781.89pt usable
    const columns = [
      { label: 'Nº',             width:  25, key: '_n',          align: 'center' },
      { label: 'FEDERACIÓN',     width: 110, key: 'asociacion' },
      { label: 'DEPORTISTA',     width: 165, value: r => `${r.ap_paterno} ${r.ap_materno}, ${r.nombres}` },
      { label: 'NRO. DE CUENTA', width: 100, value: r => r.num_cuenta || 'OPE', align: 'center' },
      { label: 'NRO. DOC.',      width:  65, key: 'num_documento', align: 'center' },
      { label: 'APODERADO',      width: 145, value: r => r.es_menor && r.apo_paterno ? `${r.apo_paterno} ${r.apo_materno || ''}, ${r.apo_nombres || ''}`.trim() : '' },
      { label: 'DNI APO.',       width:  60, value: r => r.es_menor && r.apo_documento ? r.apo_documento : '', align: 'center' },
      { label: 'NIVEL',          width:  50, key: 'cod_nivel',   align: 'center' },
      { label: 'MONTO',          width:  61, value: r => formatSoles(r.monto_soles), align: 'right' },
    ];
    const tableW = columns.reduce((s, c) => s + c.width, 0); // 781

    const doc = new PDFDocument({
      size: 'A4', layout: 'landscape',
      margins: { top: mT, bottom: mB, left: mL, right: mR },
      bufferPages: true,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `inline; filename=Consolidado_Economico_${padLabel(tipo).replace(/ /g,'_')}_${periodo}.pdf`);
    doc.pipe(res);

    let y = drawPageHeader(doc, titulo, subtitulo, codigo);

    function needNewPage(needed) {
      if (y + needed > pageH - mB - FOOTER_H) {
        doc.addPage();
        y = drawPageHeader(doc, titulo, subtitulo, codigo);
      }
    }

    needNewPage(16 + 16 + 14);
    y = drawSectionBanner(doc,
      `CONSOLIDADO ECONÓMICO - PROGRAMA DE APOYO AL DEPORTISTA ${subtipoLabel}`,
      y, tableW, mL);
    y = drawColHeader(doc, columns, y, mL);

    rows.forEach((r, i) => {
      r._n = i + 1;
      needNewPage(14);
      y = drawDataRow(doc, columns, r, y, i, mL);
    });

    needNewPage(16);
    drawTotalRow(doc, `Total: ${rows.length} deportistas`, formatSoles(total), y, tableW, mL);

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      drawPageFooter(doc, i + 1, range.count);
    }
    doc.flushPages();
    doc.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── REGISTRO DE CAMBIOS PAD (SUB-FO-24) ───────────────────
router.get('/cambios-pad', async (req, res) => {
  try {
    const periodo = req.query.periodo || currentPeriodo();
    const tipo    = req.query.tipo;

    let whereClause = 'WHERE c.periodo_vigencia = @periodo';
    const inputs = [{ name: 'periodo', type: sql.VarChar(6), value: periodo }];
    if (tipo) {
      whereClause += ' AND p.cod_tipo_pad = @tipo';
      inputs.push({ name: 'tipo', type: sql.VarChar(5), value: tipo });
    }

    const result = await query(`
      SELECT
        c.cod_cambio, c.nro_informe, c.periodo_vigencia, c.motivo,
        c.nivel_anterior, c.nivel_nuevo, c.cod_tip_mov,
        d.num_documento, d.ap_paterno, d.ap_materno, d.nombres,
        p.cod_tipo_pad,
        (SELECT STRING_AGG(e.nro_expediente, ' / ')
         FROM pad.expedientes_cambio e WHERE e.cod_cambio = c.cod_cambio) AS expedientes
      FROM pad.cambios_PAD c
      JOIN pad.PAD p ON c.cod_pad = p.cod_pad
      JOIN pad.Deportistas d ON p.cod_deportista = d.cod_deportista
      ${whereClause}
      ORDER BY c.cod_tip_mov, d.ap_paterno, d.ap_materno
    `, inputs);

    const rows   = result.recordset;
    const grupos = {};
    rows.forEach(r => {
      if (!grupos[r.cod_tip_mov]) grupos[r.cod_tip_mov] = [];
      grupos[r.cod_tip_mov].push(r);
    });

    const mL = 30, mT = 40, mB = 30, mR = 30;
    const titleSuffix  = tipo ? ` — ${padLabel(tipo)}` : '';
    const titulo       = `REGISTRO DE CAMBIOS PAD${titleSuffix}`;
    const subtitulo    = `PERIODO: ${periodoLabel(periodo).toUpperCase()}`;
    const codigo       = 'SUB-FO-24';
    const pageH        = 595.28; // landscape height

    // Landscape A4 columns (tableW = 781)
    const columns = [
      { label: 'Nº',              width:  25, key: '_n',          align: 'center' },
      { label: 'TIPO',            width:  60, value: r => ({ING:'Ingreso',CAMBNIV:'Cambio Nivel',RET:'Retiro'})[r.cod_tip_mov] || r.cod_tip_mov, align: 'center' },
      { label: 'DEPORTISTA',      width: 175, value: r => `${r.ap_paterno} ${r.ap_materno}, ${r.nombres}` },
      { label: 'DNI',             width:  60, key: 'num_documento', align: 'center' },
      { label: 'PROG.',           width:  50, value: r => padLabel(r.cod_tipo_pad), align: 'center' },
      { label: 'NIV. ANT.',       width:  50, value: r => r.nivel_anterior || '—', align: 'center' },
      { label: 'NIV. NUE.',       width:  50, value: r => r.nivel_nuevo    || '—', align: 'center' },
      { label: 'MOTIVO',          width: 130, key: 'motivo' },
      { label: 'NRO. INFORME',    width:  80, key: 'nro_informe',  align: 'center' },
      { label: 'NRO. EXPEDIENTE', width: 101, key: 'expedientes',  align: 'center' },
    ];
    const tableW = columns.reduce((s, c) => s + c.width, 0); // 781

    const doc = new PDFDocument({
      size: 'A4', layout: 'landscape',
      margins: { top: mT, bottom: mB, left: mL, right: mR },
      bufferPages: true,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `inline; filename=Cambios_PAD_${periodo}${tipo ? '_'+tipo : ''}.pdf`);
    doc.pipe(res);

    let y = drawPageHeader(doc, titulo, subtitulo, codigo);

    function needNewPage(needed) {
      if (y + needed > pageH - mB - FOOTER_H) {
        doc.addPage();
        y = drawPageHeader(doc, titulo, subtitulo, codigo);
      }
    }

    const movLabels = { ING: 'INGRESOS', CAMBNIV: 'CAMBIOS DE NIVEL', RET: 'RETIROS' };
    let globalN = 0;

    for (const movType of ['ING', 'CAMBNIV', 'RET']) {
      const grp = grupos[movType];
      if (!grp?.length) continue;

      needNewPage(16 + 16 + 14);
      y = drawSectionBanner(doc,
        `${movLabels[movType]}  (${grp.length} registro${grp.length > 1 ? 's' : ''})`,
        y, tableW, mL);
      y = drawColHeader(doc, columns, y, mL);

      grp.forEach((r, i) => {
        globalN++;
        r._n = globalN;
        needNewPage(14);
        y = drawDataRow(doc, columns, r, y, i, mL);
      });
      y += 10;
    }

    const ing  = (grupos.ING    || []).length;
    const camb = (grupos.CAMBNIV || []).length;
    const ret  = (grupos.RET    || []).length;
    needNewPage(16);
    drawTotalRow(doc,
      `Total: ${rows.length} registros — Ingresos: ${ing} | Cambios: ${camb} | Retiros: ${ret}`,
      '', y, tableW, mL);

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      drawPageFooter(doc, i + 1, range.count);
    }
    doc.flushPages();
    doc.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
