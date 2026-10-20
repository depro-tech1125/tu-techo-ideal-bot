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

// Deduplicación y Debounce por Lead para evitar envíos dobles
const processedMessages = new Set();
const leadLastProcessed = new Map();

function isDuplicate(msgId) {
  if (!msgId) return false;
  if (processedMessages.has(msgId)) return true;
  processedMessages.add(msgId);
  setTimeout(() => processedMessages.delete(msgId), 60000);
  return false;
}

function isDebounced(leadId) {
  const now = Date.now();
  const last = leadLastProcessed.get(leadId);
  if (last && (now - last) < 5000) { // 5 segundos de protección anti-doble envío
    return true;
  }
  leadLastProcessed.set(leadId, now);
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
// 🚨 ALERTAS EN KOMMO PARA ROBERT
// ==========================================
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
        complete_till: now + 1800,
        task_type_id: 1
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
    const formattedInventory = availableProperties.map((p, i) => {
      const cleanPrice = (p.PRECIO || '').replace('$', '').trim();
      return `${i + 1}. [${p.ID_PROPIEDAD || 'PROP'}] ${p.TIPO} en ${p.ZONA} | Operación: ${p.OPERACION} | Precio: US$ ${cleanPrice} | Habs: ${p.HABITACIONES} | Baños: ${p.BANOS} | Puestos: ${p.ESTACIONAMIENTOS} | Detalles: ${p.DESCRIPCION_BREVE || 'N/A'} | Fotos: ${p.LINK_FOTOS || 'No link'}`;
    }).join('\n');

    const systemPrompt = `Eres el asistente inmobiliario virtual de "Tu Techo Ideal", atendiendo en nombre de Bárbara Bravo y Robert Jiménez.
Tu objetivo es responder de forma amable, profesional, concisa y persuasiva para agendar visitas presenciales.

REGLAS CRÍTICAS E INVIOLABLES:
1. Comienza siempre tus respuestas iniciales con el saludo oficial exacto:
"¡Hola! Gracias por comunicarte con, Tu Techo Ideal, somos Bárbara Bravo y Robert Jiménez. ✨"
2. SI EL CLIENTE PIDE CASAS EN VENTA: Solo ofrece propiedades cuya "Operación" sea estrictamente "Venta". NUNCA ofrezcas un alquiler si el cliente pidió comprar o venta.
3. SI EL CLIENTE PIDE ALQUILER: Solo ofrece propiedades cuya "Operación" sea "Alquiler".
4. INVENTARIO REAL EN TIEMPO REAL:
${formattedInventory}
5. Nunca inventes propiedades, precios, características ni ubicaciones que no estén en la lista anterior.
6. Presenta los precios en formato "US$ [monto]". Si hay link de fotos disponible, inclúyelo para que el cliente pueda verlas.
7. Al final invita siempre a coordinar una visita presencial con Bárbara o Robert Jiménez para conocer el inmueble.`;

    const model = process.env.CLAUDE_MODEL || 'anthropic/claude-sonnet-4.5';

    const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.3,
      max_tokens: 600
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://tu-techo-ideal-bot-1.onrender.com',
        'X-Title': 'Tu Techo Ideal Bot',
        'Content-Type': 'application/json'
      },
      timeout: 12000
    });

    const aiMessage = response.data?.choices?.[0]?.message?.content?.trim();
    if (aiMessage) {
      console.log(`[Claude via OpenRouter] Response generated successfully (${aiMessage.length} chars)`);
      return aiMessage;
    }
    return null;
  } catch (err) {
    console.warn('[Claude/OpenRouter Error]:', err.response?.data || err.message);
    return null; // Fallback al motor determinístico
  }
}

async function generateResponse(userMessage, allProperties) {
  const cleanMessage = userMessage.substring(0, 800);
  const q = normalizeText(cleanMessage);

  // Filtramos solo las disponibles
  const available = allProperties.filter(row => {
    const status = normalizeText(row.ESTATUS || row.Estatus || row.estatus);
    return status === 'disponible';
  });

  // Si Claude está configurado y no está explícitamente apagado, usamos Claude AI
  const isClaudeEnabled = process.env.USE_CLAUDE !== 'false';
  if (isClaudeEnabled) {
    const claudeResult = await generateClaudeResponse(userMessage, available);
    if (claudeResult) {
      return claudeResult;
    }
    console.log('[Fallback] Claude no respondió o dio error, usando motor determinístico de respaldo.');
  }

  // Saludo oficial corregido exactamente según instrucciones del usuario
  const baseGreeting = `¡Hola! Gracias por comunicarte con, Tu Techo Ideal, somos Bárbara Bravo y Robert Jiménez. ✨\n\n`;

  // 1. Saludos simples
  const greetingsList = ['hola', 'buenas', 'buenos dias', 'buenas tardes', 'buenas noches', 'saludos', 'hola buenas'];
  const isOnlyGreeting = greetingsList.some(g => q === g || q === `${g}!` || q === `${g}.`);
  if (isOnlyGreeting || q.length < 5) {
    return `${baseGreeting}¿En qué podemos ayudarte hoy? ¿Estás buscando comprar, alquilar o vender algún inmueble?`;
  }

  // 2. Cliente pide cita o visita directamente
  if (isHighIntent(q) && !q.includes('casa') && !q.includes('apto') && !q.includes('venta') && !q.includes('alquiler')) {
    return `${baseGreeting}¡Con muchísimo gusto te coordinamos una visita presencial! 📅\n\nIndícanos por favor qué propiedad te gustaría conocer y qué día u horario te resulta más conveniente para agendarlo de inmediato.`;
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
  const mentionsAltamira = q.includes('altamira');
  const mentionsMercedes = q.includes('mercedes');

  // Filtrado estricto por Operación si fue solicitada
  let filtered = available;

  if (wantsBuy) {
    filtered = filtered.filter(p => normalizeText(p.OPERACION).includes('venta'));
  } else if (wantsRent) {
    filtered = filtered.filter(p => normalizeText(p.OPERACION).includes('alquiler'));
  }

  // Filtrado por Tipo de Inmueble
  if (wantsCasa) {
    // Si busca casa comercial específicamente
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
    const zoneFiltered = filtered.filter(p => normalizeText(p.ZONA).includes('macaracuay'));
    if (zoneFiltered.length > 0) filtered = zoneFiltered;
  } else if (mentionsFlorida) {
    const zoneFiltered = filtered.filter(p => normalizeText(p.ZONA).includes('florida'));
    if (zoneFiltered.length > 0) filtered = zoneFiltered;
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
    return text;
  }

  // Si pidió una combinación que NO existe disponible (ejemplo: Casas en Venta si no hubiera, o Apartamentos en Venta)
  if (wantsBuy) {
    const availableSales = available.filter(p => normalizeText(p.OPERACION).includes('venta'));
    if (availableSales.length > 0) {
      let text = `${baseGreeting}Actualmente para la búsqueda exacta que solicitas no disponemos de opciones inmediatas. Sin embargo, en **VENTA** tenemos disponible esta excelente propiedad:\n\n`;
      text += formatSingleProperty(availableSales[0]) + '\n';
      text += `¿Te gustaría recibir detalles o agendar una visita para conocerla?`;
      return text;
    }
  }

  if (wantsRent) {
    const availableRentals = available.filter(p => normalizeText(p.OPERACION).includes('alquiler'));
    if (availableRentals.length > 0) {
      let text = `${baseGreeting}Actualmente en esa categoría específica no disponemos de opciones inmediatas. En **ALQUILER** tenemos disponibles estas magníficas opciones:\n\n`;
      availableRentals.slice(0, 2).forEach(p => {
        text += formatSingleProperty(p) + '\n';
      });
      text += `¿Te gustaría recibir más información o coordinar una visita presencial?`;
      return text;
    }
  }

  // Si es una pregunta general ("qué tienen", "busco opciones")
  let text = `${baseGreeting}En nuestro inventario actualmente contamos con las siguientes opciones disponibles:\n\n`;
  available.forEach((p, idx) => {
    const cleanPrice = (p.PRECIO || '').replace('$', '').trim();
    text += `${idx + 1}. **${p.TIPO} en ${p.ZONA} (${p.OPERACION})** - US$ ${cleanPrice}\n`;
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

    // 🛑 FILTRO 4: Deduplicación por Message ID
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

    // 🛑 FILTRO 5: Debounce de 5 segundos por Lead para evitar doble envío
    if (isDebounced(leadId)) {
      console.log(`[Webhook] Debounce activado para Lead #${leadId}. Skipping para evitar doble respuesta.`);
      return;
    }

    const clientName = messageObj.author?.name || 'Cliente';

    console.log(`\n========================================`);
    console.log(`[Processing New Message]`);
    console.log(`Lead ID: ${leadId}`);
    console.log(`Cliente: ${clientName}`);
    console.log(`Message: "${userText}"`);
    console.log(`========================================`);

    // Alerta de cita para Robert
    if (isHighIntent(userText)) {
      console.log(`[Hot Lead Alert] Intención de cita detectada para Lead #${leadId}!`);
      notifyRobertInKommo(leadId, userText, clientName);
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
  res.send({
    status: 'running',
    service: 'Tu Techo Ideal Bot Microservice - v3.0 Claude AI Edition',
    claude_enabled: process.env.USE_CLAUDE !== 'false',
    claude_model: process.env.CLAUDE_MODEL || 'anthropic/claude-sonnet-4.5',
    uptime_seconds: Math.floor(process.uptime())
  });
});

app.listen(PORT, () => {
  console.log(`Tu Techo Ideal Bot running on port ${PORT}`);
});
