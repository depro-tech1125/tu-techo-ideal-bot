require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { parse } = require('csv-parse/sync');

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
const activeProcessingLeads = new Set();
const activeProcessingTalks = new Set();

function isDuplicate(key) {
  if (!key) return false;
  if (processedMessages.has(key)) return true;
  processedMessages.add(key);
  setTimeout(() => processedMessages.delete(key), 60000);
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
// 📊 GOOGLE SHEETS EN TIEMPO REAL
// ==========================================
async function getAvailableProperties() {
  try {
    const csvUrl = process.env.GOOGLE_SHEET_CSV_URL;
    const response = await axios.get(csvUrl, { timeout: 7000 });
    const records = parse(response.data, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });
    console.log(`[Google Sheets] Total rows: ${records.length}`);
    return records;
  } catch (err) {
    console.error('[Google Sheets Error]:', err.message);
    return [];
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
function isCasualOrChitChat(text) {
  const q = normalizeText(text);

  // Lista de comentarios casuales, exclamaciones, bromas y opiniones
  const casualPhrases = [
    'si es una locura', 'una locura', 'que locura', 'es una locura', 'locura',
    'jajaja', 'jaja', 'jeje', 'jiji', 'lol', 'xd',
    'ok', 'oka', 'okey', 'okay', 'vale', 'dale', 'dale pues', 'dale fino', 'listo',
    'gracias', 'muchas gracias', 'mil gracias', 'gracias amigo', 'gracias amiga',
    'perfecto', 'excelente', 'bueno', 'buenisimo', 'fino', 'chevere', 'que fino', 'que chevere',
    'de acuerdo', 'entendido', 'anotado', 'copiado',
    'chao', 'adios', 'hasta luego', 'nos vemos', 'feliz dia', 'feliz tarde', 'feliz noche',
    'muy caro', 'esta caro', 'esta muy caro', 'demasiado caro', 'no me alcanza', 'no llego a eso',
    'yo te aviso', 'yo les aviso', 'despues te aviso', 'te estoy avisando', 'cualquier cosa te aviso',
    'voy a consultar', 'voy a pensar', 'lo voy a pensar', 'dejame pensarlo', 'dejame ver', 'dejame consultar',
    'voy a hablar con', 'hablo con mi esposa', 'hablo con mi esposo', 'hablo con mi socio',
    'como estas', 'como estan', 'que tal', 'epale', 'que hubo', 'bien y tu', 'todo bien',
    'donde estas', 'a que hora nos vemos', 'vamos a comer', 'pasame el documento',
    'colega una pregunta', 'una pregunta', 'tengo una pregunta', 'tengo una duda', 'una consulta', 'hola colega', 'buenas colega', 'colega'
  ];

  if (casualPhrases.some(p => q === p || q === `${p}!` || q === `${p}.` || q === `${p}?` || q.startsWith(p + ' ') || q.endsWith(' ' + p))) {
    return true;
  }

  // Palabras clave de intención inmobiliaria
  const realEstateKeywords = [
    'casa', 'casas', 'apto', 'aptos', 'apartamento', 'apartamentos', 'quinta', 'quintas',
    'local', 'locales', 'oficina', 'oficinas', 'comercial', 'galpon', 'terreno',
    'venta', 'comprar', 'compra', 'alquiler', 'alquilar', 'renta', 'rentar',
    'precio', 'precios', 'costo', 'valor', 'cuanto', 'presupuesto',
    'macaracuay', 'florida', 'boyera', 'hatillo', 'caracas', 'zona', 'ubicacion',
    'cita', 'visita', 'visitar', 'agendar', 'verlo', 'verla', 'disponible', 'disponibles',
    'inmueble', 'inmuebles', 'propiedad', 'propiedades'
  ];

  const hasRealEstateIntent = realEstateKeywords.some(kw => q.includes(kw));

  // Si no menciona nada del negocio inmobiliario y es un mensaje corto (< 40 caracteres):
  if (!hasRealEstateIntent && q.length < 40) {
    return true;
  }

  return false;
}

// ==========================================
// 🎯 COMPROBACIÓN ESTRICTA DE INTENCIÓN INMOBILIARIA
// "NO SE RESPONDE a menos que te diga hola estoy interesada o interesado en comprar, alquilar un inmueble o vender..."
// ==========================================
function hasExplicitRealEstateIntent(text) {
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
    'comercial', 'galpon', 'terreno', 'inmueble', 'inmuebles', 'propiedad', 'propiedades',
    'precio', 'precios', 'costo', 'presupuesto',
    'macaracuay', 'alta florida', 'florida', 'boyera', 'hatillo',
    'wasi', 'http'
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
          text: `🚨 ${alertHeadline}\n\n⚠️ RECUERDA CARGAR LA INFORMACIÓN DE ESTE INMUEBLE EN GOOGLE SHEETS.\nNo puedo responder al cliente porque no tengo información de este inmueble en Google Sheets y no puedo inventarla.\n\nCliente/Remitente: ${clientIdentifier}\nPregunta recibida: "${userText}"\nInmueble / Enlace consultado: ${requestedItem}\nEnlace Lead: ${leadUrl}\n\n⚡ El bot no respondió a esta persona y guarda silencio para que Robert o Bárbara respondan directamente.`
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
      } catch (e) {}
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
// 🤝 GESTIÓN DE TRASPASO A HUMANO (HANDOFF)
// ==========================================
const fs = require('fs');
const path = require('path');
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
  } catch (e) {}
}

function checkLeadHandoffStatus(leadId) {
  const h = leadHandoffs[String(leadId)];
  if (!h || !h.timestamp) return { inHandoff: false, hoursElapsed: 999 };
  const hoursElapsed = (Date.now() - h.timestamp) / (1000 * 60 * 60);
  // Si pasaron menos de 24 horas, Robert y Bárbara están atendiendo ese mismo día
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
    } catch (e) {}
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
  } catch (e) {}

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
// 🧠 MOTOR DE CONVERSACIÓN INTELIGENTE
// ==========================================
function formatSingleProperty(p) {
  const cleanPrice = (p.PRECIO || '').replace('$', '').trim();
  let out = `📍 **${p.TIPO} en ${p.ZONA} (${p.OPERACION})**\n`;
  out += `• **Precio:** US$ ${cleanPrice}\n`;
  out += `• **Distribución:** ${p.HABITACIONES} Habs | ${p.BANOS} Baños | ${p.ESTACIONAMIENTOS} Puestos\n`;
  if (p.DESCRIPCION_BREVE && p.DESCRIPCION_BREVE.trim() !== '-' && p.DESCRIPCION_BREVE.trim() !== '') {
    out += `• **Detalles:** ${p.DESCRIPCION_BREVE.trim()}\n`;
  }
  if (p.LINK_FOTOS && p.LINK_FOTOS.trim() !== '') {
    out += `• **Fotos:** ${p.LINK_FOTOS.trim()}\n`;
  }
  return out;
}

// ==========================================
// 🤖 INTEGRACIÓN CON CLAUDE AI (OPENROUTER)
// ==========================================
async function generateClaudeResponse(userMessage, availableProperties) {
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.CLAUDE_API_KEY || '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';
  if (!apiKey) return null;

  try {
    // Verificación de saldo en segundo plano
    checkAndAlertLowBalance().catch(e => console.warn('[Bg Balance Check]:', e.message));

    // Formatear inventario SIN códigos de referencia internos (REF-xxx)
    const formattedInventory = availableProperties.map((p, i) => {
      const cleanPrice = (p.PRECIO || '').replace('$', '').trim();
      return `${i + 1}. ${p.TIPO} en ${p.ZONA} | Operación: ${p.OPERACION} | Precio: US$ ${cleanPrice} | Habs: ${p.HABITACIONES} | Baños: ${p.BANOS} | Puestos: ${p.ESTACIONAMIENTOS} | Detalles: ${p.DESCRIPCION_BREVE || 'N/A'} | Fotos: ${p.LINK_FOTOS || 'No link'}`;
    }).join('\n');

    const systemPrompt = `Eres el asistente inmobiliario virtual de "Tu Techo Ideal", atendiendo en nombre de Bárbara Bravo y Robert Jiménez.
Tu único objetivo es responder de forma concisa, profesional y directa con los inmuebles disponibles en el inventario real de Google Sheets para agendar visitas presenciales.

REGLAS CRÍTICAS E INVIOLABLES:
1. Comienza siempre tus respuestas iniciales con el saludo oficial exacto:
"¡Hola! Gracias por comunicarte con, Tu Techo Ideal, somos Bárbara Bravo y Robert Jiménez. ✨"
2. SI EL CLIENTE PIDE CASAS EN VENTA: Solo ofrece propiedades cuya "Operación" sea estrictamente "Venta". NUNCA ofrezcas un alquiler si el cliente pidió comprar o venta.
3. SI EL CLIENTE PIDE ALQUILER: Solo ofrece propiedades cuya "Operación" sea "Alquiler".
4. INVENTARIO REAL EN TIEMPO REAL:
${formattedInventory}
5. Nunca inventes propiedades, precios, características ni ubicaciones que no estén en la lista anterior.
6. Presenta los precios en formato "US$ [monto]". Si hay link de fotos disponible, inclúyelo para que el cliente pueda verlas.
7. Al final invita siempre a coordinar una visita presencial con Bárbara o Robert Jiménez para conocer el inmueble.
8. ATENCIÓN PERSONALIZADA DE CITAS: NUNCA coloques enlaces a WhatsApp (como https://wa.me/...) ya que el cliente ya está hablando directamente por este mismo chat de WhatsApp. Si el cliente solicita agendar una cita o visita, o muestra intención de compra, dile con amabilidad que en este momento le has avisado a Robert y a Bárbara y que en breve uno de ellos continuará la conversación con él por este mismo chat para coordinar la fecha y hora personalmente.
9. REGLA ESTRICTA DE PRIVACIDAD: NUNCA menciones códigos de referencia internos como [REF-001], [REF-002], [REF-003] ni identificadores. Presenta las propiedades directamente por su tipo y zona (por ejemplo: "Casa Comercial en Alta Florida").
10. PROHIBICIÓN ESTRICTA DE CONVERSAR O RESPONDER COMENTARIOS CASUALES:
Tu único propósito es ofrecer inmuebles del inventario y coordinar citas. NUNCA respondas a comentarios casuales, opiniones, exclamaciones o charlas sociales (como "si es una locura", "una locura", "jajaja", "ok gracias", "muy caro", "dale pues", "yo te aviso", "¿cómo estás?"). Si el mensaje del cliente es una reacción, charla informal, comentario casual o ajeno a buscar o visitar un inmueble, responde ÚNICAMENTE la palabra: "IGNORAR_NO_INMOBILIARIO". NO debes conversar, eso lo hacen Robert y Bárbara.
11. CONSULTA DE INMUEBLE, ENLACES (WASI, CONEXA, PORTALES), ZONAS O DETALLES NO REGISTRADOS EN GOOGLE SHEETS:
Si el cliente o colega pregunta por un inmueble, enlace de Wasi, enlace web, código externo, zona, alquiler, características, aceptación de mascotas o cualquier propiedad que NO esté claramente en el inventario real de Google Sheets de arriba (por ejemplo: enlace o código de Wasi como 10493109 o Los Samanes, apartamento en La California Norte, o alquiler de apartamentos):
NO DEBES RESPONDERLE AL CLIENTE NI SALUDARLO BAJO NINGUNA CIRCUNSTANCIA. NUNCA INVENTES INFORMACIÓN.
Responde ÚNICAMENTE en este formato exacto de una sola línea:
NO_DISPONIBLE: [Escribe aquí el inmueble, enlace o consulta no registrada, por ejemplo: Apartamento en Los Samanes - Wasi 10493109]`;

    const model = process.env.CLAUDE_MODEL || 'anthropic/claude-sonnet-4.5';

    const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.3,
      max_tokens: 350
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://tu-techo-ideal-bot-1.onrender.com',
        'X-Title': 'Tu Techo Ideal Bot',
        'Content-Type': 'application/json'
      },
      timeout: 12000
    });

    let aiMessage = response.data?.choices?.[0]?.message?.content?.trim();
    if (aiMessage) {
      if (aiMessage.includes('IGNORAR_NO_INMOBILIARIO')) {
        console.log('[Claude Filter] Mensaje clasificado como conversación personal/ajena/comentario casual. No se responde.');
        return { text: null, notFoundItem: null, skip: true };
      }
      // Limpieza de seguridad: eliminar cualquier mención accidental a códigos tipo [REF-xxx] o REF-xxx
      aiMessage = aiMessage.replace(/\[\s*REF-[^\]]+\]\s*/gi, '').replace(/\bREF-\d+\b\s*/gi, '');

      // Verificar si detectó inmueble o detalle no disponible en Google Sheets
      if (aiMessage.includes('NO_DISPONIBLE:')) {
        const notFoundDesc = aiMessage.replace(/NO_DISPONIBLE:\s*/i, '').split('\n')[0].trim();
        console.log(`[Claude Inventory Check] Inmueble/Detalle no disponible detectado: "${notFoundDesc}"`);
        return { text: null, notFoundItem: notFoundDesc, skip: false };
      }

      console.log(`[Claude via OpenRouter] Response generated successfully (${aiMessage.length} chars)`);
      return { text: aiMessage, notFoundItem: null, skip: false };
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

async function generateResponse(userMessage, allProperties) {
  const cleanMessage = userMessage.substring(0, 800);
  const q = normalizeText(cleanMessage);

  // 🛑 FILTRO 1: Descartar charla casual, reacciones y comentarios sin intención inmobiliaria
  if (isCasualOrChitChat(cleanMessage)) {
    console.log(`[Anti-Chitchat Filter] Comentario casual o reacción detectada ("${cleanMessage}"). El bot guarda silencio para no gastar tokens.`);
    return { text: null, notFoundItem: null, skip: true };
  }

  // Saludo oficial corregido exactamente según instrucciones del usuario
  const baseGreeting = `¡Hola! Gracias por comunicarte con, Tu Techo Ideal, somos Bárbara Bravo y Robert Jiménez. ✨\n\n`;

  // 🛑 FILTRO 2 ESTRICTO: NO SE RESPONDE A MENOS QUE TENGA INTENCIÓN INMOBILIARIA EXPLÍCITA
  // Regla del usuario: "NO SE RESPONDE a menos que te diga hola estoy interesada o interesado en comprar, alquilar un inmueble o vender..."
  if (!hasExplicitRealEstateIntent(cleanMessage)) {
    console.log(`[Strict Intent Gate] Mensaje sin intención inmobiliaria explícita ("${cleanMessage}"). Silencio absoluto para proteger tokens y no molestar.`);
    return { text: null, notFoundItem: null, skip: true };
  }

  // Filtramos solo las disponibles
  const available = allProperties.filter(row => {
    const status = normalizeText(row.ESTATUS || row.Estatus || row.estatus);
    return status === 'disponible';
  });

  // Usamos Claude AI para consultas reales de inmuebles
  const isClaudeEnabled = process.env.DISABLE_CLAUDE !== 'true';
  if (isClaudeEnabled) {
    const claudeResult = await generateClaudeResponse(userMessage, available);
    if (claudeResult) {
      if (claudeResult.skip) return { text: null, notFoundItem: null, skip: true };
      return claudeResult;
    }
    console.log('[Fallback] Claude no respondió o dio error, usando motor determinístico de respaldo.');
  }

  // 2. Cliente pide cita o visita directamente
  if (detectLeadIntent(q).isHot && !q.includes('casa') && !q.includes('apto') && !q.includes('venta') && !q.includes('alquiler')) {
    return {
      text: `${baseGreeting}¡Excelente! En este momento le acabo de avisar a Robert y a Bárbara sobre tu interés para coordinar la visita. En breve uno de ellos continuará la conversación contigo directamente por aquí para definir la fecha y la hora. ¡Un placer atenderte!`,
      notFoundItem: null,
      skip: false
    };
  }

  // Detectar intención de Operación (Venta vs Alquiler)
  const wantsBuy = q.includes('venta') || q.includes('comprar') || q.includes('compra') || q.includes('adquirir');
  const wantsRent = q.includes('alquiler') || q.includes('alquilar') || q.includes('renta') || q.includes('rentar');

  // Detectar Tipo de Inmueble
  const wantsCasa = q.includes('casa') || q.includes('casas') || q.includes('quinta') || q.includes('quintas');
  const wantsComercial = q.includes('comercial') || q.includes('local') || q.includes('oficina');
  const wantsApto = q.includes('apartamento') || q.includes('apartamentos') || q.includes('apto') || q.includes('aptos');

  // Detectar Zonas
  const mentionsMacaracuay = q.includes('macaracuay');
  const mentionsFlorida = q.includes('florida') || q.includes('alta florida') || q.includes('libertador');
  const mentionsBoyera = q.includes('boyera') || q.includes('hatillo');

  // Filtrado estricto por Operación si fue solicitada
  let filtered = available;

  if (wantsBuy) {
    filtered = filtered.filter(p => normalizeText(p.OPERACION).includes('venta'));
  } else if (wantsRent) {
    filtered = filtered.filter(p => normalizeText(p.OPERACION).includes('alquiler'));
  }

  // Filtrado por Tipo de Inmueble
  if (wantsCasa) {
    if (wantsComercial) {
      filtered = filtered.filter(p => normalizeText(p.TIPO).includes('comercial'));
    } else {
      filtered = filtered.filter(p => normalizeText(p.TIPO).includes('casa'));
    }
  } else if (wantsApto) {
    filtered = filtered.filter(p => normalizeText(p.TIPO).includes('apartamento') || normalizeText(p.TIPO).includes('apto'));
  } else if (wantsComercial) {
    filtered = filtered.filter(p => normalizeText(p.TIPO).includes('comercial') || normalizeText(p.TIPO).includes('local'));
  }

  // Filtrado por Zona si fue solicitada
  if (mentionsMacaracuay) {
    filtered = filtered.filter(p => normalizeText(p.ZONA).includes('macaracuay'));
  } else if (mentionsFlorida) {
    filtered = filtered.filter(p => normalizeText(p.ZONA).includes('florida'));
  } else if (mentionsBoyera) {
    filtered = filtered.filter(p => normalizeText(p.ZONA).includes('boyera') || normalizeText(p.ZONA).includes('hatillo'));
  }

  // ==========================================
  // RESPUESTAS SEGÚN COINCIDENCIAS
  // ==========================================

  // Si encontramos coincidencias exactas
  if (filtered.length > 0) {
    const opText = wantsBuy ? 'en venta' : (wantsRent ? 'en alquiler' : 'disponibles');
    let text = `${baseGreeting}Revisando nuestro inventario, tenemos excelentes opciones ${opText} para ti:\n\n`;
    
    filtered.slice(0, 2).forEach(p => {
      text += formatSingleProperty(p) + '\n';
    });

    text += `¿Te gustaría coordinar una visita presencial para conocer alguna de estas opciones o recibir información adicional?`;
    return { text: text, notFoundItem: null, skip: false };
  }

  // Si pidió un inmueble que NO existe en Google Sheets
  const requestedDesc = (wantsApto ? 'Apartamento' : (wantsCasa ? 'Casa' : (wantsComercial ? 'Comercial' : 'Inmueble'))) +
    (wantsBuy ? ' en Venta' : (wantsRent ? ' en Alquiler' : '')) +
    (mentionsMacaracuay ? ' en Macaracuay' : (mentionsFlorida ? ' en Alta Florida' : (mentionsBoyera ? ' en La Boyera' : '')));

  return {
    text: null,
    notFoundItem: requestedDesc.trim() || 'Inmueble no registrado en Sheets',
    skip: false
  };
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
      'Authorization': token,
      'Content-Type': 'application/json'
    },
    timeout: 10000
  });

  console.log(`[Kommo API] Salesbot #${botId} triggered for Lead #${leadId} (Status ${response.status})`);
  return response.data;
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

    const userText = (messageObj.text || messageObj.value || '').trim();
    if (!userText) {
      console.log('[Webhook] Message has no text content. Skipping.');
      return;
    }

    // 🛑 FILTRO 1: Anti-Autorespuesta (Si el mensaje contiene el nombre de la empresa, es del bot)
    if (userText.includes('Tu Techo Ideal') || userText.includes('Bárbara Bravo') || userText.includes('Robert Jiménez')) {
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
        console.log(`[Handoff Silence] Lead #${currentLeadId} está en atención manual con Robert/Bárbara (${handoffStatus.hoursElapsed.toFixed(1)}h transcurridas). El bot se mantiene al margen y en silencio.`);
        return;
      }

      // 1. Obtener propiedades de Google Sheets
      const properties = await getAvailableProperties();

      // 2. Generar respuesta personalizada (Solo 1 llamada a Claude)
      console.log('[Processing] Generating response with Claude/Model...');
      const result = await generateResponse(userText, properties);

      // 🛑 SI EL INMUEBLE O DETALLE NO ESTÁ EN GOOGLE SHEETS:
      // "claude ese tipo de pregunta no debe responder sino mandar una alerta, por correo y al whatsapp de robert... Y listo..."
      if (result && result.notFoundItem) {
        console.log(`\n========================================`);
        console.log(`[Missing Property] Consulta sobre "${result.notFoundItem}" no registrada en Sheets.`);
        console.log(`El bot GUARDA SILENCIO ABSOLUTO con el cliente (${clientName}).`);
        console.log(`Enviando alerta urgente a Robert (+584143115105) y por correo.`);
        console.log(`========================================\n`);

        await dispatchMissingPropertyAlert(currentLeadId, clientName, clientPhone, result.notFoundItem, userText);
        setLeadHandoff(currentLeadId); // Silenciar bot durante 24h para que Robert o Bárbara respondan personalmente
        return; // ¡NO ENVIAR NINGÚN MENSAJE AL CLIENTE! ¡NO DISPARAR SALESBOT AL CLIENTE!
      }

      // Si el filtro determinístico o Claude clasificaron como charla casual, comentario o ignorar
      if (!result || result.skip || !result.text) {
        console.log('[Processing] No response required (casual conversation, chit-chat or personal talk). Skipping delivery.');
        return;
      }
      const responseText = result.text;
      console.log('[Processing] Response text:\n', responseText);

      // 3. Guardar en Kommo
      console.log('[Processing] Saving response to Kommo lead field...');
      await updateKommoLead(currentLeadId, responseText);

      // 4. Disparar Salesbot ÚNICA VEZ
      console.log('[Processing] Triggering Salesbot single delivery...');
      await triggerKommoSalesbot(currentLeadId);

      // 5. Si el cliente activó intención caliente (visita, cita, compra):
      if (intent.isHot) {
        console.log(`[Hot Lead Alert] ${intent.type} detectado para Lead #${currentLeadId}! Disparando alerta inmediata WhatsApp + Correo.`);
        dispatchAlertToRobert(currentLeadId, userText, clientName, intent.type);
        setLeadHandoff(currentLeadId); // Activamos silencio de 24h para que Robert y Bárbara atiendan personalmente
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
  } catch (e) {}

  res.send({
    status: 'running',
    service: 'Tu Techo Ideal Bot Microservice - v3.9 Daily AI Intelligence & Balance Report Edition',
    claude_enabled: process.env.DISABLE_CLAUDE !== 'true',
    claude_model: process.env.CLAUDE_MODEL || 'anthropic/claude-sonnet-4.5',
    credits_remaining_usd: remainingCredits,
    uptime_seconds: Math.floor(process.uptime())
  });
});

// Endpoints del Reporte Diario y Estadísticas
app.get(['/stats', '/report', '/dashboard'], async (req, res) => {
  const stats = await getDailyStats();
  if (!stats) return res.status(500).send('Error obteniendo estadísticas');
  res.send(generateHtmlDailyReport(stats));
});

app.get('/api/daily-stats', async (req, res) => {
  const stats = await getDailyStats();
  res.send(stats || { error: 'No data' });
});

app.get('/api/send-daily-report', async (req, res) => {
  const result = await sendDailyBalanceReport();
  res.send(result);
});

app.listen(PORT, () => {
  console.log(`Tu Techo Ideal Bot running on port ${PORT}`);
  initDailyReportScheduler();
});
