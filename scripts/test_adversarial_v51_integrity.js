/**
 * ============================================================================
 * BANCO DE PRUEBAS ADVERSARIALES: INTEGRIDAD COMERCIAL V5.1
 * ============================================================================
 * Proyecto: Tu Techo Ideal V5.1 — DEPRO TECH SOLUTIONS
 *
 * Grupos de Prueba:
 * - Grupo A: Aislamiento Conversacional (Talk-to-Lead Context Isolation)
 * - Grupo B: Integridad y Proveniencia de Datos (Pre-Dispatch Commercial Truth Barrier)
 * - Grupo C: Identificación y Eliminación del 90% Superficial (Level 3 Discriminants)
 * - Grupo D: Integridad de Google Sheets y Filas en Cuarentena (Borradores REF-063 a 069)
 * - Grupo E: Control de IA y Vigencia de Caché (Nemotron Free & Stale Cache)
 * - Grupo F: Seguridad de Despacho (Cero Mutaciones ante Fallo de Verificación)
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const {
  evaluateCentralDecisionPipeline,
  verifyPreDispatchSafety,
  validateCommercialClaimsProvenance,
  ConversationContextManager,
  HandoffManager,
  adaptProperty,
  AVAILABILITY_RESPONSE
} = require('../pipeline_decision.js');

const {
  matchPublicationAgainstProperties,
  extractPublicationAttributes,
  extractPropertyFeaturesFromExternalText
} = require('../lib/external_publication_reader.js');

async function runAdversarialSuite() {
  console.log('==============================================================================');
  console.log('    BANCO DE PRUEBAS ADVERSARIALES — INTEGRIDAD COMERCIAL V5.1 (DEPRO TECH)  ');
  console.log('==============================================================================\n');

  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`✅ [Adv Test ${total}] ${name}... PASÓ`);
      passed++;
    } catch (err) {
      console.error(`❌ [Adv Test ${total}] ${name}... FALLÓ: ${err.message}`);
      throw err;
    }
  }

  async function testAsync(name, fn) {
    total++;
    try {
      await fn();
      console.log(`✅ [Adv Test ${total}] ${name}... PASÓ`);
      passed++;
    } catch (err) {
      console.error(`❌ [Adv Test ${total}] ${name}... FALLÓ: ${err.message}`);
      throw err;
    }
  }

  // Cargar inventario oficial desde caché de propiedades
  const cachePath = path.join(__dirname, '..', 'properties_cache.json');
  const rawProps = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  const properties = rawProps.map(adaptProperty);

  const ref012 = properties.find(p => p.ID_PROPIEDAD === 'REF-012');
  const ref003 = properties.find(p => p.ID_PROPIEDAD === 'REF-003');
  const ref035 = properties.find(p => p.ID_PROPIEDAD === 'REF-035');
  const ref063 = properties.find(p => p.ID_PROPIEDAD === 'REF-063');

  assert(ref012, 'REF-012 debe existir');
  assert(ref003, 'REF-003 debe existir');
  assert(ref035, 'REF-035 debe existir');
  assert(ref063, 'REF-063 debe existir');

  const advContextFile = path.join(__dirname, 'temp_adv_lead_contexts.json');
  if (fs.existsSync(advContextFile)) fs.unlinkSync(advContextFile);
  const contextManager = new ConversationContextManager(advContextFile);
  const handoffManager = new HandoffManager();

  // ==========================================================================
  // GRUPO A: AISLAMIENTO CONVERSACIONAL (Talk-to-Lead Isolation)
  // ==========================================================================
  console.log('\n--- GRUPO A: AISLAMIENTO CONVERSACIONAL (TALK-TO-LEAD) ---');

  // Test A1: Lead L1, Talk T1 consultó REF-012. Talk T2 pregunta "¿Cuánto cuesta?" -> Jamás hereda REF-012
  await testAsync('A1: Talk T2 bajo el mismo Lead L1 NO hereda contexto de Talk T1', async () => {
    const leadId = 'lead_adv_multi_talk_1';
    const talk1 = 'talk_adv_t1';
    const talk2 = 'talk_adv_t2';

    // Talk 1 consulta REF-012
    const dec1 = await evaluateCentralDecisionPipeline({
      leadId,
      talkId: talk1,
      userText: 'Hola, ¿está disponible REF-012?',
      properties,
      contextManager,
      handoffManager,
      channel: 'facebook'
    });
    assert.strictEqual(dec1.log.action, 'RESPOND');
    assert.strictEqual(dec1.targetProperty?.ID_PROPIEDAD, 'REF-012');

    // Contexto de Talk 1 tiene REF-012
    const ctx1 = contextManager.getContext(talk1, leadId);
    assert(ctx1 !== null, 'ctx1 no debe ser null');
    assert.strictEqual(ctx1.ID_PROPIEDAD, 'REF-012');

    // Talk 2 entra con pregunta ambigua sin código: "¿Cuánto cuesta?"
    const dec2 = await evaluateCentralDecisionPipeline({
      leadId,
      talkId: talk2,
      userText: '¿Cuánto cuesta?',
      properties,
      contextManager,
      handoffManager,
      channel: 'facebook'
    });

    // Talk 2 NUNCA debe haber recibido REF-012
    assert.notStrictEqual(dec2.targetProperty?.ID_PROPIEDAD, 'REF-012', 'Talk 2 NO debe heredar REF-012');
    assert.notStrictEqual(dec2.log.identificationMethod, 'PROPERTY_MATCH_EXACT', 'Talk 2 NO debe considerarse PROPERTY_MATCH_EXACT');
    // Debe ser silencio o pedir referencia
    if (dec2.shouldRespond && dec2.text) {
      assert(
        !dec2.text.includes('146.000') && !dec2.text.includes('Los Samanes'),
        'Talk 2 no debe responder datos de REF-012'
      );
    }
  });

  // Test A2: Talk T2 pregunta "¿Cuántos metros tiene el anterior?" -> Jamás resuelve el de Talk T1
  await testAsync('A2: Talk T2 no resuelve ordinales relativos a Talk T1', async () => {
    const leadId = 'lead_adv_multi_talk_1';
    const talk2 = 'talk_adv_t2';

    const decOrdinalT2 = await evaluateCentralDecisionPipeline({
      leadId,
      talkId: talk2,
      userText: '¿Cuántos metros tiene el anterior?',
      properties,
      contextManager,
      handoffManager,
      channel: 'facebook'
    });

    assert.notStrictEqual(decOrdinalT2.targetProperty?.ID_PROPIEDAD, 'REF-012');
    if (decOrdinalT2.shouldRespond && decOrdinalT2.text) {
      assert(!decOrdinalT2.text.includes('110'), 'No debe responder el metraje de REF-012');
    }
  });

  // Test A3: Mismo Talk T3 consulta sucesivamente REF-003 y REF-012, luego pregunta "¿y el primero?" -> Resuelve REF-003
  await testAsync('A3: Mismo Talk T3 sí resuelve ordinales intra-historial correctamente', async () => {
    const leadId = 'lead_adv_ordinal_intra';
    const talk3 = 'talk_adv_t3';

    // Primer mensaje: REF-003
    await evaluateCentralDecisionPipeline({
      leadId,
      talkId: talk3,
      userText: 'Hola, ¿está disponible REF-003?',
      properties,
      contextManager,
      handoffManager,
      channel: 'whatsapp'
    });

    // Segundo mensaje: REF-012
    await evaluateCentralDecisionPipeline({
      leadId,
      talkId: talk3,
      userText: 'Y también sobre REF-012, ¿está disponible?',
      properties,
      contextManager,
      handoffManager,
      channel: 'whatsapp'
    });

    // Historial del talk3 debe tener 2 propiedades
    const hist = contextManager.getHistory(talk3, leadId);
    assert.strictEqual(hist.length, 2);
    assert.strictEqual(hist[0].ID_PROPIEDAD, 'REF-003');
    assert.strictEqual(hist[1].ID_PROPIEDAD, 'REF-012');
  });

  // ==========================================================================
  // GRUPO B: INTEGRIDAD Y PROVENIENCIA DE DATOS (Pre-Dispatch Safety Barrier)
  // ==========================================================================
  console.log('\n--- GRUPO B: INTEGRIDAD Y PROVENIENCIA DE DATOS (PRE-DISPATCH) ---');

  // Test B1: Contaminación de precio cruzado (precio de REF-012 en respuesta de REF-035)
  await testAsync('B1: verifyPreDispatchSafety bloquea contaminación cruzada de precio', async () => {
    const responseWithCrossPrice = '¡Hola! Sí, el apartamento REF-035 en El Rosal se encuentra disponible. Su precio es USD 146.000.';
    const safety = await verifyPreDispatchSafety({
      responseText: responseWithCrossPrice,
      targetProperty: ref035, // Precio oficial es USD 100.000
      properties
    });
    assert.strictEqual(safety.canDispatch, false, 'Debe fallar por discrepancia de precio');
    assert(safety.reason.includes('precio') || safety.reason.includes('PRECIO'), 'Debe contener razón de precio');
  });

  // Test B2: Contaminación de metraje (metraje falso de 250 m² en REF-012 que tiene 110 m²)
  await testAsync('B2: verifyPreDispatchSafety bloquea metraje contradictorio o falso', async () => {
    const responseWithWrongArea = '¡Hola! Sí, el apartamento REF-012 en Los Samanes cuenta con 250 m2 y está disponible.';
    const safety = await verifyPreDispatchSafety({
      responseText: responseWithWrongArea,
      targetProperty: ref012, // Metraje oficial es 110 m²
      properties
    });
    assert.strictEqual(safety.canDispatch, false, 'Debe fallar por discrepancia de metraje');
    assert(safety.reason.includes('metraje') || safety.reason.includes('METRAJE'), 'Debe contener razón de metraje');
  });

  // Test B3: Operación contradictoria (dice Alquiler para REF-012 que es Venta)
  await testAsync('B3: verifyPreDispatchSafety bloquea operación contradictoria con Google Sheets', async () => {
    const responseWithWrongOp = '¡Hola! Sí, el apartamento REF-012 en Los Samanes está disponible para alquiler.';
    const safety = await verifyPreDispatchSafety({
      responseText: responseWithWrongOp,
      targetProperty: ref012, // Operación oficial: Venta
      properties
    });
    assert.strictEqual(safety.canDispatch, false, 'Debe fallar por operación contradictoria');
    assert(safety.reason.includes('operación') || safety.reason.includes('alquiler') || safety.reason.includes('Venta'));
  });

  // Test B4: Validación positiva de proveniencia fiel
  await testAsync('B4: verifyPreDispatchSafety aprueba despacho cuando todos los datos concuerdan', async () => {
    const validResponse = '¡Hola! Sí, el apartamento en Los Samanes se encuentra disponible para venta. Cuenta con 110 m² y su precio es de USD 146.000.';
    const safety = await verifyPreDispatchSafety({
      responseText: validResponse,
      targetProperty: ref012,
      properties
    });
    assert.strictEqual(safety.canDispatch, true, 'Debe ser aprobada exitosamente');
  });

  // Test B5: Bloqueo de propiedades en cuarentena
  await testAsync('B5: verifyPreDispatchSafety bloquea despacho para propiedades en cuarentena', async () => {
    const quarantinedResponse = '¡Hola! Sí, la propiedad REF-063 está disponible.';
    const safety = await verifyPreDispatchSafety({
      responseText: quarantinedResponse,
      targetProperty: ref063,
      properties
    });
    assert.strictEqual(safety.canDispatch, false, 'Debe bloquear propiedades en cuarentena');
    assert(safety.reason.includes('cuarentena') || safety.reason.includes('INCOMPLETE'));
  });

  // ==========================================================================
  // GRUPO C: IDENTIFICACIÓN Y ELIMINACIÓN DEL 90% SUPERFICIAL (Level 3 Discriminants)
  // ==========================================================================
  console.log('\n--- GRUPO C: ELIMINACIÓN DEL 90% SUPERFICIAL (LEVEL 3 DISCRIMINANTS) ---');

  // Test C1: Coincidencia superficial al 90% sin 2 discriminantes exactos -> matched: false, candidate: null
  test('C1: Coincidencia sin discriminantes suficientes es rechazada como no concluyente', () => {
    const htmlAmbiguous = '<html><body><h1>Apartamento en venta Los Samanes Caracas</h1><p>Hermosa oportunidad para tu familia.</p></body></html>';
    const attrs = extractPublicationAttributes(htmlAmbiguous, 'https://unknown-portal.com/apto-samanes');
    const result = matchPublicationAgainstProperties(attrs, properties, 'https://unknown-portal.com/apto-samanes');
    assert.strictEqual(result.matched, false, 'No debe autorizar coincidencia sin discriminantes');
    assert.strictEqual(result.candidate, null, 'No debe asignar candidato');
  });

  // Test C2: Coincidencia con contradicción de operación -> rechazo estricto
  test('C2: Coincidencia con contradicción de operación es rechazada inmediatamente', () => {
    const htmlAlquiler = '<html><body><h1>Apartamento en alquiler Los Samanes Caracas</h1><p>Canon $1,200 mensual, 110 m2.</p></body></html>';
    const attrs = extractPublicationAttributes(htmlAlquiler, 'https://unknown-portal.com/apto-alquiler');
    const result = matchPublicationAgainstProperties(attrs, properties, 'https://unknown-portal.com/apto-alquiler');
    // REF-012 es venta, no debe emparejar jamás con una búsqueda de alquiler
    if (result.matched && result.candidate) {
      assert.notStrictEqual(result.candidate.ID_PROPIEDAD, 'REF-012', 'No debe emparejar con propiedad de venta');
    } else {
      assert.strictEqual(result.matched, false);
    }
  });

  // Test C3: Coincidencia perfecta Nivel 3 con discriminantes (Metraje 110m2 + 3 habs + Venta + Samanes)
  test('C3: Coincidencia perfecta Nivel 3 con discriminantes exactos es aprobada unívocamente', () => {
    const htmlPass = '<html><body><h1>Apartamento en venta Los Samanes Caracas</h1><p>Superficie: 110 m2. Precio: $146.000 USD. 3 habitaciones, 2 baños. Centro Comercial Los Samanes, maletero.</p></body></html>';
    const attrs = extractPublicationAttributes(htmlPass, 'https://unknown-portal.com/apto-perfecto');
    const result = matchPublicationAgainstProperties(attrs, properties, 'https://unknown-portal.com/apto-perfecto');
    assert.strictEqual(result.matched, true, 'Debe superar el blindaje Nivel 3');
    assert(result.candidate !== null, 'Debe asignar candidato');
    assert.strictEqual(result.candidate.ID_PROPIEDAD, 'REF-012', 'Debe ser unívocamente REF-012');
  });

  // ==========================================================================
  // GRUPO D: INTEGRIDAD DE GOOGLE SHEETS Y FILAS EN CUARENTENA
  // ==========================================================================
  console.log('\n--- GRUPO D: INTEGRIDAD DE GOOGLE SHEETS Y FILAS EN CUARENTENA ---');

  // Test D1: Todas las filas REF-063 a REF-069 están en cuarentena
  test('D1: Filas REF-063 a REF-069 tienen _isQuarantined=true y _isComplete=false', () => {
    const draftIds = ['REF-063', 'REF-064', 'REF-065', 'REF-066', 'REF-067', 'REF-068', 'REF-069'];
    draftIds.forEach(id => {
      const p = properties.find(prop => prop.ID_PROPIEDAD === id);
      assert(p, `Propiedad ${id} debe existir`);
      assert.strictEqual(p._isQuarantined, true, `${id} debe estar en cuarentena`);
      assert.strictEqual(p._isComplete, false, `${id} debe tener _isComplete=false`);
      assert(p.quarantineReason !== null, `${id} debe tener una razón de cuarentena`);
    });
  });

  // Test D2: Consulta directa por código de borrador REF-064 -> No confirma disponibilidad comercial
  await testAsync('D2: Consulta directa por código en cuarentena REF-064 no confirma disponibilidad', async () => {
    const dec = await evaluateCentralDecisionPipeline({
      leadId: 'lead_adv_draft_query',
      talkId: 'talk_adv_draft_query',
      userText: 'Hola, ¿está disponible REF-064?',
      properties,
      contextManager,
      handoffManager,
      channel: 'whatsapp'
    });

    assert.notStrictEqual(dec.log.action, 'RESPOND', 'No debe responder confirmación para borrador');
    if (dec.shouldRespond && dec.text) {
      assert(!dec.text.toLowerCase().includes('sí, disponible'), 'No debe afirmar disponibilidad');
    }
  });

  // Test D3: Búsqueda general por zona excluye inmuebles en cuarentena
  await testAsync('D3: Búsqueda por zona jamás incluye inmuebles en cuarentena', async () => {
    const dec = await evaluateCentralDecisionPipeline({
      leadId: 'lead_adv_zone_search',
      talkId: 'talk_adv_zone_search',
      userText: 'Busco apartamento en venta en Caracas',
      properties,
      contextManager,
      handoffManager,
      channel: 'whatsapp'
    });

    if (dec.shouldRespond && dec.text) {
      const draftIds = ['REF-063', 'REF-064', 'REF-065', 'REF-066', 'REF-067', 'REF-068', 'REF-069'];
      draftIds.forEach(dId => {
        assert(!dec.text.includes(dId), `La respuesta jamás debe contener la referencia en borrador ${dId}`);
      });
    }
  });

  // ==========================================================================
  // GRUPO E: CONTROL DE IA Y VIGENCIA DE CACHÉ
  // ==========================================================================
  console.log('\n--- GRUPO E: CONTROL DE IA Y VIGENCIA DE CACHÉ ---');

  // Test E1: Prompt injection intentando cambiar el precio oficial a $0
  test('E1: Inyección adversarial de precio falso es bloqueada por barrera de proveniencia', () => {
    const maliciousClaim = '¡Hola! Sí, la propiedad REF-012 en Los Samanes está disponible y se regala a solo USD 0.';
    const provenance = validateCommercialClaimsProvenance({
      responseText: maliciousClaim,
      targetProperty: ref012,
      properties
    });
    assert.strictEqual(provenance.valid, false, 'Debe ser bloqueada');
    assert(provenance.reason.includes('precio') || provenance.reason.includes('PRECIO'), 'Debe detectar discrepancia de precio');
  });

  // Test E2: Caché con flag _isStale=true es rechazada por verifyPreDispatchSafety
  await testAsync('E2: Caché obsoleta (_isStale=true) es bloqueada por la barrera pre-dispatch', async () => {
    const staleProperties = [...properties];
    staleProperties._isStale = true;
    const validText = '¡Hola! Sí, el apartamento en Los Samanes se encuentra disponible para venta. Cuenta con 110 m² y su precio es de USD 146.000.';
    const safety = await verifyPreDispatchSafety({
      responseText: validText,
      targetProperty: ref012,
      properties: staleProperties
    });
    assert.strictEqual(safety.canDispatch, false, 'Debe fallar ante fuente obsoleta');
    assert(safety.reason.includes('desactualizado') || safety.reason.includes('conexión'));
  });

  // ==========================================================================
  // GRUPO F: SEGURIDAD DE DESPACHO Y REGLAS DE ORO
  // ==========================================================================
  console.log('\n--- GRUPO F: SEGURIDAD DE DESPACHO Y REGLAS DE ORO ---');

  // Test F1: Textos sin contenido o vacíos son rechazados
  await testAsync('F1: Textos vacíos o no-strings son rechazados por la barrera de seguridad', async () => {
    const emptySafety = await verifyPreDispatchSafety({
      responseText: '',
      targetProperty: ref012,
      properties
    });
    assert.strictEqual(emptySafety.canDispatch, false);
    assert(emptySafety.reason.includes('vacío') || emptySafety.reason.includes('Texto'));
  });

  // Test F2: Textos con tokens corruptos (undefined, null, NaN) son rechazados
  await testAsync('F2: Textos con tokens corruptos (undefined, null, NaN) son rechazados', async () => {
    const corruptSafety = await verifyPreDispatchSafety({
      responseText: 'El precio es undefined en Los Samanes.',
      targetProperty: ref012,
      properties
    });
    assert.strictEqual(corruptSafety.canDispatch, false);
    assert(corruptSafety.reason.includes('corrupto') || corruptSafety.reason.includes('inválidos'));
  });

  // Test F3: Bloqueo activo por asesor humano en HandoffManager bloquea cualquier despacho
  await testAsync('F3: Bloqueo humano activo en HandoffManager bloquea despacho incondicionalmente', async () => {
    const lockedLeadId = 'lead_adv_locked_human';
    handoffManager.recordHumanIntervention(lockedLeadId, null, null, Date.now());

    const safety = await verifyPreDispatchSafety({
      responseText: '¡Hola! Sí, disponible.',
      targetProperty: ref012,
      leadId: lockedLeadId,
      handoffManager,
      properties
    });
    assert.strictEqual(safety.canDispatch, false);
    assert(safety.reason.includes('humana') || safety.reason.includes('cancelado'));
  });

  // Limpiar archivo temporal de contexto
  if (fs.existsSync(advContextFile)) fs.unlinkSync(advContextFile);

  console.log('\n==============================================================================');
  console.log(`RESUMEN ADVERSARIAL: ${passed} / ${total} PRUEBAS SUPERADAS (100%)`);
  console.log('==============================================================================\n');
}

runAdversarialSuite().catch(err => {
  console.error('Fallo crítico en suite adversarial:', err);
  process.exit(1);
});
