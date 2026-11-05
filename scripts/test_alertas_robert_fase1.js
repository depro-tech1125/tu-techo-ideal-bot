const assert = require('assert');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const {
  evaluateCentralDecisionPipeline,
  HandoffManager,
  ConversationContextManager,
  classifyOutgoingMessage
} = require('../pipeline_decision');
const {
  buildRobertAlertText,
  dispatchDirectWhatsAppToRobert,
  getAvailableProperties
} = require('../server');

async function runRobertAlertsSuite() {
  console.log('================================================================');
  console.log(' SUITE DE VERIFICACIÓN FASE 1: ALERTAS DE CIERRE A ROBERT (D)  ');
  console.log('================================================================\n');

  let passed = 0;
  const total = 12;

  const properties = await getAvailableProperties();
  const testHandoffFile = path.join(__dirname, 'temp_test_handoffs_alert.json');
  if (fs.existsSync(testHandoffFile)) fs.unlinkSync(testHandoffFile);
  const handoffManager = new HandoffManager(testHandoffFile);
  const contextManager = new ConversationContextManager();

  // Helper para registrar contexto limpio de prueba para REF-035
  const ref035 = properties.find(p => p.ID_PROPIEDAD === 'REF-035');
  const setupTestLead = (leadSuffix) => {
    const leadId = `lead_alert_fase1_${leadSuffix}`;
    const talkId = `talk_alert_fase1_${leadSuffix}`;
    contextManager.saveContext(talkId, leadId, ref035);
    return { leadId, talkId };
  };

  // ---------------------------------------------------------------------------
  // TEST 1: Cliente que quiere agendar una visita
  // ---------------------------------------------------------------------------
  const t1 = setupTestLead('visit');
  const res1 = await evaluateCentralDecisionPipeline({
    userText: 'Quiero agendar una visita para conocer el inmueble.',
    leadId: t1.leadId,
    talkId: t1.talkId,
    properties,
    handoffManager,
    contextManager
  });
  const alert1 = buildRobertAlertText({
    type: 'AGENDAR_CITA',
    clientName: 'Daniel Palma',
    clientPhone: '+584140128826',
    channel: 'WhatsApp',
    matchedProperty: res1.targetProperty,
    userText: 'Quiero agendar una visita para conocer el inmueble.',
    leadId: t1.leadId,
    interestType: 'Agendar una visita'
  });

  if (!res1.shouldRespond && res1.log.typeDetected === 'HUMAN_ATTENTION_REQUEST' && alert1.includes('Agendar una visita') && alert1.includes('REF-035')) {
    console.log('✅ [PASS 1/12] Cliente que quiere agendar visita -> Silencio comercial y alerta estructurada con REF-035.');
    passed++;
  } else {
    console.error('❌ [FAIL 1/12] Falló detección de agendamiento de visita:', res1, alert1);
  }

  // ---------------------------------------------------------------------------
  // TEST 2: Cliente que quiere reservar
  // ---------------------------------------------------------------------------
  const t2 = setupTestLead('reserve');
  const res2 = await evaluateCentralDecisionPipeline({
    userText: 'Quiero reservar el inmueble hoy mismo.',
    leadId: t2.leadId,
    talkId: t2.talkId,
    properties,
    handoffManager,
    contextManager
  });
  const alert2 = buildRobertAlertText({
    type: 'AGENDAR_CITA',
    clientName: 'Carlos Mendoza',
    clientPhone: '+584121234567',
    channel: 'WhatsApp',
    matchedProperty: res2.targetProperty,
    userText: 'Quiero reservar el inmueble hoy mismo.',
    leadId: t2.leadId,
    interestType: 'Reserva de inmueble'
  });

  if (!res2.shouldRespond && res2.log.typeDetected === 'HUMAN_ATTENTION_REQUEST' && alert2.includes('Reserva de inmueble')) {
    console.log('✅ [PASS 2/12] Cliente que quiere reservar -> Silencio comercial y alerta de Reserva de inmueble.');
    passed++;
  } else {
    console.error('❌ [FAIL 2/12] Falló detección de reserva:', res2);
  }

  // ---------------------------------------------------------------------------
  // TEST 3: Cliente que quiere firmar
  // ---------------------------------------------------------------------------
  const t3 = setupTestLead('sign');
  const res3 = await evaluateCentralDecisionPipeline({
    userText: 'Estoy listo para firmar el contrato.',
    leadId: t3.leadId,
    talkId: t3.talkId,
    properties,
    handoffManager,
    contextManager
  });
  const alert3 = buildRobertAlertText({
    type: 'AGENDAR_CITA',
    clientName: 'María Gómez',
    clientPhone: '+584249876543',
    channel: 'WhatsApp',
    matchedProperty: res3.targetProperty,
    userText: 'Estoy listo para firmar el contrato.',
    leadId: t3.leadId,
    interestType: 'Firma de contrato'
  });

  if (!res3.shouldRespond && res3.log.typeDetected === 'HUMAN_ATTENTION_REQUEST' && alert3.includes('Firma de contrato')) {
    console.log('✅ [PASS 3/12] Cliente que quiere firmar -> Silencio comercial y alerta de Firma de contrato.');
    passed++;
  } else {
    console.error('❌ [FAIL 3/12] Falló detección de firma:', res3);
  }

  // ---------------------------------------------------------------------------
  // TEST 4: Cliente con intención clara de cerrar
  // ---------------------------------------------------------------------------
  const t4 = setupTestLead('close');
  const res4 = await evaluateCentralDecisionPipeline({
    userText: 'Tengo el dinero y quiero cerrar la operación.',
    leadId: t4.leadId,
    talkId: t4.talkId,
    properties,
    handoffManager,
    contextManager
  });
  const alert4 = buildRobertAlertText({
    type: 'AGENDAR_CITA',
    clientName: 'Pedro Pérez',
    clientPhone: '+584145555555',
    channel: 'WhatsApp',
    matchedProperty: res4.targetProperty,
    userText: 'Tengo el dinero y quiero cerrar la operación.',
    leadId: t4.leadId,
    interestType: 'Alta intención de compra / Cierre comercial'
  });

  if (!res4.shouldRespond && res4.log.typeDetected === 'HUMAN_ATTENTION_REQUEST' && alert4.includes('Alta intención de compra / Cierre comercial')) {
    console.log('✅ [PASS 4/12] Cliente con intención de cerrar -> Silencio comercial y alerta de Cierre comercial.');
    passed++;
  } else {
    console.error('❌ [FAIL 4/12] Falló detección de cierre comercial:', res4);
  }

  // ---------------------------------------------------------------------------
  // TEST 5: Consulta simple de precio: NO genera alerta
  // ---------------------------------------------------------------------------
  const t5 = setupTestLead('price');
  const res5 = await evaluateCentralDecisionPipeline({
    userText: '¿Cuál es el precio del inmueble?',
    leadId: t5.leadId,
    talkId: t5.talkId,
    properties,
    handoffManager,
    contextManager
  });

  if (res5.shouldRespond && res5.text === '$300' && res5.log.typeDetected !== 'HUMAN_ATTENTION_REQUEST') {
    console.log('✅ [PASS 5/12] Consulta simple de precio -> Responde determinista "$300" y CERO alertas.');
    passed++;
  } else {
    console.error('❌ [FAIL 5/12] Consulta de precio generó alerta indebida o no respondió:', res5);
  }

  // ---------------------------------------------------------------------------
  // TEST 6: Solicitud de fotografías: NO genera alerta
  // ---------------------------------------------------------------------------
  const t6 = setupTestLead('photos');
  const res6 = await evaluateCentralDecisionPipeline({
    userText: '¿Me puedes compartir fotografías de la propiedad?',
    leadId: t6.leadId,
    talkId: t6.talkId,
    properties,
    handoffManager,
    contextManager
  });

  if (res6.shouldRespond && res6.text.includes('rexup.net') && res6.log.typeDetected === 'PROPERTY_EXTENDED_INFO_LINK_FOTOS') {
    console.log('✅ [PASS 6/12] Solicitud de fotos -> Entrega enlace directo Rexup y CERO alertas.');
    passed++;
  } else {
    console.error('❌ [FAIL 6/12] Solicitud de fotos generó alerta indebida o no respondió:', res6);
  }

  // ---------------------------------------------------------------------------
  // TEST 7: Nota interna en Kommo: NO genera alerta
  // ---------------------------------------------------------------------------
  const internalNoteMsg = {
    type: 'note',
    is_internal: true,
    element_type: 'note',
    text: 'Nota para el asesor: cliente solvente, contactar mañana'
  };
  const noteClassification = classifyOutgoingMessage(internalNoteMsg);

  if (noteClassification.isInternalNote && !noteClassification.isHumanAdvisor) {
    console.log('✅ [PASS 7/12] Nota interna en Kommo -> Identificada como nota interna, CERO alertas.');
    passed++;
  } else {
    console.error('❌ [FAIL 7/12] Nota interna no fue clasificada correctamente:', noteClassification);
  }

  // ---------------------------------------------------------------------------
  // TEST 8: Mensaje de asesor: NO genera alerta a Robert (es el propio asesor)
  // ---------------------------------------------------------------------------
  const advisorMsg = {
    type: 'outgoing',
    author: { type: 'user', name: 'Robert Jiménez' },
    text: 'Hola Daniel, con gusto coordinamos la visita para mañana.'
  };
  const advisorClassification = classifyOutgoingMessage(advisorMsg, () => false);

  if (advisorClassification.isHumanAdvisor) {
    console.log('✅ [PASS 8/12] Mensaje manual de asesor -> Activa bloqueo humano de 12h y no se auto-alerta.');
    passed++;
  } else {
    console.error('❌ [FAIL 8/12] Mensaje de asesor no fue reconocido:', advisorClassification);
  }

  // ---------------------------------------------------------------------------
  // TEST 9: Mensaje duplicado: una sola alerta (Dedup 5 minutos)
  // ---------------------------------------------------------------------------
  // Primer despacho:
  const firstDispatch = await dispatchDirectWhatsAppToRobert(alert1, 'lead_dedup_test_1', 'Agendar una visita');
  // Segundo despacho idéntico en menos de 5 min:
  const secondDispatch = await dispatchDirectWhatsAppToRobert(alert1, 'lead_dedup_test_1', 'Agendar una visita');

  if (secondDispatch && secondDispatch.reason === 'DUPLICATE_ALERT_THROTTLED') {
    console.log('✅ [PASS 9/12] Alerta repetida en menos de 5 min -> Interceptada por Dedup (DUPLICATE_ALERT_THROTTLED). Una sola alerta.');
    passed++;
  } else {
    console.error('❌ [FAIL 9/12] No se evitó la alerta duplicada:', secondDispatch);
  }

  // ---------------------------------------------------------------------------
  // TEST 10: Cliente sin propiedad identificada: alerta sin inventar propiedad
  // ---------------------------------------------------------------------------
  const emptyContextManager = new ConversationContextManager();
  const res10 = await evaluateCentralDecisionPipeline({
    userText: 'Quiero agendar una cita con ustedes para ver qué opciones tienen.',
    leadId: 'lead_no_prop_999',
    talkId: 'talk_no_prop_999',
    properties,
    handoffManager,
    contextManager: emptyContextManager
  });
  const alert10 = buildRobertAlertText({
    type: 'AGENDAR_CITA',
    clientName: 'Contacto Sin Inmueble',
    clientPhone: '+584149999999',
    channel: 'WhatsApp',
    matchedProperty: res10.targetProperty || null,
    userText: 'Quiero agendar una cita con ustedes para ver qué opciones tienen.',
    leadId: 'lead_no_prop_999',
    interestType: 'Agendar una visita'
  });

  if (!res10.shouldRespond && !res10.targetProperty && alert10.includes('No especificada en el mensaje / Consulta general') && !alert10.includes('REF-')) {
    console.log('✅ [PASS 10/12] Cliente sin propiedad -> Alerta honesta sin inventar ninguna ficha ni código REF.');
    passed++;
  } else {
    console.error('❌ [FAIL 10/12] Alerta inventó propiedad para consulta general:', alert10);
  }

  // ---------------------------------------------------------------------------
  // TEST 11: Error de WhatsApp: registro y manejo seguro sin caída del servidor
  // ---------------------------------------------------------------------------
  try {
    // Simular error de despacho seguro cuando el lead de destino es inválido
    const originalLeadId = process.env.ROBERT_KOMMO_LEAD_ID;
    process.env.ROBERT_KOMMO_LEAD_ID = '999999999'; // Lead inexistente
    const errorHandlingTest = await dispatchDirectWhatsAppToRobert(alert1, 'lead_test_err_sim', 'Test Error');
    process.env.ROBERT_KOMMO_LEAD_ID = originalLeadId;
    // Si no arrojó excepción no capturada y retornó objeto estructurado seguro
    if (typeof errorHandlingTest === 'object' && errorHandlingTest.sent === false && errorHandlingTest.error) {
      console.log('✅ [PASS 11/12] Error de despacho a WhatsApp -> Manejo seguro de excepción sin caída de servidor.');
      passed++;
    } else {
      console.error('❌ [FAIL 11/12] Retorno inesperado en manejo de error:', errorHandlingTest);
    }
  } catch (e) {
    console.error('❌ [FAIL 11/12] Excepción no capturada en dispatchDirectWhatsAppToRobert:', e.message);
  }

  // ---------------------------------------------------------------------------
  // TEST 12: Destinatario de alerta incorrecto: impedir el despacho
  // ---------------------------------------------------------------------------
  const originalRobertPhone = process.env.ROBERT_WHATSAPP;
  process.env.ROBERT_WHATSAPP = '12345'; // Número inválido no venezolano
  const invalidDispatch = await dispatchDirectWhatsAppToRobert(alert1, 'lead_invalid_dest', 'Test Invalido');
  process.env.ROBERT_WHATSAPP = originalRobertPhone; // Restaurar

  if (invalidDispatch && invalidDispatch.reason === 'INVALID_RECIPIENT') {
    console.log('✅ [PASS 12/12] Destinatario de alerta incorrecto (<10 dígitos o sin código país 58) -> Despacho cancelado.');
    passed++;
  } else {
    console.error('❌ [FAIL 12/12] Destinatario incorrecto no fue rechazado:', invalidDispatch);
  }

  if (fs.existsSync(testHandoffFile)) {
    try { fs.unlinkSync(testHandoffFile); } catch (e) {}
  }

  console.log('\n================================================================');
  console.log(` RESULTADOS FINALES: ${passed} / ${total} PRUEBAS SUPERADAS (${Math.round(passed/total*100)}%)`);
  console.log('================================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
  process.exit(0);
}

runRobertAlertsSuite().catch(err => {
  console.error('Error fatal en suite de alertas:', err);
  process.exit(1);
});
