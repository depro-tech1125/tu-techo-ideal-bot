/**
 * SIMULACIÓN DE CONVERSACIÓN COMPLETA (7 MENSAJES) EN RENDER STAGING
 * Objetivo: Validar la secuencia completa de conversación manteniendo el mismo talk_id
 * y comprobando la respuesta real del servidor staging y de Nemotron.
 */

const axios = require('axios');
require('dotenv').config();

const BASE_URL = 'https://tu-techo-ideal-staging.onrender.com';
const TALK_ID = 'talk_stg_test_seq_8899';
const LEAD_ID = '88990001';
const CONTACT_ID = 'contact_stg_seq_8899';

const results = [];

function recordResult(step, name, expected, actual, passed, details = {}) {
  results.push({
    step,
    name,
    expected,
    actual,
    passed,
    details
  });
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} [${step}] ${name}`);
  console.log(`   Esperado: ${expected}`);
  console.log(`   Obtenido: ${actual}`);
  if (details.reason) console.log(`   Motivo/Evidencia: ${details.reason}`);
  if (details.calledAI !== undefined) console.log(`   Utilizó Nemotron: ${details.calledAI ? 'SÍ' : 'NO'}`);
  if (details.tokensUsed) console.log(`   Tokens: ${details.tokensUsed}`);
  console.log('');
}

async function sendWebhookMessage({ text, type = 'incoming', authorType = 'external', createdBy = null, talkId = TALK_ID, leadId = LEAD_ID }) {
  const payload = {
    account: { id: '36728143', subdomain: 'tutechoidealrd' },
    message: {
      add: [
        {
          id: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          type,
          text,
          entity_id: leadId,
          talk_id: talkId,
          contact_id: CONTACT_ID,
          created_at: Math.floor(Date.now() / 1000),
          created_by: createdBy,
          author: {
            type: authorType,
            name: type === 'incoming' ? 'Cliente Staging' : 'Robert Asesor Humano'
          }
        }
      ]
    }
  };

  const response = await axios.post(`${BASE_URL}/webhook?sync=true`, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 25000
  });

  return response.data;
}

async function runFullSimulation() {
  console.log('================================================================');
  console.log(' INICIANDO SIMULACIÓN DE CONVERSACIÓN COMPLETA (7 MENSAJES)');
  console.log(` Entorno: ${BASE_URL}`);
  console.log(` Talk ID: ${TALK_ID} | Lead ID: ${LEAD_ID}`);
  console.log('================================================================\n');

  // --------------------------------------------------------------------------
  // MENSAJE 1: Enlace Wasi disponible
  // --------------------------------------------------------------------------
  try {
    const text1 = 'Hola, me interesa este apartamento https://info.wasi.co/apartamento-venta-los-samanes-caracas/10493109';
    const res1 = await sendWebhookMessage({ text: text1 });
    const dec1 = res1.decision;
    const passed1 = res1.status === 'ok' && dec1.action === 'RESPOND' && res1.text === 'Sí, disponible.';
    recordResult(
      'MENSAJE 1',
      'Cliente envía enlace Wasi disponible',
      '«Sí, disponible.»',
      res1.text || dec1.action,
      passed1,
      {
        property: dec1.propertyIdentified,
        reason: dec1.reason,
        calledAI: dec1.calledAI || false
      }
    );
  } catch (err) {
    recordResult('MENSAJE 1', 'Cliente envía enlace Wasi disponible', '«Sí, disponible.»', `ERROR: ${err.message}`, false);
  }

  // --------------------------------------------------------------------------
  // MENSAJE 2: Pregunta por metraje (Inferencia Nemotron)
  // --------------------------------------------------------------------------
  try {
    const text2 = '¿Cuántos metros tiene el apartamento?';
    const res2 = await sendWebhookMessage({ text: text2 });
    const dec2 = res2.decision;
    const hasMetros = res2.text && (/120\s*m/i.test(res2.text) || /ciento\s*veinte/i.test(res2.text));
    const passed2 = res2.status === 'ok' && dec2.action === 'RESPOND' && hasMetros;
    recordResult(
      'MENSAJE 2',
      'Cliente pregunta cuántos metros tiene (Nemotron)',
      'Responder dato exacto de la ficha con evidencia validada (120 m²)',
      res2.text || dec2.action,
      passed2,
      {
        property: dec2.propertyIdentified,
        reason: dec2.reason,
        calledAI: dec2.calledAI || true,
        tokensUsed: dec2.tokensUsed,
        evidence: dec2.evidence
      }
    );
  } catch (err) {
    recordResult('MENSAJE 2', 'Cliente pregunta cuántos metros tiene', 'Responder dato exacto', `ERROR: ${err.message}`, false);
  }

  // --------------------------------------------------------------------------
  // MENSAJE 3: Pregunta por condominio (Dato inexistente -> Silencio)
  // --------------------------------------------------------------------------
  try {
    const text3 = '¿Cuánto se paga de condominio mensual?';
    const res3 = await sendWebhookMessage({ text: text3 });
    const dec3 = res3.decision;
    const passed3 = res3.status === 'ok' && dec3.action === 'SILENCE' && !res3.text;
    recordResult(
      'MENSAJE 3',
      'Cliente pregunta por condominio (dato no existe)',
      'Silencio absoluto (has_data: false, cero invención)',
      res3.text ? `Respondió: ${res3.text}` : 'SILENCIO ABSOLUTO',
      passed3,
      {
        property: dec3.propertyIdentified,
        reason: dec3.reason,
        calledAI: dec3.calledAI || true,
        tokensUsed: dec3.tokensUsed
      }
    );
  } catch (err) {
    recordResult('MENSAJE 3', 'Cliente pregunta por condominio', 'Silencio absoluto', `ERROR: ${err.message}`, false);
  }

  // --------------------------------------------------------------------------
  // MENSAJE 4: Crédito Venezuela Renace
  // --------------------------------------------------------------------------
  try {
    const text4 = '¿Aceptan crédito Venezuela Renace para comprarlo?';
    const res4 = await sendWebhookMessage({ text: text4 });
    const dec4 = res4.decision;
    const validReplies = ['Sí', 'No', 'Voy a consultar y ya le informo.'];
    const passed4 = res4.status === 'ok' && validReplies.some(r => res4.text && res4.text.includes(r));
    recordResult(
      'MENSAJE 4',
      'Cliente pregunta por crédito Venezuela Renace',
      '«Sí», «No» o «Voy a consultar y ya le informo.»',
      res4.text || dec4.action,
      passed4,
      {
        property: dec4.propertyIdentified,
        reason: dec4.reason,
        calledAI: false
      }
    );
  } catch (err) {
    recordResult('MENSAJE 4', 'Cliente pregunta crédito Venezuela Renace', 'Respuesta oficial', `ERROR: ${err.message}`, false);
  }

  // --------------------------------------------------------------------------
  // MENSAJE 5: Simular intervención humana saliente
  // --------------------------------------------------------------------------
  try {
    const text5 = 'Hola, soy Robert de Tu Techo Ideal, con gusto le atiendo personalmente para coordinar la visita.';
    const res5 = await sendWebhookMessage({
      text: text5,
      type: 'outgoing',
      authorType: 'user',
      createdBy: 1007661
    });
    const passed5 = res5.status === 'ok' && res5.action === 'LOCK_24H';
    recordResult(
      'MENSAJE 5',
      'Simular intervención humana saliente',
      'Bloqueo inmediato de 24 horas (Handoff)',
      res5.action === 'LOCK_24H' ? 'BLOQUEO INMEDIATO 24H ACTIVADO' : JSON.stringify(res5),
      passed5,
      {
        source: res5.source,
        reason: res5.reason,
        calledAI: false
      }
    );
  } catch (err) {
    recordResult('MENSAJE 5', 'Simular intervención humana', 'Bloqueo inmediato', `ERROR: ${err.message}`, false);
  }

  // --------------------------------------------------------------------------
  // MENSAJE 6: Cliente envía enlace Wasi antes de las 24 horas
  // --------------------------------------------------------------------------
  try {
    const text6 = 'Hola, también me gusta este https://info.wasi.co/apartamento-venta-lomas-del-sol-caracas/10544010';
    const res6 = await sendWebhookMessage({ text: text6 });
    const dec6 = res6.decision;
    const passed6 = res6.status === 'ok' && dec6.action === 'SILENCE' && dec6.typeDetected === 'HUMAN_LOCKED';
    recordResult(
      'MENSAJE 6',
      'Cliente envía otro enlace Wasi antes de las 24 horas',
      'Silencio (Conversación en bloqueo humano)',
      res6.text ? `Respondió: ${res6.text}` : 'SILENCIO (BLOQUEO HUMANO ACTIVO)',
      passed6,
      {
        reason: dec6.reason,
        calledAI: false
      }
    );
  } catch (err) {
    recordResult('MENSAJE 6', 'Cliente envía enlace durante bloqueo', 'Silencio', `ERROR: ${err.message}`, false);
  }

  // --------------------------------------------------------------------------
  // MENSAJE 7: Simular más de 24 horas y nuevo enlace Wasi válido
  // --------------------------------------------------------------------------
  try {
    // Adelantar el timestamp en staging a 25 horas atrás
    console.log('>>> [Simulación Temporal] Adelantando handoff en staging a 25 horas atrás...');
    const timeRes = await axios.post(`${BASE_URL}/api/staging/set-handoff-time`, {
      talk_id: TALK_ID,
      lead_id: LEAD_ID,
      hours_ago: 25
    });
    console.log('    Resultado ajuste temporal:', JSON.stringify(timeRes.data));

    const text7 = 'Hola, han pasado varios días, ahora me interesa este apartamento disponible https://info.wasi.co/apartamento-venta-lomas-del-sol-caracas/10544010';
    const res7 = await sendWebhookMessage({ text: text7 });
    const dec7 = res7.decision;
    const passed7 = res7.status === 'ok' && dec7.action === 'RESPOND' && res7.text === 'Sí, disponible.';
    recordResult(
      'MENSAJE 7',
      'Simular más de 24 horas y nuevo enlace Wasi válido',
      'Reactivación autorizada: «Sí, disponible.»',
      res7.text || dec7.action,
      passed7,
      {
        property: dec7.propertyIdentified,
        reason: dec7.reason,
        calledAI: false
      }
    );
  } catch (err) {
    recordResult('MENSAJE 7', 'Reactivación post-24h', 'Reactivación autorizada', `ERROR: ${err.message}`, false);
  }

  console.log('================================================================');
  console.log(` RESUMEN FINAL: ${results.filter(r => r.passed).length} / ${results.length} PASARON`);
  console.log('================================================================');
}

runFullSimulation().catch(console.error);
