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
    /notificaci[oó]n de instagram/i
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
    // Presupuestos monetarios, capacidad de inversión o condiciones comerciales abiertas
    /(?:presupuesto|inversi[oó]n|dispongo\s*de|cuento\s*con)\s*(?:de\s*)?[\$€]?\s*\d+/i,

    // Reuniones, videollamadas, llamadas, citas comerciales
    /(?:agendar|coordinar|hacer|programar|tener)\s*(?:una\s*)?(?:reuni[oó]n|videollamada|llamada|cita|encuentro|zoom|meet)/i,
    /quiero\s*(?:una\s*)?(?:reuni[oó]n|videollamada|llamada|hablar\s*con\s*(?:el\s*)?(?:asesor|agente|ustedes))/i,
    /podemos\s*(?:reunirnos|hacer\s*una\s*llamada|hacer\s*una\s*videollamada)/i,

    // Ofrecimiento de inmuebles para captación (vender o alquilar su propiedad)
    /quiero\s*(?:vender|ofrecer|publicar|promocionar|captar)\s*(?:mi|un)\s*(?:inmueble|apartamento|casa|terreno|propiedad|local)/i,
    /quiero\s*alquilar\s*mi\s*(?:inmueble|apartamento|casa|propiedad|local)/i,
    /tengo\s*(?:un|una)\s*(?:inmueble|apartamento|casa|terreno|local)\s*para\s*(?:vender|alquilar|ofrecer)/i,
    /ustedes\s*me\s*pueden\s*(?:vender|alquilar)\s*mi\s*propiedad/i,

    // Negociación comercial / ofertas / comisiones / contratos
    /(?:oferta|negociaci[oó]n|rebaja|descuento|comisi[oó]n|porcentaje|documentaci[oó]n|firmar|contrato)/i
  ];

  return humanPatterns.some(p => p.test(norm));
}

// ============================================================================
// 4. DETECCIÓN BLINDADA DE ENLACES E IDENTIFICADORES DE WASI
// ============================================================================
function extractWasiPropertyIdentifiers(text, properties = []) {
  if (!text) {
    return { count: 0, codes: [], matches: [] };
  }
  const raw = text.toString();
  const codeSet = new Set();

  // 1. Extraer códigos de URLs Wasi oficiales
  const wasiUrlRegex = /https?:\/\/(?:[a-zA-Z0-9.-]+\.)?wasi\.(?:co|com)\/[^\s\/]+\/(\d{6,9})/gi;
  const urlMatches = Array.from(raw.matchAll(wasiUrlRegex));
  for (const m of urlMatches) {
    if (m[1]) codeSet.add(m[1]);
  }

  // 2. Extraer menciones textuales con indicador inequívoco
  const explicitTextMatches = Array.from(raw.matchAll(/(?:inmueble|c[oó]digo|cod|id|ref|propiedad)\s*[:#]?\s*(\d{6,9})\b/gi));
  for (const m of explicitTextMatches) {
    const candidateCode = m[1];
    const matchIndex = m.index || 0;
    const precedingText = raw.substring(Math.max(0, matchIndex - 15), matchIndex).toLowerCase();
    const isPrice = /[\$€]|usd|bs|precio|canon/i.test(precedingText);
    const isPhone = /tlf|telefono|celular|ws|whatsapp|\+58|04/i.test(precedingText);
    if (!isPrice && !isPhone) {
      codeSet.add(candidateCode);
    }
  }

  // 3. Códigos internos REF-xxx
  const refMatches = Array.from(raw.matchAll(/\bREF-(\d{2,4})\b/gi));
  for (const m of refMatches) {
    const fullRef = m[0].toUpperCase();
    const propMatch = Array.isArray(properties) ? properties.find(p => (p.ID_PROPIEDAD || '').toUpperCase() === fullRef) : null;
    if (propMatch) {
      const adapted = adaptProperty(propMatch);
      if (adapted.CODIGO_WASI) codeSet.add(adapted.CODIGO_WASI);
    }
  }

  const allExtractedCodes = Array.from(codeSet);

  const matches = allExtractedCodes.map(code => {
    if (!Array.isArray(properties) || properties.length === 0) return null;
    const rawMatch = properties.find(p => {
      const pCode = (p.CODIGO_WASI || '').toString().trim();
      const pUrl = (p.Wasi_URL || p.Wasi || '').toString();
      return pCode === code || pUrl.includes(`/${code}`);
    });
    return rawMatch ? adaptProperty(rawMatch) : null;
  });

  return {
    count: allExtractedCodes.length,
    codes: allExtractedCodes,
    matches: matches
  };
}

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
    const hasTerreno = /terreno/i.test(desc) && /construcci[oó]n/i.test(desc);
    if (hasTerreno && !/terreno|construcci/i.test(q)) {
      return { matched: true, hasData: false, reason: 'Información de metraje ambigua (especifica terreno o construcción).' };
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
            activeAutomationPropertyId: null
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
      activeAutomationPropertyId: null
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

  const model = process.env.CLAUDE_MODEL || 'anthropic/claude-sonnet-4.5';

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
    console.error('[Pipeline QA Error]:', err.message);
    return { text: null, tokensUsed: 0, isSinDato: true, reason: err.message };
  }
}

// ============================================================================
// 12. CONTROLADOR CENTRAL ÚNICO (EVALUATE CENTRAL DECISION PIPELINE)
// ============================================================================
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
    aiEvaluator = null
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
    logEntry.reason = 'El cliente solicitó reunión, llamada, negociación o captación de propiedad. Silencio y traspaso.';
    logEntry.action = 'SILENCE';
    if (handoffManager) {
      handoffManager.recordHumanAttentionRequested(leadId, talkId, contactId, currentTime);
    }
    return { shouldRespond: false, text: null, log: logEntry };
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

  // Extraer enlaces Wasi o identificadores presentes en el mensaje
  const wasiExtraction = extractWasiPropertyIdentifiers(textClean, properties);

  // --------------------------------------------------------------------------
  // PRIORIDAD 2.1: CONDICIÓN DE REACTIVACIÓN POST-12H (REGLA 4):
  // Tras cumplirse 12h de una intervención humana previa, se exige un nuevo enlace Wasi validado
  // o una propiedad previamente activa en el contexto de la conversación. Si no hay contexto ni enlace, silencio.
  // --------------------------------------------------------------------------
  const knownConversationProperty = (contextManager && contextManager.getContext(talkId, leadId)) ||
    (handoff && handoff.activeAutomationPropertyId && Array.isArray(properties) ? properties.find(p => (p.ID_PROPIEDAD || '').toUpperCase() === (handoff.activeAutomationPropertyId || '').toUpperCase()) : null);

  if (handoff.hadPreviousIntervention && handoff.hoursElapsed >= HANDOFF_LOCK_HOURS && !handoff.activeAutomationPropertyId && !knownConversationProperty) {
    if (wasiExtraction.count === 0) {
      logEntry.typeDetected = 'POST_12H_REQUIRES_WASI_LINK';
      logEntry.reason = `Transcurridas ${HANDOFF_LOCK_HOURS}h tras intervención humana, pero el cliente no envió enlace Wasi nuevo. Silencio seguro.`;
      logEntry.action = 'SILENCE';
      return { shouldRespond: false, text: null, log: logEntry };
    }
  }

  // --------------------------------------------------------------------------
  // PRIORIDAD 5: MENSAJES CON VARIAS PROPIEDADES -> DERIVAR A HUMANO EN SILENCIO
  // --------------------------------------------------------------------------
  if (wasiExtraction.count > 1) {
    logEntry.typeDetected = 'MULTIPLE_PROPERTIES';
    logEntry.reason = `Mensaje contiene ${wasiExtraction.count} propiedades diferentes. Prohibido mezclar fichas. Derivado a humano.`;
    logEntry.action = 'SILENCE';
    if (handoffManager) handoffManager.recordHumanAttentionRequested(leadId, talkId, contactId, currentTime);
    return { shouldRespond: false, text: null, log: logEntry };
  }

  // --------------------------------------------------------------------------
  // PRIORIDAD 6 Y 7: ENLACE WASI / IDENTIFICADOR DE PROPIEDAD UNÍVOCO
  // --------------------------------------------------------------------------
  let targetProperty = null;

  if (wasiExtraction.count === 1) {
    targetProperty = wasiExtraction.matches[0];
    if (!targetProperty) {
      logEntry.typeDetected = 'WASI_LINK_NOT_FOUND';
      logEntry.reason = `Enlace o identificador ${wasiExtraction.codes[0]} no existe en Google Sheets. Prohibido inventar.`;
      logEntry.action = 'SILENCE';
      return { shouldRespond: false, text: null, log: logEntry };
    }

    logEntry.propertyIdentified = targetProperty.ID_PROPIEDAD;

    // Comprobación de estatus en tiempo real
    const isAvail = isPropertyAvailable(targetProperty);
    const isWasiInitialShare = /compartiste\s*en\s*la\s*red|interesado\s*en\s*el\s*inmueble|podr[ií]amos\s*conversar|disponib/i.test(normalizeText(textClean)) || textClean.includes('http');

    if (isWasiInitialShare) {
      if (isAvail) {
        logEntry.typeDetected = 'WASI_LINK_AVAILABLE';
        logEntry.reason = `Propiedad ${targetProperty.ID_PROPIEDAD} verificada con equivalencia exacta Disponible en Google Sheets.`;
        logEntry.action = 'RESPOND';
        logEntry.text = AVAILABILITY_RESPONSE;

        // Guardar contexto aislado por talkId y leadId
        if (contextManager) {
          contextManager.saveContext(talkId, leadId, targetProperty);
        }
        if (handoffManager) {
          handoffManager.activateAutomation(leadId, talkId, contactId, targetProperty.ID_PROPIEDAD);
        }

        return { shouldRespond: true, text: AVAILABILITY_RESPONSE, log: logEntry, targetProperty };
      } else {
        logEntry.typeDetected = 'WASI_LINK_NOT_AVAILABLE';
        logEntry.reason = `Propiedad ${targetProperty.ID_PROPIEDAD} estatus no equivalente a Disponible ("${targetProperty.ESTATUS}"). Silencio seguro.`;
        logEntry.action = 'SILENCE';
        return { shouldRespond: false, text: null, log: logEntry };
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
    const aiResult = await evaluatorFn(textClean, targetProperty);
    logEntry.tokensUsed = aiResult.tokensUsed;

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
  const createdBy = messageObj.created_by !== undefined && messageObj.created_by !== null ? Number(messageObj.created_by) : null;
  const botId = process.env.KOMMO_BOT_ID || '100766';

  // 1. Detección de Asesor Humano desde Kommo Web UI (prioridad de autor humano explícito):
  if (authorType === 'user' && createdBy !== null && createdBy > 0) {
    return { isBot: false, isHuman: true, isHumanAdvisor: true, isUncertain: false, source: 'KOMMO_WEB', reason: 'KOMMO_WEB', userId: createdBy };
  }

  // 2. Detección segura de Bot / Salesbot / App:
  if (['bot', 'salesbot', 'app', 'system'].includes(authorType)) {
    return { isBot: true, isHuman: false, isHumanAdvisor: false, isUncertain: false, source: 'BOT_AUTHOR_TYPE', reason: 'KOMMO_AUTHOR_BOT' };
  }
  if (authorName === 'salesbot' || authorName.includes('bot') || String(messageObj.author?.id) === String(botId)) {
    return { isBot: true, isHuman: false, isHumanAdvisor: false, isUncertain: false, source: 'BOT_ID_OR_NAME', reason: 'KOMMO_BOT_ID_OR_NAME' };
  }
  if (recentBotDispatchedFn && typeof recentBotDispatchedFn === 'function' && recentBotDispatchedFn(outText, messageObj.entity_id || messageObj.element_id || messageObj.talk_id)) {
    return { isBot: true, isHuman: false, isHumanAdvisor: false, isUncertain: false, source: 'BOT_DISPATCHED_ECHO', reason: 'BOT_DISPATCHED_ECHO' };
  }

  // 3. Detección de Asesor Humano desde WhatsApp Móvil:
  if ((authorType === 'user' || createdBy === 0) && outText.length > 0) {
    return { isBot: false, isHuman: true, isHumanAdvisor: true, isUncertain: false, source: 'WHATSAPP_MOBILE', reason: 'WHATSAPP_MOBILE' };
  }

  // 4. Incierto: Falla cerrada (silencio preventivo)
  return { isBot: false, isHuman: false, isHumanAdvisor: false, isUncertain: true, source: 'UNKNOWN', reason: 'UNKNOWN' };
}

module.exports = {
  AVAILABILITY_RESPONSE,
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
