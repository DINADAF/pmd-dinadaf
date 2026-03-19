require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const os = require('os');

const requireApiKey = require('./middleware/auth');

const deportistas = require('./routes/deportistas');
const movimientos = require('./routes/movimientos');
const reportes = require('./routes/reportes');
const reportesPdf = require('./routes/reportes-pdf');
const reportesExcel = require('./routes/reportes-excel');

const app = express();
const PORT = process.env.API_PORT || 3001;

// ── Security headers ─────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,      // Frontend SPA manages its own CSP
  crossOriginEmbedderPolicy: false,  // Needed for PDFKit streaming
}));

// ── CORS — restrictivo: solo origenes conocidos ───────────────────────────────
const ALLOWED_ORIGINS = [
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:3000',
  `http://localhost:${PORT}`,
  /^https:\/\/.*\.github\.io$/,        // GitHub Pages (HTTPS siempre)
  /^http:\/\/172\.16\.\d+\.\d+/,      // Red interna IPD (172.16.x.x)
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow server-to-server (no origin) and health checks
    if (!origin) return callback(null, true);
    const ok = ALLOWED_ORIGINS.some(o =>
      typeof o === 'string' ? o === origin : o.test(origin)
    );
    callback(ok ? null : new Error('CORS: origen no permitido'), ok);
  },
  methods: ['GET', 'POST', 'PATCH', 'PUT'],
  allowedHeaders: ['Content-Type', 'x-api-key'],
}));

// ── Rate Limiting ─────────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutos
  max: 300,                   // max 300 req por IP por ventana
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes, intenta de nuevo en 15 minutos' },
});
app.use(globalLimiter);

// Límite más estricto para exportaciones (pueden ser lentas/costosas)
const exportLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Límite de exportaciones alcanzado, espera 1 minuto' },
});

// ── Body parser ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));

// ── Static frontend ───────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../web')));

// ── Health check — público, sin autenticación ─────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.1.0' });
});

// ── API key authentication — protege todos los endpoints /api/* ───────────────
app.use('/api', requireApiKey);

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/deportistas', deportistas);
app.use('/api/movimientos', movimientos);
app.use('/api/reportes', reportes);
app.use('/api/reportes/exportar', exportLimiter);  // extra limit for export
app.use('/api/pdf', reportesPdf);
app.use('/api/excel', reportesExcel);

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  // Never expose internal details in response
  const isDev = process.env.NODE_ENV !== 'production';
  if (isDev) console.error(err);
  else console.error('[ERROR]', err?.message);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// ── Get local network IP ──────────────────────────────────────────────────────
function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const iface of Object.values(nets)) {
    for (const cfg of iface) {
      if (cfg.family === 'IPv4' && !cfg.internal) return cfg.address;
    }
  }
  return null;
}

app.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log(`PMD Platform API corriendo en http://localhost:${PORT}`);
  if (ip) console.log(`Acceso por red local: http://${ip}:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  if (!process.env.API_KEYS) {
    console.warn('[SECURITY WARNING] API_KEYS no está configurada en .env — todos los endpoints /api son accesibles sin autenticación!');
  }
});
