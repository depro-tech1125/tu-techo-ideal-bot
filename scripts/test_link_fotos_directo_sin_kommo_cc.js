/**
 * SUITE DE PRUEBAS OBLIGATORIAS: ENVÍO DIRECTO DE LINK_FOTOS SIN KOMMO.CC
 * Tu Techo Ideal V5.0
 * 
 * Verifica los 14 requerimientos obligatorios de la Sección 7:
 * 1. Solicitud de fotografías de REF-035: obtiene el LINK_FOTOS correcto.
 * 2. Solicitud de información ampliada: obtiene el mismo enlace original.
 * 3. Dos inmuebles diferentes: cada uno recibe su propio enlace.
 * 4. LINK_FOTOS vacío: silencio seguro.
 * 5. Enlace inválido: silencio seguro.
 * 6. Parámetro cod_inmueble conservado.
 * 7. No se genera ningún kommo.cc desde nuestro código.
 * 8. No se altera el enlace durante la preparación del mensaje.
 * 9. No se repite el saludo.
 * 10. No se generan dos respuestas.
 * 11. La intervención humana sigue bloqueando durante 12 horas.
 * 12. Los mensajes internos no activan el bloqueo.
 * 13. Los mensajes salientes del bot no reactivan el pipeline.
 * 14. No existen regresiones en el reconocimiento multiportal.
 */

const fs = require('fs');
const path = require('path');
const {
  evaluateCentralDecisionPipeline,
  adaptProperty,
  classifyOutgoingMessage,
  ConversationContextManager,
  HandoffManager
} = require('../pipeline_decision');
const { IdempotencyManager } = require('../lib/idempotency_manager');

const rawProps = require('../properties_cache.json');

let passed = 0;
let total = 14;

function assert(num, title, cond, detail) {
  if (cond) {
    passed++;
    console.log(`\x1b[32m[PASS ${num}/14]\x1b[0m ${title}`);
    if (detail) console.log(`       Detalle: ${detail}`);
  } else {
    console.error(`\x1b[31m[FAIL ${num}/14]\x1b[0m ${title}`);
    if (detail) console.error(`       Detalle: ${detail}`);
    process.exitCode = 1;
  }
}

async function runLinkFotosSuite() {
  console.log('================================================================');
  console.log(' SUITE DE PRUEBAS OBLIGATORIAS: ENVÍO DIRECTO DE LINK_FOTOS     ');
  console.log('                 (TU TECHO IDEAL V5.0)                          ');
  console.log('================================================================\n');

  const contextMgr = new ConversationContextManager();
  const dummyHandoff = path.join(__dirname, 'dummy_fotos_handoff.json');
  if (fs.existsSync(dummyHandoff)) fs.unlinkSync(dummyHandoff);
  const handoffMgr = new HandoffManager(dummyHandoff);

  const dummyIdempDir = path.join(__dirname, 'dummy_fotos_idemp');
  if (fs.existsSync(dummyIdempDir)) fs.rmSync(dummyIdempDir, { recursive: true, force: true });
  const idempMgr = new IdempotencyManager(dummyIdempDir);

  const now = Date.now();
  const propRef035 = rawProps.find(p => p.ID_PROPIEDAD === 'REF-035');
  const propRef001 = rawProps.find(p => p.ID_PROPIEDAD === 'REF-001');

  const expectedLink035 = (propRef035.LINK_FOTOS || propRef035.LINK_FOTOS_URL || '').trim();
  const expectedLink001 = (propRef001.LINK_FOTOS || propRef001.LINK_FOTOS_URL || '').trim();

  // --------------------------------------------------------------------------
  // TEST 1: Solicitud de fotografías de REF-035 -> LINK_FOTOS correcto
  // --------------------------------------------------------------------------
  contextMgr.saveContext('talk_fotos_1', 'lead_fotos_1', adaptProperty(propRef035));
  handoffMgr.activateAutomation('lead_fotos_1', 'talk_fotos_1', null, 'REF-035');
  const r1 = await evaluateCentralDecisionPipeline({
    userText: '¿Me puedes compartir fotografías?',
    leadId: 'lead_fotos_1',
    talkId: 'talk_fotos_1',
    properties: rawProps,
    contextManager: contextMgr,
    handoffManager: handoffMgr,
    currentTime: now
  });
  assert(
    1,
    'Solicitud de fotografías de REF-035: obtiene el LINK_FOTOS correcto',
    r1.shouldRespond && r1.text.includes(expectedLink035) && r1.log.typeDetected === 'PROPERTY_EXTENDED_INFO_LINK_FOTOS',
    r1.text
  );

  // --------------------------------------------------------------------------
  // TEST 2: Solicitud de información ampliada -> mismo enlace original
  // --------------------------------------------------------------------------
  const r2 = await evaluateCentralDecisionPipeline({
    userText: '¿Dónde puedo ver más información y la ficha completa?',
    leadId: 'lead_fotos_1',
    talkId: 'talk_fotos_1',
    properties: rawProps,
    contextManager: contextMgr,
    handoffManager: handoffMgr,
    currentTime: now
  });
  assert(
    2,
    'Solicitud de información ampliada: obtiene el mismo enlace original',
    r2.shouldRespond && r2.text.includes(expectedLink035),
    r2.text
  );

  // --------------------------------------------------------------------------
  // TEST 3: Dos inmuebles diferentes -> cada uno recibe su propio enlace
  // --------------------------------------------------------------------------
  contextMgr.saveContext('talk_fotos_3b', 'lead_fotos_3b', adaptProperty(propRef001));
  handoffMgr.activateAutomation('lead_fotos_3b', 'talk_fotos_3b', null, 'REF-001');
  const r3 = await evaluateCentralDecisionPipeline({
    userText: '¿Tienes fotos?',
    leadId: 'lead_fotos_3b',
    talkId: 'talk_fotos_3b',
    properties: rawProps,
    contextManager: contextMgr,
    handoffManager: handoffMgr,
    currentTime: now
  });
  assert(
    3,
    'Dos inmuebles diferentes: cada uno recibe su propio enlace',
    r1.text.includes('3431731625') && r3.text.includes('3431603044') && r1.text !== r3.text,
    `REF-035: ${expectedLink035} | REF-001: ${expectedLink001}`
  );

  // --------------------------------------------------------------------------
  // TEST 4: LINK_FOTOS vacío o "-" -> Silencio seguro
  // --------------------------------------------------------------------------
  const propVacia = { ...propRef035, ID_PROPIEDAD: 'REF-998', LINK_FOTOS: '', LINK_FOTOS_URL: '' };
  contextMgr.saveContext('talk_fotos_4', 'lead_fotos_4', adaptProperty(propVacia));
  handoffMgr.activateAutomation('lead_fotos_4', 'talk_fotos_4', null, 'REF-998');
  const r4 = await evaluateCentralDecisionPipeline({
    userText: '¿Me puedes compartir fotografías?',
    leadId: 'lead_fotos_4',
    talkId: 'talk_fotos_4',
    properties: [propVacia],
    contextManager: contextMgr,
    handoffManager: handoffMgr,
    currentTime: now
  });
  assert(
    4,
    'LINK_FOTOS vacío: silencio seguro',
    !r4.shouldRespond && r4.log.action === 'SILENCE' && r4.log.typeDetected === 'PROPERTY_EXTENDED_INFO_SIN_LINK',
    r4.log.reason
  );

  // --------------------------------------------------------------------------
  // TEST 5: Enlace inválido -> Silencio seguro
  // --------------------------------------------------------------------------
  const propInvalida = { ...propRef035, ID_PROPIEDAD: 'REF-997', LINK_FOTOS: 'https://rexup.net/', LINK_FOTOS_URL: 'https://rexup.net/' };
  contextMgr.saveContext('talk_fotos_5', 'lead_fotos_5', adaptProperty(propInvalida));
  handoffMgr.activateAutomation('lead_fotos_5', 'talk_fotos_5', null, 'REF-997');
  const r5 = await evaluateCentralDecisionPipeline({
    userText: '¿Tienes fotos?',
    leadId: 'lead_fotos_5',
    talkId: 'talk_fotos_5',
    properties: [propInvalida],
    contextManager: contextMgr,
    handoffManager: handoffMgr,
    currentTime: now
  });
  assert(
    5,
    'Enlace inválido: silencio seguro',
    !r5.shouldRespond && r5.log.action === 'SILENCE',
    r5.log.reason
  );

  // --------------------------------------------------------------------------
  // TEST 6: Parámetro cod_inmueble conservado íntegramente
  // --------------------------------------------------------------------------
  const hasCodInmueble = r1.text.includes('cod_inmueble=3431731625');
  assert(
    6,
    'Parámetro cod_inmueble conservado',
    hasCodInmueble,
    'cod_inmueble=3431731625 presente'
  );

  // --------------------------------------------------------------------------
  // TEST 7: No se genera ningún kommo.cc desde nuestro código
  // --------------------------------------------------------------------------
  const hasKommoCc = r1.text.includes('kommo.cc') || r2.text.includes('kommo.cc') || r3.text.includes('kommo.cc');
  assert(
    7,
    'No se genera ningún kommo.cc desde nuestro código',
    !hasKommoCc,
    'Cero kommo.cc generado en el microservicio'
  );

  // --------------------------------------------------------------------------
  // TEST 8: No se altera el enlace durante la preparación del mensaje
  // --------------------------------------------------------------------------
  const extractedUrl = r1.text.split('\n\n')[1] || r1.text.split(': ')[1];
  assert(
    8,
    'No se altera el enlace durante la preparación del mensaje',
    extractedUrl === expectedLink035,
    `Original en Sheets: "${expectedLink035}" | En respuesta: "${extractedUrl}"`
  );

  // --------------------------------------------------------------------------
  // TEST 9: No se repite el saludo
  // --------------------------------------------------------------------------
  const containsGreeting = r1.text.toLowerCase().includes('bienvenido a tu techo ideal');
  assert(
    9,
    'No se repite el saludo al consultar fotos tras la bienvenida',
    !containsGreeting,
    'Respuesta contiene exclusivamente texto de fotos sin saludo duplicado'
  );

  // --------------------------------------------------------------------------
  // TEST 10: No se generan dos respuestas
  // --------------------------------------------------------------------------
  const msgKey10 = 'msg_fotos_test_10';
  const lock10a = idempMgr.acquireLock(msgKey10, 'talk_10', 'lead_10');
  let dispatches = 0;
  if (lock10a.allowed) {
    dispatches++;
    idempMgr.markSent(msgKey10, r1.text);
  }
  const lock10b = idempMgr.acquireLock(msgKey10, 'talk_10', 'lead_10');
  if (lock10b.allowed) dispatches++;
  assert(
    10,
    'No se generan dos respuestas (Idempotencia)',
    dispatches === 1 && !lock10b.allowed,
    `Disparos: ${dispatches} | Rechazo idempotencia: ${lock10b.reason}`
  );

  // --------------------------------------------------------------------------
  // TEST 11: La intervención humana sigue bloqueando durante 12 horas
  // --------------------------------------------------------------------------
  handoffMgr.recordHumanIntervention('lead_fotos_11', 'talk_fotos_11', null, now);
  const r11 = await evaluateCentralDecisionPipeline({
    userText: '¿Me compartes el enlace de la propiedad?',
    leadId: 'lead_fotos_11',
    talkId: 'talk_fotos_11',
    properties: rawProps,
    contextManager: contextMgr,
    handoffManager: handoffMgr,
    currentTime: now + 3600000 // 1 hora después
  });
  assert(
    11,
    'La intervención humana sigue bloqueando durante 12 horas',
    !r11.shouldRespond && r11.log.typeDetected === 'HUMAN_LOCKED',
    r11.log.reason
  );

  // --------------------------------------------------------------------------
  // TEST 12: Los mensajes internos no activan el bloqueo
  // --------------------------------------------------------------------------
  const c12 = classifyOutgoingMessage({
    type: 'note',
    message_type: 'note',
    is_internal: true,
    text: 'Nota del asesor para revisión interna de fotos'
  });
  assert(
    12,
    'Los mensajes internos no activan el bloqueo (isInternalNote: true)',
    c12.isInternalNote === true && !c12.isHumanAdvisor,
    c12.reason
  );

  // --------------------------------------------------------------------------
  // TEST 13: Los mensajes salientes del bot no reactivan el pipeline
  // --------------------------------------------------------------------------
  const c13 = classifyOutgoingMessage({
    author: { type: 'bot', name: 'salesbot', id: '100766' },
    text: r1.text
  });
  assert(
    13,
    'Los mensajes salientes del bot no reactivan el pipeline (isBot: true)',
    c13.isBot === true && !c13.isHumanAdvisor,
    c13.reason
  );

  // --------------------------------------------------------------------------
  // TEST 14: No existen regresiones en el reconocimiento multiportal
  // --------------------------------------------------------------------------
  const r14_wasi = await evaluateCentralDecisionPipeline({
    userText: 'https://info.wasi.co/oficina-alquiler-la-california-norte-caracas/10448420',
    leadId: 'l14a', talkId: 't14a', properties: rawProps, contextManager: contextMgr, handoffManager: handoffMgr, currentTime: now
  });
  const r14_ml = await evaluateCentralDecisionPipeline({
    userText: 'https://inmueble.mercadolibre.com.ve/MLV-1029979186-alquilo-cubiculos-20m2-torre-profesional-la-california-8420-_JM',
    leadId: 'l14b', talkId: 't14b', properties: rawProps, contextManager: contextMgr, handoffManager: handoffMgr, currentTime: now
  });
  const r14_rexup = await evaluateCentralDecisionPipeline({
    userText: 'https://www.rexup.net/AAAAAAA/ver_inmueble_c.php?cod_inmueble=3431731625',
    leadId: 'l14c', talkId: 't14c', properties: rawProps, contextManager: contextMgr, handoffManager: handoffMgr, currentTime: now
  });
  const multiOk = r14_wasi.log.propertyIdentified === 'REF-035' &&
                  r14_ml.log.propertyIdentified === 'REF-035' &&
                  r14_rexup.log.propertyIdentified === 'REF-035';
  assert(
    14,
    'No existen regresiones en el reconocimiento multiportal (Wasi, ML, Rexup -> REF-035)',
    multiOk,
    `Wasi: ${r14_wasi.log.propertyIdentified} | ML: ${r14_ml.log.propertyIdentified} | Rexup: ${r14_rexup.log.propertyIdentified}`
  );

  // Limpieza
  try {
    if (fs.existsSync(dummyHandoff)) fs.unlinkSync(dummyHandoff);
    if (fs.existsSync(dummyIdempDir)) fs.rmSync(dummyIdempDir, { recursive: true, force: true });
  } catch (e) {}

  console.log('\n================================================================');
  console.log(` RESULTADOS SUITE FOTOS: ${passed} / ${total} PRUEBAS SUPERADAS (${Math.round(passed / total * 100)}%) `);
  console.log('================================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runLinkFotosSuite().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
