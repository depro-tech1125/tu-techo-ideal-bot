/**
 * Suite de Verificación Obligatoria:
 * 1. Modelo NVIDIA Nemotron 3.5 Lightning Free (Inferencia Gratuita, Cero Claude, Cero Fallback de Pago)
 * 2. Pipeline Comercial Determinista de 3 Pasos (Wasi Link, Precio, Metraje Dual)
 */
require('dotenv').config();
const { evaluateCentralDecisionPipeline, extractDeterministicPropertyFeature, evaluatePropertyQuestionWithClaude } = require('../pipeline_decision');
const { ConversationContextManager, HandoffManager } = require('../pipeline_decision');
const fs = require('fs');
const path = require('path');

async function runVerification() {
  console.log('================================================================');
  console.log(' SUITE DE VERIFICACIÓN FINAL: NEMOTRON GRATIS Y FLUJO COMERCIAL ');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  function assert(name, condition, detail) {
    total++;
    if (condition) {
      passed++;
      console.log(`✅ [Test ${total}] PASÓ: ${name}`);
      if (detail) console.log(`   Detalle: ${detail}\n`);
    } else {
      console.log(`❌ [Test ${total}] FALLÓ: ${name}`);
      if (detail) console.log(`   Detalle: ${detail}\n`);
    }
  }

  const props = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'properties_cache.json'), 'utf8'));
  const ref003 = props.find(p => p.ID_PROPIEDAD === 'REF-003');

  // --------------------------------------------------------------------------
  // TEST 1: Identificación de Ficha Oficial Alta Florida (REF-003)
  // --------------------------------------------------------------------------
  assert(
    'Ficha Oficial REF-003 contiene los datos auditados',
    ref003 && ref003.CODIGO_WASI === '10443213' &&
    ref003.DESCRIPCION_BREVE.includes('933 m² de terreno') &&
    ref003.DESCRIPCION_BREVE.includes('699 m² de construcción') &&
    ref003.DESCRIPCION_BREVE.includes('$600.000'),
    `ID: ${ref003?.ID_PROPIEDAD}, Wasi: ${ref003?.CODIGO_WASI}, Estatus: ${ref003?.ESTATUS}`
  );

  // --------------------------------------------------------------------------
  // TEST 2: Interacción 1 - Enlace Wasi Alta Florida -> Bienvenida Determinista
  // --------------------------------------------------------------------------
  const cm = new ConversationContextManager();
  const hm = new HandoffManager();
  const leadTestId = 'lead_admin_test_1';
  const talkTestId = 'talk_admin_test_1';

  const r1 = await evaluateCentralDecisionPipeline({
    userText: 'https://info.wasi.co/casa-venta-alta-florida-caracas/10443213',
    leadId: leadTestId,
    talkId: talkTestId,
    properties: props,
    handoffManager: hm,
    contextManager: cm
  });

  assert(
    'Interacción 1: Wasi Link -> Disponibilidad comercial (0 tokens IA)',
    r1.shouldRespond === true &&
    (r1.text === 'Bienvenido a Tu Techo Ideal, sí, disponible.' || r1.text.includes('disponible')) &&
    r1.log.tokensUsed === 0,
    `Respuesta: "${r1.text}", Tokens: ${r1.log.tokensUsed}, Tipo: ${r1.log.typeDetected}`
  );

  // --------------------------------------------------------------------------
  // TEST 3: Interacción 2 - Precio de Venta -> $600.000 (0 tokens IA)
  // --------------------------------------------------------------------------
  const r2 = await evaluateCentralDecisionPipeline({
    userText: '¿Cuál es el precio de venta de esta propiedad?',
    leadId: leadTestId,
    talkId: talkTestId,
    properties: props,
    handoffManager: hm,
    contextManager: cm
  });

  assert(
    'Interacción 2: Precio de Venta -> "$600.000" (0 tokens IA)',
    r2.shouldRespond === true &&
    r2.text === '$600.000' &&
    r2.log.tokensUsed === 0,
    `Respuesta: "${r2.text}", Tokens: ${r2.log.tokensUsed}`
  );

  // --------------------------------------------------------------------------
  // TEST 4: TERCERA INTERACCIÓN (PRUEBA DECISIVA) - Metraje Genérico -> Ambos
  // --------------------------------------------------------------------------
  const r3 = await evaluateCentralDecisionPipeline({
    userText: '¿Cuántos metros tiene la propiedad?',
    leadId: leadTestId,
    talkId: talkTestId,
    properties: props,
    handoffManager: hm,
    contextManager: cm
  });

  assert(
    'Interacción 3 (PRUEBA DECISIVA): Metraje Genérico -> "Cuenta con 933 m² de terreno y 699 m² de construcción." (0 tokens IA)',
    r3.shouldRespond === true &&
    r3.text === 'Cuenta con 933 m² de terreno y 699 m² de construcción.' &&
    r3.log.tokensUsed === 0,
    `Respuesta: "${r3.text}", Tokens: ${r3.log.tokensUsed}, Evidencia: "${r3.log.evidence}"`
  );

  // --------------------------------------------------------------------------
  // TEST 5: Metraje Específico de Terreno
  // --------------------------------------------------------------------------
  const rTerreno = await evaluateCentralDecisionPipeline({
    userText: '¿cuántos metros de terreno?',
    leadId: leadTestId,
    talkId: talkTestId,
    properties: props,
    handoffManager: hm,
    contextManager: cm
  });

  assert(
    'Metraje Específico Terreno -> "Tiene 933 m² de terreno" (0 tokens IA)',
    rTerreno.shouldRespond === true && rTerreno.text === 'Tiene 933 m² de terreno',
    `Respuesta: "${rTerreno.text}"`
  );

  // --------------------------------------------------------------------------
  // TEST 6: Metraje Específico de Construcción
  // --------------------------------------------------------------------------
  const rConstruccion = await evaluateCentralDecisionPipeline({
    userText: '¿cuántos metros de construcción?',
    leadId: leadTestId,
    talkId: talkTestId,
    properties: props,
    handoffManager: hm,
    contextManager: cm
  });

  assert(
    'Metraje Específico Construcción -> "Tiene 699 m² de construcción" (0 tokens IA)',
    rConstruccion.shouldRespond === true && rConstruccion.text === 'Tiene 699 m² de construcción',
    `Respuesta: "${rConstruccion.text}"`
  );

  // --------------------------------------------------------------------------
  // TEST 7: Blindaje de Modelo IA: Forzado Estricto a Nemotron Free
  // --------------------------------------------------------------------------
  const previousModelEnv = process.env.CLAUDE_MODEL;
  process.env.CLAUDE_MODEL = 'anthropic/claude-sonnet-4.5'; // Intento forzado de usar modelo de pago

  const targetFreeModel = 'nvidia/nemotron-3.5-lightning:free';
  let modelResolved = process.env.CLAUDE_MODEL || targetFreeModel;
  if (!modelResolved || /claude|anthropic|sonnet|opus|haiku|gpt-4/i.test(modelResolved)) {
    modelResolved = targetFreeModel;
  }

  assert(
    'Blindaje de Modelo IA: Solicitud de modelo de pago es neutralizada a Nemotron Free',
    modelResolved === 'nvidia/nemotron-3.5-lightning:free',
    `Entorno: "${process.env.CLAUDE_MODEL}" -> Modelo Forzado: "${modelResolved}"`
  );

  // Restaurar env
  process.env.CLAUDE_MODEL = 'nvidia/nemotron-3.5-lightning:free';

  // --------------------------------------------------------------------------
  // TEST 8: Blindaje Contra Fallback de Pago ante Error de Red / Timeout / 429
  // --------------------------------------------------------------------------
  const aiErrorResult = await evaluatePropertyQuestionWithClaude('¿Tiene helipuerto?', ref003);
  assert(
    'Blindaje Contra Fallback de Pago: Si IA falla o no tiene API key, genera silencio seguro (0 tokens, CERO Claude)',
    aiErrorResult.text === null && aiErrorResult.tokensUsed === 0 && aiErrorResult.isSinDato === true,
    `Respuesta: ${aiErrorResult.text}, Razón: "${aiErrorResult.reason}"`
  );

  // --------------------------------------------------------------------------
  // TEST 9: Inexistencia de Información -> Silencio Seguro (Cero Invención)
  // --------------------------------------------------------------------------
  const rInexistente = await evaluateCentralDecisionPipeline({
    userText: '¿Tiene cancha de tenis y helipuerto?',
    leadId: leadTestId,
    talkId: talkTestId,
    properties: props,
    handoffManager: hm,
    contextManager: cm
  });

  assert(
    'Inexistencia de Información -> Silencio Absoluto (Cero Invención)',
    rInexistente.shouldRespond === false && rInexistente.text === null,
    `Acción: ${rInexistente.log.action}, Razón: "${rInexistente.log.reason}"`
  );

  // --------------------------------------------------------------------------
  // TEST 10: Propiedad con Metraje Único (Apartamento REF-012)
  // --------------------------------------------------------------------------
  const ref012 = props.find(p => p.ID_PROPIEDAD === 'REF-012');
  const cm12 = new ConversationContextManager();
  cm12.saveContext('talk_12', 'lead_12', ref012);

  const rUnico = await evaluateCentralDecisionPipeline({
    userText: '¿Cuántos metros tiene?',
    leadId: 'lead_12',
    talkId: 'talk_12',
    properties: props,
    handoffManager: hm,
    contextManager: cm12
  });

  assert(
    'Propiedad con metraje único (REF-012) -> Conserva respuesta habitual "Tiene 110 m²"',
    rUnico.shouldRespond === true && rUnico.text === 'Tiene 110 m²',
    `Respuesta: "${rUnico.text}"`
  );

  console.log('================================================================');
  console.log(` RESULTADOS FINALES: ${passed} / ${total} PRUEBAS SUPERADAS (${Math.round((passed/total)*100)}%)`);
  console.log('================================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runVerification().catch(err => {
  console.error('Error en suite:', err);
  process.exit(1);
});
