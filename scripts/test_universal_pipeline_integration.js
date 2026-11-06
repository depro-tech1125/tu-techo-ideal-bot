/**
 * TEST DE INTEGRACIÓN: PIPELINE COMERCIAL CON LECTOR UNIVERSAL V5.1
 * Tu Techo Ideal V5.1 — Depro Tech Solutions
 *
 * Demuestra que:
 * 1. adaptProperty mapea dinámicamente columnas nuevas a externalLinks y raíz.
 * 2. extractMultiportalPropertyIdentifiers resuelve enlaces de portales no previstos
 *    (MLS Caracas, Portal Nuevo, etc.) sin cambios de código.
 * 3. evaluateCentralDecisionPipeline aprueba disponibilidad y genera respuesta comercial
 *    basada en la información de Google Sheets para el nuevo portal.
 */

const assert = require('assert');
const {
  adaptProperty,
  extractMultiportalPropertyIdentifiers,
  evaluateCentralDecisionPipeline
} = require('../pipeline_decision');

async function main() {
  console.log('==============================================================================');
  console.log(' TEST DE INTEGRACIÓN: PIPELINE COMERCIAL CON LECTOR UNIVERSAL V5.1            ');
  console.log('==============================================================================\n');

  // 1. Simulación de inventario enriquecido con columnas dinámicas universales
  const dynamicInventory = [
    {
      ID_PROPIEDAD: 'REF-015',
      TIPO: 'Apartamento',
      OPERACION: 'Venta',
      DESCRIPCION_BREVE: 'Apartamento en La Castellana con terraza',
      ESTATUS: 'Disponible',
      Wasi: 'https://info.wasi.co/prop/10466015',
      'Mercado Libre': 'https://inmueble.mercadolibre.com.ve/MLV-10466015',
      'MLS Caracas': 'https://mlscaracas.com.ve/inmuebles/prop-10466015-castellana',
      'Portal Inmobiliario Nuevo': 'https://portalnuevo2026.com/ref015',
      externalLinks: {
        'Wasi': 'https://info.wasi.co/prop/10466015',
        'Mercado Libre': 'https://inmueble.mercadolibre.com.ve/MLV-10466015',
        'MLS Caracas': 'https://mlscaracas.com.ve/inmuebles/prop-10466015-castellana',
        'Portal Inmobiliario Nuevo': 'https://portalnuevo2026.com/ref015'
      }
    }
  ];

  // Test 1: adaptProperty preserva externalLinks y expone columnas dinámicas
  console.log('[Test 1] Verificando adaptProperty con columnas dinámicas...');
  const adapted = adaptProperty(dynamicInventory[0]);
  assert.ok(adapted.externalLinks['MLS Caracas'], 'externalLinks debe incluir MLS Caracas');
  assert.ok(adapted.externalLinks['Portal Inmobiliario Nuevo'], 'externalLinks debe incluir Portal Inmobiliario Nuevo');
  assert.strictEqual(adapted['MLS Caracas'], 'https://mlscaracas.com.ve/inmuebles/prop-10466015-castellana');
  assert.strictEqual(adapted['Portal Inmobiliario Nuevo'], 'https://portalnuevo2026.com/ref015');
  console.log('  ✅ adaptProperty mapeó exitosamente todas las columnas dinámicas.');

  // Test 2: Reconocimiento de URL entrante de un portal nuevo (MLS Caracas)
  console.log('\n[Test 2] Extracción de identificador de portal nuevo (MLS Caracas)...');
  const clientMessageMls = 'Hola, vi este inmueble https://mlscaracas.com.ve/inmuebles/prop-10466015-castellana ¿Sigue disponible?';
  const multiportalResult = extractMultiportalPropertyIdentifiers(clientMessageMls, dynamicInventory, adaptProperty);

  assert.ok(multiportalResult.matches.length > 0, 'Debe encontrar la propiedad en el inventario dinámico');
  assert.strictEqual(multiportalResult.matches[0].ID_PROPIEDAD, 'REF-015');
  console.log('  ✅ Multiportal reconoció el enlace de MLS Caracas y resolvió a REF-015.');

  // Test 3: Reconocimiento de URL de un portal completamente desconocido
  console.log('\n[Test 3] Extracción de identificador de portal totalmente desconocido...');
  const clientMessageNuevo = 'Buenas, me interesa esta publicacion: https://portalnuevo2026.com/ref015';
  const multiportalResultNuevo = extractMultiportalPropertyIdentifiers(clientMessageNuevo, dynamicInventory, adaptProperty);

  assert.ok(multiportalResultNuevo.matches.length > 0, 'Debe encontrar la propiedad');
  assert.strictEqual(multiportalResultNuevo.matches[0].ID_PROPIEDAD, 'REF-015');
  console.log('  ✅ Multiportal reconoció el enlace de Portal Inmobiliario Nuevo y resolvió a REF-015.');

  // Test 4: Pipeline de Decisión Comercial Integral con portal dinámico
  console.log('\n[Test 4] Pipeline Central de Decisión con portal dinámico...');
  const pipelineResult = await evaluateCentralDecisionPipeline({
    userText: clientMessageMls,
    properties: dynamicInventory
  });

  assert.strictEqual(pipelineResult.shouldRespond, true);
  assert.strictEqual(pipelineResult.log.action, 'RESPOND');
  assert.strictEqual(pipelineResult.log.propertyIdentified, 'REF-015');
  assert.strictEqual(pipelineResult.targetProperty.ID_PROPIEDAD, 'REF-015');
  assert.ok(pipelineResult.text.includes('disponible'), 'La respuesta debe confirmar disponibilidad');
  console.log('  ✅ Pipeline Central aprobó respuesta oficial basada en Google Sheets para el nuevo portal.');

  console.log('\n==============================================================================');
  console.log(' TODOS LOS TESTS DE INTEGRACIÓN CON EL PIPELINE FUERON EXITOSOS (100%)       ');
  console.log('==============================================================================\n');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
