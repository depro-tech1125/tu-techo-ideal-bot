/**
 * ============================================================================
 * TU TECHO IDEAL v5.0 — PRUEBA 2: CONSULTA DE CARACTERÍSTICAS DEL INMUEBLE
 * ============================================================================
 * Objetivo:
 * Comprobar que Nemotron 3.5 Lightning utiliza Google Sheets y el contexto
 * de la conversación previa (REF-012, Wasi 10493109) para responder:
 * "¿Cuántos metros tiene el apartamento?" -> "Tiene 110 m²".
 * 
 * Parámetros autorizados:
 * - LEAD_ID: 25092108
 * - TALK_ID: 1149
 * - TTL: 15 minutos
 * - Max Despachos: 1
 * - Modo Observación global: true
 * ============================================================================
 */

const axios = require('axios');
require('dotenv').config();

const BASE_URL = 'https://tu-techo-ideal-staging.onrender.com';
const STAGING_AUTH = process.env.STAGING_AUTH_TOKEN;

const TARGET_LEAD_ID = '25092108';
const TARGET_TALK_ID = '1149';

async function executePrueba2() {
  console.log('================================================================');
  console.log(' TU TECHO IDEAL v5.0 — PRUEBA 2: CARACTERÍSTICAS DEL INMUEBLE   ');
  console.log('================================================================\n');

  // 1. Comprobar estado de Staging
  console.log('--- PASO 1: Verificación de Estado y Salud en Staging ---');
  const healthRes = await axios.get(`${BASE_URL}/health`);
  console.log('Health:', {
    status: healthRes.data.status,
    pipeline_controller: healthRes.data.pipeline_controller,
    observation_mode: healthRes.data.observation_mode,
    claude_model: healthRes.data.claude_model,
    uptime_seconds: healthRes.data.uptime_seconds
  });

  if (!healthRes.data.observation_mode) {
    throw new Error('❌ OBSERVATION_MODE no está activo globalmente en Staging. Abortando.');
  }

  // 2. Establecer estado de handoff limpio (simular 25h transcurridas para permitir reactivación)
  console.log('\n--- PASO 2: Asegurar estado de handoff desbloqueado (>24h) ---');
  const handoffRes = await axios.post(`${BASE_URL}/api/staging/set-handoff-time`, {
    lead_id: TARGET_LEAD_ID,
    talk_id: TARGET_TALK_ID,
    hours_ago: 25
  }, {
    headers: { 'x-staging-auth': STAGING_AUTH }
  });
  console.log('Handoff configurado:', handoffRes.data);

  // 3. Establecer Contexto de Conversación Previa (REF-012 / Wasi 10493109)
  // Se envía el enlace Wasi con despacho deshabilitado (modo observación) para reactivar y poblar contexto en memoria
  console.log('\n--- PASO 3: Registro de Contexto Previo (Enlace Wasi 10493109) en Staging ---');
  const wasiPayload = {
    account: { id: 36728143 },
    message: {
      add: [{
        id: 'msg_seed_context_' + Date.now(),
        entity_id: parseInt(TARGET_LEAD_ID, 10),
        talk_id: TARGET_TALK_ID,
        type: 'incoming',
        text: 'Hola, me interesa este apartamento https://info.wasi.co/apartamento-venta-los-samanes-caracas/10493109',
        author: { type: 'external', name: 'Daniel Palma' }
      }]
    }
  };

  const wasiRes = await axios.post(`${BASE_URL}/webhook?sync=true&bypass_debounce=true`, wasiPayload, {
    timeout: 35000
  });
  console.log('Contexto previo establecido:', {
    status: wasiRes.data?.status,
    action: wasiRes.data?.decision?.action,
    type: wasiRes.data?.decision?.typeDetected,
    property: wasiRes.data?.decision?.propertyIdentified,
    text: wasiRes.data?.text,
    dispatched: wasiRes.data?.dispatched
  });

  if (wasiRes.data?.decision?.propertyIdentified !== 'REF-012') {
    throw new Error(`❌ No se identificó la propiedad REF-012. Identificada: ${wasiRes.data?.decision?.propertyIdentified}`);
  }
  console.log('✅ Contexto fijado exitosamente en Staging: Propiedad REF-012 (Los Samanes, 110 m²).');

  // 4. Habilitar Despacho Controlado Exclusivo para Prueba 2
  console.log('\n--- PASO 4: Habilitando Despacho Controlado (TTL 15 min, Máx 1 despacho) ---');
  const configPayload = {
    enabled: true,
    lead_id: TARGET_LEAD_ID,
    talk_id: TARGET_TALK_ID,
    ttl_minutes: 15,
    max_dispatches: 1
  };
  const configRes = await axios.post(`${BASE_URL}/api/staging/configure-test-dispatch`, configPayload, {
    headers: { 'x-staging-auth': STAGING_AUTH }
  });
  console.log('Configuración de despacho:', configRes.data);
  if (!configRes.data.authorized_pair?.is_valid) {
    throw new Error('❌ La autorización de despacho no es válida. Abortando.');
  }

  // 5. Inyectar Mensaje de Consulta de Metraje y Ejecutar Despacho Real
  console.log('\n--- PASO 5: Inyectando Mensaje "¿Cuántos metros tiene el apartamento?" ---');
  const realPayload = {
    account: { id: 36728143 },
    message: {
      add: [{
        id: 'msg_real_p2_' + Date.now(),
        entity_id: parseInt(TARGET_LEAD_ID, 10),
        talk_id: TARGET_TALK_ID,
        type: 'incoming',
        text: '¿Cuántos metros tiene el apartamento?',
        author: { type: 'external', name: 'Daniel Palma' }
      }]
    }
  };

  const realRes = await axios.post(`${BASE_URL}/webhook?sync=true&bypass_debounce=true`, realPayload, {
    timeout: 50000
  });

  console.log('Respuesta Webhook Real:', {
    status: realRes.data?.status,
    dispatched: realRes.data?.dispatched,
    text: realRes.data?.text,
    propertyIdentified: realRes.data?.decision?.propertyIdentified,
    typeDetected: realRes.data?.decision?.typeDetected,
    calledAI: realRes.data?.decision?.calledAI,
    tokensUsed: realRes.data?.decision?.tokensUsed,
    evidence: realRes.data?.decision?.evidence,
    reason: realRes.data?.decision?.reason
  });

  // 6. Desactivar Inmediatamente la Autorización de Despacho
  console.log('\n--- PASO 6: Desactivando Inmediatamente la Autorización de Despacho ---');
  const disableRes = await axios.post(`${BASE_URL}/api/staging/configure-test-dispatch`, { enabled: false }, {
    headers: { 'x-staging-auth': STAGING_AUTH }
  });
  console.log('Estado tras revocación:', disableRes.data);
  console.log('🔒 Autorización DESACTIVADA inmediatamente. Modo observación restituido al 100%.');

  // 7. Verificación en Kommo CRM
  console.log('\n--- PASO 7: Verificando campo 2103996 (Respuesta_IA) en Kommo CRM ---');
  let kommoFieldValue = null;
  try {
    const token = process.env.KOMMO_TOKEN;
    const subdomain = process.env.KOMMO_SUBDOMAIN || 'tutechoidealrd';
    const kommoHeaders = { Authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}` };
    const leadRes = await axios.get(`https://${subdomain}.kommo.com/api/v4/leads/${TARGET_LEAD_ID}`, { headers: kommoHeaders });
    kommoFieldValue = leadRes.data?.custom_fields_values?.find(f => f.field_id === 2103996)?.values?.[0]?.value;
    console.log('Valor en campo 2103996 (Respuesta_IA) en Kommo:', `"${kommoFieldValue}"`);
  } catch (err) {
    console.warn('Advertencia consultando Kommo:', err.message);
  }

  // 8. Historial final de auditoría
  console.log('\n--- PASO 8: Historial final de auditoría en Staging ---');
  const auditRes = await axios.get(`${BASE_URL}/api/staging/controlled-dispatch-status`, {
    headers: { 'x-staging-auth': STAGING_AUTH }
  });
  console.log('Historial de Despachos:', JSON.stringify(auditRes.data.dispatch_history, null, 2));

  const expectedResponse = 'Tiene 110 m²';
  const isMatch = realRes.data?.text === expectedResponse;
  const isDispatched = realRes.data?.dispatched === true;

  return {
    success: isMatch && isDispatched,
    dispatchedText: realRes.data?.text,
    expectedResponse,
    isDispatched,
    propertyIdentified: realRes.data?.decision?.propertyIdentified,
    evidence: realRes.data?.decision?.evidence,
    calledAI: realRes.data?.decision?.calledAI,
    tokensUsed: realRes.data?.decision?.tokensUsed,
    auditHistory: auditRes.data.dispatch_history,
    kommoFieldValue
  };
}

executePrueba2()
  .then(res => {
    console.log('\n================================================================');
    if (res.success) {
      console.log('✅ PRUEBA 2 COMPLETADA CON ÉXITO TOTAL');
      console.log(`Mensaje enviado al WhatsApp de Daniel Palma: "${res.dispatchedText}"`);
    } else {
      console.error('⚠️ PRUEBA 2 FINALIZADA CON ADVERTENCIAS / REVISIÓN REQUERIDA');
    }
    console.log('================================================================\n');
  })
  .catch(err => {
    console.error('\n❌ ERROR EN PRUEBA 2:', err.response?.data || err.message);
    // Asegurar revocación en caso de error
    axios.post(`${BASE_URL}/api/staging/configure-test-dispatch`, { enabled: false }, {
      headers: { 'x-staging-auth': STAGING_AUTH }
    }).catch(() => {});
  });
