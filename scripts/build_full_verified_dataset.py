import json
import re

# We will read original_descriptions_dump.json and construct the full mapping for all 69 properties
with open(r'C:\Users\boss1\.gemini\antigravity-ide\scratch\tu-techo-ideal-bot\original_descriptions_dump.json', 'r', encoding='utf-8') as f:
    props = json.load(f)

# Helper function
def make_default(op="Venta"):
    return {
        'agua': "No especificado en la fuente",
        'almacenamiento': "No especificado en la fuente",
        'pozo': "No especificado en la fuente",
        'gas': "No especificado en la fuente",
        'electricidad': "No especificado en la fuente",
        'internet': "No especificado en la fuente",
        'telefonia': "No especificado en la fuente",
        'operacion_display': op if op and op != 'None' else "Venta",
        'precios_bloque': "Precio: No especificado en la fuente. ",
        'formas_pago': "No especificado en la fuente",
        'negociabilidad': "No especificado en la fuente",
        'financiamiento': "No especificado en la fuente",
        'creditos': "No especificado en la fuente",
        'permutas': "No especificado en la fuente",
        'condominio': "No especificado en la fuente",
        'metraje': "No especificado en la fuente",
        'hab_banos': "No especificado en la fuente",
        'balcon': "No especificado en la fuente",
        'jardin': "No especificado en la fuente",
        'vista': "No especificado en la fuente",
        'clima': "No especificado en la fuente",
        'anexos': "No especificado en la fuente",
        'lavado': "No especificado en la fuente",
        'estacionamiento': "No especificado en la fuente",
        'maletero': "No especificado en la fuente",
        'nivel': "No especificado en la fuente",
        'acabados': "No especificado en la fuente",
        'equipamiento': "No especificado en la fuente",
        'antiguedad': "No especificado en la fuente",
        'ascensores': "No especificado en la fuente",
        'seguridad': "No especificado en la fuente",
        'proteccion': "No especificado en la fuente",
        'amenidades': "No especificado en la fuente",
        'documentacion': "No especificado en la fuente",
        'conservacion': "No especificado en la fuente",
        'techos': "No especificado en la fuente",
        'ubicacion': "No especificado en la fuente",
        'comercios': "No especificado en la fuente"
    }

# Build curated dictionary
DATA = {}

# REF-001 & REF-003
for pid in ['REF-001', 'REF-003']:
    d = make_default("Venta o Alquiler")
    d['precios_bloque'] = "Venta: $600.000. Alquiler: $5.000 mensuales. Gastos de servicios: Aproximadamente $100. Precio: Venta $600.000 o Alquiler $5.000 mensuales. "
    d['agua'] = "Garantizan un suministro constante"
    d['almacenamiento'] = "3 tanques de agua"
    d['gas'] = "Gas directo industrial para el área de la cocina"
    d['electricidad'] = "Dos protectores eléctricos industriales"
    d['internet'] = "Factibilidad para instalar internet de fibra óptica"
    d['metraje'] = "933 m² de terreno y 699 m² de construcción"
    d['hab_banos'] = "Aproximadamente 12 habitaciones o cubículos y 6 baños"
    d['clima'] = "Agradable clima de montaña"
    d['estacionamiento'] = "10 puestos de estacionamiento interno y espacios adicionales de aparcamiento frente a la propiedad"
    d['acabados'] = "Sin amoblar"
    d['equipamiento'] = "Dos cavas cuarto, aires acondicionados en áreas específicas"
    d['seguridad'] = "Rejas perimetrales de seguridad"
    d['proteccion'] = "Rejas perimetrales de seguridad"
    d['amenidades'] = "Área exclusiva de carga y descarga"
    d['ubicacion'] = "Alta Florida, Caracas"
    d['comercios'] = "Ideal para establecer un centro de producción, oficinas corporativas, un restaurante u otros proyectos de envergadura"
    DATA[pid] = d

# REF-002
d = make_default("Alquiler")
d['metraje'] = "554 m²"
d['jardin'] = "Hermoso jardín"
d['vista'] = "Vista al Ávila"
d['ubicacion'] = "Parte Alta de Macaracuay, con conexión directa a El Cafetal (Calle Santa Ana)"
DATA['REF-002'] = d

# REF-004
d = make_default("Venta")
d['metraje'] = "125,90 m² (121 m² techados)"
d['hab_banos'] = "4 habitaciones y 3 baños"
d['estacionamiento'] = "1 puesto de estacionamiento"
d['ascensores'] = "Ascensor con acceso directo"
d['vista'] = "Vista panorámica de 160° a la montaña y la ciudad"
d['gas'] = "Gas directo"
d['almacenamiento'] = "Edificio con tanque de agua"
d['nivel'] = "Piso 14 (Penthouse)"
d['acabados'] = "Penthouse a remodelar (ideal para personalizar a tu gusto)"
d['ubicacion'] = "La Boyera, frente a Traki"
d['comercios'] = "Rodeada de múltiples comercios y áreas recreativas"
d['negociabilidad'] = "Negociable"
d['precios_bloque'] = "Precio: $160.000 (negociable). "
DATA['REF-004'] = d

# REF-005
d = make_default("Venta")
d['metraje'] = "80,45 m²"
d['hab_banos'] = "1 habitación, un baño completo y un medio baño para visitas"
d['balcon'] = "Agradable balcón en la sala"
d['vista'] = "Excelente vista al noroeste de Caracas"
d['estacionamiento'] = "Incluye estacionamiento"
d['acabados'] = "Pisos de porcelanato y techos listos para habitar"
d['seguridad'] = "Acceso mediante Face ID y huella dactilar para sus diferentes áreas"
d['amenidades'] = "Restaurante, gimnasio, canchas de pádel y atractivas zonas instagrameables"
d['precios_bloque'] = "Precio: Inversión total de $355.674 (equivalente a $4.421 por metro cuadrado). "
DATA['REF-005'] = d

# REF-006
d = make_default("Venta")
d['metraje'] = "85,30 m²"
d['hab_banos'] = "Tres habitaciones y dos baños completos"
d['lavado'] = "Área de lavandero"
d['acabados'] = "Remodelado a estrenar hace apenas tres meses, acabados de lujo, iluminación LED y baños estilo boutique"
d['estacionamiento'] = "Un puesto de estacionamiento negociable"
d['agua'] = "Servicio de agua directa tres días a la semana"
d['almacenamiento'] = "Tanque en el edificio"
d['nivel'] = "Piso alto"
d['documentacion'] = "Papeles 100% al día y listos para firmar en el Registro"
d['ubicacion'] = "Residencias Eridano, en la zona de Quinta Crespo y frente al Colegio Francisco Pimentel"
d['vista'] = "Hermosas vistas panorámicas"
DATA['REF-006'] = d

# REF-007
d = make_default("Venta")
d['metraje'] = "106,43 m²"
d['hab_banos'] = "Dos habitaciones y un baño principal, además de incluir una habitación y un baño de servicio"
d['nivel'] = "Segundo piso"
d['acabados'] = "Completamente amoblado, cocina actualizada con tope de cuarzo"
d['pozo'] = "Pozo de agua (suministro constante)"
d['agua'] = "Suministro constante gracias a su pozo de agua"
d['estacionamiento'] = "Acceso a un puesto de estacionamiento de uso común"
d['internet'] = "Disponibilidad de conexión para internet de Cantv o Simple TV"
d['precios_bloque'] = "Precio: $130.000. "
DATA['REF-007'] = d

# REF-008
d = make_default("Venta")
d['metraje'] = "368 m² de construcción"
d['hab_banos'] = "Tres habitaciones principales (cada una con su baño privado), una habitación y baño de servicio, y un medio baño para visitas"
d['estacionamiento'] = "Seis puestos de estacionamiento (complejo dispone de 13 puestos para visitantes)"
d['maletero'] = "Dos maleteros"
d['vista'] = "Inigualable vista panorámica a toda Caracas"
d['pozo'] = "Pozo de agua profundo"
d['electricidad'] = "Planta eléctrica"
d['amenidades'] = "Piscina, gimnasio, sala de pilates, parque infantil, caney con parrillera, canchas de tenis y bolas criollas, salón de fiestas en cada torre"
d['negociabilidad'] = "Negociable"
d['ubicacion'] = "Conjunto Residencial La Vista, en Los Naranjos"
d['precios_bloque'] = "Precio: $669.900 (valor negociable). "
DATA['REF-008'] = d

# REF-009
d = make_default("Venta")
d['metraje'] = "194,17 m² de construcción y terraza descubierta de 230 m²"
d['hab_banos'] = "Family room, tres habitaciones principales (cada una con baño integrado), una habitación y baño de servicio, y un medio baño para visitas"
d['balcon'] = "Impresionante terraza descubierta de 230 m²"
d['nivel'] = "Planta Baja (PB)"
d['acabados'] = "En obra gris (lienzo en blanco para diseñar a su gusto)"
d['vista'] = "Mejor vista de 360 grados de toda Caracas"
d['estacionamiento'] = "Cinco puestos de estacionamiento"
d['maletero'] = "Dos maleteros"
d['ubicacion'] = "Mirador de Los Campitos"
DATA['REF-009'] = d

# REF-010
d = make_default("Venta")
d['metraje'] = "222,73 m² de construcción y extraordinaria terraza de 427 m²"
d['hab_banos'] = "Family room, tres habitaciones principales (con baño integrado), una habitación y baño de servicio, y un medio baño para visitas"
d['balcon'] = "Extraordinaria terraza de 427 m²"
d['nivel'] = "Pent-House"
d['acabados'] = "En obra gris (diseñar espacio de lujo totalmente a su gusto)"
d['vista'] = "Mejor vista de 360 grados de toda Caracas"
d['estacionamiento'] = "Cinco puestos de estacionamiento"
d['maletero'] = "Dos maleteros"
d['ubicacion'] = "Mirador de Los Campitos"
d['precios_bloque'] = "Precio: $1.156.009,00. "
DATA['REF-010'] = d

# REF-011
d = make_default("Venta")
d['metraje'] = "436,90 m²"
d['hab_banos'] = "Cinco habitaciones, cinco baños completos y un medio baño para visitas"
d['balcon'] = "Hermosas terrazas"
d['vista'] = "Inigualable vista panorámica desde cualquier área"
d['ascensores'] = "Acceso mediante ascensor privado y de servicio"
d['estacionamiento'] = "Seis puestos de estacionamiento"
d['maletero'] = "Un inmenso maletero"
d['nivel'] = "Pent-house"
d['seguridad'] = "Estricta vigilancia 24/7"
d['amenidades'] = "Piscina temperada, parque infantil, salón de fiestas y amplias áreas verdes"
d['condominio'] = "$368 mensuales pagaderos en bolívares a la tasa del BCV"
d['negociabilidad'] = "Negociables (con disposición para aceptar pago mixto)"
d['ubicacion'] = "Calle Dr. Bueno del exclusivo conjunto privado Residencias La Vista, en Lomas de Las Mercedes"
d['precios_bloque'] = "Precio: $750.000 negociables (disposición para pago mixto). "
DATA['REF-011'] = d

# REF-012
d = make_default("Venta")
d['metraje'] = "110 m²"
d['hab_banos'] = "Tres habitaciones, dos baños completos y un práctico estudio convertible"
d['almacenamiento'] = "Tanque de agua interno de 700 litros"
d['internet'] = "Servicio de internet por fibra óptica de Intercable"
d['estacionamiento'] = "Dos puestos de estacionamiento techados"
d['maletero'] = "Un maletero"
d['acabados'] = "Completamente amoblado"
d['vista'] = "Agradable vista hacia el Centro Comercial Los Samanes"
d['amenidades'] = "Salón de fiestas y parque infantil"
d['ubicacion'] = "Los Samanes"
d['precios_bloque'] = "Precio: $146.000. "
DATA['REF-012'] = d

# REF-013
d = make_default("Alquiler")
d['metraje'] = "100 m²"
d['hab_banos'] = "Tres habitaciones y dos baños"
d['estacionamiento'] = "Un puesto de estacionamiento privado (edificio dispone de puestos para visitantes)"
d['gas'] = "Gas directo"
d['agua'] = "Agua constante"
d['electricidad'] = "Electricidad 110/220V"
d['internet'] = "Conexión a internet por fibra óptica"
d['acabados'] = "Completamente amoblado"
d['vista'] = "Agradable vista al sur de Caracas"
d['condominio'] = "$20 mensuales"
d['ubicacion'] = "La California Norte, en toda la avenida Francisco de Miranda"
d['precios_bloque'] = "Precio: Canon de arrendamiento de $700 al mes. Condiciones de negociación: Tres meses de depósito, tres meses de pago por adelantado, un mes de honorarios profesionales y $200 correspondientes a la redacción del contrato de arrendamiento. "
DATA['REF-013'] = d

# REF-014
d = make_default("Venta")
d['metraje'] = "334 m²"
d['hab_banos'] = "Cinco habitaciones, cuatro baños completos y un medio baño para visitas"
d['balcon'] = "Balcón y terraza cubierta"
d['jardin'] = "Jardín"
d['clima'] = "Agradable clima de montaña"
d['vista'] = "Hermosa vista panorámica"
d['almacenamiento'] = "Tanque de agua de 10.000 litros"
d['internet'] = "Servicio de internet por fibra óptica"
d['estacionamiento'] = "Capacidad para cinco puestos de estacionamiento"
d['seguridad'] = "Doble garita de vigilancia las 24 horas"
d['condominio'] = "Estimada entre $150 y $200 mensuales"
d['negociabilidad'] = "Negociables"
d['ubicacion'] = "Villas de Loma Linda, en La Lagunita (El Hatillo)"
d['precios_bloque'] = "Precio: $235.000 negociables. "
DATA['REF-014'] = d

# REF-015
d = make_default("Venta")
d['metraje'] = "168,32 m² de terreno y 184,7 m² de construcción"
d['hab_banos'] = "Cuatro habitaciones y tres baños"
d['estacionamiento'] = "Dos puestos de estacionamiento"
d['almacenamiento'] = "Tanque interno de 10.000 litros (suministro constante de agua)"
d['agua'] = "Suministro constante de agua gracias a su tanque interno"
d['clima'] = "Agradable clima de montaña"
d['jardin'] = "Hermosas áreas verdes"
d['documentacion'] = "Papeles al día y listos para firmar (posibilidad de adquirir la acción del club)"
d['ubicacion'] = "Lomas de Monteclaro, en la parroquia Cecilio Acosta del municipio Guaicaipuro, estado Miranda"
DATA['REF-015'] = d

# REF-016
d = make_default("Alquiler")
d['metraje'] = "2150 m² de terreno y 500 m² de construcción"
d['hab_banos'] = "Primera casa: 3 habitaciones principales con baño privado; segunda casa: 1 habitación y 1 baño privado; anexo independiente para servicio o seguridad con baño y kitchenette"
d['anexos'] = "Anexo independiente para servicio o seguridad con baño y kitchenette"
d['estacionamiento'] = "Capacidad para 14 puestos de estacionamiento"
d['almacenamiento'] = "Tanque de agua de 5000 litros"
d['electricidad'] = "Planta eléctrica"
d['gas'] = "2 bombonas de gas"
d['lavado'] = "Área de lavandería"
d['amenidades'] = "Salón de fiestas con 2 baños, gimnasio, bar, área de parrilla y un depósito"
d['ubicacion'] = "Oripoto, El Hatillo"
d['precios_bloque'] = "Precio: Canon de arrendamiento de $2000. Condiciones de negociación: 3 meses de adelanto, 3 meses de depósito, 1 mes de honorarios profesionales y $150 por la redacción del contrato. "
DATA['REF-016'] = d

# REF-017
d = make_default("Alquiler")
d['metraje'] = "106 m²"
d['hab_banos'] = "Distribuido en una oficina, tres depósitos, showroom a puerta cerrada, cocina y un baño completo"
d['estacionamiento'] = "Un puesto de estacionamiento al frente"
d['electricidad'] = "Acometida 220V"
d['internet'] = "Conexión lista para internet satelital"
d['equipamiento'] = "Un aire acondicionado instalado (factibilidad para adicionales)"
d['agua'] = "Suministro de agua bajo un esquema de gasto compartido, sin pago de condominio tradicional"
d['condominio'] = "Sin pago de condominio tradicional (esquema de gasto compartido de agua)"
d['seguridad'] = "Portón mecánico de acceso y sistema de cámaras de videovigilancia integrado"
d['ubicacion'] = "Calle Coromoto, Piedra Azul, Baruta"
d['precios_bloque'] = "Precio: Canon de arrendamiento de $500. Condiciones de negociación: 2 meses de depósito, 1 mes por adelantado y 1 mes de comisión inmobiliaria. "
DATA['REF-017'] = d

# REF-018
d = make_default("Alquiler")
d['hab_banos'] = "Una habitación con un baño compartido"
d['estacionamiento'] = "Un puesto de estacionamiento"
d['agua'] = "Agua continua (incluida)"
d['electricidad'] = "Luz incluida"
d['gas'] = "Gas directo (incluido)"
d['internet'] = "Internet ABA (incluido)"
d['equipamiento'] = "Acceso a áreas comunes con cocina, nevera, lavadora y secadora"
d['lavado'] = "Lavadora y secadora en áreas comunes"
d['ubicacion'] = "Torres de Baruta"
d['precios_bloque'] = "Precio: $150 mensuales (con todos los servicios incluidos: luz, agua continua, internet ABA y gas directo). Condiciones de negociación: Contrato renovable a seis meses o un año, requiriendo un mes por adelantado, un mes de depósito y un mes de comisión. "
DATA['REF-018'] = d

# REF-019
d = make_default("Alquiler")
d['hab_banos'] = "Una habitación con baño de uso privado"
d['estacionamiento'] = "Un puesto de estacionamiento"
d['internet'] = "Internet de fibra óptica incluido"
d['agua'] = "Servicio constante de agua (incluido)"
d['electricidad'] = "Servicio constante de luz (incluido)"
d['equipamiento'] = "Áreas comunes equipadas con cocina, nevera, horno, lavadora y secadora"
d['lavado'] = "Lavadora y secadora en áreas comunes"
d['seguridad'] = "Vigilancia las 24 horas"
d['ubicacion'] = "Torre Páez del pueblo de Baruta (zona comercial céntrica)"
d['precios_bloque'] = "Precio: $190 mensuales (con internet de fibra óptica y servicios incluidos). Condiciones de negociación: Dos meses de adelanto, un mes de depósito y un mes de honorarios (únicamente visitas familiares sin pernocta). "
DATA['REF-019'] = d

# REF-020
d = make_default("Venta")
d['metraje'] = "115 metros cuadrados"
d['hab_banos'] = "Tres habitaciones, dos baños, sala, comedor y área de bar"
d['estacionamiento'] = "Un puesto de estacionamiento"
d['maletero'] = "Un maletero"
d['almacenamiento'] = "Tanque interno"
d['vista'] = "Hermosa vista al Ávila"
d['seguridad'] = "Seguridad 24/7"
d['amenidades'] = "Salón de fiestas"
d['formas_pago'] = "Crédito, USDT, efectivo y euros"
d['ubicacion'] = "La Urbina"
d['precios_bloque'] = "Precio: $100.000. Formas de pago aceptadas: Crédito, USDT, efectivo y euros. "
DATA['REF-020'] = d

# REF-021
d = make_default("Alquiler")
d['metraje'] = "20 metros cuadrados"
d['hab_banos'] = "Una habitación y un baño"
d['estacionamiento'] = "Un puesto de estacionamiento"
d['equipamiento'] = "Cocina y nevera (sin lavadora)"
d['clima'] = "Agradable clima de montaña y ambiente tranquilo"
d['internet'] = "Servicio de WiFi por $20 adicionales"
d['ubicacion'] = "Oripoto, Baruta, frente al colegio Jean Piaget"
d['precios_bloque'] = "Precio: $240 mensuales. Gastos de servicios: WiFi por $20 adicionales. Condiciones de negociación: Dos meses de depósito, un mes de adelanto y un mes de honorarios. "
DATA['REF-021'] = d

# REF-022
d = make_default("Alquiler")
d['metraje'] = "67,5 metros cuadrados"
d['hab_banos'] = "Un baño interno, área de barra y recepción, zona de producción"
d['almacenamiento'] = "Tanque de agua de 600 litros"
d['gas'] = "Gas directo industrial"
d['agua'] = "Todos los servicios básicos habilitados"
d['electricidad'] = "Todos los servicios básicos habilitados"
d['condominio'] = "Condominio se paga por separado"
d['ubicacion'] = "Nivel jardín del Centro Comercial San Ignacio, Chacao"
d['comercios'] = "Excelente flujo peatonal por cercanía a escaleras mecánicas y ascensores"
d['precios_bloque'] = "Precio: $1400 mensuales más condominio. Condiciones de negociación: Dos meses de depósito, seis meses por adelantado y un mes de honorarios. "
DATA['REF-022'] = d

# REF-023
d = make_default("Alquiler")
d['metraje'] = "8 metros cuadrados de área comercial y 6 metros cuadrados adicionales de depósito"
d['condominio'] = "Condominio se paga por separado"
d['ubicacion'] = "Área de mini tiendas de la mezanina del C.C. Galerías Prados del Este"
d['precios_bloque'] = "Precio: Canon mensual de $280 más condominio (incluye un mes de gracia para facilitar su ocupación). Condiciones de negociación: Tres meses de adelanto, dos meses de depósito y un mes de honorarios. "
DATA['REF-023'] = d

# REF-024
d = make_default("Alquiler")
d['metraje'] = "Cava de congelación de 162 m³ (18 m x 3 m x 3 m) y local comercial de 70 m² en primer piso"
d['hab_banos'] = "Local comercial de 70 m² idóneo para oficinas administrativas, logística o almacenamiento en seco"
d['equipamiento'] = "Cava de congelación totalmente nueva a estrenar de 162 m³ (adaptada para comida Kosher)"
d['negociabilidad'] = "Negociable"
d['ubicacion'] = "Pleno centro del pueblo de Baruta, a solo dos cuadras de la plaza"
d['comercios'] = "Ubicación estratégica que facilita acceso para carga, descarga y distribución (cadena de frío)"
d['precios_bloque'] = "Precio: Canon mensual de $2.800 (negociable). "
DATA['REF-024'] = d

# REF-025
d = make_default("Venta")
d['metraje'] = "1.588 m²"
d['hab_banos'] = "16 baños distribuidos entre sus niveles, local comercial de 55 m², consultorios/módulos, 4 oficinas privadas, área para restaurante"
d['estacionamiento'] = "Capacidad de estacionamiento para 5 vehículos"
d['ascensores'] = "Espacio estructural acondicionado para la instalación de un ascensor"
d['seguridad'] = "Área de vigilancia independiente"
d['equipamiento'] = "Cuarto de tanques y espacio destinado para planta eléctrica"
d['negociabilidad'] = "Negociable"
d['ubicacion'] = "San Román"
d['precios_bloque'] = "Precio: $1.750.000 (negociable). "
DATA['REF-025'] = d

# REF-026
d = make_default("Alquiler")
d['metraje'] = "60 m²"
d['hab_banos'] = "Un baño y un depósito pequeño"
d['equipamiento'] = "Dos aires acondicionados, sistema contra incendios, lámpara de emergencia y protector de corriente directo en el tablero principal"
d['estacionamiento'] = "Posibilidad de alquilar hasta 20 puestos de estacionamiento justo enfrente por $30 mensuales por vehículo ($600 total)"
d['ubicacion'] = "San Román"
d['precios_bloque'] = "Precio: $2.499 mensuales. Condiciones de negociación: Dos meses de depósito con pagos trimestral, semestral o anual (opción de acordar tiempo de gracia). Estacionamiento opcional: $30 mensuales por puesto enfrente ($600 total por 20 puestos). "
DATA['REF-026'] = d

# REF-027
d = make_default("Alquiler")
d['metraje'] = "420 m²"
d['hab_banos'] = "Área de recepción, 5 despachos privados, área abierta colaborativa, zona de descanso, comedor, cocina y 8 baños"
d['internet'] = "Internet satelital Starlink"
d['seguridad'] = "Sistema de circuito cerrado de televisión (CCTV) y sistema contra incendios con lámparas de emergencia"
d['electricidad'] = "Protección eléctrica directa desde el tablero principal"
d['agua'] = "Filtrado de agua por luz UV en todas sus instalaciones"
d['estacionamiento'] = "Posibilidad de alquilar hasta 20 puestos justo al frente por tarifa mensual de $30 cada uno ($600 en total)"
d['ubicacion'] = "San Román"
d['precios_bloque'] = "Precio: No especificado en la fuente (canon en alquiler). Condiciones de negociación: Dos meses de depósito junto con modalidades de pago trimestral, semestral o anual. Estacionamiento opcional: $30 mensuales cada puesto enfrente ($600 total por 20 puestos). "
DATA['REF-027'] = d

# REF-028
d = make_default("Alquiler")
d['metraje'] = "Planta baja de 200 m², primer piso de 200 m², terraza de 200 m² al aire libre y 40 m² techados"
d['hab_banos'] = "Planta baja con 2 baños; primer piso con 2 oficinas y 3 baños (total 5 baños y 2 oficinas)"
d['almacenamiento'] = "Tanque de agua de gran capacidad en PB y 3 tanques adicionales de 2.500 litros cada uno en terraza (agua constante)"
d['agua'] = "Agua constante gracias a su elevada capacidad de almacenamiento"
d['electricidad'] = "Suministro eléctrico de luz trifásica y 110v"
d['ascensores'] = "Ascensor de carga operativo para conectar fluidamente sus niveles"
d['equipamiento'] = "Cabina de atención las 24 horas, 6 cajas de cobro, paquetero, área de carga y despacho, 2 neveras exhibidoras, cava de refrigeración, amplia cava congeladora, 2 aires acondicionados Split"
d['antiguedad'] = "5 años de construcción"
d['negociabilidad'] = "Negociables"
d['ubicacion'] = "Calle Argentina de Catia"
d['precios_bloque'] = "Precio: Canon de $6.500 mensuales negociables. "
DATA['REF-028'] = d

# REF-029
d = make_default("Venta")
d['metraje'] = "100 m² distribuidos funcionalmente en dos plantas"
d['operacion_display'] = "Venta (Fondo de comercio llave en mano)"
d['documentacion'] = "Permisología y solvencias municipales al día, licencia de expendio de licores totalmente vigente"
d['ubicacion'] = "Intersección de las calles Sucre y Escalona, en pleno pueblo de El Hatillo"
d['comercios'] = "Alto tráfico peatonal y nocturno, barra de atención directa hacia la calle y área para música en vivo"
d['precios_bloque'] = "Venta: $37.500 (fondo de comercio). Alquiler: $1.000 mensual (canon del local). Precio: Venta $37.500 (fondo de comercio) y canon de alquiler de $1.000 mensual. "
DATA['REF-029'] = d

# REF-030
d = make_default("Alquiler")
d['metraje'] = "34 m²"
d['hab_banos'] = "Un baño privado"
d['agua'] = "Suministro de agua fijo los días lunes, martes y miércoles (factibilidad técnica para tanque auxiliar)"
d['internet'] = "Factibilidad técnica para internet por fibra óptica"
d['nivel'] = "Primer piso con excelente vista e iluminación hacia la calle"
d['condominio'] = "Estimado en $3 (a cargo del inquilino junto con servicios públicos)"
d['ubicacion'] = "San Martín"
d['precios_bloque'] = "Precio: Canon mensual de $400. Condominio: Estimado en $3 a cargo del inquilino. Condiciones de negociación: 3 meses de adelanto, 2 meses de depósito y 1 mes de honorarios profesionales. "
DATA['REF-030'] = d

# REF-031
d = make_default("Alquiler")
d['metraje'] = "118 m² de construcción"
d['hab_banos'] = "Dos baños"
d['estacionamiento'] = "Dos puestos de estacionamiento situados justo al frente"
d['almacenamiento'] = "Tanque de agua"
d['electricidad'] = "Suministro eléctrico de 110v/220v"
d['internet'] = "Conexión a internet por fibra óptica de Netuno"
d['seguridad'] = "Puertas de seguridad"
d['ubicacion'] = "Vía principal Los Guayabitos - Gavilán"
d['precios_bloque'] = "Precio: Canon mensual de $320. Condiciones de negociación: Contrato anual, 2 meses de depósito, 2 meses de adelanto y 1 mes de honorarios profesionales. "
DATA['REF-031'] = d

# REF-032
d = make_default("Alquiler")
d['metraje'] = "157 m²"
d['hab_banos'] = "Una oficina, dos baños y dos depósitos independientes"
d['estacionamiento'] = "Capacidad interna actual para resguardar hasta dos vehículos"
d['ascensores'] = "Ascensor de carga (actualmente inactivo)"
d['agua'] = "Suministro continuo de agua"
d['electricidad'] = "Acometida de 110V y 220V"
d['internet'] = "Acceso a internet por fibra óptica disponible en la zona"
d['seguridad'] = "Puertas metálicas reforzadas con excelente sistema de seguridad"
d['condominio'] = "Aproximado de $27"
d['ubicacion'] = "Puente Hierro"
d['precios_bloque'] = "Precio: Canon mensual de $1.500. Gastos de servicios: $100 de Fospuca. Condominio: Aproximado de $27. Condiciones de negociación: Contrato a 1 año, 6 meses de adelanto (negociables), 3 meses de depósito de garantía (negociables) y 1 mes de honorarios. "
DATA['REF-032'] = d

# REF-033
d = make_default("Alquiler")
d['metraje'] = "100 m²"
d['hab_banos'] = "Un baño privado"
d['agua'] = "Suministro continuo de agua"
d['electricidad'] = "Acometida eléctrica de 220V"
d['internet'] = "Internet por fibra óptica disponible en la zona"
d['estacionamiento'] = "Facilidades de estacionamiento en la calle justo frente a los locales"
d['nivel'] = "Primer piso"
d['ubicacion'] = "Avenida principal de Los Guayabitos - Oripoto"
d['precios_bloque'] = "Precio: Canon de arrendamiento mensual de $270. Condiciones de negociación: Contrato anual, 2 meses de depósito, 1 mes de adelanto y 1 mes de honorarios profesionales. "
DATA['REF-033'] = d

# REF-034
d = make_default("Alquiler")
d['metraje'] = "245 m²"
d['hab_banos'] = "Cinco cubículos o ambientes"
d['almacenamiento'] = "Tanque de agua propio de 20.000 litros (suministro continuo)"
d['agua'] = "Suministro continuo gracias a tanque propio de 20.000 litros"
d['electricidad'] = "Electricidad de 220V"
d['estacionamiento'] = "Puesto de estacionamiento para vehículos"
d['nivel'] = "Primer piso"
d['ubicacion'] = "Toda la Av. Victoria, en Las Acacias"
d['precios_bloque'] = "Precio: Canon mensual de $1.500. "
DATA['REF-034'] = d

# REF-035
d = make_default("Alquiler")
d['metraje'] = "19 m²"
d['hab_banos'] = "Dos cubículos y un baño de uso común"
d['acabados'] = "Sin amoblar"
d['ascensores'] = "Ascensores completamente operativos"
d['seguridad'] = "Vigilancia privada"
d['internet'] = "Disponibilidad para instalar internet de fibra óptica"
d['estacionamiento'] = "Posibilidad de alquilar puestos de estacionamiento por separado"
d['ubicacion'] = "Torre Profesional La California, Avenida Francisco de Miranda en La California Norte"
d['comercios'] = "Transporte público al frente y a una cuadra de estación de metro La California"
d['precios_bloque'] = "Precio: Canon mensual de $300. "
DATA['REF-035'] = d

# REF-036
d = make_default("Alquiler")
d['metraje'] = "52,70 m²"
d['hab_banos'] = "Área de recepción, tres cubículos de trabajo y un baño de uso común"
d['internet'] = "Conexión a internet por fibra óptica"
d['ascensores'] = "Ascensores completamente operativos"
d['seguridad'] = "Vigilancia privada"
d['condominio'] = "Oscila entre $30 y $40 (ya incluido en el canon de arrendamiento)"
d['negociabilidad'] = "Negociable"
d['ubicacion'] = "Torre Profesional La California, Avenida Francisco de Miranda en La California Norte"
d['precios_bloque'] = "Precio: Canon de arrendamiento de $530 mensuales negociable (incluye condominio). Condiciones de negociación: Dos meses de depósito, dos meses de adelanto, un mes de honorarios profesionales y gastos de contrato. "
DATA['REF-036'] = d

# REF-037
d = make_default("Venta")
d['metraje'] = "157 m² (incluye maletero privado de 6 m²)"
d['maletero'] = "Maletero privado de 6 m²"
d['pozo'] = "Pozo de agua profundo"
d['electricidad'] = "Planta eléctrica de capacidad total"
d['vista'] = "Vistas panorámicas aseguradas hacia el majestuoso Ávila"
d['estacionamiento'] = "Estacionamiento aéreo en pisos 3 y 4, dos sótanos y servicio de valet parking bajo derecho de uso"
d['amenidades'] = "Área gastronómica tipo buffet en piso 5, gimnasio exclusivo en piso 6, rooftop para eventos en piso 14"
d['ubicacion'] = "Torre Onyx, Las Mercedes"
d['precios_bloque'] = "Precio: Inversión de $3.500 por metro cuadrado. "
DATA['REF-037'] = d

# REF-038
d = make_default("Alquiler")
d['metraje'] = "50 m²"
d['hab_banos'] = "Área de recepción y dos cubículos de trabajo, con dos baños de uso compartido"
d['acabados'] = "Amoblada"
d['equipamiento'] = "Aire acondicionado"
d['internet'] = "Conexión a internet ABA con factibilidad para instalar fibra óptica"
d['estacionamiento'] = "Puesto de estacionamiento propio (estacionamiento exclusivo para visitantes)"
d['seguridad'] = "Servicio de seguridad privada"
d['ubicacion'] = "Centro Profesional El Paraíso, en plena Avenida Principal José Antonio Páez"
d['precios_bloque'] = "Precio: Canon de arrendamiento mensual de $400. Condiciones de negociación: Un mes por adelantado, tres meses de depósito en garantía y un mes de honorarios profesionales. "
DATA['REF-038'] = d

# REF-039
d = make_default("Alquiler")
d['metraje'] = "124,2 m²"
d['hab_banos'] = "5 oficinas cerradas, 17 cubículos semi cerrados y dos baños"
d['equipamiento'] = "Aire acondicionado central"
d['agua'] = "Servicio de agua directa"
d['electricidad'] = "Electricidad 110V"
d['seguridad'] = "Vigilancia privada (sede policial contigua)"
d['amenidades'] = "Gimnasio en la mezzanina y diversas tiendas en planta baja"
d['nivel'] = "Tercer piso"
d['negociabilidad'] = "Negociables"
d['ubicacion'] = "Parque Carabobo"
d['comercios'] = "Estación del metro justo al frente y estación policial al lado"
d['precios_bloque'] = "Precio: Canon mensual de $800 negociables. Condiciones de negociación: Dos meses de depósito, dos meses por adelantado y un mes de honorarios profesionales. "
DATA['REF-039'] = d

# REF-040
d = make_default("Venta")
d['metraje'] = "155 m²"
d['hab_banos'] = "Área de recepción, seis oficinas privadas cerradas y dos baños"
d['equipamiento'] = "Aire acondicionado central"
d['agua'] = "Servicio de agua directa"
d['electricidad'] = "Suministro eléctrico de 110V"
d['seguridad'] = "Sistema de vigilancia (sede policial contigua)"
d['amenidades'] = "Gimnasio en la mezzanina y diversas tiendas comerciales en la planta baja"
d['nivel'] = "Tercer piso"
d['negociabilidad'] = "Totalmente negociable"
d['ubicacion'] = "Parque Carabobo"
d['comercios'] = "Estación del metro justo al frente y sede policial contigua"
d['precios_bloque'] = "Precio: $75.000 (totalmente negociable). "
DATA['REF-040'] = d

# REF-041 & REF-042
for pid in ['REF-041', 'REF-042']:
    d = make_default("Venta")
    d['metraje'] = "74 m² (conformado por dos oficinas totalmente remodeladas)"
    d['hab_banos'] = "Dos oficinas, un baño modernizado y área de kitchenette"
    d['acabados'] = "Sin amoblar, pisos y topes de piedra sinterizada"
    d['equipamiento'] = "Potente sistema de aire acondicionado de 5 toneladas"
    d['internet'] = "Servicio de internet activo a través de Net Uno"
    d['estacionamiento'] = "Asignación de un puesto de estacionamiento para cada oficina"
    d['seguridad'] = "Vigilancia 24/7 del centro comercial y avanzado sistema de acceso con seguridad biométrica"
    d['nivel'] = "Piso 6 de la Torre E"
    d['ubicacion'] = "Centro Comercial Ciudad Center, en la zona de Boleíta"
    d['precios_bloque'] = "Precio: $145.000. "
    DATA[pid] = d

# REF-043 & REF-044
for pid in ['REF-043', 'REF-044']:
    d = make_default("Venta")
    d['metraje'] = "73 m² cada una"
    d['acabados'] = "En obra gris (ideal para diseñar y adaptar a medida)"
    d['equipamiento'] = "Equipo de aire acondicionado de 5 toneladas"
    d['estacionamiento'] = "Asignación de un puesto de estacionamiento exclusivo"
    d['seguridad'] = "Estricto servicio de vigilancia privada las 24 horas del día"
    d['ubicacion'] = "Ciudad Center, en la zona de Boleíta"
    d['precios_bloque'] = "Precio: $90.000. "
    DATA[pid] = d

# REF-045
d = make_default("Alquiler")
d['metraje'] = "90 m²"
d['hab_banos'] = "Área de recepción, cuatro cubículos de atención y dos baños"
d['acabados'] = "Amoblado para consultorio médico u oficina particular"
d['ascensores'] = "Acceso directo mediante ascensor privado"
d['estacionamiento'] = "Un puesto de estacionamiento"
d['documentacion'] = "Documentación legal y respectivos permisos de sanidad completamente al día"
d['ubicacion'] = "Instituto Médico Integral en San Bernardino"
DATA['REF-045'] = d

# REF-046
d = make_default("Venta")
d['metraje'] = "780 m²"
d['hab_banos'] = "Cinco habitaciones u oficinas adaptables a tu medida, cocina y ocho baños"
d['estacionamiento'] = "Cuatro puestos de estacionamiento cerrados"
d['ascensores'] = "Fosa para ascensor"
d['almacenamiento'] = "Tanque de agua masivo de 12.000 litros"
d['electricidad'] = "Luz trifásica"
d['gas'] = "Gas directo"
d['seguridad'] = "Perímetro completamente cerrado y protegido por cerco eléctrico"
d['proteccion'] = "Cerco eléctrico perimetral"
d['negociabilidad'] = "Negociables"
d['ubicacion'] = "En toda la avenida Roosevelt"
d['precios_bloque'] = "Precio: $500.000 negociables. "
DATA['REF-046'] = d

# REF-047
d = make_default("Venta")
d['metraje'] = "1584 m² de construcción distribuidos en tres niveles de 396 m² cada uno (planta baja con locales de 148 m², 242 m² y 45 m²)"
d['hab_banos'] = "16 baños, tres locales independientes en PB y tercer piso con amplia terraza techada"
d['balcon'] = "Amplia terraza techada en el tercer piso"
d['ascensores'] = "Espacio estructural necesario para instalar un ascensor"
d['documentacion'] = "Documentación completamente al día"
d['formas_pago'] = "Pagos en efectivo, transferencias y criptomonedas"
d['ubicacion'] = "Pleno pueblo de Baruta"
DATA['REF-047'] = d

# REF-048
d = make_default("Venta")
d['metraje'] = "750 m² distribuidos en tres niveles"
d['hab_banos'] = "23 habitaciones con baño privado"
d['almacenamiento'] = "Tanque de agua masivo de 36.000 litros"
d['internet'] = "Conexión a internet por fibra óptica"
d['lavado'] = "Cocina y lavandería equipadas"
d['ascensores'] = "Apto para ancianato con ascensor"
d['documentacion'] = "Toda la documentación al día y lista para el registro"
DATA['REF-048'] = d

# REF-049
d = make_default("Venta")
d['metraje'] = "775 m² de terreno y 1.800 m² de construcción (cinco apartamentos de 250 m² y penthouse de dos niveles)"
d['hab_banos'] = "Cinco apartamentos de 250 m² con 3 habitaciones con baño privado, área de servicio, estudio, baño de visita; más penthouse de dos niveles con sala de juegos y bar"
d['pozo'] = "Pozo de agua de 60.000 litros"
d['estacionamiento'] = "16 puestos de estacionamiento (12 techados)"
d['maletero'] = "Maleteros individuales"
d['seguridad'] = "Conserjería y hall de entrada con baño de visita"
d['balcon'] = "Terraza techada en apartamentos y envidiable terraza con vista directa al Ávila en penthouse"
d['vista'] = "Vista directa al Ávila"
d['documentacion'] = "Documentación al día"
d['negociabilidad'] = "Negociables"
d['ubicacion'] = "Las Mercedes, a tan solo dos cuadras del Centro Comercial Tolón"
d['precios_bloque'] = "Precio: $2.990.000 negociables. "
DATA['REF-049'] = d

# REF-050
d = make_default("Venta")
d['metraje'] = "23.000 m²"
d['negociabilidad'] = "Bastante negociables"
d['financiamiento'] = "Atractivas opciones de financiamiento y todas las formas de pago"
d['formas_pago'] = "Todas las formas de pago y financiamiento aceptadas"
d['ubicacion'] = "Urbanización Monte Elena del Municipio Baruta"
d['comercios'] = "Cercanía a comercios, servicios y transporte público"
d['precios_bloque'] = "Precio: $140.000 bastante negociables. "
DATA['REF-050'] = d

# REF-051
d = make_default("Venta")
d['metraje'] = "11.200 m² con zonificación R5"
d['documentacion'] = "Zonificación R5 (permite conjunto de casas, townhouses o edificios boutique de 4 a 5 pisos)"
d['ubicacion'] = "La Trinidad, en el sureste de Caracas"
d['comercios'] = "Cercanía a los mejores comercios, clínicas y servicios"
d['precios_bloque'] = "Precio: $2.250.000. "
DATA['REF-051'] = d

# REF-052
d = make_default("Venta")
d['metraje'] = "2.840 m² con zonificación R7"
d['documentacion'] = "Zonificación R7 y documentación legal impecable, lista para firmar"
d['ubicacion'] = "Casco Central de Baruta"
DATA['REF-052'] = d

# REF-053 & REF-054
for pid in ['REF-053', 'REF-054']:
    d = make_default("Venta")
    d['metraje'] = "1.891 m² (con 900 m² totalmente planos)"
    d['agua'] = "Servicios de aguas blancas y cloacas"
    d['electricidad'] = "Medidor de electricidad y alumbrado público"
    d['internet'] = "Conexión a internet de alta velocidad por fibra óptica"
    d['documentacion'] = "Zonificación para uso bifamiliar"
    d['negociabilidad'] = "Negociables"
    d['ubicacion'] = "Bosque de La Lagunita, en El Hatillo"
    d['comercios'] = "Muy cerca de la pista de motocross Furia"
    d['precios_bloque'] = "Precio: $50.000 negociables. "
    DATA[pid] = d

# REF-055
d = make_default("Venta")
d['metraje'] = "1.306 m² totalmente planos"
d['agua'] = "Servicios básicos habilitados: agua"
d['electricidad'] = "Electricidad habilitada"
d['internet'] = "Internet habilitado"
d['seguridad'] = "Conjunto residencial cerrado con doble garita de vigilancia"
d['negociabilidad'] = "Negociables"
d['ubicacion'] = "Zona K de Macaracuay"
d['precios_bloque'] = "Precio: $300.000 negociables. "
DATA['REF-055'] = d

# REF-056
d = make_default("Venta")
d['metraje'] = "6.400 m² de terreno y 4.400 m² de sólida construcción distribuidos en dos amplias naves con altura mínima de 6,5 metros"
d['hab_banos'] = "Diez baños (siete operativos en planta principal y tres exclusivos para área administrativa) y versátiles áreas de oficinas en PB y nivel superior"
d['estacionamiento'] = "Tres portones de acceso principal"
d['seguridad'] = "Cuarto de vigilancia propio y cerco eléctrico perimetral"
d['proteccion'] = "Perímetro completamente asegurado con cerco eléctrico"
d['ubicacion'] = "Cagua, estado Aragua"
d['precios_bloque'] = "Precio: $2.000.000. "
DATA['REF-056'] = d

# REF-057
d = make_default("Alquiler")
d['metraje'] = "Más de 300 m² de terreno totalmente plano"
d['hab_banos'] = "2 baños completos, amplio jardín y acogedora churuata"
d['jardin'] = "Amplio jardín y acogedora churuata"
d['estacionamiento'] = "Capacidad para 15 puestos de estacionamiento internos"
d['agua'] = "Suministro ininterrumpido de agua"
d['internet'] = "Conexión WiFi de alta velocidad (NetUno)"
d['electricidad'] = "Red eléctrica adaptada a 110 V y 220 V"
d['seguridad'] = "Entrada privada a nivel de calle con portón eléctrico y moderno sistema de cámaras de seguridad"
d['vista'] = "Impresionante vista panorámica a la montaña"
d['ubicacion'] = "Los Guayabitos, vía El Hatillo (cerca del Volcán)"
d['precios_bloque'] = "Precio: Tarifa de $500 el día (24 horas continuas). "
DATA['REF-057'] = d

# REF-058
d = make_default("Venta")
d['metraje'] = "1.500 m²"
d['hab_banos'] = "Nueve habitaciones climatizadas y once baños impecables"
d['pozo'] = "Pozo de agua y tanque de respaldo"
d['almacenamiento'] = "Tanque de respaldo"
d['electricidad'] = "Planta eléctrica cien por ciento operativa"
d['amenidades'] = "Piscina con tobogán, jacuzzi de agua caliente, restaurante propio, acogedor caney para eventos y terreno para futuras expansiones"
d['estacionamiento'] = "Extenso estacionamiento para más de treinta vehículos"
d['seguridad'] = "Cerco eléctrico perimetral"
d['proteccion'] = "Cerco eléctrico perimetral"
d['negociabilidad'] = "Precio totalmente negociable"
d['ubicacion'] = "Avenida principal de Chichiriviche"
d['precios_bloque'] = "Precio: 250.000 (precio totalmente negociable). "
DATA['REF-058'] = d

# REF-059
d = make_default("Venta")
d['metraje'] = "60 metros cuadrados"
d['hab_banos'] = "Dos luminosas habitaciones y dos baños completos"
d['estacionamiento'] = "Un puesto de estacionamiento techado (múltiples puestos para visitantes)"
d['vista'] = "Hermosa y relajante vista verde"
d['nivel'] = "Segundo piso"
d['amenidades'] = "Agradables áreas comunes perfectas para el esparcimiento"
d['ubicacion'] = "Conjunto residencial Las Haciendas, en la tranquila zona de El Encantado"
DATA['REF-059'] = d

# REF-060
d = make_default("Alquiler")
d['metraje'] = "560 m² de construcción (entrada de 4 metros de altura)"
d['hab_banos'] = "Tres baños (incluyendo uno privado dentro de la oficina principal)"
d['estacionamiento'] = "Más de 30 puestos de estacionamiento al frente (amplia zona de maniobra)"
d['electricidad'] = "Corriente 220V"
d['almacenamiento'] = "Tanque de agua"
d['seguridad'] = "Central de incendios y sistema de circuito cerrado de cámaras de seguridad"
d['clima'] = "Agradable clima de montaña"
d['ubicacion'] = "Kilómetro 19 de la carretera al Junquito (a pie de calle)"
d['precios_bloque'] = "Precio: Canon de arrendamiento mensual de $3.000 por el espacio completo. "
DATA['REF-060'] = d

# REF-061
d = make_default("Alquiler")
d['metraje'] = "55 m²"
d['hab_banos'] = "2 ambientes (1 habitación principal + 1 estudio) y 1 baño remodelado con agua caliente"
d['estacionamiento'] = "No posee puesto propio (estacionamiento público cercano)"
d['agua'] = "Suministro 3 veces al día + 2 días continuo directo de la calle (con agua caliente)"
d['gas'] = "No posee gas directo"
d['electricidad'] = "Cocina eléctrica"
d['equipamiento'] = "Aire acondicionado integrado"
d['acabados'] = "Amoblado / listo para estrenar"
d['condominio'] = "Condominio y servicios aprox $30/mes"
d['formas_pago'] = "Cash / Efectivo (preferiblemente) o Zelle"
d['ubicacion'] = "Torre 200, en plena Av. Fuerzas Armadas"
d['precios_bloque'] = "Precio: Canon de alquiler de $500 (precio final / raya) - Ref. original: $550. Gastos de servicios: Condominio y servicios aprox $30/mes. Condiciones de negociación: Adelanto 3 meses ($1,500), depósito 3 meses ($1,500), gastos administrativos / honorarios $200. "
DATA['REF-061'] = d

# REF-062
d = make_default("Venta")
d['metraje'] = "83 m²"
d['hab_banos'] = "2 habitaciones y 2 baños"
d['estacionamiento'] = "2 puestos de estacionamiento"
d['maletero'] = "1 maletero"
d['nivel'] = "Piso 3"
d['equipamiento'] = "Cocina eléctrica"
d['ascensores'] = "2 ascensores"
d['seguridad'] = "Consejería"
d['amenidades'] = "Área para parrillas (área común)"
d['documentacion'] = "Documentación al día"
d['condominio'] = "65-70 a tasa BCV"
d['formas_pago'] = "Efectivo, Zelle, Transferencia, Binance"
d['ubicacion'] = "Lomas del Sol"
d['comercios'] = "Cerca del Centro Comercial Parque Cerro Verde, Farmatodo y supermercado Río Market"
d['precios_bloque'] = "Precio: $170.000. "
DATA['REF-062'] = d

# Save to verified_data_complete.json
with open(r'C:\Users\boss1\.gemini\antigravity\brain\e3104059-8db9-43ac-bee3-bf1422b72f35\scratch\verified_data_complete.json', 'w', encoding='utf-8') as f:
    json.dump(DATA, f, ensure_ascii=False, indent=2)

print(f"Generated verified dataset for {len(DATA)} properties successfully.")
