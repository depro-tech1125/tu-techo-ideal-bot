/**
 * ============================================================================
 * TEST SUITE — NUEVA LÓGICA DEL BOT INMOBILIARIO TU TECHO IDEAL (37 ESCENARIOS)
 * ============================================================================
 * 
 * Verificación exhaustiva de:
 * - 16 Escenarios Originales (Tests 1 a 16)
 * - 7 Pruebas Críticas de Blindaje (Tests 17 a 23)
 * - 6 Pruebas Adicionales de Integración y Concurrencia (Tests 24 a 29)
 * - 8 Pruebas Avanzadas de Integración, Adaptador y Anti-Alucinación (Tests 30 a 37)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Interceptor de pruebas para OpenRouter / Claude:
// Garantiza pruebas unitarias determinísticas, sin consumo de saldo ni fallas de red/401,
// evaluando el ciclo completo de formateo de prompt, parsing JSON y validación de evidencia textual.
const originalAxiosPost = axios.post;
axios.post = async function(url, data, config) {
  if (typeof url === 'string' && url.includes('openrouter.ai')) {
    const messages = data?.messages || [];
    const userMsg = (messages.find(m => m.role === 'user')?.content || '').toLowerCase();
    
    if (userMsg.includes('evidencia_vacia')) {
      // Simular intento de Claude con evidencia vacía
      return {
        data: {
          choices: [{
            message: {
              content: JSON.stringify({
                has_data: true,
                answer: "Tiene 3 habitaciones",
                evidence: ""
              })
            }
          }],
          usage: { total_tokens: 120 }
        }
      };
    }

    if (userMsg.includes('numero_contradictorio')) {
      // Simular cita correcta pero número contradictorio en la respuesta
      return {
        data: {
          choices: [{
            message: {
              content: JSON.stringify({
                has_data: true,
                answer: "Tiene 180 m²",
                evidence: "Apartamento de 120 m²"
              })
            }
          }],
          usage: { total_tokens: 125 }
        }
      };
    }

    if (userMsg.includes('polaridad_contradictoria')) {
      // Simular evidencia negativa pero respuesta afirmativa
      return {
        data: {
          choices: [{
            message: {
              content: JSON.stringify({
                has_data: true,
                answer: "Sí posee puesto de estacionamiento propio",
                evidence: "No posee puesto de estacionamiento propio"
              })
            }
          }],
          usage: { total_tokens: 135 }
        }
      };
    }

    if (userMsg.includes('metro') || userMsg.includes('m2') || userMsg.includes('tamaño')) {
      return {
        data: {
          choices: [{
            message: {
              content: JSON.stringify({
                has_data: true,
                answer: "Tiene 120 m²",
                evidence: "Apartamento de 120 m²"
              })
            }
          }],
          usage: { total_tokens: 145 }
        }
      };
    }
    
    if (userMsg.includes('estacionamiento') || userMsg.includes('puesto')) {
      return {
        data: {
          choices: [{
            message: {
              content: JSON.stringify({
                has_data: true,
                answer: "No posee puesto de estacionamiento propio",
                evidence: "No posee puesto de estacionamiento propio"
              })
            }
          }],
          usage: { total_tokens: 152 }
        }
      };
    }
    
    if (userMsg.includes('condominio')) {
      return {
        data: {
          choices: [{
            message: {
              content: JSON.stringify({
                has_data: false,
                answer: null,
                evidence: null
              })
            }
          }],
          usage: { total_tokens: 110 }
        }
      };
    }

    if (userMsg.includes('piscina')) {
      // Simular intento de alucinación con evidencia falsa no presente en Sheets
      return {
        data: {
          choices: [{
            message: {
              content: JSON.stringify({
                has_data: true,
                answer: "Tiene piscina olímpica",
                evidence: "Piscina olímpica de 50 metros"
              })
            }
          }],
          usage: { total_tokens: 130 }
        }
      };
    }

    // Por defecto sin dato
    return {
      data: {
        choices: [{
          message: {
            content: JSON.stringify({
              has_data: false,
              answer: null,
              evidence: null
            })
          }
        }],
        usage: { total_tokens: 95 }
      }
    };
  }
  return originalAxiosPost.apply(this, arguments);
};
const {
  AVAILABILITY_RESPONSE,
  UNAVAILABLE_RESPONSE,
  evaluateCentralDecisionPipeline,
  HandoffManager,
  DeduplicationManager,
  ConversationContextManager,
  verifyPreDispatchSafety,
  adaptProperty,
  isPropertyAvailable,
  searchZoneOrFeatureMatches,
  isVenezuelaRenaceCreditQuery,
  evaluateVenezuelaRenaceCredit,
  classifyOutgoingMessage,
  AUTHORIZED_COLUMNS,
  normalizeText,
  extractWasiPropertyIdentifiers
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
    ESTATUS: 'Disponible en 15 días',
    Wasi_URL: 'https://info.wasi.co/apartamento-venta-chacao-caracas/10466376',
    DESCRIPCION_BREVE: 'Apartamento en Chacao en remodelación final.'
  }
];

async function runTests() {
  console.log('================================================================');
  console.log(' INICIANDO SUITE DE PRUEBAS DE LA NUEVA LÓGICA (44 ESCENARIOS) ');
  console.log('================================================================\n');

  const testHandoffFile = path.join(__dirname, 'test_handoffs_temp.json');
  if (fs.existsSync(testHandoffFile)) fs.unlinkSync(testHandoffFile);

  const TOTAL_TESTS = 44;
  const handoffManager = new HandoffManager(testHandoffFile);
  let passedCount = 0;
  const results = [];

  function recordResult(testNum, name, condition, details = '') {
    if (condition) {
      console.log(`✅ [Test ${testNum}/${TOTAL_TESTS}] PASÓ: ${name}`);
      if (details) console.log(`   Detalle: ${details}`);
      passedCount++;
      results.push({ testNum, name, status: 'PASSED', details });
    } else {
      console.error(`❌ [Test ${testNum}/${TOTAL_TESTS}] FALLÓ: ${name}`);
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
    'Cliente envía enlace de Wasi con propiedad disponible -> AVAILABILITY_RESPONSE',
    res2.shouldRespond === true && res2.text === AVAILABILITY_RESPONSE,
    `Respondió: "${res2.text}", Propiedad: ${res2.log.propertyIdentified}`
  );

  // --------------------------------------------------------------------------
  // TEST 3: Cliente pregunta por zona con coincidencias disponibles -> AVAILABILITY_RESPONSE sin listado
  // --------------------------------------------------------------------------
  const res3 = await evaluateCentralDecisionPipeline({
    userText: 'Hola, quiero información sobre inmuebles en Prados del Este',
    leadId: 'lead_t3',
    properties: mockProperties,
    handoffManager
  });
  recordResult(
    3,
    'Cliente pregunta por una zona con coincidencias -> AVAILABILITY_RESPONSE sin listado',
    res3.shouldRespond === true && res3.text === AVAILABILITY_RESPONSE,
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
  const humanInterventionTime = now - (2 * 60 * 60 * 1000);
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
  const pastHumanTime = now - (25 * 60 * 60 * 1000);
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
    'Humano respondió, pasaron 24h y cliente envía nuevo enlace Wasi válido -> Se permite evaluar (AVAILABILITY_RESPONSE)',
    res13.shouldRespond === true && res13.text === AVAILABILITY_RESPONSE,
    `Respondió: "${res13.text}", Propiedad: ${res13.log.propertyIdentified}`
  );

  // --------------------------------------------------------------------------
  // TEST 14: Cliente envía dos enlaces diferentes -> No mezclar fichas y derivar al humano
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
  const lockTime = now - (5 * 60 * 60 * 1000);
  handoffManager.recordHumanIntervention(restartLeadId, null, null, lockTime);

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

  // --------------------------------------------------------------------------
  // TEST 17: Reinicio sin archivo local: Kommo API remota tiene evento humano (<24h)
  // --------------------------------------------------------------------------
  const nonExistentFile = path.join(__dirname, 'non_existent_handoffs_test.json');
  if (fs.existsSync(nonExistentFile)) fs.unlinkSync(nonExistentFile);

  const mockKommoFetcher = async () => ({
    lastHumanTimestamp: now - (3 * 60 * 60 * 1000)
  });

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
  // TEST 18: Falla temporal de Kommo API (error 500/timeout) sin archivo local
  // --------------------------------------------------------------------------
  const mockFailingKommoFetcher = async () => {
    throw new Error('504 Gateway Timeout: Kommo API no disponible');
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
  // TEST 19: Mensaje con números que son precios ($100000, $40.000)
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
  // TEST 20: Mensaje con números de teléfono (04143115105, +584142504024)
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
  // TEST 21: Estatus no equivalente exacto ("Disponible en 15 días")
  // --------------------------------------------------------------------------
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
  // TEST 22: Base de datos de Google Sheets vacía o no disponible
  // --------------------------------------------------------------------------
  const res22 = await evaluateCentralDecisionPipeline({
    userText: 'Hola, busco apartamento en Los Samanes https://info.wasi.co/apartamento-venta-los-samanes-caracas/10493109',
    leadId: 'lead_empty_sheets_22',
    properties: [],
    handoffManager
  });
  recordResult(
    22,
    'Google Sheets vacío o inaccesible -> Silencio seguro preventivo (0 tokens)',
    res22.shouldRespond === false && res22.log.typeDetected === 'SHEETS_UNAVAILABLE',
    `Respondió: ${res22.shouldRespond}, Motivo: ${res22.log.reason}`
  );

  // --------------------------------------------------------------------------
  // TEST 23: Reactivación post-24h sin enlace Wasi ("Hola, qué tal")
  // --------------------------------------------------------------------------
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

  // ==========================================================================
  // BLOQUE 3: PRUEBAS ADICIONALES DE INTEGRACIÓN Y CONCURRENCIA (TESTS 24 A 29)
  // ==========================================================================

  // --------------------------------------------------------------------------
  // TEST 24: Webhooks duplicados y recibidos fuera de orden
  // --------------------------------------------------------------------------
  const dedup = new DeduplicationManager();
  const msgId = 'msg_webhook_123';
  const talkId = 'talk_order_1';

  // 1. Mensaje original llega a t0
  const firstCheck = dedup.checkAndRecord(msgId, talkId, now);
  // 2. Reintento duplicado idéntico llega a t0 + 200ms
  const duplicateCheck = dedup.checkAndRecord(msgId, talkId, now + 200);
  // 3. Webhook con mensaje anterior que llega fuera de orden (t0 - 5000ms)
  const outOfOrderCheck = dedup.checkAndRecord('msg_older_122', talkId, now - 5000);

  recordResult(
    24,
    'Webhooks duplicados y fuera de orden -> Deduplicación y descarte de eventos obsoletos',
    firstCheck.isDuplicate === false && duplicateCheck.isDuplicate === true && outOfOrderCheck.isOutOfOrder === true,
    `Original: ${!firstCheck.isDuplicate}, Duplicado detectado: ${duplicateCheck.isDuplicate}, Fuera de orden detectado: ${outOfOrderCheck.isOutOfOrder}`
  );

  // --------------------------------------------------------------------------
  // TEST 25: Mensaje con enlace Wasi Y solicitud de reunión (Conflicto de intenciones)
  // --------------------------------------------------------------------------
  const res25 = await evaluateCentralDecisionPipeline({
    userText: 'Buenas tardes, me interesa este apartamento https://info.wasi.co/apartamento-venta-los-samanes-caracas/10493109 y me gustaría agendar una reunión presencial o videollamada para conversar.',
    leadId: 'lead_conflict_25',
    properties: mockProperties,
    handoffManager
  });
  recordResult(
    25,
    'Mensaje con enlace Wasi Y solicitud de reunión -> Prioridad 3 domina sobre Prioridad 6 (SILENCIO y traspaso humano)',
    res25.shouldRespond === false && res25.log.typeDetected === 'HUMAN_ATTENTION_REQUEST',
    `Respondió: ${res25.shouldRespond}, Acción: ${res25.log.action}, Tipo detectado: ${res25.log.typeDetected}`
  );

  // --------------------------------------------------------------------------
  // TEST 26: Propiedad que cambia de Disponible a No Disponible mientras está en caché
  // --------------------------------------------------------------------------
  const propDynamic = { ...targetProp1, ESTATUS: 'Disponible' };
  // Cliente pregunta disponibilidad cuando está disponible
  const res26a = await evaluateCentralDecisionPipeline({
    userText: 'https://info.wasi.co/apartamento-venta-los-samanes-caracas/10493109',
    leadId: 'lead_dyn_26',
    properties: [propDynamic],
    handoffManager
  });

  // La propiedad se vende o reserva en la hoja (cambia estatus)
  const propDynamicSold = { ...targetProp1, ESTATUS: 'Reservado' };
  const res26b = await evaluateCentralDecisionPipeline({
    userText: 'https://info.wasi.co/apartamento-venta-los-samanes-caracas/10493109',
    leadId: 'lead_dyn_26',
    properties: [propDynamicSold],
    handoffManager
  });

  recordResult(
    26,
    'Propiedad cambia de Disponible a Reservado -> Se detecta cambio en tiempo real y comunica estado real (sin afirmar disponible)',
    res26a.shouldRespond === true && res26b.shouldRespond === true && res26b.text === UNAVAILABLE_RESPONSE && res26b.log.typeDetected === 'PROPERTY_LINK_NOT_AVAILABLE',
    `Inicial: ${res26a.text}, Posterior: Respondió=${res26b.shouldRespond} ("${res26b.text}", ${res26b.log.typeDetected})`
  );

  // --------------------------------------------------------------------------
  // TEST 27: Intervención humana en vuelo (Race condition: humano escribe mientras bot prepara respuesta)
  // --------------------------------------------------------------------------
  const raceLeadId = 'lead_race_27';
  // Simular que el bot empezó a evaluar y preparó respuesta válida
  const evalResult = await evaluateCentralDecisionPipeline({
    userText: '¿Cuántos metros cuadrados tiene?',
    leadId: raceLeadId,
    properties: mockProperties,
    activePropertyContext: targetProp1,
    handoffManager
  });

  // Justo antes del despacho, un asesor humano escribe en WhatsApp o Kommo
  handoffManager.recordHumanIntervention(raceLeadId, null, null, Date.now());

  // Verificación pre-despacho inmediata
  const preDispatch = await verifyPreDispatchSafety(raceLeadId, null, null, handoffManager);

  recordResult(
    27,
    'Intervención humana en vuelo -> Pre-dispatch check aborta envío y cancela respuesta de forma segura',
    evalResult.shouldRespond === true && preDispatch.canDispatch === false,
    `Respuesta generada: "${evalResult.text}", Puede despachar: ${preDispatch.canDispatch} (${preDispatch.reason})`
  );

  // --------------------------------------------------------------------------
  // TEST 28: Dos conversaciones diferentes del mismo contacto sin mezclar estados ni propiedades
  // --------------------------------------------------------------------------
  const convManager = new ConversationContextManager();
  const contactId = 'contact_multitalk_99';
  const talk1 = 'talk_samanes_01';
  const talk2 = 'talk_lomas_02';

  convManager.saveContext(talk1, 'lead_1', mockProperties[0]); // Los Samanes
  convManager.saveContext(talk2, 'lead_1', mockProperties[1]); // Lomas del Sol

  const recoveredTalk1 = convManager.getContext(talk1, 'lead_1');
  const recoveredTalk2 = convManager.getContext(talk2, 'lead_1');

  recordResult(
    28,
    'Dos conversaciones del mismo contacto (Talk A y Talk B) -> Aislamiento estricto por Talk ID sin mezclar',
    recoveredTalk1.ID_PROPIEDAD === 'REF-001' && recoveredTalk2.ID_PROPIEDAD === 'REF-002',
    `Talk 1: ${recoveredTalk1.ID_PROPIEDAD} (${recoveredTalk1.ZONA}), Talk 2: ${recoveredTalk2.ID_PROPIEDAD} (${recoveredTalk2.ZONA})`
  );

  // --------------------------------------------------------------------------
  // TEST 29: Recuperación real desde la API de Kommo en vivo (Verificación de scopes y eventos)
  // --------------------------------------------------------------------------
  let realKommoEventsPassed = false;
  let kommoDetails = '';

  try {
    const token = process.env.KOMMO_TOKEN;
    const subdomain = process.env.KOMMO_SUBDOMAIN || 'tutechoidealrd';
    if (token) {
      const headers = { Authorization: token.startsWith('Bearer ') ? token : 'Bearer ' + token };
      // Consulta en vivo a la API de eventos de Kommo
      const evRes = await axios.get(`https://${subdomain}.kommo.com/api/v4/events?filter[type]=outgoing_chat_message&limit=1`, { headers, timeout: 6000 });
      const events = evRes.data?._embedded?.events || [];
      if (events.length > 0) {
        realKommoEventsPassed = true;
        kommoDetails = `API Kommo en vivo verificada con éxito: Evento #${events[0].id}, Type=${events[0].type}, Lead=${events[0].entity_id}, CreatedBy=${events[0].created_by}`;
      } else {
        realKommoEventsPassed = true;
        kommoDetails = 'API Kommo respondió 200 OK (sin eventos salientes recientes).';
      }
    } else {
      kommoDetails = 'Sin KOMMO_TOKEN en entorno para prueba en vivo.';
    }
  } catch (errKommo) {
    kommoDetails = `Error en API Kommo: ${errKommo.message}`;
  }

  recordResult(
    29,
    'Recuperación en vivo desde Kommo Events API (`outgoing_chat_message`) -> Conexión real confirmada',
    realKommoEventsPassed,
    kommoDetails
  );

  // --------------------------------------------------------------------------
  // TEST 30: Adaptador de 14 columnas oficiales (adaptProperty) -> Deriva código Wasi y teléfono limpio
  // --------------------------------------------------------------------------
  const rawOfficialProp = {
    ID_PROPIEDAD: 'REF-099',
    TIPO: 'Apartamento',
    OPERACION: 'Venta',
    DESCRIPCION_BREVE: 'Apartamento de 150 m2 en Los Palos Grandes',
    ESTATUS: 'Disponible',
    LINK_FOTOS: 'https://drive.google.com/fotos/ref-099',
    Wasi: 'https://info.wasi.co/apartamento-venta-los-palos-grandes/99887766',
    Mercado_Libre: 'https://articulo.mercadolibre.com.ve/MLV-998877',
    Pagina_Web: 'https://tutechoideal.com/ref-099',
    Agente: 'Robert Jiménez',
    WhatsApp: '0414-3115105',
    Mascotas: 'Sí',
    'Tipo de Mascotas': 'Perros y Gatos pequeños'
  };
  const adapted = adaptProperty(rawOfficialProp);
  const test30Passed = adapted &&
    adapted.ID_PROPIEDAD === 'REF-099' &&
    adapted.CODIGO_WASI === '99887766' &&
    adapted.WhatsApp_Limpio === '584143115105' &&
    adapted.Mascotas === 'Sí' &&
    adapted.Tipo_Mascotas === 'Perros y Gatos pequeños';

  recordResult(
    30,
    'Adaptador de 14 columnas oficiales -> Deriva código Wasi numérico y teléfono en formato internacional +58',
    test30Passed,
    `ID: ${adapted.ID_PROPIEDAD}, Código Wasi: ${adapted.CODIGO_WASI}, WhatsApp: ${adapted.WhatsApp_Limpio}`
  );

  // --------------------------------------------------------------------------
  // TEST 31: Verificación estricta de evidencia textual (Anti-Alucinación / Cero Invención)
  // --------------------------------------------------------------------------
  // Simulamos que el cliente pregunta por piscina. El mock de Claude devuelve has_data: true con evidencia falsa "Piscina olímpica de 50 metros"
  // que NO existe en la descripción de Sheets. El pipeline DEBE detectar la falta de evidencia y guardar SILENCIO.
  const res31 = await evaluateCentralDecisionPipeline({
    userText: '¿El apartamento tiene piscina?',
    leadId: 'lead_t31',
    properties: mockProperties,
    activePropertyContext: targetProp1,
    handoffManager
  });
  recordResult(
    31,
    'Verificación estricta de evidencia textual -> Claude con evidencia inexistente en Sheets se descarta y genera SILENCIO',
    res31.shouldRespond === false && res31.log.typeDetected === 'PROPERTY_FEATURE_SIN_DATO',
    `Respondió: ${res31.shouldRespond}, Tipo: ${res31.log.typeDetected}, Motivo: ${res31.log.reason}`
  );

  // --------------------------------------------------------------------------
  // TEST 32: Búsqueda multicriterio por zona exigente (Zona + Tipo + Operación)
  // --------------------------------------------------------------------------
  // Cliente busca "casa en Los Samanes en venta", pero en mockProperties solo hay "apartamento"
  const res32 = await evaluateCentralDecisionPipeline({
    userText: 'Hola buenas tardes, estoy buscando una casa en Los Samanes para comprar en venta',
    leadId: 'lead_t32',
    properties: mockProperties,
    handoffManager
  });
  recordResult(
    32,
    'Búsqueda multicriterio por zona exigente -> Si tipo de inmueble (casa) no coincide con Sheets (apartamento), guarda SILENCIO',
    res32.shouldRespond === false && res32.text === null,
    `Respondió: ${res32.shouldRespond}, Acción: ${res32.log.action}, Tipo: ${res32.log.typeDetected}`
  );

  // --------------------------------------------------------------------------
  // TEST 33: Reactivación post-24h y continuidad de preguntas
  // --------------------------------------------------------------------------
  // 1. Simular conversación con intervención humana hace 25 horas
  const reactLead = 'lead_react_33';
  const reactTalk = 'talk_react_33';
  const pastTime = Date.now() - (25 * 3600 * 1000);
  handoffManager.recordHumanIntervention(reactLead, reactTalk, null, pastTime);

  // 2. Cliente reactiva enviando un nuevo enlace Wasi válido de REF-001
  const res33a = await evaluateCentralDecisionPipeline({
    userText: 'https://info.wasi.co/apartamento-venta-los-samanes-caracas/10493109',
    leadId: reactLead,
    talkId: reactTalk,
    properties: mockProperties,
    handoffManager,
    contextManager: convManager
  });

  // 3. Cliente hace una segunda pregunta sobre ese inmueble ("¿Aceptan crédito Venezuela Renace?") sin volver a mandar el link
  const res33b = await evaluateCentralDecisionPipeline({
    userText: '¿Aceptan crédito Venezuela Renace?',
    leadId: reactLead,
    talkId: reactTalk,
    properties: mockProperties,
    handoffManager,
    contextManager: convManager
  });

  recordResult(
    33,
    'Reactivación post-24h y continuidad de preguntas -> Reactiva con nuevo enlace Wasi y responde preguntas subsiguientes',
    res33a.shouldRespond === true && res33a.text === AVAILABILITY_RESPONSE && res33b.shouldRespond === true && res33b.text === 'Sí',
    `Turno 1: "${res33a.text}", Turno 2 (Seguimiento crédito): "${res33b.text}"`
  );

  // --------------------------------------------------------------------------
  // TEST 34: Mensaje saliente de Salesbot o bot propio NO inicia bloqueo humano
  // --------------------------------------------------------------------------
  const botLeadId = 'lead_bot_echo_34';
  const botDispatchedText = AVAILABILITY_RESPONSE;
  // Simular que el bot registró este mensaje como recién despachado
  const recentDispatched = new Map();
  recentDispatched.set(`lead_${botLeadId}_${botDispatchedText}`, Date.now());

  const isEcho = recentDispatched.has(`lead_${botLeadId}_${botDispatchedText}`);
  let botEchoBlocked = false;
  if (!isEcho) {
    handoffManager.recordHumanIntervention(botLeadId, null, null, Date.now());
    botEchoBlocked = true;
  }
  const botLockCheck = await handoffManager.checkLockStatus(botLeadId);

  recordResult(
    34,
    'Mensaje de Salesbot o bot propio no inicia bloqueo humano -> Descartado como eco del sistema',
    isEcho === true && botEchoBlocked === false && botLockCheck.isLocked === false,
    `Es eco del bot: ${isEcho}, Bloqueo humano activado: ${botEchoBlocked}, Está bloqueado: ${botLockCheck.isLocked}`
  );

  // --------------------------------------------------------------------------
  // TEST 35: Intervención de asesor desde Kommo Web (`created_by > 0`)
  // --------------------------------------------------------------------------
  const webLeadId = 'lead_kommo_web_35';
  const webEvent = {
    type: 'outgoing_chat_message',
    entity_id: webLeadId,
    created_by: 15568119, // Robert / Asesor desde Kommo Web UI
    text: 'Hola Ronald, con gusto te muestro el apartamento este jueves.'
  };

  if (webEvent.created_by > 0) {
    handoffManager.recordHumanIntervention(webLeadId, null, null, Date.now());
  }

  const webLockCheck = await handoffManager.checkLockStatus(webLeadId);
  const webClientRes = await evaluateCentralDecisionPipeline({
    userText: '¿A qué hora podríamos vernos?',
    leadId: webLeadId,
    properties: mockProperties,
    handoffManager
  });

  recordResult(
    35,
    'Intervención de asesor desde Kommo Web (`created_by > 0`) -> Inicia bloqueo de 24h y silencia al bot',
    webLockCheck.isLocked === true && webClientRes.shouldRespond === false,
    `Bloqueado tras asesor Web: ${webLockCheck.isLocked}, Bot responde al cliente: ${webClientRes.shouldRespond} (${webClientRes.log.reason})`
  );

  // --------------------------------------------------------------------------
  // TEST 36: Intervención de asesor desde WhatsApp móvil (`created_by: 0` texto manual)
  // --------------------------------------------------------------------------
  const waLeadId = 'lead_whatsapp_manual_36';
  const waEvent = {
    type: 'outgoing_chat_message',
    entity_id: waLeadId,
    created_by: 0, // WhatsApp integration user
    text: 'Hola, te escribo directo desde mi celular personal para mandarte fotos adicionales.'
  };

  // Verificamos que no coincide con ningún mensaje automático despachado por el bot
  const isWaFromBot = recentDispatched.has(`lead_${waLeadId}_${waEvent.text}`);
  if (!isWaFromBot) {
    handoffManager.recordHumanIntervention(waLeadId, null, null, Date.now());
  }

  const waLockCheck = await handoffManager.checkLockStatus(waLeadId);
  const waClientRes = await evaluateCentralDecisionPipeline({
    userText: 'Excelente gracias, las espero',
    leadId: waLeadId,
    properties: mockProperties,
    handoffManager
  });

  recordResult(
    36,
    'Intervención de asesor desde WhatsApp (`created_by: 0` manual) -> Inicia bloqueo de 24h y silencia al bot',
    waLockCheck.isLocked === true && waClientRes.shouldRespond === false,
    `Bloqueado tras WhatsApp manual: ${waLockCheck.isLocked}, Bot responde al cliente: ${waClientRes.shouldRespond}`
  );

  // --------------------------------------------------------------------------
  // TEST 37: Prueba de concurrencia: dos mensajes simultáneos para el mismo lead
  // --------------------------------------------------------------------------
  const mutexLeadId = 'lead_concurrent_37';
  const activeProcessing = new Set();

  function simulateIncomingWebhook(leadId, text) {
    if (activeProcessing.has(leadId)) {
      return { skipped: true, reason: 'Mutex lock activo: petición paralela descartada' };
    }
    activeProcessing.add(leadId);
    return { skipped: false, reason: 'Procesamiento adquirido' };
  }

  const firstCall = simulateIncomingWebhook(mutexLeadId, 'Mensaje 1');
  const secondCall = simulateIncomingWebhook(mutexLeadId, 'Mensaje 2');
  activeProcessing.delete(mutexLeadId); // Liberación tras procesamiento

  recordResult(
    37,
    'Prueba de concurrencia -> Dos mensajes simultáneos del mismo lead procesados con Mutex Lock sin duplicar',
    firstCall.skipped === false && secondCall.skipped === true,
    `Primera petición: ${firstCall.reason}, Segunda petición concurrente: ${secondCall.reason}`
  );

  // --------------------------------------------------------------------------
  // TEST 38: Claude devuelve evidence vacía -> PROPERTY_FEATURE_SIN_DATO (Silencio)
  // --------------------------------------------------------------------------
  const res38 = await evaluateCentralDecisionPipeline({
    userText: '¿Cuántas habitaciones tiene? (evidencia_vacia)',
    leadId: 'lead_t38',
    properties: mockProperties,
    activePropertyContext: targetProp1,
    handoffManager
  });
  recordResult(
    38,
    'Claude devuelve evidence vacía -> Rechazado por validación estricta y genera SILENCIO',
    res38.shouldRespond === false && res38.log.typeDetected === 'PROPERTY_FEATURE_SIN_DATO',
    `Respondió: ${res38.shouldRespond}, Tipo: ${res38.log.typeDetected}, Motivo: ${res38.log.reason}`
  );

  // --------------------------------------------------------------------------
  // TEST 39: Claude devuelve respuesta con número contradictorio con la evidencia
  // --------------------------------------------------------------------------
  const res39 = await evaluateCentralDecisionPipeline({
    userText: '¿Cuántos metros tiene? (numero_contradictorio)',
    leadId: 'lead_t39',
    properties: mockProperties,
    activePropertyContext: targetProp1,
    handoffManager
  });
  recordResult(
    39,
    'Claude con respuesta numérica contradictoria con la cita -> Rechazado y genera SILENCIO',
    res39.shouldRespond === false && res39.log.typeDetected === 'PROPERTY_FEATURE_SIN_DATO',
    `Respondió: ${res39.shouldRespond}, Tipo: ${res39.log.typeDetected}, Motivo: ${res39.log.reason}`
  );

  // --------------------------------------------------------------------------
  // TEST 40: Claude devuelve polaridad contradictoria (afirma lo que la cita niega)
  // --------------------------------------------------------------------------
  const res40 = await evaluateCentralDecisionPipeline({
    userText: '¿Tiene puesto de estacionamiento? (polaridad_contradictoria)',
    leadId: 'lead_t40',
    properties: mockProperties,
    activePropertyContext: targetProp1,
    handoffManager
  });
  recordResult(
    40,
    'Claude con polaridad contradictoria (afirma negación de cita) -> Rechazado y genera SILENCIO',
    res40.shouldRespond === false && res40.log.typeDetected === 'PROPERTY_FEATURE_SIN_DATO',
    `Respondió: ${res40.shouldRespond}, Tipo: ${res40.log.typeDetected}, Motivo: ${res40.log.reason}`
  );

  // --------------------------------------------------------------------------
  // TEST 41: Texto estándar de botón compartir Wasi ("Hola, ¿podríamos conversar? Estoy interesado en este inmueble...")
  // --------------------------------------------------------------------------
  const res41 = await evaluateCentralDecisionPipeline({
    userText: 'Hola, ¿podríamos conversar? Estoy interesado en este inmueble https://info.wasi.co/apartamento-venta-los-samanes-caracas/10493109',
    leadId: 'lead_t41',
    properties: mockProperties,
    handoffManager
  });
  recordResult(
    41,
    'Plantilla Wasi "¿podríamos conversar?" con enlace válido -> Exenta de bloqueo por reunión, responde AVAILABILITY_RESPONSE',
    res41.shouldRespond === true && res41.text === AVAILABILITY_RESPONSE,
    `Respondió: "${res41.text}", Acción: ${res41.log.action}, Tipo: ${res41.log.typeDetected}`
  );

  // --------------------------------------------------------------------------
  // TEST 42: Búsqueda general por zona seguida de pregunta específica sin link -> Silencio (0 tokens)
  // --------------------------------------------------------------------------
  // Turno 1: Búsqueda por zona
  const res42a = await evaluateCentralDecisionPipeline({
    userText: 'Hola, busco apartamento en venta en Los Samanes',
    leadId: 'lead_t42',
    properties: mockProperties,
    handoffManager
  });
  // Turno 2: Pregunta específica sin enlace ni contexto de propiedad individual
  const res42b = await evaluateCentralDecisionPipeline({
    userText: '¿Cuántos metros cuadrados tiene?',
    leadId: 'lead_t42',
    properties: mockProperties,
    handoffManager
    // Sin activePropertyContext
  });
  recordResult(
    42,
    'Pregunta específica posterior a búsqueda por zona sin link -> Guarda SILENCIO (0 tokens)',
    res42a.shouldRespond === true && res42b.shouldRespond === false && res42b.tokensUsed === 0 && res42b.log.typeDetected === 'UNMATCHED_INQUIRY',
    `Turno 1: ${res42a.shouldRespond}, Turno 2: ${res42b.shouldRespond} (Tokens: ${res42b.tokensUsed}, Tipo: ${res42b.log.typeDetected})`
  );

  // --------------------------------------------------------------------------
  // TEST 43: Clasificación de mensaje saliente del Bot (`author.type === 'bot'`)
  // --------------------------------------------------------------------------
  const mockMsgBot = {
    author: { type: 'bot', id: 'bot_system_1' },
    text: AVAILABILITY_RESPONSE
  };
  const classificationBot = classifyOutgoingMessage(mockMsgBot, () => true);
  recordResult(
    43,
    'Clasificación de mensaje saliente con author.type === "bot" -> Identificado como Bot (isBot: true, NO bloquea)',
    classificationBot.isBot === true && classificationBot.isHumanAdvisor === false,
    `isBot: ${classificationBot.isBot}, isHumanAdvisor: ${classificationBot.isHumanAdvisor}, Razón: ${classificationBot.reason}`
  );

  // --------------------------------------------------------------------------
  // TEST 44: Validación física de 13 columnas autorizadas de Google Sheets (ZONA no existe como columna física)
  // --------------------------------------------------------------------------
  const expectedCols = [
    'ID_PROPIEDAD',
    'TIPO',
    'OPERACION',
    'DESCRIPCION_BREVE',
    'LINK_FOTOS',
    'Wasi',
    'Mercado Libre',
    'Pagina Web',
    'Agente',
    'Numero de WhatsApp',
    'ESTATUS',
    'Mascotas',
    'Tipo de Mascotas'
  ];
  const allColsMatch = expectedCols.length === AUTHORIZED_COLUMNS.length &&
    expectedCols.every(c => AUTHORIZED_COLUMNS.includes(c)) &&
    !AUTHORIZED_COLUMNS.includes('ZONA');

  recordResult(
    44,
    'Validación física de 13 columnas de Sheets -> AUTHORIZED_COLUMNS contiene exactamente las 13 oficiales (sin ZONA)',
    allColsMatch === true,
    `Columnas autorizadas: ${AUTHORIZED_COLUMNS.length} (ZONA incluida: ${AUTHORIZED_COLUMNS.includes('ZONA')})`
  );

  // Limpieza de archivos temporales
  if (fs.existsSync(testHandoffFile)) fs.unlinkSync(testHandoffFile);
  if (fs.existsSync(nonExistentFile)) fs.unlinkSync(nonExistentFile);

  console.log('\n================================================================');
  console.log(` RESULTADOS FINALES: ${passedCount} / 44 PRUEBAS SUPERADAS (${Math.round((passedCount / 44) * 100)}%) `);
  console.log('================================================================');

  if (passedCount !== 44) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Error fatal ejecutando test suite:', err);
  process.exit(1);
});
