/**
 * TEST SUITE: RECONOCIMIENTO UNIVERSAL DE UBICACIONES (FASE 3)
 * Tu Techo Ideal V5.1 - Depro Tech Solutions
 */

const assert = require('assert');
const {
  extractRequestedZone,
  searchZoneOrFeatureMatches,
  evaluateCentralDecisionPipeline
} = require('../pipeline_decision');

// Mock de inventario de prueba con propiedades representativas
const mockInventory = [
  {
    ID_PROPIEDAD: 'REF-012',
    TIPO: 'Apartamento',
    OPERACION: 'Venta',
    ESTATUS: 'Disponible',
    PRECIO: 'USD 146.000',
    DESCRIPCION_BREVE: 'Hermoso apartamento en Los Samanes, 110 m², 3 hab, 2 baños.',
    Wasi: 'https://info.wasi.co/apartamento-venta-los-samanes-caracas/10493109',
    LINK_FOTOS: 'https://rexup.net/fotos/REF012',
    Agente: 'Robert',
    Numero_WhatsApp: '584121234567'
  },
  {
    ID_PROPIEDAD: 'REF-025',
    TIPO: 'Apartamento',
    OPERACION: 'Alquiler',
    ESTATUS: 'Disponible',
    PRECIO: 'USD 600',
    DESCRIPCION_BREVE: 'Excelente apartamento en alquiler en Altamira, 90 m², amoblado.',
    Wasi: 'https://info.wasi.co/apartamento-alquiler-altamira-caracas/10493125',
    LINK_FOTOS: 'https://rexup.net/fotos/REF025',
    Agente: 'Robert',
    Numero_WhatsApp: '584121234567'
  },
  {
    ID_PROPIEDAD: 'REF-035',
    TIPO: 'Casa',
    OPERACION: 'Venta',
    ESTATUS: 'Disponible',
    PRECIO: 'USD 350.000',
    DESCRIPCION_BREVE: 'Imponente casa en Prados del Este, 450 m², jardín y piscina.',
    Wasi: 'https://info.wasi.co/casa-venta-prados-del-este-caracas/10493135',
    LINK_FOTOS: 'https://rexup.net/fotos/REF035',
    Agente: 'Robert',
    Numero_WhatsApp: '584121234567'
  },
  {
    ID_PROPIEDAD: 'REF-040',
    TIPO: 'Apartamento',
    OPERACION: 'Venta',
    ESTATUS: 'No disponible',
    PRECIO: 'USD 120.000',
    DESCRIPCION_BREVE: 'Apartamento en La Boyera, 100 m².',
    Wasi: 'https://info.wasi.co/apartamento-venta-la-boyera-caracas/10493140',
    LINK_FOTOS: 'https://rexup.net/fotos/REF040',
    Agente: 'Robert',
    Numero_WhatsApp: '584121234567'
  }
];

async function runUniversalLocationTests() {
  console.log('==============================================================================');
  console.log('      SUITE AUTOMATIZADA: RECONOCIMIENTO UNIVERSAL DE UBICACIONES (FASE 3)    ');
  console.log('==============================================================================\n');

  let passed = 0;
  let total = 0;

  async function testCase(desc, fn) {
    total++;
    try {
      await fn();
      console.log(`✅ [Test ${total}] ${desc}... PASÓ`);
      passed++;
    } catch (err) {
      console.log(`❌ [Test ${total}] ${desc}... FALLÓ`);
      console.error('   Error:', err.message);
      throw err;
    }
  }

  // 1. Zonas existentes en Google Sheets (Los Samanes, Altamira, Prados del Este)
  await testCase('1.1 Coincidencia de zona existente en Sheets -> Devuelve candidatos de esa zona', () => {
    const res = searchZoneOrFeatureMatches('¿Tienen apartamentos en venta en Los Samanes?', mockInventory);
    assert.strictEqual(res.hasAvailableMatches, true, 'Debe encontrar coincidencia');
    assert.strictEqual(res.candidates.length, 1, 'Debe haber 1 candidato');
    assert.strictEqual(res.candidates[0].ID_PROPIEDAD, 'REF-012', 'Debe ser REF-012');
  });

  await testCase('1.2 Zona existente pero con estatus No Disponible -> hasAvailableMatches es false', () => {
    const res = searchZoneOrFeatureMatches('¿Tienen apartamentos en La Boyera?', mockInventory);
    assert.strictEqual(res.hasAvailableMatches, false, 'No debe haber coincidencias disponibles en La Boyera');
  });

  // 2. Zonas inexistentes en Google Sheets (Valencia, Lechería, Puerto Ordaz, San Diego)
  await testCase('2.1 Zona inexistente (Valencia) -> Extrae ubicación y reporta ausencia sin inventar disponibilidad', async () => {
    const zone = extractRequestedZone('¿Tienen apartamentos en venta en Valencia?', mockInventory);
    assert.strictEqual(zone, 'valencia', 'Debe extraer "valencia" dinámicamente');

    const evalRes = await evaluateCentralDecisionPipeline({
      leadId: 7701,
      talkId: 'talk_valencia_01',
      userText: '¿Tienen apartamentos en venta en Valencia?',
      clientName: 'Alejandro',
      properties: mockInventory
    });

    assert.strictEqual(evalRes.shouldRespond, true, 'Debe responder educadamente');
    assert.strictEqual(evalRes.log.typeDetected, 'ZONE_SEARCH_NO_MATCH', 'Tipo detectado debe ser ZONE_SEARCH_NO_MATCH');
    assert.ok(evalRes.text.includes('no disponemos de inmuebles'), 'Debe comunicar que no se dispone de inmuebles');
    assert.ok(evalRes.text.includes('VALENCIA'), 'Debe mencionar VALENCIA en la respuesta');
    assert.strictEqual(evalRes.text.includes('Sí, disponible'), false, 'NUNCA debe decir sí disponible');
    assert.strictEqual(evalRes.text.includes('Los Samanes'), false, 'NUNCA debe devolver propiedades de Caracas');
  });

  await testCase('2.2 Otra ciudad inexistente (Lechería) -> Extrae ubicación y reporta ausencia', async () => {
    const zone = extractRequestedZone('Hola, ¿hay casas en alquiler en Lechería?', mockInventory);
    assert.strictEqual(zone, 'lecheria', 'Debe extraer "lecheria" dinámicamente');

    const evalRes = await evaluateCentralDecisionPipeline({
      leadId: 7702,
      talkId: 'talk_lecheria_01',
      userText: 'Hola, ¿hay casas en alquiler en Lechería?',
      clientName: 'Beatriz',
      properties: mockInventory
    });

    assert.strictEqual(evalRes.shouldRespond, true);
    assert.strictEqual(evalRes.log.typeDetected, 'ZONE_SEARCH_NO_MATCH');
    assert.ok(evalRes.text.includes('no disponemos de inmuebles'));
    assert.ok(evalRes.text.includes('LECHERIA'));
    assert.strictEqual(evalRes.text.includes('Sí, disponible'), false);
  });

  // 3. Urbanizaciones nuevas y sectores con nombres compuestos
  await testCase('3.1 Sector con nombre compuesto (San Diego Carabobo) -> Extrae correctamente', async () => {
    const zone = extractRequestedZone('Busco apartamento en San Diego Carabobo', mockInventory);
    assert.strictEqual(zone, 'san diego carabobo', 'Debe extraer el nombre compuesto');

    const evalRes = await evaluateCentralDecisionPipeline({
      leadId: 7703,
      talkId: 'talk_sandiego_01',
      userText: 'Busco apartamento en San Diego Carabobo',
      clientName: 'Carlos',
      properties: mockInventory
    });

    assert.strictEqual(evalRes.shouldRespond, true);
    assert.strictEqual(evalRes.log.typeDetected, 'ZONE_SEARCH_NO_MATCH');
    assert.ok(evalRes.text.includes('SAN DIEGO CARABOBO'));
    assert.strictEqual(evalRes.text.includes('Sí, disponible'), false);
  });

  await testCase('3.2 Urbanización no registrada (La Trigaleña) -> Extracción y respuesta de ausencia', async () => {
    const zone = extractRequestedZone('¿Tienen apartamentos en La Trigaleña?', mockInventory);
    assert.strictEqual(zone, 'trigalena', 'Debe extraer "trigalena"');

    const evalRes = await evaluateCentralDecisionPipeline({
      leadId: 7704,
      talkId: 'talk_trigalena_01',
      userText: '¿Tienen apartamentos en La Trigaleña?',
      clientName: 'Daniel',
      properties: mockInventory
    });

    assert.strictEqual(evalRes.shouldRespond, true);
    assert.strictEqual(evalRes.log.typeDetected, 'ZONE_SEARCH_NO_MATCH');
    assert.ok(evalRes.text.includes('TRIGALENA'));
  });

  // 4. Ubicaciones con acentos y variantes ortográficas
  await testCase('4.1 Ubicación con acento en texto (El Viñedo) -> Extracción normalizada', () => {
    const zone1 = extractRequestedZone('¿Hay disponibilidad en El Viñedo?', mockInventory);
    const zone2 = extractRequestedZone('¿Hay disponibilidad en El Vinedo?', mockInventory);
    assert.strictEqual(zone1, 'vinedo', 'Debe normalizar acento');
    assert.strictEqual(zone2, 'vinedo', 'Debe ser idéntico sin acento');
  });

  await testCase('4.2 Ciudad con acento (Mérida vs Merida) -> Extracción consistente', () => {
    const zone1 = extractRequestedZone('Busco apartamento en venta en Mérida', mockInventory);
    const zone2 = extractRequestedZone('Busco apartamento en venta en Merida', mockInventory);
    assert.strictEqual(zone1, 'merida');
    assert.strictEqual(zone2, 'merida');
  });

  // 5. Consultas donde el cliente NO menciona ubicación
  await testCase('5.1 Consulta general sin ubicación ("Busco apartamento en venta") -> Encuentra coincidencias válidas', () => {
    const zone = extractRequestedZone('Busco apartamento en venta', mockInventory);
    assert.strictEqual(zone, null, 'No debe inventar zona');

    const res = searchZoneOrFeatureMatches('Busco apartamento en venta', mockInventory);
    assert.strictEqual(res.hasAvailableMatches, true, 'Debe encontrar apartamentos en venta en Caracas');
    assert.strictEqual(res.candidates[0].ID_PROPIEDAD, 'REF-012');
  });

  await testCase('5.2 Consulta de tipo y operación sin ubicación ("Hola, qué apartamentos tienen en alquiler?") -> Devuelve listado de alquiler', () => {
    const zone = extractRequestedZone('Hola buenas tardes, ¿qué apartamentos tienen en alquiler?', mockInventory);
    assert.strictEqual(zone, null, 'No debe inventar zona');

    const res = searchZoneOrFeatureMatches('Hola buenas tardes, ¿qué apartamentos tienen en alquiler?', mockInventory);
    assert.strictEqual(res.hasAvailableMatches, true);
    assert.strictEqual(res.candidates[0].ID_PROPIEDAD, 'REF-025', 'Debe ser REF-025 (Alquiler)');
  });

  // 6. Consultas con Zona + Tipo de inmueble
  await testCase('6.1 Zona coincidente + Tipo no coincidente (Casa en Los Samanes) -> Guarda SILENCIO seguro', async () => {
    const evalRes = await evaluateCentralDecisionPipeline({
      leadId: 7705,
      talkId: 'talk_lossamanes_casa',
      userText: '¿Tienen casas en venta en Los Samanes?',
      clientName: 'Eduardo',
      properties: mockInventory
    });

    assert.strictEqual(evalRes.shouldRespond, false, 'Debe guardar silencio seguro');
    assert.strictEqual(evalRes.log.typeDetected, 'ZONE_OR_FEATURE_MISMATCH');
    assert.strictEqual(evalRes.log.action, 'SILENCE');
  });

  await testCase('6.2 Zona coincidente + Tipo coincidente (Apartamento en Los Samanes) -> Responde disponibilidad', async () => {
    const evalRes = await evaluateCentralDecisionPipeline({
      leadId: 7706,
      talkId: 'talk_lossamanes_apto',
      userText: '¿Tienen apartamento en venta en Los Samanes?',
      clientName: 'Fabiana',
      properties: mockInventory
    });

    assert.strictEqual(evalRes.shouldRespond, true);
    assert.strictEqual(evalRes.log.action, 'RESPOND');
    assert.ok(evalRes.text.includes('disponible'));
  });

  // 7. Regla de Oro: Prohibido interpretar ubicación desconocida como búsqueda general de Caracas
  await testCase('7.1 Búsqueda en Barquisimeto no debe retornar opciones de Caracas', async () => {
    const evalRes = await evaluateCentralDecisionPipeline({
      leadId: 7707,
      talkId: 'talk_barquisimeto_01',
      userText: 'Buenas tardes, quisiera saber si tienen apartamentos en Barquisimeto',
      clientName: 'Gustavo',
      properties: mockInventory
    });

    assert.strictEqual(evalRes.shouldRespond, true);
    assert.strictEqual(evalRes.log.typeDetected, 'ZONE_SEARCH_NO_MATCH');
    assert.ok(evalRes.text.includes('BARQUISIMETO'));
    // Verificar que NUNCA incluye propiedades de Los Samanes o Altamira
    assert.strictEqual(evalRes.text.includes('REF-012'), false);
    assert.strictEqual(evalRes.text.includes('REF-025'), false);
    assert.strictEqual(evalRes.text.includes('Los Samanes'), false);
    assert.strictEqual(evalRes.text.includes('Altamira'), false);
  });

  await testCase('7.2 Búsqueda en Maracaibo no debe retornar opciones de Caracas', async () => {
    const evalRes = await evaluateCentralDecisionPipeline({
      leadId: 7708,
      talkId: 'talk_maracaibo_01',
      userText: 'Hola, ¿tienen casas en Maracaibo?',
      clientName: 'Hector',
      properties: mockInventory
    });

    assert.strictEqual(evalRes.shouldRespond, true);
    assert.strictEqual(evalRes.log.typeDetected, 'ZONE_SEARCH_NO_MATCH');
    assert.ok(evalRes.text.includes('MARACAIBO'));
    assert.strictEqual(evalRes.text.includes('REF-035'), false);
    assert.strictEqual(evalRes.text.includes('Prados del Este'), false);
  });

  console.log('\n==============================================================================');
  console.log(`RESUMEN FASE 3: ${passed} / ${total} PRUEBAS SUPERADAS (${Math.round(passed/total*100)}%)`);
  console.log('==============================================================================\n');
}

runUniversalLocationTests().catch(err => {
  console.error('Fatal Suite Error:', err);
  process.exit(1);
});
