/**
 * ============================================================================
 * PIPELINE DE DECISIÓN CENTRALIZADO — BOT INMOBILIARIO TU TECHO IDEAL
 * ============================================================================
 * 
 * Regla Fundamental:
 * Google Sheets es la ÚNICA fuente autorizada de información inmobiliaria.
 * Prohibido inventar datos, deducir ausencias como negativas o asumir características.
 * 
 * Pilares de Blindaje Técnico:
 * 1. Equivalencia exacta de disponibilidad: normalizeText(ESTATUS) === 'disponible'.
 * 2. Bloqueo humano persistente: Falla cerrada (silencio seguro) ante fallas de Kommo API.
 * 3. Reactivación post-24h estricta: Solo con nuevo enlace Wasi válido y existente en Sheets.
 * 4. Extracción blindada de Wasi: Prohibido confundir con precios ($100.000) o teléfonos (0414...).
 * 5. Integridad de Google Sheets: Silencio seguro si la fuente está vacía o inaccesible.
 * 6. Deduplicación y orden de llegada: Ventana antirreintento y descarte de eventos obsoletos.
 * 7. Verificación previa al despacho (Pre-dispatch check): Aborta si hubo intervención humana en vuelo.
 * 8. Aislamiento por conversación (Talk ID): Previene mezcla de inmuebles entre chats del mismo contacto.
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Columnas oficiales autorizadas verificadas en Google Sheets
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
  'Tipo de Mascotas',    // Col M (12)
  'col_13'               // Col N (13)
]);

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
 * Verificación de disponibilidad estricta:
 * Exige equivalencia exacta con 'disponible' después de normalizar.
 * Cero coincidencias parciales ("no disponible", "disponible en 15 días" quedan descartadas).
 */
function isPropertyAvailable(property) {
  if (!property || typeof property !== 'object') return false;
  const rawStatus = property.ESTATUS || '';
  const normalizedStatus = normalizeText(rawStatus);
  return normalizedStatus === 'disponible';
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
// 3. DETECCIÓN DE SOLICITUDES QUE CORRESPONDEN AL HUMANO (REGLA 3.G)
// ============================================================================
function isHumanAttentionRequest(text) {
  if (!text) return false;
  const norm = normalizeText(text);

  const humanPatterns = [
    // Presupuestos monetarios, capacidad de inversión o condiciones comerciales abiertas
    /(?:presupuesto|inversi[oó]n|dispongo\s*de|cuento\s*con)\s*(?:de\s*)?[\$€]?\s*\d+/i,

    // Reuniones, videollamadas, llamadas, citas comerciales
    /(?:agendar|coordinar|hacer|programar|tener)\s*(?:una\s*)?(?:reuni[oó]n|videollamada|llamada|cita|encuentro|zoom|meet)/i,
    /quiero\s*(?:una\s*)?(?:reuni[oó]n|videollamada|llamada|conversar|hablar\s*con\s*ustedes)/i,
    /podemos\s*(?:reunirnos|hacer\s*una\s*llamada|hacer\s*una\s*videollamada|conversar)/i,

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
// 4. DETECCIÓN BLINDADA DE ENLACES E IDENTIFICADORES DE WASI (ANTI-PRECIOS Y TELÉFONOS)
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

  // 2. Extraer menciones textuales con indicador INEQUÍVOCO de inmueble
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
    if (propMatch && propMatch.CODIGO_WASI) {
      codeSet.add(propMatch.CODIGO_WASI);
    }
  }

  const allExtractedCodes = Array.from(codeSet);

  // Mapear cada código extraído con su propiedad en Google Sheets (si existe)
  const matches = allExtractedCodes.map(code => {
    if (!Array.isArray(properties) || properties.length === 0) return null;
    return properties.find(p => {
      const pCode = (p.CODIGO_WASI || '').toString().trim();
      const pUrl = (p.Wasi_URL || p.Wasi || '').toString();
      return pCode === code || pUrl.includes(`/${code}`);
    }) || null;
  });

  return {
    count: allExtractedCodes.length,
    codes: allExtractedCodes,
    matches: matches
  };
}

// ============================================================================
// 5. BÚSQUEDA INTERNA POR ZONA O CARACTERÍSTICAS (REGLA 3.C)
// ============================================================================
function searchZoneOrFeatureMatches(queryText, properties = []) {
  if (!queryText || !Array.isArray(properties) || properties.length === 0) {
    return { hasAvailableMatches: false, count: 0, candidates: [] };
  }
  const q = normalizeText(queryText);

  // Si el mensaje es una consulta de presupuesto o dinero, no se trata como búsqueda por zona
  if (/(?:presupuesto|inversi[oó]n|dispongo\s*de|cuento\s*con)\s*(?:de\s*)?[\$€]?\s*\d+/i.test(q)) {
    return { hasAvailableMatches: false, count: 0, candidates: [] };
  }

  const isSearchIntent = /(?:busco|buscando|quiero|necesito|interesad[oa]|informaci[oó]n\s*sobre|tienen?|alquiler|venta|comprar|alquilar|apartamento|casa|anexo|terreno|local)\b/i.test(q);
  if (!isSearchIntent) return { hasAvailableMatches: false, count: 0, candidates: [] };

  const stopWords = new Set([
    'hola', 'buenas', 'tardes', 'dias', 'noches', 'quiero', 'informacion', 'sobre', 'inmuebles',
    'inmueble', 'estoy', 'buscando', 'busco', 'para', 'comprar', 'alquilar', 'alquiler', 'venta',
    'en', 'de', 'un', 'una', 'por', 'favor', 'gracias', 'caracas', 'zona'
  ]);

  const tokens = q.split(/[\s,.;:!?]+/).filter(w => w.length >= 3 && !stopWords.has(w));
  if (tokens.length === 0) return { hasAvailableMatches: false, count: 0, candidates: [] };

  const matches = [];

  for (const prop of properties) {
    if (!isPropertyAvailable(prop)) continue;

    const zona = normalizeText(prop.ZONA || '');
    const tipo = normalizeText(prop.TIPO || '');
    const operacion = normalizeText(prop.OPERACION || '');
    const desc = normalizeText(prop.DESCRIPCION_BREVE || '');

    const fullSearchable = `${zona} ${tipo} ${operacion} ${desc}`;

    const matchScore = tokens.reduce((score, token) => {
      return score + (fullSearchable.includes(token) ? 1 : 0);
    }, 0);

    if (matchScore > 0) {
      matches.push({ prop, score: matchScore });
    }
  }

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

  const positivePatterns = [
    /(?:acepta|aceptan|aplica|recibe|toma)\s*(?:cr[eé]dito|financiamiento|venezuela\s*renace)/i,
    /formas\s*de\s*pago\s*que\s*incluyen\s*cr[eé]dito/i,
    /aceptan\s*diversas\s*formas\s*de\s*pago\s*que\s*incluyen\s*cr[eé]dito/i,
    /opciones\s*de\s*financiamiento/i
  ];

  const negativePatterns = [
    /no\s*(?:posee|tiene|acepta|recibe|admite)\s*(?:cr[eé]dito|financiamiento)/i,
    /financiamiento:\s*no\s*posee/i,
    /cr[eé]ditos?:\s*no\s*(?:acepta|posee|aplica)/i,
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

  return { hasData: false, response: 'Voy a consultar y ya le informo.' };
}

// ============================================================================
// 7. GESTOR DE INTERVENCIÓN HUMANA Y BLOQUEO DE 24 HORAS CON FAIL-SAFE
// ============================================================================
class HandoffManager {
  constructor(filePath = null, kommoFetcher = null) {
    this.filePath = filePath || path.join(__dirname, 'handoffs.json');
    this.kommoFetcher = kommoFetcher;
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

  async checkLockStatus(leadId = null, talkId = null, contactId = null, now = Date.now()) {
    const entries = [
      leadId && this.handoffs.leads ? this.handoffs.leads[String(leadId)] : null,
      talkId && this.handoffs.talks ? this.handoffs.talks[String(talkId)] : null,
      contactId && this.handoffs.contacts ? this.handoffs.contacts[String(contactId)] : null
    ].filter(Boolean);

    // Si tenemos registro local
    if (entries.length > 0) {
      const latestTimestamp = Math.max(...entries.map(e => e.timestamp || 0));
      const hoursElapsed = (now - latestTimestamp) / (1000 * 60 * 60);

      if (hoursElapsed < 24) {
        return { isLocked: true, hoursElapsed, lastIntervention: latestTimestamp, hadPreviousIntervention: true };
      }
      return { isLocked: false, hoursElapsed, lastIntervention: latestTimestamp, hadPreviousIntervention: true };
    }

    // Si NO hay registro local en disco (ej: tras reinicio/despliegue en Render) y tenemos kommoFetcher:
    if (this.kommoFetcher && typeof this.kommoFetcher === 'function') {
      try {
        const remoteResult = await this.kommoFetcher({ leadId, talkId, contactId });
        if (remoteResult && remoteResult.lastHumanTimestamp) {
          this.recordHumanIntervention(leadId, talkId, contactId, remoteResult.lastHumanTimestamp);
          const hoursElapsed = (now - remoteResult.lastHumanTimestamp) / (1000 * 60 * 60);
          if (hoursElapsed < 24) {
            return { isLocked: true, hoursElapsed, lastIntervention: remoteResult.lastHumanTimestamp, hadPreviousIntervention: true };
          }
          return { isLocked: false, hoursElapsed, lastIntervention: remoteResult.lastHumanTimestamp, hadPreviousIntervention: true };
        }
      } catch (err) {
        // Falla cerrada ante error temporal de Kommo API
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

    return { isLocked: false, hoursElapsed: 999, lastIntervention: null, hadPreviousIntervention: false };
  }
}

// ============================================================================
// 8. DEDUPLICACIÓN ROBUSTA Y ORDEN DE LLEGADA DE WEBHOOKS
// ============================================================================
class DeduplicationManager {
  constructor(windowMs = 15 * 60 * 1000) {
    this.windowMs = windowMs;
    this.processedMessages = new Map(); // key -> timestamp
    this.lastProcessedTimestampByTalk = new Map(); // talkId -> timestamp
  }

  /**
   * Verifica si un mensaje es duplicado o llega fuera de orden (obsoleto).
   * Retorna { isDuplicate: boolean, isOutOfOrder: boolean }
   */
  checkAndRecord(msgId, talkId, messageTimestamp = Date.now()) {
    const now = Date.now();

    // 1. Limpieza de memoria
    for (const [key, ts] of this.processedMessages.entries()) {
      if (now - ts > this.windowMs) this.processedMessages.delete(key);
    }

    // 2. Comprobar si ya fue procesado por ID único
    if (msgId && this.processedMessages.has(String(msgId))) {
      return { isDuplicate: true, isOutOfOrder: false };
    }

    // 3. Comprobar orden de llegada por Talk
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
// 9. AISLAMIENTO DE CONTEXTO POR CONVERSACIÓN (TALK ID)
// ============================================================================
class ConversationContextManager {
  constructor() {
    this.talkContexts = new Map(); // talkId -> property
    this.leadContexts = new Map(); // leadId -> property
  }

  saveContext(talkId, leadId, property) {
    if (!property) return;
    if (talkId) this.talkContexts.set(String(talkId), property);
    if (leadId) this.leadContexts.set(String(leadId), property);
  }

  getContext(talkId, leadId) {
    // Prioridad 1: Contexto de la conversación exacta (Talk ID)
    if (talkId && this.talkContexts.has(String(talkId))) {
      return this.talkContexts.get(String(talkId));
    }
    // Prioridad 2: Contexto general del Lead
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
// 11. CONSULTA PRECISA DE ATRIBUTOS CON CLAUDE SONNET 4.5 (REGLA 3.E & 6)
// ============================================================================
async function evaluatePropertyQuestionWithClaude(userQuestion, property) {
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) {
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
// 12. PUNTO CENTRAL DE DECISIÓN ÚNICO (REGLA 8 — PRIORIDADES 1 AL 12)
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
    logEntry.reason = 'Base de datos de Google Sheets no disponible o no verificable. Silencio seguro.';
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
  // PRIORIDAD 2: CONVERSACIÓN BLOQUEADA POR INTERVENCIÓN HUMANA (24 HORAS)
  // --------------------------------------------------------------------------
  const handoff = handoffManager
    ? await handoffManager.checkLockStatus(leadId, talkId, contactId, currentTime)
    : { isLocked: false, hoursElapsed: 999, hadPreviousIntervention: false };

  if (handoff.isLocked) {
    logEntry.typeDetected = 'HUMAN_LOCKED';
    logEntry.reason = handoff.isFailClosed
      ? handoff.reason
      : `Conversación en bloqueo humano (${handoff.hoursElapsed.toFixed(1)}h transcurridas de 24h requeridas).`;
    logEntry.action = 'SILENCE';
    return { shouldRespond: false, text: null, log: logEntry };
  }

  // --------------------------------------------------------------------------
  // PRIORIDAD 2.1: CONDICIÓN DE REACTIVACIÓN POST-24H (REGLA 4):
  // --------------------------------------------------------------------------
  const wasiExtraction = extractWasiPropertyIdentifiers(textClean, properties);

  if (handoff.hadPreviousIntervention && handoff.hoursElapsed >= 24) {
    if (wasiExtraction.count === 0) {
      logEntry.typeDetected = 'POST_24H_REQUIRES_WASI_LINK';
      logEntry.reason = 'Transcurridas 24h tras intervención humana, pero el cliente no envió enlace Wasi nuevo. Silencio seguro.';
      logEntry.action = 'SILENCE';
      return { shouldRespond: false, text: null, log: logEntry };
    }
  }

  // --------------------------------------------------------------------------
  // PRIORIDAD 3: SOLICITUD QUE CORRESPONDE AL HUMANO (REUNIÓN, VENTA, CAPTACIÓN, PRESUPUESTO)
  // --------------------------------------------------------------------------
  if (isHumanAttentionRequest(textClean)) {
    logEntry.typeDetected = 'HUMAN_ATTENTION_REQUEST';
    logEntry.reason = 'El cliente solicitó reunión, llamada, negociación o captación/ofrecimiento de propiedad.';
    logEntry.action = 'SILENCE';
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
  // PRIORIDAD 5: MENSAJES CON VARIAS PROPIEDADES -> DERIVAR A HUMANO EN SILENCIO
  // --------------------------------------------------------------------------
  if (wasiExtraction.count > 1) {
    logEntry.typeDetected = 'MULTIPLE_PROPERTIES';
    logEntry.reason = `Mensaje contiene ${wasiExtraction.count} propiedades diferentes. Prohibido mezclar fichas. Derivado a humano.`;
    logEntry.action = 'SILENCE';
    if (handoffManager) handoffManager.recordHumanIntervention(leadId, talkId, contactId, currentTime);
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

    // Validación de estatus con equivalencia exacta con 'disponible'
    const isAvail = isPropertyAvailable(targetProperty);

    const isWasiInitialShare = /compartiste\s*en\s*la\s*red|interesado\s*en\s*el\s*inmueble|podr[ií]amos\s*conversar|disponib/i.test(normalizeText(textClean)) || textClean.includes('http');

    if (isWasiInitialShare) {
      if (isAvail) {
        logEntry.typeDetected = 'WASI_LINK_AVAILABLE';
        logEntry.reason = `Propiedad ${targetProperty.ID_PROPIEDAD} verificada con equivalencia exacta Disponible en Google Sheets.`;
        logEntry.action = 'RESPOND';
        logEntry.text = 'Sí, disponible.';
        return { shouldRespond: true, text: 'Sí, disponible.', log: logEntry, targetProperty };
      } else {
        logEntry.typeDetected = 'WASI_LINK_NOT_AVAILABLE';
        logEntry.reason = `Propiedad ${targetProperty.ID_PROPIEDAD} estatus no equivalente a Disponible ("${targetProperty.ESTATUS}"). Silencio seguro.`;
        logEntry.action = 'SILENCE';
        return { shouldRespond: false, text: null, log: logEntry };
      }
    }
  }

  // --------------------------------------------------------------------------
  // PRIORIDAD 4: CONSULTA POR ZONA O CARACTERÍSTICAS GENERALES
  // --------------------------------------------------------------------------
  if (wasiExtraction.count === 0 && !activePropertyContext) {
    const zoneSearch = searchZoneOrFeatureMatches(textClean, properties);
    if (zoneSearch.hasAvailableMatches) {
      logEntry.typeDetected = 'ZONE_OR_FEATURE_SEARCH';
      logEntry.reason = `Coincidencias encontradas (${zoneSearch.count} disponibles). Respondiendo exactamente "Sí, disponible." sin listados.`;
      logEntry.action = 'RESPOND';
      logEntry.text = 'Sí, disponible.';
      if (handoffManager) handoffManager.recordHumanIntervention(leadId, talkId, contactId, currentTime);
      return { shouldRespond: true, text: 'Sí, disponible.', log: logEntry };
    }
  }

  // --------------------------------------------------------------------------
  // PRIORIDAD 8, 9 Y 10: PREGUNTAS ESPECÍFICAS DE UNA PROPIEDAD IDENTIFICADA (REGLA 3.E)
  // --------------------------------------------------------------------------
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
  AUTHORIZED_COLUMNS,
  normalizeText,
  isPropertyAvailable,
  isSocialMediaEventOrMention,
  isPureGreetingWithoutInquiry,
  isHumanAttentionRequest,
  extractWasiPropertyIdentifiers,
  searchZoneOrFeatureMatches,
  isVenezuelaRenaceCreditQuery,
  evaluateVenezuelaRenaceCredit,
  HandoffManager,
  DeduplicationManager,
  ConversationContextManager,
  verifyPreDispatchSafety,
  evaluatePropertyQuestionWithClaude,
  evaluateCentralDecisionPipeline
};
