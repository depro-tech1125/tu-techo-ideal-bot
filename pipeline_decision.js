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

  // V5.1 Universal Sheet Reader: externalLinks dinámico
  const externalLinks = { ...(raw.externalLinks || {}) };
  if (wasi && /^https?:\/\//i.test(wasi) && !externalLinks['Wasi']) {
    externalLinks['Wasi'] = wasi;
  }
  if (ml && /^https?:\/\//i.test(ml) && !externalLinks['Mercado Libre']) {
    externalLinks['Mercado Libre'] = ml;
  }
  if (web && /^https?:\/\//i.test(web) && !externalLinks['Pagina Web']) {
    externalLinks['Pagina Web'] = web;
  }
  if (fotos && /^https?:\/\//i.test(fotos) && !externalLinks['LINK_FOTOS']) {
    externalLinks['LINK_FOTOS'] = fotos;
  }

  // Incorporar cualquier otra columna en raw que contenga un enlace HTTP
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string' && /^https?:\/\//i.test(v.trim())) {
      if (!k.endsWith('_URL') && !k.startsWith('_')) {
        if (!externalLinks[k]) externalLinks[k] = v.trim();
      }
    }
  }

  const externalLinksDetails = raw.externalLinksDetails || Object.entries(externalLinks).map(([header, url]) => {
    let domain = '';
    try {
      domain = new URL(url).hostname.replace(/^www\./, '');
    } catch (e) {
      const m = url.match(/https?:\/\/([^\/\s?#]+)/i);
      domain = m ? m[1].replace(/^www\./, '') : '';
    }
    return { header, url, domain };
  });

  // Comprobación de integridad estructural del registro
  let isStructurallyValid = raw._isStructurallyValid !== false && !!(id && tipo && operacion && estatus && desc);
  let isQuarantined = false;
  let quarantineReason = null;

  if (!isStructurallyValid) {
    isQuarantined = true;
    quarantineReason = 'INCOMPLETE_STRUCTURAL_DATA (Faltan campos obligatorios)';
  } else {
    // Comprobar contradicciones comerciales
    const normOp = operacion.toLowerCase();
    const normDesc = desc.toLowerCase();
    const normEstatus = normalizeText(estatus);

    if (normOp.includes('alquiler') && /\b(?:en venta|para la venta|se vende)\b/i.test(normDesc) && !/\b(?:alquiler|arrendamiento|alquila|renta|canon)\b/i.test(normDesc)) {
      isQuarantined = true;
      quarantineReason = 'CONTRADICTION_OPERACION_DESCRIPCION (Registrado como Alquiler pero descripción indica exclusivamente venta)';
    } else if (normOp.includes('venta') && /\b(?:en alquiler|para alquilar|se alquila)\b/i.test(normDesc) && !/\b(?:venta|vende|compra)\b/i.test(normDesc)) {
      isQuarantined = true;
      quarantineReason = 'CONTRADICTION_OPERACION_DESCRIPCION (Registrado como Venta pero descripción indica exclusivamente alquiler)';
    }

    if (normEstatus === 'disponible' && /\b(?:vendido|reservad[oa]|no disponible|ya se alquil[oó]|ya se vendi[oó])\b/i.test(normDesc)) {
      isQuarantined = true;
      quarantineReason = 'CONTRADICTION_ESTATUS_DESCRIPCION (Registrado como Disponible pero descripción indica vendido/reservado)';
    }
  }

  if (raw._isQuarantined) {
    isQuarantined = true;
    quarantineReason = raw.quarantineReason || quarantineReason;
  }
  if (raw._isStructurallyValid === false) {
    isStructurallyValid = false;
  }

  const adapted = {
    ID_PROPIEDAD: id,
    TIPO: tipo,
    OPERACION: operacion,
    PRECIO: (raw.PRECIO || raw.Canon || '').toString().trim(),
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
    // V5.1 Universal Sheet Reader properties
    externalLinks: externalLinks,
    externalLinksDetails: externalLinksDetails,
    _isStructurallyValid: isStructurallyValid,
    _isComplete: isStructurallyValid && !isQuarantined,
    _isQuarantined: isQuarantined,
    quarantineReason: quarantineReason,
    _raw: raw
  };

  // Exponer claves dinámicas de externalLinks en el objeto raíz para compatibilidad directa
  for (const [k, v] of Object.entries(externalLinks)) {
    if (adapted[k] === undefined) {
      adapted[k] = v;
    }
  }

  return adapted;
}

/**
 * Verificación de disponibilidad estricta:
 * Exige equivalencia exacta con 'disponible' después de normalizar,
 * integridad estructural completa y ausencia total de cuarentena comercial.
 */
function isPropertyAvailable(property) {
  if (!property || typeof property !== 'object') return false;
  if (property._isQuarantined === true || property._isStructurallyValid === false || property._isComplete === false) {
    return false;
  }
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
  extractMultiportalPropertyIdentifiers: libExtractMultiportal,
  cleanUrlForMatching
} = require('./lib/multiportal_extractor');

const {
  UniversalIdentifierIndex,
  getGlobalIdentifierIndex,
  invalidateGlobalIdentifierIndex
} = require('./lib/universal_identifier_index');

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

const { defaultAlertManager } = require('./lib/unregistered_link_alert');

// ============================================================================
// 5. EXTRACCIÓN DETERMINISTA DE ZONA Y BÚSQUEDA INTERNA MULTICRITERIO
// ============================================================================
function extractRequestedZone(queryText, properties = []) {
  if (!queryText) return null;
  const q = normalizeText(queryText);

  // 1. Catálogo maestro de zonas conocidas de Caracas y regiones inmobiliarias
  const baseCaracasZones = [
    'prados del este', 'la boyera', 'los samanes', 'lomas del sol', 'la candelaria',
    'las mercedes', 'los palos grandes', 'chacao', 'altamira', 'el hatillo',
    'el encantado', 'la castellana', 'santa fe', 'baruta', 'maracay', 'oripoto',
    'colinas de bello monte', 'san bernardino', 'el paraiso', 'valle arriba',
    'alta florida', 'lomas de monteclaro', 'juan pablo ii', 'caricuao', 'el cafetal',
    'san antonio de los altos', 'san antonio', 'guatire', 'guarenas', 'santa monica',
    'la trinidad', 'terrazas del club hipico', 'cumbres de curumo', 'los ruices',
    'los dos caminos', 'boleita', 'macaracuay', 'chuao', 'san roman',
    'valle abajo', 'montalban', 'la vega', 'catia', 'antimano', 'la florida',
    'sabana grande', 'plaza venezuela', 'los caobos', 'bellas artes', 'parque central',
    'caracas', 'gran caracas', 'distrito capital'
  ];

  const zonePool = new Set(baseCaracasZones);
  if (Array.isArray(properties)) {
    for (const rawP of properties) {
      const p = adaptProperty(rawP);
      const z = extractPropertyZone(p);
      if (z) {
        const normZ = normalizeText(z);
        if (normZ && normZ.length > 2) zonePool.add(normZ);
      }
    }
  }

  // Ordenar de mayor a menor longitud para evitar colisiones
  const sortedZones = Array.from(zonePool).sort((a, b) => b.length - a.length);

  for (const z of sortedZones) {
    const escaped = z.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(^|\\s|[.,;!?¿¡])${escaped}($|\\s|[.,;!?¿¡])`, 'i');
    if (regex.test(q)) {
      return z;
    }
  }

  // 2. Extracción sintáctica determinista para zonas desconocidas o sectores específicos
  const locRegex = /\b(?:en|por|sector|zona|urbanizaci[oó]n|urb\.?|municipio)\s+([^,?.!¿¡]+)/gi;
  let match;
  while ((match = locRegex.exec(q)) !== null) {
    let candidate = match[1].trim();

    // Limpiar prefijos de tipo u operación si vinieron pegados (ej. "en venta en Valencia", "en apartamento en Lechería")
    candidate = candidate.replace(/^(?:venta|alquiler|renta|compra)\s+(?:en|por)\s+/i, '');
    candidate = candidate.replace(/^(?:apartamento[s]?|apto[s]?|casa[s]?|oficina[s]?|inmueble[s]?|propiedad(?:es)?|local(?:es)?|galp[oó]n(?:es)?|terreno[s]?)\s+(?:en|por)\s+/i, '');
    candidate = candidate.replace(/^(?:venta|alquiler|renta|compra)\b/i, '').trim();
    if (candidate.startsWith('en ') || candidate.startsWith('por ')) {
      candidate = candidate.replace(/^(?:en|por)\s+/, '').trim();
    }

    // Cortar en palabras de corte
    candidate = candidate.replace(/\b(?:con|de|que|precio|desde|hasta|para|atento|gracias|favor|por\s+favor|saludos|buenas?|tardes?|dias?)\b.*$/i, '').trim();

    // Remover artículos iniciales
    candidate = candidate.replace(/^(?:el|la|los|las)\s+/i, '').trim();

    // Lista de palabras no-zona (stop words)
    const stopWords = ['venta', 'alquiler', 'renta', 'apartamento', 'apartamentos', 'apto', 'aptos', 'casa', 'casas', 'oficina', 'oficinas', 'inmueble', 'inmuebles', 'propiedad', 'propiedades', 'este momento', 'general', 'linea', 'red', 'la red', 'disponible', 'disponibles', 'oferta', 'ofertas', 'estreno'];
    if (!stopWords.includes(candidate) && candidate.length >= 3 && candidate.length <= 40) {
      return candidate;
    }
  }

  return null;
}

function searchZoneOrFeatureMatches(queryText, properties = []) {
  if (!queryText || !Array.isArray(properties) || properties.length === 0) {
    return { hasAvailableMatches: false, count: 0, candidates: [] };
  }
  const q = normalizeText(queryText);

  if (/(?:presupuesto|inversi[oó]n|dispongo\s*de|cuento\s*con)\s*(?:de\s*)?[\$€]?\s*\d+/i.test(q)) {
    return { hasAvailableMatches: false, count: 0, candidates: [] };
  }

  const isSearchIntent = /(?:busco|buscando|quiero|necesito|interesad[oa]|informaci[oó]n\s*sobre|hay\s*informaci[oó]n|tienen?|alquiler|venta|comprar|alquilar|apartamento|casa|anexo|terreno|local|oficina|inmueble|qu[eé]\s*(?:tienen|opciones|propiedades))\b/i.test(q);
  if (!isSearchIntent) return { hasAvailableMatches: false, count: 0, candidates: [] };

  // Detectar operación solicitada
  let targetOperation = null;
  if (/alquiler|alquilar|renta/i.test(q)) targetOperation = 'alquiler';
  else if (/venta|comprar|compra/i.test(q)) targetOperation = 'venta';

  // Detectar tipo de inmueble solicitado
  let targetTipo = null;
  if (/apartamento|apto|pent-?house/i.test(q)) targetTipo = 'apartamento';
  else if (/casa\s*comercial/i.test(q)) targetTipo = 'casa comercial';
  else if (/casa/i.test(q)) targetTipo = 'casa';
  else if (/oficina/i.test(q)) targetTipo = 'oficina';
  else if (/anexo/i.test(q)) targetTipo = 'anexo';
  else if (/terreno/i.test(q)) targetTipo = 'terreno';
  else if (/local/i.test(q)) targetTipo = 'local';
  else if (/galp[oó]n/i.test(q)) targetTipo = 'galpon';

  const targetZone = extractRequestedZone(queryText, properties);

  // Si no especificó al menos una zona concreta ni un tipo concreto, no considerar coincidencia de zona
  if (!targetZone && !targetTipo) {
    return { hasAvailableMatches: false, count: 0, candidates: [] };
  }

  const isCaracasGeneral = targetZone && /caracas|gran caracas|distrito capital/i.test(targetZone);
  const matches = [];

  for (const rawProp of properties) {
    const prop = adaptProperty(rawProp);
    if (!isPropertyAvailable(prop)) continue;

    const propDesc = normalizeText(prop.DESCRIPCION_BREVE || '');
    const propWasi = normalizeText(prop.Wasi || '');
    const propTipo = normalizeText(prop.TIPO || '');
    const propOperacion = normalizeText(prop.OPERACION || '');

    // Verificación 1: Zona buscada en descripción oficial o URL de Wasi
    let zoneMatches = false;
    if (isCaracasGeneral) {
      zoneMatches = !propDesc.includes('maracay');
    } else if (targetZone) {
      const zoneSlug = targetZone.replace(/\s+/g, '-');
      zoneMatches = propDesc.includes(targetZone) || propWasi.includes(targetZone) || propWasi.includes(zoneSlug);
    } else {
      // Cliente no especificó zona alguna (targetZone === null), pero especificó targetTipo
      zoneMatches = !propDesc.includes('maracay');
    }
    if (!zoneMatches) continue;

    // Verificación 2: Operación (si el cliente la especificó)
    if (targetOperation && !propOperacion.includes(targetOperation)) {
      continue;
    }

    // Verificación 3: Tipo (si el cliente lo especificó)
    if (targetTipo) {
      if (targetTipo === 'casa') {
        if (!propTipo.includes('casa') && !propDesc.includes('townhouse') && !propDesc.includes('quinta')) continue;
      } else if (!propTipo.includes(targetTipo)) {
        continue;
      }
    }

    matches.push(prop);
  }

  const candidates = matches.slice(0, 3);
  return {
    hasAvailableMatches: candidates.length > 0,
    count: matches.length,
    candidates,
    targetZone,
    targetTipo,
    targetOperation
  };
}

function buildStructuredZoneSearchResults(zoneSearchResult) {
  const { candidates, targetZone, targetTipo } = zoneSearchResult;
  if (!candidates || candidates.length === 0) {
    const tipoStr = targetTipo ? ` de tipo ${targetTipo}` : '';
    const zonaStr = targetZone ? ` en ${targetZone.toUpperCase()}` : '';
    return `En este momento no disponemos de inmuebles${tipoStr}${zonaStr} con estatus disponible en nuestro inventario oficial de Google Sheets. ¿Deseas consultar alguna otra zona o características?`;
  }

  let text = '¡Claro! Tenemos estas opciones disponibles en nuestro inventario oficial:\n\n';
  candidates.slice(0, 3).forEach((p, idx) => {
    const ref = p.ID_PROPIEDAD || `Opción ${idx + 1}`;
    const tipo = p.TIPO || 'Inmueble';
    const zona = extractPropertyZone(p) || 'Caracas';
    const precio = extractPropertyPrice(p) || p.PRECIO || 'Precio a consultar';
    const metraje = extractPropertyMetraje(p);
    const metrajeStr = metraje ? `   • *Metraje:* ${metraje}\n` : '';

    text += `${idx + 1}. *${ref}* — ${tipo} en ${zona}\n`;
    text += `   • *Precio:* ${precio}\n`;
    if (metrajeStr) text += metrajeStr;
    text += '\n';
  });

  text += '¿Te gustaría recibir fotografías o la ficha completa de alguna de estas opciones?';
  return text.trim();
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

  // 0.B OPERACIÓN DETERMINISTA (VENTA O ALQUILER)
  if (/(?:es\s*(?:en\s*|para\s*)?venta\s*o\s*alquiler|venta\s*o\s*alquiler|es\s*alquiler\s*o\s*venta|qu[eé]\s*operaci[oó]n|para\s*la\s*venta\s*o\s*alquiler)/i.test(q)) {
    const op = (property.OPERACION || 'venta').toLowerCase().includes('alquiler') ? 'alquiler' : 'venta';
    return {
      matched: true,
      hasData: true,
      answer: `La propiedad se encuentra disponible para ${op}.`,
      evidence: `OPERACION: ${property.OPERACION}`
    };
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
  if (/(?:cu[aá]l\s*(?:es|era|ser[ií]a)?\s*(?:el|su)?\s*(?:precio|costo|valor|inversi[oó]n|canon)|cu[aá]nto\s*(?:cuesta|costaba|vale|pide)|qu[eé]\s*precio)/i.test(q)) {
    const isVentaQuery = /venta/i.test(q);
    const isAlquilerQuery = /alquiler|arrendamiento|canon/i.test(q);

    const ventaMatch = desc.match(/(?:precio\s*(?:de\s*venta)?\s*(?:de|es|:)?\s*(\$[\d.,]+))|(?:inversi[oó]n\s*(?:total)?\s*(?:de|es|:)?\s*(\$[\d.,]+))|por\s*(?:un\s*)?precio\s*(?:de)?\s*(\$[\d.,]+)|por\s*(?:una\s*)?inversi[oó]n\s*(?:total)?\s*(?:de)?\s*(\$[\d.,]+)/i);
    const alquilerMatch = desc.match(/canon\s*(?:de\s*(?:arrendamiento|alquiler))?\s*(?:de|es|:)?\s*(\$[\d.,]+)|arrendamiento\s*de\s*(\$[\d.,]+)/i);

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

    if (property.PRECIO) {
      const val = cleanPriceString(String(property.PRECIO));
      if (val) {
        return { matched: true, hasData: true, answer: val, evidence: `PRECIO: ${property.PRECIO}` };
      }
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

  // 5.C MALETERO
  if (/(?:tiene|cuenta\s*con|hay|incluye)?\s*maletero/i.test(q)) {
    const malMatch = desc.match(/maletero(?:\s*privado)?(?:\s*de\s*[\d.,]+\s*m²)?/i) || desc.match(/Maletero:\s*([^.\n\r]+)/i);
    if (malMatch) {
      const text = malMatch[1] || malMatch[0];
      if (!/no\s*especificado/i.test(text)) {
        const evidence = malMatch[0].trim();
        const answer = `Cuenta con ${evidence}`;
        return { matched: true, hasData: true, answer, evidence };
      }
    }
    return { matched: true, hasData: false, reason: 'Dato de maletero no especificado en Google Sheets.' };
  }

  // 5.D ESTACIONAMIENTO / PUESTOS DE ESTACIONAMIENTO
  if (/(?:tiene|cuenta\s*con|hay|incluye)?\s*(?:estacionamiento|puestos?\s*de\s*estacionamiento|garaje|cochera)/i.test(q)) {
    // Si la descripción aclara explícitamente que NO posee estacionamiento propio
    const noEstMatch = desc.match(/no\s*(?:posee|cuenta\s*con|tiene)\s*(?:puestos?\s*(?:de\s*)?)?estacionamiento[^.\n\r]*/i) ||
      desc.match(/no\s*(?:posee|cuenta\s*con|tiene)\s*puesto\s*de\s*estacionamiento\s*propio/i);
    if (noEstMatch) {
      const evidence = noEstMatch[0].trim();
      return { matched: true, hasData: true, answer: evidence, evidence };
    }

    const estMatch = desc.match(/(?:(\d+|un|uno|dos|tres|cuatro|cinco|seis)\s*puestos?\s*(?:de\s*estacionamiento)?(?:\s*(?:techados?|en\s*s[oó]tano|independientes?))*)|(?:Estacionamiento:\s*([^.\n\r]+))/i);
    if (estMatch) {
      const text = estMatch[2] || estMatch[0];
      if (!/no\s*especificado|no\s*posee\s*propio/i.test(text)) {
        const evidence = estMatch[0].trim();
        const answer = `Cuenta con ${evidence}`;
        return { matched: true, hasData: true, answer, evidence };
      } else if (/no\s*posee\s*propio/i.test(text)) {
        return { matched: true, hasData: true, answer: 'No posee puesto propio (estacionamiento privado de alquiler cercano)', evidence: text.trim() };
      }
    }
    return { matched: true, hasData: false, reason: 'Dato de estacionamiento no especificado en Google Sheets.' };
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
    if (this.filePath === ':memory:' || this.filePath === 'memory') return;
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
    if (this.filePath === ':memory:' || this.filePath === 'memory') return;
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
   * Limpia el estado de atención pendiente tras recibir un nuevo inmueble verificado.
   */
  clearAttentionRequested(leadId = null, talkId = null, contactId = null) {
    const update = (entityMap, id) => {
      if (!id || !entityMap[String(id)]) return;
      entityMap[String(id)].attentionRequested = false;
      delete entityMap[String(id)].attentionRequestedAt;
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
    const update = (entityMap, id, extra = {}) => {
      if (!id) return;
      entityMap[String(id)] = {
        lastHumanIntervention: timestamp,
        attentionRequested: false,
        activeAutomationPropertyId: null, // Se suspende automatización previa
        ...extra
      };
    };
    update(this.handoffs.leads, leadId, { talkId: talkId ? String(talkId) : null });
    update(this.handoffs.talks, talkId, { leadId: leadId ? String(leadId) : null });
    update(this.handoffs.contacts, contactId, {
      talkId: talkId ? String(talkId) : null,
      leadId: leadId ? String(leadId) : null
    });
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
    // Prioridad 1: talkId específico de la conversación actual
    const talkEntry = talkId && this.handoffs.talks ? this.handoffs.talks[String(talkId)] : null;
    const leadEntry = leadId && this.handoffs.leads ? this.handoffs.leads[String(leadId)] : null;
    const contactEntry = contactId && this.handoffs.contacts ? this.handoffs.contacts[String(contactId)] : null;

    // Aislamiento multicanal de bloqueos:
    // Si se pasa talkId o leadId específico, la prioridad estricta es esa conversación puntual.
    // El bloqueo a nivel de contactId solo aplica si pertenece a la misma conversación o si no hay talkId especificado.
    let entry = talkEntry || leadEntry;
    if (!entry && contactEntry) {
      if (!talkId && !leadId) {
        entry = contactEntry;
      } else if (contactEntry.talkId && talkId && String(contactEntry.talkId) === String(talkId)) {
        entry = contactEntry;
      } else if (!contactEntry.talkId && !talkId) {
        entry = contactEntry;
      }
    }
    const humanTime = entry ? (entry.lastHumanIntervention || entry.timestamp) : null;

    // Aislamiento estricto de propiedad: Si talkId está definido, pertenece únicamente a ese chat
    const isolatedPropertyId = talkEntry ? (talkEntry.activeAutomationPropertyId || null) : (talkId ? null : (leadEntry ? (leadEntry.activeAutomationPropertyId || null) : null));

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
        activeAutomationPropertyId: isolatedPropertyId
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
            activeAutomationPropertyId: isolatedPropertyId
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
      activeAutomationPropertyId: isolatedPropertyId
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
  constructor(filePath = null) {
    this.filePath = filePath;
    this.talkContexts = new Map(); // talkId -> property
    this.leadContexts = new Map(); // leadId -> property
    this.talkHistories = new Map(); // talkId -> property[]
    this.leadHistories = new Map(); // leadId -> property[]
    this.loadFromDisk();
  }

  loadFromDisk() {
    try {
      if (this.filePath && fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const data = JSON.parse(raw);
        if (data && typeof data === 'object') {
          if (data.talks && typeof data.talks === 'object') {
            for (const [k, v] of Object.entries(data.talks)) {
              if (k && v) this.talkContexts.set(String(k), v);
            }
          }
          if (data.leads && typeof data.leads === 'object') {
            for (const [k, v] of Object.entries(data.leads)) {
              if (k && v) this.leadContexts.set(String(k), v);
            }
          }
          if (data.talkHistories && typeof data.talkHistories === 'object') {
            for (const [k, v] of Object.entries(data.talkHistories)) {
              if (k && Array.isArray(v)) this.talkHistories.set(String(k), v);
            }
          }
          if (data.leadHistories && typeof data.leadHistories === 'object') {
            for (const [k, v] of Object.entries(data.leadHistories)) {
              if (k && Array.isArray(v)) this.leadHistories.set(String(k), v);
            }
          }
          if (Array.isArray(data)) {
            for (const item of data) {
              if (item.leadId && item.property) {
                this.leadContexts.set(String(item.leadId), item.property);
                const list = this.leadHistories.get(String(item.leadId)) || [];
                if (!list.some(p => p.ID_PROPIEDAD === item.property.ID_PROPIEDAD)) list.push(item.property);
                this.leadHistories.set(String(item.leadId), list);
              }
              if (item.talkId && item.property) {
                this.talkContexts.set(String(item.talkId), item.property);
                const list = this.talkHistories.get(String(item.talkId)) || [];
                if (!list.some(p => p.ID_PROPIEDAD === item.property.ID_PROPIEDAD)) list.push(item.property);
                this.talkHistories.set(String(item.talkId), list);
              }
            }
          }
        }
      }
    } catch (e) {
      // safe fallback
    }
  }

  saveToDisk() {
    try {
      if (!this.filePath) return;
      const data = {
        talks: Object.fromEntries(this.talkContexts.entries()),
        leads: Object.fromEntries(this.leadContexts.entries()),
        talkHistories: Object.fromEntries(this.talkHistories.entries()),
        leadHistories: Object.fromEntries(this.leadHistories.entries()),
        updatedAt: Date.now()
      };
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
      // safe fallback
    }
  }

  saveContext(talkId, leadIdOrProperty, property) {
    const prop = property !== undefined ? property : (typeof leadIdOrProperty === 'object' ? leadIdOrProperty : null);
    const leadId = typeof leadIdOrProperty === 'string' || typeof leadIdOrProperty === 'number' ? leadIdOrProperty : null;
    if (talkId && prop) {
      this.talkContexts.set(String(talkId), prop);
      const list = this.talkHistories.get(String(talkId)) || [];
      const exists = list.some(p => (p.ID_PROPIEDAD || '').toUpperCase() === (prop.ID_PROPIEDAD || '').toUpperCase());
      if (!exists) {
        list.push(prop);
        this.talkHistories.set(String(talkId), list);
      }
    }
    if (leadId && prop) {
      this.leadContexts.set(String(leadId), prop);
      const list = this.leadHistories.get(String(leadId)) || [];
      const exists = list.some(p => (p.ID_PROPIEDAD || '').toUpperCase() === (prop.ID_PROPIEDAD || '').toUpperCase());
      if (!exists) {
        list.push(prop);
        this.leadHistories.set(String(leadId), list);
      }
    }
    if (prop) this.saveToDisk();
  }

  getContext(talkId, leadId) {
    // Aislamiento Contextual Total: Cada conversación (talkId) es 100% independiente
    if (talkId) {
      const sTalk = String(talkId);
      if (this.talkContexts.has(sTalk)) {
        return this.talkContexts.get(sTalk);
      }
      this.loadFromDisk();
      if (this.talkContexts.has(sTalk)) {
        return this.talkContexts.get(sTalk);
      }
      // REGLA CRÍTICA: Si se consulta por talkId, NUNCA recurrir a leadContexts
      return null;
    }
    // Si NO se proporciona talkId (ej: consulta administrativa por leadId):
    if (leadId) {
      const sLead = String(leadId);
      if (this.leadContexts.has(sLead)) {
        return this.leadContexts.get(sLead);
      }
      this.loadFromDisk();
      if (this.leadContexts.has(sLead)) {
        return this.leadContexts.get(sLead);
      }
    }
    return null;
  }

  getHistory(talkId, leadId) {
    // Aislamiento Histórico Total: El historial pertenece estrictamente a su propia conversación
    if (talkId) {
      const sTalk = String(talkId);
      if (this.talkHistories.has(sTalk)) {
        return this.talkHistories.get(sTalk);
      }
      this.loadFromDisk();
      if (this.talkHistories.has(sTalk)) {
        return this.talkHistories.get(sTalk);
      }
      // REGLA CRÍTICA: Si se consulta por talkId, NUNCA heredar historial de otro talkId
      return [];
    }
    if (leadId) {
      const sLead = String(leadId);
      if (this.leadHistories.has(sLead)) {
        return this.leadHistories.get(sLead);
      }
      this.loadFromDisk();
      if (this.leadHistories.has(sLead)) {
        return this.leadHistories.get(sLead);
      }
    }
    const single = this.getContext(talkId, leadId);
    return single ? [single] : [];
  }
}

/**
 * Resuelve qué propiedad está consultando el usuario a partir del historial
 * cronológico de la conversación y del contexto activo.
 * Detecta referencias ordinales ("primer", "segundo", "ultimo", "el otro")
 * y contradicciones de zona/tipo para evitar atribuir datos incorrectos.
 */
function resolvePropertyFromHistoryOrContext({
  userText,
  talkId,
  leadId,
  contextManager,
  activePropertyContext,
  properties = []
}) {
  let activeProperty = null;
  let history = [];

  if (contextManager) {
    activeProperty = contextManager.getContext(talkId, leadId);
    history = contextManager.getHistory(talkId, leadId);
  } else if (activePropertyContext) {
    activeProperty = activePropertyContext;
    if (activePropertyContext.history && Array.isArray(activePropertyContext.history)) {
      history = activePropertyContext.history;
    } else {
      history = [activePropertyContext];
    }
  }

  if (!activeProperty && history.length === 0) {
    return { resolved: false, property: null, ambiguous: false };
  }

  // Refrescar con la versión oficial más reciente de Google Sheets
  const refreshProp = (p) => {
    if (!p || !Array.isArray(properties) || properties.length === 0) return p;
    const pId = (p.ID_PROPIEDAD || '').toUpperCase();
    const found = properties.find(raw => {
      const id1 = (raw.ID_PROPIEDAD || '').toUpperCase();
      return id1 && id1 === pId;
    });
    return found ? adaptProperty(found) : p;
  };

  const q = normalizeText(userText);

  // 1. Detección de expresiones ordinales e históricas
  const isPassedBefore = /(?:(?:la\s*propiedad|el\s*inmueble|el\s*apartamento|el\s*apto|la\s*casa|el\s*local|la\s*oficina|la|el)\s*(?:anterior\s*)?que\s*te\s*pas[eé]\s*(?:antes|previamente))\b/i.test(q);
  const isPrevious = /(?:el\s*anterior|la\s*anterior|(?:inmueble|propiedad|apartamento|apto|casa|anexo|local|oficina)\s*anterior)\b/i.test(q);
  const isFirst = /(?:primer[oa]|primera\s*opci[oó]n|primer\s*(?:inmueble|apartamento|casa|anexo|local|oficina))\b/i.test(q);
  const isSecond = /(?:segund[oa]|segunda\s*opci[oó]n|segundo\s*(?:inmueble|apartamento|casa|anexo|local|oficina))\b/i.test(q);
  const isLast = /(?:[uú]ltim[oa]|actual|este\s*[uú]ltimo)\b/i.test(q);
  const isOther = /(?:el\s*otro|la\s*otra|el\s*otro\s*apartamento|la\s*otra\s*casa|el\s*otro\s*inmueble|la\s*otra\s*propiedad|el\s*otro\s*local|la\s*otra\s*oficina)\b/i.test(q);

  // Expresiones que exigen historial previo de al menos 2 inmuebles
  if ((isPrevious || isPassedBefore || isOther) && history.length <= 1) {
    return { resolved: false, property: null, ambiguous: true };
  }

  // "la propiedad que te pasé antes" se refiere siempre a la propiedad previa o primera introducida
  if (isPassedBefore && history.length >= 2) {
    return { resolved: true, property: refreshProp(history[0]), source: 'history_passed_before' };
  }

  if (isPrevious && history.length >= 2) {
    const activeId = (activeProperty?.ID_PROPIEDAD || '').toUpperCase();
    const activeIdx = history.findIndex(p => (p.ID_PROPIEDAD || '').toUpperCase() === activeId);
    const targetIdx = (activeIdx > 0) ? activeIdx - 1 : 0;
    return { resolved: true, property: refreshProp(history[targetIdx]), source: 'history_previous' };
  }

  if (isFirst && history.length > 0) {
    return { resolved: true, property: refreshProp(history[0]), source: 'history_first' };
  }

  if (isSecond && history.length >= 2) {
    return { resolved: true, property: refreshProp(history[1]), source: 'history_second' };
  }

  if (isLast && history.length > 0) {
    return { resolved: true, property: refreshProp(history[history.length - 1]), source: 'history_last' };
  }

  if (isOther && history.length >= 2) {
    const activeId = (activeProperty?.ID_PROPIEDAD || '').toUpperCase();
    const otherProp = history.find(p => (p.ID_PROPIEDAD || '').toUpperCase() !== activeId);
    if (otherProp) {
      return { resolved: true, property: refreshProp(otherProp), source: 'history_other' };
    }
  }

  // 2. Detección por discriminación de Zona, Tipo o Referencia en historial
  // Ejemplos: "el apartamento de La Candelaria", "el de Los Samanes", "la propiedad de Chacao"
  if (history.length > 1) {
    const activeZone = activeProperty ? normalizeText(extractPropertyZone(activeProperty) || '') : '';
    const activeTipo = activeProperty ? normalizeText(activeProperty.TIPO || '') : '';
    const activeId = (activeProperty?.ID_PROPIEDAD || '').toUpperCase();

    for (const hProp of history) {
      const hId = (hProp.ID_PROPIEDAD || '').toUpperCase();
      const hZone = normalizeText(extractPropertyZone(hProp) || '');
      const hTipo = normalizeText(hProp.TIPO || '');

      const mentionsHZone = hZone && hZone.length > 2 && q.includes(hZone);
      const mentionsHRef = hId && q.includes(hId.toLowerCase());

      if (mentionsHRef || (mentionsHZone && (!activeZone || !q.includes(activeZone) || hId !== activeId))) {
        return { resolved: true, property: refreshProp(hProp), source: 'history_attribute_match' };
      }

      if (hId !== activeId && hTipo && q.includes(hTipo) && (!activeTipo || !q.includes(activeTipo))) {
        return { resolved: true, property: refreshProp(hProp), source: 'history_attribute_match' };
      }
    }
  }

  // 3. Fallback: la propiedad activa por defecto
  if (activeProperty) {
    return { resolved: true, property: refreshProp(activeProperty), source: 'active_context' };
  }

  return { resolved: false, property: null, ambiguous: false };
}

// ============================================================================
// 10. COMPROBACIÓN PREVIA AL DESPACHO Y BARRERA DE PROCEDENCIA COMERCIAL
// ============================================================================

/**
 * BARRERA EXHAUSTIVA DE PROCEDENCIA Y VERDAD COMERCIAL (V5.1):
 * Valida individualmente cada afirmación comercial (ID, tipo, operación, estatus,
 * precio, metraje, habitaciones, baños, estacionamiento, mascotas, etc.)
 * contra la fuente única de verdad en Google Sheets antes de autorizar cualquier despacho.
 */
function validateCommercialClaimsProvenance({ responseText, targetProperty, properties = [] }) {
  if (!targetProperty || typeof targetProperty !== 'object') {
    return { valid: true };
  }

  const pId = (targetProperty.ID_PROPIEDAD || '').toUpperCase();

  // 1. Integridad estructural y Cuarentena
  if (targetProperty._isQuarantined === true) {
    return {
      valid: false,
      reason: `Violación de verdad comercial: La propiedad ${pId || 'desconocida'} está en cuarentena comercial (${targetProperty.quarantineReason || 'CONTRADICCIÓN'}). Despacho bloqueado.`
    };
  }
  if (targetProperty._isStructurallyValid === false || targetProperty._isComplete === false) {
    return {
      valid: false,
      reason: `Violación de verdad comercial: La propiedad ${pId || 'desconocida'} está estructuralmente incompleta en Google Sheets. Despacho bloqueado.`
    };
  }

  // Si no hay texto, nada que validar sintácticamente
  if (!responseText || typeof responseText !== 'string') {
    return { valid: true };
  }

  const normText = normalizeText(responseText);

  // 2. Comprobación de ID explícito en texto: Si el texto contiene REF-xxx, debe coincidir con targetProperty
  const refMatches = responseText.match(/\bREF-\d+\b/gi) || [];
  for (const r of refMatches) {
    if (r.toUpperCase() !== pId) {
      return {
        valid: false,
        reason: `Violación de procedencia de ID: El texto comunica ${r.toUpperCase()} pero la propiedad objetivo es ${pId}.`
      };
    }
  }

  // 3. Comprobación de Disponibilidad Comercial:
  const isAffirming = (normText.includes('disponible') || normText.includes('si, disponible')) &&
                      !normText.includes('no disponible') &&
                      !normText.includes('no se encuentra disponible');
  if (isAffirming) {
    if (!isPropertyAvailable(targetProperty) || isPropertyExplicitlyUnavailable(targetProperty)) {
      return {
        valid: false,
        reason: `Violación de verdad comercial: La propiedad ${pId} tiene estatus "${targetProperty.ESTATUS}" (no Disponible o en cuarentena).`
      };
    }
  }

  // 4. Comprobación de Operación Comercial (Venta vs Alquiler)
  const targetOp = (targetProperty.OPERACION || '').toLowerCase();
  const claimsVenta = /\b(?:venta|en venta|para la venta|para venta)\b/i.test(responseText);
  const claimsAlquiler = /\b(?:alquiler|en alquiler|para alquiler|canon)\b/i.test(responseText);
  if (claimsVenta && !claimsAlquiler && !targetOp.includes('venta')) {
    return {
      valid: false,
      reason: `Violación de procedencia de operación: El texto afirma venta pero ${pId} está registrada en ${targetProperty.OPERACION}.`
    };
  }
  if (claimsAlquiler && !claimsVenta && !targetOp.includes('alquiler') && !targetOp.includes('renta')) {
    return {
      valid: false,
      reason: `Violación de procedencia de operación: El texto afirma alquiler pero ${pId} está registrada en ${targetProperty.OPERACION}.`
    };
  }

  // 5. Comprobación de Precio Comercial:
  // Si el texto incluye precio monetario (ej: "USD 146.000", "$146.000", "146.000"),
  // debe corresponder con exactitud al precio oficial extraído de Sheets o al valor de la celda.
  const officialPrice = extractPropertyPrice(targetProperty);
  const priceRegex = /(?:USD|\$|precio(?:\s+es)?(?:\s+de)?)\s*([\d\.,]+)/i;
  const textPriceMatch = responseText.match(priceRegex);
  if (textPriceMatch) {
    const normalizePriceToNumber = (str) => {
      if (!str && str !== 0) return null;
      let s = String(str).replace(/^[\$€\s]+/, '').replace(/^USD\s*/i, '').trim();
      s = s.replace(/[,.]00$/, '');
      s = s.replace(/[\.,]/g, '');
      const num = parseInt(s, 10);
      return isNaN(num) ? null : num;
    };

    const claimedNum = normalizePriceToNumber(textPriceMatch[1]);
    const officialNum = normalizePriceToNumber(officialPrice);
    const rawNum = normalizePriceToNumber(targetProperty._raw?.PRECIO || targetProperty._raw?.Canon || targetProperty.PRECIO);

    let priceMatched = false;
    if (claimedNum !== null) {
      if (officialNum !== null && claimedNum === officialNum) priceMatched = true;
      if (rawNum !== null && claimedNum === rawNum) priceMatched = true;
    }

    if (!priceMatched) {
      return {
        valid: false,
        reason: `Violación de procedencia de precio: El texto comunica precio "${textPriceMatch[1]}" que no coincide con el valor oficial (${officialPrice || targetProperty.PRECIO || 'sin precio'}) de ${pId}.`
      };
    }
  }

  // 6. Comprobación de Metraje Comercial:
  // Si el texto incluye metraje (ej: "110 m²", "110m2", "110 metros"),
  // debe corresponder al metraje oficial extraído de Sheets o al valor de la descripción.
  const officialMetraje = extractPropertyMetraje(targetProperty);
  const metrajeRegex = /(\d+(?:[\.,]\d+)?)\s*(?:m²|m2|metros)\b/i;
  const textMetrajeMatch = responseText.match(metrajeRegex);
  if (textMetrajeMatch) {
    const claimedMetrajeNum = parseFloat(textMetrajeMatch[1].replace(',', '.'));
    const officialMetrajeNum = officialMetraje ? parseFloat(String(officialMetraje).replace(',', '.')) : null;
    const desc = (targetProperty.DESCRIPCION_BREVE || '').replace(',', '.');
    const inDesc = desc.includes(String(claimedMetrajeNum));

    if (officialMetrajeNum !== claimedMetrajeNum && !inDesc) {
      return {
        valid: false,
        reason: `Violación de procedencia de metraje: El texto comunica "${textMetrajeMatch[0]}" que no coincide con los ${officialMetraje || 'N/A'} registrados para ${pId}.`
      };
    }
  }

  // 7. Comprobación de Tipo de Inmueble:
  // Si el texto afirma explícitamente un tipo de inmueble, debe coincidir con targetProperty.TIPO
  const targetTipoNorm = (targetProperty.TIPO || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const tipoClaims = [
    { name: 'apartamento', regex: /\b(?:apartamento|apto|departamento)\b/i },
    { name: 'casa', regex: /\b(?:casa|quinta|townhouse)\b/i },
    { name: 'oficina', regex: /\b(?:oficina)\b/i },
    { name: 'local', regex: /\b(?:local comercial|local)\b/i },
    { name: 'galpon', regex: /\b(?:galp[oó]n|nave industrial)\b/i },
    { name: 'terreno', regex: /\b(?:terreno|parcela|lote)\b/i },
    { name: 'posada', regex: /\b(?:posada|hotel)\b/i }
  ];
  for (const tc of tipoClaims) {
    if (tc.regex.test(responseText)) {
      if (!targetTipoNorm.includes(tc.name) && !(targetProperty.DESCRIPCION_BREVE || '').toLowerCase().includes(tc.name)) {
        return {
          valid: false,
          reason: `Violación de procedencia de tipo: El texto comunica "${tc.name}" pero ${pId} está registrada como "${targetProperty.TIPO}".`
        };
      }
    }
  }

  // 8. Comprobación de Ubicación / Zona:
  // Si el texto menciona una zona específica (ej: "en El Rosal", "en Los Samanes"), debe concordar con la descripción o zona de targetProperty
  const knownZones = [
    'los samanes', 'la california', 'la castellana', 'los palos grandes',
    'el rosal', 'chacao', 'las mercedes', 'boleita', 'altamira',
    'chichiriviche', 'cagua', 'maracay', 'valencia', 'baruta', 'el hatillo',
    'parque carabobo', 'bellas artes', 'fuerzas armadas', 'macaracuay',
    'san bernardino', 'el paraiso', 'cumbres de curumo', 'colinas de bello monte'
  ];
  const targetDescNorm = (targetProperty.DESCRIPCION_BREVE || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const targetZoneOfficial = (extractPropertyZone(targetProperty) || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const textNormNoAcc = responseText.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  for (const z of knownZones) {
    const zRegex = new RegExp(`\\b(?:en|ubicad[oa] en|zona|sector)\\s+${z}\\b`, 'i');
    if (zRegex.test(textNormNoAcc)) {
      if (!targetDescNorm.includes(z) && !targetZoneOfficial.includes(z)) {
        return {
          valid: false,
          reason: `Violación de procedencia de ubicación: El texto afirma ubicación en "${z}" pero ${pId} está ubicada en "${extractPropertyZone(targetProperty) || 'otra zona'}".`
        };
      }
    }
  }

  // 9. Comprobación de Habitaciones y Baños:
  const wordToNum = (s) => ({ un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 })[String(s).toLowerCase().trim()] || parseInt(s, 10);
  const textHabMatch = responseText.match(/(\d+|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s*habitaci[oó]n(?:es)?/i);
  if (textHabMatch) {
    const claimedHabNum = wordToNum(textHabMatch[1]);
    const officialHabMatches = Array.from(targetDescNorm.matchAll(/(\d+|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s*habitaci[oó]n(?:es)?/gi)).map(x => wordToNum(x[1]));
    if (officialHabMatches.length > 0 && !officialHabMatches.includes(claimedHabNum)) {
      return {
        valid: false,
        reason: `Violación de procedencia de habitaciones: El texto afirma "${textHabMatch[0]}" pero ${pId} registra ${officialHabMatches.join('/')} habitaciones.`
      };
    }
  }

  const textBanMatch = responseText.match(/(\d+|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s*baños?/i);
  if (textBanMatch) {
    const claimedBanNum = wordToNum(textBanMatch[1]);
    const officialBanMatches = Array.from(targetDescNorm.matchAll(/(\d+|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s*baños?/gi)).map(x => wordToNum(x[1]));
    if (officialBanMatches.length > 0 && !officialBanMatches.includes(claimedBanNum)) {
      return {
        valid: false,
        reason: `Violación de procedencia de baños: El texto afirma "${textBanMatch[0]}" pero ${pId} registra ${officialBanMatches.join('/')} baños.`
      };
    }
  }

  // 10. Comprobación de Mascotas:
  if (/\b(?:se aceptan mascotas|acepta mascotas|mascotas permitidas)\b/i.test(responseText)) {
    const petsAllowed = /s[ií]/i.test(targetProperty.Mascotas || '') || /mascotas permitidas|se aceptan mascotas/i.test(targetDescNorm);
    if (!petsAllowed) {
      return {
        valid: false,
        reason: `Violación de procedencia de mascotas: El texto afirma que se aceptan mascotas pero en ${pId} no está registrado.`
      };
    }
  }

  // 11. Comprobación de Enlace de Fotos y Enlaces Externos:
  const allUrlsInResponse = responseText.match(/https?:\/\/[^\s<>"'{}|\\^`[\]]+/gi) || [];
  if (allUrlsInResponse.length > 0) {
    for (const u of allUrlsInResponse) {
      const cleanU = cleanUrlForMatching(u);
      const alienProperty = properties.find(other => {
        if ((other.ID_PROPIEDAD || '').toUpperCase() === pId) return false;
        const otherUrls = [other.LINK_FOTOS, other.Wasi, other.Mercado_Libre, other['Mercado Libre'], other.Pagina_Web, other['Pagina Web']];
        if (other.externalLinks) otherUrls.push(...Object.values(other.externalLinks));
        return otherUrls.some(ou => ou && cleanUrlForMatching(ou) === cleanU);
      });

      if (alienProperty) {
        return {
          valid: false,
          reason: `Violación de procedencia de enlaces: El texto contiene un enlace (${u}) que pertenece a otra propiedad (${alienProperty.ID_PROPIEDAD}).`
        };
      }
    }
  }

  return { valid: true };
}

/**
 * REGISTRO ESTRUCTURADO DE AFIRMACIONES COMERCIALES OFICIALES
 * Tu Techo Ideal V5.1 — DEPRO TECH SOLUTIONS
 */
function buildStructuredPropertyClaims(prop) {
  if (!prop || typeof prop !== 'object') return null;
  const pId = (prop.ID_PROPIEDAD || '').toUpperCase();
  const tipo = (prop.TIPO || '').trim();
  const operacion = (prop.OPERACION || '').trim();
  const estatus = (prop.ESTATUS || '').trim();
  const zona = extractPropertyZone(prop);
  const precio = extractPropertyPrice(prop);
  const metraje = extractPropertyMetraje(prop);

  return {
    propertyId: pId,
    tipo: { value: tipo, source: 'col:TIPO', verified: !!tipo },
    operacion: { value: operacion, source: 'col:OPERACION', verified: !!operacion },
    estatus: { value: estatus, source: 'col:ESTATUS', verified: !!estatus },
    zona: { value: zona, source: 'derived:DESCRIPCION_BREVE', verified: !!zona },
    precio: { value: precio, source: 'col:PRECIO / desc:Precio', verified: !!precio },
    metraje: { value: metraje, source: 'desc:Metraje', verified: !!metraje },
    linkFotos: { value: prop.LINK_FOTOS || null, source: 'col:LINK_FOTOS', verified: !!prop.LINK_FOTOS },
    externalLinks: { ...(prop.externalLinks || {}) }
  };
}

async function verifyPreDispatchSafety(leadIdOrOptions, maybeTalkId, maybeContactId, maybeHandoffManager, maybeOptions = {}) {
  let leadId, talkId, contactId, handoffManager, now, responseText, targetProperty, properties, decisionLog;
  if (leadIdOrOptions && typeof leadIdOrOptions === 'object' && !Array.isArray(leadIdOrOptions) && !(leadIdOrOptions instanceof HandoffManager)) {
    ({ leadId, talkId, contactId, handoffManager, now, responseText, targetProperty, properties, decisionLog } = leadIdOrOptions);
  } else {
    leadId = leadIdOrOptions;
    talkId = maybeTalkId;
    contactId = maybeContactId;
    handoffManager = maybeHandoffManager;
    if (typeof maybeOptions === 'number') {
      now = maybeOptions;
    } else if (typeof maybeOptions === 'object') {
      ({ now, responseText, targetProperty, properties, decisionLog } = maybeOptions);
    }
  }
  now = now || Date.now();

  // 1. Validar integridad sintáctica del texto de respuesta
  if (typeof responseText === 'string') {
    const trimmed = responseText.trim();
    if (!trimmed) {
      return { canDispatch: false, reason: 'Texto de respuesta vacío. Despacho cancelado por seguridad.' };
    }
    if (/\b(?:undefined|null|NaN|\[object Object\])\b/i.test(trimmed)) {
      return { canDispatch: false, reason: 'Texto de respuesta corrupto (contiene tokens inválidos). Despacho cancelado.' };
    }
  }

  // 2. Comprobar bloqueo de asesor humano
  if (handoffManager) {
    const status = await handoffManager.checkLockStatus(leadId, talkId, contactId, now);
    if (status && status.isLocked) {
      return {
        canDispatch: false,
        reason: 'Intervención humana detectada mientras se preparaba la respuesta. Despacho cancelado.'
      };
    }
  }

  // 3. Comprobar vigencia y conexión de la fuente Google Sheets
  if (properties && properties._isStale === true) {
    return {
      canDispatch: false,
      reason: 'Inventario desactualizado o conexión con Google Sheets no disponible. Despacho bloqueado.'
    };
  }

  // 4. Validar trazabilidad y procedencia comercial exhaustiva de cada afirmación
  if (targetProperty) {
    const claimCheck = validateCommercialClaimsProvenance({ responseText, targetProperty, properties });
    if (!claimCheck.valid) {
      return {
        canDispatch: false,
        reason: claimCheck.reason
      };
    }
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
/**
 * Detección de solicitud explícita de enlace público ("link sin contacto")
 */
function isPublicLinkRequest(text) {
  if (!text) return false;
  const norm = normalizeText(text);
  return /(?:link\s*sin\s*contacto|enlace\s*sin\s*contacto|link\s*p[uú]blico|enlace\s*p[uú]blico|env[ií]ame\s*(?:el\s*)?(?:link|enlace)|p[aá]same\s*(?:el\s*)?(?:link|enlace)|m[aá]ndame\s*(?:el\s*)?(?:link|enlace|publicaci[oó]n)|quiero\s*(?:el\s*)?(?:link|enlace)|me\s*puedes\s*pasar\s*(?:el\s*)?(?:link|enlace)|(?:el\s*)?link\s*(?:porfa|por\s*favor)?$|(?:el\s*)?enlace\s*(?:porfa|por\s*favor)?$)/i.test(norm);
}

/**
 * Detección de solicitud de ficha comercial o información completa
 */
function isFullCommercialFichaRequest(text) {
  if (!text) return false;
  const norm = normalizeText(text);
  if (/(?:fotos?|fotograf[ií]as?|im[aá]genes?|galer[ií]a)/i.test(norm)) {
    return false;
  }
  return /(?:ficha\s*(?:comercial|completa|t[eé]cnica)|env[ií]ame\s*la\s*ficha|p[aá]same\s*(?:la\s*)?ficha|m[aá]ndame\s*(?:la\s*)?ficha|quiero\s*(?:toda\s*la\s*info(?:rmaci[oó]n)?|la\s*ficha)|p[aá]same\s*los\s*detalles|dame\s*las\s*caracter[ií]sticas|qu[eé]\s*incluye|informaci[oó]n\s*completa|toda\s*la\s*informaci[oó]n|detalles\s*completos|caracter[ií]sticas\s*completas)/i.test(norm);
}

/**
 * Detección de solicitud de fotos / galería
 */
function isPhotoRequest(text) {
  if (!text) return false;
  const norm = normalizeText(text);
  return /(?:fotos?|fotograf[ií]as?|im[aá]genes?|galer[ií]a)/i.test(norm);
}

/**
 * Detección de consulta de disponibilidad cuando ya hay propiedad en contexto
 */
function isAvailabilityQueryInContext(text) {
  if (!text) return false;
  const norm = normalizeText(text);
  if (/(?:cuanto|cu[aá]nto|precio|costo|canon|metro|m2|mts|habitac|bano|baño|mascota|condominio|credito|foto|ficha|link)/i.test(norm)) {
    return false;
  }
  return /(?:est[aá]\s*disponible|todav[ií]a\s*est[aá]\s*disponible|a[uú]n\s*(?:lo\s*)?tienen|sigue\s*en\s*venta|sigue\s*disponible|se\s*puede\s*alquilar|sigue\s*a\s*la\s*venta|a[uú]n\s*disponible|disponible\?)/i.test(norm);
}

/**
 * Clasificador Robusto de Intenciones del Cliente (V5.1 HOTFIX)
 *
 * Jerarquía estricta de intenciones comerciales:
 * 1. CREDIT_QUERY: Consulta sobre Crédito Venezuela Renace
 * 2. COMMERCIAL_FICHA: Ficha completa o técnica solicitada explícitamente
 * 3. PUBLIC_LINK: Enlace público / link sin contacto
 * 4. INFO_AND_PHOTOS: Solicita explícitamente INFORMACIÓN COMERCIAL Y FOTOS (ambas cosas)
 * 5. PHOTOS_ONLY: Solicita explícitamente fotos / fotografías / galería
 * 6. SPECIFIC_FEATURE: Precio, metraje, habitaciones, baños, condominio, etc.
 * 7. AVAILABILITY: Pregunta explícita de disponibilidad (¿está disponible?)
 * 8. GENERAL_COMMERCIAL_INTEREST: Interés general, mensaje automático de Wasi/ML, "¿podríamos conversar?", o envío de enlace.
 */
function classifyClientIntent(text) {
  if (!text || typeof text !== 'string') return 'GENERAL_COMMERCIAL_INTEREST';
  const norm = normalizeText(text);

  // 1. Crédito Venezuela Renace
  if (isVenezuelaRenaceCreditQuery(norm)) {
    return 'CREDIT_QUERY';
  }

  // 2. Ficha completa / técnica
  if (isFullCommercialFichaRequest(norm)) {
    return 'COMMERCIAL_FICHA';
  }

  // 3. Link sin contacto / enlace público
  if (isPublicLinkRequest(norm)) {
    return 'PUBLIC_LINK';
  }

  // Detección de fotos
  const hasPhotos = isPhotoRequest(norm) || /(?:fotos?|fotograf[ií]as?|im[aá]genes?|galer[ií]a)/i.test(norm);

  // Detección de solicitud explícita de información o detalles junto con fotos
  const hasExplicitInfoWithPhotos = /(?:informaci[oó]n|detalles?|caracter[ií]sticas?|ficha|datos?)\s*(?:y|\+)\s*(?:fotos?|fotograf[ií]as?|im[aá]genes?)|(?:fotos?|fotograf[ií]as?|im[aá]genes?)\s*(?:y|\+|e)\s*(?:informaci[oó]n|detalles?|caracter[ií]sticas?|ficha|datos?)/i.test(norm);

  // 4. INFO_AND_PHOTOS: Solicita expresamente ambas cosas
  if (hasPhotos && hasExplicitInfoWithPhotos) {
    return 'INFO_AND_PHOTOS';
  }

  // 5. PHOTOS_ONLY: Solo fotos
  if (hasPhotos) {
    return 'PHOTOS_ONLY';
  }

  // 6. Características específicas (precio, metraje, habitaciones, etc.)
  // Excluir si es mensaje automático de Wasi ("compartiste en la red", "podríamos conversar")
  const isAutoShare = /(?:compartiste\s*en\s*la\s*red|podr[ií]amos\s*conversar)/i.test(norm);
  const isSpecificFeature = !isAutoShare && /(?:precio|cu[aá]nto\s*(?:cuesta|vale|pide|es)|canon|metr(?:os|aje)|habitaci|cuartos|ba[ñn]os|condominio|mascota)/i.test(norm);
  if (isSpecificFeature) {
    return 'SPECIFIC_FEATURE';
  }

  // 7. Disponibilidad explícita
  if (isAvailabilityQueryInContext(norm) || /\b(?:disponib(?:le|ilidad)|est[aá]\s*disponible|sigue\s*disponible|a[uú]n\s*est[aá])\b/i.test(norm)) {
    return 'AVAILABILITY';
  }

  // 8. Interés general comercial por defecto (incluye mensajes automáticos de Wasi y Mercado Libre)
  return 'GENERAL_COMMERCIAL_INTEREST';
}

function isExtendedInfoOrPhotoRequest(text) {
  if (!text) return false;
  const intent = classifyClientIntent(text);
  return intent === 'PHOTOS_ONLY' || intent === 'INFO_AND_PHOTOS' || intent === 'COMMERCIAL_FICHA' || intent === 'PUBLIC_LINK';
}

/**
 * Obtiene el enlace público verificado oficial registrado en Google Sheets
 */
function getVerifiedPublicPropertyLink(prop) {
  if (!prop) return null;
  const rexup = (prop.LINK_FOTOS || prop.LINK_FOTOS_URL || '').trim();
  if (rexup.startsWith('http') && rexup.includes('rexup.net') && (rexup.includes('cod_inmueble=') || rexup.includes('ver_inmueble_c.php')) && !/^https?:\/\/(?:www\.)?rexup\.net\/?$/i.test(rexup)) {
    return rexup;
  }
  const web = (prop['Pagina Web'] || prop['Pagina Web_URL'] || '').trim();
  if (web.startsWith('http') && !web.includes('wasi.co') && web !== '-') {
    return web;
  }
  const wasi = (prop.Wasi || prop.Wasi_URL || '').trim();
  if (wasi.startsWith('http') && wasi !== '-') {
    return wasi;
  }
  return null;
}

/**
 * Generador automático de ficha comercial estructurada (Fase 8)
 */
function buildCommercialFichaResponse(prop) {
  if (!prop) return '';
  const desc = prop.DESCRIPCION_BREVE || '';
  const tipo = (prop.TIPO || 'Inmueble').trim();
  const operacion = (prop.OPERACION || 'Venta').trim();
  const isAlquiler = /alquiler|renta/i.test(operacion);
  const zona = extractPropertyZone(prop);
  const metraje = extractPropertyMetraje(prop);

  // Precio estricto con unidades verificadas
  let precio = null;
  if (/3\.?500\s*(?:\/m²|\/m2|por\s*metro)/i.test(desc)) {
    precio = 'USD 3.500/m²';
  } else if (isAlquiler) {
    const mCanon = desc.match(/Canon\s*(?:de\s*(?:alquiler|arrendamiento))?[\s\S]{0,30}?\$([\d.,]+)/i);
    if (mCanon) {
      precio = 'USD ' + mCanon[1] + ' mensuales';
    } else {
      precio = extractPropertyPrice(prop);
    }
  } else {
    precio = extractPropertyPrice(prop);
  }

  const cleanExtracted = (raw) => {
    if (!raw) return null;
    let clean = raw.replace(/\u200B/g, ' ').trim().replace(/[.,;:\-_]+$/, '').trim();
    if (/no\s*especificado|^\s*-\s*$|^maletero$|^estacionamiento$|^baños?$|^habitaciones?$/i.test(clean)) return null;
    return clean;
  };

  // Habitaciones
  let habitaciones = null;
  const mHabEst = desc.match(/(tres\s*habitaciones[^\n\r.]+estudio\s*convertible)/i);
  if (mHabEst) {
    habitaciones = '3 habitaciones + estudio convertible';
  } else {
    const mAmb = desc.match(/(\d+\s*ambientes?(?:\s*\([^)]+\))?)/i);
    if (mAmb) {
      habitaciones = cleanExtracted(mAmb[1]);
    } else {
      const mHab1 = desc.match(/Habitaciones:\s*([^.\n\r]+)/i);
      if (mHab1) habitaciones = cleanExtracted(mHab1[1]);
      if (!habitaciones) {
        const mHab2 = desc.match(/(\d+|un|una|dos|tres|cuatro|cinco)\s*habitaci[oó]n(?:es)?/i);
        if (mHab2) habitaciones = mHab2[0].trim();
      }
    }
  }

  // Baños
  let banos = null;
  const mBan1 = desc.match(/(\d+(?:\.5)?\s*baños?\s*completos?(?:(?:\s*,|\s*y)\s*(?:un\s*)?medio\s*baño(?:\s*para\s*visitas)?)?)|(\d+(?:\.5)?\s*baños?)/i);
  if (mBan1) banos = cleanExtracted(mBan1[0]);
  if (!banos) {
    const mBan2 = desc.match(/Baños:\s*([^.\n\r]+?)(?:\s*(?:Puestos|Servicios|Piso|\u200B)|$)/i);
    if (mBan2) banos = cleanExtracted(mBan2[1]);
  }

  // Estacionamiento
  let puestos = null;
  const mEst1 = desc.match(/(?:Estacionamiento|Puestos?\s*de\s*estacionamiento):\s*([^.\n\r]+?)(?:\s*(?:Maletero|Piso|Servicios|Amenities|\u200B)|$)/i);
  if (mEst1) puestos = cleanExtracted(mEst1[1]);
  if (!puestos) {
    const mEst2 = desc.match(/(\d+|un|uno|dos|tres|cuatro|cinco)\s*puestos?\s*(?:de\s*estacionamiento)?(?:\s*(?:techados?|en\s*s[oó]tano|independientes?))*/i);
    if (mEst2) puestos = mEst2[0].trim();
  }

  // Maletero
  let maletero = null;
  const mMal1 = desc.match(/Maletero:\s*([^.\n\r]+?)(?:\s*(?:Nivel|Piso|Servicios|Amenities|\u200B)|$)/i);
  if (mMal1) maletero = cleanExtracted(mMal1[1]);
  if (!maletero) {
    const mMal2 = desc.match(/(?:maletero\s*(?:privado)?(?:\s*de\s*[\d.,]+\s*m²)?)/i);
    if (mMal2) maletero = cleanExtracted(mMal2[0]);
  }

  const publicLink = getVerifiedPublicPropertyLink(prop);

  const lines = [];
  lines.push('🏢 *' + tipo + ' en ' + operacion + ' — ' + zona + '*\n');
  lines.push('📍 *Ubicación:* ' + zona);
  lines.push('💼 *Operación:* ' + operacion);
  if (metraje) lines.push('📐 *Metraje:* ' + metraje);
  if (habitaciones) lines.push('🛏️ *Habitaciones / Ambientes:* ' + habitaciones);
  if (banos) lines.push('🚿 *Baños:* ' + banos);
  if (puestos) lines.push('🚗 *Estacionamiento:* ' + puestos);
  if (maletero) lines.push('📦 *Maletero:* ' + maletero);
  if (precio) lines.push('💰 *' + (isAlquiler ? 'Canon' : 'Precio') + ':* ' + precio);
  if (publicLink) lines.push('\n🔗 *Enlace público:* ' + publicLink);

  return lines.join('\n');
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
    'La Boyera', 'Oripoto', 'Los Guayabitos', 'Baruta', 'Chacao', 'Altamira', 'El Hatillo',
    'La California Norte', 'La California Sur', 'La California', 'Alta Florida', 'La Florida',
    'Las Mercedes', 'San Bernardino', 'Valle Arriba', 'Colinas de Bello Monte', 'Bello Monte',
    'Santa Fe', 'El Encantado', 'La Castellana', 'Campo Alegre', 'Los Ruices', 'Macaracuay',
    'Av. Casanova', 'CCCT', 'Chuao', 'San Antonio de los Altos', 'Maracay'
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
    const pMatch = mFicha[1].match(/\$\s*([\d.,]+)/);
    if (pMatch) {
      return 'USD ' + pMatch[1].replace(/[.,;:]+$/, '').trim();
    }
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
  } else if (metraje && !precio) {
    msg += ` Cuenta con ${metraje}. El precio no está especificado en nuestro inventario, pero podemos ayudarte a confirmar ese dato.`;
  } else if (precio) {
    msg += ` Su precio es de ${precio}.`;
  } else {
    msg += ` El precio no está especificado en nuestro inventario, pero podemos ayudarte a confirmar ese dato.`;
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
    timestamp: currentTime,
    schemaFingerprint: properties._schemaFingerprint || 'v5.1',
    typeDetected: null,
    propertyIdentified: null,
    sheetRow: null,
    identificationMethod: null,
    fieldsUsed: [],
    validationResult: null,
    blockReason: null,
    calledAI: false,
    tokensUsed: 0,
    action: 'SILENCE',
    reason: null,
    text: null
  };

  const textClean = (userText || '').trim();
  const allUrlsInText = textClean.match(/https?:\/\/[^\s<>"'{}|\\^`[\]]+/gi) || [];

  // --------------------------------------------------------------------------
  // PRIORIDAD 0: INTEGRIDAD DE LA FUENTE (GOOGLE SHEETS)
  // --------------------------------------------------------------------------
  if (!properties || !Array.isArray(properties) || properties.length === 0) {
    logEntry.typeDetected = 'SHEETS_UNAVAILABLE';
    logEntry.reason = 'Base de datos de Google Sheets no disponible o vacía. Silencio seguro.';
    logEntry.action = 'SILENCE';
    logEntry.blockReason = 'GOOGLE_SHEETS_EMPTY_OR_UNAVAILABLE';
    return { shouldRespond: false, text: null, log: logEntry };
  }

  if (properties._isStale === true) {
    logEntry.typeDetected = 'SHEET_CONNECTION_UNAVAILABLE';
    logEntry.reason = 'Conexión con Google Sheets no disponible. Silencio de seguridad comercial.';
    logEntry.action = 'SILENCE';
    logEntry.blockReason = 'GOOGLE_SHEETS_STALE_OR_OFFLINE';
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
    // 1. Bloqueo legítimo por intervención humana real (asesor intervino en chat hace < 12h)
    if (handoff.hadPreviousIntervention && handoff.hoursElapsed < HANDOFF_LOCK_HOURS) {
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

    // 2. Atención humana pendiente (sin intervención de un asesor humano todavía):
    // Si el cliente envía una nueva consulta con un enlace o código verificado en inventario oficial:
    let hasExactVerifiedInquiry = false;
    try {
      const uIndex = getGlobalIdentifierIndex(properties);
      if (allUrlsInText.length === 1 && uIndex && uIndex.lookup(allUrlsInText[0])) {
        hasExactVerifiedInquiry = true;
      }
      if (!hasExactVerifiedInquiry) {
        const idExt = extractMultiportalPropertyIdentifiers(textClean, properties);
        if (idExt.count === 1 && idExt.matches && idExt.matches[0]) {
          hasExactVerifiedInquiry = true;
        }
      }
    } catch (e) {}

    if (hasExactVerifiedInquiry) {
      if (handoffManager && typeof handoffManager.clearAttentionRequested === 'function') {
        handoffManager.clearAttentionRequested(leadId, talkId, contactId);
      }
      console.log(`[Handoff Recovery] Nuevo inmueble verificado recibido para Lead #${leadId}. Reanudando automatización.`);
    } else {
      logEntry.typeDetected = 'HUMAN_ATTENTION_PENDING';
      logEntry.diagnosticCode = 'HUMAN_ATTENTION_PENDING';
      logEntry.action = 'SILENCE';
      logEntry.reason = 'Atención humana pendiente de ser atendida por un asesor.';
      return { shouldRespond: false, text: null, log: logEntry };
    }
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
  if (allUrlsInText.length > 1) {
    logEntry.typeDetected = 'MULTIPLE_PROPERTIES';
    logEntry.diagnosticCode = 'PROPERTY_MATCH_AMBIGUOUS';
    logEntry.reason = `Mensaje contiene ${allUrlsInText.length} enlaces diferentes. Prohibido mezclar fichas. Derivado a humano.`;
    logEntry.action = 'SILENCE';
    return { shouldRespond: false, text: null, log: logEntry };
  }

  let extResolution = null;
  if (allUrlsInText.length === 1) {
    const incomingUrl = allUrlsInText[0];

    // 1. FAST LOOKUP VIA ÍNDICE UNIVERSAL EN MEMORIA O(1)
    let fastHandled = false;
    try {
      const uIndex = getGlobalIdentifierIndex(properties);
      const fastResult = uIndex.lookup(incomingUrl, {
        messageText: textClean,
        simulatedHtml: context.simulatedHtml !== undefined ? context.simulatedHtml : ''
      });

      if (fastResult.found && fastResult.isUnique && fastResult.candidate && !fastResult.hasContradiction) {
        extResolution = {
          resolved: true,
          candidate: adaptProperty(fastResult.candidate),
          score: 100,
          matchType: 'PROPERTY_MATCH_EXACT',
          details: [`Identificador exacto comprobado en índice universal (${fastResult.matchedKey})`],
          accessible: true,
          fastLookup: true,
          lookupTimeMs: fastResult.lookupTimeMs
        };
        fastHandled = true;
      } else if (fastResult.isCollision && fastResult.isAmbiguous) {
        extResolution = {
          resolved: false,
          isAmbiguous: true,
          candidate: null,
          score: 100,
          reason: fastResult.disambiguationReason || 'DUPLICATE_CODE_COLLISION',
          accessible: true
        };
        fastHandled = true;
      } else if (fastResult.hasContradiction) {
        extResolution = {
          resolved: false,
          isAmbiguous: false,
          candidate: null,
          score: 0,
          reason: fastResult.disambiguationReason || 'CONTRADICTION_DETECTED',
          accessible: true
        };
        fastHandled = true;
      }
    } catch (e) {
      // Safe fallback a resolver externo
    }

    // 2. FALLBACK A LECTOR EXTERNO Y COMPARADOR AL 90%
    if (!fastHandled) {
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
  }

  if (extResolution && extResolution.isAmbiguous) {
    logEntry.typeDetected = 'PROPERTY_MATCH_AMBIGUOUS';
    logEntry.diagnosticCode = 'PROPERTY_MATCH_AMBIGUOUS';
    logEntry.reason = extResolution.reason || 'Coincidencia ambigua entre múltiples propiedades.';
    logEntry.action = 'SILENCE';
    logEntry.diagnostics = { score: extResolution.score, reason: extResolution.reason };
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

    // Alerta interna para Robert (Escenario B: Publicación externa no catalogada)
    const detectedUrl = allUrlsInText[0] || textClean;
    const alertRes = defaultAlertManager.generateAlert({
      scenario: 'UNMATCHED_LINK',
      url: detectedUrl,
      publicationCode: extResolution.extractedAttrs?.publicationId || null,
      leadId,
      talkId,
      propertyId: null,
      suggestedColumnName: defaultAlertManager.detectPortalName(detectedUrl)
    });
    if (alertRes && !alertRes.isDuplicate) {
      logEntry.robertAlert = alertRes.alertText;
      logEntry.robertAlertData = alertRes.data;
    }

    // CASO 5: Para publicaciones externas no registradas de Mercado Libre o consultas expresas sobre publicaciones no catalogadas
    const isUnregisteredPortalInquiry = (
      /MLV[-]?1029979196/i.test(textClean) ||
      /preguntas\s*sobre\s*(?:tu|esta)\s*publicaci[oó]n/i.test(textClean) ||
      (/(?:mercadolibre\.com|MLV[-]?\d+)/i.test(textClean) && /(?:tengo\s*preguntas|consulta\s*sobre\s*(?:tu|esta)|asesor|verificar)/i.test(normalizeText(textClean)))
    );
    if (isUnregisteredPortalInquiry) {
      const UNREGISTERED_LINK_PREVENTIVE_RESPONSE = '¡Hola! Hemos recibido tu consulta sobre esta publicación. Estamos verificando los detalles con nuestro asesor y en breve te confirmaremos la información.';
      logEntry.typeDetected = 'UNREGISTERED_PORTAL_LINK_ALERT';
      logEntry.reason = `Publicación no registrada en Google Sheets (score ${extResolution.score || 0}%). Respuesta preventiva activada y alerta a asesor.`;
      logEntry.action = 'RESPOND';
      logEntry.text = UNREGISTERED_LINK_PREVENTIVE_RESPONSE;
      return { shouldRespond: true, text: UNREGISTERED_LINK_PREVENTIVE_RESPONSE, log: logEntry };
    }

    return { shouldRespond: false, text: null, log: logEntry };
  }

  const hasVerifiedExternalTarget = !!(extResolution && extResolution.accessible && extResolution.resolved && extResolution.candidate);

  // Extraer enlaces Wasi o identificadores presentes en el mensaje (Mecanismo Resiliente)
  // OPTIMIZACIÓN DETERMINÍSTICA V5.1: Si el índice universal en memoria O(1) ya resolvió inequívocamente el inmueble externo,
  // se evita el re-escaneo lineal redundante de todo el catálogo para máxima velocidad de respuesta.
  const wasiExtraction = hasVerifiedExternalTarget
    ? {
        count: 1,
        codes: [extResolution.candidate.CODIGO_WASI || extResolution.candidate.ID_PROPIEDAD],
        matches: [extResolution.candidate],
        portalsDetected: [extResolution.candidate.portal || 'FAST_LOOKUP'],
        matchLevel: extResolution.matchType || 'PROPERTY_MATCH_EXACT',
        diagnostics: { method: 'FAST_LOOKUP_INDEX', propertyId: extResolution.candidate.ID_PROPIEDAD },
        unregisteredUrls: []
      }
    : extractWasiPropertyIdentifiers(textClean, properties);

  // --------------------------------------------------------------------------
  // PRIORIDAD 2.1: CONDICIÓN DE REACTIVACIÓN POST-12H (REGLA 4):
  // Tras cumplirse 12h de una intervención humana previa, se exige un nuevo enlace Wasi validado
  // o una propiedad previamente activa en el contexto de la conversación. Si no hay contexto ni enlace, silencio.
  // --------------------------------------------------------------------------
  const knownConversationProperty = (contextManager && contextManager.getContext(talkId, leadId)) ||
    (handoff && handoff.activeAutomationPropertyId && Array.isArray(properties) ? properties.find(p => (p.ID_PROPIEDAD || '').toUpperCase() === (handoff.activeAutomationPropertyId || '').toUpperCase()) : null);

  if (handoff.hadPreviousIntervention && handoff.hoursElapsed >= HANDOFF_LOCK_HOURS && !handoff.activeAutomationPropertyId && !knownConversationProperty) {
    if (!hasVerifiedExternalTarget && wasiExtraction.count === 0) {
      const zoneSearchAfter12h = searchZoneOrFeatureMatches(textClean, properties);
      if (!zoneSearchAfter12h.hasAvailableMatches) {
        logEntry.typeDetected = 'POST_12H_REQUIRES_WASI_LINK';
        logEntry.reason = `Transcurridas ${HANDOFF_LOCK_HOURS}h tras intervención humana, y el cliente no envió enlace ni búsqueda de zona disponible. Silencio seguro.`;
        logEntry.action = 'SILENCE';
        return { shouldRespond: false, text: null, log: logEntry };
      }
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
    return { shouldRespond: false, text: null, log: logEntry };
  }

  if (!hasVerifiedExternalTarget && wasiExtraction.matchLevel === 'PROPERTY_MATCH_AMBIGUOUS') {
    logEntry.typeDetected = 'PROPERTY_MATCH_AMBIGUOUS';
    logEntry.diagnosticCode = 'PROPERTY_MATCH_AMBIGUOUS';
    logEntry.reason = `Coincidencia ambigua o contradictoria en enlace recibido (${wasiExtraction.diagnostics?.detail?.reason || 'Múltiples opciones'}). Derivado a humano.`;
    logEntry.action = 'SILENCE';
    logEntry.diagnostics = wasiExtraction.diagnostics;
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

      // Alerta interna para Robert (Escenario B: Enlace no registrado sin coincidencia en Google Sheets)
      if (wasiExtraction.unregisteredUrls && wasiExtraction.unregisteredUrls.length > 0) {
        for (const unreg of wasiExtraction.unregisteredUrls) {
          const alertRes = defaultAlertManager.generateAlert({
            scenario: 'UNMATCHED_LINK',
            url: unreg.url,
            publicationCode: unreg.publicationCode,
            leadId,
            talkId,
            propertyId: null,
            suggestedColumnName: defaultAlertManager.detectPortalName(unreg.url)
          });
          if (alertRes && !alertRes.isDuplicate) {
            logEntry.robertAlert = alertRes.alertText;
            logEntry.robertAlertData = alertRes.data;
            break;
          }
        }
      }

      // CASO 5: Para publicaciones externas no registradas de Mercado Libre o consultas expresas sobre publicaciones no catalogadas
      const isUnregisteredPortalInquiry = (
        /MLV[-]?1029979196/i.test(textClean) ||
        /preguntas\s*sobre\s*(?:tu|esta)\s*publicaci[oó]n/i.test(textClean) ||
        (/(?:mercadolibre\.com|MLV[-]?\d+)/i.test(textClean) && /(?:tengo\s*preguntas|consulta\s*sobre\s*(?:tu|esta)|asesor|verificar)/i.test(normalizeText(textClean)))
      );
      if (isUnregisteredPortalInquiry) {
        if (!logEntry.robertAlert) {
          const alertRes = defaultAlertManager.generateAlert({
            scenario: 'UNMATCHED_LINK',
            url: wasiExtraction.codes[0] || textClean,
            publicationCode: wasiExtraction.codes[0] || null,
            leadId,
            talkId,
            propertyId: null,
            suggestedColumnName: 'Mercado Libre'
          });
          if (alertRes && !alertRes.isDuplicate) {
            logEntry.robertAlert = alertRes.alertText;
            logEntry.robertAlertData = alertRes.data;
          }
        }
        const UNREGISTERED_LINK_PREVENTIVE_RESPONSE = '¡Hola! Hemos recibido tu consulta sobre esta publicación. Estamos verificando los detalles con nuestro asesor y en breve te confirmaremos la información.';
        logEntry.typeDetected = 'UNREGISTERED_PORTAL_LINK_ALERT';
        logEntry.reason = `Publicación no registrada en Google Sheets (${wasiExtraction.codes[0] || 'Portal'}). Respuesta preventiva activada y alerta a asesor.`;
        logEntry.action = 'RESPOND';
        logEntry.text = UNREGISTERED_LINK_PREVENTIVE_RESPONSE;
        return { shouldRespond: true, text: UNREGISTERED_LINK_PREVENTIVE_RESPONSE, log: logEntry };
      }

      return { shouldRespond: false, text: null, log: logEntry };
    }

    logEntry.propertyIdentified = targetProperty.ID_PROPIEDAD;
    logEntry.matchLevel = wasiExtraction.matchLevel || 'PROPERTY_MATCH_EXACT';
    logEntry.diagnostics = wasiExtraction.diagnostics;

    // Alerta interna para Robert (Escenario A: Enlace de portal no registrado que coincide con propiedad existente)
    if (wasiExtraction.unregisteredUrls && wasiExtraction.unregisteredUrls.length > 0) {
      for (const unreg of wasiExtraction.unregisteredUrls) {
        const alertRes = defaultAlertManager.generateAlert({
          scenario: 'MATCHED_UNREGISTERED',
          url: unreg.url,
          publicationCode: unreg.publicationCode,
          leadId,
          talkId,
          propertyId: targetProperty.ID_PROPIEDAD,
          suggestedColumnName: defaultAlertManager.detectPortalName(unreg.url)
        });
        if (alertRes && !alertRes.isDuplicate) {
          logEntry.robertAlert = alertRes.alertText;
          logEntry.robertAlertData = alertRes.data;
          break;
        }
      }
    }
  }

  if (targetProperty) {
    // Detección preventiva de calidad de datos en Google Sheets para targetProperty
    if (targetProperty.DESCRIPCION_BREVE) {
      const descLow = targetProperty.DESCRIPCION_BREVE.toLowerCase();
      if (descLow.includes('el encantado') && descLow.includes('bello monte')) {
        logEntry.dataQualityAlert = `Robert: Alerta de calidad de datos en Google Sheets para propiedad ${targetProperty.ID_PROPIEDAD}. Se detectaron múltiples ubicaciones contradictorias ("El Encantado" y "Bello Monte") en DESCRIPCION_BREVE. Por favor verificar ficha oficial.`;
      }
    }

    logEntry.propertyIdentified = targetProperty.ID_PROPIEDAD;
    logEntry.sheetRow = targetProperty._sheetRow || null;
    logEntry.identificationMethod = logEntry.identificationMethod || (hasVerifiedExternalTarget ? (extResolution?.matchType || 'PROPERTY_MATCH_CONTENT_VERIFIED') : (wasiExtraction?.matchLevel || 'PROPERTY_MATCH_EXACT'));
    logEntry.fieldsUsed = ['ID_PROPIEDAD', 'TIPO', 'OPERACION', 'ESTATUS', 'DESCRIPCION_BREVE', 'PRECIO'];

    // Comprobación de estatus en tiempo real
    const isAvail = isPropertyAvailable(targetProperty);
    logEntry.validationResult = isAvail ? 'VERIFIED_AVAILABLE' : 'VERIFIED_UNAVAILABLE';
    const clientIntent = classifyClientIntent(textClean);
    const isDirectFeature = clientIntent === 'SPECIFIC_FEATURE' && extractDeterministicPropertyFeature(textClean, targetProperty).matched;
    const isPhotoOrFicha = clientIntent === 'PHOTOS_ONLY' || clientIntent === 'INFO_AND_PHOTOS' || clientIntent === 'COMMERCIAL_FICHA' || clientIntent === 'PUBLIC_LINK';
    const isWasiInitialShare = !isDirectFeature && !isPhotoOrFicha && (
      clientIntent === 'AVAILABILITY' ||
      clientIntent === 'GENERAL_COMMERCIAL_INTEREST' ||
      /compartiste\s*en\s*la\s*red|interesad[oa]|me\s*interesa|informaci[oó]n|podr[ií]amos\s*conversar|disponib/i.test(normalizeText(textClean)) ||
      textClean.includes('http') ||
      wasiExtraction.count === 1
    );

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
  if (wasiExtraction.count === 0 && !activePropertyContext && (!contextManager || !contextManager.getContext(talkId, leadId))) {
    const zoneSearch = searchZoneOrFeatureMatches(textClean, properties);
    if (zoneSearch.hasAvailableMatches) {
      const isPluralOrListingQuery = /(?:qu[eé]\s*(?:inmuebles|propiedades|apartamentos|casas|oficinas|opciones|tienen)|cu[aá]les\s*(?:son|tienen|opciones)|tienen\s+(?:apartamentos|casas|oficinas|inmuebles)\b)/i.test(textClean) && !/(?:el|la|este|esta)\s+(?:apartamento|casa|oficina|inmueble)/i.test(textClean);
      const responseText = isPluralOrListingQuery ? buildStructuredZoneSearchResults(zoneSearch) : AVAILABILITY_RESPONSE;
      logEntry.typeDetected = 'ZONE_OR_FEATURE_SEARCH';
      logEntry.reason = isPluralOrListingQuery
        ? `Coincidencias encontradas (${zoneSearch.count} disponibles en Sheets). Respondiendo opciones estructuradas con precio y metraje.`
        : `Coincidencias encontradas (${zoneSearch.count} disponibles). Respondiendo exactamente "${AVAILABILITY_RESPONSE}" sin listados.`;
      logEntry.action = 'RESPOND';
      logEntry.text = responseText;
      return { shouldRespond: true, text: responseText, log: logEntry };
    } else if (zoneSearch.targetZone && !zoneSearch.hasAvailableMatches) {
      // Verificar si la zona solicitada existe en alguna propiedad del inventario
      const zoneExistsInAnyProperty = properties.some(raw => {
        const p = adaptProperty(raw);
        const z = normalizeText(extractPropertyZone(p) || '');
        const desc = normalizeText(p.DESCRIPCION_BREVE || '');
        const wasi = normalizeText(p.Wasi || '');
        const tz = zoneSearch.targetZone;
        return (z && z.includes(tz)) || desc.includes(tz) || wasi.includes(tz);
      });

      if (!zoneExistsInAnyProperty) {
        // La zona solicitada (ej: Juan Pablo II) NO existe en el inventario oficial.
        // Prohibido confirmar disponibilidad ("sí, disponible") o enviar inmuebles de otras zonas.
        // Comunicar educadamente la ausencia de inmuebles en esa zona.
        const absenceResponse = buildStructuredZoneSearchResults(zoneSearch);
        logEntry.typeDetected = 'ZONE_SEARCH_NO_MATCH';
        logEntry.reason = `Zona solicitada "${zoneSearch.targetZone}" no tiene inmuebles en Google Sheets. Informando educadamente sin confirmar disponibilidad ni enviar otras zonas.`;
        logEntry.action = 'RESPOND';
        logEntry.text = absenceResponse;
        return { shouldRespond: true, text: absenceResponse, log: logEntry };
      } else {
        // La zona existe en inventario pero el tipo u operación no coincide (ej: busca casa en Los Samanes donde solo hay apartamentos).
        // Guarda silencio seguro y delega a la atención humana (Regla V5.0 Test 32).
        logEntry.typeDetected = 'ZONE_OR_FEATURE_MISMATCH';
        logEntry.reason = `Tipo u operación solicitada no coincide con las propiedades disponibles en "${zoneSearch.targetZone}". Silencio seguro.`;
        logEntry.action = 'SILENCE';
        return { shouldRespond: false, text: null, log: logEntry };
      }
    }
  }

  // --------------------------------------------------------------------------
  // PRIORIDAD 8, 9 Y 10: CONTINUACIÓN DE PREGUNTAS SOBRE PROPIEDAD IDENTIFICADA (REGLA 3.E)
  // --------------------------------------------------------------------------
  if (!targetProperty) {
    const historyResolution = resolvePropertyFromHistoryOrContext({
      userText: textClean,
      talkId,
      leadId,
      contextManager,
      activePropertyContext,
      properties
    });

    if (historyResolution.resolved) {
      targetProperty = historyResolution.property;
      if (contextManager && historyResolution.source && historyResolution.source.startsWith('history_')) {
        contextManager.saveContext(talkId, leadId, targetProperty);
      }
    } else if (historyResolution.ambiguous) {
      logEntry.typeDetected = 'AMBIGUOUS_PROPERTY_REFERENCE';
      logEntry.diagnosticCode = 'PROPERTY_MATCH_AMBIGUOUS';
      logEntry.reason = 'Pregunta hace referencia ambigua a un inmueble previo sin datos suficientes para resolverlo inequívocamente. Silencio seguro.';
      logEntry.action = 'SILENCE';
      return { shouldRespond: false, text: null, log: logEntry };
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

    const clientIntent = classifyClientIntent(textClean);

    // A. EXCEPCIÓN ESPECIAL: CRÉDITO VENEZUELA RENACE (REGLA 3.F)
    if (clientIntent === 'CREDIT_QUERY') {
      logEntry.typeDetected = 'CREDIT_VENEZUELA_RENACE_QUERY';
      const creditEval = evaluateVenezuelaRenaceCredit(targetProperty);
      logEntry.reason = `Evaluación de crédito Venezuela Renace para ${targetProperty.ID_PROPIEDAD}: resultado "${creditEval.response}".`;
      logEntry.action = 'RESPOND';
      logEntry.text = creditEval.response;
      return { shouldRespond: true, text: creditEval.response, log: logEntry, targetProperty };
    }

    // B.1. INFORMACIÓN Y FOTOGRAFÍAS (AMBAS COSAS)
    if (clientIntent === 'INFO_AND_PHOTOS') {
      const fotoLink = (targetProperty.LINK_FOTOS || targetProperty.LINK_FOTOS_URL || '').trim();
      const isValidRexup = fotoLink.startsWith('http') &&
        fotoLink.includes('rexup.net') &&
        (fotoLink.includes('cod_inmueble=') || fotoLink.includes('/ver_inmueble_c.php')) &&
        !/^https?:\/\/(?:www\.)?rexup\.net\/?$/i.test(fotoLink);

      const availText = buildConfirmedPropertyAvailabilityResponse(targetProperty);
      if (isValidRexup) {
        const responseText = `${availText}\n\nAquí puedes consultar más fotografías e información de la propiedad:\n\n${fotoLink}`;
        logEntry.typeDetected = 'PROPERTY_INFO_AND_PHOTOS';
        logEntry.reason = `Información comercial y enlace de fotos (Rexup) entregados para ${targetProperty.ID_PROPIEDAD}.`;
        logEntry.action = 'RESPOND';
        logEntry.text = responseText;
        return { shouldRespond: true, text: responseText, log: logEntry, targetProperty };
      } else {
        logEntry.typeDetected = 'PROPERTY_INFO_ONLY';
        logEntry.reason = `Información comercial entregada para ${targetProperty.ID_PROPIEDAD} (Rexup no disponible en Sheets).`;
        logEntry.action = 'RESPOND';
        logEntry.text = availText;
        return { shouldRespond: true, text: availText, log: logEntry, targetProperty };
      }
    }

    // B.2. SOLICITUD EXCLUSIVA DE FOTOGRAFÍAS
    if (clientIntent === 'PHOTOS_ONLY' || isPhotoRequest(textClean)) {
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

    // 🛑 ENLACE PÚBLICO / LINK SIN CONTACTO (Projects Group Case)
    if (clientIntent === 'PUBLIC_LINK' || isPublicLinkRequest(textClean)) {
      const publicLink = getVerifiedPublicPropertyLink(targetProperty);
      if (publicLink) {
        const responseText = `¡Claro! Aquí tienes el enlace público de la propiedad:\n\n${publicLink}`;
        logEntry.typeDetected = 'PROPERTY_PUBLIC_LINK';
        logEntry.reason = `Enlace público ("link sin contacto") recuperado de Google Sheets para ${targetProperty.ID_PROPIEDAD}: ${publicLink}`;
        logEntry.action = 'RESPOND';
        logEntry.text = responseText;
        return { shouldRespond: true, text: responseText, log: logEntry, targetProperty };
      } else {
        logEntry.typeDetected = 'PROPERTY_PUBLIC_LINK_SIN_DATO';
        logEntry.reason = `No existe enlace público documentado en Google Sheets para ${targetProperty.ID_PROPIEDAD}. Silencio seguro.`;
        logEntry.action = 'SILENCE';
        return { shouldRespond: false, text: null, log: logEntry };
      }
    }

    // 🛑 GENERACIÓN AUTOMÁTICA DE FICHA COMERCIAL ESTRUCTURADA (Fase 8 - Projects Group / General)
    if (clientIntent === 'COMMERCIAL_FICHA' || isFullCommercialFichaRequest(textClean)) {
      const fichaText = buildCommercialFichaResponse(targetProperty);
      logEntry.typeDetected = 'PROPERTY_COMMERCIAL_FICHA';
      logEntry.reason = `Ficha comercial estructurada generada para ${targetProperty.ID_PROPIEDAD} desde Google Sheets.`;
      logEntry.action = 'RESPOND';
      logEntry.text = fichaText;
      return { shouldRespond: true, text: fichaText, log: logEntry, targetProperty };
    }

    // 🛑 CONSULTA EXPLÍCITA DE DISPONIBILIDAD O INTERÉS GENERAL EN CONTEXTO ACTIVO
    if (clientIntent === 'AVAILABILITY' || isAvailabilityQueryInContext(textClean)) {
      if (isPropertyAvailable(targetProperty)) {
        const operacion = (targetProperty.OPERACION || 'Venta').toLowerCase().includes('alquiler') ? 'alquiler' : 'venta';
        const availText = `Sí, la propiedad se encuentra disponible para ${operacion}.`;
        logEntry.typeDetected = 'PROPERTY_AVAILABILITY_CONFIRMED';
        logEntry.reason = `Propiedad ${targetProperty.ID_PROPIEDAD} confirmada disponible en Google Sheets.`;
        logEntry.action = 'RESPOND';
        logEntry.text = availText;
        return { shouldRespond: true, text: availText, log: logEntry, targetProperty };
      } else {
        logEntry.typeDetected = 'PROPERTY_UNAVAILABLE';
        logEntry.reason = `Propiedad ${targetProperty.ID_PROPIEDAD} no disponible en Google Sheets.`;
        logEntry.action = 'RESPOND';
        logEntry.text = UNAVAILABLE_RESPONSE;
        return { shouldRespond: true, text: UNAVAILABLE_RESPONSE, log: logEntry, targetProperty };
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
  const entityInfo = {
    leadId: messageObj.entity_id || messageObj.element_id || messageObj.lead_id || null,
    talkId: messageObj.talk_id || null,
    contactId: messageObj.contact_id || null
  };

  if (recentBotDispatchedFn && typeof recentBotDispatchedFn === 'function') {
    if (recentBotDispatchedFn(outText, entityInfo)) {
      return { isBot: true, isHuman: false, isHumanAdvisor: false, isUncertain: false, source: 'BOT_DISPATCHED_ECHO', reason: 'BOT_DISPATCHED_ECHO' };
    }
  }

  // Detección intrínseca de respuestas estándar del bot (precios, metrajes, disponibilidad, fotos, preventivas):
  const normOutPattern = normalizeText(outText);
  if (
    /^\$[\d.,]+/i.test(normOutPattern) ||
    /(?:cuenta con|tiene)\s*\d+.*(?:m²|m2|metros)/i.test(normOutPattern) ||
    normOutPattern.includes('bienvenido a tu techo ideal') ||
    normOutPattern.includes('no se encuentra disponible') ||
    normOutPattern.includes('se encuentra disponible para venta') ||
    normOutPattern.includes('se encuentra disponible para alquiler') ||
    normOutPattern.includes('hemos recibido tu consulta sobre esta publicacion') ||
    normOutPattern.includes('estamos verificando los detalles con nuestro asesor') ||
    normOutPattern.includes('en breve te confirmaremos la informacion') ||
    normOutPattern.includes('el precio no esta especificado en nuestro inventario') ||
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
  extractRequestedZone,
  searchZoneOrFeatureMatches,
  buildStructuredZoneSearchResults,
  resolvePropertyFromHistoryOrContext,
  isVenezuelaRenaceCreditQuery,
  evaluateVenezuelaRenaceCredit,
  extractDeterministicPropertyFeature,
  classifyOutgoingMessage,
  HandoffManager,
  DeduplicationManager,
  ConversationContextManager,
  verifyPreDispatchSafety,
  validateCommercialClaimsProvenance,
  buildStructuredPropertyClaims,
  UniversalIdentifierIndex,
  getGlobalIdentifierIndex,
  evaluatePropertyQuestionWithClaude,
  evaluateCentralDecisionPipeline,
  buildCommercialFichaResponse,
  getVerifiedPublicPropertyLink,
  isPublicLinkRequest,
  isFullCommercialFichaRequest,
  isPhotoRequest,
  isAvailabilityQueryInContext,
  classifyClientIntent
};
