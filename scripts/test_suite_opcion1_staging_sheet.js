const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const {
  parseXlsxBufferToProperties,
  getStagingTestProperties,
  OFFICIAL_GOOGLE_SHEET_ID,
  GOOGLE_SHEET_TEST_URL_REGEX,
  getStagingTestSheetCache,
  getAvailableProperties
} = require('../server.js');
const {
  evaluateCentralDecisionPipeline,
  ConversationContextManager,
  HandoffManager
} = require('../pipeline_decision.js');

async function runTestSuiteOpcion1() {
  console.log('================================================================');
  console.log(' SUITE DE VERIFICACIÓN TÉCNICA: MECANISMO DE HOJA DE PRUEBAS   ');
  console.log('        (OPCIÓN 1 - AISLAMIENTO ABSOLUTO EN STAGING)            ');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  function assertTest(name, condition, detail) {
    total++;
    if (condition) {
      passed++;
      console.log(`✅ [Test ${total}] PASÓ: ${name}`);
      console.log(`   Detalle: ${detail}\n`);
    } else {
      console.error(`❌ [Test ${total}] FALLÓ: ${name}`);
      console.error(`   Detalle: ${detail}\n`);
    }
  }

  // --------------------------------------------------------------------------
  // GRUPO 1: SEGURIDAD Y VALIDACIÓN DE URL (SSRF & ID DE HOJA OFICIAL)
  // --------------------------------------------------------------------------
  console.log('--- GRUPO 1: VALIDACIÓN DE SEGURIDAD DE URL (SSRF) ---');

  // 1.1 Aceptación sintáctica de URL legítima de Google Sheets simple
  const urlLegitimaSimple = 'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';
  assertTest(
    '1. URL legítima de Google Sheets aceptada',
    GOOGLE_SHEET_TEST_URL_REGEX.test(urlLegitimaSimple),
    `Patrón validado para: ${urlLegitimaSimple}`
  );

  // 1.2 Aceptación sintáctica de URL con /edit#gid=0
  const urlLegitimaEditGid = 'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0';
  assertTest(
    '2. URL con /edit#gid=0 aceptada',
    GOOGLE_SHEET_TEST_URL_REGEX.test(urlLegitimaEditGid),
    `Patrón validado para: ${urlLegitimaEditGid}`
  );

  // 1.3 Rechazo EXPRESO de la Google Sheet oficial directa
  let errOficialDirecta = null;
  try {
    await getStagingTestProperties(`https://docs.google.com/spreadsheets/d/${OFFICIAL_GOOGLE_SHEET_ID}`);
  } catch (e) {
    errOficialDirecta = e.message;
  }
  assertTest(
    '3. URL oficial rechazada categóricamente',
    errOficialDirecta && errOficialDirecta.includes('No se permite usar la Google Sheet oficial'),
    `Capturado error de salvaguarda: "${errOficialDirecta}"`
  );

  // 1.4 Rechazo de la Google Sheet oficial con parámetros ?x=1
  let errOficialParam = null;
  try {
    await getStagingTestProperties(`https://docs.google.com/spreadsheets/d/${OFFICIAL_GOOGLE_SHEET_ID}?x=1`);
  } catch (e) {
    errOficialParam = e.message;
  }
  assertTest(
    '4. URL oficial con ?x=1 sigue siendo rechazada',
    errOficialParam && errOficialParam.includes('No se permite usar la Google Sheet oficial'),
    `Capturado error de salvaguarda: "${errOficialParam}"`
  );

  // 1.5 Rechazo de la Google Sheet oficial con fragmento #gid=0
  let errOficialHash = null;
  try {
    await getStagingTestProperties(`https://docs.google.com/spreadsheets/d/${OFFICIAL_GOOGLE_SHEET_ID}/edit#gid=0`);
  } catch (e) {
    errOficialHash = e.message;
  }
  assertTest(
    '5. URL oficial con #gid=0 sigue siendo rechazada',
    errOficialHash && errOficialHash.includes('No se permite usar la Google Sheet oficial'),
    `Capturado error de salvaguarda: "${errOficialHash}"`
  );

  // 1.6 IDs con caracteres no permitidos (@, :, ?, [, /, etc.) rechazados por regex
  const invalidIdUrls = [
    'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2up@s/edit',
    'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2up:s/edit',
    'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2up.s/edit',
    'https://docs.google.com/spreadsheets/d/short_id_below_20/edit'
  ];
  const allInvalidRejected = invalidIdUrls.every(u => !GOOGLE_SHEET_TEST_URL_REGEX.test(u));
  assertTest(
    '6. IDs con caracteres no permitidos (@, :, ., longitud < 20) rechazados',
    allInvalidRejected,
    `Verificados 4 intentos de inyección y longitud inválida, todos rechazados`
  );

  // 1.7 Dominios falsos (docs.google.com.evil.com) rechazados
  const fakeDomains = [
    'https://docs.google.com.evil.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit',
    'https://evil-docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit',
    'http://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit'
  ];
  const allFakeRejected = fakeDomains.every(u => !GOOGLE_SHEET_TEST_URL_REGEX.test(u));
  assertTest(
    '7. Dominios falsos (docs.google.com.evil.com o HTTP inseguro) rechazados',
    allFakeRejected,
    `Verificados dominios fraudulentos y protocolo no HTTPS, todos rechazados`
  );

  // 1.8 Imposibilidad de consultar dominios externos (SSRF)
  let errSsrf = null;
  try {
    await getStagingTestProperties('https://evil-server.com/malicious.xlsx');
  } catch (e) {
    errSsrf = e.message;
  }
  assertTest(
    '8. Imposibilidad absoluta de consulta a dominios externos (Blindaje SSRF)',
    errSsrf && errSsrf.includes('test_sheet_url inválida'),
    `Capturado error: "${errSsrf}". Descarga restringida por código a docs.google.com con sheetId sanitizado`
  );

  // 1.9 Validación estricta de tipo booleano en forceRefresh
  let errBool = null;
  try {
    await getStagingTestProperties('https://docs.google.com/spreadsheets/d/1TEST_SHEET_ID_ABCD_1234567890_XYZ/edit#gid=0', 'true');
  } catch (e) {
    errBool = e.message;
  }
  assertTest(
    '9. test_sheet_force_refresh exige booleano primitivo real (rechaza string "true")',
    errBool && errBool.includes('debe ser un valor booleano'),
    `Capturado error de tipo estricto: "${errBool}"`
  );

  // --------------------------------------------------------------------------
  // GRUPO 2: AISLAMIENTO ABSOLUTO DE CACHÉ Y NO CONTAMINACIÓN
  // --------------------------------------------------------------------------
  console.log('--- GRUPO 2: VERIFICACIÓN DE AISLAMIENTO ABSOLUTO DE CACHÉ ---');

  // Capturar estado previo de la memoria oficial
  const officialPropsBefore = await getAvailableProperties();
  const officialCountBefore = officialPropsBefore.length;
  const officialPropsCacheDiskBefore = fs.readFileSync(path.join(__dirname, '../properties_cache.json'), 'utf8');

  // Construir workbook de prueba sintético con REF-070
  function buildTestXlsxBuffer(prop) {
    const wb = XLSX.utils.book_new();
    const headers = [
      'ID_PROPIEDAD', 'TIPO', 'OPERACION', 'DESCRIPCION_BREVE',
      'LINK_FOTOS', 'Wasi', 'Mercado Libre', 'Pagina Web',
      'Agente', 'Numero de WhatsApp', 'ESTATUS', 'Mascotas', 'Tipo de Mascotas'
    ];
    const data = [headers];
    if (prop) {
      data.push([
        prop.ID_PROPIEDAD,
        prop.TIPO,
        prop.OPERACION,
        prop.DESCRIPCION_BREVE,
        'https://fotos.test/1',
        prop.Wasi,
        '', '',
        'Asesor Test',
        '584140000000',
        'Disponible',
        'No', 'Ninguna'
      ]);
    }
    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'Hoja 1');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  // 2.1 Parseo de prueba no contamina variables globales oficiales
  const testBufferA = buildTestXlsxBuffer({
    ID_PROPIEDAD: 'REF-070',
    TIPO: 'Apartamento',
    OPERACION: 'Venta',
    DESCRIPCION_BREVE: 'Apartamento de prueba en Los Palos Grandes de 150 m² con 3 habitaciones y 2 baños por un precio de $220.000.',
    Wasi: 'https://info.wasi.co/apartamento-venta/77889900'
  });
  const parsedTestProps = parseXlsxBufferToProperties(testBufferA);

  assertTest(
    'Parseo de buffer XLSX independiente genera array limpio de 1 propiedad',
    parsedTestProps.length === 1 && parsedTestProps[0].ID_PROPIEDAD === 'REF-070' && parsedTestProps[0].CODIGO_WASI === '77889900',
    `Propiedad extraída: ${parsedTestProps[0].ID_PROPIEDAD}, Código Wasi: ${parsedTestProps[0].CODIGO_WASI}`
  );

  // Verificar que el inventario oficial sigue teniendo exactamente la misma cantidad
  const officialPropsAfter = await getAvailableProperties();
  const officialPropsCacheDiskAfter = fs.readFileSync(path.join(__dirname, '../properties_cache.json'), 'utf8');

  assertTest(
    'cachedProperties oficial NO se modifica ni se contamina con REF-070',
    officialPropsAfter.length === officialCountBefore && !officialPropsAfter.some(p => p.ID_PROPIEDAD === 'REF-070'),
    `Conteo oficial intacto: ${officialPropsAfter.length} propiedades (REF-070 ausente de memoria global)`
  );

  assertTest(
    'properties_cache.json en disco permanece 100% idéntico e intacto',
    officialPropsCacheDiskBefore === officialPropsCacheDiskAfter,
    `Respaldo local permanente en disco no sufrió alteraciones de bytes`
  );

  // --------------------------------------------------------------------------
  // GRUPO 3: SIMULACIÓN DE ALTA, MODIFICACIÓN Y BAJA EN MEMORIA AISLADA
  // --------------------------------------------------------------------------
  console.log('--- GRUPO 3: PRUEBAS DE ALTA, MODIFICACIÓN Y BAJA (CICLO DINÁMICO) ---');

  const handoffManager = new HandoffManager(path.join(__dirname, 'test_handoffs_opcion1.json'));
  const contextManager = new ConversationContextManager();

  // 3.1 PRUEBA A: ALTA (REF-070 con 150 m² y $220.000)
  const rAltaLink = await evaluateCentralDecisionPipeline({
    userText: 'Hola me interesa https://info.wasi.co/apartamento-venta/77889900',
    leadId: 'lead_test_alta',
    talkId: 'talk_test_alta',
    properties: parsedTestProps,
    handoffManager,
    contextManager
  });
  assertTest(
    'PRUEBA A (Alta - Detección): Reconocimiento y bienvenida de REF-070',
    rAltaLink.shouldRespond === true && rAltaLink.text === 'Bienvenido a Tu Techo Ideal, sí, disponible.',
    `Respuesta: "${rAltaLink.text}", Propiedad: ${rAltaLink.targetProperty ? rAltaLink.targetProperty.ID_PROPIEDAD : 'null'}`
  );

  const rAltaMetraje = await evaluateCentralDecisionPipeline({
    userText: '¿cuántos metros tiene?',
    leadId: 'lead_test_alta',
    talkId: 'talk_test_alta',
    properties: parsedTestProps,
    handoffManager,
    contextManager
  });
  assertTest(
    'PRUEBA A (Alta - Metraje): Extracción exacta de 150 m² (0 tokens IA)',
    rAltaMetraje.shouldRespond === true && rAltaMetraje.text === 'Tiene 150 m²' && rAltaMetraje.log.tokensUsed === 0,
    `Respuesta: "${rAltaMetraje.text}", Evidencia: "${rAltaMetraje.log.evidence}"`
  );

  const rAltaPrecio = await evaluateCentralDecisionPipeline({
    userText: '¿cuál es el precio?',
    leadId: 'lead_test_alta',
    talkId: 'talk_test_alta',
    properties: parsedTestProps,
    handoffManager,
    contextManager
  });
  assertTest(
    'PRUEBA A (Alta - Precio): Extracción exacta de $220.000 (0 tokens IA)',
    rAltaPrecio.shouldRespond === true && rAltaPrecio.text === '$220.000' && rAltaPrecio.log.tokensUsed === 0,
    `Respuesta: "${rAltaPrecio.text}", Evidencia: "${rAltaPrecio.log.evidence}"`
  );

  // 3.2 PRUEBA B: MODIFICACIÓN (Cambio a 180 m² y $250.000)
  const testBufferMod = buildTestXlsxBuffer({
    ID_PROPIEDAD: 'REF-070',
    TIPO: 'Apartamento',
    OPERACION: 'Venta',
    DESCRIPCION_BREVE: 'Apartamento ampliado en Los Palos Grandes de 180 m² con 3 habitaciones y 2 baños por un precio de $250.000.',
    Wasi: 'https://info.wasi.co/apartamento-venta/77889900'
  });
  const parsedModProps = parseXlsxBufferToProperties(testBufferMod);

  // Actualizar contexto con la propiedad modificada
  contextManager.saveContext('talk_test_mod', 'lead_test_mod', parsedModProps[0]);

  const rModMetraje = await evaluateCentralDecisionPipeline({
    userText: '¿cuántos metros tiene?',
    leadId: 'lead_test_mod',
    talkId: 'talk_test_mod',
    properties: parsedModProps,
    handoffManager,
    contextManager
  });
  assertTest(
    'PRUEBA B (Modificación - Metraje): Refleja 180 m² tras actualización sin residuos de 150 m²',
    rModMetraje.shouldRespond === true && rModMetraje.text === 'Tiene 180 m²',
    `Nuevo metraje extraído: "${rModMetraje.text}" (anterior: 150 m²)`
  );

  const rModPrecio = await evaluateCentralDecisionPipeline({
    userText: '¿cuál es el precio?',
    leadId: 'lead_test_mod',
    talkId: 'talk_test_mod',
    properties: parsedModProps,
    handoffManager,
    contextManager
  });
  assertTest(
    'PRUEBA B (Modificación - Precio): Refleja $250.000 tras actualización sin residuos de $220.000',
    rModPrecio.shouldRespond === true && rModPrecio.text === '$250.000',
    `Nuevo precio extraído: "${rModPrecio.text}" (anterior: $220.000)`
  );

  // 3.3 PRUEBA C: ELIMINACIÓN (Retiro de REF-070 de la hoja)
  const testBufferBaja = buildTestXlsxBuffer(null); // Hoja sin propiedades
  const parsedBajaProps = parseXlsxBufferToProperties(testBufferBaja);

  const rBaja = await evaluateCentralDecisionPipeline({
    userText: 'Hola me interesa https://info.wasi.co/apartamento-venta/77889900',
    leadId: 'lead_test_baja',
    talkId: 'talk_test_baja',
    properties: parsedBajaProps,
    handoffManager,
    contextManager: new ConversationContextManager()
  });
  assertTest(
    'PRUEBA C (Eliminación): Propiedad retirada deja de ofrecerse de inmediato (Silencio)',
    rBaja.shouldRespond === false && rBaja.text === null,
    `Acción: ${rBaja.log.action}, Motivo: ${rBaja.log.reason}`
  );

  // 3.4 PRUEBA D: AISLAMIENTO ENTRE PROPIEDADES EN PARALELO
  const rOficial = await evaluateCentralDecisionPipeline({
    userText: '¿cuántos metros de construcción tiene?',
    leadId: 'lead_oficial_test',
    talkId: 'talk_oficial_test',
    properties: officialPropsBefore,
    handoffManager,
    contextManager: (() => {
      const cm = new ConversationContextManager();
      cm.saveContext('talk_oficial_test', 'lead_oficial_test', officialPropsBefore.find(p => p.ID_PROPIEDAD === 'REF-003'));
      return cm;
    })()
  });
  assertTest(
    'PRUEBA D (Aislamiento): REF-003 oficial responde "Tiene 933 m²" sin verse alterada por las pruebas',
    rOficial.shouldRespond === true && rOficial.text === 'Tiene 933 m²',
    `Respuesta propiedad oficial: "${rOficial.text}"`
  );

  // Limpieza de archivos temporales de prueba
  const testHandoffFile = path.join(__dirname, 'test_handoffs_opcion1.json');
  if (fs.existsSync(testHandoffFile)) fs.unlinkSync(testHandoffFile);

  console.log('================================================================');
  console.log(` RESULTADOS SUITE OPCIÓN 1: ${passed} / ${total} PRUEBAS SUPERADAS (${Math.round((passed/total)*100)}%)`);
  console.log('================================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runTestSuiteOpcion1().catch(err => {
  console.error('Error en suite de pruebas opción 1:', err);
  process.exit(1);
});

