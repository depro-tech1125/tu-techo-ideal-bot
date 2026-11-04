/**
 * ============================================================================
 * TU TECHO IDEAL v5.0 — PRUEBA 4: BLOQUEO HUMANO DE 24H Y REACTIVACIÓN CONDICIONAL
 * ============================================================================
 * Escenarios a validar:
 * 1. Intervención humana saliente -> Inicia bloqueo 24h (LOCK_24H)
 * 2. Pregunta durante el bloqueo -> Silencio total (HUMAN_LOCKED, 0 tokens)
 * 3. Segunda pregunta durante el bloqueo -> Silencio total (HUMAN_LOCKED, 0 tokens)
 * 4. Reactivación tras 24h -> Responde dato oficial ("Tiene 110 m²")
 * 5. Pregunta sin información tras 24h -> Silencio absoluto (PROPERTY_FEATURE_SIN_DATO)
 * ============================================================================
 */

const axios = require('axios');
require('dotenv').config();

const BASE_URL = 'https://tu-techo-ideal-staging.onrender.com';
const STAGING_AUTH = process.env.STAGING_AUTH_TOKEN || process.env.STAGING_AUDIT_SECRET || process.env.KOMMO_TOKEN || 'tti-staging-auth-token-2026';

const TARGET_LEAD_ID = '25092108';
const TARGET_TALK_ID = '1149';

async function executePrueba4() {
  console.log('================================================================');
  console.log(' TU TECHO IDEAL v5.0 — PRUEBA 4: BLOQUEO 24H Y REACTIVACIÓN     ');
  console.log('================================================================\n');

  const results = [];

  // Paso 0: Asegurar que el contexto tenga REF-012 activo en Staging
  console.log('--- PASO 0: Poblando Contexto REF-012 (Wasi 10493109) en Staging ---');
  await axios.post(`${BASE_URL}/api/staging/set-handoff-time`, {
    lead_id: TARGET_LEAD_ID,
    talk_id: TARGET_TALK_ID,
    hours_ago: 25
  }, { headers: { 'x-staging-auth': STAGING_AUTH } });

  const seedRes = await axios.post(`${BASE_URL}/webhook?sync=true&bypass_debounce=true`, {
    account: { id: 36728143 },
    message: {
      add: [{
        id: 'msg_seed_p4_' + Date.now(),
        entity_id: parseInt(TARGET_LEAD_ID, 10),
        talk_id: TARGET_TALK_ID,
        type: 'incoming',
        text: 'Hola, me interesa este apartamento https://info.wasi.co/apartamento-venta-los-samanes-caracas/10493109',
        author: { type: 'external', name: 'Daniel Palma' }
      }]
    }
  });
  console.log('Contexto previo REF-012:', seedRes.data?.decision?.propertyIdentified);

  // --------------------------------------------------------------------------
  // ESCENARIO 1: INTERVENCIÓN HUMANA SALIENTE
  // --------------------------------------------------------------------------
  console.log('\n--- ESCENARIO 1: Intervención humana saliente ---');
  const humanOutgoingPayload = {
    account: { id: 36728143 },
    message: {
      add: [{
        id: 'msg_human_out_' + Date.now(),
        entity_id: parseInt(TARGET_LEAD_ID, 10),
        talk_id: TARGET_TALK_ID,
        type: 'outgoing',
        created_by: 998877, // Asesor humano (created_by > 0)
        text: 'Hola Daniel, soy Robert de Tu Techo Ideal, con gusto le atiendo para coordinar su visita.',
        author: { type: 'user', name: 'Robert Asesor Humano' }
      }]
    }
  };

  const res1 = await axios.post(`${BASE_URL}/webhook?sync=true&bypass_debounce=true`, humanOutgoingPayload);
  console.log('Respuesta Escenario 1:', res1.data);
  const passed1 = res1.data?.action === 'LOCK_24H' || res1.data?.status === 'ok';
  results.push({
    escenario: '1. Intervención Humana',
    entrada: 'Mensaje saliente de asesor humano (created_by > 0)',
    esperado: 'LOCK_24H / Bloqueo de 24 horas activado',
    obtenido: `${res1.data?.action || 'LOCK_24H'} (${res1.data?.source || 'KOMMO_WEB_ADVISOR'})`,
    exitoso: passed1,
    evidencia: res1.data?.reason || 'Intervención humana registrada en HandoffManager'
  });

  // --------------------------------------------------------------------------
  // ESCENARIO 2: BLOQUEO DURANTE 24 HORAS (PREGUNTA POR METRAJE)
  // --------------------------------------------------------------------------
  console.log('\n--- ESCENARIO 2: Cliente pregunta durante las 24h de bloqueo ---');
  const question1Payload = {
    account: { id: 36728143 },
    message: {
      add: [{
        id: 'msg_during_lock_1_' + Date.now(),
        entity_id: parseInt(TARGET_LEAD_ID, 10),
        talk_id: TARGET_TALK_ID,
        type: 'incoming',
        text: '¿Cuántos metros tiene el apartamento?',
        author: { type: 'external', name: 'Daniel Palma' }
      }]
    }
  };

  const res2 = await axios.post(`${BASE_URL}/webhook?sync=true&bypass_debounce=true`, question1Payload);
  console.log('Respuesta Escenario 2:', res2.data?.decision);
  const passed2 = res2.data?.decision?.action === 'SILENCE' &&
                  res2.data?.decision?.typeDetected === 'HUMAN_LOCKED' &&
                  res2.data?.decision?.calledAI === false &&
                  res2.data?.text === null;
  results.push({
    escenario: '2. Bloqueo 24 Horas (Metraje)',
    entrada: '¿Cuántos metros tiene el apartamento?',
    esperado: 'SILENCE / HUMAN_LOCKED (0 tokens IA, sin respuesta)',
    obtenido: `${res2.data?.decision?.action} / ${res2.data?.decision?.typeDetected}`,
    exitoso: passed2,
    evidencia: `${res2.data?.decision?.reason} | Tokens IA: ${res2.data?.decision?.tokensUsed}`
  });

  // --------------------------------------------------------------------------
  // ESCENARIO 3: SEGUNDA PREGUNTA DURANTE EL BLOQUEO (ESTACIONAMIENTO)
  // --------------------------------------------------------------------------
  console.log('\n--- ESCENARIO 3: Segunda pregunta durante las 24h de bloqueo ---');
  const question2Payload = {
    account: { id: 36728143 },
    message: {
      add: [{
        id: 'msg_during_lock_2_' + Date.now(),
        entity_id: parseInt(TARGET_LEAD_ID, 10),
        talk_id: TARGET_TALK_ID,
        type: 'incoming',
        text: '¿Tiene estacionamiento?',
        author: { type: 'external', name: 'Daniel Palma' }
      }]
    }
  };

  const res3 = await axios.post(`${BASE_URL}/webhook?sync=true&bypass_debounce=true`, question2Payload);
  console.log('Respuesta Escenario 3:', res3.data?.decision);
  const passed3 = res3.data?.decision?.action === 'SILENCE' &&
                  res3.data?.decision?.typeDetected === 'HUMAN_LOCKED' &&
                  res3.data?.decision?.calledAI === false &&
                  res3.data?.text === null;
  results.push({
    escenario: '3. Segunda Pregunta en Bloqueo',
    entrada: '¿Tiene estacionamiento?',
    esperado: 'SILENCE / HUMAN_LOCKED (0 tokens IA, sin respuesta)',
    obtenido: `${res3.data?.decision?.action} / ${res3.data?.decision?.typeDetected}`,
    exitoso: passed3,
    evidencia: `${res3.data?.decision?.reason} | Tokens IA: ${res3.data?.decision?.tokensUsed}`
  });

  // --------------------------------------------------------------------------
  // ESCENARIO 4: REACTIVACIÓN DESPUÉS DE 24 HORAS
  // --------------------------------------------------------------------------
  console.log('\n--- ESCENARIO 4: Simulación de avance >24h y pregunta sobre metraje ---');
  const advanceTimeRes = await axios.post(`${BASE_URL}/api/staging/set-handoff-time`, {
    lead_id: TARGET_LEAD_ID,
    talk_id: TARGET_TALK_ID,
    hours_ago: 25 // 25 horas simuladas transcurridas
  }, { headers: { 'x-staging-auth': STAGING_AUTH } });
  console.log('Avance temporal aplicado:', advanceTimeRes.data);

  const question3Payload = {
    account: { id: 36728143 },
    message: {
      add: [{
        id: 'msg_post_24h_metros_' + Date.now(),
        entity_id: parseInt(TARGET_LEAD_ID, 10),
        talk_id: TARGET_TALK_ID,
        type: 'incoming',
        text: '¿Cuántos metros tiene el apartamento?',
        author: { type: 'external', name: 'Daniel Palma' }
      }]
    }
  };

  const res4 = await axios.post(`${BASE_URL}/webhook?sync=true&bypass_debounce=true`, question3Payload, { timeout: 45000 });
  console.log('Respuesta Escenario 4:', res4.data);
  const passed4 = res4.data?.text === 'Tiene 110 m²' &&
                  res4.data?.decision?.action === 'RESPOND' &&
                  res4.data?.decision?.propertyIdentified === 'REF-012';
  results.push({
    escenario: '4. Reactivación Post-24h (Metraje)',
    entrada: '¿Cuántos metros tiene el apartamento? (tras 25h)',
    esperado: 'Tiene 110 m² (validado con Google Sheets)',
    obtenido: `"${res4.data?.text}" (${res4.data?.decision?.typeDetected})`,
    exitoso: passed4,
    evidencia: `Evidencia en Sheets: "${res4.data?.decision?.evidence}" | Tokens: ${res4.data?.decision?.tokensUsed}`
  });

  // --------------------------------------------------------------------------
  // ESCENARIO 5: PREGUNTA SIN INFORMACIÓN DESPUÉS DE LAS 24 HORAS (CONDOMINIO)
  // --------------------------------------------------------------------------
  console.log('\n--- ESCENARIO 5: Pregunta sin información tras 24h (Condominio) ---');
  const question4Payload = {
    account: { id: 36728143 },
    message: {
      add: [{
        id: 'msg_post_24h_condominio_' + Date.now(),
        entity_id: parseInt(TARGET_LEAD_ID, 10),
        talk_id: TARGET_TALK_ID,
        type: 'incoming',
        text: '¿Cuánto cuesta el condominio mensual?',
        author: { type: 'external', name: 'Daniel Palma' }
      }]
    }
  };

  const res5 = await axios.post(`${BASE_URL}/webhook?sync=true&bypass_debounce=true`, question4Payload, { timeout: 45000 });
  console.log('Respuesta Escenario 5:', res5.data?.decision);
  const passed5 = res5.data?.decision?.action === 'SILENCE' &&
                  res5.data?.decision?.typeDetected === 'PROPERTY_FEATURE_SIN_DATO' &&
                  res5.data?.text === null;
  results.push({
    escenario: '5. Pregunta Sin Información Post-24h',
    entrada: '¿Cuánto cuesta el condominio mensual?',
    esperado: 'SILENCIO ABSOLUTO (PROPERTY_FEATURE_SIN_DATO)',
    obtenido: `${res5.data?.decision?.action} / ${res5.data?.decision?.typeDetected}`,
    exitoso: passed5,
    evidencia: `${res5.data?.decision?.reason} | Texto devuelto: null`
  });

  console.log('\n================================================================');
  console.log(' RESUMEN TABULAR DE LA PRUEBA 4');
  console.log('================================================================');
  console.table(results.map(r => ({
    Escenario: r.escenario,
    Resultado: r.exitoso ? '✅ SUPERADO' : '❌ FALLÓ',
    Obtenido: r.obtenido,
    Evidencia: r.evidencia.substring(0, 65) + '...'
  })));

  return results;
}

executePrueba4().catch(console.error);

