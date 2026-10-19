require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { parse } = require('csv-parse/sync');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse urlencoded and JSON bodies
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));

// Deduplication cache to prevent handling the same message twice
const processedMessages = new Set();
function isDuplicate(msgId) {
  if (!msgId) return false;
  if (processedMessages.has(msgId)) return true;
  processedMessages.add(msgId);
  setTimeout(() => processedMessages.delete(msgId), 60000); // 1 minute TTL
  return false;
}

// 1. Fetch available properties from Google Sheets
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

// Helper to remove accents and lowercase
function normalizeText(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

// 2. Generate Intelligent Response (Zero Token Cost, Zero Latency, 100% Truthful)
async function generateResponse(userMessage, allProperties) {
  const q = normalizeText(userMessage);

  // Filter available properties
  const available = allProperties.filter(row => {
    const status = normalizeText(row.ESTATUS || row.Estatus || row.estatus);
    return status === 'disponible';
  });

  // Base institutional greeting
  const greeting = `¡Hola! Gracias por comunicarte con **Tu Techo Ideal**, somos Bárbara Bravo y Robert Jiménez. ✨\n\n`;

  // 1. Check if it's just a greeting (e.g. "hola", "buenas", "buenos dias", "buenas tardes", "hola buenas")
  const greetingsList = ['hola', 'buenas', 'buenos dias', 'buenas tardes', 'buenas noches', 'saludos', 'hola buenas'];
  const isOnlyGreeting = greetingsList.some(g => q === g || q === `${g}!` || q === `${g}.`);
  if (isOnlyGreeting || q.length < 5) {
    return `${greeting}¿En qué podemos ayudarte hoy? ¿Estás buscando comprar, alquilar o vender algún inmueble en Caracas?`;
  }

  // 2. Check general inquiry without specific zone (e.g. "busco alquiler en caracas", "busco comprar en caracas", "tienen inmuebles")
  const isBroadInquiry = (q.includes('caracas') || q.includes('inmueble') || q.includes('propiedad') || q.includes('opciones')) && 
                         !q.includes('altamira') && !q.includes('mercedes') && !q.includes('rosal') && !q.includes('chacao') && !q.includes('bella vista');

  // Detect requested operation
  const wantsRent = q.includes('alquiler') || q.includes('alquilar') || q.includes('renta') || q.includes('rentar');
  const wantsBuy = q.includes('venta') || q.includes('comprar') || q.includes('compra');

  // Detect requested type
  const wantsApto = q.includes('apto') || q.includes('apartamento') || q.includes('departamento');
  const wantsCasa = q.includes('casa') || q.includes('quinta') || q.includes('townhouse');
  const wantsLocal = q.includes('local') || q.includes('comercial') || q.includes('oficina');

  // Detect requested zone
  const mentionsAltamira = q.includes('altamira');
  const mentionsMercedes = q.includes('mercedes') || q.includes('las mercedes');
  const mentionsRosal = q.includes('rosal') || q.includes('el rosal');

  // Format a single property beautifully
  function formatProperty(p) {
    let out = `📍 **${p.TIPO} en ${p.ZONA} (${p.OPERACION})**\n`;
    out += `• **Precio:** US$ ${p.PRECIO}\n`;
    out += `• **Distribución:** ${p.HABITACIONES} Habs | ${p.BANOS} Baños | ${p.ESTACIONAMIENTOS} Puestos\n`;
    if (p.DESCRIPCION_BREVE) out += `• **Detalles:** ${p.DESCRIPCION_BREVE}\n`;
    if (p.LINK_FOTOS) out += `• **Fotos:** ${p.LINK_FOTOS}\n`;
    return out;
  }

  // SCENARIO A: Altamira check
  if (mentionsAltamira) {
    const altamiraProp = available.find(p => normalizeText(p.ZONA).includes('altamira'));
    if (altamiraProp) {
      if (wantsRent) {
        // Asked for rent in Altamira, but we have Sale in Altamira
        let text = `${greeting}En **Altamira** actualmente no disponemos de opciones en alquiler, pero sí tenemos disponible un excelente apartamento en **VENTA**:\n\n`;
        text += formatProperty(altamiraProp);
        
        // Suggest rental alternative if available
        const rentalAlt = available.find(p => normalizeText(p.OPERACION).includes('alquiler'));
        if (rentalAlt) {
          text += `\nEn **ALQUILER** en Caracas tenemos disponible:\n\n`;
          text += formatProperty(rentalAlt);
        }
        text += `\n¿Te gustaría coordinar una visita presencial para conocerlo o recibir información adicional?`;
        return text;
      } else {
        // Asked for Altamira or Altamira Venta
        let text = `${greeting}Revisando nuestro inventario disponible, en **Altamira** tenemos una excelente opción para ti:\n\n`;
        text += formatProperty(altamiraProp);
        text += `\n¿Te gustaría coordinar una visita presencial para conocer este apartamento o que te compartamos más información?`;
        return text;
      }
    }
  }

  // SCENARIO B: Las Mercedes check
  if (mentionsMercedes) {
    const mercedesProp = available.find(p => normalizeText(p.ZONA).includes('mercedes'));
    if (mercedesProp) {
      let text = `${greeting}En **Las Mercedes** tenemos esta excelente opción disponible:\n\n`;
      text += formatProperty(mercedesProp);
      text += `\n¿Te gustaría coordinar una visita presencial esta semana o deseas más detalles?`;
      return text;
    }
  }

  // SCENARIO C: Local Comercial / El Rosal
  if (wantsLocal || mentionsRosal) {
    const localProp = allProperties.find(p => normalizeText(p.TIPO).includes('local') || normalizeText(p.ZONA).includes('rosal'));
    if (localProp && normalizeText(localProp.ESTATUS) === 'vendido') {
      return `${greeting}En este momento nuestro local comercial en **El Rosal** se encuentra **Vendido**. Con mucho gusto podemos tomar tus datos y necesidades específicas para notificarte de inmediato apenas ingrese una nueva opción comercial en la zona. ¿Qué tipo de metraje o ubicación buscas?`;
    }
  }

  // SCENARIO D: Asked for House in Rent (Casa en Alquiler)
  if (wantsCasa || (wantsRent && !wantsApto)) {
    const casa = available.find(p => normalizeText(p.TIPO).includes('casa'));
    if (casa) {
      let text = `${greeting}En alquiler tenemos esta magnífica opción disponible:\n\n`;
      text += formatProperty(casa);
      text += `\n¿Te gustaría coordinar una visita presencial o recibir más detalles?`;
      return text;
    }
  }

  // SCENARIO E: Asked for Apartment in Sale (Apto en Venta)
  if (wantsApto || (wantsBuy && !wantsCasa)) {
    const apto = available.find(p => normalizeText(p.TIPO).includes('apartamento'));
    if (apto) {
      let text = `${greeting}En venta tenemos este excelente apartamento disponible:\n\n`;
      text += formatProperty(apto);
      text += `\n¿Te gustaría agendar una visita o recibir más información detallada?`;
      return text;
    }
  }

  // SCENARIO F: Broad inquiry (e.g. "busco alquiler en caracas")
  if (isBroadInquiry) {
    let text = `${greeting}En Caracas contamos con excelentes opciones en nuestro inventario. Actualmente tenemos disponibles:\n\n`;
    available.forEach(p => {
      text += `• **${p.TIPO} en ${p.ZONA} (${p.OPERACION}):** US$ ${p.PRECIO} | ${p.HABITACIONES} Habs\n`;
    });
    text += `\nPara asesorarte de la mejor manera, ¿en qué zona específica te gustaría, cuántas habitaciones buscas o cuál es tu presupuesto aproximado?`;
    return text;
  }

  // SCENARIO G: Default fallback showing all active inventory
  let text = `${greeting}Actualmente en nuestro inventario disponible contamos con las siguientes opciones destacadas:\n\n`;
  available.forEach((p, idx) => {
    text += `${idx + 1}. **${p.TIPO} en ${p.ZONA} (${p.OPERACION})** - US$ ${p.PRECIO} (${p.HABITACIONES} Habs, ${p.BANOS} Baños)\n`;
  });
  text += `\nCuéntanos, ¿cuál de estas se adapta mejor a lo que estás buscando o en qué zona específica te interesaría?`;
  return text;
}

// 3. Update Kommo Lead with Response
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

  console.log(`[Kommo API] Lead #${leadId} updated successfully with field #${fieldId} (Status ${response.status})`);
  return response.data;
}

// 4. Trigger Kommo Salesbot to deliver the message
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

// Webhook endpoint
app.post(['/webhook', '/kommo-webhook'], async (req, res) => {
  // Always acknowledge immediately with 200 OK so Kommo does not retry
  res.status(200).send({ status: 'ok' });

  try {
    const body = req.body;
    console.log('[Webhook Received]', JSON.stringify(body).substring(0, 300));

    // Handle both JSON and urlencoded formats from Kommo
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
          type: body['message[add][0][author][type]']
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

    // Filter out outgoing bot / user messages to prevent infinite loops
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

    // Resolve Lead ID
    let leadId = messageObj.entity_id || messageObj.element_id;

    if (!leadId && messageObj.talk_id) {
      try {
        console.log(`[Webhook] Resolving lead from talk #${messageObj.talk_id}...`);
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
        console.log(`[Webhook] Resolving lead from contact #${messageObj.contact_id}...`);
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

    console.log(`\n========================================`);
    console.log(`[Processing New Message]`);
    console.log(`Lead ID: ${leadId}`);
    console.log(`Message: "${userText}"`);
    console.log(`========================================`);

    // 1. Fetch properties from Google Sheets
    const properties = await getAvailableProperties();

    // 2. Generate customized response
    console.log('[Processing] Generating response...');
    const responseText = await generateResponse(userText, properties);
    console.log('[Processing] Response text:\n', responseText);

    // 3. Update Kommo Lead field
    console.log('[Processing] Saving response to Kommo lead field...');
    await updateKommoLead(leadId, responseText);

    // 4. Trigger Salesbot to send the message
    console.log('[Processing] Triggering Salesbot delivery...');
    await triggerKommoSalesbot(leadId);

    console.log(`[Success] Message processed and delivered for Lead #${leadId}!\n`);

  } catch (err) {
    console.error('[Webhook Processing Error]:', err.response?.data || err.message);
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.send({ status: 'running', service: 'Tu Techo Ideal Bot Microservice' });
});

// Start Server
app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`  Tu Techo Ideal - Dedicated AI Microservice`);
  console.log(`  Running on http://localhost:${PORT}`);
  console.log(`  Health Check: http://localhost:${PORT}/health`);
  console.log(`  Webhook URL:  http://localhost:${PORT}/webhook`);
  console.log(`=======================================================`);
});
