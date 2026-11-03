/**
 * ============================================================================
 * TEST SUITE — NUEVA LÓGICA DEL BOT INMOBILIARIO TU TECHO IDEAL
 * ============================================================================
 * 
 * Verificación exhaustiva de los 16 escenarios obligatorios originales
 * MÁS 7 pruebas críticas de blindaje técnico (Total: 23 escenarios):
 * 
 * --- Bloque 1: Escenarios Originales (1 a 16) ---
 * 1. Mención de historia -> Ignorar sin llamar a IA.
 * 2. Enlace Wasi disponible -> "Sí, disponible.".
 * 3. Búsqueda por zona con coincidencias -> "Sí, disponible." (sin listado).
 * 4. Pregunta por metros cuadrados (dato en Sheets) -> Responde dato exacto.
 * 5. Pregunta por condominio (dato no aparece) -> Silencio absoluto.
 * 6. Pregunta por estacionamiento (descripción indica que no tiene) -> Responde que no tiene.
 * 7. Crédito Venezuela Renace (Sheets dice que sí) -> "Sí".
 * 8. Crédito Venezuela Renace (Sheets dice que no) -> "No".
 * 9. Crédito Venezuela Renace (dato no existe en Sheets) -> "Voy a consultar y ya le informo.".
 * 10. Solicitud de reunión -> Silencio y atención humana.
 * 11. Ofrecimiento para vender o alquilar inmueble propio -> Silencio y atención humana.
 * 12. Humano responde y cliente escribe antes de 24h -> Silencio (bloqueo activo).
 * 13. Humano responde, transcurren 24h y cliente envía nuevo enlace Wasi -> Se permite evaluar.
 * 14. Cliente envía dos enlaces diferentes -> Derivar al humano sin mezclar.
 * 15. Propiedad no encontrada en Sheets -> No inventar, silencio.
 * 16. Servidor se reinicia mientras conversación está bloqueada -> El bloqueo persiste.
 * 
 * --- Bloque 2: Nuevas Pruebas Críticas de Blindaje (17 a 23) ---
 * 17. Reinicio sin archivo local: Kommo API remota tiene evento humano (<24h) -> Reconstruye bloqueo, silencio.
 * 18. Falla temporal de Kommo API (error 500/timeout) sin archivo local -> Falla cerrada / Silencio seguro.
 * 19. Mensaje con precios ($100000, $40.000) -> No se confunde con código Wasi, silencio.
 * 20. Mensaje con teléfonos (04143115105, +584142504024) -> No se confunde con código Wasi, silencio.
 * 21. Estatus ambiguo ("No Disponible", "Disponible en 15 días") -> Equivalencia exacta exige 'disponible', silencio.
 * 22. Base de datos de Google Sheets vacía o no disponible -> Silencio seguro preventivo.
 * 23. Reactivación post-24h sin enlace Wasi ("Hola, qué tal") -> Permanece en silencio (requiere nuevo enlace Wasi).
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  evaluateCentralDecisionPipeline,
  HandoffManager
} = require('./pipeline_decision.js');

// Dataset de prueba representativo fiel a las columnas y estructura real de Google Sheets
const mockProperties = [
  {
    ID_PROPIEDAD: 'REF-001',
    CODIGO_WASI: '10493109',
    TIPO: 'Apartamento',
    OPERACION: 'Venta',
    ZONA: 'Los Samanes',
    ESTATUS: 'Disponible',
    Wasi_URL: 'https://info.wasi.co/apartamento-venta-los-samanes-caracas/10493109',
    DESCRIPCION_BREVE: 'Apartamento de 120 m², tres habitaciones, dos baños. No posee puesto de estacionamiento propio. Cuenta con tanque interno de 600 litros. Se aceptan diversas formas de pago que incluyen crédito Venezuela Renace, transferencias y efectivo.'
  },
  {
    ID_PROPIEDAD: 'REF-002',
    CODIGO_WASI: '10544010',
    TIPO: 'Apartamento',
    OPERACION: 'Venta',
    ZONA: 'Lomas del Sol',
    ESTATUS: 'Disponible',
    Wasi_URL: 'https://info.wasi.co/apartamento-venta-lomas-del-sol-caracas/10544010',
    DESCRIPCION_BREVE: 'Apartamento de 83 m², dos habitaciones, dos baños, dos puestos de estacionamiento. Financiamiento: No posee financiamiento. Créditos: No acepta crédito de ninguna entidad bancaria ni Venezuela Renace. Formas de pago: Efectivo y Zelle.'
  },
  {
    ID_PROPIEDAD: 'REF-003',
    CODIGO_WASI: '10539723',
    TIPO: 'Apartamento',
    OPERACION: 'Alquiler',
    ZONA: 'La Candelaria',
    ESTATUS: 'Disponible',
    Wasi_URL: 'https://info.wasi.co/apartamento-alquiler-la-candelaria-caracas/10539723',
    DESCRIPCION_BREVE: 'Apartamento de 55 m², Torre 200, dos ambientes, un baño. Canon $500. No se especifican créditos ni financiamientos en la fuente. Gas: No posee gas directo, cocina eléctrica.'
  },
  {
    ID_PROPIEDAD: 'REF-004',
    CODIGO_WASI: '10441456',
    TIPO: 'Casa',
    OPERACION: 'Alquiler',
    ZONA: 'Prados del Este',
    ESTATUS: 'Disponible',
    Wasi_URL: 'https://info.wasi.co/casa-alquiler-prados-del-este-caracas/10441456',
    DESCRIPCION_BREVE: 'Hermosa casa en Prados del Este de 400 m², cuatro habitaciones y cuatro puestos de estacionamiento.'
  },
  {
    ID_PROPIEDAD: 'REF-005',
    CODIGO_WASI: '10443213',
    TIPO: 'Apartamento',
    OPERACION: 'Venta',
    ZONA: 'La Boyera',
    ESTATUS: 'No Disponible',
    Wasi_URL: 'https://info.wasi.co/apartamento-venta-la-boyera-caracas/10443213',
    DESCRIPCION_BREVE: 'Apartamento en La Boyera ya reservado.'
  },
  {
    ID_PROPIEDAD: 'REF-006',
    CODIGO_WASI: '10466376',
    TIPO: 'Apartamento',
    OPERACION: 'Venta',
    ZONA: 'Chacao',
    ESTATUS: 'Disponible en 15 días', // Caso de prueba para equivalencia exacta de estatus
    Wasi_URL: 'https://info.wasi.co/apartamento-venta-chacao-caracas/10466376',
    DESCRIPCION_BREVE: 'Apartamento en Chacao en remodelación final.'
  }
];

async function runTests() {
  console.log('================================================================');
  console.log(' INICIANDO SUITE DE PRUEBAS DE LA NUEVA LÓGICA (23 ESCENARIOS) ');
  console.log('================================================================\n');

  const testHandoffFile = path.join(__dirname, 'test_handoffs_temp.json');
  if (fs.existsSync(testHandoffFile)) fs.unlinkSync(testHandoffFile);

  const handoffManager = new HandoffManager(testHandoffFile);
  let passedCount = 0;
  const results = [];

  function recordResult(testNum, name, condition, details = '') {
    if (condition) {
      console.log(`✅ [Test ${testNum}/23] PASÓ: ${name}`);
      if (details) console.log(`   Detalle: ${details}`);
      passedCount++;
      results.push({ testNum, name, status: 'PASSED', details });
    } else {
      console.error(`❌ [Test ${testNum}/23] FALLÓ: ${name}`);
      if (details) console.error(`   Detalle: ${details}`);
      results.push({ testNum, name, status: 'FAILED', details });
    }
  }

  // --------------------------------------------------------------------------
  // TEST 1: Mención en historia de Instagram -> Silencio sin llamar a IA
  // --------------------------------------------------------------------------
  const res1 = await evaluateCentralDecisionPipeline({
    userText: 'Te mencionó en su historia',
    leadId: 'lead_t1',
    properties: mockProperties,
    handoffManager
  });
  recordResult(
    1,
    'Mención: "Te mencionó en su historia" -> Silencio sin llamar a IA',
    res1.shouldRespond === false && res1.text === null && res1.log.calledAI === false,
    `Respondió: ${res1.shouldRespond}, Llamó IA: ${res1.log.calledAI}, Motivo: ${res1.log.reason}`
  );

  // --------------------------------------------------------------------------
  // TEST 2: Cliente envía enlace de Wasi con propiedad disponible -> "Sí, disponible."
  // --------------------------------------------------------------------------
  const res2 = await evaluateCentralDecisionPipeline({
    userText: 'Buen día Robert, soy Ronald y estoy interesado en el inmueble https://info.wasi.co/apartamento-venta-los-samanes-caracas/10493109?shared=whatsapp',
    leadId: 'lead_t2',
    properties: mockProperties,
    handoffManager
  });
  recordResult(
    2,
    'Cliente envía enlace de Wasi con propiedad disponible -> "Sí, disponible."',
    res2.shouldRespond === true && res2.text === 'Sí, disponible.',
    `Respondió: "${res2.text}", Propiedad: ${res2.log.propertyIdentified}`
  );

  // --------------------------------------------------------------------------
  // TEST 3: Cliente pregunta por zona con coincidencias disponibles -> "Sí, disponible." sin listado
  // --------------------------------------------------------------------------
  const res3 = await evaluateCentralDecisionPipeline({
    userText: 'Hola, quiero información sobre inmuebles en Prados del Este',
    leadId: 'lead_t3',
    properties: mockProperties,
    handoffManager
  });
  recordResult(
    3,
    'Cliente pregunta por una zona con coincidencias -> "Sí, disponible." sin listado',
    res3.shouldRespond === true && res3.text === 'Sí, disponible.',
    `Respondió: "${res3.text}", Motivo: ${res3.log.reason}`
  );

  // --------------------------------------------------------------------------
  // TEST 4: Pregunta cuántos metros tiene (dato en Sheets) -> Responde dato exacto
  // --------------------------------------------------------------------------
  const targetProp1 = mockProperties.find(p => p.ID_PROPIEDAD === 'REF-001');
  const res4 = await evaluateCentralDecisionPipeline({
    userText: '¿Cuántos metros cuadrados tiene?',
    leadId: 'lead_t4',
    properties: mockProperties,
    activePropertyContext: targetProp1,
    handoffManager
  });
  const text4 = (res4.text || '').toLowerCase();
  recordResult(
    4,
    'Pregunta cuántos metros tiene (dato en Sheets) -> Responde dato exacto',
    res4.shouldRespond === true && (text4.includes('120') || text4.includes('120 m²')),
    `Respondió: "${res4.text}"`
  );

  // --------------------------------------------------------------------------
  // TEST 5: Pregunta cuánto es el condominio (dato NO aparece) -> Silencio
  // --------------------------------------------------------------------------
  const res5 = await evaluateCentralDecisionPipeline({
    userText: '¿Cuánto se paga de condominio en ese apartamento?',
    leadId: 'lead_t5',
    properties: mockProperties,
    activePropertyContext: targetProp1,
    handoffManager
  });
  recordResult(
    5,
    'Pregunta cuánto es el condominio (dato NO aparece) -> Silencio absoluto',
    res5.shouldRespond === false && res5.text === null,
    `Respondió: ${res5.shouldRespond}, Texto: ${res5.text}, Motivo: ${res5.log.reason}`
  );

  // --------------------------------------------------------------------------
  // TEST 6: Pregunta si tiene estacionamiento y descripción dice que NO tiene -> Responde que no tiene
  // --------------------------------------------------------------------------
  const res6 = await evaluateCentralDecisionPipeline({
    userText: '¿Tiene puesto de estacionamiento?',
    leadId: 'lead_t6',
    properties: mockProperties,
    activePropertyContext: targetProp1,
    handoffManager
  });
  const text6 = (res6.text || '').toLowerCase();
  recordResult(
    6,
    'Pregunta si tiene estacionamiento (descripción aclara que no tiene) -> Responde que no tiene',
    res6.shouldRespond === true && text6.includes('no') && (text6.includes('estacionamiento') || text6.includes('puesto')),
    `Respondió: "${res6.text}"`
  );

  // --------------------------------------------------------------------------
  // TEST 7: Pregunta si acepta crédito Venezuela Renace (Sheets dice que sí) -> "Sí"
  // --------------------------------------------------------------------------
  const res7 = await evaluateCentralDecisionPipeline({
    userText: '¿Aceptan crédito Venezuela Renace para este inmueble?',
    leadId: 'lead_t7',
    properties: mockProperties,
    activePropertyContext: targetProp1,
    handoffManager
  });
  recordResult(
    7,
    'Pregunta crédito Venezuela Renace (Sheets dice que sí) -> "Sí"',
    res7.shouldRespond === true && res7.text === 'Sí',
    `Respondió: "${res7.text}"`
  );

  // --------------------------------------------------------------------------
  // TEST 8: Pregunta por ese crédito y Sheets dice que no -> "No"
  // --------------------------------------------------------------------------
  const targetProp2 = mockProperties.find(p => p.ID_PROPIEDAD === 'REF-002');
  const res8 = await evaluateCentralDecisionPipeline({
    userText: '¿Se puede comprar con crédito Venezuela Renace?',
    leadId: 'lead_t8',
    properties: mockProperties,
    activePropertyContext: targetProp2,
    handoffManager
  });
  recordResult(
    8,
    'Pregunta crédito Venezuela Renace (Sheets dice que no) -> "No"',
    res8.shouldRespond === true && res8.text === 'No',
    `Respondió: "${res8.text}"`
  );

  // --------------------------------------------------------------------------
  // TEST 9: Pregunta por ese crédito y dato no existe en Sheets -> "Voy a consultar y ya le informo."
  // --------------------------------------------------------------------------
  const targetProp3 = mockProperties.find(p => p.ID_PROPIEDAD === 'REF-003');
  const res9 = await evaluateCentralDecisionPipeline({
    userText: '¿Acepta crédito Venezuela Renace este apartamento de La Candelaria?',
    leadId: 'lead_t9',
    properties: mockProperties,
    activePropertyContext: targetProp3,
    handoffManager
  });
  recordResult(
    9,
    'Pregunta crédito Venezuela Renace (dato no existe) -> "Voy a consultar y ya le informo."',
    res9.shouldRespond === true && res9.text === 'Voy a consultar y ya le informo.',
    `Respondió: "${res9.text}"`
  );

  // --------------------------------------------------------------------------
  // TEST 10: Cliente solicita una reunión -> Silencio y atención humana
  // --------------------------------------------------------------------------
  const res10 = await evaluateCentralDecisionPipeline({
    userText: 'Me gustaría agendar una reunión o videollamada para conversar con ustedes',
    leadId: 'lead_t10',
    properties: mockProperties,
    handoffManager
  });
  recordResult(
    10,
    'Cliente solicita una reunión -> Silencio y atención humana',
    res10.shouldRespond === false && res10.text === null && res10.log.action === 'SILENCE',
    `Respondió: ${res10.shouldRespond}, Motivo: ${res10.log.reason}`
  );

  // --------------------------------------------------------------------------
  // TEST 11: Cliente ofrece vender o alquilar su inmueble -> Silencio y atención humana
  // --------------------------------------------------------------------------
  const res11 = await evaluateCentralDecisionPipeline({
    userText: 'Buenas tardes, quiero vender mi propiedad en Los Palos Grandes con ustedes',
    leadId: 'lead_t11',
    properties: mockProperties,
    handoffManager
  });
  recordResult(
    11,
    'Cliente ofrece vender o alquilar su inmueble -> Silencio y atención humana',
    res11.shouldRespond === false && res11.text === null && res11.log.action === 'SILENCE',
    `Respondió: ${res11.shouldRespond}, Motivo: ${res11.log.reason}`
  );

  // --------------------------------------------------------------------------
  // TEST 12: Un humano responde al cliente y este vuelve a escribir antes de 24h -> Silencio
  // --------------------------------------------------------------------------
  const now = Date.now();
  const humanInterventionTime = now - (2 * 60 * 60 * 1000); // Hace 2 horas
  handoffManager.recordHumanIntervention('lead_t12', 'talk_t12', 'contact_t12', humanInterventionTime);

  const res12 = await evaluateCentralDecisionPipeline({
    userText: '¿Sigue disponible el apartamento?',
    leadId: 'lead_t12',
    talkId: 'talk_t12',
    contactId: 'contact_t12',
    properties: mockProperties,
    handoffManager,
    currentTime: now
  });
  recordResult(
    12,
    'Humano respondió y cliente escribe antes de 24h -> Silencio absoluto',
    res12.shouldRespond === false && res12.log.typeDetected === 'HUMAN_LOCKED',
    `Respondió: ${res12.shouldRespond}, Motivo: ${res12.log.reason}`
  );

  // --------------------------------------------------------------------------
  // TEST 13: Humano responde, transcurren 24h y cliente envía nuevo enlace Wasi -> Se permite evaluar
  // --------------------------------------------------------------------------
  const pastHumanTime = now - (25 * 60 * 60 * 1000); // Hace 25 horas
  handoffManager.recordHumanIntervention('lead_t13', 'talk_t13', 'contact_t13', pastHumanTime);

  const res13 = await evaluateCentralDecisionPipeline({
    userText: 'Hola, ahora me interesa este otro inmueble https://info.wasi.co/apartamento-venta-lomas-del-sol-caracas/10544010',
    leadId: 'lead_t13',
    talkId: 'talk_t13',
    contactId: 'contact_t13',
    properties: mockProperties,
    handoffManager,
    currentTime: now
  });
  recordResult(
    13,
    'Humano respondió, pasaron 24h y cliente envía nuevo enlace Wasi válido -> Se permite evaluar ("Sí, disponible.")',
    res13.shouldRespond === true && res13.text === 'Sí, disponible.',
    `Respondió: "${res13.text}", Propiedad: ${res13.log.propertyIdentified}`
  );

  // --------------------------------------------------------------------------
  // TEST 14: Cliente envía dos enlaces de propiedades diferentes -> No mezclar fichas y derivar al humano
  // --------------------------------------------------------------------------
  const res14 = await evaluateCentralDecisionPipeline({
    userText: 'Hola, me interesan estos dos: https://info.wasi.co/apartamento-venta-los-samanes-caracas/10493109 y https://info.wasi.co/apartamento-venta-lomas-del-sol-caracas/10544010',
    leadId: 'lead_t14',
    properties: mockProperties,
    handoffManager
  });
  recordResult(
    14,
    'Cliente envía dos enlaces diferentes -> No mezclar fichas, silencio y derivar al humano',
    res14.shouldRespond === false && res14.log.typeDetected === 'MULTIPLE_PROPERTIES',
    `Respondió: ${res14.shouldRespond}, Motivo: ${res14.log.reason}`
  );

  // --------------------------------------------------------------------------
  // TEST 15: Propiedad no encontrada en Google Sheets -> No inventar y no responder
  // --------------------------------------------------------------------------
  const res15 = await evaluateCentralDecisionPipeline({
    userText: 'Me interesa el inmueble 99999999 https://info.wasi.co/inmueble-inexistente/99999999',
    leadId: 'lead_t15',
    properties: mockProperties,
    handoffManager
  });
  recordResult(
    15,
    'Propiedad no encontrada en Google Sheets -> No inventar y no responder (silencio)',
    res15.shouldRespond === false && res15.log.typeDetected === 'WASI_LINK_NOT_FOUND',
    `Respondió: ${res15.shouldRespond}, Motivo: ${res15.log.reason}`
  );

  // --------------------------------------------------------------------------
  // TEST 16: El servidor se reinicia mientras conversación está bloqueada -> El bloqueo persiste
  // --------------------------------------------------------------------------
  const restartLeadId = 'lead_t16_restart';
  const lockTime = now - (5 * 60 * 60 * 1000); // Bloqueado hace 5 horas
  handoffManager.recordHumanIntervention(restartLeadId, null, null, lockTime);

  // Simular reinicio creando una instancia que lee del archivo persistente
  const rebootedHandoffManager = new HandoffManager(testHandoffFile);

  const res16 = await evaluateCentralDecisionPipeline({
    userText: 'Hola, ¿sigue libre?',
    leadId: restartLeadId,
    properties: mockProperties,
    handoffManager: rebootedHandoffManager,
    currentTime: now
  });
  recordResult(
    16,
    'Servidor se reinicia mientras conversación está bloqueada -> Bloqueo persiste en disco',
    res16.shouldRespond === false && res16.log.typeDetected === 'HUMAN_LOCKED',
    `Respondió: ${res16.shouldRespond}, Motivo: ${res16.log.reason}`
  );

  // ==========================================================================
  // BLOQUE 2: NUEVAS PRUEBAS CRÍTICAS DE BLINDAJE TÉCNICO (TESTS 17 A 23)
  // ==========================================================================

  // --------------------------------------------------------------------------
  // TEST 17: Reinicio sin archivo local: Kommo API remota tiene evento humano (<24h) -> Reconstruye bloqueo
  // --------------------------------------------------------------------------
  // Simular dyno nuevo de Render donde el archivo local NO EXISTE, pero Kommo API responde con evento humano de hace 3 horas
  const nonExistentFile = path.join(__dirname, 'non_existent_handoffs_test.json');
  if (fs.existsSync(nonExistentFile)) fs.unlinkSync(nonExistentFile);

  const mockKommoFetcher = async ({ leadId }) => {
    // Simula respuesta de Kommo API con evento outgoing_chat_message humano de hace 3 horas
    return {
      lastHumanTimestamp: now - (3 * 60 * 60 * 1000)
    };
  };

  const remoteRebuiltHandoffManager = new HandoffManager(nonExistentFile, mockKommoFetcher);

  const res17 = await evaluateCentralDecisionPipeline({
    userText: 'Buenas tardes, ¿está disponible?',
    leadId: 'lead_remote_17',
    properties: mockProperties,
    handoffManager: remoteRebuiltHandoffManager,
    currentTime: now
  });

  recordResult(
    17,
    'Reinicio sin archivo local: Kommo API remota informa intervención (<24h) -> Reconstruye bloqueo y SILENCIO',
    res17.shouldRespond === false && res17.log.typeDetected === 'HUMAN_LOCKED',
    `Respondió: ${res17.shouldRespond}, Motivo: ${res17.log.reason}`
  );

  // --------------------------------------------------------------------------
  // TEST 18: Falla temporal de Kommo API (error 500/timeout) sin archivo local -> Falla cerrada / Silencio seguro
  // --------------------------------------------------------------------------
  const mockFailingKommoFetcher = async () => {
    throw new Error('504 Gateway Timeout: Kommo API no disponible temporalmente');
  };

  const failingKommoHandoffManager = new HandoffManager(nonExistentFile, mockFailingKommoFetcher);

  const res18 = await evaluateCentralDecisionPipeline({
    userText: 'Hola, información por favor',
    leadId: 'lead_failing_18',
    properties: mockProperties,
    handoffManager: failingKommoHandoffManager,
    currentTime: now
  });

  recordResult(
    18,
    'Falla temporal de Kommo API (timeout/500) -> Falla cerrada (SILENCIO SEGURO, no desbloquea indebidamente)',
    res18.shouldRespond === false && res18.log.typeDetected === 'HUMAN_LOCKED',
    `Respondió: ${res18.shouldRespond}, Motivo: ${res18.log.reason}`
  );

  // --------------------------------------------------------------------------
  // TEST 19: Mensaje con números que son precios ($100000, $40.000) -> No se confunden con Wasi
  // --------------------------------------------------------------------------
  const res19 = await evaluateCentralDecisionPipeline({
    userText: 'Hola, cuento con un presupuesto de $100000 para comprar apartamento en Caracas',
    leadId: 'lead_price_19',
    properties: mockProperties,
    handoffManager
  });

  recordResult(
    19,
    'Mensaje con precios monetarios ($100000) -> No se confunde con código Wasi, SILENCIO sin inventar',
    res19.shouldRespond === false && res19.log.propertyIdentified === null,
    `Respondió: ${res19.shouldRespond}, Propiedad identificada: ${res19.log.propertyIdentified}, Motivo: ${res19.log.reason}`
  );

  // --------------------------------------------------------------------------
  // TEST 20: Mensaje con números de teléfono (04143115105, +584142504024) -> No se confunden con Wasi
  // --------------------------------------------------------------------------
  const res20 = await evaluateCentralDecisionPipeline({
    userText: 'Hola, por favor escríbeme a mi WhatsApp 04143115105 para coordinar',
    leadId: 'lead_phone_20',
    properties: mockProperties,
    handoffManager
  });

  recordResult(
    20,
    'Mensaje con teléfono móvil (04143115105) -> No se confunde con código Wasi, SILENCIO para atención humana',
    res20.shouldRespond === false && res20.log.propertyIdentified === null,
    `Respondió: ${res20.shouldRespond}, Propiedad identificada: ${res20.log.propertyIdentified}, Motivo: ${res20.log.reason}`
  );

  // --------------------------------------------------------------------------
  // TEST 21: Estatus ambiguo ("Disponible en 15 días" o "No Disponible") -> Equivalencia exacta exige 'disponible'
  // --------------------------------------------------------------------------
  // REF-006 tiene ESTATUS: "Disponible en 15 días" (contiene la palabra disponible pero NO es equivalente exacto)
  const res21 = await evaluateCentralDecisionPipeline({
    userText: 'Buenas tardes, me interesa el inmueble 10466376 https://info.wasi.co/apartamento-venta-chacao-caracas/10466376',
    leadId: 'lead_status_21',
    properties: mockProperties,
    handoffManager
  });

  recordResult(
    21,
    'Estatus no equivalente exacto ("Disponible en 15 días") -> No afirma disponible, SILENCIO seguro',
    res21.shouldRespond === false && res21.log.typeDetected === 'WASI_LINK_NOT_AVAILABLE',
    `Respondió: ${res21.shouldRespond}, Motivo: ${res21.log.reason}`
  );

  // --------------------------------------------------------------------------
  // TEST 22: Base de datos de Google Sheets vacía o no disponible -> Silencio seguro preventivo
  // --------------------------------------------------------------------------
  const res22 = await evaluateCentralDecisionPipeline({
    userText: 'Hola, busco apartamento en Los Samanes https://info.wasi.co/apartamento-venta-los-samanes-caracas/10493109',
    leadId: 'lead_empty_sheets_22',
    properties: [], // Simulando fallo de conexión con Google Sheets
    handoffManager
  });

  recordResult(
    22,
    'Google Sheets vacío o inaccesible -> Silencio seguro preventivo (0 tokens)',
    res22.shouldRespond === false && res22.log.typeDetected === 'SHEETS_UNAVAILABLE',
    `Respondió: ${res22.shouldRespond}, Motivo: ${res22.log.reason}`
  );

  // --------------------------------------------------------------------------
  // TEST 23: Reactivación post-24h sin enlace Wasi ("Hola, qué tal") -> Permanece en silencio
  // --------------------------------------------------------------------------
  // Un humano intervino hace 26 horas. El cliente envía un saludo simple sin enlace Wasi.
  const oldHumanTime = now - (26 * 60 * 60 * 1000);
  handoffManager.recordHumanIntervention('lead_t23', 'talk_t23', 'contact_t23', oldHumanTime);

  const res23 = await evaluateCentralDecisionPipeline({
    userText: 'Hola, buenas tardes',
    leadId: 'lead_t23',
    talkId: 'talk_t23',
    contactId: 'contact_t23',
    properties: mockProperties,
    handoffManager,
    currentTime: now
  });

  recordResult(
    23,
    'Transcurridas >24h pero cliente envía mensaje SIN nuevo enlace Wasi -> Permanece en SILENCIO',
    res23.shouldRespond === false && (res23.log.typeDetected === 'POST_24H_REQUIRES_WASI_LINK' || res23.log.typeDetected === 'PURE_GREETING'),
    `Respondió: ${res23.shouldRespond}, Motivo: ${res23.log.reason}`
  );

  // Limpieza de archivos temporales
  if (fs.existsSync(testHandoffFile)) fs.unlinkSync(testHandoffFile);
  if (fs.existsSync(nonExistentFile)) fs.unlinkSync(nonExistentFile);

  console.log('\n================================================================');
  console.log(` RESULTADOS FINALES: ${passedCount} / 23 PRUEBAS SUPERADAS (${Math.round((passedCount / 23) * 100)}%) `);
  console.log('================================================================');

  if (passedCount !== 23) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Error fatal ejecutando test suite:', err);
  process.exit(1);
});
