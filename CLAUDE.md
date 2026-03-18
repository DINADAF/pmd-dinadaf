# PAD Data System — DINADAF/IPD

> **Read DESIGN_CONTEXT.md in the project root** for architectural decisions, design context, and the rationale behind every decision.

Sports subsidy program (PAD) database for Peru's Instituto Peruano del Deporte (IPD). Transforms Excel-based data management into a relational SQL Server system with formal data governance (DAMA-DMBOK framework).

## Stack
- Database: SQL Server 2025 Express (instance: `localhost\SQLEXPRESS`)
- Language: T-SQL exclusively
- DB Name: `PAD_IPD`
- IDE: SSMS 22 (primary), VS Code + MSSQL extension (secondary)
- Collation: `Latin1_General_CI_AI` (accent-insensitive queries, accented data preserved)
- Reference framework: DAMA-DMBOK 2nd Edition

## Database Architecture

Three schemas following DAMA data taxonomy:
- `cat` — Reference/catalog data (slow-changing)
- `pad` — Master + transactional data (operational)
- `gold` — Views for reports and dashboards

### Tables (15 total)

**cat schema (5 tables, fully loaded):**
- `cat.tipo_PAD` (3 records: PAD1, PAD2, PNM)
- `cat.estado_PAD` (4 records: ACT, LES, LSS, RET)
- `cat.tipo_movimiento` (3 records: ING, RET, CAMBNIV)
- `cat.Nivel` (30 records: 14 active + 16 historical; PK format: P1-III, P2-O, PNM-TOP)
- `cat.ubigeo` (1,891 INEI district codes)

**pad schema (10 tables):**
- `pad.Asociacion_Deportiva` (72 records — federations, associations, COP)
- `pad.Deportistas` (master data: num_documento, tipo_documento[DNI/CE/PAS/OTR], ap_paterno, ap_materno, nombres, sexo, fecha_nac, cod_asociacion FK, cod_ubigeo FK, num_cuenta, correo, telefono, agrupacion, activo, fecha_registro)
- `pad.Apoderados` (legal guardians for minors, FK to Deportistas)
- `pad.PAD` (benefit assignment: cod_deportista FK, cod_tipo_pad FK, cod_nivel FK, cod_estado_pad FK, es_permanente BIT, fecha_ingreso, fecha_retiro)
- `pad.cambios_PAD` (movement log: nro_informe, periodo_vigencia, motivo, detalle_evento, nivel_anterior/nuevo, fecha_limite, ruta_documento, cod_resultado FK)
- `pad.expedientes_cambio` (multiple docs per change; PK: cod_cambio+nro_expediente; tipo_documento: INFORME/EXPEDIENTE/OFICIO/RESOLUCION/OTRO)
- `pad.montos_referencia` (2,172 records: fixed amounts by nivel+periodo; divisa S/D, tipo_cambio, monto_soles; spans 201301-202612)
- `pad.ejecucion_mensual` (fact table: athlete paid X in month Y; UNIQUE on cod_pad+periodo)
- `pad.Eventos_Resultado` (sports events: name, type, dates, city, country, resolution number)
- `pad.resultados_deportista` (individual results per athlete per event: modalidad, categoria, resultado[ORO/PLATA/BRONCE/PARTICIPACION/OTRO], paises_participantes, fecha_vencimiento)

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

### Results & Expiration
- Sports results valid for **12 months from the event date** (not from PAD entry date)
- `pad.resultados_deportista.fecha_vencimiento` = event_end_date + 12 months
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
- **Ruben** — System admin and primary data entry user. Reads physical/digital expedientes from SGD and enters all PAD movements.
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

## System Architecture (3 Layers)

- **Layer 1 (Operational):** SQL Server Express local — Ruben's work PC only. Contains sensitive data (DNI, bank accounts). All data entry happens here.
- **Layer 2 (Distribution):** SharePoint/OneDrive — aggregated/non-sensitive reports (PDF, CSV/JSON). Available 24/7 regardless of PC status.
- **Layer 3 (Visualization):** Power BI + GitHub Pages — dashboards reading from SharePoint exports. Always available.

**Key constraint:** Data entry forms require access to local SQL Server → they cannot be hosted externally without a local API layer running on Ruben's PC.

## Commands
- Connect: `sqlcmd -S "localhost,1433" -U sa -P "<password>" -d PAD_IPD` (TCP; named pipe fails from bash)
- Backup: via SSMS or `BACKUP DATABASE PAD_IPD TO DISK = '<path>'`
- SQL files: `sql/` directory in project root

## Project Files
- `sql/` — All SQL scripts (DDL, DML, ETL, queries)
- `data/` — Source Excel files (reference only)
- `docs/` — Directiva PDF/DOCX, DAMA-DMBOK, report samples
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
- ✅ 15 tables created and validated
- ✅ 8 gold views created and validated
- ✅ All catalogs loaded (ubigeo, niveles, asociaciones, montos 2013-2026)
- ✅ Collation changed to Latin1_General_CI_AI (DB + 71 columns; scripts: 05_collation_change.sql, 06_collation_columns.sql)
- ✅ Mass migration complete: 2,011 athletes + 4,532 PAD records + 70,389 ejecucion_mensual
- ✅ Cambios PAD migrated (Layer 1 algorithmic + Layer 2 Excel enrichment 2014-2026)
- ✅ ACT/RET states corrected: 273 ACT (253 PAD I + 7 PAD II + 13 PNM), 1,738 inactive
- ✅ Financial validation: S/ 101,138,080.40 total historical 2013-2026
- ✅ num_cuenta loaded from "matriz de cuentas 2020 a 2026_pad.xlsx"
- ✅ Apoderados loaded from "Relación de menores de edad"
- ⚠️ BUG: Deportistas.activo shows 2,011 active instead of 273. Fix: UPDATE needs explicit alias (UPDATE d FROM pad.Deportistas d WHERE EXISTS (...p.cod_deportista = d.cod_deportista...))
- ⏸️ NEXT: Stored procedures (sp_registrar_ingreso, sp_registrar_retiro, sp_registrar_cambniv)
- ⏸️ NEXT: "Cambios PAD" data entry form — web interface (architecture TBD: local API + GitHub Pages vs. full local)
- ⏸️ NEXT: GitHub repository setup + SharePoint/OneDrive integration for report distribution
- ⏸️ PENDING: LES/LSS states — 0 records currently (expected if no active injured athletes)
- ⏸️ PENDING: Cambios PAD 2013 — source file not found
- ⏸️ FUTURE: Automated PDF report generation from gold views
- ⏸️ FUTURE: Export pipeline SQL Server → JSON/CSV → SharePoint/OneDrive
- ⏸️ FUTURE: Web dashboard (Power BI + possible GitHub Pages)
- ⏸️ FUTURE: Clickable ruta_documento from dashboard

## Migration Notes
- Authoritative source: PAD - BD.xlsx (sheet: matriz_pad) — 2,011 athletes, 70,389 executions
- Foreign athletes: 65 with cod_ubigeo=NULL (ubigeo '000000' → NULL by design)
- BREAKING and DEPORTES DE INVIERNO: no own association → mapped to parent federation cod_asociacion
- NATACIÓN renamed to DEPORTES ACUÁTICOS (cod=18)
- FEDEPOL → POLICÍAS Y BOMBEROS
- ETL scripts: sql/migracion_etl.py, sql/migracion_cambios_pad.py
