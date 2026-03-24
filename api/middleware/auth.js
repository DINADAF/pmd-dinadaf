// ── middleware/auth.js — API Key authentication ──────────────────────────────
// Routes that do NOT require a key (health check only)
const PUBLIC_PATHS = ['/health'];

module.exports = function requireApiKey(req, res, next) {
  if (PUBLIC_PATHS.some(p => req.path === p)) return next();

  const key = req.headers['x-api-key'];
  const validKeys = (process.env.API_KEYS || '').split(',').map(k => k.trim()).filter(Boolean);

  if (!key || !validKeys.includes(key)) {
    return res.status(401).json({ error: 'No autorizado — se requiere X-Api-Key válida' });
  }
  next();
};
