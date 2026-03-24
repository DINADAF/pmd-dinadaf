# PAD Project — Design Decisions & Architecture Context

This document captures all design discussions, architectural decisions, and pending ideas from the Claude.ai chat sessions (Oct 2025 – Mar 2026). It serves as context for Claude Code to understand the WHY behind every decision, not just the WHAT.

## Origin Story: Report-First, Then Backwards

The project started from the reporting problem: Ruben generates monthly PDF reports (technical + economic consolidated) for PAD beneficiaries, but the process is inverted — the report is created first (manually in Excel), and then the data is copied backwards to update the base Excel file. This means the report drives the data, instead of data driving the report.

**Core principle established:** "The report must be a byproduct of the data, not the other way around."

The entire system was designed backwards from the reports: what data do the reports need → what tables store that data → what processes feed those tables → what interface captures the input.

## Complete Business Flow

```
Organización Deportiva sends Expediente (via SGD)
    │
    ▼
Specialist (Ruben/UFPMD) evaluates per Directiva rules
    │
    ├── New athlete? → Create in pad.Deportistas
    ├── Existing athlete, level change? → Update pad.PAD + log in cambios_PAD
    └── Athlete no longer qualifies? → Retire via cambios_PAD
    │
    ▼
Register Movement in pad.cambios_PAD (ING/RET/CAMBNIV)
    ├── Link to pad.Eventos_Resultado (sports event justification)
    ├── Link to pad.expedientes_cambio (document traceability)
    └── Link to pad.resultados_deportista (medal/result details)
    │
    ▼
System auto-generates from data:
    ├── Consolidado Técnico PDF (SUB-FO-25) — 4 reports: PAD I, PAD II, PNM, combined
    ├── Registro de Cambios PAD PDF (SUB-FO-24) — 1 report per month
    ├── Consolidado Económico PDF — 3 reports: PAD I, PAD II, PNM (produced by GDS)
    └── Excel GIRO — 3 files: internal payment file for Tesorería
    │
    ▼
All reports travel together with a Memorando to GDS for payment processing
    │
    ▼
GDS processes payment → pad.ejecucion_mensual records the fact
    │
    ▼
Dashboard/Power BI reads from gold views → available 24/7
```

## Architecture: Three Layers

### Layer 1: Operational Database (SQL Server Express, local)
- Where Ruben and Claudia work daily
- 16 tables in schemas cat/pad, 8 views in gold
- Only accessible from Ruben's work PC
- Contains sensitive data (DNI, bank accounts)

### Layer 2: Report Distribution (SharePoint/OneDrive)
- Stores exported reports (PDF, CSV/JSON summaries)
- Available 24/7 regardless of PC status
- Only aggregated/non-sensitive data
- Area staff accesses reports here

### Layer 3: Dashboard (Power BI + possible GitHub Pages)
- Power BI connects to SQL Server for dynamic dashboards (requires PC on)
- Alternative: static dashboard on GitHub Pages reading from SharePoint exports (always available)
- Explored JavaScript-based interactive dashboard as complement/alternative to Power BI

**Key insight:** SQL Server local for operation, SharePoint/OneDrive + GitHub Pages for distribution. They integrate, not replace each other. The PC only needs to be on during the operational moment (register changes, run export). Once files are in SharePoint, dashboards work independently.

## Interface Design Philosophy

**Separation of concerns:** The table structure defines HOW data is stored and related, NOT how it's entered. These are independent layers (DAMA Ch5). A single user action (e.g., registering a new ING) may touch 5+ tables in one transaction.

**Example flow for registering an INGRESO:**
1. User selects "Nuevo Cambio PAD" → type: INGRESO
2. System asks for DNI → searches pad.Deportistas
3. If athlete doesn't exist → opens modal to create (INSERT pad.Deportistas)
4. If minor → opens sub-modal for apoderado (INSERT pad.Apoderados)
5. User selects/creates the sports event (pad.Eventos_Resultado)
6. User enters result details (pad.resultados_deportista)
7. User enters informe/expediente numbers
8. On save: single transaction inserts into pad.PAD + pad.cambios_PAD + pad.expedientes_cambio
9. **Architectural Change (Mar 2026)**: System calculates `fecha_vencimiento` strictly on the SQL Database side natively applying `EOMONTH(fecha_fin, 11)` ensuring accurate complete calendar-month durations without UI drift.

**The interface should NOT mirror the table structure.** It should mirror the business workflow.

## Reports Generated (8 total)

### From UFPMD (Ruben):
1. **Consolidado Técnico PAD I** (PDF, SUB-FO-25) — Sections: Ingresos, Cambios, Retiros, full roster
2. **Consolidado Técnico PAD II** (PDF, SUB-FO-25) — Same structure
3. **Consolidado Técnico PNM** (PDF, SUB-FO-25) — Same structure
4. **Consolidado Técnico Combinado** (PDF) — All three combined
5. **Registro de Cambios PAD** (PDF, SUB-FO-24) — All movements with Nro.Inf, Nro.Exp, Motivo

### From GDS (payment processing):
6. **Consolidado Económico PAD I** (PDF) — Federación, Deportista, Nro.Cuenta, DNI, Apoderado, Nivel, Monto
7. **Consolidado Económico PAD II** (PDF) — Same structure
8. **Consolidado Económico PNM** (PDF) — Deportista, Nivel, DNI, Región, Nro.Cuenta, Monto (no federation)

### Internal (for Tesorería):
9. **Excel GIRO PAD I/II/PNM** — Payment summary replacing minors with their apoderados, includes OPE for athletes without bank accounts

## Special Business Cases

### Bank Account Opening Process
New PAD athletes need a Banco de la Nación account. Process: fill format → internal Memorando to Tesorería → Oficio to BN → wait for response. Sometimes the response doesn't arrive before report deadline, so the Consolidado Económico goes out WITHOUT the account number. The GIRO Excel compensates by adding late-arriving accounts. If still no account, payment uses OPE (electronic payment order to DNI, athlete withdraws at branch).

**Implication:** `pad.Deportistas.num_cuenta` is nullable. The system should flag athletes with pending account opening.

### Injury Flow (Directiva 9.1.4.1.6)
ACT → LES (6 months with full benefits) → LSS (6 more months, insurance only) → RET
- `pad.cambios_PAD.fecha_limite` enables automated alerts for recovery deadlines
- System should calculate and display: "Athlete X has 15 days left in LES period"

### PAD Permanente (Directiva 9.1.6)
- Special condition within PAD II, levels O and I only
- For Olympic/Paralympic medalists or multi-world medalists
- Marked with `pad.PAD.es_permanente = 1`
- Has its own retention rules

### Result Expiration (12 months)
- Sports results that justify PAD entry expire 12 months after the EVENT date (not the PAD entry date)
- If event was January and entry processed in March, athlete effectively has 10 months
- `pad.resultados_deportista.fecha_vencimiento` = event end date + 12 months
- Gold views should show approaching expirations

## Level Normativa Architecture (Mar 2026)

### Problem
`cat.Nivel.normativa` was initially set to the current directive (Dir. 003-2025) for all active levels, including P1-I which has existed since 2013. This was misleading — it implied the level was created by the latest directive.

### Decision
Two-layer normativa architecture:
1. **`cat.Nivel.normativa`** — stores the FIRST directive period in which each level appeared (historical origin). Read-only reference for understanding when a level was introduced.
2. **`pad.montos_referencia.normativa`** — the authoritative source for nivel×period×directive relationships. Every row maps a (cod_nivel, periodo_desde) to a specific directive label. This is where the "currently active under which directive" question is answered.

### Level History (6 directive periods)
| Period range | Directive label |
|---|---|
| 201301–201705 | Directiva 012013-052017 |
| 201706–201803 | Directiva 062017-032018 |
| 201804–201903 | Directiva 042018-032019 |
| 201904–202210 | Directiva 042019-102022 |
| 202211–202504 | Directiva 112022-042025 |
| 202505+ | Dir. 003-2025-IPD/DINADAF |

### Level Groups
- **P1-I..V, P2-I..III** (8): existed since 2013 (Directiva 012013-052017)
- **P2-IO** (1): 201301–201903 only (retired in Directiva 042019)
- **P1-IA/IB, P1-IIA/IIB, P1-IIIA/IIIB, P1-IVA/IVB, P1-IO, P2-IA/IB, P2-IIA/IIB, P2-IIIA/IIIB, P2-IOA, P2-IVA** (16): A/B split levels, 201904–202210 only
- **P2-O, P2-IV, P2-V** (3): introduced in Directiva 112022
- **PNM-TOP, PNM-R01, PNM-R02** (3): active since 2018 (Directiva 062017)
- **PNM-I..V** (5): historical PNM levels (2019–2022 era)
- **Total: 37 records (14 active + 23 historical)**

### Implementation
Script `sql/21_normativa_niveles.sql` executed in March 2026:
- Updated all 2,172 `montos_referencia.normativa` values (were NULL)
- Corrected all 37 `cat.Nivel.normativa` values

## Security & Access

### Security Audit (March 2026) — Comprehensive hardening applied
Full audit conducted covering OWASP Top 10 in context. All CRITICAL and HIGH vulnerabilities resolved:

**CRITICAL — resolved:**
- C1: API key was hardcoded in `app.js` (`LOCAL_API_KEY` constant) → replaced with `getApiKey()` using sessionStorage + prompt
- C2: API key leaked in URLs via `?_key=` query param (visible in logs, browser history) → `fetchDownload()` helper uses headers only; `auth.js` no longer accepts `req.query._key`
- C3: SQL injection in `montos.js` `POST /generar` via string-concatenated INSERT → replaced with parameterized per-row inserts
- C4: SQL injection in `reportes.js` active athletes query via string-interpolated WHERE clauses → replaced with `@periodo`/`@tipo` parameterized queries

**HIGH — resolved:**
- H1+H2+H4: XSS via `innerHTML` interpolation throughout `app.js` → `esc()` helper applied globally to all server-data rendering; `toast()`/`showAlert()` sanitized; `showConfirm()` uses `textContent`
- H3: Helmet CSP was disabled (`contentSecurityPolicy: false`) → enabled with `script-src: 'self' + jsdelivr`, `connect-src: Graph API + MSAL`, `script-src-attr: 'unsafe-inline'` (required for onclick handlers; full refactor deferred)
- H5: `auth.js` accepted `req.query._key` as fallback → removed, header-only
- H6: `reportes-excel.js` and `reportes-pdf.js` lacked input validation → `validarParamsReporte()` added to all 6 report endpoints

**MEDIUM — resolved:**
- M1: `num_cuenta` PATCH endpoint had no format validation → regex `/^[A-Za-z0-9\-]{1,20}$/`
- M2: `movimientos.js` periodo route params unvalidated → `validarPeriodo()` on GET /periodo/:periodo, POST /cerrar, POST /reabrir

**HTTPS decision:** Local network HTTPS (TLS) was evaluated. mkcert (local CA) was the only viable option but requires installing the CA on every client machine — not acceptable since Claudia would need setup. Let's Encrypt requires a public domain. Decision: remain on HTTP for internal network with current API key + CORS + Helmet hardening.

Discussed but NOT yet implemented (Future):
- **User Traceability:** Replace static API Key with Microsoft Entra ID JWT tokens for granular per-user audit trail
- **Least-privilege DB user:** Replace SQL Server `sa` with dedicated read/write user

**Authorization tables (future):**
- `cat.roles` — ADM (admin), ESP (specialist PMD), GDS (subsidy management), CON (read-only)
- `pad.usuarios_sistema` — maps SharePoint identity to PAD role

## Methodological Framework

### DAMA-DMBOK 2nd Edition
All decisions grounded in DAMA. Key chapters applied:
- Ch3 Data Governance — overall framework
- Ch4 Data Architecture — schema separation cat/pad/gold
- Ch5 Data Modeling and Design — relational model, separation of logical model from UI
- Ch10 Reference and Master Data — cat = Reference Data, pad = Master + Transaction Data (Chisholm taxonomy)
- Ch11 Data Warehousing and BI — gold layer, fact tables (ejecucion_mensual)
- Ch13 Data Quality — validation rules, constraints

### Hefesto Methodology
For Data Warehouse design: requirements analysis → OLTP source analysis → conceptual DW model → logical DW model → ETL integration. Applied when designing gold views and fact tables.

### Academic Foundation
Diploma project in Data Governance on GCP (BigQuery + GCS) with Bronze/Silver/Gold architecture using synthetic PAD data. Deliverables: Data Dictionary, Business Glossary, Traceability Matrix, Quality Matrix. This academic project is the theoretical foundation for the production implementation.

## Montos de Referencia Module (March 2026)

### Design decisions
- **New table `cat.valor_uit`**: UIT is an annual government value (DS each December), not a per-level value. Storing it in a separate table avoids redundancy across 14 levels × 12 months. PK is `anio SMALLINT`.
- **Historical data locked**: Periods before 202505 are read-only. The `POST /generar` endpoint blocks inserts for `periodo < '202505'` to prevent accidental modification of historical records.
- **Directive-based selector**: UX uses directive period labels (e.g., "Dir. 003-2025-IPD/DINADAF") instead of month/year pickers — mirrors how specialists think about normativa.
- **Historical levels visible**: Removed `WHERE n.activo = 1` filter from the montos query. The JOIN with `montos_referencia` naturally filters to levels that existed in each period — historical A/B split levels (P1-IA, P1-IB, etc.) appear correctly when viewing their directive period.
- **Conditional %UIT column**: Only shown for periods with UIT data (Dir. 003-2025-IPD/DINADAF). Hidden for pre-2025 periods where UIT percentages weren't the calculation basis.
- **UIT sub-grouping**: Only Dir. 003-2025-IPD/DINADAF is split by UIT year in the dropdown. Previous directives show as single entries regardless of year span.

## Consulta PAD Architecture Pivot (March 2026)

### Problem
GitHub Pages + MSAL.js was the original plan for the specialist-facing dashboard. Three blockers encountered:
1. IPD Azure AD tenant has a policy requiring admin consent for ALL external app permissions — even `Files.Read` (delegated) requires admin approval. No Global Admin available to grant consent.
2. `Sites.Read.All` was added to try reading SharePoint drives → also blocked by same policy.
3. Anonymous OneDrive sharing link + Graph API shares endpoint: Graph API always requires authentication even for "Anyone with the link" shares. Returns 401.

### Decision: Power BI as Module 1
Power BI is native to the Microsoft 365 / Azure AD tenant. It connects to OneDrive/SharePoint without requiring external app consent. The pipeline:
1. API exports JSON to `dinadaf@ipd.gob.pe` OneDrive via device code flow (server-side, already working)
2. Power BI Desktop connects via SharePoint Online (carpeta) connector — uses IPD org credentials natively
3. Power BI Service publishes dashboard with a public link
4. Specialists access via that link — no additional auth setup needed

### What stays on GitHub Pages
GitHub Pages is retained as the hosting layer for Gestión PAD (the SPA served by the Node.js API). It is NOT retired — just repurposed. The "Consulta PAD" section on GitHub Pages becomes a redirect/link to the Power BI report. MSAL loginRedirect remains for potential future use.

### MSAL loginPopup → loginRedirect
Switched because `loginPopup` causes the browser to show a "site wants to open a popup" permission dialog on every new device/profile. `loginRedirect` navigates the full page to Microsoft login and back — no popup permission needed, works everywhere transparently. (Note: `loginRedirect` was previously abandoned due to `invalid_request` error; that error was from a missing redirect URI in the Azure AD app registration — fixed by adding the GitHub Pages URL as SPA redirect URI.)

## Pending Ideas & Future Phases

1. **Power BI dashboard**: build visuals, publish to Power BI Service, share public link, configure weekly refresh from OneDrive (in progress — separate Claude Chat project)
2. **JSON export enrichment**: add `sexo`, `fecha_ingreso`, region to `activos.json` for Power BI demographic charts
3. **nivel_anterior/nivel_nuevo historical backfill** — existing cambios_PAD ING/RET records prior to Mar 2026 have these fields NULL; need one-time UPDATE from pad.PAD.cod_nivel
4. **TABLA_MAESTRA_CAMBIOS_PAD.xlsx** — awaiting historical data population for batch ETL load
5. **Stored procedures** for common operations (sp_registrar_ingreso, sp_registrar_retiro)
6. **Insurance report** — Excel with ACT+LES+LSS athletes entitled to health insurance
7. **Juntas Directivas module** — pad.Junta_Directiva + pad.Miembros_JD
8. **Migration to Azure SQL** — when multi-user access needed
9. **OCR/AI integration** — Claudia's idea; Ruben prefers manual entry. Future complement only.
