/**
 * PRUEBA DE INSTRUMENTACIÓN Y VERIFICACIÓN DE DESCARGAS DE GOOGLE SHEETS
 * Tu Techo Ideal — DEPRO TECH SOLUTIONS
 *
 * Simula 1.000 llamadas a getAvailableProperties() simulando webhooks de entrada.
 * Comprueba:
 *  - Cantidad de descargas del XLSX (debe ser 1 inicial, 0 adicionales dentro del TTL)
 *  - Cantidad de reconstrucciones del índice
 *  - Cantidad de consultas a Google Sheets
 *  - Cantidad de recuperaciones desde caché (debe ser 999)
 *  - Cantidad de errores (debe ser 0)
 *  - Protección single-flight ante concurrencia
 *  - Tiempo total empleado
 */

const assert = require('assert');
const { getAvailableProperties, inventoryMetrics } = require('../server');

async function testSheetsDownloads() {
  console.log('==============================================================================');
  console.log(' VERIFICACIÓN DE DESCARGAS DE GOOGLE SHEETS (1.000 MENSAJES SIMULADOS)        ');
  console.log('==============================================================================\n');

  // Resetear métricas iniciales
  inventoryMetrics.xlsxDownloads = 0;
  inventoryMetrics.cacheHits = 0;
  inventoryMetrics.sheetQueries = 0;
  inventoryMetrics.indexRebuilds = 0;
  inventoryMetrics.errors = 0;

  console.log('Iniciando simulación de 1.000 mensajes concurrentes y secuenciales...');
  const t0 = process.hrtime.bigint();

  // 1. Ejecutar ráfaga concurrente de 50 mensajes en el instante t=0 (Prueba de Single-Flight)
  console.log('Fase 1: Disparando ráfaga concurrente de 50 llamadas simultáneas...');
  const burstPromises = [];
  for (let b = 0; b < 50; b++) {
    burstPromises.push(getAvailableProperties());
  }
  const burstResults = await Promise.all(burstPromises);
  assert.strictEqual(burstResults.length, 50, 'Todas las 50 promesas deben resolverse');

  console.log(`  -> Ráfaga inicial completada. Descargas XLSX: ${inventoryMetrics.xlsxDownloads}, Consultas Sheets: ${inventoryMetrics.sheetQueries}`);
  assert.strictEqual(inventoryMetrics.xlsxDownloads, 1, 'Single-flight DEBE garantizar exactamente 1 sola descarga XLSX para la ráfaga');
  assert.strictEqual(inventoryMetrics.sheetQueries, 1, 'Single-flight DEBE garantizar exactamente 1 sola consulta a Google Sheets');

  // 2. Ejecutar los 950 mensajes restantes dentro de la ventana de vigencia (Prueba de Caché TTL)
  console.log('Fase 2: Ejecutando las 950 consultas restantes en memoria...');
  for (let i = 50; i < 1000; i++) {
    const props = await getAvailableProperties();
    assert.strictEqual(Array.isArray(props), true);
    assert.strictEqual(props.length, 69);
  }

  const t1 = process.hrtime.bigint();
  const totalMs = Number(t1 - t0) / 1e6;

  console.log('\n==============================================================================');
  console.log(' RESULTADOS DE LA INSTRUMENTACIÓN (1.000 CONSULTAS SIMULADAS)                 ');
  console.log('==============================================================================');
  console.log(`- Cantidad de descargas del XLSX:          ${inventoryMetrics.xlsxDownloads} (Esperado: 1)`);
  console.log(`- Cantidad de reconstrucciones del índice: ${inventoryMetrics.indexRebuilds} (Esperado: 1)`);
  console.log(`- Cantidad de consultas a Google Sheets:   ${inventoryMetrics.sheetQueries} (Esperado: 1)`);
  console.log(`- Cantidad de recuperaciones desde caché:  ${inventoryMetrics.cacheHits} (Esperado: 999)`);
  console.log(`- Cantidad de errores:                     ${inventoryMetrics.errors} (Esperado: 0)`);
  console.log(`- Tiempo total empleado:                   ${totalMs.toFixed(2)} ms (${(totalMs / 1000).toFixed(4)} ms/msg)`);
  console.log('==============================================================================\n');

  assert.strictEqual(inventoryMetrics.xlsxDownloads, 1, 'No debe descargar XLSX más de 1 vez');
  assert.strictEqual(inventoryMetrics.cacheHits, 999, 'Debe recuperar de caché exactamente 999 veces');
  assert.strictEqual(inventoryMetrics.errors, 0, 'No debe haber errores');

  console.log('✅ CERTIFICACIÓN EXITOSA: Cada webhook recupera la instantánea vigente desde memoria.');
  console.log('✅ PROTECCIÓN SINGLE-FLIGHT CONFIRMADA: Cero descargas redundantes.');
}

if (require.main === module) {
  testSheetsDownloads().catch(err => {
    console.error('❌ Error en prueba de descargas:', err);
    process.exit(1);
  });
}

module.exports = { testSheetsDownloads };

