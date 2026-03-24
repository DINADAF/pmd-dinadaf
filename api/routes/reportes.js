const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { uploadJSON } = require('../sharepoint');
const logger = require('../logger');


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
        (SELECT COALESCE(SUM(mr.monto_soles), 0)
         FROM pad.PAD p2
         JOIN pad.montos_referencia mr
           ON mr.cod_nivel = p2.cod_nivel
           AND TO_CHAR(now(), 'YYYYMM') BETWEEN mr.periodo_desde AND COALESCE(mr.periodo_hasta, '999999')
         WHERE p2.cod_estado_pad = 'ACT') AS monto_mensual_total,
        TO_CHAR(now(), 'YYYYMM') AS periodo_actual
      FROM pad.PAD p
    `);
    res.json(result.recordset[0]);
  } catch (err) {
    logger.error('reportes', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// New Dashboard KPIs
router.get('/dashboard', async (_req, res) => {
  try {
    const [finanzasR, demografiaR, retencionesR] = await Promise.all([
      // 1. Distribución del presupuesto por Federación (Top 10)
      query(`
        SELECT
               a.nombre AS asociacion,
               SUM(mr.monto_soles) AS total_inversion,
               COUNT(p.cod_deportista) AS deportistas
        FROM pad.PAD p
        JOIN pad.Deportistas d ON p.cod_deportista = d.cod_deportista
        JOIN pad.Asociacion_Deportiva a ON d.cod_asociacion = a.cod_asociacion
        JOIN pad.montos_referencia mr ON p.cod_nivel = mr.cod_nivel
          AND TO_CHAR(now(), 'YYYYMM') BETWEEN mr.periodo_desde AND COALESCE(mr.periodo_hasta, '999999')
        WHERE p.cod_estado_pad = 'ACT'
        GROUP BY a.nombre
        ORDER BY total_inversion DESC
        LIMIT 10
      `),
      
      // 2. Demografía: Sexo y Tipo / Nivel
      query(`
        SELECT p.cod_tipo_pad, p.cod_nivel, d.sexo, COUNT(*) as cantidad
        FROM pad.PAD p
        JOIN pad.Deportistas d ON p.cod_deportista = d.cod_deportista
        WHERE p.cod_estado_pad IN ('ACT', 'LES', 'LSS')
        GROUP BY p.cod_tipo_pad, p.cod_nivel, d.sexo
      `),

      // 3. Impacto y Continuidad: Estados y Vencimientos
      query(`
        SELECT
          SUM(CASE WHEN p.cod_estado_pad = 'LES' THEN 1 ELSE 0 END) as lesionados_les,
          SUM(CASE WHEN p.cod_estado_pad = 'LSS' THEN 1 ELSE 0 END) as lesionados_lss,
          (
            SELECT COUNT(DISTINCT r.cod_deportista)
            FROM pad.resultados_deportista r
            JOIN pad.PAD p2 ON r.cod_deportista = p2.cod_deportista
            WHERE p2.cod_estado_pad = 'ACT'
              AND r.fecha_vencimiento BETWEEN now()::DATE AND (now() + interval '30 days')::DATE
          ) as vencimientos_30_dias
        FROM pad.PAD p
      `)
    ]);

    res.json({
      finanzas_federaciones: finanzasR.recordset,
      demografia: demografiaR.recordset,
      continuidad: retencionesR.recordset[0]
    });
  } catch (err) {
    logger.error('reportes', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Active athletes list
router.get('/activos', async (req, res) => {
  const { tipo, periodo } = req.query;
  const periodoRef = (periodo && /^\d{6}$/.test(periodo)) ? periodo : null;
  const tipoRef    = (tipo && ['PAD1','PAD2','PNM'].includes(tipo)) ? tipo : null;
  try {
    const result = await query(`
      SELECT
        d.cod_deportista, d.num_documento, d.ap_paterno, d.ap_materno, d.nombres,
        d.sexo, p.cod_tipo_pad, p.cod_nivel, p.cod_estado_pad,
        p.es_permanente, p.fecha_ingreso,
        n.nombre_nivel AS nivel_desc,
        a.nombre AS asociacion,
        d.num_cuenta,
        mr.monto_soles,
        CASE WHEN d.num_cuenta IS NULL THEN 'OPE' ELSE 'CUENTA' END AS tipo_giro
      FROM pad.PAD p
      JOIN pad.Deportistas d ON p.cod_deportista = d.cod_deportista
      JOIN cat.Nivel n ON p.cod_nivel = n.cod_nivel
      LEFT JOIN pad.Asociacion_Deportiva a ON d.cod_asociacion = a.cod_asociacion
      LEFT JOIN pad.montos_referencia mr
        ON mr.cod_nivel = p.cod_nivel
        AND COALESCE($1::VARCHAR, TO_CHAR(now(), 'YYYYMM'))
            BETWEEN mr.periodo_desde AND COALESCE(mr.periodo_hasta, '999999')
      WHERE p.cod_estado_pad = 'ACT'
        AND ($2::VARCHAR IS NULL OR p.cod_tipo_pad = $2)
      ORDER BY p.cod_tipo_pad, p.cod_nivel, d.ap_paterno, d.ap_materno
    `, [periodoRef, tipoRef]);
    res.json(result.recordset);
  } catch (err) {
    logger.error('reportes', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// All athletes (one row per athlete) — used by Deportistas maintenance page
router.get('/todos', async (_req, res) => {
  try {
    const result = await query(`
      SELECT
        d.cod_deportista, d.num_documento, d.ap_paterno, d.ap_materno, d.nombres,
        d.sexo, d.fecha_nac, d.num_cuenta, d.activo,
        a.nombre AS asociacion,
        CASE WHEN EXISTS (
          SELECT 1 FROM pad.PAD p WHERE p.cod_deportista = d.cod_deportista AND p.cod_estado_pad = 'ACT'
        ) THEN 'ACT' ELSE 'RET' END AS cod_estado_pad
      FROM pad.Deportistas d
      LEFT JOIN pad.Asociacion_Deportiva a ON d.cod_asociacion = a.cod_asociacion
      ORDER BY d.ap_paterno, d.ap_materno, d.nombres
    `);
    res.json(result.recordset);
  } catch (err) {
    logger.error('reportes', err);
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
               (SELECT COALESCE(SUM(mr2.monto_soles), 0)
                FROM pad.PAD p2
                JOIN pad.montos_referencia mr2
                  ON mr2.cod_nivel = p2.cod_nivel
                  AND TO_CHAR(now(),'YYYYMM') BETWEEN mr2.periodo_desde AND COALESCE(mr2.periodo_hasta,'999999')
                WHERE p2.cod_estado_pad='ACT') AS monto_mensual_total,
               TO_CHAR(now(),'YYYYMM') AS periodo_actual
             FROM pad.PAD p`),
      // Activos (sin datos sensibles para OneDrive)
      query(`SELECT d.ap_paterno||' '||d.ap_materno||', '||d.nombres AS deportista,
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
               AND TO_CHAR(now(),'YYYYMM') BETWEEN mr.periodo_desde AND COALESCE(mr.periodo_hasta,'999999')
             WHERE p.cod_estado_pad='ACT'
             ORDER BY p.cod_tipo_pad, p.cod_nivel, d.ap_paterno`),
      // Movimientos recientes
      query(`SELECT
                    c.cod_tip_mov AS cod_tipo_movimiento,
                    d.ap_paterno||' '||d.ap_materno||', '||d.nombres AS deportista,
                    p.cod_tipo_pad, c.nivel_anterior, c.nivel_nuevo,
                    c.nro_informe, c.periodo_vigencia, c.motivo
             FROM pad.cambios_PAD c
             JOIN pad.PAD p ON c.cod_pad=p.cod_pad
             JOIN pad.Deportistas d ON p.cod_deportista=d.cod_deportista
             ORDER BY c.cod_cambio DESC
             LIMIT 100`),
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
    logger.error('reportes', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
