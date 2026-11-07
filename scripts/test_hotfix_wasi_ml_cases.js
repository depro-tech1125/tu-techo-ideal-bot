/**
 * SUITE DE PRUEBAS DE REGRESIÓN OBLIGATORIA: HOTFIX WASI Y MERCADO LIBRE V5.1
 * DEPRO TECH SOLUTIONS — TU TECHO IDEAL
 *
 * Casos Obligatorios:
 * CASO 1: Wasi (10493109 / Los Samanes) -> Información comercial, CERO fotos por defecto
 * CASO 2: Consulta de disponibilidad en contexto -> Estatus oficial confirmado
 * CASO 3: Solicitud explícita de fotos -> Enlace Rexup correspondiente
 * CASO 3b: Solicitud de información y fotos -> Información comercial + Enlace Rexup
 * CASO 4: Mercado Libre (MLV-1030682516 y variantes) -> Resuelve REF-021 con datos oficiales
 * CASO 5: Mercado Libre no registrado (MLV-1029979196) -> Cero invención, alerta a Robert, respuesta preventiva
 * CASO 6: Protección contra duplicados -> Idempotencia y CERO despachos duplicados
 * CASO 7: No regresión multicanal -> WhatsApp, Instagram y Messenger
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const {
  evaluateCentralDecisionPipeline,
  HandoffManager,
  ConversationContextManager,
  classifyClientIntent
} = require('../pipeline_decision');

const {
  UniversalIdentifierIndex,
  getGlobalIdentifierIndex
} = require('../lib/universal_identifier_index');

const {
  IdempotencyManager
} = require('../lib/idempotency_manager');

async function runHotfixTests() {
  console.log('==============================================================================');
  console.log(' SUITE DE REGRESIÓN: HOTFIX WASI Y MERCADO LIBRE V5.1                         ');
  console.log('==============================================================================\n');

  const propertiesPath = path.join(__dirname, '..', 'properties_cache.json');
  const properties = JSON.parse(fs.readFileSync(propertiesPath, 'utf8'));

  const testHandoffFile = path.join(__dirname, 'temp_test_handoffs_hotfix.json');
  if (fs.existsSync(testHandoffFile)) fs.unlinkSync(testHandoffFile);
  const handoffManager = new HandoffManager(testHandoffFile);
  const contextManager = new ConversationContextManager();

  const testIdempFile = path.join(__dirname, 'temp_test_idemp_hotfix.json');
  if (fs.existsSync(testIdempFile)) fs.unlinkSync(testIdempFile);
  const idempotencyManager = new IdempotencyManager(testIdempFile);

  let passed = 0;
  let total = 0;

  function testAssert(desc, condition, details = '') {
    total++;
    if (condition) {
      console.log(`✅ [PASS ${total}] ${desc}`);
      passed++;
    } else {
      console.error(`❌ [FAIL ${total}] ${desc} ${details ? '(' + details + ')' : ''}`);
      throw new Error(`Fallo en prueba: ${desc}`);
    }
  }

  // ==========================================================================
  // CASO 1: MENSAJE TIPO WASI (SUSANA MAKKI / REF-012)
  // ==========================================================================
  console.log('--- CASO 1: Mensaje de Wasi con interés o texto automático ---');
  const wasiMessage = `Buen día Robert Jimenez, soy Susana Makki y estoy interesado en el inmueble 10493109 que compartiste en la red inmobiliaria de Wasi. ¿Podríamos conversar y así obtener más información?\nhttps://info.wasi.co/apartamento-venta-los-samanes-caracas/10493109?shared=whatsapp`;

  const res1 = await evaluateCentralDecisionPipeline({
    userText: wasiMessage,
    leadId: 'lead_wasi_susana',
    talkId: 'talk_wasi_susana',
    contactId: '584149991122',
    properties,
    handoffManager,
    contextManager
  });

  testAssert('CASO 1.1: Clasificador no interpreta como solo fotos', classifyClientIntent(wasiMessage) === 'GENERAL_COMMERCIAL_INTEREST');
  testAssert('CASO 1.2: Resuelve REF-012', res1.targetProperty && res1.targetProperty.ID_PROPIEDAD === 'REF-012');
  testAssert('CASO 1.3: Responde disponibilidad e info comercial', res1.shouldRespond && res1.text.includes('Los Samanes') && res1.text.includes('110 m²') && res1.text.includes('146.000'));
  testAssert('CASO 1.4: NO contiene enlace Rexup por defecto', !res1.text.includes('rexup.net'));

  const res1b = await evaluateCentralDecisionPipeline({
    userText: '10493109',
    leadId: 'lead_wasi_code_pure',
    talkId: 'talk_wasi_code_pure',
    contactId: '584149991123',
    properties,
    handoffManager,
    contextManager
  });
  testAssert('CASO 1.5: Entrada por código puro 10493109 da info comercial', res1b.shouldRespond && res1b.text.includes('Los Samanes') && !res1b.text.includes('rexup.net'));

  // ==========================================================================
  // CASO 2: CONSULTA DE DISPONIBILIDAD EN CONTEXTO ACTIVO
  // ==========================================================================
  console.log('\n--- CASO 2: Consulta de Disponibilidad ("¿Está disponible?") ---');
  const res2 = await evaluateCentralDecisionPipeline({
    userText: '¿Está disponible?',
    leadId: 'lead_wasi_susana',
    talkId: 'talk_wasi_susana',
    contactId: '584149991122',
    properties,
    handoffManager,
    contextManager
  });

  testAssert('CASO 2.1: Intención clasificada como AVAILABILITY', classifyClientIntent('¿Está disponible?') === 'AVAILABILITY');
  testAssert('CASO 2.2: Responde estatus oficial de la misma propiedad (REF-012)', res2.shouldRespond && res2.text.includes('disponible para venta'));
  testAssert('CASO 2.3: No envía enlace Rexup', !res2.text.includes('rexup.net'));

  // ==========================================================================
  // CASO 3: SOLICITUD EXPLÍCITA DE FOTOGRAFÍAS
  // ==========================================================================
  console.log('\n--- CASO 3: Solicitud Explícita de Fotografías ("¿Me puedes enviar las fotos?") ---');
  const res3 = await evaluateCentralDecisionPipeline({
    userText: '¿Me puedes enviar las fotos?',
    leadId: 'lead_wasi_susana',
    talkId: 'talk_wasi_susana',
    contactId: '584149991122',
    properties,
    handoffManager,
    contextManager
  });

  testAssert('CASO 3.1: Intención clasificada como PHOTOS_ONLY', classifyClientIntent('¿Me puedes enviar las fotos?') === 'PHOTOS_ONLY');
  testAssert('CASO 3.2: Entrega el enlace Rexup oficial de REF-012', res3.shouldRespond && res3.text.includes('rexup.net') && res3.text.includes('5480914701'));

  // ==========================================================================
  // CASO 3b: INFORMACIÓN Y FOTOGRAFÍAS (AMBAS COSAS)
  // ==========================================================================
  console.log('\n--- CASO 3b: Solicitud de Información y Fotografías ---');
  const res3b = await evaluateCentralDecisionPipeline({
    userText: 'Quiero información y fotografías de este inmueble',
    leadId: 'lead_wasi_susana',
    talkId: 'talk_wasi_susana',
    contactId: '584149991122',
    properties,
    handoffManager,
    contextManager
  });

  testAssert('CASO 3b.1: Intención clasificada como INFO_AND_PHOTOS', classifyClientIntent('Quiero información y fotografías de este inmueble') === 'INFO_AND_PHOTOS');
  testAssert('CASO 3b.2: Entrega información comercial PRIMERO', res3b.shouldRespond && res3b.text.includes('Los Samanes') && res3b.text.includes('110 m²'));
  testAssert('CASO 3b.3: Entrega enlace Rexup TAMBIÉN', res3b.text.includes('rexup.net') && res3b.text.includes('5480914701'));

  // ==========================================================================
  // CASO 4: RECONOCIMIENTO DE MERCADO LIBRE (REF-021)
  // ==========================================================================
  console.log('\n--- CASO 4: Reconocimiento de Mercado Libre (REF-021) ---');
  const mlFullUrl = 'https://inmueble.mercadolibre.com.ve/MLV-1030682516-alquilo-anexo-en-oripoto-frente-al-colegio-jean-piaget-baruta-_JM';

  const res4 = await evaluateCentralDecisionPipeline({
    userText: mlFullUrl,
    leadId: 'lead_ml_daniel',
    talkId: 'talk_ml_daniel',
    contactId: '584223115105',
    properties,
    handoffManager,
    contextManager
  });

  testAssert('CASO 4.1: URL completa de ML resuelve REF-021', res4.targetProperty && res4.targetProperty.ID_PROPIEDAD === 'REF-021');
  testAssert('CASO 4.2: Responde con información comercial oficial de REF-021', res4.shouldRespond && (res4.text.includes('Oripoto') || res4.text.includes('Los Guayabitos')) && res4.text.includes('20') && res4.text.includes('240'));
  testAssert('CASO 4.3: Operación alquiler confirmada', res4.text.includes('alquiler'));

  // Probar variantes de Mercado Libre
  const mlVariants = [
    { name: 'Código con guión', input: 'MLV-1030682516' },
    { name: 'Código numérico puro', input: '1030682516' },
    { name: 'Código sin guión', input: 'MLV1030682516' },
    { name: 'URL con query params y hash', input: 'https://inmueble.mercadolibre.com.ve/MLV-1030682516-alquilo-anexo-en-oripoto-frente-al-colegio-jean-piaget-baruta-_JM?tracking=xyz#abc' },
    { name: 'URL con puntuación final', input: 'https://inmueble.mercadolibre.com.ve/MLV-1030682516-alquilo-anexo-en-oripoto-frente-al-colegio-jean-piaget-baruta-_JM.' }
  ];

  for (const v of mlVariants) {
    const resV = await evaluateCentralDecisionPipeline({
      userText: v.input,
      leadId: `lead_ml_${v.name.replace(/\s+/g, '_')}`,
      talkId: `talk_ml_${v.name.replace(/\s+/g, '_')}`,
      contactId: '584223115105',
      properties,
      handoffManager,
      contextManager
    });
    testAssert(`CASO 4.4 (${v.name}): Resuelve REF-021 y responde info comercial`, resV.targetProperty?.ID_PROPIEDAD === 'REF-021' && resV.shouldRespond && (resV.text.includes('Oripoto') || resV.text.includes('Los Guayabitos')) && resV.text.includes('240'));
  }

  // ==========================================================================
  // CASO 5: MERCADO LIBRE NO REGISTRADO (MLV-1029979196)
  // ==========================================================================
  console.log('\n--- CASO 5: Enlace de Mercado Libre No Registrado (MLV-1029979196) ---');
  const unregMsg = `Hola, tengo algunas preguntas sobre tu publicación en Mercado Libre:\nhttps://inmueble.mercadolibre.com.ve/MLV-1029979196-alquilo-oficina-52m2-av-casanova-instituto-m`;

  const res5 = await evaluateCentralDecisionPipeline({
    userText: unregMsg,
    leadId: 'lead_unreg_palma',
    talkId: 'talk_unreg_palma',
    contactId: '584223115105',
    properties,
    handoffManager,
    contextManager
  });

  testAssert('CASO 5.1: No inventa propiedad ni asocia a otra (targetProperty es null)', !res5.targetProperty);
  testAssert('CASO 5.2: Genera alerta interna para Robert (UNMATCHED_LINK)', res5.log.robertAlert && res5.log.robertAlert.includes('Google Sheets') && res5.log.robertAlert.includes('Mercado Libre'));
  testAssert('CASO 5.3: Envía respuesta preventiva al cliente', res5.shouldRespond && res5.text.includes('Hemos recibido tu consulta sobre esta publicación. Estamos verificando los detalles con nuestro asesor y en breve te confirmaremos la información.'));

  // Probar con código puro MLV-1029979196
  const res5b = await evaluateCentralDecisionPipeline({
    userText: 'MLV-1029979196',
    leadId: 'lead_unreg_code',
    talkId: 'talk_unreg_code',
    contactId: '584223115105',
    properties,
    handoffManager,
    contextManager
  });
  testAssert('CASO 5.4: Código puro no registrado da respuesta preventiva', res5b.shouldRespond && res5b.text.includes('Estamos verificando los detalles con nuestro asesor'));

  // ==========================================================================
  // CASO 6: PROTECCIÓN CONTRA DUPLICADOS
  // ==========================================================================
  console.log('\n--- CASO 6: Protección Contra Duplicados (Idempotencia) ---');
  const testMsgId = 'msg_hotfix_idemp_001';
  const lock1 = idempotencyManager.acquireLock(testMsgId, 'talk_hotfix_1', 'lead_hotfix_1');
  testAssert('CASO 6.1: Primer intento adquiere el lock atómico (allowed: true)', lock1.allowed === true);

  const lock2 = idempotencyManager.acquireLock(testMsgId, 'talk_hotfix_1', 'lead_hotfix_1');
  testAssert('CASO 6.2: Segundo intento con mismo messageId es bloqueado (0 duplicados)', lock2.allowed === false && lock2.reason === 'IN_FLIGHT_PROCESSING');

  idempotencyManager.markSent(testMsgId, 'Respuesta comercial despachada', { dispatched: true });
  const lock3 = idempotencyManager.acquireLock(testMsgId, 'talk_hotfix_1', 'lead_hotfix_1');
  testAssert('CASO 6.3: Mensaje ya procesado es rechazado (ALREADY_SENT)', lock3.allowed === false && lock3.reason === 'ALREADY_SENT');

  // ==========================================================================
  // CASO 7: NO REGRESIÓN MULTICANAL (WHATSAPP, INSTAGRAM, MESSENGER)
  // ==========================================================================
  console.log('\n--- CASO 7: No Regresión Multicanal ---');
  const waRes = await evaluateCentralDecisionPipeline({
    userText: '10493109',
    leadId: 'lead_wa_01',
    talkId: 'talk_wa_01',
    contactId: '584149990001',
    channel: 'whatsapp',
    properties,
    handoffManager,
    contextManager
  });
  testAssert('CASO 7.1: Canal WhatsApp opera correctamente', waRes.shouldRespond && waRes.text.includes('Los Samanes'));

  const igRes = await evaluateCentralDecisionPipeline({
    userText: '10493109',
    leadId: 'lead_ig_01',
    talkId: 'talk_ig_01',
    contactId: 'ig_user_123',
    channel: 'instagram',
    properties,
    handoffManager,
    contextManager
  });
  testAssert('CASO 7.2: Canal Instagram opera correctamente', igRes.shouldRespond && igRes.text.includes('Los Samanes'));

  const fbRes = await evaluateCentralDecisionPipeline({
    userText: '10493109',
    leadId: 'lead_fb_01',
    talkId: 'talk_fb_01',
    contactId: 'fb_user_456',
    channel: 'facebook',
    properties,
    handoffManager,
    contextManager
  });
  testAssert('CASO 7.3: Canal Facebook Messenger opera correctamente', fbRes.shouldRespond && fbRes.text.includes('Los Samanes'));

  // Limpiar temporales
  if (fs.existsSync(testHandoffFile)) fs.unlinkSync(testHandoffFile);
  if (fs.existsSync(testIdempFile)) fs.unlinkSync(testIdempFile);

  console.log('\n==============================================================================');
  console.log(` RESULTADOS DEL HOTFIX: ${passed} / ${total} PRUEBAS SUPERADAS (100%)`);
  console.log('==============================================================================\n');
}

runHotfixTests().catch(err => {
  console.error('ERROR EN SUITE DE HOTFIX:', err);
  process.exit(1);
});
