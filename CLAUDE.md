# PMD Platform — UF-PMD / DINADAF / IPD

> **Read DESIGN_CONTEXT.md in the project root** for architectural decisions, design context, and the rationale behind every decision.

**Plataforma PMD** is the data management platform for the Unidad Funcional de Gestión de Planificación y Metodología Deportiva (UF-PMD), under DINADAF at Peru's Instituto Peruano del Deporte (IPD). Its first module is the **PAD module**: a SQL Server database for the sports subsidy program (Programa de Apoyo al Deportista), replacing Excel-based management with a relational system under the DAMA-DMBOK framework. Additional modules for the UF-PMD area are planned.

## Stack
- Database: PostgreSQL 12+ (instance: `localhost:5432`)
- Language: SQL (PostgreSQL dialect, previously T-SQL for SQL Server)
- DB Name: `pad_ipd`
- DB User: `pad_app` (non-superuser, least-privilege)
- Node.js Driver: `pg` package (v8+)
- IDE: pgAdmin 4 (primary), VS Code + PostgreSQL extension (secondary)
- Collation: Default PostgreSQL collation with `unaccent` extension (accent-insensitive queries, accented data preserved)
- Reference framework: DAMA-DMBOK 2nd Edition
- **Migration Note:** Migrated from SQL Server 2025 Express (March 2026) to PostgreSQL for alignment with IPD IT infrastructure

## Database Architecture

Three schemas following DAMA data taxonomy:
- `cat` — Reference/catalog data (slow-changing)
- `pad` — Master + transactional data (operational)
- `gold` — Views for reports and dashboards

### Tables (16 total)

**cat schema (6 tables, fully loaded):**
- `cat.tipo_PAD` (3 records: PAD1, PAD2, PNM)
- `cat.estado_PAD` (4 records: ACT, LES, LSS, RET)
- `cat.tipo_movimiento` (3 records: ING, RET, CAMBNIV)
- `cat.Nivel` (37 records: 14 active + 23 historical; PK format: P1-III, P2-O, PNM-TOP; `normativa` column stores the first directive period in which each level appeared; `pct_uit` column stores UIT percentage for current levels)
- `cat.ubigeo` (1,891 INEI district codes)
- `cat.valor_uit` (PK: `anio SMALLINT`; stores annual UIT value in soles + `ref_ds` DS reference; 2025=S/5,350, 2026=S/5,500; script: 22_valor_uit.sql)

**pad schema (11 tables):**
- `pad.Asociacion_Deportiva` (74 records — federations, associations, COP)
- `pad.Deportistas` (master data: num_documento, tipo_documento[DNI/CE/PAS/OTR], ap_paterno, ap_materno, nombres, sexo, fecha_nac, cod_asociacion FK, cod_ubigeo FK, num_cuenta, correo, telefono, agrupacion, activo, fecha_registro)
- `pad.Apoderados` (legal guardians for minors, FK to Deportistas)
- `pad.PAD` (benefit assignment: cod_deportista FK, cod_tipo_pad FK, cod_nivel FK, cod_estado_pad FK, es_permanente BIT, fecha_ingreso, fecha_retiro)
- `pad.cambios_PAD` (movement log: nro_informe, periodo_vigencia, motivo, detalle_evento, nivel_anterior/nuevo, fecha_limite, ruta_documento, cod_resultado FK)
  - **nivel_anterior/nivel_nuevo business rule:** ING → nivel_anterior=NULL, nivel_nuevo=cod_nivel; RET → nivel_anterior=cod_nivel, nivel_nuevo=NULL; CAMBNIV → both filled (anterior=previous level, nuevo=new level)
- `pad.expedientes_cambio` (multiple docs per change; PK: cod_cambio+nro_expediente; tipo_documento: INFORME/EXPEDIENTE/OFICIO/RESOLUCION/OTRO)
- `pad.montos_referencia` (2,172 records: fixed amounts by nivel+periodo; divisa S/D, tipo_cambio, monto_soles, normativa; spans 201301-202612; `normativa` column is the authoritative source for nivel×period×directive relationships — 6 historical periods filled via script 21)
- `pad.ejecucion_mensual` (fact table: athlete paid X in month Y; UNIQUE on cod_pad+periodo)
- `pad.Eventos_Resultado` (sports events: name, type, dates, city, country, resolution number)
- `pad.resultados_deportista` (individual results per athlete per event: modalidad, categoria, resultado[ORO/PLATA/BRONCE/PARTICIPACION/OTRO], paises_participantes, fecha_vencimiento)
- `pad.periodos_cambios` (period closing: periodo PK, cerrado BIT, fecha_cierre, usuario_cierre, notas)

### Views (8 in gold schema)
- `gold.v_deportistas_activos` — Active athletes with full data
- `gold.v_resumen_mensual` — Monthly summary by PAD type and level
- `gold.v_consolidado_economico` — Economic report for GDS (payment processing)
- `gold.v_consolidado_tecnico` — Technical report (INGRESOS/CAMBIOS/RETIROS + full roster)
- `gold.v_registro_cambios_pad` — Changes report (SUB-FO-24)
- `gold.v_movimientos_mes` — Monthly movements detail
- `gold.kpi_deportistas_asociacion_periodo` — Athletes per association KPI
- `gold.kpi_riesgo_pago_indebido` — Overpayment risk detection

## Key Business Rules (Directiva N° 003-2025-IPD/DINADAF)

### PAD Types
- **PAD I** — Qualified athletes in development
- **PAD II** — High-performance qualified athletes (DECAN)
- **PNM** — National Marathon Program (5000m, 10000m, half-marathon, marathon)

### Benefit States
- **ACT** — Active, receives monthly economic subsidy
- **LES** — Injured: retains all benefits up to 6 months (numeral 9.1.4.1.6). `fecha_limite` in cambios_PAD records the deadline. Recovery → ACT. No recovery → LSS.
- **LSS** — Medical leave without subsidy: retains health insurance only, up to 6 additional months. No automatic return to ACT — requires full new ING procedure with expediente. Ends in RET.
- **RET** — Retired, no benefits

### Movement Types
- **ING** — Program entry (terminology: "Ingreso", never "Alta"). Request submitted by FDN/ANPPER by the 5th business day of each month (numeral 9.1.1)
- **CAMBNIV** — Level change. Request by 5th business day of each month (numeral 9.1.2)
- **RET** — Program exit (terminology: "Retiro", never "Baja"). Request by 5th business day (numeral 9.1.5)

### Retirement Causes (numeral 9.1.5.2) — 8 causes
1. Failure to participate in required fundamental events without justification
2. Inadequate ethical/moral conduct
3. Less than 90% training attendance over 6 consecutive months
4. Disciplinary sanction (FDN, ANPPER, CSJDHD) or court conviction
5. Certified doping by ONAP
6. Provisional suspension or sanction for anti-doping violation
7. No qualifying sports results in the last 12 months
8. Submission of false documentation

### PAD Permanente (numeral 9.1.6, es_permanente=1)
- **Level O**: Olympic/Paralympic medal (gold/silver/bronze) → PAD II Level O, permanent
- **Level I**: World Games medal, or Gold at Senior World Championship, or multi-medalist (2+ medals) at senior multidisciplinary games → PAD II Level I, permanent
- Continued participation evaluated every 12 months from entry. No active participation → loses status and is retired from that level.

### Results & Expiration (Updated Mar 2026)
- Sports results valid for **12 full calendar months starting from the month following the event month**
- `pad.resultados_deportista.fecha_vencimiento` is calculated **automatically by the SQL Server backend** using `EOMONTH(fecha_fin, 11)`.
- Users ONLY input `fecha_fin`; no manual calculation is permitted per Directiva 003-2025.
- Minimum countries: 5 (conventional sports), 4 (para-sport Americas), 4 countries + 6 para-athletes (para-sport world level)
- Events must have Resolución Autoritativa from IPD

### Bank Accounts
- `pad.Deportistas.num_cuenta` is nullable — new athletes open Banco de la Nación account after entry
- Account opening is a **separate sub-process** that may not be complete by report deadline
- If no account at report time: Consolidado Económico is issued without account number
- GIRO Excel includes account numbers if they arrived during the process
- If still no account: **OPE (Orden de Pago Electrónica)** — payment by DNI number (or apoderado's DNI for minors)

## Operational Context

### Users
- **Ruben** — Data analyst at UF-PMD. System admin and primary data entry user. Reads physical/digital expedientes from SGD and enters all PAD movements. Works alongside Sports Specialists (Especialistas Deportivos) who evaluate PAD change expedientes and issue technical reports.
- **Claudia** — Handles SQL queries and stored procedures. Does not perform data entry.

### Monthly Workflow
Each month, expedientes arrive via SGD (Sistema de Gestión Documental) with requests for entries, retirements, and level changes. The Directiva is the permanent regulatory framework — movements occur continuously based on sports results and ongoing evaluations.

**Operation frequency (most to least common): CAMBNIV > ING > RET**

### Core Principle
Reports are **OUTPUT** of the system, never input. Generated from gold views. All data enters directly into SQL Server — eliminating Excel as the working tool is the central objective of this project.

### Main Data Entry Form: "Cambios PAD"
The primary interface mirrors Ruben's previous Excel workflow: reading from the SGD Informe and Expediente, then entering each movement. This form touches multiple tables in a single transaction:

1. User selects movement type (ING / CAMBNIV / RET)
2. Enter DNI → system searches pad.Deportistas
3. If athlete not found → modal to create (INSERT pad.Deportistas)
4. If minor → sub-modal for legal guardian (INSERT pad.Apoderados)
5. Select/create sports event (pad.Eventos_Resultado)
6. Enter athlete result (pad.resultados_deportista) — system calculates fecha_vencimiento automatically
7. Enter nro_informe and nro_expediente
8. On save: single transaction → pad.PAD + pad.cambios_PAD + pad.expedientes_cambio
9. System queries pad.montos_referencia to calculate monthly amount automatically

**The interface must reflect the business workflow, NOT the table structure.**

### Maintenance Forms (secondary)
- **Número de cuenta** — Update bank account number after Banco de la Nación process completes
- **OPE flag** — Mark payment as OPE when no account is available
- **Apoderados** — Manage guardians for minor athletes independently of the ING flow

### Reports Generated (8 total)
Produced by UFPMD (Ruben):
- Technical Consolidated PAD I, II, PNM, Combined (PDF, SUB-FO-25) — sections: Ingresos, Cambios, Retiros, full roster
- PAD Changes Register (PDF, SUB-FO-24) — all movements with Nro.Inf, Nro.Exp, Motivo

Produced by GDS (payment processing):
- Economic Consolidated PAD I, II, PNM (PDF) — Federation, Athlete, Account No., DNI, Guardian, Level, Amount

Internal (Tesorería):
- GIRO Excel PAD I/II/PNM — replaces minors with guardian data, includes OPE for athletes without bank accounts

## System Architecture (2 Modules)

### Module 1: Consulta PAD (Power BI + SharePoint)
- **Hosting:** Power BI Service — published public link shared with IPD specialists
- **Data:** OneDrive `dinadaf@ipd.gob.pe` → `/pad-data/*.json` (uploaded by API export)
- **Auth:** Power BI handles auth natively via IPD tenant; specialists access via public link
- **Users:** All IPD specialists (Especialistas Deportivos, jefaturas)
- **Content:** Dashboard, KPIs, Nómina PAD, charts — read-only
- **Availability:** Always online, no dependency on local PC
- **Built with:** Power BI Desktop + Power BI Service; project files in `docs/powerbi_*`

> **Architecture pivot (Mar 2026):** Originally planned as GitHub Pages + MSAL.js. Abandoned because IPD Azure AD tenant blocks admin consent for all external app permissions — even `Files.Read` requires admin consent. Power BI is native to the tenant and does not require external app consent.

### Module 2: Gestión PAD (local network, IPD only)
- **Hosting:** Node.js API on Ruben's PC, bound to 0.0.0.0:8080
- **Data:** SQL Server Express local (sensitive: DNI, bank accounts)
- **Auth:** API key (`x-api-key` header) + email whitelist (GESTION_PAD_USERS)
- **Users:** Ruben + Claudia (via local network IP)
- **Content:** Data entry (ING/CAMBNIV/RET), maintenance, PDF/Excel reports, montos module
- **Includes:** "Exportar datos" button → uploads JSON to OneDrive for Power BI
- **Access:** `http://localhost:8080` (Ruben) or `http://<IP>:8080` (Claudia via network)

### GitHub Pages (github.com/DINADAF/pmd-dinadaf)
- Retained as home/landing page only
- MSAL loginRedirect implemented (replaced loginPopup — eliminates browser popup permission prompt)
- Gestión PAD accessible only from local network (disabled on GitHub Pages)
- Dashboard/Consulta PAD section: legacy code retained but data now served by Power BI

### Data Flow
```
SQL Server → API POST /exportar → OneDrive dinadaf@ipd.gob.pe /pad-data/
                                        ↓
                              Power BI Desktop (Power Query)
                              reads via SharePoint Online connector
                                        ↓
                              Power BI Service → public link
                              accessible to all IPD specialists
```

### JSON Export Files (OneDrive /pad-data/)
| File | Structure | Contents |
|------|-----------|----------|
| `kpi.json` | Single object | activos_pad1/2/pnm, total_activos, total_les, monto_mensual_total, periodo_actual, exportado |
| `activos.json` | `{data:[...], exportado}` | deportista, cod_tipo_pad, cod_nivel, cod_estado_pad, es_permanente, nivel_desc, asociacion, monto_soles, tipo_giro |
| `movimientos_recientes.json` | `{data:[...], exportado}` | cod_tipo_movimiento, deportista, cod_tipo_pad, nivel_anterior, nivel_nuevo, nro_informe, periodo_vigencia, motivo (TOP 100) |
| `asociaciones.json` | Array | cod_asociacion, nombre, nombre_formal, tipo_organizacion, disciplina, activo |

### Auto-export
- Task Scheduler: "PMD - Exportar datos PAD" runs every Monday 08:00
- Calls POST /api/reportes/exportar via VBS script
- Sensitive data (DNI, bank accounts) excluded from all exports
- Power BI configured with scheduled refresh from OneDrive source

## Commands (PostgreSQL)
- Connect: `psql -h localhost -U pad_app -d pad_ipd` (will prompt for password)
- Backup: `pg_dump -h localhost -U pad_app -d pad_ipd > backup.sql`
- Restore: `psql -h localhost -U pad_app -d pad_ipd < backup.sql`
- SQL files: `sql/` directory in project root
- **Migration setup guide:** See `POSTGRESQL_SETUP.md` for complete PostgreSQL installation and migration steps

## Project Files
- `sql/` — All SQL scripts (DDL, DML, ETL, queries)
- `data/` — Source Excel files (reference only, gitignored)
- `docs/` — Directiva PDF/DOCX, DAMA-DMBOK, report samples (gitignored)
- `api/` — Node.js/Express local API (port 8080); connects to SQL Server Express
  - `server.js` — Entry point; binds 0.0.0.0; CORS: localhost + *.github.io + local network; serves web/ as static; Helmet CSP enabled (script-src-attr: unsafe-inline for onclick handlers)
  - `db.js` — mssql connection pool (dotenv config)
  - `middleware/auth.js` — API key validation via `x-api-key` header only (no ?_key= fallback)
  - `routes/deportistas.js` — Search/create athletes, update bank accounts (num_cuenta regex validated), get catalogs
  - `routes/movimientos.js` — Register ING/CAMBNIV/RET in single transaction; GET recientes; validarPeriodo on all periodo params
  - `routes/reportes.js` — KPI aggregates, active athletes list (supports `?tipo=PAD1|PAD2|PNM` and `?periodo=YYYYMM`; parameterized queries), export JSON to OneDrive
  - `routes/reportes-pdf.js` — PDF generation: consolidado-tecnico, consolidado-economico, cambios-pad (SUB-FO-24); validarParamsReporte on all endpoints
  - `routes/reportes-excel.js` — Excel generation: giro (with OPE/apoderado rules), consolidado-tecnico; validarParamsReporte on all endpoints
  - `routes/montos.js` — Montos de referencia module: GET /directivas, GET /uit, GET /?periodo&tipo, GET /preview, POST /generar; blocks periods < 202505; parameterized inserts
  - `sharepoint.js` — OneDrive upload via Microsoft Graph API (device code auth + refresh token); uploads to `dinadaf@ipd.gob.pe` personal OneDrive
  - `setup-sharepoint-auth.js` — One-time auth setup for OneDrive access (device code flow)
  - `.token-cache.json` — MSAL token cache (gitignored)
  - `.env` — DB + Azure AD credentials (gitignored; use .env.example as template)
- `web/` — GitHub Pages frontend + Gestión PAD SPA
  - `index.html` — Main SPA; MSAL.js optional loginRedirect (not popup); DM Sans + JetBrains Mono; sidebar #5C0A14
  - `css/style.css` — All styles (separated from monolithic index.html in Mar 2026)
  - `js/app.js` — All logic: `esc()` XSS helper, `getApiKey()` sessionStorage, `fetchDownload()` secure file download, montos module, MSAL loginRedirect
  - `data/` — JSON exports from API (gitignored; flows via OneDrive → Power BI)
- `sql/` — All SQL scripts; `22_valor_uit.sql` creates cat.valor_uit and loads UIT 2025+2026
- `data/TABLA_MAESTRA_CAMBIOS_PAD.xlsx` — Master template for historical PAD changes (gitignored)
- `docs/` — Directiva, DAMA-DMBOK, report samples (gitignored); also contains Power BI context files:
  - `powerbi_project_context.md` — JSON schemas, architecture, data pipeline for Power BI project
  - `powerbi_project_instructions.md` — Step-by-step guide for Claude Chat Power BI session
- `.github/workflows/pages.yml` — Deploys web/ to GitHub Pages on push to **main**
- `DESIGN_CONTEXT.md` — Design decisions, architecture, project history
- `CLAUDE.md` — This file (keep in English, update frequently)

## Conventions
- **Language for .md files:** English always
- **Response language:** Latin American Spanish, direct and concise
- All SQL in T-SQL dialect
- Table/column names: snake_case in Spanish
- Accented data preserved as-is (CI_AI collation handles accent-insensitive queries)
- Use Directiva terminology: Ingreso/Retiro/Cambio de nivel (never Alta/Baja)
- Cite specific Directiva numerals when referencing rules
- Validate structural changes with Ruben before implementing

## Current Status (March 2026)

### Database ✅
- ✅ 16 tables created and validated
- ✅ 8 gold views created and validated
- ✅ All catalogs loaded (ubigeo, niveles, asociaciones, montos 2013-2026)
- ✅ Collation changed to Latin1_General_CI_AI (DB + 71 columns; scripts: 05_collation_change.sql, 06_collation_columns.sql)
- ✅ Mass migration complete: 2,011 athletes + 4,532 PAD records + 70,389 ejecucion_mensual
- ✅ Cambios PAD migrated (Layer 1 algorithmic + Layer 2 Excel enrichment 2014-2026)
- ✅ ACT/RET states corrected: 273 ACT (253 PAD I + 7 PAD II + 13 PNM), 1,738 inactive
- ✅ Financial validation: S/ 101,138,080.40 total historical 2013-2026
- ✅ num_cuenta loaded from "matriz de cuentas 2020 a 2026_pad.xlsx"
- ✅ Apoderados loaded from "Relación de menores de edad"
- ✅ Deportistas.activo bug fixed: 273 active matches PAD.cod_estado_pad='ACT' count
- ✅ Nonclustered indexes on FK columns (19_indexes_constraints.sql): PAD, cambios_PAD, Deportistas, Apoderados, expedientes_cambio, ejecucion_mensual, resultados_deportista
- ✅ CHECK constraints: sexo, tipo_documento, monto_pagado, periodo, divisa, resultado
- ✅ gold.kpi_riesgo_pago_indebido fixed: derives retirement period from cambios_PAD when fecha_retiro is NULL (20_fix_kpi_riesgo_pago_indebido.sql)
- ✅ cat.Nivel.normativa corrected for all 37 levels: each level now stores the first directive period in which it appeared (P1-I..V since 2013; A/B split levels 2019-2022; P2-O/IV/V since 2022; PNM since 2018)
- ✅ montos_referencia.normativa filled for all 2,172 records (6 historical periods: Directiva 012013-052017, 062017-032018, 042018-032019, 042019-102022, 112022-042025, Dir. 003-2025-IPD/DINADAF) — script 21_normativa_niveles.sql
- ✅ cambios_PAD.nivel_anterior/nivel_nuevo logic corrected in API: ING stores nivel_nuevo only; RET stores nivel_anterior only; CAMBNIV stores both

### Local API (Gestión PAD) ✅
- ✅ Node.js/Express API bound to 0.0.0.0:8080 (accessible from local network)
- ✅ Serves web/index.html as static frontend (Gestión PAD via http://<IP>:8080)
- ✅ Routes: /api/deportistas, /api/movimientos, /api/reportes, /api/pdf, /api/excel
- ✅ Single-transaction POST /api/movimientos handles ING/CAMBNIV/RET
- ✅ POST /api/reportes/exportar — exports JSON to OneDrive (kpi, activos, movimientos, asociaciones)
- ✅ PDF reports (pdfkit): consolidado-tecnico, consolidado-economico, cambios-pad
- ✅ Excel reports (exceljs): giro (with OPE/apoderado rules), consolidado-tecnico
- ✅ CORS: localhost + *.github.io + 192.168.x.x + 10.x.x.x (local network)
- ✅ Security Hardened (Mar 2026): Helmet, Rate Limiting (300/15m), API Key auth (`x-api-key`) for all endpoints
- ✅ Input Validation: Period format checking (`YYYYMM`), numeric ID parsing, and explicit field SELECTs for sensitive data
- ✅ Structured Logging: Production stack traces hidden (only messages logged)
- ✅ Firewall: habilitar_red.bat creates inbound rule for port 8080 (domain/private)
- ✅ Task Scheduler: weekly export every Monday 08:00 (exportar_semanal.vbs)

### Web Platform (Gestión PAD SPA) ✅
- ✅ GitHub Pages: https://dinadaf.github.io/pmd-dinadaf/ (landing page + Gestión PAD when on local network)
- ✅ MSAL.js loginRedirect (Mar 2026): replaced loginPopup — eliminates browser popup permission prompt on every new device
- ✅ Home page: 3 module cards (Consulta PAD → Power BI link, Visitas, Gestión PAD)
- ✅ Gestión PAD: Monolithic `index.html` separated into `web/index.html` + `web/js/app.js` + `web/css/style.css`
- ✅ Gestión PAD: only accessible from local network (port 8080), disabled on GitHub Pages
- ✅ Modals Refactor: Native `overflow-y: auto / will-change: transform`; backdrop-filter removed
- ✅ Phase 5 Maintenance Module: modal + `GET /pendientes-regularizacion` for athletes missing event/dossier data
- ✅ GIRO fixes: defaults to last closed period; server-side tipo+periodo filtering
- ✅ Regularización modal: shows existing `num_cuenta` as readonly/green or editable
- ✅ Montos module (Mar 2026): directive period selector, tipo filter, conditional %UIT column, "Generar montos" modal with UIT-based preview; blocks historical periods (< 202505)
- ✅ Security hardening (Mar 2026): `esc()` XSS helper, `getApiKey()` sessionStorage, `fetchDownload()` replaces window.open+?_key=
- ✅ CSP: Helmet enabled with script-src-attr unsafe-inline (inline onclick handlers); upgrade-insecure-requests removed (HTTP local server)
- ✅ GitHub Pages workflow: deploys from `main` branch (not master); local branch `master` tracks `origin/main`

### Local API Security (Mar 2026) ✅
- ✅ C1+C2: API key via `x-api-key` header only; no ?_key= URL param; sessionStorage in frontend
- ✅ C3: Parameterized INSERT in montos.js (individual per-row inserts, no string concatenation)
- ✅ C4: Parameterized queries in reportes.js (periodo/tipo filters use @param)
- ✅ H1+H2+H4: `esc()` helper applied to all innerHTML interpolations; toast/showAlert/showConfirm sanitized
- ✅ H3: Helmet CSP enabled (script-src: self + jsdelivr; connect-src: Graph API + MSAL; script-src-attr: unsafe-inline)
- ✅ H5: auth.js — removed `req.query._key` fallback
- ✅ H6: validarParamsReporte() on all PDF and Excel report endpoints
- ✅ M1: num_cuenta regex validation `/^[A-Za-z0-9\-]{1,20}$/` in deportistas.js
- ✅ M2: validarPeriodo() on GET /periodo/:periodo, POST /periodos/:periodo/cerrar|reabrir

### OneDrive / Power BI Integration ✅
- ✅ Azure AD app: "PAD IPD Dashboard", Client ID 4ebfc360-a6b5-4330-8a73-682768a95b64
- ✅ Tenant: IPD PERU S.A.C. (IPD.GOB.PE), ID: 19ccc9d6-ff9b-4dc4-914e-f195773cb1a2
- ✅ Server-side upload: device code flow + refresh token → dinadaf@ipd.gob.pe personal OneDrive /pad-data/
- ✅ Drive ID: b!T9pa18s7Q0ucS14QcR9bATc7WiT-ztVPqEwNfjLw_AOIF3HTHWRESYYKCB6vvSsO (dinadaf@ipd.gob.pe)
- ✅ Power BI Desktop: connected via SharePoint Online (carpeta) → `https://ipdperu-my.sharepoint.com/personal/dinadaf_ipd_gob_pe`
- ✅ Anonymous folder share created (Anyone with link, view only) — for future fallback if needed
- ⏳ Power BI Service: publish + public link + scheduled refresh (in progress — Claude Chat project)
- ❌ Graph API browser access: IPD tenant blocks all external app consent (even Files.Read requires admin approval) — reason for pivot to Power BI

### Pending (Post-Migration)
- ⏸️ Data migration: Populate PostgreSQL with 2,011 athletes + 70,389 historical ejecución records from SQL Server backup
- ⏸️ nivel_anterior/nivel_nuevo backfill: ING/RET records prior to Mar 2026 have NULL fields — need UPDATE from pad.PAD.cod_nivel
- ⏸️ TABLA_MAESTRA_CAMBIOS_PAD.xlsx: awaiting historical data population for batch ETL
- ⏸️ Azure AD app rename: "PAD IPD Dashboard" → "PMD DINADAF"
- ⏸️ Stored procedures: sp_registrar_ingreso, sp_registrar_retiro, sp_registrar_cambniv
- ⏸️ LES/LSS states: 0 records currently (system ready when needed)
- ⏸️ Cambios PAD 2013: source file not found
- ⏸️ JSON export enrichment: add `sexo`, `fecha_ingreso`, region for Power BI demographics
- ⏸️ Power BI: build dashboard, publish, configure scheduled refresh, share public link

### Future
- ⏸️ FUTURE: Clickable ruta_documento from Power BI dashboard
- ⏸️ FUTURE: Power Automate flows for area team notifications
- ⏸️ FUTURE: Insurance report — Excel with ACT+LES+LSS athletes entitled to health coverage
- ⏸️ FUTURE: Migration to Azure SQL when multi-user access needed

## Migration Notes
- Authoritative source: PAD - BD.xlsx (sheet: matriz_pad) — 2,011 athletes, 70,389 executions
- Foreign athletes: 65 with cod_ubigeo=NULL (ubigeo '000000' → NULL by design)
- BREAKING and DEPORTES DE INVIERNO: no own association → mapped to parent federation cod_asociacion
- NATACIÓN renamed to DEPORTES ACUÁTICOS (cod=18)
- FEDEPOL → POLICÍAS Y BOMBEROS
- ETL scripts: sql/migracion_etl.py, sql/migracion_cambios_pad.py
