const { evaluateCentralDecisionPipeline, HandoffManager, ConversationContextManager } = require('../pipeline_decision.js');
const { getAvailableProperties } = require('../server.js');

async function testClientLifecycle() {
  console.log('================================================================');
  console.log(' PRUEBA 3: CLIENTES NUEVOS Y RECURRENTES (8 ESCENARIOS REALES)  ');
  console.log('================================================================\n');

  const properties = await getAvailableProperties();
  const handoff = new HandoffManager();
  const cm = new ConversationContextManager();
  const results = [];

  // Escenario 1: Cliente nuevo sin lead previo que envía enlace
  console.log('--- 1. Cliente nuevo sin lead previo ---');
  const talk1 = 'TALK_NEW_101';
  const lead1 = 'LEAD_NEW_101';
  const s1 = await evaluateCentralDecisionPipeline({
    userText: 'Hola, ¿está disponible? https://info.wasi.co/apartamento-venta-los-samanes-caracas/10493109',
    leadId: lead1,
    talkId: talk1,
    properties,
    handoffManager: handoff,
    contextManager: cm,
    currentTime: Date.now()
  });
  console.log('Cliente nuevo:', s1.log.action, s1.log.typeDetected, s1.text ? 'RESPONDE' : 'SILENCIO');
  results.push({ scenario: 'Cliente nuevo sin lead', pass: s1.shouldRespond && s1.targetProperty?.ID_PROPIEDAD === 'REF-012' });

  // Escenario 2: Cliente con lead abierto que continúa la consulta (mismo lead y talk)
  console.log('--- 2. Cliente con lead abierto que consulta precio ---');
  const s2 = await evaluateCentralDecisionPipeline({
    userText: '¿Cuánto cuesta el apartamento?',
    leadId: lead1,
    talkId: talk1,
    properties,
    handoffManager: handoff,
    contextManager: cm,
    currentTime: Date.now()
  });
  console.log('Lead abierto:', s2.log.action, s2.text);
  results.push({ scenario: 'Cliente con lead abierto', pass: s2.shouldRespond && s2.text.includes('146.000') });

  // Escenario 3: Cliente con lead antiguo (>30 días) que reanuda consulta
  console.log('--- 3. Cliente con lead antiguo (>30 días) que reanuda consulta ---');
  const s3 = await evaluateCentralDecisionPipeline({
    userText: 'Buenas tardes, ¿sigue disponible?',
    leadId: lead1,
    talkId: talk1,
    properties,
    handoffManager: handoff,
    contextManager: cm,
    currentTime: Date.now() + 30 * 24 * 60 * 60 * 1000
  });
  console.log('Lead antiguo:', s3.log.action, s3.text);
  results.push({ scenario: 'Cliente con lead antiguo', pass: s3.shouldRespond });

  // Escenario 4: Cliente con lead ganado que consulta nuevo inmueble
  console.log('--- 4. Cliente con lead ganado que consulta nuevo inmueble ---');
  const s4 = await evaluateCentralDecisionPipeline({
    userText: 'Hola, me interesa ahora esta oficina: https://info.wasi.co/oficina-venta-las-mercedes-caracas/10465756',
    leadId: 'LEAD_WON_404',
    talkId: 'TALK_WON_404',
    properties,
    handoffManager: handoff,
    contextManager: cm,
    currentTime: Date.now()
  });
  console.log('Lead ganado:', s4.log.action, s4.targetProperty?.ID_PROPIEDAD);
  results.push({ scenario: 'Cliente con lead ganado', pass: s4.shouldRespond && s4.targetProperty?.ID_PROPIEDAD === 'REF-037' });

  // Escenario 5: Cliente con lead perdido que consulta nuevo inmueble
  console.log('--- 5. Cliente con lead perdido que consulta nuevo inmueble ---');
  const s5 = await evaluateCentralDecisionPipeline({
    userText: 'Buenas, ¿este apartamento sigue en venta? https://info.wasi.co/apartamento-venta-los-samanes-caracas/10493109',
    leadId: 'LEAD_LOST_505',
    talkId: 'TALK_LOST_505',
    properties,
    handoffManager: handoff,
    contextManager: cm,
    currentTime: Date.now()
  });
  console.log('Lead perdido:', s5.log.action, s5.targetProperty?.ID_PROPIEDAD);
  results.push({ scenario: 'Cliente con lead perdido', pass: s5.shouldRespond && s5.targetProperty?.ID_PROPIEDAD === 'REF-012' });

  // Escenario 6: Cliente que vuelve después de 14 días
  console.log('--- 6. Cliente que vuelve después de 14 días ---');
  const s6 = await evaluateCentralDecisionPipeline({
    userText: 'Hola, ¿sigue disponible el apartamento?',
    leadId: lead1,
    talkId: talk1,
    properties,
    handoffManager: handoff,
    contextManager: cm,
    currentTime: Date.now() + 14 * 24 * 60 * 60 * 1000
  });
  console.log('Cliente 14 días:', s6.log.action, s6.text);
  results.push({ scenario: 'Cliente recurrente tras 14 días', pass: s6.shouldRespond });

  // Escenario 7: Cliente que cambia de inmueble
  console.log('--- 7. Cliente que cambia de inmueble ---');
  const s7 = await evaluateCentralDecisionPipeline({
    userText: '¿Y esta oficina en Las Mercedes? https://info.wasi.co/oficina-venta-las-mercedes-caracas/10465756',
    leadId: lead1,
    talkId: talk1,
    properties,
    handoffManager: handoff,
    contextManager: cm,
    currentTime: Date.now()
  });
  console.log('Cambio de inmueble:', s7.targetProperty?.ID_PROPIEDAD);
  results.push({ scenario: 'Cliente que cambia de inmueble', pass: s7.shouldRespond && s7.targetProperty?.ID_PROPIEDAD === 'REF-037' });

  // Escenario 8: Cliente con intervención humana dentro de las últimas 12 horas
  console.log('--- 8. Intervención humana dentro de las últimas 12 horas ---');
  handoff.recordHumanIntervention('LEAD_HUMAN_808', 'TALK_HUMAN_808', null, Date.now());
  const s8 = await evaluateCentralDecisionPipeline({
    userText: '¿Cuánto cuesta?',
    leadId: 'LEAD_HUMAN_808',
    talkId: 'TALK_HUMAN_808',
    properties,
    handoffManager: handoff,
    contextManager: cm,
    currentTime: Date.now() + 2 * 60 * 60 * 1000 // 2 horas después
  });
  console.log('Intervención humana (2h después):', s8.log.action, s8.log.reason);
  results.push({ scenario: 'Bloqueo humano <12h', pass: s8.shouldRespond === false && s8.log.action === 'SILENCE' });

  console.log('\n================================================================');
  console.log('RESUMEN ESCENARIOS:');
  results.forEach(r => console.log(`- ${r.scenario}: ${r.pass ? 'PASS' : 'FAIL'}`));
  console.log('================================================================');
}

testClientLifecycle();
