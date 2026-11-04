require('dotenv').config();
const {
  evaluateCentralDecisionPipeline,
  ConversationContextManager,
  HandoffManager,
  evaluatePropertyQuestionWithClaude
} = require('../pipeline_decision');
const { getAvailableProperties } = require('../server');

async function testMetraje() {
  const properties = await getAvailableProperties();
  const ref012 = properties.find(p => p.ID_PROPIEDAD === 'REF-012');
  console.log('REF-012 encontrada:', {
    id: ref012.ID_PROPIEDAD,
    wasi: ref012.CODIGO_WASI,
    estatus: ref012.ESTATUS,
    desc: ref012.DESCRIPCION_BREVE?.substring(0, 80)
  });

  const question = '¿Cuántos metros tiene el apartamento?';
  console.log('\n--- Probando evaluatePropertyQuestionWithClaude con Nemotron ---');
  const aiResult = await evaluatePropertyQuestionWithClaude(question, ref012);
  console.log('Resultado IA:', aiResult);
}

testMetraje().catch(console.error);
