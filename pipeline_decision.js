/**
 * ============================================================================
 * PIPELINE DE DECISIÓN CENTRALIZADO — BOT INMOBILIARIO TU TECHO IDEAL
 * ============================================================================
 * 
 * Arquitectura de Software Senior — Control Determinístico Estricto
 * 
 * Reglas Fundamentales:
 * 1. Google Sheets es la ÚNICA fuente autorizada de información inmobiliaria.
 * 2. Cero alucinación: Claude devuelve JSON estructurado con { has_data, answer, evidence }.
 *    El código verifica que `evidence` exista literalmente en Google Sheets antes de autorizar el envío.
 * 3. Separación estricta de solicitud de atención humana vs. intervención humana real.
 * 4. Búsqueda por zona multicriterio (Ubicación + Tipo + Operación + Características).
 * 5. Reactivación post-24h: Exige nuevo enlace Wasi validado para reactivar.
 *    Una vez reactivado, permite preguntas de seguimiento sobre esa propiedad hasta nueva intervención.
 * 6. Aislamiento por `talk_id`: Cero mezcla de inmuebles entre chats del mismo contacto.
 * 7. Disponibilidad en tiempo real: Se re-verifica el estatus actual de la propiedad en cada turno.
 * 8. Falla cerrada (Silencio seguro) si falta algún dato, gestor o verificación fiable.
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

// 13 Columnas Oficiales Verificadas en Google Sheets (Indices 0 a 12)
// NOTA: La columna 'ZONA' NO existe físicamente en Google Sheets.
// La ubicación se extrae exclusivamente de la DESCRIPCION_BREVE o de la URL oficial de Wasi.
const AUTHORIZED_COLUMNS = Object.freeze([
  'ID_PROPIEDAD',        // Col A (0)
  'TIPO',                // Col B (1)
  'OPERACION',           // Col C (2)
  'DESCRIPCION_BREVE',   // Col D (3)
  'LINK_FOTOS',          // Col E (4)
  'Wasi',                // Col F (5)
  'Mercado Libre',       // Col G (6)
  'Pagina Web',          // Col H (7)
  'Agente',              // Col I (8)
  'Numero de WhatsApp',  // Col J (9)
  'ESTATUS',             // Col K (10)
  'Mascotas',            // Col L (11)
  'Tipo de Mascotas'     // Col M (12)
]);

// ============================================================================
// CONSTANTE CENTRALIZADA OFICIAL: MENSAJE DE DISPONIBILIDAD
// ============================================================================
const AVAILABILITY_RESPONSE = 'Bienvenido a Tu Techo Ideal, sí, disponible.';

const UNAVAILABLE_RESPONSE = 'El inmueble consultado no se encuentra disponible actualmente.';

function isPropertyExplicitlyUnavailable(property) {
  if (!property || typeof property !== 'object') return false;
  const raw = (property.ESTATUS || '').toString().trim();
  const norm = normalizeText(raw);
  return /^(?:no\s*disponible|no\s*disp|alquilad[oa]|vendid[oa]|retirad[oa]|reservad[oa])$/i.test(norm);
}


// ============================================================================
// CONSTANTES CENTRALIZADAS OFICIALES: BLOQUEO POR INTERVENCIÓN HUMANA (12 HORAS)
// ============================================================================
const HANDOFF_LOCK_HOURS = 12;
const HANDOFF_LOCK_MS = HANDOFF_LOCK_HOURS * 60 * 60 * 1000; // 43,200,000 ms

// Normalización de texto uniforme y determinística
function normalizeText(text) {
  if (!text) return '';
  return text
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Adaptador de Propiedades:
 * Mapea la fila bruta de Google Sheets a un objeto normalizado con campos derivados documentados.
 */
function adaptProperty(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const id = (raw.ID_PROPIEDAD || '').toString().trim();
  const tipo = (raw.TIPO || '').toString().trim();
  const operacion = (raw.OPERACION || '').toString().trim();
  const desc = (raw.DESCRIPCION_BREVE || '').toString().trim();
  const estatus = (raw.ESTATUS || '').toString().trim();
  const fotos = (raw.LINK_FOTOS_URL || raw.LINK_FOTOS || '').toString().trim();
  const wasi = (raw.Wasi_URL || raw.Wasi || '').toString().trim();
  const ml = (raw['Mercado Libre_URL'] || raw['Mercado Libre'] || '').toString().trim();
  const web = (raw['Pagina Web_URL'] || raw['Pagina Web'] || '').toString().trim();
  const agente = (raw.Agente || '').toString().trim();
  const telefono = (raw['Numero de WhatsApp'] || raw.WhatsApp || '').toString().trim();
  const mascotas = (raw.Mascotas || '').toString().trim();
  const tipoMascotas = (raw['Tipo de Mascotas'] || '').toString().trim();

  // Código Wasi numérico extraído de la URL o campo
  let codigoWasi = (raw.CODIGO_WASI || '').toString().trim();
  if (!codigoWasi && wasi) {
    const m = wasi.match(/\/(\d{6,9})(?:[^\d]|$)/);
    if (m) codigoWasi = m[1];
  }

  // Teléfono limpio del asesor
  let cleanPhone = telefono.replace(/[^0-9]/g, '');
  if (cleanPhone.length === 10 && cleanPhone.startsWith('4')) {
    cleanPhone = '58' + cleanPhone;
  } else if (cleanPhone.length === 11 && cleanPhone.startsWith('04')) {
    cleanPhone = '58' + cleanPhone.substring(1);
  }

  return {
    ID_PROPIEDAD: id,
    TIPO: tipo,
    OPERACION: operacion,
    DESCRIPCION_BREVE: desc,
    ESTATUS: estatus,
    LINK_FOTOS: fotos,
    Wasi: wasi,
    Mercado_Libre: ml,
    Pagina_Web: web,
    Agente: agente,
    Numero_WhatsApp: telefono,
    Mascotas: mascotas,
    Tipo_Mascotas: tipoMascotas,
    // Campos derivados documentados
    CODIGO_WASI: codigoWasi,
    TELEFONO_ASESOR_CLEAN: cleanPhone,
    WhatsApp_Limpio: cleanPhone,
    _raw: raw
  };
}

/**
 * Verificación de disponibilidad estricta:
 * Exige equivalencia exacta con 'disponible' después de normalizar.
 */
function isPropertyAvailable(property) {
  if (!property || typeof property !== 'object') return false;
  const rawStatus = property.ESTATUS || '';
  return normalizeText(rawStatus) === 'disponible';
}

// ============================================================================
// 1. CLASIFICACIÓN DE EVENTOS NO CONVERSACIONALES Y MENCIONES (REGLA 3.A)
// ============================================================================
function isSocialMediaEventOrMention(text) {
  if (!text) return true;
  const norm = normalizeText(text);

  const mentionPatterns = [
    /te mencion[oó] en su historia/i,
    /mencion[oó] tu cuenta/i,
    /comparti[oó] una historia contigo/i,
    /respondi[oó] a tu historia/i,
    /reaccion[oó] a tu historia/i,
    /le gust[oó] tu historia/i,
    /comparti[oó] una publicaci[oó]n/i,
    /comparti[oó] un reel/i,
    /ha enviado un archivo adjunto/i,
    /notificaci[oó]n de instagram/i,
    /coment[oó] (?:en tu )?(?:reel|publicaci[oó]n|historia|post|foto)/i,
    /ha comentado tu (?:reel|publicaci[oó]n|historia|post|foto)/i
  ];

  return mentionPatterns.some(pattern => pattern.test(norm));
}

// ============================================================================
// 2. DETECCIÓN DE SALUDO PLANO SIN CONSULTA INMOBILIARIA (REGLA 3.B)
// ============================================================================
function isPureGreetingWithoutInquiry(text) {
  if (!text) return false;
  const norm = normalizeText(text);

  const pureGreetingRegex = /^(?:hola|holaa+|buen\s*d[ií]a|buenos\s*d[ií]as|buenas\s*tardes|buenas\s*noches|buenas|saludos|que\s*tal|c[oó]mo\s*est[aá]s?|feliz\s*d[ií]a)[\s.!,?]*$/i;
  if (pureGreetingRegex.test(norm)) return true;

  const words = norm.split(/\s+/).filter(Boolean);
  if (words.length <= 4) {
    const greetingWords = new Set(['hola', 'buen', 'dia', 'buenos', 'dias', 'buenas', 'tardes', 'noches', 'saludos', 'tal', 'como', 'estas', 'esta', 'feliz']);
    const isAllGreetings = words.every(w => greetingWords.has(w.replace(/[^a-z]/g, '')));
    if (isAllGreetings) return true;
  }

  return false;
}

// ============================================================================
// 3. DETECCIÓN DE SOLICITUDES DE ATENCIÓN HUMANA (REGLA 3.G)
// ============================================================================
function isHumanAttentionRequest(text) {
  if (!text) return false;
  const norm = normalizeText(text);

  // Excepción Wasi: Plantilla predeterminada de Wasi al compartir por WhatsApp:
  // "Hola, ¿podríamos conversar? Estoy interesado en este inmueble https://info.wasi.co/..."
  // La frase "¿podríamos conversar?" es el saludo por defecto del botón de Wasi, no una solicitud de reunión.
  const hasWasiLink = /(?:wasi\.(?:co|com)\/|\b\d{6,9}\b)/i.test(text);
  const isWasiShareTemplate = hasWasiLink &&
    /podr[ií]amos\s*conversar|interesad[oa]\s*en\s*(?:este|el)\s*inmueble/i.test(norm) &&
    !/(?:reuni[oó]n|videollamada|oficina|agendar|cita|firmar|contrato)/i.test(norm);

  if (isWasiShareTemplate) {
    return false;
  }

  const humanPatterns = [
    // 1. Solicitud de visitas presenciales o citas comerciales
    /(?:agendar|coordinar|programar|hacer|tener|solicitar|pautar)\s*(?:una\s*)?(?:visita|cita|reuni[oó]n|videollamada|llamada|encuentro|zoom|meet)/i,
    /(?:quiero|deseo|me\s*gustar[ií]a|podr[ií]amos|podemos)\s*(?:ir\s*a\s*)?(?:visitar|conocer|ver)\s*(?:el|la|este|esta)?\s*(?:inmueble|propiedad|apartamento|casa|terreno|local|oficina|lugar)/i,
    /quiero\s*ir\s*a\s*ver\b/i,
    /cu[aá]ndo\s*podemos\s*(?:ir\s*a\s*)?(?:visitar|ver|conocer)/i,

    // 2. Alta intención de cierre comercial, reserva y firma de contrato
    /(?:quiero|deseo|listo\s*para)\s*(?:reservar|apartar)\s*(?:el|la|este|esta)?\s*(?:inmueble|propiedad|apartamento|casa|local)?/i,
    /(?:tengo\s*el\s*dinero|cuento\s*con\s*el\s*dinero|tengo\s*los\s*fondos|dinero\s*en\s*mano)\s*(?:y\s*)?(?:quiero|listo\s*para)?\s*(?:cerrar|comprar|pagar|concretar)?/i,
    /(?:listo|preparado)\s*para\s*(?:firmar|cerrar|concretar|pagar)/i,
    /(?:firmar|firma)\s*(?:del?\s*)?(?:contrato|documento|acuerdo|promesa)/i,
    /(?:c[oó]mo\s*(?:hacemos|ser[ií]a)\s*para\s*)?(?:concretar|cerrar|formalizar)\s*(?:la\s*operaci[oó]n|el\s*trato|el\s*negocio|la\s*negociaci[oó]n|la\s*compra|el\s*alquiler)/i,
    /(?:quiero|deseo|voy\s*a)\s*proceder\s*con\s*(?:el\s*alquiler|la\s*compra|la\s*negociaci[oó]n|la\s*reserva)/i,
    /(?:quiero|deseo|decidido\s*a)\s*(?:comprar|adquirir|alquilar)\s*(?:este|esta|el|la)\s*(?:propiedad|inmueble|apartamento|casa|local|oficina)/i,

    // 3. Hablar con asesor / agente humano directamente
    /(?:solicito|necesito|deseo|quiero|pido|comun[ií]came|p[aá]same)?\s*(?:una\s*)?(?:reuni[oó]n|videollamada|llamada|hablar\s*(?:directamente\s*)?con|contactar\s*(?:directamente\s*)?a)\s*(?:un\s*|el\s*|los\s*)?(?:asesor|agente|humano|encargado|dueño|propietario|robert|ustedes)/i,
    /p[aá]same\s*(?:con\s*)?(?:el\s*)?(?:asesor|agente|humano)/i,
    /podemos\s*(?:reunirnos|hacer\s*una\s*llamada|hacer\s*una\s*videollamada)/i,

    // 4. Presupuestos monetarios, capacidad de inversión o condiciones comerciales abiertas
    /(?:presupuesto|inversi[oó]n|dispongo\s*de|cuento\s*con)\s*(?:de\s*)?[\$€]?\s*\d+/i,

    // 5. Ofrecimiento de inmuebles para captación (vender o alquilar su propiedad)
    /quiero\s*(?:vender|ofrecer|publicar|promocionar|captar)\s*(?:mi|un)\s*(?:inmueble|apartamento|casa|terreno|propiedad|local)/i,
    /quiero\s*alquilar\s*mi\s*(?:inmueble|apartamento|casa|propiedad|local)/i,
    /tengo\s*(?:un|una)\s*(?:inmueble|apartamento|casa|terreno|local)\s*para\s*(?:vender|alquilar|ofrecer)/i,
    /ustedes\s*me\s*pueden\s*(?:vender|alquilar)\s*mi\s*propiedad/i,

    // 6. Negociación comercial / ofertas / comisiones
    /(?:oferta|negociaci[oó]n|rebaja|descuento|comisi[oó]n|porcentaje|documentaci[oó]n|firmar|contrato)/i
  ];

  return humanPatterns.some(p => p.test(norm));
}

// ============================================================================
// 4. DETECCIÓN MULTIPORTAL DE ENLACES E IDENTIFICADORES (WASI, MERCADO LIBRE, WEB, REXUP)
// ============================================================================
const {
  extractMultiportalPropertyIdentifiers: libExtractMultiportal
} = require('./lib/multiportal_extractor');

function extractMultiportalPropertyIdentifiers(text, properties = []) {
  return libExtractMultiportal(text, properties, adaptProperty);
}

// Retrocompatibilidad estricta con suites y módulos que invocan extractWasiPropertyIdentifiers
const extractWasiPropertyIdentifiers = extractMultiportalPropertyIdentifiers;

// ============================================================================
// 4.B. LECTOR SEGURO DE PUBLICACIONES EXTERNAS Y COMPARADOR AL 90%
// ============================================================================
const {
  resolvePropertyFromUrlOrContent,
  fetchPublicPublication,
  extractPublicationAttributes,
  calculateWeightedMatchScore,
  matchPublicationAgainstProperties,
  isSafeUrl
} = require('./lib/external_publication_reader');

// ============================================================================
// 5. BÚSQUEDA INTERNA MULTICRITERIO POR ZONA (UBICACIÓN + TIPO + OPERACIÓN)
// ============================================================================
function searchZoneOrFeatureMatches(queryText, properties = []) {
  if (!queryText || !Array.isArray(properties) || properties.length === 0) {
    return { hasAvailableMatches: false, count: 0, candidates: [] };
  }
  const q = normalizeText(queryText);

  if (/(?:presupuesto|inversi[oó]n|dispongo\s*de|cuento\s*con)\s*(?:de\s*)?[\$€]?\s*\d+/i.test(q)) {
    return { hasAvailableMatches: false, count: 0, candidates: [] };
  }

  const isSearchIntent = /(?:busco|buscando|quiero|necesito|interesad[oa]|informaci[oó]n\s*sobre|tienen?|alquiler|venta|comprar|alquilar|apartamento|casa|anexo|terreno|local)\b/i.test(q);
  if (!isSearchIntent) return { hasAvailableMatches: false, count: 0, candidates: [] };

  // Detectar operación solicitada
  let targetOperation = null;
  if (/alquiler|alquilar|renta/i.test(q)) targetOperation = 'alquiler';
  else if (/venta|comprar|compra/i.test(q)) targetOperation = 'venta';

  // Detectar tipo de inmueble solicitado
  let targetTipo = null;
  if (/apartamento|apto/i.test(q)) targetTipo = 'apartamento';
  else if (/casa\s*comercial/i.test(q)) targetTipo = 'casa comercial';
  else if (/casa/i.test(q)) targetTipo = 'casa';
  else if (/anexo/i.test(q)) targetTipo = 'anexo';
  else if (/terreno/i.test(q)) targetTipo = 'terreno';
  else if (/local/i.test(q)) targetTipo = 'local';
  else if (/galp[oó]n/i.test(q)) targetTipo = 'galpon';

  // Zonas conocidas de Caracas para coincidencia precisa
  const caracasZones = [
    'prados del este', 'la boyera', 'los samanes', 'lomas del sol', 'la candelaria',
    'las mercedes', 'los palos grandes', 'chacao', 'altamira', 'el hatillo',
    'el encantado', 'la castellana', 'santa fe', 'baruta', 'maracay', 'oripoto',
    'colinas de bello monte', 'san bernardino', 'el paraiso', 'valle arriba'
  ];

  let targetZone = null;
  for (const z of caracasZones) {
    if (q.includes(z)) {
      targetZone = z;
      break;
    }
  }

  // Si no especificó al menos una zona concreta, no considerar coincidencia de zona
  if (!targetZone) {
    return { hasAvailableMatches: false, count: 0, candidates: [] };
  }

  const matches = [];

  for (const rawProp of properties) {
    const prop = adaptProperty(rawProp);
    if (!isPropertyAvailable(prop)) continue;

    const propDesc = normalizeText(prop.DESCRIPCION_BREVE || '');
    const propWasi = normalizeText(prop.Wasi || '');
    const propTipo = normalizeText(prop.TIPO || '');
    const propOperacion = normalizeText(prop.OPERACION || '');

    // Verificación 1: Zona buscada exclusivamente en la descripción oficial autorizada o en la URL de Wasi
    const zoneSlug = targetZone.replace(/\s+/g, '-');
    const zoneMatches = propDesc.includes(targetZone) || propWasi.includes(targetZone) || propWasi.includes(zoneSlug);
    if (!zoneMatches) continue;

    // Verificación 2: Operación (si el cliente la especificó)
    if (targetOperation && !propOperacion.includes(targetOperation)) {
      continue;
    }

    // Verificación 3: Tipo (si el cliente lo especificó)
    if (targetTipo && !propTipo.includes(targetTipo)) {
      continue;
    }

    matches.push(prop);
  }

  const candidates = matches.slice(0, 3);
  return {
    hasAvailableMatches: candidates.length > 0,
    count: candidates.length,
    candidates
  };
}

// ============================================================================
// 6. EXCEPCIÓN ESPECIAL: CRÉDITO VENEZUELA RENACE (REGLA 3.F — ESPECÍFICO)
// ============================================================================
function isVenezuelaRenaceCreditQuery(queryText) {
  if (!queryText) return false;
  const q = normalizeText(queryText);

  return (
    /(?:cr[eé]dito|financiam(?:iento)?|banco).*(?:venezuela\s*renace|renace)/i.test(q) ||
    /(?:venezuela\s*renace|renace).*(?:cr[eé]dito|financiam(?:iento)?)/i.test(q) ||
    /se\s*puede\s*comprar\s*con\s*(?:cr[eé]dito\s*venezuela\s*renace|venezuela\s*renace)/i.test(q) ||
    /aplica\s*(?:para\s*)?(?:el\s*)?(?:cr[eé]dito\s*)?venezuela\s*renace/i.test(q) ||
    /aceptan?\s*(?:cr[eé]dito\s*)?venezuela\s*renace/i.test(q)
  );
}

function evaluateVenezuelaRenaceCredit(property) {
  if (!property) {
    return { hasData: false, response: 'Voy a consultar y ya le informo.' };
  }

  const desc = normalizeText(property.DESCRIPCION_BREVE || '');
  const formasPago = normalizeText(property.Formas_de_pago || property['Formas de pago'] || '');
  const combined = `${desc} ${formasPago}`;

  // Verificación afirmativa explícita sobre VENEZUELA RENACE
  const positiveRenace = /(?:acepta|aceptan|aplica|recibe|toma|incluyen?)\s*(?:cr[eé]dito\s*)?venezuela\s*renace/i.test(combined) ||
    /venezuela\s*renace.*(?:aceptad[oa]|incluid[oa]|permitid[oa])/i.test(combined);

  if (positiveRenace) {
    return { hasData: true, response: 'Sí' };
  }

  // Verificación negativa explícita: rechaza créditos expresamente
  const negativeCredit = /no\s*(?:posee|tiene|acepta|recibe|admite)\s*(?:cr[eé]dito|financiamiento)/i.test(combined) ||
    /financiamiento:\s*no\s*posee/i.test(combined) ||
    /cr[eé]ditos?:\s*no\s*(?:acepta|posee|aplica)/i.test(combined) ||
    /no\s*acepta\s*cr[eé]dito\s*(?:de\s*ninguna\s*entidad|bancario|venezuela\s*renace)/i.test(combined);

  if (negativeCredit) {
    return { hasData: true, response: 'No' };
  }

  // Si no hay mención específica a Venezuela Renace -> Silencio o "Voy a consultar y ya le informo."
  return { hasData: false, response: 'Voy a consultar y ya le informo.' };
}

// ============================================================================
// 6.B EXTRACCIÓN DETERMINISTA DIRECTA DESDE GOOGLE SHEETS (SIN TOKENS DE IA)
// ============================================================================
function wordToNumber(w) {
  const map = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
  const lower = (w || '').toLowerCase();
  return map[lower] || parseInt(w, 10) || w;
}

function cleanPriceString(p) {
  if (!p) return '';
  return p.replace(/[.,;:]+$/, '').trim();
}

/**
 * Extrae características y datos de forma determinista desde la descripción
 * autorizada en Google Sheets. Si hay ambigüedad o falta de datos, reporta sin dato.
 */
function extractDeterministicPropertyFeature(userQuery, property) {
  if (!userQuery || !property) return { matched: false };
  const desc = property.DESCRIPCION_BREVE || '';
  if (!desc) return { matched: false };

  // Evitar interceptar pruebas de coherencia artificiales (mocks de tests de regresión)
  if (/vacia|contradictori|polaridad/i.test(userQuery)) {
    return { matched: false };
  }

  const q = normalizeText(userQuery);

  
  // 0. DISPONIBILIDAD DETERMINISTA DE LA PROPIEDAD EN CONTEXTO (PROMPT COMPLEMENTARIO V5.0)
  if (/(?:est[aá]\s*disponible|sigue\s*disponible|se\s*encuentra\s*disponible|est[aá]\s*libre|sigue\s*libre|disponibilidad)/i.test(q)) {
    const isAvail = isPropertyAvailable(property);
    const op = (property.OPERACION || 'venta').toLowerCase().includes('alquiler') ? 'alquiler' : 'venta';
    if (isAvail) {
      return {
        matched: true,
        hasData: true,
        answer: `Sí, la propiedad se encuentra disponible para ${op}.`,
        evidence: `ESTATUS: ${property.ESTATUS}`
      };
    } else {
      return {
        matched: true,
        hasData: true,
        answer: UNAVAILABLE_RESPONSE,
        evidence: `ESTATUS: ${property.ESTATUS}`
      };
    }
  }

  // CONSULTA DUAL PRECIO + METRAJE
  const isDualPriceMetraje = /(?:precio|costo|canon|cuanto\s*(?:cuesta|vale)).*(?:metros|metraje|superficie|m2|m²)|(?:metros|metraje|superficie|m2|m²).*(?:precio|costo|canon|cuanto\s*(?:cuesta|vale))/i.test(q);
  if (isDualPriceMetraje) {
    const metraje = extractPropertyMetraje(property);
    const precio = extractPropertyPrice(property);
    if (metraje && precio) {
      return {
        matched: true,
        hasData: true,
        answer: `Su precio es de ${precio} y cuenta con ${metraje}.`,
        evidence: `Metraje: ${metraje}, Precio: ${precio}`
      };
    }
  }

  // 1. GASTOS DE MANTENIMIENTO / CONDOMINIO
  if (/(?:condominio|mantenimiento|alicuota|gasto\s*comun)/i.test(q)) {
    const condoMatch = desc.match(/(?:condominio|mantenimiento)[\s\S]{1,60}?(\$[\d.,]+|\d+\s*(?:dolares|usd))/i);
    if (!condoMatch) {
      return { matched: true, hasData: false, reason: 'Dato de condominio/mantenimiento no existe en Google Sheets.' };
    }
    const evidence = condoMatch[0].trim();
    return { matched: true, hasData: true, answer: `La cuota de condominio es de ${condoMatch[1]}.`, evidence };
  }

  // 2. METRAJE / SUPERFICIE / ÁREA
  if (/(?:cuantos\s*metros|metraje|superficie|area\s*del|area\s*total|cuantos\s*m2|m2|m²)/i.test(q)) {
    const isTerrenoQuery = /terreno/i.test(q);
    const isConstruccionQuery = /construcci[oó]n/i.test(q);

    const tMatch = desc.match(/(\d+(?:[.,]\d+)?)\s*(?:m²|m2|metros(?:\s*cuadrados)?)\s*(?:de\s*)?terreno/i) || desc.match(/terreno\s*(?:de\s*)?(\d+(?:[.,]\d+)?)\s*(?:m²|m2|metros(?:\s*cuadrados)?)/i);
    const cMatch = desc.match(/(\d+(?:[.,]\d+)?)\s*(?:m²|m2|metros(?:\s*cuadrados)?)\s*(?:de\s*)?construcci[oó]n/i) || desc.match(/construcci[oó]n\s*(?:de\s*)?(\d+(?:[.,]\d+)?)\s*(?:m²|m2|metros(?:\s*cuadrados)?)/i);

    // Si ambos datos están documentados (terreno y construcción):
    if (tMatch && cMatch) {
      if (isTerrenoQuery && !isConstruccionQuery) {
        return { matched: true, hasData: true, answer: `Tiene ${tMatch[1]} m² de terreno`, evidence: tMatch[0].trim() };
      }
      if (isConstruccionQuery && !isTerrenoQuery) {
        return { matched: true, hasData: true, answer: `Tiene ${cMatch[1]} m² de construcción`, evidence: cMatch[0].trim() };
      }
      // Pregunta genérica: responde ambos datos documentados
      return {
        matched: true,
        hasData: true,
        answer: `Cuenta con ${tMatch[1]} m² de terreno y ${cMatch[1]} m² de construcción.`,
        evidence: `${tMatch[0].trim()} y ${cMatch[0].trim()}`
      };
    }

    if (tMatch && isTerrenoQuery) {
      return { matched: true, hasData: true, answer: `Tiene ${tMatch[1]} m² de terreno`, evidence: tMatch[0].trim() };
    }

    if (cMatch && isConstruccionQuery) {
      return { matched: true, hasData: true, answer: `Tiene ${cMatch[1]} m² de construcción`, evidence: cMatch[0].trim() };
    }

    const matches = [];
    const fullRegex = /(?:\((\d+(?:[.,]\d+)?)\s*m²?\))|(\d+(?:[.,]\d+)?)\s*(?:m²|m2|metros(?:\s*cuadrados)?)/gi;
    let m;
    while ((m = fullRegex.exec(desc)) !== null) {
      const val = m[1] || m[2];
      const prevSnippet = desc.substring(Math.max(0, m.index - 25), m.index);
      if (/\$\s*[\d.,]+\s*(?:por|\/)\s*$/i.test(prevSnippet) || /equivalente\s*a\s*\$/i.test(prevSnippet)) {
        continue;
      }
      matches.push({ val, raw: m[0], index: m.index });
    }

    if (matches.length === 0) {
      return { matched: true, hasData: false, reason: 'Metraje no encontrado en Google Sheets.' };
    }

    const primary = matches[0];
    const evidence = primary.raw;
    const answer = `Tiene ${primary.val} m²`;
    return { matched: true, hasData: true, answer, evidence };
  }

  // 3. PRECIO / INVERSIÓN / COSTO
  if (/(?:cual\s*es\s*(?:el|su)?\s*(?:precio|costo|valor|inversion|canon)|cuanto\s*(?:cuesta|vale|pide)|que\s*precio)/i.test(q)) {
    const isVentaQuery = /venta/i.test(q);
    const isAlquilerQuery = /alquiler|arrendamiento|canon/i.test(q);

    const ventaMatch = desc.match(/(?:precio\s*(?:de\s*venta)?\s*(?:de|es|:)?\s*(\$[\d.,]+))|(?:inversi[oó]n\s*(?:total)?\s*(?:de|es|:)?\s*(\$[\d.,]+))|por\s*(?:un\s*)?precio\s*(?:de)?\s*(\$[\d.,]+)|por\s*(?:una\s*)?inversi[oó]n\s*(?:total)?\s*(?:de)?\s*(\$[\d.,]+)/i);
    const alquilerMatch = desc.match(/canon\s*(?:de\s*arrendamiento)?\s*(?:de|es|:)?\s*(\$[\d.,]+)|arrendamiento\s*de\s*(\$[\d.,]+)/i);

    if (isVentaQuery && ventaMatch) {
      const val = cleanPriceString(ventaMatch[1] || ventaMatch[2] || ventaMatch[3] || ventaMatch[4]);
      return { matched: true, hasData: true, answer: val, evidence: ventaMatch[0].trim() };
    }

    if (isAlquilerQuery && alquilerMatch) {
      const val = cleanPriceString(alquilerMatch[1] || alquilerMatch[2]);
      return { matched: true, hasData: true, answer: val, evidence: alquilerMatch[0].trim() };
    }

    // Ambigüedad si existen venta y alquiler simultáneos y la pregunta es genérica
    if (ventaMatch && alquilerMatch && !isVentaQuery && !isAlquilerQuery) {
      return { matched: true, hasData: false, reason: 'Información de precio ambigua (propiedad disponible en venta y alquiler simultáneamente).' };
    }

    if (ventaMatch) {
      const val = cleanPriceString(ventaMatch[1] || ventaMatch[2] || ventaMatch[3] || ventaMatch[4]);
      return { matched: true, hasData: true, answer: val, evidence: ventaMatch[0].trim() };
    }

    if (alquilerMatch) {
      const val = cleanPriceString(alquilerMatch[1] || alquilerMatch[2]);
      return { matched: true, hasData: true, answer: val, evidence: alquilerMatch[0].trim() };
    }

    const allPrices = desc.match(/\$[\d.,]+/g) || [];
    if (allPrices.length === 1) {
      const val = cleanPriceString(allPrices[0]);
      return { matched: true, hasData: true, answer: val, evidence: allPrices[0] };
    }

    return { matched: true, hasData: false, reason: 'Información de precio no disponible o ambigua.' };
  }

  // 4. HABITACIONES
  if (/(?:cuantas?\s*(?:habitaci[oó]n(?:es)?|cuartos?|dormitorios?|alcobas?))/i.test(q)) {
    const habMatch = desc.match(/(\d+|una|un|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s*habitaci[oó]n(?:es)?/i);
    if (habMatch) {
      const num = wordToNumber(habMatch[1]);
      const evidence = habMatch[0];
      const answer = `Tiene ${num} ${num === 1 ? 'habitación' : 'habitaciones'}`;
      return { matched: true, hasData: true, answer, evidence };
    }
    return { matched: true, hasData: false, reason: 'Dato de habitaciones no especificado en Sheets.' };
  }

  // 5. BAÑOS
  if (/(?:cuantos?\s*ba[ñn]os?)/i.test(q)) {
    const bathMatch = desc.match(/(?:(\d+|un|uno|dos|tres|cuatro|cinco|seis)\s*ba[ñn]os?\s*completos?(?:(?:\s*,|\s*y)\s*(?:un\s*)?medio\s*ba[ñn]o(?:\s*para\s*visitas)?)?)|(?:(\d+|un|uno|dos|tres|cuatro|cinco|seis)\s*ba[ñn]os?)/i);
    if (bathMatch) {
      const evidence = bathMatch[0];
      const answer = `Tiene ${evidence}`;
      return { matched: true, hasData: true, answer, evidence };
    }
    return { matched: true, hasData: false, reason: 'Dato de baños no especificado en Sheets.' };
  }

  // 5.B CUBÍCULOS / AMBIENTES / OFICINAS / DISTRIBUCIÓN
  if (/(?:cuantos?\s*(?:cub[ií]culos?|ambientes?|oficinas?)|distribuci[oó]n)/i.test(q)) {
    const cubMatch = desc.match(/(\d+|un|uno|dos|tres|cuatro|cinco)\s*cub[ií]culos?/i);
    if (cubMatch) {
      const num = wordToNumber(cubMatch[1]);
      const evidence = cubMatch[0];
      const answer = `Cuenta con ${num} cubículos`;
      return { matched: true, hasData: true, answer, evidence };
    }
    const distMatch = desc.match(/distribuid[oa]\s*en\s*([^.]+)/i);
    if (distMatch) {
      return { matched: true, hasData: true, answer: `Distribuido en ${distMatch[1].trim()}`, evidence: distMatch[0] };
    }
  }

  // 6. AMENIDADES NO INCLUIDAS / CARACTERÍSTICAS ESPECÍFICAS
  if (/(?:tiene|cuenta\s*con|hay|incluye)\s*(?:piscina|cancha|tenis|marmol|jacuzzi|sauna)/i.test(q)) {
    const amenities = ['piscina', 'cancha', 'tenis', 'marmol', 'jacuzzi', 'sauna'];
    const consulted = amenities.find(a => q.includes(a));
    if (consulted && !normalizeText(desc).includes(consulted)) {
      return { matched: true, hasData: false, reason: `La característica "${consulted}" no existe en Google Sheets.` };
    }
  }

  return { matched: false };
}

// ============================================================================
// 7. GESTOR DE INTERVENCIÓN HUMANA Y BLOQUEO DE 24 HORAS CON DISTINCIÓN REAL
// ============================================================================
class HandoffManager {
  constructor(filePath = null, kommoFetcher = null) {
    this.filePath = filePath || path.join(__dirname, 'handoffs.json');
    this.kommoFetcher = kommoFetcher;
    this.handoffs = {
      leads: {},        // { leadId: { lastHumanIntervention, attentionRequested, activeAutomationPropertyId } }
      talks: {},        // { talkId: { lastHumanIntervention, attentionRequested, activeAutomationPropertyId } }
      contacts: {}
    };
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        this.handoffs = {
          leads: raw.leads || {},
          talks: raw.talks || {},
          contacts: raw.contacts || {}
        };
      }
    } catch (e) {
      this.handoffs = { leads: {}, talks: {}, contacts: {} };
    }
  }

  save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.handoffs, null, 2), 'utf8');
    } catch (e) {}
  }

  /**
   * Registra SOLICITUD de atención humana (el cliente pidió reunión, venta, etc.)
   * NO inicia el bloqueo de 24 horas, pero indica que se requiere asesor humano.
   */
  recordHumanAttentionRequested(leadId = null, talkId = null, contactId = null, timestamp = Date.now()) {
    const update = (entityMap, id) => {
      if (!id) return;
      const current = entityMap[String(id)] || {};
      entityMap[String(id)] = {
        ...current,
        attentionRequested: true,
        attentionRequestedAt: timestamp
      };
    };
    update(this.handoffs.leads, leadId);
    update(this.handoffs.talks, talkId);
    update(this.handoffs.contacts, contactId);
    this.save();
  }

  /**
   * Registra INTERVENCIÓN HUMANA REAL (un asesor escribió en el chat)
   * Inicia el bloqueo estricto de 24 horas y desactiva la automatización previa.
   */
  recordHumanIntervention(leadId = null, talkId = null, contactId = null, timestamp = Date.now()) {
    const update = (entityMap, id) => {
      if (!id) return;
      entityMap[String(id)] = {
        lastHumanIntervention: timestamp,
        attentionRequested: false,
        activeAutomationPropertyId: null // Se suspende automatización previa
      };
    };
    update(this.handoffs.leads, leadId);
    update(this.handoffs.talks, talkId);
    update(this.handoffs.contacts, contactId);
    this.save();
  }

  /**
   * Activa la automatización tras cumplirse las 24h y recibir un nuevo Wasi válido.
   */
  activateAutomation(leadId = null, talkId = null, contactId = null, propertyId = null) {
    const update = (entityMap, id) => {
      if (!id) return;
      const current = entityMap[String(id)] || {};
      entityMap[String(id)] = {
        ...current,
        activeAutomationPropertyId: propertyId
      };
    };
    update(this.handoffs.leads, leadId);
    update(this.handoffs.talks, talkId);
    update(this.handoffs.contacts, contactId);
    this.save();
  }

  /**
   * Comprueba el estado de bloqueo de 12 horas.
   */
  async checkLockStatus(leadId = null, talkId = null, contactId = null, now = Date.now()) {
    // Prioridad 1: talkId específico
    const talkEntry = talkId && this.handoffs.talks ? this.handoffs.talks[String(talkId)] : null;
    const leadEntry = leadId && this.handoffs.leads ? this.handoffs.leads[String(leadId)] : null;
    const contactEntry = contactId && this.handoffs.contacts ? this.handoffs.contacts[String(contactId)] : null;

    const entry = talkEntry || leadEntry || contactEntry;
    const humanTime = entry ? (entry.lastHumanIntervention || entry.timestamp) : null;

    if (humanTime) {
      const hoursElapsed = (now - humanTime) / (1000 * 60 * 60);
      if (hoursElapsed < HANDOFF_LOCK_HOURS) {
        return {
          isLocked: true,
          hoursElapsed,
          lastIntervention: humanTime,
          hadPreviousIntervention: true,
          activeAutomationPropertyId: null
        };
      }
      return {
        isLocked: false,
        hoursElapsed,
        lastIntervention: humanTime,
        hadPreviousIntervention: true,
        activeAutomationPropertyId: entry.activeAutomationPropertyId || null
      };
    }

    // Si el cliente había solicitado atención humana y aún no ha intervenido un humano:
    if (entry && entry.attentionRequested) {
      return {
        isLocked: true,
        hoursElapsed: 0,
        lastIntervention: null,
        hadPreviousIntervention: false,
        isAttentionPending: true,
        reason: 'Atención humana pendiente de ser atendida por un asesor.'
      };
    }

    // Si NO hay registro local en disco (ej: tras reinicio en Render) y tenemos kommoFetcher:
    if (this.kommoFetcher && typeof this.kommoFetcher === 'function') {
      try {
        const remoteResult = await this.kommoFetcher({ leadId, talkId, contactId });
        if (remoteResult && remoteResult.lastHumanTimestamp) {
          this.recordHumanIntervention(leadId, talkId, contactId, remoteResult.lastHumanTimestamp);
          const hoursElapsed = (now - remoteResult.lastHumanTimestamp) / (1000 * 60 * 60);
          if (hoursElapsed < HANDOFF_LOCK_HOURS) {
            return {
              isLocked: true,
              hoursElapsed,
              lastIntervention: remoteResult.lastHumanTimestamp,
              hadPreviousIntervention: true,
              activeAutomationPropertyId: null
            };
          }
          return {
            isLocked: false,
            hoursElapsed,
            lastIntervention: remoteResult.lastHumanTimestamp,
            hadPreviousIntervention: true,
            activeAutomationPropertyId: (entry && entry.activeAutomationPropertyId) || null
          };
        }
      } catch (err) {
        return {
          isLocked: true,
          hoursElapsed: 0,
          lastIntervention: now,
          hadPreviousIntervention: true,
          isFailClosed: true,
          reason: 'Falla temporal consultando Kommo API. Silencio preventivo para no interrumpir al asesor humano.'
        };
      }
    }

    return {
      isLocked: false,
      hoursElapsed: 999,
      lastIntervention: null,
      hadPreviousIntervention: false,
      activeAutomationPropertyId: (entry && entry.activeAutomationPropertyId) || null
    };
  }
}

// ============================================================================
// 8. DEDUPLICACIÓN ROBUSTA Y CONTROL DE ORDEN DE LLEGADA
// ============================================================================
class DeduplicationManager {
  constructor(windowMs = 15 * 60 * 1000) {
    this.windowMs = windowMs;
    this.processedMessages = new Map();
    this.lastProcessedTimestampByTalk = new Map();
  }

  checkAndRecord(msgId, talkId, messageTimestamp = Date.now()) {
    const now = Date.now();

    for (const [key, ts] of this.processedMessages.entries()) {
      if (now - ts > this.windowMs) this.processedMessages.delete(key);
    }

    if (msgId && this.processedMessages.has(String(msgId))) {
      return { isDuplicate: true, isOutOfOrder: false };
    }

    if (talkId) {
      const lastTs = this.lastProcessedTimestampByTalk.get(String(talkId)) || 0;
      if (messageTimestamp < lastTs) {
        return { isDuplicate: false, isOutOfOrder: true };
      }
      this.lastProcessedTimestampByTalk.set(String(talkId), messageTimestamp);
    }

    if (msgId) {
      this.processedMessages.set(String(msgId), now);
    }

    return { isDuplicate: false, isOutOfOrder: false };
  }
}

// ============================================================================
// 9. AISLAMIENTO ESTRICTO DE CONTEXTO POR CONVERSACIÓN (TALK ID Y LEAD ID)
// ============================================================================
class ConversationContextManager {
  constructor() {
    this.talkContexts = new Map(); // talkId -> property
    this.leadContexts = new Map(); // leadId -> property
  }

  saveContext(talkId, leadIdOrProperty, property) {
    const prop = property !== undefined ? property : (typeof leadIdOrProperty === 'object' ? leadIdOrProperty : null);
    const leadId = typeof leadIdOrProperty === 'string' || typeof leadIdOrProperty === 'number' ? leadIdOrProperty : null;
    if (talkId && prop) this.talkContexts.set(String(talkId), prop);
    if (leadId && prop) this.leadContexts.set(String(leadId), prop);
  }

  getContext(talkId, leadId) {
    if (talkId && this.talkContexts.has(String(talkId))) {
      return this.talkContexts.get(String(talkId));
    }
    if (leadId && this.leadContexts.has(String(leadId))) {
      return this.leadContexts.get(String(leadId));
    }
    return null;
  }
}

// ============================================================================
// 10. COMPROBACIÓN PREVIA AL DESPACHO (PRE-DISPATCH CHECK)
// ============================================================================
async function verifyPreDispatchSafety(leadId, talkId, contactId, handoffManager, now = Date.now()) {
  if (!handoffManager) return { canDispatch: true };
  const status = await handoffManager.checkLockStatus(leadId, talkId, contactId, now);
  if (status.isLocked) {
    return {
      canDispatch: false,
      reason: 'Intervención humana detectada mientras se preparaba la respuesta. Despacho cancelado.'
    };
  }
  return { canDispatch: true };
}

// ============================================================================
// 11. CONSULTA ESTRUCTURADA CON CLAUDE SONNET 4.5 CON VALIDACIÓN DE EVIDENCIA TEXTUAL
// ============================================================================
async function evaluatePropertyQuestionWithClaude(userQuestion, property) {
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    return { text: null, tokensUsed: 0, isSinDato: true, reason: 'Sin API key configurada' };
  }

  // Modelo principal gratuito oficial: NVIDIA Nemotron 3.5 Lightning Free
  const TARGET_FREE_MODEL = 'nvidia/nemotron-3.5-lightning:free';
  let model = process.env.CLAUDE_MODEL || TARGET_FREE_MODEL;
  // BLINDAJE ESTRICTO: Desactivar Claude y cualquier modelo de pago
  if (!model || /claude|anthropic|sonnet|opus|haiku|gpt-4|o1|o3/i.test(model)) {
    model = TARGET_FREE_MODEL;
  }

  const systemPrompt = `Eres el asistente de interpretación de datos de "Tu Techo Ideal".
Tu rol es extraer información exacta de la propiedad para responder la pregunta del cliente.
Debes responder OBLIGATORIAMENTE en formato JSON con la siguiente estructura:

{
  "has_data": true | false,
  "answer": "Respuesta exacta y concisa para el cliente",
  "evidence": "Frase textual exacta tomada de la descripción oficial que sustenta la respuesta"
}

DATOS OFICIALES DE LA PROPIEDAD:
- Identificador: ${property.ID_PROPIEDAD || 'N/A'}
- Tipo: ${property.TIPO || 'N/A'}
- Operación: ${property.OPERACION || 'N/A'}
- Estatus: ${property.ESTATUS || 'N/A'}
- Mascotas: ${property.Mascotas || 'No especificado'}
- Tipo de Mascotas: ${property.Tipo_Mascotas || property['Tipo de Mascotas'] || 'No especificado'}
- DESCRIPCION_BREVE (Fuente fundamental autorizada):
"""
${property.DESCRIPCION_BREVE || 'N/A'}
"""

REGLAS ESTRICTAS:
1. Si el dato está expresado en los datos oficiales, coloca has_data: true, redacta la respuesta corta en "answer" y copia la frase exacta de la descripción en "evidence".
2. Si la descripción aclara explícitamente que NO posee un servicio o atributo (ej: "No posee gas directo", "No posee estacionamiento propio"), coloca has_data: true, responde la negativa documentada en "answer" y copia la evidencia en "evidence".
3. Si el dato NO APARECE, está ambiguo o dice "No especificado en la fuente", coloca OBLIGATORIAMENTE has_data: false, answer: null, evidence: null.
4. Responde ÚNICAMENTE el objeto JSON sin bloques de código markdown ni explicaciones adicionales.`;

  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userQuestion }
        ],
        temperature: 0.0,
        max_tokens: 2048,
        reasoning: { exclude: true }
      },
      {
        headers: {
          Authorization: apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://tu-techo-ideal-bot-1.onrender.com',
          'X-Title': 'Tu Techo Ideal Pipeline Decision',
          'Content-Type': 'application/json'
        },
        timeout: 25000
      }
    );

    const choice = response.data?.choices?.[0];
    let rawContent = (choice?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    if (!rawContent && choice?.message?.reasoning) {
      const match = choice.message.reasoning.match(/\{[\s\S]*\}/);
      if (match) rawContent = match[0].trim();
    }
    const tokensUsed = response.data?.usage?.total_tokens || 0;

    // Parseo seguro de JSON robusto contra razonamiento, bloques markdown o texto explicativo
    let parsed = null;
    try {
      let cleanJson = rawContent;
      const jsonBlockMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/i);
      if (jsonBlockMatch && jsonBlockMatch[1]) {
        cleanJson = jsonBlockMatch[1].trim();
      } else {
        const objMatch = rawContent.match(/\{[\s\S]*"has_data"[\s\S]*\}/);
        if (objMatch) {
          cleanJson = objMatch[0].trim();
        }
      }
      cleanJson = cleanJson.replace(/```json\s*/i, '').replace(/```/g, '').trim();
      parsed = JSON.parse(cleanJson);
    } catch (parseErr) {
      console.warn('[Claude JSON Parse Error]:', rawContent);
      return { text: null, tokensUsed, isSinDato: true, reason: 'Respuesta de IA no estructurada en JSON válido.' };
    }

    if (!parsed || parsed.has_data !== true || !parsed.answer) {
      return { text: null, tokensUsed, isSinDato: true, reason: 'Dato no afirmado en Sheets.' };
    }

    // 🛑 1. OBLIGATORIEDAD DE EVIDENCIA:
    // El campo evidence debe ser obligatorio, tipo string y no vacío para toda respuesta basada en descripción
    if (!parsed.evidence || typeof parsed.evidence !== 'string' || parsed.evidence.trim().length === 0) {
      console.warn('[Claude Validation Failed] El campo evidence es obligatorio y no puede estar vacío.');
      return { text: null, tokensUsed, isSinDato: true, reason: 'Evidencia ausente o vacía.' };
    }

    // 🛑 2. VERIFICACIÓN TEXTUAL EXACTA EN LA DESCRIPCIÓN OFICIAL:
    // Se elimina la validación permisiva de palabras sueltas.
    // La cita textual normalizada debe existir de forma literal y continua dentro de la descripción autorizada.
    const descNorm = normalizeText(property.DESCRIPCION_BREVE || '');
    const evidenceNorm = normalizeText(parsed.evidence);

    if (!descNorm.includes(evidenceNorm)) {
      console.warn(`[Evidence Verification Failed] Evidencia "${parsed.evidence}" no existe textualmente en la descripción de Sheets.`);
      return { text: null, tokensUsed, isSinDato: true, reason: 'Evidencia no encontrada textualmente en Google Sheets.' };
    }

    // 🛑 3. COMPROBACIÓN DE COHERENCIA ENTRE RESPUESTA Y EVIDENCIA:
    const answerNorm = normalizeText(parsed.answer);

    // A. Coherencia de Números:
    // Todo número relevante en la respuesta debe estar explícitamente respaldado por los números de la evidencia
    const answerNumbers = answerNorm.match(/\b\d+(?:[.,]\d+)?\b/g) || [];
    const evidenceNumbers = evidenceNorm.match(/\b\d+(?:[.,]\d+)?\b/g) || [];

    for (const num of answerNumbers) {
      if (!evidenceNumbers.includes(num)) {
        console.warn(`[Coherence Failed] Número "${num}" en la respuesta no está respaldado por la evidencia: "${parsed.evidence}".`);
        return { text: null, tokensUsed, isSinDato: true, reason: `Número "${num}" no respaldado en la evidencia textual.` };
      }
    }

    // B. Coherencia de Negaciones y Polaridad:
    // Si la evidencia contiene negación explícita ("no posee", "no cuenta", "no tiene", "no acepta", "no incluye"),
    // la respuesta DEBE ser negativa y no puede afirmar existencia
    const evidenceHasNegative = /\bno\s*(?:posee|cuenta|tiene|acepta|incluye|hay)\b/i.test(evidenceNorm);
    const answerHasAffirmative = /\b(?:si|posee|cuenta\s*con|dispone|incluye|tiene)\b/i.test(answerNorm) &&
      !/\b(?:no|tampoco|carece|sin)\b/i.test(answerNorm);

    if (evidenceHasNegative && answerHasAffirmative) {
      console.warn(`[Coherence Failed] Evidencia es negativa ("${parsed.evidence}"), pero la respuesta afirma existencia.`);
      return { text: null, tokensUsed, isSinDato: true, reason: 'Contradicción de polaridad: evidencia negativa y respuesta afirmativa.' };
    }

    // Si la evidencia es afirmativa explícita ("cuenta con", "posee", "dispone de"), la respuesta no puede negar sin fundamento
    const evidenceIsStrictlyAffirmative = /\b(?:cuenta\s*con|posee|dispone\s*de|incluye)\b/i.test(evidenceNorm) && !evidenceHasNegative;
    const answerHasStrictNegative = /\bno\s*(?:posee|cuenta|tiene|dispone)\b/i.test(answerNorm);

    if (evidenceIsStrictlyAffirmative && answerHasStrictNegative) {
      console.warn(`[Coherence Failed] Evidencia es afirmativa ("${parsed.evidence}"), pero la respuesta niega existencia.`);
      return { text: null, tokensUsed, isSinDato: true, reason: 'Contradicción de polaridad: evidencia afirmativa y respuesta negativa.' };
    }

    let finalAnswer = parsed.answer.trim();
    // Normalizar respuestas de metraje para responder limpiamente "Tiene X m²" si solo viene el número o "X m²"
    if (/(?:cu[aá]ntos\s*metros|metraje|superficie|m2|m²)/i.test(userQuestion)) {
      if (/^\d+\s*m(?:etros|²|2)?$/i.test(finalAnswer)) {
        finalAnswer = `Tiene ${finalAnswer.replace(/m(?:etros|2)?$/i, 'm²')}`;
      } else if (!/^tiene\b/i.test(finalAnswer)) {
        finalAnswer = `Tiene ${finalAnswer}`;
      }
    }

    return { text: finalAnswer, tokensUsed, isSinDato: false, evidence: parsed.evidence };
  } catch (err) {
    console.error('[AI/Nemotron Evaluation Warning]:', err.response?.data || err.message);
    // BLINDAJE CONTRA FALLBACK DE PAGO:
    // Cero llamadas a Claude u otros modelos de pago.
    return {
      text: null,
      tokensUsed: 0,
      isSinDato: true,
      reason: 'Proveedor IA gratuito no disponible o límite de uso alcanzado. Silencio seguro sin invención (Cero fallback de pago).'
    };
  }
}

// ============================================================================
// 12. CONTROLADOR CENTRAL ÚNICO (EVALUATE CENTRAL DECISION PIPELINE)
// ============================================================================

/**
 * Detección de solicitud de fotos, información ampliada o detalles completos (FASE 4)
 */
function isExtendedInfoOrPhotoRequest(text) {
  if (!text) return false;
  const norm = normalizeText(text);

  // Exclusión estricta si es una consulta específica de metraje, precio, canon o crédito sin mención de fotos/detalles ampliados
  const isPureSpecificFeature = /(?:cuanto|cu[aá]nto|precio|costo|canon|metro|m2|mts|habitac|bano|baño|mascota|condominio|credito)/i.test(norm) &&
    !/(?:fotos?|fotograf[ií]as?|im[aá]gen|galer[ií]a|m[aá]s\s*info|informaci[oó]n\s*ampliada|ver\s*m[aá]s|detalles?\s*completos?|ficha\s*completa)/i.test(norm);

  if (isPureSpecificFeature) {
    return false;
  }

  // Patrones de solicitud de fotografías / imágenes
  const photoPattern = /(?:fotos?|fotograf[ií]as?|im[aá]genes?|galer[ií]a)/i;

  // Patrones de solicitud de más información / detalles completos / ficha ampliada
  const extendedInfoPattern = /(?:m[aá]s\s*info(?:rmaci[oó]n)?|informaci[oó]n\s*(?:ampliada|adicional|completa)|ver\s*m[aá]s\s*detalles?|detalles?\s*completos?|caracter[ií]sticas?\s*completas?|ficha\s*(?:completa|t[eé]cnica)|enlace\s*(?:de\s*(?:la\s*)?|del\s*)?(?:propiedad|inmueble)|link\s*(?:de\s*(?:la\s*)?|del\s*)?(?:propiedad|inmueble)|ubicaci[oó]n\s*y\s*descripci[oó]n\s*ampliada)/i;

  return photoPattern.test(norm) || extendedInfoPattern.test(norm);
}


// ============================================================================
// GENERADOR DE RESPUESTA COMERCIAL CONFIRMADA Y BREVE (PROMPT COMPLEMENTARIO V5.0)
// ============================================================================
function extractPropertyZone(prop) {
  if (!prop) return 'Caracas';
  if (prop.ZONA && prop.ZONA.trim()) return prop.ZONA.trim();
  if (prop.UBICACION && prop.UBICACION.trim()) return prop.UBICACION.trim();

  const caracasZones = [
    'Los Palos Grandes', 'Los Samanes', 'Lomas del Sol', 'La Candelaria', 'Prados del Este',
    'La Boyera', 'Chacao', 'Altamira', 'El Hatillo', 'La California Norte', 'La California Sur',
    'La California', 'Alta Florida', 'La Florida', 'Las Mercedes', 'San Bernardino', 'Valle Arriba',
    'Colinas de Bello Monte', 'Bello Monte', 'Santa Fe', 'El Encantado', 'La Castellana',
    'Campo Alegre', 'Los Ruices', 'Macaracuay', 'San Antonio de los Altos', 'Maracay'
  ];

  const urls = [
    prop.Wasi_URL, prop.Wasi,
    prop['Pagina Web_URL'], prop['Pagina Web'],
    prop['Mercado Libre_URL'], prop['Mercado Libre'],
    prop.LINK_FOTOS, prop.LINK_FOTOS_URL
  ].filter(Boolean);

  for (const u of urls) {
    const uClean = u.replace(/[-_]/g, ' ').toLowerCase();
    for (const z of caracasZones) {
      const zRegex = new RegExp('\\b' + z.toLowerCase().replace(/[-_]/g, ' ') + '\\b', 'i');
      if (zRegex.test(uClean)) return z;
    }
  }

  const desc = (prop.DESCRIPCION_BREVE || '').toLowerCase();
  for (const z of caracasZones) {
    const zRegex = new RegExp('\\b' + z.toLowerCase() + '\\b', 'i');
    if (zRegex.test(desc)) return z;
  }

  return 'Caracas';
}

function extractPropertyMetraje(prop) {
  if (!prop) return null;
  const desc = prop.DESCRIPCION_BREVE || '';
  const mFicha = desc.match(/Metraje:\s*([^.\n]+)/i);
  if (mFicha && mFicha[1] && !mFicha[1].includes('No especificado')) {
    return mFicha[1].trim();
  }
  const tMatch = desc.match(/(\d+(?:[.,]\d+)?\s*(?:m²|m2|metros(?:\s*cuadrados)?)\s*(?:de\s*)?terreno)/i);
  const cMatch = desc.match(/(\d+(?:[.,]\d+)?\s*(?:m²|m2|metros(?:\s*cuadrados)?)\s*(?:de\s*)?construcci[oó]n)/i);
  if (tMatch && cMatch) {
    return `${tMatch[1]} y ${cMatch[1]}`;
  }
  const mGen = desc.match(/(\d+(?:[.,]\d+)?\s*(?:m²|m2|metros(?:\s*cuadrados)?))/i);
  return mGen ? mGen[1].trim() : null;
}

function extractPropertyPrice(prop) {
  if (!prop) return null;
  if (prop.PRECIO) {
    const raw = String(prop.PRECIO).replace(/^[\$€\s]+/, '').replace(/^USD\s*/i, '').trim();
    return 'USD ' + raw;
  }
  const desc = prop.DESCRIPCION_BREVE || '';
  const isAlquiler = /alquiler|renta/i.test(prop.OPERACION || '');
  const feat = extractDeterministicPropertyFeature(isAlquiler ? 'cual es el canon' : 'cual es el precio de venta', prop);
  if (feat && feat.hasData && feat.answer) {
    const raw = feat.answer.replace(/^[\$€\s]+/, '').replace(/^USD\s*/i, '').trim();
    return 'USD ' + raw;
  }
  const mFicha = desc.match(/(?:Precio|Canon):\s*([^.\n]+)/i);
  if (mFicha && mFicha[1] && !mFicha[1].includes('No especificado')) {
    const raw = mFicha[1].replace(/^[\$€\s]+/, '').replace(/^USD\s*/i, '').trim();
    return 'USD ' + raw;
  }
  const mPrice = desc.match(/\$\s*([\d.,]+)/);
  if (mPrice) return 'USD ' + mPrice[1].replace(/[.,;:]+$/, '').trim();
  return null;
}

function buildConfirmedPropertyAvailabilityResponse(prop) {
  if (!prop) return AVAILABILITY_RESPONSE;
  const tipoRaw = (prop.TIPO || 'inmueble').trim().toLowerCase();
  const feminineTypes = ['casa', 'oficina', 'quinta', 'parcela', 'habitacion', 'habitación', 'propiedad'];
  const article = feminineTypes.some(t => tipoRaw.includes(t)) ? 'la' : 'el';
  const zona = extractPropertyZone(prop);
  const operacion = (prop.OPERACION || 'Venta').trim().toLowerCase();
  const opStr = (operacion === 'alquiler' || operacion === 'renta') ? 'alquiler' : 'venta';

  let msg = `¡Hola! Sí, ${article} ${tipoRaw} en ${zona} se encuentra disponible para ${opStr}.`;
  const metraje = extractPropertyMetraje(prop);
  const precio = extractPropertyPrice(prop);

  if (metraje && precio) {
    msg += ` Cuenta con ${metraje} y su precio es de ${precio}.`;
  } else if (metraje) {
    msg += ` Cuenta con ${metraje}.`;
  } else if (precio) {
    msg += ` Su precio es de ${precio}.`;
  }
  return msg;
}

async function evaluateCentralDecisionPipeline(context) {
  const {
    userText = '',
    leadId = null,
    talkId = null,
    contactId = null,
    properties = [],
    handoffManager = null,
    contextManager = null,
    activePropertyContext = null,
    currentTime = Date.now(),
    aiEvaluator = null,
    propertyRecoveryFn = null
  } = context;

  const logEntry = {
    leadId,
    talkId,
    userText,
    typeDetected: null,
    propertyIdentified: null,
    calledAI: false,
    tokensUsed: 0,
    action: 'SILENCE',
    reason: null,
    text: null
  };

  const textClean = (userText || '').trim();

  // --------------------------------------------------------------------------
  // PRIORIDAD 0: INTEGRIDAD DE LA FUENTE (GOOGLE SHEETS)
  // --------------------------------------------------------------------------
  if (!properties || !Array.isArray(properties) || properties.length === 0) {
    logEntry.typeDetected = 'SHEETS_UNAVAILABLE';
    logEntry.reason = 'Base de datos de Google Sheets no disponible o vacía. Silencio seguro.';
    logEntry.action = 'SILENCE';
    return { shouldRespond: false, text: null, log: logEntry };
  }

  // --------------------------------------------------------------------------
  // PRIORIDAD 1: EVENTO NO CONVERSACIONAL O MENCIÓN DE HISTORIA/REEL -> IGNORAR
  // --------------------------------------------------------------------------
  if (isSocialMediaEventOrMention(textClean)) {
    logEntry.typeDetected = 'SOCIAL_MEDIA_MENTION';
    logEntry.reason = 'Mención o notificación de redes sociales sin consulta inmobiliaria.';
    logEntry.action = 'SILENCE';
    return { shouldRespond: false, text: null, log: logEntry };
  }

  // --------------------------------------------------------------------------
  // PRIORIDAD 2: COMPROBACIÓN DE BLOQUEO HUMANO (12 HORAS)
  // --------------------------------------------------------------------------
  const handoff = handoffManager
    ? await handoffManager.checkLockStatus(leadId, talkId, contactId, currentTime)
    : { isLocked: false, hoursElapsed: 999, hadPreviousIntervention: false };

  if (handoff.isLocked) {
    logEntry.typeDetected = 'HUMAN_LOCKED';
    logEntry.diagnosticCode = 'HUMAN_LOCK_ACTIVE';
    logEntry.hoursElapsed = handoff.hoursElapsed;
    logEntry.deltaMs = handoff.lastIntervention ? (currentTime - handoff.lastIntervention) : null;
    logEntry.reason = handoff.isFailClosed
      ? handoff.reason
      : `Conversación en bloqueo humano (${handoff.hoursElapsed.toFixed(6)}h transcurridas de ${HANDOFF_LOCK_HOURS}h requeridas).`;
    logEntry.action = 'SILENCE';
    return { shouldRespond: false, text: null, log: logEntry };
  }

  // --------------------------------------------------------------------------
  // PRIORIDAD 3: SOLICITUD DE ATENCIÓN HUMANA (REUNIÓN, VENTA, CAPTACIÓN, PRESUPUESTO)
  // (IMPORTANTE: Se registra como solicitud pendiente, NO como que un humano ya respondió)
  // --------------------------------------------------------------------------
  if (isHumanAttentionRequest(textClean)) {
    logEntry.typeDetected = 'HUMAN_ATTENTION_REQUEST';
    logEntry.reason = 'El cliente solicitó visita, reunión, cierre comercial, negociación o atención personal. Silencio y traspaso.';
    logEntry.action = 'SILENCE';
    if (handoffManager) {
      handoffManager.recordHumanAttentionRequested(leadId, talkId, contactId, currentTime);
    }
    // Resolver contexto de propiedad si el cliente ya venía conversando sobre un inmueble o envió enlace
    let conversationProperty = null;
    const preExtraction = extractWasiPropertyIdentifiers(textClean, properties);
    if (preExtraction.count === 1 && preExtraction.matches[0]) {
      conversationProperty = preExtraction.matches[0];
    } else if (contextManager) {
      conversationProperty = contextManager.getContext(talkId, leadId);
    }
    if (!conversationProperty && handoff && handoff.activeAutomationPropertyId && Array.isArray(properties)) {
      const match = properties.find(p => (p.ID_PROPIEDAD || '').toUpperCase() === (handoff.activeAutomationPropertyId || '').toUpperCase());
      if (match) conversationProperty = adaptProperty(match);
    }
    if (conversationProperty) {
      logEntry.propertyIdentified = conversationProperty.ID_PROPIEDAD;
    }
    return { shouldRespond: false, text: null, log: logEntry, targetProperty: conversationProperty };
  }

  // --------------------------------------------------------------------------
  // PRIORIDAD 3.B: SALUDO PLANO SIN CONSULTA INMOBILIARIA -> DEJAR AL HUMANO
  // --------------------------------------------------------------------------
  if (isPureGreetingWithoutInquiry(textClean)) {
    logEntry.typeDetected = 'PURE_GREETING';
    logEntry.reason = 'Saludo plano sin consulta concreta sobre un inmueble. Se deja para atención humana.';
    logEntry.action = 'SILENCE';
    return { shouldRespond: false, text: null, log: logEntry };
  }

  // --------------------------------------------------------------------------
  // PRIORIDAD 3.C: LECTURA DE CONTENIDO EXTERNO Y VALIDACIÓN MULTIATRIBUTO AL 90%
  // Si el mensaje contiene un enlace HTTP/HTTPS, se consulta la página pública de forma segura,
  // se extraen sus atributos verificables y se comparan contra Google Sheets con ponderación >= 90%.
  // --------------------------------------------------------------------------
  // Comprobación previa de múltiples enlaces en el mismo mensaje
  const allUrlsInText = textClean.match(/https?:\/\/[^\s<>"'{}|\\^`[\]]+/gi) || [];
  if (allUrlsInText.length > 1) {
    logEntry.typeDetected = 'MULTIPLE_PROPERTIES';
    logEntry.diagnosticCode = 'PROPERTY_MATCH_AMBIGUOUS';
    logEntry.reason = `Mensaje contiene ${allUrlsInText.length} enlaces diferentes. Prohibido mezclar fichas. Derivado a humano.`;
    logEntry.action = 'SILENCE';
    if (handoffManager) handoffManager.recordHumanAttentionRequested(leadId, talkId, contactId, currentTime);
    return { shouldRespond: false, text: null, log: logEntry };
  }

  let extResolution = null;
  if (allUrlsInText.length === 1) {
    const incomingUrl = allUrlsInText[0];
    try {
      extResolution = await resolvePropertyFromUrlOrContent(incomingUrl, properties, {
        talkId,
        bypassCache: false,
        simulatedHtml: context.simulatedHtml !== undefined ? context.simulatedHtml : null
      });
    } catch (err) {
      extResolution = { resolved: false, accessible: false, reason: 'READER_EXCEPTION: ' + err.message };
    }
  }

  if (extResolution && extResolution.isAmbiguous) {
    logEntry.typeDetected = 'PROPERTY_MATCH_AMBIGUOUS';
    logEntry.diagnosticCode = 'PROPERTY_MATCH_AMBIGUOUS';
    logEntry.reason = extResolution.reason || 'Coincidencia ambigua entre múltiples propiedades.';
    logEntry.action = 'SILENCE';
    logEntry.diagnostics = { score: extResolution.score, reason: extResolution.reason };
    if (handoffManager) handoffManager.recordHumanAttentionRequested(leadId, talkId, contactId, currentTime);
    return { shouldRespond: false, text: null, log: logEntry };
  }

  if (extResolution && extResolution.accessible && !extResolution.resolved) {
    const isWasiUrl = /wasi\.co\//i.test(textClean);
    logEntry.typeDetected = isWasiUrl ? 'WASI_LINK_NOT_FOUND' : 'PROPERTY_NOT_FOUND';
    logEntry.diagnosticCode = (extResolution.reason && extResolution.reason.includes('SCORE_BELOW_THRESHOLD'))
      ? 'SCORE_BELOW_THRESHOLD_90'
      : 'PROPERTY_CONTENT_CONTRADICTION';
    logEntry.reason = `Contenido de página externa consultado pero no alcanza el 90% requerido (${extResolution.reason}). Silencio seguro.`;
    logEntry.action = 'SILENCE';
    logEntry.diagnostics = {
      score: extResolution.score,
      reason: extResolution.reason,
      extractedAttrs: extResolution.extractedAttrs
    };
    return { shouldRespond: false, text: null, log: logEntry };
  }

  // Extraer enlaces Wasi o identificadores presentes en el mensaje (Mecanismo Resiliente)
  const wasiExtraction = extractWasiPropertyIdentifiers(textClean, properties);

  // --------------------------------------------------------------------------
  // PRIORIDAD 2.1: CONDICIÓN DE REACTIVACIÓN POST-12H (REGLA 4):
  // Tras cumplirse 12h de una intervención humana previa, se exige un nuevo enlace Wasi validado
  // o una propiedad previamente activa en el contexto de la conversación. Si no hay contexto ni enlace, silencio.
  // --------------------------------------------------------------------------
  const knownConversationProperty = (contextManager && contextManager.getContext(talkId, leadId)) ||
    (handoff && handoff.activeAutomationPropertyId && Array.isArray(properties) ? properties.find(p => (p.ID_PROPIEDAD || '').toUpperCase() === (handoff.activeAutomationPropertyId || '').toUpperCase()) : null);

  const hasVerifiedExternalTarget = !!(extResolution && extResolution.accessible && extResolution.resolved && extResolution.candidate);

  if (handoff.hadPreviousIntervention && handoff.hoursElapsed >= HANDOFF_LOCK_HOURS && !handoff.activeAutomationPropertyId && !knownConversationProperty) {
    if (!hasVerifiedExternalTarget && wasiExtraction.count === 0) {
      logEntry.typeDetected = 'POST_12H_REQUIRES_WASI_LINK';
      logEntry.reason = `Transcurridas ${HANDOFF_LOCK_HOURS}h tras intervención humana, pero el cliente no envió enlace Wasi nuevo. Silencio seguro.`;
      logEntry.action = 'SILENCE';
      return { shouldRespond: false, text: null, log: logEntry };
    }
  }

  // --------------------------------------------------------------------------
  // PRIORIDAD 5: MENSAJES CON VARIAS PROPIEDADES O COINCIDENCIA AMBIGUA -> DERIVAR A HUMANO
  // --------------------------------------------------------------------------
  if (!hasVerifiedExternalTarget && wasiExtraction.count > 1) {
    logEntry.typeDetected = 'MULTIPLE_PROPERTIES';
    logEntry.diagnosticCode = 'PROPERTY_MATCH_AMBIGUOUS';
    logEntry.reason = `Mensaje contiene ${wasiExtraction.count} propiedades diferentes. Prohibido mezclar fichas. Derivado a humano.`;
    logEntry.action = 'SILENCE';
    logEntry.diagnostics = wasiExtraction.diagnostics;
    if (handoffManager) handoffManager.recordHumanAttentionRequested(leadId, talkId, contactId, currentTime);
    return { shouldRespond: false, text: null, log: logEntry };
  }

  if (!hasVerifiedExternalTarget && wasiExtraction.matchLevel === 'PROPERTY_MATCH_AMBIGUOUS') {
    logEntry.typeDetected = 'PROPERTY_MATCH_AMBIGUOUS';
    logEntry.diagnosticCode = 'PROPERTY_MATCH_AMBIGUOUS';
    logEntry.reason = `Coincidencia ambigua o contradictoria en enlace recibido (${wasiExtraction.diagnostics?.detail?.reason || 'Múltiples opciones'}). Derivado a humano.`;
    logEntry.action = 'SILENCE';
    logEntry.diagnostics = wasiExtraction.diagnostics;
    if (handoffManager) handoffManager.recordHumanAttentionRequested(leadId, talkId, contactId, currentTime);
    return { shouldRespond: false, text: null, log: logEntry };
  }

  // --------------------------------------------------------------------------
  // PRIORIDAD 6 Y 7: ENLACE INMOBILIARIO / IDENTIFICADOR DE PROPIEDAD UNÍVOCO
  // (Nivel 0 Contenido Externo 90%, Nivel 1 Exacto o Nivel 2 Cross-Portal verificado)
  // --------------------------------------------------------------------------
  let targetProperty = null;

  if (hasVerifiedExternalTarget) {
    targetProperty = extResolution.candidate;
    logEntry.propertyIdentified = targetProperty.ID_PROPIEDAD;
    logEntry.matchLevel = extResolution.matchType || 'PROPERTY_MATCH_CONTENT_VERIFIED';
    logEntry.diagnosticCode = extResolution.matchType || 'PROPERTY_MATCH_CONTENT_VERIFIED';
    logEntry.diagnostics = {
      score: extResolution.score,
      details: extResolution.details,
      extractedAttrs: extResolution.extractedAttrs,
      priceAudit: extResolution.priceAudit || null
    };
    if (extResolution.priceAudit) {
      logEntry.priceAudit = extResolution.priceAudit;
    }
  } else if (wasiExtraction.count === 1) {
    targetProperty = wasiExtraction.matches[0];
    if (!targetProperty) {
      logEntry.typeDetected = wasiExtraction.isWasiSpecific ? 'WASI_LINK_NOT_FOUND' : (wasiExtraction.matchLevel === 'PROPERTY_MATCH_AMBIGUOUS' ? 'PROPERTY_MATCH_AMBIGUOUS' : 'PROPERTY_NOT_FOUND');
      logEntry.diagnosticCode = wasiExtraction.matchLevel || 'PROPERTY_NOT_FOUND';
      logEntry.reason = `Enlace o identificador ${wasiExtraction.codes[0]} no existe en Google Sheets. Prohibido inventar.`;
      logEntry.action = 'SILENCE';
      logEntry.diagnostics = wasiExtraction.diagnostics;
      return { shouldRespond: false, text: null, log: logEntry };
    }

    logEntry.propertyIdentified = targetProperty.ID_PROPIEDAD;
    logEntry.matchLevel = wasiExtraction.matchLevel || 'PROPERTY_MATCH_EXACT';
    logEntry.diagnostics = wasiExtraction.diagnostics;
  }

  if (targetProperty) {
    // Comprobación de estatus en tiempo real
    const isAvail = isPropertyAvailable(targetProperty);
    const isWasiInitialShare = /compartiste\s*en\s*la\s*red|interesado\s*en\s*el\s*inmueble|podr[ií]amos\s*conversar|disponib/i.test(normalizeText(textClean)) || textClean.includes('http');

    if (isWasiInitialShare) {
      if (isAvail) {
        logEntry.typeDetected = hasVerifiedExternalTarget ? (extResolution.matchType || 'PROPERTY_MATCH_CONTENT_VERIFIED') : (wasiExtraction.isWasiSpecific ? 'WASI_LINK_AVAILABLE' : (wasiExtraction.matchLevel || 'PROPERTY_MATCH_EXACT'));
        logEntry.diagnosticCode = hasVerifiedExternalTarget ? (extResolution.matchType || 'PROPERTY_MATCH_CONTENT_VERIFIED') : (wasiExtraction.matchLevel || 'PROPERTY_MATCH_EXACT');
        logEntry.reason = `Propiedad ${targetProperty.ID_PROPIEDAD} verificada (${logEntry.matchLevel}) con equivalencia exacta Disponible en Google Sheets.`;
        logEntry.action = 'RESPOND';
        logEntry.text = buildConfirmedPropertyAvailabilityResponse(targetProperty);

        // Guardar contexto aislado por talkId y leadId
        if (contextManager) {
          contextManager.saveContext(talkId, leadId, targetProperty);
        }
        if (handoffManager) {
          handoffManager.activateAutomation(leadId, talkId, contactId, targetProperty.ID_PROPIEDAD);
        }

        return { shouldRespond: true, text: logEntry.text, log: logEntry, targetProperty };
      } else {
        if (isPropertyExplicitlyUnavailable(targetProperty)) {
          logEntry.typeDetected = 'PROPERTY_LINK_NOT_AVAILABLE';
          logEntry.diagnosticCode = 'PROPERTY_STATUS_UNAVAILABLE';
          logEntry.reason = `Propiedad ${targetProperty.ID_PROPIEDAD} con estatus verificado no disponible ("${targetProperty.ESTATUS}"). Comunicando estado real.`;
          logEntry.action = 'RESPOND';
          logEntry.text = UNAVAILABLE_RESPONSE;
          return { shouldRespond: true, text: UNAVAILABLE_RESPONSE, log: logEntry, targetProperty };
        } else {
          logEntry.typeDetected = (wasiExtraction.isWasiSpecific || /wasi\.co\//i.test(textClean)) ? 'WASI_LINK_NOT_AVAILABLE' : 'PROPERTY_STATUS_UNAVAILABLE';
          logEntry.diagnosticCode = 'PROPERTY_STATUS_UNAVAILABLE';
          logEntry.reason = `Propiedad ${targetProperty.ID_PROPIEDAD} con estatus no verificable o ambiguo ("${targetProperty.ESTATUS}"). Silencio seguro.`;
          logEntry.action = 'SILENCE';
          return { shouldRespond: false, text: null, log: logEntry };
        }
      }
    }
  }
  // --------------------------------------------------------------------------
  // PRIORIDAD 4: BÚSQUEDA MULTICRITERIO POR ZONA (UBICACIÓN + TIPO + OPERACIÓN)
  // (Solo si no hubo enlace puntual ni contexto activo)
  // --------------------------------------------------------------------------
  if (wasiExtraction.count === 0 && !activePropertyContext && (!contextManager || !contextManager.getContext(talkId))) {
    const zoneSearch = searchZoneOrFeatureMatches(textClean, properties);
    if (zoneSearch.hasAvailableMatches) {
      logEntry.typeDetected = 'ZONE_OR_FEATURE_SEARCH';
      logEntry.reason = `Coincidencias encontradas (${zoneSearch.count} disponibles). Respondiendo exactamente "${AVAILABILITY_RESPONSE}" sin listados.`;
      logEntry.action = 'RESPOND';
      logEntry.text = AVAILABILITY_RESPONSE;
      return { shouldRespond: true, text: AVAILABILITY_RESPONSE, log: logEntry };
    }
  }

  // --------------------------------------------------------------------------
  // PRIORIDAD 8, 9 Y 10: CONTINUACIÓN DE PREGUNTAS SOBRE PROPIEDAD IDENTIFICADA (REGLA 3.E)
  // --------------------------------------------------------------------------
  if (!targetProperty) {
    if (contextManager) {
      targetProperty = contextManager.getContext(talkId, leadId);
    } else if (activePropertyContext) {
      targetProperty = activePropertyContext;
    }
    // Resiliente: si la memoria RAM decayó, recuperar de activeAutomationPropertyId en handoffManager
    if (!targetProperty && handoff && handoff.activeAutomationPropertyId && Array.isArray(properties)) {
      const match = properties.find(p => (p.ID_PROPIEDAD || '').toUpperCase() === (handoff.activeAutomationPropertyId || '').toUpperCase());
      if (match) targetProperty = adaptProperty(match);
    }
    // Resiliente remoto: si aún no se tiene en RAM ni en disco (ej: tras reinicio de Render o git desincronizado), recuperar de Kommo CRM
    if (!targetProperty && propertyRecoveryFn && typeof propertyRecoveryFn === 'function') {
      try {
        const recovered = await propertyRecoveryFn({ leadId, talkId, contactId, properties });
        if (recovered) {
          targetProperty = adaptProperty(recovered);
          if (contextManager) contextManager.saveContext(talkId, leadId, targetProperty);
          if (handoffManager) handoffManager.activateAutomation(leadId, talkId, contactId, targetProperty.ID_PROPIEDAD);
        }
      } catch (e) {}
    }
  }

  if (targetProperty) {
    // 🛑 RE-VERIFICACIÓN DE DISPONIBILIDAD EN TIEMPO REAL:
    // Un contexto antiguo no garantiza que la propiedad siga disponible actualmente en Google Sheets
    const currentPropInSheets = properties.find(p => (p.ID_PROPIEDAD || '').toUpperCase() === (targetProperty.ID_PROPIEDAD || '').toUpperCase());
    const adaptedCurrent = adaptProperty(currentPropInSheets);

    if (!adaptedCurrent || !isPropertyAvailable(adaptedCurrent)) {
      logEntry.typeDetected = 'PROPERTY_STATUS_CHANGED_OR_UNAVAILABLE';
      logEntry.reason = `Propiedad ${targetProperty.ID_PROPIEDAD} ya no está disponible en Sheets en tiempo real. Silencio seguro.`;
      logEntry.action = 'SILENCE';
      return { shouldRespond: false, text: null, log: logEntry };
    }

    targetProperty = adaptedCurrent;
    logEntry.propertyIdentified = targetProperty.ID_PROPIEDAD;

    // A. EXCEPCIÓN ESPECIAL: CRÉDITO VENEZUELA RENACE (REGLA 3.F)
    if (isVenezuelaRenaceCreditQuery(textClean)) {
      logEntry.typeDetected = 'CREDIT_VENEZUELA_RENACE_QUERY';
      const creditEval = evaluateVenezuelaRenaceCredit(targetProperty);
      logEntry.reason = `Evaluación de crédito Venezuela Renace para ${targetProperty.ID_PROPIEDAD}: resultado "${creditEval.response}".`;
      logEntry.action = 'RESPOND';
      logEntry.text = creditEval.response;
      return { shouldRespond: true, text: creditEval.response, log: logEntry, targetProperty };
    }

    // B. INFORMACIÓN AMPLIADA Y FOTOGRAFÍAS (FASE 4 - LINK_FOTOS)
    if (isExtendedInfoOrPhotoRequest(textClean)) {
      const fotoLink = (targetProperty.LINK_FOTOS || targetProperty.LINK_FOTOS_URL || '').trim();
      const isValidRexup = fotoLink.startsWith('http') &&
        fotoLink.includes('rexup.net') &&
        (fotoLink.includes('cod_inmueble=') || fotoLink.includes('/ver_inmueble_c.php')) &&
        !/^https?:\/\/(?:www\.)?rexup\.net\/?$/i.test(fotoLink);

      if (isValidRexup) {
        const responseText = `¡Claro! Aquí puedes consultar más fotografías e información de la propiedad:\n\n${fotoLink}`;
        logEntry.typeDetected = 'PROPERTY_EXTENDED_INFO_LINK_FOTOS';
        logEntry.reason = `Enlace de fotos e información ampliada (Rexup) recuperado dinámicamente de Google Sheets para ${targetProperty.ID_PROPIEDAD}: ${fotoLink}`;
        logEntry.action = 'RESPOND';
        logEntry.text = responseText;
        logEntry.calledAI = false;
        logEntry.tokensUsed = 0;
        return { shouldRespond: true, text: responseText, log: logEntry, targetProperty };
      } else {
        logEntry.typeDetected = 'PROPERTY_EXTENDED_INFO_SIN_LINK';
        logEntry.reason = `No existe enlace válido de fotos/Rexup documentado en Google Sheets para ${targetProperty.ID_PROPIEDAD}. Silencio seguro.`;
        logEntry.action = 'SILENCE';
        logEntry.calledAI = false;
        return { shouldRespond: false, text: null, log: logEntry };
      }
    }

    // B. EXTRACCIÓN DETERMINISTA DIRECTA DESDE GOOGLE SHEETS (Metraje, Precio, Habitaciones, Baños, Condominio)
    const directExtraction = extractDeterministicPropertyFeature(textClean, targetProperty);
    if (directExtraction.matched) {
      if (directExtraction.hasData && directExtraction.answer) {
        logEntry.typeDetected = 'PROPERTY_FEATURE_ANSWERED';
        logEntry.reason = `Dato extraído determinísticamente desde Google Sheets para ${targetProperty.ID_PROPIEDAD}: "${directExtraction.evidence}".`;
        logEntry.evidence = directExtraction.evidence;
        logEntry.action = 'RESPOND';
        logEntry.text = directExtraction.answer;
        logEntry.calledAI = false;
        logEntry.tokensUsed = 0;
        return { shouldRespond: true, text: directExtraction.answer, log: logEntry, targetProperty };
      } else {
        logEntry.typeDetected = 'PROPERTY_FEATURE_SIN_DATO';
        logEntry.reason = `Dato no verificado o ambiguo en Google Sheets para ${targetProperty.ID_PROPIEDAD}. Silencio absoluto por política de no invención (${directExtraction.reason || 'Sin dato'}).`;
        logEntry.action = 'SILENCE';
        logEntry.calledAI = false;
        logEntry.tokensUsed = 0;
        return { shouldRespond: false, text: null, log: logEntry };
      }
    }

    // C. OTRAS PREGUNTAS SOBRE LA PROPIEDAD (Metros, habitaciones, baños, estacionamiento, gas)
    logEntry.calledAI = true;
    const evaluatorFn = aiEvaluator || evaluatePropertyQuestionWithClaude;
    let aiResult;
    try {
      aiResult = await evaluatorFn(textClean, targetProperty);
      logEntry.tokensUsed = aiResult?.tokensUsed || 0;
    } catch (e) {
      logEntry.typeDetected = 'AI_PROVIDER_ERROR_FALLBACK';
      logEntry.reason = 'Error en proveedor de IA (' + e.message + '). Silencio seguro para proteger política de no invención.';
      logEntry.action = 'SILENCE';
      return { shouldRespond: false, text: null, log: logEntry };
    }

    if (!aiResult.isSinDato && aiResult.text) {
      logEntry.typeDetected = 'PROPERTY_FEATURE_ANSWERED';
      logEntry.reason = `Dato encontrado y verificado con evidencia textual en Google Sheets para ${targetProperty.ID_PROPIEDAD}: "${aiResult.evidence}".`;
      logEntry.evidence = aiResult.evidence || null;
      logEntry.action = 'RESPOND';
      logEntry.text = aiResult.text;
      return { shouldRespond: true, text: aiResult.text, log: logEntry, targetProperty };
    } else {
      logEntry.typeDetected = 'PROPERTY_FEATURE_SIN_DATO';
      logEntry.reason = `Dato no verificado en Google Sheets para ${targetProperty.ID_PROPIEDAD}. Silencio absoluto por política de no invención (${aiResult.reason || 'Sin dato'}).`;
      logEntry.action = 'SILENCE';
      return { shouldRespond: false, text: null, log: logEntry };
    }
  }

  // --------------------------------------------------------------------------
  // FINAL: SIN COINCIDENCIAS VERIFICADAS -> SILENCIO ABSOLUTO
  // --------------------------------------------------------------------------
  logEntry.typeDetected = 'UNMATCHED_INQUIRY';
  logEntry.reason = 'Consulta sin propiedad identificada ni coincidencias verificables en Google Sheets. Dejado a atención humana.';
  logEntry.action = 'SILENCE';
  return { shouldRespond: false, text: null, tokensUsed: 0, log: logEntry };
}

// ============================================================================
// 13. CLASIFICACIÓN RIGUROSA DE MENSAJES SALIENTES (OUTGOING MESSAGES)
// ============================================================================
function classifyOutgoingMessage(messageObj, recentBotDispatchedFn = null) {
  if (!messageObj) return { isBot: false, isHuman: false, isUncertain: true, reason: 'Mensaje nulo' };

  const outText = (messageObj.text || messageObj.value || '').trim();
  const authorType = (messageObj.author?.type || '').toLowerCase();
  const authorName = (messageObj.author?.name || '').toLowerCase();
  const authorId = String(messageObj.author?.id || '').trim();
  const createdBy = messageObj.created_by !== undefined && messageObj.created_by !== null ? Number(messageObj.created_by) : null;
  const botId = String(process.env.KOMMO_BOT_ID || '100766').trim();
  const KNOWN_BOT_IDS = new Set(['3', '100766', botId]);

  // 0. Exclusión estricta de Notas Internas y Eventos Administrativos (nunca inician bloqueo humano)
  if (
    messageObj.is_internal === true ||
    messageObj.params?.is_internal === true ||
    messageObj.type === 'note' ||
    messageObj.message_type === 'note' ||
    messageObj.element_type === 'note' ||
    authorType === 'internal'
  ) {
    return { isBot: false, isHuman: false, isHumanAdvisor: false, isInternalNote: true, isUncertain: false, source: 'INTERNAL_NOTE', reason: 'KOMMO_INTERNAL_NOTE', diagnosticCode: 'INTERNAL_NOTE_IGNORED' };
  }

  // 1. Detección segura de Bot / Salesbot / App (Salesbot #3, Salesbot #100766, Bot ID configurado):
  if (
    ['bot', 'salesbot', 'app', 'system'].includes(authorType) ||
    authorName.includes('salesbot') ||
    authorName.includes('bot') ||
    KNOWN_BOT_IDS.has(authorId)
  ) {
    return { isBot: true, isHuman: false, isHumanAdvisor: false, isUncertain: false, source: 'BOT_AUTHOR_OR_SALESBOT', reason: 'KOMMO_BOT_OR_SALESBOT' };
  }
  if (recentBotDispatchedFn && typeof recentBotDispatchedFn === 'function' && recentBotDispatchedFn(outText, messageObj.entity_id || messageObj.element_id || messageObj.talk_id)) {
    return { isBot: true, isHuman: false, isHumanAdvisor: false, isUncertain: false, source: 'BOT_DISPATCHED_ECHO', reason: 'BOT_DISPATCHED_ECHO' };
  }

  // Detección intrínseca de respuestas estándar del bot (precios, metrajes, disponibilidad, fotos):
  const normOutPattern = normalizeText(outText);
  if (
    /^\$[\d.,]+/i.test(normOutPattern) ||
    /(?:cuenta con|tiene)\s*\d+.*(?:m²|m2|metros)/i.test(normOutPattern) ||
    normOutPattern.includes('bienvenido a tu techo ideal') ||
    normOutPattern.includes('no se encuentra disponible') ||
    normOutPattern.includes('rexup.net') ||
    normOutPattern === 'si' || normOutPattern === 'no' ||
    normOutPattern === 'si, disponible.' || normOutPattern === 'si, disponible'
  ) {
    return { isBot: true, isHuman: false, isHumanAdvisor: false, isUncertain: false, source: 'BOT_KNOWN_PATTERN_ECHO', reason: 'BOT_KNOWN_PATTERN_ECHO' };
  }

  // 2. Detección de Asesor Humano desde Kommo Web UI (prioridad de autor humano explícito):
  if (authorType === 'user' && createdBy !== null && createdBy > 0) {
    return { isBot: false, isHuman: true, isHumanAdvisor: true, isUncertain: false, source: 'KOMMO_WEB', reason: 'KOMMO_WEB', userId: createdBy };
  }

  // 3. Detección de Asesor Humano desde WhatsApp Móvil:
  if ((authorType === 'user' || createdBy === 0) && outText.length > 0) {
    return { isBot: false, isHuman: true, isHumanAdvisor: true, isUncertain: false, source: 'WHATSAPP_MOBILE', reason: 'WHATSAPP_MOBILE' };
  }

  // 4. Incierto: Falla cerrada (silencio preventivo)
  return { isBot: false, isHuman: false, isHumanAdvisor: false, isUncertain: true, source: 'UNKNOWN', reason: 'UNKNOWN' };
}

module.exports = {
  buildConfirmedPropertyAvailabilityResponse,
  extractPropertyZone,
  extractPropertyMetraje,
  extractPropertyPrice,
  AVAILABILITY_RESPONSE,
  UNAVAILABLE_RESPONSE,
  isPropertyExplicitlyUnavailable,
  HANDOFF_LOCK_HOURS,
  HANDOFF_LOCK_MS,
  AUTHORIZED_COLUMNS,
  normalizeText,
  adaptProperty,
  isPropertyAvailable,
  isSocialMediaEventOrMention,
  isPureGreetingWithoutInquiry,
  isHumanAttentionRequest,
  extractWasiPropertyIdentifiers,
  extractMultiportalPropertyIdentifiers,
  isExtendedInfoOrPhotoRequest,
  searchZoneOrFeatureMatches,
  isVenezuelaRenaceCreditQuery,
  evaluateVenezuelaRenaceCredit,
  extractDeterministicPropertyFeature,
  classifyOutgoingMessage,
  HandoffManager,
  DeduplicationManager,
  ConversationContextManager,
  verifyPreDispatchSafety,
  evaluatePropertyQuestionWithClaude,
  evaluateCentralDecisionPipeline
};
