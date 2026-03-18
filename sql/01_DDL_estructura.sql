-- ============================================================
-- PAD_IPD Database — Complete DDL Structure
-- Version: 1.0 | Date: 2026-03-17
-- SQL Server 2025 Express
-- ============================================================

CREATE DATABASE PAD_IPD;
GO

USE PAD_IPD;
GO

-- Schemas
CREATE SCHEMA cat;
GO
CREATE SCHEMA pad;
GO
CREATE SCHEMA gold;
GO

-- ============================================================
-- CATALOG TABLES (cat)
-- ============================================================

CREATE TABLE cat.tipo_PAD (
    cod_tipo_pad    VARCHAR(5)  NOT NULL,
    tipo_pad        VARCHAR(10) NOT NULL,
    descripcion     VARCHAR(60) NOT NULL,
    activo          BIT         NOT NULL DEFAULT 1,
    CONSTRAINT PK_tipo_PAD PRIMARY KEY (cod_tipo_pad)
);
GO

CREATE TABLE cat.estado_PAD (
    cod_estado_pad  VARCHAR(3)   NOT NULL,
    estado          VARCHAR(30)  NOT NULL,
    descripcion     VARCHAR(100) NOT NULL,
    CONSTRAINT PK_estado_PAD PRIMARY KEY (cod_estado_pad)
);
GO

CREATE TABLE cat.tipo_movimiento (
    cod_tip_mov     VARCHAR(7)   NOT NULL,
    tipo_movimiento VARCHAR(20)  NOT NULL,
    descripcion     VARCHAR(100) NOT NULL,
    CONSTRAINT PK_tipo_movimiento PRIMARY KEY (cod_tip_mov)
);
GO

CREATE TABLE cat.Nivel (
    cod_nivel       VARCHAR(10)  NOT NULL,
    nombre_nivel    VARCHAR(10)  NOT NULL,
    cod_tipo_pad    VARCHAR(5)   NOT NULL,
    pct_uit         DECIMAL(4,2) NULL,
    orden           INT          NOT NULL,
    activo          BIT          NOT NULL DEFAULT 1,
    normativa       VARCHAR(60)  NULL,
    CONSTRAINT PK_Nivel PRIMARY KEY (cod_nivel),
    CONSTRAINT FK_Nivel_tipoPAD FOREIGN KEY (cod_tipo_pad) REFERENCES cat.tipo_PAD(cod_tipo_pad)
);
GO

CREATE TABLE cat.ubigeo (
    cod_ubigeo      CHAR(6)     NOT NULL,
    departamento    VARCHAR(30) NOT NULL,
    provincia       VARCHAR(30) NOT NULL,
    distrito        VARCHAR(40) NOT NULL,
    CONSTRAINT PK_ubigeo PRIMARY KEY (cod_ubigeo)
);
GO

-- ============================================================
-- OPERATIONAL TABLES (pad)
-- ============================================================

CREATE TABLE pad.Asociacion_Deportiva (
    cod_asociacion    INT IDENTITY(1,1) NOT NULL,
    nombre            VARCHAR(80)  NOT NULL,
    nombre_formal     VARCHAR(150) NULL,
    tipo_organizacion VARCHAR(15)  NOT NULL DEFAULT 'FEDERACION',
    disciplina        VARCHAR(80)  NULL,
    es_grupo_trabajo  BIT          NOT NULL DEFAULT 0,
    activo            BIT          NOT NULL DEFAULT 1,
    CONSTRAINT PK_Asociacion_Deportiva PRIMARY KEY (cod_asociacion),
    CONSTRAINT UQ_Asociacion_Nombre UNIQUE (nombre),
    CONSTRAINT CK_Asociacion_TipoOrg CHECK (tipo_organizacion IN ('FEDERACION','ASOCIACION','COMITE'))
);
GO

CREATE TABLE pad.Deportistas (
    cod_deportista  INT IDENTITY(1,1) NOT NULL,
    num_documento   VARCHAR(12)  NOT NULL,
    tipo_documento  VARCHAR(3)   NOT NULL DEFAULT 'DNI',
    ap_paterno      VARCHAR(50)  NOT NULL,
    ap_materno      VARCHAR(50)  NULL,
    nombres         VARCHAR(50)  NOT NULL,
    sexo            CHAR(1)      NOT NULL,
    fecha_nac       DATE         NOT NULL,
    cod_asociacion  INT          NOT NULL,
    cod_ubigeo      CHAR(6)      NULL,
    num_cuenta      VARCHAR(20)  NULL,
    correo          VARCHAR(80)  NULL,
    telefono        VARCHAR(15)  NULL,
    agrupacion      CHAR(1)      NULL,
    activo          BIT          NOT NULL DEFAULT 1,
    fecha_registro  DATE         NOT NULL DEFAULT GETDATE(),
    CONSTRAINT PK_Deportistas PRIMARY KEY (cod_deportista),
    CONSTRAINT UQ_Deportistas_Documento UNIQUE (tipo_documento, num_documento),
    CONSTRAINT FK_Deportistas_Asociacion FOREIGN KEY (cod_asociacion) REFERENCES pad.Asociacion_Deportiva(cod_asociacion),
    CONSTRAINT FK_Deportistas_Ubigeo FOREIGN KEY (cod_ubigeo) REFERENCES cat.ubigeo(cod_ubigeo),
    CONSTRAINT CK_Deportistas_Sexo CHECK (sexo IN ('M','F')),
    CONSTRAINT CK_Deportistas_TipoDoc CHECK (tipo_documento IN ('DNI','CE','PAS','OTR'))
);
GO

CREATE TABLE pad.Apoderados (
    cod_apoderado   INT IDENTITY(1,1) NOT NULL,
    cod_deportista  INT          NOT NULL,
    num_documento   VARCHAR(12)  NOT NULL,
    tipo_documento  VARCHAR(3)   NOT NULL DEFAULT 'DNI',
    ap_paterno      VARCHAR(50)  NOT NULL,
    ap_materno      VARCHAR(50)  NULL,
    nombres         VARCHAR(50)  NOT NULL,
    parentesco      VARCHAR(20)  NOT NULL,
    telefono        VARCHAR(15)  NULL,
    activo          BIT          NOT NULL DEFAULT 1,
    CONSTRAINT PK_Apoderados PRIMARY KEY (cod_apoderado),
    CONSTRAINT FK_Apoderados_Deportista FOREIGN KEY (cod_deportista) REFERENCES pad.Deportistas(cod_deportista),
    CONSTRAINT CK_Apoderados_TipoDoc CHECK (tipo_documento IN ('DNI','CE','PAS','OTR'))
);
GO

CREATE TABLE pad.PAD (
    cod_pad         INT IDENTITY(1,1) NOT NULL,
    cod_deportista  INT          NOT NULL,
    cod_tipo_pad    VARCHAR(5)   NOT NULL,
    cod_nivel       VARCHAR(10)  NOT NULL,
    cod_estado_pad  VARCHAR(3)   NOT NULL DEFAULT 'ACT',
    es_permanente   BIT          NOT NULL DEFAULT 0,
    fecha_ingreso   DATE         NOT NULL,
    fecha_retiro    DATE         NULL,
    CONSTRAINT PK_PAD PRIMARY KEY (cod_pad),
    CONSTRAINT FK_PAD_Deportista FOREIGN KEY (cod_deportista) REFERENCES pad.Deportistas(cod_deportista),
    CONSTRAINT FK_PAD_TipoPAD FOREIGN KEY (cod_tipo_pad) REFERENCES cat.tipo_PAD(cod_tipo_pad),
    CONSTRAINT FK_PAD_Nivel FOREIGN KEY (cod_nivel) REFERENCES cat.Nivel(cod_nivel),
    CONSTRAINT FK_PAD_Estado FOREIGN KEY (cod_estado_pad) REFERENCES cat.estado_PAD(cod_estado_pad)
);
GO

CREATE TABLE pad.Eventos_Resultado (
    cod_evento              INT IDENTITY(1,1) NOT NULL,
    nombre_evento           VARCHAR(200)  NOT NULL,
    tipo_evento             VARCHAR(30)   NULL,
    fecha_inicio            DATE          NULL,
    fecha_fin               DATE          NULL,
    ciudad                  VARCHAR(80)   NULL,
    pais                    VARCHAR(50)   NULL,
    resolucion_autorizacion VARCHAR(60)   NULL,
    observaciones           VARCHAR(500)  NULL,
    CONSTRAINT PK_Eventos_Resultado PRIMARY KEY (cod_evento)
);
GO

CREATE TABLE pad.resultados_deportista (
    cod_resultado           INT IDENTITY(1,1) NOT NULL,
    cod_evento              INT           NOT NULL,
    cod_deportista          INT           NOT NULL,
    modalidad               VARCHAR(100)  NULL,
    categoria               VARCHAR(50)   NULL,
    resultado               VARCHAR(30)   NOT NULL,
    paises_participantes    INT           NULL,
    fecha_vencimiento       DATE          NULL,
    CONSTRAINT PK_resultados_deportista PRIMARY KEY (cod_resultado),
    CONSTRAINT FK_resultDep_Evento FOREIGN KEY (cod_evento) REFERENCES pad.Eventos_Resultado(cod_evento),
    CONSTRAINT FK_resultDep_Deportista FOREIGN KEY (cod_deportista) REFERENCES pad.Deportistas(cod_deportista),
    CONSTRAINT CK_resultDep_Resultado CHECK (resultado IN ('ORO','PLATA','BRONCE','PARTICIPACION','OTRO'))
);
GO

CREATE TABLE pad.cambios_PAD (
    cod_cambio          INT IDENTITY(1,1) NOT NULL,
    cod_pad             INT          NOT NULL,
    cod_tip_mov         VARCHAR(7)   NOT NULL,
    periodo_vigencia    VARCHAR(6)   NOT NULL,
    nro_informe         VARCHAR(30)  NULL,
    fecha_informe       DATE         NULL,
    motivo              VARCHAR(500) NULL,
    detalle_evento      VARCHAR(2000) NULL,
    nivel_anterior      VARCHAR(10)  NULL,
    nivel_nuevo         VARCHAR(10)  NULL,
    fecha_limite        DATE         NULL,
    ruta_documento      VARCHAR(500) NULL,
    observaciones       VARCHAR(500) NULL,
    cod_resultado       INT          NULL,
    CONSTRAINT PK_cambios_PAD PRIMARY KEY (cod_cambio),
    CONSTRAINT FK_cambiosPAD_PAD FOREIGN KEY (cod_pad) REFERENCES pad.PAD(cod_pad),
    CONSTRAINT FK_cambiosPAD_TipoMov FOREIGN KEY (cod_tip_mov) REFERENCES cat.tipo_movimiento(cod_tip_mov),
    CONSTRAINT FK_cambiosPAD_Resultado FOREIGN KEY (cod_resultado) REFERENCES pad.resultados_deportista(cod_resultado)
);
GO

CREATE TABLE pad.expedientes_cambio (
    cod_cambio      INT          NOT NULL,
    nro_expediente  VARCHAR(50)  NOT NULL,
    tipo_documento  VARCHAR(20)  NOT NULL,
    fecha_documento DATE         NULL,
    ruta_documento  VARCHAR(500) NULL,
    CONSTRAINT PK_expedientes_cambio PRIMARY KEY (cod_cambio, nro_expediente),
    CONSTRAINT FK_expCambio_Cambio FOREIGN KEY (cod_cambio) REFERENCES pad.cambios_PAD(cod_cambio),
    CONSTRAINT CK_expCambio_TipoDoc CHECK (tipo_documento IN ('INFORME','EXPEDIENTE','OFICIO','RESOLUCION','OTRO'))
);
GO

CREATE TABLE pad.montos_referencia (
    cod_nivel       VARCHAR(10)   NOT NULL,
    periodo_desde   VARCHAR(6)    NOT NULL,
    periodo_hasta   VARCHAR(6)    NULL,
    divisa          CHAR(1)       NOT NULL DEFAULT 'S',
    monto_base      DECIMAL(10,2) NOT NULL,
    tipo_cambio     DECIMAL(6,3)  NULL,
    monto_soles     DECIMAL(10,2) NOT NULL,
    normativa       VARCHAR(60)   NULL,
    CONSTRAINT PK_montos_referencia PRIMARY KEY (cod_nivel, periodo_desde),
    CONSTRAINT FK_montosRef_Nivel FOREIGN KEY (cod_nivel) REFERENCES cat.Nivel(cod_nivel),
    CONSTRAINT CK_montosRef_Divisa CHECK (divisa IN ('S','D'))
);
GO

CREATE TABLE pad.ejecucion_mensual (
    cod_ejecucion           INT IDENTITY(1,1) NOT NULL,
    cod_pad                 INT           NOT NULL,
    periodo                 VARCHAR(6)    NOT NULL,
    monto_pagado            DECIMAL(10,2) NOT NULL,
    nro_informe_consolidado VARCHAR(30)   NULL,
    nro_giro                VARCHAR(30)   NULL,
    CONSTRAINT PK_ejecucion_mensual PRIMARY KEY (cod_ejecucion),
    CONSTRAINT FK_ejecMensual_PAD FOREIGN KEY (cod_pad) REFERENCES pad.PAD(cod_pad),
    CONSTRAINT UQ_ejecMensual_PadPeriodo UNIQUE (cod_pad, periodo)
);
GO

-- ============================================================
-- GOLD VIEWS
-- ============================================================

CREATE VIEW gold.v_deportistas_activos AS
SELECT p.cod_pad, d.num_documento, d.tipo_documento,
    d.ap_paterno + ' ' + ISNULL(d.ap_materno,'') + ', ' + d.nombres AS deportista,
    d.sexo, d.fecha_nac, a.nombre AS asociacion, tp.tipo_pad,
    n.nombre_nivel AS nivel, n.orden AS nivel_orden, ep.estado,
    p.es_permanente, p.fecha_ingreso, u.departamento, u.provincia, u.distrito, d.num_cuenta
FROM pad.PAD p
JOIN pad.Deportistas d ON p.cod_deportista = d.cod_deportista
JOIN pad.Asociacion_Deportiva a ON d.cod_asociacion = a.cod_asociacion
JOIN cat.tipo_PAD tp ON p.cod_tipo_pad = tp.cod_tipo_pad
JOIN cat.Nivel n ON p.cod_nivel = n.cod_nivel
JOIN cat.estado_PAD ep ON p.cod_estado_pad = ep.cod_estado_pad
LEFT JOIN cat.ubigeo u ON d.cod_ubigeo = u.cod_ubigeo
WHERE p.cod_estado_pad IN ('ACT','LES','LSS');
GO

CREATE VIEW gold.v_resumen_mensual AS
SELECT e.periodo, tp.tipo_pad, n.nombre_nivel AS nivel, n.orden,
    COUNT(*) AS cantidad_deportistas, SUM(e.monto_pagado) AS total_pagado
FROM pad.ejecucion_mensual e
JOIN pad.PAD p ON e.cod_pad = p.cod_pad
JOIN cat.tipo_PAD tp ON p.cod_tipo_pad = tp.cod_tipo_pad
JOIN cat.Nivel n ON p.cod_nivel = n.cod_nivel
GROUP BY e.periodo, tp.tipo_pad, n.nombre_nivel, n.orden;
GO

CREATE VIEW gold.v_consolidado_economico AS
SELECT e.periodo, tp.tipo_pad, a.nombre AS federacion,
    d.ap_paterno + ' ' + ISNULL(d.ap_materno,'') + ', ' + d.nombres AS deportista,
    d.num_cuenta, d.num_documento, d.tipo_documento, n.nombre_nivel AS nivel,
    e.monto_pagado,
    ap.num_documento AS dni_apoderado,
    ap.ap_paterno + ' ' + ISNULL(ap.ap_materno,'') + ', ' + ap.nombres AS apoderado,
    u.departamento AS region
FROM pad.ejecucion_mensual e
JOIN pad.PAD p ON e.cod_pad = p.cod_pad
JOIN pad.Deportistas d ON p.cod_deportista = d.cod_deportista
JOIN pad.Asociacion_Deportiva a ON d.cod_asociacion = a.cod_asociacion
JOIN cat.tipo_PAD tp ON p.cod_tipo_pad = tp.cod_tipo_pad
JOIN cat.Nivel n ON p.cod_nivel = n.cod_nivel
LEFT JOIN cat.ubigeo u ON d.cod_ubigeo = u.cod_ubigeo
LEFT JOIN pad.Apoderados ap ON d.cod_deportista = ap.cod_deportista AND ap.activo = 1;
GO

CREATE VIEW gold.v_consolidado_tecnico AS
SELECT c.periodo_vigencia AS periodo, tp.tipo_pad, tp.cod_tipo_pad,
    CASE WHEN c.cod_tip_mov = 'ING' THEN '1-INGRESOS'
         WHEN c.cod_tip_mov = 'CAMBNIV' THEN '2-CAMBIOS'
         WHEN c.cod_tip_mov = 'RET' THEN '3-RETIROS'
    END AS seccion,
    a.nombre AS federacion,
    d.ap_paterno + ' ' + ISNULL(d.ap_materno,'') + ', ' + d.nombres AS deportista,
    tm.tipo_movimiento AS estado, n.nombre_nivel AS nivel,
    c.nivel_anterior, c.nivel_nuevo
FROM pad.cambios_PAD c
JOIN pad.PAD p ON c.cod_pad = p.cod_pad
JOIN pad.Deportistas d ON p.cod_deportista = d.cod_deportista
JOIN pad.Asociacion_Deportiva a ON d.cod_asociacion = a.cod_asociacion
JOIN cat.tipo_PAD tp ON p.cod_tipo_pad = tp.cod_tipo_pad
JOIN cat.Nivel n ON p.cod_nivel = n.cod_nivel
JOIN cat.tipo_movimiento tm ON c.cod_tip_mov = tm.cod_tip_mov
UNION ALL
SELECT e.periodo, tp.tipo_pad, tp.cod_tipo_pad, '4-CONSOLIDADO',
    a.nombre, d.ap_paterno + ' ' + ISNULL(d.ap_materno,'') + ', ' + d.nombres,
    ep.estado, n.nombre_nivel, NULL, NULL
FROM pad.ejecucion_mensual e
JOIN pad.PAD p ON e.cod_pad = p.cod_pad
JOIN pad.Deportistas d ON p.cod_deportista = d.cod_deportista
JOIN pad.Asociacion_Deportiva a ON d.cod_asociacion = a.cod_asociacion
JOIN cat.tipo_PAD tp ON p.cod_tipo_pad = tp.cod_tipo_pad
JOIN cat.Nivel n ON p.cod_nivel = n.cod_nivel
JOIN cat.estado_PAD ep ON p.cod_estado_pad = ep.cod_estado_pad;
GO

CREATE VIEW gold.v_registro_cambios_pad AS
SELECT c.periodo_vigencia, tp.tipo_pad AS programa, tm.tipo_movimiento AS estado,
    a.nombre AS federacion,
    d.ap_paterno + ' ' + ISNULL(d.ap_materno,'') + ', ' + d.nombres AS apellidos_y_nombres,
    d.num_documento AS dni,
    CASE WHEN c.cod_tip_mov = 'CAMBNIV' THEN c.nivel_anterior + ' -> ' + c.nivel_nuevo
         ELSE n.nombre_nivel END AS nivel,
    c.nro_informe AS nro_inf, c.motivo, c.detalle_evento
FROM pad.cambios_PAD c
JOIN pad.PAD p ON c.cod_pad = p.cod_pad
JOIN pad.Deportistas d ON p.cod_deportista = d.cod_deportista
JOIN pad.Asociacion_Deportiva a ON d.cod_asociacion = a.cod_asociacion
JOIN cat.tipo_PAD tp ON p.cod_tipo_pad = tp.cod_tipo_pad
JOIN cat.Nivel n ON p.cod_nivel = n.cod_nivel
JOIN cat.tipo_movimiento tm ON c.cod_tip_mov = tm.cod_tip_mov;
GO

CREATE VIEW gold.v_movimientos_mes AS
SELECT c.periodo_vigencia, tp.tipo_pad, tm.tipo_movimiento, a.nombre AS federacion,
    d.ap_paterno + ' ' + ISNULL(d.ap_materno,'') + ', ' + d.nombres AS deportista,
    d.num_documento, n.nombre_nivel AS nivel_actual,
    c.nivel_anterior, c.nivel_nuevo, c.nro_informe, c.motivo, c.detalle_evento
FROM pad.cambios_PAD c
JOIN pad.PAD p ON c.cod_pad = p.cod_pad
JOIN pad.Deportistas d ON p.cod_deportista = d.cod_deportista
JOIN pad.Asociacion_Deportiva a ON d.cod_asociacion = a.cod_asociacion
JOIN cat.tipo_PAD tp ON p.cod_tipo_pad = tp.cod_tipo_pad
JOIN cat.Nivel n ON p.cod_nivel = n.cod_nivel
JOIN cat.tipo_movimiento tm ON c.cod_tip_mov = tm.cod_tip_mov;
GO

CREATE VIEW gold.kpi_deportistas_asociacion_periodo AS
SELECT e.periodo, a.nombre AS asociacion, tp.tipo_pad,
    COUNT(DISTINCT p.cod_deportista) AS total_deportistas,
    SUM(e.monto_pagado) AS total_pagado
FROM pad.ejecucion_mensual e
JOIN pad.PAD p ON e.cod_pad = p.cod_pad
JOIN pad.Deportistas d ON p.cod_deportista = d.cod_deportista
JOIN pad.Asociacion_Deportiva a ON d.cod_asociacion = a.cod_asociacion
JOIN cat.tipo_PAD tp ON p.cod_tipo_pad = tp.cod_tipo_pad
GROUP BY e.periodo, a.nombre, tp.tipo_pad;
GO

CREATE VIEW gold.kpi_riesgo_pago_indebido AS
SELECT e.periodo,
    d.ap_paterno + ' ' + ISNULL(d.ap_materno,'') + ', ' + d.nombres AS deportista,
    d.num_documento, tp.tipo_pad, e.monto_pagado, p.cod_estado_pad, p.fecha_retiro
FROM pad.ejecucion_mensual e
JOIN pad.PAD p ON e.cod_pad = p.cod_pad
JOIN pad.Deportistas d ON p.cod_deportista = d.cod_deportista
JOIN cat.tipo_PAD tp ON p.cod_tipo_pad = tp.cod_tipo_pad
WHERE p.cod_estado_pad = 'RET' AND e.periodo > FORMAT(p.fecha_retiro, 'yyyyMM');
GO
