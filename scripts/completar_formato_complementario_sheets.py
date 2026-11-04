import openpyxl
import re
import json
import shutil
import os

BASE_DIR = r"C:\Users\boss1\.gemini\antigravity-ide\scratch\tu-techo-ideal-bot"
ORIGINAL_BACKUP = os.path.join(BASE_DIR, "google_sheet_backup_original.xlsx")
CURRENT_FILE = os.path.join(BASE_DIR, "google_sheet_backup_current.xlsx")
OUTPUT_XLSX = os.path.join(BASE_DIR, "google_sheet_Hoja1_COMPLETA_ACTUALIZADA.xlsx")
PROPS_CACHE = os.path.join(BASE_DIR, "properties_cache.json")
PROPS_BACKUP = os.path.join(BASE_DIR, "properties_cache_backup_original.json")

# 1. Crear copia de seguridad de la hoja original
if not os.path.exists(ORIGINAL_BACKUP):
    shutil.copyfile(CURRENT_FILE, ORIGINAL_BACKUP)
    print(f"[Backup] Copia de seguridad creada: {ORIGINAL_BACKUP}")
else:
    print(f"[Backup] Copia de seguridad ya existente: {ORIGINAL_BACKUP}")

if not os.path.exists(PROPS_BACKUP):
    shutil.copyfile(PROPS_CACHE, PROPS_BACKUP)
    print(f"[Backup] Copia de properties_cache creada: {PROPS_BACKUP}")

wb = openpyxl.load_workbook(CURRENT_FILE)
ws = wb['Hoja 1']

# Template base de Ficha técnica, apartamento Lomas del Sol.docx
TEMPLATE = (
    "Servicios Básicos. Agua: {agua}. Almacenamiento de agua: {almacenamiento}. Pozo: {pozo}. "
    "Gas: {gas}. Electricidad / Respaldo: {electricidad}. Internet / Telecomunicaciones: {internet}. "
    "Telefonía: {telefonia}. Condiciones Comerciales ({operacion}) Precio: {precio}. "
    "Formas de pago / Métodos aceptados: {formas_pago}. Negociabilidad: {negociabilidad}. "
    "Financiamiento: {financiamiento}. Créditos: {creditos}. Permutas: {permutas}. "
    "Condominio: {condominio}. Características Físicas y Distribución. Metraje: {metraje}. "
    "Habitaciones y Baños: {hab_banos}. Balcón / Terraza: {balcon}. Jardín / Patio: {jardin}. "
    "Vista: {vista}. Clima, Ventilación e Iluminación: {clima}. Anexos o Servicio: {anexos}. "
    "Área de lavado: {lavado}. Estacionamiento: {estacionamiento}. Maletero: {maletero}. "
    "Nivel / Ubicación: {nivel}. Acabados / Pisos: {acabados}. Equipamiento: {equipamiento}. "
    "Antigüedad: {antiguedad}. Edificio, Áreas Comunes y Seguridad. Ascensores: {ascensores}. "
    "Seguridad / Consejería: {seguridad}. Protección perimetral: {proteccion}. Amenidades: {amenidades}. "
    "Estatus Legal e Infraestructura. Documentación: {documentacion}. Estado de conservación: {conservacion}. "
    "Techos y filtraciones: {techos}. Ventajas por Ubicación (Entorno y Accesibilidad) Ubicación: {ubicacion}. "
    "Comercios y Servicios (A pie / Cercanías): {comercios}."
)

updated_count = 0
already_formatted = 0
new_descriptions = {}

for r in range(2, ws.max_row + 1):
    id_p = ws.cell(row=r, column=1).value
    if not id_p or not str(id_p).startswith('REF-'):
        continue

    tipo = str(ws.cell(row=r, column=2).value or 'Inmueble').strip()
    operacion = str(ws.cell(row=r, column=3).value or 'Venta').strip()
    desc_orig = str(ws.cell(row=r, column=4).value or '').strip()

    if 'Servicios Básicos' in desc_orig:
        already_formatted += 1
        new_descriptions[id_p] = desc_orig
        continue

    # Asegurar punto final en descripción original
    if desc_orig and not desc_orig.endswith(('.', '!', '?')):
        desc_orig += '.'

    # Extracción conservadora basada en evidencia textual estricta
    m_metraje = re.search(r'(\d+[\d.,]*\s*(?:m²|mts?2|metros\s*cuadrados))', desc_orig, re.I)
    metraje_val = m_metraje.group(1) if m_metraje else "No especificado en la fuente"

    m_precio = re.search(r'((?:\$|USD\s*|ref\s*)\s*\d+[\d.,]*)', desc_orig, re.I)
    precio_val = m_precio.group(1) if m_precio else "No especificado en la fuente"

    hab_match = re.search(r'(\d+|una|dos|tres|cuatro|cinco)\s*habitación(?:es)?', desc_orig, re.I)
    ban_match = re.search(r'(\d+|un|dos|tres|cuatro|cinco)\s*baño(?:s)?', desc_orig, re.I)
    hab_ban_parts = []
    if hab_match:
        hab_ban_parts.append(f"{hab_match.group(0)}")
    if ban_match:
        hab_ban_parts.append(f"{ban_match.group(0)}")
    hab_ban_val = " y ".join(hab_ban_parts) if hab_ban_parts else "No especificado en la fuente"

    est_match = re.search(r'(\d+|un|dos|tres|cuatro)\s*puesto(?:s)?\s*(?:de\s*estacionamiento)?', desc_orig, re.I)
    est_val = est_match.group(0) if est_match else ("No posee propio" if re.search(r'no posee.*estacionamiento', desc_orig, re.I) else "No especificado en la fuente")

    tanque_match = re.search(r'(tanque\s*(?:de\s*agua)?(?:\s*de\s*\d+[\d.,]*\s*(?:litros|lts))?)', desc_orig, re.I)
    pozo_match = re.search(r'(pozo\s*(?:de\s*agua)?(?:\s*profundo)?)', desc_orig, re.I)
    almacenamiento_val = tanque_match.group(1) if tanque_match else "No especificado en la fuente"
    pozo_val = pozo_match.group(1) if pozo_match else "No especificado en la fuente"

    gas_match = re.search(r'(gas\s*directo|gas\s*por\s*bombona)', desc_orig, re.I)
    gas_val = gas_match.group(1) if gas_match else "No especificado en la fuente"
    planta_match = re.search(r'(planta\s*eléctrica(?:\s*(?:100%|total))?)', desc_orig, re.I)
    elec_val = planta_match.group(1) if planta_match else "No especificado en la fuente"

    condo_match = re.search(r'condominio\s*(?:de\s*|aprox\.?\s*)?(\$?\s*\d+[\d.,]*(?:\s*a\s*tasa\s*BCV)?)', desc_orig, re.I)
    condo_val = condo_match.group(1) if condo_match else "No especificado en la fuente"

    m_ubi = re.search(r'(?:ubicad[oa]\s*en|en\s*la\s*zona\s*de|en\s*el\s*conjunto|en\s*plena)\s*([A-Za-zÁÉÍÓÚáéíóúñÑ0-9\s,.-]+?)(?:\.|\s*cuenta|\s*con|\s*disfruta|\s*ofrece)', desc_orig, re.I)
    ubi_val = m_ubi.group(1).strip() if m_ubi else "No especificado en la fuente"

    amenidades_list = []
    if re.search(r'piscina', desc_orig, re.I): amenidades_list.append("Piscina")
    if re.search(r'parrilla|caney', desc_orig, re.I): amenidades_list.append("Área de parrillera/caney")
    if re.search(r'cancha', desc_orig, re.I): amenidades_list.append("Canchas deportivas")
    if re.search(r'parque\s*infantil', desc_orig, re.I): amenidades_list.append("Parque infantil")
    amenidades_val = ", ".join(amenidades_list) if amenidades_list else "No especificado en la fuente"

    seg_match = re.search(r'(vigilancia\s*(?:privada\s*)?24/7|vigilancia\s*privada|control\s*de\s*acceso|consejería|cerco\s*eléctrico)', desc_orig, re.I)
    seg_val = seg_match.group(1) if seg_match else "No especificado en la fuente"

    bloque = TEMPLATE.format(
        agua="No especificado en la fuente",
        almacenamiento=almacenamiento_val,
        pozo=pozo_val,
        gas=gas_val,
        electricidad=elec_val,
        internet="No especificado en la fuente",
        telefonia="No especificado en la fuente",
        operacion=operacion,
        precio=precio_val,
        formas_pago="No especificado en la fuente",
        negociabilidad="No especificado en la fuente",
        financiamiento="No especificado en la fuente",
        creditos="No especificado en la fuente",
        permutas="No especificado en la fuente",
        condominio=condo_val,
        metraje=metraje_val,
        hab_banos=hab_ban_val,
        balcon="No especificado en la fuente",
        jardin="No especificado en la fuente",
        vista="No especificado en la fuente",
        clima="No especificado en la fuente",
        anexos="No especificado en la fuente",
        lavado="No especificado en la fuente",
        estacionamiento=est_val,
        maletero="No especificado en la fuente",
        nivel="No especificado en la fuente",
        acabados="No especificado en la fuente",
        equipamiento="No especificado en la fuente",
        antiguedad="No especificado en la fuente",
        ascensores="No especificado en la fuente",
        seguridad=seg_val,
        proteccion="No especificado en la fuente",
        amenidades=amenidades_val,
        documentacion="No especificado en la fuente",
        conservacion="No especificado en la fuente",
        techos="No especificado en la fuente",
        ubicacion=ubi_val,
        comercios="No especificado en la fuente"
    )

    nueva_desc = f"{desc_orig} {bloque}"
    ws.cell(row=r, column=4, value=nueva_desc)
    new_descriptions[id_p] = nueva_desc
    updated_count += 1

wb.save(OUTPUT_XLSX)
print(f"[Google Sheets] Completadas {updated_count} propiedades con formato complementario.")
print(f"[Google Sheets] Propiedades que ya tenían formato: {already_formatted}.")
print(f"[Google Sheets] Archivo generado exitosamente: {OUTPUT_XLSX}")

# Actualizar properties_cache.json
with open(PROPS_CACHE, 'r', encoding='utf-8') as f:
    props = json.load(f)

for p in props:
    id_p = p.get('ID_PROPIEDAD')
    if id_p in new_descriptions:
        p['DESCRIPCION_BREVE'] = new_descriptions[id_p]

with open(PROPS_CACHE, 'w', encoding='utf-8') as f:
    json.dump(props, f, indent=2, ensure_ascii=False)

print(f"[Properties Cache] Actualizado properties_cache.json con {len(new_descriptions)} propiedades.")
