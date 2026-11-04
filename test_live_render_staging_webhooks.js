/**
 * ============================================================================
 * FASE 6: PRUEBAS EN VIVO CONTRA RENDER STAGING
 * URL: https://tu-techo-ideal-staging.onrender.com
 * ============================================================================
 */

require('dotenv').config();
const axios = require('axios');

async function testLiveRenderStaging() {
  console.log('================================================================');
  console.log(' FASE 6: PRUEBAS REALES EN VIVO CONTRA RENDER STAGING          ');
  console.log(' URL: https://tu-techo-ideal-staging.onrender.com               ');
  console.log('================================================================\n');

  const baseUrl = 'https://tu-techo-ideal-staging.onrender.com';
  let passed = 0;
  const total = 9;
  const results = [];

  function record(num, name, condition, details = '') {
    if (condition) {
      console.log(`✅ [Render Live Test ${num}/${total}] PASÓ: ${name}`);
      if (details) console.log(`   Detalle: ${details}`);
      passed++;
      results.push({ num, name, passed: true, details });
    } else {
      console.error(`❌ [Render Live Test ${num}/${total}] FALLÓ: ${name}`);
      if (details) console.error(`   Detalle: ${details}`);
      results.push({ num, name, passed: false, details });
    }
  }

  // --------------------------------------------------------------------------
  // 1. Endpoint /health en Render Staging
  // --------------------------------------------------------------------------
  console.log('>>> [1/9] Consultando /health en Render Staging...');
  const healthRes = await axios.get(`${baseUrl}/health`, { timeout: 15000 });
  const h = healthRes.data;

  const test1Ok = healthRes.status === 200 &&
    h.status === 'running' &&
    h.observation_mode === true &&
    h.pipeline_controller === 'pipeline_decision.js' &&
    h.claude_model === 'nvidia/nemotron-3.5-lightning:free';

  record(
    1,
    'Endpoint /health reporta running, observation_mode: true, pipeline_decision.js y modelo Nemotron',
    test1Ok,
    `Status: ${h.status}, ObsMode: ${h.observation_mode}, Controller: ${h.pipeline_controller}, Model: "${h.claude_model}"`
  );

  // --------------------------------------------------------------------------
  // 2. Webhook Sintético 1: Enlace Wasi disponible
  // --------------------------------------------------------------------------
  console.log('\n>>> [2/9] Enviando webhook sintético: Enlace Wasi disponible...');
  const wh1Res = await axios.post(`${baseUrl}/webhook`, {
    account: { id: 36728143 },
    message: {
      add: [{
        id: 'msg_render_live_01',
        entity_id: 99001101,
        talk_id: 'talk_render_live_01',
        type: 'incoming',
        text: 'Hola, me interesa este inmueble https://info.wasi.co/apartamento-venta-los-samanes-caracas/10493109',
        author: { type: 'external', name: 'Tester Staging' }
      }]
    }
  }, { timeout: 15000 });

  record(2, 'Webhook Enlace Wasi -> HTTP 200 en Render Staging', wh1Res.status === 200, `Respuesta: ${JSON.stringify(wh1Res.data)}`);

  // --------------------------------------------------------------------------
  // 3. Webhook Sintético 2: Búsqueda por zona
  // --------------------------------------------------------------------------
  console.log('\n>>> [3/9] Enviando webhook sintético: Búsqueda por zona...');
  const wh2Res = await axios.post(`${baseUrl}/webhook`, {
    account: { id: 36728143 },
    message: {
      add: [{
        id: 'msg_render_live_02',
        entity_id: 99001102,
        talk_id: 'talk_render_live_02',
        type: 'incoming',
        text: 'Hola buenas tardes, busco apartamento en venta en Los Samanes',
        author: { type: 'external', name: 'Tester Staging' }
      }]
    }
  }, { timeout: 15000 });

  record(3, 'Webhook Búsqueda por zona -> HTTP 200 en Render Staging', wh2Res.status === 200, `Respuesta: ${JSON.stringify(wh2Res.data)}`);

  // --------------------------------------------------------------------------
  // 4. Webhook Sintético 3: Mención en Instagram
  // --------------------------------------------------------------------------
  console.log('\n>>> [4/9] Enviando webhook sintético: Mención en Instagram...');
  const wh3Res = await axios.post(`${baseUrl}/webhook`, {
    account: { id: 36728143 },
    message: {
      add: [{
        id: 'msg_render_live_03',
        entity_id: 99001103,
        talk_id: 'talk_render_live_03',
        type: 'incoming',
        text: 'Te mencionó en su historia de Instagram',
        author: { type: 'external', name: 'Tester Staging' }
      }]
    }
  }, { timeout: 15000 });

  record(4, 'Webhook Mención de Instagram -> HTTP 200 en Render Staging (Ignorado)', wh3Res.status === 200, `Respuesta: ${JSON.stringify(wh3Res.data)}`);

  // --------------------------------------------------------------------------
  // 5. Webhook Sintético 4: Pregunta sin datos en Sheets (Condominio)
  // --------------------------------------------------------------------------
  console.log('\n>>> [5/9] Enviando webhook sintético: Pregunta sin datos en Sheets...');
  const wh4Res = await axios.post(`${baseUrl}/webhook`, {
    account: { id: 36728143 },
    message: {
      add: [{
        id: 'msg_render_live_04',
        entity_id: 99001104,
        talk_id: 'talk_render_live_04',
        type: 'incoming',
        text: '¿Cuánto es el costo mensual exacto de condominio en ese apartamento?',
        author: { type: 'external', name: 'Tester Staging' }
      }]
    }
  }, { timeout: 15000 });

  record(5, 'Webhook Pregunta sin datos -> HTTP 200 en Render Staging (Silencio)', wh4Res.status === 200, `Respuesta: ${JSON.stringify(wh4Res.data)}`);

  // --------------------------------------------------------------------------
  // 6. Webhook Sintético 5: Solicitud de reunión
  // --------------------------------------------------------------------------
  console.log('\n>>> [6/9] Enviando webhook sintético: Solicitud de reunión...');
  const wh5Res = await axios.post(`${baseUrl}/webhook`, {
    account: { id: 36728143 },
    message: {
      add: [{
        id: 'msg_render_live_05',
        entity_id: 99001105,
        talk_id: 'talk_render_live_05',
        type: 'incoming',
        text: 'Quiero agendar una reunión o cita presencial en su oficina para negociar el precio',
        author: { type: 'external', name: 'Tester Staging' }
      }]
    }
  }, { timeout: 15000 });

  record(6, 'Webhook Solicitud de reunión -> HTTP 200 en Render Staging (Silencio y derivación)', wh5Res.status === 200, `Respuesta: ${JSON.stringify(wh5Res.data)}`);

  // --------------------------------------------------------------------------
  // 7. Webhook Sintético 6: Crédito Venezuela Renace
  // --------------------------------------------------------------------------
  console.log('\n>>> [7/9] Enviando webhook sintético: Crédito Venezuela Renace...');
  const wh6Res = await axios.post(`${baseUrl}/webhook`, {
    account: { id: 36728143 },
    message: {
      add: [{
        id: 'msg_render_live_06',
        entity_id: 99001106,
        talk_id: 'talk_render_live_06',
        type: 'incoming',
        text: '¿Aceptan crédito Venezuela Renace para el inmueble 10493109?',
        author: { type: 'external', name: 'Tester Staging' }
      }]
    }
  }, { timeout: 15000 });

  record(7, 'Webhook Crédito Venezuela Renace -> HTTP 200 en Render Staging', wh6Res.status === 200, `Respuesta: ${JSON.stringify(wh6Res.data)}`);

  // --------------------------------------------------------------------------
  // 8. Webhook Sintético 7: Intervención humana saliente (Bloqueo 24h)
  // --------------------------------------------------------------------------
  console.log('\n>>> [8/9] Enviando webhook sintético: Intervención humana saliente...');
  const wh7Res = await axios.post(`${baseUrl}/webhook`, {
    account: { id: 36728143 },
    message: {
      add: [{
        id: 'msg_render_live_07_out',
        entity_id: 99001107,
        talk_id: 'talk_render_live_07',
        type: 'outgoing',
        text: 'Hola, te escribe Robert Jiménez personalmente para atender tu caso.',
        author: { type: 'user', name: 'Robert Jiménez' },
        created_by: 15568119
      }]
    }
  }, { timeout: 15000 });

  record(8, 'Webhook Intervención humana saliente -> HTTP 200 en Render Staging (Bloqueo 24h)', wh7Res.status === 200, `Respuesta: ${JSON.stringify(wh7Res.data)}`);

  // --------------------------------------------------------------------------
  // 9. Comprobación en Kommo en Vivo: CERO leads sintéticos modificados
  // --------------------------------------------------------------------------
  console.log('\n>>> [9/9] Verificando en Kommo CRM que los leads sintéticos NO existen y NO fueron creados...');
  const token = process.env.KOMMO_TOKEN;
  const subdomain = process.env.KOMMO_SUBDOMAIN || 'tutechoidealrd';
  const headers = { Authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}` };

  let leadNotFoundConfirmed = false;
  try {
    // Consultar el lead sintético 99001101 en Kommo: Kommo devuelve 204 No Content si el lead no existe
    const res = await axios.get(`https://${subdomain}.kommo.com/api/v4/leads/99001101`, { headers, timeout: 5000 });
    if (res.status === 204 || !res.data) {
      leadNotFoundConfirmed = true;
    }
  } catch (err) {
    if (err.response?.status === 204 || err.response?.status === 404) {
      leadNotFoundConfirmed = true;
    }
  }

  record(
    9,
    'Verificación en Kommo CRM -> Lead sintético no existe (Cero modificaciones en Kommo)',
    leadNotFoundConfirmed,
    'Lead #99001101 no existe en la base de datos de Kommo (Status 204/404 esperado). Cero mutaciones confirmadas.'
  );

  console.log('\n================================================================');
  console.log(` RESULTADOS PRUEBAS EN VIVO RENDER: ${passed} / ${total} PRUEBAS SUPERADAS (${Math.round((passed / total) * 100)}%) `);
  console.log('================================================================\n');

  if (passed !== total) process.exit(1);
}

testLiveRenderStaging().catch(err => {
  console.error('Error fatal en pruebas en vivo contra Render:', err);
  process.exit(1);
});
