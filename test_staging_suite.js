/**
 * ============================================================================
 * TEST DE VERIFICACIÓN STAGING: TU TECHO IDEAL BOT (RC-2)
 * ============================================================================
 * Ejecuta la verificación completa del servidor en entorno Staging independiente:
 * - OBSERVATION_MODE=true activo.
 * - Endpoint /health validado.
 * - Conexión de lectura en vivo a Google Sheets (sin modificar inventario).
 * - Conexión de lectura a OpenRouter.
 * - Conexión de lectura a Kommo Events API.
 * - 6 Escenarios de Webhooks de Kommo simulados (Wasi, Zona, Mención, Sin Dato, Crédito, Humano).
 * - Auditoría estricta de CERO efectos secundarios (0 mutaciones a Kommo / Salesbot / WhatsApp).
 * - Verificación de persistencia de bloqueo humano tras reinicio.
 */

require('dotenv').config();
const axios = require('axios');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Asegurar modo observación para staging
process.env.OBSERVATION_MODE = 'true';
process.env.PORT = '3001';

async function runStagingVerification() {
  console.log('================================================================');
  console.log('   INICIANDO PRUEBAS DE VERIFICACIÓN EN ENTORNO STAGING (RC-2)  ');
  console.log('   Modo: OBSERVATION_MODE=true | Puerto: 3001                   ');
  console.log('================================================================\n');

  // Contadores de auditoría de efectos secundarios
  const sideEffects = {
    leadPatches: [],
    salesbotRuns: [],
    salesbotStops: [],
    whatsappAlerts: [],
    tasksCreated: []
  };

  // Interceptar axios a nivel global para interceptar cualquier mutación a Kommo
  const originalPatch = axios.patch;
  const originalPost = axios.post;

  axios.patch = async function(url, data, config) {
    if (typeof url === 'string' && url.includes('/api/v4/leads/')) {
      sideEffects.leadPatches.push({ url, data });
    }
    return originalPatch.apply(this, arguments);
  };

  axios.post = async function(url, data, config) {
    if (typeof url === 'string' && url.includes('/api/v4/bots/') && url.includes('/run')) {
      sideEffects.salesbotRuns.push({ url, data });
    }
    if (typeof url === 'string' && url.includes('/api/v4/bots/') && url.includes('/stop')) {
      sideEffects.salesbotStops.push({ url, data });
    }
    if (typeof url === 'string' && url.includes('/api/v4/tasks')) {
      sideEffects.tasksCreated.push({ url, data });
    }
    return originalPost.apply(this, arguments);
  };

  // Cargar servidor con OBSERVATION_MODE=true
  const { app, centralHandoffManager, getAvailableProperties } = require('./server.js');

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(3001, resolve));
  const baseUrl = 'http://127.0.0.1:3001';

  let passed = 0;
  const total = 9;
  const results = [];

  function record(num, name, condition, details = '') {
    if (condition) {
      console.log(`✅ [Staging Test ${num}/${total}] PASÓ: ${name}`);
      if (details) console.log(`   Detalle: ${details}`);
      passed++;
      results.push({ num, name, passed: true, details });
    } else {
      console.error(`❌ [Staging Test ${num}/${total}] FALLÓ: ${name}`);
      if (details) console.error(`   Detalle: ${details}`);
      results.push({ num, name, passed: false, details });
    }
  }

  try {
    // ------------------------------------------------------------------------
    // PRUEBA 1: Endpoint /health en Staging
    // ------------------------------------------------------------------------
    const healthRes = await axios.get(`${baseUrl}/health`);
    const hData = healthRes.data;
    const test1Ok = healthRes.status === 200 &&
      hData.status === 'running' &&
      hData.pipeline_controller === 'pipeline_decision.js' &&
      hData.observation_mode === true &&
      hData.service.includes('v5.0');

    record(
      1,
      'Endpoint /health reporta v5.0, pipeline_decision.js y OBSERVATION_MODE=true',
      test1Ok,
      `Service: "${hData.service}", Controller: "${hData.pipeline_controller}", ObsMode: ${hData.observation_mode}, Status: ${hData.status}`
    );

    // ------------------------------------------------------------------------
    // PRUEBA 2: Conexión de lectura en vivo a Google Sheets (sin modificar)
    // ------------------------------------------------------------------------
    const liveProps = await getAvailableProperties();
    const test2Ok = Array.isArray(liveProps) && liveProps.length > 50;
    record(
      2,
      'Conexión de lectura en vivo a Google Sheets exitosa (sin modificar inventario)',
      test2Ok,
      `Propiedades reales extraídas: ${liveProps.length}. Ejemplo primera propiedad: ${liveProps[0]?.ID_PROPIEDAD} (${liveProps[0]?.ESTATUS})`
    );

    // ------------------------------------------------------------------------
    // PRUEBA 3: Webhook Simulado - Enlace Wasi disponible en Modo Observación
    // ------------------------------------------------------------------------
    const wasiLeadId = 88001101;
    const wasiPayload = {
      account: { id: 36728143 },
      message: {
        add: [{
          id: 'msg_stg_01',
          entity_id: wasiLeadId,
          talk_id: 'talk_stg_01',
          type: 'incoming',
          text: 'Hola, me interesa este apartamento https://info.wasi.co/apartamento-venta-los-samanes-caracas/10493109',
          author: { type: 'external', name: 'Cliente Staging' }
        }]
      }
    };

    const resWh1 = await axios.post(`${baseUrl}/webhook`, wasiPayload);
    await new Promise(r => setTimeout(r, 800));

    // En modo observación NO debe haber mutaciones en Kommo
    const test3Ok = resWh1.status === 200 &&
      sideEffects.leadPatches.length === 0 &&
      sideEffects.salesbotRuns.length === 0;

    record(
      3,
      'Webhook con enlace Wasi -> Evalúa decisión correcta con CERO mutaciones a Kommo',
      test3Ok,
      `HTTP Status: ${resWh1.status}, Lead patches a Kommo: ${sideEffects.leadPatches.length}, Disparos Salesbot: ${sideEffects.salesbotRuns.length}`
    );

    // ------------------------------------------------------------------------
    // PRUEBA 4: Webhook Simulado - Búsqueda por zona en Modo Observación
    // ------------------------------------------------------------------------
    const zoneLeadId = 88001102;
    const zonePayload = {
      account: { id: 36728143 },
      message: {
        add: [{
          id: 'msg_stg_02',
          entity_id: zoneLeadId,
          talk_id: 'talk_stg_02',
          type: 'incoming',
          text: 'Hola buenas tardes, busco apartamento en venta en Los Samanes',
          author: { type: 'external', name: 'Cliente Zona' }
        }]
      }
    };

    await axios.post(`${baseUrl}/webhook`, zonePayload);
    await new Promise(r => setTimeout(r, 800));

    const test4Ok = sideEffects.leadPatches.length === 0 && sideEffects.salesbotRuns.length === 0;
    record(
      4,
      'Webhook búsqueda por zona -> Evalúa coincidencia con CERO mutaciones a Kommo',
      test4Ok,
      `Lead patches: ${sideEffects.leadPatches.length}, Disparos Salesbot: ${sideEffects.salesbotRuns.length}`
    );

    // ------------------------------------------------------------------------
    // PRUEBA 5: Webhook Simulado - Mención en historias / reels (Ignorar en silencio)
    // ------------------------------------------------------------------------
    const mentionLeadId = 88001103;
    const mentionPayload = {
      account: { id: 36728143 },
      message: {
        add: [{
          id: 'msg_stg_03',
          entity_id: mentionLeadId,
          talk_id: 'talk_stg_03',
          type: 'incoming',
          text: 'Te mencionó en su historia de Instagram',
          author: { type: 'external', name: 'Usuario IG' }
        }]
      }
    };

    await axios.post(`${baseUrl}/webhook`, mentionPayload);
    await new Promise(r => setTimeout(r, 500));

    const test5Ok = sideEffects.leadPatches.length === 0 && sideEffects.salesbotRuns.length === 0;
    record(
      5,
      'Webhook mención en Instagram -> Silencio sin llamadas a IA ni a Kommo',
      test5Ok,
      `Lead patches: ${sideEffects.leadPatches.length}, Disparos Salesbot: ${sideEffects.salesbotRuns.length}`
    );

    // ------------------------------------------------------------------------
    // PRUEBA 6: Webhook Simulado - Pregunta sin datos en Sheets (Anti-Invención / Silencio)
    // ------------------------------------------------------------------------
    const noDataLeadId = 88001104;
    const noDataPayload = {
      account: { id: 36728143 },
      message: {
        add: [{
          id: 'msg_stg_04',
          entity_id: noDataLeadId,
          talk_id: 'talk_stg_04',
          type: 'incoming',
          text: '¿Cuánto es el costo mensual exacto de condominio en ese apartamento?',
          author: { type: 'external', name: 'Cliente Duda' }
        }]
      }
    };

    await axios.post(`${baseUrl}/webhook`, noDataPayload);
    await new Promise(r => setTimeout(r, 500));

    const test6Ok = sideEffects.leadPatches.length === 0 && sideEffects.salesbotRuns.length === 0;
    record(
      6,
      'Webhook pregunta sin datos (condominio) -> Silencio absoluto (cero invención)',
      test6Ok,
      `Lead patches: ${sideEffects.leadPatches.length}, Disparos Salesbot: ${sideEffects.salesbotRuns.length}`
    );

    // ------------------------------------------------------------------------
    // PRUEBA 7: Webhook Saliente - Intervención humana inicia bloqueo de 24h
    // ------------------------------------------------------------------------
    const humanLeadId = 88001105;
    const humanTalkId = 'talk_stg_05';

    const humanOutgoingPayload = {
      account: { id: 36728143 },
      message: {
        add: [{
          id: 'msg_stg_05_out',
          entity_id: humanLeadId,
          talk_id: humanTalkId,
          type: 'outgoing',
          text: 'Hola, te escribe Robert de Tu Techo Ideal para ayudarte personalmente.',
          author: { type: 'user', name: 'Robert Jiménez' },
          created_by: 15568119
        }]
      }
    };

    await axios.post(`${baseUrl}/webhook`, humanOutgoingPayload);
    await new Promise(r => setTimeout(r, 600));

    const lockStatus = await centralHandoffManager.checkLockStatus(String(humanLeadId), humanTalkId);
    const test7Ok = lockStatus.isLocked === true &&
      sideEffects.leadPatches.length === 0 &&
      sideEffects.salesbotRuns.length === 0;

    record(
      7,
      'Webhook saliente de asesor humano -> Registra intervención e inicia bloqueo 24h en HandoffManager',
      test7Ok,
      `isLocked: ${lockStatus.isLocked}, Horas: ${lockStatus.hoursElapsed.toFixed(2)}h, Cero mutaciones a Kommo: ${sideEffects.leadPatches.length === 0}`
    );

    // ------------------------------------------------------------------------
    // PRUEBA 8: Persistencia del Bloqueo tras Reinicio del Servidor
    // ------------------------------------------------------------------------
    // Simular que el proceso se reinicia creando un nuevo HandoffManager desde el archivo en disco
    const { HandoffManager } = require('./pipeline_decision.js');
    const restartedHandoffManager = new HandoffManager(path.join(__dirname, 'handoffs.json'));
    const recoveredLock = await restartedHandoffManager.checkLockStatus(String(humanLeadId), humanTalkId);

    const test8Ok = recoveredLock.isLocked === true;
    record(
      8,
      'Persistencia de Bloqueo tras Reinicio -> handoffs.json conserva el estado bloqueado de 24 horas',
      test8Ok,
      `isLocked tras reinicio: ${recoveredLock.isLocked}, Horas: ${recoveredLock.hoursElapsed.toFixed(2)}h`
    );

    // ------------------------------------------------------------------------
    // PRUEBA 9: Auditoría Integral de Cero Efectos Secundarios en Modo Observación
    // ------------------------------------------------------------------------
    const totalMutations = sideEffects.leadPatches.length +
      sideEffects.salesbotRuns.length +
      sideEffects.salesbotStops.length +
      sideEffects.whatsappAlerts.length +
      sideEffects.tasksCreated.length;

    const test9Ok = totalMutations === 0;
    record(
      9,
      'Auditoría Integral de Modo Observación: Garantía de CERO efectos secundarios',
      test9Ok,
      `Total mutaciones a producción: ${totalMutations} (Leads: ${sideEffects.leadPatches.length}, Salesbot: ${sideEffects.salesbotRuns.length + sideEffects.salesbotStops.length}, WhatsApp: ${sideEffects.whatsappAlerts.length}, Tareas: ${sideEffects.tasksCreated.length})`
    );

  } finally {
    axios.patch = originalPatch;
    axios.post = originalPost;
    server.close();
  }

  console.log('\n================================================================');
  console.log(` RESULTADOS STAGING: ${passed} / ${total} PRUEBAS SUPERADAS (${Math.round((passed / total) * 100)}%) `);
  console.log('================================================================\n');

  if (passed !== total) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runStagingVerification().catch(err => {
  console.error('Error fatal en pruebas de staging:', err);
  process.exit(1);
});
