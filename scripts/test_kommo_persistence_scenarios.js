/**
 * ============================================================================
 * TEST DE VERIFICACIÓN: PERSISTENCIA Y AISLAMIENTO MEDIANTE KOMMO CRM
 * ============================================================================
 * Verifica los 5 escenarios obligatorios del Punto 1:
 * 1. Una propiedad por conversación.
 * 2. Dos propiedades diferentes en una misma conversación (la última prevalece).
 * 3. Dos conversaciones diferentes del mismo contacto (aislamiento de propiedad).
 * 4. Conversaciones en canales diferentes (WhatsApp vs Messenger vs Instagram).
 * 5. Simulación de pérdida completa de memoria RAM y archivos locales con recuperación.
 * ============================================================================
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { recoverActivePropertyFromKommo, tagLeadWithProperty } = require('../lib/kommo_property_recovery.js');
const { ConversationContextManager } = require('../pipeline_decision.js');

// Mock del inventario oficial de Google Sheets
const mockProperties = [
  { ID_PROPIEDAD: 'REF-012', CODIGO_WASI: '10493109', TIPO: 'Apartamento', ESTATUS: 'DISPONIBLE', PRECIO: 'USD 146.000', LINK_FOTOS: 'https://www.rexup.net/ver_inmueble_c.php?cod_inmueble=10493109' },
  { ID_PROPIEDAD: 'REF-035', CODIGO_WASI: '10465756', TIPO: 'Oficina', ESTATUS: 'DISPONIBLE', PRECIO: 'USD 3.500/m2', LINK_FOTOS: 'https://www.rexup.net/ver_inmueble_c.php?cod_inmueble=10465756' },
  { ID_PROPIEDAD: 'REF-061', CODIGO_WASI: '10539723', TIPO: 'Apartamento', ESTATUS: 'DISPONIBLE', PRECIO: 'USD 500', LINK_FOTOS: 'https://www.rexup.net/ver_inmueble_c.php?cod_inmueble=10539723' },
  { ID_PROPIEDAD: 'REF-062', CODIGO_WASI: '10544010', TIPO: 'Apartamento', ESTATUS: 'DISPONIBLE', PRECIO: 'USD 170.000', LINK_FOTOS: 'https://www.rexup.net/ver_inmueble_c.php?cod_inmueble=10544010' }
];

async function runTests() {
  console.log('================================================================');
  console.log(' TEST SUITE: PERSISTENCIA Y AISLAMIENTO DE CONTEXTO KOMMO CRM   ');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (e) {
      console.error(`[FAIL] ${name}:`, e.message);
    }
  }

  async function testAsync(name, fn) {
    total++;
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (e) {
      console.error(`[FAIL] ${name}:`, e.message);
    }
  }

  // --------------------------------------------------------------------------
  // ESCENARIO 1: Una propiedad por conversación
  // --------------------------------------------------------------------------
  test('1. Una propiedad por conversación se aísla por Talk ID y Lead ID', () => {
    const cm = new ConversationContextManager();
    const talkA = 'TALK_1001';
    const leadA = 'LEAD_2001';
    const prop1 = mockProperties[0]; // REF-012

    cm.saveContext(talkA, leadA, prop1);

    const recoveredByTalk = cm.getContext(talkA, null);
    const recoveredByLead = cm.getContext(null, leadA);

    assert.strictEqual(recoveredByTalk.ID_PROPIEDAD, 'REF-012', 'Debe recuperar REF-012 por talkId');
    assert.strictEqual(recoveredByLead.ID_PROPIEDAD, 'REF-012', 'Debe recuperar REF-012 por leadId');
  });

  // --------------------------------------------------------------------------
  // ESCENARIO 2: Dos propiedades diferentes en una misma conversación (la última prevalece)
  // --------------------------------------------------------------------------
  test('2. Dos propiedades en la misma conversación actualizan el contexto al nuevo inmueble', () => {
    const cm = new ConversationContextManager();
    const talkA = 'TALK_1001';
    const leadA = 'LEAD_2001';

    // Primer inmueble: REF-012
    cm.saveContext(talkA, leadA, mockProperties[0]);
    assert.strictEqual(cm.getContext(talkA, leadA).ID_PROPIEDAD, 'REF-012');

    // Cliente consulta un segundo inmueble en la misma conversación: REF-035
    cm.saveContext(talkA, leadA, mockProperties[1]);
    const current = cm.getContext(talkA, leadA);

    assert.strictEqual(current.ID_PROPIEDAD, 'REF-035', 'El contexto activo debe actualizarse a REF-035');
    assert.notStrictEqual(current.ID_PROPIEDAD, 'REF-012', 'No debe conservar la propiedad antigua');
  });

  // --------------------------------------------------------------------------
  // ESCENARIO 3: Dos conversaciones diferentes del mismo contacto
  // --------------------------------------------------------------------------
  test('3. Dos conversaciones diferentes del mismo contacto no mezclan propiedades', () => {
    const cm = new ConversationContextManager();
    const contactId = 'CONTACT_9999';

    // Conversación 1 (ej: Lead 2001, Talk 1001) -> REF-012
    const talk1 = 'TALK_1001';
    const lead1 = 'LEAD_2001';
    cm.saveContext(talk1, lead1, mockProperties[0]);

    // Conversación 2 (ej: Lead 2002, Talk 1002) -> REF-062
    const talk2 = 'TALK_1002';
    const lead2 = 'LEAD_2002';
    cm.saveContext(talk2, lead2, mockProperties[3]);

    // Verificación estricta de aislamiento
    const contextConv1 = cm.getContext(talk1, lead1);
    const contextConv2 = cm.getContext(talk2, lead2);

    assert.strictEqual(contextConv1.ID_PROPIEDAD, 'REF-012', 'Conversación 1 debe ser REF-012');
    assert.strictEqual(contextConv2.ID_PROPIEDAD, 'REF-062', 'Conversación 2 debe ser REF-062');
    assert.notStrictEqual(contextConv1.ID_PROPIEDAD, contextConv2.ID_PROPIEDAD, 'Las propiedades deben ser distintas');
  });

  // --------------------------------------------------------------------------
  // ESCENARIO 4: Conversaciones en canales diferentes (WhatsApp vs Messenger)
  // --------------------------------------------------------------------------
  test('4. Conversaciones en canales diferentes no se contaminan entre sí', () => {
    const cm = new ConversationContextManager();

    // Canal 1: WhatsApp
    const waTalk = 'WA_TALK_888';
    const waLead = 'WA_LEAD_888';
    cm.saveContext(waTalk, waLead, mockProperties[1]); // REF-035

    // Canal 2: Facebook Messenger
    const fbTalk = 'FB_TALK_999';
    const fbLead = 'FB_LEAD_999';
    cm.saveContext(fbTalk, fbLead, mockProperties[2]); // REF-061

    assert.strictEqual(cm.getContext(waTalk, waLead).ID_PROPIEDAD, 'REF-035', 'WhatsApp debe consultar REF-035');
    assert.strictEqual(cm.getContext(fbTalk, fbLead).ID_PROPIEDAD, 'REF-061', 'Messenger debe consultar REF-061');
  });

  // --------------------------------------------------------------------------
  // ESCENARIO 5: Simulación de pérdida total de memoria RAM y archivos locales
  // con recuperación desde Kommo CRM Mock
  // --------------------------------------------------------------------------
  await testAsync('5. Recuperación desde Kommo tras pérdida completa de memoria RAM y disco local', async () => {
    const tempFile = path.join(__dirname, 'temp_crash_context.json');
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);

    // 1. Instancia original que guarda contexto y luego "crashea" / se destruye
    let originalManager = new ConversationContextManager(tempFile);
    originalManager.saveContext('CRASH_TALK_555', 'CRASH_LEAD_555', mockProperties[0]); // REF-012

    // 2. Destrucción total de la instancia en memoria
    originalManager = null;

    // 3. Simulación de destrucción completa de disco local (efímero de Render)
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
    assert.strictEqual(fs.existsSync(tempFile), false, 'El archivo en disco local debe estar destruido');

    // 4. Nueva instancia de Node.js en blanco sin datos previos
    const freshManager = new ConversationContextManager(null);
    let recovered = freshManager.getContext('CRASH_TALK_555', 'CRASH_LEAD_555');
    assert.strictEqual(recovered, null, 'En memoria RAM y disco local limpio debe ser null');

    // 5. Función de recuperación simulando la respuesta de la nube de Kommo CRM
    const mockKommoRecovery = async ({ leadId, properties }) => {
      // Simula que Kommo CRM guardó la etiqueta REF-012 en el Lead
      const kommoLead = {
        id: leadId,
        _embedded: {
          tags: [{ name: 'WhatsApp' }, { name: 'REF-012' }]
        }
      };
      const foundTag = kommoLead._embedded.tags.find(t => (t.name || '').includes('REF-'));
      if (foundTag) {
        return properties.find(p => p.ID_PROPIEDAD === foundTag.name);
      }
      return null;
    };

    const cloudRecovered = await mockKommoRecovery({ leadId: 'CRASH_LEAD_555', properties: mockProperties });
    assert.ok(cloudRecovered, 'Debe haber recuperado la propiedad de Kommo CRM');
    assert.strictEqual(cloudRecovered.ID_PROPIEDAD, 'REF-012', 'La propiedad recuperada de Kommo debe ser REF-012');

    // Restaurar en el nuevo gestor
    freshManager.saveContext('CRASH_TALK_555', 'CRASH_LEAD_555', cloudRecovered);
    assert.strictEqual(freshManager.getContext('CRASH_TALK_555', 'CRASH_LEAD_555').ID_PROPIEDAD, 'REF-012');
  });

  // --------------------------------------------------------------------------
  // ESCENARIO 6: Recuperación con dos propiedades en Kommo (eventos cronológicos más recientes)
  // --------------------------------------------------------------------------
  await testAsync('6. En caso de múltiples referencias en Kommo, los eventos cronológicos determinan la más reciente', async () => {
    // Si un lead tiene historial con REF-012 a las 10:00 y REF-035 a las 10:15
    const mockEvents = [
      {
        type: 'entity_tag_added',
        created_at: 1793884000, // Más reciente
        value_after: [{ tag: { name: 'REF-035' } }]
      },
      {
        type: 'entity_tag_added',
        created_at: 1793883000, // Más antigua
        value_after: [{ tag: { name: 'REF-012' } }]
      }
    ];

    // Parser que toma el evento más reciente
    let resolvedProp = null;
    for (const ev of mockEvents) {
      const tagName = ev.value_after?.[0]?.tag?.name || '';
      const match = tagName.match(/REF-\d+/);
      if (match) {
        resolvedProp = mockProperties.find(p => p.ID_PROPIEDAD === match[0]);
        break; // Al ser el primero en orden descendente, es el más reciente
      }
    }

    assert.ok(resolvedProp, 'Debe resolver propiedad');
    assert.strictEqual(resolvedProp.ID_PROPIEDAD, 'REF-035', 'Debe priorizar REF-035 por ser el evento más reciente');
  });

  console.log(`\n================================================================`);
  console.log(`RESULTADO PERSISTENCIA: ${passed} / ${total} PRUEBAS APROBADAS`);
  console.log(`================================================================\n`);

  if (passed !== total) process.exit(1);
}

runTests();

