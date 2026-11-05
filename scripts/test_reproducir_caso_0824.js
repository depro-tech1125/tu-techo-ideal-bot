const assert = require('assert');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const {
  evaluateCentralDecisionPipeline,
  HandoffManager,
  ConversationContextManager,
  AVAILABILITY_RESPONSE
} = require('../pipeline_decision');
const { IdempotencyManager } = require('../lib/idempotency_manager');
const { recoverActivePropertyFromKommo } = require('../lib/kommo_property_recovery');
const { getAvailableProperties } = require('../server');

async function runTest0824() {
  console.log('================================================================');
  console.log(' SUITE DE VERIFICACIÓN Y REGRESIÓN: CASO INCIDENCIA 08:24 AM    ');
  console.log('================================================================\n');

  let passed = 0;
  const total = 7;

  const properties = await getAvailableProperties();
  const testStorePath = path.join(__dirname, 'temp_test_idemp_0824.json');
  if (fs.existsSync(testStorePath)) fs.unlinkSync(testStorePath);

  const idempotencyManager = new IdempotencyManager(testStorePath);
  const handoffManager = new HandoffManager(path.join(__dirname, '..', 'handoffs.json'));

  const leadId = '25092108';
  const talkId = '1423';
  const contactId = '49554440';
  const msgId = '2bddde92-1a11-4fc3-be74-4661f7a6f62d';
  const userText = '¿Me puedes compartir fotografías y más información de la propiedad?';

  // ---------------------------------------------------------------------------
  // TEST 1: checkLockStatus retorna activeAutomationPropertyId sin intervención humana previa
  // ---------------------------------------------------------------------------
  const lockStatus = await handoffManager.checkLockStatus(leadId, talkId, contactId);
  if (!lockStatus.isLocked && lockStatus.activeAutomationPropertyId === 'REF-035') {
    console.log('✅ [1/7] PASÓ: checkLockStatus preserva activeAutomationPropertyId = "REF-035" cuando no hay bloqueo humano.');
    passed++;
  } else {
    console.error('❌ [1/7] FALLÓ: checkLockStatus no retornó REF-035:', lockStatus);
  }

  // ---------------------------------------------------------------------------
  // TEST 2: Idempotency manager permite el nuevo mensaje legítimo con UUID único
  // ---------------------------------------------------------------------------
  const msgKey = `msg_${msgId}`;
  const lockRes = idempotencyManager.acquireLock(msgKey, talkId, leadId);
  if (lockRes.allowed) {
    console.log(`✅ [2/7] PASÓ: Idempotency lock adquirido exitosamente para nuevo evento [${msgKey}].`);
    passed++;
  } else {
    console.error('❌ [2/7] FALLÓ: Idempotency rechazó mensaje legítimo:', lockRes);
  }

  // ---------------------------------------------------------------------------
  // TEST 3: Evaluación tras reinicio (RAM vacía) resuelve REF-035 y responde fotos
  // ---------------------------------------------------------------------------
  const freshContextManager = new ConversationContextManager(); // RAM vacía tras reinicio
  const res = await evaluateCentralDecisionPipeline({
    userText,
    leadId,
    talkId,
    contactId,
    properties,
    handoffManager,
    contextManager: freshContextManager,
    propertyRecoveryFn: recoverActivePropertyFromKommo,
    currentTime: 1793881474000 // 12:24:34 UTC (08:24 local)
  });

  if (res.shouldRespond && res.log.typeDetected === 'PROPERTY_EXTENDED_INFO_LINK_FOTOS' && res.log.propertyIdentified === 'REF-035') {
    console.log('✅ [3/7] PASÓ: Pipeline identifica correctamente REF-035 tras reinicio y decide RESPONDER.');
    passed++;
  } else {
    console.error('❌ [3/7] FALLÓ: Pipeline no respondió:', res);
  }

  // ---------------------------------------------------------------------------
  // TEST 4: Enlace Rexup directo e inalterado sin kommo.cc y con separación limpia
  // ---------------------------------------------------------------------------
  const expectedRexup = 'https://www.rexup.net/AAAAAAA/ver_inmueble_c.php?cod_inmueble=3431731625';
  if (res.text && res.text.includes(expectedRexup) && !res.text.includes('kommo.cc') && res.text.includes('\n\n')) {
    console.log('✅ [4/7] PASÓ: Mensaje contiene enlace directo Rexup sin kommo.cc ni alteraciones.');
    passed++;
  } else {
    console.error('❌ [4/7] FALLÓ: Enlace no coincide o contiene kommo.cc:', res.text);
  }

  // ---------------------------------------------------------------------------
  // TEST 5: Cero repetición del saludo de bienvenida
  // ---------------------------------------------------------------------------
  if (res.text && !res.text.includes('Bienvenido a Tu Techo Ideal')) {
    console.log('✅ [5/7] PASÓ: No se repite el saludo de bienvenida en consultas repetidas.');
    passed++;
  } else {
    console.error('❌ [5/7] FALLÓ: El mensaje incluyó indebidamente el saludo de bienvenida:', res.text);
  }

  // Marcar como SENT en idempotencia
  idempotencyManager.markSent(msgKey, res.text);

  // ---------------------------------------------------------------------------
  // TEST 6: El mismo mensaje ID repetido es bloqueado por idempotencia
  // ---------------------------------------------------------------------------
  const dupLock = idempotencyManager.acquireLock(msgKey, talkId, leadId);
  if (!dupLock.allowed && dupLock.reason === 'ALREADY_SENT') {
    console.log('✅ [6/7] PASÓ: Retransmisión del mismo message_id es bloqueada atómicamente (ALREADY_SENT).');
    passed++;
  } else {
    console.error('❌ [6/7] FALLÓ: Duplicado no fue bloqueado:', dupLock);
  }

  // ---------------------------------------------------------------------------
  // TEST 7: Una tercera solicitud legítima con otro ID también recibe respuesta
  // ---------------------------------------------------------------------------
  const thirdMsgId = '9c381a10-5e22-4a01-9b77-551122334455';
  const thirdLock = idempotencyManager.acquireLock(`msg_${thirdMsgId}`, talkId, leadId);
  const thirdRes = await evaluateCentralDecisionPipeline({
    userText: '¿Podrías enviarme nuevamente el enlace de fotos?',
    leadId,
    talkId,
    contactId,
    properties,
    handoffManager,
    contextManager: freshContextManager,
    propertyRecoveryFn: recoverActivePropertyFromKommo
  });

  if (thirdLock.allowed && thirdRes.shouldRespond && thirdRes.text.includes(expectedRexup)) {
    console.log('✅ [7/7] PASÓ: Nueva solicitud legítima posterior se atiende con éxito manteniendo el inmueble activo.');
    passed++;
  } else {
    console.error('❌ [7/7] FALLÓ: Tercera solicitud no atendida:', thirdRes);
  }

  if (fs.existsSync(testStorePath)) fs.unlinkSync(testStorePath);

  console.log('\n================================================================');
  console.log(` RESULTADOS FINALES: ${passed} / ${total} PRUEBAS SUPERADAS (${Math.round(passed/total*100)}%)`);
  console.log('================================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runTest0824().catch(err => {
  console.error('Fatal error en test 0824:', err);
  process.exit(1);
});
