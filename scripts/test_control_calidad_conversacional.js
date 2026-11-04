require('dotenv').config();
const {
  evaluateCentralDecisionPipeline,
  HandoffManager,
  ConversationContextManager,
  DeduplicationManager
} = require('../pipeline_decision.js');

async function runConversationalQualitySuite() {
  console.log('================================================================');
  console.log(' SUITE DE CONTROL DE CALIDAD CONVERSACIONAL (10 ESCENARIOS)     ');
  console.log('================================================================\n');

  let passed = 0;
  let total = 10;

  // Mock properties catalog (REF-012, REF-005, REF-001, REF-062)
  const mockProperties = [
    {
      ID_PROPIEDAD: 'REF-012',
      TITULO: 'Apartamento en Los Samanes',
      CODIGO_WASI: '10442900',
      Wasi_URL: 'https://info.wasi.co/apartamento-venta-los-samanes-caracas/10442900',
      ESTATUS: 'Disponible',
      OPERACION: 'Venta',
      DESCRIPCION_BREVE: 'Se ofrece en venta este excelente apartamento amoblado de 110 m², ubicado en Los Samanes. Su cómoda distribución comprende tres habitaciones, dos baños completos y un práctico estudio convertible. Precio de $146.000. Servicios Básicos. Agua: No especificado en la fuente. Almacenamiento de agua: tanque de agua. Pozo: No especificado en la fuente. Gas: No especificado en la fuente. Electricidad / Respaldo: No especificado en la fuente. Internet / Telecomunicaciones: No especificado en la fuente. Telefonía: No especificado en la fuente. Condiciones Comerciales (Venta) Precio: $146.000. Condominio: No especificado en la fuente. Características Físicas y Distribución. Metraje: 110 m². Habitaciones y Baños: dos baños. Estacionamiento: dos puestos de estacionamiento. Amenidades: Parque infantil. Ubicación: Los Samanes.'
    },
    {
      ID_PROPIEDAD: 'REF-005',
      TITULO: 'Apartamento en Chacao',
      CODIGO_WASI: '10442800',
      Wasi_URL: 'https://info.wasi.co/apartamento-venta-chacao-caracas/10442800',
      ESTATUS: 'Disponible',
      OPERACION: 'Venta',
      DESCRIPCION_BREVE: 'Apartamento de 80,45 m² en Chacao, una habitación, un baño completo, un medio baño para visitas, por una inversión total de $355.674. Servicios Básicos. Agua: No especificado en la fuente. Condiciones Comerciales (Venta) Precio: $355.674. Características Físicas y Distribución. Metraje: 80,45 m². Habitaciones y Baños: una habitación y un baño. Ubicación: Chacao.'
    },
    {
      ID_PROPIEDAD: 'REF-001',
      TITULO: 'Casa Quinta en Los Samanes',
      CODIGO_WASI: '10442700',
      Wasi_URL: 'https://info.wasi.co/casa-los-samanes-caracas/10442700',
      ESTATUS: 'Disponible',
      OPERACION: 'Venta y Alquiler',
      DESCRIPCION_BREVE: 'Hermosa casa quinta de dos niveles en venta y alquiler, ubicada en Los Samanes. Cuenta con 600 m² de terreno y 450 m² de construcción, distribuidos en 4 habitaciones, 5 baños. Precio de venta de $600.000 y canon de arrendamiento de $3.500.'
    },
    {
      ID_PROPIEDAD: 'REF-062',
      TITULO: 'Apartamento en Lomas del Sol',
      CODIGO_WASI: '10544010',
      Wasi_URL: 'https://info.wasi.co/apartamento-venta-lomas-del-sol-caracas/10544010',
      ESTATUS: 'Disponible',
      OPERACION: 'Venta',
      DESCRIPCION_BREVE: 'Servicios Básicos. Agua: Constante. Almacenamiento de agua: No especificado en la fuente. Pozo: No especificado en la fuente. Gas: No especificado en la fuente. Electricidad / Respaldo: Instalación de 110V y 220V. Internet / Telecomunicaciones: No especificado en la fuente. Telefonía: No especificado en la fuente. Condiciones Comerciales (Venta) Precio: $170.000. Formas de pago / Métodos aceptados: Efectivo, Zelle, Transferencia, Binance Negociabilidad: No especificado en la fuente. Financiamiento: No posee financiamiento. Créditos: No especificado en la fuente. Permutas: No especificado en la fuente. Condominio: 65-70 a tasa BCV. Características Físicas y Distribución. Metraje: 83 m². Habitaciones y Baños: 2 habitaciones y 2 baños. Estacionamiento: 2 puestos de estacionamiento. Maletero: 1 maletero. Nivel / Ubicación: Piso 3. Equipamiento: Cocina eléctrica. Amenidades: Área para parrillas (área común). Documentación: Documentación al día. Ubicación: Lomas del Sol.'
    }
  ];

  const handoffManager = new HandoffManager(null, async () => ({ hasHumanIntervention: false }));
  const contextManager = new ConversationContextManager();
  const deduplicationManager = new DeduplicationManager();

  // -------------------------------------------------------------
  // ESCENARIO 1: Saludo inicial -> Silencio. Luego link Wasi -> Bienvenida. Luego metraje -> Dato sin repetir bienvenida.
  // -------------------------------------------------------------
  const talk1 = 'qc_talk_1';
  const t1_res1 = await evaluateCentralDecisionPipeline({
    userText: 'Hola, buenas tardes!',
    talkId: talk1,
    leadId: 'lead_qc_1',
    properties: mockProperties,
    contextManager,
    handoffManager,
    deduplicationManager
  });
  const t1_step1_ok = t1_res1.shouldRespond === false && (t1_res1.log.typeDetected === 'PURE_GREETING' || t1_res1.log.typeDetected === 'UNMATCHED_INQUIRY');

  const t1_res2 = await evaluateCentralDecisionPipeline({
    userText: 'Buenas tardes, vi este inmueble: https://info.wasi.co/apartamento-venta-los-samanes-caracas/10442900',
    talkId: talk1,
    leadId: 'lead_qc_1',
    properties: mockProperties,
    contextManager,
    handoffManager,
    deduplicationManager
  });
  const t1_step2_ok = t1_res2.shouldRespond === true && t1_res2.text === 'Bienvenido a Tu Techo Ideal, sí, disponible.';

  const t1_res3 = await evaluateCentralDecisionPipeline({
    userText: '¿Cuántos metros cuadrados tiene?',
    talkId: talk1,
    leadId: 'lead_qc_1',
    properties: mockProperties,
    contextManager,
    handoffManager,
    deduplicationManager
  });
  const t1_step3_ok = t1_res3.shouldRespond === true && t1_res3.text === 'Tiene 110 m²' && !t1_res3.text.includes('Bienvenido');

  if (t1_step1_ok && t1_step2_ok && t1_step3_ok) {
    passed++;
    console.log('✅ [Escenario 1/10] PASÓ: Saludo -> Silencio humano (PURE_GREETING) | Link Wasi -> Bienvenida | Metraje -> "Tiene 110 m²" sin repetir bienvenida');
  } else {
    console.error('❌ [Escenario 1/10] FALLÓ:', { t1_step1_ok, t1_step2_ok, t1_step3_ok });
  }

  // -------------------------------------------------------------
  // ESCENARIO 2: Varias preguntas consecutivas sobre el mismo inmueble (Precio, Habitaciones, Baños)
  // -------------------------------------------------------------
  const t2_res1 = await evaluateCentralDecisionPipeline({
    userText: '¿Cuál es su precio?',
    talkId: talk1,
    leadId: 'lead_qc_1',
    properties: mockProperties,
    contextManager,
    handoffManager,
    deduplicationManager
  });
  const t2_p_ok = t2_res1.text === '$146.000';

  const t2_res2 = await evaluateCentralDecisionPipeline({
    userText: '¿Cuántas habitaciones tiene?',
    talkId: talk1,
    leadId: 'lead_qc_1',
    properties: mockProperties,
    contextManager,
    handoffManager,
    deduplicationManager
  });
  const t2_h_ok = t2_res2.text === 'Tiene 3 habitaciones';

  const t2_res3 = await evaluateCentralDecisionPipeline({
    userText: '¿Cuántos baños tiene?',
    talkId: talk1,
    leadId: 'lead_qc_1',
    properties: mockProperties,
    contextManager,
    handoffManager,
    deduplicationManager
  });
  const t2_b_ok = t2_res3.text === 'Tiene dos baños completos';

  if (t2_p_ok && t2_h_ok && t2_b_ok) {
    passed++;
    console.log('✅ [Escenario 2/10] PASÓ: Múltiples preguntas del mismo inmueble -> Precio: $146.000, Hab: 3, Baños: dos baños completos');
  } else {
    console.error('❌ [Escenario 2/10] FALLÓ:', { t2_p_ok, t2_h_ok, t2_b_ok });
  }

  // -------------------------------------------------------------
  // ESCENARIO 3: Cambio limpio de propiedad en el mismo chat (REF-012 a REF-005)
  // -------------------------------------------------------------
  const t3_res1 = await evaluateCentralDecisionPipeline({
    userText: 'Y este otro apartamento: https://info.wasi.co/apartamento-venta-chacao-caracas/10442800',
    talkId: talk1,
    leadId: 'lead_qc_1',
    properties: mockProperties,
    contextManager,
    handoffManager,
    deduplicationManager
  });
  const t3_link_ok = t3_res1.text === 'Bienvenido a Tu Techo Ideal, sí, disponible.';

  const t3_res2 = await evaluateCentralDecisionPipeline({
    userText: '¿Cuántos metros tiene este?',
    talkId: talk1,
    leadId: 'lead_qc_1',
    properties: mockProperties,
    contextManager,
    handoffManager,
    deduplicationManager
  });
  const t3_m_ok = t3_res2.text === 'Tiene 80,45 m²';

  const t3_res3 = await evaluateCentralDecisionPipeline({
    userText: '¿Cuál es su precio?',
    talkId: talk1,
    leadId: 'lead_qc_1',
    properties: mockProperties,
    contextManager,
    handoffManager,
    deduplicationManager
  });
  const t3_p_ok = t3_res3.text === '$355.674';

  if (t3_link_ok && t3_m_ok && t3_p_ok) {
    passed++;
    console.log('✅ [Escenario 3/10] PASÓ: Transición de REF-012 a REF-005 -> Aislamiento 100%, Metraje: 80,45 m², Precio: $355.674 (0 mezcla)');
  } else {
    console.error('❌ [Escenario 3/10] FALLÓ:', { t3_link_ok, t3_m_ok, t3_p_ok });
  }

  // -------------------------------------------------------------
  // ESCENARIO 4: Preguntar nuevamente algo ya respondido (No duplicación ni bucles)
  // -------------------------------------------------------------
  const t4_res1 = await evaluateCentralDecisionPipeline({
    userText: 'Disculpa, ¿me repites cuánto cuesta?',
    talkId: talk1,
    leadId: 'lead_qc_1',
    properties: mockProperties,
    contextManager,
    handoffManager,
    deduplicationManager
  });
  const t4_ok = t4_res1.shouldRespond === true && t4_res1.text === '$355.674';
  if (t4_ok) {
    passed++;
    console.log('✅ [Escenario 4/10] PASÓ: Repregunta de precio -> Responde concisamente "$355.674" sin repetir mensajes previos ni palabras redundantes');
  } else {
    console.error('❌ [Escenario 4/10] FALLÓ:', t4_res1);
  }

  // -------------------------------------------------------------
  // ESCENARIO 5: Pregunta incompleta o sin propiedad activa en nueva conversación
  // -------------------------------------------------------------
  const talk2 = 'qc_talk_sin_propiedad';
  const t5_res = await evaluateCentralDecisionPipeline({
    userText: '¿Tienen financiamiento?',
    talkId: talk2,
    leadId: 'lead_qc_2',
    properties: mockProperties,
    contextManager,
    handoffManager,
    deduplicationManager
  });
  const t5_ok = t5_res.shouldRespond === false && t5_res.log.typeDetected === 'UNMATCHED_INQUIRY';
  if (t5_ok) {
    passed++;
    console.log('✅ [Escenario 5/10] PASÓ: Pregunta sin propiedad activa -> Silencio absoluto (UNMATCHED_INQUIRY), derivado a asesor humano');
  } else {
    console.error('❌ [Escenario 5/10] FALLÓ:', t5_res);
  }

  // -------------------------------------------------------------
  // ESCENARIO 6: Solicitar información inexistente (Piscina / Condominio no existente)
  // -------------------------------------------------------------
  const t6_res1 = await evaluateCentralDecisionPipeline({
    userText: '¿El edificio tiene piscina o cancha de tenis?',
    talkId: talk1,
    leadId: 'lead_qc_1',
    properties: mockProperties,
    contextManager,
    handoffManager,
    deduplicationManager
  });
  const t6_piscina_ok = t6_res1.shouldRespond === false && t6_res1.log.typeDetected === 'PROPERTY_FEATURE_SIN_DATO';

  const t6_res2 = await evaluateCentralDecisionPipeline({
    userText: '¿Cuánto se paga de condominio mensual?',
    talkId: talk1,
    leadId: 'lead_qc_1',
    properties: mockProperties,
    contextManager,
    handoffManager,
    deduplicationManager
  });
  const t6_condo_ok = t6_res2.shouldRespond === false && t6_res2.log.typeDetected === 'PROPERTY_FEATURE_SIN_DATO';

  if (t6_piscina_ok && t6_condo_ok) {
    passed++;
    console.log('✅ [Escenario 6/10] PASÓ: Información no especificada en Sheets (Piscina y Condominio) -> Silencio absoluto (Cero invención)');
  } else {
    console.error('❌ [Escenario 6/10] FALLÓ:', { t6_piscina_ok, t6_condo_ok });
  }

  // -------------------------------------------------------------
  // ESCENARIO 7: Inmueble con Venta y Alquiler simultáneos (REF-001)
  // -------------------------------------------------------------
  const talk3 = 'qc_talk_dual';
  await evaluateCentralDecisionPipeline({
    userText: 'Me interesa: https://info.wasi.co/casa-los-samanes-caracas/10442700',
    talkId: talk3,
    leadId: 'lead_qc_3',
    properties: mockProperties,
    contextManager,
    handoffManager,
    deduplicationManager
  });

  const t7_res_ambiguo = await evaluateCentralDecisionPipeline({
    userText: '¿Cuál es el precio?',
    talkId: talk3,
    leadId: 'lead_qc_3',
    properties: mockProperties,
    contextManager,
    handoffManager,
    deduplicationManager
  });
  const t7_ambiguo_ok = t7_res_ambiguo.shouldRespond === false && t7_res_ambiguo.log.typeDetected === 'PROPERTY_FEATURE_SIN_DATO';

  const t7_res_venta = await evaluateCentralDecisionPipeline({
    userText: '¿Cuál es el precio de venta?',
    talkId: talk3,
    leadId: 'lead_qc_3',
    properties: mockProperties,
    contextManager,
    handoffManager,
    deduplicationManager
  });
  const t7_venta_ok = t7_res_venta.shouldRespond === true && t7_res_venta.text === '$600.000';

  if (t7_ambiguo_ok && t7_venta_ok) {
    passed++;
    console.log('✅ [Escenario 7/10] PASÓ: Propiedad en Venta y Alquiler -> Pregunta genérica: Silencio seguro | Pregunta específica de venta: "$600.000"');
  } else {
    console.error('❌ [Escenario 7/10] FALLÓ:', { t7_ambiguo_ok, t7_venta_ok });
  }

  // -------------------------------------------------------------
  // ESCENARIO 8: Mensajes consecutivos simultáneos (Deduplication / Mutex)
  // -------------------------------------------------------------
  const talk4 = 'qc_talk_mutex';
  const now = Date.now();
  const firstCheck = deduplicationManager.checkAndRecord('msg_dedup_100', talk4, now);
  const secondCheck = deduplicationManager.checkAndRecord('msg_dedup_100', talk4, now + 100);

  if (firstCheck.isDuplicate === false && secondCheck.isDuplicate === true) {
    passed++;
    console.log('✅ [Escenario 8/10] PASÓ: Mensajes simultáneos o duplicados -> Deduplicación activa (1er envío: procesado, 2do duplicado: descartado)');
  } else {
    console.error('❌ [Escenario 8/10] FALLÓ:', { firstCheck, secondCheck });
  }

  // -------------------------------------------------------------
  // ESCENARIO 9: Cliente sigue escribiendo mientras asesor humano interviene (Bloqueo 12h)
  // -------------------------------------------------------------
  const talk5 = 'qc_talk_handoff';
  await evaluateCentralDecisionPipeline({
    userText: 'https://info.wasi.co/apartamento-venta-los-samanes-caracas/10442900',
    talkId: talk5,
    leadId: 'lead_qc_5',
    properties: mockProperties,
    contextManager,
    handoffManager,
    deduplicationManager
  });

  // Asesor humano interviene
  handoffManager.recordHumanIntervention('lead_qc_5', talk5, null, Date.now());

  // Cliente envía 3 mensajes subsiguientes
  const t9_m1 = await evaluateCentralDecisionPipeline({
    userText: '¿Hola, sigue disponible?',
    talkId: talk5,
    leadId: 'lead_qc_5',
    properties: mockProperties,
    contextManager,
    handoffManager,
    deduplicationManager
  });
  const t9_m2 = await evaluateCentralDecisionPipeline({
    userText: '¿Cuántos metros tiene?',
    talkId: talk5,
    leadId: 'lead_qc_5',
    properties: mockProperties,
    contextManager,
    handoffManager,
    deduplicationManager
  });
  const t9_m3 = await evaluateCentralDecisionPipeline({
    userText: '¿Cuál es el precio?',
    talkId: talk5,
    leadId: 'lead_qc_5',
    properties: mockProperties,
    contextManager,
    handoffManager,
    deduplicationManager
  });

  const t9_ok = t9_m1.shouldRespond === false && t9_m1.log.typeDetected === 'HUMAN_LOCKED' &&
                t9_m2.shouldRespond === false && t9_m2.log.typeDetected === 'HUMAN_LOCKED' &&
                t9_m3.shouldRespond === false && t9_m3.log.typeDetected === 'HUMAN_LOCKED';

  if (t9_ok) {
    passed++;
    console.log('✅ [Escenario 9/10] PASÓ: Asesor interviene -> Silencio absoluto incondicional en los 3 mensajes siguientes del cliente (HUMAN_LOCKED)');
  } else {
    console.error('❌ [Escenario 9/10] FALLÓ:', { t9_m1, t9_m2, t9_m3 });
  }

  // -------------------------------------------------------------
  // ESCENARIO 10: Propiedad con Formato Complementario Integral (REF-062 Lomas del Sol)
  // -------------------------------------------------------------
  const talk6 = 'qc_talk_lomas';
  await evaluateCentralDecisionPipeline({
    userText: 'https://info.wasi.co/apartamento-venta-lomas-del-sol-caracas/10544010',
    talkId: talk6,
    leadId: 'lead_qc_6',
    properties: mockProperties,
    contextManager,
    handoffManager,
    deduplicationManager
  });

  const t10_metraje = await evaluateCentralDecisionPipeline({
    userText: '¿Cuántos metros tiene este apartamento en Lomas del Sol?',
    talkId: talk6,
    leadId: 'lead_qc_6',
    properties: mockProperties,
    contextManager,
    handoffManager,
    deduplicationManager
  });
  const t10_m_ok = t10_metraje.text === 'Tiene 83 m²';

  const t10_precio = await evaluateCentralDecisionPipeline({
    userText: '¿Cuál es el precio?',
    talkId: talk6,
    leadId: 'lead_qc_6',
    properties: mockProperties,
    contextManager,
    handoffManager,
    deduplicationManager
  });
  const t10_p_ok = t10_precio.text === '$170.000';

  const t10_inexistente = await evaluateCentralDecisionPipeline({
    userText: '¿Tiene piscina propia?',
    talkId: talk6,
    leadId: 'lead_qc_6',
    properties: mockProperties,
    contextManager,
    handoffManager,
    deduplicationManager
  });
  const t10_inex_ok = t10_inexistente.shouldRespond === false && t10_inexistente.log.typeDetected === 'PROPERTY_FEATURE_SIN_DATO';

  if (t10_m_ok && t10_p_ok && t10_inex_ok) {
    passed++;
    console.log('✅ [Escenario 10/10] PASÓ: REF-062 con Formato Complementario -> Metraje: 83 m², Precio: $170.000, Piscina: Silencio seguro');
  } else {
    console.error('❌ [Escenario 10/10] FALLÓ:', { t10_m_ok, t10_p_ok, t10_inex_ok });
  }

  console.log('\n================================================================');
  console.log(` RESULTADOS CONTROL DE CALIDAD: ${passed} / ${total} PRUEBAS SUPERADAS (${(passed/total)*100}%) `);
  console.log('================================================================');
}

runConversationalQualitySuite().catch(console.error);
