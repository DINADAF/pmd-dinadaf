const express = require('express');
const router = express.Router();
const { sql, query } = require('../db');
const logger = require('../logger');

// ── GET /api/montos/directivas ───────────────────────────────────────────────
// Lista las directivas disponibles con su periodo representativo y, para la
// directiva vigente (Dir. 003-2025), una entrada por año de UIT.
// Usado para poblar el selector de directiva en el módulo de Montos.
router.get('/directivas', async (_req, res) => {
  try {
    // Solo la directiva vigente (Dir. 003-2025) se sub-divide por año de UIT.
    // Las directivas históricas consolidan en una sola fila cada una.
    const NORMATIVA_VIGENTE = 'Dir. 003-2025-IPD/DINADAF';
    const r = await query(`
      SELECT
        mr.normativa,
        CASE WHEN mr.normativa = '${NORMATIVA_VIGENTE}' AND v.valor_uit IS NOT NULL
             THEN CAST(LEFT(mr.periodo_desde, 4) AS SMALLINT)
             ELSE NULL END                             AS anio,
        CASE WHEN mr.normativa = '${NORMATIVA_VIGENTE}'
             THEN v.valor_uit ELSE NULL END            AS valor_uit,
        CASE WHEN mr.normativa = '${NORMATIVA_VIGENTE}'
             THEN v.ref_ds    ELSE NULL END            AS ref_ds,
        MIN(mr.periodo_desde)                          AS periodo_ref,
        MAX(ISNULL(mr.periodo_hasta, '999999'))         AS periodo_hasta
      FROM pad.montos_referencia mr
      LEFT JOIN cat.valor_uit v
        ON v.anio = CAST(LEFT(mr.periodo_desde, 4) AS SMALLINT)
      WHERE mr.normativa IS NOT NULL
      GROUP BY
        mr.normativa,
        CASE WHEN mr.normativa = '${NORMATIVA_VIGENTE}' AND v.valor_uit IS NOT NULL
             THEN CAST(LEFT(mr.periodo_desde, 4) AS SMALLINT)
             ELSE NULL END,
        CASE WHEN mr.normativa = '${NORMATIVA_VIGENTE}'
             THEN v.valor_uit ELSE NULL END,
        CASE WHEN mr.normativa = '${NORMATIVA_VIGENTE}'
             THEN v.ref_ds    ELSE NULL END
      ORDER BY MIN(mr.periodo_desde)
    `);
    res.json(r.recordset);
  } catch (err) {
    logger.error('montos', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── GET /api/montos/uit ───────────────────────────────────────────────────────
// Lista todos los valores UIT registrados (histórico y vigente)
router.get('/uit', async (_req, res) => {
  try {
    const r = await query(`
      SELECT anio, valor_uit, ref_ds
      FROM cat.valor_uit
      ORDER BY anio DESC
    `);
    res.json(r.recordset);
  } catch (err) {
    logger.error('montos', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── GET /api/montos/preview ───────────────────────────────────────────────────
// Calcula los montos proyectados sin insertar (para previsualizar antes de generar)
// Query params: anio (YYYY), valor_uit (decimal)
router.get('/preview', async (req, res) => {
  try {
    const anioNum = parseInt(req.query.anio, 10);
    const uitNum  = parseFloat(req.query.valor_uit);

    if (!anioNum || anioNum < 2025 || anioNum > 2099) {
      return res.status(400).json({ error: 'anio inválido (debe ser >= 2025)' });
    }
    if (isNaN(uitNum) || uitNum <= 0 || uitNum > 99999) {
      return res.status(400).json({ error: 'valor_uit inválido' });
    }

    const niveles = await query(`
      SELECT cod_nivel, nombre_nivel, cod_tipo_pad, pct_uit, orden
      FROM cat.Nivel
      WHERE activo = 1 AND pct_uit IS NOT NULL
      ORDER BY cod_tipo_pad, orden
    `);

    const preview = niveles.recordset.map(n => ({
      cod_nivel:   n.cod_nivel,
      nombre_nivel: n.nombre_nivel,
      cod_tipo_pad: n.cod_tipo_pad,
      pct_uit:      n.pct_uit,
      monto_soles:  Math.round(n.pct_uit * uitNum * 100) / 100,
    }));

    res.json({ anio: anioNum, valor_uit: uitNum, niveles: preview });
  } catch (err) {
    logger.error('montos', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── GET /api/montos ───────────────────────────────────────────────────────────
// Lista montos vigentes para un periodo dado, con info de UIT
// Query params:
//   periodo=YYYYMM  (default: periodo actual)
//   tipo=PAD1|PAD2|PNM  (default: todos)
router.get('/', async (req, res) => {
  try {
    const { tipo, periodo } = req.query;
    const periodoRef = (periodo && /^\d{6}$/.test(periodo)) ? periodo : null;
    const tipoRef    = (tipo && ['PAD1','PAD2','PNM'].includes(tipo)) ? tipo : null;

    const r = await query(`
      SELECT
        n.cod_nivel,
        n.nombre_nivel,
        n.cod_tipo_pad,
        n.pct_uit,
        n.orden,
        mr.periodo_desde,
        mr.periodo_hasta,
        mr.divisa,
        mr.monto_base,
        mr.monto_soles,
        mr.normativa,
        v.valor_uit,
        v.ref_ds   AS ref_ds_uit
      FROM cat.Nivel n
      JOIN pad.montos_referencia mr
        ON  mr.cod_nivel     = n.cod_nivel
        AND ISNULL(@periodo, FORMAT(GETDATE(), 'yyyyMM'))
            BETWEEN mr.periodo_desde AND ISNULL(mr.periodo_hasta, '999999')
      LEFT JOIN cat.valor_uit v
        ON  v.anio = CAST(LEFT(mr.periodo_desde, 4) AS SMALLINT)
      WHERE (@tipo IS NULL OR n.cod_tipo_pad = @tipo)
      ORDER BY n.cod_tipo_pad, n.orden
    `, [
      { name: 'periodo', type: sql.VarChar(6), value: periodoRef },
      { name: 'tipo',    type: sql.VarChar(5), value: tipoRef },
    ]);

    res.json(r.recordset);
  } catch (err) {
    logger.error('montos', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── POST /api/montos/generar ──────────────────────────────────────────────────
// Genera 12 meses × 14 niveles = 168 filas en montos_referencia para un año nuevo
// Body: { anio, valor_uit, ref_ds (opcional), periodo_desde (opcional, default: {anio}01) }
// Restricción: periodo_desde >= '202505' (datos históricos bloqueados)
router.post('/generar', async (req, res) => {
  try {
    const { anio, valor_uit, ref_ds, periodo_desde } = req.body;

    // Validaciones
    if (anio == null || valor_uit == null) {
      return res.status(400).json({ error: 'anio y valor_uit son requeridos' });
    }
    const anioNum = parseInt(anio, 10);
    if (isNaN(anioNum) || anioNum < 2025 || anioNum > 2099) {
      return res.status(400).json({ error: 'anio inválido (debe ser entre 2025 y 2099)' });
    }
    const uitNum = parseFloat(valor_uit);
    if (isNaN(uitNum) || uitNum <= 0 || uitNum > 99999) {
      return res.status(400).json({ error: 'valor_uit inválido' });
    }
    const refDs = (ref_ds && typeof ref_ds === 'string') ? ref_ds.trim().slice(0, 60) : null;

    // Periodo de inicio (default: enero del año indicado)
    const perDesde = (periodo_desde && /^\d{6}$/.test(periodo_desde)) ? periodo_desde : `${anioNum}01`;

    if (perDesde < '202505') {
      return res.status(400).json({
        error: 'No se pueden generar montos para periodos anteriores a mayo 2025. Los datos históricos están cerrados.',
      });
    }
    if (perDesde.slice(0, 4) !== String(anioNum)) {
      return res.status(400).json({ error: 'El periodo_desde debe pertenecer al mismo año indicado' });
    }

    // Construir lista de meses (desde periodo_desde hasta diciembre del año)
    const mesDesde = parseInt(perDesde.slice(4), 10);
    const meses = [];
    for (let m = mesDesde; m <= 12; m++) {
      meses.push(`${anioNum}${String(m).padStart(2, '0')}`);
    }

    // Verificar que no existan montos para el primer mes (evitar duplicados)
    const check = await query(
      `SELECT COUNT(*) AS cnt FROM pad.montos_referencia WHERE periodo_desde = @per`,
      [{ name: 'per', type: sql.VarChar(6), value: meses[0] }]
    );
    if (check.recordset[0].cnt > 0) {
      return res.status(409).json({
        error: `Ya existen montos registrados para el periodo ${meses[0]}. No se puede sobrescribir datos existentes.`,
      });
    }

    // Obtener los 14 niveles activos con su % UIT
    const niveles = await query(`
      SELECT cod_nivel, pct_uit
      FROM cat.Nivel
      WHERE activo = 1 AND pct_uit IS NOT NULL
      ORDER BY cod_tipo_pad, orden
    `);

    if (!niveles.recordset.length) {
      return res.status(500).json({ error: 'No hay niveles activos con pct_uit configurado en cat.Nivel' });
    }

    // Registrar el valor UIT del año si no existe aún
    await query(
      `IF NOT EXISTS (SELECT 1 FROM cat.valor_uit WHERE anio = @anio)
         INSERT INTO cat.valor_uit (anio, valor_uit, ref_ds) VALUES (@anio, @uit, @ref_ds)`,
      [
        { name: 'anio',   type: sql.SmallInt,      value: anioNum },
        { name: 'uit',    type: sql.Decimal(10, 2), value: uitNum  },
        { name: 'ref_ds', type: sql.VarChar(60),    value: refDs   },
      ]
    );

    // Insertar montos parametrizados (uno por nivel×mes)
    const normativa = 'Dir. 003-2025-IPD/DINADAF';
    let insertados = 0;
    for (const nivel of niveles.recordset) {
      const monto = Math.round(nivel.pct_uit * uitNum * 100) / 100;
      for (const mes of meses) {
        await query(
          `INSERT INTO pad.montos_referencia
             (cod_nivel, periodo_desde, periodo_hasta, divisa, monto_base, monto_soles, normativa)
           VALUES (@cod_nivel, @per_desde, @per_hasta, 'S', @monto, @monto, @normativa)`,
          [
            { name: 'cod_nivel',  type: sql.VarChar(10),   value: nivel.cod_nivel },
            { name: 'per_desde',  type: sql.VarChar(6),    value: mes },
            { name: 'per_hasta',  type: sql.VarChar(6),    value: mes },
            { name: 'monto',      type: sql.Decimal(10,2), value: monto },
            { name: 'normativa',  type: sql.VarChar(60),   value: normativa },
          ]
        );
        insertados++;
      }
    }

    res.json({
      ok: true,
      anio: anioNum,
      valor_uit: uitNum,
      ref_ds: refDs,
      periodos: meses,
      niveles: niveles.recordset.length,
      registros_insertados: insertados,
    });
  } catch (err) {
    logger.error('montos', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
