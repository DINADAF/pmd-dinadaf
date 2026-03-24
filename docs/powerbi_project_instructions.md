# Instrucciones para Claude Chat — Proyecto Power BI PAD IPD

## Cómo usar este documento
Crea un Proyecto en Claude.ai y adjunta ambos archivos:
- `powerbi_project_context.md` — contexto técnico completo
- `powerbi_project_instructions.md` — este archivo

Luego trabaja conversacionalmente: Claude no puede interactuar con Power BI Desktop directamente, pero puede guiarte paso a paso con instrucciones precisas y darte los scripts de Power Query (M) que necesites pegar.

---

## Tarea principal
Construir un dashboard Power BI conectado a los JSON de OneDrive del sistema PAD-IPD.

## Estado actual (donde quedó la sesión anterior)
- ✅ Conectado a SharePoint Online (carpeta) en Power BI Desktop
- ✅ URL de conexión: `https://ipdperu-my.sharepoint.com/personal/dinadaf_ipd_gob_pe`
- ✅ Los 4 archivos JSON están en la carpeta `pad-data/` del OneDrive
- ⏳ Pendiente: transformar los datos en Power Query y construir el dashboard

## Próximos pasos a completar

### 1. Power Query — Transformación de datos
Necesito ayuda para crear 4 consultas en Power Query (una por JSON):
- `kpi` — desde `kpi.json`
- `activos` — desde `activos.json` (tabla principal)
- `movimientos` — desde `movimientos_recientes.json`
- `asociaciones` — desde `asociaciones.json`

Para cada una necesito el script M completo para:
- Filtrar por nombre de archivo en la tabla de origen
- Extraer el campo `Content` (binario)
- Parsear como JSON
- Expandir el array `data` (para activos y movimientos)
- Nombrar las columnas correctamente

### 2. Modelo de datos
Definir relaciones entre tablas en Power BI:
- `activos[asociacion]` → `asociaciones[nombre]`
- `activos[cod_tipo_pad]` → tabla de tipo PAD (crear tabla calculada)
- `activos[cod_nivel]` → tabla de niveles (crear tabla calculada con descripciones)

### 3. Medidas DAX
Crear las siguientes medidas:
- `Total Activos` = COUNTROWS(activos)
- `Total PAD I` = CALCULATE(COUNTROWS(activos), activos[cod_tipo_pad]="PAD1")
- `Total PAD II` = CALCULATE(COUNTROWS(activos), activos[cod_tipo_pad]="PAD2")
- `Total PNM` = CALCULATE(COUNTROWS(activos), activos[cod_tipo_pad]="PNM")
- `Monto Mensual Total` = SUM(activos[monto_soles])
- `% Masculino` = DIVIDE(CALCULATE(COUNTROWS(activos), activos[sexo]="M"), [Total Activos])

**Nota:** el campo `sexo` no está en el export actual — puede solicitarse que se agregue al JSON.

### 4. Visualizaciones a construir
1. Tarjetas KPI: Total activos / PAD I / PAD II / PNM / Monto mensual
2. Barras horizontales: Top 10 federaciones por deportistas activos
3. Dona o barras apiladas: distribución por nivel y tipo PAD
4. Tabla: nómina completa con filtros por tipo PAD, nivel, asociación
5. Tabla: movimientos recientes (ING/RET/CAMBNIV)

### 5. Publicación
- Publicar en Power BI Service (workspace del tenant IPD)
- Generar link "Publicar en web" (link público)
- Configurar actualización automática desde OneDrive

---

## Campos disponibles por tabla

### activos (tabla principal)
| Campo | Tipo | Descripción |
|-------|------|-------------|
| deportista | Texto | "APELLIDO1 APELLIDO2, Nombres" |
| cod_tipo_pad | Texto | PAD1 / PAD2 / PNM |
| cod_nivel | Texto | P1-I, P1-II... P2-O... PNM-TOP |
| cod_estado_pad | Texto | ACT / LES / LSS |
| es_permanente | Bool | PAD permanente (medalla olímpica) |
| nivel_desc | Texto | Nombre largo del nivel |
| asociacion | Texto | Nombre de la federación |
| monto_soles | Decimal | Monto mensual en soles |
| tipo_giro | Texto | CUENTA / OPE |

### movimientos
| Campo | Tipo | Descripción |
|-------|------|-------------|
| cod_tipo_movimiento | Texto | ING / RET / CAMBNIV |
| deportista | Texto | Nombre completo |
| cod_tipo_pad | Texto | PAD1 / PAD2 / PNM |
| nivel_anterior | Texto | Nivel previo (null en ING) |
| nivel_nuevo | Texto | Nivel nuevo (null en RET) |
| nro_informe | Texto | Número de informe técnico |
| periodo_vigencia | Texto | YYYYMM (ej: 202603) |
| motivo | Texto | Descripción del movimiento |

### kpi (tabla de una fila)
| Campo | Tipo | Descripción |
|-------|------|-------------|
| activos_pad1 | Entero | Total activos PAD I |
| activos_pad2 | Entero | Total activos PAD II |
| activos_pnm | Entero | Total activos PNM |
| total_activos | Entero | Total general activos |
| total_les | Entero | Total lesionados |
| monto_mensual_total | Decimal | Suma total subsidios mes actual |
| periodo_actual | Texto | YYYYMM |
| exportado | Fecha/Hora | Timestamp del último export |

---

## Datos que faltan en el export actual y que se podrían agregar
Si el dashboard los necesita, se puede pedir que el API los incluya:
- `sexo` (M/F) en `activos.json` — útil para gráficos demográficos
- `fecha_ingreso` en `activos.json` — para calcular antigüedad
- `cod_ubigeo` / región en `activos.json` — para mapas geográficos

Para solicitar cambios en el export, se deben hacer en el archivo:
`api/routes/reportes.js` → función `router.post('/exportar', ...)`

---

## Restricciones importantes
- El dashboard es **solo lectura** — no hay escritura hacia la base de datos
- Los datos no tienen DNI ni cuentas bancarias (excluidos por diseño)
- La actualización de datos depende del export manual o del Task Scheduler (lunes 08:00)
- El tenant IPD bloquea admin consent para apps externas — usar solo herramientas nativas Microsoft

## Contacto con el sistema Gestión PAD
Si necesitas agregar campos al export JSON o modificar la API:
- Vuelve a Claude Code con el proyecto `PAD_IPD`
- El archivo a modificar es `api/routes/reportes.js`
- Los cambios requieren reiniciar el servidor Node.js (`node server.js` en `api/`)
