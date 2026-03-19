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
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── Styling constants (match PDF palette) ─────────────────
const XL = {
  headerBg: '404040',     // Section banners + column headers
  headerText: 'FFFFFF',
  rowEven: 'F2F2F2',      // Zebra stripe
  totalBg: '404040',
  estadoBg: '404040',     // ESTADO column in técnico
};

function xlHeaderRow(ws, headers) {
  const hRow = ws.addRow(headers);
  hRow.eachCell(c => {
    c.font = { bold: true, color: { argb: XL.headerText }, size: 8 };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.headerBg } };
    c.alignment = { horizontal: 'center', vertical: 'middle' };
    c.border = { top: { style: 'thin', color: { argb: 'CCCCCC' } }, bottom: { style: 'thin', color: { argb: 'CCCCCC' } }, left: { style: 'thin', color: { argb: 'CCCCCC' } }, right: { style: 'thin', color: { argb: 'CCCCCC' } } };
  });
  hRow.height = 18;
  return hRow;
}

function xlSectionBanner(ws, label, colCount) {
  const row = ws.addRow([label]);
  ws.mergeCells(row.number, 1, row.number, colCount);
  row.getCell(1).font = { bold: true, color: { argb: XL.headerText }, size: 9 };
  row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.headerBg } };
  row.getCell(1).alignment = { vertical: 'middle' };
  row.height = 16;
  return row;
}

function xlDataRow(ws, values, idx) {
  const row = ws.addRow(values);
  row.eachCell(c => {
    c.font = { size: 8, color: { argb: '000000' } };
    c.alignment = { vertical: 'middle', wrapText: true };
    if (idx % 2 === 1) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.rowEven } };
    c.border = { top: { style: 'thin', color: { argb: 'CCCCCC' } }, bottom: { style: 'thin', color: { argb: 'CCCCCC' } }, left: { style: 'thin', color: { argb: 'CCCCCC' } }, right: { style: 'thin', color: { argb: 'CCCCCC' } } };
  });
  row.height = 16;
  return row;
}

function xlTotalRow(ws, values, colCount) {
  const row = ws.addRow(values);
  row.eachCell(c => {
    c.font = { bold: true, color: { argb: XL.headerText }, size: 8 };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.totalBg } };
    c.alignment = { vertical: 'middle' };
    c.border = { top: { style: 'thin', color: { argb: 'CCCCCC' } }, bottom: { style: 'thin', color: { argb: 'CCCCCC' } }, left: { style: 'thin', color: { argb: 'CCCCCC' } }, right: { style: 'thin', color: { argb: 'CCCCCC' } } };
  });
  for (let i = 1; i <= colCount; i++) {
    const c = row.getCell(i);
    if (!c.fill || !c.fill.fgColor) {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.totalBg } };
      c.font = { bold: true, color: { argb: XL.headerText }, size: 8 };
      c.border = { top: { style: 'thin', color: { argb: 'CCCCCC' } }, bottom: { style: 'thin', color: { argb: 'CCCCCC' } }, left: { style: 'thin', color: { argb: 'CCCCCC' } }, right: { style: 'thin', color: { argb: 'CCCCCC' } } };
    }
  }
  row.height = 18;
  return row;
}

function drawHeader3colExcel(ws, titulo, subtitulo, codigo, colCount) {
  // We simulate the 3-column box using rows 1 to 4 and merging cells
  // Cols for IPD: 1 to 2
  // Cols for Title: 3 to colCount - 1
  // Cols for Code: colCount
  const r1 = ws.addRow(['INSTITUTO PERUANO', '', titulo, ...Array(colCount - 4).fill(''), 'Código :']);
  const r2 = ws.addRow(['DEL DEPORTE', '', subtitulo, ...Array(colCount - 4).fill(''), codigo]);
  const r3 = ws.addRow(['IPD / DINADAF', '', '', ...Array(colCount - 4).fill(''), 'Versión : 01']);
  const r4 = ws.addRow(['UF-PMD', '', '', ...Array(colCount - 4).fill(''), '']);

  [r1, r2, r3, r4].forEach(row => row.height = 12);

  // Left column (IPD)
  ws.mergeCells(`A1:B1`); ws.getCell('A1').font = { bold: true, size: 7.5 }; ws.getCell('A1').alignment = { horizontal: 'center' };
  ws.mergeCells(`A2:B2`); ws.getCell('A2').font = { bold: true, size: 7.5 }; ws.getCell('A2').alignment = { horizontal: 'center' };
  ws.mergeCells(`A3:B3`); ws.getCell('A3').font = { size: 6.5, color: { argb: '555555' } }; ws.getCell('A3').alignment = { horizontal: 'center' };
  ws.mergeCells(`A4:B4`); ws.getCell('A4').font = { size: 6, color: { argb: '777777' } }; ws.getCell('A4').alignment = { horizontal: 'center' };

  // Center column (Title)
  ws.mergeCells(1, 3, 1, Math.max(3, colCount - 1));
  ws.getCell(1, 3).font = { bold: true, size: 11 }; ws.getCell(1, 3).alignment = { horizontal: 'center', vertical: 'middle' };
  
  ws.mergeCells(2, 3, 4, Math.max(3, colCount - 1));
  ws.getCell(2, 3).font = { bold: true, size: 10, color: { argb: '333333' } }; ws.getCell(2, 3).alignment = { horizontal: 'center', vertical: 'middle' };

  // Right column (Código)
  const codeCell = ws.getCell(1, colCount); codeCell.font = { size: 7.5 }; codeCell.alignment = { horizontal: 'right' };
  const valCell = ws.getCell(2, colCount); valCell.font = { bold: true, size: 8 }; valCell.alignment = { horizontal: 'right' };
  const verCell = ws.getCell(3, colCount); verCell.font = { size: 7.5 }; verCell.alignment = { horizontal: 'right' };

  // Draw outer box borders for the header array (rows 1 to 4)
  for (let c = 1; c <= colCount; c++) {
    ws.getCell(1, c).border = { ...ws.getCell(1, c).border, top: { style: 'thin', color: { argb: 'CCCCCC' } } };
    ws.getCell(4, c).border = { ...ws.getCell(4, c).border, bottom: { style: 'thin', color: { argb: 'CCCCCC' } } };
  }
  [1,2,3,4].forEach(r => {
    ws.getCell(r, 1).border = { ...ws.getCell(r, 1).border, left: { style: 'thin', color: { argb: 'CCCCCC' } } };
    ws.getCell(r, 2).border = { ...ws.getCell(r, 2).border, right: { style: 'thin', color: { argb: 'CCCCCC' } } };
    ws.getCell(r, colCount - 1).border = { ...ws.getCell(r, colCount - 1).border, right: { style: 'thin', color: { argb: 'CCCCCC' } } };
    ws.getCell(r, colCount).border = { ...ws.getCell(r, colCount).border, right: { style: 'thin', color: { argb: 'CCCCCC' } } };
  });

  ws.addRow([]); // Blank row to simulate spacing
}

// ── Consolidado Técnico Excel (matches PDF SUB-FO-25) ─────
router.get('/consolidado-tecnico', async (req, res) => {
  try {
    const tipo = req.query.tipo || 'PAD1';
    const periodo = req.query.periodo || new Date().toISOString().slice(0,7).replace('-','');
    const subtipoLabel = tipo === 'PAD1' ? 'I' : tipo === 'PAD2' ? 'II' : '(PNM)';

    const pCheck = await query(`SELECT cerrado FROM pad.periodos_cambios WHERE periodo = @p`, [{name:'p', type:sql.VarChar(6), value:periodo}]);
    if (!pCheck.recordset.length || !pCheck.recordset[0].cerrado) {
      return res.status(403).json({ error: `El periodo ${periodo} no esta cerrado. Solo se pueden exportar consolidados de periodos cerrados.` });
    }

    // Movements for the period
    const movResult = await query(`
      SELECT c.cod_tip_mov, c.nivel_anterior, c.nivel_nuevo,
             d.ap_paterno, d.ap_materno, d.nombres, d.num_documento,
             p.cod_nivel, p.cod_tipo_pad, a.nombre AS asociacion
      FROM pad.cambios_PAD c
      JOIN pad.PAD p ON c.cod_pad = p.cod_pad
      JOIN pad.Deportistas d ON p.cod_deportista = d.cod_deportista
      LEFT JOIN pad.Asociacion_Deportiva a ON d.cod_asociacion = a.cod_asociacion
      WHERE c.periodo_vigencia = @periodo AND p.cod_tipo_pad = @tipo
      ORDER BY c.cod_tip_mov, a.nombre, d.ap_paterno
    `, [
      { name: 'periodo', type: sql.VarChar(6), value: periodo },
      { name: 'tipo', type: sql.VarChar(5), value: tipo },
    ]);

    // Active athletes (consolidado)
    const activosResult = await query(`
      SELECT d.ap_paterno, d.ap_materno, d.nombres, d.num_documento,
             p.cod_nivel, p.cod_tipo_pad, a.nombre AS asociacion
      FROM pad.PAD p
      JOIN pad.Deportistas d ON p.cod_deportista = d.cod_deportista
      LEFT JOIN pad.Asociacion_Deportiva a ON d.cod_asociacion = a.cod_asociacion
      WHERE p.cod_estado_pad = 'ACT' AND p.cod_tipo_pad = @tipo
      ORDER BY a.nombre, d.ap_paterno, d.ap_materno
    `, [{ name: 'tipo', type: sql.VarChar(5), value: tipo }]);

    const movRows = movResult.recordset;
    const activoRows = activosResult.recordset;
    const grupos = { ING: [], CAMBNIV: [], RET: [] };
    movRows.forEach(r => { if (grupos[r.cod_tip_mov]) grupos[r.cod_tip_mov].push(r); });
    const movByDNI = {};
    movRows.forEach(r => { movByDNI[r.num_documento] = r; });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Plataforma PMD — UF-PMD/DINADAF/IPD';
    const ws = wb.addWorksheet(`Consolidado ${padLabel(tipo)}`);

    const COL_COUNT = 5;
    const headers = ['Nº', 'FEDERACIÓN', 'DEPORTISTA', 'ESTADO', 'NIVEL'];

    // Replaced the basic headers with the PDF-style header block
    drawHeader3colExcel(ws, 'CONSOLIDADO DEL INFORME TÉCNICO', `PROGRAMA DE APOYO AL DEPORTISTA ${subtipoLabel} — ${periodoLabel(periodo).toUpperCase()}`, 'SUB-FO-25', COL_COUNT);

    ws.getColumn(1).width = 5;
    ws.getColumn(2).width = 25;
    ws.getColumn(3).width = 40;
    ws.getColumn(4).width = 18;
    ws.getColumn(5).width = 12;

    ws.addRow([]);

    const estadoLbl = {
      ING: () => 'INGRESO',
      CAMBNIV: r => `${r.nivel_anterior || '—'} → ${r.nivel_nuevo || '—'}`,
      RET: () => 'RETIRO',
    };
    const movLabels = { ING: 'INGRESOS', CAMBNIV: 'CAMBIOS DE NIVEL', RET: 'RETIROS' };

    // Movement sections
    for (const movType of ['ING', 'CAMBNIV', 'RET']) {
      const grp = grupos[movType];
      if (!grp.length) continue;

      xlSectionBanner(ws, `${movLabels[movType]}  (${grp.length} registro${grp.length > 1 ? 's' : ''})`, COL_COUNT);
      xlHeaderRow(ws, headers);

      grp.forEach((r, i) => {
        const row = xlDataRow(ws, [
          i + 1,
          r.asociacion || '',
          `${r.ap_paterno} ${r.ap_materno}, ${r.nombres}`,
          estadoLbl[movType](r),
          r.cod_nivel,
        ], i);
        row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
        row.getCell(4).alignment = { horizontal: 'center', vertical: 'middle' };
        row.getCell(4).font = { size: 8, bold: true, color: { argb: XL.headerText } };
        row.getCell(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.estadoBg } };
        row.getCell(5).alignment = { horizontal: 'center', vertical: 'middle' };
      });
      ws.addRow([]);
    }

    // Consolidado section (full roster)
    xlSectionBanner(ws, `CONSOLIDADO - PROGRAMA DE APOYO AL DEPORTISTA ${subtipoLabel}  (${activoRows.length} deportistas activos)`, COL_COUNT);
    xlHeaderRow(ws, headers);

    activoRows.forEach((r, i) => {
      const mov = movByDNI[r.num_documento];
      const estado = mov ? estadoLbl[mov.cod_tip_mov](mov) : '';
      const row = xlDataRow(ws, [
        i + 1,
        r.asociacion || '',
        `${r.ap_paterno} ${r.ap_materno}, ${r.nombres}`,
        estado,
        r.cod_nivel,
      ], i);
      row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      row.getCell(4).alignment = { horizontal: 'center', vertical: 'middle' };
      row.getCell(5).alignment = { horizontal: 'center', vertical: 'middle' };
      if (estado) {
        row.getCell(4).font = { size: 8, bold: true, color: { argb: XL.headerText } };
        row.getCell(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.estadoBg } };
      }
    });

    // Resumen por Federación y Nivel
    ws.addRow([]);
    const levels = [...new Set(activoRows.map(r => r.cod_nivel))].sort();
    const sumCols = levels.length + 2;
    xlSectionBanner(ws, 'RESUMEN POR FEDERACIÓN Y NIVEL', sumCols);
    
    const headersRes = ['FEDERACIÓN', ...levels, 'TOTAL'];
    const hRowRes = ws.addRow(headersRes);
    hRowRes.eachCell(c => {
      c.font = { bold: true, color: { argb: XL.headerText }, size: 8 };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.headerBg } };
      c.alignment = { horizontal: 'center', vertical: 'middle' };
      c.border = { top: { style: 'thin', color: { argb: 'CCCCCC' } }, bottom: { style: 'thin', color: { argb: 'CCCCCC' } }, left: { style: 'thin', color: { argb: 'CCCCCC' } }, right: { style: 'thin', color: { argb: 'CCCCCC' } } };
    });
    hRowRes.height = 18;

    const fedGroup = {};
    activoRows.forEach(r => {
      const f = r.asociacion || '(Sin Asignar)';
      if (!fedGroup[f]) fedGroup[f] = { fed: f, total: 0 };
      fedGroup[f][r.cod_nivel] = (fedGroup[f][r.cod_nivel] || 0) + 1;
      fedGroup[f].total++;
    });

    Object.values(fedGroup).sort((a, b) => a.fed.localeCompare(b.fed)).forEach((fedData, i) => {
      const rowVals = [fedData.fed, ...levels.map(lv => fedData[lv] || '-'), fedData.total];
      const row = xlDataRow(ws, rowVals, i);
      for (let j = 2; j <= sumCols; j++) {
        row.getCell(j).alignment = { horizontal: 'center', vertical: 'middle' };
      }
    });

    if (activoRows.length > 0) {
      xlTotalRow(ws, [`Total: ${activoRows.length} deportistas activos`], sumCols);
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=Consolidado_Tecnico_${padLabel(tipo).replace(/ /g,'_')}_${periodo}.xlsx`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── Consolidado Económico Excel (matches PDF SUB-FO-26) ───
router.get('/consolidado-economico', async (req, res) => {
  try {
    const tipo = req.query.tipo || 'PAD1';
    const periodo = req.query.periodo || new Date().toISOString().slice(0,7).replace('-','');
    const subtipoLabel = tipo === 'PAD1' ? 'I' : tipo === 'PAD2' ? 'II' : '(PNM)';

    const pCheck = await query(`SELECT cerrado FROM pad.periodos_cambios WHERE periodo = @p`, [{name:'p', type:sql.VarChar(6), value:periodo}]);
    if (!pCheck.recordset.length || !pCheck.recordset[0].cerrado) {
      return res.status(403).json({ error: `El periodo ${periodo} no esta cerrado. Solo se pueden exportar consolidados de periodos cerrados.` });
    }

    const result = await query(`
      SELECT
        d.num_documento,
        d.ap_paterno, d.ap_materno, d.nombres,
        d.num_cuenta, d.fecha_nac,
        CASE WHEN DATEDIFF(YEAR, d.fecha_nac, GETDATE()) < 18 THEN 1 ELSE 0 END AS es_menor,
        p.cod_tipo_pad, p.cod_nivel,
        a.nombre AS asociacion,
        mr.monto_soles,
        ap.num_documento AS apo_documento,
        ap.ap_paterno AS apo_paterno, ap.ap_materno AS apo_materno,
        ap.nombres AS apo_nombres
      FROM pad.PAD p
      JOIN pad.Deportistas d ON p.cod_deportista = d.cod_deportista
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
    const total = rows.reduce((s, r) => s + (parseFloat(r.monto_soles) || 0), 0);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Plataforma PMD — UF-PMD/DINADAF/IPD';
    const ws = wb.addWorksheet(`Consolidado Economico ${padLabel(tipo)}`);

    const COL_COUNT = 9;
    const headers = ['Nº', 'FEDERACIÓN', 'DEPORTISTA', 'NRO. DE CUENTA', 'NRO. DOC.', 'APODERADO', 'DNI APO.', 'NIVEL', 'MONTO'];

    ws.getColumn(1).width = 5;   // Nº
    ws.getColumn(2).width = 22;  // Federación
    ws.getColumn(3).width = 30;  // Deportista
    ws.getColumn(4).width = 18;  // Nro. de Cuenta
    ws.getColumn(5).width = 12;  // Nro. Doc.
    ws.getColumn(6).width = 28;  // Apoderado
    ws.getColumn(7).width = 12;  // DNI Apo.
    ws.getColumn(8).width = 8;   // Nivel
    ws.getColumn(9).width = 12;  // Monto

    // Title
    drawHeader3colExcel(ws, 'CONSOLIDADO DEL INFORME ECONÓMICO', `PROGRAMA DE APOYO AL DEPORTISTA ${subtipoLabel} — ${periodoLabel(periodo).toUpperCase()}`, 'SUB-FO-26', COL_COUNT);

    ws.getColumn(1).width = 5;   // Nº
    ws.getColumn(2).width = 22;  // Federación
    ws.getColumn(3).width = 32;  // Deportista
    ws.getColumn(4).width = 20;  // Nro. de Cuenta
    ws.getColumn(5).width = 12;  // Nro. Doc.
    ws.getColumn(6).width = 30;  // Apoderado
    ws.getColumn(7).width = 12;  // DNI Apo.
    ws.getColumn(8).width = 10;  // Nivel
    ws.getColumn(9).width = 14;  // Monto

    ws.addRow([]);

    // Section banner
    xlSectionBanner(ws, `CONSOLIDADO ECONÓMICO - PROGRAMA DE APOYO AL DEPORTISTA ${subtipoLabel}`, COL_COUNT);
    xlHeaderRow(ws, headers);

    rows.forEach((r, i) => {
      const monto = Number(r.monto_soles) || 0;
      const apoderado = r.es_menor && r.apo_paterno
        ? `${r.apo_paterno} ${r.apo_materno || ''}, ${r.apo_nombres || ''}`.trim() : '';
      const dniApo = r.es_menor && r.apo_documento ? r.apo_documento : '';

      const row = xlDataRow(ws, [
        i + 1,
        r.asociacion || '',
        `${r.ap_paterno} ${r.ap_materno}, ${r.nombres}`,
        r.num_cuenta || 'OPE',
        r.num_documento,
        apoderado,
        dniApo,
        r.cod_nivel,
        monto,
      ], i);
      row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      row.getCell(4).alignment = { horizontal: 'center', vertical: 'middle' };
      row.getCell(5).alignment = { horizontal: 'center', vertical: 'middle' };
      row.getCell(7).alignment = { horizontal: 'center', vertical: 'middle' };
      row.getCell(8).alignment = { horizontal: 'center', vertical: 'middle' };
      row.getCell(9).numFmt = '#,##0.00';
      row.getCell(9).alignment = { horizontal: 'right', vertical: 'middle' };
      // OPE highlight
      if (!r.num_cuenta) {
        row.getCell(4).font = { size: 8, bold: true, color: { argb: 'D85A30' } };
      }
    });

    // Total row
    const tRow = xlTotalRow(ws, ['', '', '', '', '', '', '', `Total: ${rows.length}`, total], COL_COUNT);
    tRow.getCell(9).numFmt = '#,##0.00';
    tRow.getCell(9).alignment = { horizontal: 'right', vertical: 'middle' };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=Consolidado_Economico_${padLabel(tipo).replace(/ /g,'_')}_${periodo}.xlsx`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
