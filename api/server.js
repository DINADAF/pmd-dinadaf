require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const os = require('os');

const deportistas = require('./routes/deportistas');
const movimientos = require('./routes/movimientos');
const reportes = require('./routes/reportes');
const reportesPdf = require('./routes/reportes-pdf');
const reportesExcel = require('./routes/reportes-excel');

const app = express();
const PORT = process.env.API_PORT || 3001;

// CORS: GitHub Pages + localhost + any local network IP
app.use(cors({
  origin: [
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://localhost:3000',
    /^https:\/\/.*\.github\.io$/,
    /^http:\/\/192\.168\.\d+\.\d+/,
    /^http:\/\/10\.\d+\.\d+\.\d+/,
  ],
  methods: ['GET', 'POST', 'PATCH', 'PUT'],
}));

app.use(express.json({ limit: '1mb' }));

// Serve Gestion PAD frontend (web/ directory)
app.use(express.static(path.join(__dirname, '../web')));

// Health check — used by web app to detect if local API is running
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});

app.use('/api/deportistas', deportistas);
app.use('/api/movimientos', movimientos);
app.use('/api/reportes', reportes);
app.use('/api/pdf', reportesPdf);
app.use('/api/excel', reportesExcel);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// Get local network IP for display
function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const iface of Object.values(nets)) {
    for (const cfg of iface) {
      if (cfg.family === 'IPv4' && !cfg.internal) return cfg.address;
    }
  }
  return null;
}

// Bind to 0.0.0.0 — accessible from any PC in the local network
app.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log(`PMD Platform API corriendo en http://localhost:${PORT}`);
  if (ip) console.log(`Acceso por red local: http://${ip}:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
