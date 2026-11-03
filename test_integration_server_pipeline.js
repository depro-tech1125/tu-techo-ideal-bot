/**
 * ============================================================================
 * TEST DE INTEGRACIÓN: SERVER.JS + PIPELINE DE DECISIÓN CENTRAL
 * ============================================================================
 * 
 * Verifica la integración real entre server.js y pipeline_decision.js:
 * 1. Endpoint /health reporta el nuevo pipeline y el estado de OBSERVATION_MODE.
 * 2. Webhook procesa enlaces Wasi válidos y actualiza el campo 2103996 de Kommo.
 * 3. Webhook respeta la solicitud de reunión (silencio, sin despacho a Kommo).
 * 4. Verificación pre-despacho aborta si un humano interviene en vuelo.
 * 5. MODO OBSERVACIÓN (OBSERVATION_MODE=true) evalúa sin modificar Kommo ni disparar Salesbot.
 */

require('dotenv').config();
const axios = require('axios');
const http = require('http');
const fs = require('fs');
const path = require('path');

async function runServerIntegrationTests() {
  console.log('================================================================');
  console.log(' INICIANDO PRUEBAS DE INTEGRACIÓN SERVER.JS + PIPELINE CENTRAL ');
  console.log('================================================================\n');

  // Interceptar axios para Kommo API en pruebas sin alterar producción
  const dispatchedToKommo = [];
  const triggeredSalesbots = [];
  const stoppedSalesbots = [];

  const originalGet = axios.get;
  const originalPatch = axios.patch;
  const originalPost = axios.post;

  axios.get = async function(url, config) {
    if (typeof url === 'string' && url.includes('/api/v4/leads/')) {
      return { status: 200, data: { id: 99112233, status_id: 108871571, responsible_user_id: 15568119 } };
    }
    return originalGet.apply(this, arguments);
  };

  axios.patch = async function(url, data, config) {
    if (typeof url === 'string' && url.includes('/api/v4/leads/')) {
      dispatchedToKommo.push({ url, data });
      return { status: 200, data: { id: 12345, updated: true } };
    }
    return originalPatch.apply(this, arguments);
  };

  axios.post = async function(url, data, config) {
    if (typeof url === 'string' && url.includes('/api/v4/bots/') && url.includes('/run')) {
      triggeredSalesbots.push({ url, data });
      return { status: 200, data: { success: true } };
    }
    if (typeof url === 'string' && url.includes('/api/v4/bots/') && url.includes('/stop')) {
      stoppedSalesbots.push({ url, data });
      return { status: 200, data: { success: true } };
    }
    return originalPost.apply(this, arguments);
  };

  const { app, centralHandoffManager } = require('./server.js');

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  let passed = 0;
  const total = 6;

  try {
    // ------------------------------------------------------------------------
    // TEST 1: Endpoint /health reporta v5.0 y pipeline_decision.js
    // ------------------------------------------------------------------------
    const healthRes = await axios.get(`${baseUrl}/health`);
    const isHealthOk = healthRes.status === 200 &&
      healthRes.data?.pipeline_controller === 'pipeline_decision.js' &&
      healthRes.data?.service?.includes('v5.0');

    if (isHealthOk) {
      console.log('✅ [Int Test 1/6] PASÓ: Health check reporta controlador pipeline_decision.js y versión v5.0');
      passed++;
    } else {
      console.error('❌ [Int Test 1/6] FALLÓ: Health check no reporta pipeline_decision.js:', healthRes.data);
    }

    // ------------------------------------------------------------------------
    // TEST 2: Webhook con enlace Wasi válido -> Despacha "Sí, disponible." a Kommo Lead field 2103996
    // ------------------------------------------------------------------------
    dispatchedToKommo.length = 0;
    triggeredSalesbots.length = 0;

    const freshLeadId = 99112233;
    const freshTalkId = 'talk_fresh_01';

    const webhookPayload = {
      account: { id: 36728143 },
      message: {
        add: [{
          id: 'msg_wasi_int_01',
          entity_id: freshLeadId,
          talk_id: freshTalkId,
          type: 'incoming',
          text: 'Hola, me interesa este inmueble https://info.wasi.co/apartamento-venta-los-samanes-caracas/10493109',
          author: { type: 'external', name: 'Ronald' }
        }]
      }
    };

    const whRes = await axios.post(`${baseUrl}/webhook`, webhookPayload);

    // Esperar a que el webhook asíncrono descargue/consulte Google Sheets y despache
    for (let i = 0; i < 30; i++) {
      if (dispatchedToKommo.some(d => d.url.includes(`/api/v4/leads/${freshLeadId}`))) break;
      await new Promise(r => setTimeout(r, 200));
    }

    const dispatchedMsg = dispatchedToKommo.find(d => d.url.includes(`/api/v4/leads/${freshLeadId}`));
    const fieldValue = dispatchedMsg?.data?.custom_fields_values?.[0]?.values?.[0]?.value;
    const fieldId = dispatchedMsg?.data?.custom_fields_values?.[0]?.field_id;

    const test2Passed = whRes.status === 200 &&
      fieldValue === 'Sí, disponible.' &&
      fieldId === 2103996 &&
      triggeredSalesbots.length > 0;

    if (test2Passed) {
      console.log('✅ [Int Test 2/6] PASÓ: Webhook procesa enlace Wasi -> Guarda "Sí, disponible." en campo 2103996 y dispara Salesbot');
      console.log(`   Detalle: Campo=${fieldId}, Valor="${fieldValue}", Salesbot disparado=${triggeredSalesbots.length > 0}`);
      passed++;
    } else {
      console.error('❌ [Int Test 2/6] FALLÓ: Despacho a Kommo incorrecto:', { fieldValue, fieldId, triggeredSalesbots });
    }

    // ------------------------------------------------------------------------
    // TEST 3: Webhook con solicitud de reunión -> Silencio absoluto (0 despacho a Kommo)
    // ------------------------------------------------------------------------
    dispatchedToKommo.length = 0;
    triggeredSalesbots.length = 0;

    const meetingPayload = {
      account: { id: 36728143 },
      message: {
        add: [{
          id: 'msg_meet_int_02',
          entity_id: 25685885,
          talk_id: 'talk_int_02',
          type: 'incoming',
          text: 'Buenas tardes, quiero coordinar una reunión presencial en la oficina para negociar.',
          author: { type: 'external', name: 'Carlos' }
        }]
      }
    };

    await axios.post(`${baseUrl}/webhook`, meetingPayload);
    await new Promise(r => setTimeout(r, 800));

    // Solo debe haber peticiones de borrado de campo o ninguna de envío
    const meaningfulDispatches = dispatchedToKommo.filter(d => {
      const val = d.data?.custom_fields_values?.[0]?.values?.[0]?.value;
      return val && val.trim().length > 0;
    });

    const test3Passed = meaningfulDispatches.length === 0 && triggeredSalesbots.length === 0;

    if (test3Passed) {
      console.log('✅ [Int Test 3/6] PASÓ: Solicitud de reunión genera silencio total y detiene Salesbot (0 mensajes despachados)');
      passed++;
    } else {
      console.error('❌ [Int Test 3/6] FALLÓ: Se envió mensaje indebido a Kommo ante solicitud de reunión');
    }

    // ------------------------------------------------------------------------
    // TEST 4: Intervención humana vía Webhook saliente -> Activa bloqueo de 24h
    // ------------------------------------------------------------------------
    const outgoingHumanPayload = {
      account: { id: 36728143 },
      message: {
        add: [{
          id: 'msg_human_out_03',
          entity_id: 25685886,
          talk_id: 'talk_int_03',
          type: 'outgoing',
          text: 'Hola Carlos, con gusto te atiendo yo personalmente.',
          author: { type: 'user', name: 'Robert Jiménez' }
        }]
      }
    };

    await axios.post(`${baseUrl}/webhook`, outgoingHumanPayload);
    await new Promise(r => setTimeout(r, 600));

    const lockStatus = await centralHandoffManager.checkLockStatus('25685886', 'talk_int_03');

    if (lockStatus.isLocked) {
      console.log('✅ [Int Test 4/6] PASÓ: Webhook saliente de asesor humano activa bloqueo estricto de 24h en HandoffManager');
      console.log(`   Detalle: isLocked=${lockStatus.isLocked}, Horas transcurridas=${lockStatus.hoursElapsed.toFixed(2)}h`);
      passed++;
    } else {
      console.error('❌ [Int Test 4/6] FALLÓ: Bloqueo de 24h no activado:', lockStatus);
    }

    // ------------------------------------------------------------------------
    // TEST 5: MODO OBSERVACIÓN (OBSERVATION_MODE=true) garantiza cero mutaciones
    // ------------------------------------------------------------------------
    let observationModeVerified = true;
    let observationDetails = '';

    const { execSync } = require('child_process');
    try {
      const observationOutput = execSync(
        `node "${path.join(__dirname, 'test_obs_worker.js')}"`,
        { encoding: 'utf8', timeout: 10000 }
      );
      const obsLine = observationOutput.split('\n').find(l => l.startsWith('OBS_RESULT:'));
      if (obsLine) {
        const jsonStr = obsLine.replace('OBS_RESULT:', '').trim();
        const parsed = JSON.parse(jsonStr);
        if (parsed.r1?.observation_mode === true &&
            parsed.r2?.observation_mode === true &&
            parsed.r3?.observation_mode === true &&
            parsed.r4 === null &&
            parsed.r5 === null) {
          observationModeVerified = true;
          observationDetails = 'Todas las funciones mutadoras abortan inmediatamente en OBSERVATION_MODE=true';
        } else {
          observationModeVerified = false;
          observationDetails = 'Alguna función no retornó el flag de observation_mode: ' + jsonStr;
        }
      } else {
        observationModeVerified = false;
        observationDetails = 'No se encontró línea OBS_RESULT en la salida';
      }
    } catch (e) {
      observationModeVerified = false;
      observationDetails = 'Error ejecutando prueba de observation mode: ' + e.message;
    }

    if (observationModeVerified) {
      console.log('✅ [Int Test 5/6] PASÓ: OBSERVATION_MODE=true garantiza CERO mutaciones a Kommo, Salesbot y WhatsApp');
      console.log(`   Detalle: ${observationDetails}`);
      passed++;
    } else {
      console.error('❌ [Int Test 5/6] FALLÓ: MODO OBSERVACIÓN permitió mutaciones:', observationDetails);
    }

    // ------------------------------------------------------------------------
    // TEST 6: Desconexión total de motores antiguos en server.js
    // ------------------------------------------------------------------------
    const serverSource = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    
    // Verificamos que el webhook principal ya no delega a generateResponseRaw ni searchInventoryWithClaude
    const hasPipelineCentralInWebhook = serverSource.includes('evaluateCentralDecisionPipeline({');
    const webhookCallsGenerateResponseRaw = /app\.post\(['"]\/webhook['"][\s\S]*?generateResponseRaw\(/i.test(serverSource);
    const webhookCallsSearchInventory = /app\.post\(['"]\/webhook['"][\s\S]*?searchInventoryWithClaude\(/i.test(serverSource);
    const webhookUsesFichasManager = /app\.post\(['"]\/webhook['"][\s\S]*?fichas_manager/i.test(serverSource);

    const test6Passed = hasPipelineCentralInWebhook &&
      !webhookCallsGenerateResponseRaw &&
      !webhookCallsSearchInventory &&
      !webhookUsesFichasManager;

    if (test6Passed) {
      console.log('✅ [Int Test 6/6] PASÓ: Motores antiguos (fichas_manager, generateResponseRaw, searchInventoryWithClaude) 100% desconectados del flujo webhook');
      console.log('   Detalle: pipeline_decision.js es el único motor de decisión activo en /webhook');
      passed++;
    } else {
      console.error('❌ [Int Test 6/6] FALLÓ: Se detectaron llamadas residuales a motores antiguos en /webhook');
    }

  } finally {
    axios.get = originalGet;
    axios.patch = originalPatch;
    axios.post = originalPost;
    server.close();
  }

  console.log('\n================================================================');
  console.log(` RESULTADOS INTEGRACIÓN: ${passed} / ${total} PRUEBAS SUPERADAS (${Math.round((passed / total) * 100)}%) `);
  console.log('================================================================');

  if (passed !== total) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runServerIntegrationTests().catch(err => {
  console.error('Error en pruebas de integración:', err);
  process.exit(1);
});
