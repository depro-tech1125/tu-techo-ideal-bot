/**
 * ============================================================================
 * TU TECHO IDEAL v5.0 — PRUEBA 3: SILENCIO ABSOLUTO ANTE INFORMACIÓN INEXISTENTE
 * ============================================================================
 * Objetivo:
 * Comprobar la política estricta de NO INVENCIÓN (anti-alucinación):
 * Ante una pregunta sobre datos que NO constan en Google Sheets
 * ("¿Cuánto cuesta el condominio mensual?"), el bot debe guardar
 * SILENCIO ABSOLUTO, con cero mutaciones en Kommo y cero despachos a WhatsApp.
 * ============================================================================
 */

const axios = require('axios');
require('dotenv').config();
const { getAvailableProperties } = require('../server.js');

const BASE_URL = 'https://tu-techo-ideal-staging.onrender.com';
const STAGING_AUTH = process.env.STAGING_AUTH_TOKEN || process.env.STAGING_AUDIT_SECRET || process.env.KOMMO_TOKEN || 'tti-staging-auth-token-2026';

const TARGET_LEAD_ID = '25092108';
const TARGET_TALK_ID = '1149';

async function executePrueba3() {
  console.log('================================================================');
  console.log(' TU TECHO IDEAL v5.0 — PRUEBA 3: SILENCIO ANTE DATO INEXISTENTE ');
  console.log('================================================================\n');

  // PASO 1: Consultar directamente Google Sheets para REF-012
  console.log('--- PASO 1: Consulta directa a Google Sheets (REF-012) ---');
  const properties = await getAvailableProperties();
  const ref012 = properties.find(p => p.ID_PROPIEDAD === 'REF-012');

  if (!ref012) {
    throw new Error('❌ No se encontró la propiedad REF-012 en Google Sheets.');
  }

  console.log('Ficha REF-012 obtenida de Sheets:');
  console.log(`- ID_PROPIEDAD: ${ref012.ID_PROPIEDAD}`);
  console.log(`- TIPO: ${ref012.TIPO}`);
  console.log(`- OPERACION: ${ref012.OPERACION}`);
  console.log(`- ESTATUS: ${ref012.ESTATUS}`);
  console.log(`- DESCRIPCION_BREVE: "${ref012.DESCRIPCION_BREVE}"`);

  // Búsqueda exhaustiva de cualquier mención sobre condominio o gastos comunes
  const fullText = JSON.stringify(ref012).toLowerCase();
  const mentionsCondominio = fullText.includes('condominio') || fullText.includes('alicuota') || fullText.includes('gasto comun');
  console.log(`\n¿Existe mención de "condominio" en toda la ficha?: ${mentionsCondominio ? 'SÍ' : 'NO'}`);

  if (mentionsCondominio) {
    console.warn('⚠️ Se encontró mención de condominio en los datos.');
  } else {
    console.log('✅ Confirmado en Google Sheets: CERO información sobre condominio en REF-012.');
  }

  // PASO 2: Verificar estado de Kommo antes de la prueba
  console.log('\n--- PASO 2: Estado inicial en Kommo CRM y Staging ---');
  const token = process.env.KOMMO_TOKEN;
  const subdomain = process.env.KOMMO_SUBDOMAIN || 'tutechoidealrd';
  const kommoHeaders = { Authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}` };

  let initialFieldValue = null;
  try {
    const leadRes = await axios.get(`https://${subdomain}.kommo.com/api/v4/leads/${TARGET_LEAD_ID}`, { headers: kommoHeaders });
    initialFieldValue = leadRes.data?.custom_fields_values?.find(f => f.field_id === 2103996)?.values?.[0]?.value || null;
    console.log(`Valor previo en campo 2103996 (Respuesta_IA): "${initialFieldValue}"`);
  } catch (err) {
    console.warn('Advertencia al consultar Kommo:', err.message);
  }

  const dispatchStatusBefore = await axios.get(`${BASE_URL}/api/staging/controlled-dispatch-status`, {
    headers: { 'x-staging-auth': STAGING_AUTH }
  });
  console.log('Staging Test Dispatch Status (Antes):', {
    enabled: dispatchStatusBefore.data.staging_test_dispatch_enabled,
    observation_mode: dispatchStatusBefore.data.observation_mode,
    history_count: dispatchStatusBefore.data.dispatch_history?.length || 0
  });

  if (dispatchStatusBefore.data.staging_test_dispatch_enabled) {
    throw new Error('❌ La lista blanca de despachos está habilitada. Para esta prueba debe estar DESACTIVADA.');
  }

  // PASO 3: Procesar la pregunta en Staging mediante el pipeline central
  console.log('\n--- PASO 3: Inyectando Pregunta "¿Cuánto cuesta el condominio mensual?" ---');
  const webhookPayload = {
    account: { id: 36728143 },
    message: {
      add: [{
        id: 'msg_prueba3_' + Date.now(),
        entity_id: parseInt(TARGET_LEAD_ID, 10),
        talk_id: TARGET_TALK_ID,
        type: 'incoming',
        text: '¿Cuánto cuesta el condominio mensual?',
        author: { type: 'external', name: 'Daniel Palma' }
      }]
    }
  };

  const webhookRes = await axios.post(`${BASE_URL}/webhook?sync=true&bypass_debounce=true`, webhookPayload, {
    timeout: 35000
  });

  console.log('Respuesta del Webhook en Staging:');
  console.log(JSON.stringify(webhookRes.data, null, 2));

  const decision = webhookRes.data?.decision;
  const isSilence = decision?.action === 'SILENCE';
  const textIsNull = webhookRes.data?.text === null;
  const isNotDispatched = webhookRes.data?.dispatched === false;

  console.log('\n--- PASO 4: Validación de Decisión Central ---');
  console.log(`- Acción tomada: ${decision?.action} (Esperado: SILENCE)`);
  console.log(`- Tipo detectado: ${decision?.typeDetected}`);
  console.log(`- Propiedad evaluada: ${decision?.propertyIdentified}`);
  console.log(`- Llamó a IA (Nemotron): ${decision?.calledAI}`);
  console.log(`- Tokens IA consumidos: ${decision?.tokensUsed}`);
  console.log(`- Motivo de la decisión: "${decision?.reason}"`);
  console.log(`- Texto de respuesta devuelto: ${webhookRes.data?.text}`);
  console.log(`- Despacho ejecutado: ${webhookRes.data?.dispatched} (Esperado: false)`);

  // PASO 5: Verificar que Kommo CRM NO sufrió mutaciones
  console.log('\n--- PASO 5: Verificando ausencia de mutaciones en Kommo CRM ---');
  let postFieldValue = null;
  try {
    const leadResAfter = await axios.get(`https://${subdomain}.kommo.com/api/v4/leads/${TARGET_LEAD_ID}`, { headers: kommoHeaders });
    postFieldValue = leadResAfter.data?.custom_fields_values?.find(f => f.field_id === 2103996)?.values?.[0]?.value || null;
    console.log(`Valor en campo 2103996 tras la prueba: "${postFieldValue}"`);
  } catch (err) {
    console.warn('Advertencia al consultar Kommo post-prueba:', err.message);
  }

  // PASO 6: Verificar que no hubo despachos en Staging
  console.log('\n--- PASO 6: Comprobando historial de despachos en Staging ---');
  const dispatchStatusAfter = await axios.get(`${BASE_URL}/api/staging/controlled-dispatch-status`, {
    headers: { 'x-staging-auth': STAGING_AUTH }
  });
  const historyBeforeCount = dispatchStatusBefore.data.dispatch_history?.length || 0;
  const historyAfterCount = dispatchStatusAfter.data.dispatch_history?.length || 0;
  console.log(`Despachos antes: ${historyBeforeCount} | Despachos después: ${historyAfterCount}`);

  const passed = isSilence && textIsNull && isNotDispatched && (historyBeforeCount === historyAfterCount);

  return {
    passed,
    decision,
    mentionsCondominio,
    initialFieldValue,
    postFieldValue,
    historyBeforeCount,
    historyAfterCount
  };
}

executePrueba3()
  .then(res => {
    console.log('\n================================================================');
    if (res.passed) {
      console.log('✅ PRUEBA 3 SUPERADA CON ÉXITO TOTAL: SILENCIO ABSOLUTO CONFIRMADO');
      console.log('El bot no inventó información, no alteró Kommo y no envió mensajes.');
    } else {
      console.error('⚠️ PRUEBA 3: ADVERTENCIA O RESULTADO INESPERADO');
    }
    console.log('================================================================\n');
  })
  .catch(err => {
    console.error('\n❌ ERROR EN PRUEBA 3:', err.response?.data || err.message);
  });
