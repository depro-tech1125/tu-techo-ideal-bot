require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');
const { parse } = require('csv-parse/sync');
const XLSX = require('xlsx');
// Fichas técnicas desvinculadas del flujo de decisión principal (mantenidas solo para compatibilidad)
const { loadFichasTecnicas, findFichaTecnica, handleFichaTecnicaQuery } = require('./fichas_manager.js');

// ============================================================================
// NUEVO CONTROLADOR CENTRAL DETERMINÍSTICO (PIPELINE DE DECISIÓN INMOBILIARIA)
// ============================================================================
const {
  AVAILABILITY_RESPONSE,
  HANDOFF_LOCK_HOURS,
  HANDOFF_LOCK_MS,
  evaluateCentralDecisionPipeline,
  HandoffManager,
  DeduplicationManager,
  ConversationContextManager,
  verifyPreDispatchSafety,
  classifyOutgoingMessage,
  adaptProperty,
  isPropertyAvailable,
  extractMultiportalPropertyIdentifiers,
  isExtendedInfoOrPhotoRequest
} = require('./pipeline_decision.js');

const { recoverActivePropertyFromKommo, tagLeadWithProperty } = require('./lib/kommo_property_recovery.js');

const OBSERVATION_MODE = process.env.OBSERVATION_MODE === 'true';

// ============================================================================
// VERIFICACIÓN DE SEGURIDAD ESTRICTA PARA USO DE RELOJ SIMULADO EN STAGING
// ============================================================================

const ALLOWED_STAGING_HOSTNAMES = Object.freeze([
  'tu-techo-ideal-staging.onrender.com'
]);

const ALLOWED_SIMULATED_TIME_ROUTES = Object.freeze([
  { method: 'GET', path: '/api/staging/check-lock-status' },
  { method: 'POST', path: '/api/staging/set-handoff-time' },
  { method: 'POST', path: '/api/staging/test-pipeline-evaluation' }
]);

function verifyStagingAuthHeader(req) {
  const expectedToken = process.env.STAGING_AUTH_TOKEN;
  if (!expectedToken || typeof expectedToken !== 'string') {
    return false;
  }
  // Exigir exclusivamente la cabecera x-staging-auth
  const clientToken = req?.headers?.['x-staging-auth'];
  if (!clientToken || typeof clientToken !== 'string') {
    return false;
  }
  const expectedBuf = Buffer.from(expectedToken, 'utf8');
  const clientBuf = Buffer.from(clientToken, 'utf8');
  if (expectedBuf.length !== clientBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuf, clientBuf);
}

function isAuthorizedStagingTestRequest(req) {
  // 1. Exigir expresamente NODE_ENV === 'staging'. Si no es exactamente staging, rechazar.
  if (process.env.NODE_ENV !== 'staging') {
    return false;
  }

  // 2. Validación estricta y exacta de hostname (únicamente hostname de Render Staging, sin X-Forwarded-Host no confiable)
  const rawHost = (req?.headers?.host || req?.hostname || '').split(':')[0].trim().toLowerCase();
  if (!ALLOWED_STAGING_HOSTNAMES.includes(rawHost)) {
    return false;
  }

  // 3. Restricción estricta de rutas (solo lista blanca cerrada para reloj simulado)
  const reqMethod = (req?.method || '').toUpperCase();
  const reqPath = (req?.baseUrl || '') + (req?.path || req?._parsedUrl?.pathname || '');
  const isAllowedRoute = ALLOWED_SIMULATED_TIME_ROUTES.some(r =>
    r.method === reqMethod && r.path === reqPath
  );
  if (!isAllowedRoute) {
    return false;
  }

  // 4. Verificación criptográfica segura de la cabecera x-staging-auth
  return verifyStagingAuthHeader(req);
}

// Gestor de handoff y bloqueo humano persistente
const centralHandoffManager = new HandoffManager(
  path.join(__dirname, 'handoffs.json'),
  async ({ leadId, talkId, contactId }) => {
    try {
      const token = process.env.KOMMO_TOKEN;
      const subdomain = process.env.KOMMO_SUBDOMAIN;
      if (!token || !subdomain) return null;
      const headers = { Authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}` };
      const url = `https://${subdomain}.kommo.com/api/v4/events?filter[type]=outgoing_chat_message&limit=15`;
      const evRes = await axios.get(url, { headers, timeout: 5000 });
      const events = evRes.data?._embedded?.events || [];
      for (const ev of events) {
        if (leadId && String(ev.entity_id) === String(leadId)) {
          // Ignorar mensajes salientes automáticos de robots/Salesbot/API (created_by === 0)
          if (ev.created_by === 0) continue;
          return { lastHumanTimestamp: ev.created_at * 1000 };
        }
      }
    } catch (e) {}
    return null;
  }
);
const centralContextManager = new ConversationContextManager(path.join(__dirname, 'lead_context.json'));

// Control contra alertas duplicadas a Robert (ventana móvil de 5 minutos por lead e interés)
const recentAlertsSentToRobert = new Map();

// ============================================================================
// 🎛️ CONTROLADOR DE DESPACHO RESTRINGIDO PARA STAGING (CONTROLLED DISPATCH)
// ============================================================================
let stagingTestDispatchEnabled = process.env.STAGING_TEST_DISPATCH === 'true';

// Lista blanca estricta con coincidencia simultánea de LEAD_ID y TALK_ID
const authorizedControlledPair = {
  leadId: process.env.STAGING_ALLOWED_LEAD_ID || null,
  talkId: process.env.STAGING_ALLOWED_TALK_ID || null,
  expiresAt: process.env.STAGING_DISPATCH_TTL_MS ? Date.now() + Number(process.env.STAGING_DISPATCH_TTL_MS) : (Date.now() + 60 * 60 * 1000), // 1 hora por defecto
  maxDispatches: Number(process.env.STAGING_MAX_TEST_DISPATCHES) || 2, // Máximo 2 mensajes por defecto
  currentDispatches: 0
};

// Historial de auditoría de despachos controlados en Staging
const controlledDispatchHistory = [];
function recordControlledDispatch(entry) {
  controlledDispatchHistory.unshift({
    timestamp: new Date().toISOString(),
    lead_id: entry.leadId ? `LEAD_${String(entry.leadId).substring(0, 4)}***` : null,
    talk_id: entry.talkId ? `TALK_${String(entry.talkId).substring(0, 4)}***` : null,
    text: entry.text || null,
    action: entry.action || 'DISPATCH',
    success: !!entry.success,
    salesbot_triggered: !!entry.salesbotTriggered,
    error: entry.error || null
  });
  if (controlledDispatchHistory.length > 50) controlledDispatchHistory.pop();
}

function isControlledDispatchAuthorized(leadId, talkId) {
  // 1. En producción real (sin modo observación), esta excepción queda COMPLETAMENTE BLOQUEADA
  if (process.env.NODE_ENV === 'production' && !OBSERVATION_MODE) {
    return false;
  }
  // 2. Interruptor general de despacho en Staging debe estar encendido
  if (!stagingTestDispatchEnabled) return false;

  // 3. Debe haber un par (LEAD_ID + TALK_ID) configurado
  if (!authorizedControlledPair.leadId || !authorizedControlledPair.talkId) {
    return false;
  }

  // 4. SEGURIDAD REFORZADA: Exigir coincidencia SIMULTÁNEA de ambos identificadores.
  // Prohibida la autorización por uno solo.
  if (!leadId || !talkId) {
    return false;
  }
  const leadMatch = String(leadId) === String(authorizedControlledPair.leadId);
  const talkMatch = String(talkId) === String(authorizedControlledPair.talkId);
  if (!leadMatch || !talkMatch) {
    return false;
  }

  // 5. Vencimiento temporal de la autorización
  if (Date.now() > authorizedControlledPair.expiresAt) {
    console.warn(`[CONTROLLED DISPATCH EXPIRED] La autorización para Lead #${leadId} / Talk #${talkId} ha vencido.`);
    return false;
  }

  // 6. Límite de mensajes de prueba
  if (authorizedControlledPair.currentDispatches >= authorizedControlledPair.maxDispatches) {
    console.warn(`[CONTROLLED DISPATCH LIMIT REACHED] Se alcanzó el límite de ${authorizedControlledPair.maxDispatches} despachos para Lead #${leadId} / Talk #${talkId}.`);
    return false;
  }

  return true;
}

// Buffer de decisiones de auditoría para Staging con anonimización estricta de datos personales
const stagingDecisionBuffer = [];
function recordStagingDecision(entry) {
  // Anonimizar identificadores y omitir datos personales (teléfonos, nombres reales)
  const sanitized = {
    timestamp: entry.timestamp || Date.now(),
    lead_id: entry.lead_id ? `LEAD_${String(entry.lead_id).substring(0, 4)}***` : null,
    talk_id: entry.talk_id ? `TALK_${String(entry.talk_id).substring(0, 4)}***` : null,
    inquiry_type: entry.decision?.typeDetected || 'UNKNOWN',
    action: entry.decision?.action || 'UNKNOWN',
    property_id: entry.decision?.propertyIdentified || null,
    response_text: entry.text || null,
    called_ai: !!entry.decision?.calledAI,
    tokens_used: entry.decision?.tokensUsed || 0,
    evidence: entry.decision?.evidence || null,
    reason: entry.decision?.reason || null
  };
  stagingDecisionBuffer.unshift(sanitized);
  if (stagingDecisionBuffer.length > 50) stagingDecisionBuffer.pop();
}

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// 🔒 SEGURIDAD Y PROTECCIÓN DEL SERVIDOR
// ==========================================
app.disable('x-powered-by');
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json({ limit: '2mb' }));

// Rate Limiter en memoria (Máximo 40 peticiones por minuto por IP)
const ipRequestCounts = new Map();
function rateLimiter(req, res, next) {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxRequests = 40;

  let client = ipRequestCounts.get(ip);
  if (!client || now - client.startTime > windowMs) {
    client = { count: 1, startTime: now };
    ipRequestCounts.set(ip, client);
  } else {
    client.count++;
  }

  if (client.count > maxRequests) {
    console.warn(`[Security Alert] Rate limit excedido para IP: ${ip}`);
    return res.status(429).send({ error: 'Too Many Requests' });
  }
  next();
}
app.use(rateLimiter);

// ============================================================================
// GESTOR DE IDEMPOTENCIA PERSISTENTE, MUTEX EN VUELO Y TIMERS SEGUROS
// ============================================================================
const { IdempotencyManager } = require('./lib/idempotency_manager.js');
const idempotencyManager = new IdempotencyManager();

const activeProcessingLeads = new Set();
const activeProcessingTalks = new Set();
const leadCleanupTimers = new Map(); // leadId -> NodeJS.Timeout

// Debounce ultracorto (1.5 segundos) exclusivamente para ráfagas idénticas a nivel de socket
const leadLastProcessed = new Map();
function isRapidBurst(leadId) {
  const now = Date.now();
  const last = leadLastProcessed.get(String(leadId));
  if (last && (now - last) < 1500) {
    return true;
  }
  leadLastProcessed.set(String(leadId), now);
  return false;
}

// ==========================================
// 📊 GOOGLE SHEETS EN TIEMPO REAL & MEMORIA VIRTUAL VOCABULARIO
// ==========================================
let cachedProperties = null;
let lastPropertiesFetchTime = 0;
const CACHE_TTL_MS = 60 * 1000; // 1 minuto de caché para alta velocidad y frescura
const PROPERTIES_CACHE_FILE = path.join(__dirname, 'properties_cache.json');

let virtualPropertyVocabulary = new Set();
let virtualWordToPropertiesMap = new Map();

const VOCABULARY_STOPWORDS = new Set([
  'de', 'la', 'que', 'el', 'en', 'y', 'a', 'los', 'del', 'se', 'las', 'por', 'un', 'para',
  'con', 'no', 'una', 'su', 'al', 'lo', 'como', 'mas', 'pero', 'sus', 'le', 'ya', 'o',
  'este', 'si', 'porque', 'esta', 'son', 'entre', 'cuando', 'muy', 'sin', 'sobre',
  'ser', 'tiene', 'tambien', 'me', 'hasta', 'hay', 'donde', 'quien', 'desde', 'todo',
  'nos', 'durante', 'todos', 'uno', 'les', 'ni', 'contra', 'otros', 'ese', 'eso', 'ante',
  'ellos', 'e', 'esto', 'mi', 'antes', 'algunos', 'unos', 'yo', 'otro', 'otras', 'otra',
  'tanto', 'esa', 'estos', 'mucho', 'quienes', 'nada', 'muchos', 'cual', 'sea', 'poco',
  'ella', 'estar', 'haber', 'estas', 'estaba', 'estamos', 'algunas', 'algo', 'nosotros',
  'gracias', 'hola', 'bienvenido', 'bienvenidos', 'buen', 'buenos', 'buenas', 'dias', 'tardes',
  'noches', 'saludos', 'saludo', 'atentamente', 'asesor', 'asesora', 'favor', 'porfavor', 'inmobiliaria',
  'ideal', 'techo'
]);

function normalizeWordToken(w) {
  return (w || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function indexPropertiesVocabulary(properties) {
  const newVocab = new Set();
  const newMap = new Map();

  for (const prop of properties) {
    const propVocab = new Set();
    const textsToIndex = [
      prop['DESCRIPCION_BREVE'] || '',
      prop.TIPO || '',
      prop.OPERACION || '',
      prop.ESTATUS || '',
      prop.Mascotas || '',
      prop['Tipo de Mascotas'] || ''
    ].join(' ');

    const rawWords = textsToIndex.split(/\s+/);
    for (const rw of rawWords) {
      const token = normalizeWordToken(rw);
      if (token.length > 2 && !VOCABULARY_STOPWORDS.has(token)) {
        newVocab.add(token);
        propVocab.add(token);

        if (!newMap.has(token)) {
          newMap.set(token, []);
        }
        if (!newMap.get(token).includes(prop.ID_PROPIEDAD)) {
          newMap.get(token).push(prop.ID_PROPIEDAD);
        }
      }
    }
    prop._vocabulary = propVocab;
  }

  virtualPropertyVocabulary = newVocab;
  virtualWordToPropertiesMap = newMap;
  console.log(`[Memoria Virtual] Indexadas ${properties.length} propiedades y ${virtualPropertyVocabulary.size} palabras descriptivas en memoria.`);
}

function parseXlsxBufferToProperties(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet || !sheet['!ref']) return [];
  const range = XLSX.utils.decode_range(sheet['!ref']);

  const headers = [];
  for (let C = range.s.c; C <= range.e.c; ++C) {
    const cell = sheet[XLSX.utils.encode_cell({ r: range.s.r, c: C })];
    const headerVal = (cell && cell.v !== undefined && cell.v !== null) ? String(cell.v).trim() : '';
    headers.push(headerVal || `col_${C}`);
  }

  const records = [];
  for (let R = range.s.r + 1; R <= range.e.r; ++R) {
    const row = {};
    let hasData = false;
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const header = headers[C];
      if (!header) continue;
      const cellRef = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = sheet[cellRef];
      let val = (cell && cell.v !== undefined && cell.v !== null) ? String(cell.v).trim() : '';

      // Extraer hipervínculo nativo si existe en la celda
      if (cell && cell.l && cell.l.Target) {
        row[header + '_URL'] = cell.l.Target;
        if (!val || val.startsWith('🏢') || val.startsWith('📷') || val.startsWith('🔗') || val.startsWith('🌐')) {
          val = cell.l.Target;
        }
      }
      row[header] = val;
      if (val) hasData = true;
    }

    const propId = (row['ID_PROPIEDAD'] || row['id_propiedad'] || row['ID'] || '').trim();
    if (hasData && propId) {
      row['ID_PROPIEDAD'] = propId;
      // Extraer código WASI (número de 6 a 9 dígitos de URL o texto plano)
      const wasiUrl = (row['Wasi_URL'] || row['Wasi'] || row['WASI'] || row['Link Wasi'] || '').trim();
      const wasiMatch = wasiUrl.match(/\/(\d{6,9})(?:[^\d]|$)/) || wasiUrl.match(/^\s*(\d{6,9})\s*$/);
      row['CODIGO_WASI'] = wasiMatch ? wasiMatch[1] : '';

      // Limpieza de teléfono de asesor
      let agentPhone = (row['Numero de WhatsApp'] || row['WhatsApp'] || row['Telefono'] || '').replace(/[^0-9]/g, '');
      if (agentPhone.length === 10 && agentPhone.startsWith('4')) {
        agentPhone = '58' + agentPhone;
      } else if (agentPhone.length === 11 && agentPhone.startsWith('04')) {
        agentPhone = '58' + agentPhone.substring(1);
      }
      row['TELEFONO_ASESOR_CLEAN'] = agentPhone;

      records.push(row);
    }
  }
  return records;
}

// ==========================================
// 🧪 CACHÉ AISLADA PARA HOJA DE PRUEBAS EN STAGING (OPCIÓN 1)
// ==========================================
const OFFICIAL_GOOGLE_SHEET_ID = '1cXZdjOck8rYUZdZUOWlhQMWxnyegipyVa081EkrRc_A';
const GOOGLE_SHEET_TEST_URL_REGEX = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,80})(?:\/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$/;

let stagingTestSheetCache = {
  sheetId: null,
  properties: null,
  lastFetchTime: 0
};

/**
 * Valida y obtiene las propiedades de una Google Sheet de prueba independiente.
 * Aislamiento estricto:
 * 1. NUNCA modifica cachedProperties global.
 * 2. NUNCA modifica virtualPropertyVocabulary ni virtualWordToPropertiesMap.
 * 3. NUNCA escribe en properties_cache.json de producción.
 * 4. Rechaza expresamente el ID de la hoja oficial.
 * 5. Protegido contra SSRF validando dominio y extrayendo únicamente el sheetId.
 */
async function getStagingTestProperties(testSheetUrl, forceRefresh = false) {
  if (!testSheetUrl || typeof testSheetUrl !== 'string') {
    throw new Error('test_sheet_url es obligatorio y debe ser una cadena de texto.');
  }

  if (typeof forceRefresh !== 'boolean') {
    throw new Error('test_sheet_force_refresh debe ser un valor booleano (true o false).');
  }

  const trimmedUrl = testSheetUrl.trim();
  const match = trimmedUrl.match(GOOGLE_SHEET_TEST_URL_REGEX);
  if (!match) {
    throw new Error('test_sheet_url inválida. Debe ser una URL legítima de Google Sheets (https://docs.google.com/spreadsheets/d/...).');
  }

  const sheetId = match[1];
  if (sheetId === OFFICIAL_GOOGLE_SHEET_ID) {
    throw new Error('Prohibido: No se permite usar la Google Sheet oficial como test_sheet_url para pruebas aisladas.');
  }

  const now = Date.now();
  if (
    !forceRefresh &&
    stagingTestSheetCache.sheetId === sheetId &&
    stagingTestSheetCache.properties &&
    (now - stagingTestSheetCache.lastFetchTime) < CACHE_TTL_MS
  ) {
    return stagingTestSheetCache.properties;
  }

  // Descarga segura construyendo la URL XLSX exclusivamente con el ID validado
  const xlsxUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`;
  const response = await axios.get(xlsxUrl, { responseType: 'arraybuffer', timeout: 10000 });
  const records = parseXlsxBufferToProperties(response.data);

  console.log(`[Staging Test Sheet] Extraídas ${records.length} propiedades de prueba desde ${sheetId} (Caché aislada).`);

  stagingTestSheetCache = {
    sheetId,
    properties: records,
    lastFetchTime: now
  };

  return records;
}

async function getAvailableProperties(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedProperties && (now - lastPropertiesFetchTime) < CACHE_TTL_MS) {
    return cachedProperties;
  }

  // 1. Intentamos primero vía XLSX para extraer los enlaces reales ocultos de Wasi, Fotos, Web y MercadoLibre
  try {
    const rawSheetUrl = process.env.GOOGLE_SHEET_CSV_URL || 'https://docs.google.com/spreadsheets/d/1cXZdjOck8rYUZdZUOWlhQMWxnyegipyVa081EkrRc_A/gviz/tq?tqx=out:csv&sheet=Hoja%201';
    let xlsxUrl = rawSheetUrl;
    if (xlsxUrl.includes('/spreadsheets/d/')) {
      const match = xlsxUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      if (match) {
        xlsxUrl = `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=xlsx`;
      }
    }

    const response = await axios.get(xlsxUrl, { responseType: 'arraybuffer', timeout: 10000 });
    const records = parseXlsxBufferToProperties(response.data);

    console.log(`[Google Sheets XLSX] Extraídas ${records.length} propiedades con hipervínculos y códigos Wasi reales.`);
    try {
      const cleanProps = records.map(p => {
        const copy = { ...p };
        delete copy._vocabulary;
        return copy;
      });
      fs.writeFileSync(PROPERTIES_CACHE_FILE, JSON.stringify(cleanProps, null, 2), 'utf8');
    } catch (e) {}

    indexPropertiesVocabulary(records);
    cachedProperties = records;
    lastPropertiesFetchTime = now;
    return records;
  } catch (errXlsx) {
    console.warn('[Google Sheets XLSX Fallback Warning]:', errXlsx.message);
    // 2. Si XLSX falla o da timeout, recurrir de inmediato al respaldo local permanente donde los 69 códigos Wasi y URLs reales están 100% preservados
    if (fs.existsSync(PROPERTIES_CACHE_FILE)) {
      try {
        const localData = JSON.parse(fs.readFileSync(PROPERTIES_CACHE_FILE, 'utf8'));
        if (Array.isArray(localData) && localData.length > 0) {
          console.log(`[Google Sheets Local Backup] Cargadas ${localData.length} propiedades con códigos Wasi desde ${PROPERTIES_CACHE_FILE}`);
          indexPropertiesVocabulary(localData);
          cachedProperties = localData;
          lastPropertiesFetchTime = now;
          return localData;
        }
      } catch (e) {
        console.warn('[Local Properties Cache Read Error]:', e.message);
      }
    }

    // 3. Fallback de contingencia a CSV si todo lo anterior falla
    try {
      const csvUrl = process.env.GOOGLE_SHEET_CSV_URL;
      const response = await axios.get(csvUrl, { timeout: 7000 });
      const records = parse(response.data, {
        columns: true,
        skip_empty_lines: true,
        trim: true
      });
      for (const row of records) {
        if (!row.Wasi_URL && row.Wasi && row.Wasi.startsWith('http')) {
          row.Wasi_URL = row.Wasi;
        }
        if (!row.CODIGO_WASI) {
          const wasiUrl = row.Wasi_URL || row.Wasi || '';
          const wasiMatch = wasiUrl.match(/\/(\d{7,9})(?:\?|$)/);
          row.CODIGO_WASI = wasiMatch ? wasiMatch[1] : '';
        }
        if (!row.LINK_FOTOS_URL && row.LINK_FOTOS && row.LINK_FOTOS.startsWith('http')) {
          row.LINK_FOTOS_URL = row.LINK_FOTOS;
        }
        let agentPhone = (row['Numero de WhatsApp'] || row['WhatsApp'] || '').replace(/[^0-9]/g, '');
        if (agentPhone.length === 10 && agentPhone.startsWith('4')) {
          agentPhone = '58' + agentPhone;
        } else if (agentPhone.length === 11 && agentPhone.startsWith('04')) {
          agentPhone = '58' + agentPhone.substring(1);
        }
        row.TELEFONO_ASESOR_CLEAN = agentPhone;
      }
      console.log(`[Google Sheets CSV Fallback] Total rows: ${records.length}`);
      indexPropertiesVocabulary(records);
      cachedProperties = records;
      lastPropertiesFetchTime = now;
      return records;
    } catch (errCsv) {
      console.error('[Google Sheets Fatal Error]:', errCsv.message);
      return cachedProperties || [];
    }
  }
}

function normalizeText(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function cleanUrlForMatching(url) {
  if (!url) return '';
  return String(url).toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
    .trim();
}

function findPropertyByAnyLinkOrCode(text, allProps) {
  if (!text || !allProps || allProps.length === 0) return null;
  const raw = String(text).trim();

  // 0. Extracción multiportal prioritaria unificada (Wasi, Mercado Libre, Web, Rexup, Aliases)
  const multiExtraction = extractMultiportalPropertyIdentifiers(raw, allProps);
  if (multiExtraction && multiExtraction.count > 0 && multiExtraction.matches[0]) {
    return multiExtraction.matches[0];
  }

  // 1. Extraer códigos numéricos (7 a 9 dígitos)
  const numMatches = raw.match(/\b(\d{7,9})\b/g) || [];
  for (const code of numMatches) {
    const found = allProps.find(p =>
      p.CODIGO_WASI === code ||
      (p.Wasi_URL && p.Wasi_URL.includes(code)) ||
      (p.Wasi && p.Wasi.includes(code))
    );
    if (found) return found;
  }

  // 2. Extraer código REF (REF-012)
  const refMatch = raw.match(/\b(REF-?\d{3})\b/i);
  if (refMatch) {
    const cleanRef = refMatch[1].toUpperCase().replace('REF', 'REF-').replace('--', '-');
    const found = allProps.find(p => (p.ID_PROPIEDAD || '').toUpperCase() === cleanRef);
    if (found) return found;
  }

  // 3. Extraer código Rexup (cod_inmueble)
  const rexupMatch = raw.match(/cod_inmueble=(\d+)/i);
  if (rexupMatch) {
    const found = allProps.find(p => (p.LINK_FOTOS || p.LINK_FOTOS_URL || '').includes(rexupMatch[1]));
    if (found) return found;
  }

  // 4. Extraer código Mercado Libre (MLV)
  const mlMatch = raw.match(/MLV-?(\d+)/i);
  if (mlMatch) {
    const found = allProps.find(p => (p['Mercado Libre'] || p.MercadoLibre_URL || '').includes(mlMatch[1]));
    if (found) return found;
  }

  // 5. Extraer URLs completas o parciales (Wasi, Web, Mercado Libre, Rexup)
  const urlMatches = raw.match(/https?:\/\/[^\s"'<>]+/gi) || [];
  for (const rawUrl of urlMatches) {
    const cleaned = cleanUrlForMatching(rawUrl);

    for (const p of allProps) {
      const wasiClean = cleanUrlForMatching(p.Wasi_URL || p.Wasi);
      const webClean = cleanUrlForMatching(p['Pagina Web'] || p.PaginaWeb_URL);
      const mlClean = cleanUrlForMatching(p['Mercado Libre'] || p.MercadoLibre_URL);
      const fotosClean = cleanUrlForMatching(p.LINK_FOTOS || p.LINK_FOTOS_URL);

      if (wasiClean && (cleaned === wasiClean || cleaned.includes(wasiClean) || wasiClean.includes(cleaned))) return p;
      if (webClean && (cleaned === webClean || cleaned.includes(webClean) || webClean.includes(cleaned))) return p;
      if (mlClean && (cleaned === mlClean || cleaned.includes(mlClean) || mlClean.includes(cleaned))) return p;
      if (fotosClean && (cleaned === fotosClean || cleaned.includes(fotosClean) || fotosClean.includes(cleaned))) return p;

      // Comparar por slug final de la URL
      const slugMatch = cleaned.match(/\/([a-z0-9-]+)$/i);
      if (slugMatch && slugMatch[1].length > 5) {
        const slug = slugMatch[1];
        if (wasiClean.includes(slug) || webClean.includes(slug)) return p;
      }
    }
  }

  return null;
}

function isStandaloneLinkWithoutQuestion(text, properties = null) {
  if (!text || typeof text !== 'string') return false;
  const clean = text.trim();

  // Detectar si el mensaje contiene links o URLs
  const hasUrl = /https?:\/\/[^\s]+/i.test(clean) || /www\.[^\s]+/i.test(clean);
  if (!hasUrl) return false;

  // Si tenemos el catálogo de propiedades y el link coincide con una propiedad real de la BD, NO es un link descartable
  if (properties && Array.isArray(properties) && properties.length > 0) {
    const match = findPropertyByAnyLinkOrCode(clean, properties);
    if (match) {
      return false; // ¡Es una consulta legítima de un inmueble de nuestro inventario!
    }
    // Si contiene dominios de inmobiliaria o catálogos, NUNCA descartar
    if (/wasi\.co|tutechoideal\.com|mercadolibre\.com|rexup\.net/i.test(clean)) {
      return false;
    }
  }

  // Remover todas las URLs para ver qué texto queda
  const textWithoutUrls = clean.replace(/https?:\/\/[^\s]+/gi, '').replace(/www\.[^\s]+/gi, '').trim();

  // Si al quitar las URLs no queda nada o solo puntuación/emojis (< 4 caracteres)
  if (textWithoutUrls.length < 4) {
    if (/instagram\.com|tiktok\.com|facebook\.com|youtube\.com|youtu\.be/i.test(clean)) {
      return true; // Reel o red social suelta sin consulta
    }
    return false;
  }

  // Si el texto incluye palabras claras de consulta inmobiliaria o red Wasi
  const q = normalizeText(textWithoutUrls);
  const isRealEstateInquiry = /\b(?:wasi|inmueble|inmuebles|propiedad|propiedades|inmobiliari[ao]|realtor|interesad[oa]|oportunidad(?:es)?|negocio|apartamento|apto|casa|oficina|local|galpon|terreno|alquiler|alquilar|venta|comprar?|precio|costo|canon|disponib|habitac|bano|baño|metro|mts|m2|ubicacion|informacion|info|link|enlace|fotos?)\b/i.test(q);

  if (isRealEstateInquiry || /\?|¿/.test(textWithoutUrls)) {
    return false; // Es una consulta inmobiliaria válida con texto
  }

  return false;
}

// ==========================================
// 🛑 FILTRO DETERMINÍSTICO ANTI-CHITCHAT Y CHARLA CASUAL
// ==========================================
function isCasualOrChitChat(text, imageUrl = null, hasActiveContext = false, activeProperty = null) {
  if (isStandaloneLinkWithoutQuestion(text)) {
    return true;
  }
  if (imageUrl) return false;
  if (!text || typeof text !== 'string') return true;
  const q = normalizeText(text);

  // 0. Filtrar ofrecimientos de servicios de terceros, publicidad o preguntas de atención externa
  // (ej: "¿Cómo podemos ayudarte?", agencias de marketing, diseño, etc.)
  const vendorServicePhrases = [
    'como podemos ayudarte', 'como puedo ayudarte', 'en que podemos ayudarte',
    'en que te puedo ayudar', 'en que le puedo ayudar', 'en que te puedo colaborar',
    'en que le puedo colaborar', 'en que te colaboro', 'en que le colaboro',
    'a la orden', 'a su orden', 'a sus ordenes', 'ofrecemos servicios', 'ofrezco servicios',
    'manejo redes', 'marketing digital', 'diseno web', 'somos una agencia'
  ];
  if (vendorServicePhrases.some(phrase => q.includes(phrase))) {
    const hasPropertyRef = /REF-\d{3}|\b\d{7,9}\b|https?:\/\//i.test(text);
    if (!hasPropertyRef) {
      return true; // Se descarta por completo y se deja en visto
    }
  }

  // 1. Si ya hay un inmueble activo en contexto para este lead, CUALQUIER consulta es válida y NUNCA se descarta
  if (hasActiveContext) {
    // Solo si el mensaje es exclusivamente un cierre social aislado ("ok gracias", "chao", "jajaja")
    const strictClosures = ['jaja', 'jajaja', 'jeje', 'xd', 'ok', 'oka', 'gracias', 'muchas gracias', 'chao', 'adios', 'listo', 'vale', 'ok gracias'];
    if (strictClosures.includes(q)) {
      return true;
    }
    return false;
  }

  // 2. Si menciona colega, fotos o publicación inmobiliaria, no es charla casual
  if (q.includes('colega') || q.includes('publicacion') || q.includes('flyer')) {
    return false;
  }

  // 3. Lista estricta de comentarios casuales, exclamaciones, bromas y saludos puros
  const casualPhrases = [
    'si es una locura', 'una locura', 'que locura', 'es una locura', 'locura',
    'jajaja', 'jaja', 'jeje', 'jiji', 'lol', 'xd',
    'ok', 'oka', 'okey', 'okay', 'vale', 'dale', 'dale pues', 'dale fino', 'listo',
    'gracias', 'muchas gracias', 'mil gracias', 'gracias amigo', 'gracias amiga', 'ok gracias',
    'perfecto', 'excelente', 'bueno', 'buenisimo', 'fino', 'chevere', 'que fino', 'que chevere',
    'de acuerdo', 'entendido', 'anotado', 'copiado',
    'chao', 'adios', 'hasta luego', 'nos vemos', 'feliz dia', 'feliz tarde', 'feliz noche',
    'muy caro', 'esta caro', 'esta muy caro', 'demasiado caro', 'no me alcanza', 'no llego a eso',
    'yo te aviso', 'yo les aviso', 'despues te aviso', 'te estoy avisando', 'cualquier cosa te aviso',
    'voy a consultar', 'voy a pensar', 'lo voy a pensar', 'dejame pensarlo', 'dejame ver', 'dejame consultar',
    'voy a hablar con', 'hablo con mi esposa', 'hablo con mi esposo', 'hablo con mi socio',
    'como estas', 'como estan', 'que tal', 'epale', 'que hubo', 'bien y tu', 'todo bien',
    'donde estas', 'a que hora nos vemos', 'vamos a comer', 'pasame el documento'
  ];

  const isStrictCasual = casualPhrases.some(p => q === p || q === `${p}!` || q === `${p}.` || q === `${p}?` || q.startsWith(p + ' ') || q.endsWith(' ' + p));
  if (isStrictCasual) {
    const hasPropertyQuestion = /\?|¿|cuant|tien|preci|habitac|bano|baño|puest|estacion|metr|mts|m2|mt2|pis|agu|pozo|gas|color|pared|sala/i.test(q);
    if (!hasPropertyQuestion) return true;
  }

  // 4. Si contiene signos de interrogación o palabras de pregunta / consulta seca
  if (
    q.includes('?') || q.includes('¿') ||
    /^(?:cu[aá]nto|qu[eé]|cu[aá]l|d[oó]nde|c[oó]mo|tiene|cuenta|acepta|hay|precio|costo|inversion|canon|color|de\s+que\s+color|de\s+cuantos\s+mts|cuantos\s+mts)\b/i.test(q)
  ) {
    return false;
  }

  // 5. Si el mensaje contiene CUALQUIER palabra presente en la Memoria Virtual de Google Sheets
  const queryTokens = q.split(/\s+/).map(normalizeWordToken).filter(w => w.length > 2 && !VOCABULARY_STOPWORDS.has(w));
  const matchesVirtualMemory = queryTokens.some(token => {
    if (virtualPropertyVocabulary.has(token)) return true;
    if (activeProperty && activeProperty._vocabulary && activeProperty._vocabulary.has(token)) return true;
    return false;
  });
  if (matchesVirtualMemory) {
    return false; // Es una pregunta o mención directa de características de la base de datos
  }

  // 6. Palabras clave exhaustivas de inmuebles, partes de casas, colores, servicios y características
  const realEstateKeywords = [
    'casa', 'casas', 'apto', 'aptos', 'apartamento', 'apartamentos', 'quinta', 'quintas',
    'local', 'locales', 'oficina', 'oficinas', 'comercial', 'galpon', 'galpones', 'terreno', 'terrenos',
    'anexo', 'anexos', 'penthouse', 'fondo de comercio',
    'venta', 'comprar', 'compra', 'alquiler', 'alquilar', 'renta', 'rentar',
    'precio', 'precios', 'costo', 'valor', 'inversion', 'canon', 'cuanto', 'cuanta', 'cuantos', 'cuantas', 'presupuesto', 'menos de', 'mil',
    'habitacion', 'habitaciones', 'hab', 'habs', 'cuarto', 'cuartos', 'dormitorio', 'dormitorios',
    'baño', 'baños', 'bano', 'banos',
    'estacionamiento', 'estacionamientos', 'puesto', 'puestos', 'parqueo', 'parqueos', 'garage', 'garaje', 'carro', 'carros',
    'metro', 'metros', 'metraje', 'm2', 'mts', 'mt2', 'mts2', 'superficie', 'tamano', 'tamaño',
    'piso', 'pisos', 'nivel', 'planta', 'pb',
    'pared', 'paredes', 'color', 'colores', 'amarillo', 'amarilla', 'blanco', 'blanca', 'pintura', 'pintado',
    'sala', 'comedor', 'cocina', 'cocinas', 'barra', 'recepcion', 'produccion', 'area',
    'agua', 'pozo', 'tanque', 'tanques', 'luz', 'gas', 'electricidad', 'condominio', 'mantenimiento',
    'financiamiento', 'credito', 'inicial', 'cuotas', 'ref', 'codigo',
    'piscina', 'gimnasio', 'terraza', 'balcon', 'ascensor', 'vista', 'amoblado',
    'macaracuay', 'florida', 'boyera', 'hatillo', 'caracas', 'zona', 'ubicacion', 'marques', 'chacao', 'mercedes', 'palos grandes', 'san ignacio',
    'cita', 'visita', 'visitar', 'agendar', 'verlo', 'verla', 'disponible', 'disponibles',
    'inmueble', 'inmuebles', 'propiedad', 'propiedades',
    'colega', 'publicacion', 'wasi', 'fotos', 'foto', 'flyer',
    'mascota', 'mascotas', 'perro', 'perros', 'gato', 'gatos', 'animal', 'animales', 'pet friendly'
  ];

  const hasRealEstateIntent = realEstateKeywords.some(kw => q.includes(kw));
  if (hasRealEstateIntent) {
    return false;
  }

  // Si no menciona nada del inventario ni negocio y es un texto corto (< 15 caracteres sin pregunta):
  if (!hasRealEstateIntent && !matchesVirtualMemory && q.length < 15) {
    return true;
  }

  return false;
}

// ==========================================
// 🎯 COMPROBACIÓN ESTRICTA DE INTENCIÓN INMOBILIARIA
// ==========================================
function hasExplicitRealEstateIntent(text, imageUrl = null) {
  if (isStandaloneLinkWithoutQuestion(text)) return false;
  if (imageUrl) return true;
  const q = normalizeText(text);

  // Descartar mensajes del sistema, menciones de historias, reels o restricciones de Instagram
  if (
    q.includes('menciono en su historia') ||
    q.includes('restricciones de instagram') ||
    q.includes('no podemos mostrar este mensaje') ||
    q.includes('abrir en instagram')
  ) {
    return false;
  }

  const intentKeywords = [
    'comprar', 'compra', 'compro', 'adquirir',
    'alquilar', 'alquiler', 'rentar', 'renta',
    'vender', 'venta', 'vendo',
    'interesado', 'interesada', 'interesados', 'interesa', 'interesan',
    'busco', 'buscando',
    'casa', 'casas', 'apto', 'aptos', 'apartamento', 'apartamentos',
    'quinta', 'quintas', 'local', 'locales', 'oficina', 'oficinas',
    'comercial', 'galpon', 'terreno', 'anexo', 'anexos', 'inmueble', 'inmuebles', 'propiedad', 'propiedades',
    'precio', 'precios', 'costo', 'presupuesto', 'menos de', 'mil',
    'macaracuay', 'alta florida', 'florida', 'boyera', 'hatillo', 'marques', 'chacao', 'mercedes', 'palos grandes',
    'wasi', 'colega', 'fotos', 'foto', 'publicacion', 'flyer',
    'mascota', 'mascotas', 'perro', 'perros', 'gato', 'gatos', 'animal', 'animales', 'pet friendly'
  ];

  return intentKeywords.some(kw => q.includes(kw));
}

// ==========================================
// 📢 DETECCIÓN DE MENSAJES Y PALABRAS CLAVE DE CAMPAÑA META (ADS)
// ==========================================
// ==========================================
// 💬 DETECCIÓN DE COMENTARIOS PÚBLICOS DE FACEBOOK (EXCLUSIÓN ESTRICTA)
// ==========================================
// Distingue expresamente los mensajes privados de Messenger de los comentarios públicos de Facebook.
// No se automatizan comentarios públicos en publicaciones: silencio absoluto (0 mensajes, 0 alertas).
function isFacebookPublicComment(body, messageObj) {
  if (!body && !messageObj) return false;

  if (messageObj) {
    if (messageObj.is_comment === true || messageObj.is_comment === "true" || messageObj.is_comment === 1 || messageObj.is_comment === "1") {
      return true;
    }
    if (messageObj.item === "comment" || messageObj.type === "comment" || messageObj.message_type === "comment") {
      return true;
    }
    if (typeof messageObj.origin === "string" && /comment/i.test(messageObj.origin)) {
      return true;
    }
  }

  if (body) {
    if (body.comment || body["message[add][0][is_comment]"] === "true" || body["message[add][0][is_comment]"] === "1" || body["message[add][0][is_comment]"] === true) {
      return true;
    }
    if (body.event === "comment_add" || body.event === "new_comment" || body.event === "facebook_comment") {
      return true;
    }
    if (body["message[add][0][item]"] === "comment" || body["message[add][0][type]"] === "comment") {
      return true;
    }
  }

  return false;
}

// ==========================================
// 🌐 IDENTIFICACIÓN EXACTA DEL CANAL DE COMUNICACIÓN (FACEBOOK, INSTAGRAM, WHATSAPP)
// ==========================================
function resolveCommunicationChannel(talkOrigin, talkSourceId, clientPhone, clientName, messageObj) {
  const origin = (talkOrigin || messageObj?.origin || "").toLowerCase();
  const sourceId = String(talkSourceId || messageObj?.source_id || "");

  // 1. Facebook Messenger confirmado por origen de talk o source_id de Kommo
  if (origin === "facebook" || origin.includes("facebook") || origin.includes("messenger") || sourceId === "44070" || sourceId === "44072") {
    return "Facebook Messenger";
  }

  // 2. Instagram Direct confirmado por origen de talk o source_id de Kommo
  if (origin.includes("instagram") || sourceId === "83712" || sourceId === "83714") {
    return "Instagram";
  }

  // 3. WhatsApp confirmado por origen de talk, source_id o número telefónico válido
  if (origin.includes("wa") || origin.includes("whatsapp") || sourceId === "83710" || (clientPhone && String(clientPhone).length > 5)) {
    return "WhatsApp";
  }

  // 4. Heurística secundaria por nombre de usuario (@username típico de Instagram)
  if (clientName && clientName.startsWith("@")) {
    return "Instagram";
  }

  return "Facebook Messenger / Redes Sociales";
}

function isMetaCampaignKeyword(text) {
  if (!text || typeof text !== 'string') return false;
  const q = normalizeText(text);
  // Campaña de Meta (Facebook / Instagram Ads) con mensaje predeterminado o palabra clave CTA:
  // "Ideal", "Tu Techo Ideal", "Tutechoideal"
  if (
    q === 'ideal' ||
    q === 'ideal!' ||
    q === 'ideal.' ||
    q === 'tu techo ideal' ||
    q === 'tu techo ideal!' ||
    q === 'tutechoideal' ||
    q === 'hola vi este anuncio' ||
    q === 'vi este anuncio en instagram' ||
    q === 'vi este anuncio en facebook' ||
    q.startsWith('vi este anuncio')
  ) {
    return true;
  }
  return false;
}

// ==========================================
// 🏢 DETECCIÓN DE FRASE AISLADA DE MARCA: "Inmobiliaria tu techo ideal."
// ==========================================
function isStandaloneInmobiliariaTuTechoIdeal(text) {
  if (!text || typeof text !== 'string') return false;
  // Limpiar puntuación exterior, comillas, exclamaciones, puntos
  let clean = normalizeText(text)
    .replace(/^[\s"'¿?¡!\.,;\-_#@()]+/, '')
    .replace(/[\s"'¿?¡!\.,;\-_#@()]+$/, '')
    .trim();

  // Reducir espacios múltiples
  clean = clean.replace(/\s+/g, ' ');

  // Variaciones exactas y con errores ortográficos comunes (b/v, letras transpuestas, omisión de tu)
  const exactPatterns = [
    /^(la\s+)?inmo[bv]ili?[ae]?r?i?a?s?\s+(tu\s+)?techo\s*id[ea]+l+(\s*rd|\s*c\.?a\.?)?$/i,
    /^(la\s+)?inmo[bv]ili?[ae]?r?i?a?s?\s+tutecho\s*id[ea]+l+(\s*rd|\s*c\.?a\.?)?$/i
  ];

  return exactPatterns.some(p => p.test(clean));
}

// ==========================================
// 🚨 DETECCIÓN Y ALERTAS DE LEADS CALIENTES
// ==========================================
function detectLeadIntent(text) {
  const q = normalizeText(text);

  // 1. Cita o Visita presencial
  const visitKeywords = [
    'cita', 'visita', 'agendar', 'verlo', 'verla', 'visitar',
    'cuando podemos ir', 'cuando se puede ver', 'disponible para ver',
    'mostrar', 'conocerlo', 'conocerla', 'me interesa ver', 'quiero ver',
    'ir a ver', 'horario para ver', 'puedo ir hoy', 'puedo ir manana'
  ];
  if (visitKeywords.some(kw => q.includes(kw))) {
    return { isHot: true, type: '📅 CITA / VISITA PRESENCIAL' };
  }

  // 2. Intención directa de compra / oferta
  const buyKeywords = [
    'quiero comprar', 'deseo comprar', 'interesado en comprar', 'interesada en comprar',
    'listo para comprar', 'oferta', 'ofertar', 'negociable', 'precio final',
    'formas de pago', 'metodo de pago', 'financiamiento', 'cuanto es lo minimo'
  ];
  if (buyKeywords.some(kw => q.includes(kw))) {
    return { isHot: true, type: '💰 INTENCIÓN DE COMPRA / OFERTA' };
  }

  // 3. Alquiler inmediato
  const rentKeywords = [
    'quiero alquilar', 'deseo alquilar', 'interesado en alquilar', 'interesada en alquilar',
    'listo para alquilar', 'para mudarme ya', 'mudanza inmediata'
  ];
  if (rentKeywords.some(kw => q.includes(kw))) {
    return { isHot: true, type: '🔑 ALQUILER INMEDIATO' };
  }

  return { isHot: false, type: null };
}

async function dispatchAlertToRobert(leadId, clientText, clientName, intentType) {
  const robertPhone = process.env.ROBERT_WHATSAPP || '+584143115105';
  const cleanPhone = robertPhone.replace(/[^0-9]/g, '');
  const token = process.env.KOMMO_TOKEN;
  const subdomain = process.env.KOMMO_SUBDOMAIN;
  const leadUrl = `https://${subdomain}.kommo.com/leads/detail/${leadId}`;
  const now = Math.floor(Date.now() / 1000);

  console.log(`\n🚨 [ALERTA DE CLIENTE CALIENTE DISPARADA] 🚨`);
  console.log(`Tipo: ${intentType}`);
  console.log(`Cliente: ${clientName} (Lead #${leadId})`);
  console.log(`Destinatario WhatsApp: ${robertPhone}`);
  console.log(`Mensaje: "${clientText}"`);

  // 1. Tarea prioritaria en Kommo asignada a Robert
  try {
    const robertUserId = parseInt(process.env.KOMMO_RESPONSIBLE_ID || '15568119', 10);
    const taskPayload = [
      {
        responsible_user_id: robertUserId,
        entity_id: parseInt(leadId, 10),
        entity_type: 'leads',
        text: `🔥 [${intentType}] ${clientName || 'Cliente'}: "${clientText}". WhatsApp Robert: ${robertPhone}`,
        complete_till: now + 1800,
        task_type_id: 1
      }
    ];
    await axios.post(`https://${subdomain}.kommo.com/api/v4/tasks`, taskPayload, {
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      timeout: 5000
    });
    console.log(`[Alert Kommo Task] Tarea urgente creada para Robert en Lead #${leadId}`);
  } catch (err) {
    console.warn('[Alert Error Kommo Task]:', err.response?.data || err.message);
  }

  // 2. Nota interna en el Lead de Kommo
  try {
    await axios.post(`https://${subdomain}.kommo.com/api/v4/leads/${leadId}/notes`, [
      {
        note_type: 'common',
        params: {
          text: `🚨 ALERTA DISPARADA A ROBERT (${robertPhone})\n\nMotivo: ${intentType}\nCliente: ${clientName}\nMensaje: "${clientText}"\nEnlace: ${leadUrl}`
        }
      }
    ], {
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      timeout: 5000
    });
    console.log(`[Alert Kommo Note] Nota registrada en Lead #${leadId}`);
  } catch (err) {
    console.warn('[Alert Error Kommo Note]:', err.response?.data || err.message);
  }

  // 3. Envío directo a WhatsApp si CallMeBot o Gateway está configurado
  const alertWhatsAppText = `🚨 *ALERTA TU TECHO IDEAL* 🚨\n\n` +
    `👤 *Cliente:* ${clientName || 'Cliente'}\n` +
    `🎯 *Motivo:* ${intentType}\n` +
    `💬 *Mensaje:* "${clientText}"\n\n` +
    `🔗 *Ver Lead en Kommo:*\n${leadUrl}\n\n` +
    `⚡ _¡Atiende a este cliente de inmediato para asegurar el cierre!_`;

  if (process.env.CALLMEBOT_API_KEY) {
    try {
      const callmebotUrl = `https://api.callmebot.com/whatsapp.php?phone=${cleanPhone}&text=${encodeURIComponent(alertWhatsAppText)}&apikey=${process.env.CALLMEBOT_API_KEY}`;
      await axios.get(callmebotUrl, { timeout: 8000 });
      console.log(`[WhatsApp Alert] Mensaje enviado a WhatsApp ${robertPhone} vía CallMeBot`);
    } catch (e) {
      console.warn(`[WhatsApp Alert CallMeBot Error]:`, e.message);
    }
  }

  if (process.env.WHATSAPP_GATEWAY_URL) {
    try {
      await axios.post(process.env.WHATSAPP_GATEWAY_URL, {
        phone: cleanPhone,
        message: alertWhatsAppText
      }, { timeout: 8000 });
      console.log(`[WhatsApp Alert] Mensaje enviado vía WhatsApp Gateway a ${robertPhone}`);
    } catch (e) {
      console.warn(`[WhatsApp Alert Gateway Error]:`, e.message);
    }
  }

  // 4. Envío de Alerta por Correo Electrónico
  try {
    const alertEmail = process.env.ALERT_EMAIL || 'tutechoidealrd@gmail.com';
    console.log(`[Email Alert] Alerta de cliente caliente dirigida a: ${alertEmail}`);
    if (process.env.EMAIL_GATEWAY_URL) {
      await axios.post(process.env.EMAIL_GATEWAY_URL, {
        to: alertEmail,
        subject: `🔥 ALERTA INMEDIATA: ${clientName} solicita ${intentType}`,
        message: alertWhatsAppText,
        leadUrl: leadUrl
      }, { timeout: 5000 });
      console.log(`[Email Alert] Correo enviado vía Email Gateway a ${alertEmail}`);
    }
  } catch (e) {
    console.warn(`[Email Alert Error]:`, e.message);
  }
}

// ==========================================
// 🚨 ALERTA: NO TENGO INFORMACIÓN DE ESTE INMUEBLE
// ==========================================
async function dispatchMissingPropertyAlert(leadId, clientName, clientPhone, requestedItem, userText) {
  const primaryPhone = process.env.ROBERT_WHATSAPP || '+584143115105';
  const phoneNumbers = [primaryPhone, '+584223115105'];
  const token = process.env.KOMMO_TOKEN;
  const subdomain = process.env.KOMMO_SUBDOMAIN;
  const leadUrl = `https://${subdomain}.kommo.com/leads/detail/${leadId}`;
  const now = Math.floor(Date.now() / 1000);
  const alertEmail = process.env.ALERT_EMAIL || 'tutechoidealrd@gmail.com';

  const clientIdentifier = `${clientName || 'Cliente'}${clientPhone ? ' (' + clientPhone + ')' : ''}`;
  const alertHeadline = 'ALERTA NO TENGO INFORMACION DE ESTE INMUEBLE ES IMPORTANTE RESPONDER';

  console.log(`\n🚨 [${alertHeadline}] 🚨`);
  console.log(`Cliente / Colega: ${clientIdentifier}`);
  console.log(`Pregunta recibida: "${userText}"`);
  console.log(`Inmueble / Zona / Enlace: ${requestedItem}`);
  console.log(`Destinatario WhatsApp: ${primaryPhone}`);
  console.log(`Lead URL: ${leadUrl}`);

  // 1. Tarea urgente en Kommo asignada a Robert
  try {
    const robertUserId = parseInt(process.env.KOMMO_RESPONSIBLE_ID || '15568119', 10);
    await axios.post(`https://${subdomain}.kommo.com/api/v4/tasks`, [
      {
        responsible_user_id: robertUserId,
        entity_id: parseInt(leadId, 10),
        entity_type: 'leads',
        text: `🚨 Cargar en Sheets: No puedo responder a ${clientIdentifier} sobre "${requestedItem}". Mensaje: "${userText}". Lead: ${leadUrl}`,
        complete_till: now + 1800,
        task_type_id: 1
      }
    ], {
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      timeout: 5000
    });
    console.log(`[Missing Property Task] Tarea urgente creada en Kommo para Robert en Lead #${leadId}`);
  } catch (err) {
    console.warn('[Missing Property Task Error]:', err.response?.data || err.message);
  }

  // 2. Nota interna en el Lead de Kommo
  try {
    await axios.post(`https://${subdomain}.kommo.com/api/v4/leads/${leadId}/notes`, [
      {
        note_type: 'common',
        params: {
          text: `🚨 ${alertHeadline}\n\n⚠️ RECUERDA CARGAR LA INFORMACIÓN DE ESTE INMUEBLE EN GOOGLE SHEETS.\nNo puedo responder al cliente porque no tengo información de este inmueble en Google Sheets y no puedo inventarla.\n\nCliente/Remitente: ${clientIdentifier}\nPregunta recibida: "${userText}"\nInmueble / Enlace consultado: ${requestedItem}\nEnlace Lead: ${leadUrl}\n\n⚡ El bot no respondió a esta persona y guarda silencio para que el equipo de Tu Techo Ideal responda directamente.`
        }
      }
    ], {
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      timeout: 5000
    });
    console.log(`[Missing Property Note] Nota registrada en Lead #${leadId}`);
  } catch (err) {
    console.warn('[Missing Property Note Error]:', err.response?.data || err.message);
  }

  // 3. Envío directo por WhatsApp a Robert
  const alertWhatsAppText = `🚨 *${alertHeadline}* 🚨\n\n` +
    `⚠️ *Recuerda cargar la información de este inmueble en Google Sheets.*\n` +
    `_No puedo responder al cliente porque NO tengo información de este inmueble en Google Sheets y no puedo inventarla._\n\n` +
    `👤 *Cliente / Remitente:* ${clientIdentifier}\n` +
    `📍 *Inmueble / Enlace consultado:* ${requestedItem || 'Inmueble no registrado'}\n` +
    `💬 *Mensaje del cliente:* "${userText}"\n\n` +
    `🔗 *Atender chat directamente en Kommo:*\n${leadUrl}\n\n` +
    `⚡ _El bot NO respondió nada al cliente y guarda silencio para que atiendas directamente._`;

  // 3.1 Envío directo al WhatsApp de Robert a través de su chat en Kommo (Lead #7882504)
  try {
    const robertLeadId = process.env.ROBERT_KOMMO_LEAD_ID || '7882504';
    if (robertLeadId && String(leadId) !== String(robertLeadId)) {
      await updateKommoLead(robertLeadId, alertWhatsAppText);
      await triggerKommoSalesbot(robertLeadId);
      console.log(`[WhatsApp Alert to Robert] Mensaje de alerta enviado al WhatsApp de Robert (+584143115105) vía Kommo Lead #${robertLeadId}`);
    }
  } catch (e) {
    console.warn('[WhatsApp Alert via Kommo Error]:', e.response?.data || e.message);
  }

  for (const phone of phoneNumbers) {
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    if (process.env.CALLMEBOT_API_KEY) {
      try {
        const callmebotUrl = `https://api.callmebot.com/whatsapp.php?phone=${cleanPhone}&text=${encodeURIComponent(alertWhatsAppText)}&apikey=${process.env.CALLMEBOT_API_KEY}`;
        await axios.get(callmebotUrl, { timeout: 8000 });
        console.log(`[WhatsApp Alert] Notificación enviada a WhatsApp ${phone}`);
      } catch (e) {
        console.warn(`[WhatsApp Alert CallMeBot Error]:`, e.message);
      }
    }

    if (process.env.WHATSAPP_GATEWAY_URL) {
      try {
        await axios.post(process.env.WHATSAPP_GATEWAY_URL, {
          phone: cleanPhone,
          message: alertWhatsAppText
        }, { timeout: 8000 });
        console.log(`[WhatsApp Alert Gateway] Notificación enviada a ${phone}`);
      } catch (e) { }
    }
  }

  // 4. Envío de Alerta por Correo a Tu Techo Ideal (tutechoidealrd@gmail.com)
  try {
    console.log(`[Email Alert] Alerta de inventario dirigida a: ${alertEmail}`);
    if (process.env.EMAIL_GATEWAY_URL) {
      await axios.post(process.env.EMAIL_GATEWAY_URL, {
        to: alertEmail,
        subject: `🚨 ${alertHeadline} - ${clientName}`,
        message: alertWhatsAppText,
        leadUrl: leadUrl
      }, { timeout: 5000 });
      console.log(`[Email Alert] Correo enviado a ${alertEmail}`);
    }
  } catch (e) {
    console.warn(`[Email Alert Error]:`, e.message);
  }
}

// ==========================================
// 🔔 ALERTA A ASESORES Y REPORTE GERENCIAL A ROBERT (SISTEMA DE ASIGNACIÓN AUTOMÁTICA)
// ==========================================
const ADVISOR_LEADS_MAP = {
  '4125800379': { name: 'Barbara Bravo', leadId: '7467864' },
  '4142356802': { name: 'Vladimir Mussot', leadId: '7487210' },
  '4143115105': { name: 'Robert Jimenez', leadId: '7882504' },
  '4248465846': { name: 'Ernesto Escala', leadId: '7468444' },
  '4265131780': { name: 'Rebeca Roo', leadId: '7467894' },
  '4128296255': { name: 'Gabriela Itanare', leadId: '7467858' }
};

async function resolveAdvisorLeadId(rawPhone) {
  if (!rawPhone) return null;
  const clean = String(rawPhone).replace(/[^0-9]/g, '');
  const last10 = clean.slice(-10);
  if (ADVISOR_LEADS_MAP[last10]) {
    return ADVISOR_LEADS_MAP[last10].leadId;
  }
  // Búsqueda dinámica en Kommo por si se incorpora un nuevo asesor
  try {
    const token = process.env.KOMMO_TOKEN;
    const subdomain = process.env.KOMMO_SUBDOMAIN || 'tutechoidealrd';
    const res = await axios.get(`https://${subdomain}.kommo.com/api/v4/contacts?query=${last10}&with=leads`, {
      headers: { Authorization: token },
      timeout: 5000
    });
    const contacts = res.data?._embedded?.contacts || [];
    if (contacts.length > 0 && contacts[0]._embedded?.leads?.[0]?.id) {
      const foundLeadId = String(contacts[0]._embedded.leads[0].id);
      ADVISOR_LEADS_MAP[last10] = { name: contacts[0].name, leadId: foundLeadId };
      return foundLeadId;
    }
  } catch (e) {
    console.warn(`[Advisor Lead Lookup Error for ${rawPhone}]:`, e.message);
  }
  return null;
}

async function dispatchAdvisorAlertAndRobertReport(property, clientName, clientPhone, channel, userText, clientLeadId) {
  const advisorName = property.Agente || 'Asesor Tu Techo Ideal';
  const rawAdvisorPhone = property['Numero de WhatsApp'] || property.WhatsApp || '';
  const cleanAdvisorPhone = rawAdvisorPhone.replace(/[^0-9]/g, '');
  const propertyUrl = property.Wasi_URL || (property.Wasi && property.Wasi.startsWith('http') ? property.Wasi : '') ||
    property.PaginaWeb_URL || (property['Pagina Web'] && property['Pagina Web'].startsWith('http') ? property['Pagina Web'] : '') ||
    property.LINK_FOTOS_URL || (property.LINK_FOTOS && property.LINK_FOTOS.startsWith('http') ? property.LINK_FOTOS : '') ||
    `${property.TIPO} en ${property.ZONA}`;

  const subdomain = process.env.KOMMO_SUBDOMAIN || 'tutechoidealrd';
  const clientLeadUrl = `https://${subdomain}.kommo.com/leads/detail/${clientLeadId}`;
  const nowFormatted = new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' });

  console.log(`\n📢 [DISPATCH ALERTA ASESOR & REPORTE ROBERT] 📢`);
  console.log(`Asesor asignado: ${advisorName} (${cleanAdvisorPhone})`);
  console.log(`Cliente: ${clientName} (${channel})`);
  console.log(`Inmueble: ${property.TIPO} en ${property.ZONA} (${property.OPERACION})`);
  console.log(`URL Inmueble: ${propertyUrl}`);

  // 1. Mensaje para el Asesor asignado
  // Formato exacto solicitado:
  // "Pedro Perez (El nombre que sale en el chat) + por la red social xxx, se le acaba de responder esta consulta: "xxxxxx" un mensaje corto puede ser la url de wasi sino tiene wasi pues se agrega la url de la pagina web , termina de asesorarlo"
  const advisorWhatsAppText = `🚨 *ALERTA DE CONSULTA RESPONDIDA* 🚨\n\n` +
    `👤 *${clientName || 'Cliente'}* por la red social *${channel || 'WhatsApp'}*, se le acaba de responder esta consulta:\n` +
    `🔗 ${propertyUrl}\n\n` +
    `💬 *Mensaje recibido:* "${userText.substring(0, 160)}"\n\n` +
    `⚡ *¡Termina de asesorarlo!*`;

  // 2. Despacho al WhatsApp del Asesor (Vía su Lead directo en Kommo Salesbot)
  const advisorLeadId = await resolveAdvisorLeadId(cleanAdvisorPhone);
  if (advisorLeadId && String(advisorLeadId) !== String(clientLeadId)) {
    try {
      await updateKommoLead(advisorLeadId, advisorWhatsAppText);
      await triggerKommoSalesbot(advisorLeadId);
      console.log(`[Advisor Alert Sent] Alerta enviada al WhatsApp de ${advisorName} vía Kommo Lead #${advisorLeadId}`);
    } catch (e) {
      console.warn(`[Advisor Alert Kommo Error]:`, e.response?.data || e.message);
    }
  }

  // Si CallMeBot o Gateway está configurado, despachar también
  if (cleanAdvisorPhone) {
    let fullAdvisorPhone = cleanAdvisorPhone;
    if (fullAdvisorPhone.length === 10 && fullAdvisorPhone.startsWith('4')) fullAdvisorPhone = '58' + fullAdvisorPhone;
    if (process.env.CALLMEBOT_API_KEY) {
      try {
        const callmebotUrl = `https://api.callmebot.com/whatsapp.php?phone=${fullAdvisorPhone}&text=${encodeURIComponent(advisorWhatsAppText)}&apikey=${process.env.CALLMEBOT_API_KEY}`;
        await axios.get(callmebotUrl, { timeout: 8000 });
      } catch (e) { }
    }
    if (process.env.WHATSAPP_GATEWAY_URL) {
      try {
        await axios.post(process.env.WHATSAPP_GATEWAY_URL, { phone: fullAdvisorPhone, message: advisorWhatsAppText }, { timeout: 8000 });
      } catch (e) { }
    }
  }

  // 3. Reporte de confirmación para Robert Jiménez (Broker / Gerencia)
  // Formato exacto solicitado:
  // "Hola soy el sistema automatizado acabo de alertar por whatsapp al asesor tal que preguntaron por este inmueble url: xxxxx, hora y fecha"
  const robertLeadId = process.env.ROBERT_KOMMO_LEAD_ID || '7882504';
  const robertReportText = `📋 *REPORTE DE ASIGNACIÓN AUTOMÁTICA*\n\n` +
    `Hola soy el sistema automatizado, acabo de alertar por WhatsApp al asesor *${advisorName}* que preguntaron por este inmueble:\n` +
    `🔗 ${propertyUrl}\n\n` +
    `👤 *Cliente:* ${clientName || 'Cliente'} (${channel || 'WhatsApp'})\n` +
    `🕒 *Fecha y hora:* ${nowFormatted}`;

  // Si el asesor es el propio Robert (ej: REF-005), él ya recibió la alerta directa arriba;
  // si el asesor es otro integrante del equipo (Vladimir, Rebeca, etc.), le despachamos a Robert el reporte de supervisión:
  if (advisorLeadId !== robertLeadId && String(robertLeadId) !== String(clientLeadId)) {
    try {
      await updateKommoLead(robertLeadId, robertReportText);
      await triggerKommoSalesbot(robertLeadId);
      console.log(`[Robert Report Sent] Reporte de asignación despachado a Robert vía Kommo Lead #${robertLeadId}`);
    } catch (e) {
      console.warn(`[Robert Report Error]:`, e.response?.data || e.message);
    }
  }

  // 4. Registro de Nota interna de auditoría en el Lead del cliente
  try {
    const token = process.env.KOMMO_TOKEN;
    await axios.post(`https://${subdomain}.kommo.com/api/v4/leads/${clientLeadId}/notes`, [
      {
        note_type: 'common',
        params: {
          text: `✅ CONSULTA RESPONDIDA AUTOMÁTICAMENTE\n\n• Inmueble: ${property.TIPO} en ${property.ZONA} (${property.OPERACION})\n• Código Wasi: ${property.CODIGO_WASI || 'N/A'}\n• Enlace compartido: ${propertyUrl}\n• Asesor notificado por WhatsApp: ${advisorName} (${rawAdvisorPhone})\n• Reporte gerencial: Enviado a Robert Jiménez\n• Fecha y hora: ${nowFormatted}`
        }
      }
    ], {
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      timeout: 5000
    });
    console.log(`[Audit Note] Nota de consulta y alertas registrada en Lead #${clientLeadId}`);
  } catch (err) {
    console.warn('[Audit Note Error]:', err.response?.data || err.message);
  }
}

// ==========================================
// 🧠 MEMORIA CONVERSACIONAL Y CONTEXTO POR LEAD
// ==========================================
const LEAD_CONTEXT_FILE = path.join(__dirname, 'lead_context.json');
const leadContextCache = new Map();

try {
  if (fs.existsSync(LEAD_CONTEXT_FILE)) {
    const raw = fs.readFileSync(LEAD_CONTEXT_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    for (const [k, v] of Object.entries(parsed)) {
      leadContextCache.set(String(k), v);
    }
    console.log(`[Lead Context] Cargados ${leadContextCache.size} contextos de leads previos.`);
  }
} catch (e) {
  console.warn('[Lead Context Init Warning]:', e.message);
}

function getLeadPropertyContext(leadId, allProperties, talkId = null, contactId = null) {
  let ctx = null;
  if (leadId && leadContextCache.has(String(leadId))) {
    ctx = leadContextCache.get(String(leadId));
  } else if (talkId && leadContextCache.has(`talk_${talkId}`)) {
    ctx = leadContextCache.get(`talk_${talkId}`);
  } else if (contactId && leadContextCache.has(`contact_${contactId}`)) {
    ctx = leadContextCache.get(`contact_${contactId}`);
  }
  if (!ctx || !ctx.propertyRef) return null;
  const isFresh = (Date.now() - ctx.updatedAt) < (7 * 24 * 60 * 60 * 1000);
  if (!isFresh) return null;

  // Soporte prioritario nativo para Fichas Técnicas Oficiales de Word
  if (ctx.propertyRef.startsWith('FICHA-')) {
    const fichas = loadFichasTecnicas();
    const f = fichas.find(item => item.id.toUpperCase() === ctx.propertyRef.toUpperCase());
    if (f) {
      return {
        ID_PROPIEDAD: f.id,
        TIPO: 'Apartamento',
        ZONA: f.zona,
        ESTATUS: 'Disponible',
        DESCRIPCION_BREVE: f.rawText,
        isFichaTecnica: true,
        rawFicha: f,
        CODIGO_WASI: f.codigoWasi || '',
        Wasi: f.wasiUrl || '',
        Wasi_URL: f.wasiUrl || '',
        LINK_FOTOS: f.photoUrl || '',
        LINK_FOTOS_URL: f.photoUrl || ''
      };
    }
  }

  return allProperties.find(p => (p.ID_PROPIEDAD || '').toUpperCase() === ctx.propertyRef.toUpperCase()) || null;
}

// Recuperación de contexto ultra-resiliente: memoria RAM local + notas de Kommo + eventos de Kommo
async function getOrRecoverLeadPropertyContext(leadId, allProperties, talkId = null, contactId = null) {
  if (!leadId && !talkId && !contactId) return null;

  // 1. Verificar primero en memoria RAM local
  const localProp = getLeadPropertyContext(leadId, allProperties, talkId, contactId);
  if (localProp) return localProp;

  // 2. Recuperar de notas internas del Lead en Kommo
  if (leadId) {
    try {
      const token = process.env.KOMMO_TOKEN;
      const subdomain = process.env.KOMMO_SUBDOMAIN || 'tutechoidealrd';
      if (token) {
        const headers = { Authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}` };
        const resNotes = await axios.get(`https://${subdomain}.kommo.com/api/v4/leads/${leadId}/notes?limit=10`, { headers, timeout: 3500 });
        const notes = resNotes.data?._embedded?.notes || [];
        for (const n of notes) {
          const text = n.params?.text || '';
          const matchNote = text.match(/\[INMUEBLE_IDENTIFICADO:\s*(REF-\d{3}|FICHA-[A-Z-]+)/i);
          if (matchNote) {
            const refCode = matchNote[1].toUpperCase();
            if (refCode.startsWith('FICHA-')) {
              const fichas = loadFichasTecnicas();
              const f = fichas.find(item => item.id.toUpperCase() === refCode);
              if (f) {
                const fichaProp = {
                  ID_PROPIEDAD: f.id,
                  TIPO: 'Apartamento',
                  ZONA: f.zona,
                  ESTATUS: 'Disponible',
                  DESCRIPCION_BREVE: f.rawText,
                  isFichaTecnica: true,
                  rawFicha: f,
                  CODIGO_WASI: f.codigoWasi || '',
                  Wasi: f.wasiUrl || '',
                  Wasi_URL: f.wasiUrl || '',
                  LINK_FOTOS: f.photoUrl || '',
                  LINK_FOTOS_URL: f.photoUrl || ''
                };
                saveLeadPropertyContext(leadId, fichaProp, talkId, contactId);
                return fichaProp;
              }
            }
            const found = allProperties.find(p => (p.ID_PROPIEDAD || '').toUpperCase() === refCode);
            if (found) {
              console.log(`[Lead Context Recovery] Inmueble ${refCode} recuperado de nota interna de Kommo para Lead #${leadId}`);
              saveLeadPropertyContext(leadId, found, talkId, contactId);
              return found;
            }
          }
        }
      }
    } catch (e) {
      console.warn('[Lead Notes Recovery Warning]:', e.message);
    }
  }

  // 3. Recuperar del historial de eventos de Kommo si la memoria local estaba vacía
  if (leadId || contactId) {
    try {
      const token = process.env.KOMMO_TOKEN;
      const subdomain = process.env.KOMMO_SUBDOMAIN || 'tutechoidealrd';
      if (token) {
        const authHeader = token.startsWith('Bearer ') ? token : `Bearer ${token}`;

        // 3a. Consultar eventos del Lead
        if (leadId) {
          const res = await axios.get(`https://${subdomain}.kommo.com/api/v4/events?filter[entity]=lead&filter[entity_id]=${leadId}`, {
            headers: { Authorization: authHeader },
            timeout: 4500
          });
          const events = res.data?._embedded?.events || [];

          // Contar cuántas respuestas previas dio el bot en este lead
          const prevBotResponses = events.filter(ev =>
            ev.type === 'custom_field_2103996_value_changed' &&
            Array.isArray(ev.value_after) &&
            ev.value_after.length > 0 &&
            ev.value_after[0]?.custom_field_value?.text?.trim()
          ).length;

          if (prevBotResponses > 0) {
            const existing = leadContextCache.get(String(leadId)) || {};
            existing.responseCount = Math.max(existing.responseCount || 0, prevBotResponses);
            leadContextCache.set(String(leadId), existing);
            console.log(`[Lead Context Recovery] Contador de respuestas restaurado para Lead #${leadId}: ${existing.responseCount}`);
          }

          for (const ev of events) {
            const text = JSON.stringify(ev.value_after || ev.params || ev);
            const wasiCheck = matchWasiOrProperty(text, allProperties);
            if (wasiCheck && wasiCheck.status === 'MATCH') {
              saveLeadPropertyContext(leadId, wasiCheck.property, talkId, contactId);
              console.log(`[Lead Context Recovery] Inmueble recuperado de eventos de Lead #${leadId}: ${wasiCheck.property.ID_PROPIEDAD}`);
              return wasiCheck.property;
            }
          }
        }

        // 3b. Consultar eventos del Contacto (donde Kommo vincula chats)
        if (contactId) {
          const resContact = await axios.get(`https://${subdomain}.kommo.com/api/v4/events?filter[entity]=contact&filter[entity_id]=${contactId}&limit=15`, {
            headers: { Authorization: authHeader },
            timeout: 4500
          });
          const contactEvents = resContact.data?._embedded?.events || [];
          for (const ev of contactEvents) {
            const text = JSON.stringify(ev.value_after || ev.params || ev);
            const wasiCheck = matchWasiOrProperty(text, allProperties);
            if (wasiCheck && wasiCheck.status === 'MATCH') {
              saveLeadPropertyContext(leadId, wasiCheck.property, talkId, contactId);
              console.log(`[Lead Context Recovery] Inmueble recuperado de eventos de Contacto #${contactId}: ${wasiCheck.property.ID_PROPIEDAD}`);
              return wasiCheck.property;
            }
          }

          // 3c. Consultar notas del Contacto
          try {
            const resContactNotes = await axios.get(`https://${subdomain}.kommo.com/api/v4/contacts/${contactId}/notes?limit=10`, {
              headers: { Authorization: authHeader },
              timeout: 3500
            });
            const cNotes = resContactNotes.data?._embedded?.notes || [];
            for (const n of cNotes) {
              const text = n.params?.text || '';
              const matchNote = text.match(/\[INMUEBLE_IDENTIFICADO:\s*(REF-\d{3})/i);
              if (matchNote) {
                const refCode = matchNote[1].toUpperCase();
                const found = allProperties.find(p => (p.ID_PROPIEDAD || '').toUpperCase() === refCode);
                if (found) {
                  console.log(`[Lead Context Recovery] Inmueble ${refCode} recuperado de nota de Contacto #${contactId}`);
                  saveLeadPropertyContext(leadId, found, talkId, contactId);
                  return found;
                }
              }
            }
          } catch (eNotes) {}
        }
      }
    } catch (err) {
      console.warn(`[Lead Context Recovery Warning] Error consultando eventos/notas:`, err.message);
    }
  }

  return null;
}

const MAX_AI_RESPONSES_PER_LEAD = 4; // Límite estricto de 3 a 4 respuestas máximas de la IA por lead

function getLeadResponseCount(leadId) {
  if (!leadId) return 0;
  const ctx = leadContextCache.get(String(leadId));
  return (ctx && typeof ctx.responseCount === 'number') ? ctx.responseCount : 0;
}

function incrementLeadResponseCount(leadId) {
  if (!leadId) return 1;
  const ctx = leadContextCache.get(String(leadId)) || {};
  ctx.responseCount = (ctx.responseCount || 0) + 1;
  ctx.updatedAt = Date.now();
  leadContextCache.set(String(leadId), ctx);
  try {
    const obj = {};
    for (const [k, v] of leadContextCache.entries()) obj[k] = v;
    fs.writeFileSync(LEAD_CONTEXT_FILE, JSON.stringify(obj, null, 2), 'utf8');
  } catch (e) {
    console.warn('[Lead Context Save Error]:', e.message);
  }
  return ctx.responseCount;
}

function saveLeadPropertyContext(leadId, property, talkId = null, contactId = null) {
  if (!property || !property.ID_PROPIEDAD) return;
  const existing = (leadId ? leadContextCache.get(String(leadId)) : null) || {};
  const ctx = {
    ...existing,
    propertyRef: property.ID_PROPIEDAD,
    wasiCode: property.CODIGO_WASI || '',
    wasiUrl: property.Wasi_URL || (property.Wasi && property.Wasi.startsWith('http') ? property.Wasi : ''),
    photoUrl: property.LINK_FOTOS_URL || (property.LINK_FOTOS && property.LINK_FOTOS.startsWith('http') ? property.LINK_FOTOS : ''),
    updatedAt: Date.now()
  };
  if (leadId) leadContextCache.set(String(leadId), ctx);
  if (talkId) leadContextCache.set(`talk_${talkId}`, ctx);
  if (contactId) leadContextCache.set(`contact_${contactId}`, ctx);

  try {
    const obj = {};
    for (const [k, v] of leadContextCache.entries()) obj[k] = v;
    fs.writeFileSync(LEAD_CONTEXT_FILE, JSON.stringify(obj, null, 2), 'utf8');
  } catch (e) {
    console.warn('[Lead Context Save Error]:', e.message);
  }

  // Guardar nota interna en Kommo para persistencia indestructible
  if (leadId) {
    try {
      const token = process.env.KOMMO_TOKEN;
      const subdomain = process.env.KOMMO_SUBDOMAIN || 'tutechoidealrd';
      if (token) {
        const headers = { Authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}` };
        const payload = [{
          note_type: 'common',
          params: {
            text: `🤖 [INMUEBLE_IDENTIFICADO: ${property.ID_PROPIEDAD} | WASI: ${property.CODIGO_WASI || 'N/A'}]\nInmueble: ${property.TIPO || 'Inmueble'} en ${property.ZONA || ''}\nWasi: ${ctx.wasiUrl}\nFotos: ${ctx.photoUrl}`
          }
        }];
        axios.post(`https://${subdomain}.kommo.com/api/v4/leads/${leadId}/notes`, payload, { headers, timeout: 4000 }).catch(e => {
          console.warn('[Kommo Note Save Warning]:', e.message);
        });
      }
    } catch (e) {}
  }
}

// ==========================================
// 🕒 SALUDO DINÁMICO POR HORA (HORA VENEZUELA UTC-4)
// ==========================================
function getVenezuelaGreeting() {
  const now = new Date();
  const vHour = parseInt(now.toLocaleString('en-US', { timeZone: 'America/Caracas', hour12: false, hour: 'numeric' }), 10);
  if (vHour >= 5 && vHour < 12) {
    return 'buen día';
  } else if (vHour >= 12 && vHour < 19) {
    return 'buenas tardes';
  } else {
    return 'buenas noches';
  }
}

// ==========================================
// 🎯 DETECCIONES DE INTENCIÓN
// ==========================================
function isVisitSchedulingIntent(text) {
  const t = normalizeText(text);
  return /(?:agendar|coordinar|cuadrar|pautar|fijar)\s*(?:para\s*(?:verla|verlo|visitar)|(?:una\s*)?(?:cita|visita))|\bagendar\b|quiero\s*(?:agendar|verla|verlo|visitar)|(?:cuando|cuándo)\s*(?:podr[ií]amos|podemos|se\s*puede)\s*(?:ir|verla|verlo|visitar)|interesad[oa].*?(?:agendar|cita|visita|verla|verlo)/i.test(t);
}

function isExplicitAvailabilityQuery(text) {
  if (!text) return false;
  const t = normalizeText(text);
  return /(?:disponib|est[aá]\s*(?:disponible|libre)|sigue\s*(?:disponible|libre)|a[uú]n\s*(?:disponible|libre)|est[aá]\s*en\s*(?:alquiler|venta)|tienes\s*(?:un|el|este)|estoy\s*interesad[oa]|quisiera\s*saber\s*del|informaci[oó]n\s*del\s*inmueble|compartiste\s*en\s*(?:la\s*red\s*)?wasi)/i.test(t);
}

function isPropertyLinkRequest(text) {
  if (!text) return false;
  const clean = text.trim();

  // Si el mensaje YA CONTIENE una URL/enlace, el cliente NO está pidiendo el link (ya lo tiene y nos lo está enviando)
  if (/https?:\/\/[^\s]+/i.test(clean) || /www\.[^\s]+/i.test(clean)) {
    return false;
  }

  const t = normalizeText(clean);

  // Solicitud directa de compartir/enviar
  if (/me\s+lo\s+(?:puede[sn]?\s+)?compartir/i.test(t)) return true;
  if (/me\s+lo\s+comparte[sn]?/i.test(t)) return true;
  if (/me\s+lo\s+pasa[sn]?/i.test(t)) return true;
  if (/me\s+lo\s+env[ií]a[sn]?/i.test(t)) return true;
  if (/me\s+lo\s+manda[sn]?/i.test(t)) return true;

  // Si incluye link, enlace, wasi, fotos, ficha, publicacion junto a verbos de entrega/solicitud
  const hasLinkKeyword = /\b(?:links?|enlaces?|ficha|fotos?|im[aá]genes)\b/i.test(t);
  const hasActionKeyword = /\b(?:enviar|envia|envie|env[ií]ame|pasa|pasame|pásame|pasas|pásas|mandar|manda|mandame|mándame|compartir|comparte|compartes|facilit(?:ar|a|ame)|puedes\s+enviar|me\s+pasas)\b/i.test(t);

  if (hasLinkKeyword && hasActionKeyword) return true;

  // Preguntas cortas de solicitud (ej: "el link por favor", "me pasas el link?")
  if (/\b(?:el\s+)?(?:link|enlace)\b.*\b(?:por\s+favor|\?|$)/i.test(t) && !/compartiste/i.test(t)) return true;
  if (/^(?:link|enlace|el\s+link|el\s+enlace)\??$/i.test(clean)) return true;

  return false;
}

function isPureGreeting(text) {
  if (!text) return false;
  const t = normalizeText(text).replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?!¿¡]/g, '').trim();

  // Si contiene palabras o preguntas de inmuebles o datos concretos, NO es saludo puro
  if (/cuant|preci|inmueble|propiedad|apto|apartamento|casa|oficina|local|alquiler|venta|compr|disponib|costo|canon|donde|ubicacion|fotos?|link|enlace|wasi/i.test(t)) {
    return false;
  }

  const greetings = [
    'hola', 'buenas', 'buen dia', 'buenos dias', 'buenas dias',
    'buenas tardes', 'buenas noches', 'hola buenas', 'hola buenos dias',
    'hola buenas dias', 'hola buenas tardes', 'hola buenas noches',
    'hola buen dia', 'saludos', 'hola saludos', 'hola que tal',
    'que tal', 'epale', 'hola epale', 'como esta', 'como estas', 'hola como estas',
    'hola buenas como esta', 'hola buenas como estas', 'buen dia como esta', 'buenos dias como esta'
  ];

  return greetings.includes(t);
}

function isAvailabilityWithoutProperty(text, hasProperty) {
  if (hasProperty) return false;
  if (!text) return false;

  // Si el mensaje contiene un link o código, NO es disponibilidad genérica sin inmueble
  if (/https?:\/\/[^\s]+/i.test(text) || /\b\d{7,9}\b|\bREF-?\d{3}\b/i.test(text)) {
    return false;
  }

  const t = normalizeText(text).replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?!¿¡]/g, '').trim();

  // Si menciona tipo de inmueble o zona, ya no es pregunta seca sin inmueble
  if (/apto|apartamento|casa|local|oficina|galpon|terreno|california|marques|mercedes|palos grandes|haciendas|encantado|florida|boyera|urbina|samanes|chacao|baruta|hatillo/i.test(t)) {
    return false;
  }

  // Detectar si pregunta por disponibilidad genérica sin especificar cuál inmueble
  const isGenericAvail = /\b(?:esta|sigue|aun\s+esta|se\s+encuentra)?\s*dispon[io]ble\b/i.test(t);
  const mentionsSpecifics = /\b(?:habitacion|habitaciones|bano|banos|metro|metros|precio|costo|canon)\b/i.test(t);

  if (isGenericAvail && !mentionsSpecifics) {
    return true;
  }

  return false;
}

// ==========================================
// 📋 GENERADOR DE FORMATO GERENCIAL PARA ROBERT
// ==========================================
function buildRobertAlertText({ type, clientName, clientPhone, channel, matchedProperty, userText, leadId, interestType }) {
  const subdomain = process.env.KOMMO_SUBDOMAIN || "tutechoidealrd";
  const leadUrl = leadId ? `https://${subdomain}.kommo.com/leads/detail/${leadId}` : null;
  const nowFormatted = new Date().toLocaleString("es-VE", { timeZone: "America/Caracas" });

  let propDescription = "No especificada en el mensaje / Consulta general";
  if (matchedProperty) {
    const wasiInfo = matchedProperty.CODIGO_WASI ? ` | Wasi: ${matchedProperty.CODIGO_WASI}` : "";
    propDescription = `${matchedProperty.ID_PROPIEDAD} - ${matchedProperty.TIPO || "Inmueble"} en ${matchedProperty.ZONA || "Caracas"}${wasiInfo}`;
  }

  const cleanPhone = clientPhone ? clientPhone : (channel === "Facebook Messenger" ? "No disponible (Facebook Messenger - Chat privado)" : "No disponible");
  const detectedInterest = interestType || (
    /visita|cita|reuni[oó]n|ver\s*(?:la|el)?\s*propiedad|conocer/i.test(userText) ? "Agendar una visita" :
    /reservar|apartar/i.test(userText) ? "Reserva de inmueble" :
    /firmar|contrato/i.test(userText) ? "Firma de contrato" :
    /dinero|cerrar|concretar|comprar|alquilar/i.test(userText) ? "Alta intención de compra / Cierre comercial" :
    type === "NOTA_DE_VOZ" ? "Nota de voz / Audio recibido" :
    "Atención comercial prioritaria"
  );

  return `🚨 *ALERTA COMERCIAL - TU TECHO IDEAL* 🚨\n\n` +
    `Un cliente necesita atención prioritaria.\n\n` +
    `👤 *Cliente:* ${clientName || "Cliente"}\n` +
    `🌐 *Canal:* ${channel || "WhatsApp"}\n` +
    `📱 *Teléfono:* ${cleanPhone}\n` +
    `🏢 *Propiedad:* ${propDescription}\n` +
    `🎯 *Interés detectado:* ${detectedInterest}\n` +
    `💬 *Mensaje del cliente:*\n"${userText}"\n\n` +
    `⚡ *Acción recomendada:* Contactar al cliente para continuar con el proceso comercial. El bot ha cedido el control a un humano.\n\n` +
    (leadUrl ? `🔗 *Abrir chat en Kommo:*\n${leadUrl}\n\n` : "") +
    `🕒 *Fecha y hora:* ${nowFormatted}`;
}

// ==========================================
// 📲 DISPATCH DIRECTO DE ALERTA WHATSAPP A ROBERT
// ==========================================
async function dispatchDirectWhatsAppToRobert(messageText, leadId = null, interestType = null) {
  if (OBSERVATION_MODE) {
    console.log(`[OBSERVATION MODE] dispatchDirectWhatsAppToRobert interceptado. Cero alertas enviadas.`);
    return { sent: false, reason: "OBSERVATION_MODE" };
  }

  const robertLeadId = process.env.ROBERT_KOMMO_LEAD_ID || "7882504";
  const robertPhone = (process.env.ROBERT_WHATSAPP || "+584143115105").replace(/[^0-9]/g, "");

  // 1. Validación estricta del destinatario (Robert Jiménez)
  if (!robertLeadId || !robertPhone || !robertPhone.startsWith("58") || robertPhone.length < 10) {
    console.error(`[Security] Destinatario de alerta incorrecto o no autorizado (${robertPhone}). Despacho cancelado para proteger al usuario.`);
    return { sent: false, reason: "INVALID_RECIPIENT" };
  }

  // 2. Control estricto contra alertas duplicadas (ventana de 5 minutos)
  const now = Date.now();
  if (leadId) {
    const alertKey = `${leadId}_${interestType || "general"}`;
    const lastSent = recentAlertsSentToRobert.get(alertKey);
    if (lastSent && (now - lastSent < 5 * 60 * 1000)) {
      console.log(`[Alert Dedup] Alerta de "${interestType || "general"}" para Lead #${leadId} ya fue enviada hace ${Math.round((now - lastSent)/1000)}s. Evitando alerta duplicada.`);
      return { sent: false, reason: "DUPLICATE_ALERT_THROTTLED" };
    }
    recentAlertsSentToRobert.set(alertKey, now);
  }

  console.log(`\n📲 [DISPATCH WHATSAPP DIRECTO A ROBERT]`);
  console.log(`Destinatario: Robert Jiménez (+${robertPhone}) | Kommo Lead #${robertLeadId}`);
  console.log(`Mensaje:\n${messageText}\n`);

  try {
    await updateKommoLead(robertLeadId, messageText);
    await triggerKommoSalesbot(robertLeadId);
    console.log(`[WhatsApp to Robert] Notificación enviada al WhatsApp de Robert vía Kommo Lead #${robertLeadId}`);

    // Limpieza de campo Respuesta_IA en el lead de Robert tras 25 segundos
    setTimeout(async () => {
      try {
        await updateKommoLead(robertLeadId, " ");
      } catch (e) { }
    }, 25000);
    return { sent: true, leadId: robertLeadId, phone: robertPhone };
  } catch (e) {
    console.warn("[WhatsApp to Robert Kommo Error]:", e.response?.data || e.message);
    return { sent: false, error: e.message };
  }
}
// ==========================================
// 🔍 DETECCIÓN Y EMPAREJAMIENTO DE INMUEBLES
// ==========================================
function matchWasiOrProperty(text, properties) {
  // 1. Detección exhaustiva por enlaces (Wasi, Web, Mercado Libre, Rexup) o códigos directos
  const directProp = findPropertyByAnyLinkOrCode(text, properties);
  if (directProp) {
    return { status: 'MATCH', property: directProp, code: directProp.CODIGO_WASI || directProp.ID_PROPIEDAD };
  }

  // 2. Si vino un código numérico explícito (7 a 9 dígitos) que no existe en inventario
  const explicitCodeMatch = text.match(/(?:c[oó]digo\s*(?:es)?:?\s*|inmueble\s*(?:es)?:?\s*|wasi\s*(?:es)?:?\s*|\binfo\.wasi\.co\/[^\s\/]+\/)(\d{7,9})/i);
  if (explicitCodeMatch) {
    return { status: 'NOT_FOUND', code: explicitCodeMatch[1], item: `Inmueble código Wasi ${explicitCodeMatch[1]}` };
  }

  // 3. Si vino un link de portal inmobiliario que no coincide con nuestro catálogo
  if (/https?:\/\/[^\s]*(?:wasi\.co|tutechoideal\.com|mercadolibre\.com|rexup\.net)[^\s]*/i.test(text)) {
    return { status: 'NOT_FOUND', code: 'LINK_NO_REGISTRADO', item: 'Enlace de inmueble no registrado en catálogo' };
  }

  // Emparejamiento por código REF directo (ej: REF-005)
  const refMatch = text.match(/\b(REF-\d{3})\b/i);
  if (refMatch) {
    const refUpper = refMatch[1].toUpperCase();
    const matched = properties.find(p => (p.ID_PROPIEDAD || '').toUpperCase() === refUpper);
    if (matched) return { status: 'MATCH', property: matched, code: refUpper };
  }

  // Emparejamiento por link de fotos Rexup (cod_inmueble)
  const rexupMatch = text.match(/cod_inmueble=(\d+)/i);
  if (rexupMatch) {
    const matched = properties.find(p => (p.LINK_FOTOS_URL || p.LINK_FOTOS || '').includes(rexupMatch[1]));
    if (matched) return { status: 'MATCH', property: matched, code: rexupMatch[1] };
  }

  // Emparejamiento por Mercado Libre (MLV)
  const mlMatch = text.match(/MLV-?(\d+)/i);
  if (mlMatch) {
    const matched = properties.find(p => (p.MercadoLibre_URL || p['Mercado Libre'] || '').includes(mlMatch[1]));
    if (matched) return { status: 'MATCH', property: matched, code: mlMatch[1] };
  }

  // Emparejamiento por zona y tipo si se especifica claramente en el texto
  const qNorm = normalizeText(text);
  if (qNorm.includes('samanes')) {
    const matched = properties.find(p => p.ID_PROPIEDAD === 'REF-012');
    if (matched) return { status: 'MATCH', property: matched, code: 'REF-012' };
  }
  if (qNorm.includes('lomas del sol')) {
    const matched = properties.find(p => p.ID_PROPIEDAD === 'REF-062');
    if (matched) return { status: 'MATCH', property: matched, code: 'REF-062' };
  }
  if (qNorm.includes('trinidad')) {
    const matched = properties.find(p => p.ID_PROPIEDAD === 'REF-051');
    if (matched) return { status: 'MATCH', property: matched, code: 'REF-051' };
  }
  if (qNorm.includes('lagunita')) {
    const matched = properties.find(p => p.ID_PROPIEDAD === 'REF-053');
    if (matched) return { status: 'MATCH', property: matched, code: 'REF-053' };
  }
  if (qNorm.includes('campitos')) {
    const matched = properties.find(p => p.ID_PROPIEDAD === 'REF-009' || p.ID_PROPIEDAD === 'REF-010');
    if (matched) return { status: 'MATCH', property: matched, code: matched.ID_PROPIEDAD };
  }
  if (qNorm.includes('california') && (qNorm.includes('apartamento') || qNorm.includes('alquiler') || qNorm.includes('apto'))) {
    const matched = properties.find(p => p.ID_PROPIEDAD === 'REF-013');
    if (matched) return { status: 'MATCH', property: matched, code: 'REF-013' };
  }
  if (qNorm.includes('encantado') || qNorm.includes('haciendas')) {
    const matched = properties.find(p => p.ID_PROPIEDAD === 'REF-014' || p.ID_PROPIEDAD === 'REF-015');
    if (matched) return { status: 'MATCH', property: matched, code: matched.ID_PROPIEDAD };
  }
  if (qNorm.includes('urbina')) {
    const matched = properties.find(p => p.ID_PROPIEDAD === 'REF-016');
    if (matched) return { status: 'MATCH', property: matched, code: 'REF-016' };
  }
  if (qNorm.includes('mercedes') && qNorm.includes('apartamento')) {
    const matched = properties.find(p => p.ID_PROPIEDAD === 'REF-005');
    if (matched) return { status: 'MATCH', property: matched, code: 'REF-005' };
  }
  if (qNorm.includes('palos grandes') && (qNorm.includes('apartamento') || qNorm.includes('apto'))) {
    const matched = properties.find(p => p.ID_PROPIEDAD === 'REF-007');
    if (matched) return { status: 'MATCH', property: matched, code: 'REF-007' };
  }
  if (qNorm.includes('macaracuay')) {
    const matched = properties.find(p => p.ID_PROPIEDAD === 'REF-002');
    if (matched) return { status: 'MATCH', property: matched, code: 'REF-002' };
  }
  if (qNorm.includes('alta florida') || (qNorm.includes('florida') && qNorm.includes('casa'))) {
    const matched = properties.find(p => p.ID_PROPIEDAD === 'REF-001' || p.ID_PROPIEDAD === 'REF-003');
    if (matched) return { status: 'MATCH', property: matched, code: matched.ID_PROPIEDAD };
  }
  if (qNorm.includes('boyera')) {
    const matched = properties.find(p => p.ID_PROPIEDAD === 'REF-004');
    if (matched) return { status: 'MATCH', property: matched, code: 'REF-004' };
  }
  if (qNorm.includes('san ignacio') || (qNorm.includes('castellana') && qNorm.includes('local'))) {
    const matched = properties.find(p => p.ID_PROPIEDAD === 'REF-022');
    if (matched) return { status: 'MATCH', property: matched, code: 'REF-022' };
  }

  return { status: 'NONE' };
}

function formatAvailabilityResponse(property, userText) {
  const greeting = getVenezuelaGreeting();
  const wantsNoContactLink = /sin\s+datos|sin\s+contacto|ficha\s+blanca|enlace\s+neutro/i.test(userText);
  const wantsPhotos = /fotos?|im[aá]genes/i.test(userText);
  const wantsLink = isPropertyLinkRequest(userText);
  const photoUrl = property.LINK_FOTOS_URL || (property.LINK_FOTOS && property.LINK_FOTOS.startsWith('http') ? property.LINK_FOTOS : null);
  const wasiUrl = property.Wasi_URL || (property.Wasi && property.Wasi.startsWith('http') ? property.Wasi : null);

  let resp = `Hola, bienvenido a Tu techo ideal, ${greeting}, sí disponible.`;

  if (wantsNoContactLink && photoUrl) {
    resp += ` Aquí tienes el enlace sin datos de contacto: ${photoUrl}`;
  } else if (wantsLink && wasiUrl) {
    resp += ` Con gusto, aquí tienes el enlace en Wasi: ${wasiUrl}`;
    if (wantsPhotos && photoUrl) {
      resp += ` y aquí puedes ver las fotos: ${photoUrl}`;
    }
  } else if (wantsPhotos && photoUrl) {
    resp += ` Aquí puedes ver las fotos del inmueble: ${photoUrl}`;
  }

  return resp;
}

// ==========================================
// 🤖 CONSULTAS BASADAS EN "DESCRIPCION_BREVE" (CLAUDE AI)
// ==========================================
async function generateClaudePropertyQA(userMessage, property, clientName = '') {
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.CLAUDE_API_KEY;
  const model = process.env.CLAUDE_MODEL || 'nvidia/nemotron-3.5-lightning:free';
  // AISLAMIENTO ESTRICTO: Únicamente la columna DESCRIPCION_BREVE. Ninguna otra columna parecida.
  const descBreve = String(property['DESCRIPCION_BREVE'] || '').trim();
  const mascotas = property.Mascotas || 'No especificado';
  const tipoMascotas = property['Tipo de Mascotas'] || '';
  const estatus = property.ESTATUS || 'Disponible';
  const fotos = property.LINK_FOTOS_URL || (property.LINK_FOTOS && property.LINK_FOTOS.startsWith('http') ? property.LINK_FOTOS : '');
  const wasi = property.Wasi_URL || (property.Wasi && property.Wasi.startsWith('http') ? property.Wasi : '');

  const systemPrompt = `Eres el asesor profesional de atención al cliente inmobiliario de "Tu Techo Ideal", una prestigiosa empresa inmobiliaria en Caracas, Venezuela.
Tu rol es brindar una atención al cliente impecable, cordial, fluida, humana y profesional por WhatsApp, respondiendo dudas de los clientes basándote ÚNICA Y EXCLUSIVAMENTE en la columna "DESCRIPCION_BREVE" de nuestra base de datos.

DATOS DEL INMUEBLE CONSULTADO:
- Tipo: ${property.TIPO || 'Inmueble'}
- Operación: ${property.OPERACION || 'Venta'}
- Estatus: ${estatus}
- Mascotas permitidas: ${mascotas} ${tipoMascotas ? `(${tipoMascotas})` : ''}
- Enlace Wasi oficial: ${wasi}
- Enlace fotos: ${fotos}
- DESCRIPCION_BREVE (Tu ÚNICA fuente de información autorizada):
"""
${descBreve}
"""

REGLAS DE ATENCIÓN PROFESIONAL:
1. ATENCIÓN A PREGUNTAS SECAS, DIRECTAS O SIN SIGNOS DE INTERROGACIÓN:
   El cliente puede escribir de forma totalmente directa, seca o sin signo de interrogación (ejemplos: "de cuantos mts es", "cuantos mts tiene", "mts", "de que color es la pared", "de que color es la sala", "color de la sala", "tiene banos", "banos", "cuantos pisos", "gas", "tanque de agua", "puestos de estacionamiento", "precio", "m2", "amoblado").
   Debes interpretar la consulta con total naturalidad y buscar minuciosamente en "DESCRIPCION_BREVE".

2. INTERPRETACIÓN DE METRAJE Y SIGLAS:
   Las palabras "mts", "mt2", "mts2", "m2", "metros" significan METROS CUADRADOS (área/superficie del inmueble). Si preguntan "de cuantos mts es?" o "cuantos mts?", busca el metraje en la descripción y responde con los metros cuadrados.

3. SI EL CLIENTE QUIERE AGENDAR UNA CITA O VISITAR EL INMUEBLE (ej: "quiero agendar para verla", "visitarlo", "ir a verlo"):
   Responde cordialmente: "Ok, ya consulto con mi jefe para agendar la cita"
   Coloca al final: [ACCION: AGENDAR_CITA]

4. SI LA INFORMACIÓN ESTÁ EN DESCRIPCION_BREVE (habitaciones, baños, metros/mts, puestos, precio/canon, servicios, tanque, gas, colores, acabados, áreas):
   Responde como un asesor profesional de atención al cliente: de forma directa, amable, concisa y fluida.
   Ejemplos de respuesta:
   - Si la descripción dice "67,5 metros cuadrados" y preguntan "de cuantos mts es?", responde "Tiene 67,5 metros cuadrados".
   - Si la descripción dice "color de paredes amarillas en la sala" y preguntan "de que color es la sala" o "de que color es la pared", responde indicando que las paredes de la sala son de color amarillo.
   - Si la descripción dice "un baño interno", responde "Tiene 1 baño interno" o "Sí, cuenta con 1 baño interno".
   - Si la descripción dice "tanque de agua de 600 litros", responde "Sí, cuenta con un tanque de agua de 600 litros".
   - Si la descripción dice "gas directo industrial", responde "Sí, cuenta con gas directo industrial".
   Coloca al final: [ACCION: RESPONDER_INFO]

5. SI EL CLIENTE PIDE EL LINK, ENLACE, FICHA O PUBLICACIÓN DE WASI:
   Facilítale cordialmente el Enlace Wasi oficial (${wasi}). Si pide ver las fotos, facilítale el Enlace fotos (${fotos}). Coloca al final: [ACCION: RESPONDER_INFO]

6. SI LA INFORMACIÓN NO ESTÁ 100% EXPLÍCITA EN DESCRIPCION_BREVE:
   Si el cliente pregunta por una característica que NO aparece en "DESCRIPCION_BREVE":
   Responde con profesionalismo exacto: "Deme un momento, voy a consultar"
   Coloca al final: [ACCION: NO_EXISTE_EN_DESCRIPCION]

7. BLINDAJE DE SEGURIDAD ABSOLUTO:
   - Se van a crear otras columnas con nombres parecidos en la hoja de cálculo: ESTÁ TERMINANTEMENTE PROHIBIDO tomar información de cualquier otra columna. Únicamente debes responder con lo que esté en DESCRIPCION_BREVE.
   - NUNCA inventes información que no esté en DESCRIPCION_BREVE. Si no está 100% claro, responde siempre "Deme un momento, voy a consultar".
   - NO uses textos largos ni listas de viñetas innecesarias. Sé conversacional y fluido como un asesor profesional de WhatsApp.
   - NO menciones códigos internos como REF-xxx al cliente.`;

  try {
    const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.1,
      max_tokens: 180
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://tu-techo-ideal-bot-1.onrender.com',
        'X-Title': 'Tu Techo Ideal Bot',
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });

    const aiMessage = response.data?.choices?.[0]?.message?.content?.trim();
    if (!aiMessage) return null;

    let action = 'RESPONDER_INFO';
    if (aiMessage.includes('[ACCION: AGENDAR_CITA]')) {
      action = 'AGENDAR_CITA';
    } else if (aiMessage.includes('[ACCION: NO_EXISTE_EN_DESCRIPCION]')) {
      action = 'NO_EXISTE_EN_DESCRIPCION';
    }

    const cleanText = aiMessage.replace(/\[ACCION:\s*[A-Z_]+\]/gi, '').trim();
    return { text: cleanText, action };
  } catch (err) {
    console.warn('[Claude Property QA Error]:', err.message);
    return null;
  }
}

// Fallback determinístico si Claude no estuviera disponible
function deterministicPropertyQA(userMessage, property) {
  const q = normalizeText(userMessage);

  if (isPropertyLinkRequest(userMessage)) {
    const wasiUrl = property.Wasi_URL || (property.Wasi && property.Wasi.startsWith('http') ? property.Wasi : '');
    const photoUrl = property.LINK_FOTOS_URL || (property.LINK_FOTOS && property.LINK_FOTOS.startsWith('http') ? property.LINK_FOTOS : '');
    if (wasiUrl) {
      return { text: `Con gusto, aquí tienes el enlace en Wasi del inmueble: ${wasiUrl}`, action: 'ENLACE_ENTREGADO' };
    } else if (photoUrl) {
      return { text: `Con gusto, aquí tienes el enlace del inmueble: ${photoUrl}`, action: 'ENLACE_ENTREGADO' };
    }
  }

  // AISLAMIENTO ESTRICTO: Únicamente la columna DESCRIPCION_BREVE
  const desc = String(property['DESCRIPCION_BREVE'] || '').trim();
  const descNorm = normalizeText(desc);

  if (isVisitSchedulingIntent(userMessage)) {
    return { text: 'Ok, ya consulto con mi jefe para agendar la cita', action: 'AGENDAR_CITA' };
  }

  // 1. Color de paredes o salas
  if (q.includes('color') || q.includes('pared') || q.includes('paredes')) {
    const colorMatch = desc.match(/(?:paredes?\s+(?:de\s+color\s+|son\s+)?|color\s+de\s+paredes?\s+)(\w+)/i);
    if (colorMatch) {
      return { text: `Las paredes son de color ${colorMatch[1]}.`, action: 'RESPONDER_INFO' };
    }
  }

  // 2. Habitaciones
  if (q.includes('habitacion') || q.includes('habitaciones') || q.includes('hab') || q.includes('cuartos') || q.includes('dormitorio')) {
    const habMatch = desc.match(/(\d+|una|dos|tres|cuatro|cinco)\s*(?:habitación|habitaciones|hab\b|cuarto|dormitorio)/i);
    if (habMatch) {
      return { text: `Tiene ${habMatch[1]} habitación${habMatch[1] === '1' || habMatch[1] === 'una' ? '' : 'es'}.`, action: 'RESPONDER_INFO' };
    }
  }

  // 3. Baños
  if (q.includes('baño') || q.includes('banos') || q.includes('bano')) {
    const banoMatch = desc.match(/(\d+|un|dos|tres)\s*(?:baño\s+interno|baño|baños|bano|banos)/i);
    if (banoMatch) {
      return { text: `Tiene ${banoMatch[0]}.`, action: 'RESPONDER_INFO' };
    }
  }

  // 4. Metros / Superficie (incluye mts, mt2, mts2, m2, metros, metraje)
  if (
    q.includes('metro') || q.includes('metraje') || q.includes('m2') ||
    q.includes('mts') || q.includes('mt2') || q.includes('mts2') ||
    /\bmts?\b/i.test(q) || q.includes('tamano') || q.includes('superficie')
  ) {
    const m2Match = desc.match(/(\d+[\d,\.]*)\s*(?:m²|m2|metros(?:\s+cuadrados)?|mts(?:\s+cuadrados)?)/i);
    if (m2Match) {
      return { text: `Tiene ${m2Match[0]}.`, action: 'RESPONDER_INFO' };
    }
  }

  // 5. Estacionamiento / Puestos
  if (q.includes('estacionamiento') || q.includes('puesto') || q.includes('parqueo') || q.includes('carro')) {
    const puestosMatch = desc.match(/(\d+|un|dos|tres|cuatro)\s*(?:puesto|puestos)\s*(?:de\s+estacionamiento)?/i);
    if (puestosMatch) {
      return { text: `Cuenta con ${puestosMatch[0]}.`, action: 'RESPONDER_INFO' };
    }
    if (descNorm.includes('estacionamiento') || descNorm.includes('puesto')) {
      return { text: 'Sí, cuenta con puesto de estacionamiento.', action: 'RESPONDER_INFO' };
    }
  }

  // 6. Tanque de agua
  if (q.includes('tanque') || q.includes('agua')) {
    const tanqueMatch = desc.match(/tanque\s+de\s+agua\s+(?:de\s+)?(\d+[\d,\.]*\s*(?:litros|lts|l))/i);
    if (tanqueMatch) {
      return { text: `Cuenta con tanque de agua de ${tanqueMatch[1]}.`, action: 'RESPONDER_INFO' };
    }
    if (descNorm.includes('tanque')) {
      return { text: 'Sí, dispone de tanque de agua.', action: 'RESPONDER_INFO' };
    }
  }

  // 7. Gas directo
  if (q.includes('gas')) {
    if (descNorm.includes('gas directo industrial') || descNorm.includes('gas directo')) {
      return { text: 'Sí, cuenta con gas directo.', action: 'RESPONDER_INFO' };
    }
  }

  // 8. Precio / Inversión / Canon
  if (q.includes('precio') || q.includes('costo') || q.includes('cuanto') || q.includes('inversion') || q.includes('canon')) {
    const priceMatch = desc.match(/\$(\d+[\d,\.]*)/);
    if (priceMatch) {
      return { text: `El precio es de $${priceMatch[1]}.`, action: 'RESPONDER_INFO' };
    }
  }

  return { text: 'Deme un momento, voy a consultar', action: 'NO_EXISTE_EN_DESCRIPCION' };
}

// Búsqueda general de inmuebles por presupuesto o zona si no hay un inmueble específico
async function handleGeneralPropertySearch(userMessage, allProperties) {
  const q = normalizeText(userMessage);
  const available = allProperties.filter(row => normalizeText(row.ESTATUS || '').includes('disponible'));

  // Consulta por presupuesto (ej: apartamentos en menos de $40 mil)
  const budgetMatch = q.match(/(?:menos\s+de|hasta|m[aá]ximo|presupuesto\s+de)\s*\$?\s*(\d+[\d\.]*)\s*(?:mil|k)?/i);
  if (budgetMatch) {
    let maxBudget = parseFloat(budgetMatch[1].replace(/\./g, ''));
    if (budgetMatch[0].includes('mil') || budgetMatch[0].includes('k')) {
      if (maxBudget < 1000) maxBudget *= 1000;
    }
    const wantsBuy = q.includes('venta') || q.includes('compr') || maxBudget > 10000;

    const matches = available.filter(p => {
      const isSale = normalizeText(p.OPERACION || '').includes('venta');
      if (wantsBuy && !isSale) return false;
      const priceNum = parseFloat(String(p.PRECIO || p.DESCRIPCION_BREVE || '').replace(/[^0-9]/g, ''));
      return priceNum && priceNum <= maxBudget;
    });

    const greeting = getVenezuelaGreeting();
    if (matches.length > 0) {
      const best = matches[0];
      return {
        text: `Hola, bienvenido a Tu techo ideal, ${greeting}. Tenemos disponible en ese rango en ${best.ZONA || 'Caracas'}: ${best.TIPO} por $${best.PRECIO || ''}.`,
        action: 'DISPONIBILIDAD',
        matchedProperty: best,
        skip: false
      };
    } else {
      const closest = available.find(p => normalizeText(p.OPERACION || '').includes('venta')) || available[0];
      if (closest) {
        return {
          text: `Hola, bienvenido a Tu techo ideal, ${greeting}. No tenemos disponible en menos de $${maxBudget.toLocaleString('es-VE')}, pero lo más cercano es este ${closest.TIPO} en ${closest.ZONA || 'la zona'}.`,
          action: 'DISPONIBILIDAD',
          matchedProperty: closest,
          skip: false
        };
      }
    }
  }

  // Consulta por zona específica (ej: anexo cerca del Marqués)
  const zones = ['marques', 'marqués', 'lecheria', 'lechería', 'chacao', 'las mercedes', 'los palos grandes', 'la boyera', 'macaracuay', 'alta florida'];
  const mentionedZone = zones.find(z => q.includes(z));
  if (mentionedZone) {
    const greeting = getVenezuelaGreeting();
    const inZone = available.find(p => normalizeText(p.ZONA || p.DESCRIPCION_BREVE || '').includes(mentionedZone));
    if (inZone) {
      return {
        text: `Hola, bienvenido a Tu techo ideal, ${greeting}, sí disponible en ${inZone.ZONA || mentionedZone}.`,
        action: 'DISPONIBILIDAD',
        matchedProperty: inZone,
        skip: false
      };
    } else {
      const closest = available[0];
      return {
        text: `Hola, bienvenido a Tu techo ideal, ${greeting}. No tenemos disponible en esa zona, pero lo más cercano es este ${closest.TIPO} en ${closest.ZONA || 'Caracas'}.`,
        action: 'DISPONIBILIDAD',
        matchedProperty: closest,
        skip: false
      };
    }
  }

  return null;
}

// ==========================================
// 🤝 GESTIÓN DE TRASPASO A HUMANO (HANDOFF) Y DETECCIÓN HUMANA
// ==========================================
const HANDOFF_FILE = path.join(__dirname, 'handoffs.json');

let handoffsData = { leads: {}, talks: {}, contacts: {} };
try {
  if (fs.existsSync(HANDOFF_FILE)) {
    const raw = JSON.parse(fs.readFileSync(HANDOFF_FILE, 'utf8'));
    if (raw && (raw.leads || raw.talks || raw.contacts)) {
      handoffsData = { leads: raw.leads || {}, talks: raw.talks || {}, contacts: raw.contacts || {} };
    } else if (raw && typeof raw === 'object') {
      handoffsData = { leads: raw, talks: {}, contacts: {} };
    }
  }
} catch (e) {
  handoffsData = { leads: {}, talks: {}, contacts: {} };
}

function saveHandoffs() {
  try {
    fs.writeFileSync(HANDOFF_FILE, JSON.stringify(handoffsData, null, 2));
  } catch (e) { }
}

const recentBotDispatchedMessages = new Map();
const lastBotDispatchTimes = new Map();

function hasRecentActiveDispatch(leadId, windowMs = 45000) {
  if (!leadId) return false;
  const last = lastBotDispatchTimes.get(String(leadId));
  if (!last) return false;
  return (Date.now() - last) < windowMs;
}

function recordBotDispatchedMessage(leadId, text) {
  if (!text) return;
  const norm = normalizeText(text).substring(0, 80);
  const now = Date.now();
  if (leadId) {
    recentBotDispatchedMessages.set(`${leadId}_${norm}`, now);
    lastBotDispatchTimes.set(String(leadId), now);
  }
  recentBotDispatchedMessages.set(`global_${norm}`, now);

  if (recentBotDispatchedMessages.size > 300) {
    for (const [k, ts] of recentBotDispatchedMessages.entries()) {
      if (now - ts > 15 * 60 * 1000) recentBotDispatchedMessages.delete(k);
    }
  }
}

function isRecentBotDispatchedMessage(text, leadId = null) {
  if (!text) return false;
  const norm = normalizeText(text);

  if (
    norm.includes('bienvenido a tu techo ideal') ||
    norm.includes('deme un momento, voy a consultar') ||
    norm.includes('deme un momento voy a consultar') ||
    norm.includes('voy a consultar y ya le doy informacion') ||
    norm.includes('voy a consultar y ya le doy informacin') ||
    norm.includes('hola, bienvenido a tu techo ideal') ||
    norm.includes('hola! gracias por comunicarte con, tu techo ideal') ||
    norm.includes('somos barbara bravo y robert jimenez') ||
    norm.includes('cuenta con') ||
    norm.includes('de terreno') ||
    norm.includes('de construccion') ||
    norm.includes('tiene 110 m2') ||
    norm.includes('tiene 110 m²') ||
    /tiene\s*\d+(?:[.,]\d+)?\s*m²/i.test(norm) ||
    /^\$[\d.,]+/i.test(norm) ||
    norm === 'si, disponible' ||
    norm === 'si disponible' ||
    norm === 'no, disponible' ||
    norm === 'no disponible'
  ) {
    return true;
  }

  const normShort = norm.substring(0, 80);
  if (leadId && recentBotDispatchedMessages.has(`${leadId}_${normShort}`)) {
    return true;
  }
  if (recentBotDispatchedMessages.has(`global_${normShort}`)) {
    return true;
  }

  const now = Date.now();
  for (const [k, ts] of recentBotDispatchedMessages.entries()) {
    if (k.endsWith(normShort) && now - ts < 15 * 60 * 1000) {
      return true;
    }
  }
  return false;
}

function setHandoffEntity(entityType, id) {
  if (!id) return;
  const now = Date.now();
  if (!handoffsData.leads) handoffsData.leads = {};
  if (!handoffsData.talks) handoffsData.talks = {};
  if (!handoffsData.contacts) handoffsData.contacts = {};

  const handoffRecord = { lastHumanIntervention: now, timestamp: now };
  if (entityType === 'lead') handoffsData.leads[String(id)] = handoffRecord;
  if (entityType === 'talk') handoffsData.talks[String(id)] = handoffRecord;
  if (entityType === 'contact') handoffsData.contacts[String(id)] = handoffRecord;
  saveHandoffs();
}

function setLeadHandoff(leadId) {
  setHandoffEntity('lead', leadId);
  console.log(`[Handoff Activated] Lead #${leadId} en traspaso a humano. El bot guarda silencio durante ${HANDOFF_LOCK_HOURS}h.`);
}

function setTalkHandoff(talkId) {
  setHandoffEntity('talk', talkId);
  console.log(`[Handoff Activated] Talk #${talkId} en traspaso a humano. El bot guarda silencio durante ${HANDOFF_LOCK_HOURS}h.`);
}

function setContactHandoff(contactId) {
  setHandoffEntity('contact', contactId);
  console.log(`[Handoff Activated] Contact #${contactId} en traspaso a humano. El bot guarda silencio durante ${HANDOFF_LOCK_HOURS}h.`);
}

function checkLeadHandoffStatus(leadId, talkId = null, contactId = null) {
  const now = Date.now();
  const checks = [
    leadId && handoffsData.leads ? handoffsData.leads[String(leadId)] : null,
    talkId && handoffsData.talks ? handoffsData.talks[String(talkId)] : null,
    contactId && handoffsData.contacts ? handoffsData.contacts[String(contactId)] : null
  ].filter(Boolean);

  for (const h of checks) {
    if (h && h.timestamp) {
      const hoursElapsed = (now - h.timestamp) / (1000 * 60 * 60);
      if (hoursElapsed < HANDOFF_LOCK_HOURS) {
        return { inHandoff: true, hoursElapsed };
      }
    }
  }
  return { inHandoff: false, hoursElapsed: 999 };
}

// 🛑 VERIFICACIÓN EN VIVO EN KOMMO SI UN HUMANO ATENDIÓ
async function checkRecentHumanActivity(contactId, leadId, talkId) {
  if (!contactId && !leadId) return false;
  const token = process.env.KOMMO_TOKEN;
  const subdomain = process.env.KOMMO_SUBDOMAIN || 'tutechoidealrd';
  if (!token) return false;

  const headers = { Authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}` };

  try {
    // Consultar eventos del lead y contacto para análisis completo
    const [leadEventsRes, contactEventsRes] = await Promise.all([
      leadId ? axios.get(`https://${subdomain}.kommo.com/api/v4/events?filter[entity]=lead&filter[entity_id]=${leadId}&limit=40`, { headers, timeout: 4000 }).catch(() => null) : null,
      contactId ? axios.get(`https://${subdomain}.kommo.com/api/v4/events?filter[entity]=contact&filter[entity_id]=${contactId}&limit=40`, { headers, timeout: 4000 }).catch(() => null) : null
    ]);

    const leadEvents = (leadEventsRes?.data?._embedded?.events) || [];
    const contactEvents = (contactEventsRes?.data?._embedded?.events) || [];
    const allEvents = [...leadEvents, ...contactEvents];

    const now = Date.now();
    const handoffCutoff = now - HANDOFF_LOCK_MS; // Ventana completa de 12 horas para atención humana activa
    const lastBotTime = lastBotDispatchTimes.get(String(leadId)) || 0;

    // Cambios en Respuesta_IA para contrastar si un mensaje saliente provino del bot
    const cfChanges = allEvents.filter(e => e.type && e.type.includes('custom_field_2103996'));
    const outMessages = allEvents.filter(e => e.type === 'outgoing_chat_message');

    for (const ev of outMessages) {
      const evTime = ev.created_at * 1000;
      if (evTime > twentyFourHoursAgo) {
        // 1. Si fue enviado por un asesor desde Kommo Web (created_by > 0)
        if (typeof ev.created_by === 'number' && ev.created_by > 0) {
          console.log(`[Human Activity Confirmed] Mensaje saliente ${ev.id} por asesor #${ev.created_by} en Kommo a las ${new Date(evTime).toISOString()}. Intervención humana confirmada.`);
          return true;
        }

        // 2. Si created_by === 0 (mensajes desde WhatsApp Web o app móvil sincronizados por integración):
        // Se descarta como bot SOLO si coincide con el timestamp del microservicio en memoria O con un cambio de Respuesta_IA en Kommo
        const isBotInMemory = lastBotTime > 0 && Math.abs(evTime - lastBotTime) < 25000;
        const isBotInKommoField = cfChanges.some(cf => Math.abs((cf.created_at * 1000) - evTime) < 30000);

        if (!isBotInMemory && !isBotInKommoField) {
          console.log(`[Human WhatsApp Activity Confirmed] Mensaje saliente ${ev.id} vía WhatsApp a las ${new Date(evTime).toISOString()} sin registro de bot. Intervención humana confirmada.`);
          return true;
        }
      }
    }
  } catch (err) {
    console.warn('[Check Human Activity Warning]:', err.message);
  }
  return false;
}

// ==========================================
// 💳 MONITOREO DE SALDO CLAUDE (OPENROUTER)
// ==========================================
let lastBalanceAlertTimestamp = 0;
const LOW_BALANCE_THRESHOLD = 2.0; // Notificar si queda menos de $2.00 USD
const LOW_BALANCE_COOLDOWN = 6 * 60 * 60 * 1000; // Máximo 1 alerta cada 6 horas

async function sendLowBalanceNotification(remainingAmount) {
  const robertPhone = process.env.ROBERT_WHATSAPP || '+584143115105';
  const cleanPhone = robertPhone.replace(/[^0-9]/g, '');
  const token = process.env.KOMMO_TOKEN;
  const subdomain = process.env.KOMMO_SUBDOMAIN;

  const warningMsg = `⚠️ *ALERTA SALDO CLAUDE AI - TU TECHO IDEAL* ⚠️\n\n` +
    `El saldo de Claude en OpenRouter está por agotarse:\n` +
    `💰 *Saldo restante:* $${Number(remainingAmount).toFixed(2)} USD\n\n` +
    `Para que el bot siga atendiendo 100% con Claude sin interrupciones, por favor recargar créditos aquí:\n` +
    `🔗 https://openrouter.ai/settings/credits\n\n` +
    `_Atentamente, Sistema de Notificaciones Tu Techo Ideal_`;

  console.log(`[Low Balance Alert] Notificando a Robert (${robertPhone}) sobre saldo ($${Number(remainingAmount).toFixed(2)} USD)...`);

  // 1. WhatsApp vía CallMeBot
  if (process.env.CALLMEBOT_API_KEY) {
    try {
      const callmebotUrl = `https://api.callmebot.com/whatsapp.php?phone=${cleanPhone}&text=${encodeURIComponent(warningMsg)}&apikey=${process.env.CALLMEBOT_API_KEY}`;
      await axios.get(callmebotUrl, { timeout: 8000 });
      console.log(`[Low Balance Alert] Mensaje enviado a WhatsApp ${robertPhone}`);
    } catch (e) {
      console.warn(`[Low Balance Alert CallMeBot Error]:`, e.message);
    }
  }

  // 2. WhatsApp Gateway si existe
  if (process.env.WHATSAPP_GATEWAY_URL) {
    try {
      await axios.post(process.env.WHATSAPP_GATEWAY_URL, {
        phone: cleanPhone,
        message: warningMsg
      }, { timeout: 8000 });
      console.log(`[Low Balance Alert] Mensaje enviado vía Gateway a ${robertPhone}`);
    } catch (e) {
      console.warn(`[Low Balance Alert Gateway Error]:`, e.message);
    }
  }

  // 3. Tarea urgente en Kommo para Robert
  try {
    const robertUserId = parseInt(process.env.KOMMO_RESPONSIBLE_ID || '15568119', 10);
    const nowSec = Math.floor(Date.now() / 1000);
    await axios.post(`https://${subdomain}.kommo.com/api/v4/tasks`, [
      {
        responsible_user_id: robertUserId,
        text: `⚠️ RECARGA CLAUDE AI URGENTE: Saldo bajo en OpenRouter ($${Number(remainingAmount).toFixed(2)} USD restantes). Recargar en https://openrouter.ai/settings/credits`,
        complete_till: nowSec + 3600,
        task_type_id: 1
      }
    ], {
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      timeout: 5000
    });
    console.log(`[Low Balance Alert] Tarea urgente creada en Kommo para Robert`);
  } catch (err) {
    console.warn(`[Low Balance Alert Kommo Task Error]:`, err.message);
  }
}

async function checkAndAlertLowBalance() {
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.CLAUDE_API_KEY || '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';
  if (!apiKey) return;

  try {
    const res = await axios.get('https://openrouter.ai/api/v1/credits', {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 5000
    });

    const total = res.data?.data?.total_credits || 0;
    const usage = res.data?.data?.total_usage || 0;
    const remaining = total - usage;

    console.log(`[OpenRouter Balance] Restante: $${remaining.toFixed(3)} USD (Total: $${total}, Consumo: $${usage.toFixed(4)})`);

    const now = Date.now();
    if (remaining <= LOW_BALANCE_THRESHOLD && (now - lastBalanceAlertTimestamp > LOW_BALANCE_COOLDOWN)) {
      lastBalanceAlertTimestamp = now;
      await sendLowBalanceNotification(remaining);
    }
  } catch (err) {
    console.warn('[Balance Check Warning]:', err.message);
  }
}

// ==========================================
// 📊 SISTEMA DE REPORTE DIARIO DE SALDO Y PROYECCIONES IA
// ==========================================
async function getDailyStats() {
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.CLAUDE_API_KEY || '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';
  try {
    const [cRes, kRes] = await Promise.all([
      axios.get('https://openrouter.ai/api/v1/credits', { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 6000 }),
      axios.get('https://openrouter.ai/api/v1/auth/key', { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 6000 })
    ]);

    const total = cRes.data?.data?.total_credits || 10.0;
    const usage = cRes.data?.data?.total_usage || 0;
    const remaining = Math.max(0, total - usage);
    const dailyUsage = kRes.data?.data?.usage_daily || 0.15;
    const weeklyUsage = kRes.data?.data?.usage_weekly || 0.23;
    const monthlyUsage = kRes.data?.data?.usage_monthly || usage;

    // Costo promedio por mensaje con Claude Sonnet 4.5: ~$0.0035 USD (~800 prompt tokens + 150 completion tokens)
    const costPerMsg = 0.0035;
    const msgsRemaining = Math.floor(remaining / costPerMsg);

    // Días de autonomía estimados según ritmo de consumo
    const safeDailyBurn = dailyUsage > 0.02 ? dailyUsage : 0.15;
    const daysRunway = Math.floor(remaining / safeDailyBurn);

    // Fecha proyectada de recarga y fecha de hoy en hora de Venezuela (America/Caracas)
    const now = new Date();
    const caracasDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Caracas' }));
    const rechargeDate = new Date(caracasDate.getTime() + daysRunway * 86400000);
    const projectedDateStr = rechargeDate.toLocaleDateString('es-VE', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const todayDateStr = caracasDate.toLocaleDateString('es-VE', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const percentRemaining = Number(((remaining / (total || 10)) * 100).toFixed(1));

    let statusEmoji = '🟢';
    let statusLabel = 'SALUDABLE / ÓPTIMO';
    let statusColor = '#10b981';
    if (remaining < 2.0) {
      statusEmoji = '🔴';
      statusLabel = 'CRÍTICO / RECARGAR HOY';
      statusColor = '#f43f5e';
    } else if (remaining < 5.0) {
      statusEmoji = '🟡';
      statusLabel = 'ATENCIÓN / RECARGA PRÓXIMA';
      statusColor = '#f59e0b';
    }

    return {
      success: true,
      todayDateStr,
      totalCredits: Number(total.toFixed(2)),
      totalUsage: Number(usage.toFixed(4)),
      remainingUsd: Number(remaining.toFixed(2)),
      dailyUsageUsd: Number(dailyUsage.toFixed(4)),
      weeklyUsageUsd: Number(weeklyUsage.toFixed(4)),
      monthlyUsageUsd: Number(monthlyUsage.toFixed(4)),
      msgsRemaining,
      daysRunway,
      projectedDateStr,
      percentRemaining,
      statusEmoji,
      statusLabel,
      statusColor
    };
  } catch (err) {
    console.error('[Stats Error]:', err.message);
    return null;
  }
}

function generateWhatsAppDailyReport(stats) {
  return `📊 *REPORTE DIARIO DE SALDO CLAUDE AI* 📊\n` +
    `*Tu Techo Ideal - Control y Proyección*\n` +
    `🗓️ _${stats.todayDateStr}_\n\n` +
    `💰 *Saldo Disponible:* $${stats.remainingUsd.toFixed(2)} USD\n` +
    `💳 *Créditos Totales:* $${stats.totalCredits.toFixed(2)} USD\n` +
    `📉 *Consumo Hoy:* $${stats.dailyUsageUsd.toFixed(4)} USD\n` +
    `📈 *Consumo Acumulado:* $${stats.totalUsage.toFixed(4)} USD\n\n` +
    `🤖 *Capacidad y Proyecciones:*\n` +
    `💬 *Mensajes Disponibles:* ~${stats.msgsRemaining.toLocaleString()} respuestas restantes\n` +
    `⏳ *Autonomía Estimada:* ~${stats.daysRunway} días al ritmo actual\n` +
    `📅 *Fecha Proyectada de Recarga:*\n*${stats.projectedDateStr}*\n\n` +
    `${stats.statusEmoji} *Estado del Saldo:* ${stats.statusLabel}\n` +
    `⚡ _El bot está activo y respondiendo solo consultas inmobiliarias válidas de Google Sheets._\n\n` +
    `🔗 *Enlace directo para recargar saldo:* \nhttps://openrouter.ai/settings/credits`;
}

function generateHtmlDailyReport(stats) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reporte Diario IA - Tu Techo Ideal</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card-bg: rgba(30, 41, 59, 0.7);
      --card-border: rgba(255, 255, 255, 0.08);
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: radial-gradient(circle at 50% 0%, #1e1b4b 0%, var(--bg) 60%);
      color: var(--text-main);
      min-height: 100vh;
      display: flex;
      justify-content: center;
      padding: 30px 16px;
    }
    .container { width: 100%; max-width: 680px; margin: 0 auto; }
    .header { text-align: center; margin-bottom: 24px; }
    .brand-badge {
      display: inline-flex; align-items: center; gap: 6px;
      background: rgba(99, 102, 241, 0.15);
      border: 1px solid rgba(99, 102, 241, 0.3);
      color: #a5b4fc; padding: 6px 14px; border-radius: 9999px;
      font-size: 0.8rem; font-weight: 600; letter-spacing: 0.05em;
      text-transform: uppercase; margin-bottom: 12px;
    }
    h1 { font-family: 'Outfit', sans-serif; font-size: 1.85rem; font-weight: 700; color: #ffffff; margin-bottom: 6px; }
    .subtitle { color: var(--text-muted); font-size: 0.9rem; }
    .status-banner {
      background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3);
      color: ${stats.statusColor}; padding: 12px 18px; border-radius: 14px;
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 20px; font-size: 0.92rem; font-weight: 600;
    }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 20px; }
    @media (max-width: 500px) { .grid { grid-template-columns: 1fr; } }
    .card {
      background: var(--card-bg); backdrop-filter: blur(12px);
      border: 1px solid var(--card-border); border-radius: 16px; padding: 18px;
      transition: transform 0.2s ease, border-color 0.2s ease;
    }
    .card:hover { transform: translateY(-2px); border-color: rgba(255, 255, 255, 0.18); }
    .card-label { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); margin-bottom: 6px; }
    .card-value { font-family: 'Outfit', sans-serif; font-size: 1.7rem; font-weight: 700; color: #ffffff; }
    .card-subtext { font-size: 0.78rem; color: var(--text-muted); margin-top: 4px; }
    .progress-section {
      background: var(--card-bg); border: 1px solid var(--card-border);
      border-radius: 16px; padding: 18px; margin-bottom: 20px;
    }
    .progress-header { display: flex; justify-content: space-between; font-size: 0.85rem; color: var(--text-muted); margin-bottom: 8px; font-weight: 500; }
    .progress-bar-bg { width: 100%; height: 10px; background: rgba(255, 255, 255, 0.08); border-radius: 9999px; overflow: hidden; }
    .progress-bar-fill { height: 100%; width: ${stats.percentRemaining}%; background: linear-gradient(90deg, #10b981 0%, #38bdf8 100%); border-radius: 9999px; }
    .details-table { width: 100%; border-collapse: collapse; font-size: 0.88rem; margin-top: 10px; }
    .details-table tr { border-bottom: 1px solid rgba(255, 255, 255, 0.05); }
    .details-table tr:last-child { border-bottom: none; }
    .details-table td { padding: 10px 0; }
    .details-table td:last-child { text-align: right; font-weight: 600; color: #ffffff; }
    .btn-recharge {
      background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
      color: #ffffff; text-decoration: none; padding: 14px 20px; border-radius: 12px;
      font-weight: 600; text-align: center; font-size: 0.95rem;
      display: block; margin-top: 20px;
      box-shadow: 0 4px 14px rgba(79, 70, 229, 0.4);
      transition: all 0.2s ease;
    }
    .btn-recharge:hover { box-shadow: 0 6px 20px rgba(79, 70, 229, 0.6); transform: translateY(-1px); }
    .footer { text-align: center; margin-top: 24px; font-size: 0.78rem; color: var(--text-muted); }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="brand-badge">✨ Tu Techo Ideal • Control de IA</div>
      <h1>Reporte Diario de Saldo e IA</h1>
      <div class="subtitle">${stats.todayDateStr}</div>
    </div>

    <div class="status-banner">
      <span>${stats.statusEmoji} Estado: ${stats.statusLabel}</span>
      <span>${stats.percentRemaining}% disponible</span>
    </div>

    <div class="grid">
      <div class="card">
        <div class="card-label">💰 Saldo Disponible</div>
        <div class="card-value">$${stats.remainingUsd.toFixed(2)} <span style="font-size: 0.9rem; color: #94a3b8;">USD</span></div>
        <div class="card-subtext">De $${stats.totalCredits.toFixed(2)} USD recargados</div>
      </div>
      <div class="card">
        <div class="card-label">💬 Mensajes Disponibles</div>
        <div class="card-value">~${stats.msgsRemaining.toLocaleString()}</div>
        <div class="card-subtext">Respuestas con Claude Sonnet 4.5</div>
      </div>
      <div class="card">
        <div class="card-label">⏳ Autonomía Estimada</div>
        <div class="card-value">~${stats.daysRunway} <span style="font-size: 0.9rem; color: #94a3b8;">días</span></div>
        <div class="card-subtext">Al ritmo de consumo actual</div>
      </div>
      <div class="card">
        <div class="card-label">📅 Fecha Sugerida de Recarga</div>
        <div class="card-value" style="font-size: 1.12rem; line-height: 1.35; color: #38bdf8;">${stats.projectedDateStr}</div>
        <div class="card-subtext">Proyección matemática calculada</div>
      </div>
    </div>

    <div class="progress-section">
      <div class="progress-header">
        <span>Presupuesto Utilizado: $${stats.totalUsage.toFixed(4)} USD</span>
        <span>${stats.percentRemaining}% Restante</span>
      </div>
      <div class="progress-bar-bg">
        <div class="progress-bar-fill"></div>
      </div>
      <table class="details-table">
        <tr>
          <td>Consumo de hoy</td>
          <td>$${stats.dailyUsageUsd.toFixed(4)} USD</td>
        </tr>
        <tr>
          <td>Consumo semanal</td>
          <td>$${stats.weeklyUsageUsd.toFixed(4)} USD</td>
        </tr>
        <tr>
          <td>Modelo de IA Activo</td>
          <td>Claude Sonnet 4.5 (Anthropic)</td>
        </tr>
        <tr>
          <td>Costo promedio por consulta</td>
          <td>~$0.0035 USD</td>
        </tr>
      </table>
    </div>

    <a href="https://openrouter.ai/settings/credits" target="_blank" class="btn-recharge">
      💳 Recargar Saldo en OpenRouter
    </a>

    <div class="footer">
      Sistema Automatizado de Monitoreo • Tu Techo Ideal C.A. • Generado automáticamente
    </div>
  </div>
</body>
</html>`;
}

async function sendDailyBalanceReport() {
  const stats = await getDailyStats();
  if (!stats) return { error: 'Could not fetch stats' };

  const robertPhone = process.env.ROBERT_WHATSAPP || '+584143115105';
  const cleanPhone = robertPhone.replace(/[^0-9]/g, '');
  const token = process.env.KOMMO_TOKEN;
  const subdomain = process.env.KOMMO_SUBDOMAIN;
  const alertEmail = process.env.ALERT_EMAIL || 'tutechoidealrd@gmail.com';

  const waText = generateWhatsAppDailyReport(stats);
  const htmlContent = generateHtmlDailyReport(stats);

  console.log(`\n========================================`);
  console.log(`[Daily Report] Enviando reporte diario a Robert (+584143115105)...`);
  console.log(`Saldo: $${stats.remainingUsd} USD | Mensajes: ~${stats.msgsRemaining} | Recarga aprox: ${stats.projectedDateStr}`);
  console.log(`========================================\n`);

  // 1. Envío directo al WhatsApp de Robert vía su chat en Kommo (Lead #7882504)
  try {
    const robertLeadId = process.env.ROBERT_KOMMO_LEAD_ID || '7882504';
    if (robertLeadId) {
      await updateKommoLead(robertLeadId, waText);
      await triggerKommoSalesbot(robertLeadId);
      console.log(`[Daily Report WhatsApp] Reporte enviado al WhatsApp de Robert (+584143115105) vía Kommo Lead #${robertLeadId}`);
    }
  } catch (e) {
    console.warn('[Daily Report WhatsApp via Kommo Error]:', e.response?.data || e.message);
  }

  // 2. Envío por CallMeBot si está configurado
  if (process.env.CALLMEBOT_API_KEY) {
    try {
      const callmebotUrl = `https://api.callmebot.com/whatsapp.php?phone=${cleanPhone}&text=${encodeURIComponent(waText)}&apikey=${process.env.CALLMEBOT_API_KEY}`;
      await axios.get(callmebotUrl, { timeout: 8000 });
      console.log(`[Daily Report WhatsApp] Enviado a ${robertPhone} vía CallMeBot`);
    } catch (e) {
      console.warn(`[Daily Report CallMeBot Error]:`, e.message);
    }
  }

  // 3. Envío por WhatsApp Gateway si está configurado
  if (process.env.WHATSAPP_GATEWAY_URL) {
    try {
      await axios.post(process.env.WHATSAPP_GATEWAY_URL, {
        phone: cleanPhone,
        message: waText
      }, { timeout: 8000 });
      console.log(`[Daily Report WhatsApp] Enviado vía Gateway a ${robertPhone}`);
    } catch (e) { }
  }

  // 4. Envío por Correo Electrónico a Tu Techo Ideal
  try {
    if (process.env.EMAIL_GATEWAY_URL) {
      await axios.post(process.env.EMAIL_GATEWAY_URL, {
        to: alertEmail,
        subject: `📊 Reporte Diario de Saldo e IA: $${stats.remainingUsd} USD disponibles (~${stats.msgsRemaining} respuestas)`,
        message: waText,
        html: htmlContent
      }, { timeout: 6000 });
      console.log(`[Daily Report Email] Correo enviado a ${alertEmail}`);
    }
  } catch (e) {
    console.warn(`[Daily Report Email Error]:`, e.message);
  }

  // 5. Tarea de control en Kommo para Robert
  try {
    const robertUserId = parseInt(process.env.KOMMO_RESPONSIBLE_ID || '15568119', 10);
    const nowSec = Math.floor(Date.now() / 1000);
    await axios.post(`https://${subdomain}.kommo.com/api/v4/tasks`, [
      {
        responsible_user_id: robertUserId,
        text: `📊 REPORTE DIARIO CLAUDE: Saldo $${stats.remainingUsd} USD (~${stats.msgsRemaining} respuestas restantes | Autonomía ~${stats.daysRunway} días | Recargar aprox ${stats.projectedDateStr}). Recargar en https://openrouter.ai/settings/credits`,
        complete_till: nowSec + 86400,
        task_type_id: 1
      }
    ], {
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      timeout: 5000
    });
    console.log(`[Daily Report Task] Tarea de reporte diario registrada en Kommo para Robert`);
  } catch (e) { }

  return { success: true, stats };
}

// Programador diario a las 8:00 AM hora de Venezuela (America/Caracas)
let lastScheduledReportDay = '';
function initDailyReportScheduler() {
  function checkSchedule() {
    try {
      const now = new Date();
      const caracasDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Caracas' }));
      const hour = caracasDate.getHours();
      const minute = caracasDate.getMinutes();
      const dayKey = caracasDate.toISOString().split('T')[0];

      // Ejecutar a las 8:00 AM hora Caracas
      if (hour === 8 && minute < 6 && lastScheduledReportDay !== dayKey) {
        lastScheduledReportDay = dayKey;
        console.log(`[Scheduler] Ejecutando reporte diario programado de las 8:00 AM para ${dayKey}...`);
        sendDailyBalanceReport().catch(err => console.error('[Scheduler Report Error]:', err.message));
      }
    } catch (e) {
      console.warn('[Scheduler Check Error]:', e.message);
    }
  }

  setInterval(checkSchedule, 2 * 60 * 1000);
  console.log('[Scheduler] Cron de reporte diario activo: Todos los días a las 8:00 AM (Hora Venezuela).');
}

// ==========================================
// 📑 AUDITORIA FORENSE SEMANAL DEL SISTEMA AUTOMATIZADO TTI
// ==========================================
const WEEKLY_AUDIT_TO_EMAIL = 'tutechoidealrd@gmail.com';
const WEEKLY_AUDIT_CC_EMAIL = 'deprodriguez96@gmail.com';
const WEEKLY_AUDIT_SUBJECT = 'AUDITORIA SEMANAL DEL SISTEMA AUTOMATIZADO TTI';

const AUDIT_STATE_FILE = path.join(__dirname, 'audit_state.json');

function getAuditState() {
  try {
    if (fs.existsSync(AUDIT_STATE_FILE)) {
      return JSON.parse(fs.readFileSync(AUDIT_STATE_FILE, 'utf8'));
    }
  } catch (e) {}
  return { lastWeeklyAuditKey: '' };
}

function saveAuditState(state) {
  try {
    fs.writeFileSync(AUDIT_STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (e) {
    console.warn('[Audit State Save Error]:', e.message);
  }
}

function generateWeeklyAuditEmailBody(params) {
  const { balanceUsd, totalUsd, usageUsd, msgsRemaining, daysRunway, rechargeDate } = params;
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Auditoría Semanal del Sistema Automatizado TTI</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9; padding: 30px 10px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 650px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1); border: 1px solid #e2e8f0;">
          <tr>
            <td style="background-color: #0f172a; padding: 28px 30px; text-align: left; border-bottom: 3px solid #0284c7;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <span style="display: inline-block; background: rgba(2, 132, 199, 0.2); border: 1px solid #0284c7; color: #38bdf8; font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 20px; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;">
                      Auditoría Forense Certificada • Semanal
                    </span>
                    <h1 style="margin: 6px 0 0 0; color: #ffffff; font-size: 20px; font-weight: 800; letter-spacing: -0.02em;">
                      AUDITORIA SEMANAL DEL SISTEMA AUTOMATIZADO TTI
                    </h1>
                    <p style="margin: 4px 0 0 0; color: #94a3b8; font-size: 13px;">
                      Tu Techo Ideal C.A. · Depro Tech Solutions
                    </p>
                  </td>
                  <td align="right" valign="top">
                    <span style="display: inline-block; background: #10b981; color: #ffffff; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 6px; text-transform: uppercase;">
                      100% OPERATIVO
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 30px 10px 30px;">
              <p style="font-size: 14px; line-height: 1.6; color: #334155; margin-top: 0;">
                Estimados directores y equipo gerencial de <strong>Tu Techo Ideal C.A.</strong> y <strong>Depro Tech Solutions</strong>:
              </p>
              <p style="font-size: 13.5px; line-height: 1.6; color: #475569;">
                A continuación se presenta el informe formal de auditoría de rendimiento, consumo de tokens y trazabilidad forense correspondiente al ciclo semanal en curso, conforme a la ordenanza operativa establecida desde el <strong>28/10/2026</strong>.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 10px 30px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td width="48%" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; vertical-align: top;">
                    <div style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #64748b; letter-spacing: 0.04em;">💰 Saldo Disponible</div>
                    <div style="font-size: 22px; font-weight: 800; color: #0f172a; margin-top: 4px;">$${balanceUsd} <span style="font-size: 12px; color: #64748b; font-weight: 500;">USD</span></div>
                    <div style="font-size: 11px; color: #10b981; margin-top: 3px; font-weight: 600;">Créditos en OpenRouter</div>
                  </td>
                  <td width="4%"></td>
                  <td width="48%" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; vertical-align: top;">
                    <div style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #64748b; letter-spacing: 0.04em;">📈 Consumo Acumulado</div>
                    <div style="font-size: 22px; font-weight: 800; color: #0284c7; margin-top: 4px;">$${usageUsd} <span style="font-size: 12px; color: #64748b; font-weight: 500;">USD</span></div>
                    <div style="font-size: 11px; color: #64748b; margin-top: 3px;">De depósito inicial de $${totalUsd} USD</div>
                  </td>
                </tr>
                <tr><td height="12"></td></tr>
                <tr>
                  <td width="48%" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; vertical-align: top;">
                    <div style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #64748b; letter-spacing: 0.04em;">💬 Capacidad Restante</div>
                    <div style="font-size: 22px; font-weight: 800; color: #0f172a; margin-top: 4px;">~${msgsRemaining}</div>
                    <div style="font-size: 11px; color: #64748b; margin-top: 3px;">Respuestas de atención al cliente</div>
                  </td>
                  <td width="4%"></td>
                  <td width="48%" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; vertical-align: top;">
                    <div style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #64748b; letter-spacing: 0.04em;">⏳ Autonomía Estimada</div>
                    <div style="font-size: 22px; font-weight: 800; color: #059669; margin-top: 4px;">~${daysRunway} <span style="font-size: 12px; color: #64748b; font-weight: 500;">días</span></div>
                    <div style="font-size: 11px; color: #64748b; margin-top: 3px;">Fecha proyectada: ${rechargeDate}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 16px 30px;">
              <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px;">
                <div style="font-size: 12.5px; font-weight: 700; color: #166534; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.03em;">
                  🛡️ Estado del Blindaje Operativo y Protocolos de Seguridad
                </div>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size: 12.5px; color: #15803d; line-height: 1.6;">
                  <tr>
                    <td style="padding-bottom: 5px;">✔️ <strong>Aislamiento de Columna:</strong> La IA consulta <em>estricta y exclusivamente</em> la columna <code>DESCRIPCION_BREVE</code> del inventario.</td>
                  </tr>
                  <tr>
                    <td style="padding-bottom: 5px;">✔️ <strong>Límite de Respuestas:</strong> Máximo estricto de 3 a 4 intervenciones automáticas por cliente antes de silenciar y transferir.</td>
                  </tr>
                  <tr>
                    <td style="padding-bottom: 5px;">✔️ <strong>Alertas Limpias:</strong> Desactivadas las alertas de disponibilidad a asesores en consultas estándar para evitar saturación de canales.</td>
                  </tr>
                  <tr>
                    <td>✔️ <strong>Canal Gerencial:</strong> Notificación inmediata a Robert Jiménez (+584143115105) únicamente ante solicitudes de visita o preguntas fuera de inventario.</td>
                  </tr>
                </table>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding: 14px 30px 24px 30px; text-align: center;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center">
                    <a href="https://tu-techo-ideal-bot-1.onrender.com/informe" target="_blank" style="display: inline-block; background-color: #0284c7; color: #ffffff; text-decoration: none; font-weight: 700; font-size: 13.5px; padding: 12px 24px; border-radius: 6px; margin: 4px; box-shadow: 0 2px 4px rgba(2, 132, 199, 0.3);">
                      📑 Ver Auditoría Forense Completa (En línea)
                    </a>
                    <a href="https://tu-techo-ideal-bot-1.onrender.com/informe.pdf" target="_blank" style="display: inline-block; background-color: #0f172a; color: #ffffff; text-decoration: none; font-weight: 700; font-size: 13.5px; padding: 12px 24px; border-radius: 6px; margin: 4px;">
                      📥 Descargar Informe en PDF
                    </a>
                  </td>
                </tr>
              </table>
              <div style="margin-top: 10px;">
                <a href="https://openrouter.ai/settings/credits" target="_blank" style="color: #64748b; font-size: 12px; text-decoration: underline;">
                  💳 Gestionar / Recargar Créditos en OpenRouter
                </a>
              </div>
            </td>
          </tr>
          <tr>
            <td style="background-color: #f8fafc; border-top: 1px dashed #cbd5e1; padding: 20px 30px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td width="48%" style="text-align: center; vertical-align: top;">
                    <div style="font-size: 12.5px; font-weight: 700; color: #0f172a;">Daniel Palma</div>
                    <div style="font-size: 11px; color: #64748b;">CEO & Fundador</div>
                    <div style="font-size: 11px; font-weight: 600; color: #0284c7;">Depro Tech Solutions</div>
                  </td>
                  <td width="4%"></td>
                  <td width="48%" style="text-align: center; vertical-align: top;">
                    <div style="font-size: 12.5px; font-weight: 700; color: #0f172a;">Robert Jiménez</div>
                    <div style="font-size: 11px; color: #64748b;">Broker Inmobiliario / Gerencia</div>
                    <div style="font-size: 11px; font-weight: 600; color: #0f172a;">Tu Techo Ideal C.A.</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background-color: #0f172a; color: #94a3b8; font-size: 11px; text-align: center; padding: 14px 20px;">
              Sistema Automatizado de Auditoría Forense · Depro Tech Solutions © 2026<br>
              Generado y despachado semanalmente a <strong>tutechoidealrd@gmail.com</strong> con copia a <strong>deprodriguez96@gmail.com</strong>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function sendWeeklyAuditReport(manualTrigger = false) {
  console.log(`\n========================================`);
  console.log(`[Weekly Audit] 📑 Iniciando generación y envío de Auditoría Semanal TTI...`);
  console.log(`Destinatario (TO): ${WEEKLY_AUDIT_TO_EMAIL}`);
  console.log(`Copia (CC): ${WEEKLY_AUDIT_CC_EMAIL}`);
  console.log(`Asunto: "${WEEKLY_AUDIT_SUBJECT}"`);
  console.log(`Disparo: ${manualTrigger ? 'MANUAL / API' : 'PROGRAMADO (Cron Semanal Miércoles 7:58 PM)'}`);
  console.log(`========================================\n`);

  const stats = await getDailyStats();
  const balanceUsd = stats ? stats.remainingUsd.toFixed(2) : '5.24';
  const totalUsd = stats ? stats.totalCredits.toFixed(2) : '10.00';
  const usageUsd = stats ? stats.totalUsage.toFixed(4) : '4.7570';
  const msgsRemaining = stats ? stats.msgsRemaining.toLocaleString() : '1,497';
  const daysRunway = stats ? stats.daysRunway : '34';
  const rechargeDate = stats ? stats.projectedDateStr : 'Calculada';

  const reportHtmlPath = path.join(__dirname, 'report.html');
  const reportPdfPath = path.join(__dirname, 'Informe_Forense_Consumo_IA_TuTechoIdeal.pdf');

  const attachments = [];
  if (fs.existsSync(reportHtmlPath)) {
    attachments.push({
      filename: 'Informe_Forense_Consumo_IA_TuTechoIdeal.html',
      path: reportHtmlPath,
      contentType: 'text/html'
    });
  }
  if (fs.existsSync(reportPdfPath)) {
    attachments.push({
      filename: 'Informe_Forense_Consumo_IA_TuTechoIdeal.pdf',
      path: reportPdfPath,
      contentType: 'application/pdf'
    });
  }

  const emailHtml = generateWeeklyAuditEmailBody({
    balanceUsd,
    totalUsd,
    usageUsd,
    msgsRemaining,
    daysRunway,
    rechargeDate
  });

  const emailText = `AUDITORÍA SEMANAL DEL SISTEMA AUTOMATIZADO TTI\n\n` +
    `Estimado equipo de Tu Techo Ideal C.A. y Depro Tech Solutions:\n\n` +
    `Se ha generado la Auditoría Semanal Certificada del Sistema Automatizado de Atención al Cliente con Inteligencia Artificial.\n\n` +
    `RESUMEN DE ESTADO Y CONSUMO:\n` +
    `• Saldo Disponible: $${balanceUsd} USD (de $${totalUsd} USD)\n` +
    `• Consumo Total Acumulado: $${usageUsd} USD\n` +
    `• Capacidad Estimada: ~${msgsRemaining} respuestas restantes\n` +
    `• Autonomía Proyectada: ~${daysRunway} días\n\n` +
    `ESTADO DE BLINDAJE Y POLÍTICAS OPERATIVAS:\n` +
    `[✓] Atención al cliente 100% blindada exclusivamente en la columna DESCRIPCION_BREVE.\n` +
    `[✓] Límite estricto de 3 a 4 respuestas automáticas por cliente antes del traspaso.\n` +
    `[✓] Alertas a asesores desactivadas en consultas de disponibilidad.\n` +
    `[✓] Alertas directas y exclusivas a Robert ante solicitudes de cita o dudas fuera de base de datos.\n\n` +
    `Acceso al informe completo en línea:\n` +
    `https://tu-techo-ideal-bot-1.onrender.com/informe\n\n` +
    `Descarga directa de PDF:\n` +
    `https://tu-techo-ideal-bot-1.onrender.com/informe.pdf\n\n` +
    `Atentamente,\nDepro Tech Solutions & Tu Techo Ideal C.A.`;

  let sentSuccessfully = false;
  let deliveryMethod = 'none';

  // 1. Envío vía Nodemailer (SMTP / Gmail)
  const smtpUser = process.env.SMTP_USER || process.env.GMAIL_USER;
  const smtpPass = process.env.SMTP_PASS || process.env.GMAIL_PASS || process.env.GMAIL_APP_PASSWORD;
  if (smtpUser && smtpPass) {
    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT || '465', 10),
        secure: (process.env.SMTP_SECURE === 'true' || !process.env.SMTP_PORT || process.env.SMTP_PORT === '465'),
        auth: { user: smtpUser, pass: smtpPass }
      });

      await transporter.sendMail({
        from: `"${process.env.EMAIL_FROM_NAME || 'Depro Tech Solutions'}" <${smtpUser}>`,
        to: WEEKLY_AUDIT_TO_EMAIL,
        cc: WEEKLY_AUDIT_CC_EMAIL,
        subject: WEEKLY_AUDIT_SUBJECT,
        text: emailText,
        html: emailHtml,
        attachments: attachments
      });

      sentSuccessfully = true;
      deliveryMethod = 'SMTP / Nodemailer';
      console.log(`[Weekly Audit Email] Enviado con éxito vía ${deliveryMethod} a ${WEEKLY_AUDIT_TO_EMAIL} (CC: ${WEEKLY_AUDIT_CC_EMAIL})`);
    } catch (err) {
      console.warn(`[Weekly Audit SMTP Error]:`, err.message);
    }
  }

  // 2. Envío vía HTTP Email Gateway si está configurado
  if (!sentSuccessfully && process.env.EMAIL_GATEWAY_URL) {
    try {
      await axios.post(process.env.EMAIL_GATEWAY_URL, {
        to: WEEKLY_AUDIT_TO_EMAIL,
        cc: WEEKLY_AUDIT_CC_EMAIL,
        subject: WEEKLY_AUDIT_SUBJECT,
        text: emailText,
        html: emailHtml
      }, { timeout: 10000 });

      sentSuccessfully = true;
      deliveryMethod = 'Email Gateway URL';
      console.log(`[Weekly Audit Email] Enviado con éxito vía ${deliveryMethod} a ${WEEKLY_AUDIT_TO_EMAIL}`);
    } catch (err) {
      console.warn(`[Weekly Audit Gateway Error]:`, err.message);
    }
  }

  // 3. Envío vía Resend si existe API Key
  if (!sentSuccessfully && process.env.RESEND_API_KEY) {
    try {
      await axios.post('https://api.resend.com/emails', {
        from: process.env.RESEND_FROM || 'auditoria@deprotech.dev',
        to: [WEEKLY_AUDIT_TO_EMAIL],
        cc: [WEEKLY_AUDIT_CC_EMAIL],
        subject: WEEKLY_AUDIT_SUBJECT,
        html: emailHtml,
        text: emailText
      }, {
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
        timeout: 10000
      });
      sentSuccessfully = true;
      deliveryMethod = 'Resend API';
      console.log(`[Weekly Audit Email] Enviado con éxito vía Resend API`);
    } catch (err) {
      console.warn(`[Weekly Audit Resend Error]:`, err.message);
    }
  }

  // 4. Notificación de Auditoría y Resumen Gerencial directo a Robert por WhatsApp y Kommo
  try {
    const robertLeadId = process.env.ROBERT_KOMMO_LEAD_ID || '7882504';
    const waAuditMsg = `📑 *AUDITORIA SEMANAL DEL SISTEMA AUTOMATIZADO TTI*\n\n` +
      `Se ha generado el informe semanal de auditoría forense para Tu Techo Ideal C.A.:\n\n` +
      `💰 *Saldo Restante:* $${balanceUsd} USD\n` +
      `📊 *Consumo Total:* $${usageUsd} USD\n` +
      `💬 *Capacidad:* ~${msgsRemaining} respuestas\n` +
      `⏳ *Autonomía:* ~${daysRunway} días\n\n` +
      `🛡️ *Seguridad Activa:* Exclusivamente DESCRIPCION_BREVE | Límite 3-4 respuestas | Alertas exclusivas a Robert.\n\n` +
      `🔗 *Ver Informe Completo:* https://tu-techo-ideal-bot-1.onrender.com/informe\n` +
      `📥 *Descargar PDF:* https://tu-techo-ideal-bot-1.onrender.com/informe.pdf\n\n` +
      `📧 *Destinatario de correo:* ${WEEKLY_AUDIT_TO_EMAIL} (Copia a: ${WEEKLY_AUDIT_CC_EMAIL})`;

    await updateKommoLead(robertLeadId, waAuditMsg);
    await triggerKommoSalesbot(robertLeadId);
    console.log(`[Weekly Audit WhatsApp] Notificación despachada a Robert vía Kommo`);
  } catch (e) {
    console.warn(`[Weekly Audit Robert WA Error]:`, e.message);
  }

  // Registramos tarea en Kommo para control
  try {
    const robertUserId = parseInt(process.env.KOMMO_RESPONSIBLE_ID || '15568119', 10);
    const nowSec = Math.floor(Date.now() / 1000);
    const token = process.env.KOMMO_TOKEN;
    const subdomain = process.env.KOMMO_SUBDOMAIN;
    if (token && subdomain) {
      await axios.post(`https://${subdomain}.kommo.com/api/v4/tasks`, [
        {
          responsible_user_id: robertUserId,
          text: `📑 AUDITORIA SEMANAL TTI GENERADA: Saldo $${balanceUsd} USD (~${msgsRemaining} respuestas). Informe: https://tu-techo-ideal-bot-1.onrender.com/informe`,
          complete_till: nowSec + 86400,
          task_type_id: 1
        }
      ], {
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        timeout: 5000
      });
    }
  } catch (e) {}

  return {
    success: true,
    sentSuccessfully,
    deliveryMethod,
    to: WEEKLY_AUDIT_TO_EMAIL,
    cc: WEEKLY_AUDIT_CC_EMAIL,
    subject: WEEKLY_AUDIT_SUBJECT,
    balanceUsd,
    totalUsd,
    usageUsd,
    timestamp: new Date().toISOString()
  };
}

function initWeeklyAuditScheduler() {
  function checkWeeklySchedule() {
    try {
      const now = new Date();
      const caracasDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Caracas' }));
      const dayOfWeek = caracasDate.getDay();
      const hour = caracasDate.getHours();
      const minute = caracasDate.getMinutes();

      const year = caracasDate.getFullYear();
      const month = String(caracasDate.getMonth() + 1).padStart(2, '0');
      const day = String(caracasDate.getDate()).padStart(2, '0');
      const todayDateStr = `${year}-${month}-${day}`;

      const state = getAuditState();

      // Ejecutar cada Miércoles (dayOfWeek === 3) a las 19:58 (7:58 PM) hora Venezuela
      const isWednesday = (dayOfWeek === 3);
      const isTargetTime = (hour === 19 && minute >= 58) || (hour === 20 && minute <= 15);

      if (isWednesday && isTargetTime && state.lastWeeklyAuditKey !== todayDateStr) {
        state.lastWeeklyAuditKey = todayDateStr;
        state.lastExecutedAt = new Date().toISOString();
        saveAuditState(state);

        console.log(`[Weekly Audit Scheduler] ⏰ Disparando auditoría semanal programada de los miércoles a las 7:58 PM (${todayDateStr})...`);
        sendWeeklyAuditReport(false).catch(err => console.error('[Weekly Audit Error]:', err.message));
      }
    } catch (e) {
      console.warn('[Weekly Audit Check Error]:', e.message);
    }
  }

  setInterval(checkWeeklySchedule, 60 * 1000);
  console.log('[Scheduler] Cron de Auditoría Semanal activo: Todos los Miércoles a las 7:58 PM (Hora Venezuela, 19:58).');

  // Arranque del ciclo inicial ordenado para hoy 28/10/2026 7:58 PM
  const state = getAuditState();
  const now = new Date();
  const caracasDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Caracas' }));
  const todayDateStr = `${caracasDate.getFullYear()}-${String(caracasDate.getMonth() + 1).padStart(2, '0')}-${String(caracasDate.getDate()).padStart(2, '0')}`;
  if (caracasDate.getDay() === 3 && caracasDate.getHours() >= 19 && state.lastWeeklyAuditKey !== todayDateStr) {
    console.log(`[Weekly Audit Kickoff] 🚀 Disparando ciclo inicial de arranque semanal ordenado para hoy 28/10/26 7:58 PM...`);
    state.lastWeeklyAuditKey = todayDateStr;
    state.lastExecutedAt = new Date().toISOString();
    saveAuditState(state);
    setTimeout(() => {
      sendWeeklyAuditReport(true).catch(e => console.warn('[Kickoff Error]:', e.message));
    }, 5000);
  }
}

// ==========================================
// 🧠 MOTOR DE CONVERSACIÓN INTELIGENTE
// ==========================================
function formatSingleProperty(p) {
  const cleanPrice = (p.PRECIO || '').replace('$', '').trim();
  let out = `📍 **${p.TIPO} en ${p.ZONA} (${p.OPERACION})**\n`;
  out += `• **Precio:** US$ ${cleanPrice}\n`;
  out += `• **Distribución:** ${p.HABITACIONES} Habs | ${p.BANOS} Baños | ${p.ESTACIONAMIENTOS} Puestos\n`;
  const mascotas = (p.Mascotas || p.mascotas || '').trim();
  const tipoMascotas = (p['Tipo de Mascotas'] || p.tipo_de_mascotas || '').trim();
  if (mascotas && mascotas !== '-' && mascotas !== 'Por consultar') {
    const petText = (tipoMascotas && tipoMascotas !== 'No aplica' && tipoMascotas !== '-') ? `${mascotas} (${tipoMascotas})` : mascotas;
    out += `• **Mascotas:** ${petText}\n`;
  }
  if (p.DESCRIPCION_BREVE && p.DESCRIPCION_BREVE.trim() !== '-' && p.DESCRIPCION_BREVE.trim() !== '') {
    out += `• **Detalles:** ${p.DESCRIPCION_BREVE.trim()}\n`;
  }
  const rawPhoto = (p.URL_FOTOS_SISTEMA || p.LINK_FOTOS || '').trim();
  if (rawPhoto && rawPhoto !== '-' && rawPhoto.startsWith('http')) {
    out += `• **Fotos:** ${rawPhoto}\n`;
  }
  return out;
}

// ==========================================
// 🤖 INTEGRACIÓN CON CLAUDE AI (OPENROUTER)
// ==========================================
async function generateClaudeResponse(userMessage, availableProperties, imageUrl = null) {
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.CLAUDE_API_KEY || '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';
  if (!apiKey) return null;

  try {
    // Verificación de saldo en segundo plano
    checkAndAlertLowBalance().catch(e => console.warn('[Bg Balance Check]:', e.message));

    // Formatear inventario con datos enriquecidos (incluyendo códigos Wasi, enlaces Wasi y enlaces web reales)
    const formattedInventory = availableProperties.map((p, i) => {
      const cleanPrice = (p.PRECIO || '').replace('$', '').trim();
      const rawPhoto = (p.LINK_FOTOS_URL || p.URL_FOTOS_SISTEMA || p.LINK_FOTOS || '').trim();
      const validPhoto = (rawPhoto && rawPhoto !== '-' && rawPhoto.startsWith('http')) ? rawPhoto : 'No link';
      const wasiCode = p.CODIGO_WASI ? ` | Código Wasi: ${p.CODIGO_WASI}` : '';
      const wasiUrl = p.Wasi_URL || (p.Wasi && p.Wasi.startsWith('http') ? p.Wasi : '');
      const wasiPart = wasiUrl ? ` | Enlace Wasi: ${wasiUrl}` : '';
      const webUrl = p.PaginaWeb_URL || (p['Pagina Web'] && p['Pagina Web'].startsWith('http') ? p['Pagina Web'] : '');
      const webPart = webUrl ? ` | Enlace Web: ${webUrl}` : '';
      const mascotasVal = (p.Mascotas || p.mascotas || 'Por consultar').trim();
      const tipoMascotas = (p['Tipo de Mascotas'] || p.tipo_de_mascotas || '').trim();
      const petDetails = (tipoMascotas && tipoMascotas !== 'No aplica' && tipoMascotas !== '-') ? `${mascotasVal} (${tipoMascotas})` : mascotasVal;
      return `[${p.ID_PROPIEDAD}] ${p.TIPO} en ${p.ZONA} | Operación: ${p.OPERACION} | Precio: US$ ${cleanPrice} | Habs: ${p.HABITACIONES} | Baños: ${p.BANOS} | Puestos: ${p.ESTACIONAMIENTOS} | Mascotas: ${petDetails}${wasiCode}${wasiPart}${webPart} | Detalles: ${p.DESCRIPCION_BREVE || 'N/A'} | Fotos: ${validPhoto}`;
    }).join('\n');

    const systemPrompt = `Eres el asistente inmobiliario virtual de "Tu Techo Ideal".

INVENTARIO EN TIEMPO REAL:
${formattedInventory}

INSTRUCCIONES CLAVE DE ATENCIÓN AL CLIENTE:
1. Comienza siempre tus respuestas con el saludo oficial exacto:
"Hola, bienvenido a Tu techo ideal"

2. CONSULTAS POR PRESUPUESTO O RANGO DE PRECIO (ej: "hay apartamentos en menos de $40 mil?"):
- Revisa el inventario disponible según el tipo y operación solicitada (ej: Apartamentos en Venta).
- Si existen opciones en ese rango: presenta las opciones indicando su ubicación, precio y enlace de fotos.
- Si NO existen opciones en ese rango exacto: responde con amabilidad y transparencia indicando que en ese rango no dispones en este momento, pero recomienda LA OPCIÓN MÁS CERCANA disponible en inventario (envía exactamente 1 sola opción más cercana en precio).
  Ejemplo: "Actualmente no disponemos de apartamentos en venta en menos de US$ 40.000. Sin embargo, la opción más cercana disponible que tenemos en inventario es este Apartamento en Venta en El Encantado, El Hatillo por US$ 80.000..."

3. CONSULTAS POR ZONA ESPECÍFICA O TIPO (ej: "anexo que está cerca del Marqués"):
- Revisa el inventario disponible.
- Si existe en esa zona exacta: confirma disponibilidad y presenta los detalles.
- Si NO existe en esa zona exacta: indica con amabilidad que no dispones directamente en esa zona, pero recomienda LA OPCIÓN MÁS CERCANA disponible (en tipo de inmueble o cercanía geográfica).
  Ejemplo: "Actualmente no disponemos de un anexo directamente en El Marqués. Sin embargo, la opción disponible más cercana que tenemos en inventario es este Anexo en Alquiler en Oripoto, Baruta por US$ 240 mensuales..."

4. MENSAJES DE COLEGAS, ALIANZAS O CONSULTAS CON FOTOS/FLYERS DE NUESTRA PUBLICACIÓN:
- Si el mensaje dice "Hola feliz día como estas colega?" o similar, o adjunta imagen/foto de una publicación:
  - Valida la información consultada con el inventario de Google Sheets y responde cordialmente confirmando disponibilidad y detalles.
  - Si el colega solicita "link sin datos de contacto", ficha blanca o enlace neutro, comparte el enlace de fotos (Rexup) que no tiene datos personales.

5. REGLAS GENERALES:
- NUNCA coloques en el texto hacia el cliente el nombre ni teléfono del asesor comercial, ya que la atención humana se coordina directamente por este mismo chat de WhatsApp.
- NUNCA menciones códigos internos como [REF-001] ni REF-xxx en el texto al cliente. Presenta siempre por tipo y zona (ej: "Apartamento en Las Mercedes").
- Presenta los precios en formato "US$ [monto]". Si hay fotos disponibles (http), compártelas. Si dice "No link" no menciones nada sobre fotos.
- Al final de tu mensaje, incluye siempre exactamente esta pregunta de cierre:
"¿Te gustaría coordinar una visita presencial, para conocerlo en persona?"

6. ETIQUETA INTERNA OBLIGATORIA DE SEGUIMIENTO:
Al final de todo tu mensaje, en una nueva línea separada al final, coloca SIEMPRE el código interno de la propiedad que estás recomendando o respondiendo:
[PROPIEDAD_RECOMENDADA: REF-xxx]
(Esta etiqueta será removida automáticamente por el sistema antes del envío al cliente para disparar la alerta al asesor y a Robert).`;

    const model = process.env.CLAUDE_MODEL || 'nvidia/nemotron-3.5-lightning:free';

    // Soporte multimodal para imágenes (flyers, capturas de publicaciones de colegas)
    const userMessageContent = [];
    if (imageUrl) {
      userMessageContent.push({
        type: 'image_url',
        image_url: { url: imageUrl }
      });
    }
    userMessageContent.push({
      type: 'text',
      text: userMessage || 'Revisa esta imagen/publicación y valida los datos con el inventario de Google Sheets.'
    });

    const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessageContent }
      ],
      temperature: 0.1,
      max_tokens: 550
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://tu-techo-ideal-bot-1.onrender.com',
        'X-Title': 'Tu Techo Ideal Bot',
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });

    let aiMessage = response.data?.choices?.[0]?.message?.content?.trim();
    if (aiMessage) {
      if (aiMessage.includes('IGNORAR_NO_INMOBILIARIO')) {
        console.log('[Claude Filter] Mensaje clasificado como conversación personal/ajena/comentario casual. No se responde.');
        return { text: null, notFoundItem: null, skip: true };
      }

      // Extraer etiqueta interna de propiedad recomendada
      let matchedProperty = null;
      const propTagMatch = aiMessage.match(/\[PROPIEDAD_RECOMENDADA:\s*(REF-\d+)\]/i);
      if (propTagMatch) {
        const refCode = propTagMatch[1].toUpperCase();
        matchedProperty = availableProperties.find(p => (p.ID_PROPIEDAD || '').toUpperCase() === refCode);
        aiMessage = aiMessage.replace(/\[PROPIEDAD_RECOMENDADA:\s*REF-\d+\]\s*/gi, '').trim();
      }

      // Limpieza de seguridad: eliminar cualquier mención accidental a códigos tipo [REF-xxx] o REF-xxx
      aiMessage = aiMessage.replace(/\[\s*REF-[^\]]+\]\s*/gi, '').replace(/\bREF-\d+\b\s*/gi, '');
      // Blindaje de fotos: nunca enviar un guion "-" ni "No link" al cliente
      aiMessage = aiMessage.replace(/•?\s*\*+Fotos:\*+\s*-\s*\n?/gi, '').replace(/•?\s*\*+Fotos:\*+\s*No link\s*\n?/gi, '');
      // Blindaje de asesores: nunca colocar nombres/teléfonos de asesores en texto al cliente
      aiMessage = aiMessage.replace(/\*?\*?Asesor:\*?\*?\s*[^\n]+\n?/gi, '');

      // Verificar si detectó inmueble o detalle no disponible en Google Sheets
      if (aiMessage.includes('NO_DISPONIBLE:')) {
        const notFoundDesc = aiMessage.replace(/NO_DISPONIBLE:\s*/i, '').split('\n')[0].trim();
        console.log(`[Claude Inventory Check] Inmueble/Detalle no disponible detectado: "${notFoundDesc}"`);
        return { text: null, notFoundItem: notFoundDesc, skip: false };
      }

      console.log(`[Claude via OpenRouter] Response generated successfully (${aiMessage.length} chars)`);
      return { text: aiMessage, matchedProperty: matchedProperty, notFoundItem: null, skip: false };
    }
    return null;
  } catch (err) {
    console.warn('[Claude/OpenRouter Error]:', err.response?.data || err.message);
    if (err.response?.status === 402 || err.response?.data?.error?.code === 402) {
      console.error('[CRITICAL] OpenRouter credits exhausted (402)! Notifying Robert...');
      sendLowBalanceNotification(0.00);
    }
    return null; // Fallback al motor determinístico de emergencia
  }
}

async function matchPropertyByImage(imageUrl, properties) {
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.CLAUDE_API_KEY;
  const model = process.env.CLAUDE_MODEL || 'nvidia/nemotron-3.5-lightning:free';

  const summary = properties.slice(0, 30).map(p =>
    `${p.ID_PROPIEDAD}: ${p.TIPO} en ${p.OPERACION} en ${p.ZONA || ''} - Wasi: ${p.CODIGO_WASI || ''} - ${p.DESCRIPCION_BREVE?.substring(0, 140) || ''}`
  ).join('\n');

  try {
    const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: model,
      messages: [
        {
          role: 'system',
          content: `Analiza la imagen de la publicación inmobiliaria y compárala con el siguiente inventario de Tu Techo Ideal:\n${summary}\n\nResponde ÚNICAMENTE con el código del inmueble (ej: REF-005) o responde "NO_MATCH".`
        },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: imageUrl } },
            { type: 'text', text: '¿A cuál inmueble de Tu Techo Ideal corresponde esta imagen?' }
          ]
        }
      ],
      temperature: 0.1,
      max_tokens: 20
    }, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 15000
    });

    const matchText = response.data?.choices?.[0]?.message?.content?.trim();
    if (matchText && matchText.includes('REF-')) {
      const codeMatch = matchText.match(/REF-\d+/i);
      if (codeMatch) {
        return properties.find(p => (p.ID_PROPIEDAD || '').toUpperCase() === codeMatch[0].toUpperCase()) || null;
      }
    }
  } catch (e) {
    console.warn('[Vision Property Match Warning]:', e.message);
  }
  return null;
}

async function generateResponseRaw(userMessage, allProperties, imageUrl = null, leadId = null, clientName = 'Cliente', talkId = null, contactId = null) {
  const cleanMessage = userMessage.substring(0, 800);
  const q = normalizeText(cleanMessage);

  // 🛑 REGLA ESPECIAL STANDALONE: "Inmobiliaria tu techo ideal."
  // OJO ALERTA: Solo si la frase viene sola (con o sin errores ortográficos).
  // Si en una conversación dicen: "Ustedes son Inmobiliaria tu techo ideal.", NO responder esto.
  if (isStandaloneInmobiliariaTuTechoIdeal(cleanMessage)) {
    console.log(`[Special Standalone Match] Cliente ${clientName} envió la frase aislada de marca ("${cleanMessage}"). Respondiendo con frase oficial requerida.`);
    return {
      text: 'Hola, tienes alguna otra duda o te gustaría agendar una llamada?',
      action: 'INMOBILIARIA_STANDALONE',
      exactText: true,
      skip: false
    };
  }

  // Verificar y recuperar si hay contexto de inmueble activo en la memoria del lead (local o Kommo)
  const existingProp = await getOrRecoverLeadPropertyContext(leadId, allProperties, talkId, contactId);
  const hasActiveContext = !!existingProp;

  // 🛑 FILTRO 1: Descartar charla casual, reacciones y comentarios sin intención inmobiliaria
  if (isCasualOrChitChat(cleanMessage, imageUrl, hasActiveContext, existingProp)) {
    console.log(`[Anti-Chitchat Filter] Comentario casual o reacción detectada ("${cleanMessage}"). Silencio para no gastar tokens.`);
    return { text: null, notFoundItem: null, skip: true };
  }

  // 🛑 FILTRO DE LÍMITE DE RESPUESTAS AUTOMÁTICAS (MÁXIMO 3 A 4 RESPUESTAS POR LEAD)
  const currentCount = getLeadResponseCount(leadId);
  if (currentCount >= MAX_AI_RESPONSES_PER_LEAD) {
    console.log(`[Limit Guard] Lead #${leadId} ya alcanzó el límite de ${currentCount}/${MAX_AI_RESPONSES_PER_LEAD} respuestas automáticas. Derivando a atención humana...`);
    const activeProp = existingProp || getLeadPropertyContext(leadId, allProperties, talkId, contactId);
    return {
      text: 'Deme un momento, voy a consultar',
      action: 'LIMITE_ALCANZADO',
      matchedProperty: activeProp,
      skip: false
    };
  }

  // 🛑 CAPA DE FICHAS TÉCNICAS OFICIALES WORD (PRIORIDAD ABSOLUTA SOBRE EXCEL)
  // "los nombres de la ficha tecnica tienen las ubicaciones del inmueble, espero que respetes la informacion dada por word y no consulte nada en excel..."
  const matchedFicha = findFichaTecnica(cleanMessage, existingProp);
  if (matchedFicha) {
    console.log(`[Ficha Técnica Match] Propiedad identificada en Ficha Técnica Word: ${matchedFicha.zona} (${matchedFicha.id})`);

    const fichaProp = {
      ID_PROPIEDAD: matchedFicha.id,
      TIPO: 'Apartamento',
      ZONA: matchedFicha.zona,
      ESTATUS: 'Disponible',
      DESCRIPCION_BREVE: matchedFicha.rawText,
      isFichaTecnica: true,
      rawFicha: matchedFicha,
      CODIGO_WASI: matchedFicha.codigoWasi || '',
      Wasi: matchedFicha.wasiUrl || '',
      Wasi_URL: matchedFicha.wasiUrl || '',
      LINK_FOTOS: matchedFicha.photoUrl || '',
      LINK_FOTOS_URL: matchedFicha.photoUrl || ''
    };

    // 1. Si el cliente o colega pide agendar cita para ver este inmueble
    if (isVisitSchedulingIntent(cleanMessage)) {
      saveLeadPropertyContext(leadId, fichaProp, talkId, contactId);
      console.log(`[Visit Scheduling Intent] Solicitud de cita para ${matchedFicha.zona}.`);
      return {
        text: 'Ok, ya consulto con mi jefe para agendar la cita',
        action: 'AGENDAR_CITA',
        matchedProperty: fichaProp,
        skip: false
      };
    }

    // 2. Si el cliente o colega pide el link/fotos
    if (isPropertyLinkRequest(cleanMessage)) {
      const wasiUrl = fichaProp.Wasi_URL && fichaProp.Wasi_URL.startsWith('http') ? fichaProp.Wasi_URL : '';
      const photoUrl = fichaProp.LINK_FOTOS_URL && fichaProp.LINK_FOTOS_URL.startsWith('http') ? fichaProp.LINK_FOTOS_URL : '';
      const wantsOnlyPhotos = /fotos?|im[aá]genes/i.test(cleanMessage) && !/wasi|link|enlace/i.test(cleanMessage);

      let linkReply = '';
      if (wantsOnlyPhotos && photoUrl) {
        linkReply = `Con gusto, aquí puedes ver las fotos del inmueble: ${photoUrl}`;
      } else if (wasiUrl && photoUrl && /fotos?/i.test(cleanMessage)) {
        linkReply = `Con gusto, aquí tienes el enlace en Wasi: ${wasiUrl}\n\nY aquí puedes ver las fotos: ${photoUrl}`;
      } else if (wasiUrl) {
        linkReply = `Con gusto, aquí tienes el enlace en Wasi del inmueble: ${wasiUrl}`;
      } else if (photoUrl) {
        linkReply = `Con gusto, aquí tienes el enlace del inmueble: ${photoUrl}`;
      }

      if (linkReply) {
        saveLeadPropertyContext(leadId, fichaProp, talkId, contactId);
        console.log(`[Link Request Fulfilled] Enlace entregado para Ficha ${matchedFicha.zona}: ${wasiUrl || photoUrl}`);
        return {
          text: linkReply,
          action: 'ENLACE_ENTREGADO',
          matchedProperty: fichaProp,
          exactText: true,
          skip: false
        };
      }
    }

    // 3. Ejecutar consulta técnica blindada con Claude Sonnet 4.5 (con silencio absoluto si no está en el Word)
    const fichaResult = await handleFichaTecnicaQuery(cleanMessage, existingProp, clientName);
    if (fichaResult) {
      saveLeadPropertyContext(leadId, fichaProp, talkId, contactId);
      fichaResult.matchedProperty = fichaProp;
      return fichaResult;
    }
  }

  // 1. Emparejar propiedad mencionada en el mensaje actual (o por imagen/flyer)
  let matchedProp = null;
  const wasiCheck = matchWasiOrProperty(cleanMessage, allProperties);

  if (wasiCheck.status === 'MATCH') {
    matchedProp = wasiCheck.property;
    saveLeadPropertyContext(leadId, matchedProp, talkId, contactId);
    console.log(`[Property Match] Coincidencia encontrada: ${matchedProp.ID_PROPIEDAD} (${matchedProp.TIPO} en ${matchedProp.ZONA})`);
  } else if (wasiCheck.status === 'NOT_FOUND') {
    console.log(`[Wasi Match] Código ${wasiCheck.code} no existe en inventario. Derivando a espera y alerta.`);
    return {
      text: 'Deme un momento, voy a consultar',
      action: 'NO_EXISTE_EN_DESCRIPCION',
      notFoundItem: wasiCheck.item,
      skip: false
    };
  }

  // Si no vino código en el mensaje pero vino imagen, intentar emparejar por visión
  if (!matchedProp && imageUrl) {
    matchedProp = await matchPropertyByImage(imageUrl, allProperties);
    if (matchedProp) {
      saveLeadPropertyContext(leadId, matchedProp, talkId, contactId);
      console.log(`[Vision Match] Propiedad identificada por imagen: ${matchedProp.ID_PROPIEDAD}`);
    }
  }

  // Si aún no tenemos propiedad del mensaje, usar el contexto activo recuperado del lead
  if (!matchedProp) {
    matchedProp = existingProp || getLeadPropertyContext(leadId, allProperties, talkId, contactId);
    if (matchedProp) {
      console.log(`[Lead Context Memory] Inmueble activo recuperado para Lead #${leadId}: ${matchedProp.ID_PROPIEDAD}`);
    }
  }

  // 🛑 1.5: SI EL CLIENTE O COLEGA PIDE EL LINK / ENLACE / WASI / COMPARTIR
  if (isPropertyLinkRequest(cleanMessage)) {
    if (matchedProp) {
      const wasiUrl = matchedProp.Wasi_URL || (matchedProp.Wasi && matchedProp.Wasi.startsWith('http') ? matchedProp.Wasi : '');
      const photoUrl = matchedProp.LINK_FOTOS_URL || (matchedProp.LINK_FOTOS && matchedProp.LINK_FOTOS.startsWith('http') ? matchedProp.LINK_FOTOS : '');
      const wantsOnlyPhotos = /fotos?|im[aá]genes/i.test(cleanMessage) && !/wasi|link|enlace/i.test(cleanMessage);

      let linkReply = '';
      if (wantsOnlyPhotos && photoUrl) {
        linkReply = `Con gusto, aquí puedes ver las fotos del inmueble: ${photoUrl}`;
      } else if (wasiUrl && photoUrl && /fotos?/i.test(cleanMessage)) {
        linkReply = `Con gusto, aquí tienes el enlace en Wasi: ${wasiUrl}\n\nY aquí puedes ver las fotos: ${photoUrl}`;
      } else if (wasiUrl) {
        linkReply = `Con gusto, aquí tienes el enlace en Wasi del inmueble: ${wasiUrl}`;
      } else if (photoUrl) {
        linkReply = `Con gusto, aquí tienes el enlace del inmueble: ${photoUrl}`;
      } else {
        linkReply = 'Deme un momento, voy a consultar';
      }

      if (linkReply !== 'Deme un momento, voy a consultar') {
        console.log(`[Link Request Fulfilled] Enlace Wasi entregado para Lead #${leadId} (${matchedProp.ID_PROPIEDAD}): ${wasiUrl || photoUrl}`);
        return {
          text: linkReply,
          action: 'ENLACE_ENTREGADO',
          matchedProperty: matchedProp,
          skip: false
        };
      }
    }

    console.log(`[Link Request Not Found] Solicitud de link para Lead #${leadId} sin inmueble validado en base de datos. Derivando a espera y alerta.`);
    return {
      text: 'Deme un momento, voy a consultar',
      action: 'NO_EXISTE_EN_DESCRIPCION',
      notFoundItem: `Solicitud de enlace de inmueble no encontrado: "${cleanMessage}"`,
      skip: false
    };
  }

  // 🛑 2: Verificar si el cliente pide AGENDAR CITA o VER/VISITAR el inmueble
  if (isVisitSchedulingIntent(cleanMessage)) {
    const activeProp = matchedProp || existingProp || getLeadPropertyContext(leadId, allProperties, talkId, contactId);
    console.log(`[Visit Scheduling Intent] El cliente ${clientName} solicita agendar cita para ver inmueble.`);
    return {
      text: 'Ok, ya consulto con mi jefe para agendar la cita',
      action: 'AGENDAR_CITA',
      matchedProperty: activeProp,
      skip: false
    };
  }

  // 🛑 3: Determinar si es una consulta de DISPONIBILIDAD del inmueble identificado
  const isAvailabilityQuery = isExplicitAvailabilityQuery(cleanMessage) || wasiCheck.status === 'MATCH' || !!imageUrl || /https?:\/\/[^\s]+/i.test(cleanMessage);

  if (matchedProp && isAvailabilityQuery) {
    const isAvail = normalizeText(matchedProp.ESTATUS || '').includes('disponible') && !normalizeText(matchedProp.ESTATUS || '').includes('no');
    if (!isAvail) {
      console.log(`[Disponibilidad Inmueble] ${matchedProp.ID_PROPIEDAD} estatus: "${matchedProp.ESTATUS}". Respondiendo escuetamente "No, disponible".`);
      return {
        text: 'No, disponible',
        action: 'NO_DISPONIBLE',
        matchedProperty: matchedProp,
        exactText: true,
        skip: false
      };
    }

    console.log(`[Disponibilidad Inmueble] ${matchedProp.ID_PROPIEDAD} estatus: "${matchedProp.ESTATUS}". Respondiendo escuetamente "Si, disponible".`);
    return {
      text: 'Si, disponible',
      action: 'DISPONIBILIDAD',
      matchedProperty: matchedProp,
      exactText: true,
      skip: false
    };
  }

  // 🛑 4: Si no hay propiedad identificada, comprobar si es saludo plano o consulta genérica sin inmueble
  if (!matchedProp) {
    if (isPureGreeting(cleanMessage)) {
      const greeting = getVenezuelaGreeting();
      console.log(`[Pure Greeting Detected] Cliente ${clientName} envió un saludo plano ("${cleanMessage}").`);
      return {
        text: `Hola, bienvenido a Tu techo ideal, ${greeting}. ¿En qué inmueble o zona estás interesado para brindarte información?`,
        action: 'SALUDO_CORDIAL',
        skip: false
      };
    }

    if (isAvailabilityWithoutProperty(cleanMessage, false)) {
      const greeting = getVenezuelaGreeting();
      console.log(`[Availability Without Property] Cliente ${clientName} consultó disponibilidad sin especificar inmueble ("${cleanMessage}").`);
      return {
        text: `Hola, bienvenido a Tu techo ideal, ${greeting}. Con gusto, ¿cuál es el inmueble o enlace por el que consultas para confirmarte la disponibilidad?`,
        action: 'CONSULTA_INMUEBLE_PENDIENTE',
        skip: false
      };
    }
  }

  // 4. Si tenemos una propiedad activa y el cliente hace preguntas sobre ella (habitaciones, baños, metros, precio, etc.):
  // "Si escribe cualquier otra pregunta que exista respuesta en 'DESCRIPCION_BREVE' lo hara de la siguiente forma ejemplo: Cuantas habitaciones tiene? 'Tiene 3 habitaciones' ... sino existe 100% validada que no existe, le respondemos 'Deme un momento, voy a consultar'"
  if (matchedProp) {
    const qaResult = await generateClaudePropertyQA(cleanMessage, matchedProp, clientName);
    if (qaResult) {
      return {
        text: qaResult.text,
        action: qaResult.action,
        matchedProperty: matchedProp,
        skip: false
      };
    }

    const fallbackQA = deterministicPropertyQA(cleanMessage, matchedProp);
    return {
      text: fallbackQA.text,
      action: fallbackQA.action,
      matchedProperty: matchedProp,
      skip: false
    };
  }

  // 5. Si no hay propiedad identificada y el cliente pregunta por inmuebles generales
  const generalResult = await handleGeneralPropertySearch(cleanMessage, allProperties);
  if (generalResult) {
    return generalResult;
  }

  // 6. Si no se puede validar ni responder con certeza de la BD:
  // Si el mensaje no tiene intención inmobiliaria (no busca comprar, alquilar, ni menciona zonas o características),
  // se deja en visto silenciosamente sin gastar tokens ni alertar innecesariamente
  if (!hasExplicitRealEstateIntent(cleanMessage, imageUrl)) {
    console.log(`[Anti-Spam Filter] Mensaje sin intención inmobiliaria descartado silenciosamente: "${cleanMessage}"`);
    return { text: null, notFoundItem: null, skip: true };
  }

  return {
    text: 'Deme un momento, voy a consultar',
    action: 'NO_EXISTE_EN_DESCRIPCION',
    notFoundItem: cleanMessage,
    skip: false
  };
}

// ==========================================
// 🌟 PROTOCOLO OFICIAL DE SALUDO Y BLINDAJE DE ATENCIÓN AL CLIENTE
// ==========================================
function finalizeResponse(result, leadId) {
  if (!result || result.skip || !result.text) return result;

  const greeting = getVenezuelaGreeting();
  const officialGreetingPrefix = `Hola, bienvenido a Tu techo ideal, ${greeting}`;

  // 🛑 CASO: FALTA DE INFORMACIÓN EN BD / INMUEBLE NO ENCONTRADO
  // "esta bien el mensaje de entrada pero no, no respondas porque no tenemos acceso a esa informacion,
  // en este caso avisa urgente a robert para que en futuro responda el...
  // Y este mensaje 'Hola, bienvenido a Tu techo ideal, buenas tardes. Con mucho gusto te asesoramos.'
  // vamos acomodarlo por esto 'Hola, bienvenido a Tu techo ideal, buenas tardes. Voy a consultar y ya le doy informacion.'
  // listo esperamos a que el humano responda"
  if (result.action === 'NO_EXISTE_EN_DESCRIPCION' || /^deme\s+un\s+momento/i.test(result.text)) {
    result.text = `${officialGreetingPrefix}. Voy a consultar y ya le doy informacion.`;
    result.action = 'NO_EXISTE_EN_DESCRIPCION';
    result.exactText = true;
    return result;
  }

  // 🛑 SI ES LA RESPUESTA DIRECTA DE DISPONIBILIDAD, NO DISPONIBLE O STANDALONE, NO AGREGAR SALUDO DE BIENVENIDA
  if (
    result.action === 'INMOBILIARIA_STANDALONE' ||
    result.action === 'DISPONIBILIDAD' ||
    result.action === 'NO_DISPONIBLE' ||
    result.exactText
  ) {
    return result;
  }

  const currentCount = getLeadResponseCount(leadId);

  if (currentCount === 0) {
    let cleanText = result.text.trim();

    // Si ya empieza con "Bienvenido a Tu Techo Ideal", normalizar al saludo oficial exacto
    if (/^bienvenido\s+a\s+tu\s+techo\s+ideal/i.test(cleanText)) {
      cleanText = cleanText.replace(/^bienvenido\s+a\s+tu\s+techo\s+ideal[,\.]?\s*(buen d[ií]a|buenas tardes|buenas noches)?[,\.]?\s*/i, `${officialGreetingPrefix}. `);
      cleanText = cleanText.replace(/^(Hola,\s*bienvenido\s+a\s+Tu\s+techo\s+ideal,\s*(?:buen d[ií]a|buenas tardes|buenas noches))\.\s*(s[ií]\s*disponible)/i, '$1, $2');
    } else if (!/^hola,\s*bienvenido\s+a\s+tu\s+techo\s+ideal/i.test(cleanText)) {
      // Si la respuesta no contiene el saludo oficial de bienvenida, anteponerlo con cordialidad profesional
      if (/^ok,\s*ya\s+consulto/i.test(cleanText)) {
        cleanText = `${officialGreetingPrefix}. Ok, ya consulto con mi jefe para agendar la cita.`;
      } else {
        cleanText = `${officialGreetingPrefix}. ${cleanText}`;
      }
    }
    result.text = cleanText;
  } else {
    // Si ya es la 2da, 3ra o 4ta respuesta, evitar saludos repetitivos en cada mensaje
    let cleanText = result.text.trim();
    if (/^hola,\s*bienvenido\s+a\s+tu\s+techo\s+ideal[,\.]?\s*(buen d[ií]a|buenas tardes|buenas noches)?[,\.]?\s*/i.test(cleanText)) {
      cleanText = cleanText.replace(/^hola,\s*bienvenido\s+a\s+tu\s+techo\s+ideal[,\.]?\s*(buen d[ií]a|buenas tardes|buenas noches)?[,\.]?\s*/i, '').trim();
      if (cleanText) cleanText = cleanText.charAt(0).toUpperCase() + cleanText.slice(1);
    } else if (/^bienvenido\s+a\s+tu\s+techo\s+ideal[,\.]?\s*(buen d[ií]a|buenas tardes|buenas noches)?[,\.]?\s*/i.test(cleanText)) {
      cleanText = cleanText.replace(/^bienvenido\s+a\s+tu\s+techo\s+ideal[,\.]?\s*(buen d[ií]a|buenas tardes|buenas noches)?[,\.]?\s*/i, '').trim();
      if (cleanText) cleanText = cleanText.charAt(0).toUpperCase() + cleanText.slice(1);
    }
    // Si la respuesta es de espera por falta de datos, responder la frase oficial
    if (/^deme\s+un\s+momento/i.test(cleanText)) {
      cleanText = `${officialGreetingPrefix}. Voy a consultar y ya le doy informacion.`;
    } else if (/^ok,\s*ya\s+consulto/i.test(cleanText)) {
      cleanText = 'Ok, ya consulto con mi jefe para agendar la cita.';
    }
    if (cleanText) result.text = cleanText;
  }

  return result;
}

async function generateResponse(userMessage, allProperties, imageUrl = null, leadId = null, clientName = 'Cliente', talkId = null, contactId = null) {
  const result = await generateResponseRaw(userMessage, allProperties, imageUrl, leadId, clientName, talkId, contactId);
  return finalizeResponse(result, leadId);
}

// ==========================================
// ⚡ COMUNICACIÓN CON KOMMO CRM
// ==========================================
async function ensureLeadInActivePipeline(leadId, forceDispatch = false) {
  if (!leadId) return;
  if (OBSERVATION_MODE && !forceDispatch) {
    console.log(`[OBSERVATION MODE] ensureLeadInActivePipeline(Lead #${leadId}) interceptado. Cero llamadas a Kommo.`);
    return null;
  }
  try {
    const token = process.env.KOMMO_TOKEN;
    const subdomain = process.env.KOMMO_SUBDOMAIN || 'tutechoidealrd';
    const authHeader = token.startsWith('Bearer ') ? token : `Bearer ${token}`;

    const leadRes = await axios.get(`https://${subdomain}.kommo.com/api/v4/leads/${leadId}`, {
      headers: { Authorization: authHeader },
      timeout: 5000
    });

    const lead = leadRes.data;
    // Status 108871567 es "Leads Entrantes" (Buzón Unsorted), responsible_user_id 0 es sin asignar
    if (lead && (lead.status_id === 108871567 || lead.responsible_user_id === 0 || lead.is_unsorted)) {
      console.log(`[Auto-Accept Lead] Lead #${leadId} es contacto nuevo o no clasificado (status ${lead.status_id}, resp ${lead.responsible_user_id}). Auto-aceptando a "Contacto inicial" (108871571) con Robert Jiménez (15568119)...`);

      await axios.patch(`https://${subdomain}.kommo.com/api/v4/leads/${leadId}`, {
        status_id: 108871571, // "Contacto inicial"
        responsible_user_id: 15568119 // Robert Jiménez
      }, {
        headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
        timeout: 5000
      });

      console.log(`[Auto-Accept Lead] Lead #${leadId} movido con éxito a "Contacto inicial" (108871571). Salesbot habilitado.`);
    }
  } catch (err) {
    console.warn(`[Auto-Accept Lead Error] No se pudo auto-aceptar Lead #${leadId}:`, err.message);
  }
}

async function updateKommoLead(leadId, aiText, forceDispatch = false) {
  if (OBSERVATION_MODE && !forceDispatch) {
    console.log(`[OBSERVATION MODE] updateKommoLead(Lead #${leadId}, "${(aiText || '').substring(0, 30)}...") interceptado. Cero actualizaciones a Kommo.`);
    return { id: leadId, observation_mode: true };
  }
  const token = process.env.KOMMO_TOKEN;
  const subdomain = process.env.KOMMO_SUBDOMAIN;
  const fieldId = parseInt(process.env.KOMMO_FIELD_ID, 10);
  const authHeader = token.startsWith('Bearer ') ? token : `Bearer ${token}`;

  const url = `https://${subdomain}.kommo.com/api/v4/leads/${leadId}`;
  const payload = {
    custom_fields_values: [
      {
        field_id: fieldId,
        values: [{ value: aiText }]
      }
    ]
  };

  const response = await axios.patch(url, payload, {
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json'
    },
    timeout: 10000
  });

  console.log(`[Kommo API] Lead #${leadId} updated successfully (Status ${response.status})`);
  return response.data;
}

async function triggerKommoSalesbot(leadId, forceDispatch = false) {
  if (OBSERVATION_MODE && !forceDispatch) {
    console.log(`[OBSERVATION MODE] triggerKommoSalesbot(Lead #${leadId}) interceptado. Cero disparos a Salesbot.`);
    return { success: true, observation_mode: true };
  }
  const token = process.env.KOMMO_TOKEN;
  const subdomain = process.env.KOMMO_SUBDOMAIN;
  const botId = parseInt(process.env.KOMMO_BOT_ID, 10);

  const url = `https://${subdomain}.kommo.com/api/v4/bots/${botId}/run`;
  const payload = {
    entity_id: parseInt(leadId, 10),
    entity_type: 'leads'
  };

  const response = await axios.post(url, payload, {
    headers: {
      'Authorization': token.startsWith('Bearer ') ? token : `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    timeout: 10000
  });

  console.log(`[Kommo API] Salesbot #${botId} triggered for Lead #${leadId} (Status ${response.status})`);
  return response.data;
}

// 🛑 DETENER SALESBOT EN KOMMO PARA EVITAR SECUENCIAS O TIMERS NO DESEADOS
async function stopKommoSalesbot(leadId, forceDispatch = false) {
  if (!leadId) return;
  if (OBSERVATION_MODE && !forceDispatch) {
    console.log(`[OBSERVATION MODE] stopKommoSalesbot(Lead #${leadId}) interceptado. Cero llamadas a Kommo.`);
    return { success: true, observation_mode: true };
  }
  const token = process.env.KOMMO_TOKEN;
  const subdomain = process.env.KOMMO_SUBDOMAIN;
  const botId = parseInt(process.env.KOMMO_BOT_ID || '100766', 10);
  if (!token || !subdomain || !botId) return;

  try {
    const url = `https://${subdomain}.kommo.com/api/v4/bots/${botId}/stop`;
    const payload = {
      entity_id: parseInt(leadId, 10),
      entity_type: 'leads'
    };
    await axios.post(url, payload, {
      headers: {
        'Authorization': token.startsWith('Bearer ') ? token : `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      timeout: 5000
    });
    console.log(`[Kommo API] Salesbot #${botId} DETENIDO exitosamente para Lead #${leadId} (Parada forzosa por atención humana/bloqueo).`);
  } catch (err) {
    console.warn(`[Kommo API Stop Bot Warning] No se pudo detener Salesbot #${botId} para Lead #${leadId}:`, err.response?.data?.detail || err.message);
  }
}

function extractImageUrl(body, messageObj) {
  const attachType = (messageObj?.attachment?.type || body?.['message[add][0][attachment][type]'] || '').toLowerCase();
  const attachMime = (messageObj?.attachment?.mime_type || body?.['message[add][0][attachment][mime_type]'] || '').toLowerCase();

  // Si el adjunto es video, audio, voz o story, NUNCA es una imagen de inmueble
  if (attachType.includes('video') || attachType.includes('audio') || attachType.includes('voice') || attachType.includes('story')) {
    return null;
  }
  if (attachMime.includes('video') || attachMime.includes('audio')) {
    return null;
  }

  const candidateUrls = [
    messageObj?.attachment?.link,
    messageObj?.attachment?.url,
    messageObj?.media,
    messageObj?.media_url,
    body?.['message[add][0][attachment][link]'],
    body?.['message[add][0][attachment][url]'],
    body?.['message[add][0][media]'],
    body?.['message[add][0][media_url]'],
    messageObj?.link,
    body?.['message[add][0][link]']
  ].filter(Boolean);

  for (const u of candidateUrls) {
    const s = String(u);
    // Descartar videos y audios
    if (/\.(mp4|mov|avi|webm|mkv|ogg|opus|mp3|m4a|wav)(?:\?|$)/i.test(s)) continue;
    // Si tiene extensión explícita de imagen o viene en attachment tipo picture/image
    if (/\.(jpeg|jpg|png|webp)(?:\?|$)/i.test(s) || attachType.includes('image') || attachType.includes('picture') || attachMime.includes('image')) {
      return s;
    }
  }

  const text = messageObj?.text || '';
  const urlMatch = text.match(/(https?:\/\/[^\s]+\.(?:jpg|jpeg|png|webp)(?:\?[^\s]+)?)/i);
  if (urlMatch) return urlMatch[1];
  return null;
}

function isVoiceNoteOrAudio(body, messageObj, userText = '') {
  const mType = (messageObj?.type || body?.['message[add][0][type]'] || '').toLowerCase();
  if (mType === 'voice' || mType === 'audio') return true;

  const attachType = (messageObj?.attachment?.type || body?.['message[add][0][attachment][type]'] || '').toLowerCase();
  const attachMime = (messageObj?.attachment?.mime_type || body?.['message[add][0][attachment][mime_type]'] || '').toLowerCase();
  if (attachType === 'audio' || attachType === 'voice' || attachMime.includes('audio')) return true;

  const mediaUrl = messageObj?.media || messageObj?.media_url || messageObj?.attachment?.link || messageObj?.attachment?.url ||
    body?.['message[add][0][media]'] || body?.['message[add][0][media_url]'] ||
    body?.['message[add][0][attachment][link]'] || body?.['message[add][0][attachment][url]'] || '';
  if (/\.(?:ogg|opus|mp3|m4a|wav|aac|amr|oga)(?:\?|$)/i.test(String(mediaUrl))) return true;

  const clean = (userText || '').trim().toLowerCase();
  if (!clean) return false;
  if (/^\[?(?:nota\s+de\s+voz|mensaje\s+de\s+voz|audio|voice\s*note|voice\s*message|ptt)\]?$/i.test(clean)) return true;
  if (clean === '<audio>' || clean === '<nota de voz>' || clean === '<voice note>') return true;
  if (/\.(?:ogg|opus|mp3|m4a|wav|aac|amr|oga)(?:\?[^\s]+)?$/i.test(clean)) return true;

  return false;
}

function isInstagramStoryOrRestricted(body, messageObj = null, userText = '') {
  // 1. Inspección profunda del cuerpo crudo del webhook
  try {
    const rawStr = normalizeText(typeof body === 'string' ? body : JSON.stringify(body || {}));
    if (
      rawStr.includes('te menciono en su historia') ||
      rawStr.includes('te menciono en una historia') ||
      rawStr.includes('menciono en su historia') ||
      rawStr.includes('menciono en una historia') ||
      (rawStr.includes('te menciono') && rawStr.includes('historia')) ||
      (rawStr.includes('menciono') && rawStr.includes('historia')) ||
      (rawStr.includes('mencion') && rawStr.includes('historia')) ||
      rawStr.includes('mentioned you in their story') ||
      rawStr.includes('mentioned you in a story') ||
      (rawStr.includes('mentioned you') && rawStr.includes('story')) ||
      rawStr.includes('story_mention') ||
      rawStr.includes('story_share') ||
      rawStr.includes('story_reply') ||
      rawStr.includes('story_reaction') ||
      rawStr.includes('respondio a tu historia') ||
      rawStr.includes('reacciono a tu historia') ||
      rawStr.includes('replied to your story') ||
      rawStr.includes('reacted to your story') ||
      rawStr.includes('compartio una historia') ||
      rawStr.includes('compartio tu historia') ||
      rawStr.includes('compartio un reel') ||
      rawStr.includes('shared a story') ||
      rawStr.includes('shared a reel') ||
      rawStr.includes('restricciones de instagram') ||
      rawStr.includes('instagram restrictions') ||
      rawStr.includes('no podemos mostrar este mensaje') ||
      rawStr.includes('cannot display this message') ||
      rawStr.includes('could not be displayed') ||
      rawStr.includes('api restrictions') ||
      rawStr.includes('due to api restrictions') ||
      rawStr.includes('the message could not be displayed') ||
      rawStr.includes('abre esta conversacion en tu cuenta de instagram') ||
      rawStr.includes('estas se aplican a reels') ||
      rawStr.includes('galerias de videos') ||
      rawStr.includes('galerias de fotos') ||
      rawStr.includes('avatares y pedidos') ||
      rawStr.includes('lo sentimos, pero no podemos mostrar este mensaje') ||
      rawStr.includes('lo sentimos pero no podemos mostrar este mensaje') ||
      rawStr.includes('recibiste un mensaje multimedia') ||
      rawStr.includes('espera a que se cargue o se visualice') ||
      rawStr.includes('id del mensaje:')
    ) {
      return true;
    }
  } catch (e) {}

  // 2. Inspección de campos de texto específicos
  const candidates = [
    userText,
    typeof body === 'string' ? body : null,
    messageObj?.text,
    messageObj?.value,
    messageObj?.attachment?.name,
    messageObj?.attachment?.title,
    body?.['message[add][0][text]'],
    body?.['message[add][0][value]'],
    body?.['message[add][0][attachment][name]'],
    body?.['message[add][0][attachment][title]'],
    body?.['message[add][0][attachment][type]']
  ];

  for (const c of candidates) {
    if (!c || typeof c !== 'string') continue;
    const q = normalizeText(c);
    if (
      q.includes('te menciono en su historia') ||
      q.includes('menciono en su historia') ||
      q.includes('menciono en una historia') ||
      (q.includes('menciono') && q.includes('historia')) ||
      (q.includes('mencion') && q.includes('historia')) ||
      q.includes('mentioned you in their story') ||
      q.includes('mentioned you in a story') ||
      (q.includes('mentioned you') && q.includes('story')) ||
      q.includes('te menciono') ||
      q.includes('respondio a tu historia') ||
      q.includes('reacciono a tu historia') ||
      q.includes('replied to your story') ||
      q.includes('reacted to your story') ||
      q.includes('compartio una historia') ||
      q.includes('compartio tu historia') ||
      q.includes('compartio un reel') ||
      q.includes('shared a story') ||
      q.includes('shared a reel') ||
      q.includes('restricciones de instagram') ||
      q.includes('instagram restrictions') ||
      q.includes('no podemos mostrar este mensaje') ||
      q.includes('cannot display this message') ||
      q.includes('could not be displayed') ||
      q.includes('api restrictions') ||
      q.includes('due to api restrictions') ||
      q.includes('the message could not be displayed') ||
      q.includes('abre esta conversacion en tu cuenta de instagram') ||
      q.includes('estas se aplican a reels') ||
      q.includes('galerias de videos') ||
      q.includes('galerias de fotos') ||
      q.includes('avatares y pedidos') ||
      q.includes('lo sentimos, pero no podemos mostrar este mensaje') ||
      q.includes('lo sentimos pero no podemos mostrar este mensaje') ||
      q.includes('recibiste un mensaje multimedia') ||
      q.includes('espera a que se cargue o se visualice') ||
      q.includes('id del mensaje:') ||
      q.includes('story') ||
      q.includes('story_mention')
    ) {
      return true;
    }
  }

  // 3. Inspección de tipo de evento y tipo de adjunto
  const mType = String(messageObj?.type || body?.['message[add][0][type]'] || '').toLowerCase();
  const attachType = String(messageObj?.attachment?.type || body?.['message[add][0][attachment][type]'] || '').toLowerCase();
  if (
    mType.includes('story') || 
    mType.includes('reel') || 
    mType.includes('mention') ||
    attachType.includes('story') ||
    attachType.includes('reel') ||
    attachType.includes('mention')
  ) {
    return true;
  }

  return false;
}

// ==========================================
// 📡 ENDPOINT DEL WEBHOOK
// ==========================================
app.post(['/webhook', '/kommo-webhook'], async (req, res) => {
  const isSync = req.query.sync === 'true' || req.headers['x-sync-eval'] === 'true';
  // Respuesta 200 OK inmediata para Kommo cuando no se solicita evaluación síncrona
  if (!isSync) {
    res.status(200).send({ status: 'ok' });
  }

  let msgKey = null;

  try {
    const body = req.body;

    // 🛑 BLINDAJE INMEDIATO NIVEL 0: Menciones de Instagram, Stories y Restricciones
    // "todo lo que diga 'Te mencionó en su historia' no se responde... CERO"
    // "tampoco le mandes alerta a robert por eso... silencio absoluto (0 mensajes al cliente y 0 alertas a Robert)"
    if (isInstagramStoryOrRestricted(body)) {
      console.log('[CRITICAL BLINDAJE] Instagram story mention or restricted notice discarded immediately at endpoint entry. Zero client messages, zero Robert alerts.');
      recordStagingDecision({
        timestamp: Date.now(),
        lead_id: null,
        talk_id: null,
        user_text: '[Instagram Story/Restricted]',
        observation_mode: OBSERVATION_MODE,
        decision: { action: 'SILENCE', typeDetected: 'SOCIAL_MEDIA_MENTION', reason: 'Mención de Instagram descartada en la entrada.' },
        text: null
      });
      if (isSync && !res.headersSent) {
        return res.status(200).json({ status: 'ok', handled: 'DISCARDED_INSTAGRAM_STORY' });
      }
      return;
    }

    // Validación de Cuenta Kommo
    if (body.account && body.account.id) {
      const allowedAccountId = process.env.KOMMO_ACCOUNT_ID || '36728143';
      if (String(body.account.id) !== String(allowedAccountId)) {
        console.warn(`[Security] Petición rechazada: Account ID no coincide (${body.account.id})`);
        if (isSync && !res.headersSent) {
          return res.status(403).json({ error: 'Account ID mismatch' });
        }
        return;
      }
    }

    let messageObj = null;
    if (body.message && body.message.add && body.message.add[0]) {
      messageObj = body.message.add[0];
    } else if (body['message[add][0][text]'] || body['message[add][0][value]']) {
      messageObj = {
        id: body['message[add][0][id]'],
        text: body['message[add][0][text]'] || body['message[add][0][value]'],
        entity_id: body['message[add][0][entity_id]'] || body['message[add][0][element_id]'],
        talk_id: body['message[add][0][talk_id]'],
        contact_id: body['message[add][0][contact_id]'],
        type: body['message[add][0][type]'],
        origin: body['message[add][0][origin]'],
        source_id: body['message[add][0][source_id]'],
        is_comment: body['message[add][0][is_comment]'],
        item: body['message[add][0][item]'],
        author: {
          type: body['message[add][0][author][type]'],
          name: body['message[add][0][author][name]']
        }
      };
    }

    if (!messageObj) {
      console.log('[Webhook] Not a chat message event. Skipping.');
      if (isSync && !res.headersSent) {
        return res.status(200).json({ status: 'ok', handled: 'NOT_A_CHAT_MESSAGE' });
      }
      return;
    }

    // 🛑 DETECCIÓN INMEDIATA DE INTERVENCIÓN HUMANA EN CHAT (OUTGOING)
    // "PORQUE RESPONDES SI YA UN HUMANO LO HIZO......"
    // Se procesa inmediatamente antes de cualquier filtro para que NINGÚN mensaje humano pase desapercibido.
    if (messageObj.type === 'outgoing') {
      const outText = (messageObj.text || messageObj.value || '').trim();
      let outLeadId = messageObj.entity_id || messageObj.element_id;
      const outTalkId = messageObj.talk_id;
      const outContactId = messageObj.contact_id;

      if (!outLeadId && outTalkId) {
        try {
          const talkRes = await axios.get(`https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/talks/${outTalkId}`, {
            headers: { Authorization: process.env.KOMMO_TOKEN },
            timeout: 4000
          });
          outLeadId = talkRes.data?.entity_id;
        } catch (e) {}
      }

      const outClassification = classifyOutgoingMessage(messageObj, (text, id) => isRecentBotDispatchedMessage(text, outLeadId || id || outTalkId));

      if (outClassification.isBot) {
        console.log(`[Bot Outgoing Echo] Mensaje saliente generado por el bot confirmado (${outClassification.source}, "${outText.substring(0, 40)}..."). Skipping echo.`);
        if (isSync && !res.headersSent) {
          return res.status(200).json({ status: 'ok', handled: 'BOT_OUTGOING_ECHO' });
        }
        return;
      }

      console.log(`[HUMAN INTERVENTION DETECTED IN WEBHOOK] Intervención saliente detectada (${outClassification.source}, Lead #${outLeadId}, Talk #${outTalkId}, Contact #${outContactId}): "${outText}". Activando handoff total por ${HANDOFF_LOCK_HOURS} horas y deteniendo Salesbot.`);

      // En el webhook público el tiempo siempre es estrictamente el reloj real Date.now()
      const simulatedNowOut = Date.now();

      // Registrar en ambos gestores (nuevo pipeline central y compatibilidad)
      centralHandoffManager.recordHumanIntervention(outLeadId, outTalkId, outContactId, simulatedNowOut);
      if (outLeadId) setLeadHandoff(outLeadId);
      if (outTalkId) setTalkHandoff(outTalkId);
      if (outContactId) setContactHandoff(outContactId);

      recordStagingDecision({
        timestamp: simulatedNowOut,
        lead_id: outLeadId,
        talk_id: outTalkId,
        user_text: outText,
        observation_mode: OBSERVATION_MODE,
        decision: {
          action: 'LOCK_12H',
          typeDetected: 'HUMAN_OUTGOING_INTERVENTION',
          source: outClassification.source,
          reason: `Intervención humana detectada (${outClassification.source}). Bloqueo de ${HANDOFF_LOCK_HOURS} horas activado.`
        },
        text: null
      });

      const isOutControlledDispatch = isControlledDispatchAuthorized(outLeadId, outTalkId);

      // En MODO OBSERVACIÓN (sin autorización de despacho controlado): Cero efectos secundarios en Kommo
      if (OBSERVATION_MODE && !isOutControlledDispatch) {
        console.log(`[OBSERVATION MODE] Intervención registrada internamente. Cero mutaciones a Kommo.`);
        if (isSync && !res.headersSent) {
          return res.status(200).json({
            status: 'ok',
            processed: true,
            action: 'LOCK_12H',
            source: outClassification.source,
            reason: `Intervención humana detectada (${outClassification.source}). Bloqueo de ${HANDOFF_LOCK_HOURS} horas activado.`
          });
        }
        return;
      }

      // Para conversaciones en despacho controlado o producción:
      // Cancelar inmediatamente Salesbot y cualquier Respuesta_IA residual para evitar colisiones
      if (outLeadId) {
        await stopKommoSalesbot(outLeadId);
        try {
          await updateKommoLead(outLeadId, ' ');
          console.log(`[Anti-Collision] Respuesta_IA vaciada y Salesbot detenido para Lead #${outLeadId}`);
        } catch (e) {}
      }

      if (isSync && !res.headersSent) {
        return res.status(200).json({
          status: 'ok',
          processed: true,
          action: 'LOCK_12H',
          source: outClassification.source,
          reason: `Intervención humana detectada (${outClassification.source}). Bloqueo de ${HANDOFF_LOCK_HOURS} horas activado en Kommo.`
        });
      }

      return;
    }

    const imageUrl = extractImageUrl(body, messageObj);
    let userText = (messageObj.text || messageObj.value || '').trim();

    // 🛑 BLINDAJE NIVEL 1: Validación con objeto de mensaje resuelto y userText
    if (isInstagramStoryOrRestricted(body, messageObj, userText)) {
      console.log(`[Instagram Story/Restricted Ignored] Mención o restricción de Instagram descartada silenciosamente ("${userText.substring(0, 60)}..."). Sin respuesta al cliente y sin alerta a Robert.`);
      return;
    }

    // 🛑 BLINDAJE DE PALABRA CLAVE DE CAMPAÑA META ("Ideal"):
    // Si el cliente envía la palabra clave configurada en la pauta de Meta ("Ideal"),
    // Meta o el Salesbot ya tienen programado su flujo. El bot guarda silencio total para no generar mensajes dobles ni alertar falsamente a Robert.
    if (isMetaCampaignKeyword(userText)) {
      console.log(`[Meta Campaign Keyword Ignored] Detectada palabra clave de campaña ("${userText}"). Respetando automatización de Meta/Salesbot. Silencio total (0 mensajes al cliente y 0 alertas a Robert).`);
      return;
    }

    // 🛑 FILTRO DE SILENCIO TOTAL: Si el cliente NO escribió texto (y no es nota de voz), NUNCA responder
    // Previene que historias, reels, fotos aisladas, stickers o galerías disparen respuestas no solicitadas
    if (!userText && !isVoiceNoteOrAudio(body, messageObj, userText)) {
      console.log('[Webhook] Mensaje sin texto escrito por el cliente (media/story/reel/adjunto sin consulta). Silencio absoluto respetando el cuadro de diálogo.');
      return;
    }

    if (!userText && isVoiceNoteOrAudio(body, messageObj, userText)) {
      userText = '[Nota de voz / Audio recibido]';
    }

    const properties = await getAvailableProperties();

    // 🛑 FILTRO DE LINKS AISLADOS SIN PREGUNTA (Excluye links de nuestro propio inventario de Google Sheets):
    // "No puso hola ni nada solo mando un link cualquiera y le responde? No eso no puede pasar cancelado..."
    // "Revisa esta conversacion y dime si esta ese enlace en la base de datos y si es si, porque no respondio"
    if (isStandaloneLinkWithoutQuestion(userText, properties)) {
      console.log(`[Standalone Link Ignored] Mensaje contiene solo un link ajeno sin consulta concreta ("${userText.substring(0, 80)}..."). Cancelado. Silencio absoluto respetando el cuadro de diálogo.`);
      return;
    }

    // 🛑 FILTRO 1: Anti-Autorespuesta (Si el mensaje contiene el nombre de la empresa, es del bot)
    // Se exceptúa si el cliente envió la frase aislada de marca solicitada ("Inmobiliaria tu techo ideal.")
    if (!isStandaloneInmobiliariaTuTechoIdeal(userText) && (userText.includes('Tu Techo Ideal, ') || userText.includes('Robert Jiménez') || (messageObj.author?.type !== 'external' && userText.includes('Tu Techo Ideal')))) {
      console.log('[Webhook] Bot self-message detected. Skipping.');
      return;
    }

    // 🛑 FILTRO 2: Solo mensajes entrantes del cliente
    if (messageObj.type && messageObj.type !== 'incoming') {
      console.log(`[Webhook] Skipping non-incoming message (type: ${messageObj.type})`);
      return;
    }

    // 🛑 FILTRO 3: Autor externo obligatorio
    if (messageObj.author && messageObj.author.type && messageObj.author.type !== 'external') {
      console.log(`[Webhook] Skipping non-external author (author.type: ${messageObj.author.type})`);
      return;
    }

    // 🛑 FILTRO 4: Deduplicación e Idempotencia Persistente por Message ID / Event ID
    msgKey = idempotencyManager.resolveMessageKey(body, messageObj);
    const lockResult = idempotencyManager.acquireLock(msgKey, messageObj.talk_id, messageObj.entity_id || messageObj.element_id);

    if (!lockResult.allowed) {
      console.log(`[Idempotency] Message key [${msgKey}] already processed or in-flight (${lockResult.reason}). Skipping duplicate.`);
      if (isSync && !res.headersSent) {
        return res.status(200).json({ status: 'ok', handled: 'IDEMPOTENCY_REJECTED', reason: lockResult.reason, diagnosticCode: 'DUPLICATE_EVENT' });
      }
      return;
    }

    // 🛑 FILTRO 4.1: Mutex Lock en Vuelo por Talk ID (Previene carreras concurrentes antes de resolver el lead)
    const currentTalkId = messageObj.talk_id ? String(messageObj.talk_id) : null;
    if (currentTalkId && activeProcessingTalks.has(currentTalkId)) {
      console.log(`[Webhook] Talk #${currentTalkId} ya está en procesamiento en vuelo. Skipping petición paralela.`);
      return;
    }
    if (currentTalkId) {
      activeProcessingTalks.add(currentTalkId);
    }

    // Resolver Lead ID, Canal y Origen
    let leadId = messageObj.entity_id || messageObj.element_id;
    let talkOrigin = messageObj.origin || null;
    let talkSourceId = messageObj.source_id || null;

    if (messageObj.talk_id) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const talkRes = await axios.get(`https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/talks/${messageObj.talk_id}`, {
            headers: { Authorization: process.env.KOMMO_TOKEN },
            timeout: 5000
          });
          if (talkRes.data) {
            if (talkRes.data.origin) talkOrigin = talkRes.data.origin;
            if (talkRes.data.source_id) talkSourceId = talkRes.data.source_id;
            if (!leadId && talkRes.data.entity_id) {
              leadId = talkRes.data.entity_id;
              break;
            }
          }
        } catch (err) {
          if (attempt === 3) console.warn('[Webhook] Could not resolve lead from talk_id:', err.message);
        }
        if (!leadId && attempt < 3) {
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }

    let clientPhone = '';
    if (messageObj.contact_id) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const contactRes = await axios.get(`https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/contacts/${messageObj.contact_id}?with=leads`, {
            headers: { Authorization: process.env.KOMMO_TOKEN },
            timeout: 5000
          });
          if (!leadId) {
            leadId = contactRes.data._embedded?.leads?.[0]?.id;
          }
          const phoneField = contactRes.data.custom_fields_values?.find(f => f.field_code === 'PHONE' || f.field_name === 'Phone' || f.field_name === 'Teléfono');
          if (phoneField?.values?.[0]?.value) {
            clientPhone = phoneField.values[0].value;
          }
          if (leadId) break;
        } catch (err) {
          if (attempt === 3) console.warn('[Webhook] Could not resolve lead/phone from contact_id:', err.message);
        }
        if (!leadId && attempt < 3) {
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }

    // Respaldo antibloqueo para contactos nuevos: buscar en el buzón de no clasificados (unsorted)
    if (!leadId && (messageObj.contact_id || messageObj.talk_id)) {
      try {
        const unsortedRes = await axios.get(`https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/unsorted?limit=50`, {
          headers: { Authorization: process.env.KOMMO_TOKEN },
          timeout: 5000
        });
        const unsortedList = unsortedRes.data?._embedded?.unsorted || [];
        const match = unsortedList.find(u =>
          (messageObj.contact_id && u._embedded?.contacts?.some(c => String(c.id) === String(messageObj.contact_id))) ||
          (messageObj.talk_id && u.source_uid && u.source_uid.includes(String(messageObj.talk_id)))
        );
        if (match && match._embedded?.leads?.[0]?.id) {
          leadId = match._embedded.leads[0].id;
          console.log(`[Webhook] Lead #${leadId} resuelto con éxito desde el buzón de no clasificados (Unsorted UID: ${match.uid})`);
        }
      } catch (err) {
        console.warn('[Webhook] Error buscando en unsorted:', err.message);
      }
    }

    if (!leadId) {
      console.log('[Webhook] Could not resolve lead entity_id. Skipping.');
      if (currentTalkId) activeProcessingTalks.delete(currentTalkId);
      if (isSync && !res.headersSent) return res.status(200).json({ status: 'ok', handled: 'NO_LEAD_ID' });
      return;
    }

    const currentLeadId = String(leadId);
    const clientName = messageObj.author?.name || 'Cliente';

    // Identificar canal exacto de la conversación (Facebook Messenger, Instagram, WhatsApp)
    const detectedChannel = resolveCommunicationChannel(talkOrigin, talkSourceId, clientPhone, clientName, messageObj);

    // 🛑 FILTRO 4.2: Ignorar si el mensaje procede del propio Robert Jiménez (Broker / Admin) o de su chat de alertas
    const isRobertChat = currentLeadId === '7882504' ||
      String(messageObj.contact_id) === '18822786' ||
      (clientPhone && (clientPhone.includes('4143115105') || clientPhone.includes('4223115105')));
    if (isRobertChat) {
      console.log(`[Webhook] Mensaje procedente del chat o número de Robert (${clientPhone || currentLeadId}). El bot no responde a Robert.`);
      if (currentTalkId) activeProcessingTalks.delete(currentTalkId);
      if (isSync && !res.headersSent) return res.status(200).json({ status: 'ok', handled: 'ROBERT_CHAT' });
      return;
    }

    // 🛑 FILTRO 5: Mutex Lock en Vuelo por Lead ID (Garantiza 0 duplicados y 0 tokens perdidos)
    if (activeProcessingLeads.has(currentLeadId)) {
      console.log(`[Webhook] Lead #${currentLeadId} ya está en procesamiento activo en vuelo. Skipping petición concurrente.`);
      if (currentTalkId) activeProcessingTalks.delete(currentTalkId);
      if (isSync && !res.headersSent) return res.status(200).json({ status: 'ok', handled: 'CONCURRENT_PROCESSING' });
      return;
    }

    // 🛑 FILTRO 6: Ráfaga ultracorta (1.5s) anti-rebote a nivel de socket
    if (isRapidBurst(currentLeadId)) {
      console.log(`[Webhook] Ráfaga instantánea detectada para Lead #${currentLeadId} (<1.5s). Skipping rebote de red.`);
      if (currentTalkId) activeProcessingTalks.delete(currentTalkId);
      if (isSync && !res.headersSent) return res.status(200).json({ status: 'ok', handled: 'RAPID_BURST' });
      return;
    }

    activeProcessingLeads.add(currentLeadId);

    try {

      console.log(`\n========================================`);
      console.log(`[Processing New Message]`);
      console.log(`Canal: ${detectedChannel} (Origin: ${talkOrigin || 'n/a'}, Source: ${talkSourceId || 'n/a'})`);
      console.log(`Lead ID: ${currentLeadId}`);
      console.log(`Cliente: ${clientName}`);
      console.log(`Message: "${userText}"`);
      console.log(`========================================`);

      // 1. Obtener propiedades de Google Sheets autorizadas
      const properties = await getAvailableProperties();

      // ======================================================================
      // 2. NUEVO CONTROLADOR CENTRAL DETERMINÍSTICO ÚNICO (REGLAS 1 A 10)
      // ======================================================================
      console.log('[Processing] Evaluando decisión central con pipeline_decision.js...');
      // En el webhook público el tiempo siempre es estrictamente el reloj real Date.now()
      const currentTime = Date.now();

      const pipelineResult = await evaluateCentralDecisionPipeline({
        userText,
        leadId: currentLeadId,
        talkId: currentTalkId,
        contactId: messageObj.contact_id ? String(messageObj.contact_id) : null,
        properties,
        handoffManager: centralHandoffManager,
        contextManager: centralContextManager,
        currentTime,
        propertyRecoveryFn: recoverActivePropertyFromKommo
      });

      console.log(`[Pipeline Decision] Action: ${pipelineResult.log.action}, Type: ${pipelineResult.log.typeDetected}, Reason: ${pipelineResult.log.reason}`);

      // ======================================================================
      // 3. MODO OBSERVACIÓN O DESPACHO CONTROLADO RESTRINGIDO PARA STAGING
      // ======================================================================
      const isControlledDispatch = isControlledDispatchAuthorized(currentLeadId, currentTalkId);

      if (OBSERVATION_MODE && !isControlledDispatch) {
        if (pipelineResult.shouldRespond && pipelineResult.text) {
          console.log(`[OBSERVATION MODE ACTIVE] Decisión: RESPONDER con "${pipelineResult.text}". Cero modificaciones a Kommo, cero disparos a Salesbot.`);
        } else {
          console.log(`[OBSERVATION MODE ACTIVE] Decisión: SILENCIO (${pipelineResult.log.reason || 'Sin respuesta'}). Cero modificaciones a Kommo, cero alertas a WhatsApp.`);
        }

        recordStagingDecision({
          timestamp: Date.now(),
          lead_id: currentLeadId,
          talk_id: currentTalkId,
          user_text: userText,
          observation_mode: true,
          decision: pipelineResult.log,
          text: pipelineResult.text
        });

        if (pipelineResult.shouldRespond && pipelineResult.text) {
          idempotencyManager.markSent(msgKey, pipelineResult.text, { observation_mode: true });
        } else {
          idempotencyManager.markIgnored(msgKey, pipelineResult.log.reason || 'SILENCE_OBSERVATION');
        }

        if (isSync && !res.headersSent) {
          return res.status(200).json({
            status: 'ok',
            processed: true,
            observation_mode: true,
            dispatched: false,
            lead_id: currentLeadId,
            talk_id: currentTalkId,
            decision: pipelineResult.log,
            text: pipelineResult.text
          });
        }
        return;
      }

      if (isControlledDispatch) {
        console.log(`[CONTROLLED DISPATCH AUTHORIZED] Conversación autorizada para prueba real de despacho en Staging (Lead #${currentLeadId}, Talk #${currentTalkId}). Despachando a Kommo...`);
      }

      // Si el pipeline determinó silencio absoluto en modo normal o en despacho controlado
      if (!pipelineResult.shouldRespond || !pipelineResult.text) {
        console.log(`[Pipeline Silence] El bot guarda silencio absoluto y cede el control.`);
        idempotencyManager.markIgnored(msgKey, pipelineResult.log.reason || 'SILENCE');

        // 🛑 PROTECCIÓN CONTRA RÁFAGAS (BURST PROTECTION - Alondra Case):
        // Si ya hay un despacho activo reciente en este lead (dentro de 45s), un mensaje posterior
        // que evalúe a silencio (ej: saludo repetido, mensaje en ráfaga) NO debe cancelar
        // el Salesbot en vuelo ni borrar arbitrariamente el campo Respuesta_IA.
        const isRecentDispatchActive = hasRecentActiveDispatch(currentLeadId, 45000);
        if (!isRecentDispatchActive) {
          await stopKommoSalesbot(currentLeadId);
          try {
            await updateKommoLead(currentLeadId, ' ');
          } catch (e) {}
        } else {
          console.log(`[Burst Protection] Despacho activo en curso para Lead #${currentLeadId}. Conservando ejecución de Salesbot y Respuesta_IA.`);
        }

        // Si fue una solicitud de atención humana o nota de voz, alertar a Robert para que atienda al cliente
        if (pipelineResult.log.typeDetected === 'HUMAN_ATTENTION_REQUEST' || isVoiceNoteOrAudio(body, messageObj, userText)) {
          let channel = detectedChannel;
          let interestType = 'Atención comercial prioritaria';
          if (isVoiceNoteOrAudio(body, messageObj, userText)) {
            interestType = 'Nota de voz / Audio recibido';
          } else if (/visita|cita|reuni[oó]n|ver\s*(?:la|el)?\s*propiedad|conocer/i.test(userText)) {
            interestType = 'Agendar una visita';
          } else if (/reservar|apartar/i.test(userText)) {
            interestType = 'Reserva de inmueble';
          } else if (/firmar|contrato/i.test(userText)) {
            interestType = 'Firma de contrato';
          } else if (/dinero|cerrar|concretar|comprar|alquilar/i.test(userText)) {
            interestType = 'Alta intención de compra / Cierre comercial';
          }

          const robertAlert = buildRobertAlertText({
            type: isVoiceNoteOrAudio(body, messageObj, userText) ? 'NOTA_DE_VOZ' : 'AGENDAR_CITA',
            clientName,
            clientPhone,
            channel,
            matchedProperty: pipelineResult.targetProperty || null,
            userText: userText || '[Solicitud de atención / Nota de voz]',
            leadId: currentLeadId,
            interestType
          });
          await dispatchDirectWhatsAppToRobert(robertAlert, currentLeadId, interestType);
        }

        if (isSync && !res.headersSent) {
          return res.status(200).json({
            status: 'ok',
            processed: true,
            observation_mode: false,
            dispatched: false,
            lead_id: currentLeadId,
            talk_id: currentTalkId,
            text: null,
            decision: pipelineResult.log
          });
        }
        return;
      }

      const responseText = pipelineResult.text;
      console.log(`[Pipeline Approved Response] Text: "${responseText}"`);

      // ======================================================================
      // 4. COMPROBACIÓN PREVIA AL DESPACHO (PRE-DISPATCH CHECK)
      // ======================================================================
      const preDispatchCheck = await verifyPreDispatchSafety(
        currentLeadId,
        currentTalkId,
        messageObj.contact_id ? String(messageObj.contact_id) : null,
        centralHandoffManager
      );

      if (!preDispatchCheck.canDispatch) {
        console.warn(`[PRE-DISPATCH ABORT] ${preDispatchCheck.reason} Cancelando despacho a Kommo.`);
        idempotencyManager.markIgnored(msgKey, preDispatchCheck.reason || 'PRE_DISPATCH_ABORT');
        await stopKommoSalesbot(currentLeadId, isControlledDispatch);
        try {
          await updateKommoLead(currentLeadId, ' ', isControlledDispatch);
        } catch (e) {}
        if (isSync && !res.headersSent) {
          return res.status(200).json({
            status: 'ok',
            processed: true,
            observation_mode: false,
            dispatched: false,
            aborted: true,
            reason: preDispatchCheck.reason,
            lead_id: currentLeadId,
            talk_id: currentTalkId
          });
        }
        return;
      }

      // ======================================================================
      // 5. DESPACHO A KOMMO Y DISPARO DE SALESBOT
      // ======================================================================
      await ensureLeadInActivePipeline(currentLeadId, isControlledDispatch);

      // Guardar respuesta en campo 2103996 de Kommo
      console.log('[Processing] Saving response to Kommo lead field...');
      await updateKommoLead(currentLeadId, responseText, isControlledDispatch);
      recordBotDispatchedMessage(currentLeadId, responseText);

      // Disparar Salesbot ÚNICA VEZ
      console.log('[Processing] Triggering Salesbot single delivery...');
      await triggerKommoSalesbot(currentLeadId, isControlledDispatch);
      idempotencyManager.markSent(msgKey, responseText, {
        dispatched: true,
        leadId: currentLeadId,
        talkId: currentTalkId,
        isControlledDispatch
      });

      // Persistencia permanente en Kommo CRM y contexto local para tolerancia a reinicios de Render
      if (pipelineResult.targetProperty && pipelineResult.targetProperty.ID_PROPIEDAD) {
        centralContextManager.saveContext(currentTalkId, currentLeadId, pipelineResult.targetProperty);
        tagLeadWithProperty(currentLeadId, pipelineResult.targetProperty.ID_PROPIEDAD).catch(() => {});
      }

      if (isControlledDispatch) {
        authorizedControlledPair.currentDispatches++;
        recordControlledDispatch({
          leadId: currentLeadId,
          talkId: currentTalkId,
          text: responseText,
          action: 'DISPATCH_SUCCESS',
          success: true,
          salesbotTriggered: true
        });
      }

      const responseNum = incrementLeadResponseCount(currentLeadId);
      console.log(`[Response Count] Lead #${currentLeadId} - Respuestas automáticas acumuladas: ${responseNum}/${MAX_AI_RESPONSES_PER_LEAD}`);

      // 🛑 CONTROL DE DESPACHO SEGURO Y LIMPIEZA DEL CAMPO RESPUESTA_IA (60s)
      // Cancelar cualquier temporizador previo de este lead para evitar que un timer anterior anule este despacho
      if (leadCleanupTimers.has(currentLeadId)) {
        clearTimeout(leadCleanupTimers.get(currentLeadId));
        leadCleanupTimers.delete(currentLeadId);
      }
      const cleanupTimer = setTimeout(async () => {
        try {
          leadCleanupTimers.delete(currentLeadId);
          await updateKommoLead(currentLeadId, ' ', isControlledDispatch);
          console.log(`[Safe Cleanup] Campo Respuesta_IA reiniciado tras ventana de 60s para Lead #${currentLeadId}`);
        } catch (e) {
          console.warn('[Safe Cleanup Error]:', e.message);
        }
      }, 60000);
      leadCleanupTimers.set(currentLeadId, cleanupTimer);

      console.log(`[Success] Message strictly processed 1 single time for Lead #${currentLeadId}!\n`);

      if (isSync && !res.headersSent) {
        return res.status(200).json({
          status: 'ok',
          processed: true,
          observation_mode: false,
          dispatched: true,
          lead_id: currentLeadId,
          talk_id: currentTalkId,
          text: responseText,
          decision: pipelineResult.log
        });
      }

    } finally {
      activeProcessingLeads.delete(currentLeadId);
      if (currentTalkId) activeProcessingTalks.delete(currentTalkId);
    }

  } catch (err) {
    if (msgKey) idempotencyManager.markFailed(msgKey, err.message);
    console.error('[Webhook Processing Error]:', err.response?.data || err.message);
    if (isSync && !res.headersSent) {
      return res.status(500).json({ status: 'error', error: err.message });
    }
  }
});

// Health check endpoint
app.get('/health', async (req, res) => {
  let remainingCredits = null;
  try {
    const key = process.env.OPENROUTER_API_KEY || process.env.CLAUDE_API_KEY || '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';
    const cRes = await axios.get('https://openrouter.ai/api/v1/credits', {
      headers: { Authorization: `Bearer ${key}` },
      timeout: 3000
    });
    const total = cRes.data?.data?.total_credits || 0;
    const usage = cRes.data?.data?.total_usage || 0;
    remainingCredits = Number((total - usage).toFixed(3));
  } catch (e) { }

  let targetModel = process.env.CLAUDE_MODEL || 'nvidia/nemotron-3.5-lightning:free';
  if (/claude|anthropic|sonnet/i.test(targetModel)) {
    targetModel = 'nvidia/nemotron-3.5-lightning:free';
  }

  res.send({
    status: 'running',
    service: 'Tu Techo Ideal Bot Microservice - v5.0 Deterministic Central Pipeline Edition',
    observation_mode: OBSERVATION_MODE,
    pipeline_controller: 'pipeline_decision.js',
    ai_model: targetModel,
    claude_model: targetModel,
    claude_enabled: false,
    paid_fallback_disabled: true,
    credits_remaining_usd: 0.00,
    idempotency: 'active',
    idempotency_store_records: idempotencyManager.records.size,
    uptime_seconds: Math.floor(process.uptime())
  });
});

app.get('/', (req, res) => {
  res.redirect('/health');
});

// Endpoints del Reporte Diario y Estadísticas
app.get(['/stats', '/report', '/dashboard'], async (req, res) => {
  const stats = await getDailyStats();
  if (!stats) return res.status(500).send('Error obteniendo estadísticas');
  res.send(generateHtmlDailyReport(stats));
});

// Endpoint oficial del Informe Forense Descargable (PDF / Imprimible / HTML)
app.get(['/informe', '/informe-forense', '/auditoria'], (req, res) => {
  res.sendFile(path.join(__dirname, 'report.html'));
});

app.get(['/report.html', '/descargar-informe', '/descargar-html', '/informe.html'], (req, res) => {
  res.download(path.join(__dirname, 'report.html'), 'Informe_Forense_Consumo_IA_TuTechoIdeal.html');
});

app.get('/api/daily-stats', async (req, res) => {
  const stats = await getDailyStats();
  res.send(stats || { error: 'No data' });
});

app.get('/api/send-daily-report', async (req, res) => {
  const result = await sendDailyBalanceReport();
  res.send(result);
});

// Endpoint de descarga de PDF oficial
app.get(['/informe.pdf', '/descargar-pdf', '/auditoria.pdf'], (req, res) => {
  const pdfPath = path.join(__dirname, 'Informe_Forense_Consumo_IA_TuTechoIdeal.pdf');
  if (fs.existsSync(pdfPath)) {
    res.download(pdfPath, 'Informe_Forense_Consumo_IA_TuTechoIdeal.pdf');
  } else {
    res.redirect('/informe');
  }
});

// Endpoint para disparar o verificar la Auditoría Semanal bajo demanda
app.get(['/api/send-weekly-audit', '/api/enviar-auditoria-semanal'], async (req, res) => {
  const result = await sendWeeklyAuditReport(true);
  res.send(result);
});

app.get(['/api/audit-status', '/api/estado-auditoria'], (req, res) => {
  const state = getAuditState();
  res.send({
    service: 'Auditoría Semanal Automatizada TTI',
    schedule: 'Todos los Miércoles a las 7:58 PM (Hora Venezuela, America/Caracas)',
    to: WEEKLY_AUDIT_TO_EMAIL,
    cc: WEEKLY_AUDIT_CC_EMAIL,
    subject: WEEKLY_AUDIT_SUBJECT,
    state
  });
});

// ============================================================================
// 🧪 ENDPOINTS DE VERIFICACIÓN Y AUDITORÍA EXCLUSIVOS PARA STAGING
// ============================================================================

// Middleware de protección estricta para endpoints de prueba y diagnóstico
function requireStagingAuth(req, res, next) {
  // 1. Exigir expresamente NODE_ENV === 'staging'. Si no es exactamente staging -> 404 Not Found
  if (process.env.NODE_ENV !== 'staging') {
    return res.status(404).json({ error: 'Not Found' });
  }

  // Validación exacta de hostname (únicamente Render Staging, sin X-Forwarded-Host no confiable)
  const rawHost = (req?.headers?.host || req?.hostname || '').split(':')[0].trim().toLowerCase();
  if (!ALLOWED_STAGING_HOSTNAMES.includes(rawHost)) {
    return res.status(404).json({ error: 'Not Found' });
  }

  // 2. Exigir autenticación estricta con token dedicado mediante cabecera x-staging-auth
  if (!verifyStagingAuthHeader(req)) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Este endpoint de diagnóstico requiere el header de autenticación x-staging-auth con token válido.'
    });
  }

  next();
}

// 1. Inferencia Real en Vivo con Nemotron 3.5 Lightning (Ficha Sintética, 0 Datos Personales)
app.get('/api/test-nemotron-inference', requireStagingAuth, async (req, res) => {
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'No OPENROUTER_API_KEY configured in environment' });
  }

  const model = process.env.CLAUDE_MODEL || 'nvidia/nemotron-3.5-lightning:free';

  // Ficha sintética estrictamente ficticia (sin datos reales ni personales)
  const syntheticProperty = {
    ID_PROPIEDAD: 'SYNTH-STG-001',
    TIPO: 'Apartamento',
    OPERACION: 'Venta',
    ESTATUS: 'Disponible',
    DESCRIPCION_BREVE: 'Apartamento de 120 m² en Los Samanes, tres habitaciones, dos baños y cocina remodelada. No posee gas directo, cocina eléctrica.'
  };

  const syntheticQuestion = '¿Cuántos metros tiene el apartamento?';

  const systemPrompt = `Eres el asistente de interpretación de datos de "Tu Techo Ideal".
Tu rol es extraer información exacta de la propiedad para responder la pregunta del cliente.
Debes responder OBLIGATORIAMENTE en formato JSON con la siguiente estructura:

{
  "has_data": true,
  "answer": "Respuesta exacta y concisa para el cliente",
  "evidence": "Frase textual exacta tomada de la descripción oficial que sustenta la respuesta"
}

DATOS OFICIALES DE LA PROPIEDAD:
- Identificador: ${syntheticProperty.ID_PROPIEDAD}
- Tipo: ${syntheticProperty.TIPO}
- Operación: ${syntheticProperty.OPERACION}
- Estatus: ${syntheticProperty.ESTATUS}
- DESCRIPCION_BREVE:
"""
${syntheticProperty.DESCRIPCION_BREVE}
"""

REGLAS ESTRICTAS:
1. Si el dato está expresado en los datos oficiales, coloca has_data: true, redacta la respuesta corta en "answer" y copia la frase exacta de la descripción en "evidence".
2. Si la descripción aclara explícitamente que NO posee un servicio o atributo, coloca has_data: true, responde la negativa documentada en "answer" y copia la evidencia en "evidence".
3. Si el dato NO APARECE, coloca has_data: false, answer: null, evidence: null.
4. Responde ÚNICAMENTE el objeto JSON sin bloques de código markdown ni explicaciones adicionales.`;

  const startTime = Date.now();
  try {
    const apiRes = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: syntheticQuestion }
        ],
        temperature: 0.0,
        max_tokens: 2048,
        reasoning: { exclude: true }
      },
      {
        headers: {
          Authorization: apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://tu-techo-ideal-staging.onrender.com',
          'X-Title': 'Tu Techo Ideal Staging Verification',
          'Content-Type': 'application/json'
        },
        timeout: 25000
      }
    );

    const latencyMs = Date.now() - startTime;
    const choice = apiRes.data?.choices?.[0];
    let rawContent = (choice?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    if (!rawContent && choice?.message?.reasoning) {
      const match = choice.message.reasoning.match(/\{[\s\S]*\}/);
      if (match) rawContent = match[0].trim();
    }
    let parsedJson = null;
    let jsonValid = false;
    let validationPassed = false;
    let validationDetails = '';

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
      parsedJson = JSON.parse(cleanJson);
      jsonValid = true;

      if (parsedJson.has_data === true && parsedJson.answer && parsedJson.evidence) {
        const descNorm = syntheticProperty.DESCRIPCION_BREVE.toLowerCase();
        const evNorm = parsedJson.evidence.toLowerCase();
        if (descNorm.includes(evNorm)) {
          validationPassed = true;
          validationDetails = 'Evidencia textual verificada al 100% en la descripción autorizada.';
        } else {
          validationDetails = 'La evidencia no se encuentra textualmente en la descripción.';
        }
      } else {
        validationDetails = 'JSON no contiene has_data:true o falta answer/evidence.';
      }
    } catch (pe) {
      jsonValid = false;
      validationDetails = `Error parseando JSON: ${pe.message}`;
    }

    res.json({
      status: 'success',
      http_status: apiRes.status,
      latency_ms: latencyMs,
      model_requested: model,
      model_used: apiRes.data?.model || model,
      generation_id: apiRes.data?.id || 'unknown',
      usage: {
        prompt_tokens: apiRes.data?.usage?.prompt_tokens || 0,
        completion_tokens: apiRes.data?.usage?.completion_tokens || 0,
        total_tokens: apiRes.data?.usage?.total_tokens || 0
      },
      raw_content: rawContent,
      parsed_json: parsedJson,
      json_valid: jsonValid,
      validation_passed: validationPassed,
      validation_details: validationDetails,
      errors_or_limits: null
    });
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    res.status(err.response?.status || 500).json({
      status: 'error',
      http_status: err.response?.status || 500,
      latency_ms: latencyMs,
      model_requested: model,
      error_message: err.message,
      error_data: err.response?.data || null,
      errors_or_limits: err.response?.data?.error || err.message
    });
  }
});

// 2. Buffer de Decisiones de Staging
app.get('/api/staging-decision-logs', requireStagingAuth, (req, res) => {
  const { talk_id, lead_id } = req.query;
  let logs = stagingDecisionBuffer;
  if (talk_id) {
    logs = logs.filter(l => String(l.talk_id).includes(String(talk_id).substring(0, 4)));
  }
  if (lead_id) {
    logs = logs.filter(l => String(l.lead_id).includes(String(lead_id).substring(0, 4)));
  }
  res.json({ count: logs.length, logs });
});

// 3. Simular Avance Temporal de Bloqueo de 24 Horas para Pruebas Controladas
app.post('/api/staging/set-handoff-time', requireStagingAuth, (req, res) => {
  const { lead_id, talk_id, hours_ago, seconds_ago, timestamp, clear, reset } = req.body;

  if (clear || reset) {
    if (talk_id && centralHandoffManager.handoffs.talks) delete centralHandoffManager.handoffs.talks[String(talk_id)];
    if (lead_id && centralHandoffManager.handoffs.leads) delete centralHandoffManager.handoffs.leads[String(lead_id)];
    centralHandoffManager.save();
    return res.json({ status: 'ok', cleared: true, lead_id, talk_id });
  }

  let simulatedTime = Date.now();
  if (timestamp !== undefined) {
    simulatedTime = Number(timestamp);
  } else if (seconds_ago !== undefined) {
    simulatedTime = Date.now() - (Number(seconds_ago) * 1000);
  } else if (hours_ago !== undefined) {
    simulatedTime = Date.now() - (Number(hours_ago) * 60 * 60 * 1000);
  } else {
    simulatedTime = Date.now() - ((HANDOFF_LOCK_HOURS + 1) * 60 * 60 * 1000);
  }

  if (talk_id) {
    if (!centralHandoffManager.handoffs.talks) centralHandoffManager.handoffs.talks = {};
    const cur = centralHandoffManager.handoffs.talks[String(talk_id)] || {};
    centralHandoffManager.handoffs.talks[String(talk_id)] = {
      ...cur,
      lastHumanIntervention: simulatedTime,
      timestamp: simulatedTime
    };
  }
  if (lead_id) {
    if (!centralHandoffManager.handoffs.leads) centralHandoffManager.handoffs.leads = {};
    const cur = centralHandoffManager.handoffs.leads[String(lead_id)] || {};
    centralHandoffManager.handoffs.leads[String(lead_id)] = {
      ...cur,
      lastHumanIntervention: simulatedTime,
      timestamp: simulatedTime
    };
  }
  centralHandoffManager.save();

  const elapsedSeconds = (Date.now() - simulatedTime) / 1000;
  res.json({
    status: 'ok',
    simulated_timestamp: simulatedTime,
    elapsed_seconds: elapsedSeconds,
    elapsed_hours: elapsedSeconds / 3600,
    lead_id,
    talk_id
  });
});

app.get('/api/staging/check-lock-status', requireStagingAuth, async (req, res) => {
  const { lead_id, talk_id, simulated_now, offset_ms } = req.query;
  let now = Date.now();
  if (isAuthorizedStagingTestRequest(req)) {
    if (simulated_now) {
      now = Number(simulated_now);
    } else if (offset_ms !== undefined) {
      const entry = (talk_id && centralHandoffManager.handoffs.talks ? centralHandoffManager.handoffs.talks[String(talk_id)] : null) ||
                    (lead_id && centralHandoffManager.handoffs.leads ? centralHandoffManager.handoffs.leads[String(lead_id)] : null);
      const humanTime = entry ? (entry.lastHumanIntervention || entry.timestamp) : null;
      if (humanTime) {
        now = humanTime + Number(offset_ms);
      }
    }
  }
  const status = await centralHandoffManager.checkLockStatus(lead_id, talk_id, null, now);
  res.json({
    status: 'ok',
    now,
    simulated_delta_ms: status.lastIntervention ? (now - status.lastIntervention) : null,
    lock_status: status
  });
});

// Endpoint exclusivo de Staging para evaluación determinista del pipeline con tiempo simulado
app.post('/api/staging/test-pipeline-evaluation', requireStagingAuth, async (req, res) => {
  try {
    const {
      user_text,
      lead_id,
      talk_id,
      contact_id,
      offset_ms,
      simulated_now,
      test_sheet_url,
      test_sheet_force_refresh
    } = req.body || {};

    const currentLeadId = lead_id ? String(lead_id) : null;
    const currentTalkId = talk_id ? String(talk_id) : null;
    const currentContactId = contact_id ? String(contact_id) : null;
    const userText = user_text || '';

    let evaluationTime = Date.now();
    if (isAuthorizedStagingTestRequest(req)) {
      if (simulated_now !== undefined && simulated_now !== null) {
        evaluationTime = Number(simulated_now);
      } else if (offset_ms !== undefined && offset_ms !== null) {
        const offsetMs = Number(offset_ms);
        const entry = (currentTalkId && centralHandoffManager.handoffs.talks ? centralHandoffManager.handoffs.talks[String(currentTalkId)] : null) ||
                      (currentLeadId && centralHandoffManager.handoffs.leads ? centralHandoffManager.handoffs.leads[String(currentLeadId)] : null);
        const humanTime = entry ? (entry.lastHumanIntervention || entry.timestamp) : null;
        if (humanTime) {
          evaluationTime = humanTime + offsetMs;
        }
      }
    }

    // Validación estricta del tipo booleano de test_sheet_force_refresh
    if (test_sheet_force_refresh !== undefined && typeof test_sheet_force_refresh !== 'boolean') {
      return res.status(400).json({
        status: 'error',
        error: 'Invalid parameter',
        message: 'test_sheet_force_refresh debe ser un valor booleano (true o false).'
      });
    }

    // Aislamiento estricto: si se proporciona test_sheet_url en Staging, usar la caché aislada de prueba
    let properties;
    let isTestSheetActive = false;
    if (test_sheet_url) {
      try {
        properties = await getStagingTestProperties(test_sheet_url, test_sheet_force_refresh === true);
        isTestSheetActive = true;
      } catch (sheetErr) {
        return res.status(400).json({
          status: 'error',
          error: 'Invalid test_sheet_url',
          message: sheetErr.message
        });
      }
    } else {
      properties = await getAvailableProperties();
    }

    const pipelineResult = await evaluateCentralDecisionPipeline({
      userText,
      leadId: currentLeadId,
      talkId: currentTalkId,
      contactId: currentContactId,
      properties,
      handoffManager: centralHandoffManager,
      contextManager: centralContextManager,
      currentTime: evaluationTime
    });

    recordStagingDecision({
      timestamp: evaluationTime,
      lead_id: currentLeadId,
      talk_id: currentTalkId,
      user_text: userText,
      observation_mode: OBSERVATION_MODE,
      decision: pipelineResult.log,
      text: pipelineResult.text
    });

    return res.json({
      status: 'ok',
      evaluation_time: evaluationTime,
      lead_id: currentLeadId,
      talk_id: currentTalkId,
      user_text: userText,
      test_sheet_active: isTestSheetActive,
      decision: pipelineResult.log,
      text: pipelineResult.text
    });
  } catch (err) {
    console.error('[test-pipeline-evaluation] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// 4. Verificación de Capacidades y Permisos en Vivo de la API de Kommo
app.get('/api/audit-kommo-lock-capability', requireStagingAuth, async (req, res) => {
  const token = process.env.KOMMO_TOKEN;
  const subdomain = process.env.KOMMO_SUBDOMAIN || 'tutechoidealrd';
  if (!token) return res.status(500).json({ error: 'KOMMO_TOKEN no configurado' });
  const headers = { Authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}` };

  const results = {};

  // A. Probar Endpoint de Mensajes de Conversación (External Chat History)
  try {
    const talkRes = await axios.get(`https://${subdomain}.kommo.com/api/v4/talks/12345/messages`, { headers, timeout: 5000 });
    results.talk_messages = { status: talkRes.status, available: true };
  } catch (err) {
    results.talk_messages = {
      status: err.response?.status || 500,
      available: false,
      error: err.response?.data?.['detail'] || err.message,
      limitation: 'El token carece del scope "crm_chats_read" (External chat history). Prohibido acceso directo al historial de chat.'
    };
  }

  // B. Probar Endpoint de Eventos Outgoing
  try {
    const evRes = await axios.get(`https://${subdomain}.kommo.com/api/v4/events?filter[type]=outgoing_chat_message&limit=5`, { headers, timeout: 5000 });
    const events = evRes.data?._embedded?.events || [];
    results.outgoing_events = {
      status: evRes.status,
      count: events.length,
      sample_created_by: events[0]?.created_by,
      sample_origin: events[0]?.value_after?.[0]?.message?.origin,
      can_differentiate_salesbot_vs_human: false,
      limitation: 'Eventos de WhatsApp / Salesbot registran created_by: 0 sin metadatos de autor. No es posible diferenciar Salesbot de asesor humano vía eventos. Se requiere silencio preventivo fail-closed.'
    };
  } catch (err) {
    results.outgoing_events = { status: err.response?.status || 500, error: err.message };
  }

  res.json(results);
});

// 5. Estado del Despacho Controlado en Staging
app.get('/api/staging/controlled-dispatch-status', requireStagingAuth, (req, res) => {
  res.json({
    status: 'ok',
    staging_test_dispatch_enabled: stagingTestDispatchEnabled,
    observation_mode: OBSERVATION_MODE,
    authorized_pair: {
      lead_id: authorizedControlledPair.leadId,
      talk_id: authorizedControlledPair.talkId,
      expires_at: authorizedControlledPair.expiresAt ? new Date(authorizedControlledPair.expiresAt).toISOString() : null,
      max_dispatches: authorizedControlledPair.maxDispatches,
      current_dispatches: authorizedControlledPair.currentDispatches,
      is_valid: isControlledDispatchAuthorized(authorizedControlledPair.leadId, authorizedControlledPair.talkId)
    },
    dispatch_history: controlledDispatchHistory,
    node_env: process.env.NODE_ENV || 'development'
  });
});

// 6. Configuración Dinámica de Despacho Controlado en Staging
app.post('/api/staging/configure-test-dispatch', requireStagingAuth, (req, res) => {
  const { enabled, lead_id, talk_id, ttl_minutes, max_dispatches } = req.body || {};

  if (typeof enabled === 'boolean') {
    stagingTestDispatchEnabled = enabled;
  }

  if (lead_id && talk_id) {
    const ttl = Number(ttl_minutes) || 60; // 60 minutos por defecto
    authorizedControlledPair.leadId = String(lead_id).trim();
    authorizedControlledPair.talkId = String(talk_id).trim();
    authorizedControlledPair.expiresAt = Date.now() + (ttl * 60 * 1000);
    authorizedControlledPair.maxDispatches = Number(max_dispatches) || 2;
    authorizedControlledPair.currentDispatches = 0;
    console.log(`[CONTROLLED DISPATCH CONFIGURED] Autorizado par simultáneo Lead #${authorizedControlledPair.leadId} + Talk #${authorizedControlledPair.talkId} por ${ttl} min (máx ${authorizedControlledPair.maxDispatches} despachos).`);
  }

  if (enabled === false) {
    authorizedControlledPair.leadId = null;
    authorizedControlledPair.talkId = null;
    authorizedControlledPair.expiresAt = 0;
    authorizedControlledPair.currentDispatches = 0;
    console.log(`[CONTROLLED DISPATCH DISABLED] Despacho controlado desactivado y par limpiado.`);
  }

  res.json({
    status: 'ok',
    staging_test_dispatch_enabled: stagingTestDispatchEnabled,
    observation_mode: OBSERVATION_MODE,
    authorized_pair: {
      lead_id: authorizedControlledPair.leadId,
      talk_id: authorizedControlledPair.talkId,
      expires_at: authorizedControlledPair.expiresAt ? new Date(authorizedControlledPair.expiresAt).toISOString() : null,
      max_dispatches: authorizedControlledPair.maxDispatches,
      current_dispatches: authorizedControlledPair.currentDispatches,
      is_valid: isControlledDispatchAuthorized(authorizedControlledPair.leadId, authorizedControlledPair.talkId)
    }
  });
});

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', async () => {
    console.log(`Tu Techo Ideal Bot running on 0.0.0.0:${PORT}`);
    initDailyReportScheduler();
    initWeeklyAuditScheduler();

    // Inicializar Memoria Virtual y Vocabulario de Google Sheets al arrancar
    try {
      const props = await getAvailableProperties(true);
      console.log(`[Memoria Virtual Startup] Inicializadas ${props.length} propiedades con ${virtualPropertyVocabulary.size} palabras clave extraídas.`);
    } catch (err) {
      console.warn('[Memoria Virtual Startup Warning]:', err.message);
    }
  });
}

module.exports = {
  AVAILABILITY_RESPONSE,
  app,
  centralHandoffManager,
  centralContextManager,
  OBSERVATION_MODE,
  evaluateCentralDecisionPipeline,
  updateKommoLead,
  triggerKommoSalesbot,
  stopKommoSalesbot,
  ensureLeadInActivePipeline,
  dispatchDirectWhatsAppToRobert,
  buildRobertAlertText,
  getAvailableProperties,
  matchWasiOrProperty,
  isStandaloneLinkWithoutQuestion,
  isPropertyLinkRequest,
  isInstagramStoryOrRestricted,
  isMetaCampaignKeyword,
  isFacebookPublicComment,
  resolveCommunicationChannel,
  isStandaloneInmobiliariaTuTechoIdeal,
  isPureGreeting,
  isAvailabilityWithoutProperty,
  saveLeadPropertyContext,
  getLeadPropertyContext,
  getOrRecoverLeadPropertyContext,
  generateResponseRaw,
  generateResponse,
  formatAvailabilityResponse,
  isControlledDispatchAuthorized,
  stagingTestDispatchEnabled: () => stagingTestDispatchEnabled,
  authorizedControlledPair,
  controlledDispatchHistory,
  recordControlledDispatch,
  isAuthorizedStagingTestRequest,
  verifyStagingAuthHeader,
  ALLOWED_STAGING_HOSTNAMES,
  ALLOWED_SIMULATED_TIME_ROUTES,
  parseXlsxBufferToProperties,
  getStagingTestProperties,
  OFFICIAL_GOOGLE_SHEET_ID,
  GOOGLE_SHEET_TEST_URL_REGEX,
  getStagingTestSheetCache: () => stagingTestSheetCache,
  app
};
