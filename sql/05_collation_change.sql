-- ============================================================
-- PAD_IPD — Collation Change to Latin1_General_CI_AI
-- CI = Case Insensitive, AI = Accent Insensitive
-- Run this BEFORE bulk data migration
-- Version: 1.0 | Date: 2026-03-17
-- ============================================================

-- 1. Check current collation
SELECT DATABASEPROPERTYEX('PAD_IPD', 'Collation') AS current_collation;
GO

-- 2. Change database collation
-- NOTE: Requires single-user mode temporarily
USE master;
GO

ALTER DATABASE PAD_IPD SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
GO

ALTER DATABASE PAD_IPD COLLATE Latin1_General_CI_AI;
GO

ALTER DATABASE PAD_IPD SET MULTI_USER;
GO

-- 3. Verify new collation
SELECT DATABASEPROPERTYEX('PAD_IPD', 'Collation') AS new_collation;
GO

USE PAD_IPD;
GO

-- 4. Test accent insensitivity
-- This should return BADMINTON row even without tilde
SELECT * FROM pad.Asociacion_Deportiva WHERE nombre = 'BADMINTON';
GO
