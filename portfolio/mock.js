// PORTFOLIO MOCK DATA
// Este archivo sobreescribe las funciones de red de la aplicación para permitir
// que la maqueta (portfolio) funcione en modo 100% offline (sin backend local ni base de datos).

const MOCK_DATA = {
  '/api/reportes/kpi': {
    activos_pad1: 253, activos_pad2: 7, activos_pnm: 13,
    total_activos: 273, total_les: 4, monto_mensual_total: 498740, periodo_actual: "202603", exportado: new Date().toISOString()
  },
  '/api/reportes/dashboard': {
    finanzas_federaciones: [
      { asociacion: "ATLETISMO", total_inversion: 44715, deportistas: 23 },
      { asociacion: "DEPORTES ACUÁTICOS", total_inversion: 39490, deportistas: 21 },
      { asociacion: "GIMNASIA", total_inversion: 34705, deportistas: 21 },
      { asociacion: "LUCHA AMATEUR", total_inversion: 29205, deportistas: 18 },
      { asociacion: "BILLAR", total_inversion: 27940, deportistas: 11 },
      { asociacion: "BÁDMINTON", total_inversion: 26730, deportistas: 15 },
      { asociacion: "KARATE", total_inversion: 24475, deportistas: 11 },
      { asociacion: "ESGRIMA", total_inversion: 23980, deportistas: 15 }
    ],
    demografia: [
      { cod_tipo_pad: "PAD1", cod_nivel: "N1", sexo: "M", cantidad: 120 },
      { cod_tipo_pad: "PAD1", cod_nivel: "N1", sexo: "F", cantidad: 95 },
      { cod_tipo_pad: "PAD1", cod_nivel: "N2", sexo: "M", cantidad: 20 },
      { cod_tipo_pad: "PAD1", cod_nivel: "N2", sexo: "F", cantidad: 18 },
      { cod_tipo_pad: "PAD2", cod_nivel: "N5", sexo: "M", cantidad: 4 },
      { cod_tipo_pad: "PAD2", cod_nivel: "N5", sexo: "F", cantidad: 3 },
      { cod_tipo_pad: "PNM", cod_nivel: "M1", sexo: "M", cantidad: 8 },
      { cod_tipo_pad: "PNM", cod_nivel: "M1", sexo: "F", cantidad: 5 }
    ],
    continuidad: { lesionados_les: 2, lesionados_lss: 2, vencimientos_30_dias: 5 }
  },
  '/api/movimientos/recientes': [
    { deportista: "ÁLVAREZ LUIS", cod_tipo_movimiento: "ING", cod_tipo_pad: "PAD1", nivel_nuevo: "N1", periodo_vigencia: "202603" },
    { deportista: "REYES MARCOS", cod_tipo_movimiento: "CAMBNIV", cod_tipo_pad: "PAD1", nivel_anterior: "N2", nivel_nuevo: "N1", periodo_vigencia: "202603" },
    { deportista: "GUTIÉRREZ SOFÍA", cod_tipo_movimiento: "RET", cod_tipo_pad: "PAD2", nivel_anterior: "N5", nivel_nuevo: null, periodo_vigencia: "202603" }
  ],
  '/api/movimientos/periodos': [
    { periodo: "202603", cantidad_registros: 15, cerrado: 0 },
    { periodo: "202602", cantidad_registros: 42, cerrado: 1 },
    { periodo: "202601", cantidad_registros: 120, cerrado: 1 }
  ],
  '/api/reportes/todos': [
    { cod_deportista: 1, num_documento: "12345678", deportista: "ÁLVAREZ LUIS", asociacion: "ATLETISMO", sexo: "M", cod_tipo_pad: "PAD1", cod_estado_pad: "ACT" },
    { cod_deportista: 2, num_documento: "87654321", deportista: "REYES MARCOS", asociacion: "GIMNASIA", sexo: "F", cod_tipo_pad: "PAD1", cod_estado_pad: "ACT" },
    { cod_deportista: 3, num_documento: "11223344", deportista: "GUTIÉRREZ SOFÍA", asociacion: "KARATE", sexo: "M", cod_tipo_pad: "PAD2", cod_estado_pad: "RET" }
  ],
  '/api/reportes/activos': [
    { cod_tipo_pad: "PAD1", cod_nivel: "N1", nivel_desc: "Nivel 1", monto_soles: 2500, n: 12 },
    { cod_tipo_pad: "PAD1", cod_nivel: "N2", nivel_desc: "Nivel 2", monto_soles: 1800, n: 8 },
    { cod_tipo_pad: "PAD2", cod_nivel: "N5", nivel_desc: "Nivel 5", monto_soles: 900, n: 5 }
  ],
  '/api/deportistas/catalogos': {
    asociaciones: [ { cod_asociacion: 1, nombre: "ATLETISMO" }, { cod_asociacion: 2, nombre: "GIMNASIA" } ],
    niveles: [ { cod_nivel: "N1", desc_nivel: "Nivel 1" }, { cod_nivel: "N2", desc_nivel: "Nivel 2" } ]
  }
};

// Sobreescribir las funciones nativas después de cargar
window.addEventListener('load', () => {
    window.online = true; // Forzar estado verde
    window.IS_LOCAL_API = true;
    
    // Sobreescribir el verificador de salud API
    window.checkApi = async function() { 
        window.online = true; 
        document.getElementById('api-dot').className = 'api-dot online';
        document.getElementById('api-txt').textContent = 'Mock API (Portfolio)';
        if(document.getElementById('api-dot-home')) document.getElementById('api-dot-home').className = 'api-dot online';
        if(document.getElementById('api-txt-home')) document.getElementById('api-txt-home').textContent = 'API Simulada Local';
        return true; 
    };

    // Sobreescribir el fetcher de la API general
    window.apiGet = async function(path) {
      return new Promise(resolve => {
        setTimeout(() => {
          let cleanPath = path.split('?')[0]; // ignorar query params para el mock
          if (cleanPath.startsWith('/api/movimientos/periodo/')) cleanPath = '/api/movimientos/recientes'; // fallback mock
          resolve(MOCK_DATA[cleanPath] || []);
        }, 150); // Simular latencia de red
      });
    };
    
    // Mocks de acciones POST/PUT vacíos
    window.apiPost = async function() { return { success: true }; };
    window.apiPut = async function() { return { success: true }; };

    // ─────────────────────────────────────────────────────────────
    // INTERCEPTORES DE LA EXPORTACIÓN DE PDF/EXCEL (PORTFOLIO MODE)
    // ─────────────────────────────────────────────────────────────
    window.descargarReporte = function(formato, _ruta) { abrirModalEjemplo(formato); };
    window.descargarCambiosPeriodo = function(formato, _per) { abrirModalEjemplo(formato); };
    window.descargarGiro = function() { abrirModalEjemplo('excel'); };
    window.doExport = function() { toast('Mockup: Proceso de exportación a OneDrive desactivado', 'info'); };
});

function abrirModalEjemplo(formato) {
    const isPDF = formato.toLowerCase() === 'pdf';
    document.getElementById('mock-modal-title').textContent = isPDF ? 'Reporte PDF (Ejemplo del Mock)' : 'Reporte Excel (Ejemplo del Mock)';
    // Carga de imágenes estáticas; si no existen, fallback visual
    document.getElementById('mock-modal-img').src = isPDF ? 'img/mock_pdf.png' : 'img/mock_excel.png';
    document.getElementById('mock-modal-img').alt = 'Reporte ' + formato;
    openModal('modal-mock-reporte');
}
