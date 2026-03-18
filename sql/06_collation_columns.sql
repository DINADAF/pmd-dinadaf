-- ============================================================
-- PAD_IPD — Cambio de Collation a Nivel de Columnas
-- De: Modern_Spanish_CI_AS  →  Latin1_General_CI_AI
-- Generado con tipos/tamaños exactos de sys.columns
-- Version: 2.0 | Fecha: 2026-03-17
-- ============================================================

USE PAD_IPD;
GO

-- ============================================================
-- PASO 1: DROP FK CONSTRAINTS
-- ============================================================
ALTER TABLE [pad].[Apoderados]            DROP CONSTRAINT [FK_Apoderados_Deportista];
ALTER TABLE [pad].[cambios_PAD]           DROP CONSTRAINT [FK_cambiosPAD_Resultado];
ALTER TABLE [pad].[cambios_PAD]           DROP CONSTRAINT [FK_cambiosPAD_PAD];
ALTER TABLE [pad].[cambios_PAD]           DROP CONSTRAINT [FK_cambiosPAD_TipoMov];
ALTER TABLE [pad].[Deportistas]           DROP CONSTRAINT [FK_Deportistas_Ubigeo];
ALTER TABLE [pad].[Deportistas]           DROP CONSTRAINT [FK_Deportistas_Asociacion];
ALTER TABLE [pad].[ejecucion_mensual]     DROP CONSTRAINT [FK_ejecMensual_PAD];
ALTER TABLE [pad].[expedientes_cambio]    DROP CONSTRAINT [FK_expCambio_Cambio];
ALTER TABLE [pad].[montos_referencia]     DROP CONSTRAINT [FK_montosRef_Nivel];
ALTER TABLE [cat].[Nivel]                 DROP CONSTRAINT [FK_Nivel_tipoPAD];
ALTER TABLE [pad].[PAD]                   DROP CONSTRAINT [FK_PAD_Deportista];
ALTER TABLE [pad].[PAD]                   DROP CONSTRAINT [FK_PAD_TipoPAD];
ALTER TABLE [pad].[PAD]                   DROP CONSTRAINT [FK_PAD_Nivel];
ALTER TABLE [pad].[PAD]                   DROP CONSTRAINT [FK_PAD_Estado];
ALTER TABLE [pad].[resultados_deportista] DROP CONSTRAINT [FK_resultDep_Evento];
ALTER TABLE [pad].[resultados_deportista] DROP CONSTRAINT [FK_resultDep_Deportista];
GO

-- ============================================================
-- PASO 2: DROP UNIQUE CONSTRAINTS sobre columnas de texto
-- ============================================================
ALTER TABLE [pad].[Asociacion_Deportiva] DROP CONSTRAINT [UQ_Asociacion_Nombre];
ALTER TABLE [pad].[Deportistas]          DROP CONSTRAINT [UQ_Deportistas_Documento];
ALTER TABLE [pad].[ejecucion_mensual]    DROP CONSTRAINT [UQ_ejecMensual_PadPeriodo];
GO

-- ============================================================
-- PASO 3: DROP PK CONSTRAINTS que incluyen columnas de texto
-- ============================================================
ALTER TABLE [cat].[estado_PAD]         DROP CONSTRAINT [PK_estado_PAD];
ALTER TABLE [cat].[Nivel]              DROP CONSTRAINT [PK_Nivel];
ALTER TABLE [cat].[tipo_movimiento]    DROP CONSTRAINT [PK_tipo_movimiento];
ALTER TABLE [cat].[tipo_PAD]           DROP CONSTRAINT [PK_tipo_PAD];
ALTER TABLE [cat].[ubigeo]             DROP CONSTRAINT [PK_ubigeo];
ALTER TABLE [pad].[expedientes_cambio] DROP CONSTRAINT [PK_expedientes_cambio];
ALTER TABLE [pad].[montos_referencia]  DROP CONSTRAINT [PK_montos_referencia];
GO

-- ============================================================
-- PASO 4: ALTER COLUMNS — cat schema
-- ============================================================

-- cat.tipo_PAD
ALTER TABLE [cat].[tipo_PAD] ALTER COLUMN [cod_tipo_pad] VARCHAR(5)  COLLATE Latin1_General_CI_AI NOT NULL;
ALTER TABLE [cat].[tipo_PAD] ALTER COLUMN [tipo_pad]     VARCHAR(10) COLLATE Latin1_General_CI_AI NOT NULL;
ALTER TABLE [cat].[tipo_PAD] ALTER COLUMN [descripcion]  VARCHAR(60) COLLATE Latin1_General_CI_AI NOT NULL;
GO

-- cat.estado_PAD
ALTER TABLE [cat].[estado_PAD] ALTER COLUMN [cod_estado_pad] VARCHAR(3)   COLLATE Latin1_General_CI_AI NOT NULL;
ALTER TABLE [cat].[estado_PAD] ALTER COLUMN [estado]         VARCHAR(30)  COLLATE Latin1_General_CI_AI NOT NULL;
ALTER TABLE [cat].[estado_PAD] ALTER COLUMN [descripcion]    VARCHAR(100) COLLATE Latin1_General_CI_AI NOT NULL;
GO

-- cat.tipo_movimiento
ALTER TABLE [cat].[tipo_movimiento] ALTER COLUMN [cod_tip_mov]     VARCHAR(7)   COLLATE Latin1_General_CI_AI NOT NULL;
ALTER TABLE [cat].[tipo_movimiento] ALTER COLUMN [tipo_movimiento] VARCHAR(20)  COLLATE Latin1_General_CI_AI NOT NULL;
ALTER TABLE [cat].[tipo_movimiento] ALTER COLUMN [descripcion]     VARCHAR(100) COLLATE Latin1_General_CI_AI NOT NULL;
GO

-- cat.Nivel
ALTER TABLE [cat].[Nivel] ALTER COLUMN [cod_nivel]    VARCHAR(10) COLLATE Latin1_General_CI_AI NOT NULL;
ALTER TABLE [cat].[Nivel] ALTER COLUMN [nombre_nivel] VARCHAR(10) COLLATE Latin1_General_CI_AI NOT NULL;
ALTER TABLE [cat].[Nivel] ALTER COLUMN [cod_tipo_pad] VARCHAR(5)  COLLATE Latin1_General_CI_AI NOT NULL;
ALTER TABLE [cat].[Nivel] ALTER COLUMN [normativa]    VARCHAR(60) COLLATE Latin1_General_CI_AI NULL;
GO

-- cat.ubigeo
ALTER TABLE [cat].[ubigeo] ALTER COLUMN [cod_ubigeo]   CHAR(6)     COLLATE Latin1_General_CI_AI NOT NULL;
ALTER TABLE [cat].[ubigeo] ALTER COLUMN [departamento] VARCHAR(30) COLLATE Latin1_General_CI_AI NOT NULL;
ALTER TABLE [cat].[ubigeo] ALTER COLUMN [provincia]    VARCHAR(30) COLLATE Latin1_General_CI_AI NOT NULL;
ALTER TABLE [cat].[ubigeo] ALTER COLUMN [distrito]     VARCHAR(40) COLLATE Latin1_General_CI_AI NOT NULL;
GO

-- ============================================================
-- PASO 5: ALTER COLUMNS — pad schema
-- ============================================================

-- pad.Asociacion_Deportiva
ALTER TABLE [pad].[Asociacion_Deportiva] ALTER COLUMN [nombre]            VARCHAR(80)  COLLATE Latin1_General_CI_AI NOT NULL;
ALTER TABLE [pad].[Asociacion_Deportiva] ALTER COLUMN [nombre_formal]     VARCHAR(150) COLLATE Latin1_General_CI_AI NULL;
ALTER TABLE [pad].[Asociacion_Deportiva] ALTER COLUMN [tipo_organizacion] VARCHAR(15)  COLLATE Latin1_General_CI_AI NOT NULL;
ALTER TABLE [pad].[Asociacion_Deportiva] ALTER COLUMN [disciplina]        VARCHAR(80)  COLLATE Latin1_General_CI_AI NULL;
GO

-- pad.Deportistas
ALTER TABLE [pad].[Deportistas] ALTER COLUMN [num_documento]  VARCHAR(12) COLLATE Latin1_General_CI_AI NOT NULL;
ALTER TABLE [pad].[Deportistas] ALTER COLUMN [tipo_documento] VARCHAR(3)  COLLATE Latin1_General_CI_AI NOT NULL;
ALTER TABLE [pad].[Deportistas] ALTER COLUMN [ap_paterno]     VARCHAR(50) COLLATE Latin1_General_CI_AI NOT NULL;
ALTER TABLE [pad].[Deportistas] ALTER COLUMN [ap_materno]     VARCHAR(50) COLLATE Latin1_General_CI_AI NULL;
ALTER TABLE [pad].[Deportistas] ALTER COLUMN [nombres]        VARCHAR(50) COLLATE Latin1_General_CI_AI NOT NULL;
ALTER TABLE [pad].[Deportistas] ALTER COLUMN [sexo]           CHAR(1)     COLLATE Latin1_General_CI_AI NOT NULL;
ALTER TABLE [pad].[Deportistas] ALTER COLUMN [cod_ubigeo]     CHAR(6)     COLLATE Latin1_General_CI_AI NULL;
ALTER TABLE [pad].[Deportistas] ALTER COLUMN [num_cuenta]     VARCHAR(20) COLLATE Latin1_General_CI_AI NULL;
ALTER TABLE [pad].[Deportistas] ALTER COLUMN [correo]         VARCHAR(80) COLLATE Latin1_General_CI_AI NULL;
ALTER TABLE [pad].[Deportistas] ALTER COLUMN [telefono]       VARCHAR(15) COLLATE Latin1_General_CI_AI NULL;
ALTER TABLE [pad].[Deportistas] ALTER COLUMN [agrupacion]     CHAR(1)     COLLATE Latin1_General_CI_AI NULL;
GO

-- pad.Apoderados
ALTER TABLE [pad].[Apoderados] ALTER COLUMN [num_documento]  VARCHAR(12) COLLATE Latin1_General_CI_AI NOT NULL;
ALTER TABLE [pad].[Apoderados] ALTER COLUMN [tipo_documento] VARCHAR(3)  COLLATE Latin1_General_CI_AI NOT NULL;
ALTER TABLE [pad].[Apoderados] ALTER COLUMN [ap_paterno]     VARCHAR(50) COLLATE Latin1_General_CI_AI NOT NULL;
ALTER TABLE [pad].[Apoderados] ALTER COLUMN [ap_materno]     VARCHAR(50) COLLATE Latin1_General_CI_AI NULL;
ALTER TABLE [pad].[Apoderados] ALTER COLUMN [nombres]        VARCHAR(50) COLLATE Latin1_General_CI_AI NOT NULL;
ALTER TABLE [pad].[Apoderados] ALTER COLUMN [parentesco]     VARCHAR(20) COLLATE Latin1_General_CI_AI NOT NULL;
ALTER TABLE [pad].[Apoderados] ALTER COLUMN [telefono]       VARCHAR(15) COLLATE Latin1_General_CI_AI NULL;
GO

-- pad.PAD
ALTER TABLE [pad].[PAD] ALTER COLUMN [cod_tipo_pad]  VARCHAR(5)  COLLATE Latin1_General_CI_AI NOT NULL;
ALTER TABLE [pad].[PAD] ALTER COLUMN [cod_nivel]     VARCHAR(10) COLLATE Latin1_General_CI_AI NOT NULL;
ALTER TABLE [pad].[PAD] ALTER COLUMN [cod_estado_pad] VARCHAR(3) COLLATE Latin1_General_CI_AI NOT NULL;
GO

-- pad.cambios_PAD
ALTER TABLE [pad].[cambios_PAD] ALTER COLUMN [cod_tip_mov]      VARCHAR(7)    COLLATE Latin1_General_CI_AI NOT NULL;
ALTER TABLE [pad].[cambios_PAD] ALTER COLUMN [periodo_vigencia]  VARCHAR(6)   COLLATE Latin1_General_CI_AI NOT NULL;
ALTER TABLE [pad].[cambios_PAD] ALTER COLUMN [nro_informe]       VARCHAR(30)  COLLATE Latin1_General_CI_AI NULL;
ALTER TABLE [pad].[cambios_PAD] ALTER COLUMN [motivo]            VARCHAR(500) COLLATE Latin1_General_CI_AI NULL;
ALTER TABLE [pad].[cambios_PAD] ALTER COLUMN [detalle_evento]    VARCHAR(2000) COLLATE Latin1_General_CI_AI NULL;
ALTER TABLE [pad].[cambios_PAD] ALTER COLUMN [nivel_anterior]    VARCHAR(10)  COLLATE Latin1_General_CI_AI NULL;
ALTER TABLE [pad].[cambios_PAD] ALTER COLUMN [nivel_nuevo]       VARCHAR(10)  COLLATE Latin1_General_CI_AI NULL;
ALTER TABLE [pad].[cambios_PAD] ALTER COLUMN [ruta_documento]    VARCHAR(500) COLLATE Latin1_General_CI_AI NULL;
ALTER TABLE [pad].[cambios_PAD] ALTER COLUMN [observaciones]     VARCHAR(500) COLLATE Latin1_General_CI_AI NULL;
GO

-- pad.expedientes_cambio
ALTER TABLE [pad].[expedientes_cambio] ALTER COLUMN [nro_expediente] VARCHAR(50)  COLLATE Latin1_General_CI_AI NOT NULL;
ALTER TABLE [pad].[expedientes_cambio] ALTER COLUMN [tipo_documento] VARCHAR(20)  COLLATE Latin1_General_CI_AI NOT NULL;
ALTER TABLE [pad].[expedientes_cambio] ALTER COLUMN [ruta_documento] VARCHAR(500) COLLATE Latin1_General_CI_AI NULL;
GO

-- pad.montos_referencia
ALTER TABLE [pad].[montos_referencia] ALTER COLUMN [cod_nivel]     VARCHAR(10) COLLATE Latin1_General_CI_AI NOT NULL;
ALTER TABLE [pad].[montos_referencia] ALTER COLUMN [periodo_desde] VARCHAR(6)  COLLATE Latin1_General_CI_AI NOT NULL;
ALTER TABLE [pad].[montos_referencia] ALTER COLUMN [periodo_hasta] VARCHAR(6)  COLLATE Latin1_General_CI_AI NULL;
ALTER TABLE [pad].[montos_referencia] ALTER COLUMN [divisa]        CHAR(1)     COLLATE Latin1_General_CI_AI NOT NULL;
ALTER TABLE [pad].[montos_referencia] ALTER COLUMN [normativa]     VARCHAR(60) COLLATE Latin1_General_CI_AI NULL;
GO

-- pad.ejecucion_mensual
ALTER TABLE [pad].[ejecucion_mensual] ALTER COLUMN [periodo]                 VARCHAR(6)  COLLATE Latin1_General_CI_AI NOT NULL;
ALTER TABLE [pad].[ejecucion_mensual] ALTER COLUMN [nro_informe_consolidado] VARCHAR(30) COLLATE Latin1_General_CI_AI NULL;
ALTER TABLE [pad].[ejecucion_mensual] ALTER COLUMN [nro_giro]                VARCHAR(30) COLLATE Latin1_General_CI_AI NULL;
GO

-- pad.Eventos_Resultado
ALTER TABLE [pad].[Eventos_Resultado] ALTER COLUMN [nombre_evento]           VARCHAR(200) COLLATE Latin1_General_CI_AI NOT NULL;
ALTER TABLE [pad].[Eventos_Resultado] ALTER COLUMN [tipo_evento]             VARCHAR(30)  COLLATE Latin1_General_CI_AI NULL;
ALTER TABLE [pad].[Eventos_Resultado] ALTER COLUMN [ciudad]                  VARCHAR(80)  COLLATE Latin1_General_CI_AI NULL;
ALTER TABLE [pad].[Eventos_Resultado] ALTER COLUMN [pais]                    VARCHAR(50)  COLLATE Latin1_General_CI_AI NULL;
ALTER TABLE [pad].[Eventos_Resultado] ALTER COLUMN [resolucion_autorizacion] VARCHAR(60)  COLLATE Latin1_General_CI_AI NULL;
ALTER TABLE [pad].[Eventos_Resultado] ALTER COLUMN [observaciones]           VARCHAR(500) COLLATE Latin1_General_CI_AI NULL;
GO

-- pad.resultados_deportista
ALTER TABLE [pad].[resultados_deportista] ALTER COLUMN [modalidad] VARCHAR(100) COLLATE Latin1_General_CI_AI NULL;
ALTER TABLE [pad].[resultados_deportista] ALTER COLUMN [categoria] VARCHAR(50)  COLLATE Latin1_General_CI_AI NULL;
ALTER TABLE [pad].[resultados_deportista] ALTER COLUMN [resultado] VARCHAR(30)  COLLATE Latin1_General_CI_AI NOT NULL;
GO

-- ============================================================
-- PASO 6: RECREAR PK CONSTRAINTS
-- ============================================================
ALTER TABLE [cat].[tipo_PAD]          ADD CONSTRAINT [PK_tipo_PAD]          PRIMARY KEY ([cod_tipo_pad]);
ALTER TABLE [cat].[estado_PAD]        ADD CONSTRAINT [PK_estado_PAD]        PRIMARY KEY ([cod_estado_pad]);
ALTER TABLE [cat].[tipo_movimiento]   ADD CONSTRAINT [PK_tipo_movimiento]   PRIMARY KEY ([cod_tip_mov]);
ALTER TABLE [cat].[Nivel]             ADD CONSTRAINT [PK_Nivel]             PRIMARY KEY ([cod_nivel]);
ALTER TABLE [cat].[ubigeo]            ADD CONSTRAINT [PK_ubigeo]            PRIMARY KEY ([cod_ubigeo]);
ALTER TABLE [pad].[expedientes_cambio] ADD CONSTRAINT [PK_expedientes_cambio] PRIMARY KEY ([cod_cambio], [nro_expediente]);
ALTER TABLE [pad].[montos_referencia]  ADD CONSTRAINT [PK_montos_referencia]  PRIMARY KEY ([cod_nivel], [periodo_desde]);
GO

-- ============================================================
-- PASO 7: RECREAR UNIQUE CONSTRAINTS
-- ============================================================
ALTER TABLE [pad].[Asociacion_Deportiva] ADD CONSTRAINT [UQ_Asociacion_Nombre]
    UNIQUE ([nombre]);

ALTER TABLE [pad].[Deportistas] ADD CONSTRAINT [UQ_Deportistas_Documento]
    UNIQUE ([tipo_documento], [num_documento]);

ALTER TABLE [pad].[ejecucion_mensual] ADD CONSTRAINT [UQ_ejecMensual_PadPeriodo]
    UNIQUE ([cod_pad], [periodo]);
GO

-- ============================================================
-- PASO 8: RECREAR FK CONSTRAINTS
-- ============================================================
ALTER TABLE [cat].[Nivel] ADD CONSTRAINT [FK_Nivel_tipoPAD]
    FOREIGN KEY ([cod_tipo_pad]) REFERENCES [cat].[tipo_PAD]([cod_tipo_pad]);

ALTER TABLE [pad].[Deportistas] ADD CONSTRAINT [FK_Deportistas_Asociacion]
    FOREIGN KEY ([cod_asociacion]) REFERENCES [pad].[Asociacion_Deportiva]([cod_asociacion]);

ALTER TABLE [pad].[Deportistas] ADD CONSTRAINT [FK_Deportistas_Ubigeo]
    FOREIGN KEY ([cod_ubigeo]) REFERENCES [cat].[ubigeo]([cod_ubigeo]);

ALTER TABLE [pad].[Apoderados] ADD CONSTRAINT [FK_Apoderados_Deportista]
    FOREIGN KEY ([cod_deportista]) REFERENCES [pad].[Deportistas]([cod_deportista]);

ALTER TABLE [pad].[PAD] ADD CONSTRAINT [FK_PAD_Deportista]
    FOREIGN KEY ([cod_deportista]) REFERENCES [pad].[Deportistas]([cod_deportista]);

ALTER TABLE [pad].[PAD] ADD CONSTRAINT [FK_PAD_TipoPAD]
    FOREIGN KEY ([cod_tipo_pad]) REFERENCES [cat].[tipo_PAD]([cod_tipo_pad]);

ALTER TABLE [pad].[PAD] ADD CONSTRAINT [FK_PAD_Nivel]
    FOREIGN KEY ([cod_nivel]) REFERENCES [cat].[Nivel]([cod_nivel]);

ALTER TABLE [pad].[PAD] ADD CONSTRAINT [FK_PAD_Estado]
    FOREIGN KEY ([cod_estado_pad]) REFERENCES [cat].[estado_PAD]([cod_estado_pad]);

ALTER TABLE [pad].[cambios_PAD] ADD CONSTRAINT [FK_cambiosPAD_PAD]
    FOREIGN KEY ([cod_pad]) REFERENCES [pad].[PAD]([cod_pad]);

ALTER TABLE [pad].[cambios_PAD] ADD CONSTRAINT [FK_cambiosPAD_TipoMov]
    FOREIGN KEY ([cod_tip_mov]) REFERENCES [cat].[tipo_movimiento]([cod_tip_mov]);

ALTER TABLE [pad].[cambios_PAD] ADD CONSTRAINT [FK_cambiosPAD_Resultado]
    FOREIGN KEY ([cod_resultado]) REFERENCES [pad].[Eventos_Resultado]([cod_evento]);

ALTER TABLE [pad].[expedientes_cambio] ADD CONSTRAINT [FK_expCambio_Cambio]
    FOREIGN KEY ([cod_cambio]) REFERENCES [pad].[cambios_PAD]([cod_cambio]);

ALTER TABLE [pad].[montos_referencia] ADD CONSTRAINT [FK_montosRef_Nivel]
    FOREIGN KEY ([cod_nivel]) REFERENCES [cat].[Nivel]([cod_nivel]);

ALTER TABLE [pad].[ejecucion_mensual] ADD CONSTRAINT [FK_ejecMensual_PAD]
    FOREIGN KEY ([cod_pad]) REFERENCES [pad].[PAD]([cod_pad]);

ALTER TABLE [pad].[resultados_deportista] ADD CONSTRAINT [FK_resultDep_Deportista]
    FOREIGN KEY ([cod_deportista]) REFERENCES [pad].[Deportistas]([cod_deportista]);

ALTER TABLE [pad].[resultados_deportista] ADD CONSTRAINT [FK_resultDep_Evento]
    FOREIGN KEY ([cod_evento]) REFERENCES [pad].[Eventos_Resultado]([cod_evento]);
GO

-- ============================================================
-- VERIFICACIÓN FINAL
-- ============================================================
-- Columnas pendientes (debe ser 0)
SELECT COUNT(*) AS columnas_pendientes
FROM sys.columns c
JOIN sys.tables t ON c.object_id = t.object_id
WHERE c.collation_name IS NOT NULL
  AND c.collation_name <> 'Latin1_General_CI_AI';
GO

-- Test accent-insensitive: buscar sin tilde debe encontrar datos con tilde
-- 'FEDERACION' debe encontrar 'FEDERACIÓN DE ATLETISMO DEL PERU', etc.
SELECT nombre FROM pad.Asociacion_Deportiva
WHERE nombre LIKE '%FEDERACION%';
GO
