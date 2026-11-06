const { evaluateCentralDecisionPipeline, HandoffManager, ConversationContextManager } = require('../pipeline_decision.js');
const { getAvailableProperties } = require('../server.js');
const { recoverActivePropertyFromKommo, tagLeadWithProperty } = require('../lib/kommo_property_recovery.js');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

async function testTwoPropertiesSequence() {
  console.log('================================================================');
  console.log(' PRUEBA 2: DOS INMUEBLES EN UNA MISMA CONVERSACIÓN              ');
  console.log('================================================================\n');

  const properties = await getAvailableProperties();
  const testTalkId = 'TALK_TWO_PROPS_' + Date.now();
  const testLeadId = 'LEAD_TWO_PROPS_' + Date.now();
  const contextFile = path.join(__dirname, 'test_two_props_context.json');
  if (fs.existsSync(contextFile)) fs.unlinkSync(contextFile);

  let cm = new ConversationContextManager(contextFile);
  const handoff = new HandoffManager();

  // 1. Enviar enlace Wasi de REF-012
  console.log('--- 1. Enviar enlace Wasi REF-012 ---');
  const step1 = await evaluateCentralDecisionPipeline({
    userText: 'Hola https://info.wasi.co/apartamento-venta-los-samanes-caracas/10493109',
    leadId: testLeadId,
    talkId: testTalkId,
    properties,
    handoffManager: handoff,
    contextManager: cm,
    currentTime: Date.now()
  });
  console.log('Paso 1 Propiedad:', step1.targetProperty?.ID_PROPIEDAD);

  // 2. Consultar disponibilidad de REF-012
  console.log('--- 2. Consultar disponibilidad REF-012 ---');
  const step2 = await evaluateCentralDecisionPipeline({
    userText: '¿Está disponible?',
    leadId: testLeadId,
    talkId: testTalkId,
    properties,
    handoffManager: handoff,
    contextManager: cm,
    currentTime: Date.now()
  });
  console.log('Paso 2 Respuesta:', step2.text);

  // 3. Enviar segundo enlace correspondiente a REF-037
  console.log('--- 3. Enviar segundo enlace REF-037 ---');
  const step3 = await evaluateCentralDecisionPipeline({
    userText: 'https://info.wasi.co/oficina-venta-las-mercedes-caracas/10465756',
    leadId: testLeadId,
    talkId: testTalkId,
    properties,
    handoffManager: handoff,
    contextManager: cm,
    currentTime: Date.now()
  });
  console.log('Paso 3 Propiedad:', step3.targetProperty?.ID_PROPIEDAD);

  // 4. Consultar disponibilidad del segundo inmueble
  console.log('--- 4. Consultar disponibilidad segundo inmueble ---');
  const step4 = await evaluateCentralDecisionPipeline({
    userText: '¿Y esta oficina está disponible?',
    leadId: testLeadId,
    talkId: testTalkId,
    properties,
    handoffManager: handoff,
    contextManager: cm,
    currentTime: Date.now()
  });
  console.log('Paso 4 Respuesta:', step4.text);

  // 5. Simular reinicio completo del proceso
  console.log('--- 5. Simular reinicio completo del proceso ---');
  cm = null;
  // Nueva instancia que lee de disco o memoria en blanco
  const freshCm = new ConversationContextManager(contextFile);

  // 6. Preguntar por el último inmueble
  console.log('--- 6. Preguntar por el último inmueble ---');
  const step6 = await evaluateCentralDecisionPipeline({
    userText: '¿Cuántos metros tiene?',
    leadId: testLeadId,
    talkId: testTalkId,
    properties,
    handoffManager: handoff,
    contextManager: freshCm,
    currentTime: Date.now()
  });
  console.log('Paso 6 Propiedad identificada:', step6.log.propertyIdentified);
  console.log('Paso 6 Respuesta:', step6.text);

  // 7. Preguntar por el primer inmueble
  console.log('--- 7. Preguntar por el primer inmueble con referencia clara ---');
  const step7 = await evaluateCentralDecisionPipeline({
    userText: '¿Y el apartamento de Los Samanes cuántos metros tiene?',
    leadId: testLeadId,
    talkId: testTalkId,
    properties,
    handoffManager: handoff,
    contextManager: freshCm,
    currentTime: Date.now()
  });
  console.log('Paso 7 Propiedad identificada:', step7.log.propertyIdentified);
  console.log('Paso 7 Respuesta:', step7.text);

  // 8. Preguntar por el primer inmueble de forma ambigua ("¿Y el primer inmueble?")
  console.log('--- 8. Preguntar por el primer inmueble sin datos ("¿Y el primer inmueble?") ---');
  const step8 = await evaluateCentralDecisionPipeline({
    userText: '¿Y el primer inmueble que te pasé?',
    leadId: testLeadId,
    talkId: testTalkId,
    properties,
    handoffManager: handoff,
    contextManager: freshCm,
    currentTime: Date.now()
  });
  console.log('Paso 8 Decisión:', step8.log.action, step8.log.typeDetected, step8.log.reason);
  console.log('Paso 8 Respuesta:', step8.text);

  if (fs.existsSync(contextFile)) fs.unlinkSync(contextFile);
}

testTwoPropertiesSequence();

