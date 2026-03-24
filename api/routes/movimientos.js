const express = require('express');
const router = express.Router();
const { sql, query, getPool } = require('../db');
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
  const transaction = new sql.Transaction(pool);

  try {
    await transaction.begin();

    let cod_pad;

    if (tipo_movimiento === 'ING') {
      const r1 = await new sql.Request(transaction)
        .input('cod_deportista', sql.Int, cod_deportista)
        .input('cod_tipo_pad', sql.VarChar(5), cod_tipo_pad)
        .input('cod_nivel', sql.VarChar(10), cod_nivel)
        .input('es_permanente', sql.Bit, es_permanente ? 1 : 0)
        .input('fecha_ingreso', sql.Date, new Date())
        .query(`INSERT INTO pad.PAD
                  (cod_deportista, cod_tipo_pad, cod_nivel, cod_estado_pad, es_permanente, fecha_ingreso)
                OUTPUT INSERTED.cod_pad
                VALUES (@cod_deportista, @cod_tipo_pad, @cod_nivel, 'ACT', @es_permanente, @fecha_ingreso)`);
      cod_pad = r1.recordset[0].cod_pad;

      await new sql.Request(transaction)
        .input('cod', sql.Int, cod_deportista)
        .query(`UPDATE d SET activo = 1
                FROM pad.Deportistas d WHERE d.cod_deportista = @cod`);

    } else if (tipo_movimiento === 'CAMBNIV') {
      const existing = await new sql.Request(transaction)
        .input('cod_deportista', sql.Int, cod_deportista)
        .input('cod_tipo_pad', sql.VarChar(5), cod_tipo_pad)
        .query(`SELECT cod_pad FROM pad.PAD
                WHERE cod_deportista = @cod_deportista
                  AND cod_tipo_pad = @cod_tipo_pad
                  AND cod_estado_pad = 'ACT'`);

      if (existing.recordset.length === 0)
        throw new Error('No se encontró registro PAD activo para este deportista y tipo PAD');
      cod_pad = existing.recordset[0].cod_pad;

      await new sql.Request(transaction)
        .input('cod_nivel', sql.VarChar(10), cod_nivel)
        .input('cod_pad', sql.Int, cod_pad)
        .query(`UPDATE pad.PAD SET cod_nivel = @cod_nivel WHERE cod_pad = @cod_pad`);

    } else if (tipo_movimiento === 'RET') {
      const existing = await new sql.Request(transaction)
        .input('cod_deportista', sql.Int, cod_deportista)
        .input('cod_tipo_pad', sql.VarChar(5), cod_tipo_pad)
        .query(`SELECT cod_pad, cod_nivel FROM pad.PAD
                WHERE cod_deportista = @cod_deportista
                  AND cod_tipo_pad = @cod_tipo_pad
                  AND cod_estado_pad IN ('ACT','LES','LSS')`);

      if (existing.recordset.length === 0)
        throw new Error('No se encontró registro PAD activo para retirar');
      cod_pad = existing.recordset[0].cod_pad;
      cod_nivel = existing.recordset[0].cod_nivel; // nivel al momento del retiro

      await new sql.Request(transaction)
        .input('cod_pad', sql.Int, cod_pad)
        .query(`UPDATE pad.PAD
                SET cod_estado_pad = 'RET', fecha_retiro = GETDATE()
                WHERE cod_pad = @cod_pad`);

      const remaining = await new sql.Request(transaction)
        .input('cod_deportista', sql.Int, cod_deportista)
        .query(`SELECT COUNT(*) AS n FROM pad.PAD
                WHERE cod_deportista = @cod_deportista AND cod_estado_pad = 'ACT'`);
      if (remaining.recordset[0].n === 0) {
        await new sql.Request(transaction)
          .input('cod', sql.Int, cod_deportista)
          .query(`UPDATE d SET activo = 0
                  FROM pad.Deportistas d WHERE d.cod_deportista = @cod`);
      }
    }

    let resolved_cod_resultado = cod_resultado || null;
    
    // Si envian datos de evento y no tenemos cod_resultado preexistente, crearlo al vuelo
    if (!resolved_cod_resultado && detalle_evento && tipo_movimiento !== 'RET') {
      // 1. Crear el Evento
      const evQuery = await new sql.Request(transaction)
        .input('nombre_evento', sql.VarChar(200), detalle_evento)
        .input('fecha_inicio', sql.Date, fecha_inicio_evento || null)
        .input('fecha_fin', sql.Date, fecha_fin_evento || null)
        .input('ciudad', sql.VarChar(80), lugar_evento || null)
        .query(`INSERT INTO pad.Eventos_Resultado (nombre_evento, fecha_inicio, fecha_fin, ciudad)
                OUTPUT INSERTED.cod_evento
                VALUES (@nombre_evento, @fecha_inicio, @fecha_fin, @ciudad)`);

      const cod_evento_nuevo = evQuery.recordset[0].cod_evento;

      const RESULTADOS_VALIDOS = ['ORO', 'PLATA', 'BRONCE', 'PARTICIPACION', 'OTRO'];
      const resultadoVal = resultado && RESULTADOS_VALIDOS.includes(resultado) ? resultado : 'PARTICIPACION';

      // 2. Asociar el Resultado al Deportista (Vencimiento = fin de mes, 11 meses despues)
      const resQuery = await new sql.Request(transaction)
        .input('cod_evento', sql.Int, cod_evento_nuevo)
        .input('cod_deportista', sql.Int, cod_deportista)
        .input('modalidad', sql.VarChar(100), modalidad || null)
        .input('categoria', sql.VarChar(50), categoria || null)
        .input('resultado', sql.VarChar(30), resultadoVal)
        .query(`INSERT INTO pad.resultados_deportista (cod_evento, cod_deportista, modalidad, categoria, resultado, fecha_vencimiento)
                OUTPUT INSERTED.cod_resultado
                VALUES (@cod_evento, @cod_deportista, @modalidad, @categoria, @resultado, EOMONTH((SELECT fecha_fin FROM pad.Eventos_Resultado WHERE cod_evento = @cod_evento), 11))`);
      
      resolved_cod_resultado = resQuery.recordset[0].cod_resultado;
    }

    // Insert into cambios_PAD (uses cod_tip_mov, not cod_tipo_movimiento)
    const r2 = await new sql.Request(transaction)
      .input('cod_pad', sql.Int, cod_pad)
      .input('cod_tip_mov', sql.VarChar(7), tipo_movimiento)
      .input('nro_informe', sql.VarChar(80), nro_informe || null)
      .input('periodo_vigencia', sql.VarChar(6), periodo_vigencia || null)
      .input('motivo', sql.VarChar(500), motivo || null)
      .input('detalle_evento', sql.VarChar(2000), detalle_evento || null)
      .input('nivel_anterior', sql.VarChar(10), tipo_movimiento === 'CAMBNIV' ? (cod_nivel_anterior || null)
                                              : tipo_movimiento === 'RET'     ? (cod_nivel || null)
                                              : null)
      .input('nivel_nuevo',    sql.VarChar(10), tipo_movimiento === 'ING'     ? (cod_nivel || null)
                                              : tipo_movimiento === 'CAMBNIV' ? (cod_nivel || null)
                                              : null)
      .input('fecha_limite', sql.Date, fecha_limite || null)
      .input('ruta_documento', sql.VarChar(500), ruta_documento || null)
      .input('cod_resultado', sql.Int, resolved_cod_resultado)
      .query(`INSERT INTO pad.cambios_PAD
                (cod_pad, cod_tip_mov, nro_informe, periodo_vigencia,
                 motivo, detalle_evento, nivel_anterior, nivel_nuevo,
                 fecha_limite, ruta_documento, cod_resultado)
              OUTPUT INSERTED.cod_cambio
              VALUES
                (@cod_pad, @cod_tip_mov, @nro_informe, @periodo_vigencia,
                 @motivo, @detalle_evento, @nivel_anterior, @nivel_nuevo,
                 @fecha_limite, @ruta_documento, @cod_resultado)`);

    const cod_cambio = r2.recordset[0].cod_cambio;

    // Insert expedientes
    if (expedientes && expedientes.length > 0) {
      for (const exp of expedientes) {
        await new sql.Request(transaction)
          .input('cod_cambio', sql.Int, cod_cambio)
          .input('nro_expediente', sql.VarChar(50), exp.nro_expediente)
          .input('tipo_documento', sql.VarChar(20), exp.tipo_documento || 'EXPEDIENTE')
          .query(`INSERT INTO pad.expedientes_cambio (cod_cambio, nro_expediente, tipo_documento)
                  VALUES (@cod_cambio, @nro_expediente, @tipo_documento)`);
      }
    }

    await transaction.commit();
    res.json({ ok: true, cod_pad, cod_cambio });

  } catch (err) {
    await transaction.rollback().catch(() => {});
    logger.error('movimientos.post', err);
    res.status(500).json({ error: 'Error al registrar movimiento' });
  }
});

// Get recent movements
router.get('/recientes', async (req, res) => {
  const { periodo } = req.query;
  try {
    const result = await query(
      `SELECT TOP 50
         c.cod_cambio, c.cod_tip_mov AS cod_tipo_movimiento,
         c.nro_informe, c.periodo_vigencia, c.motivo,
         ISNULL(nant.nombre_nivel, c.nivel_anterior) AS nivel_anterior,
         ISNULL(nnuv.nombre_nivel, c.nivel_nuevo)    AS nivel_nuevo,
         c.fecha_informe AS fecha_cambio,
         d.ap_paterno + ' ' + d.ap_materno + ', ' + d.nombres AS deportista,
         d.num_documento,
         p.cod_tipo_pad, p.cod_nivel,
         a.nombre AS asociacion
       FROM pad.cambios_PAD c
       JOIN pad.PAD p ON c.cod_pad = p.cod_pad
       JOIN pad.Deportistas d ON p.cod_deportista = d.cod_deportista
       LEFT JOIN pad.Asociacion_Deportiva a ON d.cod_asociacion = a.cod_asociacion
       LEFT JOIN cat.Nivel nant ON nant.cod_nivel = c.nivel_anterior
       LEFT JOIN cat.Nivel nnuv ON nnuv.cod_nivel = c.nivel_nuevo
       WHERE (@periodo IS NULL OR c.periodo_vigencia = @periodo)
       ORDER BY c.cod_cambio DESC`,
      /* NOTA: El ISNULL se mantiene como fallback para cualquier residual histórico no mapeado */
      [{ name: 'periodo', type: sql.VarChar(6), value: periodo || null }]
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
         COUNT(*) AS cantidad_registros,
         ISNULL(p.cerrado, 0) AS cerrado,
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
         ISNULL(nant.nombre_nivel, c.nivel_anterior) AS nivel_anterior,
         ISNULL(nnuv.nombre_nivel, c.nivel_nuevo)    AS nivel_nuevo,
         c.fecha_informe AS fecha_cambio,
         d.ap_paterno + ' ' + d.ap_materno + ', ' + d.nombres AS deportista,
         d.num_documento,
         p.cod_tipo_pad,
         p.cod_nivel,
         a.nombre AS asociacion,
         (SELECT STRING_AGG(e.nro_expediente, ' / ')
          FROM pad.expedientes_cambio e WHERE e.cod_cambio = c.cod_cambio) AS expedientes
       FROM pad.cambios_PAD c
       JOIN pad.PAD p ON c.cod_pad = p.cod_pad
       JOIN pad.Deportistas d ON p.cod_deportista = d.cod_deportista
       LEFT JOIN pad.Asociacion_Deportiva a ON d.cod_asociacion = a.cod_asociacion
       LEFT JOIN cat.Nivel nant ON nant.cod_nivel = c.nivel_anterior
       LEFT JOIN cat.Nivel nnuv ON nnuv.cod_nivel = c.nivel_nuevo
       WHERE c.periodo_vigencia = @periodo
       ORDER BY c.cod_cambio ASC`,
      [{ name: 'periodo', type: sql.VarChar(6), value: periodo }]
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
    await pool.request()
      .input('periodo', sql.VarChar(6), periodo)
      .input('usuario', sql.VarChar(100), usuario || 'sistema')
      .input('notas', sql.VarChar(500), notas || null)
      .query(`MERGE pad.periodos_cambios AS target
              USING (SELECT @periodo AS periodo) AS source ON target.periodo = source.periodo
              WHEN MATCHED THEN
                UPDATE SET cerrado=1, fecha_cierre=GETDATE(), usuario_cierre=@usuario, notas=@notas
              WHEN NOT MATCHED THEN
                INSERT (periodo, cerrado, fecha_cierre, usuario_cierre, notas)
                VALUES (@periodo, 1, GETDATE(), @usuario, @notas);`);
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
    await pool.request()
      .input('periodo', sql.VarChar(6), periodo)
      .query(`UPDATE pad.periodos_cambios
              SET cerrado=0, fecha_cierre=NULL, usuario_cierre=NULL
              WHERE periodo=@periodo`);
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
    const cur = await pool.request()
      .input('cod', sql.Int, cod_cambio)
      .query(`SELECT c.cod_cambio, c.periodo_vigencia, ISNULL(p.cerrado,0) AS cerrado
              FROM pad.cambios_PAD c
              LEFT JOIN pad.periodos_cambios p ON p.periodo = c.periodo_vigencia
              WHERE c.cod_cambio = @cod`);

    if (!cur.recordset.length) return res.status(404).json({ error: 'Cambio no encontrado' });
    if (cur.recordset[0].cerrado) return res.status(403).json({ error: 'El periodo está cerrado. No se puede editar.' });

    await pool.request()
      .input('cod',            sql.Int,          cod_cambio)
      .input('cod_tip_mov',    sql.VarChar(7),   cod_tip_mov   || null)
      .input('nro_informe',    sql.VarChar(80),  nro_informe   || null)
      .input('motivo',         sql.VarChar(500), motivo        || null)
      .input('nivel_anterior', sql.VarChar(10),  nivel_anterior || null)
      .input('nivel_nuevo',    sql.VarChar(10),  nivel_nuevo    || null)
      .query(`UPDATE pad.cambios_PAD SET
                cod_tip_mov    = ISNULL(@cod_tip_mov,    cod_tip_mov),
                nro_informe    = ISNULL(@nro_informe,    nro_informe),
                motivo         = ISNULL(@motivo,         motivo),
                nivel_anterior = @nivel_anterior,
                nivel_nuevo    = @nivel_nuevo
              WHERE cod_cambio = @cod`);

    res.json({ ok: true, cod_cambio });
  } catch (err) {
    logger.error('movimientos patch', err);
    res.status(500).json({ error: 'Error al actualizar el cambio' });
  }
});

module.exports = router;
