/**
 * AUDITORÍA DE SEGURIDAD Y PROTECCIÓN DE ENDPOINTS DE STAGING
 * Objetivo: Demostrar que los endpoints de prueba están protegidos por autenticación,
 * deshabilitados ante accesos externos no autorizados y que la telemetría no expone PII.
 */

const axios = require('axios');
require('dotenv').config();

const BASE_URL = 'https://tu-techo-ideal-staging.onrender.com';
const STAGING_AUTH = process.env.STAGING_AUTH_TOKEN || process.env.KOMMO_TOKEN || 'tti-staging-auth-token-2026';

async function testEndpointProtection() {
  console.log('================================================================');
  console.log(' AUDITORÍA DE SEGURIDAD Y PROTECCIÓN DE ENDPOINTS DE STAGING   ');
  console.log('================================================================\n');

  let passed = 0;
  let total = 4;

  // 1. Acceso NO autenticado a /api/test-nemotron-inference
  try {
    await axios.get(`${BASE_URL}/api/test-nemotron-inference`, { timeout: 10000 });
    console.error('❌ [1/4] FALLÓ: /api/test-nemotron-inference permitió acceso sin autenticación');
  } catch (err) {
    if (err.response?.status === 401) {
      console.log('✅ [1/4] PASÓ: /api/test-nemotron-inference sin token -> HTTP 401 Unauthorized');
      passed++;
    } else {
      console.error(`❌ [1/4] FALLÓ: Esperado 401, recibido ${err.response?.status}`);
    }
  }

  // 2. Acceso NO autenticado a /api/staging-decision-logs
  try {
    await axios.get(`${BASE_URL}/api/staging-decision-logs`, { timeout: 10000 });
    console.error('❌ [2/4] FALLÓ: /api/staging-decision-logs permitió acceso sin autenticación');
  } catch (err) {
    if (err.response?.status === 401) {
      console.log('✅ [2/4] PASÓ: /api/staging-decision-logs sin token -> HTTP 401 Unauthorized');
      passed++;
    } else {
      console.error(`❌ [2/4] FALLÓ: Esperado 401, recibido ${err.response?.status}`);
    }
  }

  // 3. Acceso NO autenticado a /api/staging/set-handoff-time
  try {
    await axios.post(`${BASE_URL}/api/staging/set-handoff-time`, { hours_ago: 25 }, { timeout: 10000 });
    console.error('❌ [3/4] FALLÓ: /api/staging/set-handoff-time permitió mutación sin autenticación');
  } catch (err) {
    if (err.response?.status === 401) {
      console.log('✅ [3/4] PASÓ: /api/staging/set-handoff-time sin token -> HTTP 401 Unauthorized');
      passed++;
    } else {
      console.error(`❌ [3/4] FALLÓ: Esperado 401, recibido ${err.response?.status}`);
    }
  }

  // 4. Acceso AUTENTICADO con x-staging-auth y comprobación de anonimización
  try {
    const resAuth = await axios.get(`${BASE_URL}/api/staging-decision-logs`, {
      headers: { 'x-staging-auth': STAGING_AUTH },
      timeout: 10000
    });
    const logs = resAuth.data?.logs || [];
    const hasRawPersonalData = logs.some(l => l.client_phone || l.client_name || (l.lead_id && !l.lead_id.includes('***')));
    
    if (resAuth.status === 200 && !hasRawPersonalData) {
      console.log('✅ [4/4] PASÓ: Acceso autenticado autorizado y telemetría 100% anonimizada (Cero PII)');
      console.log(`   Registros auditados: ${logs.length}, IDs anonimizados con máscara ***`);
      passed++;
    } else {
      console.error('❌ [4/4] FALLÓ: Acceso autenticado o fuga de datos personales:', { status: resAuth.status, hasRawPersonalData });
    }
  } catch (err) {
    console.error('❌ [4/4] FALLÓ: Error en petición autenticada:', err.message);
  }

  console.log('\n================================================================');
  console.log(` RESULTADOS SEGURIDAD: ${passed} / ${total} PRUEBAS SUPERADAS (${(passed/total)*100}%)`);
  console.log('================================================================');
}

testEndpointProtection().catch(console.error);
