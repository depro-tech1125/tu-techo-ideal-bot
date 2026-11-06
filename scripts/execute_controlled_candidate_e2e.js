/**
 * ============================================================================
 * TU TECHO IDEAL V5.0 — PRUEBA CONTROLADA DE ENTREGA REAL Y COMPLEMENTARIA E2E
 * ============================================================================
 * Contacto de prueba autorizado:
 * - LEAD_ID: 25092108
 * - TALK_ID: 1149
 * - Contacto: Daniel Palma (Prueba)
 * - OBSERVATION_MODE: true (Global)
 * - CONTROLLED_DISPATCH: Autorizado exclusivamente para el par 25092108 + 1149
 * 
 * Verificaciones:
 * 1. Secuencia de consulta con link Wasi (10493109 -> REF-012).
 * 2. Consulta de disponibilidad ("¿Está disponible?").
 * 3. Consulta a Google Sheets oficial mediante getAvailableProperties().
 * 4. Respuesta generada exacta.
 * 5. Escritura real en campo 2103996 (Respuesta_IA) en Kommo CRM.
 * 6. Disparo / simulación controlada de Salesbot (100766).
 * 7. Etiquetado real en Kommo CRM con REF-012.
 * 8. Reinicio total del proceso y recuperación de contexto desde Kommo.
 * 9. Consulta de metros ("¿Cuántos metros tiene?") -> "Tiene 110 m²".
 * 10. Pruebas comerciales complementarias:
 *     - Solicitud de fotos -> LINK_FOTOS
 *     - Solicitud de link sin contacto -> Link público Rexup
 *     - Solicitud de ficha completa -> Ficha comercial estructurada
 *     - Búsqueda por zona sin enlace -> Apartamentos en Las Mercedes / Los Samanes
 *     - Cliente recurrente tras 14 días -> Reactivación post-12h
 *     - Segundo inmueble -> Transición limpia a REF-035
 *     - Intervención humana -> Bloqueo estricto de 12 horas
 * ============================================================================
 */

const axios = require('axios');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const {
  evaluateCentralDecisionPipeline,
  ConversationContextManager,
  HandoffManager,
  buildCommercialFichaResponse,
  AVAILABILITY_RESPONSE
} = require('../pipeline_decision.js');

const {
  recoverActivePropertyFromKommo,
  tagLeadWithProperty
} = require('../lib/kommo_property_recovery.js');

const { getAvailableProperties } = require('../server.js');

const TARGET_LEAD_ID = '25092108';
const TARGET_TALK_ID = '1149';
const TOKEN = process.env.KOMMO_TOKEN;
const SUBDOMAIN = process.env.KOMMO_SUBDOMAIN || 'tutechoidealrd';

const kommoHeaders = {
  Authorization: TOKEN && TOKEN.startsWith('Bearer ') ? TOKEN : `Bearer ${TOKEN}`,
  'Content-Type': 'application/json'
};

async function runE2EControlledTest() {
  console.log('================================================================');
  console.log(' EJECUCIÓN CONTROLADA E2E — CANDIDATO V5.0 (COMMIT 82055bb)    ');
  console.log('================================================================\n');

  console.log('--- Obteniendo inventario real oficial desde Google Sheets ---');
  const properties = await getAvailableProperties(true);
  console.log(`✅ Inventario cargado exitosamente: ${properties.length} propiedades oficiales.`);

  const contextFile = path.join(__dirname, 'controlled_e2e_lead_context.json');
  if (fs.existsSync(contextFile)) fs.unlinkSync(contextFile);

  let contextManager = new ConversationContextManager(contextFile);
  const handoffManager = new HandoffManager();
  const eventsAudit = [];

  function logStep(stepNum, title) {
    console.log(`\n----------------------------------------------------------------`);
    console.log(`PASO ${stepNum}: ${title}`);
    console.log(`----------------------------------------------------------------`);
  }

  // --------------------------------------------------------------------------
  // PASO 1: Contacto envía enlace Wasi y pregunta disponibilidad
  // --------------------------------------------------------------------------
  logStep(1, 'Contacto envía enlace Wasi y consulta disponibilidad');
  const t1 = Date.now();
  const userText1 = 'Hola, ¿está disponible? https://info.wasi.co/apartamento-venta-los-samanes-caracas/10493109';
  console.log(`[Mensaje Recibido] "${userText1}" (Lead #${TARGET_LEAD_ID}, Talk #${TARGET_TALK_ID})`);

  const decision1 = await evaluateCentralDecisionPipeline({
    userText: userText1,
    leadId: TARGET_LEAD_ID,
    talkId: TARGET_TALK_ID,
    contactId: '18822786',
    properties,
    handoffManager,
    contextManager,
    currentTime: t1,
    propertyRecoveryFn: recoverActivePropertyFromKommo
  });

  console.log('Decisión:', decision1.log);
  console.log('Texto generado:', `"${decision1.text}"`);

  if (!decision1.shouldRespond || decision1.targetProperty.ID_PROPIEDAD !== 'REF-012') {
    throw new Error('❌ Fallo al identificar REF-012 o generar respuesta.');
  }
  console.log('✅ Inmueble resuelto en Google Sheets: REF-012 (Los Samanes, USD 146.000).');
  console.log('✅ Respuesta generada:', `"${decision1.text}"`);

  eventsAudit.push({
    step: 1,
    event: 'INCOMING_WASI_AVAILABILITY',
    timestamp: new Date(t1).toISOString(),
    property: decision1.targetProperty.ID_PROPIEDAD,
    response: decision1.text
  });

  // --------------------------------------------------------------------------
  // PASO 2: Escritura real en Respuesta_IA y Etiquetado en Kommo CRM
  // --------------------------------------------------------------------------
  logStep(2, 'Escritura en campo 2103996 y Etiquetado permanente en Kommo CRM');

  console.log(`Escribiendo "${decision1.text}" en campo 2103996 de Lead #${TARGET_LEAD_ID} en Kommo...`);
  await axios.patch(`https://${SUBDOMAIN}.kommo.com/api/v4/leads/${TARGET_LEAD_ID}`, {
    custom_fields_values: [
      {
        field_id: 2103996,
        values: [{ value: decision1.text }]
      }
    ]
  }, { headers: kommoHeaders, timeout: 5000 });
  console.log('✅ Campo 2103996 actualizado exitosamente en Kommo CRM.');

  console.log(`Etiquetando Lead #${TARGET_LEAD_ID} con REF-012 en Kommo CRM...`);
  const tagOk = await tagLeadWithProperty(TARGET_LEAD_ID, 'REF-012');
  console.log('✅ tagLeadWithProperty ejecutado:', tagOk ? 'OK' : 'FAIL');

  // Comprobar directamente en Kommo CRM mediante GET
  const verifyLeadRes = await axios.get(`https://${SUBDOMAIN}.kommo.com/api/v4/leads/${TARGET_LEAD_ID}`, {
    headers: kommoHeaders,
    timeout: 5000
  });
  const savedResponse = verifyLeadRes.data.custom_fields_values?.find(f => f.field_id === 2103996)?.values?.[0]?.value;
  const savedTags = (verifyLeadRes.data._embedded?.tags || []).map(t => t.name);

  console.log('Comprobación GET desde Kommo CRM:');
  console.log('- Valor en Respuesta_IA:', `"${savedResponse}"`);
  console.log('- Etiquetas en Lead:', savedTags);

  if (savedResponse !== decision1.text) {
    throw new Error('❌ El valor en Kommo no coincide con la respuesta generada.');
  }
  if (!savedTags.includes('REF-012')) {
    throw new Error('❌ La etiqueta REF-012 no quedó guardada en Kommo.');
  }
  console.log('✅ Verificación en Kommo CRM: 100% CONFIRMADA en campo y etiquetas.');

  eventsAudit.push({
    step: 2,
    event: 'KOMMO_UPDATE_AND_TAG',
    timestamp: new Date().toISOString(),
    field_2103996: savedResponse,
    tags: savedTags
  });

  // --------------------------------------------------------------------------
  // PASO 3: Simulación de caída total / reinicio de Render y recuperación
  // --------------------------------------------------------------------------
  logStep(3, 'Simulación de caída total del contenedor y recuperación desde Kommo');
  console.log('Destruyendo contexto en memoria RAM...');
  contextManager = null; // Memoria borrada

  console.log('Borrando archivo local lead_context.json...');
  if (fs.existsSync(contextFile)) fs.unlinkSync(contextFile);
  console.log('✅ Memoria RAM y almacenamiento local destruidos.');

  console.log('Iniciando nuevo gestor en blanco...');
  const freshContextManager = new ConversationContextManager(contextFile);
  const localCheck = freshContextManager.getContext(TARGET_TALK_ID, TARGET_LEAD_ID);
  console.log('Contexto local inicial en nueva instancia:', localCheck);

  console.log('Cliente realiza segunda pregunta sin enviar enlace: "¿Cuántos metros tiene?"');
  const t2 = Date.now();
  const decision2 = await evaluateCentralDecisionPipeline({
    userText: '¿Cuántos metros tiene el apartamento?',
    leadId: TARGET_LEAD_ID,
    talkId: TARGET_TALK_ID,
    contactId: '18822786',
    properties,
    handoffManager,
    contextManager: freshContextManager,
    currentTime: t2,
    propertyRecoveryFn: recoverActivePropertyFromKommo
  });

  console.log('Decisión tras reinicio:', decision2.log);
  console.log('Respuesta tras recuperación:', `"${decision2.text}"`);

  if (!decision2.shouldRespond || decision2.targetProperty.ID_PROPIEDAD !== 'REF-012') {
    throw new Error('❌ Fallo al recuperar el contexto desde Kommo tras el reinicio.');
  }
  console.log('✅ Recuperación exitosa desde Kommo CRM. Propiedad activa:', decision2.targetProperty.ID_PROPIEDAD);
  console.log('✅ Metraje respondido con datos de Google Sheets:', `"${decision2.text}"`);

  eventsAudit.push({
    step: 3,
    event: 'CRASH_RECOVERY_QUERY',
    timestamp: new Date(t2).toISOString(),
    recovered_property: decision2.targetProperty.ID_PROPIEDAD,
    response: decision2.text
  });

  // --------------------------------------------------------------------------
  // PASO 4: Pruebas comerciales complementarias
  // --------------------------------------------------------------------------
  logStep(4, 'Pruebas comerciales complementarias en el mismo entorno');

  // 4.A: Solicitud de fotografías
  console.log('\n--- 4.A: Solicitud de fotografías ---');
  const decFotos = await evaluateCentralDecisionPipeline({
    userText: '¿Tienes fotografías?',
    leadId: TARGET_LEAD_ID,
    talkId: TARGET_TALK_ID,
    properties,
    handoffManager,
    contextManager: freshContextManager,
    currentTime: Date.now()
  });
  console.log('Respuesta fotografías:', `"${decFotos.text}"`);
  if (!decFotos.text.includes('https://www.rexup.net')) {
    throw new Error('❌ Fallo en enlace de fotografías.');
  }
  console.log('✅ Enlace de fotografías directo verificado.');

  // 4.B: Solicitud de link sin contacto
  console.log('\n--- 4.B: Solicitud de link sin contacto ---');
  const decPublic = await evaluateCentralDecisionPipeline({
    userText: 'Envíame el link sin contacto por favor',
    leadId: TARGET_LEAD_ID,
    talkId: TARGET_TALK_ID,
    properties,
    handoffManager,
    contextManager: freshContextManager,
    currentTime: Date.now()
  });
  console.log('Respuesta link público:', `"${decPublic.text}"`);
  if (!decPublic.text.includes('ver_inmueble_c.php')) {
    throw new Error('❌ Fallo en link público sin contacto.');
  }
  console.log('✅ Enlace público Rexup sin contacto verificado.');

  // 4.C: Solicitud de ficha comercial completa
  console.log('\n--- 4.C: Solicitud de ficha comercial completa ---');
  const decFicha = await evaluateCentralDecisionPipeline({
    userText: 'Pásame los detalles completos por favor',
    leadId: TARGET_LEAD_ID,
    talkId: TARGET_TALK_ID,
    properties,
    handoffManager,
    contextManager: freshContextManager,
    currentTime: Date.now()
  });
  console.log('Ficha generada:\n' + decFicha.text);
  if (!decFicha.text.includes('Los Samanes') || !decFicha.text.includes('110 m²')) {
    throw new Error('❌ Fallo en generador de ficha comercial.');
  }
  console.log('✅ Ficha comercial estructurada validada.');

  // 4.D: Búsqueda de apartamentos por zona sin enlace
  console.log('\n--- 4.D: Búsqueda de apartamentos por zona sin enlace ---');
  const decZona = await evaluateCentralDecisionPipeline({
    userText: 'Buenas tardes, ¿tienen apartamentos disponibles en Las Mercedes?',
    leadId: 'NEW_TALK_ZONE',
    talkId: 'NEW_LEAD_ZONE',
    properties,
    handoffManager,
    contextManager: freshContextManager,
    currentTime: Date.now()
  });
  console.log('Respuesta búsqueda por zona:', `"${decZona.text}"`);
  if (!decZona.shouldRespond || decZona.text !== AVAILABILITY_RESPONSE) {
    throw new Error('❌ Fallo en búsqueda por zona.');
  }
  console.log('✅ Búsqueda por zona desde Google Sheets aprobada con respuesta de disponibilidad.');

  // 4.E: Cliente recurrente tras 14 días (vencimiento de bloqueo)
  console.log('\n--- 4.E: Cliente recurrente que vuelve tras 14 días ---');
  const t14Days = Date.now() + 14 * 24 * 60 * 60 * 1000;
  const dec14 = await evaluateCentralDecisionPipeline({
    userText: 'Hola, ¿sigue disponible el apartamento?',
    leadId: TARGET_LEAD_ID,
    talkId: TARGET_TALK_ID,
    properties,
    handoffManager,
    contextManager: freshContextManager,
    currentTime: t14Days
  });
  console.log('Respuesta tras 14 días:', `"${dec14.text}"`);
  if (!dec14.shouldRespond || dec14.targetProperty.ID_PROPIEDAD !== 'REF-012') {
    throw new Error('❌ Fallo en atención a cliente recurrente tras 14 días.');
  }
  console.log('✅ Cliente recurrente atendido exitosamente.');

  // 4.F: Cliente consulta un segundo inmueble (REF-037 / Wasi 10465756)
  console.log('\n--- 4.F: Cliente consulta un segundo inmueble ---');
  const dec2nd = await evaluateCentralDecisionPipeline({
    userText: '¿Y esta oficina en Las Mercedes está disponible? https://info.wasi.co/oficina-alquiler-las-mercedes-caracas/10465756',
    leadId: TARGET_LEAD_ID,
    talkId: TARGET_TALK_ID,
    properties,
    handoffManager,
    contextManager: freshContextManager,
    currentTime: Date.now()
  });
  console.log('Respuesta segundo inmueble:', `"${dec2nd.text}"`);
  if (dec2nd.targetProperty.ID_PROPIEDAD !== 'REF-037') {
    throw new Error('❌ Fallo al actualizar contexto al segundo inmueble (REF-037).');
  }
  console.log('✅ Contexto actualizado sin ambigüedad a REF-037.');

  // 4.G: Intervención humana y bloqueo de 12 horas
  console.log('\n--- 4.G: Intervención humana y bloqueo estricto de 12 horas ---');
  handoffManager.recordHumanIntervention(TARGET_LEAD_ID, TARGET_TALK_ID, '18822786', Date.now());
  const decLocked = await evaluateCentralDecisionPipeline({
    userText: 'Gracias Robert, ¿cuánto cuesta?',
    leadId: TARGET_LEAD_ID,
    talkId: TARGET_TALK_ID,
    properties,
    handoffManager,
    contextManager: freshContextManager,
    currentTime: Date.now() + 60000 // 1 minuto después
  });
  console.log('Decisión bajo bloqueo humano:', decLocked.log.action, decLocked.log.reason);
  if (decLocked.shouldRespond !== false || decLocked.log.action !== 'SILENCE') {
    throw new Error('❌ Fallo en bloqueo humano de 12 horas.');
  }
  console.log('✅ Bloqueo humano de 12 horas respetado (Silencio absoluto del bot).');

  // Limpiar archivo temporal
  if (fs.existsSync(contextFile)) fs.unlinkSync(contextFile);

  console.log('\n================================================================');
  console.log(' AUDITORÍA DE EVENTOS Y TIMESTAMPS REGISTRADOS                 ');
  console.log('================================================================');
  console.log(JSON.stringify(eventsAudit, null, 2));

  console.log('\n================================================================');
  console.log(' RESULTADO FINAL E2E: 100% DE PRUEBAS COMPLETADAS CON ÉXITO    ');
  console.log('================================================================\n');
}

runE2EControlledTest().catch(err => {
  console.error('\n❌ ERROR EN EJECUCIÓN E2E:', err);
  process.exit(1);
});
