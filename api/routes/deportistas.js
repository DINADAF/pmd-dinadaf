const express = require('express');
const router = express.Router();
const { sql, query } = require('../db');
const logger = require('../logger');
const { parseIntParam } = require('../middleware/validate');

// Allowed enum values
const TIPOS_DOC_VALIDOS = ['DNI', 'CE', 'PAS', 'OTR'];
const SEXOS_VALIDOS = ['M', 'F'];

// Search athlete by DNI
router.get('/buscar', async (req, res) => {
  const { dni } = req.query;
  if (!dni) return res.status(400).json({ error: 'DNI requerido' });

  try {
    const result = await query(
      `SELECT d.cod_deportista, d.num_documento, d.tipo_documento,
              d.ap_paterno, d.ap_materno, d.nombres,
              d.sexo, d.fecha_nac, d.num_cuenta, d.activo,
              a.nombre AS asociacion, d.cod_asociacion,
              d.cod_ubigeo, d.agrupacion
       FROM pad.Deportistas d
       LEFT JOIN pad.Asociacion_Deportiva a ON d.cod_asociacion = a.cod_asociacion
       WHERE d.num_documento = @dni`,
      [{ name: 'dni', type: sql.VarChar(12), value: dni }]
    );
    if (result.recordset.length === 0) {
      return res.json({ found: false });
    }
    const deportista = result.recordset[0];

    // Get active PAD records
    const padResult = await query(
      `SELECT p.cod_pad, p.cod_tipo_pad, p.cod_nivel, p.cod_estado_pad,
              p.es_permanente, p.fecha_ingreso, p.fecha_retiro,
              n.nombre_nivel AS nivel_desc,
              mr.monto_soles
       FROM pad.PAD p
       JOIN cat.Nivel n ON p.cod_nivel = n.cod_nivel
       LEFT JOIN pad.montos_referencia mr
           ON mr.cod_nivel = p.cod_nivel
           AND FORMAT(GETDATE(), 'yyyyMM') BETWEEN mr.periodo_desde AND ISNULL(mr.periodo_hasta, '999999')
       WHERE p.cod_deportista = @cod
       ORDER BY p.cod_estado_pad, p.fecha_ingreso DESC`,
      [{ name: 'cod', type: sql.Int, value: deportista.cod_deportista }]
    );

    res.json({ found: true, deportista, pad_records: padResult.recordset });
  } catch (err) {
    logger.error('deportistas.buscar', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Create new athlete
router.post('/', async (req, res) => {
  const {
    num_documento, tipo_documento, ap_paterno, ap_materno, nombres,
    sexo, fecha_nac, cod_asociacion, cod_ubigeo, num_cuenta,
    correo, telefono, agrupacion
  } = req.body;

  if (!num_documento || !ap_paterno || !nombres)
    return res.status(400).json({ error: 'Campos requeridos: num_documento, ap_paterno, nombres' });
  if (num_documento.length > 12)
    return res.status(400).json({ error: 'num_documento excede 12 caracteres' });
  if (!fecha_nac || isNaN(Date.parse(fecha_nac)))
    return res.status(400).json({ error: 'fecha_nac es requerida y debe ser una fecha válida' });
  if (!cod_asociacion)
    return res.status(400).json({ error: 'cod_asociacion es requerido' });
  if (!sexo || !SEXOS_VALIDOS.includes(sexo))
    return res.status(400).json({ error: 'sexo es requerido y debe ser M o F' });
  if (tipo_documento && !TIPOS_DOC_VALIDOS.includes(tipo_documento))
    return res.status(400).json({ error: 'tipo_documento debe ser DNI, CE, PAS o OTR' });

  try {
    const result = await query(
      `INSERT INTO pad.Deportistas
         (num_documento, tipo_documento, ap_paterno, ap_materno, nombres,
          sexo, fecha_nac, cod_asociacion, cod_ubigeo, num_cuenta,
          correo, telefono, agrupacion, activo, fecha_registro)
       OUTPUT INSERTED.cod_deportista
       VALUES
         (@num_documento, @tipo_documento, @ap_paterno, @ap_materno, @nombres,
          @sexo, @fecha_nac, @cod_asociacion, @cod_ubigeo, @num_cuenta,
          @correo, @telefono, @agrupacion, 0, GETDATE())`,
      [
        { name: 'num_documento', type: sql.VarChar(12), value: num_documento },
        { name: 'tipo_documento', type: sql.VarChar(3), value: tipo_documento || 'DNI' },
        { name: 'ap_paterno', type: sql.VarChar(50), value: ap_paterno },
        { name: 'ap_materno', type: sql.VarChar(50), value: ap_materno || null },
        { name: 'nombres', type: sql.VarChar(50), value: nombres },
        { name: 'sexo', type: sql.Char(1), value: sexo },
        { name: 'fecha_nac', type: sql.Date, value: fecha_nac },
        { name: 'cod_asociacion', type: sql.Int, value: cod_asociacion },
        { name: 'cod_ubigeo', type: sql.Char(6), value: cod_ubigeo || null },
        { name: 'num_cuenta', type: sql.VarChar(20), value: num_cuenta || null },
        { name: 'correo', type: sql.VarChar(80), value: correo || null },
        { name: 'telefono', type: sql.VarChar(20), value: telefono || null },
        { name: 'agrupacion', type: sql.Char(1), value: agrupacion || null },
      ]
    );
    res.json({ cod_deportista: result.recordset[0].cod_deportista });
  } catch (err) {
    logger.error('deportistas.create', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Update bank account
router.patch('/:cod/cuenta', async (req, res) => {
  const cod = parseIntParam(req.params.cod);
  if (!cod) return res.status(400).json({ error: 'ID de deportista inválido' });

  const { num_cuenta, tipo_giro } = req.body;
  if (!['CUENTA', 'OPE'].includes(tipo_giro))
    return res.status(400).json({ error: 'tipo_giro debe ser CUENTA o OPE' });
  if (tipo_giro === 'CUENTA' && (!num_cuenta || typeof num_cuenta !== 'string' || num_cuenta.trim().length === 0 || num_cuenta.length > 20))
    return res.status(400).json({ error: 'num_cuenta es requerido y no puede exceder 20 caracteres' });
  if (tipo_giro === 'CUENTA' && !/^[A-Za-z0-9\-]{1,20}$/.test(num_cuenta.trim()))
    return res.status(400).json({ error: 'num_cuenta contiene caracteres no permitidos' });

  try {
    await query(
      `UPDATE pad.Deportistas SET num_cuenta = @cuenta WHERE cod_deportista = @cod`,
      [
        { name: 'cuenta', type: sql.VarChar(20), value: tipo_giro === 'OPE' ? null : num_cuenta.trim() },
        { name: 'cod', type: sql.Int, value: cod },
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    logger.error('deportistas.cuenta', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Get single deportista by cod_deportista
router.get('/:cod(\\d+)', async (req, res) => {
  const cod = parseIntParam(req.params.cod);
  if (!cod) return res.status(400).json({ error: 'ID inválido' });
  try {
    const result = await query(
      // Explicit field list — no d.* to avoid exposing all sensitive fields
      `SELECT d.cod_deportista, d.num_documento, d.tipo_documento,
              d.ap_paterno, d.ap_materno, d.nombres,
              d.sexo, d.fecha_nac, d.cod_asociacion, d.cod_ubigeo,
              d.num_cuenta, d.correo, d.telefono, d.agrupacion, d.activo,
              a.nombre AS asociacion_nombre
       FROM pad.Deportistas d
       LEFT JOIN pad.Asociacion_Deportiva a ON d.cod_asociacion = a.cod_asociacion
       WHERE d.cod_deportista = @cod`,
      [{ name: 'cod', type: sql.Int, value: cod }]
    );
    if (!result.recordset.length) return res.status(404).json({ error: 'No encontrado' });
    res.json(result.recordset[0]);
  } catch (err) {
    logger.error('deportistas.get', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Update all deportista fields
router.put('/:cod(\\d+)', async (req, res) => {
  const cod = parseIntParam(req.params.cod);
  if (!cod) return res.status(400).json({ error: 'ID inválido' });
  const {
    num_documento, tipo_documento, ap_paterno, ap_materno, nombres,
    sexo, fecha_nac, cod_asociacion, cod_ubigeo, num_cuenta,
    correo, telefono, agrupacion
  } = req.body;
  if (!num_documento || !ap_paterno || !nombres)
    return res.status(400).json({ error: 'Campos requeridos: num_documento, ap_paterno, nombres' });
  if (!fecha_nac || isNaN(Date.parse(fecha_nac)))
    return res.status(400).json({ error: 'fecha_nac es requerida y debe ser una fecha válida' });
  if (!cod_asociacion)
    return res.status(400).json({ error: 'cod_asociacion es requerido' });
  if (!sexo || !SEXOS_VALIDOS.includes(sexo))
    return res.status(400).json({ error: 'sexo es requerido y debe ser M o F' });
  if (tipo_documento && !TIPOS_DOC_VALIDOS.includes(tipo_documento))
    return res.status(400).json({ error: 'tipo_documento debe ser DNI, CE, PAS o OTR' });
  try {
    await query(
      `UPDATE pad.Deportistas SET
         num_documento  = @num_documento,
         tipo_documento = @tipo_documento,
         ap_paterno     = @ap_paterno,
         ap_materno     = @ap_materno,
         nombres        = @nombres,
         sexo           = @sexo,
         fecha_nac      = @fecha_nac,
         cod_asociacion = @cod_asociacion,
         cod_ubigeo     = @cod_ubigeo,
         num_cuenta     = @num_cuenta,
         correo         = @correo,
         telefono       = @telefono,
         agrupacion     = @agrupacion
       WHERE cod_deportista = @cod`,
      [
        { name: 'num_documento',  type: sql.VarChar(12),  value: num_documento },
        { name: 'tipo_documento', type: sql.VarChar(3),   value: tipo_documento || 'DNI' },
        { name: 'ap_paterno',     type: sql.VarChar(50),  value: ap_paterno },
        { name: 'ap_materno',     type: sql.VarChar(50),  value: ap_materno || null },
        { name: 'nombres',        type: sql.VarChar(50),  value: nombres },
        { name: 'sexo',           type: sql.Char(1),      value: sexo },
        { name: 'fecha_nac',      type: sql.Date,         value: fecha_nac },
        { name: 'cod_asociacion', type: sql.Int,          value: cod_asociacion },
        { name: 'cod_ubigeo',     type: sql.Char(6),      value: cod_ubigeo || null },
        { name: 'num_cuenta',     type: sql.VarChar(20),  value: num_cuenta || null },
        { name: 'correo',         type: sql.VarChar(80),  value: correo || null },
        { name: 'telefono',       type: sql.VarChar(20),  value: telefono || null },
        { name: 'agrupacion',     type: sql.Char(1),      value: agrupacion || null },
        { name: 'cod',            type: sql.Int,          value: cod },
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    logger.error('deportistas.update', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Get all organizaciones
router.get('/organizaciones/lista', async (_req, res) => {
  try {
    const result = await query(
      `SELECT cod_asociacion, nombre, nombre_formal, tipo_organizacion, disciplina, activo
       FROM pad.Asociacion_Deportiva ORDER BY nombre`
    );
    res.json(result.recordset);
  } catch (err) {
    logger.error('organizaciones.lista', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Update organizacion deportiva
router.put('/organizaciones/:cod(\\d+)', async (req, res) => {
  const { nombre, nombre_formal, tipo_organizacion, disciplina, activo } = req.body;
  if (!nombre) return res.status(400).json({ error: 'nombre es requerido' });
  if (!tipo_organizacion) return res.status(400).json({ error: 'tipo_organizacion es requerido' });
  try {
    await query(
      `UPDATE pad.Asociacion_Deportiva SET
         nombre            = @nombre,
         nombre_formal     = @nombre_formal,
         tipo_organizacion = @tipo_organizacion,
         disciplina        = @disciplina,
         activo            = @activo
       WHERE cod_asociacion = @cod`,
      [
        { name: 'nombre',            type: sql.VarChar(80),  value: nombre },
        { name: 'nombre_formal',     type: sql.VarChar(150), value: nombre_formal || null },
        { name: 'tipo_organizacion', type: sql.VarChar(15),  value: tipo_organizacion },
        { name: 'disciplina',        type: sql.VarChar(80),  value: disciplina || null },
        { name: 'activo',            type: sql.Bit,          value: activo ? 1 : 0 },
        { name: 'cod',               type: sql.Int,          value: parseInt(req.params.cod) },
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    logger.error('organizaciones.update', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Get catalogs needed for forms
router.get('/catalogos', async (_req, res) => {
  try {
    const [asociaciones, niveles, ubigeo_sample] = await Promise.all([
      query(`SELECT cod_asociacion, nombre FROM pad.Asociacion_Deportiva ORDER BY nombre`),
      query(`SELECT cod_nivel, nombre_nivel AS descripcion, cod_tipo_pad, activo FROM cat.Nivel WHERE activo = 1 ORDER BY cod_tipo_pad, cod_nivel`),
      query(`SELECT TOP 0 cod_ubigeo FROM cat.ubigeo`), // just to confirm table exists
    ]);
    res.json({
      asociaciones: asociaciones.recordset,
      niveles: niveles.recordset,
    });
  } catch (err) {
    logger.error('catalogos', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET Pendientes de Regulación (Módulo temporal Fase 5)
// Deportistas ACT que su registro cambo_PAD activo no tenga evento/resultado/informe/expediente
router.get('/pendientes-regularizacion', async (_req, res) => {
  try {
    const result = await query(`
      SELECT
        d.cod_deportista, d.num_documento, d.ap_paterno, d.ap_materno, d.nombres, d.num_cuenta,
        p.cod_pad, p.cod_nivel, p.cod_tipo_pad,
        a.nombre as asociacion,
        c.cod_cambio, c.nro_informe, c.detalle_evento, c.cod_resultado,
        (SELECT COUNT(*) FROM pad.expedientes_cambio e WHERE e.cod_cambio = c.cod_cambio) as cant_expedientes,
        (SELECT e.nro_expediente, e.tipo_documento FROM pad.expedientes_cambio e WHERE e.cod_cambio = c.cod_cambio FOR JSON PATH) as expedientes_json
      FROM pad.Deportistas d
      JOIN pad.PAD p ON d.cod_deportista = p.cod_deportista AND p.cod_estado_pad = 'ACT'
      LEFT JOIN pad.Asociacion_Deportiva a ON d.cod_asociacion = a.cod_asociacion
      CROSS APPLY (
        SELECT TOP 1 * FROM pad.cambios_PAD cp
        WHERE cp.cod_pad = p.cod_pad
        ORDER BY cp.cod_cambio DESC
      ) c
      WHERE c.nro_informe IS NULL
         OR (c.detalle_evento IS NULL AND c.cod_resultado IS NULL)
         OR NOT EXISTS (SELECT 1 FROM pad.expedientes_cambio e WHERE e.cod_cambio = c.cod_cambio)
         OR d.num_cuenta IS NULL
      ORDER BY d.ap_paterno, d.ap_materno
    `);
    // Parse expedientes_json string to array for each row
    result.recordset.forEach(row => {
      try { row.expedientes_existentes = row.expedientes_json ? JSON.parse(row.expedientes_json) : []; }
      catch { row.expedientes_existentes = []; }
      delete row.expedientes_json;
    });
    res.json(result.recordset);
  } catch (err) {
    logger.error('pendientes', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST Regularizar Registro Incompleto
router.post('/regularizar', async (req, res) => {
  const {
    cod_cambio, cod_deportista, nro_informe, detalle_evento,
    fecha_inicio_evento, fecha_fin_evento, lugar_evento,
    modalidad, categoria, resultado, num_cuenta, expedientes
  } = req.body;

  // Parsear IDs a entero (vienen como string desde inputs del DOM)
  const codCambioInt   = parseInt(cod_cambio,    10);
  const codDepInt      = parseInt(cod_deportista, 10);

  if (!codCambioInt || !codDepInt) return res.status(400).json({ error: 'cod_cambio y cod_deportista requeridos y deben ser números válidos' });

  const pool = await require('../db').getPool();
  const transaction = new sql.Transaction(pool);

  try {
    await transaction.begin();

    let resolved_cod_resultado = null;
    if (detalle_evento) {
      // 1. Crear Evento
      // La columna nombre_evento en Eventos_Resultado es VarChar(200)
      // Mientras que detalle_evento en cambios_PAD es VarChar(2000)
      const nombreEventoTruncado = detalle_evento.substring(0, 200);

      const evQuery = await new sql.Request(transaction)
        .input('nombre_evento', sql.VarChar(200), nombreEventoTruncado)
        .input('fecha_inicio', sql.Date, fecha_inicio_evento || null)
        .input('fecha_fin', sql.Date, fecha_fin_evento || null)
        .input('ciudad', sql.VarChar(80), lugar_evento || null)
        .query(`INSERT INTO pad.Eventos_Resultado (nombre_evento, fecha_inicio, fecha_fin, ciudad)
                OUTPUT INSERTED.cod_evento
                VALUES (@nombre_evento, @fecha_inicio, @fecha_fin, @ciudad)`);

      const cod_evento_nuevo = evQuery.recordset[0].cod_evento;

      // 2. Asociar Resultado
      const RESULTADOS_VALIDOS = ['ORO', 'PLATA', 'BRONCE', 'PARTICIPACION', 'OTRO'];
      const resultadoVal = resultado && RESULTADOS_VALIDOS.includes(resultado) ? resultado : 'PARTICIPACION';
      const resQuery = await new sql.Request(transaction)
        .input('cod_evento', sql.Int, cod_evento_nuevo)
        .input('cod_deportista', sql.Int, codDepInt)
        .input('modalidad', sql.VarChar(100), modalidad || null)
        .input('categoria', sql.VarChar(50), categoria || null)
        .input('resultado', sql.VarChar(30), resultadoVal)
        .query(`INSERT INTO pad.resultados_deportista (cod_evento, cod_deportista, modalidad, categoria, resultado, fecha_vencimiento)
                OUTPUT INSERTED.cod_resultado
                VALUES (@cod_evento, @cod_deportista, @modalidad, @categoria, @resultado, EOMONTH((SELECT fecha_fin FROM pad.Eventos_Resultado WHERE cod_evento = @cod_evento), 11))`);
      
      resolved_cod_resultado = resQuery.recordset[0].cod_resultado;
    }

    // 3. Update el record cambios_PAD — construir SET dinámicamente para evitar
    //    pasar null a sql.Int cuando no hay evento (causa error en mssql)
    const req3 = new sql.Request(transaction)
      .input('cod_cambio', sql.Int, codCambioInt);

    const setClauses = [];
    if (nro_informe !== null && nro_informe !== undefined && nro_informe !== '') {
      req3.input('nro_informe', sql.VarChar(80), nro_informe);
      setClauses.push('nro_informe = ISNULL(@nro_informe, nro_informe)');
    }
    if (detalle_evento) {
      req3.input('detalle_evento', sql.VarChar(2000), detalle_evento);
      setClauses.push('detalle_evento = ISNULL(@detalle_evento, detalle_evento)');
    }
    if (resolved_cod_resultado !== null) {
      req3.input('cod_resultado', sql.Int, resolved_cod_resultado);
      setClauses.push('cod_resultado = ISNULL(@cod_resultado, cod_resultado)');
    }

    if (setClauses.length > 0) {
      await req3.query(`UPDATE pad.cambios_PAD SET ${setClauses.join(', ')} WHERE cod_cambio = @cod_cambio`);
    }

    // 4. Actualizar num_cuenta si se proporcionó
    if (num_cuenta && num_cuenta.trim().length > 0 && num_cuenta.trim().length <= 20) {
      await new sql.Request(transaction)
        .input('cod_deportista', sql.Int, codDepInt)
        .input('num_cuenta', sql.VarChar(20), num_cuenta.trim())
        .query('UPDATE pad.Deportistas SET num_cuenta = @num_cuenta WHERE cod_deportista = @cod_deportista');
    }

    // 5. Update expedientes (Delete old, insert new)
    if (expedientes && expedientes.length > 0) {
      await new sql.Request(transaction)
        .input('cod_cambio', sql.Int, codCambioInt)
        .query('DELETE FROM pad.expedientes_cambio WHERE cod_cambio = @cod_cambio');

      for (const exp of expedientes) {
        await new sql.Request(transaction)
          .input('cod_cambio', sql.Int, codCambioInt)
          .input('nro_expediente', sql.VarChar(50), exp.nro_expediente)
          .input('tipo_documento', sql.VarChar(20), exp.tipo_documento || 'EXPEDIENTE')
          .query(`INSERT INTO pad.expedientes_cambio (cod_cambio, nro_expediente, tipo_documento)
                  VALUES (@cod_cambio, @nro_expediente, @tipo_documento)`);
      }
    }

    await transaction.commit();
    res.json({ ok: true });
  } catch (err) {
    await transaction.rollback().catch(() => {});

    logger.error('regularizar', err);
    res.status(500).json({ error: 'Error al regularizar registro' });
  }
});

module.exports = router;
