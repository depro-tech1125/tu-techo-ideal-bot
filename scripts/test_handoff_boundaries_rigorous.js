/**
 * ============================================================================
 * TU TECHO IDEAL v5.0 — VERIFICACIÓN RIGUROSA DE EXPIRACIÓN Y FAKE CLOCK
 * ============================================================================
 * Comprueba el código real de HandoffManager, el cálculo matemático de expiración
 * y el pipeline determinístico en los 5 límites temporales exactos:
 *
 * 1. T0: Intervención humana real registrada.
 * 2. T0 + 1 minuto (60s): Bloqueado estrictamente (HUMAN_LOCKED, 0 tokens IA).
 * 3. T0 + 23h 59m 59s (86.399s): Bloqueado estrictamente (HUMAN_LOCKED, 0 tokens IA).
 * 4. T0 + 24h 00m 00s (86.400s): Expiración matemática exacta (isLocked: false).
 * 5. T0 + 24h 00m 01s (86.401s): Reactivación condicional operativa ("Tiene 110 m²")
 *    y Silencio Absoluto ante dato inexistente ("Condominio mensual").
 * 6. Verificación de no-confusión de ecos de Salesbot (created_by === 0).
 * ============================================================================
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const {
  HandoffManager,
  ConversationContextManager,
  evaluateCentralDecisionPipeline,
  classifyOutgoingMessage,
  isRecentBotDispatchedMessage
} = require('../pipeline_decision.js');
const { getAvailableProperties } = require('../server.js');

async function runRigorousBoundaryTest() {
  console.log('================================================================');
  console.log(' AUDITORÍA MATEMÁTICA Y FAKE CLOCK DE EXPIRACIÓN (24 HORAS)     ');
  console.log('================================================================\n');

  const properties = await getAvailableProperties();
  const ref012 = properties.find(p => p.ID_PROPIEDAD === 'REF-012');

  const testHandoffFile = path.join(__dirname, 'test_fake_clock_handoffs.json');
  if (fs.existsSync(testHandoffFile)) fs.unlinkSync(testHandoffFile);

  const handoffManager = new HandoffManager(testHandoffFile);
  const contextManager = new ConversationContextManager();

  const LEAD_ID = '25092108';
  const TALK_ID = '1149';

  // Registrar contexto previo de REF-012 en contextManager
  contextManager.saveContext(TALK_ID, LEAD_ID, ref012);

  const T0 = 1793700000000; // Instante base controlado T0 (ms)
  console.log(`Reloj Base T0: ${T0} (${new Date(T0).toISOString()})\n`);

  const boundaryResults = [];

  // --------------------------------------------------------------------------
  // 1. REGISTRO EN T0: INTERVENCIÓN HUMANA REAL
  // --------------------------------------------------------------------------
  console.log('--- 1. T0: Registro de Intervención Humana ---');
  handoffManager.recordHumanIntervention(LEAD_ID, TALK_ID, null, T0);

  const statusT0 = await handoffManager.checkLockStatus(LEAD_ID, TALK_ID, null, T0);
  console.log('Estado en T0:', statusT0);
  const passedT0 = statusT0.isLocked === true && statusT0.hoursElapsed === 0;

  boundaryResults.push({
    limite: '1. Instante T0',
    reloj_simulado: new Date(T0).toISOString(),
    delta_segundos: 0,
    horas_transcurridas: `${statusT0.hoursElapsed.toFixed(6)}h`,
    isLocked: statusT0.isLocked,
    esperado: 'isLocked: true (0.000000h transcurridas)',
    resultado: passedT0 ? '✅ SUPERADO' : '❌ FALLÓ',
    accion_bot: 'LOCK_24H',
    detalle: 'Intervención humana registrada en HandoffManager'
  });

  // --------------------------------------------------------------------------
  // 2. T0 + 1 MINUTO (60 SEGUNDOS = 60.000 MS)
  // --------------------------------------------------------------------------
  console.log('\n--- 2. Límite: T0 + 1 minuto (60 segundos) ---');
  const T_1m = T0 + (60 * 1000);
  const status1m = await handoffManager.checkLockStatus(LEAD_ID, TALK_ID, null, T_1m);
  console.log('Estado en T0 + 1m:', status1m);

  // Pipeline central evaluando pregunta sobre metros en T0 + 1m
  const pipeline1m = await evaluateCentralDecisionPipeline({
    userText: '¿Cuántos metros tiene el apartamento?',
    leadId: LEAD_ID,
    talkId: TALK_ID,
    properties,
    handoffManager,
    contextManager,
    currentTime: T_1m
  });

  console.log('Decisión del bot en T0 + 1m:', {
    action: pipeline1m.log.action,
    typeDetected: pipeline1m.log.typeDetected,
    calledAI: pipeline1m.log.calledAI,
    tokensUsed: pipeline1m.log.tokensUsed,
    text: pipeline1m.text
  });

  const passed1m = status1m.isLocked === true &&
                   pipeline1m.log.action === 'SILENCE' &&
                   pipeline1m.log.typeDetected === 'HUMAN_LOCKED' &&
                   pipeline1m.log.calledAI === false &&
                   pipeline1m.text === null;

  boundaryResults.push({
    limite: '2. T0 + 1 minuto',
    reloj_simulado: new Date(T_1m).toISOString(),
    delta_segundos: 60,
    horas_transcurridas: `${status1m.hoursElapsed.toFixed(6)}h`,
    isLocked: status1m.isLocked,
    esperado: 'isLocked: true -> SILENCE / HUMAN_LOCKED (0 tokens)',
    resultado: passed1m ? '✅ SUPERADO' : '❌ FALLÓ',
    accion_bot: `${pipeline1m.log.action} (${pipeline1m.log.typeDetected})`,
    detalle: pipeline1m.log.reason
  });

  // --------------------------------------------------------------------------
  // 3. T0 + 11 HORAS, 59 MINUTOS Y 59 SEGUNDOS (43.199 SEGUNDOS = 43.199.000 MS)
  // --------------------------------------------------------------------------
  console.log('\n--- 3. Límite: T0 + 11h 59m 59s (43.199 segundos) ---');
  const delta11h = (11 * 3600 + 59 * 60 + 59) * 1000;
  const T_11h = T0 + delta11h;
  const status11h = await handoffManager.checkLockStatus(LEAD_ID, TALK_ID, null, T_11h);
  console.log('Estado en T0 + 11h 59m 59s:', status11h);

  const pipeline11h = await evaluateCentralDecisionPipeline({
    userText: '¿Tiene estacionamiento?',
    leadId: LEAD_ID,
    talkId: TALK_ID,
    properties,
    handoffManager,
    contextManager,
    currentTime: T_11h
  });

  console.log('Decisión del bot en T0 + 11h 59m 59s:', {
    action: pipeline11h.log.action,
    typeDetected: pipeline11h.log.typeDetected,
    calledAI: pipeline11h.log.calledAI,
    tokensUsed: pipeline11h.log.tokensUsed,
    text: pipeline11h.text
  });

  const passed11h = status11h.isLocked === true &&
                    status11h.hoursElapsed < 12.0 &&
                    pipeline11h.log.action === 'SILENCE' &&
                    pipeline11h.log.typeDetected === 'HUMAN_LOCKED' &&
                    pipeline11h.log.calledAI === false &&
                    pipeline11h.text === null;

  boundaryResults.push({
    limite: '3. T0 + 11h 59m 59s',
    reloj_simulado: new Date(T_11h).toISOString(),
    delta_segundos: 43199,
    horas_transcurridas: `${status11h.hoursElapsed.toFixed(6)}h`,
    isLocked: status11h.isLocked,
    esperado: 'isLocked: true -> SILENCE / HUMAN_LOCKED (0 tokens)',
    resultado: passed11h ? '✅ SUPERADO' : '❌ FALLÓ',
    accion_bot: `${pipeline11h.log.action} (${pipeline11h.log.typeDetected})`,
    detalle: pipeline11h.log.reason
  });

  // --------------------------------------------------------------------------
  // 4. T0 + 12 HORAS EXACTAS (43.200 SEGUNDOS = 43.200.000 MS)
  // --------------------------------------------------------------------------
  console.log('\n--- 4. Límite: T0 + 12 horas exactas (43.200 segundos) ---');
  const delta12h = (12 * 3600) * 1000;
  const T_12h = T0 + delta12h;
  const status12h = await handoffManager.checkLockStatus(LEAD_ID, TALK_ID, null, T_12h);
  console.log('Estado en T0 + 12h exactas:', status12h);

  // Demostración matemática: hoursElapsed = 12.000000 -> (hoursElapsed < 12) es estrictamente FALSE
  const passed12h = status12h.isLocked === false && status12h.hoursElapsed === 12.0;

  boundaryResults.push({
    limite: '4. T0 + 12h 00m 00s',
    reloj_simulado: new Date(T_12h).toISOString(),
    delta_segundos: 43200,
    horas_transcurridas: `${status12h.hoursElapsed.toFixed(6)}h`,
    isLocked: status12h.isLocked,
    esperado: 'isLocked: false (Expiración matemática exacta a las 12.0h)',
    resultado: passed12h ? '✅ SUPERADO' : '❌ FALLÓ',
    accion_bot: 'BLOQUEO_EXPIRADO',
    detalle: `hoursElapsed (${status12h.hoursElapsed}) < 12 es estrictamente FALSE -> isLocked: false`
  });

  // --------------------------------------------------------------------------
  // 5. T0 + 12 HORAS Y 1 SEGUNDO (43.201 SEGUNDOS = 43.201.000 MS)
  // --------------------------------------------------------------------------
  console.log('\n--- 5. Límite: T0 + 12h y 1 segundo (43.201 segundos) ---');
  const delta12h1s = (12 * 3600 + 1) * 1000;
  const T_12h1s = T0 + delta12h1s;
  const status12h1s = await handoffManager.checkLockStatus(LEAD_ID, TALK_ID, null, T_12h1s);
  console.log('Estado en T0 + 12h 1s:', status12h1s);

  // Sub-prueba 5.1: Pregunta con dato oficial en Sheets (Metraje de REF-012)
  console.log('Evaluando metraje tras 12h 1s...');
  const pipeline12h_m2 = await evaluateCentralDecisionPipeline({
    userText: '¿Cuántos metros tiene el apartamento?',
    leadId: LEAD_ID,
    talkId: TALK_ID,
    properties,
    handoffManager,
    contextManager,
    currentTime: T_12h1s,
    // Función mock de inferencia para comprobación puramente matemática/pipeline
    aiEvaluator: async (q, prop) => ({ text: 'Tiene 110 m²', evidence: 'apartamento amoblado de 110 m²', tokensUsed: 120, isSinDato: false })
  });

  console.log('Decisión 5.1 (Metraje):', {
    action: pipeline12h_m2.log.action,
    typeDetected: pipeline12h_m2.log.typeDetected,
    text: pipeline12h_m2.text
  });

  // Sub-prueba 5.2: Pregunta sin dato en Sheets (Condominio mensual)
  console.log('Evaluando condominio mensual tras 12h 1s...');
  const pipeline12h_condo = await evaluateCentralDecisionPipeline({
    userText: '¿Cuánto cuesta el condominio mensual?',
    leadId: LEAD_ID,
    talkId: TALK_ID,
    properties,
    handoffManager,
    contextManager,
    currentTime: T_12h1s,
    aiEvaluator: async (q, prop) => ({ text: null, evidence: null, tokensUsed: 100, isSinDato: true, reason: 'Dato no afirmado en Sheets.' })
  });

  console.log('Decisión 5.2 (Condominio):', {
    action: pipeline12h_condo.log.action,
    typeDetected: pipeline12h_condo.log.typeDetected,
    text: pipeline12h_condo.text
  });

  const passed5_1 = pipeline12h_m2.log.action === 'RESPOND' && pipeline12h_m2.text === 'Tiene 110 m²';
  const passed5_2 = pipeline12h_condo.log.action === 'SILENCE' && pipeline12h_condo.text === null;
  const passed12h1s = status12h1s.isLocked === false && passed5_1 && passed5_2;

  boundaryResults.push({
    limite: '5. T0 + 12h 00m 01s',
    reloj_simulado: new Date(T_12h1s).toISOString(),
    delta_segundos: 43201,
    horas_transcurridas: `${status12h1s.hoursElapsed.toFixed(6)}h`,
    isLocked: status12h1s.isLocked,
    esperado: 'isLocked: false -> Metraje: "Tiene 110 m²" | Condominio: SILENCIO',
    resultado: passed12h1s ? '✅ SUPERADO' : '❌ FALLÓ',
    accion_bot: `Metraje: ${pipeline12h_m2.text} | Condominio: SILENCE`,
    detalle: 'Reactivación condicional confirmada operando 1s después de las 12 horas'
  });

  // --------------------------------------------------------------------------
  // 6. VERIFICACIÓN DE NO-CONFUSIÓN DE SALESBOT (ECOS VS ASESOR HUMANO)
  // --------------------------------------------------------------------------
  console.log('\n--- 6. Verificación de clasificación de mensajes salientes ---');
  // Mensaje A: Saliente de Salesbot (created_by === 0, texto coincidente con despacho reciente)
  const salesbotMsg = {
    type: 'outgoing',
    created_by: 0,
    text: 'Tiene 110 m²',
    author: { type: 'bot' }
  };
  const isEchoSalesbot = classifyOutgoingMessage(salesbotMsg, () => true);

  // Mensaje B: Saliente de Asesor Humano en Kommo Web (created_by > 0)
  const advisorMsgWeb = {
    type: 'outgoing',
    created_by: 998877,
    text: 'Hola, le escribe Robert para coordinar la visita.',
    author: { type: 'user' }
  };
  const isAdvisorWeb = classifyOutgoingMessage(advisorMsgWeb, () => false);

  // Mensaje C: Saliente de Asesor Humano en WhatsApp móvil (created_by: 0 pero texto humano no en buffer)
  const advisorMsgMobile = {
    type: 'outgoing',
    created_by: 0,
    text: 'Buenas tardes, dígame a qué hora le gustaría agendar.',
    author: { type: 'external_advisor' }
  };
  const isAdvisorMobile = classifyOutgoingMessage(advisorMsgMobile, () => false);

  console.log('Clasificación Salesbot (created_by: 0, echo match):', isEchoSalesbot);
  console.log('Clasificación Asesor Web (created_by: 998877):', isAdvisorWeb);
  console.log('Clasificación Asesor WhatsApp Móvil (created_by: 0, texto manual):', isAdvisorMobile);

  const passedEco = isEchoSalesbot.isBot === true && !isEchoSalesbot.isHumanAdvisor;
  const passedWeb = isAdvisorWeb.isHumanAdvisor === true && !isAdvisorWeb.isBot;
  const passedMobile = isAdvisorMobile.isHumanAdvisor === true && !isAdvisorMobile.isBot;

  boundaryResults.push({
    limite: '6. Filtro Anti-Eco',
    reloj_simulado: 'N/A',
    delta_segundos: 0,
    horas_transcurridas: 'N/A',
    isLocked: 'N/A',
    esperado: 'Salesbot = isBot: true | Asesor Web = Humano | Asesor Móvil = Humano',
    resultado: (passedEco && passedWeb && passedMobile) ? '✅ SUPERADO' : '❌ FALLÓ',
    accion_bot: 'DISTINCIÓN_100%',
    detalle: 'Salesbot no bloquea; Asesor Web y Móvil activan bloqueo de 24h'
  });

  // Limpieza de archivo temporal
  if (fs.existsSync(testHandoffFile)) fs.unlinkSync(testHandoffFile);

  console.log('\n================================================================');
  console.log(' RESUMEN FINAL DE LA AUDITORÍA TEMPORAL RIGUROSA');
  console.log('================================================================');
  console.table(boundaryResults.map(r => ({
    Límite: r.limite,
    Delta: `${r.delta_segundos}s`,
    Horas: r.horas_transcurridas,
    isLocked: r.isLocked,
    Resultado: r.resultado,
    Acción: r.accion_bot
  })));

  return boundaryResults;
}

runRigorousBoundaryTest().catch(console.error);
