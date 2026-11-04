/**
 * ============================================================================
 * TU TECHO IDEAL v5.0 — SIMULACIÓN TEMPORAL RIGUROSA DE LÍMITES DE BLOQUEO 24H
 * ============================================================================
 * Objetivo:
 * Comprobar la precisión matemática de expiración de HandoffManager en Staging
 * en los 5 límites temporales exactos:
 * 1. T0: Intervención humana real registrada.
 * 2. T0 + 1 minuto (60s): Bloqueado estrictamente (HUMAN_LOCKED, 0 tokens IA).
 * 3. T0 + 23h 59m 59s (86.399s): Bloqueado estrictamente (HUMAN_LOCKED, 0 tokens IA).
 * 4. T0 + 24h 00m 00s (86.400s): Expiración exacta verificada (isLocked: false).
 * 5. T0 + 24h 00m 01s (86.401s): Reactivación condicional operativa ("Tiene 110 m²")
 *    y Silencio Absoluto ante dato sin información ("Condominio mensual").
 * ============================================================================
 */

const axios = require('axios');
require('dotenv').config();

const BASE_URL = 'https://tu-techo-ideal-staging.onrender.com';
const STAGING_AUTH = process.env.STAGING_AUTH_TOKEN || process.env.STAGING_AUDIT_SECRET || process.env.KOMMO_TOKEN || 'tti-staging-auth-token-2026';

const TARGET_LEAD_ID = '25092108';
const TARGET_TALK_ID = '1149';

async function runTemporalBoundarySimulation() {
  console.log('================================================================');
  console.log(' SIMULACIÓN TEMPORAL RIGUROSA DE BLOQUEO 24H (RELICARIO FAKE CLOCK)');
  console.log('================================================================\n');

  const report = [];

  // Paso 0: Asegurar contexto activo de REF-012 en Staging
  console.log('--- PASO PREVIO: Asegurar contexto activo de REF-012 en Staging ---');
  await axios.post(`${BASE_URL}/webhook?sync=true&bypass_debounce=true`, {
    account: { id: 36728143 },
    message: {
      add: [{
        id: 'msg_seed_t_' + Date.now(),
        entity_id: parseInt(TARGET_LEAD_ID, 10),
        talk_id: TARGET_TALK_ID,
        type: 'incoming',
        text: 'Hola, me interesa este apartamento https://info.wasi.co/apartamento-venta-los-samanes-caracas/10493109',
        author: { type: 'external', name: 'Daniel Palma' }
      }]
    }
  });
  console.log('✅ Contexto REF-012 activo.');

  // --------------------------------------------------------------------------
  // 1. INSTANTE T0: REGISTRO DE INTERVENCIÓN HUMANA REAL
  // --------------------------------------------------------------------------
  console.log('\n--- 1. INSTANTE T0: Registrar intervención humana real ---');
  const humanOutRes = await axios.post(`${BASE_URL}/webhook?sync=true&bypass_debounce=true`, {
    account: { id: 36728143 },
    message: {
      add: [{
        id: 'msg_human_t0_' + Date.now(),
        entity_id: parseInt(TARGET_LEAD_ID, 10),
        talk_id: TARGET_TALK_ID,
        type: 'outgoing',
        created_by: 998877, // Asesor humano web
        text: 'Hola Daniel, soy Robert de Tu Techo Ideal, estoy a tu orden.',
        author: { type: 'user', name: 'Robert Asesor Humano' }
      }]
    }
  });

  const t0Status = await axios.get(`${BASE_URL}/api/staging/check-lock-status?lead_id=${TARGET_LEAD_ID}&talk_id=${TARGET_TALK_ID}`, {
    headers: { 'x-staging-auth': STAGING_AUTH }
  });

  const t0Timestamp = t0Status.data.lock_status.lastIntervention;
  console.log(`T0 registrado: ${t0Timestamp} (${new Date(t0Timestamp).toISOString()})`);
  console.log(`Estado T0: isLocked = ${t0Status.data.lock_status.isLocked}, hoursElapsed = ${t0Status.data.lock_status.hoursElapsed.toFixed(4)}h`);

  report.push({
    paso: '1. Instante T0',
    descripcion: 'Intervención humana saliente de asesor (created_by > 0)',
    delta: '0 segundos',
    horas_transcurridas: `${t0Status.data.lock_status.hoursElapsed.toFixed(4)}h`,
    esperado: 'isLocked: true (LOCK_24H activado)',
    obtenido: `isLocked: ${t0Status.data.lock_status.isLocked}`,
    superado: t0Status.data.lock_status.isLocked === true
  });

  // --------------------------------------------------------------------------
  // 2. SIMULAR T0 + 1 MINUTO (60 SEGUNDOS)
  // --------------------------------------------------------------------------
  console.log('\n--- 2. LÍMITE: T0 + 1 minuto (60 segundos) ---');
  // Se simula que la intervención humana ocurrió hace 60 segundos
  await axios.post(`${BASE_URL}/api/staging/set-handoff-time`, {
    lead_id: TARGET_LEAD_ID,
    talk_id: TARGET_TALK_ID,
    seconds_ago: 60
  }, { headers: { 'x-staging-auth': STAGING_AUTH } });

  const status1m = await axios.get(`${BASE_URL}/api/staging/check-lock-status?lead_id=${TARGET_LEAD_ID}&talk_id=${TARGET_TALK_ID}`, {
    headers: { 'x-staging-auth': STAGING_AUTH }
  });
  console.log(`Cálculo HandoffManager en T0 + 1m: isLocked = ${status1m.data.lock_status.isLocked}, hoursElapsed = ${status1m.data.lock_status.hoursElapsed.toFixed(4)}h`);

  // Simular pregunta del cliente durante este límite
  const webhook1m = await axios.post(`${BASE_URL}/webhook?sync=true&bypass_debounce=true`, {
    account: { id: 36728143 },
    message: {
      add: [{
        id: 'msg_t_1m_' + Date.now(),
        entity_id: parseInt(TARGET_LEAD_ID, 10),
        talk_id: TARGET_TALK_ID,
        type: 'incoming',
        text: '¿Cuántos metros tiene el apartamento?',
        author: { type: 'external', name: 'Daniel Palma' }
      }]
    }
  });

  const passed1m = status1m.data.lock_status.isLocked === true &&
                   webhook1m.data?.decision?.action === 'SILENCE' &&
                   webhook1m.data?.decision?.typeDetected === 'HUMAN_LOCKED' &&
                   webhook1m.data?.decision?.calledAI === false;

  report.push({
    paso: '2. T0 + 1 minuto',
    descripcion: 'Pregunta sobre metraje durante el primer minuto de bloqueo',
    delta: '60 segundos',
    horas_transcurridas: `${status1m.data.lock_status.hoursElapsed.toFixed(4)}h`,
    esperado: 'SILENCE / HUMAN_LOCKED (0 tokens IA)',
    obtenido: `${webhook1m.data?.decision?.action} / ${webhook1m.data?.decision?.typeDetected} (Tokens: ${webhook1m.data?.decision?.tokensUsed})`,
    superado: passed1m
  });

  // --------------------------------------------------------------------------
  // 3. SIMULAR T0 + 23 HORAS, 59 MINUTOS Y 59 SEGUNDOS (86.399 SEGUNDOS)
  // --------------------------------------------------------------------------
  console.log('\n--- 3. LÍMITE: T0 + 23h 59m 59s (86.399 segundos) ---');
  const seconds23h59m59s = (23 * 3600) + (59 * 60) + 59; // 86399 s
  await axios.post(`${BASE_URL}/api/staging/set-handoff-time`, {
    lead_id: TARGET_LEAD_ID,
    talk_id: TARGET_TALK_ID,
    seconds_ago: seconds23h59m59s
  }, { headers: { 'x-staging-auth': STAGING_AUTH } });

  const status23h = await axios.get(`${BASE_URL}/api/staging/check-lock-status?lead_id=${TARGET_LEAD_ID}&talk_id=${TARGET_TALK_ID}`, {
    headers: { 'x-staging-auth': STAGING_AUTH }
  });
  console.log(`Cálculo HandoffManager en T0 + 23h 59m 59s: isLocked = ${status23h.data.lock_status.isLocked}, hoursElapsed = ${status23h.data.lock_status.hoursElapsed.toFixed(6)}h`);

  const webhook23h = await axios.post(`${BASE_URL}/webhook?sync=true&bypass_debounce=true`, {
    account: { id: 36728143 },
    message: {
      add: [{
        id: 'msg_t_23h_' + Date.now(),
        entity_id: parseInt(TARGET_LEAD_ID, 10),
        talk_id: TARGET_TALK_ID,
        type: 'incoming',
        text: '¿Tiene estacionamiento techado?',
        author: { type: 'external', name: 'Daniel Palma' }
      }]
    }
  });

  const passed23h = status23h.data.lock_status.isLocked === true &&
                    webhook23h.data?.decision?.action === 'SILENCE' &&
                    webhook23h.data?.decision?.typeDetected === 'HUMAN_LOCKED' &&
                    webhook23h.data?.decision?.calledAI === false;

  report.push({
    paso: '3. T0 + 23h 59m 59s',
    descripcion: 'Pregunta 1 segundo antes de expirar las 24 horas',
    delta: '86.399 segundos',
    horas_transcurridas: `${status23h.data.lock_status.hoursElapsed.toFixed(6)}h`,
    esperado: 'SILENCE / HUMAN_LOCKED (0 tokens IA)',
    obtenido: `${webhook23h.data?.decision?.action} / ${webhook23h.data?.decision?.typeDetected} (Tokens: ${webhook23h.data?.decision?.tokensUsed})`,
    superado: passed23h
  });

  // --------------------------------------------------------------------------
  // 4. SIMULAR T0 + 24 HORAS EXACTAS (86.400 SEGUNDOS)
  // --------------------------------------------------------------------------
  console.log('\n--- 4. LÍMITE: T0 + 24 horas exactas (86.400 segundos) ---');
  const seconds24hExact = 24 * 3600; // 86400 s
  await axios.post(`${BASE_URL}/api/staging/set-handoff-time`, {
    lead_id: TARGET_LEAD_ID,
    talk_id: TARGET_TALK_ID,
    seconds_ago: seconds24hExact
  }, { headers: { 'x-staging-auth': STAGING_AUTH } });

  const status24h = await axios.get(`${BASE_URL}/api/staging/check-lock-status?lead_id=${TARGET_LEAD_ID}&talk_id=${TARGET_TALK_ID}`, {
    headers: { 'x-staging-auth': STAGING_AUTH }
  });
  console.log(`Cálculo HandoffManager en T0 + 24h exactas: isLocked = ${status24h.data.lock_status.isLocked}, hoursElapsed = ${status24h.data.lock_status.hoursElapsed.toFixed(6)}h`);

  const passed24h = status24h.data.lock_status.isLocked === false &&
                    status24h.data.lock_status.hoursElapsed >= 24.0;

  report.push({
    paso: '4. T0 + 24h 00m 00s',
    descripcion: 'Comprobación de expiración exacta en el límite de 24 horas',
    delta: '86.400 segundos',
    horas_transcurridas: `${status24h.data.lock_status.hoursElapsed.toFixed(6)}h`,
    esperado: 'isLocked: false (Bloqueo humano expirado exactamente)',
    obtenido: `isLocked: ${status24h.data.lock_status.isLocked}`,
    superado: passed24h
  });

  // --------------------------------------------------------------------------
  // 5. SIMULAR T0 + 24 HORAS Y 1 SEGUNDO (86.401 SEGUNDOS) - REACTIVACIÓN CONDICIONAL
  // --------------------------------------------------------------------------
  console.log('\n--- 5. LÍMITE: T0 + 24h y 1 segundo (86.401 segundos) ---');
  const seconds24h1s = (24 * 3600) + 1; // 86401 s
  await axios.post(`${BASE_URL}/api/staging/set-handoff-time`, {
    lead_id: TARGET_LEAD_ID,
    talk_id: TARGET_TALK_ID,
    seconds_ago: seconds24h1s
  }, { headers: { 'x-staging-auth': STAGING_AUTH } });

  const status24h1s = await axios.get(`${BASE_URL}/api/staging/check-lock-status?lead_id=${TARGET_LEAD_ID}&talk_id=${TARGET_TALK_ID}`, {
    headers: { 'x-staging-auth': STAGING_AUTH }
  });
  console.log(`Cálculo HandoffManager en T0 + 24h 1s: isLocked = ${status24h1s.data.lock_status.isLocked}, hoursElapsed = ${status24h1s.data.lock_status.hoursElapsed.toFixed(6)}h`);

  // Sub-prueba 5.1: Pregunta con información disponible en Sheets (Metraje de REF-012)
  console.log('Sub-prueba 5.1: Pregunta de metraje tras 24h 1s...');
  const webhook24h1s_m2 = await axios.post(`${BASE_URL}/webhook?sync=true&bypass_debounce=true`, {
    account: { id: 36728143 },
    message: {
      add: [{
        id: 'msg_t_24h1s_m2_' + Date.now(),
        entity_id: parseInt(TARGET_LEAD_ID, 10),
        talk_id: TARGET_TALK_ID,
        type: 'incoming',
        text: '¿Cuántos metros tiene el apartamento?',
        author: { type: 'external', name: 'Daniel Palma' }
      }]
    }
  }, { timeout: 45000 });

  const passed5_1 = webhook24h1s_m2.data?.text === 'Tiene 110 m²' &&
                    webhook24h1s_m2.data?.decision?.action === 'RESPOND' &&
                    webhook24h1s_m2.data?.decision?.propertyIdentified === 'REF-012';

  console.log(`Respuesta 5.1: "${webhook24h1s_m2.data?.text}" (${webhook24h1s_m2.data?.decision?.typeDetected})`);

  // Sub-prueba 5.2: Pregunta sin información (Condominio mensual)
  console.log('Sub-prueba 5.2: Pregunta sin dato en Sheets (Condominio mensual)...');
  const webhook24h1s_condo = await axios.post(`${BASE_URL}/webhook?sync=true&bypass_debounce=true`, {
    account: { id: 36728143 },
    message: {
      add: [{
        id: 'msg_t_24h1s_condo_' + Date.now(),
        entity_id: parseInt(TARGET_LEAD_ID, 10),
        talk_id: TARGET_TALK_ID,
        type: 'incoming',
        text: '¿Cuánto cuesta el condominio mensual?',
        author: { type: 'external', name: 'Daniel Palma' }
      }]
    }
  }, { timeout: 45000 });

  const passed5_2 = webhook24h1s_condo.data?.decision?.action === 'SILENCE' &&
                    webhook24h1s_condo.data?.decision?.typeDetected === 'PROPERTY_FEATURE_SIN_DATO' &&
                    webhook24h1s_condo.data?.text === null;

  console.log(`Respuesta 5.2: Acción = ${webhook24h1s_condo.data?.decision?.action}, Texto = ${webhook24h1s_condo.data?.text}`);

  // Sub-prueba 5.3: Diferenciación de eco de Salesbot (created_by === 0)
  console.log('Sub-prueba 5.3: Mensaje saliente de Salesbot (created_by === 0)...');
  const botOutgoingRes = await axios.post(`${BASE_URL}/webhook?sync=true&bypass_debounce=true`, {
    account: { id: 36728143 },
    message: {
      add: [{
        id: 'msg_bot_out_eco_' + Date.now(),
        entity_id: parseInt(TARGET_LEAD_ID, 10),
        talk_id: TARGET_TALK_ID,
        type: 'outgoing',
        created_by: 0, // Generado por Salesbot / API
        text: 'Tiene 110 m²',
        author: { type: 'bot', name: 'Tu Techo Ideal Bot' }
      }]
    }
  });

  const passed5_3 = botOutgoingRes.data?.handled === 'BOT_OUTGOING_ECHO' || botOutgoingRes.data?.action !== 'LOCK_24H';
  console.log(`Respuesta 5.3: Eco de Salesbot manejado como = ${botOutgoingRes.data?.handled || botOutgoingRes.data?.action}`);

  report.push({
    paso: '5. T0 + 24h 00m 01s',
    descripcion: 'Reactivación condicional: respuesta oficial con dato y silencio ante dato inexistente',
    delta: '86.401 segundos',
    horas_transcurridas: `${status24h1s.data.lock_status.hoursElapsed.toFixed(6)}h`,
    esperado: 'Metraje: "Tiene 110 m²" | Condominio: SILENCIO | Eco Salesbot: Descartado',
    obtenido: `Metraje: "${webhook24h1s_m2.data?.text}" | Condominio: ${webhook24h1s_condo.data?.decision?.action} | Eco: ${botOutgoingRes.data?.handled || 'BOT_ECHO'}`,
    superado: passed5_1 && passed5_2 && passed5_3
  });

  console.log('\n================================================================');
  console.log(' INFORME FINAL DE LÍMITES TEMPORALES RIGUROSOS');
  console.log('================================================================');
  console.table(report.map(r => ({
    Límite: r.paso,
    Delta: r.delta,
    Horas: r.horas_transcurridas,
    Resultado: r.superado ? '✅ SUPERADO' : '❌ FALLÓ',
    Obtenido: r.obtenido
  })));

  return report;
}

runTemporalBoundarySimulation().catch(console.error);

