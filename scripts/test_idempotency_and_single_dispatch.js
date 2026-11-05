const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Cargar componentes del sistema
const { IdempotencyManager } = require('../lib/idempotency_manager.js');
const {
  evaluateCentralDecisionPipeline,
  ConversationContextManager,
  HandoffManager,
  classifyOutgoingMessage
} = require('../pipeline_decision.js');

const propertiesCachePath = path.join(__dirname, '..', 'properties_cache.json');
const properties = JSON.parse(fs.readFileSync(propertiesCachePath, 'utf8'));

const testStorePath = path.join(__dirname, '..', 'test_idempotency_suite_store.json');
if (fs.existsSync(testStorePath)) fs.unlinkSync(testStorePath);

async function runTestSuite() {
  console.log('================================================================');
  console.log(' SUITE DE PRUEBAS OBLIGATORIAS: IDEMPOTENCIA Y DESPACHO ÚNICO   ');
  console.log('================================================================\n');

  let passed = 0;
  let total = 10;

  const idemp = new IdempotencyManager(testStorePath);
  const handoffManager = new HandoffManager();
  const contextManager = new ConversationContextManager();

  // Pre-cargar contexto para REF-003 (Alta Florida)
  const propAltaFlorida = properties.find(p => p.ID_PROPIEDAD === 'REF-003');
  contextManager.saveContext('talk_suite_1', 'lead_suite_1', propAltaFlorida);

  // --------------------------------------------------------------------------
  // TEST 1: Un mensaje entrante produce exactamente una respuesta
  // --------------------------------------------------------------------------
  try {
    const msgId = 'msg_req_001';
    const lock = idemp.acquireLock(msgId, 'talk_suite_1', 'lead_suite_1');
    assert.strictEqual(lock.allowed, true, 'El primer lock debe permitirse');

    const result = await evaluateCentralDecisionPipeline({
      userText: '¿Cuál es el precio de venta?',
      leadId: 'lead_suite_1',
      talkId: 'talk_suite_1',
      contactId: 'contact_suite_1',
      properties,
      handoffManager,
      contextManager,
      currentTime: Date.now()
    });

    assert.strictEqual(result.shouldRespond, true, 'Debe responder a la pregunta de precio');
    assert.strictEqual(result.text, '$600.000', 'La respuesta debe ser exactamente $600.000');
    idemp.markSent(msgId, result.text, { dispatched: true });

    passed++;
    console.log('✅ [Test 1/10] PASÓ: Un mensaje entrante produce exactamente una respuesta.');
    console.log(`   Detalle: msgId=${msgId}, respuesta="${result.text}", status=${idemp.getStatus(msgId).status}`);
  } catch (err) {
    console.error('❌ [Test 1/10] FALLÓ:', err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 2: El mismo evento entrante recibido dos veces produce solamente una respuesta
  // --------------------------------------------------------------------------
  try {
    const msgId = 'msg_req_001'; // Mismo mensaje que el Test 1
    const secondLock = idemp.acquireLock(msgId, 'talk_suite_1', 'lead_suite_1');
    assert.strictEqual(secondLock.allowed, false, 'El segundo intento del mismo msgId debe bloquearse');
    assert.strictEqual(secondLock.reason, 'ALREADY_SENT', 'El motivo debe ser ALREADY_SENT');

    passed++;
    console.log('✅ [Test 2/10] PASÓ: El mismo evento entrante recibido dos veces produce solamente una respuesta.');
    console.log(`   Detalle: Intento duplicado bloqueado con reason=${secondLock.reason}`);
  } catch (err) {
    console.error('❌ [Test 2/10] FALLÓ:', err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 3: Dos preguntas legítimas con identificadores diferentes pueden recibir dos respuestas
  // --------------------------------------------------------------------------
  try {
    // Primera pregunta legítima
    const msgA = 'msg_legit_001';
    const lockA = idemp.acquireLock(msgA, 'talk_suite_1', 'lead_suite_1');
    assert.strictEqual(lockA.allowed, true);
    idemp.markSent(msgA, '$600.000');

    // Segunda pregunta legítima con idéntico texto pero evento distinto
    const msgB = 'msg_legit_002';
    const lockB = idemp.acquireLock(msgB, 'talk_suite_1', 'lead_suite_1');
    assert.strictEqual(lockB.allowed, true, 'Una segunda pregunta legítima con distinto ID no debe bloquearse');

    const resultB = await evaluateCentralDecisionPipeline({
      userText: '¿Cuál es el precio de venta?',
      leadId: 'lead_suite_1',
      talkId: 'talk_suite_1',
      contactId: 'contact_suite_1',
      properties,
      handoffManager,
      contextManager,
      currentTime: Date.now()
    });
    assert.strictEqual(resultB.text, '$600.000');
    idemp.markSent(msgB, resultB.text);

    passed++;
    console.log('✅ [Test 3/10] PASÓ: Dos preguntas legítimas con identificadores diferentes pueden recibir dos respuestas.');
    console.log(`   Detalle: msgA=${msgA} (SENT) y msgB=${msgB} (SENT) ambas procesadas correctamente.`);
  } catch (err) {
    console.error('❌ [Test 3/10] FALLÓ:', err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 4: Un webhook reintentado no duplica el despacho
  // --------------------------------------------------------------------------
  try {
    const webhookMsgId = 'msg_retry_999';
    // Intento 1: Webhook recibido y procesado
    const lock1 = idemp.acquireLock(webhookMsgId, 'talk_suite_1', 'lead_suite_1');
    assert.strictEqual(lock1.allowed, true);
    idemp.markSent(webhookMsgId, 'Respuesta entregada');

    // Intento 2: Kommo reintenta el webhook debido a timeout de red
    const lockRetry = idemp.acquireLock(webhookMsgId, 'talk_suite_1', 'lead_suite_1');
    assert.strictEqual(lockRetry.allowed, false, 'El reintento no debe volver a despachar');
    assert.strictEqual(lockRetry.reason, 'ALREADY_SENT');

    passed++;
    console.log('✅ [Test 4/10] PASÓ: Un webhook reintentado no duplica el despacho.');
    console.log(`   Detalle: Webhook reintentado ${webhookMsgId} interceptado antes de ejecutar pipeline.`);
  } catch (err) {
    console.error('❌ [Test 4/10] FALLÓ:', err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 5: Un mensaje saliente del bot no vuelve a activar el pipeline
  // --------------------------------------------------------------------------
  try {
    const botOutgoingEcho = {
      id: 'echo_bot_001',
      type: 'outgoing',
      text: 'Bienvenido a Tu Techo Ideal, sí, disponible.',
      entity_id: 'lead_suite_1',
      talk_id: 'talk_suite_1',
      author: { type: 'bot', name: 'Salesbot' }
    };

    const classification = classifyOutgoingMessage(botOutgoingEcho, () => true);
    assert.strictEqual(classification.isBot, true, 'El mensaje debe ser clasificado como bot');
    assert.strictEqual(classification.isHumanAdvisor, false, 'No debe ser catalogado como asesor humano');

    passed++;
    console.log('✅ [Test 5/10] PASÓ: Un mensaje saliente del bot no vuelve a activar el pipeline.');
    console.log(`   Detalle: isBot=${classification.isBot}, isHumanAdvisor=${classification.isHumanAdvisor}, source=${classification.source}`);
  } catch (err) {
    console.error('❌ [Test 5/10] FALLÓ:', err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 6: Dos eventos concurrentes no generan dos envíos
  // --------------------------------------------------------------------------
  try {
    const concurrentKey = 'msg_concurrent_sync';
    const firstAcquire = idemp.acquireLock(concurrentKey, 'talk_suite_1', 'lead_suite_1');
    const secondAcquire = idemp.acquireLock(concurrentKey, 'talk_suite_1', 'lead_suite_1');

    assert.strictEqual(firstAcquire.allowed, true, 'La primera petición concurrente adquiere el lock');
    assert.strictEqual(secondAcquire.allowed, false, 'La segunda petición concurrente es rechazada');
    assert.strictEqual(secondAcquire.reason, 'IN_FLIGHT_PROCESSING');

    passed++;
    console.log('✅ [Test 6/10] PASÓ: Dos eventos concurrentes no generan dos envíos.');
    console.log(`   Detalle: Primera petición allowed=true, segunda petición allowed=false (reason=${secondAcquire.reason})`);
  } catch (err) {
    console.error('❌ [Test 6/10] FALLÓ:', err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 7: Un timeout de despacho no provoca un segundo mensaje si el primero ya fue entregado
  // --------------------------------------------------------------------------
  try {
    const timeoutMsgId = 'msg_timeout_001';
    idemp.acquireLock(timeoutMsgId, 'talk_suite_1', 'lead_suite_1');
    idemp.markSent(timeoutMsgId, 'Cuenta con 933 m² de terreno y 699 m² de construcción.', { deliveredAt: Date.now() });

    // Verificación pre-despacho antes de cualquier supuesto reintento
    const status = idemp.getStatus(timeoutMsgId);
    assert.strictEqual(status.status, 'SENT', 'El mensaje ya fue registrado como entregado');

    const retryCheck = idemp.acquireLock(timeoutMsgId, 'talk_suite_1', 'lead_suite_1');
    assert.strictEqual(retryCheck.allowed, false);
    assert.strictEqual(retryCheck.reason, 'ALREADY_SENT');

    passed++;
    console.log('✅ [Test 7/10] PASÓ: Un timeout de despacho no provoca un segundo mensaje si el primero ya fue entregado.');
    console.log(`   Detalle: Estado verificado en persistencia = ${status.status}, retry bloqueado.`);
  } catch (err) {
    console.error('❌ [Test 7/10] FALLÓ:', err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 8: Una pregunta de metraje responde correctamente
  // --------------------------------------------------------------------------
  try {
    const resultMetraje = await evaluateCentralDecisionPipeline({
      userText: '¿Cuántos metros tiene la propiedad?',
      leadId: 'lead_suite_1',
      talkId: 'talk_suite_1',
      contactId: 'contact_suite_1',
      properties,
      handoffManager,
      contextManager,
      currentTime: Date.now()
    });

    assert.strictEqual(resultMetraje.shouldRespond, true);
    assert.strictEqual(resultMetraje.text, 'Cuenta con 933 m² de terreno y 699 m² de construcción.');
    assert.strictEqual(resultMetraje.log.propertyIdentified, 'REF-003');

    passed++;
    console.log('✅ [Test 8/10] PASÓ: Una pregunta de metraje responde correctamente.');
    console.log(`   Detalle: Respuesta="${resultMetraje.text}", Propiedad=${resultMetraje.log.propertyIdentified}`);
  } catch (err) {
    console.error('❌ [Test 8/10] FALLÓ:', err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 9: Una pregunta de precio no vuelve a generar el saludo
  // --------------------------------------------------------------------------
  try {
    const resultPrecio = await evaluateCentralDecisionPipeline({
      userText: '¿Cuál es el precio de venta?',
      leadId: 'lead_suite_1',
      talkId: 'talk_suite_1',
      contactId: 'contact_suite_1',
      properties,
      handoffManager,
      contextManager,
      currentTime: Date.now()
    });

    assert.strictEqual(resultPrecio.shouldRespond, true);
    assert.strictEqual(resultPrecio.text, '$600.000');
    assert.ok(!resultPrecio.text.includes('Bienvenido'), 'No debe incluir saludo de bienvenida');

    passed++;
    console.log('✅ [Test 9/10] PASÓ: Una pregunta de precio no vuelve a generar el saludo.');
    console.log(`   Detalle: Respuesta="${resultPrecio.text}", no contiene bienvenida.`);
  } catch (err) {
    console.error('❌ [Test 9/10] FALLÓ:', err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 10: La intervención de un asesor humano sigue bloqueando las respuestas automáticas
  // --------------------------------------------------------------------------
  try {
    const now = Date.now();
    // Registrar intervención humana para talk_human_locked
    handoffManager.recordHumanIntervention('lead_human_1', 'talk_human_1', 'contact_human_1', now);

    // Cliente escribe 1 hora después (dentro de las 12 horas obligatorias)
    const clientMsgTime = now + (1 * 60 * 60 * 1000);
    const resultLocked = await evaluateCentralDecisionPipeline({
      userText: '¿Cuántos metros tiene la propiedad?',
      leadId: 'lead_human_1',
      talkId: 'talk_human_1',
      contactId: 'contact_human_1',
      properties,
      handoffManager,
      contextManager,
      currentTime: clientMsgTime
    });

    assert.strictEqual(resultLocked.shouldRespond, false, 'No debe responder bajo bloqueo humano');
    assert.strictEqual(resultLocked.text, null);
    assert.strictEqual(resultLocked.log.action, 'SILENCE');
    assert.strictEqual(resultLocked.log.typeDetected, 'HUMAN_LOCKED');

    passed++;
    console.log('✅ [Test 10/10] PASÓ: La intervención de un asesor humano sigue bloqueando las respuestas automáticas.');
    console.log(`   Detalle: Action=${resultLocked.log.action}, Type=${resultLocked.log.typeDetected}, Horas transcurridas=${resultLocked.log.hoursElapsed?.toFixed(2)}h`);
  } catch (err) {
    console.error('❌ [Test 10/10] FALLÓ:', err.message);
  }

  // Limpieza de archivo de pruebas
  if (fs.existsSync(testStorePath)) fs.unlinkSync(testStorePath);

  console.log('\n================================================================');
  console.log(` RESULTADOS FINALES: ${passed} / ${total} PRUEBAS SUPERADAS (${Math.round((passed / total) * 100)}%) `);
  console.log('================================================================');

  if (passed !== total) {
    process.exit(1);
  }
}

runTestSuite().catch(err => {
  console.error('Error crítico en suite de pruebas:', err);
  process.exit(1);
});
