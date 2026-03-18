"""
PAD_IPD — Migración de pad.cambios_PAD
Capa 1: Reconstrucción algorítmica desde PAD_BD (fuente confiable)
Capa 2: Enriquecimiento documental desde Excel Cambios PAD 2013-2026

Lógica de detección (Capa 1):
  - ING:     Primera aparición de (deportista, tipo_pad) en ejecucion_mensual
  - CAMBNIV: Cambio de cod_nivel entre registros consecutivos del mismo (deportista, tipo_pad)
  - RET:     Último registro de deportistas con cod_estado_pad='RET'

Autor: Claude (Opus 4.6) | Fecha: 2026-03-17
"""

import pandas as pd
import pyodbc
import unicodedata
import re
import sys
import math
from datetime import datetime, date

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

BATCH_SIZE = 500

def log(msg):
    try:
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)
    except UnicodeEncodeError:
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg.encode('ascii','replace').decode()}", flush=True)

def normalizar(texto):
    if not texto: return ''
    nfkd = unicodedata.normalize('NFKD', str(texto))
    return ''.join(c for c in nfkd if not unicodedata.combining(c)).upper().strip()

def safe_str(val, max_len=None):
    if val is None or (isinstance(val, float) and math.isnan(val)):
        return None
    s = str(val).strip()
    if s == '' or s.lower() == 'nan': return None
    return s[:max_len] if max_len else s

def periodo_siguiente(p):
    """Dado '202312' devuelve '202401'."""
    anio, mes = int(p[:4]), int(p[4:])
    mes += 1
    if mes > 12: anio += 1; mes = 1
    return f"{anio}{mes:02d}"

def periodo_a_date(p):
    """Convierte '202301' → date(2023,1,1)."""
    return date(int(p[:4]), int(p[4:]), 1)

# ============================================================
# CAPA 1: RECONSTRUCCIÓN DESDE PAD_BD
# ============================================================
def reconstruir_cambios(conn):
    log("CAPA 1: Cargando ejecucion_mensual desde BD...")
    query = """
        SELECT
            d.cod_deportista,
            d.num_documento AS dni,
            p.cod_pad,
            p.cod_tipo_pad,
            p.cod_nivel,
            p.cod_estado_pad,
            em.periodo
        FROM pad.ejecucion_mensual em
        JOIN pad.PAD p ON em.cod_pad = p.cod_pad
        JOIN pad.Deportistas d ON p.cod_deportista = d.cod_deportista
        ORDER BY d.cod_deportista, p.cod_tipo_pad, em.periodo
    """
    df = pd.read_sql(query, conn)
    log(f"  Registros cargados: {len(df):,}")

    cambios = []  # lista de dicts para insertar

    # Procesar por deportista + tipo_pad
    for (cod_dep, cod_tipo_pad), grupo in df.groupby(['cod_deportista', 'cod_tipo_pad']):
        grupo = grupo.sort_values('periodo').reset_index(drop=True)

        for i, row in grupo.iterrows():
            periodo_actual = row['periodo']
            cod_pad_actual = row['cod_pad']
            nivel_actual   = row['cod_nivel']

            if i == 0:
                # ── ING: primera aparición ──
                cambios.append({
                    'cod_pad':          int(cod_pad_actual),
                    'cod_tip_mov':      'ING',
                    'periodo_vigencia': str(periodo_actual),
                    'nivel_anterior':   None,
                    'nivel_nuevo':      None,
                    'motivo':           'Reconstruido desde PAD_BD',
                })
            else:
                periodo_anterior = str(grupo.loc[i-1, 'periodo'])
                nivel_anterior   = str(grupo.loc[i-1, 'cod_nivel'])

                # ── CAMBNIV: cambio de nivel ──
                if nivel_actual != nivel_anterior:
                    cambios.append({
                        'cod_pad':          int(cod_pad_actual),
                        'cod_tip_mov':      'CAMBNIV',
                        'periodo_vigencia': str(periodo_actual),
                        'nivel_anterior':   nivel_anterior,
                        'nivel_nuevo':      str(nivel_actual),
                        'motivo':           'Reconstruido desde PAD_BD',
                    })

                # ── Gap > 1 mes: reingreso ──
                if periodo_siguiente(periodo_anterior) != periodo_actual:
                    if nivel_actual == nivel_anterior:
                        cambios.append({
                            'cod_pad':          int(cod_pad_actual),
                            'cod_tip_mov':      'ING',
                            'periodo_vigencia': str(periodo_actual),
                            'nivel_anterior':   None,
                            'nivel_nuevo':      None,
                            'motivo':           'Reconstruido desde PAD_BD',
                            'observaciones':    f'Reingreso detectado (gap desde {periodo_anterior})',
                        })

        # ── RET: un registro por cada cod_pad retirado ──
        for cod_pad_ret, subgrupo in grupo[grupo['cod_estado_pad'] == 'RET'].groupby('cod_pad'):
            ultimo_ret = subgrupo.sort_values('periodo').iloc[-1]
            cambios.append({
                'cod_pad':          int(cod_pad_ret),
                'cod_tip_mov':      'RET',
                'periodo_vigencia': ultimo_ret['periodo'],
                'nivel_anterior':   None,
                'nivel_nuevo':      None,
                'motivo':           'Reconstruido desde PAD_BD',
            })

    log(f"  Cambios detectados: {len(cambios):,}")
    return cambios

# ============================================================
# CAPA 2: ENRIQUECIMIENTO DESDE EXCEL
# ============================================================
ESTADO_MAP = {
    'INGRESO': 'ING',
    'RETIRO':  'RET',
    'CAMBIO':  'CAMBNIV',
    'CAMBIO DE PAD I A PAD II': 'CAMBNIV',
    'CAMBIO DE PAD II A PAD I': 'CAMBNIV',
}

def parsear_nivel_cambio(nivel_str):
    """Extrae (nivel_anterior, nivel_nuevo) de strings como 'III -> V', 'IV - II', 'IV-III'."""
    if not nivel_str: return None, None
    for sep in [' \u2192 ', ' -> ', ' - ', '-']:
        if sep in nivel_str:
            partes = nivel_str.split(sep, 1)
            return partes[0].strip(), partes[1].strip()
    return None, nivel_str.strip()

def leer_hoja_cambios(filepath, sheet_name, anio):
    """Lee una hoja de Cambios PAD y retorna DataFrame normalizado."""
    try:
        df = pd.read_excel(filepath, sheet_name=sheet_name, dtype=str, header=0)
        df.columns = [str(c).strip() for c in df.columns]

        # Eliminar filas completamente vacías
        df = df.dropna(how='all').reset_index(drop=True)

        # Resolver columnas duplicadas añadiendo sufijo numérico
        cols = list(df.columns)
        seen = {}
        new_cols = []
        for c in cols:
            if c in seen:
                seen[c] += 1
                new_cols.append(f"{c}_{seen[c]}")
            else:
                seen[c] = 0
                new_cols.append(c)
        df.columns = new_cols

        # Mapear columnas a nombres estándar
        col_map = {}
        for c in df.columns:
            cn = c.upper().strip()
            if 'DNI' in cn:                             col_map[c] = 'dni'
            elif 'ESTADO' in cn:                        col_map[c] = 'estado'
            elif 'PROGRAMA' in cn or cn == 'PAD':       col_map[c] = 'programa'
            elif 'APELLIDO' in cn or 'NOMBRE' in cn:    col_map[c] = 'nombre_completo'
            elif 'NIVEL' in cn:                         col_map[c] = 'nivel'
            elif 'NRO. INF' in cn or 'INFORME' in cn:  col_map[c] = 'nro_informe'
            elif 'NRO. EXP' in cn or 'EXPEDIENTE' in cn: col_map[c] = 'nro_expediente'
            elif 'MOTIVO' in cn and 'DETALLE' in cn:    col_map[c] = 'detalle_evento'
            elif 'MOTIVO' in cn:                        col_map[c] = 'motivo'
            elif 'FECHA' in cn and 'INFORME' in cn:     col_map[c] = 'fecha_informe'
            elif 'FECHA' in cn and 'EXPEDIENTE' in cn:  col_map[c] = 'fecha_expediente'
            elif 'MES' in cn:                           col_map[c] = 'mes'
            elif 'FEDERACI' in cn:                      col_map[c] = 'federacion'

        df = df.rename(columns=col_map)

        # Resolver duplicados post-rename
        cols2 = list(df.columns)
        seen2 = {}
        new_cols2 = []
        for c in cols2:
            if c in seen2:
                seen2[c] += 1
                new_cols2.append(f"{c}_{seen2[c]}")
            else:
                seen2[c] = 0
                new_cols2.append(c)
        df.columns = new_cols2

        df['_anio'] = str(anio)

        # Normalizar estado
        if 'estado' in df.columns:
            df['tipo_mov'] = df['estado'].apply(
                lambda x: ESTADO_MAP.get(safe_str(x, 30), None) if safe_str(x) else None
            )

        return df

    except Exception as e:
        return None

def cargar_excel_cambios():
    """Carga todos los Excel de Cambios PAD y retorna DataFrame consolidado."""
    log("CAPA 2: Cargando Excel de Cambios PAD...")

    # Hojas a ignorar
    HOJAS_SKIP = {'resumen', 'avance', 'Resumen', 'AVANCE', 'AVANCE'}

    todas = []
    anios = range(2013, 2027)

    for anio in anios:
        ext = 'xls' if anio == 2013 else 'xlsx'
        filepath = f"{DATA_DIR}\\Cambios PAD - {anio}.{ext}"

        try:
            xl = pd.ExcelFile(filepath)
        except Exception:
            log(f"  No encontrado: {anio}")
            continue

        hojas_validas = [h for h in xl.sheet_names
                         if normalizar(h) not in {'RESUMEN','AVANCE'} and len(h) > 2]

        count_hojas = 0
        for hoja in hojas_validas:
            df_h = leer_hoja_cambios(filepath, hoja, anio)
            if df_h is not None and len(df_h) > 2:
                todas.append(df_h)
                count_hojas += 1

        log(f"  {anio}: {count_hojas} hojas cargadas")

    if not todas:
        log("  No se pudo cargar ningún Excel de Cambios.")
        return pd.DataFrame()

    df_all = pd.concat(todas, ignore_index=True, sort=False)
    log(f"  Total filas cargadas: {len(df_all):,}")
    return df_all

def construir_indice_excel(df_excel, mapa_nombre_dni):
    """
    Construye un índice para buscar rápidamente en Excel por DNI o por nombre.
    Retorna dict: (dni, tipo_mov) → lista de filas.
    """
    idx_dni  = {}  # (dni, tipo_mov) → [filas]
    idx_nombre = {}  # (nombre_norm, tipo_mov) → [filas]

    for _, row in df_excel.iterrows():
        dni      = safe_str(row.get('dni', ''))
        tipo_mov = safe_str(row.get('tipo_mov', ''))
        nombre   = safe_str(row.get('nombre_completo', ''))

        if not tipo_mov: continue

        fila = row.to_dict()

        if dni and dni.isdigit():
            key = (dni, tipo_mov)
            idx_dni.setdefault(key, []).append(fila)

        if nombre:
            key = (normalizar(nombre), tipo_mov)
            idx_nombre.setdefault(key, []).append(fila)

    return idx_dni, idx_nombre

def enriquecer_cambio(cambio, dni, nombre_norm, df_excel_idx_dni, df_excel_idx_nombre):
    """
    Busca en el índice de Excel y añade datos documentales al cambio.
    Retorna el cambio enriquecido.
    """
    tipo_mov = cambio['cod_tip_mov']
    periodo  = cambio.get('periodo_vigencia', '')

    # Intentar por DNI primero
    filas = df_excel_idx_dni.get((dni, tipo_mov), [])

    # Si no hay por DNI, intentar por nombre
    if not filas and nombre_norm:
        filas = df_excel_idx_nombre.get((nombre_norm, tipo_mov), [])

    if not filas: return cambio

    # Si hay múltiples, intentar filtrar por periodo/año
    anio_cambio = periodo[:4] if periodo else ''
    filas_filtradas = [f for f in filas if str(f.get('_anio','')).startswith(anio_cambio)]
    filas_usar = filas_filtradas if filas_filtradas else filas

    fila = filas_usar[0]  # Tomar la primera

    # Enriquecer con datos documentales
    nro_inf = safe_str(fila.get('nro_informe', ''), 50)
    nro_exp = safe_str(fila.get('nro_expediente', ''), 50)
    motivo  = safe_str(fila.get('motivo', ''), 200)
    detalle = safe_str(fila.get('detalle_evento', ''), 2000)

    if nro_inf: cambio['nro_informe'] = nro_inf
    if motivo and motivo != 'Reconstruido desde PAD_BD':
        cambio['motivo'] = motivo
    if detalle: cambio['detalle_evento'] = detalle

    # Expediente para pad.expedientes_cambio
    if nro_exp:
        cambio['_nro_expediente'] = nro_exp

    # Nivel anterior/nuevo desde Excel (más preciso que el inferido)
    nivel_excel = safe_str(fila.get('nivel', ''))
    if nivel_excel and tipo_mov == 'CAMBNIV':
        niv_ant, niv_nvo = parsear_nivel_cambio(nivel_excel)
        if niv_ant and niv_nvo:
            cambio['nivel_anterior'] = niv_ant
            cambio['nivel_nuevo']    = niv_nvo

    return cambio

# ============================================================
# INSERCIÓN EN BD
# ============================================================
def insertar_cambios(conn, cambios_enriquecidos, mapa_dep_info):
    log("INSERCIÓN: Escribiendo en pad.cambios_PAD...")
    cursor = conn.cursor()

    # Verificar que no haya registros previos
    cursor.execute("SELECT COUNT(*) FROM pad.cambios_PAD")
    existing = cursor.fetchone()[0]
    if existing > 0:
        log(f"  AVISO: ya existen {existing} registros en cambios_PAD. Omitiendo duplicados.")

    insertados    = 0
    expedientes   = 0
    errores       = 0

    for cambio in cambios_enriquecidos:
        try:
            cursor.execute("""
                INSERT INTO pad.cambios_PAD (
                    cod_pad, cod_tip_mov, nro_informe, periodo_vigencia,
                    motivo, detalle_evento, nivel_anterior, nivel_nuevo, observaciones
                )
                OUTPUT INSERTED.cod_cambio
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            int(cambio.get('cod_pad')),
            cambio.get('cod_tip_mov'),
            cambio.get('nro_informe'),
            cambio.get('periodo_vigencia'),
            cambio.get('motivo', 'Reconstruido desde PAD_BD'),
            cambio.get('detalle_evento'),
            cambio.get('nivel_anterior'),
            cambio.get('nivel_nuevo'),
            cambio.get('observaciones'),
            )
            row = cursor.fetchone()
            if not row: continue
            cod_cambio = row[0]
            insertados += 1

            # Insertar expediente si existe
            nro_exp = cambio.get('_nro_expediente')
            if nro_exp:
                try:
                    cursor.execute("""
                        INSERT INTO pad.expedientes_cambio (cod_cambio, nro_expediente, tipo_documento)
                        VALUES (?, ?, 'EXPEDIENTE')
                    """, cod_cambio, nro_exp[:50])
                    expedientes += 1
                except Exception:
                    pass  # Ignorar duplicados de expediente

        except Exception as e:
            errores += 1
            if errores <= 3:
                log(f"  ERROR: {e}")

        if insertados % BATCH_SIZE == 0:
            conn.commit()
            log(f"  ... {insertados} cambios insertados")

    conn.commit()
    log(f"  RESULTADO: {insertados} cambios | {expedientes} expedientes | {errores} errores")
    return insertados

# ============================================================
# MAIN
# ============================================================
if __name__ == '__main__':
    log("=== INICIO MIGRACIÓN CAMBIOS PAD ===")

    conn = pyodbc.connect(CONN_STR)
    conn.autocommit = False

    # ── Capa 1: reconstruir desde PAD_BD ──
    cambios = reconstruir_cambios(conn)

    # ── Capa 2: cargar Excel y enriquecer ──
    df_excel = cargar_excel_cambios()

    # Cargar info de deportistas para matching por nombre
    log("  Cargando mapa deportistas (DNI → nombre)...")
    cursor = conn.cursor()
    cursor.execute("""
        SELECT num_documento,
               ISNULL(ap_paterno,'') + ' ' + ISNULL(ap_materno,'') + ' ' + nombres AS nombre_full
        FROM pad.Deportistas
        WHERE tipo_documento = 'DNI'
    """)
    mapa_dep_info = {r[0]: normalizar(r[1]) for r in cursor.fetchall()}

    if not df_excel.empty:
        log(f"  Construyendo índices Excel...")
        idx_dni, idx_nombre = construir_indice_excel(df_excel, mapa_dep_info)
        log(f"  Índice DNI: {len(idx_dni)} entradas | Índice nombre: {len(idx_nombre)} entradas")

        log("  Enriqueciendo cambios con datos Excel...")
        cambios_enriquecidos = []
        enriquecidos = 0
        for cambio in cambios:
            cod_pad = cambio.get('cod_pad')
            # Buscar DNI del deportista desde cod_pad
            cursor.execute("""
                SELECT d.num_documento,
                       ISNULL(d.ap_paterno,'') + ' ' + ISNULL(d.ap_materno,'') + ' ' + d.nombres
                FROM pad.PAD p
                JOIN pad.Deportistas d ON p.cod_deportista = d.cod_deportista
                WHERE p.cod_pad = ?
            """, int(cod_pad))
            r = cursor.fetchone()
            if r:
                dni = r[0]
                nombre_norm = normalizar(r[1])
                cambio_e = enriquecer_cambio(dict(cambio), dni, nombre_norm, idx_dni, idx_nombre)
                if cambio_e.get('nro_informe') or cambio_e.get('_nro_expediente'):
                    enriquecidos += 1
                cambios_enriquecidos.append(cambio_e)
            else:
                cambios_enriquecidos.append(cambio)

        log(f"  Cambios enriquecidos con datos Excel: {enriquecidos} / {len(cambios)}")
    else:
        cambios_enriquecidos = cambios

    # ── Insertar en BD ──
    insertar_cambios(conn, cambios_enriquecidos, mapa_dep_info)

    # ── Verificación final ──
    log("VERIFICACIÓN:")
    for label, sql in [
        ("cambios_PAD total",   "SELECT COUNT(*) FROM pad.cambios_PAD"),
        ("ING",                  "SELECT COUNT(*) FROM pad.cambios_PAD WHERE cod_tip_mov='ING'"),
        ("RET",                  "SELECT COUNT(*) FROM pad.cambios_PAD WHERE cod_tip_mov='RET'"),
        ("CAMBNIV",              "SELECT COUNT(*) FROM pad.cambios_PAD WHERE cod_tip_mov='CAMBNIV'"),
        ("Con nro_informe",      "SELECT COUNT(*) FROM pad.cambios_PAD WHERE nro_informe IS NOT NULL"),
        ("expedientes_cambio",   "SELECT COUNT(*) FROM pad.expedientes_cambio"),
    ]:
        cursor.execute(sql)
        log(f"  {label}: {cursor.fetchone()[0]:,}")

    conn.close()
    log("=== COMPLETADO ===")
