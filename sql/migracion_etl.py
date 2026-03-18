"""
PAD_IPD — Script de Migración ETL
Fase 1: Deportistas (reporte_deportistas_pad.xlsx / dep_pad)
Fase 2: PAD + Ejecución Mensual (PAD - BD.xlsx / matriz_pad)

Autor: Claude (Opus 4.6) | Fecha: 2026-03-17
"""

import pandas as pd
import pyodbc
import math
import sys
import unicodedata
from datetime import datetime, date

def normalizar(texto):
    """Quita tildes y convierte a mayúsculas para comparación."""
    if not texto:
        return ''
    nfkd = unicodedata.normalize('NFKD', texto)
    ascii_str = ''.join(c for c in nfkd if not unicodedata.combining(c))
    return ascii_str.upper().strip()

# ============================================================
# CONFIGURACIÓN
# ============================================================
CONN_STR = (
    "DRIVER={ODBC Driver 18 for SQL Server};"
    "SERVER=localhost,1433;"
    "DATABASE=PAD_IPD;"
    "UID=sa;"
    "PWD=Ruben71972481*;"
    "TrustServerCertificate=yes;"
)

DATA_DIR = r"C:\Users\apoyo19dinadaf\Documents\Proyectos-Claude\PAD_IPD\data"
DEPORTISTAS_FILE = DATA_DIR + r"\reporte_deportistas_pad.xlsx"
MATRIZ_FILE      = DATA_DIR + r"\PAD - BD.xlsx"

BATCH_SIZE = 500  # registros por lote de inserción

# ============================================================
# MAPEOS
# ============================================================

# Nombres de federación en Excel → nombre en BD (después de strip)
FED_MAP = {
    'TAEKWONDO':         'TAE KWON DO',
    'DEPORTES ECUESTRES':'ECUESTRE',
    'FEDEPOL':           'POLICÍAS Y BOMBEROS',
    'NATACIÓN':          'DEPORTES ACUÁTICOS',  # renombrada recientemente
    'NATACION':          'DEPORTES ACUÁTICOS',
}

# Sexo texto → código
SEXO_MAP = {
    'MASCULINO': 'M',
    'FEMENINO':  'F',
}

# Tipo PAD texto → cod_tipo_pad
TIPO_PAD_MAP = {
    'PAD I':  'PAD1',
    'PAD II': 'PAD2',
    'PNM':    'PNM',
}

def get_cod_nivel(tipo_pad_txt, nivel_txt):
    """Construye cod_nivel a partir del texto de pad y nivel."""
    prefijos = {'PAD I': 'P1', 'PAD II': 'P2', 'PNM': 'PNM'}
    prefix = prefijos.get(tipo_pad_txt, 'P1')
    return f"{prefix}-{nivel_txt}"

def periodo_a_fecha_fin(periodo_str):
    """Convierte '201301' al último día del mes como date."""
    anio = int(periodo_str[:4])
    mes  = int(periodo_str[4:])
    if mes == 12:
        return date(anio + 1, 1, 1) - pd.Timedelta(days=1).to_pytimedelta()
    return date(anio, mes + 1, 1) - pd.Timedelta(days=1).to_pytimedelta()

def safe_str(val, max_len=None):
    """Convierte a string limpio o None."""
    if val is None or (isinstance(val, float) and math.isnan(val)):
        return None
    s = str(val).strip()
    if s == '' or s.lower() == 'nan':
        return None
    if max_len:
        s = s[:max_len]
    return s

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)

# ============================================================
# CONEXIÓN
# ============================================================
def conectar():
    conn = pyodbc.connect(CONN_STR)
    conn.autocommit = False
    return conn

# ============================================================
# FASE 0: AGREGAR ASOCIACIONES HISTÓRICAS FALTANTES
# ============================================================
def insertar_asociaciones_historicas(conn):
    log("FASE 0: Verificando asociaciones históricas faltantes...")
    cursor = conn.cursor()

    asociaciones_nuevas = [
        # (nombre, nombre_formal, tipo_organizacion, disciplina)
        ('BREAKING',          'BREAKING (HISTÓRICO)',          'FEDERACION', 'Breaking'),
        ('DEPORTES DE INVIERNO', 'DEPORTES DE INVIERNO (HISTÓRICO)', 'FEDERACION', 'Deportes de Invierno'),
    ]

    for nombre, nombre_formal, tipo_org, disciplina in asociaciones_nuevas:
        cursor.execute(
            "SELECT COUNT(*) FROM pad.Asociacion_Deportiva WHERE nombre = ?", nombre
        )
        if cursor.fetchone()[0] == 0:
            cursor.execute(
                """INSERT INTO pad.Asociacion_Deportiva
                   (nombre, nombre_formal, tipo_organizacion, disciplina)
                   VALUES (?, ?, ?, ?)""",
                nombre, nombre_formal, tipo_org, disciplina
            )
            log(f"  + Insertada: {nombre}")
        else:
            log(f"  = Ya existe: {nombre}")

    conn.commit()

# ============================================================
# CARGA DEL CATÁLOGO DE ASOCIACIONES DESDE LA BD
# ============================================================
def cargar_mapa_asociaciones(conn):
    cursor = conn.cursor()
    cursor.execute("SELECT cod_asociacion, nombre FROM pad.Asociacion_Deportiva")
    mapa = {}
    for cod, nombre in cursor.fetchall():
        mapa[nombre.strip().upper()] = cod       # clave exacta
        mapa[normalizar(nombre)] = cod            # clave sin tildes (fallback)
    return mapa

# ============================================================
# FASE 1: MIGRACIÓN DE DEPORTISTAS
# ============================================================
def migrar_deportistas(conn):
    log("FASE 1: Leyendo deportistas desde Excel...")
    df = pd.read_excel(DEPORTISTAS_FILE, sheet_name='dep_pad', dtype=str)
    df.columns = df.columns.str.strip()
    log(f"  Filas leídas: {len(df)}")

    mapa_asoc = cargar_mapa_asociaciones(conn)
    cursor    = conn.cursor()

    sin_mapeo  = set()
    insertados = 0
    omitidos   = 0
    errores    = 0

    for _, row in df.iterrows():
        # --- Federación → cod_asociacion ---
        fed_raw  = safe_str(row.get('federacion', ''))
        fed_norm = FED_MAP.get(fed_raw, fed_raw) if fed_raw else None
        if fed_norm:
            # Intentar primero exacto, luego sin tildes
            cod_asoc = (mapa_asoc.get(fed_norm.strip().upper())
                        or mapa_asoc.get(normalizar(fed_norm)))
        else:
            cod_asoc = None
        if cod_asoc is None:
            sin_mapeo.add(fed_raw)

        # --- Ubigeo ---
        ubigeo_raw = safe_str(row.get('Columna1', ''))
        cod_ubigeo = ubigeo_raw.zfill(6) if ubigeo_raw and ubigeo_raw.isdigit() else None

        # --- Sexo ---
        sexo_txt = safe_str(row.get('sexo', ''))
        sexo     = SEXO_MAP.get(sexo_txt.upper() if sexo_txt else '', None)

        # --- Fecha nacimiento ---
        fecha_nac_raw = safe_str(row.get('fecha_nac', ''))
        try:
            fecha_nac = pd.to_datetime(fecha_nac_raw).date() if fecha_nac_raw else None
        except Exception:
            fecha_nac = None

        # --- Agrupación (normalizar P→p) ---
        agrupacion_raw = safe_str(row.get('agrupacion', ''))
        agrupacion = agrupacion_raw.lower()[0] if agrupacion_raw else None

        # --- Teléfono (celular > fijo) ---
        tel = safe_str(row.get('t_celular', '')) or safe_str(row.get('t_fijo', ''))

        campos = {
            'num_documento':  safe_str(row.get('doc_ident', ''), 12),
            'tipo_documento': 'DNI',
            'ap_paterno':     safe_str(row.get('ap_paterno', ''), 50),
            'ap_materno':     safe_str(row.get('ap_materno', ''), 50),
            'nombres':        safe_str(row.get('nombres', ''), 50),
            'sexo':           sexo,
            'fecha_nac':      fecha_nac,
            'cod_asociacion': cod_asoc,
            'cod_ubigeo':     cod_ubigeo,
            'correo':         safe_str(row.get('correo', ''), 80),
            'telefono':       safe_str(tel, 15),
            'agrupacion':     agrupacion,
            'activo':         1,
            'fecha_registro': date.today(),
        }

        if not campos['num_documento'] or not campos['nombres']:
            omitidos += 1
            continue

        try:
            cursor.execute("""
                IF NOT EXISTS (
                    SELECT 1 FROM pad.Deportistas
                    WHERE num_documento = ? AND tipo_documento = ?
                )
                INSERT INTO pad.Deportistas (
                    num_documento, tipo_documento, ap_paterno, ap_materno,
                    nombres, sexo, fecha_nac, cod_asociacion, cod_ubigeo,
                    correo, telefono, agrupacion, activo, fecha_registro
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            campos['num_documento'], campos['tipo_documento'],
            campos['num_documento'], campos['tipo_documento'],
            campos['ap_paterno'], campos['ap_materno'],
            campos['nombres'], campos['sexo'], campos['fecha_nac'],
            campos['cod_asociacion'], campos['cod_ubigeo'],
            campos['correo'], campos['telefono'], campos['agrupacion'],
            campos['activo'], campos['fecha_registro']
            )
            insertados += 1
        except pyodbc.IntegrityError as e:
            # FK ubigeo inválido: reintentar sin ubigeo
            if 'FK_Deportistas_Ubigeo' in str(e):
                try:
                    cursor.execute("""
                        IF NOT EXISTS (
                            SELECT 1 FROM pad.Deportistas
                            WHERE num_documento = ? AND tipo_documento = ?
                        )
                        INSERT INTO pad.Deportistas (
                            num_documento, tipo_documento, ap_paterno, ap_materno,
                            nombres, sexo, fecha_nac, cod_asociacion, cod_ubigeo,
                            correo, telefono, agrupacion, activo, fecha_registro
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    campos['num_documento'], campos['tipo_documento'],
                    campos['num_documento'], campos['tipo_documento'],
                    campos['ap_paterno'], campos['ap_materno'],
                    campos['nombres'], campos['sexo'], campos['fecha_nac'],
                    campos['cod_asociacion'], None,  # ubigeo NULL
                    campos['correo'], campos['telefono'], campos['agrupacion'],
                    campos['activo'], campos['fecha_registro']
                    )
                    insertados += 1
                    log(f"  AVISO DNI {campos['num_documento']}: ubigeo {campos['cod_ubigeo']} no encontrado, insertado sin ubigeo")
                except Exception as e2:
                    errores += 1
                    log(f"  ERROR DNI {campos['num_documento']}: {e2}")
            else:
                errores += 1
                log(f"  ERROR fila DNI {campos['num_documento']}: {e}")
        except Exception as e:
            errores += 1
            log(f"  ERROR fila DNI {campos['num_documento']}: {e}")

        if insertados % BATCH_SIZE == 0:
            conn.commit()
            log(f"  ... {insertados} deportistas insertados")

    conn.commit()

    if sin_mapeo:
        log(f"  ADVERTENCIA — Federaciones sin mapeo: {sin_mapeo}")
    log(f"  RESULTADO: {insertados} insertados | {omitidos} omitidos | {errores} errores")
    return insertados

# ============================================================
# FASE 2: MIGRACIÓN DE PAD + EJECUCIÓN MENSUAL
# ============================================================
def migrar_pad_ejecucion(conn):
    log("FASE 2: Leyendo matriz_pad desde Excel...")
    df = pd.read_excel(MATRIZ_FILE, sheet_name='matriz_pad', dtype=str)
    df.columns = df.columns.str.strip()

    # Normalizar columna federacion (puede tener tilde en el nombre)
    col_fed = [c for c in df.columns if 'ederal' in c or 'ederac' in c][0]
    df.rename(columns={col_fed: 'federacion'}, inplace=True)

    log(f"  Filas leídas: {len(df)}")

    cursor = conn.cursor()

    # Recargar mapa asociaciones con normalización (por si acaso en fase 2)
    mapa_asoc = cargar_mapa_asociaciones(conn)

    # --- Cargar mapa DNI → cod_deportista ---
    cursor.execute("SELECT num_documento, cod_deportista FROM pad.Deportistas WHERE tipo_documento='DNI'")
    mapa_dep = {row[0]: row[1] for row in cursor.fetchall()}
    log(f"  Deportistas en BD: {len(mapa_dep)}")

    sin_deportista = set()
    sin_nivel      = set()
    pad_creados    = 0
    ejec_insert    = 0
    ejec_omit      = 0
    errores        = 0

    # --- Cache de PAD records creados: (cod_dep, cod_tipo_pad, cod_nivel) → cod_pad ---
    mapa_pad = {}

    # Cargar PAD records ya existentes
    cursor.execute("SELECT cod_deportista, cod_tipo_pad, cod_nivel, cod_pad FROM pad.PAD")
    for cod_dep, cod_tipo, cod_niv, cod_pad in cursor.fetchall():
        mapa_pad[(cod_dep, cod_tipo, cod_niv)] = cod_pad

    # --- Determinar últimos periodos por deportista para estado ACT/RET ---
    df['periodo'] = df['año'].str.zfill(4) + df['mes'].str.zfill(2)

    ultimo_periodo_dep = (
        df.groupby('dni')['periodo'].max().to_dict()
    )
    PERIODO_ACTIVO = '202501'  # si último periodo >= este, es ACT

    for idx, row in df.iterrows():
        dni         = safe_str(row.get('dni', ''))
        tipo_pad_txt = safe_str(row.get('pad', ''))
        nivel_txt    = safe_str(row.get('nivel', ''))
        periodo      = safe_str(row.get('periodo', ''))
        monto_txt    = safe_str(row.get('monto', ''))

        if not dni or not tipo_pad_txt or not nivel_txt or not periodo:
            ejec_omit += 1
            continue

        cod_dep = mapa_dep.get(dni)
        if cod_dep is None:
            sin_deportista.add(dni)
            ejec_omit += 1
            continue

        cod_tipo_pad = TIPO_PAD_MAP.get(tipo_pad_txt)
        if not cod_tipo_pad:
            ejec_omit += 1
            continue

        cod_nivel = get_cod_nivel(tipo_pad_txt, nivel_txt)

        # --- Crear PAD record si no existe ---
        key_pad = (cod_dep, cod_tipo_pad, cod_nivel)
        if key_pad not in mapa_pad:
            # Determinar estado
            ultimo = ultimo_periodo_dep.get(dni, '0')
            cod_estado = 'ACT' if ultimo >= PERIODO_ACTIVO else 'RET'
            # fecha_ingreso = primera aparición (aproximación: usar periodo actual)
            fecha_ingreso_raw = f"{periodo[:4]}-{periodo[4:]}-01"
            try:
                fecha_ingreso = datetime.strptime(fecha_ingreso_raw, '%Y-%m-%d').date()
            except Exception:
                fecha_ingreso = date.today()

            try:
                cursor.execute("""
                    INSERT INTO pad.PAD (
                        cod_deportista, cod_tipo_pad, cod_nivel,
                        cod_estado_pad, es_permanente, fecha_ingreso
                    )
                    OUTPUT INSERTED.cod_pad
                    VALUES (?, ?, ?, ?, 0, ?)
                """, cod_dep, cod_tipo_pad, cod_nivel, cod_estado, fecha_ingreso)
                row_result = cursor.fetchone()
                if row_result:
                    cod_pad = row_result[0]
                    mapa_pad[key_pad] = cod_pad
                    pad_creados += 1
                else:
                    ejec_omit += 1
                    continue
            except Exception as e:
                errores += 1
                if errores <= 5:
                    log(f"  ERROR PAD DNI {dni} nivel {cod_nivel}: {e}")
                ejec_omit += 1
                continue
        else:
            cod_pad = mapa_pad[key_pad]

        # --- Insertar ejecucion_mensual ---
        try:
            monto = float(monto_txt) if monto_txt else None
        except Exception:
            monto = None

        try:
            cursor.execute("""
                IF NOT EXISTS (
                    SELECT 1 FROM pad.ejecucion_mensual
                    WHERE cod_pad = ? AND periodo = ?
                )
                INSERT INTO pad.ejecucion_mensual (cod_pad, periodo, monto_pagado)
                VALUES (?, ?, ?)
            """, cod_pad, periodo, cod_pad, periodo, monto)
            ejec_insert += 1
        except Exception as e:
            errores += 1
            if errores <= 5:
                log(f"  ERROR ejecucion DNI {dni} periodo {periodo}: {e}")
            ejec_omit += 1

        if ejec_insert % BATCH_SIZE == 0:
            conn.commit()
            log(f"  ... {ejec_insert} registros ejecucion insertados | {pad_creados} PAD creados")

    conn.commit()

    if sin_deportista:
        log(f"  DNIs no encontrados en BD ({len(sin_deportista)}): {list(sin_deportista)[:10]}...")
    if sin_nivel:
        log(f"  Niveles sin mapeo: {sin_nivel}")
    log(f"  RESULTADO PAD: {pad_creados} creados")
    log(f"  RESULTADO Ejecución: {ejec_insert} insertados | {ejec_omit} omitidos | {errores} errores")

# ============================================================
# VERIFICACIÓN FINAL
# ============================================================
def verificar(conn):
    log("VERIFICACIÓN FINAL:")
    cursor = conn.cursor()
    queries = [
        ("Deportistas", "SELECT COUNT(*) FROM pad.Deportistas"),
        ("PAD records", "SELECT COUNT(*) FROM pad.PAD"),
        ("Ejecución mensual", "SELECT COUNT(*) FROM pad.ejecucion_mensual"),
        ("PAD activos", "SELECT COUNT(*) FROM pad.PAD WHERE cod_estado_pad='ACT'"),
        ("PAD retirados", "SELECT COUNT(*) FROM pad.PAD WHERE cod_estado_pad='RET'"),
    ]
    for label, sql in queries:
        cursor.execute(sql)
        count = cursor.fetchone()[0]
        log(f"  {label}: {count:,}")

# ============================================================
# MAIN
# ============================================================
if __name__ == '__main__':
    log("=== INICIO MIGRACIÓN PAD_IPD ===")
    try:
        conn = conectar()
        log("Conexión exitosa a SQL Server.")

        insertar_asociaciones_historicas(conn)
        migrar_deportistas(conn)
        migrar_pad_ejecucion(conn)
        verificar(conn)

        conn.close()
        log("=== MIGRACIÓN COMPLETADA ===")
    except Exception as e:
        log(f"ERROR CRÍTICO: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
