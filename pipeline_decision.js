/**
 * ============================================================================
 * PIPELINE DE DECISIÓN CENTRALIZADO — BOT INMOBILIARIO TU TECHO IDEAL
 * ============================================================================
 * 
 * Regla Fundamental:
 * Google Sheets es la ÚNICA fuente autorizada de información inmobiliaria.
 * Prohibido inventar datos, deducir ausencias como negativas o asumir características.
 * 
 * Arquitectura:
 * Punto único de entrada determinístico antes de cualquier llamada a IA.
 * Si no se cumplen los requisitos estrictos, el resultado es SILENCIO ABSOLUTO (skip: true).
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Normalización de texto para búsquedas robustas
function normalizeText(text) {
  if (!text) return '';
  return text
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
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

  // Palabras comunes de saludo plano
  const pureGreetingRegex = /^(?:hola|holaa+|buen\s*d[ií]a|buenos\s*d[ií]as|buenas\s*tardes|buenas\s*noches|buenas|saludos|que\s*tal|c[oó]mo\s*est[aá]s?|feliz\s*d[ií]a)[\s.!,?]*$/i;
  
  if (pureGreetingRegex.test(norm)) return true;

  // Si tiene menos de 4 palabras y solo contiene saludos
  const words = norm.split(/\s+/).filter(Boolean);
  if (words.length <= 4) {
    const greetingWords = new Set(['hola', 'buen', 'dia', 'buenos', 'dias', 'buenas', 'tardes', 'noches', 'saludos', 'tal', 'como', 'estas', 'esta', 'feliz']);
    const isAllGreetings = words.every(w => greetingWords.has(w.replace(/[^a-z]/g, '')));
    if (isAllGreetings) return true;
  }

  return false;
}

// ============================================================================
// 3. DETECCIÓN DE SOLICITUDES QUE CORRESPONDEN AL HUMANO (REGLA 3.G)
// ============================================================================
function isHumanAttentionRequest(text) {
  if (!text) return false;
  const norm = normalizeText(text);

  const humanPatterns = [
    // Reuniones, videollamadas, citas comerciales
    /(?:agendar|coordinar|hacer|programar|tener)\s*(?:una\s*)?(?:reuni[oó]n|videollamada|llamada|cita|encuentro|zoom|meet)/i,
    /quiero\s*(?:una\s*)?(?:reuni[oó]n|videollamada|llamada|conversar|hablar\s*con\s*ustedes)/i,
    /podemos\s*(?:reunirnos|hacer\s*una\s*llamada|hacer\s*una\s*videollamada|conversar)/i,

    // Ofrecimiento de inmuebles para captación (vender o alquilar su propiedad)
    /quiero\s*(?:vender|ofrecer|publicar|promocionar|captar)\s*(?:mi|un)\s*(?:inmueble|apartamento|casa|terreno|propiedad|local)/i,
    /quiero\s*alquilar\s*mi\s*(?:inmueble|apartamento|casa|propiedad|local)/i,
    /tengo\s*(?:un|una)\s*(?:inmueble|apartamento|casa|terreno|local)\s*para\s*(?:vender|alquilar|ofrecer)/i,
    /ustedes\s*me\s*pueden\s*(?:vender|alquilar)\s*mi\s*propiedad/i,

    // Negociación comercial / ofertas / comisiones
    /(?:oferta|negociaci[oó]n|rebaja|descuento|comisi[oó]n|porcentaje|documentaci[oó]n|firmar|contrato)/i
  ];

  return humanPatterns.some(p => p.test(norm));
}

// ============================================================================
// 4. DETECCIÓN DE ENLACES O IDENTIFICADORES DE WASI (REGLA 3.D & REGLA 5)
// ============================================================================
function extractWasiPropertyIdentifiers(text, properties = []) {
  if (!text) return { count: 0, codes: [], matches: [] };
  const raw = text.toString();

  const codeSet = new Set();

  // 1. Extraer códigos de URLs Wasi (ej: https://info.wasi.co/.../10493109)
  const urlMatches = raw.matchAll(/(?:wasi\.co\/[^\s\/]+\/|wasi\.com\/[^\s\/]+\/)(\d{6,9})/gi);
  for (const m of urlMatches) {
    if (m[1]) codeSet.add(m[1]);
  }

  // 2. Extraer menciones textuales con "inmueble 10493109", "código 10493109", "ref 10493109"
  const textCodeMatches = raw.matchAll(/(?:inmueble|c[oó]digo|cod|id|ref|propiedad)?[:\s#]*(\d{7,9})\b/gi);
  for (const m of textCodeMatches) {
    const num = m[1];
    // Verificar si este número existe como CODIGO_WASI o en la URL de Wasi de alguna propiedad en Sheets
    const existsInSheets = properties.some(p => {
      const pCode = (p.CODIGO_WASI || '').toString().trim();
      const pUrl = (p.Wasi_URL || p.Wasi || '').toString();
      return pCode === num || pUrl.includes(num);
    });
    if (existsInSheets) {
      codeSet.add(num);
    }
  }

  // 3. Extraer referencias internas REF-xxx si vinieran en el texto
  const refMatches = raw.matchAll(/\bREF-(\d{2,4})\b/gi);
  for (const m of refMatches) {
    const fullRef = m[0].toUpperCase();
    const propMatch = properties.find(p => (p.ID_PROPIEDAD || '').toUpperCase() === fullRef);
    if (propMatch && propMatch.CODIGO_WASI) {
      codeSet.add(propMatch.CODIGO_WASI);
    }
  }

  const codes = Array.from(codeSet);
  const matchedProps = codes.map(code => {
    return properties.find(p => {
      const pCode = (p.CODIGO_WASI || '').toString().trim();
      const pUrl = (p.Wasi_URL || p.Wasi || '').toString();
      return pCode === code || pUrl.includes(code);
    }) || null;
  }).filter(Boolean);

  return {
    count: codes.length,
    codes,
    matches: matchedProps
  };
}

// ============================================================================
// 5. BÚSQUEDA INTERNA POR ZONA O CARACTERÍSTICAS (REGLA 3.C)
// ============================================================================
function searchZoneOrFeatureMatches(queryText, properties = []) {
  if (!queryText) return { hasAvailableMatches: false, count: 0, candidates: [] };
  const q = normalizeText(queryText);

  // Descartar si el texto no tiene intención de búsqueda de inmueble
  const isSearchIntent = /(?:busco|buscando|quiero|necesito|interesad[oa]|informaci[oó]n\s*sobre|tienen?|alquiler|venta|comprar|alquilar|apartamento|casa|anexo|terreno|local)\b/i.test(q);
  if (!isSearchIntent) return { hasAvailableMatches: false, count: 0, candidates: [] };

  // Palabras significativas ignorando stopwords comunes
  const stopWords = new Set([
    'hola', 'buenas', 'tardes', 'dias', 'noches', 'quiero', 'informacion', 'sobre', 'inmuebles',
    'inmueble', 'estoy', 'buscando', 'busco', 'para', 'comprar', 'alquilar', 'alquiler', 'venta',
    'en', 'de', 'un', 'una', 'por', 'favor', 'gracias', 'caracas', 'zona'
  ]);

  const tokens = q.split(/[\s,.;:!?]+/).filter(w => w.length >= 3 && !stopWords.has(w));
  if (tokens.length === 0) return { hasAvailableMatches: false, count: 0, candidates: [] };

  // Buscar propiedades disponibles que coincidan en ZONA, TIPO, OPERACION o DESCRIPCION_BREVE
  const matches = [];

  for (const prop of properties) {
    const estatus = normalizeText(prop.ESTATUS || '');
    const isAvailable = estatus.includes('disponible') && !estatus.includes('no');
    if (!isAvailable) continue;

    const zona = normalizeText(prop.ZONA || '');
    const tipo = normalizeText(prop.TIPO || '');
    const operacion = normalizeText(prop.OPERACION || '');
    const desc = normalizeText(prop.DESCRIPCION_BREVE || '');

    const fullSearchable = `${zona} ${tipo} ${operacion} ${desc}`;

    // Ver si coincide con alguno de los tokens clave (ej: "prados", "este", "boyera", "marques")
    const matchScore = tokens.reduce((score, token) => {
      return score + (fullSearchable.includes(token) ? 1 : 0);
    }, 0);

    if (matchScore > 0) {
      matches.push({ prop, score: matchScore });
    }
  }

  // Ordenar por relevancia y limitar internamente a 3
  matches.sort((a, b) => b.score - a.score);
  const candidates = matches.slice(0, 3).map(m => m.prop);

  return {
    hasAvailableMatches: candidates.length > 0,
    count: candidates.length,
    candidates
  };
}

// ============================================================================
// 6. EXCEPCIÓN ESPECIAL: CRÉDITO VENEZUELA RENACE (REGLA 3.F)
// ============================================================================
function isVenezuelaRenaceCreditQuery(queryText) {
  if (!queryText) return false;
  const q = normalizeText(queryText);

  return (
    /(?:cr[eé]dito|financiam(?:iento)?|banco).*(?:venezuela\s*renace|renace)/i.test(q) ||
    /(?:venezuela\s*renace|renace).*(?:cr[eé]dito|financiam(?:iento)?)/i.test(q) ||
    /(?:acepta|aceptan|reciben|toman)\s*(?:cr[eé]dito|financiamiento)/i.test(q) ||
    /se\s*puede\s*comprar\s*con\s*(?:cr[eé]dito|financiamiento|venezuela\s*renace)/i.test(q) ||
    /aplica\s*(?:para\s*)?(?:el\s*)?(?:cr[eé]dito|financiamiento|renace)/i.test(q)
  );
}

function evaluateVenezuelaRenaceCredit(property) {
  if (!property) {
    return { hasData: false, response: 'Voy a consultar y ya le informo.' };
  }

  const desc = normalizeText(property.DESCRIPCION_BREVE || '');
  const formasPago = normalizeText(property.Formas_de_pago || property['Formas de pago'] || '');
  const combined = `${desc} ${formasPago}`;

  // 1. Verificación explícita de aceptación de crédito / Venezuela Renace
  const positivePatterns = [
    /(?:acepta|aceptan|aplica|recibe|toma)\s*(?:cr[eé]dito|financiamiento|venezuela\s*renace)/i,
    /formas\s*de\s*pago\s*que\s*incluyen\s*cr[eé]dito/i,
    /aceptan\s*diversas\s*formas\s*de\s*pago\s*que\s*incluyen\s*cr[eé]dito/i,
    /opciones\s*de\s*financiamiento/i
  ];

  // 2. Verificación explícita de rechazo / NO acepta crédito
  const negativePatterns = [
    /no\s*(?:posee|tiene|acepta|recibe|admite)\s*(?:cr[eé]dito|financiamiento)/i,
    /financiamiento:\s*no\s*posee/i,
    /no\s*se\s*acepta\s*(?:cr[eé]dito|financiamiento)/i,
    /solo\s*(?:contado|efectivo|transferencia)/i
  ];

  for (const neg of negativePatterns) {
    if (neg.test(combined)) {
      return { hasData: true, response: 'No' };
    }
  }

  for (const pos of positivePatterns) {
    if (pos.test(combined)) {
      return { hasData: true, response: 'Sí' };
    }
  }

  // 3. Si no existe información o dice "No especificado en la fuente"
  return { hasData: false, response: 'Voy a consultar y ya le informo.' };
}

// ============================================================================
// 7. GESTOR DE INTERVENCIÓN HUMANA Y BLOQUEO DE 24 HORAS (REGLA 4)
// ============================================================================
class HandoffManager {
  constructor(filePath = null) {
    this.filePath = filePath || path.join(__dirname, 'handoffs.json');
    this.handoffs = { leads: {}, talks: {}, contacts: {} };
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

  recordHumanIntervention(leadId = null, talkId = null, contactId = null, timestamp = Date.now()) {
    const entry = { timestamp };
    if (leadId) this.handoffs.leads[String(leadId)] = entry;
    if (talkId) this.handoffs.talks[String(talkId)] = entry;
    if (contactId) this.handoffs.contacts[String(contactId)] = entry;
    this.save();
  }

  /**
   * Comprueba si una conversación está bloqueada por intervención humana.
   * Retorna { isLocked: boolean, hoursElapsed: number, lastIntervention: number | null }
   */
  checkLockStatus(leadId = null, talkId = null, contactId = null, now = Date.now()) {
    const entries = [
      leadId && this.handoffs.leads ? this.handoffs.leads[String(leadId)] : null,
      talkId && this.handoffs.talks ? this.handoffs.talks[String(talkId)] : null,
      contactId && this.handoffs.contacts ? this.handoffs.contacts[String(contactId)] : null
    ].filter(Boolean);

    if (entries.length === 0) {
      return { isLocked: false, hoursElapsed: 999, lastIntervention: null };
    }

    // Tomar la intervención humana más reciente registrada
    const latestTimestamp = Math.max(...entries.map(e => e.timestamp || 0));
    const hoursElapsed = (now - latestTimestamp) / (1000 * 60 * 60);

    if (hoursElapsed < 24) {
      return { isLocked: true, hoursElapsed, lastIntervention: latestTimestamp };
    }

    return { isLocked: false, hoursElapsed, lastIntervention: latestTimestamp };
  }
}

// ============================================================================
// 8. CONSULTA PRECISA DE ATRIBUTOS CON CLAUDE SONNET 4.5 (REGLA 3.E & 6)
// ============================================================================
async function evaluatePropertyQuestionWithClaude(userQuestion, property) {
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    console.warn('[Pipeline QA] No API key for Claude. Falling back to SIN_DATO');
    return { text: null, tokensUsed: 0, isSinDato: true };
  }

  const model = process.env.CLAUDE_MODEL || 'anthropic/claude-sonnet-4.5';

  const systemPrompt = `Eres el asistente de interpretación de datos de "Tu Techo Ideal".
Tu única función es responder la pregunta del cliente usando EXCLUSIVAMENTE los datos proporcionados de la propiedad.

DATOS OFICIALES DE LA PROPIEDAD:
- Identificador: ${property.ID_PROPIEDAD || 'N/A'}
- Tipo: ${property.TIPO || 'N/A'}
- Operación: ${property.OPERACION || 'N/A'}
- Estatus: ${property.ESTATUS || 'N/A'}
- Mascotas permitidas: ${property.Mascotas || 'No especificado'}
- Tipo de Mascotas: ${property['Tipo de Mascotas'] || 'No especificado'}
- DESCRIPCION_BREVE (Fuente fundamental autorizada):
"""
${property.DESCRIPCION_BREVE || 'N/A'}
"""

REGLAS ABSOLUTAS:
1. Puedes interpretar sinónimos ("mts", "m2", "metros", "habitaciones", "cuartos", "baños", "puestos", "estacionamiento", "tanque", "gas").
2. Si el dato solicitado está EXPRESADO o AFIRMADO en los datos proporcionados:
   - Responde con el dato exacto de forma directa y concisa (ej: "Tiene 120 m²", "Tiene 3 habitaciones", "Cuenta con tanque interno de 600L").
3. Si la pregunta consulta sobre una característica que la descripción aclara explícitamente que NO posee (ej: "no posee estacionamiento", "no posee gas directo"):
   - Responde la negativa documentada (ej: "No posee estacionamiento", "No posee gas directo").
4. Si el dato NO APARECE, está ambiguo, o dice "No especificado en la fuente":
   - DEBES RESPONDER ÚNICA Y EXCLUSIVAMENTE LA PALABRA: SIN_DATO
   - Prohibido inventar, deducir, pedir disculpas o responder "no tengo esa información". Si no está: SIN_DATO.`;

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
        max_tokens: 150
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://tu-techo-ideal-bot-1.onrender.com',
          'X-Title': 'Tu Techo Ideal Pipeline Decision',
          'Content-Type': 'application/json'
        },
        timeout: 12000
      }
    );

    const answer = response.data?.choices?.[0]?.message?.content?.trim() || '';
    const tokensUsed = response.data?.usage?.total_tokens || 0;

    if (!answer || answer.includes('SIN_DATO') || answer.includes('[SILENCIO]')) {
      return { text: null, tokensUsed, isSinDato: true };
    }

    return { text: answer, tokensUsed, isSinDato: false };
  } catch (err) {
    console.error('[Pipeline QA Error]:', err.message);
    return { text: null, tokensUsed: 0, isSinDato: true };
  }
}

// ============================================================================
// 9. PUNTO CENTRAL DE DECISIÓN ÚNICO (REGLA 8 — PRIORIDADES 1 AL 12)
// ============================================================================
async function evaluateCentralDecisionPipeline(context) {
  const {
    userText = '',
    leadId = null,
    talkId = null,
    contactId = null,
    properties = [],
    handoffManager = null,
    activePropertyContext = null,
    currentTime = Date.now()
  } = context;

  const logEntry = {
    leadId,
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
  // PRIORIDAD 1: EVENTO NO CONVERSACIONAL O MENCIÓN DE HISTORIA/REEL -> IGNORAR
  // --------------------------------------------------------------------------
  if (isSocialMediaEventOrMention(textClean)) {
    logEntry.typeDetected = 'SOCIAL_MEDIA_MENTION';
    logEntry.reason = 'Mención o notificación de redes sociales sin consulta inmobiliaria.';
    logEntry.action = 'SILENCE';
    return { shouldRespond: false, text: null, log: logEntry };
  }

  // --------------------------------------------------------------------------
  // PRIORIDAD 2: CONVERSACIÓN BLOQUEADA POR INTERVENCIÓN HUMANA (24 HORAS)
  // --------------------------------------------------------------------------
  const handoff = handoffManager ? handoffManager.checkLockStatus(leadId, talkId, contactId, currentTime) : { isLocked: false, hoursElapsed: 999 };

  if (handoff.isLocked) {
    logEntry.typeDetected = 'HUMAN_LOCKED';
    logEntry.reason = `Conversación en bloqueo humano (${handoff.hoursElapsed.toFixed(1)}h transcurridas de 24h requeridas).`;
    logEntry.action = 'SILENCE';
    return { shouldRespond: false, text: null, log: logEntry };
  }

  // --------------------------------------------------------------------------
  // PRIORIDAD 3: SOLICITUD QUE CORRESPONDE AL HUMANO (REUNIÓN, VENTA, CAPTACIÓN)
  // --------------------------------------------------------------------------
  if (isHumanAttentionRequest(textClean)) {
    logEntry.typeDetected = 'HUMAN_ATTENTION_REQUEST';
    logEntry.reason = 'El cliente solicitó reunión, llamada, negociación o captación/ofrecimiento de propiedad.';
    logEntry.action = 'SILENCE';
    // Registrar handoff para que el asesor atienda
    if (handoffManager) handoffManager.recordHumanIntervention(leadId, talkId, contactId, currentTime);
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

  // --------------------------------------------------------------------------
  // PRIORIDAD 5: DETECCIÓN DE ENLACES O IDENTIFICADORES DE PROPIEDADES
  // --------------------------------------------------------------------------
  const wasiExtraction = extractWasiPropertyIdentifiers(textClean, properties);

  // REGLA 5: MENSAJES CON VARIAS PROPIEDADES -> DERIVAR A HUMANO EN SILENCIO
  if (wasiExtraction.count > 1) {
    logEntry.typeDetected = 'MULTIPLE_PROPERTIES';
    logEntry.reason = `Mensaje contiene ${wasiExtraction.count} propiedades diferentes. Prohibido mezclar fichas. Derivado a humano.`;
    logEntry.action = 'SILENCE';
    if (handoffManager) handoffManager.recordHumanIntervention(leadId, talkId, contactId, currentTime);
    return { shouldRespond: false, text: null, log: logEntry };
  }

  // --------------------------------------------------------------------------
  // PRIORIDAD 4: CONSULTA POR ZONA O CARACTERÍSTICAS GENERALES
  // (Solo si no envió un identificador específico de propiedad)
  // --------------------------------------------------------------------------
  if (wasiExtraction.count === 0 && !activePropertyContext) {
    const zoneSearch = searchZoneOrFeatureMatches(textClean, properties);
    if (zoneSearch.hasAvailableMatches) {
      logEntry.typeDetected = 'ZONE_OR_FEATURE_SEARCH';
      logEntry.reason = `Coincidencias encontradas (${zoneSearch.count} disponibles). Respondiendo exactamente "Sí, disponible." sin listados.`;
      logEntry.action = 'RESPOND';
      logEntry.text = 'Sí, disponible.';
      // Ceder el control al humano inmediatamente después de la respuesta
      if (handoffManager) handoffManager.recordHumanIntervention(leadId, talkId, contactId, currentTime);
      return { shouldRespond: true, text: 'Sí, disponible.', log: logEntry };
    }
  }

  // --------------------------------------------------------------------------
  // PRIORIDAD 6 Y 7: ENLACE WASI / IDENTIFICADOR DE PROPIEDAD UNÍVOCO
  // --------------------------------------------------------------------------
  let targetProperty = null;

  if (wasiExtraction.count === 1) {
    targetProperty = wasiExtraction.matches[0];
    if (!targetProperty) {
      // El cliente envió un código/enlace que NO existe en Google Sheets
      logEntry.typeDetected = 'WASI_LINK_NOT_FOUND';
      logEntry.reason = `Enlace o identificador ${wasiExtraction.codes[0]} no existe en Google Sheets. Prohibido inventar.`;
      logEntry.action = 'SILENCE';
      return { shouldRespond: false, text: null, log: logEntry };
    }

    logEntry.propertyIdentified = targetProperty.ID_PROPIEDAD;

    // Verificar estatus en Google Sheets
    const estatus = normalizeText(targetProperty.ESTATUS || '');
    const isAvailable = estatus.includes('disponible') && !estatus.includes('no');

    // Si el mensaje es el enlace o solicitud de disponibilidad inicial del inmueble:
    // (o el mensaje contiene el enlace junto con el texto de Wasi compartido)
    const isWasiInitialShare = /compartiste\s*en\s*la\s*red|interesado\s*en\s*el\s*inmueble|podr[ií]amos\s*conversar|disponib/i.test(normalizeText(textClean)) || textClean.includes('http');
    
    if (isWasiInitialShare) {
      if (isAvailable) {
        logEntry.typeDetected = 'WASI_LINK_AVAILABLE';
        logEntry.reason = `Propiedad ${targetProperty.ID_PROPIEDAD} verificada como Disponible en Google Sheets.`;
        logEntry.action = 'RESPOND';
        logEntry.text = 'Sí, disponible.';
        return { shouldRespond: true, text: 'Sí, disponible.', log: logEntry, targetProperty };
      } else {
        logEntry.typeDetected = 'WASI_LINK_NOT_AVAILABLE';
        logEntry.reason = `Propiedad ${targetProperty.ID_PROPIEDAD} no está disponible (${targetProperty.ESTATUS}). Dejar al humano.`;
        logEntry.action = 'SILENCE';
        return { shouldRespond: false, text: null, log: logEntry };
      }
    }
  }

  // --------------------------------------------------------------------------
  // PRIORIDAD 8, 9 Y 10: PREGUNTAS ESPECÍFICAS DE UNA PROPIEDAD IDENTIFICADA (REGLA 3.E)
  // --------------------------------------------------------------------------
  // Si no vino enlace nuevo pero hay una propiedad activa en el contexto del lead:
  if (!targetProperty && activePropertyContext) {
    targetProperty = activePropertyContext;
    logEntry.propertyIdentified = targetProperty.ID_PROPIEDAD;
  }

  if (targetProperty) {
    // A. EXCEPCIÓN ESPECIAL: CRÉDITO VENEZUELA RENACE (REGLA 3.F)
    if (isVenezuelaRenaceCreditQuery(textClean)) {
      logEntry.typeDetected = 'CREDIT_VENEZUELA_RENACE_QUERY';
      const creditEval = evaluateVenezuelaRenaceCredit(targetProperty);
      logEntry.reason = `Evaluación de crédito Venezuela Renace para ${targetProperty.ID_PROPIEDAD}: resultado "${creditEval.response}".`;
      logEntry.action = 'RESPOND';
      logEntry.text = creditEval.response;
      return { shouldRespond: true, text: creditEval.response, log: logEntry, targetProperty };
    }

    // B. OTRAS PREGUNTAS SOBRE LA PROPIEDAD (Metros, habitaciones, baños, estacionamiento, condominio, gas)
    logEntry.calledAI = true;
    const aiResult = await evaluatePropertyQuestionWithClaude(textClean, targetProperty);
    logEntry.tokensUsed = aiResult.tokensUsed;

    if (!aiResult.isSinDato && aiResult.text) {
      logEntry.typeDetected = 'PROPERTY_FEATURE_ANSWERED';
      logEntry.reason = `Dato encontrado y verificado en Google Sheets para ${targetProperty.ID_PROPIEDAD}.`;
      logEntry.action = 'RESPOND';
      logEntry.text = aiResult.text;
      return { shouldRespond: true, text: aiResult.text, log: logEntry, targetProperty };
    } else {
      logEntry.typeDetected = 'PROPERTY_FEATURE_SIN_DATO';
      logEntry.reason = `Dato no encontrado en Google Sheets para ${targetProperty.ID_PROPIEDAD}. Silencio absoluto por política de no invención.`;
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
  return { shouldRespond: false, text: null, log: logEntry };
}

module.exports = {
  normalizeText,
  isSocialMediaEventOrMention,
  isPureGreetingWithoutInquiry,
  isHumanAttentionRequest,
  extractWasiPropertyIdentifiers,
  searchZoneOrFeatureMatches,
  isVenezuelaRenaceCreditQuery,
  evaluateVenezuelaRenaceCredit,
  HandoffManager,
  evaluatePropertyQuestionWithClaude,
  evaluateCentralDecisionPipeline
};
