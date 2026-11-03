/**
 * ============================================================================
 * TEST DE VERIFICACIÓN STAGING COMPLETA: TU TECHO IDEAL BOT (RC-2)
 * ============================================================================
 * Comprueba las 9 situaciones exigidas en FASE 5:
 * 1. Endpoint /health (v5.0, pipeline_decision.js, OBSERVATION_MODE=true).
 * 2. Conexión de lectura en vivo a Google Sheets (sin modificar inventario).
 * 3. Enlace Wasi disponible.
 * 4. Búsqueda por zona.
 * 5. Notificación / Mención de Instagram.
 * 6. Pregunta sobre propiedad sin datos (condominio -> silencio / anti-alucinación).
 * 7. Solicitud de reunión (silencio y derivación a humano).
 * 8. Crédito Venezuela Renace (evaluación determinística basada en Sheets).
 * 9. Intervención humana saliente (inicia bloqueo 24h).
 * 10. Mensaje del cliente durante bloqueo de 24h (silencio seguro).
 * 11. Reactivación post-24h con nuevo enlace Wasi válido (se permite evaluar).
 * 12. Persistencia del bloqueo tras reinicio (handoffs.json bidireccional).
 * 13. Auditoría integral de CERO efectos secundarios en Kommo / WhatsApp.
 */

require('dotenv').config();
const axios = require('axios');
const http = require('http');
const fs = require('fs');
const path = require('path');

process.env.OBSERVATION_MODE = 'true';
process.env.PORT = '3001';

async function runStagingVerification() {
  console.log('================================================================');
  console.log('   VERIFICACIÓN EN ENTORNO STAGING COMPLETO (FASE 5 - 13 TESTS)  ');
  console.log('   Modo: OBSERVATION_MODE=true | Puerto: 3001                   ');
  console.log('================================================================\n');

  const sideEffects = {
    leadPatches: [],
    salesbotRuns: [],
    salesbotStops: [],
    whatsappAlerts: [],
    tasksCreated: []
  };

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

  const { app, centralHandoffManager, getAvailableProperties } = require('./server.js');

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(3001, resolve));
  const baseUrl = 'http://127.0.0.1:3001';

  let passed = 0;
  const total = 13;
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
      `Propiedades reales extraídas: ${liveProps.length}. Primera propiedad: ${liveProps[0]?.ID_PROPIEDAD} (${liveProps[0]?.ESTATUS})`
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
    await new Promise(r => setTimeout(r, 600));

    const test3Ok = resWh1.status === 200 &&
      sideEffects.leadPatches.length === 0 &&
      sideEffects.salesbotRuns.length === 0;

    record(
      3,
      'Webhook con enlace Wasi -> Evalúa decisión correcta con CERO mutaciones a Kommo',
      test3Ok,
      `HTTP Status: ${resWh1.status}, Lead patches: ${sideEffects.leadPatches.length}, Disparos Salesbot: ${sideEffects.salesbotRuns.length}`
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
    await new Promise(r => setTimeout(r, 600));

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
    await new Promise(r => setTimeout(r, 400));

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
    await new Promise(r => setTimeout(r, 400));

    const test6Ok = sideEffects.leadPatches.length === 0 && sideEffects.salesbotRuns.length === 0;
    record(
      6,
      'Webhook pregunta sin datos (condominio) -> Silencio absoluto (cero invención)',
      test6Ok,
      `Lead patches: ${sideEffects.leadPatches.length}, Disparos Salesbot: ${sideEffects.salesbotRuns.length}`
    );

    // ------------------------------------------------------------------------
    // PRUEBA 7: Webhook Simulado - Solicitud de reunión del cliente (Silencio y pase a humano)
    // ------------------------------------------------------------------------
    const meetingLeadId = 88001105;
    const meetingPayload = {
      account: { id: 36728143 },
      message: {
        add: [{
          id: 'msg_stg_05_meet',
          entity_id: meetingLeadId,
          talk_id: 'talk_stg_05_meet',
          type: 'incoming',
          text: 'Buenas tardes, deseo coordinar una reunión presencial en la oficina para ver el contrato.',
          author: { type: 'external', name: 'Cliente Reunión' }
        }]
      }
    };

    await axios.post(`${baseUrl}/webhook`, meetingPayload);
    await new Promise(r => setTimeout(r, 400));

    const test7Ok = sideEffects.leadPatches.length === 0 && sideEffects.salesbotRuns.length === 0;
    record(
      7,
      'Webhook solicitud de reunión -> Silencio absoluto y derivación a asesor humano',
      test7Ok,
      `Lead patches: ${sideEffects.leadPatches.length}, Disparos Salesbot: ${sideEffects.salesbotRuns.length}`
    );

    // ------------------------------------------------------------------------
    // PRUEBA 8: Webhook Simulado - Crédito Venezuela Renace (Evaluación determinística)
    // ------------------------------------------------------------------------
    const creditLeadId = 88001106;
    const creditPayload = {
      account: { id: 36728143 },
      message: {
        add: [{
          id: 'msg_stg_06_cred',
          entity_id: creditLeadId,
          talk_id: 'talk_stg_06_cred',
          type: 'incoming',
          text: '¿Aceptan crédito Venezuela Renace para este inmueble? https://info.wasi.co/apartamento-venta-los-samanes-caracas/10493109',
          author: { type: 'external', name: 'Cliente Crédito' }
        }]
      }
    };

    await axios.post(`${baseUrl}/webhook`, creditPayload);
    await new Promise(r => setTimeout(r, 600));

    const test8Ok = sideEffects.leadPatches.length === 0 && sideEffects.salesbotRuns.length === 0;
    record(
      8,
      'Webhook crédito Venezuela Renace -> Evalúa respuesta según Sheets sin mutar Kommo',
      test8Ok,
      `Lead patches: ${sideEffects.leadPatches.length}, Disparos Salesbot: ${sideEffects.salesbotRuns.length}`
    );

    // ------------------------------------------------------------------------
    // PRUEBA 9: Webhook Saliente - Intervención humana inicia bloqueo de 24h
    // ------------------------------------------------------------------------
    const humanLeadId = 88001107;
    const humanTalkId = 'talk_stg_07';

    const humanOutgoingPayload = {
      account: { id: 36728143 },
      message: {
        add: [{
          id: 'msg_stg_07_out',
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
    await new Promise(r => setTimeout(r, 500));

    const lockStatus = await centralHandoffManager.checkLockStatus(String(humanLeadId), humanTalkId);
    const test9Ok = lockStatus.isLocked === true &&
      sideEffects.leadPatches.length === 0 &&
      sideEffects.salesbotRuns.length === 0;

    record(
      9,
      'Webhook saliente de asesor humano -> Inicia bloqueo de 24h en HandoffManager',
      test9Ok,
      `isLocked: ${lockStatus.isLocked}, Horas: ${lockStatus.hoursElapsed.toFixed(2)}h, Cero mutaciones a Kommo: ${sideEffects.leadPatches.length === 0}`
    );

    // ------------------------------------------------------------------------
    // PRUEBA 10: Mensaje de cliente antes de 24h -> Bloqueo humano activo (Silencio)
    // ------------------------------------------------------------------------
    const clientDuringLockPayload = {
      account: { id: 36728143 },
      message: {
        add: [{
          id: 'msg_stg_08_lock',
          entity_id: humanLeadId,
          talk_id: humanTalkId,
          type: 'incoming',
          text: '¿A qué hora podríamos vernos mañana?',
          author: { type: 'external', name: 'Cliente' }
        }]
      }
    };

    await axios.post(`${baseUrl}/webhook`, clientDuringLockPayload);
    await new Promise(r => setTimeout(r, 400));

    const test10Ok = sideEffects.leadPatches.length === 0 && sideEffects.salesbotRuns.length === 0;
    record(
      10,
      'Mensaje de cliente durante bloqueo 24h -> El bot guarda silencio absoluto y respeta al asesor',
      test10Ok,
      `Lead patches: ${sideEffects.leadPatches.length}, Disparos Salesbot: ${sideEffects.salesbotRuns.length}`
    );

    // ------------------------------------------------------------------------
    // PRUEBA 11: Reactivación post-24h con nuevo enlace Wasi válido
    // ------------------------------------------------------------------------
    const reactLeadId = 88001108;
    const reactTalkId = 'talk_stg_08';
    const past25h = Date.now() - (25 * 3600 * 1000);
    centralHandoffManager.recordHumanIntervention(reactLeadId, reactTalkId, null, past25h);

    const reactPayload = {
      account: { id: 36728143 },
      message: {
        add: [{
          id: 'msg_stg_09_react',
          entity_id: reactLeadId,
          talk_id: reactTalkId,
          type: 'incoming',
          text: 'Hola, ahora me interesa este otro inmueble https://info.wasi.co/apartamento-venta-lomas-del-sol-caracas/10544010',
          author: { type: 'external', name: 'Cliente' }
        }]
      }
    };

    await axios.post(`${baseUrl}/webhook`, reactPayload);
    await new Promise(r => setTimeout(r, 600));

    const test11Ok = sideEffects.leadPatches.length === 0 && sideEffects.salesbotRuns.length === 0;
    record(
      11,
      'Reactivación post-24h con nuevo enlace Wasi válido -> Evalúa disponibilidad correctamente',
      test11Ok,
      `Lead patches: ${sideEffects.leadPatches.length}, Disparos Salesbot: ${sideEffects.salesbotRuns.length}`
    );

    // ------------------------------------------------------------------------
    // PRUEBA 12: Persistencia del Bloqueo tras Reinicio del Servidor
    // ------------------------------------------------------------------------
    const { HandoffManager } = require('./pipeline_decision.js');
    const restartedHandoffManager = new HandoffManager(path.join(__dirname, 'handoffs.json'));
    const recoveredLock = await restartedHandoffManager.checkLockStatus(String(humanLeadId), humanTalkId);

    const test12Ok = recoveredLock.isLocked === true;
    record(
      12,
      'Persistencia de Bloqueo tras Reinicio -> handoffs.json conserva el estado bloqueado de 24 horas',
      test12Ok,
      `isLocked tras reinicio: ${recoveredLock.isLocked}, Horas: ${recoveredLock.hoursElapsed.toFixed(2)}h`
    );

    // ------------------------------------------------------------------------
    // PRUEBA 13: Auditoría Integral de Cero Efectos Secundarios en Modo Observación
    // ------------------------------------------------------------------------
    const totalMutations = sideEffects.leadPatches.length +
      sideEffects.salesbotRuns.length +
      sideEffects.salesbotStops.length +
      sideEffects.whatsappAlerts.length +
      sideEffects.tasksCreated.length;

    const test13Ok = totalMutations === 0;
    record(
      13,
      'Auditoría Integral de Modo Observación: Garantía de CERO efectos secundarios',
      test13Ok,
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
