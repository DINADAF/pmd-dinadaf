require('dotenv').config();
const express = require('express');
const cors = require('cors');

const deportistas = require('./routes/deportistas');
const movimientos = require('./routes/movimientos');
const reportes = require('./routes/reportes');
const reportesPdf = require('./routes/reportes-pdf');
const reportesExcel = require('./routes/reportes-excel');

const app = express();
const PORT = process.env.API_PORT || 3001;

// Allow requests from GitHub Pages and localhost
app.use(cors({
  origin: [
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://localhost:3000',
    /^https:\/\/.*\.github\.io$/,
  ],
  methods: ['GET', 'POST', 'PATCH', 'PUT'],
}));

app.use(express.json());

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

app.listen(PORT, '127.0.0.1', () => {
  console.log(`PMD Platform API corriendo en http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
