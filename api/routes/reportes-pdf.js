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

function drawHeader(doc, title, subtitle) {
  doc.fontSize(16).font('Helvetica-Bold').text(title, { align: 'center' });
  doc.fontSize(10).font('Helvetica').text(subtitle, { align: 'center' });
  doc.moveDown(0.5);
  doc.fontSize(8).fillColor('#666').text('Instituto Peruano del Deporte — DINADAF — UF-PMD', { align: 'center' });
  doc.fillColor('#000').moveDown(1);
}

function drawTableHeader(doc, columns, y) {
  const x0 = doc.page.margins.left;
  doc.save();
  doc.rect(x0, y, doc.page.width - doc.page.margins.left - doc.page.margins.right, 18).fill('#1D6B4F');
  doc.fillColor('#fff').fontSize(7).font('Helvetica-Bold');
  let cx = x0 + 4;
  columns.forEach(col => {
    doc.text(col.label, cx, y + 5, { width: col.width, align: col.align || 'left' });
    cx += col.width;
  });
  doc.restore();
  doc.fillColor('#000').font('Helvetica');
  return y + 18;
}

function drawTableRow(doc, columns, row, y, idx) {
  const x0 = doc.page.margins.left;
  const rowH = 14;
  if (idx % 2 === 0) {
    doc.save();
    doc.rect(x0, y, doc.page.width - doc.page.margins.left - doc.page.margins.right, rowH).fill('#f7f7f5');
    doc.restore();
  }
  doc.fontSize(7).font('Helvetica').fillColor('#1a1a18');
  let cx = x0 + 4;
  columns.forEach(col => {
    const val = typeof col.value === 'function' ? col.value(row) : (row[col.key] || '');
    doc.text(String(val), cx, y + 3, { width: col.width - 4, align: col.align || 'left' });
    cx += col.width;
  });
  return y + rowH;
}

function needsNewPage(doc, y, margin) {
  return y > doc.page.height - (margin || 60);
}

// ── Consolidado Técnico ────────────────────────────────────
router.get('/consolidado-tecnico', async (req, res) => {
  try {
    const tipo = req.query.tipo || 'PAD1'; // PAD1, PAD2, PNM
    const periodo = req.query.periodo || new Date().toISOString().slice(0,7).replace('-','');

    const result = await query(`
      SELECT
        d.num_documento, d.ap_paterno, d.ap_materno, d.nombres, d.sexo,
        p.cod_tipo_pad, p.cod_nivel, p.cod_estado_pad, p.es_permanente, p.fecha_ingreso,
        n.nombre_nivel, a.nombre AS asociacion,
        mr.monto_soles
      FROM pad.PAD p
      JOIN pad.Deportistas d ON p.cod_deportista = d.cod_deportista
      JOIN cat.Nivel n ON p.cod_nivel = n.cod_nivel
      LEFT JOIN pad.Asociacion_Deportiva a ON d.cod_asociacion = a.cod_asociacion
      LEFT JOIN pad.montos_referencia mr ON mr.cod_nivel = p.cod_nivel
        AND @periodo BETWEEN mr.periodo_desde AND ISNULL(mr.periodo_hasta, '999999')
      WHERE p.cod_estado_pad = 'ACT' AND p.cod_tipo_pad = @tipo
      ORDER BY a.nombre, d.ap_paterno, d.ap_materno
    `, [
      { name: 'tipo', type: sql.VarChar(5), value: tipo },
      { name: 'periodo', type: sql.VarChar(6), value: periodo }
    ]);

    const rows = result.recordset;
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=Consolidado_Tecnico_${padLabel(tipo).replace(/ /g,'_')}_${periodo}.pdf`);
    doc.pipe(res);

    drawHeader(doc,
      `CONSOLIDADO TÉCNICO — ${padLabel(tipo)}`,
      `Periodo: ${periodoLabel(periodo)} — SUB-FO-25`
    );

    const columns = [
      { label: 'N°', width: 25, key: '_n', align: 'center' },
      { label: 'FEDERACIÓN / ASOCIACIÓN', width: 160, key: 'asociacion' },
      { label: 'DEPORTISTA', width: 200, value: r => `${r.ap_paterno} ${r.ap_materno}, ${r.nombres}` },
      { label: 'DNI', width: 60, key: 'num_documento', align: 'center' },
      { label: 'SEXO', width: 30, key: 'sexo', align: 'center' },
      { label: 'NIVEL', width: 50, key: 'nombre_nivel', align: 'center' },
      { label: 'MONTO', width: 70, value: r => formatSoles(r.monto_soles), align: 'right' },
      { label: 'F.INGRESO', width: 65, value: r => r.fecha_ingreso ? new Date(r.fecha_ingreso).toLocaleDateString('es-PE') : '—', align: 'center' },
    ];

    let y = drawTableHeader(doc, columns, doc.y);
    let total = 0;

    rows.forEach((row, i) => {
      if (needsNewPage(doc, y)) {
        doc.addPage();
        y = drawTableHeader(doc, columns, doc.page.margins.top);
      }
      row._n = i + 1;
      y = drawTableRow(doc, columns, row, y, i);
      total += Number(row.monto_soles) || 0;
    });

    // Footer totals
    doc.moveDown(0.5);
    y += 8;
    doc.fontSize(9).font('Helvetica-Bold');
    doc.text(`Total deportistas: ${rows.length}`, doc.page.margins.left, y);
    doc.text(`Monto total mensual: ${formatSoles(total)}`, doc.page.margins.left + 300, y);

    doc.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Consolidado Económico ──────────────────────────────────
router.get('/consolidado-economico', async (req, res) => {
  try {
    const tipo = req.query.tipo || 'PAD1';
    const periodo = req.query.periodo || new Date().toISOString().slice(0,7).replace('-','');

    const result = await query(`
      SELECT
        d.num_documento, d.ap_paterno, d.ap_materno, d.nombres,
        d.num_cuenta,
        p.cod_tipo_pad, p.cod_nivel,
        n.nombre_nivel, a.nombre AS asociacion,
        mr.monto_soles,
        ap.num_documento AS apo_documento, ap.ap_paterno AS apo_paterno,
        ap.ap_materno AS apo_materno, ap.nombres AS apo_nombres,
        CASE WHEN DATEDIFF(YEAR, d.fecha_nac, GETDATE()) < 18 THEN 1 ELSE 0 END AS es_menor
      FROM pad.PAD p
      JOIN pad.Deportistas d ON p.cod_deportista = d.cod_deportista
      JOIN cat.Nivel n ON p.cod_nivel = n.cod_nivel
      LEFT JOIN pad.Asociacion_Deportiva a ON d.cod_asociacion = a.cod_asociacion
      LEFT JOIN pad.montos_referencia mr ON mr.cod_nivel = p.cod_nivel
        AND @periodo BETWEEN mr.periodo_desde AND ISNULL(mr.periodo_hasta, '999999')
      LEFT JOIN pad.Apoderados ap ON d.cod_deportista = ap.cod_deportista
      WHERE p.cod_estado_pad = 'ACT' AND p.cod_tipo_pad = @tipo
      ORDER BY a.nombre, d.ap_paterno, d.ap_materno
    `, [
      { name: 'tipo', type: sql.VarChar(5), value: tipo },
      { name: 'periodo', type: sql.VarChar(6), value: periodo }
    ]);

    const rows = result.recordset;
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=Consolidado_Economico_${padLabel(tipo).replace(/ /g,'_')}_${periodo}.pdf`);
    doc.pipe(res);

    drawHeader(doc,
      `CONSOLIDADO ECONÓMICO — ${padLabel(tipo)}`,
      `Periodo: ${periodoLabel(periodo)} — GDS`
    );

    const columns = [
      { label: 'N°', width: 25, key: '_n', align: 'center' },
      { label: 'FEDERACIÓN', width: 130, key: 'asociacion' },
      { label: 'DEPORTISTA', width: 160, value: r => `${r.ap_paterno} ${r.ap_materno}, ${r.nombres}` },
      { label: 'DNI', width: 55, key: 'num_documento', align: 'center' },
      { label: 'APODERADO', width: 130, value: r => r.es_menor && r.apo_paterno ? `${r.apo_paterno} ${r.apo_materno||''}, ${r.apo_nombres||''}` : '' },
      { label: 'N° CUENTA', width: 95, value: r => r.num_cuenta || 'OPE', align: 'center' },
      { label: 'NIVEL', width: 40, key: 'nombre_nivel', align: 'center' },
      { label: 'MONTO', width: 65, value: r => formatSoles(r.monto_soles), align: 'right' },
    ];

    let y = drawTableHeader(doc, columns, doc.y);
    let total = 0;

    rows.forEach((row, i) => {
      if (needsNewPage(doc, y)) {
        doc.addPage();
        y = drawTableHeader(doc, columns, doc.page.margins.top);
      }
      row._n = i + 1;
      y = drawTableRow(doc, columns, row, y, i);
      total += Number(row.monto_soles) || 0;
    });

    y += 8;
    doc.fontSize(9).font('Helvetica-Bold');
    doc.text(`Total: ${rows.length} deportistas`, doc.page.margins.left, y);
    doc.text(`Monto total: ${formatSoles(total)}`, doc.page.margins.left + 350, y);

    doc.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Registro de Cambios PAD (SUB-FO-24) ────────────────────
router.get('/cambios-pad', async (req, res) => {
  try {
    const periodo = req.query.periodo || new Date().toISOString().slice(0,7).replace('-','');
    const tipo = req.query.tipo; // optional filter

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
        e.nro_expediente, e.tipo_documento
      FROM pad.cambios_PAD c
      JOIN pad.PAD p ON c.cod_pad = p.cod_pad
      JOIN pad.Deportistas d ON p.cod_deportista = d.cod_deportista
      LEFT JOIN pad.expedientes_cambio e ON c.cod_cambio = e.cod_cambio
      ${whereClause}
      ORDER BY c.cod_tip_mov, d.ap_paterno, d.ap_materno
    `, inputs);

    const rows = result.recordset;
    const movLabels = { ING: 'INGRESOS', CAMBNIV: 'CAMBIOS DE NIVEL', RET: 'RETIROS' };

    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=Cambios_PAD_${periodo}${tipo ? '_'+tipo : ''}.pdf`);
    doc.pipe(res);

    const titleSuffix = tipo ? ` — ${padLabel(tipo)}` : '';
    drawHeader(doc,
      `REGISTRO DE CAMBIOS PAD${titleSuffix}`,
      `Periodo: ${periodoLabel(periodo)} — SUB-FO-24`
    );

    const columns = [
      { label: 'N°', width: 25, key: '_n', align: 'center' },
      { label: 'TIPO', width: 55, value: r => ({ING:'Ingreso',CAMBNIV:'Cambio Niv.',RET:'Retiro'})[r.cod_tip_mov] || r.cod_tip_mov },
      { label: 'DEPORTISTA', width: 180, value: r => `${r.ap_paterno} ${r.ap_materno}, ${r.nombres}` },
      { label: 'DNI', width: 55, key: 'num_documento', align: 'center' },
      { label: 'PROGRAMA', width: 50, value: r => padLabel(r.cod_tipo_pad), align: 'center' },
      { label: 'NIV.ANT', width: 45, value: r => r.nivel_anterior || '—', align: 'center' },
      { label: 'NIV.NUE', width: 45, value: r => r.nivel_nuevo || '—', align: 'center' },
      { label: 'MOTIVO', width: 140, key: 'motivo' },
      { label: 'N° INFORME', width: 75, key: 'nro_informe', align: 'center' },
      { label: 'N° EXPEDIENTE', width: 80, key: 'nro_expediente', align: 'center' },
    ];

    // Group by movement type
    const groups = {};
    rows.forEach(r => {
      if (!groups[r.cod_tip_mov]) groups[r.cod_tip_mov] = [];
      groups[r.cod_tip_mov].push(r);
    });

    let globalN = 0;
    for (const movType of ['ING', 'CAMBNIV', 'RET']) {
      const grp = groups[movType];
      if (!grp || !grp.length) continue;

      doc.fontSize(10).font('Helvetica-Bold').fillColor('#1D6B4F')
        .text(`${movLabels[movType]} (${grp.length})`, doc.page.margins.left, doc.y + 4);
      doc.fillColor('#000').moveDown(0.3);

      let y = drawTableHeader(doc, columns, doc.y);

      grp.forEach((row, i) => {
        if (needsNewPage(doc, y)) {
          doc.addPage();
          y = drawTableHeader(doc, columns, doc.page.margins.top);
        }
        globalN++;
        row._n = globalN;
        y = drawTableRow(doc, columns, row, y, i);
      });

      doc.y = y + 8;
    }

    // Summary
    doc.moveDown(1);
    doc.fontSize(9).font('Helvetica-Bold');
    doc.text(`Total movimientos: ${rows.length}`, doc.page.margins.left);
    const ing = (groups.ING || []).length;
    const camb = (groups.CAMBNIV || []).length;
    const ret = (groups.RET || []).length;
    doc.fontSize(8).font('Helvetica').text(`Ingresos: ${ing} | Cambios de nivel: ${camb} | Retiros: ${ret}`);

    doc.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
