const { evaluateCentralDecisionPipeline, HandoffManager, ConversationContextManager } = require('../pipeline_decision.js');
const { getAvailableProperties } = require('../server.js');

async function testZoneQueries() {
  console.log('================================================================');
  console.log(' PRUEBA 4: BÚSQUEDA POR ZONA CON PREGUNTAS REALES               ');
  console.log('================================================================\n');

  const properties = await getAvailableProperties();
  const handoff = new HandoffManager();
  const cm = new ConversationContextManager();

  const queries = [
    '¿Tienen apartamentos disponibles en Las Mercedes?',
    '¿Qué apartamentos tienen en Los Samanes?',
    '¿Tienen casas disponibles en Caracas?'
  ];

  for (const q of queries) {
    console.log(`\nConsulta: "${q}"`);
    const dec = await evaluateCentralDecisionPipeline({
      userText: q,
      leadId: 'ZONE_LEAD_' + Date.now(),
      talkId: 'ZONE_TALK_' + Date.now(),
      properties,
      handoffManager: handoff,
      contextManager: cm,
      currentTime: Date.now()
    });
    console.log('Acción:', dec.log.action);
    console.log('Tipo detectado:', dec.log.typeDetected);
    console.log('Razón:', dec.log.reason);
    console.log('Respuesta obtenida:', `"${dec.text}"`);
  }
}

testZoneQueries();

