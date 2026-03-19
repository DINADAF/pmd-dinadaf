const express = require('express');
const router = express.Router();
const { sql, query } = require('../db');

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
      [{ name: 'dni', type: sql.VarChar(20), value: dni }]
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
    console.error(err);
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
  if (sexo && !['M', 'F'].includes(sexo))
    return res.status(400).json({ error: 'sexo debe ser M o F' });
  if (tipo_documento && !['DNI', 'CE', 'PAS', 'OTR'].includes(tipo_documento))
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
        { name: 'num_documento', type: sql.VarChar(20), value: num_documento },
        { name: 'tipo_documento', type: sql.VarChar(3), value: tipo_documento || 'DNI' },
        { name: 'ap_paterno', type: sql.VarChar(60), value: ap_paterno },
        { name: 'ap_materno', type: sql.VarChar(60), value: ap_materno },
        { name: 'nombres', type: sql.VarChar(80), value: nombres },
        { name: 'sexo', type: sql.Char(1), value: sexo },
        { name: 'fecha_nac', type: sql.Date, value: fecha_nac },
        { name: 'cod_asociacion', type: sql.SmallInt, value: cod_asociacion },
        { name: 'cod_ubigeo', type: sql.Char(6), value: cod_ubigeo || null },
        { name: 'num_cuenta', type: sql.VarChar(30), value: num_cuenta || null },
        { name: 'correo', type: sql.VarChar(100), value: correo || null },
        { name: 'telefono', type: sql.VarChar(20), value: telefono || null },
        { name: 'agrupacion', type: sql.VarChar(100), value: agrupacion || null },
      ]
    );
    res.json({ cod_deportista: result.recordset[0].cod_deportista });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Update bank account
router.patch('/:cod/cuenta', async (req, res) => {
  const { num_cuenta, tipo_giro } = req.body; // tipo_giro: 'CUENTA' | 'OPE'
  try {
    await query(
      `UPDATE pad.Deportistas SET num_cuenta = @cuenta WHERE cod_deportista = @cod`,
      [
        { name: 'cuenta', type: sql.VarChar(30), value: tipo_giro === 'OPE' ? null : num_cuenta },
        { name: 'cod', type: sql.Int, value: parseInt(req.params.cod) },
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Get single deportista by cod_deportista
router.get('/:cod(\\d+)', async (req, res) => {
  try {
    const result = await query(
      `SELECT d.*, a.nombre AS asociacion_nombre
       FROM pad.Deportistas d
       LEFT JOIN pad.Asociacion_Deportiva a ON d.cod_asociacion = a.cod_asociacion
       WHERE d.cod_deportista = @cod`,
      [{ name: 'cod', type: sql.Int, value: parseInt(req.params.cod) }]
    );
    if (!result.recordset.length) return res.status(404).json({ error: 'No encontrado' });
    res.json(result.recordset[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Update all deportista fields
router.put('/:cod(\\d+)', async (req, res) => {
  const {
    num_documento, tipo_documento, ap_paterno, ap_materno, nombres,
    sexo, fecha_nac, cod_asociacion, cod_ubigeo, num_cuenta,
    correo, telefono, agrupacion
  } = req.body;
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
        { name: 'num_documento',  type: sql.VarChar(20),  value: num_documento },
        { name: 'tipo_documento', type: sql.VarChar(3),   value: tipo_documento || 'DNI' },
        { name: 'ap_paterno',     type: sql.VarChar(60),  value: ap_paterno },
        { name: 'ap_materno',     type: sql.VarChar(60),  value: ap_materno },
        { name: 'nombres',        type: sql.VarChar(80),  value: nombres },
        { name: 'sexo',           type: sql.Char(1),      value: sexo },
        { name: 'fecha_nac',      type: sql.Date,         value: fecha_nac },
        { name: 'cod_asociacion', type: sql.SmallInt,     value: cod_asociacion },
        { name: 'cod_ubigeo',     type: sql.Char(6),      value: cod_ubigeo || null },
        { name: 'num_cuenta',     type: sql.VarChar(30),  value: num_cuenta || null },
        { name: 'correo',         type: sql.VarChar(100), value: correo || null },
        { name: 'telefono',       type: sql.VarChar(20),  value: telefono || null },
        { name: 'agrupacion',     type: sql.VarChar(100), value: agrupacion || null },
        { name: 'cod',            type: sql.Int,          value: parseInt(req.params.cod) },
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
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
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Update organizacion deportiva
router.put('/organizaciones/:cod(\\d+)', async (req, res) => {
  const { nombre, nombre_formal, tipo_organizacion, disciplina, activo } = req.body;
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
        { name: 'nombre',            type: sql.VarChar(100), value: nombre },
        { name: 'nombre_formal',     type: sql.VarChar(200), value: nombre_formal || null },
        { name: 'tipo_organizacion', type: sql.VarChar(20),  value: tipo_organizacion },
        { name: 'disciplina',        type: sql.VarChar(100), value: disciplina || null },
        { name: 'activo',            type: sql.Bit,          value: activo ? 1 : 0 },
        { name: 'cod',               type: sql.SmallInt,     value: parseInt(req.params.cod) },
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
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
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
