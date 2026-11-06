/**
 * SUITE DE ACEPTACIÓN UNIVERSAL — FASE 8 (10 ESCENARIOS MAESTROS)
 * Tu Techo Ideal V5.1 — Depro Tech Solutions
 *
 * Demuestra que el sistema opera con reglas universales y agnósticas de datos:
 * 1. Propiedad nueva incorporada al inventario.
 * 2. Portal nunca antes utilizado.
 * 3. Columna agregada tras iniciar el servicio.
 * 4. Columna eliminada tras iniciar el servicio.
 * 5. Zona desconocida fuera del catálogo.
 * 6. Propiedad con operación contradictoria (URL dice alquiler, Sheets dice venta).
 * 7. Propiedad con estatus Reservado.
 * 8. Enlace con identificador duplicado / ambiguo.
 * 9. Cliente que consulta múltiples inmuebles en orden cronológico.
 * 10. Cliente nuevo sin historial previo.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const {
  evaluateCentralDecisionPipeline,
  ConversationContextManager,
  searchZoneOrFeatureMatches,
  extractRequestedZone
} = require('../pipeline_decision');

const {
  processUniversalRows,
  UniversalSheetCacheManager
} = require('../lib/universal_sheet_reader');

async function runUniversalAcceptanceTests() {
  console.log('==============================================================================');
  console.log('      SUITE DE ACEPTACIÓN UNIVERSAL — FASE 8 (10 ESCENARIOS MAESTROS)         ');
  console.log('==============================================================================\n');

  let passed = 0;
  let total = 0;

  async function testCase(desc, fn) {
    total++;
    try {
      await fn();
      console.log(`✅ [Escenario ${total}/10] ${desc}... APROBADO`);
      passed++;
    } catch (err) {
      console.log(`❌ [Escenario ${total}/10] ${desc}... FALLÓ`);
      console.error('   Detalle del error:', err.message);
      throw err;
    }
  }

  // --------------------------------------------------------------------------
  // ESCENARIO 1: Propiedad nueva incorporada al inventario
  // --------------------------------------------------------------------------
  await testCase('Propiedad nueva incorporada (REF-105 en Colinas de Bello Monte)', async () => {
    const customInventory = [
      {
        ID_PROPIEDAD: 'REF-105',
        TIPO: 'Apartamento',
        OPERACION: 'Venta',
        ESTATUS: 'Disponible',
        PRECIO: 'USD 89.000',
        DESCRIPCION_BREVE: 'Excelente apartamento en Colinas de Bello Monte, 85 m², 2 habitaciones.',
        Wasi: 'https://info.wasi.co/apartamento-venta-colinas-de-bello-monte-caracas/10998877',
        LINK_FOTOS: 'https://rexup.net/fotos/REF105',
        Agente: 'Robert Ramos',
        Numero_WhatsApp: '584121234567'
      }
    ];

    const evalRes = await evaluateCentralDecisionPipeline({
      leadId: 8801,
      talkId: 'talk_new_prop_01',
      userText: 'Hola, me interesa este apartamento https://info.wasi.co/apartamento-venta-colinas-de-bello-monte-caracas/10998877',
      clientName: 'Mariana',
      properties: customInventory
    });

    assert.strictEqual(evalRes.shouldRespond, true);
    assert.strictEqual(evalRes.log.propertyIdentified, 'REF-105');
    assert.ok(evalRes.text.includes('Colinas de Bello Monte'));
    assert.ok(evalRes.text.includes('85 m²'));
    assert.ok(evalRes.text.includes('USD 89.000'));
  });

  // --------------------------------------------------------------------------
  // ESCENARIO 2: Portal nunca antes utilizado
  // --------------------------------------------------------------------------
  await testCase('Portal nunca antes utilizado ("TuPortalExpress")', async () => {
    const headers = [
      'ID_PROPIEDAD', 'TIPO', 'OPERACION', 'DESCRIPCION_BREVE', 'ESTATUS',
      'TuPortalExpress', 'LINK_FOTOS'
    ];
    const rows = [
      [
        'REF-201', 'Apartamento', 'Venta', 'Penthouse en La Castellana, 220 m². Precio: $320.000', 'Disponible',
        'https://tuportalexpress.com/inmuebles/prop-201-la-castellana', 'https://rexup.net/fotos/REF201'
      ]
    ];

    const processed = processUniversalRows(headers, rows);
    assert.strictEqual(processed.validCount, 1);
    const prop = processed.properties[0];
    assert.strictEqual(prop.externalLinks['TuPortalExpress'], 'https://tuportalexpress.com/inmuebles/prop-201-la-castellana');

    const evalRes = await evaluateCentralDecisionPipeline({
      leadId: 8802,
      talkId: 'talk_new_portal_01',
      userText: 'Hola, vi esto en TuPortalExpress: https://tuportalexpress.com/inmuebles/prop-201-la-castellana',
      clientName: 'Rodrigo',
      properties: processed.properties
    });

    assert.strictEqual(evalRes.shouldRespond, true);
    assert.strictEqual(evalRes.log.propertyIdentified, 'REF-201');
    assert.ok(evalRes.text.includes('La Castellana'));
    assert.ok(evalRes.text.includes('320.000'));
  });

  // --------------------------------------------------------------------------
  // ESCENARIO 3: Columna agregada tras iniciar el servicio sin reinicio
  // --------------------------------------------------------------------------
  await testCase('Columna agregada tras iniciar el servicio (actualización de caché en caliente)', async () => {
    const cacheManager = new UniversalSheetCacheManager({ ttlMs: 60000 });
    let currentData = [
      {
        ID_PROPIEDAD: 'REF-301',
        TIPO: 'Apartamento',
        OPERACION: 'Alquiler',
        ESTATUS: 'Disponible',
        DESCRIPCION_BREVE: 'Apartamento en Chacao',
        Wasi: 'https://info.wasi.co/prop/301'
      }
    ];

    // Primer fetch
    const read1 = await cacheManager.getProperties(async () => currentData);
    assert.strictEqual(read1.fromCache, false);
    assert.strictEqual(read1.properties[0].externalLinks['NuevoPortalPro'], undefined);

    // Se agrega columna en vivo
    currentData = [
      {
        ID_PROPIEDAD: 'REF-301',
        TIPO: 'Apartamento',
        OPERACION: 'Alquiler',
        ESTATUS: 'Disponible',
        DESCRIPCION_BREVE: 'Apartamento en Chacao',
        Wasi: 'https://info.wasi.co/prop/301',
        'NuevoPortalPro': 'https://nuevoportalpro.com/alquiler/301'
      }
    ];

    // Siguiente sincronización detecta cambio de esquema
    const read2 = await cacheManager.getProperties(async () => currentData, true);
    assert.strictEqual(read2.schemaChange.hasChanged, true);
    assert.deepStrictEqual(read2.schemaChange.addedColumns, ['NuevoPortalPro']);
    assert.strictEqual(read2.properties[0].externalLinks['NuevoPortalPro'], 'https://nuevoportalpro.com/alquiler/301');
  });

  // --------------------------------------------------------------------------
  // ESCENARIO 4: Columna eliminada tras iniciar el servicio
  // --------------------------------------------------------------------------
  await testCase('Columna eliminada tras iniciar el servicio (remoción de enlaces obsoletos)', async () => {
    const cacheManager = new UniversalSheetCacheManager({ ttlMs: 60000 });
    let currentData = [
      {
        ID_PROPIEDAD: 'REF-401',
        TIPO: 'Casa',
        OPERACION: 'Venta',
        ESTATUS: 'Disponible',
        DESCRIPCION_BREVE: 'Casa en El Hatillo',
        Wasi: 'https://info.wasi.co/prop/401',
        'PortalObsoleto': 'https://portalobsoleto.com/prop/401'
      }
    ];

    await cacheManager.getProperties(async () => currentData);

    // Robert elimina la columna PortalObsoleto
    currentData = [
      {
        ID_PROPIEDAD: 'REF-401',
        TIPO: 'Casa',
        OPERACION: 'Venta',
        ESTATUS: 'Disponible',
        DESCRIPCION_BREVE: 'Casa en El Hatillo',
        Wasi: 'https://info.wasi.co/prop/401'
      }
    ];

    const readAfterDelete = await cacheManager.getProperties(async () => currentData, true);
    assert.strictEqual(readAfterDelete.schemaChange.hasChanged, true);
    assert.deepStrictEqual(readAfterDelete.schemaChange.removedColumns, ['PortalObsoleto']);
    assert.strictEqual(readAfterDelete.properties[0].externalLinks['PortalObsoleto'], undefined);
  });

  // --------------------------------------------------------------------------
  // ESCENARIO 5: Zona desconocida fuera del catálogo
  // --------------------------------------------------------------------------
  await testCase('Zona desconocida (Puerto La Cruz) -> Reporta no disponibilidad sin confundir con Caracas', async () => {
    const properties = [
      {
        ID_PROPIEDAD: 'REF-012',
        TIPO: 'Apartamento',
        OPERACION: 'Venta',
        ESTATUS: 'Disponible',
        PRECIO: 'USD 146.000',
        DESCRIPCION_BREVE: 'Apartamento en Los Samanes Caracas',
        Wasi: 'https://info.wasi.co/apartamento-venta-los-samanes-caracas/10493109'
      }
    ];

    const evalRes = await evaluateCentralDecisionPipeline({
      leadId: 8805,
      talkId: 'talk_plc_01',
      userText: 'Hola, ¿tienen apartamentos en Puerto La Cruz?',
      clientName: 'Sofia',
      properties
    });

    assert.strictEqual(evalRes.shouldRespond, true);
    assert.strictEqual(evalRes.log.typeDetected, 'ZONE_SEARCH_NO_MATCH');
    assert.ok(evalRes.text.includes('PUERTO LA CRUZ'));
    assert.strictEqual(evalRes.text.includes('Los Samanes'), false);
    assert.strictEqual(evalRes.text.includes('REF-012'), false);
    assert.strictEqual(evalRes.text.includes('Sí, disponible'), false);
  });

  // --------------------------------------------------------------------------
  // ESCENARIO 6: Propiedad con operación contradictoria (URL dice alquiler, Sheets dice venta)
  // --------------------------------------------------------------------------
  await testCase('Contradicción de operación: URL dice alquiler pero Google Sheets dice Venta', async () => {
    const properties = [
      {
        ID_PROPIEDAD: 'REF-601',
        TIPO: 'Apartamento',
        OPERACION: 'Venta',
        ESTATUS: 'Disponible',
        PRECIO: 'USD 95.000',
        DESCRIPCION_BREVE: 'Apartamento en venta en Santa Mónica, 90 m²',
        Wasi: 'https://info.wasi.co/apartamento-venta-santa-monica-caracas/10555666'
      }
    ];

    // Enlace externo mal etiquetado con slug "alquiler" pero mismo código numérico
    const contradictoryUrl = 'https://portal-externo.com/apartamento-alquiler-santa-monica/10555666';

    const evalRes = await evaluateCentralDecisionPipeline({
      leadId: 8806,
      talkId: 'talk_contradiction_01',
      userText: `Hola, me interesa este inmueble ${contradictoryUrl}`,
      clientName: 'Tomas',
      properties
    });

    assert.strictEqual(evalRes.shouldRespond, true);
    assert.strictEqual(evalRes.log.propertyIdentified, 'REF-601');
    // Prevalece Google Sheets: debe responder que está disponible para VENTA
    assert.ok(evalRes.text.includes('disponible para venta'));
    assert.strictEqual(evalRes.text.includes('alquiler'), false);
  });

  // --------------------------------------------------------------------------
  // ESCENARIO 7: Propiedad con estatus Reservado
  // --------------------------------------------------------------------------
  await testCase('Propiedad con estatus Reservado -> Comunica no disponibilidad real y no confirma disponibilidad', async () => {
    const properties = [
      {
        ID_PROPIEDAD: 'REF-701',
        TIPO: 'Apartamento',
        OPERACION: 'Venta',
        ESTATUS: 'Reservado',
        PRECIO: 'USD 115.000',
        DESCRIPCION_BREVE: 'Apartamento en Las Mercedes',
        Wasi: 'https://info.wasi.co/apartamento-venta-las-mercedes-caracas/10777001'
      }
    ];

    const evalRes = await evaluateCentralDecisionPipeline({
      leadId: 8807,
      talkId: 'talk_reserved_01',
      userText: 'Hola, ¿sigue disponible este apartamento? https://info.wasi.co/apartamento-venta-las-mercedes-caracas/10777001',
      clientName: 'Valeria',
      properties
    });

    assert.strictEqual(evalRes.shouldRespond, true);
    assert.strictEqual(evalRes.log.typeDetected, 'PROPERTY_LINK_NOT_AVAILABLE');
    assert.ok(evalRes.text.includes('no se encuentra disponible'));
    assert.strictEqual(evalRes.text.includes('disponible para venta'), false);
    assert.strictEqual(evalRes.text.includes('Sí, disponible'), false);
  });

  // --------------------------------------------------------------------------
  // ESCENARIO 8: Enlace con identificador duplicado / ambiguo
  // --------------------------------------------------------------------------
  await testCase('Identificador duplicado o ambiguo entre dos propiedades -> Silencio seguro', async () => {
    const properties = [
      {
        ID_PROPIEDAD: 'REF-801A',
        TIPO: 'Apartamento',
        OPERACION: 'Venta',
        ESTATUS: 'Disponible',
        DESCRIPCION_BREVE: 'Apartamento A',
        Wasi: 'https://info.wasi.co/apartamento-venta-caracas/10888999'
      },
      {
        ID_PROPIEDAD: 'REF-801B',
        TIPO: 'Apartamento',
        OPERACION: 'Venta',
        ESTATUS: 'Disponible',
        DESCRIPCION_BREVE: 'Apartamento B',
        Wasi: 'https://info.wasi.co/apartamento-venta-caracas/10888999'
      }
    ];

    const evalRes = await evaluateCentralDecisionPipeline({
      leadId: 8808,
      talkId: 'talk_duplicate_id_01',
      userText: 'Hola, información de este inmueble https://info.wasi.co/apartamento-venta-caracas/10888999',
      clientName: 'Walter',
      properties
    });

    // Ante colisión no unívoca, el pipeline debe guardar silencio seguro para no alucinar
    assert.strictEqual(evalRes.shouldRespond, false);
    assert.strictEqual(evalRes.log.action, 'SILENCE');
  });

  // --------------------------------------------------------------------------
  // ESCENARIO 9: Cliente que consulta múltiples inmuebles en orden cronológico
  // --------------------------------------------------------------------------
  await testCase('Múltiples consultas de inmuebles: Resuelve correctamente "el anterior"', async () => {
    const properties = [
      {
        ID_PROPIEDAD: 'REF-901',
        TIPO: 'Apartamento',
        OPERACION: 'Venta',
        ESTATUS: 'Disponible',
        PRECIO: 'USD 80.000',
        DESCRIPCION_BREVE: 'Apartamento en La Florida, 75 m²',
        Wasi: 'https://info.wasi.co/apartamento-venta-la-florida/10901'
      },
      {
        ID_PROPIEDAD: 'REF-902',
        TIPO: 'Apartamento',
        OPERACION: 'Venta',
        ESTATUS: 'Disponible',
        PRECIO: 'USD 190.000',
        DESCRIPCION_BREVE: 'Apartamento en Los Palos Grandes, 140 m²',
        Wasi: 'https://info.wasi.co/apartamento-venta-los-palos-grandes/10902'
      }
    ];

    const contextManager = new ConversationContextManager();

    // Turno 1: Envía primera propiedad
    await evaluateCentralDecisionPipeline({
      leadId: 8809,
      talkId: 'talk_multi_99',
      userText: 'Me interesa este https://info.wasi.co/apartamento-venta-la-florida/10901',
      clientName: 'Yolanda',
      properties,
      contextManager
    });

    // Turno 2: Envía segunda propiedad
    await evaluateCentralDecisionPipeline({
      leadId: 8809,
      talkId: 'talk_multi_99',
      userText: 'Y también este otro https://info.wasi.co/apartamento-venta-los-palos-grandes/10902',
      clientName: 'Yolanda',
      properties,
      contextManager
    });

    // Turno 3: Pregunta por el anterior
    const turn3 = await evaluateCentralDecisionPipeline({
      leadId: 8809,
      talkId: 'talk_multi_99',
      userText: '¿Cuál era el precio del apartamento anterior que te pasé?',
      clientName: 'Yolanda',
      properties,
      contextManager
    });

    assert.strictEqual(turn3.shouldRespond, true);
    assert.strictEqual(turn3.log.propertyIdentified, 'REF-901');
    assert.ok(turn3.text.includes('80.000'));
    assert.strictEqual(turn3.text.includes('190.000'), false);
  });

  // --------------------------------------------------------------------------
  // ESCENARIO 10: Cliente nuevo sin historial previo
  // --------------------------------------------------------------------------
  await testCase('Cliente nuevo sin historial -> Atención inmediata y precisa en turno 1', async () => {
    const properties = [
      {
        ID_PROPIEDAD: 'REF-999',
        TIPO: 'Apartamento',
        OPERACION: 'Venta',
        ESTATUS: 'Disponible',
        PRECIO: 'USD 135.000',
        DESCRIPCION_BREVE: 'Apartamento en Macaracuay, 105 m²',
        Wasi: 'https://info.wasi.co/apartamento-venta-macaracuay/10999'
      }
    ];

    const freshLeadId = 99990000 + Math.floor(Math.random() * 9999);
    const freshTalkId = 'talk_brand_new_' + Date.now();

    const evalRes = await evaluateCentralDecisionPipeline({
      leadId: freshLeadId,
      talkId: freshTalkId,
      userText: 'Buenas tardes, ¿está disponible https://info.wasi.co/apartamento-venta-macaracuay/10999?',
      clientName: 'Zulma',
      properties
    });

    assert.strictEqual(evalRes.shouldRespond, true);
    assert.strictEqual(evalRes.log.propertyIdentified, 'REF-999');
    assert.ok(evalRes.text.includes('Macaracuay'));
    assert.ok(evalRes.text.includes('105 m²'));
    assert.ok(evalRes.text.includes('USD 135.000'));
  });

  console.log('\n==============================================================================');
  console.log(`RESUMEN FASE 8: ${passed} / ${total} ESCENARIOS SUPERADOS (100%)`);
  console.log('==============================================================================\n');
}

runUniversalAcceptanceTests().catch(err => {
  console.error('Fatal Suite Error:', err);
  process.exit(1);
});
