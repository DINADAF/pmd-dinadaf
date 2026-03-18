-- pad.periodos_cambios: gestión de periodos de cambios PAD
-- Cada periodo agrupa los cambios del mes, puede cerrarse para evitar edición

USE PAD_IPD;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='periodos_cambios' AND schema_id=SCHEMA_ID('pad'))
BEGIN
  CREATE TABLE pad.periodos_cambios (
    periodo        VARCHAR(6)   NOT NULL PRIMARY KEY,  -- e.g. '202602'
    cerrado        BIT          NOT NULL DEFAULT 0,
    fecha_cierre   DATE         NULL,
    usuario_cierre VARCHAR(100) NULL,
    notas          VARCHAR(500) NULL,
    fecha_creacion DATETIME     NOT NULL DEFAULT GETDATE()
  );
  PRINT 'Tabla pad.periodos_cambios creada.';
END
ELSE
  PRINT 'Tabla pad.periodos_cambios ya existe.';
GO
