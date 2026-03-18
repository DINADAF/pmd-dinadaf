const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const { query, sql } = require('../db');

function padLabel(cod) {
  return (cod || '').replace('PAD1','PAD I').replace('PAD2','PAD II');
}

const MESES = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
function periodoLabel(p) {
  if (!p || p.length !== 6) return p || '';
  return MESES[parseInt(p.slice(4,6))] + ' ' + p.slice(0,4);
}

// ── GIRO Excel ─────────────────────────────────────────────
// Business rules:
// - Minors (< 18): replace athlete data with apoderado data
// - No bank account: mark as OPE (payment by DNI)
// - OPE for minors without account: use apoderado DNI
router.get('/giro', async (req, res) => {
  try {
    const tipo = req.query.tipo || 'PAD1';
    const periodo = req.query.periodo || new Date().toISOString().slice(0,7).replace('-','');

    const result = await query(`
      SELECT
        d.cod_deportista, d.num_documento, d.tipo_documento,
        d.ap_paterno, d.ap_materno, d.nombres,
        d.num_cuenta, d.fecha_nac,
        CASE WHEN DATEDIFF(YEAR, d.fecha_nac, GETDATE()) < 18 THEN 1 ELSE 0 END AS es_menor,
        p.cod_tipo_pad, p.cod_nivel,
        n.nombre_nivel, a.nombre AS asociacion,
        mr.monto_soles,
        ap.num_documento AS apo_documento, ap.tipo_documento AS apo_tipo_doc,
        ap.ap_paterno AS apo_paterno, ap.ap_materno AS apo_materno,
        ap.nombres AS apo_nombres
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

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Plataforma PMD — UF-PMD/DINADAF/IPD';
    wb.created = new Date();

    const ws = wb.addWorksheet(`GIRO ${padLabel(tipo)}`);

    // Title rows
    ws.mergeCells('A1:I1');
    const titleCell = ws.getCell('A1');
    titleCell.value = `GIRO ${padLabel(tipo)} — ${periodoLabel(periodo)}`;
    titleCell.font = { bold: true, size: 14 };
    titleCell.alignment = { horizontal: 'center' };

    ws.mergeCells('A2:I2');
    const subCell = ws.getCell('A2');
    subCell.value = 'Instituto Peruano del Deporte — DINADAF — UF-PMD';
    subCell.font = { size: 10, color: { argb: '666666' } };
    subCell.alignment = { horizontal: 'center' };

    // Headers
    const headerRow = ws.addRow([]);
    ws.addRow([]);
    const headers = ['N°', 'FEDERACIÓN', 'BENEFICIARIO', 'TIPO DOC', 'N° DOCUMENTO', 'N° CUENTA / OPE', 'NIVEL', 'MONTO (S/)', 'OBSERVACIÓN'];
    const hRow = ws.addRow(headers);
    hRow.eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFF' }, size: 9 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1D6B4F' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        bottom: { style: 'thin', color: { argb: '000000' } }
      };
    });

    // Column widths
    ws.getColumn(1).width = 5;   // N°
    ws.getColumn(2).width = 25;  // Federación
    ws.getColumn(3).width = 35;  // Beneficiario
    ws.getColumn(4).width = 8;   // Tipo doc
    ws.getColumn(5).width = 14;  // N° documento
    ws.getColumn(6).width = 18;  // Cuenta/OPE
    ws.getColumn(7).width = 8;   // Nivel
    ws.getColumn(8).width = 12;  // Monto
    ws.getColumn(9).width = 25;  // Observación

    let totalMonto = 0;
    let opeCount = 0;

    rows.forEach((r, i) => {
      // Apply business rules for giro
      let beneficiario, tipoDoc, numDoc, observacion = '';

      if (r.es_menor && r.apo_paterno) {
        // Minor with apoderado: use apoderado data for payment
        beneficiario = `${r.apo_paterno} ${r.apo_materno || ''}, ${r.apo_nombres || ''}`.trim();
        tipoDoc = r.apo_tipo_doc || 'DNI';
        numDoc = r.apo_documento;
        observacion = `Menor: ${r.ap_paterno} ${r.ap_materno}, ${r.nombres}`;
      } else {
        beneficiario = `${r.ap_paterno} ${r.ap_materno}, ${r.nombres}`;
        tipoDoc = r.tipo_documento || 'DNI';
        numDoc = r.num_documento;
      }

      let cuentaOpe = r.num_cuenta || 'OPE';
      if (!r.num_cuenta) {
        opeCount++;
        // For OPE, payment is made by DNI (or apoderado DNI for minors)
        if (r.es_menor && r.apo_documento) {
          observacion += (observacion ? ' | ' : '') + `OPE por DNI apoderado`;
        } else {
          observacion += (observacion ? ' | ' : '') + `OPE por DNI`;
        }
      }

      const monto = Number(r.monto_soles) || 0;
      totalMonto += monto;

      const row = ws.addRow([
        i + 1,
        r.asociacion || '',
        beneficiario,
        tipoDoc,
        numDoc,
        cuentaOpe,
        r.nombre_nivel,
        monto,
        observacion
      ]);

      // Style data row
      row.eachCell((cell, colNum) => {
        cell.font = { size: 9 };
        cell.alignment = { vertical: 'middle' };
        if (i % 2 === 0) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F7F6F3' } };
        }
      });

      // Format monto as currency
      row.getCell(8).numFmt = '#,##0.00';
      row.getCell(8).alignment = { horizontal: 'right' };
      row.getCell(1).alignment = { horizontal: 'center' };
      row.getCell(4).alignment = { horizontal: 'center' };
      row.getCell(5).alignment = { horizontal: 'center' };
      row.getCell(7).alignment = { horizontal: 'center' };

      // OPE highlight
      if (!r.num_cuenta) {
        row.getCell(6).font = { size: 9, bold: true, color: { argb: 'D85A30' } };
      }
    });

    // Totals row
    const totRow = ws.addRow(['', '', '', '', '', `Total: ${rows.length}`, '', totalMonto, `OPE: ${opeCount}`]);
    totRow.eachCell(cell => {
      cell.font = { bold: true, size: 9 };
      cell.border = { top: { style: 'double', color: { argb: '000000' } } };
    });
    totRow.getCell(8).numFmt = '#,##0.00';

    // Send
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=GIRO_${padLabel(tipo).replace(/ /g,'_')}_${periodo}.xlsx`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Consolidado Técnico Excel ──────────────────────────────
router.get('/consolidado-tecnico', async (req, res) => {
  try {
    const tipo = req.query.tipo || 'PAD1';
    const periodo = req.query.periodo || new Date().toISOString().slice(0,7).replace('-','');

    const result = await query(`
      SELECT
        d.num_documento, d.ap_paterno, d.ap_materno, d.nombres, d.sexo,
        p.cod_tipo_pad, p.cod_nivel, p.es_permanente, p.fecha_ingreso,
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
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(`Consolidado ${padLabel(tipo)}`);

    ws.mergeCells('A1:H1');
    ws.getCell('A1').value = `CONSOLIDADO TÉCNICO ${padLabel(tipo)} — ${periodoLabel(periodo)}`;
    ws.getCell('A1').font = { bold: true, size: 13 };
    ws.getCell('A1').alignment = { horizontal: 'center' };

    ws.addRow([]);
    const hRow = ws.addRow(['N°', 'FEDERACIÓN', 'DEPORTISTA', 'DNI', 'SEXO', 'NIVEL', 'MONTO (S/)', 'F. INGRESO']);
    hRow.eachCell(c => {
      c.font = { bold: true, color: { argb: 'FFFFFF' }, size: 9 };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1D6B4F' } };
      c.alignment = { horizontal: 'center' };
    });
    ws.getColumn(1).width = 5;
    ws.getColumn(2).width = 25;
    ws.getColumn(3).width = 35;
    ws.getColumn(4).width = 12;
    ws.getColumn(5).width = 6;
    ws.getColumn(6).width = 8;
    ws.getColumn(7).width = 12;
    ws.getColumn(8).width = 12;

    let total = 0;
    rows.forEach((r, i) => {
      const m = Number(r.monto_soles) || 0;
      total += m;
      const row = ws.addRow([
        i+1, r.asociacion || '', `${r.ap_paterno} ${r.ap_materno}, ${r.nombres}`,
        r.num_documento, r.sexo, r.nombre_nivel, m,
        r.fecha_ingreso ? new Date(r.fecha_ingreso).toLocaleDateString('es-PE') : ''
      ]);
      row.getCell(7).numFmt = '#,##0.00';
      if (i % 2 === 0) row.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F7F6F3' } }; });
    });

    const tRow = ws.addRow(['', '', '', '', '', `Total: ${rows.length}`, total, '']);
    tRow.getCell(7).numFmt = '#,##0.00';
    tRow.eachCell(c => { c.font = { bold: true }; });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=Consolidado_Tecnico_${padLabel(tipo).replace(/ /g,'_')}_${periodo}.xlsx`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
