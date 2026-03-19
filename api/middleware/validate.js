// ── middleware/validate.js — Input validation helpers ─────────────────────────
const TIPOS_PAD_VALIDOS = ['PAD1', 'PAD2', 'PNM'];

/**
 * Validates YYYYMM period format.
 * Returns true if valid, false otherwise.
 */
function validarPeriodo(p) {
  if (!p || !/^\d{6}$/.test(p)) return false;
  const mes = parseInt(p.slice(4), 10);
  return mes >= 1 && mes <= 12;
}

/**
 * Validates report query params ?tipo= and ?periodo=
 * Returns an error string if invalid, null if ok.
 */
function validarParamsReporte(tipo, periodo) {
  if (!TIPOS_PAD_VALIDOS.includes(tipo))
    return `tipo debe ser uno de: ${TIPOS_PAD_VALIDOS.join(', ')}`;
  if (!validarPeriodo(periodo))
    return 'periodo debe tener formato YYYYMM válido (ej: 202602)';
  return null;
}

/**
 * Validates a numeric route param (e.g. :cod).
 * Returns the integer value or null if invalid.
 */
function parseIntParam(val) {
  const n = parseInt(val, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

module.exports = { validarPeriodo, validarParamsReporte, parseIntParam };
