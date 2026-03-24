# Contexto del Proyecto — Dashboard Power BI / PAD IPD

## Quién soy
Ruben, analista de datos en la Unidad Funcional de Gestión de Planificación y Metodología Deportiva (UF-PMD), bajo DINADAF en el Instituto Peruano del Deporte (IPD), Lima, Perú.

## Qué es el PAD
El **Programa de Apoyo al Deportista (PAD)** es un subsidio económico mensual que el IPD otorga a deportistas calificados. Hay tres tipos:
- **PAD I** — Deportistas en desarrollo
- **PAD II** — Alto rendimiento (DECAN)
- **PNM** — Programa Nacional de Maratón

Los deportistas tienen niveles (P1-I, P1-II, P1-III, P2-O, P2-I... PNM-A, PNM-B, etc.) que determinan el monto mensual que reciben, basado en un porcentaje de la UIT vigente.

Actualmente hay **273 deportistas activos** (253 PAD I + 7 PAD II + 13 PNM).

## Arquitectura del sistema (lo que ya existe)

### Módulo 1 — Gestión PAD (solo red local IPD)
- Node.js API corriendo en la PC de Ruben (`localhost:8080`)
- Base de datos SQL Server Express con toda la data operacional
- Usado para ingreso de datos, reportes PDF/Excel, administración

### Módulo 2 — Consulta PAD (para especialistas)
- Antes: GitHub Pages con Chart.js (se está migrando)
- **Ahora: Power BI** — dashboard conectado a OneDrive
- Usuarios: Especialistas Deportivos e jefaturas del IPD

### Pipeline de datos
```
SQL Server → API (POST /exportar) → OneDrive /pad-data/ → Power BI
```

El export se ejecuta automáticamente cada lunes 08:00 via Task Scheduler.
También se puede ejecutar manualmente desde la interfaz de Gestión PAD.

## Archivos JSON en OneDrive
**Ubicación:** OneDrive de `dinadaf@ipd.gob.pe` → carpeta `pad-data/`
**Conexión Power BI:** SharePoint Online (carpeta) → `https://ipdperu-my.sharepoint.com/personal/dinadaf_ipd_gob_pe`

### kpi.json — Objeto único (para tarjetas KPI)
```json
{
  "activos_pad1": 253,
  "activos_pad2": 7,
  "activos_pnm": 13,
  "total_activos": 273,
  "total_les": 0,
  "monto_mensual_total": 1234567.89,
  "periodo_actual": "202603",
  "exportado": "2026-03-24T12:00:00Z"
}
```

### activos.json — Lista de deportistas activos
```json
{
  "data": [
    {
      "deportista": "APELLIDO1 APELLIDO2, Nombres",
      "cod_tipo_pad": "PAD1",
      "cod_nivel": "P1-I",
      "cod_estado_pad": "ACT",
      "es_permanente": false,
      "nivel_desc": "Nivel I",
      "asociacion": "FEDERACIÓN DE ATLETISMO DEL PERÚ",
      "monto_soles": 1200.00,
      "tipo_giro": "CUENTA"
    }
  ],
  "exportado": "2026-03-24T12:00:00Z"
}
```
**Nota:** sin DNI ni número de cuenta (datos sensibles excluidos del export)

### movimientos_recientes.json — Últimos 100 movimientos
```json
{
  "data": [
    {
      "cod_tipo_movimiento": "ING",
      "deportista": "APELLIDO1 APELLIDO2, Nombres",
      "cod_tipo_pad": "PAD1",
      "nivel_anterior": null,
      "nivel_nuevo": "P1-I",
      "nro_informe": "001-2026-IPD/DINADAF",
      "periodo_vigencia": "202603",
      "motivo": "Resultados deportivos internacionales"
    }
  ],
  "exportado": "2026-03-24T12:00:00Z"
}
```
Tipos de movimiento: `ING` (Ingreso), `RET` (Retiro), `CAMBNIV` (Cambio de nivel)

### asociaciones.json — Federaciones y asociaciones deportivas
```json
[
  {
    "cod_asociacion": 1,
    "nombre": "ATLETISMO",
    "nombre_formal": "FEDERACIÓN PERUANA DE ATLETISMO",
    "tipo_organizacion": "FDN",
    "disciplina": "ATLETISMO",
    "activo": true
  }
]
```
74 registros en total (federaciones, asociaciones, COP)

## Niveles PAD (referencia)
| Código | Descripción | Tipo |
|--------|-------------|------|
| P1-I a P1-V | Niveles I al V | PAD I |
| P2-O, P2-I a P2-V | Nivel Olímpico y I-V | PAD II |
| PNM-TOP, PNM-A, PNM-B | Top, A, B | PNM |

Estados: `ACT` (activo), `LES` (lesionado), `LSS` (licencia sin subsidio), `RET` (retirado)

## Objetivo del Dashboard Power BI
Crear un dashboard para los **Especialistas Deportivos e jefaturas** del IPD que muestre:

### Visualizaciones prioritarias
1. **KPIs principales** (tarjetas): Total activos PAD I / PAD II / PNM / Total / Monto mensual total
2. **Distribución por asociación** — gráfico de barras: top federaciones por cantidad de deportistas
3. **Distribución por nivel** — treemap o barras apiladas por tipo PAD y nivel
4. **Demografía por sexo** — gráfico de dona o barras por tipo PAD (M/F)
5. **Movimientos recientes** — tabla de los últimos ingresos/retiros/cambios
6. **Nómina completa** — tabla con filtros por tipo PAD, nivel, asociación, estado giro

### Funcionalidades deseadas
- Filtros interactivos (slicers): por tipo PAD, asociación, nivel
- Export a Excel desde Power BI Service
- Actualización automática (los datos en OneDrive se actualizan cada lunes)
- Link público para compartir con especialistas sin licencia Power BI

## Consideraciones de diseño
- Paleta sugerida: vino/granate `#5C0A14` (color institucional IPD/DINADAF) + blanco + gris
- Lenguaje: español (Perú)
- El dashboard es de solo lectura — los especialistas no modifican datos
- Los datos no contienen información sensible (sin DNI, sin cuentas bancarias)

## Configuración de actualización automática
Una vez publicado en Power BI Service:
1. Configurar **Actualización programada** → fuente: OneDrive SharePoint
2. Frecuencia: diaria o semanal (los datos se exportan cada lunes)
3. Las credenciales de SharePoint ya están en la cuenta `dinadaf@ipd.gob.pe`

## Preguntas frecuentes / contexto adicional
- **¿Por qué no GitHub Pages?** El tenant IPD bloquea permisos de API para apps externas (requieren admin consent). Power BI está integrado nativamente con el tenant.
- **¿Por qué JSON y no Excel?** El API genera JSON directamente desde SQL Server. Power Query puede parsearlo sin problemas.
- **¿Se pueden agregar más datos?** Sí — el API puede exportar JSON adicionales. Solo hay que modificar el endpoint `/api/reportes/exportar` y agregar el nuevo archivo a OneDrive.
- **Tenant:** IPD PERU S.A.C. — `ipd.gob.pe` — `19ccc9d6-ff9b-4dc4-914e-f195773cb1a2`
