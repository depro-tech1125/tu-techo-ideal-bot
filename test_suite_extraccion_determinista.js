/**
 * ============================================================================
 * SUITE DE REGRESIÓN Y CIERRE COMERCIAL — EXTRACCIÓN DETERMINISTA SHEETS
 * ============================================================================
 * Valida los 10 escenarios exigidos por la dirección técnica:
 * 1. REF-012: Metraje (110 m²)
 * 2. REF-012: Precio ($146.000)
 * 3. REF-005: Metraje (80,45 m²)
 * 4. REF-005: Precio ($355.674)
 * 5. Cambio de propiedad de REF-012 a REF-005 (cero contaminación)
 * 6. Datos inexistentes (Piscina/Tenis y Condominio -> Silencio absoluto)
 * 7. Valores ambiguos (Venta/Alquiler y Terreno/Construcción -> Silencio)
 * 8. Conversaciones diferentes (Aislamiento Talk A vs Talk B)
 * 9. Bloqueo humano activo (Prevalencia absoluta del bloqueo sobre respuestas)
 * 10. Nueva intervención humana (Reinicio a cero y reactivación post-12h con respuesta)
 * ============================================================================
 */

const path = require('path');
const fs = require('fs');
const {
  evaluateCentralDecisionPipeline,
  ConversationContextManager,
  HandoffManager,
  extractDeterministicPropertyFeature
} = require('./pipeline_decision.js');
const { getAvailableProperties } = require('./server.js');

async function runRegressionSuite() {
  console.log('================================================================');
  console.log('   SUITE DE REGRESIÓN: EXTRACCIÓN DETERMINISTA GOOGLE SHEETS    ');
  console.log('================================================================\n');

  const allProps = await getAvailableProperties();
  const ref012 = allProps.find(p => p.ID_PROPIEDAD === 'REF-012');
  const ref005 = allProps.find(p => p.ID_PROPIEDAD === 'REF-005');
  const ref001 = allProps.find(p => p.ID_PROPIEDAD === 'REF-001');

  if (!ref012 || !ref005 || !ref001) {
    throw new Error('Propiedades de prueba no encontradas en Sheets');
  }

  const testHandoffFile = path.join(__dirname, 'test_handoffs_regresion.json');
  if (fs.existsSync(testHandoffFile)) fs.unlinkSync(testHandoffFile);

  const handoffManager = new HandoffManager(testHandoffFile);
  const contextManager = new ConversationContextManager();

  const results = [];

  function record(num, name, condition, details) {
    if (condition) {
      console.log(`✅ [Regresión ${num}/10] PASÓ: ${name}`);
      console.log(`   Detalle: ${details}\n`);
      results.push({ num, name, status: 'PASSED', details });
    } else {
      console.error(`❌ [Regresión ${num}/10] FALLÓ: ${name}`);
      console.error(`   Detalle: ${details}\n`);
      results.push({ num, name, status: 'FAILED', details });
    }
  }

  // --------------------------------------------------------------------------
  // 1. REF-012: Metraje
  // --------------------------------------------------------------------------
  contextManager.saveContext('talk_reg_1', 'lead_reg_1', ref012);
  const r1 = await evaluateCentralDecisionPipeline({
    userText: '¿Cuántos metros tiene el apartamento?',
    leadId: 'lead_reg_1',
    talkId: 'talk_reg_1',
    properties: allProps,
    handoffManager,
    contextManager
  });
  record(
    1,
    'REF-012: Metraje -> 110 m² (0 tokens IA)',
    r1.shouldRespond === true && r1.text === 'Tiene 110 m²' && r1.log.calledAI === false && r1.log.tokensUsed === 0,
    `Respondió: "${r1.text}", Evidencia: "${r1.log.evidence}", Tokens: ${r1.log.tokensUsed}`
  );

  // --------------------------------------------------------------------------
  // 2. REF-012: Precio
  // --------------------------------------------------------------------------
  const r2 = await evaluateCentralDecisionPipeline({
    userText: '¿Cuál es su precio?',
    leadId: 'lead_reg_1',
    talkId: 'talk_reg_1',
    properties: allProps,
    handoffManager,
    contextManager
  });
  record(
    2,
    'REF-012: Precio -> $146.000 (0 tokens IA)',
    r2.shouldRespond === true && r2.text === '$146.000' && r2.log.calledAI === false && r2.log.tokensUsed === 0,
    `Respondió: "${r2.text}", Evidencia: "${r2.log.evidence}", Tokens: ${r2.log.tokensUsed}`
  );

  // --------------------------------------------------------------------------
  // 3. REF-005: Metraje
  // --------------------------------------------------------------------------
  contextManager.saveContext('talk_reg_3', 'lead_reg_3', ref005);
  const r3 = await evaluateCentralDecisionPipeline({
    userText: '¿Cuál es el área del apartamento?',
    leadId: 'lead_reg_3',
    talkId: 'talk_reg_3',
    properties: allProps,
    handoffManager,
    contextManager
  });
  record(
    3,
    'REF-005: Metraje -> 80,45 m² (0 tokens IA)',
    r3.shouldRespond === true && r3.text === 'Tiene 80,45 m²' && r3.log.calledAI === false && r3.log.tokensUsed === 0,
    `Respondió: "${r3.text}", Evidencia: "${r3.log.evidence}", Tokens: ${r3.log.tokensUsed}`
  );

  // --------------------------------------------------------------------------
  // 4. REF-005: Precio
  // --------------------------------------------------------------------------
  const r4 = await evaluateCentralDecisionPipeline({
    userText: '¿Cuánto cuesta?',
    leadId: 'lead_reg_3',
    talkId: 'talk_reg_3',
    properties: allProps,
    handoffManager,
    contextManager
  });
  record(
    4,
    'REF-005: Precio -> $355.674 (0 tokens IA)',
    r4.shouldRespond === true && r4.text === '$355.674' && r4.log.calledAI === false && r4.log.tokensUsed === 0,
    `Respondió: "${r4.text}", Evidencia: "${r4.log.evidence}", Tokens: ${r4.log.tokensUsed}`
  );

  // --------------------------------------------------------------------------
  // 5. Cambio de REF-012 a REF-005 (Misma Conversación)
  // --------------------------------------------------------------------------
  const talk5 = 'talk_reg_5';
  const lead5 = 'lead_reg_5';
  // Turno 1: Enlace REF-012
  const t5_turn1 = await evaluateCentralDecisionPipeline({
    userText: 'Me interesa este apartamento https://info.wasi.co/apartamento-venta-los-samanes-caracas/10493109',
    leadId: lead5,
    talkId: talk5,
    properties: allProps,
    handoffManager,
    contextManager
  });
  // Turno 2: Enlace REF-005 en la misma conversación
  const t5_turn2 = await evaluateCentralDecisionPipeline({
    userText: 'Y también este otro https://info.wasi.co/inmueble/10442548',
    leadId: lead5,
    talkId: talk5,
    properties: allProps,
    handoffManager,
    contextManager
  });
  // Turno 3: Pregunta sobre metraje (Debe ser 80,45 m² de REF-005, NO 110 m² de REF-012)
  const t5_metraje = await evaluateCentralDecisionPipeline({
    userText: '¿Cuántos metros tiene?',
    leadId: lead5,
    talkId: talk5,
    properties: allProps,
    handoffManager,
    contextManager
  });
  // Turno 4: Pregunta sobre precio (Debe ser $355.674 de REF-005, NO $146.000 de REF-012)
  const t5_precio = await evaluateCentralDecisionPipeline({
    userText: '¿Cuál es su precio?',
    leadId: lead5,
    talkId: talk5,
    properties: allProps,
    handoffManager,
    contextManager
  });

  const passed5 = t5_turn1.text === 'Bienvenido a Tu Techo Ideal, sí, disponible.' &&
                  t5_turn2.text === 'Bienvenido a Tu Techo Ideal, sí, disponible.' &&
                  t5_metraje.text === 'Tiene 80,45 m²' &&
                  t5_precio.text === '$355.674';
  record(
    5,
    'Cambio de REF-012 a REF-005 -> Aislamiento estricto de fichas (0 mezcla)',
    passed5,
    `Turno 3 Metraje: "${t5_metraje.text}" | Turno 4 Precio: "${t5_precio.text}"`
  );

  // --------------------------------------------------------------------------
  // 6. Datos Inexistentes (Amenidades y Condominio en REF-012)
  // --------------------------------------------------------------------------
  contextManager.saveContext('talk_reg_6', 'lead_reg_6', ref012);
  const r6_pool = await evaluateCentralDecisionPipeline({
    userText: '¿Tiene piscina olímpica y cancha de tenis?',
    leadId: 'lead_reg_6',
    talkId: 'talk_reg_6',
    properties: allProps,
    handoffManager,
    contextManager
  });
  const r6_condo = await evaluateCentralDecisionPipeline({
    userText: '¿Cuánto cuesta el condominio mensual?',
    leadId: 'lead_reg_6',
    talkId: 'talk_reg_6',
    properties: allProps,
    handoffManager,
    contextManager
  });
  const passed6 = r6_pool.shouldRespond === false && r6_pool.text === null &&
                  r6_condo.shouldRespond === false && r6_condo.text === null;
  record(
    6,
    'Datos Inexistentes -> Silencio absoluto (Cero invención)',
    passed6,
    `Piscina/Tenis: action=${r6_pool.log.action}, text=${r6_pool.text} | Condominio: action=${r6_condo.log.action}, text=${r6_condo.text}`
  );

  // --------------------------------------------------------------------------
  // 7. Valores Ambiguos (REF-001)
  // --------------------------------------------------------------------------
  contextManager.saveContext('talk_reg_7', 'lead_reg_7', ref001);
  const r7_amb_m2 = await evaluateCentralDecisionPipeline({
    userText: '¿Cuántos metros tiene?',
    leadId: 'lead_reg_7',
    talkId: 'talk_reg_7',
    properties: allProps,
    handoffManager,
    contextManager
  });
  const r7_amb_price = await evaluateCentralDecisionPipeline({
    userText: '¿Cuánto cuesta?',
    leadId: 'lead_reg_7',
    talkId: 'talk_reg_7',
    properties: allProps,
    handoffManager,
    contextManager
  });
  const r7_spec_price = await evaluateCentralDecisionPipeline({
    userText: '¿Cuál es el precio de venta?',
    leadId: 'lead_reg_7',
    talkId: 'talk_reg_7',
    properties: allProps,
    handoffManager,
    contextManager
  });
  const passed7 = r7_amb_m2.shouldRespond === false && r7_amb_m2.text === null &&
                  r7_amb_price.shouldRespond === false && r7_amb_price.text === null &&
                  r7_spec_price.shouldRespond === true && r7_spec_price.text === '$600.000';
  record(
    7,
    'Valores Ambiguos -> Silencio ante preguntas genéricas y respuesta ante pregunta específica',
    passed7,
    `Metraje ambiguo: ${r7_amb_m2.log.reason} | Precio ambiguo: ${r7_amb_price.log.reason} | Precio venta específico: "${r7_spec_price.text}"`
  );

  // --------------------------------------------------------------------------
  // 8. Conversaciones Diferentes (Aislamiento Talk A vs Talk B)
  // --------------------------------------------------------------------------
  contextManager.saveContext('talk_A', 'lead_A', ref012);
  contextManager.saveContext('talk_B', 'lead_B', ref005);
  const r8A = await evaluateCentralDecisionPipeline({
    userText: '¿Cuántos metros tiene?',
    leadId: 'lead_A',
    talkId: 'talk_A',
    properties: allProps,
    handoffManager,
    contextManager
  });
  const r8B = await evaluateCentralDecisionPipeline({
    userText: '¿Cuántos metros tiene?',
    leadId: 'lead_B',
    talkId: 'talk_B',
    properties: allProps,
    handoffManager,
    contextManager
  });
  const passed8 = r8A.text === 'Tiene 110 m²' && r8B.text === 'Tiene 80,45 m²';
  record(
    8,
    'Conversaciones Diferentes -> Aislamiento por Talk ID (Talk A: 110 m², Talk B: 80,45 m²)',
    passed8,
    `Talk A: "${r8A.text}" (${r8A.log.propertyIdentified}) | Talk B: "${r8B.text}" (${r8B.log.propertyIdentified})`
  );

  // --------------------------------------------------------------------------
  // 9. Bloqueo Humano Activo (12 Horas)
  // --------------------------------------------------------------------------
  const lead9 = 'lead_reg_9';
  const talk9 = 'talk_reg_9';
  contextManager.saveContext(talk9, lead9, ref012);
  const t0_9 = Date.now();
  handoffManager.recordHumanIntervention(lead9, talk9, null, t0_9);

  // Simular consulta a los 10 minutos (bloqueo activo)
  const r9 = await evaluateCentralDecisionPipeline({
    userText: '¿Cuántos metros tiene el apartamento?',
    leadId: lead9,
    talkId: talk9,
    properties: allProps,
    handoffManager,
    contextManager,
    currentTime: t0_9 + (10 * 60 * 1000)
  });
  const passed9 = r9.shouldRespond === false && r9.text === null &&
                  r9.log.action === 'SILENCE' && r9.log.typeDetected === 'HUMAN_LOCKED' &&
                  r9.log.calledAI === false;
  record(
    9,
    'Bloqueo Humano Activo -> Prevalencia absoluta sobre respuestas automáticas',
    passed9,
    `Acción: ${r9.log.action}, Tipo: ${r9.log.typeDetected}, Respondió: ${r9.shouldRespond}, Llamó IA: ${r9.log.calledAI}`
  );

  // --------------------------------------------------------------------------
  // 10. Nueva Intervención Humana (Reinicio y Reactivación Post-12h)
  // --------------------------------------------------------------------------
  const lead10 = 'lead_reg_10';
  const talk10 = 'talk_reg_10';
  contextManager.saveContext(talk10, lead10, ref012);
  const t0_10 = 1700000000000;
  handoffManager.recordHumanIntervention(lead10, talk10, null, t0_10);

  // A las 6 horas ocurre segunda intervención humana (T1)
  const t1_10 = t0_10 + (6 * 3600 * 1000);
  handoffManager.recordHumanIntervention(lead10, talk10, null, t1_10);

  // Comprobar en T0 + 13 horas (que es T1 + 7 horas): debe seguir BLOQUEADO
  const r10_locked = await evaluateCentralDecisionPipeline({
    userText: '¿Cuántos metros tiene el apartamento?',
    leadId: lead10,
    talkId: talk10,
    properties: allProps,
    handoffManager,
    contextManager,
    currentTime: t0_10 + (13 * 3600 * 1000) // T1 + 7h
  });

  // Comprobar tras cumplirse las 12 horas desde T1 (T1 + 12h y 1s): DESBLOQUEADO y responde
  const r10_unlocked = await evaluateCentralDecisionPipeline({
    userText: '¿Cuántos metros tiene el apartamento?',
    leadId: lead10,
    talkId: talk10,
    properties: allProps,
    handoffManager,
    contextManager,
    currentTime: t1_10 + (12 * 3600 * 1000) + 1000 // T1 + 12h 1s
  });

  const passed10 = r10_locked.shouldRespond === false && r10_locked.log.typeDetected === 'HUMAN_LOCKED' &&
                   r10_unlocked.shouldRespond === true && r10_unlocked.text === 'Tiene 110 m²';
  record(
    10,
    'Nueva Intervención Humana -> Reinicio de contador a cero y reactivación post-12h con respuesta',
    passed10,
    `T1 + 7h: isLocked=${r10_locked.log.typeDetected} | T1 + 12h1s: responde="${r10_unlocked.text}"`
  );

  console.log('================================================================');
  const passedTotal = results.filter(r => r.status === 'PASSED').length;
  console.log(` RESULTADOS FINALES: ${passedTotal} / ${results.length} PRUEBAS SUPERADAS (${Math.round(passedTotal/results.length*100)}%) `);
  console.log('================================================================');

  if (fs.existsSync(testHandoffFile)) fs.unlinkSync(testHandoffFile);
  return { passedTotal, total: results.length, results };
}

runRegressionSuite().catch(console.error);
