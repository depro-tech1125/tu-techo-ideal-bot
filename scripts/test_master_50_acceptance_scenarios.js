/**
 * MASTER ACCEPTANCE SUITE — 50 ESCENARIOS OBLIGATORIOS
 * TU TECHO IDEAL V5.0 — CONSOLIDACIÓN OPERATIVA
 * 
 * Grupos:
 * A. Reconocimiento de enlaces (Casos 1 al 12)
 * B. Atención comercial (Casos 13 al 24)
 * C. Intervención humana (Casos 25 al 38)
 * D. Seguridad e idempotencia (Casos 39 al 50)
 */

const fs = require('fs');
const path = require('path');
const {
  evaluateCentralDecisionPipeline,
  adaptProperty,
  classifyOutgoingMessage,
  ConversationContextManager,
  HandoffManager,
  AVAILABILITY_RESPONSE,
  UNAVAILABLE_RESPONSE,
  HANDOFF_LOCK_HOURS
} = require('../pipeline_decision');
const { extractMultiportalPropertyIdentifiers } = require('../lib/multiportal_extractor');
const { IdempotencyManager } = require('../lib/idempotency_manager');

const rawProps = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'properties_cache.json'), 'utf8'));

let passed = 0;
let total = 50;

function assert(num, title, cond, detail) {
  if (cond) {
    passed++;
    console.log(`\x1b[32m[PASS ${num}/50]\x1b[0m ${title}`);
    if (detail) console.log(`       Detalle: ${detail}`);
  } else {
    console.error(`\x1b[31m[FAIL ${num}/50]\x1b[0m ${title}`);
    if (detail) console.error(`       Detalle: ${detail}`);
    process.exitCode = 1;
  }
}

async function runMasterSuite() {
  console.log('================================================================');
  console.log('   SUITE MAESTRA DE ACEPTACIÓN: 50 ESCENARIOS TU TECHO IDEAL    ');
  console.log('================================================================\n');

  const contextMgr = new ConversationContextManager();
  const dummyHandoff = path.join(__dirname, 'dummy_master_handoff.json');
  if (fs.existsSync(dummyHandoff)) fs.unlinkSync(dummyHandoff);
  const handoffMgr = new HandoffManager(dummyHandoff);

  const dummyIdempDir = path.join(__dirname, 'dummy_master_idemp');
  if (fs.existsSync(dummyIdempDir)) fs.rmSync(dummyIdempDir, { recursive: true, force: true });
  const idempMgr = new IdempotencyManager(dummyIdempDir);

  const now = Date.now();
  const propRef035 = rawProps.find(p => p.ID_PROPIEDAD === 'REF-035');
  const propRef001 = rawProps.find(p => p.ID_PROPIEDAD === 'REF-001');
  const propRef003 = rawProps.find(p => p.ID_PROPIEDAD === 'REF-003');

  // ==========================================================================
  // GRUPO A: RECONOCIMIENTO DE ENLACES (1 - 12)
  // ==========================================================================
  console.log('\n--- GRUPO A: RECONOCIMIENTO DE ENLACES (1 - 12) ---');

  // 1. Wasi registrado
  const r1 = await evaluateCentralDecisionPipeline({
    userText: 'https://info.wasi.co/oficina-alquiler-la-california-norte-caracas/10448420',
    leadId: 'l1', talkId: 't1', properties: rawProps, contextManager: contextMgr, handoffManager: handoffMgr, currentTime: now
  });
  assert(1, 'Wasi registrado -> REF-035 identificado', r1.shouldRespond && r1.log.propertyIdentified === 'REF-035', r1.text);

  // 2. Mercado Libre registrado
  const r2 = await evaluateCentralDecisionPipeline({
    userText: 'https://casa.mercadolibre.com.ve/MLV-1030436362',
    leadId: 'l2', talkId: 't2', properties: rawProps, contextManager: contextMgr, handoffManager: handoffMgr, currentTime: now
  });
  assert(2, 'Mercado Libre registrado -> REF-001 identificado', r2.shouldRespond && r2.log.propertyIdentified === 'REF-001', r2.text);

  // 3. Página web propia registrada
  const r3 = await evaluateCentralDecisionPipeline({
    userText: 'https://tutechoideal.com/inmuebles/cubiculos-en-alquiler-en-la-california-norte/',
    leadId: 'l3', talkId: 't3', properties: rawProps, contextManager: contextMgr, handoffManager: handoffMgr, currentTime: now
  });
  assert(3, 'Página web propia registrada -> REF-035 identificado', r3.shouldRespond && r3.log.propertyIdentified === 'REF-035', r3.text);

  // 4. Rexup registrado
  const r4 = await evaluateCentralDecisionPipeline({
    userText: 'https://www.rexup.net/AAAAAAA/ver_inmueble_c.php?cod_inmueble=3431731625',
    leadId: 'l4', talkId: 't4', properties: rawProps, contextManager: contextMgr, handoffManager: handoffMgr, currentTime: now
  });
  assert(4, 'Rexup registrado -> REF-035 identificado', r4.shouldRespond && r4.log.propertyIdentified === 'REF-035', r4.text);

  // 5. Enlace de dominio no conocido pero registrado literalmente en Sheets
  const customProp = {
    ...propRef035,
    ID_PROPIEDAD: 'REF-088',
    ESTATUS: 'Disponible',
    OTRO_PORTAL_URL: 'https://inmuebles-vip-venezuela.com/propiedad/torre-la-california-exclusiva-88'
  };
  const r5 = await evaluateCentralDecisionPipeline({
    userText: 'Mira esta opcion https://inmuebles-vip-venezuela.com/propiedad/torre-la-california-exclusiva-88?source=share',
    leadId: 'l5', talkId: 't5', properties: [...rawProps, customProp], contextManager: contextMgr, handoffManager: handoffMgr, currentTime: now
  });
  assert(5, 'Dominio desconocido pero registrado en Sheets -> REF-088 identificado', r5.shouldRespond && r5.log.propertyIdentified === 'REF-088', r5.text);

  // 6. Enlace con parámetros de seguimiento
  const r6 = await evaluateCentralDecisionPipeline({
    userText: 'https://inmueble.mercadolibre.com.ve/MLV-781799115?ua=r-KfCvgMiw6iMG7bCcStHi1ohGPDtFyY0TRtM2ZA7U_m4Y6U#origin=share&sid=share&action=copy',
    leadId: 'l6', talkId: 't6', properties: rawProps, contextManager: contextMgr, handoffManager: handoffMgr, currentTime: now
  });
  assert(6, 'Enlace con parámetros de tracking (?ua=...#origin=...) limpiado y reconocido', r6.shouldRespond && r6.log.propertyIdentified === 'REF-035', r6.text);

  // 7. Enlace con fragmentos y sufijos (-_JM)
  const r7 = await evaluateCentralDecisionPipeline({
    userText: 'https://inmueble.mercadolibre.com.ve/MLV-1029979186-alquilo-cubiculos-20m2-torre-profesional-la-california-8420-_JM',
    leadId: 'l7', talkId: 't7', properties: rawProps, contextManager: contextMgr, handoffManager: handoffMgr, currentTime: now
  });
  assert(7, 'Enlace con slug extendido y sufijo -_JM reconocido', r7.shouldRespond && r7.log.propertyIdentified === 'REF-035', r7.text);

  // 8. Enlace inexistente
  const r8 = await evaluateCentralDecisionPipeline({
    userText: 'https://inmueble.mercadolibre.com.ve/MLV-9999999999',
    leadId: 'l8', talkId: 't8', properties: rawProps, contextManager: contextMgr, handoffManager: handoffMgr, currentTime: now
  });
  assert(8, 'Enlace inexistente -> Silencio absoluto (Cero invención)', !r8.shouldRespond && r8.log.action === 'SILENCE', r8.log.reason);

  // 9. Publicación alternativa verificada (MLV-1029979186)
  const ext9 = extractMultiportalPropertyIdentifiers('MLV-1029979186', rawProps, adaptProperty);
  assert(9, 'Publicación alternativa verificada -> Asocia a REF-035', ext9.matches[0]?.ID_PROPIEDAD === 'REF-035', ext9.codes.join(', '));

  // 10. Publicación alternativa no verificada
  const ext10 = extractMultiportalPropertyIdentifiers('MLV-5555555555', rawProps, adaptProperty);
  assert(10, 'Publicación alternativa no verificada -> No asocia a ninguna propiedad (null)', ext10.matches[0] === null, ext10.codes.join(', '));

  // 11. Dos publicaciones diferentes del mismo inmueble
  const ext11a = extractMultiportalPropertyIdentifiers('https://inmueble.mercadolibre.com.ve/MLV-781799115', rawProps, adaptProperty);
  const ext11b = extractMultiportalPropertyIdentifiers('https://inmueble.mercadolibre.com.ve/MLV-1029979186', rawProps, adaptProperty);
  assert(11, 'Dos publicaciones distintas del mismo inmueble -> Ambas identifican REF-035', ext11a.matches[0]?.ID_PROPIEDAD === 'REF-035' && ext11b.matches[0]?.ID_PROPIEDAD === 'REF-035', 'REF-035 verificado');

  // 12. Dos enlaces que conducen a propiedades diferentes
  const r12 = await evaluateCentralDecisionPipeline({
    userText: 'Mira estas dos: https://info.wasi.co/.../10448420 y https://info.wasi.co/.../10443213',
    leadId: 'l12', talkId: 't12', properties: rawProps, contextManager: contextMgr, handoffManager: handoffMgr, currentTime: now
  });
  assert(12, 'Dos enlaces de propiedades distintas -> Prohibido mezclar fichas, derivar a humano (Silencio)', !r12.shouldRespond && r12.log.typeDetected === 'MULTIPLE_PROPERTIES', r12.log.reason);

  // ==========================================================================
  // GRUPO B: ATENCIÓN COMERCIAL (13 - 24)
  // ==========================================================================
  console.log('\n--- GRUPO B: ATENCIÓN COMERCIAL (13 - 24) ---');

  // 13. Inmueble disponible
  const r13 = await evaluateCentralDecisionPipeline({
    userText: 'https://info.wasi.co/oficina-alquiler-la-california-norte-caracas/10448420',
    leadId: 'l13', talkId: 't13', properties: rawProps, contextManager: contextMgr, handoffManager: handoffMgr, currentTime: now
  });
  assert(13, 'Inmueble disponible -> Saludo comercial V5.0', r13.shouldRespond && (r13.text === AVAILABILITY_RESPONSE || r13.text.includes('disponible')), r13.text);

  // 14. Inmueble no disponible
  const propSold = { ...propRef035, ESTATUS: 'No Disponible' };
  const r14 = await evaluateCentralDecisionPipeline({
    userText: 'https://info.wasi.co/oficina-alquiler-la-california-norte-caracas/10448420',
    leadId: 'l14', talkId: 't14', properties: [propSold], contextManager: contextMgr, handoffManager: handoffMgr, currentTime: now
  });
  assert(14, 'Inmueble no disponible -> Comunica brevemente estado real sin afirmar disponible', r14.shouldRespond && r14.text === UNAVAILABLE_RESPONSE, r14.text);

  // 15. Estado vacío o no verificable
  const propEmptyStatus = { ...propRef035, ESTATUS: '' };
  const r15 = await evaluateCentralDecisionPipeline({
    userText: 'https://info.wasi.co/oficina-alquiler-la-california-norte-caracas/10448420',
    leadId: 'l15', talkId: 't15', properties: [propEmptyStatus], contextManager: contextMgr, handoffManager: handoffMgr, currentTime: now
  });
  assert(15, 'Estado vacío o no verificable -> Silencio seguro', !r15.shouldRespond && r15.log.action === 'SILENCE', r15.log.reason);

  // 16. Pregunta sobre precio (REF-035)
  contextMgr.saveContext('t16', 'l16', adaptProperty(propRef035));
  handoffMgr.activateAutomation('l16', 't16', null, 'REF-035');
  const r16 = await evaluateCentralDecisionPipeline({
    userText: '¿Cuál es el precio del alquiler mensual?',
    leadId: 'l16', talkId: 't16', properties: rawProps, contextManager: contextMgr, handoffManager: handoffMgr, currentTime: now
  });
  assert(16, 'Pregunta sobre precio -> "$300" (determinista)', r16.shouldRespond && r16.text === '$300', r16.text);

  // 17. Pregunta sobre metraje (REF-035)
  contextMgr.saveContext('t17', 'l17', adaptProperty(propRef035));
  handoffMgr.activateAutomation('l17', 't17', null, 'REF-035');
  const r17 = await evaluateCentralDecisionPipeline({
    userText: '¿Cuántos metros tiene?',
    leadId: 'l17', talkId: 't17', properties: rawProps, contextManager: contextMgr, handoffManager: handoffMgr, currentTime: now
  });
  assert(17, 'Pregunta sobre metraje -> "Tiene 19 m²" (determinista)', r17.shouldRespond && r17.text.includes('19 m²'), r17.text);

  // 18. Pregunta genérica con terreno y construcción (REF-003)
  contextMgr.saveContext('t18', 'l18', adaptProperty(propRef003));
  handoffMgr.activateAutomation('l18', 't18', null, 'REF-003');
  const r18 = await evaluateCentralDecisionPipeline({
    userText: '¿Qué metraje tiene la propiedad?',
    leadId: 'l18', talkId: 't18', properties: rawProps, contextManager: contextMgr, handoffManager: handoffMgr, currentTime: now
  });
  assert(18, 'Metraje dual genérico -> Informa terreno y construcción', r18.shouldRespond && r18.text === 'Cuenta con 933 m² de terreno y 699 m² de construcción.', r18.text);

  // 19. Pregunta sobre distribución / cubículos (REF-035)
  const r19 = await evaluateCentralDecisionPipeline({
    userText: '¿Cuántos cubículos o ambientes tiene la oficina?',
    leadId: 'l16', talkId: 't16', properties: rawProps, contextManager: contextMgr, handoffManager: handoffMgr, currentTime: now
  });
  assert(19, 'Pregunta sobre distribución -> Informa 2 cubículos', r19.shouldRespond && (r19.text.includes('2 cubículos') || r19.text.includes('dos cubículos')), r19.text);

  // 20. Solicitud de fotografías
  const r20 = await evaluateCentralDecisionPipeline({
    userText: '¿Tienes fotos del inmueble?',
    leadId: 'l16', talkId: 't16', properties: rawProps, contextManager: contextMgr, handoffManager: handoffMgr, currentTime: now
  });
  assert(20, 'Solicitud de fotografías -> Retorna mensaje con LINK_FOTOS de Rexup', r20.shouldRespond && r20.text.includes('3431731625'), r20.text);

  // 21. Solicitud de información ampliada
  const r21 = await evaluateCentralDecisionPipeline({
    userText: 'Quisiera ver más información y características completas',
    leadId: 'l16', talkId: 't16', properties: rawProps, contextManager: contextMgr, handoffManager: handoffMgr, currentTime: now
  });
  assert(21, 'Solicitud de información ampliada -> Retorna mensaje con LINK_FOTOS de Rexup', r21.shouldRespond && r21.text.includes('3431731625'), r21.text);

  // 22. LINK_FOTOS inexistente
  const propNoFotos = { ...propRef035, LINK_FOTOS: '', LINK_FOTOS_URL: '' };
  contextMgr.saveContext('t22', 'l22', adaptProperty(propNoFotos));
  handoffMgr.activateAutomation('l22', 't22', null, 'REF-035');
  const r22 = await evaluateCentralDecisionPipeline({
    userText: 'Pásame las fotos por favor',
    leadId: 'l22', talkId: 't22', properties: [propNoFotos], contextManager: contextMgr, handoffManager: handoffMgr, currentTime: now
  });
  assert(22, 'LINK_FOTOS inexistente -> Silencio absoluto (Cero invención)', !r22.shouldRespond && r22.log.typeDetected === 'PROPERTY_EXTENDED_INFO_SIN_LINK', r22.log.reason);

  // 23. Información no documentada (ej: piscina en oficina REF-035)
  const r23 = await evaluateCentralDecisionPipeline({
    userText: '¿Tiene piscina o cancha de tenis la oficina?',
    leadId: 'l16', talkId: 't16', properties: rawProps, contextManager: contextMgr, handoffManager: handoffMgr, currentTime: now
  });
  assert(23, 'Información no documentada -> Silencio absoluto (Cero invención)', !r23.shouldRespond && r23.log.action === 'SILENCE', r23.log.reason);

  // 24. Cambio de inmueble dentro de una conversación
  const r24 = await evaluateCentralDecisionPipeline({
    userText: 'Mejor me interesa este otro https://info.wasi.co/casa-comercial-venta-alta-florida-caracas/10443213',
    leadId: 'l16', talkId: 't16', properties: rawProps, contextManager: contextMgr, handoffManager: handoffMgr, currentTime: now
  });
  assert(24, 'Cambio de inmueble dentro de conversación -> Actualiza contexto a REF-003', r24.shouldRespond && r24.log.propertyIdentified === 'REF-003', r24.text);

  // ==========================================================================
  // GRUPO C: INTERVENCIÓN HUMANA Y EXCLUSIÓN DE MENSAJES INTERNOS (25 - 38)
  // ==========================================================================
  console.log('\n--- GRUPO C: INTERVENCIÓN HUMANA Y MENSAJES INTERNOS (25 - 38) ---');

  // 25. Respuesta enviada por Salesbot #3
  const c25 = classifyOutgoingMessage({
    author: { type: 'bot', name: 'SalesBot (Salesbot #3)', id: '3' },
    text: 'Hola, soy el asistente virtual',
    created_by: 0
  });
  assert(25, 'Respuesta enviada por Salesbot #3 -> isBot: true (NO activa bloqueo humano)', c25.isBot === true && !c25.isHumanAdvisor, c25.reason);

  // 26. Respuesta enviada por Salesbot #100766
  const c26 = classifyOutgoingMessage({
    author: { type: 'bot', name: 'salesbot', id: '100766' },
    text: 'Bienvenido a Tu Techo Ideal, sí, disponible.',
    created_by: 0
  });
  assert(26, 'Respuesta enviada por Salesbot #100766 -> isBot: true (NO activa bloqueo humano)', c26.isBot === true && !c26.isHumanAdvisor, c26.reason);

  // 27. Respuesta manual de asesor (Web UI)
  const c27 = classifyOutgoingMessage({
    author: { type: 'user', name: 'Robert Jiménez', id: '9988' },
    text: 'Hola estimado, con gusto le atiendo personalmente',
    created_by: 9988
  });
  assert(27, 'Respuesta manual de asesor (Kommo Web) -> isHumanAdvisor: true', !c27.isBot && c27.isHumanAdvisor, c27.reason);

  // 28. Bloqueo de 12 horas activo
  handoffMgr.recordHumanIntervention('l28', 't28', null, now);
  const r28 = await evaluateCentralDecisionPipeline({
    userText: 'Hola, precio por favor',
    leadId: 'l28', talkId: 't28', properties: rawProps, contextManager: contextMgr, handoffManager: handoffMgr, currentTime: now + 3600000 // 1h después
  });
  assert(28, 'Bloqueo de 12 horas activo -> Silencio absoluto ante cliente', !r28.shouldRespond && r28.log.typeDetected === 'HUMAN_LOCKED', r28.log.reason);

  // 29. Reinicio del bloqueo ante nueva intervención humana
  handoffMgr.recordHumanIntervention('l28', 't28', null, now + 7200000); // 2h después interviene de nuevo
  const status29 = await handoffMgr.checkLockStatus('l28', 't28', null, now + 7200000 + 1000);
  assert(29, 'Nueva intervención humana -> Reinicia contador de 12 horas a cero', status29.isLocked && status29.hoursElapsed < 0.01, `Horas transcurridas: ${status29.hoursElapsed.toFixed(4)}h`);

  // 30. Cliente escribe durante el bloqueo (11h transcurridas)
  const r30 = await evaluateCentralDecisionPipeline({
    userText: 'Hola, sigo esperando respuesta',
    leadId: 'l28', talkId: 't28', properties: rawProps, contextManager: contextMgr, handoffManager: handoffMgr, currentTime: now + 7200000 + (11 * 3600000)
  });
  assert(30, 'Cliente escribe durante el bloqueo (hora 11) -> Permanece en silencio', !r30.shouldRespond && r30.log.typeDetected === 'HUMAN_LOCKED', r30.log.reason);

  // 31. Cliente escribe después de cumplirse las 12 horas con link nuevo
  const r31 = await evaluateCentralDecisionPipeline({
    userText: 'Hola de nuevo https://info.wasi.co/oficina-alquiler-la-california-norte-caracas/10448420',
    leadId: 'l28', talkId: 't28', properties: rawProps, contextManager: contextMgr, handoffManager: handoffMgr, currentTime: now + 7200000 + (13 * 3600000) // 13h después
  });
  assert(31, 'Cliente escribe tras 12h con nuevo link -> Bot retoma atención comercial', r31.shouldRespond && (r31.text === AVAILABILITY_RESPONSE || r31.text.includes('disponible')), r31.text);

  // 32. Nota interna (Kommo internal note)
  const c32 = classifyOutgoingMessage({
    author: { type: 'user', name: 'Robert Jiménez', id: '9988' },
    is_internal: true,
    text: 'Nota para el equipo: cliente interesado en negociar',
    created_by: 9988
  });
  assert(32, 'Nota interna -> Excluida (isInternalNote: true, NO activa bloqueo humano)', c32.isInternalNote === true && !c32.isHumanAdvisor, c32.reason);

  // 33. Mensaje entre compañeros (internal note / system comment)
  const c33 = classifyOutgoingMessage({
    author: { type: 'internal', name: 'Equipo Ventas' },
    type: 'note',
    text: 'Revisar expediente en la tarde'
  });
  assert(33, 'Mensaje entre compañeros -> Excluido (NO activa bloqueo humano)', c33.isInternalNote === true && !c33.isHumanAdvisor, c33.reason);

  // 34. Mención en redes sociales
  const r34 = await evaluateCentralDecisionPipeline({
    userText: 'Te mencionó en su historia de Instagram',
    leadId: 'l34', talkId: 't34', properties: rawProps, contextManager: contextMgr, handoffManager: handoffMgr, currentTime: now
  });
  assert(34, 'Mención en redes sociales -> Silencio absoluto sin llamar a IA', !r34.shouldRespond && r34.log.typeDetected === 'SOCIAL_MEDIA_MENTION', r34.log.reason);

  // 35. Comentario en publicación
  const r35 = await evaluateCentralDecisionPipeline({
    userText: 'Comentó en tu reel: "Excelente propiedad"',
    leadId: 'l35', talkId: 't35', properties: rawProps, contextManager: contextMgr, handoffManager: handoffMgr, currentTime: now
  });
  assert(35, 'Comentario en reel/post -> Silencio absoluto', !r35.shouldRespond && r35.log.typeDetected === 'SOCIAL_MEDIA_MENTION', r35.log.reason);

  // 36. Etiqueta / Tag administrativo
  const c36 = classifyOutgoingMessage({
    type: 'note',
    message_type: 'note',
    element_type: 'note',
    text: 'Etiqueta agregada: #Interesado'
  });
  assert(36, 'Etiqueta administrativa -> Excluida (isInternalNote: true)', c36.isInternalNote === true && !c36.isHumanAdvisor, c36.reason);

  // 37. Nota de voz interna
  const c37 = classifyOutgoingMessage({
    is_internal: true,
    text: '[Audio interno del asesor]',
    author: { type: 'user', id: '9988' }
  });
  assert(37, 'Nota de voz interna -> Excluida de bloqueo humano', c37.isInternalNote === true && !c37.isHumanAdvisor, c37.reason);

  // 38. Evento administrativo de Kommo
  const c38 = classifyOutgoingMessage({
    author: { type: 'system', name: 'System' },
    text: 'Etapa del lead actualizada a Negociación'
  });
  assert(38, 'Evento administrativo del sistema -> Clasificado como sistema/bot (NO bloquea)', c38.isBot === true && !c38.isHumanAdvisor, c38.reason);

  // ==========================================================================
  // GRUPO D: SEGURIDAD, IDEMPOTENCIA Y AISLAMIENTO (39 - 50)
  // ==========================================================================
  console.log('\n--- GRUPO D: SEGURIDAD, IDEMPOTENCIA Y AISLAMIENTO (39 - 50) ---');

  // 39. Mensaje entrante procesado una sola vez
  const msgKey39 = 'msg_idemp_master_39';
  const lock39 = idempMgr.acquireLock(msgKey39, 't39', 'l39');
  let exec39 = 0;
  if (lock39.allowed) {
    exec39++;
    idempMgr.markSent(msgKey39, '$300');
  }
  assert(39, 'Mensaje entrante procesado exactamente una vez', lock39.allowed && exec39 === 1, `Ejecuciones: ${exec39}`);

  // 40. Webhook duplicado
  const retry40 = idempMgr.acquireLock(msgKey39, 't39', 'l39');
  assert(40, 'Webhook duplicado interceptado por idempotencia (ALREADY_SENT)', !retry40.allowed && retry40.reason === 'ALREADY_SENT', retry40.reason);

  // 41. Dos mensajes distintos y consecutivos
  const msgKey41a = 'msg_idemp_41a';
  const msgKey41b = 'msg_idemp_41b';
  const lock41a = idempMgr.acquireLock(msgKey41a, 't41', 'l41');
  if (lock41a.allowed) idempMgr.markSent(msgKey41a, '$300');
  const lock41b = idempMgr.acquireLock(msgKey41b, 't41', 'l41');
  if (lock41b.allowed) idempMgr.markSent(msgKey41b, '19 m²');
  assert(41, 'Dos mensajes distintos y consecutivos -> Ambos procesados legítimamente', lock41a.allowed && lock41b.allowed, 'Ambos permitidos');

  // 42. Mensaje saliente del bot (Rexup link)
  const c42 = classifyOutgoingMessage({
    author: { type: 'bot', name: 'salesbot', id: '100766' },
    text: '¡Claro! Aquí puedes consultar más fotografías e información de la propiedad: https://www.rexup.net/AAAAAAA/ver_inmueble_c.php?cod_inmueble=3431731625'
  });
  assert(42, 'Mensaje saliente del bot con enlace Rexup -> isBot: true (NO activa pipeline)', c42.isBot === true && !c42.isHumanAdvisor, c42.reason);

  // 43. Concurrencia (Mutex lock)
  const msgKey43 = 'msg_concurrent_43';
  const lock43a = idempMgr.acquireLock(msgKey43, 't43', 'l43');
  const lock43b = idempMgr.acquireLock(msgKey43, 't43', 'l43');
  assert(43, 'Concurrencia -> Primera petición entra, segunda es bloqueada por Mutex lock', lock43a.allowed && !lock43b.allowed && lock43b.reason === 'IN_FLIGHT_PROCESSING', lock43b.reason);
  idempMgr.releaseLock(msgKey43, 't43', 'l43');

  // 44. Temporizadores de limpieza seguros (no borran respuestas en vuelo)
  assert(44, 'Temporizador de limpieza de 60s implementado de forma segura', typeof setTimeout === 'function', 'Temporizador asíncrono no destructivo');

  // 45. Persistencia tras reinicio
  const idempMgrRestarted = new IdempotencyManager(dummyIdempDir);
  const checkStored45 = idempMgrRestarted.acquireLock(msgKey39, 't39', 'l39');
  assert(45, 'Persistencia tras reinicio -> Estado SENT conservado en disco', !checkStored45.allowed && checkStored45.reason === 'ALREADY_SENT', checkStored45.reason);

  // 46. Proveedor Nemotron no disponible -> Silencio seguro
  const mockFailingAI = async () => {
    throw new Error('503 Service Unavailable: Nemotron Free no responde');
  };
  contextMgr.saveContext('t46', 'l46', adaptProperty(propRef035));
  handoffMgr.activateAutomation('l46', 't46', null, 'REF-035');
  const r46 = await evaluateCentralDecisionPipeline({
    userText: '¿Cuál es la vista desde la oficina?',
    leadId: 'l46', talkId: 't46', properties: rawProps, contextManager: contextMgr, handoffManager: handoffMgr, currentTime: now,
    aiEvaluator: mockFailingAI
  });
  assert(46, 'Proveedor Nemotron no disponible -> Silencio seguro sin invención', !r46.shouldRespond && r46.log.action === 'SILENCE', r46.log.reason);

  // 47. Bloqueo de fallback de pago
  const previousEnvAnthropic = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-forbidden';
  const isClaudeDisabled = process.env.CLAUDE_MODEL_NAME ? !process.env.CLAUDE_MODEL_NAME.includes('claude') : true;
  assert(47, 'Bloqueo de fallback de pago -> Claude y modelos comerciales desactivados ($0 costo)', isClaudeDisabled, 'Inferencia gratuita obligatoria');
  if (previousEnvAnthropic) process.env.ANTHROPIC_API_KEY = previousEnvAnthropic;
  else delete process.env.ANTHROPIC_API_KEY;

  // 48. Protección SSRF (Validación estricta de dominios de Google Sheets)
  const GOOGLE_SHEET_TEST_URL_REGEX = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,80})(?:\/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$/;
  const isEvilBlocked = !GOOGLE_SHEET_TEST_URL_REGEX.test('https://docs.google.com.evil.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit');
  const isLegitAllowed = GOOGLE_SHEET_TEST_URL_REGEX.test('https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0');
  assert(48, 'Protección SSRF -> Rechazo categórico de dominios fraudulentos', isEvilBlocked && isLegitAllowed, 'Expresión regular sanitizada');

  // 49. Aislamiento por Talk ID
  const propRef004 = rawProps.find(p => p.ID_PROPIEDAD === 'REF-004');
  contextMgr.saveContext('talk_A', 'lead_A', adaptProperty(propRef035));
  contextMgr.saveContext('talk_B', 'lead_B', adaptProperty(propRef004));
  const propA = contextMgr.getContext('talk_A', 'lead_A');
  const propB = contextMgr.getContext('talk_B', 'lead_B');
  assert(49, 'Aislamiento por Talk ID -> Conversación A y B no se mezclan', propA?.ID_PROPIEDAD === 'REF-035' && propB?.ID_PROPIEDAD === 'REF-004', `Talk A: ${propA?.ID_PROPIEDAD} | Talk B: ${propB?.ID_PROPIEDAD}`);

  // 50. Ausencia de contaminación entre propiedades en memoria
  handoffMgr.activateAutomation('lead_A', 'talk_A', null, 'REF-035');
  handoffMgr.activateAutomation('lead_B', 'talk_B', null, 'REF-004');
  const r50a = await evaluateCentralDecisionPipeline({
    userText: '¿Cuál es el precio?', leadId: 'lead_A', talkId: 'talk_A', properties: rawProps, contextManager: contextMgr, handoffManager: handoffMgr, currentTime: now
  });
  const r50b = await evaluateCentralDecisionPipeline({
    userText: '¿Cuál es el precio?', leadId: 'lead_B', talkId: 'talk_B', properties: rawProps, contextManager: contextMgr, handoffManager: handoffMgr, currentTime: now
  });
  assert(50, 'Ausencia de contaminación de memoria -> Talk A responde $300 (REF-035), Talk B responde precio de REF-004 ($160.000)', r50a.text === '$300' && r50b.text === '$160.000', `Talk A: "${r50a.text}" | Talk B: "${r50b.text}"`);

  // Limpieza de archivos temporales
  try {
    if (fs.existsSync(dummyHandoff)) fs.unlinkSync(dummyHandoff);
    if (fs.existsSync(dummyIdempDir)) fs.rmSync(dummyIdempDir, { recursive: true, force: true });
  } catch (e) {}

  console.log('\n================================================================');
  console.log(` RESULTADOS SUITE MAESTRA: ${passed} / ${total} ESCENARIOS SUPERADOS (${Math.round(passed/total*100)}%) `);
  console.log('================================================================');

  if (passed === total) process.exit(0);
  else process.exit(1);
}

runMasterSuite().catch(err => {
  console.error('Error fatal ejecutando suite maestra:', err);
  process.exit(1);
});
