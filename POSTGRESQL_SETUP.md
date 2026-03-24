# PostgreSQL Setup Guide — PAD IPD Migration

**Date:** March 2026
**Purpose:** Complete setup guide for PostgreSQL migration from SQL Server Express
**Target Version:** PostgreSQL 12+

---

## 1. Installation

### Windows (Recommended: PostgreSQL 14 LTS or 15)

1. **Download PostgreSQL installer:**
   - Visit: https://www.postgresql.org/download/windows/
   - Download latest stable version (v14, v15, or v16)

2. **Run installer:**
   - Launch `postgresql-XX-x64-setup.exe`
   - **Important:** When prompted for a password for the `postgres` superuser, choose a secure password and note it

3. **Install components:**
   - Check: PostgreSQL Server, pgAdmin 4, Command Line Tools
   - Port: Accept default **5432**
   - Locale: Select your locale (typically `en_US.UTF-8` or equivalent)

4. **Complete installation:**
   - Installation complete when pgAdmin 4 launches in browser

### Linux (Ubuntu/Debian)

```bash
sudo apt update
sudo apt install postgresql postgresql-contrib postgresql-12-pgadmin4
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

### macOS

```bash
brew install postgresql@15
brew services start postgresql@15
```

---

## 2. Database & Role Setup

### Connect as superuser (first time)

**Windows (via pgAdmin 4 or Command Prompt):**
```bash
psql -U postgres
```
When prompted, enter the password you created during installation.

**Linux/macOS:**
```bash
sudo -u postgres psql
```

### Create dedicated role (non-superuser, least-privilege)

Once connected as `postgres`, execute:

```sql
-- Create role pad_app with password authentication
CREATE ROLE pad_app WITH PASSWORD 'your_secure_password_here' LOGIN;

-- Grant minimal permissions
ALTER ROLE pad_app CREATEDB;  -- Allow creating databases for PAD_IPD

-- Create database
CREATE DATABASE pad_ipd OWNER pad_app;

-- Grant schema permissions (executed after DDL)
-- GRANT ALL ON SCHEMA public TO pad_app;
-- GRANT ALL ON ALL TABLES IN SCHEMA public TO pad_app;
-- GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO pad_app;

-- Exit
\q
```

### Verify connection as pad_app user

```bash
psql -h localhost -U pad_app -d pad_ipd
# Password: your_secure_password_here
```

Should connect successfully to the `pad_ipd` database.

---

## 3. Create Extensions

Before running DDL scripts, create required PostgreSQL extensions:

```sql
-- Connect as pad_app (or postgres with privilege to create in pad_ipd)
psql -h localhost -U pad_app -d pad_ipd

-- Create unaccent extension for accent-insensitive searches
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Verify
SELECT * FROM pg_extension WHERE extname = 'unaccent';
```

---

## 4. Load DDL Scripts

Run SQL scripts in this order to create database structure:

### Execute DDL in psql

```bash
psql -h localhost -U pad_app -d pad_ipd -f sql/01_DDL_postgresql.sql
psql -h localhost -U pad_app -d pad_ipd -f sql/19_indexes_constraints_postgresql.sql
psql -h localhost -U pad_app -d pad_ipd -f sql/22_valor_uit_postgresql.sql
```

Or within psql session:

```sql
\i sql/01_DDL_postgresql.sql
\i sql/19_indexes_constraints_postgresql.sql
\i sql/22_valor_uit_postgresql.sql
```

### Verify schema creation

```sql
-- List all tables
\dt pad.*
\dt cat.*
\dt gold.*

-- List all views
\dv gold.*

-- Count records in catalogs
SELECT COUNT(*) FROM cat.valor_uit;      -- Should be 2
SELECT COUNT(*) FROM cat.Nivel;          -- Should be 37
SELECT COUNT(*) FROM cat.ubigeo;         -- Should be 1,891
```

---

## 5. Data Migration (From SQL Server)

### Option A: Using Export/Import Tools

1. **SQL Server:** Export tables to CSV using SSMS
2. **PostgreSQL:** Import CSV files using `\COPY` command

```sql
-- Example: Import deportistas from CSV
\COPY pad.Deportistas (cod_deportista, num_documento, tipo_documento, ...)
FROM '/path/to/deportistas.csv' WITH (FORMAT csv, DELIMITER ',', HEADER);
```

### Option B: Using Python Migration Script

Refer to `sql/migracion_etl_postgresql.py` (adapted from original for PostgreSQL):

```bash
python sql/migracion_etl_postgresql.py
```

This script will:
- Read from SQL Server backup file or CSV exports
- Transform data (handle SQL Server → PostgreSQL type conversions)
- Insert into PostgreSQL with validation
- Report migration statistics

### Option C: Manual backup & restore (if SQL Server backup available)

```bash
# In SQL Server, take backup
BACKUP DATABASE PAD_IPD TO DISK = 'C:\Backup\pad_ipd.bak';

# Convert and restore to PostgreSQL (requires specialized tools)
# Recommend Option A or B for reliability
```

---

## 6. Configure Node.js API

Update `.env` file in `api/` directory:

```bash
# Database (PostgreSQL)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=pad_ipd
DB_USER=pad_app
DB_PASSWORD=your_secure_password_here

# API
API_PORT=8080
API_KEYS=PMD2026

# Azure AD / Microsoft Entra ID
AZURE_TENANT_ID=<your-tenant-id>
AZURE_CLIENT_ID=<your-client-id>
AZURE_CLIENT_SECRET=<your-client-secret>
AZURE_SECRET_ID=<your-secret-id>

# SharePoint
SHAREPOINT_SITE_ID=<your-sharepoint-site-id>
SHAREPOINT_SITE_URL=<your-sharepoint-site-url>
SHAREPOINT_FOLDER=pad-data
ONEDRIVE_DRIVE_ID=<your-onedrive-drive-id>
```

### Install PostgreSQL driver

```bash
cd api
npm install pg
```

### Start API server

```bash
npm start
```

Should output:
```
[INFO] 🟢 PostgreSQL connection pool initialized
[INFO] ✅ API listening on 0.0.0.0:8080
```

---

## 7. Verification & Health Checks

### Check database connection

```bash
psql -h localhost -U pad_app -d pad_ipd -c "SELECT NOW();"
# Output: current_timestamp
```

### Check API health

```bash
curl -H "x-api-key: PMD2026" http://localhost:8080/health
# Output: { "status": "ok", "database": "connected", ... }
```

### Check catalog data

```sql
-- All catalogs should be populated
SELECT COUNT(*) as total_catalogs FROM cat.tipo_PAD;      -- 3
SELECT COUNT(*) as total_estados FROM cat.estado_PAD;     -- 4
SELECT COUNT(*) as total_niveles FROM cat.Nivel;          -- 37
SELECT COUNT(*) as total_ubigeo FROM cat.ubigeo;          -- 1,891
SELECT COUNT(*) as total_uit FROM cat.valor_uit;          -- 2
```

---

## 8. PostgreSQL Operations

### Common Commands

```bash
# Connect to database
psql -h localhost -U pad_app -d pad_ipd

# List databases
\l

# List tables in pad schema
\dt pad.*

# List views in gold schema
\dv gold.*

# Exit psql
\q
```

### Backup database

```bash
pg_dump -h localhost -U pad_app -d pad_ipd > backup_pad_ipd_2026-03-24.sql

# With compression
pg_dump -h localhost -U pad_app -d pad_ipd --format custom --file backup_pad_ipd.dump
```

### Restore database

```bash
# From SQL file
psql -h localhost -U pad_app -d pad_ipd < backup_pad_ipd_2026-03-24.sql

# From compressed dump
pg_restore -h localhost -U pad_app -d pad_ipd backup_pad_ipd.dump
```

### Monitor connections

```sql
-- List active connections
SELECT datname, usename, application_name, state FROM pg_stat_activity WHERE datname='pad_ipd';

-- Terminate connection
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='pad_ipd' AND pid <> pg_backend_pid();
```

---

## 9. Performance Tuning (Optional)

For production environments, adjust `postgresql.conf`:

```bash
# On Windows: C:\Program Files\PostgreSQL\15\data\postgresql.conf
# On Linux: /etc/postgresql/15/main/postgresql.conf

# Recommended settings for PAD_IPD (small instance):
max_connections = 200
shared_buffers = 256MB
effective_cache_size = 1GB
work_mem = 4MB
maintenance_work_mem = 64MB
random_page_cost = 1.1
```

Then restart PostgreSQL:

```bash
# Windows (Command Prompt as Admin)
pg_ctl -D "C:\Program Files\PostgreSQL\15\data" restart

# Linux
sudo systemctl restart postgresql
```

---

## 10. Security Checklist

- ✅ PostgreSQL installed on localhost only (no remote access)
- ✅ `pad_app` role created as non-superuser
- ✅ Strong password set for `pad_app` role
- ✅ `.env` file is in `.gitignore` (credentials not committed)
- ✅ pgAdmin 4 has strong password (if used)
- ✅ Firewall: only localhost can access port 5432
- ✅ Node.js API requires `x-api-key` header for all endpoints
- ✅ Sensitive data (DNI, bank accounts) handled per CLAUDE.md security rules

---

## 11. Troubleshooting

### Connection refused (localhost:5432)

1. Check PostgreSQL is running:
   ```bash
   # Windows: Services app → PostgreSQL service should be "Running"
   # Linux: sudo systemctl status postgresql
   ```

2. Verify port 5432 is listening:
   ```bash
   netstat -an | grep 5432  # Windows
   sudo netstat -an | grep 5432  # Linux
   ```

3. Check credentials in `.env` match role created in step 2

### Permission denied errors

```sql
-- Ensure pad_app user has schema access
GRANT USAGE ON SCHEMA public TO pad_app;
GRANT USAGE ON SCHEMA pad TO pad_app;
GRANT USAGE ON SCHEMA cat TO pad_app;
GRANT USAGE ON SCHEMA gold TO pad_app;

-- Grant table permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pad TO pad_app;
GRANT SELECT ON ALL TABLES IN SCHEMA cat TO pad_app;
GRANT SELECT ON ALL TABLES IN SCHEMA gold TO pad_app;

-- Grant sequence permissions
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pad TO pad_app;
```

### Extensions not found

```sql
-- Verify unaccent is installed
CREATE EXTENSION IF NOT EXISTS unaccent;

-- If it fails, install contrib package
-- Windows: PostgreSQL installer should include it
-- Linux: sudo apt install postgresql-contrib-15
```

---

## 12. Next Steps

After setup is complete:

1. ✅ Verify API health: `GET /health` returns `{ status: "ok" }`
2. ✅ Run Gestión PAD: `http://localhost:8080`
3. ✅ Test core workflows: ING/CAMBNIV/RET movements
4. ✅ Generate reports: PDF/Excel exports
5. ⏳ Configure Power BI connection to OneDrive JSON exports

---

## References

- **PostgreSQL Documentation:** https://www.postgresql.org/docs/
- **pgAdmin 4 Help:** https://www.pgadmin.org/docs/
- **CLAUDE.md:** Project architecture and configuration
- **DESIGN_CONTEXT.md:** Migration rationale and architectural decisions
- **sql/ directory:** All DDL, migration scripts, and queries
