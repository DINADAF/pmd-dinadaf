const express = require('express');
const router = express.Router();
const { query } = require('../db');
const fs = require('fs');
const path = require('path');

// KPI summary — used by dashboard Module 1
router.get('/kpi', async (_req, res) => {
  try {
    const result = await query(`
      SELECT
        SUM(CASE WHEN p.cod_tipo_pad = 'PAD1' AND p.cod_estado_pad = 'ACT' THEN 1 ELSE 0 END) AS activos_pad1,
        SUM(CASE WHEN p.cod_tipo_pad = 'PAD2' AND p.cod_estado_pad = 'ACT' THEN 1 ELSE 0 END) AS activos_pad2,
        SUM(CASE WHEN p.cod_tipo_pad = 'PNM'  AND p.cod_estado_pad = 'ACT' THEN 1 ELSE 0 END) AS activos_pnm,
        SUM(CASE WHEN p.cod_estado_pad = 'ACT' THEN 1 ELSE 0 END) AS total_activos,
        SUM(CASE WHEN p.cod_estado_pad = 'LES' THEN 1 ELSE 0 END) AS total_les
      FROM pad.PAD p
    `);
    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Active athletes list
router.get('/activos', async (_req, res) => {
  try {
    const result = await query(`
      SELECT
        d.num_documento, d.ap_paterno, d.ap_materno, d.nombres,
        d.sexo, p.cod_tipo_pad, p.cod_nivel, p.cod_estado_pad,
        p.es_permanente, p.fecha_ingreso,
        n.descripcion AS nivel_desc,
        a.nombre AS asociacion,
        mr.monto_soles,
        CASE WHEN d.num_cuenta IS NULL THEN 'OPE' ELSE 'CUENTA' END AS tipo_giro
      FROM pad.PAD p
      JOIN pad.Deportistas d ON p.cod_deportista = d.cod_deportista
      JOIN cat.Nivel n ON p.cod_nivel = n.cod_nivel
      LEFT JOIN pad.Asociacion_Deportiva a ON d.cod_asociacion = a.cod_asociacion
      LEFT JOIN pad.montos_referencia mr
        ON mr.cod_nivel = p.cod_nivel
        AND mr.periodo = FORMAT(GETDATE(), 'yyyyMM')
      WHERE p.cod_estado_pad = 'ACT'
      ORDER BY p.cod_tipo_pad, p.cod_nivel, d.ap_paterno, d.ap_materno
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Export data to JSON files for SharePoint/GitHub static dashboard
router.post('/exportar', async (_req, res) => {
  try {
    const [kpi, activos, movimientos] = await Promise.all([
      query(`SELECT
               SUM(CASE WHEN p.cod_tipo_pad='PAD1' AND p.cod_estado_pad='ACT' THEN 1 ELSE 0 END) AS activos_pad1,
               SUM(CASE WHEN p.cod_tipo_pad='PAD2' AND p.cod_estado_pad='ACT' THEN 1 ELSE 0 END) AS activos_pad2,
               SUM(CASE WHEN p.cod_tipo_pad='PNM'  AND p.cod_estado_pad='ACT' THEN 1 ELSE 0 END) AS activos_pnm,
               SUM(CASE WHEN p.cod_estado_pad='ACT' THEN 1 ELSE 0 END) AS total_activos,
               SUM(CASE WHEN p.cod_estado_pad='LES' THEN 1 ELSE 0 END) AS total_les
             FROM pad.PAD p`),
      query(`SELECT d.ap_paterno+' '+d.ap_materno+', '+d.nombres AS deportista,
                    d.num_documento, p.cod_tipo_pad, p.cod_nivel, p.cod_estado_pad,
                    n.descripcion AS nivel_desc, a.nombre AS asociacion,
                    mr.monto_soles
             FROM pad.PAD p
             JOIN pad.Deportistas d ON p.cod_deportista=d.cod_deportista
             JOIN cat.Nivel n ON p.cod_nivel=n.cod_nivel
             LEFT JOIN pad.Asociacion_Deportiva a ON d.cod_asociacion=a.cod_asociacion
             LEFT JOIN pad.montos_referencia mr
               ON mr.cod_nivel=p.cod_nivel AND mr.periodo=FORMAT(GETDATE(),'yyyyMM')
             WHERE p.cod_estado_pad='ACT'
             ORDER BY p.cod_tipo_pad, p.cod_nivel, d.ap_paterno`),
      query(`SELECT TOP 100 c.cod_tipo_movimiento,
                    d.ap_paterno+' '+d.ap_materno+', '+d.nombres AS deportista,
                    p.cod_tipo_pad, c.nivel_anterior, c.nivel_nuevo,
                    c.nro_informe, c.periodo_vigencia, c.motivo, c.fecha_cambio
             FROM pad.cambios_PAD c
             JOIN pad.PAD p ON c.cod_pad=p.cod_pad
             JOIN pad.Deportistas d ON p.cod_deportista=d.cod_deportista
             ORDER BY c.fecha_cambio DESC`),
    ]);

    const dataDir = path.join(__dirname, '../../web/data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    const exportTime = new Date().toISOString();
    fs.writeFileSync(path.join(dataDir, 'kpi.json'),
      JSON.stringify({ ...kpi.recordset[0], exportado: exportTime }, null, 2));
    fs.writeFileSync(path.join(dataDir, 'activos.json'),
      JSON.stringify({ data: activos.recordset, exportado: exportTime }, null, 2));
    fs.writeFileSync(path.join(dataDir, 'movimientos_recientes.json'),
      JSON.stringify({ data: movimientos.recordset, exportado: exportTime }, null, 2));

    res.json({ ok: true, exportado: exportTime, registros: activos.recordset.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
