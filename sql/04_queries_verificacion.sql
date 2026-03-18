-- ============================================================
-- PAD_IPD — Verification & Diagnostic Queries
-- Version: 1.0 | Date: 2026-03-17
-- ============================================================

USE PAD_IPD;
GO

-- 1. Full object inventory
SELECT 
    s.name + '.' + t.name AS tabla,
    p.rows AS registros
FROM sys.tables t
JOIN sys.schemas s ON t.schema_id = s.schema_id
JOIN sys.partitions p ON t.object_id = p.object_id AND p.index_id IN (0,1)
WHERE s.name IN ('cat','pad')
UNION ALL
SELECT s.name + '.' + v.name, NULL
FROM sys.views v
JOIN sys.schemas s ON v.schema_id = s.schema_id
WHERE s.name = 'gold'
ORDER BY 1;
GO

-- 2. Column count per table
SELECT s.name AS esquema, t.name AS tabla, COUNT(c.column_id) AS columnas
FROM sys.tables t
JOIN sys.schemas s ON t.schema_id = s.schema_id
JOIN sys.columns c ON t.object_id = c.object_id
WHERE s.name IN ('cat','pad','gold')
GROUP BY s.name, t.name
ORDER BY s.name, t.name;
GO

-- 3. Montos distribution by PAD type
SELECT n.cod_tipo_pad, COUNT(*) AS registros,
    MIN(m.periodo_desde) AS desde, MAX(m.periodo_desde) AS hasta
FROM pad.montos_referencia m
JOIN cat.Nivel n ON m.cod_nivel = n.cod_nivel
GROUP BY n.cod_tipo_pad
ORDER BY n.cod_tipo_pad;
GO

-- 4. Active vs historical levels
SELECT cod_tipo_pad, activo, COUNT(*) AS cantidad
FROM cat.Nivel
GROUP BY cod_tipo_pad, activo
ORDER BY cod_tipo_pad, activo;
GO

-- 5. Asociaciones by type
SELECT tipo_organizacion, es_grupo_trabajo, COUNT(*) AS cantidad
FROM pad.Asociacion_Deportiva
GROUP BY tipo_organizacion, es_grupo_trabajo;
GO

-- 6. Check collation
SELECT DATABASEPROPERTYEX('PAD_IPD', 'Collation') AS db_collation;
GO

-- 7. FK dependency map
SELECT fk.name AS constraint_name,
    SCHEMA_NAME(tp.schema_id) + '.' + tp.name AS parent_table,
    SCHEMA_NAME(tr.schema_id) + '.' + tr.name AS referenced_table
FROM sys.foreign_keys fk
JOIN sys.tables tp ON fk.parent_object_id = tp.object_id
JOIN sys.tables tr ON fk.referenced_object_id = tr.object_id
ORDER BY parent_table;
GO

-- 8. End-to-end flow test (all gold views)
SELECT 'v_deportistas_activos' AS vista, COUNT(*) AS filas FROM gold.v_deportistas_activos
UNION ALL SELECT 'v_resumen_mensual', COUNT(*) FROM gold.v_resumen_mensual
UNION ALL SELECT 'v_consolidado_economico', COUNT(*) FROM gold.v_consolidado_economico
UNION ALL SELECT 'v_consolidado_tecnico', COUNT(*) FROM gold.v_consolidado_tecnico
UNION ALL SELECT 'v_registro_cambios_pad', COUNT(*) FROM gold.v_registro_cambios_pad
UNION ALL SELECT 'v_movimientos_mes', COUNT(*) FROM gold.v_movimientos_mes
UNION ALL SELECT 'kpi_dep_asoc_periodo', COUNT(*) FROM gold.kpi_deportistas_asociacion_periodo
UNION ALL SELECT 'kpi_riesgo_pago', COUNT(*) FROM gold.kpi_riesgo_pago_indebido;
GO
