/**
 * End-to-End Integration Verification: server.js + fichas_manager.js + Claude Sonnet 4.5
 */
const { generateResponse, getAvailableProperties } = require('./server.js');

async function runEndToEndTests() {
  console.log('=== CARGANDO PROPIEDADES ===');
  const properties = await getAvailableProperties(true);
  console.log(`Propiedades cargadas: ${properties.length}`);

  console.log('\n=== INICIANDO PRUEBAS DE INTEGRACIÓN SERVER.JS ===\n');

  const testCases = [
    {
      leadId: 'test_lead_lomas_1',
      name: 'Lomas del Sol - Disponibilidad',
      msg: 'Hola buenas tardes, el apartamento de Lomas del Sol está disponible?',
      expected: 'Si, disponible',
      expectSilence: false
    },
    {
      leadId: 'test_lead_lomas_1',
      name: 'Lomas del Sol - Metraje (Contexto activo)',
      msg: '¿Cuánto mide?',
      expected: '83',
      expectSilence: false
    },
    {
      leadId: 'test_lead_lomas_1',
      name: 'Lomas del Sol - Pregunta trampa Gas (Dato no especificado)',
      msg: '¿Tiene gas directo?',
      expected: null,
      expectSilence: true
    },
    {
      leadId: 'test_lead_lomas_1',
      name: 'Lomas del Sol - Pregunta trampa Pozo (Dato no especificado)',
      msg: '¿Tiene pozo de agua?',
      expected: null,
      expectSilence: true
    },
    {
      leadId: 'test_lead_lomas_1',
      name: 'Lomas del Sol - Agendar cita',
      msg: 'Quiero agendar una cita para ir a verlo mañana',
      expected: 'Ok, ya consulto con mi jefe para agendar la cita',
      expectSilence: false
    },
    {
      leadId: 'test_lead_candelaria_1',
      name: 'La Candelaria - Disponibilidad',
      msg: 'Hola buenas tardes, el apartamento en La Candelaria está libre?',
      expected: 'Si, disponible',
      expectSilence: false
    },
    {
      leadId: 'test_lead_candelaria_1',
      name: 'La Candelaria - Mascotas y niños (Restricción explícita)',
      msg: '¿Se aceptan mascotas o niños?',
      expected: 'no',
      expectSilence: false
    },
    {
      leadId: 'test_lead_candelaria_1',
      name: 'La Candelaria - Internet (Proveedor WOW)',
      msg: '¿Qué internet tiene?',
      expected: 'WOW',
      expectSilence: false
    },
    {
      leadId: 'test_lead_candelaria_1',
      name: 'La Candelaria - Pregunta trampa Piscina',
      msg: '¿El edificio tiene piscina o cancha de tenis?',
      expected: null,
      expectSilence: true
    },
    {
      leadId: 'test_lead_candelaria_1',
      name: 'La Candelaria - Pregunta trampa Color paredes',
      msg: '¿De qué color están pintadas las paredes del baño?',
      expected: null,
      expectSilence: true
    }
  ];

  let passed = 0;
  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    console.log(`[Test ${i + 1}/${testCases.length}] [${tc.name}]`);
    console.log(`Mensaje: "${tc.msg}"`);

    const res = await generateResponse(tc.msg, properties, null, tc.leadId, 'Jefe Test');

    if (tc.expectSilence) {
      if (!res || res.skip || !res.text) {
        console.log(`✅ RESULTADO: SILENCIO ABSOLUTO CONFIRMADO (100% callada, skip: true)\n`);
        passed++;
      } else {
        console.error(`❌ FALLÓ: Se esperaba silencio pero respondió: "${res.text}"\n`);
      }
    } else {
      if (res && res.text && res.text.toLowerCase().includes(tc.expected.toLowerCase())) {
        console.log(`✅ RESULTADO: Respondió factual esperado -> "${res.text}"\n`);
        passed++;
      } else {
        console.error(`❌ FALLÓ: Respuesta no coincide. Obtenido: "${res ? res.text : null}", Esperado contenido: "${tc.expected}"\n`);
      }
    }
  }

  console.log(`========================================`);
  console.log(`RESULTADOS TOTALES: ${passed} / ${testCases.length} pasadas con éxito (${Math.round((passed / testCases.length) * 100)}%)`);
  console.log(`========================================`);
}

runEndToEndTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

