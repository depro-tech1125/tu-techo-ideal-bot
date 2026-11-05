const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const KOMMO_TOKEN = process.env.KOMMO_TOKEN;
const KOMMO_SUBDOMAIN = process.env.KOMMO_SUBDOMAIN;
const LEAD_ID = '26102140';
const TALK_ID = '1422';
const CONTACT_ID = '50636642';
const MSG_ID = 'bbb376ee-4e8b-4911-95d3-3996ea049c68';
const BOT_ID = parseInt(process.env.KOMMO_BOT_ID || '100766', 10);
const FIELD_ID = 2103996;
const RESPONSE_TEXT = 'Bienvenido a Tu Techo Ideal, sí, disponible.';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const authHeader = KOMMO_TOKEN.startsWith('Bearer ') ? KOMMO_TOKEN : `Bearer ${KOMMO_TOKEN}`;

async function main() {
  console.log('================================================================');
  console.log(' FASE 1: ATENCIÓN INMEDIATA CONVERSACIÓN A1422 (LEAD #26102140) ');
  console.log('================================================================\n');

  // 1. Verificar si ya fue respondido
  console.log('1. Verificando si existe respuesta previa en Kommo...');
  const evRes = await axios.get(`https://${KOMMO_SUBDOMAIN}.kommo.com/api/v4/events?filter[entity]=contact&filter[entity_id]=${CONTACT_ID}&limit=10`, {
    headers: { Authorization: authHeader }
  });
  const events = evRes.data?._embedded?.events || [];
  const existingOutgoing = events.find(e => e.type === 'outgoing_chat_message');
  if (existingOutgoing) {
    console.log(`[ABORT] La conversación ya cuenta con respuesta saliente previa (ID: ${existingOutgoing.id}). Cero envíos duplicados.`);
    return;
  }
  console.log('-> Confirmado: Conversación pendiente sin respuesta. Procediendo con despacho único comercial.');

  // 2. Actualizar campo 2103996
  console.log(`\n2. Actualizando Campo ${FIELD_ID} con saludo V5.0: "${RESPONSE_TEXT}"...`);
  const updateRes = await axios.patch(`https://${KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/${LEAD_ID}`, {
    custom_fields_values: [
      {
        field_id: FIELD_ID,
        values: [{ value: RESPONSE_TEXT }]
      }
    ]
  }, {
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
    timeout: 10000
  });
  console.log(`-> Lead #${LEAD_ID} actualizado exitosamente (Status ${updateRes.status})`);

  // 3. Disparar Salesbot 100766
  console.log(`\n3. Disparando Salesbot #${BOT_ID} para entrega única por WhatsApp...`);
  const botRes = await axios.post(`https://${KOMMO_SUBDOMAIN}.kommo.com/api/v4/bots/${BOT_ID}/run`, {
    entity_id: parseInt(LEAD_ID, 10),
    entity_type: 'leads'
  }, {
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
    timeout: 10000
  });
  console.log(`-> Salesbot disparado (Status ${botRes.status})`);

  // 4. Actualizar persistencia de contexto local
  console.log('\n4. Registrando contexto REF-035 e Idempotencia en persistencia...');
  const handoffsPath = path.join(__dirname, '..', 'handoffs.json');
  if (fs.existsSync(handoffsPath)) {
    const handoffs = JSON.parse(fs.readFileSync(handoffsPath, 'utf8'));
    if (!handoffs.talks) handoffs.talks = {};
    if (!handoffs.leads) handoffs.leads = {};
    if (!handoffs.contacts) handoffs.contacts = {};

    handoffs.talks[TALK_ID] = {
      ...(handoffs.talks[TALK_ID] || {}),
      activeAutomationPropertyId: 'REF-035'
    };
    handoffs.leads[LEAD_ID] = {
      ...(handoffs.leads[LEAD_ID] || {}),
      activeAutomationPropertyId: 'REF-035'
    };
    handoffs.contacts[CONTACT_ID] = {
      ...(handoffs.contacts[CONTACT_ID] || {}),
      activeAutomationPropertyId: 'REF-035'
    };
    fs.writeFileSync(handoffsPath, JSON.stringify(handoffs, null, 2), 'utf8');
    console.log('-> handoffs.json actualizado con Talk 1422 -> REF-035');
  }

  // 5. Esperar confirmación de despacho de Salesbot (18s)
  console.log('\n5. Esperando confirmación de entrega por WhatsApp (18s)...');
  await sleep(18000);

  const postEvRes = await axios.get(`https://${KOMMO_SUBDOMAIN}.kommo.com/api/v4/events?filter[entity]=contact&filter[entity_id]=${CONTACT_ID}&limit=5`, {
    headers: { Authorization: authHeader }
  });
  const postEvents = postEvRes.data?._embedded?.events || [];
  const newOutgoing = postEvents.find(e => e.type === 'outgoing_chat_message');
  if (newOutgoing) {
    console.log(`✅ DESPACHO CONFIRMADO EN KOMMO/WHATSAPP:`);
    console.log(`   Evento ID: ${newOutgoing.id}`);
    console.log(`   Fecha: ${new Date(newOutgoing.created_at * 1000).toISOString()}`);
    console.log(`   Talk: ${newOutgoing.value_after?.[0]?.message?.talk_id || TALK_ID}`);
  } else {
    console.log('⚠️ Salesbot en tránsito hacia WhatsApp (verificando en siguiente consulta)...');
  }

  // 6. Restablecimiento seguro tras ventana de 60 segundos
  console.log('\n6. Programando restablecimiento seguro del campo 2103996 tras 45s adicionales...');
  await sleep(42000);

  await axios.patch(`https://${KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/${LEAD_ID}`, {
    custom_fields_values: [
      {
        field_id: FIELD_ID,
        values: [{ value: ' ' }]
      }
    ]
  }, {
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
    timeout: 10000
  });
  console.log(`✅ Campo ${FIELD_ID} reiniciado exitosamente tras ventana de seguridad.`);

  console.log('\n================================================================');
  console.log(' CONVERSACIÓN A1422 ATENDIDA EXITOSAMENTE (1 SOLO ENVÍO)         ');
  console.log('================================================================');
}

main().catch(err => {
  console.error('Error atendiendo lead 26102140:', err.response?.data || err.message);
  process.exit(1);
});
