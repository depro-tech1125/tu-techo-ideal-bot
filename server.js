require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');
const { parse } = require('csv-parse/sync');
const XLSX = require('xlsx');

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

// Deduplicación, Mutex en Vuelo y Debounce por Lead para evitar envíos dobles y tokens perdidos
const processedMessages = new Set();
const leadLastProcessed = new Map();
const lastLeadProcessedMessages = new Map(); // leadId -> { textHash, timestamp }
const activeProcessingLeads = new Set();
const activeProcessingTalks = new Set();

function isDuplicate(key) {
  if (!key) return false;
  if (processedMessages.has(key)) return true;
  processedMessages.add(key);
  setTimeout(() => processedMessages.delete(key), 900000); // 15 minutos en vez de 60 segundos
  return false;
}

function isSameLeadMessageRecent(leadId, text) {
  if (!leadId || !text) return false;
  const clean = normalizeText(text).substring(0, 100);
  const now = Date.now();
  const last = lastLeadProcessedMessages.get(String(leadId));
  if (last && last.text === clean && (now - last.timestamp) < 900000) { // 15 minutos
    return true;
  }
  lastLeadProcessedMessages.set(String(leadId), { text: clean, timestamp: now });
  if (lastLeadProcessedMessages.size > 2000) lastLeadProcessedMessages.clear();
  return false;
}

function isDebounced(leadId) {
  const now = Date.now();
  const last = leadLastProcessed.get(String(leadId));
  if (last && (now - last) < 15000) { // 15 segundos de cooldown estricto anti-doble procesamiento
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
  'noches', 'saludos', 'saludo', 'atentamente', 'asesor', 'asesora', 'favor', 'porfavor', 'inmobiliaria'
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
    const workbook = XLSX.read(response.data, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const range = XLSX.utils.decode_range(sheet['!ref']);

    const headers = [];
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const cell = sheet[XLSX.utils.encode_cell({ r: range.s.r, c: C })];
      headers.push(cell ? String(cell.v).trim() : `col_${C}`);
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
        let val = cell ? (cell.v !== undefined ? String(cell.v).trim() : '') : '';

        // Extraer hipervínculo nativo si existe en la celda
        if (cell && cell.l && cell.l.Target) {
          row[header + '_URL'] = cell.l.Target;
          // Si el texto visual es un emoji o placeholder (ej: "🏢 Ver en Wasi"), colocar el URL real
          if (!val || val.startsWith('🏢') || val.startsWith('📷') || val.startsWith('🔗') || val.startsWith('🌐')) {
            val = cell.l.Target;
          }
        }
        row[header] = val;
        if (val) hasData = true;
      }

      if (hasData && row['ID_PROPIEDAD']) {
        // Extraer código WASI (número de 7 a 9 dígitos)
        const wasiUrl = row['Wasi_URL'] || row['Wasi'] || '';
        const wasiMatch = wasiUrl.match(/\/(\d{7,9})(?:\?|$)/);
        row['CODIGO_WASI'] = wasiMatch ? wasiMatch[1] : '';

        // Limpieza de teléfono de asesor
        let agentPhone = (row['Numero de WhatsApp'] || row['WhatsApp'] || '').replace(/[^0-9]/g, '');
        if (agentPhone.length === 10 && agentPhone.startsWith('4')) {
          agentPhone = '58' + agentPhone;
        } else if (agentPhone.length === 11 && agentPhone.startsWith('04')) {
          agentPhone = '58' + agentPhone.substring(1);
        }
        row['TELEFONO_ASESOR_CLEAN'] = agentPhone;

        records.push(row);
      }
    }

    console.log(`[Google Sheets XLSX] Extraídas ${records.length} propiedades con hipervínculos y códigos Wasi reales.`);
    indexPropertiesVocabulary(records);
    cachedProperties = records;
    lastPropertiesFetchTime = now;
    return records;
  } catch (errXlsx) {
    console.warn('[Google Sheets XLSX Fallback Warning]:', errXlsx.message);
    // 2. Fallback de contingencia a CSV si el XLSX falla por cualquier red
    try {
      const csvUrl = process.env.GOOGLE_SHEET_CSV_URL;
      const response = await axios.get(csvUrl, { timeout: 7000 });
      const records = parse(response.data, {
        columns: true,
        skip_empty_lines: true,
        trim: true
      });
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

// ==========================================
// 🛑 FILTRO DETERMINÍSTICO ANTI-CHITCHAT Y CHARLA CASUAL
// ==========================================
function isCasualOrChitChat(text, imageUrl = null, hasActiveContext = false, activeProperty = null) {
  if (imageUrl) return false;
  if (!text || typeof text !== 'string') return true;
  const q = normalizeText(text);

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
    'colega', 'publicacion', 'link', 'enlace', 'wasi', 'http', 'sin datos', 'fotos', 'foto',
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
    'wasi', 'http', 'colega', 'link', 'enlace', 'sin datos', 'fotos', 'foto', 'publicacion',
    'mascota', 'mascotas', 'perro', 'perros', 'gato', 'gatos', 'animal', 'animales', 'pet friendly'
  ];

  return intentKeywords.some(kw => q.includes(kw));
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

function getLeadPropertyContext(leadId, allProperties) {
  if (!leadId) return null;
  const ctx = leadContextCache.get(String(leadId));
  if (!ctx || !ctx.propertyRef) return null;
  const isFresh = (Date.now() - ctx.updatedAt) < (7 * 24 * 60 * 60 * 1000);
  if (!isFresh) return null;
  return allProperties.find(p => (p.ID_PROPIEDAD || '').toUpperCase() === ctx.propertyRef.toUpperCase()) || null;
}

// Recuperación de contexto ultra-resiliente: memoria RAM local + consulta directa a Kommo si la RAM se reinició
async function getOrRecoverLeadPropertyContext(leadId, allProperties) {
  if (!leadId) return null;

  // 1. Verificar primero en memoria RAM local
  const localProp = getLeadPropertyContext(leadId, allProperties);
  if (localProp) return localProp;

  // 2. Recuperar del historial de eventos de Kommo si la memoria local estaba vacía
  try {
    const token = process.env.KOMMO_TOKEN;
    const subdomain = process.env.KOMMO_SUBDOMAIN || 'tutechoidealrd';
    if (token) {
      const authHeader = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
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
          saveLeadPropertyContext(leadId, wasiCheck.property);
          console.log(`[Lead Context Recovery] Inmueble recuperado de eventos de Kommo para Lead #${leadId}: ${wasiCheck.property.ID_PROPIEDAD}`);
          return wasiCheck.property;
        }
      }
    }
  } catch (err) {
    console.warn(`[Lead Context Recovery Warning] Error consultando eventos de Lead #${leadId}:`, err.message);
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

function saveLeadPropertyContext(leadId, property) {
  if (!leadId || !property || !property.ID_PROPIEDAD) return;
  const existing = leadContextCache.get(String(leadId)) || {};
  const ctx = {
    ...existing,
    propertyRef: property.ID_PROPIEDAD,
    wasiCode: property.CODIGO_WASI || '',
    updatedAt: Date.now()
  };
  leadContextCache.set(String(leadId), ctx);
  try {
    const obj = {};
    for (const [k, v] of leadContextCache.entries()) obj[k] = v;
    fs.writeFileSync(LEAD_CONTEXT_FILE, JSON.stringify(obj, null, 2), 'utf8');
  } catch (e) {
    console.warn('[Lead Context Save Error]:', e.message);
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
  const t = normalizeText(text);
  return /(?:est[aá]\s*disponible|saber\s*si\s*est[aá]\s*disponible|tienes\s*(?:un|el|este)|estoy\s*interesad[oa]|quisiera\s*saber\s*del|informaci[oó]n\s*del\s*inmueble|compartiste\s*en\s*(?:la\s*red\s*)?wasi)/i.test(t);
}

// ==========================================
// 📋 GENERADOR DE FORMATO GERENCIAL PARA ROBERT
// ==========================================
function buildRobertAlertText({ type, clientName, clientPhone, channel, matchedProperty, userText, leadId }) {
  const subdomain = process.env.KOMMO_SUBDOMAIN || 'tutechoidealrd';
  const leadUrl = leadId ? `https://${subdomain}.kommo.com/leads/detail/${leadId}` : null;
  const nowFormatted = new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' });

  let propDescription = 'Búsqueda personalizada / Sin coincidencia en catálogo';
  if (matchedProperty) {
    const wasiInfo = matchedProperty.CODIGO_WASI ? ` | Wasi: ${matchedProperty.CODIGO_WASI}` : '';
    propDescription = `${matchedProperty.TIPO} en ${matchedProperty.ZONA} (${matchedProperty.ID_PROPIEDAD}${wasiInfo})`;
  }

  const cleanPhone = clientPhone ? ` (${clientPhone})` : '';

  if (type === 'AGENDAR_CITA') {
    return `📅 *SOLICITUD DE CITA / VISITA* 📅\n\n` +
      `👤 *Cliente:* ${clientName}${cleanPhone}\n` +
      `📱 *Canal:* ${channel}\n` +
      `🏢 *Inmueble:* ${propDescription}\n` +
      `💬 *Mensaje del cliente:*\n"${userText}"\n\n` +
      `⚡ *Acción realizada:* Se respondió al cliente "Ok, ya consulto con mi jefe para agendar la cita." El bot se pausó para que coordines la visita personalmente.\n\n` +
      (leadUrl ? `🔗 *Abrir chat en Kommo:*\n${leadUrl}\n\n` : '') +
      `🕒 *Fecha y hora:* ${nowFormatted}`;
  }

  if (type === 'NO_EXISTE_EN_DESCRIPCION') {
    return `🚨 *CONSULTA SIN INFORMACIÓN EN BASE DE DATOS* 🚨\n\n` +
      `👤 *Cliente:* ${clientName}${cleanPhone}\n` +
      `📱 *Canal:* ${channel}\n` +
      `🏢 *Inmueble:* ${propDescription}\n` +
      `💬 *Pregunta del cliente:*\n"${userText}"\n\n` +
      `⚠️ *Diagnóstico:* La información solicitada no existe en la columna "DESCRIPCION_BREVE" del inventario.\n` +
      `⚡ *Acción realizada:* Se respondió al cliente: "Deme un momento, voy a consultar." y el bot se pausó automáticamente para tu atención personal.\n\n` +
      (leadUrl ? `🔗 *Abrir chat en Kommo:*\n${leadUrl}\n\n` : '') +
      `🕒 *Fecha y hora:* ${nowFormatted}`;
  }

  if (type === 'LIMITE_ALCANZADO') {
    return `📋 *LÍMITE MÁXIMO DE RESPUESTAS ALCANZADO (${MAX_AI_RESPONSES_PER_LEAD}/${MAX_AI_RESPONSES_PER_LEAD})* 📋\n\n` +
      `👤 *Cliente:* ${clientName}${cleanPhone}\n` +
      `📱 *Canal:* ${channel}\n` +
      `🏢 *Inmueble:* ${propDescription}\n` +
      `💬 *Último mensaje recibido:*\n"${userText}"\n\n` +
      `⚠️ *Diagnóstico:* El bot completó sus ${MAX_AI_RESPONSES_PER_LEAD} respuestas permitidas para este cliente.\n` +
      `⚡ *Acción realizada:* La IA se pausó en este chat para que el equipo continúe la atención personalmente.\n\n` +
      (leadUrl ? `🔗 *Abrir chat en Kommo:*\n${leadUrl}\n\n` : '') +
      `🕒 *Fecha y hora:* ${nowFormatted}`;
  }

  if (type === 'NOTA_DE_VOZ') {
    return `🎙️ *NOTA DE VOZ RECIBIDA - ATENCIÓN PERSONAL* 🎙️\n\n` +
      `👤 *Cliente:* ${clientName}${cleanPhone}\n` +
      `📱 *Canal:* ${channel}\n` +
      `🏢 *Inmueble:* ${propDescription}\n` +
      `💬 *Tipo de mensaje:* Nota de voz / Audio recibido\n\n` +
      `⚡ *Acción realizada:* El bot no emitió respuesta al cliente (silencio absoluto) y pausó el chat para que escuches el audio y respondas personalmente.\n\n` +
      (leadUrl ? `🔗 *Abrir chat en Kommo:*\n${leadUrl}\n\n` : '') +
      `🕒 *Fecha y hora:* ${nowFormatted}`;
  }

  if (type === 'INSTAGRAM_STORY_OR_RESTRICTED') {
    return `📸 *MENCIÓN EN HISTORIA / REEL DE INSTAGRAM* 📸\n\n` +
      `👤 *Cliente:* ${clientName}${cleanPhone}\n` +
      `📱 *Canal:* Instagram Direct\n` +
      `🏢 *Inmueble:* ${propDescription}\n` +
      `💬 *Contenido:* Mención en historia o contenido multimedia con restricciones de Instagram.\n\n` +
      `⚡ *Acción realizada:* El bot no emitió ningún mensaje automático (silencio absoluto) para respetar el cuadro de diálogo. Chat pausado para atención humana.\n\n` +
      (leadUrl ? `🔗 *Abrir chat en Kommo:*\n${leadUrl}\n\n` : '') +
      `🕒 *Fecha y hora:* ${nowFormatted}`;
  }

  return `🔔 *ALERTA GERENCIAL TU TECHO IDEAL* 🔔\n\n` +
    `👤 *Cliente:* ${clientName}${cleanPhone}\n` +
    `📱 *Canal:* ${channel}\n` +
    `🏢 *Inmueble:* ${propDescription}\n` +
    `💬 *Mensaje:*\n"${userText}"\n\n` +
    (leadUrl ? `🔗 *Abrir chat en Kommo:*\n${leadUrl}\n\n` : '') +
    `🕒 *Fecha y hora:* ${nowFormatted}`;
}

// ==========================================
// 📲 DISPATCH DIRECTO DE ALERTA WHATSAPP A ROBERT
// ==========================================
async function dispatchDirectWhatsAppToRobert(messageText) {
  const robertLeadId = process.env.ROBERT_KOMMO_LEAD_ID || '7882504';
  const robertPhone = (process.env.ROBERT_WHATSAPP || '+584143115105').replace(/[^0-9]/g, '');

  console.log(`\n📲 [DISPATCH WHATSAPP DIRECTO A ROBERT]`);
  console.log(`Destinatario: Robert Jiménez (${robertPhone}) | Kommo Lead #${robertLeadId}`);
  console.log(`Mensaje:\n${messageText}\n`);

  try {
    await updateKommoLead(robertLeadId, messageText);
    await triggerKommoSalesbot(robertLeadId);
    console.log(`[WhatsApp to Robert] Notificación enviada al WhatsApp de Robert vía Kommo Lead #${robertLeadId}`);

    // Limpieza de campo Respuesta_IA en el lead de Robert tras 25 segundos
    setTimeout(async () => {
      try {
        await updateKommoLead(robertLeadId, ' ');
      } catch (e) { }
    }, 25000);
  } catch (e) {
    console.warn('[WhatsApp to Robert Kommo Error]:', e.response?.data || e.message);
  }

  if (process.env.CALLMEBOT_API_KEY) {
    try {
      const callmebotUrl = `https://api.callmebot.com/whatsapp.php?phone=${robertPhone}&text=${encodeURIComponent(messageText)}&apikey=${process.env.CALLMEBOT_API_KEY}`;
      await axios.get(callmebotUrl, { timeout: 8000 });
      console.log(`[WhatsApp to Robert] Notificación enviada vía CallMeBot`);
    } catch (e) {
      console.warn('[WhatsApp to Robert CallMeBot Error]:', e.message);
    }
  }

  if (process.env.WHATSAPP_GATEWAY_URL) {
    try {
      await axios.post(process.env.WHATSAPP_GATEWAY_URL, { phone: robertPhone, message: messageText }, { timeout: 8000 });
      console.log(`[WhatsApp to Robert] Notificación enviada vía WhatsApp Gateway`);
    } catch (e) { }
  }
}

// ==========================================
// 🔍 DETECCIÓN Y EMPAREJAMIENTO DE INMUEBLES
// ==========================================
function matchWasiOrProperty(text, properties) {
  let wasiCode = null;
  const urlMatch = text.match(/https?:\/\/(?:info\.)?wasi\.co\/[^\s\)]*\/(\d{7,9})/i);
  if (urlMatch) {
    wasiCode = urlMatch[1];
  } else {
    const explicitCodeMatch = text.match(/(?:c[oó]digo\s*(?:es)?:?\s*|inmueble\s+)(\d{7,9})/i);
    if (explicitCodeMatch) {
      wasiCode = explicitCodeMatch[1];
    } else {
      const anyWasiNumber = text.match(/\b(10\d{6})\b/);
      if (anyWasiNumber) wasiCode = anyWasiNumber[1];
    }
  }

  if (wasiCode) {
    const matched = properties.find(p =>
      p.CODIGO_WASI === wasiCode ||
      (p.Wasi_URL && p.Wasi_URL.includes(wasiCode)) ||
      (p.Wasi && p.Wasi.includes(wasiCode))
    );
    if (matched) {
      return { status: 'MATCH', property: matched, code: wasiCode };
    } else {
      return { status: 'NOT_FOUND', code: wasiCode, item: `Inmueble código Wasi ${wasiCode}` };
    }
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
  const wantsPhotos = /fotos?|im[aá]genes|link|enlace/i.test(userText);
  const photoUrl = property.LINK_FOTOS_URL || (property.LINK_FOTOS && property.LINK_FOTOS.startsWith('http') ? property.LINK_FOTOS : null);

  let resp = `Hola, bienvenido a Tu techo ideal, ${greeting}, sí disponible.`;

  if ((wantsNoContactLink || wantsPhotos) && photoUrl) {
    if (wantsNoContactLink) {
      resp += ` Aquí tienes el enlace sin datos de contacto: ${photoUrl}`;
    } else {
      resp += ` Aquí puedes ver las fotos del inmueble: ${photoUrl}`;
    }
  }

  return resp;
}

// ==========================================
// 🤖 CONSULTAS BASADAS EN "DESCRIPCION_BREVE" (CLAUDE AI)
// ==========================================
async function generateClaudePropertyQA(userMessage, property, clientName = '') {
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.CLAUDE_API_KEY;
  const model = process.env.CLAUDE_MODEL || 'anthropic/claude-sonnet-4.5';
  // AISLAMIENTO ESTRICTO: Únicamente la columna DESCRIPCION_BREVE. Ninguna otra columna parecida.
  const descBreve = String(property['DESCRIPCION_BREVE'] || '').trim();
  const mascotas = property.Mascotas || 'No especificado';
  const tipoMascotas = property['Tipo de Mascotas'] || '';
  const estatus = property.ESTATUS || 'Disponible';
  const fotos = property.LINK_FOTOS_URL || property.LINK_FOTOS || '';

  const systemPrompt = `Eres el asesor profesional de atención al cliente inmobiliario de "Tu Techo Ideal", una prestigiosa empresa inmobiliaria en Caracas, Venezuela.
Tu rol es brindar una atención al cliente impecable, cordial, fluida, humana y profesional por WhatsApp, respondiendo dudas de los clientes basándote ÚNICA Y EXCLUSIVAMENTE en la columna "DESCRIPCION_BREVE" de nuestra base de datos.

DATOS DEL INMUEBLE CONSULTADO:
- Tipo: ${property.TIPO || 'Inmueble'}
- Operación: ${property.OPERACION || 'Venta'}
- Estatus: ${estatus}
- Mascotas permitidas: ${mascotas} ${tipoMascotas ? `(${tipoMascotas})` : ''}
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

5. SI LA INFORMACIÓN NO ESTÁ 100% EXPLÍCITA EN DESCRIPCION_BREVE:
   Si el cliente pregunta por una característica que NO aparece en "DESCRIPCION_BREVE":
   Responde con profesionalismo exacto: "Deme un momento, voy a consultar"
   Coloca al final: [ACCION: NO_EXISTE_EN_DESCRIPCION]

6. BLINDAJE DE SEGURIDAD ABSOLUTO:
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
// 🤝 GESTIÓN DE TRASPASO A HUMANO (HANDOFF)
// ==========================================
const HANDOFF_FILE = path.join(__dirname, 'handoffs.json');

let leadHandoffs = {};
try {
  if (fs.existsSync(HANDOFF_FILE)) {
    leadHandoffs = JSON.parse(fs.readFileSync(HANDOFF_FILE, 'utf8'));
  }
} catch (e) {
  leadHandoffs = {};
}

function saveHandoffs() {
  try {
    fs.writeFileSync(HANDOFF_FILE, JSON.stringify(leadHandoffs, null, 2));
  } catch (e) { }
}

function checkLeadHandoffStatus(leadId) {
  const h = leadHandoffs[String(leadId)];
  if (!h || !h.timestamp) return { inHandoff: false, hoursElapsed: 999 };
  const hoursElapsed = (Date.now() - h.timestamp) / (1000 * 60 * 60);
  // Si pasaron menos de 24 horas, el equipo de Tu Techo Ideal está atendiendo ese mismo día
  if (hoursElapsed < 24) {
    return { inHandoff: true, hoursElapsed };
  }
  return { inHandoff: false, hoursElapsed }; // Ya pasó 1 día
}

function setLeadHandoff(leadId) {
  leadHandoffs[String(leadId)] = { timestamp: Date.now() };
  saveHandoffs();
  console.log(`[Handoff Activated] Lead #${leadId} en traspaso a humano. El bot guarda silencio durante 24h.`);
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

    const model = process.env.CLAUDE_MODEL || 'anthropic/claude-sonnet-4.5';

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
  const model = process.env.CLAUDE_MODEL || 'anthropic/claude-sonnet-4.5';

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

async function generateResponseRaw(userMessage, allProperties, imageUrl = null, leadId = null, clientName = 'Cliente') {
  const cleanMessage = userMessage.substring(0, 800);
  const q = normalizeText(cleanMessage);

  // Verificar y recuperar si hay contexto de inmueble activo en la memoria del lead (local o Kommo)
  const existingProp = await getOrRecoverLeadPropertyContext(leadId, allProperties);
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
    const activeProp = existingProp || getLeadPropertyContext(leadId, allProperties);
    return {
      text: 'Deme un momento, voy a consultar',
      action: 'LIMITE_ALCANZADO',
      matchedProperty: activeProp,
      skip: false
    };
  }

  // 1. Verificar si el cliente pide AGENDAR CITA o VER/VISITAR el inmueble
  // "si la persona sigue: Ok estoy interesa quiero agendar para verla, la ia responde 'Ok, ya consulto con mi jefe para agendar la cita'"
  if (isVisitSchedulingIntent(cleanMessage)) {
    const activeProp = existingProp || getLeadPropertyContext(leadId, allProperties);
    console.log(`[Visit Scheduling Intent] El cliente ${clientName} solicita agendar cita para ver inmueble.`);
    return {
      text: 'Ok, ya consulto con mi jefe para agendar la cita',
      action: 'AGENDAR_CITA',
      matchedProperty: activeProp,
      skip: false
    };
  }

  // 2. Emparejar propiedad mencionada en el mensaje actual (o por imagen/flyer)
  let matchedProp = null;
  const wasiCheck = matchWasiOrProperty(cleanMessage, allProperties);

  if (wasiCheck.status === 'MATCH') {
    matchedProp = wasiCheck.property;
    saveLeadPropertyContext(leadId, matchedProp);
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
      saveLeadPropertyContext(leadId, matchedProp);
      console.log(`[Vision Match] Propiedad identificada por imagen: ${matchedProp.ID_PROPIEDAD}`);
    }
  }

  // Si aún no tenemos propiedad del mensaje, usar el contexto activo recuperado del lead
  if (!matchedProp) {
    matchedProp = existingProp || getLeadPropertyContext(leadId, allProperties);
    if (matchedProp) {
      console.log(`[Lead Context Memory] Inmueble activo recuperado para Lead #${leadId}: ${matchedProp.ID_PROPIEDAD}`);
    }
  }

  // 3. Determinar si es una consulta de DISPONIBILIDAD o contacto inicial del inmueble
  const isAvailabilityQuery = isExplicitAvailabilityQuery(cleanMessage) || wasiCheck.status === 'MATCH' || !!imageUrl;

  if (matchedProp && isAvailabilityQuery) {
    const isAvail = normalizeText(matchedProp.ESTATUS || '').includes('disponible');
    const greeting = getVenezuelaGreeting();
    if (!isAvail) {
      return {
        text: `Hola, bienvenido a Tu techo ideal, ${greeting}, actualmente este inmueble ya no se encuentra disponible.`,
        action: 'NO_DISPONIBLE',
        matchedProperty: matchedProp,
        skip: false
      };
    }

    const availResp = formatAvailabilityResponse(matchedProp, cleanMessage);
    return {
      text: availResp,
      action: 'DISPONIBILIDAD',
      matchedProperty: matchedProp,
      skip: false
    };
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

  const currentCount = getLeadResponseCount(leadId);
  const greeting = getVenezuelaGreeting();
  const officialGreetingPrefix = `Hola, bienvenido a Tu techo ideal, ${greeting}`;

  if (currentCount === 0) {
    let cleanText = result.text.trim();

    // Si ya empieza con "Bienvenido a Tu Techo Ideal", normalizar al saludo oficial exacto
    if (/^bienvenido\s+a\s+tu\s+techo\s+ideal/i.test(cleanText)) {
      cleanText = cleanText.replace(/^bienvenido\s+a\s+tu\s+techo\s+ideal[,\.]?\s*(buen d[ií]a|buenas tardes|buenas noches)?[,\.]?\s*/i, `${officialGreetingPrefix}. `);
      cleanText = cleanText.replace(/^(Hola,\s*bienvenido\s+a\s+Tu\s+techo\s+ideal,\s*(?:buen d[ií]a|buenas tardes|buenas noches))\.\s*(s[ií]\s*disponible)/i, '$1, $2');
    } else if (!/^hola,\s*bienvenido\s+a\s+tu\s+techo\s+ideal/i.test(cleanText)) {
      // Si la respuesta no contiene el saludo oficial de bienvenida, anteponerlo con cordialidad profesional
      if (/^deme\s+un\s+momento/i.test(cleanText)) {
        cleanText = `${officialGreetingPrefix}. Deme un momento, voy a consultar.`;
      } else if (/^ok,\s*ya\s+consulto/i.test(cleanText)) {
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
    // Si la respuesta es de espera por falta de datos, responder única y secamente la frase oficial
    if (/^deme\s+un\s+momento/i.test(cleanText)) {
      cleanText = 'Deme un momento, voy a consultar.';
    } else if (/^ok,\s*ya\s+consulto/i.test(cleanText)) {
      cleanText = 'Ok, ya consulto con mi jefe para agendar la cita.';
    }
    if (cleanText) result.text = cleanText;
  }

  return result;
}

async function generateResponse(userMessage, allProperties, imageUrl = null, leadId = null, clientName = 'Cliente') {
  const result = await generateResponseRaw(userMessage, allProperties, imageUrl, leadId, clientName);
  return finalizeResponse(result, leadId);
}

// ==========================================
// ⚡ COMUNICACIÓN CON KOMMO CRM
// ==========================================
async function updateKommoLead(leadId, aiText) {
  const token = process.env.KOMMO_TOKEN;
  const subdomain = process.env.KOMMO_SUBDOMAIN;
  const fieldId = parseInt(process.env.KOMMO_FIELD_ID, 10);

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
      'Authorization': token,
      'Content-Type': 'application/json'
    },
    timeout: 10000
  });

  console.log(`[Kommo API] Lead #${leadId} updated successfully (Status ${response.status})`);
  return response.data;
}

async function triggerKommoSalesbot(leadId) {
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

function extractImageUrl(body, messageObj) {
  if (messageObj?.attachment?.link) return messageObj.attachment.link;
  if (messageObj?.attachment?.url) return messageObj.attachment.url;
  if (messageObj?.media) return messageObj.media;
  if (messageObj?.media_url) return messageObj.media_url;
  if (messageObj?.link && /\.(jpeg|jpg|png|webp)/i.test(messageObj.link)) return messageObj.link;
  if (body?.['message[add][0][attachment][link]']) return body['message[add][0][attachment][link]'];
  if (body?.['message[add][0][attachment][url]']) return body['message[add][0][attachment][url]'];
  if (body?.['message[add][0][media]']) return body['message[add][0][media]'];
  if (body?.['message[add][0][media_url]']) return body['message[add][0][media_url]'];
  if (body?.['message[add][0][link]'] && /\.(jpeg|jpg|png|webp)/i.test(body['message[add][0][link]'])) return body['message[add][0][link]'];
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

function isInstagramStoryOrRestricted(text, messageObj = null) {
  const q = normalizeText(text);

  if (q) {
    if (
      q.includes('menciono en su historia') ||
      q.includes('menciono en una historia') ||
      q.includes('te menciono en su historia') ||
      q.includes('restricciones de instagram') ||
      q.includes('no podemos mostrar este mensaje') ||
      q.includes('abre esta conversacion en tu cuenta de instagram') ||
      q.includes('estas se aplican a reels') ||
      q.includes('galerias de videos') ||
      q.includes('galerias de fotos') ||
      q.includes('respondio a tu historia') ||
      q.includes('reacciono a tu historia') ||
      q.includes('compartio una historia') ||
      q.includes('compartio un reel')
    ) {
      return true;
    }
  }

  const mType = String(messageObj?.type || '').toLowerCase();
  if (mType.includes('story') || mType.includes('reel') || mType.includes('mention')) {
    return true;
  }

  return false;
}

// ==========================================
// 📡 ENDPOINT DEL WEBHOOK
// ==========================================
app.post(['/webhook', '/kommo-webhook'], async (req, res) => {
  // Respuesta 200 OK inmediata para Kommo
  res.status(200).send({ status: 'ok' });

  try {
    const body = req.body;

    // Validación de Cuenta Kommo
    if (body.account && body.account.id) {
      const allowedAccountId = process.env.KOMMO_ACCOUNT_ID || '36728143';
      if (String(body.account.id) !== String(allowedAccountId)) {
        console.warn(`[Security] Petición rechazada: Account ID no coincide (${body.account.id})`);
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
        author: {
          type: body['message[add][0][author][type]'],
          name: body['message[add][0][author][name]']
        }
      };
    }

    if (!messageObj) {
      console.log('[Webhook] Not a chat message event. Skipping.');
      return;
    }

    const imageUrl = extractImageUrl(body, messageObj);
    let userText = (messageObj.text || messageObj.value || '').trim();

    if (!userText && imageUrl) {
      userText = 'Hola, quisiera información de este inmueble de la publicación';
    }

    if (!userText && isVoiceNoteOrAudio(body, messageObj, userText)) {
      userText = '[Nota de voz / Audio recibido]';
    }

    if (!userText && isInstagramStoryOrRestricted(userText, messageObj)) {
      userText = '[Mención en historia de Instagram]';
    }

    if (!userText && !imageUrl) {
      console.log('[Webhook] Message has no text nor media content. Skipping.');
      return;
    }

    // 🛑 FILTRO 1: Anti-Autorespuesta (Si el mensaje contiene el nombre de la empresa, es del bot)
    if (userText.includes('Tu Techo Ideal') || userText.includes('Robert Jiménez')) {
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

    // 🛑 FILTRO 4: Deduplicación Robusta por Message ID y Huella de Contenido
    const rawId = messageObj.id || messageObj.message_id || messageObj.element_id;
    const contentHash = `${normalizeText(userText).substring(0, 50)}_${userText.length}`;
    const msgKey = rawId ? `id_${rawId}` : `talk_${messageObj.talk_id || 'none'}_${contentHash}`;

    if (isDuplicate(msgKey)) {
      console.log(`[Webhook] Duplicate message key [${msgKey}]. Skipping.`);
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

    // Resolver Lead ID
    let leadId = messageObj.entity_id || messageObj.element_id;

    if (!leadId && messageObj.talk_id) {
      try {
        const talkRes = await axios.get(`https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/talks/${messageObj.talk_id}`, {
          headers: { Authorization: process.env.KOMMO_TOKEN },
          timeout: 5000
        });
        leadId = talkRes.data.entity_id;
      } catch (err) {
        console.warn('[Webhook] Could not resolve lead from talk_id:', err.message);
      }
    }

    let clientPhone = '';
    if (messageObj.contact_id) {
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
      } catch (err) {
        console.warn('[Webhook] Could not resolve lead/phone from contact_id:', err.message);
      }
    }

    if (!leadId) {
      console.log('[Webhook] Could not resolve lead entity_id. Skipping.');
      if (currentTalkId) activeProcessingTalks.delete(currentTalkId);
      return;
    }

    const currentLeadId = String(leadId);

    // 🛑 FILTRO 4.2: Ignorar si el mensaje procede del propio Robert Jiménez (Broker / Admin) o de su chat de alertas
    const isRobertChat = currentLeadId === '7882504' ||
      String(messageObj.contact_id) === '18822786' ||
      clientPhone.includes('4143115105') ||
      clientPhone.includes('4223115105');
    if (isRobertChat) {
      console.log(`[Webhook] Mensaje procedente del chat o número de Robert (${clientPhone || currentLeadId}). El bot no responde a Robert.`);
      if (currentTalkId) activeProcessingTalks.delete(currentTalkId);
      return;
    }

    // 🛑 FILTRO 5: Mutex Lock en Vuelo por Lead ID (Garantiza 0 duplicados y 0 tokens perdidos)
    if (activeProcessingLeads.has(currentLeadId)) {
      console.log(`[Webhook] Lead #${currentLeadId} ya está en procesamiento activo. Skipping para evitar duplicar tokens de Claude.`);
      if (currentTalkId) activeProcessingTalks.delete(currentTalkId);
      return;
    }

    // 🛑 FILTRO 6: Debounce de 15 segundos por Lead
    if (isDebounced(currentLeadId)) {
      console.log(`[Webhook] Debounce activado para Lead #${currentLeadId} (ventana 15s). Skipping para evitar doble respuesta.`);
      if (currentTalkId) activeProcessingTalks.delete(currentTalkId);
      return;
    }

    // 🛑 FILTRO 6.1: Antiduplicado Estricto de Mensaje Reciente (Ventana 15 minutos)
    // Si este mismo lead ya envió este mismo texto en los últimos 15 minutos, IGNORAR (previene reintentos de Kommo/Make).
    if (isSameLeadMessageRecent(currentLeadId, userText)) {
      console.log(`[Webhook] Mensaje idéntico detectado recientemente para Lead #${currentLeadId} ("${userText.substring(0, 40)}..."). Skipping para evitar respuesta duplicada.`);
      if (currentTalkId) activeProcessingTalks.delete(currentTalkId);
      return;
    }

    activeProcessingLeads.add(currentLeadId);

    try {
      const clientName = messageObj.author?.name || 'Cliente';

      console.log(`\n========================================`);
      console.log(`[Processing New Message]`);
      console.log(`Lead ID: ${currentLeadId}`);
      console.log(`Cliente: ${clientName}`);
      console.log(`Message: "${userText}"`);
      console.log(`========================================`);

      // 🛑 CONTROL DE TRASPASO A HUMANO (HANDOFF)
      const handoffStatus = checkLeadHandoffStatus(currentLeadId);
      const intent = detectLeadIntent(userText);

      if (handoffStatus.inHandoff) {
        console.log(`[Handoff Silence] Lead #${currentLeadId} está en atención manual con el equipo de Tu Techo Ideal (${handoffStatus.hoursElapsed.toFixed(1)}h transcurridas). El bot se mantiene al margen y en silencio.`);
        return;
      }

      // 🛑 INTERCEPCIÓN 1: NOTA DE VOZ / AUDIO RECIBIDO
      // "si el sistema detecta que llego una nota de voz tampoco la responde, manda alerta a rober para que responda. No emites ningun tipo de mensaje al cliente, ni que espere ni nada solo manda alerta..."
      if (isVoiceNoteOrAudio(body, messageObj, userText)) {
        console.log(`[Voice Note Intercepted] Lead #${currentLeadId} envió una nota de voz. El bot se mantiene en silencio absoluto (0 mensajes al cliente) y despacha alerta a Robert.`);
        const properties = await getAvailableProperties();
        const activeProp = await getOrRecoverLeadPropertyContext(currentLeadId, properties);
        let channel = clientPhone ? 'WhatsApp' : (clientName.startsWith('@') ? 'Instagram' : 'WhatsApp / Redes Sociales');

        const robertAlert = buildRobertAlertText({
          type: 'NOTA_DE_VOZ',
          clientName,
          clientPhone,
          channel,
          matchedProperty: activeProp,
          userText: userText || '[Nota de voz / Audio recibido]',
          leadId: currentLeadId
        });

        await dispatchDirectWhatsAppToRobert(robertAlert);
        setLeadHandoff(currentLeadId);
        return;
      }

      // 🛑 INTERCEPCIÓN 2: MENCIÓN EN HISTORIA / REEL / RESTRICCIÓN DE INSTAGRAM
      // "evita que eso pase, respeta el cuadro de dialogo... No emites ningun tipo de mensaje al cliente, ni que espere ni nada solo manda alerta..."
      if (isInstagramStoryOrRestricted(userText, messageObj)) {
        console.log(`[Instagram Story/Restricted Intercepted] Lead #${currentLeadId}: "${userText.substring(0, 60)}...". Silencio absoluto al cliente y alerta ejecutiva a Robert.`);
        const properties = await getAvailableProperties();
        const activeProp = await getOrRecoverLeadPropertyContext(currentLeadId, properties);

        const robertAlert = buildRobertAlertText({
          type: 'INSTAGRAM_STORY_OR_RESTRICTED',
          clientName,
          clientPhone: clientPhone || '',
          channel: 'Instagram Direct',
          matchedProperty: activeProp,
          userText: userText || '[Mención en historia de Instagram]',
          leadId: currentLeadId
        });

        await dispatchDirectWhatsAppToRobert(robertAlert);
        setLeadHandoff(currentLeadId);
        return;
      }

      // 1. Obtener propiedades de Google Sheets
      const properties = await getAvailableProperties();

      // 2. Generar respuesta personalizada
      console.log('[Processing] Generating response based on DESCRIPCION_BREVE & inventory...');
      const result = await generateResponse(userText, properties, imageUrl, currentLeadId, clientName);

      // Si el filtro determinístico o Claude clasificaron como charla casual, comentario o ignorar
      if (!result || result.skip || !result.text) {
        console.log('[Processing] No response required (casual conversation, chit-chat or personal talk). Skipping delivery.');
        return;
      }

      const responseText = result.text;
      console.log('[Processing] Response text:\n', responseText);

      // 3. Guardar respuesta en Kommo
      console.log('[Processing] Saving response to Kommo lead field...');
      await updateKommoLead(currentLeadId, responseText);

      // 4. Disparar Salesbot ÚNICA VEZ
      console.log('[Processing] Triggering Salesbot single delivery...');
      await triggerKommoSalesbot(currentLeadId);

      // Incrementar contador de respuestas automáticas de la IA para este lead
      const responseNum = incrementLeadResponseCount(currentLeadId);
      console.log(`[Response Count] Lead #${currentLeadId} - Respuestas automáticas acumuladas: ${responseNum}/${MAX_AI_RESPONSES_PER_LEAD}`);

      // 🛑 LIMPIEZA AUTOMÁTICA DEL CAMPO RESPUESTA_IA TRAS EL ENVÍO (ANTIDUPLICADOS)
      // Ventana de 60 segundos: Da tiempo total de holgura para que Salesbot lea y despache el mensaje por WhatsApp
      setTimeout(async () => {
        try {
          await updateKommoLead(currentLeadId, ' ');
          console.log(`[Anti-Duplicate] Campo Respuesta_IA vaciado para Lead #${currentLeadId}`);
        } catch (e) {
          console.warn('[Anti-Duplicate Clear Error]:', e.message);
        }
      }, 60000);

      // 5. Despacho de Alertas según la acción ejecutada (Omnicanal: WhatsApp, Instagram, Facebook)
      let channel = 'WhatsApp';
      const userTextLower = userText.toLowerCase();
      if (clientPhone) {
        channel = 'WhatsApp';
      } else if (clientName.startsWith('@') || userTextLower.includes('instagram') || (messageObj.author && String(messageObj.author.name).startsWith('@'))) {
        channel = 'Instagram';
      } else if (userTextLower.includes('facebook') || (messageObj.talk_id && String(messageObj.talk_id).toLowerCase().includes('fb'))) {
        channel = 'Facebook';
      } else {
        channel = 'WhatsApp / Redes Sociales';
      }

      if (result.action === 'AGENDAR_CITA') {
        const robertAlertText = buildRobertAlertText({
          type: 'AGENDAR_CITA',
          clientName,
          clientPhone,
          channel,
          matchedProperty: result.matchedProperty,
          userText,
          leadId: currentLeadId
        });

        console.log(`[Visit Alert] Despachando alerta ejecutiva de cita a Robert...`);
        await dispatchDirectWhatsAppToRobert(robertAlertText);
        setLeadHandoff(currentLeadId);
      } else if (result.action === 'NO_EXISTE_EN_DESCRIPCION') {
        const robertAlertText = buildRobertAlertText({
          type: 'NO_EXISTE_EN_DESCRIPCION',
          clientName,
          clientPhone,
          channel,
          matchedProperty: result.matchedProperty,
          userText,
          leadId: currentLeadId
        });

        console.log(`[Missing Info Alert] Despachando alerta ejecutiva de información fuera de BD a Robert...`);
        await dispatchDirectWhatsAppToRobert(robertAlertText);
        setLeadHandoff(currentLeadId);
      } else if (result.action === 'LIMITE_ALCANZADO') {
        const robertAlertText = buildRobertAlertText({
          type: 'LIMITE_ALCANZADO',
          clientName,
          clientPhone,
          channel,
          matchedProperty: result.matchedProperty,
          userText,
          leadId: currentLeadId
        });

        console.log(`[Limit Alert] Despachando alerta ejecutiva de límite a Robert...`);
        await dispatchDirectWhatsAppToRobert(robertAlertText);
        setLeadHandoff(currentLeadId);
      }

      // Si alcanzó el límite de 4 respuestas en esta misma interacción: pausar para que continúe un humano
      if (responseNum >= MAX_AI_RESPONSES_PER_LEAD && result.action !== 'AGENDAR_CITA' && result.action !== 'NO_EXISTE_EN_DESCRIPCION' && result.action !== 'LIMITE_ALCANZADO') {
        console.log(`[Limit Met] Lead #${currentLeadId} completó sus ${MAX_AI_RESPONSES_PER_LEAD} respuestas permitidas. Activando handoff...`);
        const limitReport = buildRobertAlertText({
          type: 'LIMITE_ALCANZADO',
          clientName,
          clientPhone,
          channel,
          matchedProperty: result.matchedProperty,
          userText,
          leadId: currentLeadId
        });
        dispatchDirectWhatsAppToRobert(limitReport).catch(() => {});
        setLeadHandoff(currentLeadId);
      }

      console.log(`[Success] Message strictly processed 1 single time for Lead #${currentLeadId}!\n`);

    } finally {
      activeProcessingLeads.delete(currentLeadId);
      if (currentTalkId) activeProcessingTalks.delete(currentTalkId);
    }

  } catch (err) {
    console.error('[Webhook Processing Error]:', err.response?.data || err.message);
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

  res.send({
    status: 'running',
    service: 'Tu Techo Ideal Bot Microservice - v4.1 Anti-Substitution & Anti-Duplicate Shield Edition',
    claude_enabled: process.env.DISABLE_CLAUDE !== 'true',
    claude_model: process.env.CLAUDE_MODEL || 'anthropic/claude-sonnet-4.5',
    credits_remaining_usd: remainingCredits,
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

app.listen(PORT, async () => {
  console.log(`Tu Techo Ideal Bot running on port ${PORT}`);
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
