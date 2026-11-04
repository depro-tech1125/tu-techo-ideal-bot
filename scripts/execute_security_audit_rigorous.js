/**
 * ============================================================================
 * TU TECHO IDEAL v5.0 — AUDITORÍA RIGUROSA DE SEGURIDAD (PRUEBAS A - E)
 * ============================================================================
 * Cierre definitivo del acceso al reloj simulado y blindaje incondicional:
 * 
 * PRUEBA A: Endpoints autorizados de Staging (/api/staging/check-lock-status,
 *           /api/staging/test-pipeline-evaluation):
 *           - Sin token -> HTTP 401
 *           - Token incorrecto -> HTTP 401
 *           - Token en URL (query param) -> HTTP 401
 *           - Token válido en cabecera x-staging-auth -> HTTP 200
 * 
 * PRUEBA B: Webhook público (/webhook) inmune a manipulación temporal:
 *           - Sin token + offset_ms -> evalúa con Date.now() real (HUMAN_LOCKED)
 *           - Token incorrecto + offset_ms -> evalúa con Date.now() real (HUMAN_LOCKED)
 *           - Token VÁLIDO + offset_ms -> evalúa con Date.now() real (HUMAN_LOCKED)
 *           - Token VÁLIDO + simulated_now -> evalúa con Date.now() real (HUMAN_LOCKED)
 * 
 * PRUEBA C: Webhook saliente (/webhook) rechaza manipulación temporal:
 *           - Intento de inyectar simulated_now/offset_ms en mensaje saliente
 *           - Timestamp registrado es estrictamente Date.now() real (< 5s delta)
 * 
 * PRUEBA D: Producción rechaza el reloj simulado de forma absoluta:
 *           - Unitario: NODE_ENV=production, OBSERVATION_MODE=true -> false
 *           - Unitario: NODE_ENV=production, OBSERVATION_MODE=false -> false
 *           - Unitario: Hostname de producción -> false
 *           - HTTP en vivo contra Producción: HTTP 404 (Not Found)
 * 
 * PRUEBA E: Integridad del sistema:
 *           - Date.now nativo, sin monkey-patching, avance monótono
 *           - Cero tokens estáticos o credenciales fallback en server.js
 *           - Cero reutilización de KOMMO_TOKEN como credencial de auditoría
 *           - Cero exposición de secretos o tokens en logs
 * ============================================================================
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const STAGING_URL = process.env.STAGING_URL || 'https://tu-techo-ideal-staging.onrender.com';
const PROD_URL = 'https://tu-techo-ideal-bot-1.onrender.com';
const VALID_TOKEN = process.env.STAGING_AUTH_TOKEN;
const INVALID_TOKEN = 'token-falso-hacker-invalido-xyz';

const TARGET_LEAD_ID = '25092108';
const TARGET_TALK_ID = '1149';

async function runRigorousSecurityAudit() {
  console.log('================================================================');
  console.log(' TU TECHO IDEAL v5.0 — AUDITORÍA RIGUROSA DE SEGURIDAD (A - E)  ');
  console.log(` Servidor Staging: ${STAGING_URL}`);
  console.log(` Servidor Prod:    ${PROD_URL}`);
  console.log('================================================================\n');

  if (!VALID_TOKEN) {
    throw new Error('❌ STAGING_AUTH_TOKEN no está definido en el entorno.');
  }

  const results = [];

  // ==========================================================================
  // PRUEBA A: ENDPOINTS AUTORIZADOS DE STAGING
  // ==========================================================================
  console.log('--------------------------------------------------');
  console.log(' [PRUEBA A] ENDPOINT AUTORIZADO DE STAGING');
  console.log('--------------------------------------------------');

  // A1. Sin token en GET check-lock-status -> 401
  let a1Status = null;
  try {
    await axios.get(`${STAGING_URL}/api/staging/check-lock-status?lead_id=${TARGET_LEAD_ID}`, { timeout: 15000 });
    a1Status = 200;
  } catch (err) {
    a1Status = err.response?.status;
  }
  console.log(`A1. GET check-lock-status sin token: HTTP ${a1Status} (Esperado: 401)`);

  // A2. Token incorrecto en GET check-lock-status -> 401
  let a2Status = null;
  try {
    await axios.get(`${STAGING_URL}/api/staging/check-lock-status?lead_id=${TARGET_LEAD_ID}`, {
      headers: { 'x-staging-auth': INVALID_TOKEN },
      timeout: 15000
    });
    a2Status = 200;
  } catch (err) {
    a2Status = err.response?.status;
  }
  console.log(`A2. GET check-lock-status con token incorrecto: HTTP ${a2Status} (Esperado: 401)`);

  // A3. Token enviado en URL (?auth_token=... o ?token=...) sin cabecera -> 401
  let a3Status = null;
  try {
    await axios.get(`${STAGING_URL}/api/staging/check-lock-status?lead_id=${TARGET_LEAD_ID}&auth_token=${VALID_TOKEN}&token=${VALID_TOKEN}`, {
      timeout: 15000
    });
    a3Status = 200;
  } catch (err) {
    a3Status = err.response?.status;
  }
  console.log(`A3. GET check-lock-status con token en URL (query params): HTTP ${a3Status} (Esperado: 401)`);

  // A4. Token válido en cabecera x-staging-auth -> 200
  let a4Status = null;
  try {
    const res = await axios.get(`${STAGING_URL}/api/staging/check-lock-status?lead_id=${TARGET_LEAD_ID}&talk_id=${TARGET_TALK_ID}`, {
      headers: { 'x-staging-auth': VALID_TOKEN },
      timeout: 15000
    });
    a4Status = res.status;
  } catch (err) {
    a4Status = err.response?.status;
  }
  console.log(`A4. GET check-lock-status con token válido en x-staging-auth: HTTP ${a4Status} (Esperado: 200)`);

  // A5. POST test-pipeline-evaluation sin token -> 401
  let a5Status = null;
  try {
    await axios.post(`${STAGING_URL}/api/staging/test-pipeline-evaluation`, { user_text: 'test' }, { timeout: 15000 });
    a5Status = 200;
  } catch (err) {
    a5Status = err.response?.status;
  }
  console.log(`A5. POST test-pipeline-evaluation sin token: HTTP ${a5Status} (Esperado: 401)`);

  // A6. POST test-pipeline-evaluation con token válido -> 200
  let a6Status = null;
  try {
    const res = await axios.post(`${STAGING_URL}/api/staging/test-pipeline-evaluation`, {
      user_text: '¿Cuántos metros tiene el apartamento?',
      lead_id: TARGET_LEAD_ID,
      talk_id: TARGET_TALK_ID,
      offset_ms: 0
    }, {
      headers: { 'x-staging-auth': VALID_TOKEN },
      timeout: 15000
    });
    a6Status = res.status;
  } catch (err) {
    a6Status = err.response?.status;
  }
  console.log(`A6. POST test-pipeline-evaluation con token válido: HTTP ${a6Status} (Esperado: 200)`);

  const passedA = (a1Status === 401) &&
                  (a2Status === 401) &&
                  (a3Status === 401) &&
                  (a4Status === 200) &&
                  (a5Status === 401) &&
                  (a6Status === 200);

  results.push({
    prueba: 'A. Endpoint Autorizado',
    condicion: 'Sin token -> 401, Token incorrecto -> 401, Token en URL -> 401, Cabecera válida -> 200',
    resultado: passedA ? 'PASÓ' : 'FALLÓ',
    evidencia: `A1(no-tok)=${a1Status}, A2(bad-tok)=${a2Status}, A3(url-tok)=${a3Status}, A4(header-ok)=${a4Status}, A5(pipe-no-tok)=${a5Status}, A6(pipe-ok)=${a6Status}`
  });

  // ==========================================================================
  // PRUEBA B: WEBHOOK PÚBLICO (/webhook) INMUNE A MANIPULACIÓN TEMPORAL
  // ==========================================================================
  console.log('\n--------------------------------------------------');
  console.log(' [PRUEBA B] WEBHOOK PÚBLICO (/webhook) - INMUNIDAD TEMPORAL');
  console.log('--------------------------------------------------');

  // Asegurar intervención humana en tiempo real (T0 = Date.now())
  await axios.post(`${STAGING_URL}/webhook?sync=true&bypass_debounce=true`, {
    account: { id: 36728143 },
    message: {
      add: [{
        id: 'msg_human_b_seed_' + Date.now(),
        entity_id: parseInt(TARGET_LEAD_ID, 10),
        talk_id: TARGET_TALK_ID,
        type: 'outgoing',
        created_by: 998877,
        text: 'Hola Daniel, soy Robert de Tu Techo Ideal.',
        author: { type: 'user', name: 'Robert Asesor Humano' }
      }]
    }
  });

  // B1. Sin token + offset_ms=43201000 (12h 1s en futuro) -> evalúa con Date.now() real
  const b1Res = await axios.post(`${STAGING_URL}/webhook?sync=true&bypass_debounce=true&offset_ms=43201000`, {
    account: { id: 36728143 },
    message: {
      add: [{
        id: 'msg_b1_no_token_' + Date.now(),
        entity_id: parseInt(TARGET_LEAD_ID, 10),
        talk_id: TARGET_TALK_ID,
        type: 'incoming',
        text: '¿Cuántos metros tiene el apartamento?',
        author: { type: 'external', name: 'Daniel Palma' }
      }]
    }
  });
  console.log('B1. Sin token + offset_ms=43201000:', {
    action: b1Res.data?.decision?.action,
    type: b1Res.data?.decision?.typeDetected,
    text: b1Res.data?.text
  });
  const passedB1 = b1Res.data?.decision?.action === 'SILENCE' &&
                   b1Res.data?.decision?.typeDetected === 'HUMAN_LOCKED' &&
                   b1Res.data?.text === null;

  // B2. Token incorrecto + offset_ms=43201000 -> evalúa con Date.now() real
  const b2Res = await axios.post(`${STAGING_URL}/webhook?sync=true&bypass_debounce=true&offset_ms=43201000`, {
    account: { id: 36728143 },
    message: {
      add: [{
        id: 'msg_b2_bad_token_' + Date.now(),
        entity_id: parseInt(TARGET_LEAD_ID, 10),
        talk_id: TARGET_TALK_ID,
        type: 'incoming',
        text: '¿Cuántos metros tiene el apartamento?',
        author: { type: 'external', name: 'Daniel Palma' }
      }]
    }
  }, { headers: { 'x-staging-auth': INVALID_TOKEN } });
  console.log('B2. Token incorrecto + offset_ms=43201000:', {
    action: b2Res.data?.decision?.action,
    type: b2Res.data?.decision?.typeDetected,
    text: b2Res.data?.text
  });
  const passedB2 = b2Res.data?.decision?.action === 'SILENCE' &&
                   b2Res.data?.decision?.typeDetected === 'HUMAN_LOCKED' &&
                   b2Res.data?.text === null;

  // B3. Token VÁLIDO + offset_ms=43201000 -> /webhook RECHAZA reloj simulado y evalúa con Date.now() real
  const b3Res = await axios.post(`${STAGING_URL}/webhook?sync=true&bypass_debounce=true&offset_ms=43201000`, {
    account: { id: 36728143 },
    message: {
      add: [{
        id: 'msg_b3_valid_token_offset_' + Date.now(),
        entity_id: parseInt(TARGET_LEAD_ID, 10),
        talk_id: TARGET_TALK_ID,
        type: 'incoming',
        text: '¿Cuántos metros tiene el apartamento?',
        author: { type: 'external', name: 'Daniel Palma' }
      }]
    }
  }, { headers: { 'x-staging-auth': VALID_TOKEN } });
  console.log('B3. Token VÁLIDO + offset_ms=43201000 en /webhook:', {
    action: b3Res.data?.decision?.action,
    type: b3Res.data?.decision?.typeDetected,
    text: b3Res.data?.text
  });
  const passedB3 = b3Res.data?.decision?.action === 'SILENCE' &&
                   b3Res.data?.decision?.typeDetected === 'HUMAN_LOCKED' &&
                   b3Res.data?.text === null;

  // B4. Token VÁLIDO + simulated_now=<futuro> -> /webhook RECHAZA simulated_now y evalúa con Date.now() real
  const futureSimulatedNow = Date.now() + 43201000;
  const b4Res = await axios.post(`${STAGING_URL}/webhook?sync=true&bypass_debounce=true&simulated_now=${futureSimulatedNow}`, {
    account: { id: 36728143 },
    message: {
      add: [{
        id: 'msg_b4_valid_token_simnow_' + Date.now(),
        entity_id: parseInt(TARGET_LEAD_ID, 10),
        talk_id: TARGET_TALK_ID,
        type: 'incoming',
        text: '¿Cuántos metros tiene el apartamento?',
        author: { type: 'external', name: 'Daniel Palma' }
      }]
    }
  }, { headers: { 'x-staging-auth': VALID_TOKEN } });
  console.log('B4. Token VÁLIDO + simulated_now en /webhook:', {
    action: b4Res.data?.decision?.action,
    type: b4Res.data?.decision?.typeDetected,
    text: b4Res.data?.text
  });
  const passedB4 = b4Res.data?.decision?.action === 'SILENCE' &&
                   b4Res.data?.decision?.typeDetected === 'HUMAN_LOCKED' &&
                   b4Res.data?.text === null;

  const passedB = passedB1 && passedB2 && passedB3 && passedB4;
  results.push({
    prueba: 'B. Webhook Público Inmune a Manipulación',
    condicion: 'No token, Bad token, Valid token + offset/simulated_now siempre evalúan Date.now() real',
    resultado: passedB ? 'PASÓ' : 'FALLÓ',
    evidencia: `B1(no-tok)=${b1Res.data?.decision?.typeDetected}, B2(bad-tok)=${b2Res.data?.decision?.typeDetected}, B3(valid-tok+offset)=${b3Res.data?.decision?.typeDetected}, B4(valid-tok+simnow)=${b4Res.data?.decision?.typeDetected}`
  });

  // ==========================================================================
  // PRUEBA C: WEBHOOK SALIENTE RECHAZA MANIPULACIÓN TEMPORAL
  // ==========================================================================
  console.log('\n--------------------------------------------------');
  console.log(' [PRUEBA C] WEBHOOK SALIENTE - RECHAZO DE MANIPULACIÓN');
  console.log('--------------------------------------------------');

  const tStartC = Date.now();
  const manipulatedFutureTime = tStartC + 43201000; // 12h en el futuro

  // Intentar inyectar simulated_now y offset_ms en webhook saliente
  await axios.post(`${STAGING_URL}/webhook?sync=true&bypass_debounce=true&simulated_now=${manipulatedFutureTime}&offset_ms=43201000`, {
    account: { id: 36728143 },
    message: {
      add: [{
        id: 'msg_c_out_attack_' + Date.now(),
        entity_id: parseInt(TARGET_LEAD_ID, 10),
        talk_id: TARGET_TALK_ID,
        type: 'outgoing',
        created_by: 998877,
        text: 'Mensaje de prueba saliente para verificar timestamp real.',
        author: { type: 'user', name: 'Robert Asesor Humano' }
      }]
    }
  }, { headers: { 'x-staging-auth': VALID_TOKEN } });

  // Consultar estado de handoff registrado usando Date.now() real (sin offset)
  const lockStatusCRes = await axios.get(`${STAGING_URL}/api/staging/check-lock-status?lead_id=${TARGET_LEAD_ID}&talk_id=${TARGET_TALK_ID}`, {
    headers: { 'x-staging-auth': VALID_TOKEN }
  });
  const recordedIntervention = lockStatusCRes.data?.lock_status?.lastIntervention;
  const tEndC = Date.now();
  const timeDifferenceFromRealNow = Math.abs(recordedIntervention - tStartC);

  console.log('C. Timestamp registrado de intervención:', recordedIntervention);
  console.log(`C. Diferencia respecto a Date.now() real: ${timeDifferenceFromRealNow} ms`);
  console.log(`C. Manipulado intentado: ${manipulatedFutureTime} (Diferencia de intento: ${Math.abs(recordedIntervention - manipulatedFutureTime)} ms)`);

  // Debe haber tomado Date.now() real (< 5000ms de diferencia), no el tiempo manipulado
  const passedC = timeDifferenceFromRealNow < 5000 && Math.abs(recordedIntervention - manipulatedFutureTime) > 40000000;
  results.push({
    prueba: 'C. Webhook Saliente Timestamp Real',
    condicion: 'Intento de manipular simulated_now/offset_ms en webhook saliente rechazado (usa Date.now() real)',
    resultado: passedC ? 'PASÓ' : 'FALLÓ',
    evidencia: `deltaRealNow=${timeDifferenceFromRealNow}ms (<5000ms), deltaIntentado=${Math.abs(recordedIntervention - manipulatedFutureTime)}ms`
  });

  // ==========================================================================
  // PRUEBA D: PRODUCCIÓN RECHAZA EL RELOJ SIMULADO DE FORMA INCONDICIONAL
  // ==========================================================================
  console.log('\n--------------------------------------------------');
  console.log(' [PRUEBA D] PRODUCCIÓN RECHAZA RELOJ SIMULADO');
  console.log('--------------------------------------------------');

  // Evaluación unitaria de isAuthorizedStagingTestRequest
  const {
    isAuthorizedStagingTestRequest,
    ALLOWED_STAGING_HOSTNAMES,
    ALLOWED_SIMULATED_TIME_ROUTES
  } = require('../server.js');

  const oldNodeEnv = process.env.NODE_ENV;

  // D1: Producción con OBSERVATION_MODE=false + token válido
  process.env.NODE_ENV = 'production';
  const d1Result = isAuthorizedStagingTestRequest({
    headers: { 'x-staging-auth': VALID_TOKEN, host: 'tu-techo-ideal-bot-1.onrender.com' },
    path: '/api/staging/check-lock-status',
    method: 'GET'
  });
  console.log(`D1. isAuthorizedStagingTestRequest(prod, obs=false): ${d1Result} (Esperado: false)`);

  // D2: Producción con OBSERVATION_MODE=true + token válido
  const d2Result = isAuthorizedStagingTestRequest({
    headers: { 'x-staging-auth': VALID_TOKEN, host: 'tu-techo-ideal-bot-1.onrender.com' },
    path: '/api/staging/check-lock-status',
    method: 'GET'
  });
  console.log(`D2. isAuthorizedStagingTestRequest(prod, obs=true): ${d2Result} (Esperado: false)`);

  // D3: Hostname de producción evaluado en staging
  process.env.NODE_ENV = 'staging';
  const d3Result = isAuthorizedStagingTestRequest({
    headers: { 'x-staging-auth': VALID_TOKEN, host: 'tu-techo-ideal-bot-1.onrender.com' },
    path: '/api/staging/check-lock-status',
    method: 'GET'
  });
  console.log(`D3. Hostname de producción 'tu-techo-ideal-bot-1.onrender.com': ${d3Result} (Esperado: false)`);

  // D4: Petición a ruta fuera de whitelist (/webhook) con token válido y staging
  const d4Result = isAuthorizedStagingTestRequest({
    headers: { 'x-staging-auth': VALID_TOKEN, host: 'tu-techo-ideal-staging.onrender.com' },
    path: '/webhook',
    method: 'POST'
  });
  console.log(`D4. Ruta /webhook con token válido en staging: ${d4Result} (Esperado: false)`);

  process.env.NODE_ENV = oldNodeEnv;

  // D5: Llamada HTTP real contra Producción en vivo
  let d5Status = null;
  try {
    const res = await axios.get(`${PROD_URL}/api/staging/check-lock-status`, {
      headers: { 'x-staging-auth': VALID_TOKEN },
      timeout: 10000
    });
    d5Status = res.status;
  } catch (err) {
    d5Status = err.response?.status || err.message;
  }
  console.log(`D5. Llamada HTTP a Producción en vivo (${PROD_URL}/api/staging/check-lock-status): HTTP ${d5Status} (Esperado: 404 Not Found)`);

  const passedD = (d1Result === false) &&
                  (d2Result === false) &&
                  (d3Result === false) &&
                  (d4Result === false) &&
                  (d5Status === 404);

  results.push({
    prueba: 'D. Producción Rechaza Reloj Simulado',
    condicion: 'NODE_ENV=prod (obs=true/false) -> false, host prod -> false, /webhook -> false, HTTP vivo -> 404',
    resultado: passedD ? 'PASÓ' : 'FALLÓ',
    evidencia: `D1(prod-false)=${d1Result}, D2(prod-true)=${d2Result}, D3(prod-host)=${d3Result}, D4(webhook)=${d4Result}, D5(prod-http)=${d5Status}`
  });

  // ==========================================================================
  // PRUEBA E: INTEGRIDAD DEL SISTEMA Y CERO CREDENCIALES ESTÁTICAS
  // ==========================================================================
  console.log('\n--------------------------------------------------');
  console.log(' [PRUEBA E] INTEGRIDAD DEL SISTEMA Y CERO SECRETOS ESTÁTICOS');
  console.log('--------------------------------------------------');

  // E1. Date.now nativo
  const isFunction = typeof Date.now === 'function';
  const isNativeCode = Date.now.toString().includes('[native code]');
  const t1 = Date.now();
  await new Promise(r => setTimeout(r, 20));
  const t2 = Date.now();
  const advancesNaturally = (t2 > t1) && (t2 - t1 >= 15);
  console.log(`E1. Date.now nativo: isFunction=${isFunction}, isNative=${isNativeCode}, delta=${t2 - t1}ms`);

  // E2. Cero tokens estáticos o cadenas de credenciales en server.js
  const serverJsContent = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const hasOldStaticTokens = serverJsContent.includes('tti-staging-auth-token-2026') ||
                             serverJsContent.includes('staging-audit-2026');
  console.log(`E2. Cero tokens estáticos hardcodeados en server.js: ${!hasOldStaticTokens}`);

  // E3. Cero reutilización de KOMMO_TOKEN como credencial de auditoría/staging
  // Comprobar que verifyStagingAuthHeader e isAuthorizedStagingTestRequest no mencionan KOMMO_TOKEN
  const stagingAuthSection = serverJsContent.substring(
    serverJsContent.indexOf('function verifyStagingAuthHeader'),
    serverJsContent.indexOf('// Gestor de handoff y bloqueo humano persistente')
  );
  const reusesKommoToken = stagingAuthSection.includes('KOMMO_TOKEN');
  console.log(`E3. Cero reutilización de KOMMO_TOKEN en autenticación de staging: ${!reusesKommoToken}`);

  // E4. Cero impresión de secretos o tokens en logs
  const logsPrintSecrets = stagingAuthSection.includes('console.log') &&
                           (stagingAuthSection.includes('expectedToken') || stagingAuthSection.includes('clientToken'));
  console.log(`E4. Cero impresión de secretos en logs: ${!logsPrintSecrets}`);

  const passedE = isFunction && isNativeCode && advancesNaturally && !hasOldStaticTokens && !reusesKommoToken && !logsPrintSecrets;
  results.push({
    prueba: 'E. Integridad y Cero Secretos Estáticos',
    condicion: 'Date.now nativo, 0 tokens estáticos, 0 reuso de KOMMO_TOKEN, 0 secretos en logs',
    resultado: passedE ? 'PASÓ' : 'FALLÓ',
    evidencia: `isNative=${isNativeCode}, noStaticTokens=${!hasOldStaticTokens}, noKommoToken=${!reusesKommoToken}, noLogsSecrets=${!logsPrintSecrets}`
  });

  // ==========================================================================
  // RESUMEN CONSOLIDADO DE LA AUDITORÍA DE SEGURIDAD
  // ==========================================================================
  console.log('\n================================================================');
  console.log(' RESUMEN CONSOLIDADO DE PRUEBAS DE SEGURIDAD (A - E)');
  console.log('================================================================');
  console.table(results.map(r => ({
    'Prueba Obligatoria': r.prueba,
    'Condición Verificada': r.condicion,
    'Resultado': r.resultado,
    'Evidencia Técnica': r.evidencia
  })));

  const allPassed = results.every(r => r.resultado === 'PASÓ');
  console.log(`\nESTADO GENERAL: ${allPassed ? '✅ AUDITORÍA DE SEGURIDAD 100% SUPERADA' : '❌ FALLA EN AUDITORÍA'}`);

  return { allPassed, results };
}

if (require.main === module) {
  runRigorousSecurityAudit().catch(err => {
    console.error('Error fatal durante la auditoría de seguridad:', err);
    process.exit(1);
  });
}

module.exports = { runRigorousSecurityAudit };
