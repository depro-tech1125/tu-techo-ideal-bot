/**
 * SUITE DE PRUEBAS DE FASE 6: MULTIPORTAL, FOTOS Y CICLO COMERCIAL COMPLETO
 * TU TECHO IDEAL V5.0
 *
 * Verifica los 12 casos obligatorios:
 * 1. Enlace Wasi registrado.
 * 2. Enlace Mercado Libre registrado.
 * 3. Enlace de página web propia.
 * 4. Identificador inexistente.
 * 5. Propiedad disponible.
 * 6. Propiedad no disponible.
 * 7. Solicitud de información ampliada mediante LINK_FOTOS (Rexup dinámico).
 * 8. Dos publicaciones diferentes del mismo inmueble (MLV-1029979186 y MLV-781799115 -> REF-035).
 * 9. Preguntas consecutivas sobre precio y metraje.
 * 10. Un mensaje entrante produce una sola respuesta.
 * 11. Un evento repetido no genera otro mensaje.
 * 12. Un mensaje saliente del bot no vuelve a activar el pipeline.
 */

const fs = require('fs');
const path = require('path');
const {
  evaluateCentralDecisionPipeline,
  adaptProperty,
  classifyOutgoingMessage,
  UNAVAILABLE_RESPONSE,
  ConversationContextManager,
  HandoffManager
} = require('../pipeline_decision');
const { IdempotencyManager } = require('../lib/idempotency_manager');
const { extractMultiportalPropertyIdentifiers } = require('../lib/multiportal_extractor');

const rawProps = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'properties_cache.json'), 'utf8'));

let passedCount = 0;
let totalTests = 12;

function assertTest(testNum, desc, condition, detail) {
  if (condition) {
    passedCount++;
    console.log(`\x1b[32m✅ [Test ${testNum}/${totalTests}] PASÓ: ${desc}\x1b[0m`);
    if (detail) console.log(`   Detalle: ${detail}`);
  } else {
    console.error(`\x1b[31m❌ [Test ${testNum}/${totalTests}] FALLÓ: ${desc}\x1b[0m`);
    if (detail) console.error(`   Detalle: ${detail}`);
    process.exitCode = 1;
  }
}

async function runSuite() {
  console.log('================================================================');
  console.log(' SUITE DE VERIFICACIÓN FASE 6: MULTIPORTAL, FOTOS Y CICLO V5.0 ');
  console.log('================================================================\n');

  const contextMgr = new ConversationContextManager();
  const dummyHandoffFile = path.join(__dirname, 'dummy_handoffs_multiportal.json');
  if (fs.existsSync(dummyHandoffFile)) fs.unlinkSync(dummyHandoffFile);
  const handoffMgr = new HandoffManager(dummyHandoffFile);

  const idempotencyDir = path.join(__dirname, 'dummy_idempotency_multiportal');
  if (fs.existsSync(idempotencyDir)) fs.rmSync(idempotencyDir, { recursive: true, force: true });
  const idempotencyMgr = new IdempotencyManager(idempotencyDir);

  const now = Date.now();

  // --------------------------------------------------------------------------
  // TEST 1: Enlace Wasi registrado
  // --------------------------------------------------------------------------
  const res1 = await evaluateCentralDecisionPipeline({
    userText: 'Hola, vi esto en Wasi https://info.wasi.co/oficina-alquiler-la-california-norte-caracas/10448420',
    leadId: 'lead_test_1',
    talkId: 'talk_test_1',
    properties: rawProps,
    contextManager: contextMgr,
    handoffManager: handoffMgr,
    currentTime: now
  });

  assertTest(
    1,
    'Enlace Wasi registrado -> Bienvenida e identificación de REF-035',
    res1.shouldRespond === true &&
    (res1.text === 'Bienvenido a Tu Techo Ideal, sí, disponible.' || res1.text.includes('disponible')) &&
    res1.log.propertyIdentified === 'REF-035',
    `Respondió: "${res1.text}", Propiedad: ${res1.log.propertyIdentified}`
  );

  // --------------------------------------------------------------------------
  // TEST 2: Enlace Mercado Libre registrado
  // --------------------------------------------------------------------------
  const res2 = await evaluateCentralDecisionPipeline({
    userText: 'Buenas tardes, me interesa esta publicación de Mercado Libre: https://casa.mercadolibre.com.ve/MLV-1030436362?ua=p0YovqJLL2_Ii_0ZF870oMVJrdIlOSln0zE_AK9v_ZFj_SwP#origin=share&sid=share&action=copy',
    leadId: 'lead_test_2',
    talkId: 'talk_test_2',
    properties: rawProps,
    contextManager: contextMgr,
    handoffManager: handoffMgr,
    currentTime: now
  });

  assertTest(
    2,
    'Enlace Mercado Libre registrado -> Bienvenida e identificación de REF-001',
    res2.shouldRespond === true &&
    (res2.text === 'Bienvenido a Tu Techo Ideal, sí, disponible.' || res2.text.includes('disponible')) &&
    res2.log.propertyIdentified === 'REF-001',
    `Respondió: "${res2.text}", Propiedad: ${res2.log.propertyIdentified}`
  );

  // --------------------------------------------------------------------------
  // TEST 3: Enlace de página web propia
  // --------------------------------------------------------------------------
  const res3 = await evaluateCentralDecisionPipeline({
    userText: 'Hola https://tutechoideal.com/inmuebles/cubiculos-en-alquiler-en-la-california-norte/',
    leadId: 'lead_test_3',
    talkId: 'talk_test_3',
    properties: rawProps,
    contextManager: contextMgr,
    handoffManager: handoffMgr,
    currentTime: now
  });

  assertTest(
    3,
    'Enlace de página web propia -> Bienvenida e identificación de REF-035',
    res3.shouldRespond === true &&
    (res3.text === 'Bienvenido a Tu Techo Ideal, sí, disponible.' || res3.text.includes('disponible')) &&
    res3.log.propertyIdentified === 'REF-035',
    `Respondió: "${res3.text}", Propiedad: ${res3.log.propertyIdentified}`
  );

  // --------------------------------------------------------------------------
  // TEST 4: Identificador inexistente
  // --------------------------------------------------------------------------
  const res4 = await evaluateCentralDecisionPipeline({
    userText: 'Hola https://inmueble.mercadolibre.com.ve/MLV-9999999999-inmueble-inexistente-_JM',
    leadId: 'lead_test_4',
    talkId: 'talk_test_4',
    properties: rawProps,
    contextManager: contextMgr,
    handoffManager: handoffMgr,
    currentTime: now
  });

  assertTest(
    4,
    'Identificador inexistente -> Silencio absoluto (Cero invención)',
    res4.shouldRespond === false && res4.log.action === 'SILENCE',
    `Acción: ${res4.log.action}, Razón: ${res4.log.reason}`
  );

  // --------------------------------------------------------------------------
  // TEST 5: Propiedad disponible
  // --------------------------------------------------------------------------
  const propRef035 = rawProps.find(p => p.ID_PROPIEDAD === 'REF-035');
  const res5 = await evaluateCentralDecisionPipeline({
    userText: 'https://info.wasi.co/oficina-alquiler-la-california-norte-caracas/10448420',
    leadId: 'lead_test_5',
    talkId: 'talk_test_5',
    properties: rawProps,
    contextManager: contextMgr,
    handoffManager: handoffMgr,
    currentTime: now
  });

  assertTest(
    5,
    'Propiedad disponible (ESTATUS === "Disponible") -> Saludo comercial V5.0',
    res5.shouldRespond === true &&
    propRef035.ESTATUS === 'Disponible' &&
    (res5.text === 'Bienvenido a Tu Techo Ideal, sí, disponible.' || res5.text.includes('disponible')),
    `Estatus verificado en Sheets: "${propRef035.ESTATUS}", Respuesta: "${res5.text}"`
  );

  // --------------------------------------------------------------------------
  // TEST 6: Propiedad no disponible
  // --------------------------------------------------------------------------
  const mockPropsWithUnavailable = [
    ...rawProps.filter(p => p.ID_PROPIEDAD !== 'REF-035'),
    {
      ...propRef035,
      ESTATUS: 'No Disponible'
    }
  ];

  const res6 = await evaluateCentralDecisionPipeline({
    userText: 'https://info.wasi.co/oficina-alquiler-la-california-norte-caracas/10448420',
    leadId: 'lead_test_6',
    talkId: 'talk_test_6',
    properties: mockPropsWithUnavailable,
    contextManager: contextMgr,
    handoffManager: handoffMgr,
    currentTime: now
  });

  assertTest(
    6,
    'Propiedad no disponible (ESTATUS === "No Disponible") -> Comunica brevemente estado real sin afirmar disponible',
    res6.shouldRespond === true && res6.text === UNAVAILABLE_RESPONSE && res6.log.typeDetected === 'PROPERTY_LINK_NOT_AVAILABLE',
    `Acción: ${res6.log.action}, Respuesta: "${res6.text}", Tipo: ${res6.log.typeDetected}`
  );

  // --------------------------------------------------------------------------
  // TEST 7: Solicitud de información ampliada mediante LINK_FOTOS
  // --------------------------------------------------------------------------
  // En conversación activa de REF-035:
  contextMgr.saveContext('talk_test_7', 'lead_test_7', adaptProperty(propRef035));
  handoffMgr.activateAutomation('lead_test_7', 'talk_test_7', null, 'REF-035');

  const res7 = await evaluateCentralDecisionPipeline({
    userText: 'Pásame las fotos y los detalles completos por favor',
    leadId: 'lead_test_7',
    talkId: 'talk_test_7',
    properties: rawProps,
    contextManager: contextMgr,
    handoffManager: handoffMgr,
    currentTime: now
  });

  const expectedRexupLink = 'https://www.rexup.net/AAAAAAA/ver_inmueble_c.php?cod_inmueble=3431731625';

  assertTest(
    7,
    'Solicitud de información ampliada mediante LINK_FOTOS -> Mensaje profesional con enlace Rexup exacto de Google Sheets',
    res7.shouldRespond === true &&
    res7.text.includes(expectedRexupLink) &&
    res7.text.includes('¡Claro! Aquí puedes consultar más fotografías') &&
    res7.log.typeDetected === 'PROPERTY_EXTENDED_INFO_LINK_FOTOS',
    `Mensaje entregado: "${res7.text}" (Exactitud con Google Sheets Col E: 100%)`
  );

  // --------------------------------------------------------------------------
  // TEST 8: Dos publicaciones diferentes del mismo inmueble
  // --------------------------------------------------------------------------
  const pub1Text = 'https://inmueble.mercadolibre.com.ve/MLV-781799115';
  const pub2Text = 'Hola, tengo algunas preguntas sobre tu publicación en Mercado Libre: https://inmueble.mercadolibre.com.ve/MLV-1029979186-alquilo-cubiculos-20m2-torre-profesional-la-california-8420-_JM';

  const extPub1 = extractMultiportalPropertyIdentifiers(pub1Text, rawProps, adaptProperty);
  const extPub2 = extractMultiportalPropertyIdentifiers(pub2Text, rawProps, adaptProperty);

  assertTest(
    8,
    'Dos publicaciones diferentes del mismo inmueble -> Ambas identifican exclusivamente REF-035',
    extPub1.matches[0]?.ID_PROPIEDAD === 'REF-035' &&
    extPub2.matches[0]?.ID_PROPIEDAD === 'REF-035',
    `Publicación original: ${extPub1.matches[0]?.ID_PROPIEDAD} (MLV-781799115) | Publicación alternativa: ${extPub2.matches[0]?.ID_PROPIEDAD} (MLV-1029979186)`
  );

  // --------------------------------------------------------------------------
  // TEST 9: Preguntas consecutivas sobre precio y metraje
  // --------------------------------------------------------------------------
  contextMgr.saveContext('talk_test_9', 'lead_test_9', adaptProperty(propRef035));
  handoffMgr.activateAutomation('lead_test_9', 'talk_test_9', null, 'REF-035');

  // Turno 1: Precio
  const res9a = await evaluateCentralDecisionPipeline({
    userText: '¿Cuál es el precio de alquiler?',
    leadId: 'lead_test_9',
    talkId: 'talk_test_9',
    properties: rawProps,
    contextManager: contextMgr,
    handoffManager: handoffMgr,
    currentTime: now
  });

  // Turno 2: Metraje
  const res9b = await evaluateCentralDecisionPipeline({
    userText: '¿Cuántos metros cuadrados tiene?',
    leadId: 'lead_test_9',
    talkId: 'talk_test_9',
    properties: rawProps,
    contextManager: contextMgr,
    handoffManager: handoffMgr,
    currentTime: now + 5000
  });

  assertTest(
    9,
    'Preguntas consecutivas sobre precio y metraje -> Respuestas deterministas ($300 y 19 m²)',
    res9a.shouldRespond === true &&
    res9a.text === '$300' &&
    res9b.shouldRespond === true &&
    res9b.text.includes('19 m²'),
    `Turno Precio: "${res9a.text}" | Turno Metraje: "${res9b.text}"`
  );

  // --------------------------------------------------------------------------
  // TEST 10: Un mensaje entrante produce una sola respuesta
  // --------------------------------------------------------------------------
  const msgKey10 = 'msg_single_001';
  const lockAcquired10 = idempotencyMgr.acquireLock(msgKey10, 'talk_test_10', 'lead_test_10');
  let dispatchedCount = 0;
  if (lockAcquired10.allowed) {
    dispatchedCount++;
    idempotencyMgr.markSent(msgKey10, '$300');
  }

  assertTest(
    10,
    'Un mensaje entrante produce una sola respuesta',
    lockAcquired10.allowed === true && dispatchedCount === 1,
    `Disparos ejecutados: ${dispatchedCount}`
  );

  // --------------------------------------------------------------------------
  // TEST 11: Un evento repetido no genera otro mensaje
  // --------------------------------------------------------------------------
  const lockRetry11 = idempotencyMgr.acquireLock(msgKey10, 'talk_test_10', 'lead_test_10');
  let duplicateDispatched = false;
  if (lockRetry11.allowed) {
    duplicateDispatched = true;
  }

  assertTest(
    11,
    'Un evento repetido no genera otro mensaje (Idempotencia)',
    lockRetry11.allowed === false &&
    lockRetry11.reason === 'ALREADY_SENT' &&
    duplicateDispatched === false,
    `Permitido: ${lockRetry11.allowed}, Motivo de rechazo: ${lockRetry11.reason}`
  );

  // --------------------------------------------------------------------------
  // TEST 12: Un mensaje saliente del bot no vuelve a activar el pipeline
  // --------------------------------------------------------------------------
  const outgoingBotMsg = {
    type: 'outgoing_chat_message',
    text: 'https://www.rexup.net/AAAAAAA/ver_inmueble_c.php?cod_inmueble=3431731625',
    author: {
      type: 'bot',
      name: 'salesbot',
      id: '100766'
    },
    created_by: 0
  };

  const classification = classifyOutgoingMessage(outgoingBotMsg);

  assertTest(
    12,
    'Un mensaje saliente del bot no vuelve a activar el pipeline (isBot === true)',
    classification.isBot === true && classification.isHumanAdvisor === false,
    `isBot: ${classification.isBot}, isHumanAdvisor: ${classification.isHumanAdvisor}, Razón: ${classification.reason}`
  );

  // Limpieza de archivos de prueba
  try {
    if (fs.existsSync(dummyHandoffFile)) fs.unlinkSync(dummyHandoffFile);
    if (fs.existsSync(idempotencyDir)) fs.rmSync(idempotencyDir, { recursive: true, force: true });
  } catch (e) {}

  console.log('\n================================================================');
  console.log(` RESULTADOS FINALES: ${passedCount} / ${totalTests} PRUEBAS SUPERADAS (${Math.round(passedCount/totalTests*100)}%) `);
  console.log('================================================================');

  if (passedCount === totalTests) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runSuite().catch(err => {
  console.error('Error fatal ejecutando suite:', err);
  process.exit(1);
});
