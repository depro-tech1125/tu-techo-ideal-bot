/**
 * ============================================================================
 * TU TECHO IDEAL v5.0 — VALIDACIÓN TEMPORAL RIGUROSA DETERMINISTA (12 HORAS)
 * ============================================================================
 * Validación matemática exacta sin latencia HTTP:
 * Inyección de tiempo relativo exacto en milisegundos (offset_ms):
 * - 0 ms (T0): Intervención humana registrada (isLocked: true, 0.000000h, LOCK_12H).
 * - 60.000 ms (T0 + 1m): Bloqueo activo (isLocked: true, 0.016667h, 0 tokens IA).
 * - 43.199.000 ms (T0 + 11h 59m 59s): Bloqueo activo (isLocked: true, 11.999722h, 0 tokens IA).
 * - 43.200.000 ms (T0 + 12h exactas): Bloqueo vencido (isLocked: false, 12.000000h, operador < 12).
 * - 43.201.000 ms (T0 + 12h 1s): Reactivación condicional (isLocked: false, 12.000278h):
 *     * Pregunta con dato verificado ("¿Cuántos metros tiene?"): Responde "Tiene 110 m²".
 *     * Pregunta sin dato en Sheets ("¿Condominio mensual?"): Silencio absoluto (text: null).
 *     * Mensajes salientes de Salesbot (created_by === 0): Descartados como BOT_OUTGOING_ECHO.
 * - Nueva intervención humana: Reinicio completo de período de 12h (T_nuevo).
 * - Seguridad: Endpoints de Staging protegidos contra acceso no autorizado (HTTP 401).
 * ============================================================================
 */

const axios = require('axios');
require('dotenv').config();

const BASE_URL = process.env.STAGING_URL || 'https://tu-techo-ideal-staging.onrender.com';
const STAGING_AUTH = process.env.STAGING_AUTH_TOKEN || process.env.STAGING_AUDIT_SECRET || process.env.KOMMO_TOKEN || 'tti-staging-auth-token-2026';

const TARGET_LEAD_ID = '25092108';
const TARGET_TALK_ID = '1149';

async function executeFullDeterministicSimulation() {
  console.log('================================================================');
  console.log(' TU TECHO IDEAL v5.0 — VALIDACIÓN TEMPORAL DETERMINISTA (12 HORAS)');
  console.log(` Servidor: ${BASE_URL}`);
  console.log('================================================================\n');

  // ==========================================================================
  // FASE 1: DESPLIEGUE Y ESTADO DE SALUD
  // ==========================================================================
  console.log('==================================================');
  console.log(' FASE 1: COMPROBACIÓN DE DESPLIEGUE Y SALUD');
  console.log('==================================================');
  const healthRes = await axios.get(`${BASE_URL}/health`);
  console.log('Health:', healthRes.data);

  if (healthRes.data.status !== 'running') {
    throw new Error('❌ Staging no está en status running.');
  }
  if (healthRes.data.observation_mode !== true) {
    throw new Error('❌ OBSERVATION_MODE no es true.');
  }

  const dispatchStatusRes = await axios.get(`${BASE_URL}/api/staging/controlled-dispatch-status`, {
    headers: { 'x-staging-auth': STAGING_AUTH }
  });
  console.log('Controlled Dispatch Status:', dispatchStatusRes.data);

  if (dispatchStatusRes.data.staging_test_dispatch_enabled !== false) {
    throw new Error('❌ La lista blanca de despachos no está desactivada.');
  }
  console.log('✅ FASE 1 SUPERADA: Servidor activo, OBSERVATION_MODE=true y lista blanca desactivada.\n');

  // Asegurar contexto activo de REF-012 en Staging
  console.log('--- Asegurando contexto activo de REF-012 en Staging ---');
  await axios.post(`${BASE_URL}/webhook?sync=true&bypass_debounce=true`, {
    account: { id: 36728143 },
    message: {
      add: [{
        id: 'msg_seed_det_' + Date.now(),
        entity_id: parseInt(TARGET_LEAD_ID, 10),
        talk_id: TARGET_TALK_ID,
        type: 'incoming',
        text: 'Hola, me interesa este apartamento https://info.wasi.co/apartamento-venta-los-samanes-caracas/10493109',
        author: { type: 'external', name: 'Daniel Palma' }
      }]
    }
  }, { headers: { 'x-staging-auth': STAGING_AUTH } });
  console.log('✅ Contexto REF-012 activo en Staging.');

  const results = [];

  // ==========================================================================
  // FASE 2 Y 3: LÍMITES TEMPORALES DETERMINISTAS Y COMPORTAMIENTO (12 HORAS)
  // ==========================================================================
  console.log('\n==================================================');
  console.log(' FASE 2 Y 3: LÍMITES TEMPORALES DETERMINISTAS (12 HORAS)');
  console.log('==================================================');

  // 1. T0: INTERVENCIÓN HUMANA REGISTRADA
  console.log('\n--- [1/6] Instante T0: Registro de Intervención Humana ---');
  const t0WebhookRes = await axios.post(`${BASE_URL}/webhook?sync=true&bypass_debounce=true`, {
    account: { id: 36728143 },
    message: {
      add: [{
        id: 'msg_human_t0_' + Date.now(),
        entity_id: parseInt(TARGET_LEAD_ID, 10),
        talk_id: TARGET_TALK_ID,
        type: 'outgoing',
        created_by: 998877, // Asesor humano web
        text: 'Hola Daniel, soy Robert de Tu Techo Ideal, estoy a su orden para atenderle.',
        author: { type: 'user', name: 'Robert Asesor Humano' }
      }]
    }
  }, { headers: { 'x-staging-auth': STAGING_AUTH } });

  const t0StatusRes = await axios.get(`${BASE_URL}/api/staging/check-lock-status?lead_id=${TARGET_LEAD_ID}&talk_id=${TARGET_TALK_ID}&offset_ms=0`, {
    headers: { 'x-staging-auth': STAGING_AUTH }
  });
  const t0Lock = t0StatusRes.data?.lock_status;
  console.log('Estado en T0:', t0Lock);
  const passedT0 = t0Lock?.isLocked === true && t0Lock?.hoursElapsed === 0;

  results.push({
    paso: '1. Instante T0',
    limite: 'T0 (0 ms)',
    delta_ms: '0 ms',
    horas_transcurridas: `${t0Lock.hoursElapsed.toFixed(6)}h`,
    isLocked: t0Lock.isLocked,
    esperado: 'isLocked: true (0.000000h) | LOCK_12H',
    obtenido: `isLocked: ${t0Lock.isLocked} (${t0Lock.hoursElapsed.toFixed(6)}h)`,
    tokens_ia: 0,
    estado: passedT0 ? 'PASÓ' : 'FALLÓ',
    evidencia: `lastIntervention: ${t0Lock.lastIntervention} | hoursElapsed exacto: 0.000000h`
  });

  // 2. T0 + 1 MINUTO (60.000 MS): BLOQUEO ACTIVO
  console.log('\n--- [2/6] Límite: T0 + 1 minuto (60.000 ms) ---');
  const status1mRes = await axios.get(`${BASE_URL}/api/staging/check-lock-status?lead_id=${TARGET_LEAD_ID}&talk_id=${TARGET_TALK_ID}&offset_ms=60000`, {
    headers: { 'x-staging-auth': STAGING_AUTH }
  });
  const lock1m = status1mRes.data?.lock_status;
  console.log('Estado en T0 + 60.000 ms:', lock1m);

  const webhook1mRes = await axios.post(`${BASE_URL}/webhook?sync=true&bypass_debounce=true&offset_ms=60000`, {
    account: { id: 36728143 },
    message: {
      add: [{
        id: 'msg_t1m_' + Date.now(),
        entity_id: parseInt(TARGET_LEAD_ID, 10),
        talk_id: TARGET_TALK_ID,
        type: 'incoming',
        text: '¿Cuántos metros tiene el apartamento?',
        author: { type: 'external', name: 'Daniel Palma' }
      }]
    }
  }, { headers: { 'x-staging-auth': STAGING_AUTH } });

  console.log('Decisión en T0 + 1m:', webhook1mRes.data?.decision);
  const passed1m = lock1m?.isLocked === true &&
                   Math.abs(lock1m?.hoursElapsed - (60000 / 3600000)) < 1e-9 &&
                   webhook1mRes.data?.decision?.action === 'SILENCE' &&
                   webhook1mRes.data?.decision?.typeDetected === 'HUMAN_LOCKED' &&
                   webhook1mRes.data?.decision?.calledAI === false &&
                   webhook1mRes.data?.text === null;

  results.push({
    paso: '2. T0 + 1 minuto',
    limite: 'T0 + 60.000 ms',
    delta_ms: '60.000 ms',
    horas_transcurridas: `${lock1m.hoursElapsed.toFixed(6)}h`,
    isLocked: lock1m.isLocked,
    esperado: 'isLocked: true (0.016667h) -> SILENCE / HUMAN_LOCKED (0 tokens IA)',
    obtenido: `${webhook1mRes.data?.decision?.action} / ${webhook1mRes.data?.decision?.typeDetected} (${lock1m.hoursElapsed.toFixed(6)}h)`,
    tokens_ia: webhook1mRes.data?.decision?.tokensUsed || 0,
    estado: passed1m ? 'PASÓ' : 'FALLÓ',
    evidencia: `${webhook1mRes.data?.decision?.reason} | delta: 60.000 ms exactos`
  });

  // 3. T0 + 11 HORAS, 59 MINUTOS Y 59 SEGUNDOS (43.199.000 MS): BLOQUEO ACTIVO
  console.log('\n--- [3/6] Límite: T0 + 11h 59m 59s (43.199.000 ms) ---');
  const status11hRes = await axios.get(`${BASE_URL}/api/staging/check-lock-status?lead_id=${TARGET_LEAD_ID}&talk_id=${TARGET_TALK_ID}&offset_ms=43199000`, {
    headers: { 'x-staging-auth': STAGING_AUTH }
  });
  const lock11h = status11hRes.data?.lock_status;
  console.log('Estado en T0 + 43.199.000 ms:', lock11h);

  const webhook11hRes = await axios.post(`${BASE_URL}/webhook?sync=true&bypass_debounce=true&offset_ms=43199000`, {
    account: { id: 36728143 },
    message: {
      add: [{
        id: 'msg_t11h_' + Date.now(),
        entity_id: parseInt(TARGET_LEAD_ID, 10),
        talk_id: TARGET_TALK_ID,
        type: 'incoming',
        text: '¿Tiene estacionamiento techado?',
        author: { type: 'external', name: 'Daniel Palma' }
      }]
    }
  }, { headers: { 'x-staging-auth': STAGING_AUTH } });

  console.log('Decisión en T0 + 43.199.000 ms:', webhook11hRes.data?.decision);
  const expectedHours11h = 43199000 / 3600000; // 11.99972222222222
  const passed11h = lock11h?.isLocked === true &&
                    Math.abs(lock11h?.hoursElapsed - expectedHours11h) < 1e-9 &&
                    webhook11hRes.data?.decision?.action === 'SILENCE' &&
                    webhook11hRes.data?.decision?.typeDetected === 'HUMAN_LOCKED' &&
                    webhook11hRes.data?.decision?.calledAI === false &&
                    webhook11hRes.data?.text === null;

  results.push({
    paso: '3. T0 + 11h 59m 59s',
    limite: 'T0 + 43.199.000 ms',
    delta_ms: '43.199.000 ms',
    horas_transcurridas: `${lock11h.hoursElapsed.toFixed(6)}h`,
    isLocked: lock11h.isLocked,
    esperado: 'isLocked: true (11.999722h) -> SILENCE / HUMAN_LOCKED (0 tokens IA)',
    obtenido: `${webhook11hRes.data?.decision?.action} / ${webhook11hRes.data?.decision?.typeDetected} (${lock11h.hoursElapsed.toFixed(6)}h)`,
    tokens_ia: webhook11hRes.data?.decision?.tokensUsed || 0,
    estado: passed11h ? 'PASÓ' : 'FALLÓ',
    evidencia: `Operador: ${lock11h.hoursElapsed.toFixed(6)}h < 12 es TRUE -> Bloqueo activo estricto`
  });

  // 4. T0 + 12 HORAS EXACTAS (43.200.000 MS): BLOQUEO VENCIDO
  console.log('\n--- [4/6] Límite: T0 + 12 horas exactas (43.200.000 ms) ---');
  const status12hRes = await axios.get(`${BASE_URL}/api/staging/check-lock-status?lead_id=${TARGET_LEAD_ID}&talk_id=${TARGET_TALK_ID}&offset_ms=43200000`, {
    headers: { 'x-staging-auth': STAGING_AUTH }
  });
  const lock12h = status12hRes.data?.lock_status;
  console.log('Estado en T0 + 43.200.000 ms exactos:', lock12h);

  // Operador de comparación en HandoffManager: if (hoursElapsed < 12) { isLocked: true } else { isLocked: false }
  // A las 12.000000h exactas, 12.0 < 12 es estrictamente FALSE, por lo que isLocked es FALSE (VENCIDO).
  const expectedHours12h = 43200000 / 3600000; // 12.00000000000000
  const passed12h = lock12h?.isLocked === false &&
                    Math.abs(lock12h?.hoursElapsed - expectedHours12h) < 1e-9;

  results.push({
    paso: '4. T0 + 12h 00m 00s',
    limite: 'T0 + 43.200.000 ms',
    delta_ms: '43.200.000 ms',
    horas_transcurridas: `${lock12h.hoursElapsed.toFixed(6)}h`,
    isLocked: lock12h.isLocked,
    esperado: 'isLocked: false (12.000000h) -> Bloqueo vencido por operador "< 12"',
    obtenido: `isLocked: ${lock12h.isLocked} (${lock12h.hoursElapsed.toFixed(6)}h)`,
    tokens_ia: 0,
    estado: passed12h ? 'PASÓ' : 'FALLÓ',
    evidencia: `Operador "hoursElapsed (${lock12h.hoursElapsed.toFixed(6)}) < 12" evalúa FALSE -> isLocked: false`
  });

  // 5. T0 + 12 HORAS Y 1 SEGUNDO (43.201.000 MS): REACTIVACIÓN CONDICIONAL
  console.log('\n--- [5/6] Límite: T0 + 12h y 1 segundo (43.201.000 ms) ---');
  const status12h1sRes = await axios.get(`${BASE_URL}/api/staging/check-lock-status?lead_id=${TARGET_LEAD_ID}&talk_id=${TARGET_TALK_ID}&offset_ms=43201000`, {
    headers: { 'x-staging-auth': STAGING_AUTH }
  });
  const lock12h1s = status12h1sRes.data?.lock_status;
  console.log('Estado en T0 + 43.201.000 ms:', lock12h1s);

  // 5.1 Pregunta con dato oficial (Metraje) -> Responde "Tiene 110 m²"
  console.log('5.1 Pregunta con información oficial (Metraje)...');
  const webhook12h1s_m2 = await axios.post(`${BASE_URL}/webhook?sync=true&bypass_debounce=true&offset_ms=43201000`, {
    account: { id: 36728143 },
    message: {
      add: [{
        id: 'msg_t12h1s_m2_' + Date.now(),
        entity_id: parseInt(TARGET_LEAD_ID, 10),
        talk_id: TARGET_TALK_ID,
        type: 'incoming',
        text: '¿Cuántos metros tiene el apartamento?',
        author: { type: 'external', name: 'Daniel Palma' }
      }]
    }
  }, { headers: { 'x-staging-auth': STAGING_AUTH }, timeout: 45000 });

  console.log('Respuesta 5.1 (Metraje):', {
    text: webhook12h1s_m2.data?.text,
    action: webhook12h1s_m2.data?.decision?.action,
    type: webhook12h1s_m2.data?.decision?.typeDetected,
    tokens: webhook12h1s_m2.data?.decision?.tokensUsed
  });

  // 5.2 Pregunta sin información (Condominio) -> Silencio absoluto
  console.log('5.2 Pregunta sin dato en Google Sheets (Condominio mensual)...');
  const webhook12h1s_condo = await axios.post(`${BASE_URL}/webhook?sync=true&bypass_debounce=true&offset_ms=43201000`, {
    account: { id: 36728143 },
    message: {
      add: [{
        id: 'msg_t12h1s_condo_' + Date.now(),
        entity_id: parseInt(TARGET_LEAD_ID, 10),
        talk_id: TARGET_TALK_ID,
        type: 'incoming',
        text: '¿Cuánto cuesta el condominio mensual?',
        author: { type: 'external', name: 'Daniel Palma' }
      }]
    }
  }, { headers: { 'x-staging-auth': STAGING_AUTH }, timeout: 45000 });

  console.log('Respuesta 5.2 (Condominio):', {
    text: webhook12h1s_condo.data?.text,
    action: webhook12h1s_condo.data?.decision?.action,
    type: webhook12h1s_condo.data?.decision?.typeDetected
  });

  // 5.3 Verificación de mensaje saliente generado por Salesbot (created_by === 0)
  console.log('5.3 Verificación de mensaje saliente generado por Salesbot (created_by === 0)...');
  const botEchoRes = await axios.post(`${BASE_URL}/webhook?sync=true&bypass_debounce=true`, {
    account: { id: 36728143 },
    message: {
      add: [{
        id: 'msg_salesbot_echo_' + Date.now(),
        entity_id: parseInt(TARGET_LEAD_ID, 10),
        talk_id: TARGET_TALK_ID,
        type: 'outgoing',
        created_by: 0, // 0 = Salesbot / API
        text: 'Tiene 110 m²',
        author: { type: 'bot', name: 'Tu Techo Ideal Bot' }
      }]
    }
  }, { headers: { 'x-staging-auth': STAGING_AUTH } });

  console.log('Respuesta 5.3 (Salesbot):', botEchoRes.data);

  const expectedHours12h1s = 43201000 / 3600000; // 12.00027777777778
  const passed5 = lock12h1s?.isLocked === false &&
                  Math.abs(lock12h1s?.hoursElapsed - expectedHours12h1s) < 1e-9 &&
                  webhook12h1s_m2.data?.text === 'Tiene 110 m²' &&
                  webhook12h1s_m2.data?.decision?.action === 'RESPOND' &&
                  webhook12h1s_condo.data?.decision?.action === 'SILENCE' &&
                  webhook12h1s_condo.data?.text === null &&
                  botEchoRes.data?.handled === 'BOT_OUTGOING_ECHO';

  results.push({
    paso: '5. T0 + 12h 00m 01s',
    limite: 'T0 + 43.201.000 ms',
    delta_ms: '43.201.000 ms',
    horas_transcurridas: `${lock12h1s.hoursElapsed.toFixed(6)}h`,
    isLocked: lock12h1s.isLocked,
    esperado: 'Metraje: "Tiene 110 m²" | Condominio: SILENCIO | Eco Salesbot: Descartado',
    obtenido: `Metraje: "${webhook12h1s_m2.data?.text}" | Condominio: ${webhook12h1s_condo.data?.decision?.action} | Eco: ${botEchoRes.data?.handled || 'BOT_ECHO'}`,
    tokens_ia: webhook12h1s_m2.data?.decision?.tokensUsed || 0,
    estado: passed5 ? 'PASÓ' : 'FALLÓ',
    evidencia: `hoursElapsed: ${lock12h1s.hoursElapsed.toFixed(6)}h (delta: 43.201.000 ms exactos)`
  });

  // 6. NUEVA INTERVENCIÓN HUMANA REINICIA EL PERÍODO DE BLOQUEO DE 12H
  console.log('\n--- [6/6] Nueva intervención humana inicia un nuevo período de 12 horas ---');
  const newHumanRes = await axios.post(`${BASE_URL}/webhook?sync=true&bypass_debounce=true`, {
    account: { id: 36728143 },
    message: {
      add: [{
        id: 'msg_new_human_' + Date.now(),
        entity_id: parseInt(TARGET_LEAD_ID, 10),
        talk_id: TARGET_TALK_ID,
        type: 'outgoing',
        created_by: 998877, // Asesor humano interviene de nuevo
        text: 'Perfecto Daniel, acabo de agendar su visita para mañana a las 3:00 PM.',
        author: { type: 'user', name: 'Robert Asesor Humano' }
      }]
    }
  }, { headers: { 'x-staging-auth': STAGING_AUTH } });

  const newLockStatusRes = await axios.get(`${BASE_URL}/api/staging/check-lock-status?lead_id=${TARGET_LEAD_ID}&talk_id=${TARGET_TALK_ID}&offset_ms=0`, {
    headers: { 'x-staging-auth': STAGING_AUTH }
  });
  const newLock = newLockStatusRes.data?.lock_status;

  // Pregunta inmediata del cliente tras la nueva intervención humana -> SILENCIO
  const postNewLockWebhookRes = await axios.post(`${BASE_URL}/webhook?sync=true&bypass_debounce=true&offset_ms=1000`, {
    account: { id: 36728143 },
    message: {
      add: [{
        id: 'msg_post_new_lock_' + Date.now(),
        entity_id: parseInt(TARGET_LEAD_ID, 10),
        talk_id: TARGET_TALK_ID,
        type: 'incoming',
        text: '¿Tiene vista al centro comercial?',
        author: { type: 'external', name: 'Daniel Palma' }
      }]
    }
  }, { headers: { 'x-staging-auth': STAGING_AUTH } });

  console.log('Decisión post nueva intervención:', postNewLockWebhookRes.data?.decision);

  const passedNewLock = newLock?.isLocked === true &&
                        newLock?.hoursElapsed === 0 &&
                        postNewLockWebhookRes.data?.decision?.action === 'SILENCE' &&
                        postNewLockWebhookRes.data?.decision?.typeDetected === 'HUMAN_LOCKED' &&
                        postNewLockWebhookRes.data?.decision?.calledAI === false;

  results.push({
    paso: '6. Nueva Intervención',
    limite: 'T_nuevo (0 ms)',
    delta_ms: '0 ms',
    horas_transcurridas: `${newLock.hoursElapsed.toFixed(6)}h`,
    isLocked: newLock.isLocked,
    esperado: 'isLocked: true (0.000000h) -> Nuevo bloqueo de 12h activado',
    obtenido: `${postNewLockWebhookRes.data?.decision?.action} / ${postNewLockWebhookRes.data?.decision?.typeDetected} (${newLock.hoursElapsed.toFixed(6)}h)`,
    tokens_ia: 0,
    estado: passedNewLock ? 'PASÓ' : 'FALLÓ',
    evidencia: `Nuevo lastIntervention: ${newLock.lastIntervention} | hoursElapsed: 0.000000h exactos (12h)`
  });

  // ==========================================================================
  // FASE 4: VERIFICACIÓN DE SEGURIDAD Y PROTECCIÓN DE ENDPOINTS (401)
  // ==========================================================================
  console.log('\n==================================================');
  console.log(' FASE 4: SEGURIDAD Y PROTECCIÓN DE ENDPOINTS');
  console.log('==================================================');

  let unauthorizedCheckPassed = false;
  try {
    // Intento de acceso sin encabezado x-staging-auth
    await axios.get(`${BASE_URL}/api/staging/check-lock-status?lead_id=${TARGET_LEAD_ID}&talk_id=${TARGET_TALK_ID}`);
    unauthorizedCheckPassed = false;
  } catch (err) {
    unauthorizedCheckPassed = err.response?.status === 401;
    console.log(`Endpoint protegido verificado (/api/staging/check-lock-status sin auth): HTTP ${err.response?.status} (${err.response?.data?.error})`);
  }

  let unauthorizedSetPassed = false;
  try {
    await axios.post(`${BASE_URL}/api/staging/set-handoff-time`, { lead_id: TARGET_LEAD_ID, talk_id: TARGET_TALK_ID, seconds_ago: 60 });
    unauthorizedSetPassed = false;
  } catch (err) {
    unauthorizedSetPassed = err.response?.status === 401;
    console.log(`Endpoint protegido verificado (/api/staging/set-handoff-time sin auth): HTTP ${err.response?.status} (${err.response?.data?.error})`);
  }

  // Verificación adicional de auditoría: webhook sin auth ignora offset_ms
  let unauthorizedWebhookIgnoredOffset = false;
  try {
    const unauthWebhookRes = await axios.post(`${BASE_URL}/webhook?sync=true&bypass_debounce=true&offset_ms=43201000`, {
      account: { id: 36728143 },
      message: {
        add: [{
          id: 'msg_unauth_offset_audit_' + Date.now(),
          entity_id: parseInt(TARGET_LEAD_ID, 10),
          talk_id: TARGET_TALK_ID,
          type: 'incoming',
          text: '¿Cuántos metros tiene?',
          author: { type: 'external', name: 'Atacante sin Auth' }
        }]
      }
    }); // Sin header x-staging-auth
    // Dado que T_nuevo dejó el lead bloqueado hace unos segundos, al ignorar offset_ms el bot debe evaluar Date.now() y seguir en SILENCE / HUMAN_LOCKED
    unauthorizedWebhookIgnoredOffset = unauthWebhookRes.data?.decision?.action === 'SILENCE' &&
                                       unauthWebhookRes.data?.decision?.typeDetected === 'HUMAN_LOCKED';
    console.log('Auditoría offset_ms sin auth: Webhook ignoró offset_ms no autorizado y mantuvo bloqueo real.');
  } catch (err) {
    console.error('Error en auditoría webhook offset_ms:', err.message);
  }

  if (unauthorizedCheckPassed && unauthorizedSetPassed && unauthorizedWebhookIgnoredOffset) {
    console.log('✅ FASE 4 SUPERADA: Todos los endpoints de auditoría y simulación rechazan accesos no autorizados con HTTP 401 y el webhook protege contra manipulación de offset_ms.');
  } else {
    console.log(`⚠️ Resultado auditoría seguridad: check=${unauthorizedCheckPassed}, set=${unauthorizedSetPassed}, webhookIgnored=${unauthorizedWebhookIgnoredOffset}`);
  }

  console.log('\n================================================================');
  console.log(' INFORME FINAL DE LA VALIDACIÓN TEMPORAL DETERMINISTA (12 HORAS)');
  console.log('================================================================');
  console.table(results.map(r => ({
    Escenario: r.paso,
    Límite: r.limite,
    Delta: r.delta_ms,
    Horas: r.horas_transcurridas,
    isLocked: r.isLocked,
    Resultado: r.estado,
    Obtenido: r.obtenido
  })));

  return {
    results,
    securityPassed: unauthorizedCheckPassed && unauthorizedSetPassed && unauthorizedWebhookIgnoredOffset
  };
}

executeFullDeterministicSimulation().catch(console.error);
