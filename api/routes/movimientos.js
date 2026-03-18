const express = require('express');
const router = express.Router();
const { sql, query, getPool } = require('../db');

// Register a PAD movement (ING / CAMBNIV / RET) in a single transaction
router.post('/', async (req, res) => {
  const {
    tipo_movimiento,     // 'ING' | 'CAMBNIV' | 'RET'
    cod_deportista,
    cod_tipo_pad,        // 'PAD1' | 'PAD2' | 'PNM'
    cod_nivel,           // e.g. 'P1-III', 'P2-O', 'PNM-TOP'
    cod_nivel_anterior,  // for CAMBNIV
    cod_estado_pad,      // 'ACT' for ING/CAMBNIV, 'RET' for RET
    es_permanente,
    nro_informe,
    periodo_vigencia,    // 'YYYYMM'
    motivo,
    detalle_evento,
    fecha_limite,        // for LES
    ruta_documento,
    expedientes,         // array of { nro_expediente, tipo_documento }
    // For ING: event + result data
    cod_resultado,       // FK to resultados_deportista (optional, set later)
  } = req.body;

  const pool = await getPool();
  const transaction = new sql.Transaction(pool);

  try {
    await transaction.begin();
    const req_t = new sql.Request(transaction);

    let cod_pad;

    if (tipo_movimiento === 'ING') {
      // Insert into pad.PAD
      const r1 = await req_t
        .input('cod_deportista', sql.Int, cod_deportista)
        .input('cod_tipo_pad', sql.VarChar(4), cod_tipo_pad)
        .input('cod_nivel', sql.VarChar(10), cod_nivel)
        .input('cod_estado_pad', sql.VarChar(3), 'ACT')
        .input('es_permanente', sql.Bit, es_permanente ? 1 : 0)
        .input('fecha_ingreso', sql.Date, new Date())
        .query(`INSERT INTO pad.PAD
                  (cod_deportista, cod_tipo_pad, cod_nivel, cod_estado_pad, es_permanente, fecha_ingreso)
                OUTPUT INSERTED.cod_pad
                VALUES (@cod_deportista, @cod_tipo_pad, @cod_nivel, @cod_estado_pad, @es_permanente, @fecha_ingreso)`);
      cod_pad = r1.recordset[0].cod_pad;

      // Update Deportistas.activo
      await new sql.Request(transaction)
        .input('cod', sql.Int, cod_deportista)
        .query(`UPDATE pad.Deportistas SET activo = 1 WHERE cod_deportista = @cod`);

    } else if (tipo_movimiento === 'CAMBNIV') {
      // Find existing PAD record
      const existing = await new sql.Request(transaction)
        .input('cod_deportista', sql.Int, cod_deportista)
        .input('cod_tipo_pad', sql.VarChar(4), cod_tipo_pad)
        .query(`SELECT cod_pad FROM pad.PAD
                WHERE cod_deportista = @cod_deportista
                  AND cod_tipo_pad = @cod_tipo_pad
                  AND cod_estado_pad = 'ACT'`);

      if (existing.recordset.length === 0) throw new Error('No se encontró registro PAD activo para este deportista y tipo PAD');
      cod_pad = existing.recordset[0].cod_pad;

      // Update level
      await new sql.Request(transaction)
        .input('cod_nivel', sql.VarChar(10), cod_nivel)
        .input('cod_pad', sql.Int, cod_pad)
        .query(`UPDATE pad.PAD SET cod_nivel = @cod_nivel WHERE cod_pad = @cod_pad`);

    } else if (tipo_movimiento === 'RET') {
      const existing = await new sql.Request(transaction)
        .input('cod_deportista', sql.Int, cod_deportista)
        .input('cod_tipo_pad', sql.VarChar(4), cod_tipo_pad)
        .query(`SELECT cod_pad FROM pad.PAD
                WHERE cod_deportista = @cod_deportista
                  AND cod_tipo_pad = @cod_tipo_pad
                  AND cod_estado_pad IN ('ACT','LES','LSS')`);

      if (existing.recordset.length === 0) throw new Error('No se encontró registro PAD activo para retirar');
      cod_pad = existing.recordset[0].cod_pad;

      await new sql.Request(transaction)
        .input('cod_pad', sql.Int, cod_pad)
        .query(`UPDATE pad.PAD
                SET cod_estado_pad = 'RET', fecha_retiro = GETDATE()
                WHERE cod_pad = @cod_pad`);

      // Check if athlete has any remaining active PAD
      const remaining = await new sql.Request(transaction)
        .input('cod_deportista', sql.Int, cod_deportista)
        .query(`SELECT COUNT(*) AS n FROM pad.PAD
                WHERE cod_deportista = @cod_deportista AND cod_estado_pad = 'ACT'`);
      if (remaining.recordset[0].n === 0) {
        await new sql.Request(transaction)
          .input('cod', sql.Int, cod_deportista)
          .query(`UPDATE pad.Deportistas SET activo = 0 WHERE cod_deportista = @cod`);
      }
    }

    // Insert into cambios_PAD
    const r2 = await new sql.Request(transaction)
      .input('cod_pad', sql.Int, cod_pad)
      .input('cod_tipo_movimiento', sql.VarChar(8), tipo_movimiento)
      .input('nro_informe', sql.VarChar(80), nro_informe || null)
      .input('periodo_vigencia', sql.Char(6), periodo_vigencia || null)
      .input('motivo', sql.VarChar(200), motivo || null)
      .input('detalle_evento', sql.VarChar(500), detalle_evento || null)
      .input('nivel_anterior', sql.VarChar(10), cod_nivel_anterior || null)
      .input('nivel_nuevo', sql.VarChar(10), cod_nivel || null)
      .input('fecha_limite', sql.Date, fecha_limite || null)
      .input('ruta_documento', sql.VarChar(500), ruta_documento || null)
      .input('cod_resultado', sql.Int, cod_resultado || null)
      .query(`INSERT INTO pad.cambios_PAD
                (cod_pad, cod_tipo_movimiento, nro_informe, periodo_vigencia,
                 motivo, detalle_evento, nivel_anterior, nivel_nuevo,
                 fecha_limite, ruta_documento, cod_resultado, fecha_cambio)
              OUTPUT INSERTED.cod_cambio
              VALUES
                (@cod_pad, @cod_tipo_movimiento, @nro_informe, @periodo_vigencia,
                 @motivo, @detalle_evento, @nivel_anterior, @nivel_nuevo,
                 @fecha_limite, @ruta_documento, @cod_resultado, GETDATE())`);

    const cod_cambio = r2.recordset[0].cod_cambio;

    // Insert expedientes
    if (expedientes && expedientes.length > 0) {
      for (const exp of expedientes) {
        await new sql.Request(transaction)
          .input('cod_cambio', sql.Int, cod_cambio)
          .input('nro_expediente', sql.VarChar(30), exp.nro_expediente)
          .input('tipo_documento', sql.VarChar(20), exp.tipo_documento || 'EXPEDIENTE')
          .query(`INSERT INTO pad.expedientes_cambio (cod_cambio, nro_expediente, tipo_documento)
                  VALUES (@cod_cambio, @nro_expediente, @tipo_documento)`);
      }
    }

    await transaction.commit();
    res.json({ ok: true, cod_pad, cod_cambio });

  } catch (err) {
    await transaction.rollback();
    res.status(500).json({ error: err.message });
  }
});

// Get recent movements for dashboard
router.get('/recientes', async (req, res) => {
  const { periodo } = req.query;
  try {
    const result = await query(
      `SELECT TOP 50
         c.cod_cambio, c.cod_tipo_movimiento,
         c.nro_informe, c.periodo_vigencia, c.motivo,
         c.nivel_anterior, c.nivel_nuevo, c.fecha_cambio,
         d.ap_paterno + ' ' + d.ap_materno + ', ' + d.nombres AS deportista,
         d.num_documento,
         p.cod_tipo_pad, p.cod_nivel,
         a.nombre AS asociacion
       FROM pad.cambios_PAD c
       JOIN pad.PAD p ON c.cod_pad = p.cod_pad
       JOIN pad.Deportistas d ON p.cod_deportista = d.cod_deportista
       LEFT JOIN pad.Asociacion_Deportiva a ON d.cod_asociacion = a.cod_asociacion
       WHERE (@periodo IS NULL OR c.periodo_vigencia = @periodo)
       ORDER BY c.fecha_cambio DESC`,
      [{ name: 'periodo', type: sql.Char(6), value: periodo || null }]
    );
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
