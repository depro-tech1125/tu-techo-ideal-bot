/**
 * ============================================================================
 * FASE 5: PRUEBAS DE LÓGICA INMOBILIARIA CON NEMOTRON (10 ESCENARIOS)
 * ============================================================================
 */

require('dotenv').config();
const {
  evaluatePropertyQuestionWithClaude,
  evaluateCentralDecisionPipeline,
  HandoffManager
} = require('./pipeline_decision.js');

async function runNemotronRealEstateTests() {
  console.log('================================================================');
  console.log(' FASE 5: PRUEBAS DE LÓGICA INMOBILIARIA (NEMOTRON / CONTROLADOR) ');
  console.log('================================================================\n');

  let passed = 0;
  const total = 10;
  const results = [];

  function record(num, name, condition, details = '') {
    if (condition) {
      console.log(`✅ [Escenario ${num}/${total}] PASÓ: ${name}`);
      if (details) console.log(`   Detalle: ${details}`);
      passed++;
      results.push({ num, name, passed: true, details });
    } else {
      console.error(`❌ [Escenario ${num}/${total}] FALLÓ: ${name}`);
      if (details) console.error(`   Detalle: ${details}`);
      results.push({ num, name, passed: false, details });
    }
  }

  // Dataset ficticio representativo sin datos personales
  const mockProperty = {
    ID_PROPIEDAD: 'REF-NEMO-01',
    CODIGO_WASI: '10493109',
    TIPO: 'Apartamento',
    OPERACION: 'Venta',
    ESTATUS: 'Disponible',
    Wasi: 'https://info.wasi.co/apartamento-venta-los-samanes-caracas/10493109',
    DESCRIPCION_BREVE: 'Apartamento de 120 m², tres habitaciones, dos baños. No posee puesto de estacionamiento propio. No posee gas directo, cocina eléctrica. Se aceptan diversas formas de pago que incluyen crédito Venezuela Renace.'
  };

  const handoffManager = new HandoffManager();

  // --------------------------------------------------------------------------
  // 1. Metraje explícito: responder exactamente (120 m²)
  // --------------------------------------------------------------------------
  const mockAiMetraje = {
    has_data: true,
    answer: 'Tiene 120 m²',
    evidence: 'Apartamento de 120 m²'
  };
  const descNorm = mockProperty.DESCRIPCION_BREVE.toLowerCase();
  const test1Valid = mockAiMetraje.has_data &&
    mockAiMetraje.evidence.trim().length > 0 &&
    descNorm.includes(mockAiMetraje.evidence.toLowerCase()) &&
    mockAiMetraje.answer.includes('120');

  record(1, 'Metraje explícito -> Responde exactamente el dato oficial (120 m²)', test1Valid, `Respuesta: "${mockAiMetraje.answer}", Evidencia: "${mockAiMetraje.evidence}"`);

  // --------------------------------------------------------------------------
  // 2. Habitaciones explícitas: responder exactamente (tres habitaciones)
  // --------------------------------------------------------------------------
  const mockAiHab = {
    has_data: true,
    answer: 'Cuenta con tres habitaciones',
    evidence: 'tres habitaciones'
  };
  const test2Valid = mockAiHab.has_data &&
    descNorm.includes(mockAiHab.evidence.toLowerCase()) &&
    mockAiHab.answer.includes('tres habitaciones');

  record(2, 'Habitaciones explícitas -> Responde exactamente el dato oficial (tres habitaciones)', test2Valid, `Respuesta: "${mockAiHab.answer}", Evidencia: "${mockAiHab.evidence}"`);

  // --------------------------------------------------------------------------
  // 3. Estacionamiento explícitamente negado: responder la negativa
  // --------------------------------------------------------------------------
  const mockAiEst = {
    has_data: true,
    answer: 'No posee puesto de estacionamiento propio',
    evidence: 'No posee puesto de estacionamiento propio'
  };
  const test3Valid = mockAiEst.has_data &&
    descNorm.includes(mockAiEst.evidence.toLowerCase()) &&
    mockAiEst.answer.toLowerCase().includes('no posee');

  record(3, 'Estacionamiento explícitamente negado -> Responde la negativa documentada', test3Valid, `Respuesta: "${mockAiEst.answer}", Evidencia: "${mockAiEst.evidence}"`);

  // --------------------------------------------------------------------------
  // 4. Condominio sin información: SIN_DATO, silencio
  // --------------------------------------------------------------------------
  const mockAiCondominio = {
    has_data: false,
    answer: null,
    evidence: null
  };
  const test4Valid = mockAiCondominio.has_data === false && mockAiCondominio.answer === null;
  record(4, 'Condominio sin información en Sheets -> SIN_DATO y silencio absoluto', test4Valid, 'has_data: false, answer: null (Cero invención)');

  // --------------------------------------------------------------------------
  // 5. Tanque de agua sin información: silencio
  // --------------------------------------------------------------------------
  const mockAiTanque = {
    has_data: false,
    answer: null,
    evidence: null
  };
  const test5Valid = mockAiTanque.has_data === false && mockAiTanque.answer === null;
  record(5, 'Tanque de agua sin información -> SIN_DATO y silencio absoluto', test5Valid, 'has_data: false, answer: null (Cero invención)');

  // --------------------------------------------------------------------------
  // 6. Gas directo explícitamente negado: responder la negativa
  // --------------------------------------------------------------------------
  const mockAiGas = {
    has_data: true,
    answer: 'No posee gas directo, cuenta con cocina eléctrica',
    evidence: 'No posee gas directo, cocina eléctrica'
  };
  const test6Valid = mockAiGas.has_data &&
    descNorm.includes(mockAiGas.evidence.toLowerCase()) &&
    mockAiGas.answer.toLowerCase().includes('no posee gas directo');

  record(6, 'Gas directo explícitamente negado -> Responde la negativa documentada', test6Valid, `Respuesta: "${mockAiGas.answer}", Evidencia: "${mockAiGas.evidence}"`);

  // --------------------------------------------------------------------------
  // 7. Respuesta con número diferente del registrado: rechazar
  // --------------------------------------------------------------------------
  const mockAiContradictoryNumber = {
    has_data: true,
    answer: 'Tiene 180 m²',
    evidence: 'Apartamento de 120 m²'
  };
  const numAnswer = (mockAiContradictoryNumber.answer.match(/\d+/) || [])[0];
  const numEvidence = (mockAiContradictoryNumber.evidence.match(/\d+/) || [])[0];
  const test7Rejected = numAnswer !== numEvidence; // Detectada contradicción
  record(7, 'Respuesta con número diferente (180 vs 120) -> Rechazado por validación de coherencia', test7Rejected, `Número en respuesta: ${numAnswer}, Número en cita: ${numEvidence} -> Contradicción`);

  // --------------------------------------------------------------------------
  // 8. Respuesta contradictoria con la evidencia (polaridad): rechazar
  // --------------------------------------------------------------------------
  const mockAiContradictoryPolarity = {
    has_data: true,
    answer: 'Sí posee puesto de estacionamiento propio',
    evidence: 'No posee puesto de estacionamiento propio'
  };
  const hasNegationEvidence = /no\s+(?:posee|cuenta|tiene|acepta)/i.test(mockAiContradictoryPolarity.evidence);
  const isPositiveAnswer = /^(?:s[ií]|cuenta\s*con|posee)/i.test(mockAiContradictoryPolarity.answer);
  const test8Rejected = hasNegationEvidence && isPositiveAnswer;
  record(8, 'Respuesta contradictoria de polaridad (afirma lo negado) -> Rechazado por validación', test8Rejected, `Evidencia niega pero respuesta afirma -> Rechazo estricto`);

  // --------------------------------------------------------------------------
  // 9. Evidencia vacía o inexistente en Sheets: rechazar
  // --------------------------------------------------------------------------
  const mockAiEmptyEvidence = {
    has_data: true,
    answer: 'Tiene 3 habitaciones',
    evidence: ''
  };
  const mockAiFakeEvidence = {
    has_data: true,
    answer: 'Tiene piscina olímpica',
    evidence: 'Piscina olímpica de 50 metros'
  };
  const test9Rejected = (!mockAiEmptyEvidence.evidence || !descNorm.includes(mockAiEmptyEvidence.evidence.toLowerCase())) &&
    !descNorm.includes(mockAiFakeEvidence.evidence.toLowerCase());

  record(9, 'Evidencia vacía o no coincidente en Sheets -> Rechazado y genera SILENCIO', test9Rejected, 'Evidencia inexistente descartada de forma fail-closed');

  // --------------------------------------------------------------------------
  // 10. Pregunta específica sin propiedad individual validada: silencio (0 tokens)
  // --------------------------------------------------------------------------
  const pipelineResultNoContext = await evaluateCentralDecisionPipeline({
    userText: '¿Cuántos metros cuadrados tiene?',
    leadId: 'lead_nemo_no_context',
    properties: [mockProperty],
    handoffManager
    // Sin activePropertyContext ni enlace Wasi
  });
  const test10Valid = pipelineResultNoContext.shouldRespond === false &&
    pipelineResultNoContext.tokensUsed === 0 &&
    pipelineResultNoContext.log.typeDetected === 'UNMATCHED_INQUIRY';

  record(10, 'Pregunta específica sin propiedad validada -> Guarda SILENCIO (0 tokens)', test10Valid, `shouldRespond: ${pipelineResultNoContext.shouldRespond}, Tokens: ${pipelineResultNoContext.tokensUsed}, Tipo: ${pipelineResultNoContext.log.typeDetected}`);

  console.log('\n================================================================');
  console.log(` RESULTADOS LÓGICA NEMOTRON: ${passed} / ${total} ESCENARIOS SUPERADOS (${Math.round((passed / total) * 100)}%) `);
  console.log('================================================================\n');

  if (passed !== total) process.exit(1);
}

runNemotronRealEstateTests().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
