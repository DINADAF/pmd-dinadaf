# PAD_IPD Project — Setup Guide

## Prerequisites
- SQL Server 2025 Express installed (instance: `localhost\SQLEXPRESS`)
- SSMS 22 installed
- Mixed authentication enabled (sa user configured)
- Claude Code installed (`npm install -g @anthropic-ai/claude-code`)

## Project Structure
```
PAD_IPD/
├── CLAUDE.md              # Claude Code context file
├── README.md              # This file
├── sql/
│   ├── 01_DDL_estructura.sql          # Complete DB structure (tables + views)
│   ├── 02_DML_catalogos.sql           # Catalog data inserts
│   ├── 03_DML_asociaciones.sql        # 72 sports organizations
│   ├── 04_queries_verificacion.sql    # Diagnostic and verification queries
│   ├── 05_collation_change.sql        # CI_AI collation migration
│   ├── insert_ubigeo.sql              # 1,891 INEI district codes
│   └── insert_montos_referencia.sql   # 2,172 historical amounts (2013-2026)
├── data/                  # Source Excel files
│   ├── PAD__BD.xlsx
│   ├── reporte_deportistas_pad.xlsx
│   ├── Cambios_PAD__2025.xlsx
│   ├── Cambios_PAD__2026.xlsx
│   ├── Juntas_Directivas__20252028_17.xlsx
│   ├── GIRO_PAD_I.xlsx
│   ├── PAD_I__Tecnico_2026.xlsx
│   └── PAD_II__Tecnico_2026.xlsx
└── docs/                  # Reference documents
    ├── Directiva_003-2025-IPD-DINADAF.pdf
    ├── DAMA-DMBOK_2nd_Edition.pdf
    ├── Consolidado_Tecnico_*.pdf
    ├── Consolidado_economico_*.pdf
    ├── Cambios_PAD_Febrero_2026F.pdf
    └── G1_Matrices_Diplomado/
```

## Quick Start
1. Open the project folder in Claude Code: `cd PAD_IPD && claude`
2. Claude reads CLAUDE.md automatically
3. Connect to DB: `sqlcmd -S localhost\SQLEXPRESS -d PAD_IPD -E`

## Database Connection
- Server: `localhost\SQLEXPRESS`
- Database: `PAD_IPD`
- Auth: Windows (recommended) or SQL Auth (sa)

## Environment Variables (`api/.env`)
The local API requires an `.env` file in the `api/` folder (never commiteed). Base variables required:
```ini
DB_SERVER=localhost
DB_PORT=1433
DB_NAME=PAD_IPD
DB_USER=sa
DB_PASSWORD=<password>

API_PORT=8080
API_KEYS=<32_char_hex_random_string>  # Required for API authentication
```
