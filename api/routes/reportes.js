const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { uploadJSON } = require('../sharepoint');

// KPI summary — used by dashboard Module 1
router.get('/kpi', async (_req, res) => {
  try {
    const result = await query(`
      SELECT
        SUM(CASE WHEN p.cod_tipo_pad = 'PAD1' AND p.cod_estado_pad = 'ACT' THEN 1 ELSE 0 END) AS activos_pad1,
        SUM(CASE WHEN p.cod_tipo_pad = 'PAD2' AND p.cod_estado_pad = 'ACT' THEN 1 ELSE 0 END) AS activos_pad2,
        SUM(CASE WHEN p.cod_tipo_pad = 'PNM'  AND p.cod_estado_pad = 'ACT' THEN 1 ELSE 0 END) AS activos_pnm,
        SUM(CASE WHEN p.cod_estado_pad = 'ACT' THEN 1 ELSE 0 END) AS total_activos,
        SUM(CASE WHEN p.cod_estado_pad = 'LES' THEN 1 ELSE 0 END) AS total_les,
        (SELECT ISNULL(SUM(mr.monto_soles), 0)
         FROM pad.PAD p2
         JOIN pad.montos_referencia mr
           ON mr.cod_nivel = p2.cod_nivel
           AND FORMAT(GETDATE(), 'yyyyMM') BETWEEN mr.periodo_desde AND ISNULL(mr.periodo_hasta, '999999')
         WHERE p2.cod_estado_pad = 'ACT') AS monto_mensual_total,
        FORMAT(GETDATE(), 'yyyyMM') AS periodo_actual
      FROM pad.PAD p
    `);
    res.json(result.recordset[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Active athletes list
router.get('/activos', async (_req, res) => {
  try {
    const result = await query(`
      SELECT
        d.cod_deportista, d.num_documento, d.ap_paterno, d.ap_materno, d.nombres,
        d.sexo, p.cod_tipo_pad, p.cod_nivel, p.cod_estado_pad,
        p.es_permanente, p.fecha_ingreso,
        n.nombre_nivel AS nivel_desc,
        a.nombre AS asociacion,
        mr.monto_soles,
        CASE WHEN d.num_cuenta IS NULL THEN 'OPE' ELSE 'CUENTA' END AS tipo_giro
      FROM pad.PAD p
      JOIN pad.Deportistas d ON p.cod_deportista = d.cod_deportista
      JOIN cat.Nivel n ON p.cod_nivel = n.cod_nivel
      LEFT JOIN pad.Asociacion_Deportiva a ON d.cod_asociacion = a.cod_asociacion
      LEFT JOIN pad.montos_referencia mr
        ON mr.cod_nivel = p.cod_nivel
        AND FORMAT(GETDATE(), 'yyyyMM') BETWEEN mr.periodo_desde AND ISNULL(mr.periodo_hasta, '999999')
      WHERE p.cod_estado_pad = 'ACT'
      ORDER BY p.cod_tipo_pad, p.cod_nivel, d.ap_paterno, d.ap_materno
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Export data to OneDrive /pad-data/ for Consulta PAD (GitHub Pages reads via Graph API)
router.post('/exportar', async (_req, res) => {
  try {
    const exportTime = new Date().toISOString();

    const [kpiR, activosR, movimientosR, asocR] = await Promise.all([
      // KPI completo
      query(`SELECT
               SUM(CASE WHEN p.cod_tipo_pad='PAD1' AND p.cod_estado_pad='ACT' THEN 1 ELSE 0 END) AS activos_pad1,
               SUM(CASE WHEN p.cod_tipo_pad='PAD2' AND p.cod_estado_pad='ACT' THEN 1 ELSE 0 END) AS activos_pad2,
               SUM(CASE WHEN p.cod_tipo_pad='PNM'  AND p.cod_estado_pad='ACT' THEN 1 ELSE 0 END) AS activos_pnm,
               SUM(CASE WHEN p.cod_estado_pad='ACT' THEN 1 ELSE 0 END) AS total_activos,
               SUM(CASE WHEN p.cod_estado_pad='LES' THEN 1 ELSE 0 END) AS total_les,
               (SELECT ISNULL(SUM(mr2.monto_soles), 0)
                FROM pad.PAD p2
                JOIN pad.montos_referencia mr2
                  ON mr2.cod_nivel = p2.cod_nivel
                  AND FORMAT(GETDATE(),'yyyyMM') BETWEEN mr2.periodo_desde AND ISNULL(mr2.periodo_hasta,'999999')
                WHERE p2.cod_estado_pad='ACT') AS monto_mensual_total,
               FORMAT(GETDATE(),'yyyyMM') AS periodo_actual
             FROM pad.PAD p`),
      // Activos (sin datos sensibles para OneDrive)
      query(`SELECT d.ap_paterno+' '+d.ap_materno+', '+d.nombres AS deportista,
                    p.cod_tipo_pad, p.cod_nivel, p.cod_estado_pad, p.es_permanente,
                    n.nombre_nivel AS nivel_desc, a.nombre AS asociacion,
                    mr.monto_soles,
                    CASE WHEN d.num_cuenta IS NULL THEN 'OPE' ELSE 'CUENTA' END AS tipo_giro
             FROM pad.PAD p
             JOIN pad.Deportistas d ON p.cod_deportista=d.cod_deportista
             JOIN cat.Nivel n ON p.cod_nivel=n.cod_nivel
             LEFT JOIN pad.Asociacion_Deportiva a ON d.cod_asociacion=a.cod_asociacion
             LEFT JOIN pad.montos_referencia mr
               ON mr.cod_nivel=p.cod_nivel
               AND FORMAT(GETDATE(),'yyyyMM') BETWEEN mr.periodo_desde AND ISNULL(mr.periodo_hasta,'999999')
             WHERE p.cod_estado_pad='ACT'
             ORDER BY p.cod_tipo_pad, p.cod_nivel, d.ap_paterno`),
      // Movimientos recientes
      query(`SELECT TOP 100
                    c.cod_tip_mov AS cod_tipo_movimiento,
                    d.ap_paterno+' '+d.ap_materno+', '+d.nombres AS deportista,
                    p.cod_tipo_pad, c.nivel_anterior, c.nivel_nuevo,
                    c.nro_informe, c.periodo_vigencia, c.motivo
             FROM pad.cambios_PAD c
             JOIN pad.PAD p ON c.cod_pad=p.cod_pad
             JOIN pad.Deportistas d ON p.cod_deportista=d.cod_deportista
             ORDER BY c.cod_cambio DESC`),
      // Asociaciones deportivas
      query(`SELECT cod_asociacion, nombre, nombre_formal, tipo_organizacion, disciplina, activo
             FROM pad.Asociacion_Deportiva
             WHERE activo=1
             ORDER BY nombre`),
    ]);

    const kpiData    = { ...kpiR.recordset[0], exportado: exportTime };
    const activosData = { data: activosR.recordset, exportado: exportTime };
    const movData    = { data: movimientosR.recordset, exportado: exportTime };
    const asocData   = asocR.recordset;

    // Subir a OneDrive /pad-data/ (Consulta PAD lee desde ahi via Graph API)
    await Promise.all([
      uploadJSON('kpi.json', kpiData),
      uploadJSON('activos.json', activosData),
      uploadJSON('movimientos_recientes.json', movData),
      uploadJSON('asociaciones.json', asocData),
    ]);

    res.json({
      ok: true,
      exportado: exportTime,
      registros: activosR.recordset.length,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
