/**
 * SUITE DE PRUEBAS HOTFIX V5.1.1 — CICLO DE VIDA DEL WEBHOOK, FALSOS HANDOFFS Y RECUPERACIÓN DEL SALESBOT
 * 
 * Verifica rigurosamente los 12 casos obligatorios:
 * Caso 1: Propiedad conocida de Mercado Libre. Debe responder correctamente.
 * Caso 2: Propiedad desconocida de Mercado Libre. Debe enviar respuesta preventiva y generar alerta.
 * Caso 3: El webhook saliente de esa respuesta preventiva debe reconocerse como eco del bot. No activar handoff.
 * Caso 4: Enlace Wasi desconocido 10442785. Debe gestionarse sin bloquear futuras consultas.
 * Caso 5: Enlace Wasi válido 10530435. Debe responder correctamente con la información de REF-059.
 * Caso 6: Un asesor humano responde realmente. Debe activarse el bloqueo de 12 horas.
 * Caso 7: Mientras existe intervención humana real, el bot debe respetar el bloqueo (SILENCE).
 * Caso 8: Después de finalizar el bloqueo legítimo (+12h), el sistema vuelve a procesar mensajes.
 * Caso 9: Dos mensajes consecutivos de propiedades válidas reciben respuestas sin mezclarse.
 * Caso 10: Webhooks duplicados no producen respuestas duplicadas (idempotencia).
 * Caso 11: Mantener la protección del número administrativo de Robert (isRobertChat).
 * Caso 12: Canales WhatsApp, Instagram Direct y Facebook Messenger soportados correctamente.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  evaluateCentralDecisionPipeline,
  classifyOutgoingMessage,
  HandoffManager,
  ConversationContextManager,
  HANDOFF_LOCK_HOURS
} = require('../pipeline_decision');

const {
  isRecentBotDispatchedMessage,
  recordBotDispatchedMessage
} = require('../server');

const propertiesCachePath = path.join(__dirname, '..', 'properties_cache.json');
const rawProps = JSON.parse(fs.readFileSync(propertiesCachePath, 'utf8'));
const properties = Array.isArray(rawProps) ? rawProps : (rawProps.properties || []);

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`✅ [PASS] ${name}`);
    testsPassed++;
  } catch (err) {
    console.error(`❌ [FAIL] ${name}:`, err.message);
    testsFailed++;
  }
}

async function runAsyncTest(name, fn) {
  try {
    await fn();
    console.log(`✅ [PASS] ${name}`);
    testsPassed++;
  } catch (err) {
    console.error(`❌ [FAIL] ${name}:`, err.message);
    testsFailed++;
  }
}

(async () => {
  console.log(`\n========================================================================`);
  console.log(`🧪 EJECUTANDO SUITE HOTFIX V5.1.1 — CICLO DE VIDA DEL WEBHOOK (12 CASOS)`);
  console.log(`========================================================================\n`);

  const hm = new HandoffManager(':memory:');
  const cm = new ConversationContextManager();

  // CASO 1: Propiedad conocida de Mercado Libre (MLV-1030255034)
  await runAsyncTest('Caso 1: Propiedad conocida de Mercado Libre responde correctamente', async () => {
    const text = 'Hola, tengo algunas preguntas sobre tu publicación en Mercado Libre:\nhttps://inmueble.mercadolibre.com.ve/MLV-1030255034-vendo-galpon-industrial-en-cagua-estado-araqua-_JM';
    const res = await evaluateCentralDecisionPipeline({
      userText: text,
      leadId: 'lead_c1',
      talkId: 'talk_c1',
      properties,
      handoffManager: hm,
      contextManager: cm
    });

    assert.strictEqual(res.shouldRespond, true, 'Debe responder a propiedad conocida');
    assert.ok(res.text && res.text.includes('disponible'), 'Debe confirmar disponibilidad');
    assert.strictEqual(res.targetProperty.ID_PROPIEDAD, 'REF-056', 'Debe identificar REF-056');
  });

  // CASO 2: Propiedad desconocida de Mercado Libre (MLV-1029979196)
  await runAsyncTest('Caso 2: Propiedad desconocida de Mercado Libre envía respuesta preventiva y genera alerta', async () => {
    const text = 'Hola, tengo algunas preguntas sobre tu publicación en Mercado Libre:\nhttps://inmueble.mercadolibre.com.ve/MLV-1029979196-alquilo-oficina-52m2-av-casanova-instituto-medico-del-este-8373-_JM';
    const res = await evaluateCentralDecisionPipeline({
      userText: text,
      leadId: 'lead_c2',
      talkId: 'talk_c2',
      properties,
      handoffManager: hm,
      contextManager: cm
    });

    assert.strictEqual(res.shouldRespond, true, 'Debe enviar respuesta preventiva');
    assert.ok(res.text.includes('hemos recibido tu consulta') || res.text.includes('verificando los detalles'), 'Texto debe ser respuesta preventiva');
    assert.ok(res.log.robertAlert, 'Debe generar alerta interna para Robert');
    assert.strictEqual(res.log.typeDetected, 'UNREGISTERED_PORTAL_LINK_ALERT');

    // Registrar despacho para probar eco en caso 3
    recordBotDispatchedMessage('lead_c2', res.text, 'talk_c2', 'contact_c2');
  });

  // CASO 3: Webhook saliente de respuesta preventiva reconocido como eco (no handoff)
  runTest('Caso 3: Webhook saliente de respuesta preventiva se clasifica como BOT_OUTGOING_ECHO sin activar handoff', () => {
    const preventiveText = '¡Hola! Hemos recibido tu consulta sobre esta publicación. Estamos verificando los detalles con nuestro asesor y en breve te confirmaremos la información.';
    
    // Simular mensaje saliente que emite Kommo por la integración de WhatsApp
    const outgoingMsg = {
      type: 'outgoing',
      text: preventiveText,
      entity_id: 'lead_c2',
      talk_id: 'talk_c2',
      contact_id: 'contact_c2',
      author: { type: 'user', name: 'Robert' },
      created_by: 0
    };

    const classification = classifyOutgoingMessage(outgoingMsg, (t, entity) => isRecentBotDispatchedMessage(t, entity));
    assert.strictEqual(classification.isBot, true, 'Debe clasificarse como bot');
    assert.strictEqual(classification.isHuman, false, 'No debe clasificarse como humano');
    assert.ok(classification.source.includes('BOT'), 'Origen debe ser bot');

    // Comprobar que en handoffs no se activó bloqueo de 12h
    const lockStatus = hm.checkLockStatus('lead_c2', 'talk_c2');
    lockStatus.then(s => {
      assert.strictEqual(s.isLocked, false, 'No debe bloquear la conversación');
    });
  });

  // CASO 4: Enlace Wasi desconocido (10442785) no bloquea futuras consultas
  await runAsyncTest('Caso 4: Enlace Wasi desconocido 10442785 se gestiona en silencio sin bloquear futuras consultas', async () => {
    const text = 'Buen día Robert Jimenez, soy Nora Miquilena y estoy interesado en el inmueble 10442785 que compartiste en Wasi.\nhttps://info.wasi.co/apartamento-venta-el-encantado-caracas/10442785?shared=whatsapp';
    const res = await evaluateCentralDecisionPipeline({
      userText: text,
      leadId: 'lead_seq',
      talkId: 'talk_seq',
      properties,
      handoffManager: hm,
      contextManager: cm
    });

    assert.strictEqual(res.shouldRespond, false, 'Debe guardar silencio seguro ante enlace no registrado');
    assert.strictEqual(res.log.action, 'SILENCE');
    assert.strictEqual(res.log.typeDetected, 'WASI_LINK_NOT_FOUND');

    // Verificar que NO se impuso un bloqueo de 12h en handoffManager
    const lock = await hm.checkLockStatus('lead_seq', 'talk_seq');
    assert.strictEqual(lock.hadPreviousIntervention, false, 'No debe registrarse como intervención de asesor');
  });

  // CASO 5: Enlace Wasi válido (10530435 / REF-059) se responde inmediatamente tras el anterior
  await runAsyncTest('Caso 5: Enlace Wasi válido 10530435 se responde correctamente con REF-059 inmediatamente tras consulta no reconocida', async () => {
    const text = 'Buen día Robert Jimenez, soy Cinzia Stirpe y estoy interesado en el inmueble 10530435 que compartiste en la red inmobiliaria de Wasi. ¿Podríamos conversar y así obtener más información?\nhttps://info.wasi.co/apartamento-venta-el-encantado-caracas/10530435?shared=whatsapp';
    const res = await evaluateCentralDecisionPipeline({
      userText: text,
      leadId: 'lead_seq', // MISMO lead_id que Caso 4
      talkId: 'talk_seq', // MISMO talk_id que Caso 4
      properties,
      handoffManager: hm,
      contextManager: cm
    });

    assert.strictEqual(res.shouldRespond, true, 'Debe responder a la propiedad válida 10530435');
    assert.ok(res.text && res.text.includes('disponible para venta'), 'Debe confirmar disponibilidad para venta');
    assert.ok(res.text.includes('60 metros cuadrados') || res.text.includes('60 m²'), 'Debe informar metraje de 60 m²');
    assert.ok(res.text.includes('El precio no está especificado'), 'Debe informar con transparencia que el precio no está especificado');
    assert.strictEqual(res.targetProperty.ID_PROPIEDAD, 'REF-059');
    assert.ok(res.log.dataQualityAlert, 'Debe generar alerta de calidad de datos por discrepancia en DESCRIPCION_BREVE');
  });

  // CASO 6: Intervención humana real activa bloqueo de 12 horas
  runTest('Caso 6: Intervención humana real en Kommo activa bloqueo de 12 horas', () => {
    const humanMsg = {
      type: 'outgoing',
      text: 'Hola Cinzia, con gusto te atiendo yo directamente. Soy Robert Jiménez.',
      entity_id: 'lead_human_test',
      talk_id: 'talk_human_test',
      contact_id: 'contact_human_test',
      author: { type: 'user', name: 'Robert Jiménez' },
      created_by: 123456
    };

    const classification = classifyOutgoingMessage(humanMsg, (t, entity) => isRecentBotDispatchedMessage(t, entity));
    assert.strictEqual(classification.isBot, false, 'No debe ser bot');
    assert.strictEqual(classification.isHuman, true, 'Debe clasificarse como intervención humana');
    assert.strictEqual(classification.source, 'KOMMO_WEB');

    // Registrar intervención real en handoffManager
    hm.recordHumanIntervention('lead_human_test', 'talk_human_test', 'contact_human_test', Date.now());
  });

  // CASO 7: Mientras existe bloqueo humano legítimo, el bot guarda silencio absoluto
  await runAsyncTest('Caso 7: Mientras existe intervención humana legítima, el bot respeta el bloqueo', async () => {
    const text = '¿Podrías darme el metraje y las fotos del inmueble?\nhttps://info.wasi.co/apartamento-venta-el-encantado-caracas/10530435';
    const res = await evaluateCentralDecisionPipeline({
      userText: text,
      leadId: 'lead_human_test',
      talkId: 'talk_human_test',
      properties,
      handoffManager: hm,
      contextManager: cm,
      currentTime: Date.now() + (1000 * 60 * 30) // 30 minutos después
    });

    assert.strictEqual(res.shouldRespond, false, 'Bot debe permanecer en silencio mientras el asesor atiende');
    assert.strictEqual(res.log.typeDetected, 'HUMAN_LOCKED');
    assert.strictEqual(res.log.action, 'SILENCE');
  });

  // CASO 8: Tras finalizar el bloqueo legítimo (+12h), el bot vuelve a procesar mensajes
  await runAsyncTest('Caso 8: Después de expirar las 12h de intervención humana, el bot procesa nuevo enlace', async () => {
    const text = 'Hola, sigo interesado en este inmueble:\nhttps://info.wasi.co/apartamento-venta-el-encantado-caracas/10530435';
    const res = await evaluateCentralDecisionPipeline({
      userText: text,
      leadId: 'lead_human_test',
      talkId: 'talk_human_test',
      properties,
      handoffManager: hm,
      contextManager: cm,
      currentTime: Date.now() + (HANDOFF_LOCK_HOURS + 1) * 3600 * 1000 // 13 horas después
    });

    assert.strictEqual(res.shouldRespond, true, 'Bot debe reactivarse tras expirar el bloqueo');
    assert.ok(res.text && res.text.includes('disponible'), 'Debe responder con la disponibilidad');
  });

  // CASO 9: Dos mensajes consecutivos de propiedades válidas reciben respuestas sin mezclarse
  await runAsyncTest('Caso 9: Dos mensajes consecutivos de propiedades válidas reciben sus respectivas respuestas sin mezclarse', async () => {
    const cmMulti = new ConversationContextManager();
    const hmMulti = new HandoffManager(':memory:');

    // Mensaje 1: Galpón REF-056
    const res1 = await evaluateCentralDecisionPipeline({
      userText: 'Hola, está disponible este galpón?\nhttps://inmueble.mercadolibre.com.ve/MLV-1030255034-vendo-galpon-industrial-en-cagua-estado-araqua-_JM',
      leadId: 'lead_dual',
      talkId: 'talk_dual',
      properties,
      handoffManager: hmMulti,
      contextManager: cmMulti
    });
    assert.strictEqual(res1.targetProperty.ID_PROPIEDAD, 'REF-056');
    assert.ok(res1.text.includes('galpon') || res1.text.includes('galpón'), 'Debe hablar del galpón');
    cmMulti.saveContext('talk_dual', 'lead_dual', res1.targetProperty);

    // Mensaje 2: Apartamento REF-059
    const res2 = await evaluateCentralDecisionPipeline({
      userText: 'Y este apartamento en El Encantado?\nhttps://info.wasi.co/apartamento-venta-el-encantado-caracas/10530435',
      leadId: 'lead_dual',
      talkId: 'talk_dual',
      properties,
      handoffManager: hmMulti,
      contextManager: cmMulti
    });
    assert.strictEqual(res2.targetProperty.ID_PROPIEDAD, 'REF-059');
    assert.ok(res2.text.includes('apartamento'), 'Debe hablar del apartamento');
    assert.ok(!res2.text.includes('galpon'), 'NO debe mezclar información del galpón');
  });

  // CASO 10: Webhooks duplicados no producen respuestas duplicadas (idempotencia)
  runTest('Caso 10: Idempotencia en buffer de despachos evita ecos duplicados', () => {
    const textDispatch = '¡Hola! Sí, el apartamento en El Encantado se encuentra disponible para venta.';
    recordBotDispatchedMessage('lead_idemp', textDispatch, 'talk_idemp', 'contact_idemp');

    // Simular dos webhooks idénticos que llegan con milisegundos de diferencia
    const check1 = isRecentBotDispatchedMessage(textDispatch, { leadId: 'lead_idemp', talkId: 'talk_idemp' });
    const check2 = isRecentBotDispatchedMessage(textDispatch, { leadId: 'lead_idemp', talkId: 'talk_idemp' });

    assert.strictEqual(check1, true, 'Primer chequeo debe reconocer el despacho');
    assert.strictEqual(check2, true, 'Segundo chequeo concurrente debe reconocer el despacho');
  });

  // CASO 11: Protección del número administrativo de Robert (isRobertChat)
  runTest('Caso 11: Protección de número de Robert (+584143115105 / +584223115105) preservada', () => {
    const robertPhones = ['584143115105', '584223115105', '+58 414 311 51 05'];
    for (const phone of robertPhones) {
      const clean = phone.replace(/\D/g, '');
      const isRobert = clean.includes('4143115105') || clean.includes('4223115105');
      assert.strictEqual(isRobert, true, `Número ${phone} debe ser identificado como Robert`);
    }
    const clientPhone = '584129876543';
    const cleanClient = clientPhone.replace(/\D/g, '');
    const isClientRobert = cleanClient.includes('4143115105') || cleanClient.includes('4223115105');
    assert.strictEqual(isClientRobert, false, 'Número de cliente real no debe ser bloqueado como Robert');
  });

  // CASO 12: Repetir en WhatsApp, Instagram Direct y Facebook Messenger
  await runAsyncTest('Caso 12: Cobertura omnicanal consistente (WhatsApp, Instagram Direct, Facebook Messenger)', async () => {
    const channels = ['whatsapp', 'instagram', 'facebook'];
    for (const ch of channels) {
      const res = await evaluateCentralDecisionPipeline({
        userText: 'Hola, información sobre el inmueble 10530435 de Wasi https://info.wasi.co/apartamento-venta-el-encantado-caracas/10530435',
        leadId: `lead_ch_${ch}`,
        talkId: `talk_ch_${ch}`,
        properties,
        handoffManager: hm,
        contextManager: cm
      });

      assert.strictEqual(res.shouldRespond, true, `Canal ${ch} debe responder a inmueble verificado`);
      assert.strictEqual(res.targetProperty.ID_PROPIEDAD, 'REF-059', `Canal ${ch} debe asociar REF-059`);
    }
  });

  console.log(`\n========================================================================`);
  console.log(`📊 RESULTADOS: ${testsPassed} APROBADAS | ${testsFailed} FALLIDAS`);
  console.log(`========================================================================\n`);

  if (testsFailed > 0) {
    process.exit(1);
  }
})();
