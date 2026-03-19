const express = require('express');
const router = express.Router();
const { sql, query, getPool } = require('../db');

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
  } = req.body;

  if (!tipo_movimiento || !['ING', 'CAMBNIV', 'RET'].includes(tipo_movimiento))
    return res.status(400).json({ error: 'tipo_movimiento debe ser ING, CAMBNIV o RET' });
  if (!cod_deportista || !Number.isInteger(cod_deportista) || cod_deportista <= 0)
    return res.status(400).json({ error: 'cod_deportista inválido' });
  if (tipo_movimiento === 'ING' && (!cod_tipo_pad || !cod_nivel))
    return res.status(400).json({ error: 'ING requiere cod_tipo_pad y cod_nivel' });
  if (tipo_movimiento === 'CAMBNIV' && !cod_nivel)
    return res.status(400).json({ error: 'CAMBNIV requiere cod_nivel' });

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
        .query(`SELECT cod_pad FROM pad.PAD
                WHERE cod_deportista = @cod_deportista
                  AND cod_tipo_pad = @cod_tipo_pad
                  AND cod_estado_pad IN ('ACT','LES','LSS')`);

      if (existing.recordset.length === 0)
        throw new Error('No se encontró registro PAD activo para retirar');
      cod_pad = existing.recordset[0].cod_pad;

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

    // Insert into cambios_PAD (uses cod_tip_mov, not cod_tipo_movimiento)
    const r2 = await new sql.Request(transaction)
      .input('cod_pad', sql.Int, cod_pad)
      .input('cod_tip_mov', sql.VarChar(7), tipo_movimiento)
      .input('nro_informe', sql.VarChar(80), nro_informe || null)
      .input('periodo_vigencia', sql.VarChar(6), periodo_vigencia || null)
      .input('motivo', sql.VarChar(500), motivo || null)
      .input('detalle_evento', sql.VarChar(2000), detalle_evento || null)
      .input('nivel_anterior', sql.VarChar(10), cod_nivel_anterior || null)
      .input('nivel_nuevo', sql.VarChar(10), cod_nivel || null)
      .input('fecha_limite', sql.Date, fecha_limite || null)
      .input('ruta_documento', sql.VarChar(500), ruta_documento || null)
      .input('cod_resultado', sql.Int, cod_resultado || null)
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
    console.error(err);
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
         c.nivel_anterior, c.nivel_nuevo, c.fecha_informe AS fecha_cambio,
         d.ap_paterno + ' ' + d.ap_materno + ', ' + d.nombres AS deportista,
         d.num_documento,
         p.cod_tipo_pad, p.cod_nivel,
         a.nombre AS asociacion
       FROM pad.cambios_PAD c
       JOIN pad.PAD p ON c.cod_pad = p.cod_pad
       JOIN pad.Deportistas d ON p.cod_deportista = d.cod_deportista
       LEFT JOIN pad.Asociacion_Deportiva a ON d.cod_asociacion = a.cod_asociacion
       WHERE (@periodo IS NULL OR c.periodo_vigencia = @periodo)
       ORDER BY c.cod_cambio DESC`,
      [{ name: 'periodo', type: sql.VarChar(6), value: periodo || null }]
    );
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
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
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/movimientos/periodo/:periodo — all changes for a specific period
router.get('/periodo/:periodo', async (req, res) => {
  const { periodo } = req.params;
  try {
    const result = await query(
      `SELECT
         c.cod_cambio,
         c.cod_tip_mov,
         c.nro_informe,
         c.periodo_vigencia,
         c.motivo,
         c.nivel_anterior,
         c.nivel_nuevo,
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
       WHERE c.periodo_vigencia = @periodo
       ORDER BY c.cod_cambio ASC`,
      [{ name: 'periodo', type: sql.VarChar(6), value: periodo }]
    );
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/movimientos/periodos/:periodo/cerrar — close a period
router.post('/periodos/:periodo/cerrar', async (req, res) => {
  const { periodo } = req.params;
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
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/movimientos/periodos/:periodo/reabrir — reopen a closed period
router.post('/periodos/:periodo/reabrir', async (req, res) => {
  const { periodo } = req.params;
  try {
    const pool = await getPool();
    await pool.request()
      .input('periodo', sql.VarChar(6), periodo)
      .query(`UPDATE pad.periodos_cambios
              SET cerrado=0, fecha_cierre=NULL, usuario_cierre=NULL
              WHERE periodo=@periodo`);
    res.json({ ok: true, periodo, cerrado: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
