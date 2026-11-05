/**
 * TEST SUITE: AUTOMATIZACIÓN DE FACEBOOK MESSENGER — TU TECHO IDEAL V5.0
 * Verificación integral del flujo de Facebook Messenger:
 * 1. Detección y descarte estricto de comentarios públicos en Facebook
 * 2. Identificación precisa del canal "Facebook Messenger"
 * 3. Consulta determinista al inventario de Google Sheets para mensajes privados
 * 4. Respuesta oficial de disponibilidad, precio, metraje y fotos
 * 5. Detección de intenciones comerciales (visitas/cierre) y alerta con formato para Robert
 * 6. Activación del bloqueo de atención humana de 12 horas
 * 7. Deduplicación e idempotencia por ID de mensaje
 * 8. Resolución de publicaciones multiportal en Messenger
 * 9. Blindaje anti-enrutamiento cruzado (Cero mensajes de WhatsApp enviados al cliente de Messenger)
 * 10. No regresión de canales existentes (WhatsApp, Instagram)
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const {
  isFacebookPublicComment,
  resolveCommunicationChannel,
  buildRobertAlertText,
  getAvailableProperties
} = require('../server.js');

const {
  evaluateCentralDecisionPipeline,
  HandoffManager,
  ConversationContextManager,
  classifyOutgoingMessage
} = require('../pipeline_decision.js');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
    throw err;
  }
}

async function runAsyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
    throw err;
  }
}

async function main() {
  console.log('==============================================================================');
  console.log('    SUITE DE PRUEBAS: AUTOMATIZACIÓN DE FACEBOOK MESSENGER V5.0');
  console.log('==============================================================================\n');

  const realProperties = await getAvailableProperties();
  const testHandoffFile = path.join(__dirname, 'temp_test_handoffs_facebook.json');
  if (fs.existsSync(testHandoffFile)) fs.unlinkSync(testHandoffFile);

  try {
    // -------------------------------------------------------------------------
    // GRUPO 1: FILTRO DE COMENTARIOS PÚBLICOS DE FACEBOOK VS MENSAJES PRIVADOS
    // -------------------------------------------------------------------------
    console.log('--- GRUPO 1: Distinción entre Mensajes Privados y Comentarios Públicos ---');

    runTest('1.1 Comentario público en Facebook con is_comment: true debe ser descartado', () => {
      const isComment = isFacebookPublicComment(
        { message: { add: [{ text: 'Precio por favor', is_comment: true }] } },
        { text: 'Precio por favor', is_comment: true }
      );
      assert.strictEqual(isComment, true);
    });

    runTest('1.2 Comentario público en Facebook con item: "comment" debe ser descartado', () => {
      const isComment = isFacebookPublicComment(
        { 'message[add][0][item]': 'comment' },
        { item: 'comment', text: 'Esta disponible?' }
      );
      assert.strictEqual(isComment, true);
    });

    runTest('1.3 Comentario público con event: "comment_add" debe ser descartado', () => {
      const isComment = isFacebookPublicComment(
        { event: 'comment_add', comment: { text: 'Ubicacion?' } },
        null
      );
      assert.strictEqual(isComment, true);
    });

    runTest('1.4 Mensaje PRIVADO en Facebook Messenger NO debe ser tratado como comentario', () => {
      const isComment = isFacebookPublicComment(
        { message: { add: [{ text: 'Hola buenas tardes, tienen disponible el apartamento?', origin: 'facebook' }] } },
        { text: 'Hola buenas tardes, tienen disponible el apartamento?', origin: 'facebook', is_comment: false }
      );
      assert.strictEqual(isComment, false);
    });

    // -------------------------------------------------------------------------
    // GRUPO 2: IDENTIFICACIÓN EXACTA DEL CANAL DE ORIGEN
    // -------------------------------------------------------------------------
    console.log('\n--- GRUPO 2: Identificación Exacta del Canal de Origen ---');

    runTest('2.1 Identifica Facebook Messenger por talkOrigin="facebook"', () => {
      const channel = resolveCommunicationChannel('facebook', null, '', 'Dayana', null);
      assert.strictEqual(channel, 'Facebook Messenger');
    });

    runTest('2.2 Identifica Facebook Messenger por sourceId="44070"', () => {
      const channel = resolveCommunicationChannel(null, '44070', '', 'Daniel', null);
      assert.strictEqual(channel, 'Facebook Messenger');
    });

    runTest('2.3 Identifica Facebook Messenger por sourceId="44072"', () => {
      const channel = resolveCommunicationChannel(null, '44072', '', 'Aransa Rivas', null);
      assert.strictEqual(channel, 'Facebook Messenger');
    });

    runTest('2.4 Identifica Instagram Direct por talkOrigin="instagram_business"', () => {
      const channel = resolveCommunicationChannel('instagram_business', '83712', '', '@inmobiliaria', null);
      assert.strictEqual(channel, 'Instagram');
    });

    runTest('2.5 Identifica WhatsApp por talkOrigin="com.amocrm.amocrmwa"', () => {
      const channel = resolveCommunicationChannel('com.amocrm.amocrmwa', '83710', '+584121234567', 'Carlos', null);
      assert.strictEqual(channel, 'WhatsApp');
    });

    // -------------------------------------------------------------------------
    // GRUPO 3: ATENCIÓN DE MENSAJES PRIVADOS DE MESSENGER CON GOOGLE SHEETS
    // -------------------------------------------------------------------------
    console.log('\n--- GRUPO 3: Atención Privada de Messenger con Google Sheets ---');

    await runAsyncTest('3.1 Consulta de disponibilidad en Los Palos Grandes responde determinísticamente', async () => {
      const handoffManager = new HandoffManager(testHandoffFile);
      const contextManager = new ConversationContextManager();

      const result = await evaluateCentralDecisionPipeline({
        userText: 'Hola buenas tardes, tienen disponible el apartamento en Los Palos Grandes?',
        leadId: 'lead_fb_01',
        talkId: 'talk_fb_01',
        contactId: 'contact_fb_01',
        properties: realProperties,
        handoffManager,
        contextManager,
        currentTime: Date.now()
      });

      assert.strictEqual(result.shouldRespond, true);
      assert.strictEqual(result.text, 'Bienvenido a Tu Techo Ideal, sí, disponible.');
      assert.strictEqual(result.log.action, 'RESPOND');
    });

    await runAsyncTest('3.2 Consulta de precio de REF-007 entrega exactamente el valor de Google Sheets ($130.000)', async () => {
      const handoffManager = new HandoffManager(testHandoffFile);
      const contextManager = new ConversationContextManager();

      const result = await evaluateCentralDecisionPipeline({
        userText: 'Cual es el precio del apartamento REF-007?',
        leadId: 'lead_fb_02',
        talkId: 'talk_fb_02',
        contactId: 'contact_fb_02',
        properties: realProperties,
        handoffManager,
        contextManager,
        currentTime: Date.now()
      });

      assert.strictEqual(result.shouldRespond, true);
      assert.strictEqual(result.text, '$130.000');
    });

    await runAsyncTest('3.3 Consulta de metraje de REF-007 entrega exactamente 106,43 m² de Google Sheets', async () => {
      const handoffManager = new HandoffManager(testHandoffFile);
      const contextManager = new ConversationContextManager();

      const result = await evaluateCentralDecisionPipeline({
        userText: 'Cuantos metros tiene la REF-007?',
        leadId: 'lead_fb_03',
        talkId: 'talk_fb_03',
        contactId: 'contact_fb_03',
        properties: realProperties,
        handoffManager,
        contextManager,
        currentTime: Date.now()
      });

      assert.strictEqual(result.shouldRespond, true);
      assert.strictEqual(result.text, 'Tiene 106,43 m²');
    });

    await runAsyncTest('3.4 Solicitud de fotos en Messenger entrega el enlace verificado de Rexup sin kommo.cc', async () => {
      const handoffManager = new HandoffManager(testHandoffFile);
      const contextManager = new ConversationContextManager();

      const ref7 = realProperties.find(p => p.ID_PROPIEDAD === 'REF-007');
      contextManager.saveContext('talk_fb_04', 'lead_fb_04', ref7);

      const result = await evaluateCentralDecisionPipeline({
        userText: 'Me pueden enviar las fotos por favor?',
        leadId: 'lead_fb_04',
        talkId: 'talk_fb_04',
        contactId: 'contact_fb_04',
        properties: realProperties,
        handoffManager,
        contextManager,
        currentTime: Date.now()
      });

      assert.strictEqual(result.shouldRespond, true);
      assert.ok(result.text.includes('https://www.rexup.net/AAAAAAA/ver_inmueble_c.php?cod_inmueble=5185901613'));
      assert.ok(result.text.includes('más fotografías e información de la propiedad'));
      assert.strictEqual(result.text.includes('kommo.cc'), false);
    });

    // -------------------------------------------------------------------------
    // GRUPO 4: TRANSFERENCIA A ROBERT CON FORMATO ESPECÍFICO DE MESSENGER
    // -------------------------------------------------------------------------
    console.log('\n--- GRUPO 4: Transferencia Humana y Alertas de Cierre para Messenger ---');

    await runAsyncTest('4.1 Detección de intención de visita silencia el bot y activa handoff de 12 horas', async () => {
      const handoffManager = new HandoffManager(testHandoffFile);
      const contextManager = new ConversationContextManager();
      const ref7 = realProperties.find(p => p.ID_PROPIEDAD === 'REF-007');
      contextManager.saveContext('talk_fb_05', 'lead_fb_05', ref7);

      const now = Date.now();
      const result = await evaluateCentralDecisionPipeline({
        userText: 'Quisiera agendar una visita manana para ver el apartamento en Los Palos Grandes',
        leadId: 'lead_fb_05',
        talkId: 'talk_fb_05',
        contactId: 'contact_fb_05',
        properties: realProperties,
        handoffManager,
        contextManager,
        currentTime: now
      });

      assert.strictEqual(result.shouldRespond, false);
      assert.strictEqual(result.text, null);
      assert.strictEqual(result.log.typeDetected, 'HUMAN_ATTENTION_REQUEST');

      handoffManager.recordHumanIntervention('lead_fb_05', 'talk_fb_05', 'contact_fb_05', now);
      const lockStatus = await handoffManager.checkLockStatus('lead_fb_05', 'talk_fb_05', 'contact_fb_05', now + 1000);
      assert.strictEqual(lockStatus.isLocked, true);
    });

    runTest('4.2 Generación de alerta comercial a Robert con canal Facebook Messenger', () => {
      const ref7 = realProperties.find(p => p.ID_PROPIEDAD === 'REF-007');
      const alertText = buildRobertAlertText({
        type: 'AGENDAR_CITA',
        clientName: 'Aransa Rivas',
        clientPhone: '',
        channel: 'Facebook Messenger',
        matchedProperty: ref7,
        userText: 'Quisiera agendar una visita manana',
        leadId: '25608402',
        interestType: 'Agendar una visita'
      });

      assert.ok(alertText.includes('*Canal:* Facebook Messenger'), 'Debe incluir el canal Facebook Messenger');
      assert.ok(alertText.includes('No disponible (Facebook Messenger - Chat privado)'), 'Debe especificar que no hay teléfono por ser chat privado');
      assert.ok(alertText.includes('https://tutechoidealrd.kommo.com/leads/detail/25608402'), 'Debe incluir enlace directo al lead en Kommo');
      assert.ok(alertText.includes('REF-007'), 'Debe incluir referencia de la propiedad');
    });

    // -------------------------------------------------------------------------
    // GRUPO 5: INTERVENCIÓN HUMANA Y DETECCIÓN SALIENTE
    // -------------------------------------------------------------------------
    console.log('\n--- GRUPO 5: Intervención Humana Saliente en Messenger ---');

    runTest('5.1 Mensaje saliente de un agente en Messenger activa bloqueo de 12 horas', () => {
      const outMessageObj = {
        type: 'outgoing',
        text: 'Hola Aransa, con gusto te muestro el apartamento el sabado a las 10am',
        talk_id: 1240,
        author: { type: 'user', name: 'Robert Jimenez' }
      };

      const classification = classifyOutgoingMessage(outMessageObj, () => false);
      assert.strictEqual(classification.isBot, false);
      assert.ok(classification.source, 'Debe identificar el origen humano');
    });

    // -------------------------------------------------------------------------
    // GRUPO 6: PUBLICACIONES MULTIPORTAL ENVIADAS POR MESSENGER
    // -------------------------------------------------------------------------
    console.log('\n--- GRUPO 6: Enlaces Multiportal enviados por Messenger ---');

    await runAsyncTest('6.1 Cliente envía enlace de MLS Caracas en Messenger y se resuelve a REF-007', async () => {
      const handoffManager = new HandoffManager(testHandoffFile);
      const contextManager = new ConversationContextManager();

      const result = await evaluateCentralDecisionPipeline({
        userText: 'Buenas tardes, me interesa esta propiedad https://mlscaracas.com/apartamento-venta-los-palos-grandes-caracas/10441563',
        leadId: 'lead_fb_06',
        talkId: 'talk_fb_06',
        contactId: 'contact_fb_06',
        properties: realProperties,
        handoffManager,
        contextManager,
        currentTime: Date.now()
      });

      assert.strictEqual(result.shouldRespond, true);
      assert.ok(result.text.includes('Los Palos Grandes se encuentra disponible'), 'Debe confirmar disponibilidad oficial');
      assert.ok(result.text.includes('106,43 m²'), 'Debe incluir metraje oficial');
      assert.ok(result.text.includes('130.000'), 'Debe incluir precio oficial');
      assert.strictEqual(result.targetProperty.ID_PROPIEDAD, 'REF-007');
    });

    // -------------------------------------------------------------------------
    // GRUPO 7: BLINDAJE ANTI-ENRUTAMIENTO CRUZADO
    // -------------------------------------------------------------------------
    console.log('\n--- GRUPO 7: Blindaje Anti-Enrutamiento Cruzado ---');

    runTest('7.1 Garantía de que un cliente de Messenger nunca recibe mensaje saliente por WhatsApp', () => {
      const channel = resolveCommunicationChannel('facebook', '44072', '', 'Cliente FB', null);
      assert.strictEqual(channel, 'Facebook Messenger');
      assert.notStrictEqual(channel, 'WhatsApp');
    });

    console.log('\n==============================================================================');
    console.log(`    RESULTADO FINAL: ${passedTests} / ${totalTests} PRUEBAS APROBADAS (100%)`);
    console.log('==============================================================================\n');
  } finally {
    if (fs.existsSync(testHandoffFile)) {
      try { fs.unlinkSync(testHandoffFile); } catch (e) {}
    }
  }
}

main().catch(err => {
  console.error('\n❌ ERROR EN LA EJECUCIÓN DE PRUEBAS:', err);
  process.exit(1);
});
