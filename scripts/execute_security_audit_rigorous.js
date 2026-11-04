/**
 * ============================================================================
 * TU TECHO IDEAL v5.0 — SUITE DEFINITIVA DE AUDITORÍA Y AISLAMIENTO (A - H)
 * ============================================================================
 * Pruebas Obligatorias:
 * A. NODE_ENV=staging + hostname autorizado + token válido: permitido (HTTP 200 / true).
 * B. NODE_ENV=development + hostname localhost: rechazado (false / 404).
 * C. NODE_ENV=production + token válido: rechazado (false / HTTP 404).
 * D. Hostname diferente al autorizado: rechazado (false / HTTP 404).
 * E. Token enviado mediante URL (?auth_token=... o ?token=...): rechazado (HTTP 401).
 * F. Token incorrecto (cabecera x-staging-auth falsa): rechazado (HTTP 401).
 * G. Token válido en /webhook con offset_ms: reloj real, sin simulación (HUMAN_LOCKED).
 * H. Token válido en /webhook con simulated_now: reloj real, sin simulación (HUMAN_LOCKED).
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

async function runDefinitiveSecuritySuite() {
  console.log('================================================================');
  console.log(' TU TECHO IDEAL v5.0 — SUITE DEFINITIVA DE SEGURIDAD (A - H)    ');
  console.log(` Servidor Staging: ${STAGING_URL}`);
  console.log(` Servidor Prod:    ${PROD_URL}`);
  console.log('================================================================\n');

  if (!VALID_TOKEN) {
    throw new Error('❌ STAGING_AUTH_TOKEN no está definido en el entorno.');
  }

  const results = [];
  const { isAuthorizedStagingTestRequest } = require('../server.js');
  const originalNodeEnv = process.env.NODE_ENV;

  // --------------------------------------------------------------------------
  // PRUEBA A: NODE_ENV=staging + hostname autorizado + token válido: PERMITIDO
  // --------------------------------------------------------------------------
  console.log('--------------------------------------------------');
  console.log(' [PRUEBA A] NODE_ENV=staging + HOST AUTORIZADO + TOKEN VÁLIDO');
  console.log('--------------------------------------------------');

  process.env.NODE_ENV = 'staging';
  const aUnit = isAuthorizedStagingTestRequest({
    headers: { host: 'tu-techo-ideal-staging.onrender.com', 'x-staging-auth': VALID_TOKEN },
    path: '/api/staging/check-lock-status',
    method: 'GET'
  });
  console.log(`A. Unitario (NODE_ENV=staging, host oficial, token válido): ${aUnit} (Esperado: true)`);

  let aHttpStatus = null;
  try {
    const res = await axios.get(`${STAGING_URL}/api/staging/check-lock-status?lead_id=${TARGET_LEAD_ID}&talk_id=${TARGET_TALK_ID}`, {
      headers: { 'x-staging-auth': VALID_TOKEN },
      timeout: 15000
    });
    aHttpStatus = res.status;
  } catch (err) {
    aHttpStatus = err.response?.status || err.message;
  }
  console.log(`A. HTTP en vivo a Staging con cabecera válida: HTTP ${aHttpStatus} (Esperado: 200)`);

  const passedA = (aUnit === true) && (aHttpStatus === 200);
  results.push({
    item: 'A. Staging + Host Autorizado + Token Válido',
    condicion: 'NODE_ENV=staging + host oficial + cabecera x-staging-auth válida -> Permitido',
    resultado: passedA ? 'PASÓ' : 'FALLÓ',
    evidencia: `Unitario=${aUnit}, HTTP=${aHttpStatus}`
  });

  // --------------------------------------------------------------------------
  // PRUEBA B: NODE_ENV=development + hostname localhost: RECHAZADO
  // --------------------------------------------------------------------------
  console.log('\n--------------------------------------------------');
  console.log(' [PRUEBA B] NODE_ENV=development + HOST LOCALHOST: RECHAZADO');
  console.log('--------------------------------------------------');

  process.env.NODE_ENV = 'development';
  const bUnitDevLocal = isAuthorizedStagingTestRequest({
    headers: { host: 'localhost:3000', 'x-staging-auth': VALID_TOKEN },
    path: '/api/staging/check-lock-status',
    method: 'GET'
  });
  const bUnitDevStagingHost = isAuthorizedStagingTestRequest({
    headers: { host: 'tu-techo-ideal-staging.onrender.com', 'x-staging-auth': VALID_TOKEN },
    path: '/api/staging/check-lock-status',
    method: 'GET'
  });
  console.log(`B1. Unitario (NODE_ENV=development, host=localhost): ${bUnitDevLocal} (Esperado: false)`);
  console.log(`B2. Unitario (NODE_ENV=development, host=staging): ${bUnitDevStagingHost} (Esperado: false)`);

  const passedB = (bUnitDevLocal === false) && (bUnitDevStagingHost === false);
  results.push({
    item: 'B. NODE_ENV=development + Localhost',
    condicion: 'Cualquier petición en entorno no staging o con hostname localhost -> Rechazado',
    resultado: passedB ? 'PASÓ' : 'FALLÓ',
    evidencia: `DevLocal=${bUnitDevLocal}, DevStagingHost=${bUnitDevStagingHost}`
  });

  // --------------------------------------------------------------------------
  // PRUEBA C: NODE_ENV=production + token válido: RECHAZADO
  // --------------------------------------------------------------------------
  console.log('\n--------------------------------------------------');
  console.log(' [PRUEBA C] NODE_ENV=production + TOKEN VÁLIDO: RECHAZADO');
  console.log('--------------------------------------------------');

  process.env.NODE_ENV = 'production';
  const cUnitProdObsFalse = isAuthorizedStagingTestRequest({
    headers: { host: 'tu-techo-ideal-staging.onrender.com', 'x-staging-auth': VALID_TOKEN },
    path: '/api/staging/check-lock-status',
    method: 'GET'
  });
  const cUnitProdHostProd = isAuthorizedStagingTestRequest({
    headers: { host: 'tu-techo-ideal-bot-1.onrender.com', 'x-staging-auth': VALID_TOKEN },
    path: '/api/staging/check-lock-status',
    method: 'GET'
  });
  console.log(`C1. Unitario (NODE_ENV=production, host staging): ${cUnitProdObsFalse} (Esperado: false)`);
  console.log(`C2. Unitario (NODE_ENV=production, host producción): ${cUnitProdHostProd} (Esperado: false)`);

  let cHttpProdStatus = null;
  try {
    const res = await axios.get(`${PROD_URL}/api/staging/check-lock-status`, {
      headers: { 'x-staging-auth': VALID_TOKEN },
      timeout: 45000
    });
    cHttpProdStatus = res.status;
  } catch (err) {
    cHttpProdStatus = err.response?.status || err.message;
  }
  console.log(`C3. HTTP en vivo a Producción con token: HTTP ${cHttpProdStatus} (Esperado: 404 Not Found)`);

  const passedC = (cUnitProdObsFalse === false) && (cUnitProdHostProd === false) && (cHttpProdStatus === 404);
  results.push({
    item: 'C. NODE_ENV=production + Token Válido',
    condicion: 'NODE_ENV=production rechaza reloj simulado incondicionalmente (HTTP 404 en vivo)',
    resultado: passedC ? 'PASÓ' : 'FALLÓ',
    evidencia: `ProdStagingHost=${cUnitProdObsFalse}, ProdProdHost=${cUnitProdHostProd}, ProdHTTP=${cHttpProdStatus}`
  });

  // --------------------------------------------------------------------------
  // PRUEBA D: HOSTNAME DIFERENTE AL AUTORIZADO: RECHAZADO
  // --------------------------------------------------------------------------
  console.log('\n--------------------------------------------------');
  console.log(' [PRUEBA D] HOSTNAME DIFERENTE AL AUTORIZADO: RECHAZADO');
  console.log('--------------------------------------------------');

  process.env.NODE_ENV = 'staging';
  // D1: Hostname de producción evaluado en staging
  const dUnitProdHost = isAuthorizedStagingTestRequest({
    headers: { host: 'tu-techo-ideal-bot-1.onrender.com', 'x-staging-auth': VALID_TOKEN },
    path: '/api/staging/check-lock-status',
    method: 'GET'
  });
  // D2: Hostname malicioso
  const dUnitMalicious = isAuthorizedStagingTestRequest({
    headers: { host: 'attacker-site.com', 'x-staging-auth': VALID_TOKEN },
    path: '/api/staging/check-lock-status',
    method: 'GET'
  });
  // D3: Intento de spoofing con X-Forwarded-Host sobre un Host header no autorizado
  const dUnitSpoof = isAuthorizedStagingTestRequest({
    headers: {
      host: 'attacker-site.com',
      'x-forwarded-host': 'tu-techo-ideal-staging.onrender.com',
      'x-staging-auth': VALID_TOKEN
    },
    path: '/api/staging/check-lock-status',
    method: 'GET'
  });
  console.log(`D1. Unitario (host producción en staging): ${dUnitProdHost} (Esperado: false)`);
  console.log(`D2. Unitario (host malicioso): ${dUnitMalicious} (Esperado: false)`);
  console.log(`D3. Unitario (intento spoofing X-Forwarded-Host): ${dUnitSpoof} (Esperado: false)`);

  const passedD = (dUnitProdHost === false) && (dUnitMalicious === false) && (dUnitSpoof === false);
  results.push({
    item: 'D. Hostname No Autorizado o Spoofed',
    condicion: 'Cualquier host diferente a tu-techo-ideal-staging.onrender.com es rechazado (inmune a X-Forwarded-Host)',
    resultado: passedD ? 'PASÓ' : 'FALLÓ',
    evidencia: `ProdHost=${dUnitProdHost}, MaliciousHost=${dUnitMalicious}, XForwardedSpoof=${dUnitSpoof}`
  });

  // --------------------------------------------------------------------------
  // PRUEBA E: TOKEN ENVIADO MEDIANTE URL: RECHAZADO (HTTP 401)
  // --------------------------------------------------------------------------
  console.log('\n--------------------------------------------------');
  console.log(' [PRUEBA E] TOKEN ENVIADO MEDIANTE URL: RECHAZADO');
  console.log('--------------------------------------------------');

  let eStatusUrlToken = null;
  try {
    await axios.get(`${STAGING_URL}/api/staging/check-lock-status?lead_id=${TARGET_LEAD_ID}&auth_token=${VALID_TOKEN}&token=${VALID_TOKEN}`, {
      timeout: 15000
    });
    eStatusUrlToken = 200;
  } catch (err) {
    eStatusUrlToken = err.response?.status || err.message;
  }
  console.log(`E. GET check-lock-status con token en query params: HTTP ${eStatusUrlToken} (Esperado: 401)`);

  const passedE = (eStatusUrlToken === 401);
  results.push({
    item: 'E. Token en URL (Query Params)',
    condicion: 'Parámetros ?auth_token=... o ?token=... en URL rechazados sin cabecera (HTTP 401)',
    resultado: passedE ? 'PASÓ' : 'FALLÓ',
    evidencia: `HTTP=${eStatusUrlToken}`
  });

  // --------------------------------------------------------------------------
  // PRUEBA F: TOKEN INCORRECTO: RECHAZADO (HTTP 401)
  // --------------------------------------------------------------------------
  console.log('\n--------------------------------------------------');
  console.log(' [PRUEBA F] TOKEN INCORRECTO: RECHAZADO');
  console.log('--------------------------------------------------');

  let fStatusBadToken = null;
  try {
    await axios.get(`${STAGING_URL}/api/staging/check-lock-status?lead_id=${TARGET_LEAD_ID}`, {
      headers: { 'x-staging-auth': INVALID_TOKEN },
      timeout: 15000
    });
    fStatusBadToken = 200;
  } catch (err) {
    fStatusBadToken = err.response?.status || err.message;
  }
  console.log(`F. GET check-lock-status con token incorrecto: HTTP ${fStatusBadToken} (Esperado: 401)`);

  const passedF = (fStatusBadToken === 401);
  results.push({
    item: 'F. Token Incorrecto',
    condicion: 'Cabecera x-staging-auth con token falso o de longitud diferente rechazada por timingSafeEqual (HTTP 401)',
    resultado: passedF ? 'PASÓ' : 'FALLÓ',
    evidencia: `HTTP=${fStatusBadToken}`
  });

  // --------------------------------------------------------------------------
  // PRUEBA G: TOKEN VÁLIDO EN /webhook CON offset_ms: RELOJ REAL, SIN SIMULACIÓN
  // --------------------------------------------------------------------------
  console.log('\n--------------------------------------------------');
  console.log(' [PRUEBA G] TOKEN VÁLIDO EN /webhook CON offset_ms (RELOJ REAL)');
  console.log('--------------------------------------------------');

  // Asegurar intervención humana reciente en T0 (Date.now() real)
  await axios.post(`${STAGING_URL}/webhook?sync=true&bypass_debounce=true`, {
    account: { id: 36728143 },
    message: {
      add: [{
        id: 'msg_human_seed_g_' + Date.now(),
        entity_id: parseInt(TARGET_LEAD_ID, 10),
        talk_id: TARGET_TALK_ID,
        type: 'outgoing',
        created_by: 998877,
        text: 'Intervención de prueba para bloqueo real.',
        author: { type: 'user', name: 'Robert Asesor Humano' }
      }]
    }
  }, { headers: { 'x-staging-auth': VALID_TOKEN } });

  // Enviar mensaje con offset_ms=43201000 y token válido a /webhook
  const gRes = await axios.post(`${STAGING_URL}/webhook?sync=true&bypass_debounce=true&offset_ms=43201000`, {
    account: { id: 36728143 },
    message: {
      add: [{
        id: 'msg_client_offset_g_' + Date.now(),
        entity_id: parseInt(TARGET_LEAD_ID, 10),
        talk_id: TARGET_TALK_ID,
        type: 'incoming',
        text: '¿Cuántos metros tiene el apartamento?',
        author: { type: 'external', name: 'Daniel Palma' }
      }]
    }
  }, { headers: { 'x-staging-auth': VALID_TOKEN } });

  console.log('G. Respuesta de /webhook con token válido y offset_ms:', {
    action: gRes.data?.decision?.action,
    type: gRes.data?.decision?.typeDetected,
    text: gRes.data?.text
  });

  const passedG = (gRes.data?.decision?.action === 'SILENCE') &&
                  (gRes.data?.decision?.typeDetected === 'HUMAN_LOCKED') &&
                  (gRes.data?.text === null);

  results.push({
    item: 'G. Webhook con Token Válido y offset_ms',
    condicion: '/webhook ignora offset_ms incondicionalmente y evalúa reloj Date.now() real (HUMAN_LOCKED)',
    resultado: passedG ? 'PASÓ' : 'FALLÓ',
    evidencia: `action=${gRes.data?.decision?.action}, type=${gRes.data?.decision?.typeDetected}, text=${gRes.data?.text}`
  });

  // --------------------------------------------------------------------------
  // PRUEBA H: TOKEN VÁLIDO EN /webhook CON simulated_now: RELOJ REAL, SIN SIMULACIÓN
  // --------------------------------------------------------------------------
  console.log('\n--------------------------------------------------');
  console.log(' [PRUEBA H] TOKEN VÁLIDO EN /webhook CON simulated_now (RELOJ REAL)');
  console.log('--------------------------------------------------');

  const futureTimestamp = Date.now() + 43201000;
  const hRes = await axios.post(`${STAGING_URL}/webhook?sync=true&bypass_debounce=true&simulated_now=${futureTimestamp}`, {
    account: { id: 36728143 },
    message: {
      add: [{
        id: 'msg_client_simnow_h_' + Date.now(),
        entity_id: parseInt(TARGET_LEAD_ID, 10),
        talk_id: TARGET_TALK_ID,
        type: 'incoming',
        text: '¿Cuántos metros tiene el apartamento?',
        author: { type: 'external', name: 'Daniel Palma' }
      }]
    }
  }, { headers: { 'x-staging-auth': VALID_TOKEN } });

  console.log('H. Respuesta de /webhook con token válido y simulated_now:', {
    action: hRes.data?.decision?.action,
    type: hRes.data?.decision?.typeDetected,
    text: hRes.data?.text
  });

  const passedH = (hRes.data?.decision?.action === 'SILENCE') &&
                  (hRes.data?.decision?.typeDetected === 'HUMAN_LOCKED') &&
                  (hRes.data?.text === null);

  results.push({
    item: 'H. Webhook con Token Válido y simulated_now',
    condicion: '/webhook ignora simulated_now incondicionalmente y evalúa reloj Date.now() real (HUMAN_LOCKED)',
    resultado: passedH ? 'PASÓ' : 'FALLÓ',
    evidencia: `action=${hRes.data?.decision?.action}, type=${hRes.data?.decision?.typeDetected}, text=${hRes.data?.text}`
  });

  // Restaurar entorno
  process.env.NODE_ENV = originalNodeEnv;

  // --------------------------------------------------------------------------
  // AUDITORÍA DE CREDENCIALES Y SECRETOS
  // --------------------------------------------------------------------------
  console.log('\n--------------------------------------------------');
  console.log(' AUDITORÍA DE ARCHIVOS, LOGS Y CREDENCIALES VERSIONADAS');
  console.log('--------------------------------------------------');

  const serverContent = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const renderYamlContent = fs.readFileSync(path.join(__dirname, '../render.yaml'), 'utf8');
  const gitignoreContent = fs.readFileSync(path.join(__dirname, '../.gitignore'), 'utf8');

  const tokenInServer = serverContent.includes(VALID_TOKEN);
  const tokenInRenderYaml = renderYamlContent.includes(VALID_TOKEN);
  const renderYamlHasSyncFalse = renderYamlContent.includes('key: STAGING_AUTH_TOKEN\n        sync: false') ||
                                 renderYamlContent.includes('key: STAGING_AUTH_TOKEN\r\n        sync: false');
  const gitignoreHasEnv = gitignoreContent.includes('.env');

  console.log(`Token en server.js: ${tokenInServer ? 'PRESENTE (FALLO)' : 'AUSENTE (CORRECTO)'}`);
  console.log(`Token en render.yaml: ${tokenInRenderYaml ? 'PRESENTE (FALLO)' : 'AUSENTE (CORRECTO)'}`);
  console.log(`render.yaml tiene sync: false: ${renderYamlHasSyncFalse ? 'CORRECTO' : 'FALLO'}`);
  console.log(`.gitignore contiene .env: ${gitignoreHasEnv ? 'CORRECTO' : 'FALLO'}`);

  const passedCreds = !tokenInServer && !tokenInRenderYaml && renderYamlHasSyncFalse && gitignoreHasEnv;
  results.push({
    item: 'I. Auditoría Definitiva de Credenciales',
    condicion: '0 tokens literales en Git/render.yaml, sync: false activo, .env excluido en .gitignore',
    resultado: passedCreds ? 'PASÓ' : 'FALLÓ',
    evidencia: `tokenInServer=${tokenInServer}, tokenInRenderYaml=${tokenInRenderYaml}, syncFalse=${renderYamlHasSyncFalse}, gitignore=${gitignoreHasEnv}`
  });

  // --------------------------------------------------------------------------
  // RESUMEN CONSOLIDADO DE LA SUITE DEFINITIVA
  // --------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(' RESUMEN CONSOLIDADO DE PRUEBAS DE SEGURIDAD (A - H)');
  console.log('================================================================');
  console.table(results.map(r => ({
    'Prueba Obligatoria': r.item,
    'Condición Verificada': r.condicion,
    'Resultado': r.resultado,
    'Evidencia Técnica': r.evidencia
  })));

  const allPassed = results.every(r => r.resultado === 'PASÓ');
  console.log(`\nESTADO GENERAL: ${allPassed ? '✅ AUDITORÍA DE SEGURIDAD 100% SUPERADA' : '❌ FALLA EN AUDITORÍA'}`);

  return { allPassed, results };
}

if (require.main === module) {
  runDefinitiveSecuritySuite().catch(err => {
    console.error('Error fatal durante la suite de seguridad:', err);
    process.exit(1);
  });
}

module.exports = { runDefinitiveSecuritySuite };
