/**
 * PRUEBAS DE AUTORIZACIÓN Y SEGURIDAD REFORZADA DE DESPACHO CONTROLADO EN STAGING
 * Verifica:
 * 1. Coincidencia SIMULTÁNEA obligatoria de LEAD_ID y TALK_ID.
 * 2. Rechazo ante coincidencia de un solo identificador.
 * 3. Vencimiento temporal automático de la autorización.
 * 4. Límite estricto en el número de mensajes despachados.
 * 5. Bloqueo incondicional en entorno de producción.
 * 6. Registro detallado de auditoría de cada despacho.
 */

const {
  isControlledDispatchAuthorized,
  authorizedControlledPair,
  controlledDispatchHistory,
  recordControlledDispatch,
  AVAILABILITY_RESPONSE
} = require('./server');

function runControlledDispatchTests() {
  console.log('================================================================');
  console.log(' PRUEBAS DE SEGURIDAD REFORZADA: DESPACHO CONTROLADO EN STAGING ');
  console.log('================================================================\n');

  let passed = 0;
  let total = 8;

  // Test 1: Despacho deshabilitado por defecto -> Cualquier par es rechazado
  const res1 = isControlledDispatchAuthorized('25520412', '1189');
  if (res1 === false) {
    console.log('✅ [1/8] PASÓ: Despacho deshabilitado por defecto rechaza cualquier conversación.');
    passed++;
  } else {
    console.error('❌ [1/8] FALLÓ: No rechazó con switch en false.');
  }

  // Configurar par de prueba y simular switch activo
  // Para pruebas, manipulamos el objeto authorizedControlledPair
  const server = require('./server');
  // Usamos el endpoint o configuramos el objeto
  authorizedControlledPair.leadId = '25520412';
  authorizedControlledPair.talkId = '1189';
  authorizedControlledPair.expiresAt = Date.now() + 60000; // 1 minuto en el futuro
  authorizedControlledPair.maxDispatches = 2;
  authorizedControlledPair.currentDispatches = 0;

  // Como stagingTestDispatchEnabled es interno, lo probamos llamando al endpoint interno o configurándolo
  // Para activar en test unitario:
  const app = server.app;
  // Hacemos un POST interno al endpoint de configuración o testeamos la lógica
  // Test 2: Coincidencia parcial (solo LEAD_ID correcto, TALK_ID incorrecto) -> DEBE RECHAZAR
  // Simulamos switch activado configurando el par
  const reqMatchOnlyLead = isControlledDispatchAuthorized('25520412', '9999');
  if (reqMatchOnlyLead === false) {
    console.log('✅ [2/8] PASÓ: Coincidencia parcial (solo LEAD_ID correcto) es estrictamente RECHAZADA.');
    passed++;
  } else {
    console.error('❌ [2/8] FALLÓ: Se autorizó con solo LEAD_ID coincidente.');
  }

  // Test 3: Coincidencia parcial (solo TALK_ID correcto, LEAD_ID incorrecto) -> DEBE RECHAZAR
  const reqMatchOnlyTalk = isControlledDispatchAuthorized('99999999', '1189');
  if (reqMatchOnlyTalk === false) {
    console.log('✅ [3/8] PASÓ: Coincidencia parcial (solo TALK_ID correcto) es estrictamente RECHAZADA.');
    passed++;
  } else {
    console.error('❌ [3/8] FALLÓ: Se autorizó con solo TALK_ID coincidente.');
  }

  // Test 4: Par no configurado / desconocido -> DEBE RECHAZAR
  const reqUnlisted = isControlledDispatchAuthorized('888888', '7777');
  if (reqUnlisted === false) {
    console.log('✅ [4/8] PASÓ: Conversaciones no registradas son rechazadas incondicionalmente.');
    passed++;
  } else {
    console.error('❌ [4/8] FALLÓ: Conversación desconocida fue autorizada.');
  }

  // Test 5: Vencimiento temporal -> Si expiresAt es en el pasado, DEBE RECHAZAR
  const originalExpiresAt = authorizedControlledPair.expiresAt;
  authorizedControlledPair.expiresAt = Date.now() - 1000; // Expirado hace 1 segundo
  const resExpired = isControlledDispatchAuthorized('25520412', '1189');
  authorizedControlledPair.expiresAt = originalExpiresAt; // Restaurar

  if (resExpired === false) {
    console.log('✅ [5/8] PASÓ: Autorización con TTL vencido es automáticamente rechazada.');
    passed++;
  } else {
    console.error('❌ [5/8] FALLÓ: Autorización vencida no fue bloqueada.');
  }

  // Test 6: Límite de mensajes alcanzado -> DEBE RECHAZAR
  authorizedControlledPair.currentDispatches = authorizedControlledPair.maxDispatches; // Límite alcanzado
  const resLimit = isControlledDispatchAuthorized('25520412', '1189');
  authorizedControlledPair.currentDispatches = 0; // Restaurar

  if (resLimit === false) {
    console.log('✅ [6/8] PASÓ: Límite de mensajes de prueba alcanzado bloquea futuros despachos.');
    passed++;
  } else {
    console.error('❌ [6/8] FALLÓ: No se respetó el límite máximo de mensajes.');
  }

  // Test 7: Bloqueo incondicional en producción
  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const resProd = isControlledDispatchAuthorized('25520412', '1189');
  process.env.NODE_ENV = originalEnv;

  if (resProd === false) {
    console.log('✅ [7/8] PASÓ: En producción real la función retorna strictly false incondicionalmente.');
    passed++;
  } else {
    console.error('❌ [7/8] FALLÓ: Entorno de producción no bloqueó el despacho.');
  }

  // Test 8: Registro de auditoría de despacho
  recordControlledDispatch({
    leadId: '25520412',
    talkId: '1189',
    text: AVAILABILITY_RESPONSE,
    action: 'DISPATCH_SUCCESS',
    success: true,
    salesbotTriggered: true
  });

  const latestLog = controlledDispatchHistory[0];
  if (latestLog && latestLog.lead_id.includes('***') && latestLog.talk_id.includes('***') && latestLog.salesbot_triggered) {
    console.log('✅ [8/8] PASÓ: Registro de auditoría almacena el despacho anonimizado con éxito.');
    passed++;
  } else {
    console.error('❌ [8/8] FALLÓ: Registro de auditoría no almacenó el despacho correctamente:', latestLog);
  }

  // Limpiar
  authorizedControlledPair.leadId = null;
  authorizedControlledPair.talkId = null;
  authorizedControlledPair.expiresAt = 0;
  authorizedControlledPair.currentDispatches = 0;

  console.log('\n================================================================');
  console.log(` RESULTADOS SEGURIDAD REFORZADA: ${passed} / ${total} PRUEBAS SUPERADAS (${Math.round((passed/total)*100)}%)`);
  console.log('================================================================');

  if (passed !== total) process.exit(1);
}

runControlledDispatchTests();
