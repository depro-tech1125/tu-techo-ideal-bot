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
      leadId: 'test_candelaria_wasi_1',
      name: 'La Candelaria - Enlace Wasi directo',
      msg: 'https://info.wasi.co/apartamento-venta-la-candelaria-caracas/10539723',
      expected: '55',
      expectSilence: false
    },
    {
      leadId: 'test_candelaria_wasi_1',
      name: 'La Candelaria - Consulta de información general',
      msg: 'Buenas tardes, busco apartamento en La Candelaria',
      expected: '500',
      expectSilence: false
    },
    {
      leadId: 'test_candelaria_wasi_1',
      name: 'La Candelaria - Pregunta sobre gas (Negativa oficial con cocina eléctrica)',
      msg: '¿Tiene gas directo el apartamento de La Candelaria?',
      expected: 'cocina',
      expectSilence: false
    },
    {
      leadId: 'test_candelaria_wasi_1',
      name: 'La Candelaria - Pregunta estacionamiento (Alquiler privado a media cuadra)',
      msg: '¿Tiene estacionamiento propio?',
      expected: 'estacionamiento',
      expectSilence: false
    },
    {
      leadId: 'test_candelaria_wasi_1',
      name: 'La Candelaria - Mascotas y niños (Restricción oficial)',
      msg: '¿Aceptan mascotas o niños?',
      expected: 'no',
      expectSilence: false
    },
    {
      leadId: 'test_candelaria_wasi_1',
      name: 'La Candelaria - Pregunta trampa Piscina',
      msg: '¿El edificio tiene piscina o gimnasio?',
      expected: null,
      expectSilence: true
    },
    {
      leadId: 'test_lomas_1',
      name: 'Lomas del Sol - Enlace Wasi directo',
      msg: 'https://info.wasi.co/apartamento-venta-lomas-del-sol-caracas/10544010',
      expected: '170',
      expectSilence: false
    },
    {
      leadId: 'test_lomas_1',
      name: 'Lomas del Sol - Metraje puntual',
      msg: '¿Cuánto mide?',
      expected: '83',
      expectSilence: false
    },
    {
      leadId: 'test_lomas_1',
      name: 'Lomas del Sol - Pregunta trampa Gas (No especificado)',
      msg: '¿Tiene gas directo?',
      expected: null,
      expectSilence: true
    },
    {
      leadId: 'test_lomas_1',
      name: 'Lomas del Sol - Pregunta trampa Pozo (No especificado)',
      msg: '¿Tiene pozo de agua?',
      expected: null,
      expectSilence: true
    },
    {
      leadId: 'test_lomas_1',
      name: 'Lomas del Sol - Agendar cita',
      msg: 'Quiero agendar una cita para ir a verlo mañana',
      expected: 'Ok, ya consulto con mi jefe para agendar la cita',
      expectSilence: false
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
        console.log(`✅ RESULTADO: Respondió factual esperado -> "${res.text.substring(0, 100)}..."\n`);
        passed++;
      } else {
        console.error(`❌ FALLÓ: Respuesta no coincide. Obtenido: "${res ? res.text : null}", Esperado contenido: "${tc.expected}"\n`);
      }
    }
  }

  console.log(`========================================`);
  console.log(`RESULTADOS TOTALES: ${passed} / ${testCases.length} pasadas con éxito (${Math.round((passed / testCases.length) * 100)}%)`);
  console.log(`========================================`);
  if (passed !== testCases.length) process.exit(1);
}

runEndToEndTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
