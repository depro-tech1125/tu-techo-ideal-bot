/**
 * SUITE DE PRUEBAS DE RESOLUCIÓN INTELIGENTE DE PROPIEDADES MULTIPORTAL
 * Tu Techo Ideal V5.0 — 20 Escenarios Obligatorios y Caso Principal Dayana Maldonado
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const {
  evaluateCentralDecisionPipeline,
  HandoffManager,
  ConversationContextManager,
  extractDeterministicPropertyFeature,
  classifyOutgoingMessage
} = require('../pipeline_decision');

const {
  extractMultiportalPropertyIdentifiers,
  cleanUrlForMatching,
  parseAndNormalizeUrl,
  checkSlugContradiction
} = require('../lib/multiportal_extractor');

const {
  IdempotencyManager
} = require('../lib/idempotency_manager');

async function runMultiportalSuite() {
  console.log('================================================================');
  console.log(' SUITE DE PRUEBAS: RESOLUCIÓN INTELIGENTE MULTIPORTAL V5.0     ');
  console.log('         (20 Escenarios Obligatorios + Caso Dayana)            ');
  console.log('================================================================\n');

  let passed = 0;
  const total = 20;

  // Cargar propiedades reales del caché
  const propertiesPath = path.join(__dirname, '..', 'properties_cache.json');
  const properties = JSON.parse(fs.readFileSync(propertiesPath, 'utf8'));

  const testHandoffFile = path.join(__dirname, 'temp_test_handoffs_multiportal.json');
  if (fs.existsSync(testHandoffFile)) fs.unlinkSync(testHandoffFile);
  const handoffManager = new HandoffManager(testHandoffFile);
  const contextManager = new ConversationContextManager();

  const testIdempDir = path.join(__dirname, 'temp_test_idemp_multiportal');
  if (fs.existsSync(testIdempDir)) fs.rmSync(testIdempDir, { recursive: true, force: true });
  const idempotencyManager = new IdempotencyManager(testIdempDir);

  const ref007 = properties.find(p => p.ID_PROPIEDAD === 'REF-007');
  assert(ref007, 'REF-007 debe existir en el catálogo');

  // ==========================================================================
  // ESCENARIO 1 (CASO DE ACEPTACIÓN PRINCIPAL - DAYANA MALDONADO):
  // Cliente envía enlace MLSCaracas y coincide con Wasi -> REF-007
  // ==========================================================================
  const urlDayana = 'https://mlscaracas.com/apartamento-venta-los-palos-grandes-caracas/10441563';
  const res1 = await evaluateCentralDecisionPipeline({
    userText: urlDayana,
    leadId: 'lead_dayana_01',
    talkId: 'talk_dayana_01',
    properties,
    handoffManager,
    contextManager
  });

  const isRes1Ok = res1.shouldRespond &&
    res1.targetProperty?.ID_PROPIEDAD === 'REF-007' &&
    res1.targetProperty?.CODIGO_WASI === '10441563' &&
    res1.targetProperty?.ESTATUS === 'Disponible' &&
    res1.log.propertyIdentified === 'REF-007' &&
    (res1.log.matchLevel === 'PROPERTY_MATCH_EXACT' || res1.log.diagnosticCode === 'PROPERTY_MATCH_EXACT');

  if (isRes1Ok) {
    console.log('✅ [PASS 1/20] Cliente envía enlace MLSCaracas -> Reconoce REF-007 (Nivel 1 Exacto por ID Wasi 10441563 y slug coincidente).');
    passed++;
  } else {
    console.error('❌ [FAIL 1/20] Falló reconocimiento de MLSCaracas para REF-007:', res1);
  }

  // ==========================================================================
  // ESCENARIO 2: Cliente envía enlace Wasi directamente
  // ==========================================================================
  const urlWasi = 'https://info.wasi.co/apartamento-venta-los-palos-grandes-caracas/10441563';
  const res2 = await evaluateCentralDecisionPipeline({
    userText: urlWasi,
    leadId: 'lead_wasi_02',
    talkId: 'talk_wasi_02',
    properties,
    handoffManager,
    contextManager
  });

  if (res2.shouldRespond && res2.targetProperty?.ID_PROPIEDAD === 'REF-007') {
    console.log('✅ [PASS 2/20] Cliente envía enlace Wasi directamente -> Reconoce REF-007 y responde disponibilidad.');
    passed++;
  } else {
    console.error('❌ [FAIL 2/20] Falló enlace Wasi directo:', res2);
  }

  // ==========================================================================
  // ESCENARIO 3: Cliente envía enlace Mercado Libre
  // ==========================================================================
  const urlMl = 'https://apartamento.mercadolibre.com.ve/MLV-781814053';
  const res3 = await evaluateCentralDecisionPipeline({
    userText: urlMl,
    leadId: 'lead_ml_03',
    talkId: 'talk_ml_03',
    properties,
    handoffManager,
    contextManager
  });

  if (res3.shouldRespond && res3.targetProperty?.ID_PROPIEDAD === 'REF-007') {
    console.log('✅ [PASS 3/20] Cliente envía enlace Mercado Libre -> Reconoce REF-007 (MLV-781814053).');
    passed++;
  } else {
    console.error('❌ [FAIL 3/20] Falló enlace Mercado Libre:', res3);
  }

  // ==========================================================================
  // ESCENARIO 4: Cliente envía enlace Rexup
  // ==========================================================================
  const urlRexup = 'https://www.rexup.net/AAAAAAA/ver_inmueble_c.php?cod_inmueble=5185901613';
  const res4 = await evaluateCentralDecisionPipeline({
    userText: urlRexup,
    leadId: 'lead_rexup_04',
    talkId: 'talk_rexup_04',
    properties,
    handoffManager,
    contextManager
  });

  if (res4.shouldRespond && res4.targetProperty?.ID_PROPIEDAD === 'REF-007') {
    console.log('✅ [PASS 4/20] Cliente envía enlace Rexup -> Reconoce REF-007 (cod_inmueble=5185901613).');
    passed++;
  } else {
    console.error('❌ [FAIL 4/20] Falló enlace Rexup:', res4);
  }

  // ==========================================================================
  // ESCENARIO 5: Cliente envía enlace de la página web propia
  // ==========================================================================
  const urlWeb = 'https://tutechoideal.com/inmuebles/apartamento-en-los-palos-grandes/';
  const res5 = await evaluateCentralDecisionPipeline({
    userText: urlWeb,
    leadId: 'lead_web_05',
    talkId: 'talk_web_05',
    properties,
    handoffManager,
    contextManager
  });

  if (res5.shouldRespond && res5.targetProperty?.ID_PROPIEDAD === 'REF-007') {
    console.log('✅ [PASS 5/20] Cliente envía enlace de página web propia -> Reconoce REF-007 por slug web.');
    passed++;
  } else {
    console.error('❌ [FAIL 5/20] Falló enlace de página web propia:', res5);
  }

  // ==========================================================================
  // ESCENARIO 6: Cliente envía enlace de dominio desconocido con ID exacto y slug coincidente
  // ==========================================================================
  const urlUnknownPortal = 'https://tuinmuebleonlinecaracas.com.ve/apartamento-venta-los-palos-grandes-caracas/10441563';
  const res6 = await evaluateCentralDecisionPipeline({
    userText: urlUnknownPortal,
    leadId: 'lead_unk_06',
    talkId: 'talk_unk_06',
    properties,
    handoffManager,
    contextManager
  });

  if (res6.shouldRespond && res6.targetProperty?.ID_PROPIEDAD === 'REF-007') {
    console.log('✅ [PASS 6/20] Dominio desconocido con ID y slug coincidente -> Reconoce REF-007 sin importar el dominio.');
    passed++;
  } else {
    console.error('❌ [FAIL 6/20] Falló dominio desconocido coincidente:', res6);
  }

  // ==========================================================================
  // ESCENARIO 7: Cliente envía URL con parámetros de seguimiento
  // ==========================================================================
  const urlTracking = 'https://mlscaracas.com/apartamento-venta-los-palos-grandes-caracas/10441563?utm_source=facebook&utm_medium=cpc&fbclid=IwAR2...&gclid=123#photo-gallery';
  const res7 = await evaluateCentralDecisionPipeline({
    userText: urlTracking,
    leadId: 'lead_track_07',
    talkId: 'talk_track_07',
    properties,
    handoffManager,
    contextManager
  });

  if (res7.shouldRespond && res7.targetProperty?.ID_PROPIEDAD === 'REF-007') {
    console.log('✅ [PASS 7/20] URL con tracking y hash (#photo-gallery) -> Normalizada y reconocida como REF-007.');
    passed++;
  } else {
    console.error('❌ [FAIL 7/20] Falló normalización con tracking:', res7);
  }

  // ==========================================================================
  // ESCENARIO 8: Propiedad disponible -> Respuesta comercial oficial
  // ==========================================================================
  if (res1.shouldRespond && res1.text === 'Bienvenido a Tu Techo Ideal, sí, disponible.') {
    console.log('✅ [PASS 8/20] Propiedad disponible (ESTATUS: Disponible) -> Responde bienvenida comercial oficial.');
    passed++;
  } else {
    console.error('❌ [FAIL 8/20] Falló respuesta comercial de disponible:', res1.text);
  }

  // ==========================================================================
  // ESCENARIO 9: Propiedad no disponible -> Informa honestamente que no se encuentra disponible
  // ==========================================================================
  const mockProperties = JSON.parse(JSON.stringify(properties));
  const mockRef007NoAvail = mockProperties.find(p => p.ID_PROPIEDAD === 'REF-007');
  mockRef007NoAvail.ESTATUS = 'No Disponible';

  const res9 = await evaluateCentralDecisionPipeline({
    userText: urlDayana,
    leadId: 'lead_noavail_09',
    talkId: 'talk_noavail_09',
    properties: mockProperties,
    handoffManager,
    contextManager
  });

  if (res9.shouldRespond && res9.text === 'El inmueble consultado no se encuentra disponible actualmente.' && (res9.log.typeDetected === 'PROPERTY_LINK_NOT_AVAILABLE' || res9.log.diagnosticCode === 'PROPERTY_STATUS_UNAVAILABLE')) {
    console.log('✅ [PASS 9/20] Propiedad no disponible -> Informa honestamente: "El inmueble consultado no se encuentra disponible actualmente."');
    passed++;
  } else {
    console.error('❌ [FAIL 9/20] Falló respuesta de no disponible:', res9);
  }

  // ==========================================================================
  // ESCENARIO 10: Enlace inexistente -> Silencio absoluto (CERO invención)
  // ==========================================================================
  const urlFake = 'https://mlscaracas.com/inmueble-falso-en-caracas/99999999';
  const res10 = await evaluateCentralDecisionPipeline({
    userText: urlFake,
    leadId: 'lead_fake_10',
    talkId: 'talk_fake_10',
    properties,
    handoffManager,
    contextManager
  });

  if (!res10.shouldRespond && res10.text === null && (res10.log.typeDetected === 'PROPERTY_NOT_FOUND' || res10.log.typeDetected === 'WASI_LINK_NOT_FOUND')) {
    console.log('✅ [PASS 10/20] Enlace inexistente (99999999) -> Silencio absoluto sin inventar (PROPERTY_NOT_FOUND).');
    passed++;
  } else {
    console.error('❌ [FAIL 10/20] Enlace inexistente generó respuesta indebida:', res10);
  }

  // ==========================================================================
  // ESCENARIO 11: Dos propiedades tienen precios similares -> NO coincidir solo por precio
  // ==========================================================================
  const res11 = await evaluateCentralDecisionPipeline({
    userText: 'Hola, vi una propiedad que cuesta $130.000',
    leadId: 'lead_price_11',
    talkId: 'talk_price_11',
    properties,
    handoffManager,
    contextManager
  });

  if (!res11.shouldRespond && res11.targetProperty === undefined) {
    console.log('✅ [PASS 11/20] Consulta solo por precio ($130.000) -> Prohibido asociar por precio aislado (CERO falsa coincidencia).');
    passed++;
  } else {
    console.error('❌ [FAIL 11/20] Se asoció propiedad indebidamente por precio:', res11);
  }

  // ==========================================================================
  // ESCENARIO 12: Dos propiedades tienen metrajes similares -> NO coincidir solo por metraje
  // ==========================================================================
  const res12 = await evaluateCentralDecisionPipeline({
    userText: 'Busco la que mide 106,43 m2',
    leadId: 'lead_metraje_12',
    talkId: 'talk_metraje_12',
    properties,
    handoffManager,
    contextManager
  });

  if (!res12.shouldRespond && res12.targetProperty === undefined) {
    console.log('✅ [PASS 12/20] Consulta solo por metraje (106,43 m²) -> Prohibido asociar por metraje aislado.');
    passed++;
  } else {
    console.error('❌ [FAIL 12/20] Se asoció propiedad indebidamente por metraje:', res12);
  }

  // ==========================================================================
  // ESCENARIO 13: Identificador coincidente pero slug contradictorio -> Rechazo/Ambiguo
  // ==========================================================================
  const urlContradiction = 'https://mlscaracas.com/galpon-alquiler-maracaibo/10441563';
  const extractionContra = extractMultiportalPropertyIdentifiers(urlContradiction, properties);
  const res13 = await evaluateCentralDecisionPipeline({
    userText: urlContradiction,
    leadId: 'lead_contra_13',
    talkId: 'talk_contra_13',
    properties,
    handoffManager,
    contextManager
  });

  if (!res13.shouldRespond && (res13.log.typeDetected === 'PROPERTY_MATCH_AMBIGUOUS' || res13.log.typeDetected === 'PROPERTY_NOT_FOUND')) {
    console.log('✅ [PASS 13/20] ID 10441563 con slug contradictorio ("galpón alquiler Maracaibo") -> Rechazado por conflicto flagrante de tipo/operación/ciudad.');
    passed++;
  } else {
    console.error('❌ [FAIL 13/20] Falló rechazo de slug contradictorio:', res13, extractionContra);
  }

  // ==========================================================================
  // ESCENARIO 14: Coincidencia ambigua entre dos inmuebles -> Derivado a humano
  // ==========================================================================
  const multiUrlText = `${urlDayana} y también me gustó esta otra https://info.wasi.co/casa-alquiler-alta-florida-caracas/10466376`;
  const res14 = await evaluateCentralDecisionPipeline({
    userText: multiUrlText,
    leadId: 'lead_multi_14',
    talkId: 'talk_multi_14',
    properties,
    handoffManager,
    contextManager
  });

  if (!res14.shouldRespond && (res14.log.typeDetected === 'MULTIPLE_PROPERTIES' || res14.log.typeDetected === 'PROPERTY_MATCH_AMBIGUOUS')) {
    console.log('✅ [PASS 14/20] Coincidencia de dos inmuebles en el mismo mensaje -> Silencio y derivado a humano sin mezclar fichas.');
    passed++;
  } else {
    console.error('❌ [FAIL 14/20] Falló manejo de coincidencia múltiple:', res14);
  }

  // ==========================================================================
  // ESCENARIO 15: Solicitud de fotografías de REF-007 -> LINK_FOTOS directo de Rexup
  // ==========================================================================
  const res15 = await evaluateCentralDecisionPipeline({
    userText: '¿Me puedes compartir fotografías de la propiedad?',
    leadId: 'lead_dayana_01',
    talkId: 'talk_dayana_01',
    properties,
    handoffManager,
    contextManager
  });

  const isFotosOk = res15.shouldRespond &&
    res15.text.includes('https://www.rexup.net/AAAAAAA/ver_inmueble_c.php?cod_inmueble=5185901613') &&
    !res15.text.includes('kommo.cc') &&
    !res15.text.includes('mlscaracas.com');

  if (isFotosOk) {
    console.log('✅ [PASS 15/20] Solicitud de fotografías -> Entrega directa de LINK_FOTOS de Rexup (5185901613) sin acortadores ni links ajenos.');
    passed++;
  } else {
    console.error('❌ [FAIL 15/20] Falló entrega de fotos:', res15);
  }

  // ==========================================================================
  // ESCENARIO 16: Solicitud de precio de REF-007 -> Determinista "$130.000"
  // ==========================================================================
  const res16 = await evaluateCentralDecisionPipeline({
    userText: '¿Cuál es el precio de venta?',
    leadId: 'lead_dayana_01',
    talkId: 'talk_dayana_01',
    properties,
    handoffManager,
    contextManager
  });

  if (res16.shouldRespond && res16.text === '$130.000') {
    console.log('✅ [PASS 16/20] Solicitud de precio de REF-007 -> Responde determinista "$130.000" extraído exactamente de Sheets.');
    passed++;
  } else {
    console.error('❌ [FAIL 16/20] Falló respuesta de precio para REF-007:', res16);
  }

  // ==========================================================================
  // ESCENARIO 17: Mensaje durante Human Lock -> Silencio absoluto (HUMAN_LOCK_ACTIVE)
  // ==========================================================================
  handoffManager.recordHumanIntervention('lead_locked_17', 'talk_locked_17', 'contact_17', Date.now());
  const res17 = await evaluateCentralDecisionPipeline({
    userText: 'Hola, ¿sigue disponible?',
    leadId: 'lead_locked_17',
    talkId: 'talk_locked_17',
    properties,
    handoffManager,
    contextManager
  });

  if (!res17.shouldRespond && (res17.log.typeDetected === 'HUMAN_LOCKED' || res17.log.diagnosticCode === 'HUMAN_LOCK_ACTIVE')) {
    console.log('✅ [PASS 17/20] Mensaje durante Human Lock activo -> Silencio absoluto respetando las 12 horas del asesor.');
    passed++;
  } else {
    console.error('❌ [FAIL 17/20] Mensaje durante Human Lock no fue silenciado:', res17);
  }

  // ==========================================================================
  // ESCENARIO 18: Nota interna de Kommo -> Excluida (INTERNAL_NOTE_IGNORED)
  // ==========================================================================
  const internalNote = {
    type: 'note',
    is_internal: true,
    element_type: 'note',
    text: 'Nota para el asesor: cliente Dayana contactó por MLS'
  };
  const noteClass = classifyOutgoingMessage(internalNote);

  if (noteClass.isInternalNote && noteClass.diagnosticCode === 'INTERNAL_NOTE_IGNORED') {
    console.log('✅ [PASS 18/20] Nota interna en Kommo -> Identificada como INTERNAL_NOTE_IGNORED (Cero respuestas, Cero bloqueo).');
    passed++;
  } else {
    console.error('❌ [FAIL 18/20] Nota interna no fue clasificada con INTERNAL_NOTE_IGNORED:', noteClass);
  }

  // ==========================================================================
  // ESCENARIO 19: Mensaje repetido -> Idempotencia DUPLICATE_EVENT / ALREADY_SENT
  // ==========================================================================
  const msgKey = 'msg_dayana_dup_test';
  const lock1 = idempotencyManager.acquireLock(msgKey, 'talk_dup', 'lead_dup');
  idempotencyManager.markSent(msgKey, 'Bienvenido a Tu Techo Ideal, sí, disponible.');
  const lock2 = idempotencyManager.acquireLock(msgKey, 'talk_dup', 'lead_dup');

  if (lock1.allowed && !lock2.allowed && lock2.reason === 'ALREADY_SENT') {
    console.log('✅ [PASS 19/20] Mensaje repetido recibido -> Bloqueado atómicamente por IdempotencyManager (ALREADY_SENT).');
    passed++;
  } else {
    console.error('❌ [FAIL 19/20] Falló deduplicación de mensaje:', lock1, lock2);
  }

  // ==========================================================================
  // ESCENARIO 20: Intervención manual del asesor -> Inicia Human Lock de 12 horas
  // ==========================================================================
  const advisorMessage = {
    type: 'outgoing',
    author: { type: 'user', name: 'Rebeca Roo' },
    text: 'Hola Dayana, con gusto te muestro el apartamento en Los Palos Grandes.'
  };
  const advisorClass = classifyOutgoingMessage(advisorMessage, () => false);

  if (advisorClass.isHumanAdvisor) {
    handoffManager.recordHumanIntervention('lead_adv_20', 'talk_adv_20', 'contact_adv_20', Date.now());
    const lockCheck = await handoffManager.checkLockStatus('lead_adv_20', 'talk_adv_20', 'contact_adv_20', Date.now());
    if (lockCheck.isLocked && lockCheck.hoursElapsed < 1) {
      console.log('✅ [PASS 20/20] Intervención manual de asesora Rebeca Roo -> Activa Human Lock de 12 horas.');
      passed++;
    } else {
      console.error('❌ [FAIL 20/20] LockCheck falló tras intervención de asesor:', lockCheck);
    }
  } else {
    console.error('❌ [FAIL 20/20] Mensaje de asesor no fue reconocido:', advisorClass);
  }

  // ==========================================================================
  // VERIFICACIÓN DEL CASO DE ACEPTACIÓN PRINCIPAL: DAYANA MALDONADO / REF-007
  // ==========================================================================
  console.log('\n----------------------------------------------------------------');
  console.log(' CASO DE ACEPTACIÓN PRINCIPAL: DAYANA MALDONADO (REF-007)       ');
  console.log('----------------------------------------------------------------');
  const metrajeFeature = extractDeterministicPropertyFeature('¿Cuántos metros tiene?', ref007);
  const priceFeature = extractDeterministicPropertyFeature('¿Cuál es el precio?', ref007);

  console.log('1. Resolución de REF-007:                ', res1.targetProperty?.ID_PROPIEDAD === 'REF-007' ? '✅ VERIFICADO' : '❌ ERROR');
  console.log('2. Identificación Wasi (10441563):       ', res1.targetProperty?.CODIGO_WASI === '10441563' ? '✅ VERIFICADO' : '❌ ERROR');
  console.log('3. Estatus Disponible en Sheets:         ', res1.targetProperty?.ESTATUS === 'Disponible' ? '✅ VERIFICADO' : '❌ ERROR');
  console.log('4. Recuperación de Precio ($130.000):    ', priceFeature.answer === '$130.000' ? `✅ VERIFICADO (${priceFeature.answer})` : '❌ ERROR');
  console.log('5. Recuperación de Metraje (106,43 m²):   ', metrajeFeature.answer === 'Tiene 106,43 m²' ? `✅ VERIFICADO (${metrajeFeature.answer})` : '❌ ERROR');
  console.log('6. Respuesta Comercial Correcta:         ', res1.text === 'Bienvenido a Tu Techo Ideal, sí, disponible.' ? `✅ VERIFICADO ("${res1.text}")` : '❌ ERROR');
  console.log('7. Enlace Fotos Directo Rexup:           ', ref007.LINK_FOTOS.includes('cod_inmueble=5185901613') ? `✅ VERIFICADO (${ref007.LINK_FOTOS})` : '❌ ERROR');
  console.log('8. Nivel de Diagnóstico:                 ', res1.log.matchLevel === 'PROPERTY_MATCH_EXACT' || res1.log.diagnosticCode === 'PROPERTY_MATCH_EXACT' ? `✅ VERIFICADO (PROPERTY_MATCH_EXACT)` : '❌ ERROR');

  // Limpiar temporales
  if (fs.existsSync(testHandoffFile)) fs.unlinkSync(testHandoffFile);
  if (fs.existsSync(testIdempDir)) fs.rmSync(testIdempDir, { recursive: true, force: true });

  console.log('\n================================================================');
  console.log(` RESULTADOS FINALES: ${passed} / ${total} PRUEBAS SUPERADAS (${Math.round(passed/total*100)}%)`);
  console.log('================================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runMultiportalSuite().catch(err => {
  console.error('Error fatal en suite multiportal:', err);
  process.exit(1);
});
