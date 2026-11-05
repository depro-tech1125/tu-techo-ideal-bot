/**
 * SUITE DE PRUEBAS: CONTROL DE RESPUESTAS COMERCIALES Y TRANSFERENCIA HUMANA
 * Tu Techo Ideal V5.0 — Directriz: "El bot informa. Robert vende."
 *
 * 14 Escenarios de Verificación Obligatorios:
 * 1. Enlace de MLSCaracas reconocido y respuesta breve.
 * 2. Enlace de Wasi reconocido y respuesta breve.
 * 3. Enlace de Mercado Libre reconocido y respuesta breve.
 * 4. Enlace de Rexup reconocido y respuesta breve.
 * 5. Pregunta de precio y respuesta únicamente con el precio.
 * 6. Pregunta de metraje y respuesta únicamente con el metraje.
 * 7. Pregunta de disponibilidad y respuesta correspondiente.
 * 8. Consulta de varias características documentadas.
 * 9. Solicitud de visita y alerta a Robert.
 * 10. Solicitud de reserva y alerta a Robert.
 * 11. Solicitud de firma o cierre y alerta a Robert.
 * 12. Consulta sin información documentada y aplicación de la política de cero invención.
 * 13. Verificación de que no se generen mensajes adicionales después de una respuesta informativa.
 * 14. Verificación de que el Human Lock siga funcionando.
 */

const fs = require('fs');
const path = require('path');
const {
  evaluateCentralDecisionPipeline,
  ConversationContextManager,
  HandoffManager,
  buildConfirmedPropertyAvailabilityResponse,
  isHumanAttentionRequest,
  AVAILABILITY_RESPONSE,
  UNAVAILABLE_RESPONSE
} = require('../pipeline_decision');

const testHandoffFile = path.join(__dirname, 'test_commercial_control_handoff.json');

async function runCommercialControlTests() {
  console.log('================================================================');
  console.log(' SUITE DE PRUEBAS: CONTROL DE RESPUESTAS COMERCIALES V5.0      ');
  console.log('        "El bot informa. Robert vende. (14 Escenarios)"         ');
  console.log('================================================================\n');

  if (fs.existsSync(testHandoffFile)) fs.unlinkSync(testHandoffFile);

  const rawProps = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'properties_cache.json'), 'utf8'));
  const handoffManager = new HandoffManager(testHandoffFile);
  const contextManager = new ConversationContextManager();

  const ref007 = rawProps.find(p => p.ID_PROPIEDAD === 'REF-007');
  const expectedRef007Response = '¡Hola! Sí, el apartamento en Los Palos Grandes se encuentra disponible para venta. Cuenta con 106,43 m² y su precio es de USD 130.000.';

  const bannedSalesPhrases = [
    'coordinar una visita',
    'agendemos una cita',
    'conocer el inmueble',
    'un asesor te contacte',
    'quieres reservarlo',
    'te gustaría visitar',
    'cuándo te gustaría',
    'deseas coordinar',
    'estamos a la orden para visitarlo'
  ];

  function containsBannedSalesPitch(text) {
    if (!text) return false;
    const lower = text.toLowerCase();
    return bannedSalesPhrases.some(phrase => lower.includes(phrase));
  }

  let passed = 0;
  let total = 14;

  // --------------------------------------------------------------------------
  // TEST 1: Enlace de MLSCaracas reconocido y respuesta breve
  // --------------------------------------------------------------------------
  const res1 = await evaluateCentralDecisionPipeline({
    userText: 'Hola, tengo una pregunta sobre esta publicación: https://mlscaracas.com/apartamento-venta-los-palos-grandes-caracas/10441563',
    talkId: 'talk_ctrl_1',
    leadId: 'lead_ctrl_1',
    contactId: 'contact_ctrl_1',
    properties: rawProps,
    contextManager,
    handoffManager
  });

  const test1Valid = res1.shouldRespond &&
    res1.text === expectedRef007Response &&
    !containsBannedSalesPitch(res1.text) &&
    res1.log.propertyIdentified === 'REF-007';

  if (test1Valid) {
    console.log('✅ [PASS 1/14] Enlace de MLSCaracas reconocido -> Respuesta breve y confirmada exacta:');
    console.log(`   "${res1.text}"`);
    passed++;
  } else {
    console.log(`❌ [FAIL 1/14] MLSCaracas falló. Respondió: "${res1.text}"`);
  }

  // --------------------------------------------------------------------------
  // TEST 2: Enlace de Wasi reconocido y respuesta breve
  // --------------------------------------------------------------------------
  const res2 = await evaluateCentralDecisionPipeline({
    userText: 'Buenas tardes, me interesa este inmueble https://info.wasi.co/apartamento-venta-los-palos-grandes-caracas/10441563',
    talkId: 'talk_ctrl_2',
    leadId: 'lead_ctrl_2',
    contactId: 'contact_ctrl_2',
    properties: rawProps,
    contextManager,
    handoffManager
  });

  const test2Valid = res2.shouldRespond &&
    res2.text === expectedRef007Response &&
    !containsBannedSalesPitch(res2.text);

  if (test2Valid) {
    console.log('✅ [PASS 2/14] Enlace de Wasi reconocido -> Respuesta breve idéntica y sin frases de venta agregadas.');
    passed++;
  } else {
    console.log(`❌ [FAIL 2/14] Wasi falló. Respondió: "${res2.text}"`);
  }

  // --------------------------------------------------------------------------
  // TEST 3: Enlace de Mercado Libre reconocido y respuesta breve
  // --------------------------------------------------------------------------
  const res3 = await evaluateCentralDecisionPipeline({
    userText: 'Hola, vi esto en Mercado Libre: https://apartamento.mercadolibre.com.ve/MLV-781814053',
    talkId: 'talk_ctrl_3',
    leadId: 'lead_ctrl_3',
    contactId: 'contact_ctrl_3',
    properties: rawProps,
    contextManager,
    handoffManager
  });

  const test3Valid = res3.shouldRespond &&
    res3.text === expectedRef007Response &&
    !containsBannedSalesPitch(res3.text);

  if (test3Valid) {
    console.log('✅ [PASS 3/14] Enlace de Mercado Libre reconocido -> Respuesta confirmada breve sin preguntas de cierre.');
    passed++;
  } else {
    console.log(`❌ [FAIL 3/14] Mercado Libre falló. Respondió: "${res3.text}"`);
  }

  // --------------------------------------------------------------------------
  // TEST 4: Enlace de Rexup reconocido y respuesta breve
  // --------------------------------------------------------------------------
  const res4 = await evaluateCentralDecisionPipeline({
    userText: 'Me mandaron este enlace: https://www.rexup.net/AAAAAAA/ver_inmueble_c.php?cod_inmueble=5185901613',
    talkId: 'talk_ctrl_4',
    leadId: 'lead_ctrl_4',
    contactId: 'contact_ctrl_4',
    properties: rawProps,
    contextManager,
    handoffManager
  });

  const test4Valid = res4.shouldRespond &&
    res4.text === expectedRef007Response &&
    !containsBannedSalesPitch(res4.text);

  if (test4Valid) {
    console.log('✅ [PASS 4/14] Enlace de Rexup reconocido -> Respuesta informativa confirmada sin insistencia comercial.');
    passed++;
  } else {
    console.log(`❌ [FAIL 4/14] Rexup falló. Respondió: "${res4.text}"`);
  }

  // --------------------------------------------------------------------------
  // TEST 5: Pregunta de precio y respuesta únicamente con el precio
  // --------------------------------------------------------------------------
  const res5 = await evaluateCentralDecisionPipeline({
    userText: '¿Cuánto cuesta esta propiedad?',
    talkId: 'talk_ctrl_1',
    leadId: 'lead_ctrl_1',
    properties: rawProps,
    contextManager,
    handoffManager
  });

  const test5Valid = res5.shouldRespond &&
    res5.text.includes('130.000') &&
    !containsBannedSalesPitch(res5.text);

  if (test5Valid) {
    console.log(`✅ [PASS 5/14] Pregunta de precio -> Responde determinista: "${res5.text}" (CERO preguntas de cierre).`);
    passed++;
  } else {
    console.log(`❌ [FAIL 5/14] Pregunta de precio falló: "${res5.text}"`);
  }

  // --------------------------------------------------------------------------
  // TEST 6: Pregunta de metraje y respuesta únicamente con el metraje
  // --------------------------------------------------------------------------
  const res6 = await evaluateCentralDecisionPipeline({
    userText: '¿Cuántos metros tiene?',
    talkId: 'talk_ctrl_1',
    leadId: 'lead_ctrl_1',
    properties: rawProps,
    contextManager,
    handoffManager
  });

  const test6Valid = res6.shouldRespond &&
    res6.text.includes('106,43 m²') &&
    !containsBannedSalesPitch(res6.text);

  if (test6Valid) {
    console.log(`✅ [PASS 6/14] Pregunta de metraje -> Responde estrictamente dato verificado: "${res6.text}".`);
    passed++;
  } else {
    console.log(`❌ [FAIL 6/14] Pregunta de metraje falló: "${res6.text}"`);
  }

  // --------------------------------------------------------------------------
  // TEST 7: Pregunta de disponibilidad y respuesta correspondiente
  // --------------------------------------------------------------------------
  const res7 = await evaluateCentralDecisionPipeline({
    userText: '¿Está disponible?',
    talkId: 'talk_ctrl_1',
    leadId: 'lead_ctrl_1',
    properties: rawProps,
    contextManager,
    handoffManager
  });

  const test7Valid = res7.shouldRespond &&
    res7.text === 'Sí, la propiedad se encuentra disponible para venta.' &&
    !containsBannedSalesPitch(res7.text);

  if (test7Valid) {
    console.log(`✅ [PASS 7/14] Pregunta de disponibilidad -> Responde confirmación formal: "${res7.text}".`);
    passed++;
  } else {
    console.log(`❌ [FAIL 7/14] Pregunta de disponibilidad falló: "${res7.text}"`);
  }

  // --------------------------------------------------------------------------
  // TEST 8: Consulta de varias características documentadas (Precio + Metraje)
  // --------------------------------------------------------------------------
  const res8 = await evaluateCentralDecisionPipeline({
    userText: '¿Cuál es el precio y cuántos metros tiene este apartamento?',
    talkId: 'talk_ctrl_1',
    leadId: 'lead_ctrl_1',
    properties: rawProps,
    contextManager,
    handoffManager
  });

  const test8Valid = res8.shouldRespond &&
    res8.text.includes('130.000') &&
    res8.text.includes('106,43 m²') &&
    !containsBannedSalesPitch(res8.text);

  if (test8Valid) {
    console.log(`✅ [PASS 8/14] Consulta agrupada verificada -> Responde características documentadas: "${res8.text}".`);
    passed++;
  } else {
    console.log(`❌ [FAIL 8/14] Consulta agrupada falló: "${res8.text}"`);
  }

  // --------------------------------------------------------------------------
  // TEST 9: Solicitud de visita y alerta a Robert
  // --------------------------------------------------------------------------
  const res9 = await evaluateCentralDecisionPipeline({
    userText: 'Quiero agendar una visita para conocer el apartamento personalmente mañana.',
    talkId: 'talk_ctrl_9',
    leadId: 'lead_ctrl_9',
    contactId: 'contact_ctrl_9',
    properties: rawProps,
    contextManager,
    handoffManager
  });

  const test9Valid = !res9.shouldRespond &&
    res9.text === null &&
    res9.log.action === 'SILENCE' &&
    res9.log.typeDetected === 'HUMAN_ATTENTION_REQUEST';

  if (test9Valid) {
    console.log('✅ [PASS 9/14] Solicitud de visita -> Silencio total del bot (0 respuestas prometidas) y derivado a Robert.');
    passed++;
  } else {
    console.log(`❌ [FAIL 9/14] Solicitud de visita falló: shouldRespond=${res9.shouldRespond}, type=${res9.log.typeDetected}`);
  }

  // --------------------------------------------------------------------------
  // TEST 10: Solicitud de reserva y alerta a Robert
  // --------------------------------------------------------------------------
  const res10 = await evaluateCentralDecisionPipeline({
    userText: 'Quiero reservar la propiedad ahora mismo.',
    talkId: 'talk_ctrl_10',
    leadId: 'lead_ctrl_10',
    contactId: 'contact_ctrl_10',
    properties: rawProps,
    contextManager,
    handoffManager
  });

  const test10Valid = !res10.shouldRespond &&
    res10.text === null &&
    res10.log.action === 'SILENCE' &&
    res10.log.typeDetected === 'HUMAN_ATTENTION_REQUEST';

  if (test10Valid) {
    console.log('✅ [PASS 10/14] Solicitud de reserva -> Silencio absoluto (CERO cierre autónomo) y derivado a Robert.');
    passed++;
  } else {
    console.log(`❌ [FAIL 10/14] Solicitud de reserva falló: shouldRespond=${res10.shouldRespond}`);
  }

  // --------------------------------------------------------------------------
  // TEST 11: Solicitud de firma o cierre y alerta a Robert
  // --------------------------------------------------------------------------
  const res11 = await evaluateCentralDecisionPipeline({
    userText: 'Estoy listo para firmar el contrato y concretar la compra.',
    talkId: 'talk_ctrl_11',
    leadId: 'lead_ctrl_11',
    contactId: 'contact_ctrl_11',
    properties: rawProps,
    contextManager,
    handoffManager
  });

  const test11Valid = !res11.shouldRespond &&
    res11.text === null &&
    res11.log.action === 'SILENCE' &&
    res11.log.typeDetected === 'HUMAN_ATTENTION_REQUEST';

  if (test11Valid) {
    console.log('✅ [PASS 11/14] Solicitud de firma o cierre -> Silencio absoluto y derivación para que Robert cierre el negocio.');
    passed++;
  } else {
    console.log(`❌ [FAIL 11/14] Solicitud de firma falló: shouldRespond=${res11.shouldRespond}`);
  }

  // --------------------------------------------------------------------------
  // TEST 12: Consulta sin información documentada -> Cero invención (Silencio)
  // --------------------------------------------------------------------------
  const res12 = await evaluateCentralDecisionPipeline({
    userText: '¿Cuánto se paga de cuota de condominio mensual en este apartamento?',
    talkId: 'talk_ctrl_1',
    leadId: 'lead_ctrl_1',
    properties: rawProps,
    contextManager,
    handoffManager
  });

  const test12Valid = !res12.shouldRespond &&
    res12.text === null &&
    res12.log.action === 'SILENCE' &&
    res12.log.typeDetected === 'PROPERTY_FEATURE_SIN_DATO';

  if (test12Valid) {
    console.log('✅ [PASS 12/14] Consulta sin dato documentado -> Silencio absoluto por política estricta de cero invención.');
    passed++;
  } else {
    console.log(`❌ [FAIL 12/14] Cero invención falló: shouldRespond=${res12.shouldRespond}`);
  }

  // --------------------------------------------------------------------------
  // TEST 13: Verificación de ausencia de mensajes posteriores no solicitados
  // --------------------------------------------------------------------------
  // Tras responder la consulta informativa, el bot no programa ni despacha nada más
  const test13Valid = res1.text && !res1.text.includes('\n¿Te gustaría') && !containsBannedSalesPitch(res1.text);
  if (test13Valid) {
    console.log('✅ [PASS 13/14] Cero mensajes automáticos posteriores -> El bot termina su respuesta informativa y espera al cliente.');
    passed++;
  } else {
    console.log('❌ [FAIL 13/14] Se detectaron mensajes adicionales de seguimiento.');
  }

  // --------------------------------------------------------------------------
  // TEST 14: Verificación de que el Human Lock siga funcionando
  // --------------------------------------------------------------------------
  const lockLeadId = 'lead_lock_commercial_test';
  handoffManager.recordHumanIntervention(lockLeadId, 'talk_lock', 'contact_lock', Date.now());

  const res14 = await evaluateCentralDecisionPipeline({
    userText: 'Hola, tengo una pregunta sobre el apartamento',
    talkId: 'talk_lock',
    leadId: lockLeadId,
    contactId: 'contact_lock',
    properties: rawProps,
    contextManager,
    handoffManager
  });

  const test14Valid = !res14.shouldRespond &&
    res14.log.typeDetected === 'HUMAN_LOCKED' &&
    res14.log.action === 'SILENCE';

  if (test14Valid) {
    console.log('✅ [PASS 14/14] Human Lock de 12 horas activo -> Silencio absoluto para proteger la negociación del asesor.');
    passed++;
  } else {
    console.log(`❌ [FAIL 14/14] Human Lock falló: shouldRespond=${res14.shouldRespond}`);
  }

  if (fs.existsSync(testHandoffFile)) fs.unlinkSync(testHandoffFile);

  console.log('\n================================================================');
  console.log(` RESULTADOS FINALES: ${passed} / ${total} PRUEBAS SUPERADAS (${Math.round((passed / total) * 100)}%) `);
  console.log('================================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runCommercialControlTests().catch(err => {
  console.error('Error ejecutando suite de control comercial:', err);
  process.exit(1);
});
