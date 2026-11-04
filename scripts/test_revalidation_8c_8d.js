const axios = require('axios');
require('dotenv').config();

const BASE_URL = process.env.STAGING_URL || 'https://tu-techo-ideal-staging.onrender.com';
const STAGING_AUTH = process.env.STAGING_AUTH_TOKEN;

const headers = {
  'x-staging-auth': STAGING_AUTH,
  'Content-Type': 'application/json'
};

const LEAD_8 = '990008';
const TALK_8 = '770008';

async function testPrueba8C_8D() {
  console.log('================================================================');
  console.log(' REVALIDACIÓN PRUEBA 8C Y 8D — CAMBIO DE PROPIEDAD (REF-005)');
  console.log('================================================================\n');

  // Limpiar contexto previo
  await axios.post(`${BASE_URL}/api/staging/set-handoff-time`, { lead_id: LEAD_8, talk_id: TALK_8, clear: true }, { headers });

  // 1. Enviar enlace de Propiedad A (REF-012)
  console.log('--- 1. Consulta inicial por Propiedad A (REF-012) ---');
  const r8A = await axios.post(`${BASE_URL}/api/staging/test-pipeline-evaluation`, {
    user_text: 'Hola, me interesa este apartamento https://info.wasi.co/apartamento-venta-los-samanes-caracas/10493109',
    lead_id: LEAD_8,
    talk_id: TALK_8
  }, { headers });
  console.log('8A Identificada:', r8A.data.decision?.propertyIdentified, '| Texto:', r8A.data.text);

  // 2. Enviar enlace de Propiedad B (REF-005) en la misma conversación
  console.log('\n--- 2. Cambio a Propiedad B (REF-005) en la misma conversación ---');
  const r8B = await axios.post(`${BASE_URL}/api/staging/test-pipeline-evaluation`, {
    user_text: 'Y también vi este apartamento https://info.wasi.co/inmueble/10442548',
    lead_id: LEAD_8,
    talk_id: TALK_8
  }, { headers });
  console.log('8B Identificada:', r8B.data.decision?.propertyIdentified, '| Texto:', r8B.data.text);

  // 3. PRUEBA 8C: Consulta de metraje de REF-005 (Esperado: 80,45 m²)
  console.log('\n--- 3. PRUEBA 8C: Consulta de metraje de REF-005 (80,45 m²) ---');
  const r8C = await axios.post(`${BASE_URL}/api/staging/test-pipeline-evaluation`, {
    user_text: '¿Cuántos metros cuadrados tiene?',
    lead_id: LEAD_8,
    talk_id: TALK_8
  }, { headers });
  console.log('8C Decisión:', JSON.stringify(r8C.data.decision, null, 2));
  console.log('8C Texto:', r8C.data.text);

  // 4. PRUEBA 8D: Consulta de precio de REF-005 (Esperado: $355.674)
  console.log('\n--- 4. PRUEBA 8D: Consulta de precio de inversión de REF-005 ($355.674) ---');
  const r8D = await axios.post(`${BASE_URL}/api/staging/test-pipeline-evaluation`, {
    user_text: '¿Cuál es el precio de inversión total?',
    lead_id: LEAD_8,
    talk_id: TALK_8
  }, { headers });
  console.log('8D Decisión:', JSON.stringify(r8D.data.decision, null, 2));
  console.log('8D Texto:', r8D.data.text);
}

testPrueba8C_8D().catch(err => {
  console.error('Error:', err.message, err.response?.data);
});

