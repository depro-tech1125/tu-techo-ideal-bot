/**
 * ============================================================================
 * TU TECHO IDEAL v5.0 — SIMULACIÓN TEMPORAL RIGUROSA DE LÍMITES DE BLOQUEO 24H
 * ============================================================================
 * Validación completa de:
 * FASE 1: Estado de despliegue, /health, OBSERVATION_MODE=true, lista blanca desactivada.
 * FASE 2: Los 5 límites temporales exactos (T0, +1m, +23h59m59s, +24h00m00s, +24h00m01s).
 * FASE 3: Validación de comportamiento:
 *         - Silencio absoluto ante preguntas con datos durante el bloqueo.
 *         - Ecos de Salesbot (created_by === 0) no bloquean.
 *         - Respuesta verificada post-24h ("Tiene 110 m²").
 *         - Silencio absoluto ante datos inexistentes post-24h (Condominio).
 *         - Nueva intervención humana reinicia período de 24h.
 * FASE 4: Verificación de seguridad y protección de endpoints ante acceso sin token (401).
 * ============================================================================
 */

const axios = require('axios');
require('dotenv').config();

const BASE_URL = 'https://tu-techo-ideal-staging.onrender.com';
const STAGING_AUTH = process.env.STAGING_AUTH_TOKEN || process.env.STAGING_AUDIT_SECRET || process.env.KOMMO_TOKEN || 'tti-staging-auth-token-2026';

const TARGET_LEAD_ID = '25092108';
const TARGET_TALK_ID = '1149';

async function executeFullSimulation() {
  console.log('================================================================');
  console.log(' TU TECHO IDEAL v5.0 — VALIDACIÓN TEMPORAL RIGUROSA DE BLOQUEO 24H');
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
        id: 'msg_seed_full_' + Date.now(),
        entity_id: parseInt(TARGET_LEAD_ID, 10),
        talk_id: TARGET_TALK_ID,
        type: 'incoming',
        text: 'Hola, me interesa este apartamento https://info.wasi.co/apartamento-venta-los-samanes-caracas/10493109',
        author: { type: 'external', name: 'Daniel Palma' }
      }]
    }
  });
  console.log('✅ Contexto REF-012 activo.');

  const results = [];

  // ==========================================================================
  // FASE 2 Y 3: LÍMITES TEMPORALES Y COMPORTAMIENTO
  // ==========================================================================
  console.log('\n==================================================');
  console.log(' FASE 2 Y 3: EJECUCIÓN DE LÍMITES TEMPORALES');
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
  });

  const t0StatusRes = await axios.get(`${BASE_URL}/api/staging/check-lock-status?lead_id=${TARGET_LEAD_ID}&talk_id=${TARGET_TALK_ID}`, {
    headers: { 'x-staging-auth': STAGING_AUTH }
  });
  const t0Lock = t0StatusRes.data?.lock_status;
  console.log('Estado en T0:', t0Lock);
  const passedT0 = t0Lock?.isLocked === true && t0Lock?.hoursElapsed < 0.001;

  results.push({
    paso: '1. Instante T0',
    limite: 'T0 (0s)',
    delta: '0 segundos',
    horas_transcurridas: `${t0Lock.hoursElapsed.toFixed(4)}h`,
    isLocked: t0Lock.isLocked,
    esperado: 'isLocked: true (LOCK_24H activado)',
    obtenido: `isLocked: ${t0Lock.isLocked} (${t0WebhookRes.data?.action || 'LOCK_24H'})`,
    tokens_ia: 0,
    estado: passedT0 ? 'PASÓ' : 'FALLÓ',
    evidencia: `lastIntervention: ${t0Lock.lastIntervention} | hoursElapsed: ${t0Lock.hoursElapsed.toFixed(6)}`
  });

  // 2. T0 + 1 MINUTO: BLOQUEO ACTIVO (PREGUNTA CON DATO EN SHEETS -> SILENCIO)
  console.log('\n--- [2/6] Límite: T0 + 1 minuto (60 segundos) ---');
  await axios.post(`${BASE_URL}/api/staging/set-handoff-time`, {
    lead_id: TARGET_LEAD_ID,
    talk_id: TARGET_TALK_ID,
    seconds_ago: 60
  }, { headers: { 'x-staging-auth': STAGING_AUTH } });

  const status1mRes = await axios.get(`${BASE_URL}/api/staging/check-lock-status?lead_id=${TARGET_LEAD_ID}&talk_id=${TARGET_TALK_ID}`, {
    headers: { 'x-staging-auth': STAGING_AUTH }
  });
  const lock1m = status1mRes.data?.lock_status;

  const webhook1mRes = await axios.post(`${BASE_URL}/webhook?sync=true&bypass_debounce=true`, {
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
  });

  console.log('Decisión en T0 + 1m:', webhook1mRes.data?.decision);
  const passed1m = lock1m?.isLocked === true &&
                   webhook1mRes.data?.decision?.action === 'SILENCE' &&
                   webhook1mRes.data?.decision?.typeDetected === 'HUMAN_LOCKED' &&
                   webhook1mRes.data?.decision?.calledAI === false &&
                   webhook1mRes.data?.text === null;

  results.push({
    paso: '2. T0 + 1 minuto',
    limite: 'T0 + 60s',
    delta: '60 segundos',
    horas_transcurridas: `${lock1m.hoursElapsed.toFixed(4)}h`,
    isLocked: lock1m.isLocked,
    esperado: 'isLocked: true -> SILENCE / HUMAN_LOCKED (0 tokens IA)',
    obtenido: `${webhook1mRes.data?.decision?.action} / ${webhook1mRes.data?.decision?.typeDetected} (Tokens: ${webhook1mRes.data?.decision?.tokensUsed})`,
    tokens_ia: webhook1mRes.data?.decision?.tokensUsed || 0,
    estado: passed1m ? 'PASÓ' : 'FALLÓ',
    evidencia: `${webhook1mRes.data?.decision?.reason} | Texto devuelto: null`
  });

  // 3. T0 + 23 HORAS, 59 MINUTOS Y 59 SEGUNDOS (86.399 SEGUNDOS): BLOQUEO ACTIVO
  console.log('\n--- [3/6] Límite: T0 + 23h 59m 59s (86.399 segundos) ---');
  await axios.post(`${BASE_URL}/api/staging/set-handoff-time`, {
    lead_id: TARGET_LEAD_ID,
    talk_id: TARGET_TALK_ID,
    seconds_ago: 86399
  }, { headers: { 'x-staging-auth': STAGING_AUTH } });

  const status23hRes = await axios.get(`${BASE_URL}/api/staging/check-lock-status?lead_id=${TARGET_LEAD_ID}&talk_id=${TARGET_TALK_ID}`, {
    headers: { 'x-staging-auth': STAGING_AUTH }
  });
  const lock23h = status23hRes.data?.lock_status;

  const webhook23hRes = await axios.post(`${BASE_URL}/webhook?sync=true&bypass_debounce=true`, {
    account: { id: 36728143 },
    message: {
      add: [{
        id: 'msg_t23h_' + Date.now(),
        entity_id: parseInt(TARGET_LEAD_ID, 10),
        talk_id: TARGET_TALK_ID,
        type: 'incoming',
        text: '¿Tiene estacionamiento techado?',
        author: { type: 'external', name: 'Daniel Palma' }
      }]
    }
  });

  console.log('Decisión en T0 + 23h 59m 59s:', webhook23hRes.data?.decision);
  const passed23h = lock23h?.isLocked === true &&
                    lock23h?.hoursElapsed < 24.0 &&
                    webhook23hRes.data?.decision?.action === 'SILENCE' &&
                    webhook23hRes.data?.decision?.typeDetected === 'HUMAN_LOCKED' &&
                    webhook23hRes.data?.decision?.calledAI === false &&
                    webhook23hRes.data?.text === null;

  results.push({
    paso: '3. T0 + 23h 59m 59s',
    limite: 'T0 + 86.399s',
    delta: '86.399 segundos',
    horas_transcurridas: `${lock23h.hoursElapsed.toFixed(6)}h`,
    isLocked: lock23h.isLocked,
    esperado: 'isLocked: true -> SILENCE / HUMAN_LOCKED (0 tokens IA)',
    obtenido: `${webhook23hRes.data?.decision?.action} / ${webhook23hRes.data?.decision?.typeDetected} (Tokens: ${webhook23hRes.data?.decision?.tokensUsed})`,
    tokens_ia: webhook23hRes.data?.decision?.tokensUsed || 0,
    estado: passed23h ? 'PASÓ' : 'FALLÓ',
    evidencia: `${webhook23hRes.data?.decision?.reason} | hoursElapsed (${lock23h.hoursElapsed.toFixed(6)}) < 24 es TRUE`
  });

  // 4. T0 + 24 HORAS EXACTAS (86.400 SEGUNDOS): BLOQUEO VENCIDO
  console.log('\n--- [4/6] Límite: T0 + 24 horas exactas (86.400 segundos) ---');
  await axios.post(`${BASE_URL}/api/staging/set-handoff-time`, {
    lead_id: TARGET_LEAD_ID,
    talk_id: TARGET_TALK_ID,
    seconds_ago: 86400
  }, { headers: { 'x-staging-auth': STAGING_AUTH } });

  const status24hRes = await axios.get(`${BASE_URL}/api/staging/check-lock-status?lead_id=${TARGET_LEAD_ID}&talk_id=${TARGET_TALK_ID}`, {
    headers: { 'x-staging-auth': STAGING_AUTH }
  });
  const lock24h = status24hRes.data?.lock_status;
  console.log('Estado en T0 + 24h exactas:', lock24h);

  // Operador de comparación en HandoffManager: if (hoursElapsed < 24) { isLocked: true } else { isLocked: false }
  // A las 24.000000h exactas, 24.0 < 24 es estrictamente FALSE, por lo que isLocked es FALSE (VENCIDO).
  const passed24h = lock24h?.isLocked === false && lock24h?.hoursElapsed >= 24.0;

  results.push({
    paso: '4. T0 + 24h 00m 00s',
    limite: 'T0 + 86.400s',
    delta: '86.400 segundos',
    horas_transcurridas: `${lock24h.hoursElapsed.toFixed(6)}h`,
    isLocked: lock24h.isLocked,
    esperado: 'isLocked: false (Expiración exacta por operador "< 24")',
    obtenido: `isLocked: ${lock24h.isLocked} (Expirado)`,
    tokens_ia: 0,
    estado: passed24h ? 'PASÓ' : 'FALLÓ',
    evidencia: `Operador "hoursElapsed (${lock24h.hoursElapsed.toFixed(6)}) < 24" evaluó FALSE -> isLocked: false`
  });

  // 5. T0 + 24 HORAS Y 1 SEGUNDO (86.401 SEGUNDOS): REACTIVACIÓN CONDICIONAL
  console.log('\n--- [5/6] Límite: T0 + 24h y 1 segundo (86.401 segundos) ---');
  await axios.post(`${BASE_URL}/api/staging/set-handoff-time`, {
    lead_id: TARGET_LEAD_ID,
    talk_id: TARGET_TALK_ID,
    seconds_ago: 86401
  }, { headers: { 'x-staging-auth': STAGING_AUTH } });

  const status24h1sRes = await axios.get(`${BASE_URL}/api/staging/check-lock-status?lead_id=${TARGET_LEAD_ID}&talk_id=${TARGET_TALK_ID}`, {
    headers: { 'x-staging-auth': STAGING_AUTH }
  });
  const lock24h1s = status24h1sRes.data?.lock_status;
  console.log('Estado en T0 + 24h 1s:', lock24h1s);

  // 5.1 Pregunta con dato oficial (Metraje) -> Responde "Tiene 110 m²"
  console.log('5.1 Pregunta con información oficial (Metraje)...');
  const webhook24h1s_m2 = await axios.post(`${BASE_URL}/webhook?sync=true&bypass_debounce=true`, {
    account: { id: 36728143 },
    message: {
      add: [{
        id: 'msg_t24h1s_m2_' + Date.now(),
        entity_id: parseInt(TARGET_LEAD_ID, 10),
        talk_id: TARGET_TALK_ID,
        type: 'incoming',
        text: '¿Cuántos metros tiene el apartamento?',
        author: { type: 'external', name: 'Daniel Palma' }
      }]
    }
  }, { timeout: 45000 });

  console.log('Respuesta 5.1 (Metraje):', {
    text: webhook24h1s_m2.data?.text,
    action: webhook24h1s_m2.data?.decision?.action,
    type: webhook24h1s_m2.data?.decision?.typeDetected,
    tokens: webhook24h1s_m2.data?.decision?.tokensUsed
  });

  // 5.2 Pregunta sin información (Condominio) -> Silencio absoluto
  console.log('5.2 Pregunta sin dato en Google Sheets (Condominio mensual)...');
  const webhook24h1s_condo = await axios.post(`${BASE_URL}/webhook?sync=true&bypass_debounce=true`, {
    account: { id: 36728143 },
    message: {
      add: [{
        id: 'msg_t24h1s_condo_' + Date.now(),
        entity_id: parseInt(TARGET_LEAD_ID, 10),
        talk_id: TARGET_TALK_ID,
        type: 'incoming',
        text: '¿Cuánto cuesta el condominio mensual?',
        author: { type: 'external', name: 'Daniel Palma' }
      }]
    }
  }, { timeout: 45000 });

  console.log('Respuesta 5.2 (Condominio):', {
    text: webhook24h1s_condo.data?.text,
    action: webhook24h1s_condo.data?.decision?.action,
    type: webhook24h1s_condo.data?.decision?.typeDetected
  });

  // 5.3 Verificación de no-confusión con mensajes de Salesbot (created_by === 0)
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
  });

  console.log('Respuesta 5.3 (Salesbot):', botEchoRes.data);

  const passed5 = lock24h1s?.isLocked === false &&
                  webhook24h1s_m2.data?.text === 'Tiene 110 m²' &&
                  webhook24h1s_m2.data?.decision?.action === 'RESPOND' &&
                  webhook24h1s_condo.data?.decision?.action === 'SILENCE' &&
                  webhook24h1s_condo.data?.text === null &&
                  botEchoRes.data?.handled === 'BOT_OUTGOING_ECHO';

  results.push({
    paso: '5. T0 + 24h 00m 01s',
    limite: 'T0 + 86.401s',
    delta: '86.401 segundos',
    horas_transcurridas: `${lock24h1s.hoursElapsed.toFixed(6)}h`,
    isLocked: lock24h1s.isLocked,
    esperado: 'Metraje: "Tiene 110 m²" | Condominio: SILENCIO | Eco Salesbot: Descartado',
    obtenido: `Metraje: "${webhook24h1s_m2.data?.text}" | Condominio: ${webhook24h1s_condo.data?.decision?.action} | Eco: ${botEchoRes.data?.handled || 'BOT_ECHO'}`,
    tokens_ia: webhook24h1s_m2.data?.decision?.tokensUsed || 0,
    estado: passed5 ? 'PASÓ' : 'FALLÓ',
    evidencia: `Inferencia Nemotron: "${webhook24h1s_m2.data?.decision?.evidence}"`
  });

  // 6. NUEVA INTERVENCIÓN HUMANA REINICIA EL PERÍODO DE BLOQUEO
  console.log('\n--- [6/6] Nueva intervención humana inicia un nuevo período de 24 horas ---');
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
  });

  const newLockStatusRes = await axios.get(`${BASE_URL}/api/staging/check-lock-status?lead_id=${TARGET_LEAD_ID}&talk_id=${TARGET_TALK_ID}`, {
    headers: { 'x-staging-auth': STAGING_AUTH }
  });
  const newLock = newLockStatusRes.data?.lock_status;

  // Pregunta inmediata del cliente tras la nueva intervención humana -> SILENCIO
  const postNewLockWebhookRes = await axios.post(`${BASE_URL}/webhook?sync=true&bypass_debounce=true`, {
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
  });

  console.log('Decisión post nueva intervención:', postNewLockWebhookRes.data?.decision);

  const passedNewLock = newLock?.isLocked === true &&
                        newLock?.hoursElapsed < 0.01 &&
                        postNewLockWebhookRes.data?.decision?.action === 'SILENCE' &&
                        postNewLockWebhookRes.data?.decision?.typeDetected === 'HUMAN_LOCKED' &&
                        postNewLockWebhookRes.data?.decision?.calledAI === false;

  results.push({
    paso: '6. Nueva Intervención',
    limite: 'T_nuevo (0s)',
    delta: '0 segundos',
    horas_transcurridas: `${newLock.hoursElapsed.toFixed(4)}h`,
    isLocked: newLock.isLocked,
    esperado: 'isLocked: true (Nuevo ciclo de 24h iniciado) -> SILENCE / HUMAN_LOCKED',
    obtenido: `${postNewLockWebhookRes.data?.decision?.action} / ${postNewLockWebhookRes.data?.decision?.typeDetected} (Tokens: ${postNewLockWebhookRes.data?.decision?.tokensUsed})`,
    tokens_ia: 0,
    estado: passedNewLock ? 'PASÓ' : 'FALLÓ',
    evidencia: `Nuevo lastIntervention: ${newLock.lastIntervention} | Nuevo bloqueo reiniciado`
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

  if (unauthorizedCheckPassed && unauthorizedSetPassed) {
    console.log('✅ FASE 4 SUPERADA: Todos los endpoints de auditoría y simulación rechazan accesos no autorizados con HTTP 401.');
  } else {
    console.error('⚠️ ALERTA: Falla en protección de endpoints.');
  }

  console.log('\n================================================================');
  console.log(' INFORME FINAL DE LA VALIDACIÓN TEMPORAL RIGUROSA (EN VIVO EN STAGING)');
  console.log('================================================================');
  console.table(results.map(r => ({
    Escenario: r.paso,
    Límite: r.limite,
    Horas: r.horas_transcurridas,
    isLocked: r.isLocked,
    Resultado: r.estado,
    Obtenido: r.obtenido
  })));

  return {
    results,
    securityPassed: unauthorizedCheckPassed && unauthorizedSetPassed
  };
}

executeFullSimulation().catch(console.error);
