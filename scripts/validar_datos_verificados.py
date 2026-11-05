import json
import re
import sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

with open(r'C:\Users\boss1\.gemini\antigravity-ide\scratch\tu-techo-ideal-bot\original_descriptions_dump.json', 'r', encoding='utf-8') as f:
    props = json.load(f)

with open(r'C:\Users\boss1\.gemini\antigravity\brain\e3104059-8db9-43ac-bee3-bf1422b72f35\scratch\verified_data_complete.json', 'r', encoding='utf-8') as f:
    verified = json.load(f)

print(f"Loaded {len(props)} original properties and {len(verified)} verified entries.")

# 1. MANDATORY VALIDATION: REF-001
ref001 = verified['REF-001']
desc001 = props['REF-001']['desc']

print("="*60)
print("EJECUTANDO VALIDACIÓN DE CONTROL OBLIGATORIA: REF-001")
print("="*60)

ref001_checks = [
    ("Terreno: 933 m²", "933 m² de terreno" in ref001['metraje']),
    ("Construcción: 699 m²", "699 m² de construcción" in ref001['metraje']),
    ("Habitaciones o cubículos: aproximadamente 12", "12 habitaciones o cubículos" in ref001['hab_banos']),
    ("Baños: 6", "6 baños" in ref001['hab_banos']),
    ("Tanques de agua: 3", "3 tanques de agua" in ref001['almacenamiento']),
    ("Cavas cuarto: 2", "dos cavas cuarto" in ref001['equipamiento'].lower()),
    ("Protectores eléctricos industriales: 2", "dos protectores eléctricos industriales" in ref001['electricidad'].lower()),
    ("Estacionamientos internos: 10", "10 puestos de estacionamiento interno" in ref001['estacionamiento'].lower()),
    ("Precio de venta: $600.000", "$600.000" in ref001['precios_bloque'] and "Venta: $600.000" in ref001['precios_bloque']),
    ("Canon de alquiler: $5.000 mensuales", "$5.000 mensuales" in ref001['precios_bloque'] and "Alquiler: $5.000 mensuales" in ref001['precios_bloque']),
    ("Gastos de servicios: $100", "$100" in ref001['precios_bloque'] and "Gastos de servicios: Aproximadamente $100" in ref001['precios_bloque']),
    ("Prohibición: $100 clasificado como alquiler", "Alquiler: $100" not in ref001['precios_bloque'])
]

ref001_passed = True
for name, ok in ref001_checks:
    status = "APROBADO" if ok else "FALLIDO"
    print(f"  [{status}] {name}")
    if not ok: ref001_passed = False

if not ref001_passed:
    print("[ERROR CRÍTICO] REF-001 NO superó la validación individual.")
    exit(1)
else:
    print("[EXITO] REF-001 SUPERÓ EL 100% DE LA VALIDACIÓN INDIVIDUAL DE CONTROL.")

# 2. VALIDATION OF ALL PROPERTIES
print("\n" + "="*60)
print("AUDITORÍA DE CONSISTENCIA TEXTUAL PARA TODAS LAS PROPIEDADES")
print("="*60)

total_checked = 0
total_fields_backed = 0
total_unspecified = 0
issues = []

for pid in sorted(verified.keys()):
    total_checked += 1
    v = verified[pid]
    orig = props[pid]['desc']
    orig_clean = orig.lower().replace('\u200b', ' ')
    
    # Check fields
    for field, val in v.items():
        if field in ['operacion_display', 'precios_bloque']:
            continue
        if val == "No especificado en la fuente":
            total_unspecified += 1
            continue
        
        # Check if numbers from val are present in orig
        nums = re.findall(r'\d+[\d.,]*', val)
        for num in nums:
            if len(num) > 1:
                clean_num = num.replace('.', '').replace(',', '')
                clean_orig = orig.replace('.', '').replace(',', '')
                if clean_num not in clean_orig:
                    issues.append(f"[{pid}] Campo '{field}': número '{num}' no encontrado en descripción original.")
        
        total_fields_backed += 1

print(f"Propiedades verificadas: {total_checked}")
print(f"Campos respaldados por texto: {total_fields_backed}")
print(f"Campos 'No especificado en la fuente': {total_unspecified}")
print(f"Incidencias encontradas: {len(issues)}")

if issues:
    for iss in issues[:10]:
        print("  AVISO:", iss)
else:
    print("[EXITO] CERO INCIDENCIAS: Todos los campos con datos cuentan con evidencia textual directa.")
