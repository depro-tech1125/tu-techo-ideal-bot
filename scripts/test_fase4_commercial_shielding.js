/**
 * ============================================================================
 * TEST SUITE: BLINDAJE COMERCIAL Y BARRERA PREVIA AL DESPACHO (FASE 4)
 * ============================================================================
 * Proyecto: Tu Techo Ideal V5.1 — DEPRO TECH SOLUTIONS
 * Verificación exhaustiva de:
 * 1. Barrera Pre-Dispatch Safety (Sintáctica, Bloqueo Humano, Verdad Comercial, Stale Source)
 * 2. Protección frente a desconexión / datos obsoletos de Google Sheets (_isStale)
 * 3. Trazabilidad integral de decisiones y enriquecimiento de auditoría
 * ============================================================================
 */

const assert = require('assert');
const {
  verifyPreDispatchSafety,
  evaluateCentralDecisionPipeline,
  HandoffManager,
  ConversationContextManager,
  adaptProperty,
  AVAILABILITY_RESPONSE
} = require('../pipeline_decision.js');

async function runPhase4Tests() {
  console.log('==============================================================================');
  console.log('      SUITE AUTOMATIZADA: BLINDAJE COMERCIAL Y BARRERA CENTRAL (FASE 4)       ');
  console.log('==============================================================================\n');

  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`✅ [Test ${total}] ${name}... PASÓ`);
      passed++;
    } catch (err) {
      console.error(`❌ [Test ${total}] ${name}... FALLÓ: ${err.message}`);
    }
  }

  async function testAsync(name, fn) {
    total++;
    try {
      await fn();
      console.log(`✅ [Test ${total}] ${name}... PASÓ`);
      passed++;
    } catch (err) {
      console.error(`❌ [Test ${total}] ${name}... FALLÓ: ${err.message}`);
    }
  }

  const sampleAvailableProperty = adaptProperty({
    ID_PROPIEDAD: 'REF-012',
    TIPO: 'Apartamento',
    OPERACION: 'Venta',
    ESTATUS: 'Disponible',
    DESCRIPCION_BREVE: 'Apartamento en Los Samanes Caracas de 110 m2',
    PRECIO: 'USD 146.000',
    Wasi: 'https://info.wasi.co/apartamento-venta-los-samanes-caracas/10493109'
  });

  const sampleReservedProperty = adaptProperty({
    ID_PROPIEDAD: 'REF-070',
    TIPO: 'Apartamento',
    OPERACION: 'Alquiler',
    ESTATUS: 'Reservado',
    DESCRIPCION_BREVE: 'Apartamento en La Castellana Caracas',
    PRECIO: 'USD 1.200',
    Wasi: 'https://info.wasi.co/apartamento-alquiler-la-castellana/1234567'
  });

  // 1. Barrera Pre-Dispatch: Detección de texto corrupto o vacío
  await testAsync('1.1 verifyPreDispatchSafety bloquea texto vacío o de solo espacios', async () => {
    const res = await verifyPreDispatchSafety({
      responseText: '   ',
      targetProperty: sampleAvailableProperty
    });
    assert.strictEqual(res.canDispatch, false);
    assert.ok(res.reason.includes('vacío'));
  });

  await testAsync('1.2 verifyPreDispatchSafety bloquea tokens inválidos (undefined, null, NaN)', async () => {
    const resUndefined = await verifyPreDispatchSafety({
      responseText: 'El precio es undefined dólares.',
      targetProperty: sampleAvailableProperty
    });
    assert.strictEqual(resUndefined.canDispatch, false);
    assert.ok(resUndefined.reason.includes('corrupto'));

    const resNull = await verifyPreDispatchSafety({
      responseText: 'Tiene null habitaciones.',
      targetProperty: sampleAvailableProperty
    });
    assert.strictEqual(resNull.canDispatch, false);

    const resNaN = await verifyPreDispatchSafety({
      responseText: 'Metraje de NaN m2.',
      targetProperty: sampleAvailableProperty
    });
    assert.strictEqual(resNaN.canDispatch, false);
  });

  // 2. Barrera Pre-Dispatch: Protección de bloqueo por asesor humano
  await testAsync('2.1 verifyPreDispatchSafety bloquea despacho si hay asesor humano activo', async () => {
    const handoff = new HandoffManager();
    const now = Date.now();
    handoff.recordHumanIntervention('lead_h1', 'talk_h1', null, now);

    const res = await verifyPreDispatchSafety({
      leadId: 'lead_h1',
      talkId: 'talk_h1',
      handoffManager: handoff,
      responseText: '¡Hola! Sí, el apartamento está disponible.',
      targetProperty: sampleAvailableProperty,
      now: now + 1000
    });
    assert.strictEqual(res.canDispatch, false);
    assert.ok(res.reason.includes('Intervención humana'));
  });

  // 3. Barrera Pre-Dispatch: Protección frente a inventario desactualizado / desconectado
  await testAsync('3.1 verifyPreDispatchSafety bloquea despacho si properties._isStale === true', async () => {
    const staleProps = [sampleAvailableProperty];
    staleProps._isStale = true;

    const res = await verifyPreDispatchSafety({
      responseText: '¡Hola! Sí, disponible.',
      targetProperty: sampleAvailableProperty,
      properties: staleProps
    });
    assert.strictEqual(res.canDispatch, false);
    assert.ok(res.reason.includes('desactualizado') || res.reason.includes('Google Sheets'));
  });

  // 4. Barrera Pre-Dispatch: Verdad Comercial estricta (no confirmar inmueble no disponible)
  await testAsync('4.1 verifyPreDispatchSafety bloquea confirmación de disponibilidad si el estatus es Reservado o No Disponible', async () => {
    const res = await verifyPreDispatchSafety({
      responseText: '¡Hola! Sí, el apartamento se encuentra disponible para alquiler.',
      targetProperty: sampleReservedProperty
    });
    assert.strictEqual(res.canDispatch, false);
    assert.ok(res.reason.includes('Violación de verdad comercial'));
  });

  await testAsync('4.2 verifyPreDispatchSafety autoriza despacho cuando todos los criterios son válidos', async () => {
    const res = await verifyPreDispatchSafety({
      responseText: '¡Hola! Sí, el apartamento en Los Samanes se encuentra disponible para venta. Cuenta con 110 m² y su precio es de USD 146.000.',
      targetProperty: sampleAvailableProperty
    });
    assert.strictEqual(res.canDispatch, true);
  });

  // 5. Compatibilidad retroactiva de argumentos posicionales
  await testAsync('5.1 verifyPreDispatchSafety mantiene compatibilidad con firma posicional (leadId, talkId, contactId, handoffManager)', async () => {
    const handoff = new HandoffManager();
    const res = await verifyPreDispatchSafety('lead_pos', 'talk_pos', null, handoff);
    assert.strictEqual(res.canDispatch, true);
  });

  // 6. Pipeline: Google Sheets desactualizado / sin conexión genera Silencio Seguro comercial
  await testAsync('6.1 evaluateCentralDecisionPipeline guarda SILENCIO absoluto si properties._isStale === true', async () => {
    const staleProps = [sampleAvailableProperty];
    staleProps._isStale = true;

    const res = await evaluateCentralDecisionPipeline({
      userText: 'Hola, está disponible https://info.wasi.co/apartamento-venta-los-samanes-caracas/10493109?',
      leadId: 'lead_stale_1',
      talkId: 'talk_stale_1',
      properties: staleProps
    });

    assert.strictEqual(res.shouldRespond, false);
    assert.strictEqual(res.log.typeDetected, 'SHEET_CONNECTION_UNAVAILABLE');
    assert.strictEqual(res.log.blockReason, 'GOOGLE_SHEETS_STALE_OR_OFFLINE');
  });

  // 7. Pipeline: Trazabilidad integral en logEntry
  await testAsync('7.1 evaluateCentralDecisionPipeline registra trazabilidad completa (timestamp, fingerprint, fieldsUsed, validationResult)', async () => {
    const freshProps = [sampleAvailableProperty];
    freshProps._schemaFingerprint = 'v5.1-sha256-test';

    const res = await evaluateCentralDecisionPipeline({
      userText: 'Hola, información de https://info.wasi.co/apartamento-venta-los-samanes-caracas/10493109',
      leadId: 'lead_trace_1',
      talkId: 'talk_trace_1',
      properties: freshProps,
      currentTime: 1700000000000
    });

    assert.strictEqual(res.shouldRespond, true);
    assert.strictEqual(res.log.leadId, 'lead_trace_1');
    assert.strictEqual(res.log.talkId, 'talk_trace_1');
    assert.strictEqual(res.log.propertyIdentified, 'REF-012');
    assert.strictEqual(res.log.schemaFingerprint, 'v5.1-sha256-test');
    assert.strictEqual(res.log.validationResult, 'VERIFIED_AVAILABLE');
    assert.ok(Array.isArray(res.log.fieldsUsed));
    assert.ok(res.log.fieldsUsed.includes('ID_PROPIEDAD'));
  });

  console.log('\n==============================================================================');
  console.log(`RESUMEN FASE 4: ${passed} / ${total} PRUEBAS SUPERADAS (${Math.round((passed/total)*100)}%)`);
  console.log('==============================================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runPhase4Tests().catch(err => {
  console.error('Error fatal en suite Fase 4:', err);
  process.exit(1);
});
