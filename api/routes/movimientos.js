const express = require('express');
const router = express.Router();
const { query, getPool } = require('../db');
const logger = require('../logger');
const { validarPeriodo } = require('../middleware/validate');


// Register a PAD movement (ING / CAMBNIV / RET) in a single transaction
router.post('/', async (req, res) => {
  const {
    tipo_movimiento,     // 'ING' | 'CAMBNIV' | 'RET'  (maps to cod_tip_mov)
    cod_deportista,
    cod_tipo_pad,        // 'PAD1' | 'PAD2' | 'PNM'
    cod_nivel,
    cod_nivel_anterior,  // for CAMBNIV
    es_permanente,
    nro_informe,
    periodo_vigencia,    // 'YYYYMM'
    motivo,
    detalle_evento,
    fecha_limite,        // for LES
    ruta_documento,
    expedientes,         // array of { nro_expediente, tipo_documento }
    cod_resultado,
    fecha_inicio_evento,
    fecha_fin_evento,
    lugar_evento,
    modalidad,
    categoria,
    resultado
  } = req.body;

  if (!tipo_movimiento || !['ING', 'CAMBNIV', 'RET'].includes(tipo_movimiento))
    return res.status(400).json({ error: 'tipo_movimiento debe ser ING, CAMBNIV o RET' });
  if (!cod_deportista || !Number.isInteger(cod_deportista) || cod_deportista <= 0)
    return res.status(400).json({ error: 'cod_deportista inválido' });
  if (tipo_movimiento === 'ING' && (!cod_tipo_pad || !cod_nivel))
    return res.status(400).json({ error: 'ING requiere cod_tipo_pad y cod_nivel' });
  if (tipo_movimiento === 'CAMBNIV' && !cod_nivel)
    return res.status(400).json({ error: 'CAMBNIV requiere cod_nivel' });
  if (periodo_vigencia && !validarPeriodo(periodo_vigencia))
    return res.status(400).json({ error: 'periodo_vigencia debe tener formato YYYYMM válido' });
  if (nro_informe && typeof nro_informe === 'string' && nro_informe.length > 80)
    return res.status(400).json({ error: 'nro_informe excede 80 caracteres' });


  const pool = await getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    let cod_pad;

    if (tipo_movimiento === 'ING') {
      const r1 = await client.query(
        `INSERT INTO pad.PAD
          (cod_deportista, cod_tipo_pad, cod_nivel, cod_estado_pad, es_permanente, fecha_ingreso)
         VALUES ($1::INTEGER, $2::VARCHAR, $3::VARCHAR, 'ACT', $4::BOOLEAN, now()::DATE)
         RETURNING cod_pad`,
        [cod_deportista, cod_tipo_pad, cod_nivel, es_permanente ? true : false]
      );
      cod_pad = r1.rows[0].cod_pad;

      await client.query(
        `UPDATE pad.Deportistas SET activo = true WHERE cod_deportista = $1::INTEGER`,
        [cod_deportista]
      );

    } else if (tipo_movimiento === 'CAMBNIV') {
      const existing = await client.query(
        `SELECT cod_pad FROM pad.PAD
         WHERE cod_deportista = $1::INTEGER
           AND cod_tipo_pad = $2::VARCHAR
           AND cod_estado_pad = 'ACT'`,
        [cod_deportista, cod_tipo_pad]
      );

      if (existing.rows.length === 0)
        throw new Error('No se encontró registro PAD activo para este deportista y tipo PAD');
      cod_pad = existing.rows[0].cod_pad;

      await client.query(
        `UPDATE pad.PAD SET cod_nivel = $1::VARCHAR WHERE cod_pad = $2::INTEGER`,
        [cod_nivel, cod_pad]
      );

    } else if (tipo_movimiento === 'RET') {
      const existing = await client.query(
        `SELECT cod_pad, cod_nivel FROM pad.PAD
         WHERE cod_deportista = $1::INTEGER
           AND cod_tipo_pad = $2::VARCHAR
           AND cod_estado_pad IN ('ACT','LES','LSS')`,
        [cod_deportista, cod_tipo_pad]
      );

      if (existing.rows.length === 0)
        throw new Error('No se encontró registro PAD activo para retirar');
      cod_pad = existing.rows[0].cod_pad;
      cod_nivel = existing.rows[0].cod_nivel; // nivel al momento del retiro

      await client.query(
        `UPDATE pad.PAD
         SET cod_estado_pad = 'RET', fecha_retiro = now()::DATE
         WHERE cod_pad = $1::INTEGER`,
        [cod_pad]
      );

      const remaining = await client.query(
        `SELECT COUNT(*)::INTEGER AS n FROM pad.PAD
         WHERE cod_deportista = $1::INTEGER AND cod_estado_pad = 'ACT'`,
        [cod_deportista]
      );
      if (remaining.rows[0].n === 0) {
        await client.query(
          `UPDATE pad.Deportistas SET activo = false WHERE cod_deportista = $1::INTEGER`,
          [cod_deportista]
        );
      }
    }

    let resolved_cod_resultado = cod_resultado || null;

    // Si envian datos de evento y no tenemos cod_resultado preexistente, crearlo al vuelo
    if (!resolved_cod_resultado && detalle_evento && tipo_movimiento !== 'RET') {
      // 1. Crear el Evento
      const evQuery = await client.query(
        `INSERT INTO pad.Eventos_Resultado (nombre_evento, fecha_inicio, fecha_fin, ciudad)
         VALUES ($1::VARCHAR, $2::DATE, $3::DATE, $4::VARCHAR)
         RETURNING cod_evento`,
        [detalle_evento, fecha_inicio_evento || null, fecha_fin_evento || null, lugar_evento || null]
      );

      const cod_evento_nuevo = evQuery.rows[0].cod_evento;

      const RESULTADOS_VALIDOS = ['ORO', 'PLATA', 'BRONCE', 'PARTICIPACION', 'OTRO'];
      const resultadoVal = resultado && RESULTADOS_VALIDOS.includes(resultado) ? resultado : 'PARTICIPACION';

      // 2. Asociar el Resultado al Deportista (Vencimiento = fin de mes, 11 meses despues)
      const resQuery = await client.query(
        `INSERT INTO pad.resultados_deportista (cod_evento, cod_deportista, modalidad, categoria, resultado, fecha_vencimiento)
         VALUES ($1::INTEGER, $2::INTEGER, $3::VARCHAR, $4::VARCHAR, $5::VARCHAR, eomonth((SELECT fecha_fin FROM pad.Eventos_Resultado WHERE cod_evento = $1), 11))
         RETURNING cod_resultado`,
        [cod_evento_nuevo, cod_deportista, modalidad || null, categoria || null, resultadoVal]
      );

      resolved_cod_resultado = resQuery.rows[0].cod_resultado;
    }

    // Insert into cambios_PAD (uses cod_tip_mov, not cod_tipo_movimiento)
    const r2 = await client.query(
      `INSERT INTO pad.cambios_PAD
        (cod_pad, cod_tip_mov, nro_informe, periodo_vigencia,
         motivo, detalle_evento, nivel_anterior, nivel_nuevo,
         fecha_limite, ruta_documento, cod_resultado)
       VALUES
        ($1::INTEGER, $2::VARCHAR, $3::VARCHAR, $4::VARCHAR,
         $5::VARCHAR, $6::VARCHAR, $7::VARCHAR, $8::VARCHAR,
         $9::DATE, $10::VARCHAR, $11::INTEGER)
       RETURNING cod_cambio`,
      [
        cod_pad,
        tipo_movimiento,
        nro_informe || null,
        periodo_vigencia || null,
        motivo || null,
        detalle_evento || null,
        tipo_movimiento === 'CAMBNIV' ? (cod_nivel_anterior || null)
          : tipo_movimiento === 'RET' ? (cod_nivel || null)
          : null,
        tipo_movimiento === 'ING' ? (cod_nivel || null)
          : tipo_movimiento === 'CAMBNIV' ? (cod_nivel || null)
          : null,
        fecha_limite || null,
        ruta_documento || null,
        resolved_cod_resultado
      ]
    );

    const cod_cambio = r2.rows[0].cod_cambio;

    // Insert expedientes
    if (expedientes && expedientes.length > 0) {
      for (const exp of expedientes) {
        await client.query(
          `INSERT INTO pad.expedientes_cambio (cod_cambio, nro_expediente, tipo_documento)
           VALUES ($1::INTEGER, $2::VARCHAR, $3::VARCHAR)`,
          [cod_cambio, exp.nro_expediente, exp.tipo_documento || 'EXPEDIENTE']
        );
      }
    }

    await client.query('COMMIT');
    res.json({ ok: true, cod_pad, cod_cambio });

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    logger.error('movimientos.post', err);
    res.status(500).json({ error: 'Error al registrar movimiento' });
  } finally {
    if (client) client.release();
  }
});

// Get recent movements
router.get('/recientes', async (req, res) => {
  const { periodo } = req.query;
  try {
    const result = await query(
      `SELECT
         c.cod_cambio, c.cod_tip_mov AS cod_tipo_movimiento,
         c.nro_informe, c.periodo_vigencia, c.motivo,
         COALESCE(nant.nombre_nivel, c.nivel_anterior) AS nivel_anterior,
         COALESCE(nnuv.nombre_nivel, c.nivel_nuevo)    AS nivel_nuevo,
         c.fecha_informe AS fecha_cambio,
         d.ap_paterno || ' ' || d.ap_materno || ', ' || d.nombres AS deportista,
         d.num_documento,
         p.cod_tipo_pad, p.cod_nivel,
         a.nombre AS asociacion
       FROM pad.cambios_PAD c
       JOIN pad.PAD p ON c.cod_pad = p.cod_pad
       JOIN pad.Deportistas d ON p.cod_deportista = d.cod_deportista
       LEFT JOIN pad.Asociacion_Deportiva a ON d.cod_asociacion = a.cod_asociacion
       LEFT JOIN cat.Nivel nant ON nant.cod_nivel = c.nivel_anterior
       LEFT JOIN cat.Nivel nnuv ON nnuv.cod_nivel = c.nivel_nuevo
       WHERE ($1::VARCHAR IS NULL OR c.periodo_vigencia = $1)
       ORDER BY c.cod_cambio DESC
       LIMIT 50`,
      /* NOTA: El COALESCE se mantiene como fallback para cualquier residual histórico no mapeado */
      [periodo || null]
    );
    res.json(result.recordset);
  } catch (err) {
    logger.error('movimientos', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/movimientos/periodos — list all periods with counts and status
router.get('/periodos', async (req, res) => {
  try {
    const result = await query(
      `SELECT
         c.periodo_vigencia AS periodo,
         COUNT(*)::INTEGER AS cantidad_registros,
         COALESCE(p.cerrado, false) AS cerrado,
         p.fecha_cierre,
         p.usuario_cierre,
         p.notas
       FROM pad.cambios_PAD c
       LEFT JOIN pad.periodos_cambios p ON p.periodo = c.periodo_vigencia
       WHERE c.periodo_vigencia IS NOT NULL
       GROUP BY c.periodo_vigencia, p.cerrado, p.fecha_cierre, p.usuario_cierre, p.notas
       ORDER BY c.periodo_vigencia DESC`,
      []
    );
    res.json(result.recordset);
  } catch (err) {
    logger.error('movimientos', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/movimientos/periodo/:periodo — all changes for a specific period
router.get('/periodo/:periodo', async (req, res) => {
  const { periodo } = req.params;
  if (!validarPeriodo(periodo)) return res.status(400).json({ error: 'periodo debe tener formato YYYYMM válido' });
  try {
    const result = await query(
      `SELECT
         c.cod_cambio,
         c.cod_tip_mov,
         c.nro_informe,
         c.periodo_vigencia,
         c.motivo,
         COALESCE(nant.nombre_nivel, c.nivel_anterior) AS nivel_anterior,
         COALESCE(nnuv.nombre_nivel, c.nivel_nuevo)    AS nivel_nuevo,
         c.fecha_informe AS fecha_cambio,
         d.ap_paterno || ' ' || d.ap_materno || ', ' || d.nombres AS deportista,
         d.num_documento,
         p.cod_tipo_pad,
         p.cod_nivel,
         a.nombre AS asociacion,
         (SELECT string_agg(e.nro_expediente, ' / ')
          FROM pad.expedientes_cambio e WHERE e.cod_cambio = c.cod_cambio) AS expedientes
       FROM pad.cambios_PAD c
       JOIN pad.PAD p ON c.cod_pad = p.cod_pad
       JOIN pad.Deportistas d ON p.cod_deportista = d.cod_deportista
       LEFT JOIN pad.Asociacion_Deportiva a ON d.cod_asociacion = a.cod_asociacion
       LEFT JOIN cat.Nivel nant ON nant.cod_nivel = c.nivel_anterior
       LEFT JOIN cat.Nivel nnuv ON nnuv.cod_nivel = c.nivel_nuevo
       WHERE c.periodo_vigencia = $1::VARCHAR
       ORDER BY c.cod_cambio ASC`,
      [periodo]
    );
    res.json(result.recordset);
  } catch (err) {
    logger.error('movimientos', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/movimientos/periodos/:periodo/cerrar — close a period
router.post('/periodos/:periodo/cerrar', async (req, res) => {
  const { periodo } = req.params;
  if (!validarPeriodo(periodo)) return res.status(400).json({ error: 'periodo debe tener formato YYYYMM válido' });
  const { usuario, notas } = req.body;
  try {
    const pool = await getPool();
    await pool.query(
      `INSERT INTO pad.periodos_cambios (periodo, cerrado, fecha_cierre, usuario_cierre, notas)
       VALUES ($1::VARCHAR, true, now()::DATE, $2::VARCHAR, $3::VARCHAR)
       ON CONFLICT (periodo) DO UPDATE SET
         cerrado = true,
         fecha_cierre = now()::DATE,
         usuario_cierre = EXCLUDED.usuario_cierre,
         notas = EXCLUDED.notas`,
      [periodo, usuario || 'sistema', notas || null]
    );
    res.json({ ok: true, periodo, cerrado: true });
  } catch (err) {
    logger.error('movimientos', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/movimientos/periodos/:periodo/reabrir — reopen a closed period
router.post('/periodos/:periodo/reabrir', async (req, res) => {
  const { periodo } = req.params;
  if (!validarPeriodo(periodo)) return res.status(400).json({ error: 'periodo debe tener formato YYYYMM válido' });
  try {
    const pool = await getPool();
    await pool.query(
      `UPDATE pad.periodos_cambios
       SET cerrado = false, fecha_cierre = NULL, usuario_cierre = NULL
       WHERE periodo = $1::VARCHAR`,
      [periodo]
    );
    res.json({ ok: true, periodo, cerrado: false });
  } catch (err) {
    logger.error('movimientos', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// PATCH /api/movimientos/:cod_cambio — edit documentary fields of an existing movement
// Only allowed when the period is NOT closed. Editable: cod_tip_mov, nro_informe, motivo,
// nivel_anterior, nivel_nuevo (the latter two only meaningful for CAMBNIV).
router.patch('/:cod_cambio(\\d+)', async (req, res) => {
  const cod_cambio = parseInt(req.params.cod_cambio);
  const { cod_tip_mov, nro_informe, motivo, nivel_anterior, nivel_nuevo } = req.body;

  const VALID_MOVS = ['ING', 'CAMBNIV', 'RET'];
  if (cod_tip_mov && !VALID_MOVS.includes(cod_tip_mov)) {
    return res.status(400).json({ error: 'cod_tip_mov inválido. Valores: ING, CAMBNIV, RET' });
  }

  try {
    const pool = await getPool();

    // Fetch current record to get period and validate
    const cur = await pool.query(
      `SELECT c.cod_cambio, c.periodo_vigencia, COALESCE(p.cerrado, false) AS cerrado
       FROM pad.cambios_PAD c
       LEFT JOIN pad.periodos_cambios p ON p.periodo = c.periodo_vigencia
       WHERE c.cod_cambio = $1::INTEGER`,
      [cod_cambio]
    );

    if (!cur.rows.length) return res.status(404).json({ error: 'Cambio no encontrado' });
    if (cur.rows[0].cerrado) return res.status(403).json({ error: 'El periodo está cerrado. No se puede editar.' });

    await pool.query(
      `UPDATE pad.cambios_PAD SET
         cod_tip_mov    = COALESCE($2::VARCHAR, cod_tip_mov),
         nro_informe    = COALESCE($3::VARCHAR, nro_informe),
         motivo         = COALESCE($4::VARCHAR, motivo),
         nivel_anterior = $5::VARCHAR,
         nivel_nuevo    = $6::VARCHAR
       WHERE cod_cambio = $1::INTEGER`,
      [cod_cambio, cod_tip_mov || null, nro_informe || null, motivo || null, nivel_anterior || null, nivel_nuevo || null]
    );

    res.json({ ok: true, cod_cambio });
  } catch (err) {
    logger.error('movimientos patch', err);
    res.status(500).json({ error: 'Error al actualizar el cambio' });
  }
});

module.exports = router;
