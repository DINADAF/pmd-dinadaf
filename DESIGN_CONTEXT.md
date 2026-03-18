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
- 15 tables in schemas cat/pad, 8 views in gold
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
9. System calculates fecha_vencimiento (event date + 12 months per Directiva)

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

## Security & Access (Phase 2)

Discussed but NOT yet implemented:

**Authentication:** Via SharePoint/Azure AD — users already exist in Microsoft 365 ecosystem. No need to replicate user/password tables.

**Authorization tables (future):**
- `cat.roles` — ADM (admin), ESP (specialist PMD), GDS (subsidy management), CON (read-only)
- `pad.usuarios_sistema` — maps SharePoint identity to PAD role

**Data sensitivity:** Sensitive data (DNI, bank accounts, personal info) stays in SQL Server local. Only aggregated data exported to SharePoint/OneDrive.

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

## Pending Ideas & Future Phases

1. **Stored procedures** for common operations (sp_registrar_ingreso, sp_registrar_retiro, sp_generar_consolidado)
2. **Automated PDF generation** from gold views
3. **Export pipeline** SQL Server → JSON/CSV → SharePoint/OneDrive
4. **Insurance report** — Excel with athletes entitled to health insurance (states ACT, LES, LSS)
5. **Juntas Directivas module** — tables for pad.Junta_Directiva and pad.Miembros_JD to track board periods and members
6. **Dashboard web** — JavaScript + GitHub Pages reading from SharePoint exports
7. **Migration to Azure SQL** — when system is mature and multi-user access is needed
8. **OCR/AI integration** — Claudia's idea to extract data from PDF informes. Ruben prefers manual entry with PDF stored as reference. Possible future complement, not replacement.
