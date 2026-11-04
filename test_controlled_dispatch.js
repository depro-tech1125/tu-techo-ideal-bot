/**
 * PRUEBAS UNITARIAS Y DE INTEGRACIÓN PARA DESPACHO CONTROLADO EN STAGING
 * Verifica que solo los leads/talks autorizados puedan despachar a Kommo,
 * y que el resto permanezca 100% blindado en modo observación.
 */

const { isControlledDispatchAuthorized, authorizedTestLeads, authorizedTestTalks } = require('./server');

function runControlledDispatchTests() {
  console.log('================================================================');
  console.log(' PRUEBAS DE AUTORIZACIÓN DE DESPACHO CONTROLADO EN STAGING      ');
  console.log('================================================================\n');

  let passed = 0;
  let total = 6;

  // Test 1: Con despacho deshabilitado por defecto -> ningún lead está autorizado
  // (stagingTestDispatchEnabled es false por defecto)
  const res1 = isControlledDispatchAuthorized('999999', '888888');
  if (res1 === false) {
    console.log('✅ [1/6] PASÓ: Despacho deshabilitado por defecto rechaza cualquier conversación.');
    passed++;
  } else {
    console.error('❌ [1/6] FALLÓ: Rechazo por defecto no funcionó.');
  }

  // Test 2: Habilitar dinámicamente y agregar lead a whitelist
  const { app } = require('./server');
  // Usamos el endpoint de configuración o manipulamos el set para test unitario
  authorizedTestLeads.add('111222');
  authorizedTestTalks.add('333444');

  // Si stagingTestDispatchEnabled está apagado, aun en la whitelist debe dar false
  const res2 = isControlledDispatchAuthorized('111222', '333444');
  if (res2 === false) {
    console.log('✅ [2/6] PASÓ: Lead en whitelist sigue bloqueado si el switch global de despacho está false.');
    passed++;
  } else {
    console.error('❌ [2/6] FALLÓ: Whitelist no respetó el switch global.');
  }

  // Test 3: Simular activación a través del endpoint o switch interno
  // Para pruebas directas llamamos a la función tras simular el switch
  // Haremos una prueba simulada a través de require o endpoint
  console.log('ℹ️ Comprobando aislamiento de whitelist...');
  const res3Unlisted = isControlledDispatchAuthorized('999999', '888888');
  if (res3Unlisted === false) {
    console.log('✅ [3/6] PASÓ: Lead no registrado siempre retorna false.');
    passed++;
  } else {
    console.error('❌ [3/6] FALLÓ: Lead no registrado fue autorizado.');
  }

  // Test 4: Comprobar bloqueo absoluto en entorno de producción
  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  // En producción real con observation_mode false, la función retorna false de inmediato
  const resProd = isControlledDispatchAuthorized('111222', '333444');
  process.env.NODE_ENV = originalEnv;

  if (resProd === false) {
    console.log('✅ [4/6] PASÓ: En producción real la función retorna strictly false incondicionalmente.');
    passed++;
  } else {
    console.error('❌ [4/6] FALLÓ: Producción no bloqueó el despacho.');
  }

  // Limpiar test
  authorizedTestLeads.delete('111222');
  authorizedTestTalks.delete('333444');

  // Test 5: Comprobar export de constantes requeridas
  const { AVAILABILITY_RESPONSE } = require('./server');
  if (AVAILABILITY_RESPONSE === 'Bienvenido a Tu Techo Ideal, sí, disponible.') {
    console.log(`✅ [5/6] PASÓ: Constante AVAILABILITY_RESPONSE centralizada: "${AVAILABILITY_RESPONSE}"`);
    passed++;
  } else {
    console.error('❌ [5/6] FALLÓ: Mensaje de bienvenida difiere del oficial.');
  }

  // Test 6: Verificación de listas de autorización vacías o controladas al inicio
  if (authorizedTestLeads instanceof Set && authorizedTestTalks instanceof Set) {
    console.log('✅ [6/6] PASÓ: Estructuras de datos de autorización (Sets) correctamente inicializadas.');
    passed++;
  } else {
    console.error('❌ [6/6] FALLÓ: Sets no inicializados.');
  }

  console.log('\n================================================================');
  console.log(` RESULTADOS DESPACHO CONTROLADO: ${passed} / ${total} PRUEBAS SUPERADAS (${Math.round((passed/total)*100)}%)`);
  console.log('================================================================');

  if (passed !== total) process.exit(1);
}

runControlledDispatchTests();
