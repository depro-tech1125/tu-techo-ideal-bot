/**
 * BENCHMARK DE VELOCIDAD Y RENDIMIENTO: ÍNDICE UNIVERSAL V5.1
 * Tu Techo Ideal — DEPRO TECH SOLUTIONS
 *
 * Mide 1.000 iteraciones de cada operación crítica:
 * - T_build: Tiempo de construcción del índice completo en memoria
 * - T_url: Tiempo de resolución de URL exacta (O(1))
 * - T_code: Tiempo de resolución de código Wasi/ML/Rexup (O(1))
 * - T_dup: Tiempo de desambiguación profunda en colisiones (MLV-1030258090)
 * - T_row: Tiempo de adaptación/recuperación directa de fila oficial
 * - T_val: Tiempo de validación de procedencia de afirmaciones comerciales
 * - T_total: Latencia acumulada total de resolución y blindaje
 */

const fs = require('fs');
const path = require('path');
const { parseXlsxBufferToUniversalProperties } = require('../lib/universal_sheet_reader');
const { UniversalIdentifierIndex, getGlobalIdentifierIndex } = require('../lib/universal_identifier_index');
const {
  adaptProperty,
  validateCommercialClaimsProvenance,
  buildCommercialFichaResponse
} = require('../pipeline_decision');

function getPercentiles(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.50)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)];
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  return { p50, p95, p99, mean };
}

function runBenchmark() {
  console.log('==============================================================================');
  console.log(' BENCHMARK DE RENDIMIENTO: ÍNDICE UNIVERSAL DE IDENTIFICADORES V5.1           ');
  console.log('==============================================================================\n');

  // Cargar inventario oficial
  const xlsxPath = path.join(__dirname, '..', 'google_sheet_live_audit.xlsx');
  const buffer = fs.readFileSync(xlsxPath);
  const parseResult = parseXlsxBufferToUniversalProperties(buffer);
  const properties = parseResult.properties;
  console.log(`Propiedades cargadas: ${properties.length}`);

  const ITERATIONS = 1000;

  // 1. T_build: Construcción del índice (50 iteraciones para no saturar memoria)
  console.log('\n[1/7] Midiendo T_build (Construcción del índice en memoria)...');
  const tBuildSamples = [];
  const BUILD_ITERATIONS = 50;
  for (let i = 0; i < BUILD_ITERATIONS; i++) {
    const t0 = process.hrtime.bigint();
    const idx = UniversalIdentifierIndex.build(properties);
    const t1 = process.hrtime.bigint();
    tBuildSamples.push(Number(t1 - t0) / 1e6); // ms
  }
  const tBuildStats = getPercentiles(tBuildSamples);
  console.log(`  T_build: p50 = ${tBuildStats.p50.toFixed(3)} ms | p95 = ${tBuildStats.p95.toFixed(3)} ms | Media = ${tBuildStats.mean.toFixed(3)} ms`);

  // Instancia global para las siguientes mediciones
  const index = getGlobalIdentifierIndex(properties);
  const targetProp = properties.find(p => p.ID_PROPIEDAD === 'REF-012') || properties[0];
  const exactUrl = targetProp.externalLinks?.['Mercado Libre'] || targetProp['Mercado Libre'] || 'https://inmueble.mercadolibre.com.ve/MLV-1030015318';

  // 2. T_url: Búsqueda O(1) por URL exacta
  console.log('\n[2/7] Midiendo T_url (Resolución por URL exacta O(1))...');
  const tUrlSamples = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const t0 = process.hrtime.bigint();
    index.lookup(exactUrl);
    const t1 = process.hrtime.bigint();
    tUrlSamples.push(Number(t1 - t0) / 1e3); // us (microsegundos)
  }
  const tUrlStats = getPercentiles(tUrlSamples);
  console.log(`  T_url: p50 = ${tUrlStats.p50.toFixed(2)} µs (${(tUrlStats.p50 / 1000).toFixed(4)} ms) | p95 = ${tUrlStats.p95.toFixed(2)} µs | Media = ${tUrlStats.mean.toFixed(2)} µs`);

  // 3. T_code: Búsqueda O(1) por Código numérico/Wasi/Rexup
  console.log('\n[3/7] Midiendo T_code (Resolución por código normalizado O(1))...');
  const tCodeSamples = [];
  const testCode = 'MLV-1030015318';
  for (let i = 0; i < ITERATIONS; i++) {
    const t0 = process.hrtime.bigint();
    index.lookup(testCode);
    const t1 = process.hrtime.bigint();
    tCodeSamples.push(Number(t1 - t0) / 1e3); // us
  }
  const tCodeStats = getPercentiles(tCodeSamples);
  console.log(`  T_code: p50 = ${tCodeStats.p50.toFixed(2)} µs (${(tCodeStats.p50 / 1000).toFixed(4)} ms) | p95 = ${tCodeStats.p95.toFixed(2)} µs | Media = ${tCodeStats.mean.toFixed(2)} µs`);

  // 4. T_dup: Desambiguación profunda de código duplicado
  console.log('\n[4/7] Midiendo T_dup (Desambiguación profunda en colisión MLV-1030258090)...');
  const tDupSamples = [];
  const dupCode = 'MLV-1030258090';
  const dupContext = { messageText: 'Hola me interesa apartamento en venta en Los Samanes' };
  for (let i = 0; i < ITERATIONS; i++) {
    const t0 = process.hrtime.bigint();
    index.lookup(dupCode, dupContext);
    const t1 = process.hrtime.bigint();
    tDupSamples.push(Number(t1 - t0) / 1e3); // us
  }
  const tDupStats = getPercentiles(tDupSamples);
  console.log(`  T_dup: p50 = ${tDupStats.p50.toFixed(2)} µs (${(tDupStats.p50 / 1000).toFixed(4)} ms) | p95 = ${tDupStats.p95.toFixed(2)} µs | Media = ${tDupStats.mean.toFixed(2)} µs`);

  // 5. T_row: Recuperación / adaptación directa de la fila oficial
  console.log('\n[5/7] Midiendo T_row (Adaptación y recuperación directa de fila oficial)...');
  const tRowSamples = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const t0 = process.hrtime.bigint();
    adaptProperty(targetProp);
    const t1 = process.hrtime.bigint();
    tRowSamples.push(Number(t1 - t0) / 1e3); // us
  }
  const tRowStats = getPercentiles(tRowSamples);
  console.log(`  T_row: p50 = ${tRowStats.p50.toFixed(2)} µs (${(tRowStats.p50 / 1000).toFixed(4)} ms) | p95 = ${tRowStats.p95.toFixed(2)} µs | Media = ${tRowStats.mean.toFixed(2)} µs`);

  // 6. T_val: Validación de procedencia de afirmaciones comerciales
  console.log('\n[6/7] Midiendo T_val (Validación de procedencia de afirmaciones comerciales)...');
  const testResponseText = buildCommercialFichaResponse(targetProp);
  const tValSamples = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const t0 = process.hrtime.bigint();
    validateCommercialClaimsProvenance({
      responseText: testResponseText,
      targetProperty: targetProp,
      properties
    });
    const t1 = process.hrtime.bigint();
    tValSamples.push(Number(t1 - t0) / 1e3); // us
  }
  const tValStats = getPercentiles(tValSamples);
  console.log(`  T_val: p50 = ${tValStats.p50.toFixed(2)} µs (${(tValStats.p50 / 1000).toFixed(4)} ms) | p95 = ${tValStats.p95.toFixed(2)} µs | Media = ${tValStats.mean.toFixed(2)} µs`);

  // 7. T_total: Latencia acumulada total (Lookup O(1) + Adapt + Build Response + Validate)
  console.log('\n[7/7] Midiendo T_total (Latencia acumulada de lookup + blindaje comercial)...');
  const tTotalSamples = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const t0 = process.hrtime.bigint();
    const lRes = index.lookup(dupCode, dupContext);
    const adapted = adaptProperty(lRes.candidate);
    const resp = buildCommercialFichaResponse(adapted);
    validateCommercialClaimsProvenance({
      responseText: resp,
      targetProperty: adapted,
      properties
    });
    const t1 = process.hrtime.bigint();
    tTotalSamples.push(Number(t1 - t0) / 1e3); // us
  }
  const tTotalStats = getPercentiles(tTotalSamples);
  console.log(`  T_total: p50 = ${tTotalStats.p50.toFixed(2)} µs (${(tTotalStats.p50 / 1000).toFixed(4)} ms) | p95 = ${tTotalStats.p95.toFixed(2)} µs | Media = ${tTotalStats.mean.toFixed(2)} µs`);

  console.log('\n==============================================================================');
  console.log(' RESUMEN EJECUTIVO DE TIEMPOS DE RESPUESTA                                   ');
  console.log('==============================================================================');
  console.log(`T_build : p50 = ${tBuildStats.p50.toFixed(3)} ms, p95 = ${tBuildStats.p95.toFixed(3)} ms`);
  console.log(`T_url   : p50 = ${tUrlStats.p50.toFixed(2)} µs (${(tUrlStats.p50 / 1000).toFixed(4)} ms), p95 = ${tUrlStats.p95.toFixed(2)} µs`);
  console.log(`T_code  : p50 = ${tCodeStats.p50.toFixed(2)} µs (${(tCodeStats.p50 / 1000).toFixed(4)} ms), p95 = ${tCodeStats.p95.toFixed(2)} µs`);
  console.log(`T_dup   : p50 = ${tDupStats.p50.toFixed(2)} µs (${(tDupStats.p50 / 1000).toFixed(4)} ms), p95 = ${tDupStats.p95.toFixed(2)} µs`);
  console.log(`T_row   : p50 = ${tRowStats.p50.toFixed(2)} µs (${(tRowStats.p50 / 1000).toFixed(4)} ms), p95 = ${tRowStats.p95.toFixed(2)} µs`);
  console.log(`T_val   : p50 = ${tValStats.p50.toFixed(2)} µs (${(tValStats.p50 / 1000).toFixed(4)} ms), p95 = ${tValStats.p95.toFixed(2)} µs`);
  console.log(`T_total : p50 = ${tTotalStats.p50.toFixed(2)} µs (${(tTotalStats.p50 / 1000).toFixed(4)} ms), p95 = ${tTotalStats.p95.toFixed(2)} µs`);
  console.log('==============================================================================\n');

  return {
    tBuildStats,
    tUrlStats,
    tCodeStats,
    tDupStats,
    tRowStats,
    tValStats,
    tTotalStats
  };
}

if (require.main === module) {
  runBenchmark();
}

module.exports = { runBenchmark };
