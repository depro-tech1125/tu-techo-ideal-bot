const axios = require('axios');
require('dotenv').config();

const BASE_URL = process.env.STAGING_URL || 'https://tu-techo-ideal-staging.onrender.com';
const STAGING_AUTH = process.env.STAGING_AUTH_TOKEN;

const headers = {
  'x-staging-auth': STAGING_AUTH,
  'Content-Type': 'application/json'
};

const TARGET_LEAD_ID = '25092108';
const TARGET_TALK_ID = '1149';

async function test7C() {
  console.log('================================================================');
  console.log(' REVALIDACIÓN PRUEBA 7C — REACTIVACIÓN TRAS 12 HORAS Y 1 SEGUNDO');
  console.log('================================================================\n');

  // Paso 1: Limpiar y re-sembrar contexto activo REF-012
  console.log('--- Paso 1: Sembrando contexto de REF-012 ---');
  await axios.post(`${BASE_URL}/api/staging/set-handoff-time`, {
    lead_id: TARGET_LEAD_ID,
    talk_id: TARGET_TALK_ID,
    clear: true
  }, { headers });

  const seedRes = await axios.post(`${BASE_URL}/webhook?sync=true&bypass_debounce=true`, {
    account: { id: 36728143 },
    message: {
      add: [{
        id: 'msg_seed_7c_' + Date.now(),
        entity_id: parseInt(TARGET_LEAD_ID, 10),
        talk_id: TARGET_TALK_ID,
        type: 'incoming',
        text: 'Hola, me interesa este apartamento https://info.wasi.co/apartamento-venta-los-samanes-caracas/10493109',
        author: { type: 'external', name: 'Daniel Palma' }
      }]
    }
  }, { headers });

  console.log('Seed response:', seedRes.status);

  // Paso 2: Registrar intervención de asesor humano en T0
  console.log('--- Paso 2: Registrando intervención humana en T0 ---');
  const humanRes = await axios.post(`${BASE_URL}/webhook?sync=true&bypass_debounce=true`, {
    account: { id: 36728143 },
    message: {
      add: [{
        id: 'msg_human_7c_' + Date.now(),
        entity_id: parseInt(TARGET_LEAD_ID, 10),
        talk_id: TARGET_TALK_ID,
        type: 'outgoing',
        created_by: 998877,
        text: 'Hola Daniel, soy Gabriela de Tu Techo Ideal.',
        author: { type: 'user', name: 'Gabriela Asesora' }
      }]
    }
  }, { headers });

  console.log('Human intervention registered:', humanRes.status);

  // Paso 3: Verificar que a T0 + 12h y 1s el bloqueo esté vencido
  const checkStatus = await axios.get(`${BASE_URL}/api/staging/check-lock-status?lead_id=${TARGET_LEAD_ID}&talk_id=${TARGET_TALK_ID}&offset_ms=43201000`, { headers });
  console.log('Lock status en T0 + 43.201.000 ms:', checkStatus.data.lock_status);

  // Paso 4: Evaluar pregunta de metraje sobre REF-012 en T0 + 43.201.000 ms
  console.log('\n--- Paso 4: Evaluando pregunta de metraje (110 m²) en T0 + 43.201.000 ms ---');
  const evalRes = await axios.post(`${BASE_URL}/api/staging/test-pipeline-evaluation`, {
    user_text: '¿Cuántos metros tiene el apartamento?',
    lead_id: TARGET_LEAD_ID,
    talk_id: TARGET_TALK_ID,
    offset_ms: 43201000
  }, { headers });

  console.log('Resultado de evaluación:');
  console.log('Decision:', JSON.stringify(evalRes.data.decision, null, 2));
  console.log('Text:', evalRes.data.text);
}

test7C().catch(err => {
  console.error('Error en 7C:', err.message, err.response?.data);
});

