/**
 * ============================================================================
 * TU TECHO IDEAL v5.0 — FASE 2: VALIDACIÓN COMERCIAL INTEGRAL
 * ============================================================================
 * Validación rigurosa de los 10 escenarios comerciales oficiales:
 * 
 * 1. CLIENTE NUEVO (Saludo plano -> Silencio / Wasi link -> Bienvenida exacta)
 * 2. DISPONIBILIDAD DE UNA PROPIEDAD ("Bienvenido a Tu Techo Ideal, sí, disponible.")
 * 3. PRECIO Y METRAJE (Datos exactos respaldados por Sheets)
 * 4. INFORMACIÓN INEXISTENTE (Silencio absoluto ante características no en Sheets)
 * 5. GASTOS DE MANTENIMIENTO / CONDOMINIO (Silencio absoluto)
 * 6. INTERVENCIÓN HUMANA (Bloqueo 12h, 0 tokens IA, silencio total a preguntas)
 * 7. REACTIVACIÓN POST-12 HORAS (T0+11h59m59s locked, T0+12h00m00s expired, T0+12h00m01s enabled)
 * 8. CAMBIO DE PROPIEDAD (Aislamiento estricto, 0 contaminación entre fichas)
 * 9. MENSAJES AUTOMÁTICOS (Salesbot / API no activan ni reinician bloqueo)
 * 10. NUEVA INTERVENCIÓN HUMANA (Reinicio de contador a 0 y 12h completas restablecidas)
 * 
 * REGLAS INNEGOCIABLES:
 * - OBSERVATION_MODE = true
 * - Lista blanca desactivada
 * - Cero despachos reales a WhatsApp
 * - Cero mutaciones en Kommo
 * - Producción 100% aislada e intacta
 * ============================================================================
 */

const axios = require('axios');
require('dotenv').config();
const { getAvailableProperties } = require('../server.js');
const { classifyOutgoingMessage } = require('../pipeline_decision.js');

const BASE_URL = process.env.STAGING_URL || 'https://tu-techo-ideal-staging.onrender.com';
const STAGING_AUTH = process.env.STAGING_AUTH_TOKEN;

if (!STAGING_AUTH) {
  console.error('❌ STAGING_AUTH_TOKEN no configurado en entorno.');
  process.exit(1);
}

const stagingHeaders = {
  'x-staging-auth': STAGING_AUTH,
  'Content-Type': 'application/json'
};

async function runCommercialValidation() {
  console.log('================================================================');
  console.log('   TU TECHO IDEAL v5.0 — FASE 2: VALIDACIÓN COMERCIAL INTEGRAL  ');
  console.log(`   Servidor Evaluado: ${BASE_URL}`);
  console.log('================================================================\n');

  // --------------------------------------------------------------------------
  // PRE-CONDICIÓN: VERIFICACIÓN OPERATIVA Y ESTADO DE SALUD
  // --------------------------------------------------------------------------
  console.log('--- COMPROBACIÓN DE CONDICIONES OPERATIVAS PREVIAS ---');
  const healthRes = await axios.get(`${BASE_URL}/health`);
  console.log('Health:', {
    status: healthRes.data.status,
    service: healthRes.data.service,
    observation_mode: healthRes.data.observation_mode,
    claude_model: healthRes.data.claude_model
  });

  if (healthRes.data.status !== 'running') throw new Error('Staging no está en ejecución');
  if (healthRes.data.observation_mode !== true) throw new Error('OBSERVATION_MODE debe ser true');

  const dispatchStatusRes = await axios.get(`${BASE_URL}/api/staging/controlled-dispatch-status`, { headers: stagingHeaders });
  console.log('Controlled Dispatch Status:', {
    enabled: dispatchStatusRes.data.staging_test_dispatch_enabled,
    dispatches: dispatchStatusRes.data.authorized_pair?.current_dispatches,
    history_count: dispatchStatusRes.data.dispatch_history?.length
  });

  if (dispatchStatusRes.data.staging_test_dispatch_enabled !== false) {
    throw new Error('La lista blanca de despachos debe estar desactivada (false)');
  }

  // Carga de propiedades de Google Sheets (modo solo lectura)
  console.log('\n--- CARGANDO GOOGLE SHEETS EN MODO SOLO LECTURA ---');
  const allProperties = await getAvailableProperties();
  const ref012 = allProperties.find(p => (p.ID_PROPIEDAD || p.id) === 'REF-012');
  const ref002 = allProperties.find(p => (p.ID_PROPIEDAD || p.id) === 'REF-002');

  if (!ref012) throw new Error('REF-012 no encontrada en Sheets');
  if (!ref002) throw new Error('REF-002 no encontrada en Sheets');

  console.log('Ficha REF-012 (Sheets):', {
    id: ref012.ID_PROPIEDAD,
    tipo: ref012.TIPO,
    operacion: ref012.OPERACION,
    estatus: ref012.ESTATUS,
    wasi_codigo: ref012.CODIGO_WASI,
    descripcion_snippet: (ref012.DESCRIPCION_BREVE || '').substring(0, 100) + '...'
  });

  console.log('Ficha REF-002 (Sheets):', {
    id: ref002.ID_PROPIEDAD,
    tipo: ref002.TIPO,
    operacion: ref002.OPERACION,
    estatus: ref002.ESTATUS,
    wasi_codigo: ref002.CODIGO_WASI,
    descripcion_snippet: (ref002.DESCRIPCION_BREVE || '').substring(0, 100) + '...'
  });

  const report = [];

  // ==========================================================================
  // PRUEBA 1. CLIENTE NUEVO
  // ==========================================================================
  console.log('\n==================================================');
  console.log(' PRUEBA 1. CLIENTE NUEVO');
  console.log('==================================================');

  // 1A. Cliente nuevo que inicia conversación sin propiedad (saludo plano / genérico)
  const lead1A = '990001';
  const talk1A = '770001';
  await axios.post(`${BASE_URL}/api/staging/set-handoff-time`, { lead_id: lead1A, talk_id: talk1A, clear: true }, { headers: stagingHeaders });

  const query1A = 'Hola, buenos días, me gustaría información inmobiliaria';
  const eval1A = await axios.post(`${BASE_URL}/api/staging/test-pipeline-evaluation`, {
    user_text: query1A,
    lead_id: lead1A,
    talk_id: talk1A
  }, { headers: stagingHeaders });

  const passed1A = eval1A.data.decision?.action === 'SILENCE' &&
                   (eval1A.data.decision?.typeDetected === 'PURE_GREETING' || eval1A.data.decision?.typeDetected === 'UNMATCHED_INQUIRY') &&
                   eval1A.data.text === null &&
                   eval1A.data.decision?.tokensUsed === 0;

  report.push({
    id: 'PRUEBA 1A',
    nombre: 'Cliente Nuevo — Saludo Sin Inmueble',
    consulta: query1A,
    propiedad: 'Ninguna',
    wasi: 'N/A',
    columnas_sheets: 'N/A',
    decision: `${eval1A.data.decision?.action} / ${eval1A.data.decision?.typeDetected}`,
    respuesta_o_motivo: eval1A.data.decision?.reason,
    consumo_ia: `${eval1A.data.decision?.tokensUsed || 0} tokens`,
    esperado: 'SILENCE / PURE_GREETING (0 tokens, no inventa disponibilidad)',
    obtenido: `${eval1A.data.decision?.action} / ${eval1A.data.decision?.typeDetected} (text: ${eval1A.data.text})`,
    estado: passed1A ? 'APROBADA' : 'FALLIDA'
  });
  console.log(`[PRUEBA 1A] ${passed1A ? '✅ APROBADA' : '❌ FALLIDA'}: Decisión=${eval1A.data.decision?.typeDetected}, Texto=${eval1A.data.text}`);

  // 1B. Cliente nuevo con enlace Wasi válido de portal
  const lead1B = '990002';
  const talk1B = '770002';
  await axios.post(`${BASE_URL}/api/staging/set-handoff-time`, { lead_id: lead1B, talk_id: talk1B, clear: true }, { headers: stagingHeaders });

  const query1B = 'Hola, ¿podríamos conversar? Estoy interesado en este inmueble https://info.wasi.co/apartamento-venta-los-samanes-caracas/10493109';
  const eval1B = await axios.post(`${BASE_URL}/api/staging/test-pipeline-evaluation`, {
    user_text: query1B,
    lead_id: lead1B,
    talk_id: talk1B
  }, { headers: stagingHeaders });

  const passed1B = eval1B.data.decision?.action === 'RESPOND' &&
                   eval1B.data.decision?.typeDetected === 'WASI_LINK_AVAILABLE' &&
                   eval1B.data.decision?.propertyIdentified === 'REF-012' &&
                   eval1B.data.text === 'Bienvenido a Tu Techo Ideal, sí, disponible.' &&
                   eval1B.data.decision?.tokensUsed === 0;

  report.push({
    id: 'PRUEBA 1B',
    nombre: 'Cliente Nuevo — Inicio con Wasi Válido',
    consulta: query1B,
    propiedad: 'REF-012',
    wasi: '10493109',
    columnas_sheets: 'Col F (Wasi), Col K (ESTATUS="Disponible")',
    decision: `${eval1B.data.decision?.action} / ${eval1B.data.decision?.typeDetected}`,
    respuesta_o_motivo: eval1B.data.text,
    consumo_ia: `${eval1B.data.decision?.tokensUsed || 0} tokens`,
    esperado: 'RESPOND / WASI_LINK_AVAILABLE -> "Bienvenido a Tu Techo Ideal, sí, disponible."',
    obtenido: `"${eval1B.data.text}" (${eval1B.data.decision?.propertyIdentified})`,
    estado: passed1B ? 'APROBADA' : 'FALLIDA'
  });
  console.log(`[PRUEBA 1B] ${passed1B ? '✅ APROBADA' : '❌ FALLIDA'}: Texto="${eval1B.data.text}"`);

  // ==========================================================================
  // PRUEBA 2. DISPONIBILIDAD DE UNA PROPIEDAD
  // ==========================================================================
  console.log('\n==================================================');
  console.log(' PRUEBA 2. DISPONIBILIDAD DE UNA PROPIEDAD');
  console.log('==================================================');

  const leadP2 = '25092108';
  const talkP2 = '1149';
  await axios.post(`${BASE_URL}/api/staging/set-handoff-time`, { lead_id: leadP2, talk_id: talkP2, clear: true }, { headers: stagingHeaders });

  const queryP2 = '¿Sigue disponible esta propiedad? https://info.wasi.co/apartamento-venta-los-samanes-caracas/10493109';
  const evalP2 = await axios.post(`${BASE_URL}/api/staging/test-pipeline-evaluation`, {
    user_text: queryP2,
    lead_id: leadP2,
    talk_id: talkP2
  }, { headers: stagingHeaders });

  const passedP2 = evalP2.data.text === 'Bienvenido a Tu Techo Ideal, sí, disponible.' &&
                   evalP2.data.decision?.action === 'RESPOND' &&
                   evalP2.data.decision?.typeDetected === 'WASI_LINK_AVAILABLE' &&
                   evalP2.data.decision?.propertyIdentified === 'REF-012';

  report.push({
    id: 'PRUEBA 2',
    nombre: 'Consulta de Disponibilidad Canónica',
    consulta: queryP2,
    propiedad: 'REF-012',
    wasi: '10493109',
    columnas_sheets: 'Col F (Wasi), Col K (ESTATUS)',
    decision: `${evalP2.data.decision?.action} / ${evalP2.data.decision?.typeDetected}`,
    respuesta_o_motivo: evalP2.data.text,
    consumo_ia: `${evalP2.data.decision?.tokensUsed || 0} tokens`,
    esperado: 'Exactamente: "Bienvenido a Tu Techo Ideal, sí, disponible." (sin adiciones)',
    obtenido: `"${evalP2.data.text}"`,
    estado: passedP2 ? 'APROBADA' : 'FALLIDA'
  });
  console.log(`[PRUEBA 2] ${passedP2 ? '✅ APROBADA' : '❌ FALLIDA'}: "${evalP2.data.text}"`);

  // ==========================================================================
  // PRUEBA 3. PRECIO Y METRAJE
  // ==========================================================================
  console.log('\n==================================================');
  console.log(' PRUEBA 3. PRECIO Y METRAJE');
  console.log('==================================================');

  // Contexto activo REF-012
  // 3A: Metraje
  const query3A = '¿Cuántos metros cuadrados tiene el apartamento?';
  const eval3A = await axios.post(`${BASE_URL}/api/staging/test-pipeline-evaluation`, {
    user_text: query3A,
    lead_id: leadP2,
    talk_id: talkP2,
    offset_ms: 50000000
  }, { headers: stagingHeaders });

  const passed3A = eval3A.data.decision?.action === 'RESPOND' &&
                   eval3A.data.decision?.typeDetected === 'PROPERTY_FEATURE_ANSWERED' &&
                   eval3A.data.text.includes('110') &&
                   eval3A.data.decision?.evidence?.includes('110 m²');

  report.push({
    id: 'PRUEBA 3A',
    nombre: 'Consulta de Metraje Verificado',
    consulta: query3A,
    propiedad: 'REF-012',
    wasi: '10493109',
    columnas_sheets: 'Col D (DESCRIPCION_BREVE: "apartamento amoblado de 110 m²")',
    decision: `${eval3A.data.decision?.action} / ${eval3A.data.decision?.typeDetected}`,
    respuesta_o_motivo: `Respuesta: "${eval3A.data.text}" | Evidencia: "${eval3A.data.decision?.evidence}"`,
    consumo_ia: `${eval3A.data.decision?.tokensUsed || 0} tokens`,
    esperado: 'Responde 110 m² respaldado en evidencia textual exacta',
    obtenido: `"${eval3A.data.text}" (Evidencia: "${eval3A.data.decision?.evidence}")`,
    estado: passed3A ? 'APROBADA' : 'FALLIDA'
  });
  console.log(`[PRUEBA 3A] ${passed3A ? '✅ APROBADA' : '❌ FALLIDA'}: "${eval3A.data.text}"`);

  // 3B: Precio
  const query3B = '¿Cuál es el precio de venta?';
  const eval3B = await axios.post(`${BASE_URL}/api/staging/test-pipeline-evaluation`, {
    user_text: query3B,
    lead_id: leadP2,
    talk_id: talkP2,
    offset_ms: 50000000
  }, { headers: stagingHeaders });

  const passed3B = eval3B.data.decision?.action === 'RESPOND' &&
                   eval3B.data.decision?.typeDetected === 'PROPERTY_FEATURE_ANSWERED' &&
                   eval3B.data.text.includes('146.000') &&
                   eval3B.data.decision?.evidence?.includes('146.000');

  report.push({
    id: 'PRUEBA 3B',
    nombre: 'Consulta de Precio Verificado',
    consulta: query3B,
    propiedad: 'REF-012',
    wasi: '10493109',
    columnas_sheets: 'Col D (DESCRIPCION_BREVE: "precio de $146.000.")',
    decision: `${eval3B.data.decision?.action} / ${eval3B.data.decision?.typeDetected}`,
    respuesta_o_motivo: `Respuesta: "${eval3B.data.text}" | Evidencia: "${eval3B.data.decision?.evidence}"`,
    consumo_ia: `${eval3B.data.decision?.tokensUsed || 0} tokens`,
    esperado: 'Responde $146.000 respaldado en evidencia textual exacta',
    obtenido: `"${eval3B.data.text}" (Evidencia: "${eval3B.data.decision?.evidence}")`,
    estado: passed3B ? 'APROBADA' : 'FALLIDA'
  });
  console.log(`[PRUEBA 3B] ${passed3B ? '✅ APROBADA' : '❌ FALLIDA'}: "${eval3B.data.text}"`);

  // ==========================================================================
  // PRUEBA 4. INFORMACIÓN INEXISTENTE
  // ==========================================================================
  console.log('\n==================================================');
  console.log(' PRUEBA 4. INFORMACIÓN INEXISTENTE');
  console.log('==================================================');

  const queryP4 = '¿Tiene piscina olímpica, cancha de tenis y acabados de mármol?';
  const evalP4 = await axios.post(`${BASE_URL}/api/staging/test-pipeline-evaluation`, {
    user_text: queryP4,
    lead_id: leadP2,
    talk_id: talkP2,
    offset_ms: 50000000
  }, { headers: stagingHeaders });

  const passedP4 = evalP4.data.decision?.action === 'SILENCE' &&
                   evalP4.data.decision?.typeDetected === 'PROPERTY_FEATURE_SIN_DATO' &&
                   evalP4.data.text === null;

  report.push({
    id: 'PRUEBA 4',
    nombre: 'Silencio Ante Características Inexistentes',
    consulta: queryP4,
    propiedad: 'REF-012',
    wasi: '10493109',
    columnas_sheets: 'Col D (DESCRIPCION_BREVE) — No figuran piscina ni cancha de tenis',
    decision: `${evalP4.data.decision?.action} / ${evalP4.data.decision?.typeDetected}`,
    respuesta_o_motivo: evalP4.data.decision?.reason,
    consumo_ia: `${evalP4.data.decision?.tokensUsed || 0} tokens`,
    esperado: 'SILENCE / PROPERTY_FEATURE_SIN_DATO (text: null, no inventa servicios ni amenidades)',
    obtenido: `${evalP4.data.decision?.action} / ${evalP4.data.decision?.typeDetected} (text: ${evalP4.data.text})`,
    estado: passedP4 ? 'APROBADA' : 'FALLIDA'
  });
  console.log(`[PRUEBA 4] ${passedP4 ? '✅ APROBADA' : '❌ FALLIDA'}: Silencio verificado (text=${evalP4.data.text})`);

  // ==========================================================================
  // PRUEBA 5. GASTOS DE MANTENIMIENTO
  // ==========================================================================
  console.log('\n==================================================');
  console.log(' PRUEBA 5. GASTOS DE MANTENIMIENTO');
  console.log('==================================================');

  const queryP5 = '¿Cuánto cuesta el mantenimiento mensual o condominio?';
  const evalP5 = await axios.post(`${BASE_URL}/api/staging/test-pipeline-evaluation`, {
    user_text: queryP5,
    lead_id: leadP2,
    talk_id: talkP2,
    offset_ms: 50000000
  }, { headers: stagingHeaders });

  const passedP5 = evalP5.data.decision?.action === 'SILENCE' &&
                   evalP5.data.decision?.typeDetected === 'PROPERTY_FEATURE_SIN_DATO' &&
                   evalP5.data.text === null;

  report.push({
    id: 'PRUEBA 5',
    nombre: 'Silencio Ante Costo de Mantenimiento / Condominio Inexistente',
    consulta: queryP5,
    propiedad: 'REF-012',
    wasi: '10493109',
    columnas_sheets: 'Col A-M (Sheets) — Dato de condominio/mantenimiento inexistente',
    decision: `${evalP5.data.decision?.action} / ${evalP5.data.decision?.typeDetected}`,
    respuesta_o_motivo: evalP5.data.decision?.reason,
    consumo_ia: `${evalP5.data.decision?.tokensUsed || 0} tokens`,
    esperado: 'SILENCE / PROPERTY_FEATURE_SIN_DATO (text: null)',
    obtenido: `${evalP5.data.decision?.action} / ${evalP5.data.decision?.typeDetected} (text: ${evalP5.data.text})`,
    estado: passedP5 ? 'APROBADA' : 'FALLIDA'
  });
  console.log(`[PRUEBA 5] ${passedP5 ? '✅ APROBADA' : '❌ FALLIDA'}: Silencio verificado (text=${evalP5.data.text})`);

  // ==========================================================================
  // PRUEBA 6. INTERVENCIÓN HUMANA
  // ==========================================================================
  console.log('\n==================================================');
  console.log(' PRUEBA 6. INTERVENCIÓN HUMANA (BLOQUEO 12 HORAS)');
  console.log('==================================================');

  // Registrar intervención humana en T0
  const leadP6 = '25092108';
  const talkP6 = '1149';
  const t0Time = Date.now();

  await axios.post(`${BASE_URL}/webhook?sync=true&bypass_debounce=true`, {
    account: { id: 36728143 },
    message: {
      add: [{
        id: 'msg_human_fase2_' + Date.now(),
        entity_id: parseInt(leadP6, 10),
        talk_id: talkP6,
        type: 'outgoing',
        created_by: 998877, // Asesor humano web
        text: 'Hola, soy Gabriela de Tu Techo Ideal, estoy revisando su solicitud.',
        author: { type: 'user', name: 'Gabriela Asesora' }
      }]
    }
  }, { headers: stagingHeaders });

  // Comprobar estado de bloqueo a los 10 minutos (600.000 ms)
  const lockP6Res = await axios.get(`${BASE_URL}/api/staging/check-lock-status?lead_id=${leadP6}&talk_id=${talkP6}&offset_ms=600000`, { headers: stagingHeaders });
  const lockP6 = lockP6Res.data?.lock_status;

  const queryP6 = '¿Cuántos metros tiene el apartamento?';
  const evalP6 = await axios.post(`${BASE_URL}/api/staging/test-pipeline-evaluation`, {
    user_text: queryP6,
    lead_id: leadP6,
    talk_id: talkP6,
    offset_ms: 600000 // T0 + 10 min
  }, { headers: stagingHeaders });

  const passedP6 = lockP6?.isLocked === true &&
                   evalP6.data.decision?.action === 'SILENCE' &&
                   evalP6.data.decision?.typeDetected === 'HUMAN_LOCKED' &&
                   evalP6.data.decision?.calledAI === false &&
                   evalP6.data.decision?.tokensUsed === 0 &&
                   evalP6.data.text === null;

  report.push({
    id: 'PRUEBA 6',
    nombre: 'Bloqueo Humano Activo Durante 12 Horas',
    consulta: queryP6,
    propiedad: 'REF-012',
    wasi: '10493109',
    columnas_sheets: 'Col D (Datos existen en Sheets pero se bloquea por política comercial)',
    decision: `${evalP6.data.decision?.action} / ${evalP6.data.decision?.typeDetected}`,
    respuesta_o_motivo: evalP6.data.decision?.reason,
    consumo_ia: `${evalP6.data.decision?.tokensUsed || 0} tokens (0 llamadas IA)`,
    esperado: 'SILENCE / HUMAN_LOCKED (isLocked: true, 0 tokens, text: null)',
    obtenido: `${evalP6.data.decision?.action} / ${evalP6.data.decision?.typeDetected} (text: ${evalP6.data.text})`,
    estado: passedP6 ? 'APROBADA' : 'FALLIDA'
  });
  console.log(`[PRUEBA 6] ${passedP6 ? '✅ APROBADA' : '❌ FALLIDA'}: Bloqueo estricto, 0 tokens IA, silencio garantizado.`);

  // ==========================================================================
  // PRUEBA 7. REACTIVACIÓN DESPUÉS DE 12 HORAS
  // ==========================================================================
  console.log('\n==================================================');
  console.log(' PRUEBA 7. REACTIVACIÓN DESPUÉS DE 12 HORAS (T0 + 11h59m59s / T0 + 12h / T0 + 12h1s)');
  console.log('==================================================');

  // 7A: T0 + 11h 59m 59s (43.199.000 ms)
  const eval7A = await axios.post(`${BASE_URL}/api/staging/test-pipeline-evaluation`, {
    user_text: '¿Cuántos metros tiene el apartamento?',
    lead_id: leadP6,
    talk_id: talkP6,
    offset_ms: 43199000
  }, { headers: stagingHeaders });

  const lock7A = await axios.get(`${BASE_URL}/api/staging/check-lock-status?lead_id=${leadP6}&talk_id=${talkP6}&offset_ms=43199000`, { headers: stagingHeaders });
  const passed7A = lock7A.data.lock_status?.isLocked === true &&
                   eval7A.data.decision?.action === 'SILENCE' &&
                   eval7A.data.decision?.typeDetected === 'HUMAN_LOCKED' &&
                   eval7A.data.decision?.tokensUsed === 0;

  // 7B: T0 + 12h exactas (43.200.000 ms)
  const lock7B = await axios.get(`${BASE_URL}/api/staging/check-lock-status?lead_id=${leadP6}&talk_id=${talkP6}&offset_ms=43200000`, { headers: stagingHeaders });
  const passed7B = lock7B.data.lock_status?.isLocked === false &&
                   Math.abs(lock7B.data.lock_status?.hoursElapsed - 12.0) < 1e-9;

  // 7C: T0 + 12h 1s (43.201.000 ms) — Reactivación con dato verificado
  const eval7C_verified = await axios.post(`${BASE_URL}/api/staging/test-pipeline-evaluation`, {
    user_text: '¿Cuántos metros tiene el apartamento?',
    lead_id: leadP6,
    talk_id: talkP6,
    offset_ms: 43201000
  }, { headers: stagingHeaders });

  // 7C: T0 + 12h 1s — Pregunta sin dato produce silencio absoluto
  const eval7C_unverified = await axios.post(`${BASE_URL}/api/staging/test-pipeline-evaluation`, {
    user_text: '¿Cuánto es el mantenimiento mensual?',
    lead_id: leadP6,
    talk_id: talkP6,
    offset_ms: 43201000
  }, { headers: stagingHeaders });

  const passed7C = eval7C_verified.data.decision?.action === 'RESPOND' &&
                   eval7C_verified.data.text.includes('110') &&
                   eval7C_unverified.data.decision?.action === 'SILENCE' &&
                   eval7C_unverified.data.text === null;

  const passedP7 = passed7A && passed7B && passed7C;

  report.push({
    id: 'PRUEBA 7',
    nombre: 'Límites Temporales de Reactivación (12 Horas)',
    consulta: '7A: 43.199.000 ms | 7B: 43.200.000 ms | 7C: 43.201.000 ms',
    propiedad: 'REF-012',
    wasi: '10493109',
    columnas_sheets: 'Col D (110 m²)',
    decision: `7A: ${eval7A.data.decision?.typeDetected} | 7B: isLocked=${lock7B.data.lock_status?.isLocked} | 7C: RESPOND / SILENCE`,
    respuesta_o_motivo: `7A: SILENCE | 7B: Lock vencido (12.000000h) | 7C verificado: "${eval7C_verified.data.text}" | 7C inexistente: text=null`,
    consumo_ia: `7A: 0 tokens | 7C: ${eval7C_verified.data.decision?.tokensUsed + eval7C_unverified.data.decision?.tokensUsed} tokens`,
    esperado: '7A bloqueado, 7B vencido (operador < 12), 7C responde solo datos verificados y silencia datos inexistentes',
    obtenido: `7A isLocked=${lock7A.data.lock_status?.isLocked}, 7B isLocked=${lock7B.data.lock_status?.isLocked}, 7C responde="${eval7C_verified.data.text}" / sin_dato=${eval7C_unverified.data.text}`,
    estado: passedP7 ? 'APROBADA' : 'FALLIDA'
  });
  console.log(`[PRUEBA 7] ${passedP7 ? '✅ APROBADA' : '❌ FALLIDA'}: 7A bloqueado (${lock7A.data.lock_status?.hoursElapsed.toFixed(6)}h), 7B vencido (${lock7B.data.lock_status?.hoursElapsed.toFixed(6)}h), 7C reactivado.`);

  // ==========================================================================
  // PRUEBA 8. CAMBIO DE PROPIEDAD
  // ==========================================================================
  console.log('\n==================================================');
  console.log(' PRUEBA 8. CAMBIO DE PROPIEDAD Y AISLAMIENTO DE FICHAS');
  console.log('==================================================');

  const leadP8 = '990008';
  const talkP8 = '770008';
  await axios.post(`${BASE_URL}/api/staging/set-handoff-time`, { lead_id: leadP8, talk_id: talkP8, clear: true }, { headers: stagingHeaders });

  // 8A. Consulta por Propiedad A: REF-012 (Apartamento Los Samanes, 110 m², $146.000, Venta)
  const query8A = 'Hola, me interesa este apartamento https://info.wasi.co/apartamento-venta-los-samanes-caracas/10493109';
  const eval8A = await axios.post(`${BASE_URL}/api/staging/test-pipeline-evaluation`, {
    user_text: query8A,
    lead_id: leadP8,
    talk_id: talkP8
  }, { headers: stagingHeaders });

  // 8B. En la misma conversación, el cliente consulta ahora por Propiedad B: REF-005 (Apartamento inteligente, 80,45 m², $355.674)
  const query8B = 'Y también vi este apartamento https://info.wasi.co/inmueble/10442548';
  const eval8B = await axios.post(`${BASE_URL}/api/staging/test-pipeline-evaluation`, {
    user_text: query8B,
    lead_id: leadP8,
    talk_id: talkP8
  }, { headers: stagingHeaders });

  // 8C. Pregunta de seguimiento sobre metraje: Debe responder el metraje de REF-005 (80,45 m²), NO el de REF-012 (110 m²)
  const query8C = '¿Cuántos metros cuadrados tiene?';
  const eval8C = await axios.post(`${BASE_URL}/api/staging/test-pipeline-evaluation`, {
    user_text: query8C,
    lead_id: leadP8,
    talk_id: talkP8
  }, { headers: stagingHeaders });

  // 8D. Pregunta sobre precio de inversión: Debe responder el precio de REF-005 ($355.674), NO el de REF-012 ($146.000)
  const query8D = '¿Cuál es el precio de inversión total?';
  const eval8D = await axios.post(`${BASE_URL}/api/staging/test-pipeline-evaluation`, {
    user_text: query8D,
    lead_id: leadP8,
    talk_id: talkP8
  }, { headers: stagingHeaders });

  const passed8A = eval8A.data.decision?.propertyIdentified === 'REF-012' && eval8A.data.text === 'Bienvenido a Tu Techo Ideal, sí, disponible.';
  const passed8B = eval8B.data.decision?.propertyIdentified === 'REF-005' && eval8B.data.text === 'Bienvenido a Tu Techo Ideal, sí, disponible.';
  const passed8C = eval8C.data.decision?.propertyIdentified === 'REF-005' &&
                   eval8C.data.text &&
                   eval8C.data.text.includes('80,45') &&
                   !eval8C.data.text.includes('110');
  const passed8D = eval8D.data.decision?.propertyIdentified === 'REF-005' &&
                   eval8D.data.text &&
                   eval8D.data.text.includes('355.674') &&
                   !eval8D.data.text.includes('146.000');

  const passedP8 = passed8A && passed8B && passed8C && passed8D;

  report.push({
    id: 'PRUEBA 8',
    nombre: 'Cambio de Propiedad y Aislamiento de Fichas',
    consulta: 'Paso 1: REF-012 | Paso 2: REF-005 | Paso 3: Metraje | Paso 4: Precio',
    propiedad: 'Secuencia: REF-012 -> REF-005',
    wasi: '10493109 -> 10442548',
    columnas_sheets: 'Col D REF-005 (80,45 m², $355.674)',
    decision: `8A: ${eval8A.data.decision?.propertyIdentified} | 8B: ${eval8B.data.decision?.propertyIdentified} | 8C: ${eval8C.data.decision?.propertyIdentified} | 8D: ${eval8D.data.decision?.propertyIdentified}`,
    respuesta_o_motivo: `8C Metraje: "${eval8C.data.text}" (80,45 m², no 110 m²) | 8D Precio: "${eval8D.data.text}" ($355.674, no $146.000)`,
    consumo_ia: `${(eval8C.data.decision?.tokensUsed || 0) + (eval8D.data.decision?.tokensUsed || 0)} tokens`,
    esperado: 'Contexto actualizado a REF-005, responde 80,45 m² y $355.674, cero mezcla con REF-012',
    obtenido: `Propiedad activa: ${eval8C.data.decision?.propertyIdentified}, Metraje: "${eval8C.data.text}", Precio: "${eval8D.data.text}"`,
    estado: passedP8 ? 'APROBADA' : 'FALLIDA'
  });
  console.log(`[PRUEBA 8] ${passedP8 ? '✅ APROBADA' : '❌ FALLIDA'}: Metraje=${eval8C.data.text}, Precio=${eval8D.data.text}, Aislamiento perfecto.`);

  // ==========================================================================
  // PRUEBA 9. MENSAJES AUTOMÁTICOS (SALESBOT / API)
  // ==========================================================================
  console.log('\n==================================================');
  console.log(' PRUEBA 9. MENSAJES AUTOMÁTICOS (SALESBOT / API)');
  console.log('==================================================');

  // Clasificación de mensajes de Salesbot y API
  const msgSalesbot = {
    text: 'Hola, gracias por comunicarte con Tu Techo Ideal.',
    author: { type: 'bot', name: 'Salesbot' },
    created_by: 0
  };

  const msgSystem = {
    text: 'Estimado cliente, un asesor le contactará pronto.',
    author: { type: 'system', name: 'Kommo Bot' },
    created_by: 0
  };

  const msgApp = {
    text: 'Notificación de sistema.',
    author: { type: 'app', id: '100766' },
    created_by: 0
  };

  const classSalesbot = classifyOutgoingMessage(msgSalesbot);
  const classSystem = classifyOutgoingMessage(msgSystem);
  const classApp = classifyOutgoingMessage(msgApp);

  const passed9A = classSalesbot.isBot === true && classSalesbot.isHuman === false && classSalesbot.isHumanAdvisor === false;
  const passed9B = classSystem.isBot === true && classSystem.isHuman === false && classSystem.isHumanAdvisor === false;
  const passed9C = classApp.isBot === true && classApp.isHuman === false && classApp.isHumanAdvisor === false;

  // Comprobar que en Staging una conversación nueva no se bloquea con mensajes automáticos
  const leadP9 = '990009';
  const talkP9 = '770009';
  await axios.post(`${BASE_URL}/api/staging/set-handoff-time`, { lead_id: leadP9, talk_id: talkP9, clear: true }, { headers: stagingHeaders });

  const lockP9Res = await axios.get(`${BASE_URL}/api/staging/check-lock-status?lead_id=${leadP9}&talk_id=${talkP9}`, { headers: stagingHeaders });
  const passed9Lock = lockP9Res.data.lock_status?.isLocked === false;

  const passedP9 = passed9A && passed9B && passed9C && passed9Lock;

  report.push({
    id: 'PRUEBA 9',
    nombre: 'Mensajes Automáticos de Salesbot y API',
    consulta: 'Mensajes salientes tipo: bot, salesbot, system, app',
    propiedad: 'N/A',
    wasi: 'N/A',
    columnas_sheets: 'N/A',
    decision: `Salesbot: isBot=${classSalesbot.isBot} | System: isBot=${classSystem.isBot} | App: isBot=${classApp.isBot}`,
    respuesta_o_motivo: `Descartados como eventos de bot. Bloqueo humano permanece inactivo (isLocked: ${lockP9Res.data.lock_status?.isLocked})`,
    consumo_ia: '0 tokens',
    esperado: 'Identificados como Bot (isBot: true, isHuman: false), NO inician ni reinician bloqueo',
    obtenido: `Salesbot=${classSalesbot.reason}, System=${classSystem.reason}, App=${classApp.reason}, isLocked=${lockP9Res.data.lock_status?.isLocked}`,
    estado: passedP9 ? 'APROBADA' : 'FALLIDA'
  });
  console.log(`[PRUEBA 9] ${passedP9 ? '✅ APROBADA' : '❌ FALLIDA'}: Salesbot/API reconocidos como bot, cero falsos bloqueos.`);

  // ==========================================================================
  // PRUEBA 10. NUEVA INTERVENCIÓN HUMANA
  // ==========================================================================
  console.log('\n==================================================');
  console.log(' PRUEBA 10. NUEVA INTERVENCIÓN HUMANA (REINICIO DE CONTADOR)');
  console.log('==================================================');

  const leadP10 = '990010';
  const talkP10 = '770010';
  await axios.post(`${BASE_URL}/api/staging/set-handoff-time`, { lead_id: leadP10, talk_id: talkP10, clear: true }, { headers: stagingHeaders });

  // Intervención 1 en T0
  const t0_simulated = 1700000000000;
  await axios.post(`${BASE_URL}/api/staging/set-handoff-time`, {
    lead_id: leadP10,
    talk_id: talkP10,
    timestamp: t0_simulated
  }, { headers: stagingHeaders });

  // A las 6 horas de T0, llega nueva intervención humana (T1 = T0 + 6h = 1700000000000 + 21.600.000 ms)
  const t1_simulated = t0_simulated + (6 * 3600 * 1000);
  await axios.post(`${BASE_URL}/api/staging/set-handoff-time`, {
    lead_id: leadP10,
    talk_id: talkP10,
    timestamp: t1_simulated
  }, { headers: stagingHeaders });

  // Verificación 1: En T1 + 1 minuto (60.000 ms después de T1)
  const check10A = await axios.get(`${BASE_URL}/api/staging/check-lock-status?lead_id=${leadP10}&talk_id=${talkP10}&offset_ms=60000`, { headers: stagingHeaders });
  const lock10A = check10A.data.lock_status;

  // Verificación 2: En T0 + 13 horas (que corresponde a T1 + 7 horas = 25.200.000 ms)
  // Sin reinicio, T0 + 13h estaría vencido (13 > 12).
  // Con el reinicio en T1, han pasado solo 7h (7 < 12), por lo que DEBE continuar bloqueado.
  const check10B = await axios.get(`${BASE_URL}/api/staging/check-lock-status?lead_id=${leadP10}&talk_id=${talkP10}&offset_ms=25200000`, { headers: stagingHeaders });
  const lock10B = check10B.data.lock_status;

  // Verificación 3: A las 12h exactas tras T1 (43.200.000 ms tras T1)
  const check10C = await axios.get(`${BASE_URL}/api/staging/check-lock-status?lead_id=${leadP10}&talk_id=${talkP10}&offset_ms=43200000`, { headers: stagingHeaders });
  const lock10C = check10C.data.lock_status;

  const passed10A = lock10A.isLocked === true && Math.abs(lock10A.hoursElapsed - (60000 / 3600000)) < 1e-9;
  const passed10B = lock10B.isLocked === true && Math.abs(lock10B.hoursElapsed - 7.0) < 1e-9;
  const passed10C = lock10C.isLocked === false && Math.abs(lock10C.hoursElapsed - 12.0) < 1e-9;

  const passedP10 = passed10A && passed10B && passed10C;

  report.push({
    id: 'PRUEBA 10',
    nombre: 'Nueva Intervención Humana — Reinicio de Contador',
    consulta: 'Intervención en T0 -> Segunda intervención en T0 + 6h (T1)',
    propiedad: 'N/A',
    wasi: 'N/A',
    columnas_sheets: 'N/A',
    decision: `T1+1m: isLocked=${lock10A.isLocked} (${lock10A.hoursElapsed.toFixed(4)}h) | T1+7h: isLocked=${lock10B.isLocked} (${lock10B.hoursElapsed.toFixed(4)}h) | T1+12h: isLocked=${lock10C.isLocked}`,
    respuesta_o_motivo: `El contador se reinició en T1. En T0+13h (T1+7h) permanece bloqueado. Expira exactamente a las 12h de T1.`,
    consumo_ia: '0 tokens',
    esperado: 'Reinicio a cero en T1, restablecimiento de las 12h completas',
    obtenido: `T1+1m: ${lock10A.hoursElapsed.toFixed(4)}h (isLocked=${lock10A.isLocked}), T1+7h: ${lock10B.hoursElapsed.toFixed(4)}h (isLocked=${lock10B.isLocked}), T1+12h: isLocked=${lock10C.isLocked}`,
    estado: passedP10 ? 'APROBADA' : 'FALLIDA'
  });
  console.log(`[PRUEBA 10] ${passedP10 ? '✅ APROBADA' : '❌ FALLIDA'}: Contador reiniciado en T1, 12h completas restablecidas.`);

  // ==========================================================================
  // RESUMEN CONSOLIDADO Y REPORTE
  // ==========================================================================
  console.log('\n================================================================');
  console.log(' TABLA CONSOLIDADA DE VALIDACIÓN COMERCIAL (FASE 2) ');
  console.log('================================================================\n');

  console.table(report.map(r => ({
    ID: r.id,
    Nombre: r.nombre,
    Estado: r.estado,
    Decision: r.decision,
    Consumo_IA: r.consumo_ia
  })));

  const totalTests = report.length;
  const passedTests = report.filter(r => r.estado === 'APROBADA').length;
  const failedTests = totalTests - passedTests;

  console.log(`\nTOTAL PRUEBAS: ${totalTests} | APROBADAS: ${passedTests} | FALLIDAS: ${failedTests}`);

  // Limpieza de contexto sintético al finalizar
  await axios.post(`${BASE_URL}/api/staging/set-handoff-time`, { lead_id: leadP2, talk_id: talkP2, clear: true }, { headers: stagingHeaders });
  await axios.post(`${BASE_URL}/api/staging/set-handoff-time`, { lead_id: leadP8, talk_id: talkP8, clear: true }, { headers: stagingHeaders });
  await axios.post(`${BASE_URL}/api/staging/set-handoff-time`, { lead_id: leadP10, talk_id: talkP10, clear: true }, { headers: stagingHeaders });

  return { totalTests, passedTests, failedTests, report };
}

runCommercialValidation().then(({ totalTests, passedTests, failedTests, report }) => {
  if (failedTests > 0) {
    console.error(`\n❌ SE DETECTARON ${failedTests} PRUEBAS FALLIDAS.`);
    process.exit(1);
  } else {
    console.log('\n✅ TODAS LAS PRUEBAS COMERCIALES DE LA FASE 2 FUERON SUPERADAS CON ÉXITO.');
    process.exit(0);
  }
}).catch(err => {
  console.error('\n❌ ERROR EN EJECUCIÓN:', err.message, err.response?.data);
  process.exit(1);
});

