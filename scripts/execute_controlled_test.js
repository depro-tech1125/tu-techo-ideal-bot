const axios = require('axios');
require('dotenv').config();

const BASE_URL = 'https://tu-techo-ideal-staging.onrender.com';
const STAGING_AUTH = process.env.STAGING_AUTH_TOKEN;

const TARGET_LEAD_ID = '25092108';
const TARGET_TALK_ID = '1149';

async function runControlledTest() {
  console.log('================================================================');
  console.log(' EJECUCIÓN CONTROLADA DE PRIMERA PRUEBA REAL EN STAGING (v5.0)  ');
  console.log('================================================================\n');

  // PASO 1: Consulta inicial de estado (comprobar que no existen despachos anteriores)
  console.log('--- PASO 1: Comprobando estado inicial del despacho controlado ---');
  const initialStatusRes = await axios.get(`${BASE_URL}/api/staging/controlled-dispatch-status`, {
    headers: { 'x-staging-auth': STAGING_AUTH }
  });
  console.log('Estado inicial en Staging:', {
    staging_test_dispatch_enabled: initialStatusRes.data.staging_test_dispatch_enabled,
    observation_mode: initialStatusRes.data.observation_mode,
    authorized_pair: initialStatusRes.data.authorized_pair,
    dispatch_history_count: initialStatusRes.data.dispatch_history?.length || 0
  });

  if (initialStatusRes.data.dispatch_history?.length > 0) {
    console.warn('⚠️ Se detectaron despachos previos en historial. Se procederá con cautela.');
  } else {
    console.log('✅ Historial limpio: Cero despachos previos registrados.');
  }

  // PASO 2: Configurar autorización exclusiva para Daniel Palma
  console.log('\n--- PASO 2: Configurando autorización restringida en Staging ---');
  const configPayload = {
    enabled: true,
    lead_id: TARGET_LEAD_ID,
    talk_id: TARGET_TALK_ID,
    ttl_minutes: 60,
    max_dispatches: 2
  };
  const configRes = await axios.post(`${BASE_URL}/api/staging/configure-test-dispatch`, configPayload, {
    headers: { 'x-staging-auth': STAGING_AUTH }
  });
  console.log('Respuesta de configuración:', configRes.data);

  if (!configRes.data.authorized_pair?.is_valid) {
    throw new Error('❌ La autorización no quedó en estado válido. Abortando.');
  }
  console.log('✅ Autorización configurada y VÁLIDA para el par simultáneo Lead #' + TARGET_LEAD_ID + ' + Talk #' + TARGET_TALK_ID);

  // PASO 3: Simular el webhook entrante con el enlace Wasi 10493109
  console.log('\n--- PASO 3: Despachando webhook simulado con enlace Wasi 10493109 ---');
  const webhookPayload = {
    account: { id: 36728143 },
    message: {
      add: [{
        id: 'msg_controlled_test_' + Date.now(),
        entity_id: parseInt(TARGET_LEAD_ID, 10),
        talk_id: TARGET_TALK_ID,
        type: 'incoming',
        text: 'Hola, me interesa este apartamento https://info.wasi.co/apartamento-venta-los-samanes-caracas/10493109',
        author: { type: 'external', name: 'Daniel Palma' }
      }]
    }
  };

  const webhookRes = await axios.post(`${BASE_URL}/webhook?sync=true&bypass_debounce=true`, webhookPayload, {
    timeout: 30000
  });
  console.log('Respuesta de Webhook:', JSON.stringify(webhookRes.data, null, 2));

  // PASO 4: Comprobar la respuesta devuelta por el pipeline y despacho
  const expectedResponse = 'Bienvenido a Tu Techo Ideal, sí, disponible.';
  const actualResponse = webhookRes.data?.text;
  const isDispatched = webhookRes.data?.dispatched;

  console.log('\n--- PASO 4: Validación de Entrega y Mensaje ---');
  console.log(`Mensaje esperado: "${expectedResponse}"`);
  console.log(`Mensaje obtenido: "${actualResponse}"`);
  console.log(`Despacho ejecutado: ${isDispatched}`);

  if (actualResponse === expectedResponse && isDispatched === true) {
    console.log('✅ ÉXITO TOTAL: El mensaje exacto fue generado y despachado a Kommo y Salesbot.');
  } else {
    console.error('⚠️ ALERTA: La respuesta no coincide o el despacho no fue marcado como true.');
  }

  // PASO 5: Verificar en Kommo CRM el campo 2103996
  console.log('\n--- PASO 5: Verificando campo 2103996 en Kommo CRM ---');
  try {
    const token = process.env.KOMMO_TOKEN;
    const subdomain = process.env.KOMMO_SUBDOMAIN || 'tutechoidealrd';
    const kommoHeaders = { Authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}` };
    const leadRes = await axios.get(`https://${subdomain}.kommo.com/api/v4/leads/${TARGET_LEAD_ID}`, { headers: kommoHeaders });
    const fieldVal = leadRes.data?.custom_fields_values?.find(f => f.field_id === 2103996)?.values?.[0]?.value;
    console.log('Valor actual en campo 2103996 (Respuesta_IA) en Kommo:', `"${fieldVal}"`);
  } catch (err) {
    console.warn('Advertencia al consultar lead en Kommo:', err.message);
  }

  // PASO 6: Consultar estado final de auditoría
  console.log('\n--- PASO 6: Consultando historial de auditoría de despacho ---');
  const finalStatusRes = await axios.get(`${BASE_URL}/api/staging/controlled-dispatch-status`, {
    headers: { 'x-staging-auth': STAGING_AUTH }
  });
  console.log('Historial de Despacho:', JSON.stringify(finalStatusRes.data.dispatch_history, null, 2));
  console.log('Contador de despachos consumidos:', finalStatusRes.data.authorized_pair?.current_dispatches);

  // PASO 7: Desactivar la autorización inmediatamente para evitar envíos no autorizados
  console.log('\n--- PASO 7: Desactivando autorización temporal en Staging ---');
  const disableRes = await axios.post(`${BASE_URL}/api/staging/configure-test-dispatch`, { enabled: false }, {
    headers: { 'x-staging-auth': STAGING_AUTH }
  });
  console.log('Estado tras desactivación:', disableRes.data);
  console.log('🔒 Autorización temporal DESACTIVADA. Sistema en modo observación total.');
}

runControlledTest().catch(console.error);

