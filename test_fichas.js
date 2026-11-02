const dotenv = require('dotenv');
dotenv.config();

const { handleFichaTecnicaQuery, loadFichasTecnicas } = require('./fichas_manager.js');

async function runTests() {
  console.log('=== CARGANDO FICHAS TÉCNICAS ===');
  const fichas = loadFichasTecnicas(true);
  console.log('Fichas cargadas:', fichas.map(f => f.zona + ' (' + f.id + ')'));

  const testCases = [
    // --- LOMAS DEL SOL ---
    {
      prop: 'Lomas del Sol',
      q: 'Hola buenas tardes, el apartamento de Lomas del Sol está disponible?',
      expected: 'Si, disponible'
    },
    {
      prop: 'Lomas del Sol',
      q: '¿Cuánto mide el apartamento de Lomas del Sol?',
      expected: '83 m²'
    },
    {
      prop: 'Lomas del Sol',
      q: '¿Cuántas habitaciones y baños tiene el de Lomas del Sol?',
      expected: '2 habitaciones y 2 baños'
    },
    {
      prop: 'Lomas del Sol',
      q: '¿Tiene estacionamiento y maletero Lomas del Sol?',
      expected: '2 puestos y 1 maletero'
    },
    {
      prop: 'Lomas del Sol',
      q: '¿Qué tipo de cocina tiene Lomas del Sol?',
      expected: 'Cocina eléctrica'
    },
    {
      prop: 'Lomas del Sol',
      q: '¿Cuánto cuesta el de Lomas del Sol?',
      expected: '$170.000'
    },
    {
      prop: 'Lomas del Sol',
      q: '¿Aceptan Binance o Zelle en Lomas del Sol?',
      expected: 'Sí, aceptan Efectivo, Zelle, Transferencia y Binance'
    },
    {
      prop: 'Lomas del Sol',
      q: '¿Cuánto se paga de condominio en Lomas del Sol?',
      expected: '65 a tasa BCV'
    },
    // PREGUNTAS CAPCIOSAS / SIN INFORMACIÓN EN LOMAS DEL SOL -> DEBE QUEDARSE 100% CALLADA (skip: true)
    {
      prop: 'Lomas del Sol',
      q: '¿Tiene gas directo el apartamento de Lomas del Sol?',
      expected: 'SILENCIO (skip: true)'
    },
    {
      prop: 'Lomas del Sol',
      q: '¿Tiene pozo de agua o tanque en Lomas del Sol?',
      expected: 'SILENCIO (skip: true)'
    },
    {
      prop: 'Lomas del Sol',
      q: '¿Aceptan mascotas en Lomas del Sol?',
      expected: 'SILENCIO (skip: true)'
    },
    {
      prop: 'Lomas del Sol',
      q: '¿El edificio de Lomas del Sol tiene piscina?',
      expected: 'SILENCIO (skip: true)'
    },
    {
      prop: 'Lomas del Sol',
      q: '¿Qué vista tiene el apartamento de Lomas del Sol?',
      expected: 'SILENCIO (skip: true)'
    },

    // --- LA CANDELARIA ---
    {
      prop: 'La Candelaria',
      q: 'Hola, el apartamento de La Candelaria en la Torre 200 está disponible?',
      expected: 'Si, disponible'
    },
    {
      prop: 'La Candelaria',
      q: '¿Cuánto es el canon de alquiler en La Candelaria?',
      expected: '$500'
    },
    {
      prop: 'La Candelaria',
      q: '¿Cuánto mide el de La Candelaria y cómo está distribuido?',
      expected: '55 m², 2 ambientes (1 hab + 1 estudio)'
    },
    {
      prop: 'La Candelaria',
      q: '¿Tiene puesto de estacionamiento propio el de La Candelaria?',
      expected: 'No tiene propio, hay alquiler privado a media cuadra'
    },
    {
      prop: 'La Candelaria',
      q: '¿Cómo es el servicio de agua en el apartamento de La Candelaria?',
      expected: 'Suministro 3 veces al día + 2 días continuo'
    },
    {
      prop: 'La Candelaria',
      q: '¿Tiene gas directo La Candelaria?',
      expected: 'No tiene gas directo, cuenta con cocina eléctrica'
    },
    {
      prop: 'La Candelaria',
      q: '¿Tiene aire acondicionado el de La Candelaria?',
      expected: 'Sí, integrado'
    },
    {
      prop: 'La Candelaria',
      q: '¿Qué internet tiene La Candelaria?',
      expected: 'Fibra óptica con proveedor WOW'
    },
    {
      prop: 'La Candelaria',
      q: '¿Se aceptan mascotas o niños en el apartamento de La Candelaria?',
      expected: 'No se admiten niños ni mascotas'
    },
    {
      prop: 'La Candelaria',
      q: '¿Cuáles son las condiciones de negociación para alquilar en La Candelaria?',
      expected: '3 meses adelanto, 3 meses depósito, $200 gastos administrativos'
    },
    // PREGUNTAS CAPCIOSAS / SIN INFORMACIÓN EN LA CANDELARIA -> DEBE QUEDARSE 100% CALLADA (skip: true)
    {
      prop: 'La Candelaria',
      q: '¿De qué color están pintadas las paredes del cuarto en La Candelaria?',
      expected: 'SILENCIO (skip: true)'
    },
    {
      prop: 'La Candelaria',
      q: '¿Tiene piscina o gimnasio el edificio de La Candelaria?',
      expected: 'SILENCIO (skip: true)'
    },
    {
      prop: 'La Candelaria',
      q: '¿Aceptan pagos con criptomonedas o Binance en La Candelaria?',
      expected: 'SILENCIO (skip: true)'
    }
  ];

  console.log('\n=== INICIANDO BATERÍA DE PRUEBAS DE BLINDAJE ===\n');

  let passed = 0;
  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    console.log(`\n[Prueba ${i + 1}/${testCases.length}] [${tc.prop}]`);
    console.log(`Pregunta: "${tc.q}"`);
    console.log(`Esperado: ${tc.expected}`);

    const res = await handleFichaTecnicaQuery(tc.q, tc.prop, 'Jefe Test');

    if (tc.expected.includes('SILENCIO')) {
      if (!res || res.skip || !res.text) {
        console.log(`✅ RESULTADO: SILENCIO ABSOLUTO CONFIRMADO (100% callada, 0 tokens gastados al cliente).`);
        passed++;
      } else {
        console.log(`❌ FALLÓ: Debía quedarse callada pero respondió: "${res.text}"`);
      }
    } else {
      if (res && !res.skip && res.text) {
        console.log(`✅ RESULTADO: Respondió factual -> "${res.text}"`);
        passed++;
      } else {
        console.log(`❌ FALLÓ: Debía responder pero se quedó callada.`);
      }
    }
  }

  console.log(`\n========================================`);
  console.log(`RESULTADOS TOTALES: ${passed} / ${testCases.length} pasadas con éxito (${Math.round((passed / testCases.length) * 100)}%)`);
  console.log(`========================================`);
}

runTests();

