-- ============================================================
-- PAD_IPD — Catalog Data Load (cat + pad.Asociacion_Deportiva)
-- Version: 1.0 | Date: 2026-03-17
-- NOTE: ubigeo and montos_referencia loaded from separate files
-- ============================================================

USE PAD_IPD;
GO

-- cat.tipo_PAD
INSERT INTO cat.tipo_PAD (cod_tipo_pad, tipo_pad, descripcion) VALUES
('PAD1', 'PAD I',  'Programa de Apoyo al Deportista I'),
('PAD2', 'PAD II', 'Programa de Apoyo al Deportista II'),
('PNM',  'PNM',   'Programa Nacional de Maratonistas');
GO

-- cat.estado_PAD
INSERT INTO cat.estado_PAD (cod_estado_pad, estado, descripcion) VALUES
('ACT', 'Activo',                'Recibe subvencion y seguro de salud'),
('LES', 'Lesion con subvencion', 'Lesionado, mantiene todos los beneficios (hasta 6 meses, numeral 9.1.4.1.6)'),
('LSS', 'Lesion solo seguro',    'No recuperado, solo seguro de salud (hasta 6 meses adicionales)'),
('RET', 'Retirado',              'Retirado del programa');
GO

-- cat.tipo_movimiento
INSERT INTO cat.tipo_movimiento (cod_tip_mov, tipo_movimiento, descripcion) VALUES
('ING',     'Ingreso',         'Ingreso al programa'),
('RET',     'Retiro',          'Retiro del programa (motivo especifico en cambios_PAD)'),
('CAMBNIV', 'Cambio de nivel', 'Cambio de nivel (incluye migracion entre tipos de PAD)');
GO

-- cat.Nivel (14 active + 16 historical = 30 total)
INSERT INTO cat.Nivel (cod_nivel, nombre_nivel, cod_tipo_pad, pct_uit, orden, activo, normativa) VALUES
('P1-I',    'I',    'PAD1', 0.49, 1, 1, 'Dir. 003-2025-IPD/DINADAF'),
('P1-II',   'II',   'PAD1', 0.44, 2, 1, 'Dir. 003-2025-IPD/DINADAF'),
('P1-III',  'III',  'PAD1', 0.36, 3, 1, 'Dir. 003-2025-IPD/DINADAF'),
('P1-IV',   'IV',   'PAD1', 0.27, 4, 1, 'Dir. 003-2025-IPD/DINADAF'),
('P1-V',    'V',    'PAD1', 0.20, 5, 1, 'Dir. 003-2025-IPD/DINADAF'),
('P2-O',    'O',    'PAD2', 1.12, 1, 1, 'Dir. 003-2025-IPD/DINADAF'),
('P2-I',    'I',    'PAD2', 1.03, 2, 1, 'Dir. 003-2025-IPD/DINADAF'),
('P2-II',   'II',   'PAD2', 0.95, 3, 1, 'Dir. 003-2025-IPD/DINADAF'),
('P2-III',  'III',  'PAD2', 0.80, 4, 1, 'Dir. 003-2025-IPD/DINADAF'),
('P2-IV',   'IV',   'PAD2', 0.67, 5, 1, 'Dir. 003-2025-IPD/DINADAF'),
('P2-V',    'V',    'PAD2', 0.53, 6, 1, 'Dir. 003-2025-IPD/DINADAF'),
('PNM-R01', 'Ranking 01', 'PNM', 0.28, 1, 1, 'Dir. 003-2025-IPD/DINADAF'),
('PNM-R02', 'Ranking 02', 'PNM', 0.37, 2, 1, 'Dir. 003-2025-IPD/DINADAF'),
('PNM-TOP', 'TOP',        'PNM', 0.80, 3, 1, 'Dir. 003-2025-IPD/DINADAF');
GO

-- Historical levels (inactive)
INSERT INTO cat.Nivel (cod_nivel, nombre_nivel, cod_tipo_pad, pct_uit, orden, activo, normativa) VALUES
('P1-IA',   'IA',   'PAD1', NULL, 10, 0, 'Dir. anterior'),
('P1-IB',   'IB',   'PAD1', NULL, 11, 0, 'Dir. anterior'),
('P1-IIA',  'IIA',  'PAD1', NULL, 18, 0, 'Dir. anterior'),
('P1-IIB',  'IIB',  'PAD1', NULL, 19, 0, 'Dir. anterior'),
('P1-IIIA', 'IIIA', 'PAD1', NULL, 14, 0, 'Dir. anterior'),
('P1-IIIB', 'IIIB', 'PAD1', NULL, 15, 0, 'Dir. anterior'),
('P1-IVA',  'IVA',  'PAD1', NULL, 20, 0, 'Dir. anterior'),
('P1-IVB',  'IVB',  'PAD1', NULL, 21, 0, 'Dir. anterior'),
('P2-IA',   'IA',   'PAD2', NULL, 10, 0, 'Dir. anterior'),
('P2-IB',   'IB',   'PAD2', NULL, 11, 0, 'Dir. anterior'),
('P2-IIA',  'IIA',  'PAD2', NULL, 12, 0, 'Dir. anterior'),
('P2-IIB',  'IIB',  'PAD2', NULL, 13, 0, 'Dir. anterior'),
('P2-IIIA', 'IIIA', 'PAD2', NULL, 22, 0, 'Dir. anterior'),
('P2-IIIB', 'IIIB', 'PAD2', NULL, 23, 0, 'Dir. anterior'),
('P2-IO',   'IO',   'PAD2', NULL, 16, 0, 'Dir. anterior'),
('P2-IOA',  'IOA',  'PAD2', NULL, 17, 0, 'Dir. anterior');
GO

-- pad.Asociacion_Deportiva (72 organizations)
-- See separate file: 03_DML_asociaciones.sql
