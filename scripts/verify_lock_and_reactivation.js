require('dotenv').config();
const {
  evaluateCentralDecisionPipeline,
  HandoffManager,
  ConversationContextManager,
  AVAILABILITY_RESPONSE
} = require('../pipeline_decision');
const { getAvailableProperties } = require('../server');
const path = require('path');
const fs = require('fs');

async function testLockAndReactivation() {
  console.log('================================================================');
  console.log(' VERIFICACIÓN DE BLOQUEO HUMANO 24H Y REACTIVACIÓN CONDICIONAL  ');
  console.log('================================================================\n');

  let passed = 0;
  let total = 4;

  const tempHandoffPath = path.join(__dirname, 'temp_test_handoffs.json');
  if (fs.existsSync(tempHandoffPath)) fs.unlinkSync(tempHandoffPath);

  const handoffManager = new HandoffManager(tempHandoffPath);
  const contextManager = new ConversationContextManager();

  const testLeadId = '25092108';
  const testTalkId = '1149';

  const properties = await getAvailableProperties();

  // 1. Simular intervención humana y comprobar bloqueo inmediato
  handoffManager.recordHumanIntervention(testLeadId, testTalkId);
  const lockStatusImmediate = await handoffManager.checkLockStatus(testLeadId, testTalkId);

  if (lockStatusImmediate.isLocked && lockStatusImmediate.hoursElapsed < 0.1) {
    console.log(`✅ [1/4] PASÓ: Intervención humana bloquea la conversación por 24 horas (horas transcurridas: ${lockStatusImmediate.hoursElapsed.toFixed(3)}h).`);
    passed++;
  } else {
    console.error('❌ [1/4] FALLÓ: Bloqueo inmediato no se activó correctamente:', lockStatusImmediate);
  }

  // 2. Durante el bloqueo (<24h), cualquier mensaje del cliente debe recibir SILENCIO TOTAL
  const resDuringLock = await evaluateCentralDecisionPipeline({
    leadId: testLeadId,
    talkId: testTalkId,
    userText: 'Hola, me interesa este inmueble https://info.wasi.co/apartamento-venta-los-samanes-caracas/10493109',
    properties,
    handoffManager,
    contextManager
  });

  if (!resDuringLock.shouldRespond && resDuringLock.log.typeDetected === 'HUMAN_LOCKED') {
    console.log('✅ [2/4] PASÓ: Durante las 24h de bloqueo, mensaje del cliente genera SILENCIO ABSOLUTO (HUMAN_LOCKED).');
    passed++;
  } else {
    console.error('❌ [2/4] FALLÓ: Mensaje no fue bloqueado durante las 24h:', resDuringLock);
  }

  // 3. Simular que transcurrieron 25 horas (>24h).
  // Si el cliente envía una pregunta SIN información verificable (ej. "¿Cuánto se paga de condominio?"),
  // el bot NO debe responder (debe guardar SILENCIO).
  const simulatedPast = Date.now() - (25 * 60 * 60 * 1000);
  handoffManager.handoffs.leads[testLeadId].lastHumanIntervention = simulatedPast;
  handoffManager.handoffs.talks[testTalkId].lastHumanIntervention = simulatedPast;
  handoffManager.save();

  const resUnverifiablePost24h = await evaluateCentralDecisionPipeline({
    leadId: testLeadId,
    talkId: testTalkId,
    userText: '¿Cuánto se paga exactamente de condominio mensual?',
    properties,
    handoffManager,
    contextManager
  });

  if (!resUnverifiablePost24h.shouldRespond && resUnverifiablePost24h.log.action === 'SILENCE') {
    console.log('✅ [3/4] PASÓ: Post-24h, consulta sin dato verificado genera SILENCIO (Cero invención).');
    passed++;
  } else {
    console.error('❌ [3/4] FALLÓ: Consulta no verificable generó respuesta indebida:', resUnverifiablePost24h);
  }

  // 4. Post-24h, si el cliente envía un enlace Wasi disponible en Google Sheets,
  // el bot se REACTIVA con el mensaje oficial de bienvenida.
  const resValidWasiPost24h = await evaluateCentralDecisionPipeline({
    leadId: testLeadId,
    talkId: testTalkId,
    userText: 'Hola, me interesa este apartamento https://info.wasi.co/apartamento-venta-los-samanes-caracas/10493109',
    properties,
    handoffManager,
    contextManager
  });

  if (resValidWasiPost24h.shouldRespond && resValidWasiPost24h.text === AVAILABILITY_RESPONSE) {
    console.log(`✅ [4/4] PASÓ: Post-24h, enlace Wasi verificado reactiva con mensaje oficial: "${resValidWasiPost24h.text}"`);
    passed++;
  } else {
    console.error('❌ [4/4] FALLÓ: Reactivación post-24h con enlace válido falló:', resValidWasiPost24h);
  }

  // Limpiar archivo temporal
  if (fs.existsSync(tempHandoffPath)) fs.unlinkSync(tempHandoffPath);

  console.log('\n================================================================');
  console.log(` RESULTADOS BLOQUEO Y REACTIVACIÓN: ${passed} / ${total} PRUEBAS SUPERADAS (${Math.round((passed/total)*100)}%)`);
  console.log('================================================================');

  if (passed !== total) process.exit(1);
}

testLockAndReactivation().catch(console.error);
