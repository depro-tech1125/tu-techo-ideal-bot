require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { parse } = require('csv-parse/sync');

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// 🔒 SEGURIDAD Y PROTECCIÓN DEL SERVIDOR
// ==========================================
// 1. Ocultar firma de Express
app.disable('x-powered-by');

// 2. Parsers con límite de tamaño para evitar ataques DoS de payloads gigantes
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json({ limit: '2mb' }));

// 3. Rate Limiter en memoria (Máximo 30 peticiones por minuto por IP)
const ipRequestCounts = new Map();
function rateLimiter(req, res, next) {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minuto
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

// 4. Cache de deduplicación para no procesar el mismo mensaje dos veces
const processedMessages = new Set();
function isDuplicate(msgId) {
  if (!msgId) return false;
  if (processedMessages.has(msgId)) return true;
  processedMessages.add(msgId);
  setTimeout(() => processedMessages.delete(msgId), 60000); // 1 minuto TTL
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

// Detectar si el cliente tiene intención de Cita / Visita
function isHighIntent(text) {
  const q = normalizeText(text);
  const hotKeywords = [
    'cita', 'visita', 'agendar', 'verlo', 'verla', 'visitar', 
    'cuando podemos ir', 'cuando se puede ver', 'disponible para ver',
    'mostrar', 'conocerlo', 'conocerla', 'me interesa ver', 'quiero ver'
  ];
  return hotKeywords.some(kw => q.includes(kw));
}

// ==========================================
// 🚨 NOTIFICACIONES Y ALERTAS PARA ROBERT
// ==========================================
// 1. Crear Tarea de Alta Prioridad en Kommo
async function notifyRobertInKommo(leadId, clientText, clientName) {
  try {
    const token = process.env.KOMMO_TOKEN;
    const subdomain = process.env.KOMMO_SUBDOMAIN;
    const robertUserId = parseInt(process.env.KOMMO_RESPONSIBLE_ID || '15568119', 10);
    const now = Math.floor(Date.now() / 1000);

    const taskPayload = [
      {
        responsible_user_id: robertUserId,
        entity_id: parseInt(leadId, 10),
        entity_type: 'leads',
        text: `🔥 CLIENTE CALIENTE: ${clientName || 'Cliente'} quiere agendar CITA/VISITA. Mensaje: "${clientText}"`,
        complete_till: now + 1800, // En los próximos 30 minutos
        task_type_id: 1 // Llamada / Contacto
      }
    ];

    await axios.post(`https://${subdomain}.kommo.com/api/v4/tasks`, taskPayload, {
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      timeout: 5000
    });
    console.log(`[Alert] Tarea de alerta creada en Kommo para Robert (Lead #${leadId})`);
  } catch (err) {
    console.warn('[Alert Error Kommo Task]:', err.response?.data || err.message);
  }
}

// 2. Enviar alerta a WhatsApp de Robert (si está configurada la API o CallMeBot)
async function sendWhatsAppAlertToRobert(leadId, clientText, clientName) {
  const phone = process.env.ROBERTS_WHATSAPP;
  const apiKey = process.env.CALLMEBOT_API_KEY;

  if (phone && apiKey) {
    try {
      const msg = encodeURIComponent(`🚨 *¡EPA ROBERT! CLIENTE QUIERE CITA*\n\n👤 *Cliente:* ${clientName || 'Cliente'}\n💬 *Mensaje:* "${clientText}"\n🔗 *Ver Chat en Kommo:* https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/chats/`);
      const url = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${msg}&apikey=${apiKey}`;
      await axios.get(url, { timeout: 6000 });
      console.log(`[Alert] Mensaje de WhatsApp enviado al teléfono de Robert (${phone})`);
    } catch (err) {
      console.warn('[Alert Error WhatsApp]:', err.message);
    }
  }
}

// ==========================================
// 🧠 MOTOR DE CONVERSACIÓN INTELIGENTE
// ==========================================
async function generateResponse(userMessage, allProperties) {
  // Limitar longitud para evitar spam
  const cleanMessage = userMessage.substring(0, 800);
  const q = normalizeText(cleanMessage);

  const available = allProperties.filter(row => {
    const status = normalizeText(row.ESTATUS || row.Estatus || row.estatus);
    return status === 'disponible';
  });

  const greeting = `¡Hola! Gracias por comunicarte con **Tu Techo Ideal**, somos Bárbara Bravo y Robert Jiménez. ✨\n\n`;

  // WhatsApp directo de Robert para contacto inmediato
  const robertsPhone = process.env.ROBERTS_WHATSAPP || '584120000000';
  const cleanPhone = robertsPhone.replace(/\+/g, '').replace(/\s/g, '');
  const waContactLink = `https://wa.me/${cleanPhone}?text=${encodeURIComponent('Hola Robert, vi una propiedad en Tu Techo Ideal y me gustaría coordinar una visita.')}`;

  // 1. Saludos simples
  const greetingsList = ['hola', 'buenas', 'buenos dias', 'buenas tardes', 'buenas noches', 'saludos', 'hola buenas'];
  const isOnlyGreeting = greetingsList.some(g => q === g || q === `${g}!` || q === `${g}.`);
  if (isOnlyGreeting || q.length < 5) {
    return `${greeting}¿En qué podemos ayudarte hoy? ¿Estás buscando comprar, alquilar o vender algún inmueble en Caracas?`;
  }

  // 2. Cliente pide cita o visita directamente
  if (isHighIntent(q) && !q.includes('altamira') && !q.includes('mercedes')) {
    return `${greeting}¡Con muchísimo gusto te coordinamos la visita! 📅\n\nIndícanos por favor qué propiedad o zona específica te gustaría conocer y qué día u horario te resulta más cómodo.\n\n📲 Si prefieres coordinar al instante, también puedes escribirle o llamarle a nuestro asesor principal **Robert Jiménez** directamente a su WhatsApp:\n👉 ${waContactLink}`;
  }

  // Detectar operaciones
  const wantsRent = q.includes('alquiler') || q.includes('alquilar') || q.includes('renta') || q.includes('rentar');
  const wantsBuy = q.includes('venta') || q.includes('comprar') || q.includes('compra');

  // Detectar tipos
  const wantsApto = q.includes('apto') || q.includes('apartamento') || q.includes('departamento');
  const wantsCasa = q.includes('casa') || q.includes('quinta') || q.includes('townhouse');
  const wantsLocal = q.includes('local') || q.includes('comercial') || q.includes('oficina');

  // Detectar zonas
  const mentionsAltamira = q.includes('altamira');
  const mentionsMercedes = q.includes('mercedes') || q.includes('las mercedes');
  const mentionsRosal = q.includes('rosal') || q.includes('el rosal');

  function formatProperty(p) {
    let out = `📍 **${p.TIPO} en ${p.ZONA} (${p.OPERACION})**\n`;
    out += `• **Precio:** US$ ${p.PRECIO}\n`;
    out += `• **Distribución:** ${p.HABITACIONES} Habs | ${p.BANOS} Baños | ${p.ESTACIONAMIENTOS} Puestos\n`;
    if (p.DESCRIPCION_BREVE) out += `• **Detalles:** ${p.DESCRIPCION_BREVE}\n`;
    if (p.LINK_FOTOS) out += `• **Fotos:** ${p.LINK_FOTOS}\n`;
    return out;
  }

  // CASO 1: Altamira
  if (mentionsAltamira) {
    const altamiraProp = available.find(p => normalizeText(p.ZONA).includes('altamira'));
    if (altamiraProp) {
      if (wantsRent) {
        let text = `${greeting}En **Altamira** actualmente no disponemos de opciones en alquiler, pero sí tenemos disponible un excelente apartamento en **VENTA**:\n\n`;
        text += formatProperty(altamiraProp);
        
        const rentalAlt = available.find(p => normalizeText(p.OPERACION).includes('alquiler'));
        if (rentalAlt) {
          text += `\nEn **ALQUILER** en Caracas tenemos disponible:\n\n`;
          text += formatProperty(rentalAlt);
        }
        text += `\n¿Te gustaría coordinar una visita presencial para conocerlo o recibir información adicional?`;
        return text;
      } else {
        let text = `${greeting}Revisando nuestro inventario disponible, en **Altamira** tenemos una excelente opción para ti:\n\n`;
        text += formatProperty(altamiraProp);
        text += `\n¿Te gustaría coordinar una visita presencial para conocer este apartamento o que te compartamos más información?`;
        return text;
      }
    }
  }

  // CASO 2: Las Mercedes
  if (mentionsMercedes) {
    const mercedesProp = available.find(p => normalizeText(p.ZONA).includes('mercedes'));
    if (mercedesProp) {
      let text = `${greeting}En **Las Mercedes** tenemos esta excelente opción disponible:\n\n`;
      text += formatProperty(mercedesProp);
      text += `\n¿Te gustaría coordinar una visita presencial esta semana o deseas más detalles?`;
      return text;
    }
  }

  // CASO 3: Local Comercial en El Rosal
  if (wantsLocal || mentionsRosal) {
    const localProp = allProperties.find(p => normalizeText(p.TIPO).includes('local') || normalizeText(p.ZONA).includes('rosal'));
    if (localProp && normalizeText(localProp.ESTATUS) === 'vendido') {
      return `${greeting}En este momento nuestro local comercial en **El Rosal** se encuentra **Vendido**. Con mucho gusto podemos tomar tus datos para notificarte de inmediato apenas ingrese una nueva opción comercial en la zona. ¿Qué tipo de metraje o ubicación buscas?`;
    }
  }

  // CASO 4: Casa en Alquiler
  if (wantsCasa || (wantsRent && !wantsApto)) {
    const casa = available.find(p => normalizeText(p.TIPO).includes('casa'));
    if (casa) {
      let text = `${greeting}En alquiler tenemos esta magnífica opción disponible:\n\n`;
      text += formatProperty(casa);
      text += `\n¿Te gustaría coordinar una visita presencial o recibir más detalles?`;
      return text;
    }
  }

  // CASO 5: Apartamento en Venta
  if (wantsApto || (wantsBuy && !wantsCasa)) {
    const apto = available.find(p => normalizeText(p.TIPO).includes('apartamento'));
    if (apto) {
      let text = `${greeting}En venta tenemos este excelente apartamento disponible:\n\n`;
      text += formatProperty(apto);
      text += `\n¿Te gustaría agendar una visita o recibir más información detallada?`;
      return text;
    }
  }

  // CASO 6: Consulta general de Caracas
  const isBroadInquiry = q.includes('caracas') || q.includes('inmueble') || q.includes('propiedad') || q.includes('opciones');
  if (isBroadInquiry) {
    let text = `${greeting}En Caracas contamos con excelentes opciones en nuestro inventario. Actualmente tenemos disponibles:\n\n`;
    available.forEach(p => {
      text += `• **${p.TIPO} en ${p.ZONA} (${p.OPERACION}):** US$ ${p.PRECIO} | ${p.HABITACIONES} Habs\n`;
    });
    text += `\nPara asesorarte de la mejor manera, ¿en qué zona específica te gustaría, cuántas habitaciones buscas o cuál es tu presupuesto aproximado?`;
    return text;
  }

  // CASO 7: Fallback mostrando inventario
  let text = `${greeting}Actualmente en nuestro inventario disponible contamos con las siguientes opciones destacadas:\n\n`;
  available.forEach((p, idx) => {
    text += `${idx + 1}. **${p.TIPO} en ${p.ZONA} (${p.OPERACION})** - US$ ${p.PRECIO} (${p.HABITACIONES} Habs, ${p.BANOS} Baños)\n`;
  });
  text += `\nCuéntanos, ¿cuál de estas se adapta mejor a lo que estás buscando o en qué zona específica te interesaría?`;
  return text;
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
  // 🔒 CANDADO 1: Validación de Secreto (si está configurado en .env)
  if (process.env.WEBHOOK_SECRET) {
    const clientSecret = req.query.secret || req.headers['x-webhook-secret'];
    if (clientSecret !== process.env.WEBHOOK_SECRET) {
      console.warn('[Security] Intento de acceso no autorizado con secreto inválido.');
      return res.status(403).send({ error: 'Forbidden: Invalid secret token' });
    }
  }

  // Responder 200 OK inmediatamente a Kommo para evitar reintentos
  res.status(200).send({ status: 'ok' });

  try {
    const body = req.body;

    // 🔒 CANDADO 2: Validación de Cuenta Kommo (evitar suplantación)
    if (body.account && body.account.id) {
      const allowedAccountId = process.env.KOMMO_ACCOUNT_ID || '36728143';
      if (String(body.account.id) !== String(allowedAccountId)) {
        console.warn(`[Security] Petición rechazada: Account ID no coincide (${body.account.id})`);
        return;
      }
    }

    console.log('[Webhook Received]', JSON.stringify(body).substring(0, 300));

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

    // Filtrar mensajes que no sean entrantes del cliente
    if (messageObj.type && messageObj.type !== 'incoming') {
      console.log(`[Webhook] Skipping non-incoming message (type: ${messageObj.type})`);
      return;
    }

    if (messageObj.author && messageObj.author.type && messageObj.author.type !== 'external') {
      console.log(`[Webhook] Skipping non-external author (author.type: ${messageObj.author.type})`);
      return;
    }

    const msgId = messageObj.id;
    if (isDuplicate(msgId)) {
      console.log(`[Webhook] Duplicate message ID ${msgId}. Skipping.`);
      return;
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

    if (!leadId && messageObj.contact_id) {
      try {
        const contactRes = await axios.get(`https://${process.env.KOMMO_SUBDOMAIN}.kommo.com/api/v4/contacts/${messageObj.contact_id}?with=leads`, {
          headers: { Authorization: process.env.KOMMO_TOKEN },
          timeout: 5000
        });
        leadId = contactRes.data._embedded?.leads?.[0]?.id;
      } catch (err) {
        console.warn('[Webhook] Could not resolve lead from contact_id:', err.message);
      }
    }

    if (!leadId) {
      console.log('[Webhook] Could not resolve lead entity_id. Skipping.');
      return;
    }

    const clientName = messageObj.author?.name || 'Cliente';

    console.log(`\n========================================`);
    console.log(`[Processing New Message]`);
    console.log(`Lead ID: ${leadId}`);
    console.log(`Cliente: ${clientName}`);
    console.log(`Message: "${userText}"`);
    console.log(`========================================`);

    // 🚨 DETECTAR INTENCIÓN DE CITA / VISITA Y ALERTAR A ROBERT
    if (isHighIntent(userText)) {
      console.log(`[Hot Lead Alert] ¡Intención de cita detectada para Lead #${leadId}!`);
      // 1. Crear Tarea de alarma en Kommo
      notifyRobertInKommo(leadId, userText, clientName);
      // 2. Enviar WhatsApp a Robert si está configurado
      sendWhatsAppAlertToRobert(leadId, userText, clientName);
    }

    // 1. Obtener propiedades de Google Sheets
    const properties = await getAvailableProperties();

    // 2. Generar respuesta personalizada
    console.log('[Processing] Generating response...');
    const responseText = await generateResponse(userText, properties);
    console.log('[Processing] Response text:\n', responseText);

    // 3. Guardar en Kommo
    console.log('[Processing] Saving response to Kommo lead field...');
    await updateKommoLead(leadId, responseText);

    // 4. Disparar Salesbot
    console.log('[Processing] Triggering Salesbot delivery...');
    await triggerKommoSalesbot(leadId);

    console.log(`[Success] Message processed and delivered for Lead #${leadId}!\n`);

  } catch (err) {
    console.error('[Webhook Processing Error]:', err.response?.data || err.message);
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.send({ status: 'running', service: 'Tu Techo Ideal Bot Microservice - Secure Edition' });
});

// Start Server
app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`  Tu Techo Ideal - Secure Microservice`);
  console.log(`  Running on port ${PORT}`);
  console.log(`  Health Check: http://localhost:${PORT}/health`);
  console.log(`=======================================================`);
});
