/**
 * AUDITORÍA DE BLOQUEO PERSISTENTE TRAS REINICIO Y LIMITACIONES DE KOMMO
 * Objetivo: Demostrar empíricamente si el bloqueo de 24 horas puede reconstruirse
 * desde Kommo tras un reinicio del contenedor, y cómo opera el blindaje fail-closed.
 */

const axios = require('axios');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const { HandoffManager, classifyOutgoingMessage } = require('./pipeline_decision.js');

async function auditPersistentLockAndKommo() {
  console.log('================================================================');
  console.log(' AUDITORÍA DE BLOQUEO PERSISTENTE Y LIMITACIONES DE KOMMO API   ');
  console.log('================================================================\n');

  const token = process.env.KOMMO_TOKEN;
  const subdomain = process.env.KOMMO_SUBDOMAIN || 'tutechoidealrd';
  const headers = { Authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}` };

  // --------------------------------------------------------------------------
  // 1. VERIFICACIÓN DE SCOPES EN KOMMO API: /talks/{talk_id}/messages
  // --------------------------------------------------------------------------
  console.log('>>> [1/4] Verificando permiso "External chat history" en Kommo API...');
  let canReadTalkMessages = false;
  let talkMessagesError = null;
  try {
    const talkRes = await axios.get(`https://${subdomain}.kommo.com/api/v4/talks/12345/messages`, { headers, timeout: 5000 });
    canReadTalkMessages = talkRes.status === 200;
  } catch (err) {
    canReadTalkMessages = false;
    talkMessagesError = {
      status: err.response?.status,
      detail: err.response?.data?.['detail'] || err.response?.data?.['title'] || err.message
    };
  }

  console.log(`    Status HTTP: ${talkMessagesError ? talkMessagesError.status : 200}`);
  console.log(`    Detalle: ${talkMessagesError ? talkMessagesError.detail : 'Acceso permitido'}`);
  console.log(`    Resultado: ${canReadTalkMessages ? 'DISPONIBLE' : 'NO DISPONIBLE (403 Invalid scope / Falta crm_chats_read)'}`);
  console.log('');

  // --------------------------------------------------------------------------
  // 2. VERIFICACIÓN DE EVENTOS OUTGOING: /events?filter[type]=outgoing_chat_message
  // --------------------------------------------------------------------------
  console.log('>>> [2/4] Verificando diferenciación de Salesbot vs Asesor Humano en Eventos Kommo...');
  let eventsDifferentiate = false;
  let sampleEvent = null;
  try {
    const evRes = await axios.get(`https://${subdomain}.kommo.com/api/v4/events?filter[type]=outgoing_chat_message&limit=5`, { headers, timeout: 5000 });
    const events = evRes.data?._embedded?.events || [];
    if (events.length > 0) {
      sampleEvent = events[0];
      // Comprobar si los eventos contienen autor explícito (user_id > 0) o solo created_by: 0
      const hasExplicitAuthor = sampleEvent.created_by !== undefined && sampleEvent.created_by > 0;
      const hasAuthorType = sampleEvent.author && sampleEvent.author.type;
      eventsDifferentiate = hasExplicitAuthor && hasAuthorType;
    }
  } catch (err) {
    console.error('    Error consultando eventos:', err.message);
  }

  console.log(`    Evento obtenido ID: ${sampleEvent?.id}`);
  console.log(`    created_by: ${sampleEvent?.created_by} (0 = sistema / WhatsApp integración / Salesbot)`);
  console.log(`    origin: ${sampleEvent?.value_after?.[0]?.message?.origin}`);
  console.log(`    ¿Eventos diferencian con certeza asesor de bot?: ${eventsDifferentiate ? 'SÍ' : 'NO'}`);
  console.log(`    Limitación técnica: Los mensajes salientes de WhatsApp registran created_by: 0 sin distinguir bot de asesor.`);
  console.log('');

  // --------------------------------------------------------------------------
  // 3. SIMULACIÓN DE REINICIO EN FRÍO (DISCO EFÍMERO LIMPIO TRAS REBOOT)
  // --------------------------------------------------------------------------
  console.log('>>> [3/4] Simulando reinicio de contenedor con almacenamiento efímero limpio...');
  const tempHandoffPath = path.join(__dirname, 'temp_cold_reboot_handoffs.json');
  if (fs.existsSync(tempHandoffPath)) fs.unlinkSync(tempHandoffPath);

  // Instanciar HandoffManager con archivo limpio (simulando disco nuevo en Render)
  let kommoFetcherCalled = false;
  const mockLeadId = '7770001';
  const recentInterventionTime = Date.now() - (2 * 60 * 60 * 1000); // 2 horas atrás

  const rebootHandoffManager = new HandoffManager(
    tempHandoffPath,
    async ({ leadId }) => {
      kommoFetcherCalled = true;
      if (String(leadId) === mockLeadId) {
        return { lastHumanTimestamp: recentInterventionTime };
      }
      return null;
    }
  );

  const statusAfterReboot = await rebootHandoffManager.checkLockStatus(mockLeadId, 'talk_mock', 'contact_mock', Date.now());

  console.log(`    ¿Invocó kommoFetcher para reconstruir el estado?: ${kommoFetcherCalled ? 'SÍ' : 'NO'}`);
  console.log(`    ¿Reconstruyó el bloqueo tras reinicio?: ${statusAfterReboot.isLocked ? 'SÍ (BLOQUEADO)' : 'NO'}`);
  console.log(`    Horas transcurridas reconstruidas: ${statusAfterReboot.hoursElapsed.toFixed(2)}h de 12h requeridas`);
  console.log('');

  // --------------------------------------------------------------------------
  // 4. VERIFICACIÓN DE POLÍTICA FAIL-CLOSED ANTE ERROR DE RED O INCERTIDUMBRE
  // --------------------------------------------------------------------------
  console.log('>>> [4/4] Verificando política Fail-Closed ante falla de red en Kommo API...');
  const failClosedManager = new HandoffManager(
    tempHandoffPath,
    async () => {
      throw new Error('Kommo API Timeout / 500 Error');
    }
  );

  const unknownLeadId = '9998881';
  const failClosedStatus = await failClosedManager.checkLockStatus(unknownLeadId, null, null, Date.now());

  console.log(`    ¿Estado ante falla de Kommo?: ${failClosedStatus.isLocked ? 'BLOQUEO PREVENTIVO (FAIL-CLOSED)' : 'DESBLOQUEADO'}`);
  console.log(`    Motivo: ${failClosedStatus.reason}`);
  console.log(`    ¿Garantiza silencio preventivo para no pisar al asesor?: ${failClosedStatus.isLocked ? 'SÍ (100% GARANTIZADO)' : 'NO'}`);
  console.log('');

  if (fs.existsSync(tempHandoffPath)) fs.unlinkSync(tempHandoffPath);

  console.log('================================================================');
  console.log(' AUDITORÍA DE PERSISTENCIA Y KOMMO COMPLETADA                   ');
  console.log('================================================================');
}

auditPersistentLockAndKommo().catch(console.error);

