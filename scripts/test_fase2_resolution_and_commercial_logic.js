/**
 * SUITE DE PRUEBAS DE FASE 2: RESOLUCIÓN UNIVERSAL DE INMUEBLES Y LÓGICA COMERCIAL
 * Tu Techo Ideal V5.1 — Depro Tech Solutions
 *
 * 1. Caso REF-061: Enlace MLS Caracas no registrado que coincide por código 10539723.
 *    Jerarquía comercial: Google Sheets "Alquiler" prevalece sobre "venta" en slug.
 *    Alerta interna para Robert (Escenario A) generada, cliente recibe respuesta verificada.
 * 2. Caso Juan Pablo II (Randal Herrera): Consulta por zona inexistente en inventario.
 *    Cero disponibilidad ("sí, disponible" prohibido), cero otras zonas, respuesta educada de ausencia.
 * 3. Enlace no registrado Escenario B: Enlace externo sin coincidencia en inventario.
 *    Silencio al cliente, alerta interna para Robert (Escenario B) generada.
 * 4. Historial multipropiedad en la misma conversación:
 *    - Secuencia REF-012 y REF-061.
 *    - "el anterior" resuelve REF-012 (110 m², no 55 m²).
 *    - "la propiedad que te pasé antes" resuelve precio de REF-012.
 *    - "el apartamento de La Candelaria" resuelve REF-061 por zona.
 *    - "el otro apartamento" resuelve REF-012.
 *    - Ambigüedad detectada correctamente cuando solo hay 1 inmueble.
 * 5. Búsqueda por zona Caracas general vs zona específica inexistente.
 * 6. Deduplicación determinística de alertas y aislamiento absoluto del cliente.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const {
  evaluateCentralDecisionPipeline,
  searchZoneOrFeatureMatches,
  buildStructuredZoneSearchResults,
  resolvePropertyFromHistoryOrContext,
  extractRequestedZone,
  extractPropertyPrice,
  extractPropertyMetraje,
  extractPropertyZone,
  buildConfirmedPropertyAvailabilityResponse,
  ConversationContextManager,
  HandoffManager,
  AVAILABILITY_RESPONSE
} = require('../pipeline_decision');

const { defaultAlertManager, UnregisteredLinkAlertManager } = require('../lib/unregistered_link_alert');
const { getAvailableProperties } = require('../server');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Error: ${err.message}`);
    if (err.stack) {
      const relevantStack = err.stack.split('\n').slice(1, 3).join('\n');
      console.error(`     ${relevantStack}`);
    }
  }
}

async function runAsyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Error: ${err.message}`);
    if (err.stack) {
      const relevantStack = err.stack.split('\n').slice(1, 3).join('\n');
      console.error(`     ${relevantStack}`);
    }
  }
}

async function main() {
  console.log('==============================================================================');
  console.log('   SUITE FASE 2: RESOLUCIÓN UNIVERSAL Y LÓGICA COMERCIAL V5.1 (DEPRO TECH)     ');
  console.log('==============================================================================\n');

  // Cargar propiedades reales del inventario oficial de Google Sheets
  const realProperties = await getAvailableProperties();
  console.log(`Inventario cargado: ${realProperties.length} propiedades reales verificadas.\n`);

  defaultAlertManager.clear();

  // --------------------------------------------------------------------------
  // GRUPO 1: CASO REF-061 Y JERARQUÍA DE VERDAD COMERCIAL
  // --------------------------------------------------------------------------
  console.log('--- Grupo 1: Caso REF-061 y Jerarquía Comercial ---');

  await runAsyncTest('REF-061: Enlace MLS Caracas entrante resuelve por ID numérico 10539723', async () => {
    const userText = 'Hola, buenas tardes. ¿Está disponible este apartamento? https://mlscaracas.com/apartamento-alquiler-la-candelaria-caracas/10539723';
    const res = await evaluateCentralDecisionPipeline({
      userText,
      leadId: 'lead_ref061_01',
      talkId: 'talk_ref061_01',
      properties: realProperties
    });

    assert.strictEqual(res.shouldRespond, true, 'Debe responder al cliente');
    assert.strictEqual(res.log.propertyIdentified, 'REF-061', 'Debe identificar inequívocamente REF-061');
    assert.ok(res.text.includes('La Candelaria'), 'Debe mencionar la zona La Candelaria');
    assert.ok(res.text.includes('55 m²'), 'Debe mencionar el metraje oficial de 55 m²');
    assert.ok(res.text.includes('alquiler'), 'Prevalece Alquiler como operación comercial');
    assert.ok(!res.text.includes('venta'), 'Prohibido indicar venta si la operación oficial es Alquiler');
  });

  await runAsyncTest('REF-061: Genera alerta interna para Robert (Escenario A) sugiriendo columna "MLS Caracas"', async () => {
    const alert = defaultAlertManager.generateAlert({
      scenario: 'MATCHED_UNREGISTERED',
      url: 'https://mlscaracas.com/apartamento-alquiler-la-candelaria-caracas/10539723',
      publicationCode: '10539723',
      leadId: 'lead_ref061_01',
      talkId: 'talk_ref061_01',
      propertyId: 'REF-061',
      suggestedColumnName: 'MLS Caracas'
    });

    assert.ok(alert && !alert.isDuplicate, 'Debe generar alerta nueva no duplicada');
    assert.ok(alert.alertText.includes('Robert:'), 'Debe iniciar con Robert:');
    assert.ok(alert.alertText.includes('MLS Caracas'), 'Debe identificar el portal MLS Caracas');
    assert.ok(alert.alertText.includes('10539723'), 'Debe incluir el código de publicación');
    assert.ok(alert.alertText.includes('REF-061'), 'Debe asociar a REF-061');
    assert.ok(alert.alertText.includes('"MLS Caracas"'), 'Debe sugerir incorporar la columna');
  });

  // --------------------------------------------------------------------------
  // GRUPO 2: CASO JUAN PABLO II (INCIDENTE RANDAL HERRERA)
  // --------------------------------------------------------------------------
  console.log('\n--- Grupo 2: Caso Juan Pablo II (Randal Herrera) ---');

  runTest('extractRequestedZone extrae "juan pablo ii" sintácticamente de la consulta real', () => {
    const query = 'Hola. Excelente día. Espero estés bien. ¿Hay información de apartamento en venta en Juan Pablo II? Atento. Gracias';
    const zone = extractRequestedZone(query, realProperties);
    assert.strictEqual(zone, 'juan pablo ii', 'Debe extraer exactamente "juan pablo ii"');
  });

  runTest('searchZoneOrFeatureMatches retorna 0 candidatos y hasAvailableMatches: false para Juan Pablo II', () => {
    const query = 'Hola. Excelente día. Espero estés bien. ¿Hay información de apartamento en venta en Juan Pablo II? Atento. Gracias';
    const searchRes = searchZoneOrFeatureMatches(query, realProperties);
    assert.strictEqual(searchRes.hasAvailableMatches, false, 'No debe reportar disponibilidad');
    assert.strictEqual(searchRes.count, 0, 'No debe haber coincidencias');
    assert.strictEqual(searchRes.candidates.length, 0, 'Candidatos debe estar vacío');
    assert.strictEqual(searchRes.targetZone, 'juan pablo ii', 'targetZone debe ser juan pablo ii');
  });

  await runAsyncTest('Incidente Randal Herrera: Pipeline informa ausencia educada, CERO "sí, disponible", CERO otras zonas', async () => {
    const query = 'Hola. Excelente día. Espero estés bien. ¿Hay información de apartamento en venta en Juan Pablo II? Atento. Gracias';
    const res = await evaluateCentralDecisionPipeline({
      userText: query,
      leadId: 'lead_randal_01',
      talkId: 'talk_randal_01',
      properties: realProperties
    });

    assert.strictEqual(res.shouldRespond, true, 'Debe responder educadamente al cliente');
    assert.strictEqual(res.log.typeDetected, 'ZONE_SEARCH_NO_MATCH', 'Tipo detectado debe ser ZONE_SEARCH_NO_MATCH');
    assert.strictEqual(res.log.action, 'RESPOND', 'Acción debe ser RESPOND con ausencia');
    assert.ok(!res.text.includes('sí, disponible'), 'ESTRICTAMENTE PROHIBIDO responder "sí, disponible"');
    assert.ok(!res.text.includes(AVAILABILITY_RESPONSE), 'ESTRICTAMENTE PROHIBIDO emitir respuesta genérica AVAILABILITY_RESPONSE');
    assert.ok(res.text.includes('JUAN PABLO II'), 'Debe mencionar que no se dispone en Juan Pablo II');
    assert.ok(res.text.includes('no disponemos de inmuebles'), 'Debe comunicar que no se dispone de inmuebles disponibles');
    assert.ok(!res.text.includes('Los Samanes'), 'Prohibido enviar inmuebles de Los Samanes');
    assert.ok(!res.text.includes('Prados del Este'), 'Prohibido enviar inmuebles de Prados del Este');
  });

  // --------------------------------------------------------------------------
  // GRUPO 3: ENLACE NO REGISTRADO ESCENARIO B (SIN COINCIDENCIA)
  // --------------------------------------------------------------------------
  console.log('\n--- Grupo 3: Enlace No Registrado Escenario B ---');

  await runAsyncTest('Escenario B: Enlace externo desconocido -> Silencio al cliente y alerta a Robert', async () => {
    const userText = 'Buenas tardes, me interesa este apartamento https://mlscaracas.com/apartamento-venta-chacao/99999999';
    const res = await evaluateCentralDecisionPipeline({
      userText,
      leadId: 'lead_unknown_link_01',
      talkId: 'talk_unknown_link_01',
      properties: realProperties
    });

    assert.strictEqual(res.shouldRespond, false, 'Prohibido responder al cliente (silencio seguro)');
    assert.strictEqual(res.text, null, 'Texto para cliente debe ser null');
    assert.strictEqual(res.log.action, 'SILENCE', 'Acción debe ser SILENCE');
    assert.ok(res.log.robertAlert, 'Debe generar alerta interna para Robert');
    assert.ok(res.log.robertAlert.includes('MLS Caracas'), 'Alerta debe identificar MLS Caracas');
    assert.ok(res.log.robertAlert.includes('99999999'), 'Alerta debe incluir código 99999999');
    assert.ok(res.log.robertAlert.includes('no coincide con ninguna propiedad'), 'Alerta debe indicar Escenario B');
  });

  // --------------------------------------------------------------------------
  // GRUPO 4: HISTORIAL MULTIPROPIEDAD EN LA MISMA CONVERSACIÓN
  // --------------------------------------------------------------------------
  console.log('\n--- Grupo 4: Historial Multipropiedad en la Misma Conversación ---');

  const testContextManager = new ConversationContextManager();
  const multiTalkId = 'talk_multi_session_01';
  const multiLeadId = 'lead_multi_session_01';

  await runAsyncTest('Multipropiedad Turno 1: Cliente envía REF-012 (Los Samanes, Venta, 110 m²)', async () => {
    const res1 = await evaluateCentralDecisionPipeline({
      userText: 'Hola me interesa este apartamento https://info.wasi.co/apartamento-venta-los-samanes-caracas/10493109',
      talkId: multiTalkId,
      leadId: multiLeadId,
      properties: realProperties,
      contextManager: testContextManager
    });

    assert.strictEqual(res1.shouldRespond, true);
    assert.strictEqual(res1.log.propertyIdentified, 'REF-012');
    assert.ok(res1.text.includes('Los Samanes'));
  });

  await runAsyncTest('Multipropiedad Turno 2: Cliente envía REF-061 (La Candelaria, Alquiler, 55 m²)', async () => {
    const res2 = await evaluateCentralDecisionPipeline({
      userText: 'Y también vi este otro apartamento https://mlscaracas.com/apartamento-alquiler-la-candelaria-caracas/10539723',
      talkId: multiTalkId,
      leadId: multiLeadId,
      properties: realProperties,
      contextManager: testContextManager
    });

    assert.strictEqual(res2.shouldRespond, true);
    assert.strictEqual(res2.log.propertyIdentified, 'REF-061');
    assert.ok(res2.text.includes('La Candelaria'));
  });

  await runAsyncTest('Multipropiedad Turno 3: "¿Cuántos metros tiene el anterior?" -> Resuelve REF-012 (110 m², no 55 m²)', async () => {
    const res3 = await evaluateCentralDecisionPipeline({
      userText: '¿Cuántos metros tiene el anterior?',
      talkId: multiTalkId,
      leadId: multiLeadId,
      properties: realProperties,
      contextManager: testContextManager
    });

    assert.strictEqual(res3.shouldRespond, true);
    assert.strictEqual(res3.log.propertyIdentified, 'REF-012', 'Debe resolver REF-012 (el anterior)');
    assert.ok(res3.text.includes('110 m²'), 'Debe responder 110 m² de REF-012');
    assert.ok(!res3.text.includes('55 m²'), 'PROHIBIDO responder 55 m² de REF-061');
  });

  await runAsyncTest('Multipropiedad Turno 4: "¿Cuánto cuesta la propiedad que te pasé antes?" -> Resuelve precio de REF-012', async () => {
    const res4 = await evaluateCentralDecisionPipeline({
      userText: '¿Cuánto cuesta la propiedad que te pasé antes?',
      talkId: multiTalkId,
      leadId: multiLeadId,
      properties: realProperties,
      contextManager: testContextManager
    });

    assert.strictEqual(res4.shouldRespond, true);
    assert.strictEqual(res4.log.propertyIdentified, 'REF-012');
    assert.ok(res4.text.includes('146.000') || res4.text.includes('150.000'), 'Debe responder precio de REF-012');
    assert.ok(!res4.text.includes('500'), 'PROHIBIDO responder canon de 500 de REF-061');
  });

  await runAsyncTest('Multipropiedad Turno 5: "¿Tiene estacionamiento el apartamento de La Candelaria?" -> Resuelve REF-061 por zona', async () => {
    const res5 = await evaluateCentralDecisionPipeline({
      userText: '¿Tiene estacionamiento el apartamento de La Candelaria?',
      talkId: multiTalkId,
      leadId: multiLeadId,
      properties: realProperties,
      contextManager: testContextManager
    });

    assert.strictEqual(res5.shouldRespond, true);
    assert.strictEqual(res5.log.propertyIdentified, 'REF-061');
    assert.ok(res5.text.includes('No posee puesto propio') || res5.text.includes('alquiler a media cuadra'), 'Debe responder el dato exacto de estacionamiento de REF-061');
  });

  await runAsyncTest('Multipropiedad Turno 6: "¿El otro apartamento es en venta o alquiler?" -> Resuelve el otro inmueble', async () => {
    const res6 = await evaluateCentralDecisionPipeline({
      userText: '¿El otro apartamento es en venta o alquiler?',
      talkId: multiTalkId,
      leadId: multiLeadId,
      properties: realProperties,
      contextManager: testContextManager
    });

    assert.strictEqual(res6.shouldRespond, true);
    assert.strictEqual(res6.log.propertyIdentified, 'REF-012');
    assert.ok(res6.text.toLowerCase().includes('venta'), 'El otro apartamento es en venta');
  });

  await runAsyncTest('Multipropiedad Turno 7: Pregunta por "el anterior" cuando solo hay 1 inmueble -> Ambigüedad y silencio seguro', async () => {
    const singleManager = new ConversationContextManager();
    const sTalk = 'talk_single_01';
    const sLead = 'lead_single_01';
    singleManager.saveContext(sTalk, sLead, realProperties.find(p => p.ID_PROPIEDAD === 'REF-012'));

    const res7 = await evaluateCentralDecisionPipeline({
      userText: '¿Cuántos metros tiene el anterior?',
      talkId: sTalk,
      leadId: sLead,
      properties: realProperties,
      contextManager: singleManager
    });

    assert.strictEqual(res7.shouldRespond, false, 'No hay anterior; debe guardar silencio seguro');
    assert.strictEqual(res7.log.action, 'SILENCE');
    assert.strictEqual(res7.log.diagnosticCode, 'PROPERTY_MATCH_AMBIGUOUS');
  });

  // --------------------------------------------------------------------------
  // GRUPO 5: BÚSQUEDA POR ZONA GENERAL VS ZONA ESPECÍFICA
  // --------------------------------------------------------------------------
  console.log('\n--- Grupo 5: Búsqueda General vs Específica ---');

  runTest('Búsqueda por Caracas general encuentra opciones del inventario', () => {
    const resCaracas = searchZoneOrFeatureMatches('¿Qué apartamentos tienen en Caracas?', realProperties);
    assert.strictEqual(resCaracas.hasAvailableMatches, true, 'Caracas debe retornar opciones');
    assert.ok(resCaracas.candidates.length > 0, 'Debe haber candidatos');
  });

  runTest('Búsqueda por zona inexistente ("Caricuao") no devuelve propiedades de otras zonas', () => {
    const resCaricuao = searchZoneOrFeatureMatches('¿Tienen apartamento en venta en Caricuao?', realProperties);
    assert.strictEqual(resCaricuao.hasAvailableMatches, false, 'No debe retornar disponibilidad');
    assert.strictEqual(resCaricuao.candidates.length, 0, 'Candidatos debe estar vacío');
    assert.strictEqual(resCaricuao.targetZone, 'caricuao');
  });

  // --------------------------------------------------------------------------
  // GRUPO 6: DEDUPLICACIÓN DE ALERTAS INTERNAS
  // --------------------------------------------------------------------------
  console.log('\n--- Grupo 6: Deduplicación y Aislamiento de Alertas ---');

  runTest('Deduplicación: No emite alertas idénticas repetidas para el mismo lead y URL', () => {
    const alertMgr = new UnregisteredLinkAlertManager();
    const a1 = alertMgr.generateAlert({
      scenario: 'UNMATCHED_LINK',
      url: 'https://mlscaracas.com/inmueble/12345',
      publicationCode: '12345',
      leadId: 'lead_dedup_01',
      suggestedColumnName: 'MLS Caracas'
    });
    assert.strictEqual(a1.isDuplicate, false);
    assert.ok(a1.alertText);

    const a2 = alertMgr.generateAlert({
      scenario: 'UNMATCHED_LINK',
      url: 'https://mlscaracas.com/inmueble/12345',
      publicationCode: '12345',
      leadId: 'lead_dedup_01',
      suggestedColumnName: 'MLS Caracas'
    });
    assert.strictEqual(a2.isDuplicate, true);
    assert.strictEqual(a2.alertText, null);
  });

  console.log('\n==============================================================================');
  console.log(`RESUMEN FASE 2: ${passedTests} / ${totalTests} PRUEBAS SUPERADAS (${Math.round((passedTests / totalTests) * 100)}%)`);
  console.log('==============================================================================\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal Suite Error:', err);
  process.exit(1);
});
